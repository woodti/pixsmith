import { desktop } from '../lib/desktop'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { Download, Eraser, Eye, EyeOff, Hand, ImagePlus, Loader2, Maximize, Minus, Paintbrush, Plus, RefreshCw, Undo2, X } from 'lucide-react'
import { detectFaces, device, foreground, matte } from '../ai/client'
import type { MatteModel } from '../ai/models'
import { compose, strokePx, type Effects, type Rect } from '../lib/effects'
import { alphaBounds, baseName, download, loadImage, makeCanvas, toBlob } from '../lib/image'
import { useFiles } from '../lib/useFiles'
import { drawChecker, prepareCanvas, useBrushCursor, useViewport } from '../lib/viewport'
import { BusyOverlay, DropZone, Group, Row, Segment, Swatches, ensureModels, type Busy } from '../ui'

type Mode = 'auto' | 'portrait' | 'object' | 'hd'
type Crop = 'none' | 'subject' | 'square'
type Tool = 'view' | 'erase' | 'restore'

interface Item {
  id: number
  name: string
  thumb: string
  src: HTMLCanvasElement
  fg: HTMLCanvasElement | null
  status: 'queued' | 'running' | 'done' | 'error'
  used?: MatteModel
  /** bumped after every edit so derived canvases are rebuilt */
  ver: number
}

const MAX_ITEMS = 10
const MAX_PIXELS = 8_000_000
const MODEL_NAMES: Record<MatteModel, string> = { modnet: '人像', isnet: '通用', birefnet: '高清' }
const COLORS = [
  { name: '白', color: '#ffffff' },
  { name: '浅灰', color: '#f2f2f2' },
  { name: '黑', color: '#111111' },
  { name: '蓝', color: '#438edb' },
  { name: '红', color: '#d8222c' },
  { name: '米黄', color: '#f6ead3' },
]
const GRADIENTS: [string, string][] = [
  ['#a1c4fd', '#c2e9fb'],
  ['#ffecd2', '#fcb69f'],
  ['#a18cd1', '#fbc2eb'],
  ['#d4fc79', '#96e6a1'],
  ['#fa709a', '#fee140'],
  ['#667eea', '#764ba2'],
  ['#0f2027', '#2c5364'],
]
const STROKE_COLORS = [
  { name: '白', color: '#ffffff' },
  { name: '黑', color: '#111111' },
  { name: '黄', color: '#ffd84d' },
  { name: '粉', color: '#ff8fb1' },
]
const DEFAULT_FX: Effects = {
  bg: 'transparent',
  color: '#ffffff',
  gradient: GRADIENTS[0],
  image: null,
  blur: 3,
  stroke: 0,
  strokeColor: '#ffffff',
  shadow: 'none',
}

let nextId = 1

