import { useCallback, useEffect, useRef, useState } from 'react'
import { Brush, Download, Eye, Hand, ImagePlus, Maximize, Minus, Plus, Undo2, Wand2, X } from 'lucide-react'
import { inpaint } from '../ai/client'
import { baseName, download, loadImage, makeCanvas, toBlob, toJpeg } from '../lib/image'
import { useFiles } from '../lib/useFiles'
import { prepareCanvas, useBrushCursor, useViewport } from '../lib/viewport'
import { BusyOverlay, DropZone, Group, Row, Segment, ensureModels, type Busy } from '../ui'

const MAX_PIXELS = 12_000_000
const MASK_COLOR = 'rgba(255, 64, 96, 1)'

interface Doc {
  name: string
  original: HTMLCanvasElement
  current: HTMLCanvasElement
  history: HTMLCanvasElement[]
}

export default function Erase({ toast }: { toast: (msg: string) => void }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [tool, setTool] = useState<'paint' | 'pan'>('paint')
  const [brush, setBrush] = useState(40)
  const [auto, setAuto] = useState(true)
  const [peek, setPeek] = useState(false)
  const [hasMask, setHasMask] = useState(false)
  const stageRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const maskRef = useRef<HTMLCanvasElement | null>(null)
  const last = useRef<[number, number] | null>(null)
  const vp = useViewport(stageRef, doc?.current.width ?? 0, doc?.current.height ?? 0)
  const cursor = useBrushCursor()

  const open = useCallback(
    async (files: File[]) => {
      try {
        const c = await loadImage(files[0], MAX_PIXELS)
        const original = makeCanvas(c.width, c.height)
        original.getContext('2d')!.drawImage(c, 0, 0)
        maskRef.current = makeCanvas(c.width, c.height)
        setHasMask(false)
        setDoc({ name: files[0].name, original, current: c, history: [] })
        ensureModels(['migan'], setBusy)
          .catch((e) => toast(`模型加载失败：${e instanceof Error ? e.message : e}`))
          .finally(() => setBusy(null))
      } catch {
        toast('图片无法读取')
      }
    },
    [toast],
  )
  const { dragging, dropProps } = useFiles(open)

  const draw = useCallback(() => {
    const c = canvasRef.current
    if (!c || !doc) return
    const ctx = prepareCanvas(c, vp.size, vp.view)
    ctx.drawImage(peek ? doc.original : doc.current, 0, 0)
    if (!peek && maskRef.current) {
      ctx.globalAlpha = 0.5
      ctx.drawImage(maskRef.current, 0, 0)
      ctx.globalAlpha = 1
    }
  }, [doc, vp.size, vp.view, peek])
  useEffect(draw, [draw])

  const run = useCallback(async () => {
    const mask = maskRef.current
    if (!doc || !mask) return
    const w = mask.width
    const h = mask.height
    // Grow the painted area a little: inpainting looks better with some margin around the object.
    const grown = makeCanvas(w, h)
    const g = grown.getContext('2d')!
    const r = Math.max(2, Math.round(Math.max(w, h) / 400))
    for (let a = 0; a < 8; a++) g.drawImage(mask, Math.cos((a * Math.PI) / 4) * r, Math.sin((a * Math.PI) / 4) * r)
    g.drawImage(mask, 0, 0)
    const data = g.getImageData(0, 0, w, h).data
    const hole = new Uint8Array(w * h)
    let any = false
    for (let i = 0; i < hole.length; i++) {
      if (data[i * 4 + 3] > 20) {
        hole[i] = 1
        any = true
      }
    }
    if (!any) return
    try {
      await ensureModels(['migan'], setBusy)
      setBusy({ label: '正在消除…' })
      const out = await inpaint(doc.current, hole)
      const next = makeCanvas(w, h)
      next.getContext('2d')!.putImageData(out, 0, 0)
      mask.getContext('2d')!.clearRect(0, 0, w, h)
      setHasMask(false)
      setDoc((d) => d && { ...d, current: next, history: [...d.history.slice(-9), d.current] })
    } catch (err) {
      console.error(err)
      toast(`消除失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(null)
    }
  }, [doc, toast])

  const paintTo = (p: [number, number]) => {
    const mask = maskRef.current
    if (!mask) return
    const ctx = mask.getContext('2d')!
    ctx.strokeStyle = MASK_COLOR
    ctx.fillStyle = MASK_COLOR
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = brush / vp.view.scale
    const from = last.current ?? p
    ctx.beginPath()
    ctx.moveTo(from[0], from[1])
    ctx.lineTo(p[0], p[1])
    ctx.stroke()
    last.current = p
    draw()
  }

  const stroke = {
    onStart: (p: [number, number]) => {
      if (busy) return
      last.current = null
      paintTo(p)
    },
    onMove: (p: [number, number]) => last.current && paintTo(p),
    onEnd: () => {
      if (!last.current) return
      last.current = null
      setHasMask(true)
      if (auto) run()
    },
  }

  const undo = () => {
    setDoc((d) => d && d.history.length ? { ...d, current: d.history[d.history.length - 1], history: d.history.slice(0, -1) } : d)
  }
  const clearMask = () => {
    const m = maskRef.current
    m?.getContext('2d')!.clearRect(0, 0, m.width, m.height)
    setHasMask(false)
    draw()
  }

  const save = async (type: 'png' | 'jpg') => {
    if (!doc) return
    const blob = type === 'png' ? await toBlob(doc.current) : await toJpeg(doc.current, 0.95)
    download(blob, `${baseName(doc.name)}-消除.${type}`)
  }

  return (
    <main className="workspace">
      <section
        ref={stageRef}
        className={`stage${dragging ? ' dragging' : ''}`}
        {...dropProps}
        {...cursor.track}
      >
        {doc ? (
          <>
            <canvas
              ref={canvasRef}
              className="fill"
              style={{ cursor: tool === 'pan' ? 'grab' : 'none' }}
              {...vp.bind(tool === 'pan', stroke)}
            />
            {tool === 'paint' && cursor.pos && (
              <div className="brush-cursor" style={{ left: cursor.pos.x, top: cursor.pos.y, width: brush, height: brush }} />
            )}
            <div className="stage-tools">
              <button className={tool === 'paint' ? 'on' : ''} title="画笔" onClick={() => setTool('paint')}>
                <Brush size={16} />
              </button>
              <button className={tool === 'pan' ? 'on' : ''} title="移动画面（也可按住空格拖动）" onClick={() => setTool('pan')}>
                <Hand size={16} />
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
            title="上传图片，涂抹想去掉的东西"
            sub="路人、杂物、水印、文字都可以 · AI 自动补全背景 · 图片只在本地处理，不上传"
            onFiles={open}
          />
        )}
        {doc && !busy && <div className="hint">{auto ? '涂抹要去掉的地方，松手后自动消除' : '涂抹要去掉的地方，然后点“消除”'}</div>}
        {busy && <BusyOverlay busy={busy} />}
      </section>

      <aside className="panel">
        <Group title="画笔">
          <Row label={`大小 ${brush}`}>
            <input type="range" min={8} max={160} value={brush} onChange={(e) => setBrush(+e.target.value)} />
          </Row>
          <Row label="松手后">
            <Segment
              value={auto ? 'auto' : 'manual'}
              items={[
                ['auto', '自动消除'],
                ['manual', '先涂完再点'],
              ]}
              onChange={(v) => setAuto(v === 'auto')}
            />
          </Row>
          <div className="buttons">
            <button className="btn primary" disabled={!doc || !hasMask || !!busy} onClick={run}>
              <Wand2 size={16} /> 消除
            </button>
            <button className="btn" disabled={!hasMask} onClick={clearMask}>
              <X size={16} /> 清除涂抹
            </button>
          </div>
          <p className="meta">大面积一次涂完效果更好；没擦干净可以再涂一遍。</p>
        </Group>

        <Group title="编辑">
          <div className="buttons">
            <button className="btn" disabled={!doc?.history.length} onClick={undo}>
              <Undo2 size={16} /> 撤销
            </button>
            <button
              className={`btn${peek ? ' active' : ''}`}
              disabled={!doc}
              onPointerDown={() => setPeek(true)}
              onPointerUp={() => setPeek(false)}
              onPointerLeave={() => setPeek(false)}
            >
              <Eye size={16} /> 按住看原图
            </button>
          </div>
        </Group>

        <Group title="导出">
          <div className="buttons">
            <button className="btn primary" disabled={!doc?.history.length} onClick={() => save('jpg')}>
              <Download size={16} /> 下载 JPG
            </button>
            <button className="btn" disabled={!doc?.history.length} onClick={() => save('png')}>
              <Download size={16} /> PNG
            </button>
            <label className="btn">
              <ImagePlus size={16} /> 换一张
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])]
                  e.target.value = ''
                  if (files.length) open(files)
                }}
              />
            </label>
          </div>
          {doc && <p className="meta">{doc.current.width} × {doc.current.height} px，原尺寸输出</p>}
        </Group>
      </aside>
    </main>
  )
}