export default function Cutout({ toast }: { toast: (msg: string) => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [mode, setMode] = useState<Mode>('auto')
  const [hdOk, setHdOk] = useState(false)
  const [fx, setFx] = useState<Effects>(DEFAULT_FX)
  const [crop, setCrop] = useState<Crop>('none')
  const [pad, setPad] = useState(8)
  const [tool, setTool] = useState<Tool>('view')
  const [brush, setBrush] = useState(40)
  const [showOriginal, setShowOriginal] = useState(false)
  const [stroking, setStroking] = useState(false)
  const stageRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const running = useRef(false)
  const edit = useRef<{ id: number; fg: ImageData; src: ImageData; undo: Uint8ClampedArray[] } | null>(null)
  const last = useRef<[number, number] | null>(null)
  const cursor = useBrushCursor()

  const item = items.find((i) => i.id === selected) ?? null
  const setFxKey = <K extends keyof Effects>(k: K, v: Effects[K]) => setFx((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    device().then((d) => setHdOk(d.webgpu && d.f16))
  }, [])

  const addFiles = useCallback(
    async (files: File[]) => {
      const room = MAX_ITEMS - items.length
      if (room <= 0) return toast(`一次最多处理 ${MAX_ITEMS} 张，先删掉几张吧`)
      if (files.length > room) toast(`一次最多 ${MAX_ITEMS} 张，只添加了前 ${room} 张`)
      const added: Item[] = []
      for (const f of files.slice(0, room)) {
        try {
          const src = await loadImage(f, MAX_PIXELS)
          added.push({ id: nextId++, name: f.name, thumb: URL.createObjectURL(f), src, fg: null, status: 'queued', ver: 0 })
        } catch {
          toast(`${f.name} 无法读取`)
        }
      }
      if (!added.length) return
      setItems((list) => [...list, ...added])
      setSelected((s) => s ?? added[0].id)
    },
    [items.length, toast],
  )
  const { dragging, dropProps } = useFiles(addFiles)

  // Work through the queue one image at a time.
  useEffect(() => {
    if (running.current) return
    const next = items.find((i) => i.status === 'queued')
    if (!next) return
    running.current = true
    const update = (patch: Partial<Item>) => setItems((list) => list.map((i) => (i.id === next.id ? { ...i, ...patch } : i)))
    update({ status: 'running' })
    ;(async () => {
      try {
        let model: MatteModel = mode === 'object' ? 'isnet' : mode === 'hd' ? 'birefnet' : 'modnet'
        if (mode === 'auto') {
          await ensureModels(['yunet'], setBusy)
          setBusy({ label: '判断图片类型…' })
          const faces = await detectFaces(next.src)
          const area = next.src.width * next.src.height
          model = faces.some((f) => (f.w * f.h) / area > 0.01) ? 'modnet' : 'isnet'
        }
        await ensureModels([model], setBusy)
        setBusy({ label: model === 'modnet' ? '抠出人像…' : '识别主体…（通用模型稍慢，请稍候）' })
        const alpha = await matte(next.src, model)
        setBusy({ label: '处理边缘…' })
        const data = await foreground(next.src, alpha)
        const fg = makeCanvas(data.width, data.height)
        fg.getContext('2d')!.putImageData(data, 0, 0)
        update({ fg, status: 'done', used: model, ver: next.ver + 1 })
      } catch (err) {
        console.error(err)
        toast(`${next.name} 处理失败：${err instanceof Error ? err.message : err}`)
        update({ status: 'error' })
      } finally {
        setBusy(null)
        running.current = false
      }
    })()
  }, [items, mode, toast])

  const subjectOf = useCallback((it: Item): Rect => {
    const W = it.src.width
    const H = it.src.height
    if (!it.fg) return { x: 0, y: 0, w: W, h: H }
    const data = it.fg.getContext('2d')!.getImageData(0, 0, W, H).data
    return alphaBounds(data, W, H, 4) ?? { x: 0, y: 0, w: W, h: H }
  }, [])

  /** Output rectangle in source-image coordinates. */
  const regionOf = useCallback(
    (it: Item, subject: Rect): Rect => {
      if (crop === 'none' || !it.fg) return { x: 0, y: 0, w: it.src.width, h: it.src.height }
      const p = (Math.max(subject.w, subject.h) * pad) / 100 + strokePx(fx, subject)
      let r = { x: subject.x - p, y: subject.y - p, w: subject.w + 2 * p, h: subject.h + 2 * p }
      if (crop === 'square') {
        const s = Math.max(r.w, r.h)
        r = { x: r.x - (s - r.w) / 2, y: r.y - (s - r.h) / 2, w: s, h: s }
      }
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }
    },
    [crop, pad, fx],
  )

  const subject = useMemo(() => (item ? subjectOf(item) : null), [item?.id, item?.ver, subjectOf])
  const region = useMemo(() => (item && subject ? regionOf(item, subject) : null), [item, subject, regionOf])
  const composite = useMemo(
    () => (item?.fg && subject && region ? compose(item.fg, item.src, region, subject, fx) : null),
    [item?.id, item?.ver, item?.fg, subject, region, fx],
  )

  const vp = useViewport(stageRef, region?.w ?? 0, region?.h ?? 0)

  const draw = useCallback(() => {
    const c = canvasRef.current
    if (!c || !item || !region) return
    const ctx = prepareCanvas(c, vp.size, vp.view)
    const raw = showOriginal || !item.fg
    if (raw) {
      ctx.drawImage(item.src, -region.x, -region.y)
      return
    }
    if (fx.bg === 'transparent' || stroking) drawChecker(ctx, region.w, region.h)
    if (stroking || !composite) {
      // cheap path while painting: effects are rebuilt when the stroke ends
      if (fx.bg === 'color') {
        ctx.fillStyle = fx.color
        ctx.fillRect(0, 0, region.w, region.h)
      }
      ctx.drawImage(item.fg!, -region.x, -region.y)
    } else ctx.drawImage(composite, 0, 0)
  }, [item, region, composite, vp.size, vp.view, showOriginal, fx.bg, fx.color, stroking])
  useEffect(draw, [draw])

  useEffect(() => {
    if (edit.current && edit.current.id !== selected) edit.current = null
  }, [selected])

  const beginEdit = () => {
    if (!item?.fg) return null
    if (!edit.current || edit.current.id !== item.id) {
      const W = item.src.width
      const H = item.src.height
      edit.current = {
        id: item.id,
        fg: item.fg.getContext('2d')!.getImageData(0, 0, W, H),
        src: item.src.getContext('2d')!.getImageData(0, 0, W, H),
        undo: [],
      }
    }
    return edit.current
  }

  const paint = (from: [number, number], to: [number, number]) => {
    const ed = edit.current
    if (!ed || !item?.fg || !region) return
    const W = item.src.width
    const H = item.src.height
    const r = brush / 2 / vp.view.scale
    const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / (r / 3)))
    let x0 = W
    let y0 = H
    let x1 = 0
    let y1 = 0
    const d = ed.fg.data
    const s = ed.src.data
    for (let t = 1; t <= steps; t++) {
      const cx = from[0] + ((to[0] - from[0]) * t) / steps
      const cy = from[1] + ((to[1] - from[1]) * t) / steps
      const bx0 = Math.max(0, Math.floor(cx - r))
      const bx1 = Math.min(W - 1, Math.ceil(cx + r))
      const by0 = Math.max(0, Math.floor(cy - r))
      const by1 = Math.min(H - 1, Math.ceil(cy + r))
      for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          const dist = Math.hypot(x - cx, y - cy) / r
          if (dist >= 1) continue
          const f = dist < 0.7 ? 1 : (1 - dist) / 0.3 // soft outer rim
          const i = (y * W + x) * 4
          if (tool === 'erase') d[i + 3] = d[i + 3] * (1 - f)
          else {
            const a = Math.max(d[i + 3], 255 * f)
            if (a > d[i + 3]) {
              d[i] = s[i]
              d[i + 1] = s[i + 1]
              d[i + 2] = s[i + 2]
              d[i + 3] = a
            }
          }
        }
      }
      x0 = Math.min(x0, bx0)
      y0 = Math.min(y0, by0)
      x1 = Math.max(x1, bx1)
      y1 = Math.max(y1, by1)
    }
    if (x1 >= x0 && y1 >= y0) item.fg.getContext('2d')!.putImageData(ed.fg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1)
    draw()
  }

  const bump = (id: number) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ver: i.ver + 1 } : i)))

  const toImg = (p: [number, number]): [number, number] => [p[0] + (region?.x ?? 0), p[1] + (region?.y ?? 0)]
  const editing = tool !== 'view' && !!item?.fg && !showOriginal
  const stroke = {
    onStart: (p: [number, number]) => {
      const ed = beginEdit()
      if (!ed) return
      ed.undo.push(ed.fg.data.slice())
      if (ed.undo.length > 5) ed.undo.shift()
      setStroking(true)
      last.current = toImg(p)
      paint(last.current, last.current)
    },
    onMove: (p: [number, number]) => {
      if (!last.current) return
      const q = toImg(p)
      paint(last.current, q)
      last.current = q
    },
    onEnd: () => {
      if (!last.current || !item) return
      last.current = null
      setStroking(false)
      bump(item.id)
    },
  }

  const undo = () => {
    const ed = edit.current
    if (!ed || !item?.fg || !ed.undo.length) return
    ed.fg.data.set(ed.undo.pop()!)
    item.fg.getContext('2d')!.putImageData(ed.fg, 0, 0)
    bump(item.id)
  }

  const render = async (it: Item) => {
    const s = subjectOf(it)
    return toBlob(compose(it.fg!, it.src, regionOf(it, s), s, fx), 'image/png')
  }

  const saveOne = async () => {
    if (!item?.fg) return
    download(await render(item), `${baseName(item.name)}-抠图.png`)
  }

  const saveAll = async () => {
    const done = items.filter((i) => i.fg)
    if (!done.length) return
    setBusy({ label: '打包中…' })
    try {
      const zip = new JSZip()
      const used = new Set<string>()
      for (const it of done) {
        let name = `${baseName(it.name)}-抠图.png`
        for (let n = 2; used.has(name); n++) name = `${baseName(it.name)}-抠图-${n}.png`
        used.add(name)
        zip.file(name, await render(it))
      }
      download(await zip.generateAsync({ type: 'blob' }), '抠图.zip')
    } finally {
      setBusy(null)
    }
  }

  const redo = () => {
    if (!item || item.status === 'running') return
    if (edit.current?.id === item.id) edit.current = null
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, fg: null, status: 'queued', used: undefined } : i)))
  }

  const remove = (id: number) => {
    const it = items.find((i) => i.id === id)
    if (!it || it.status === 'running') return
    URL.revokeObjectURL(it.thumb)
    const rest = items.filter((i) => i.id !== id)
    setItems(rest)
    if (selected === id) setSelected(rest[0]?.id ?? null)
  }

  const pickBgImage = async (file: File) => {
    try {
      setFx((f) => ({ ...f, bg: 'image' }))
      const img = await loadImage(file, 8_000_000)
      setFx((f) => ({ ...f, bg: 'image', image: img }))
    } catch {
      toast('背景图无法读取')
    }
  }

  const doneCount = items.filter((i) => i.fg).length

  return (
    <main className="workspace">
      <section ref={stageRef} className={`stage${dragging ? ' dragging' : ''}`} {...dropProps} {...cursor.track}>
        {item ? (
          <>
            <canvas
              ref={canvasRef}
              className="fill"
              style={{ cursor: editing ? 'none' : 'grab' }}
              {...vp.bind(!editing, stroke)}
            />
            {editing && cursor.pos && (
              <div className="brush-cursor" style={{ left: cursor.pos.x, top: cursor.pos.y, width: brush, height: brush }} />
            )}
            <div className="stage-tools">
              <button className={tool === 'view' ? 'on' : ''} title="查看 / 移动画面" onClick={() => setTool('view')}>
                <Hand size={16} />
              </button>
              <button className={tool === 'erase' ? 'on' : ''} title="擦除画笔" disabled={!item.fg} onClick={() => setTool('erase')}>
                <Eraser size={16} />
              </button>
              <button className={tool === 'restore' ? 'on' : ''} title="恢复画笔" disabled={!item.fg} onClick={() => setTool('restore')}>
                <Paintbrush size={16} />
              </button>
              <span className="sep-v" />
              <button title="缩小" onClick={() => vp.zoomBy(1 / 1.25)}>
                <Minus size={16} />
              </button>
              <span className="zoom">{Math.round(vp.view.scale * 100)}%</span>
              <button title="放大" onClick={() => vp.zoomBy(1.25)}>
                <Plus size={16} />
              </button>
              <button title="适应窗口" onClick={vp.fit}>
                <Maximize size={16} />
              </button>
            </div>
          </>
        ) : (
          <DropZone
            title="上传图片，自动去掉背景"
            sub={`人像、商品、宠物都可以 · 一次最多 ${MAX_ITEMS} 张 · 图片只在本地处理，不上传`}
            onFiles={addFiles}
            multiple
          />
        )}
        {item?.fg && !busy && (
          <div className="hint">
            {editing
              ? `${tool === 'erase' ? '涂抹要去掉的地方' : '涂抹要找回的地方'}，滚轮缩放，按住空格拖动画面`
              : '边缘不满意？用上方的擦除 / 恢复画笔修一下'}
          </div>
        )}
        {busy && <BusyOverlay busy={busy} />}
      </section>

      <aside className="panel">
        <Group title={`图片 ${items.length}/${MAX_ITEMS}`}>
          <div className="thumbs">
            {items.map((it) => (
              <div key={it.id} className={`thumb${it.id === selected ? ' on' : ''}`} onClick={() => setSelected(it.id)} title={it.name}>
                <img src={it.thumb} alt="" />
                {(it.status === 'queued' || it.status === 'running') && (
                  <div className="thumb-state">
                    <Loader2 size={16} className={it.status === 'running' ? 'spin' : ''} />
                  </div>
                )}
                {it.status === 'error' && <div className="thumb-state err">失败</div>}
                <div className="thumb-actions">
                  <button
                    title="移除"
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(it.id)
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
            {items.length < MAX_ITEMS && (
              <label className="thumb add">
                <ImagePlus size={18} />
                添加
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])]
                    e.target.value = ''
                    if (files.length) addFiles(files)
                  }}
                />
              </label>
            )}
          </div>
        </Group>

        <Group title="识别方式">
          <div className="chips">
            {(
              [
                ['auto', '自动'],
                ['portrait', '人像'],
                ['object', '物品 / 动物'],
                ['hd', '高清（WebGPU）'],
              ] as [Mode, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                className={`chip${mode === v ? ' on' : ''}`}
                disabled={v === 'hd' && !hdOk}
                title={v === 'hd' && !hdOk ? '需要支持 WebGPU 和 shader-f16 的浏览器（如电脑版 Chrome / Edge）' : undefined}
                onClick={() => setMode(v)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="meta">
            {item?.used ? `这张用的是${MODEL_NAMES[item.used]}模型。` : ''}
            {desktop
              ? '人像模型发丝更细；物品模型适合商品、宠物；高清模型复杂边缘最准。'
              : '人像模型发丝更细；物品模型首次下载约 90MB；高清模型约 115MB，复杂边缘最准。'}
            {!hdOk && (desktop ? ' 这台电脑不支持高清模式（需要 WebGPU）。' : ' 当前浏览器不支持高清模式。')}
          </p>
          <button className="reset" disabled={!item || item.status === 'running'} onClick={redo}>
            <RefreshCw size={12} /> 用当前方式重新抠这张
          </button>
        </Group>

        <Group title="修边">
          <Row label={`画笔 ${brush}`}>
            <input type="range" min={6} max={160} value={brush} onChange={(e) => setBrush(+e.target.value)} />
          </Row>
          <div className="buttons">
            <button className="btn" disabled={!edit.current?.undo.length || edit.current.id !== selected} onClick={undo}>
              <Undo2 size={16} /> 撤销
            </button>
            <button className={`btn${showOriginal ? ' active' : ''}`} disabled={!item?.fg} onClick={() => setShowOriginal((v) => !v)}>
              {showOriginal ? <EyeOff size={16} /> : <Eye size={16} />}
              {showOriginal ? '看结果' : '看原图'}
            </button>
          </div>
        </Group>

        <Group title="背景">
          <Segment
            value={fx.bg}
            items={[
              ['transparent', '透明'],
              ['color', '纯色'],
              ['gradient', '渐变'],
              ['image', '图片'],
              ['blur', '虚化'],
            ]}
            onChange={(v) => setFxKey('bg', v)}
          />
          {fx.bg === 'color' && (
            <div className="sub">
              <Swatches colors={COLORS} value={fx.color} onChange={(v) => setFxKey('color', v)} />
            </div>
          )}
          {fx.bg === 'gradient' && (
            <div className="sub swatches wrap">
              {GRADIENTS.map((g) => (
                <button
                  key={g.join()}
                  className={`swatch${fx.gradient === g ? ' on' : ''}`}
                  style={{ background: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }}
                  onClick={() => setFxKey('gradient', g)}
                />
              ))}
            </div>
          )}
          {fx.bg === 'image' && (
            <div className="sub">
              <label className="btn">
                <ImagePlus size={16} /> {fx.image ? '换背景图' : '选择背景图'}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) pickBgImage(f)
                  }}
                />
              </label>
            </div>
          )}
          {fx.bg === 'blur' && (
            <Row label={`强度 ${fx.blur}`}>
              <input type="range" min={1} max={10} value={fx.blur} onChange={(e) => setFxKey('blur', +e.target.value)} />
            </Row>
          )}
        </Group>

        <Group title="贴纸描边">
          <Row label={fx.stroke ? `粗细 ${fx.stroke}` : '粗细 关'}>
            <input type="range" min={0} max={8} step={0.5} value={fx.stroke} onChange={(e) => setFxKey('stroke', +e.target.value)} />
          </Row>
          {fx.stroke > 0 && <Swatches colors={STROKE_COLORS} value={fx.strokeColor} onChange={(v) => setFxKey('strokeColor', v)} />}
        </Group>

        <Group title="阴影">
          <Segment
            value={fx.shadow}
            items={[
              ['none', '无'],
              ['drop', '投影'],
              ['ground', '地面阴影'],
            ]}
            onChange={(v) => setFxKey('shadow', v)}
          />
        </Group>

        <Group title="尺寸">
          <Segment
            value={crop}
            items={[
              ['none', '原图大小'],
              ['subject', '裁到主体'],
              ['square', '正方形'],
            ]}
            onChange={setCrop}
          />
          {crop !== 'none' && (
            <Row label={`留白 ${pad}%`}>
              <input type="range" min={0} max={40} value={pad} onChange={(e) => setPad(+e.target.value)} />
            </Row>
          )}
          <p className="meta">{region && item?.fg ? `输出 ${region.w} × ${region.h} px，PNG` : '白底 + 正方形 + 地面阴影，就是电商主图'}</p>
        </Group>

        <Group title="导出">
          <div className="buttons">
            <button className="btn primary" disabled={!item?.fg} onClick={saveOne}>
              <Download size={16} /> 下载这张
            </button>
            {doneCount > 1 && (
              <button className="btn" onClick={saveAll}>
                <Download size={16} /> 全部下载（{doneCount}）
              </button>
            )}
          </div>
          <button className="reset" onClick={() => setFx(DEFAULT_FX)}>
            恢复默认效果
          </button>
        </Group>
      </aside>
    </main>
  )
}
