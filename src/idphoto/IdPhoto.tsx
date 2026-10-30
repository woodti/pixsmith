import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Camera as CameraIcon, CheckCircle2, Download, ImagePlus, Printer, RotateCcw } from 'lucide-react'
import { detectFaces, foreground, matte } from '../ai/client'
import type { Face } from '../ai/models'
import { download, jpegUnder, loadImage, makeCanvas, toJpeg } from '../lib/image'
import { useFiles } from '../lib/useFiles'
import { BusyOverlay, DropZone, Group, Row, Segment, Swatches, ensureModels, type Busy } from '../ui'
import { NO_BEAUTY, applyBeauty, faceStats, type Beauty, type FaceStats } from './beauty'
import Camera from './Camera'
import { runChecks } from './checks'
import { NO_ADJUST, NO_OUTFIT, bodyCutOff, findAnchor, renderPhoto, renderSheet, type Adjust, type Anchor, type Outfit } from './compose'
import { BG_COLORS, PAPERS, SPECS, type Spec } from './specs'
import { SUITS } from './suits'

interface Subject {
  name: string
  fg: HTMLCanvasElement
  face: Face
  anchor: Anchor
  stats: FaceStats
  /** the person reaches the bottom edge of the source photo */
  cutAtBottom: boolean
}

const PREVIEW_H = 560

const BEAUTY_SLIDERS: { key: keyof Beauty; name: string; min: number; max: number }[] = [
  { key: 'smooth', name: '磨皮', min: 0, max: 100 },
  { key: 'whiten', name: '美白', min: 0, max: 100 },
  { key: 'bright', name: '亮度', min: -50, max: 50 },
  { key: 'contrast', name: '对比度', min: -50, max: 50 },
  { key: 'saturation', name: '饱和度', min: -50, max: 50 },
]

export default function IdPhoto({ toast }: { toast: (msg: string) => void }) {
  const [busy, setBusy] = useState<Busy | null>(null)
  const [subject, setSubject] = useState<Subject | null>(null)
  const [specId, setSpecId] = useState('1in')
  const [custom, setCustom] = useState({ w: 295, h: 413 })
  const [bg, setBg] = useState('#ffffff')
  const [adj, setAdj] = useState<Adjust>(NO_ADJUST)
  const [beauty, setBeauty] = useState<Beauty>(NO_BEAUTY)
  const [retouched, setRetouched] = useState<HTMLCanvasElement | null>(null)
  const [outfit, setOutfit] = useState<Outfit>(NO_OUTFIT)
  const [paperId, setPaperId] = useState(PAPERS[0].id)
  const [mixId, setMixId] = useState('')
  const [limitKB, setLimitKB] = useState('')
  const [guides, setGuides] = useState(true)
  const [camera, setCamera] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)

  const spec: Spec = useMemo(() => {
    if (specId !== 'custom') return SPECS.find((s) => s.id === specId)!
    const w = Math.max(50, Math.min(3000, custom.w || 0))
    const h = Math.max(50, Math.min(3000, custom.h || 0))
    return { id: 'custom', name: '自定义', w, h, mm: [(w / 300) * 25.4, (h / 300) * 25.4], dpi: 300, head: 0.6, top: 0.1, bg: '#ffffff' }
  }, [specId, custom])

  const pickSpec = (id: string) => {
    setSpecId(id)
    const s = SPECS.find((x) => x.id === id)
    if (s) {
      setBg(s.bg)
      setLimitKB(s.maxKB ? String(s.maxKB) : '')
    }
  }

  const process = useCallback(
    async (files: File[]) => {
      const file = files[0]
      try {
        setBusy({ label: '读取图片…' })
        const src = await loadImage(file, 12_000_000)
        await ensureModels(['yunet', 'modnet'], setBusy)
        setBusy({ label: '识别人脸…' })
        const faces = await detectFaces(src)
        if (!faces.length) {
          toast('没有检测到人脸，请换一张清晰的正脸照片')
          return
        }
        const face = faces.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a))
        if (faces.length > 1) toast('检测到多张人脸，已使用最大的一张')

        // Matte only the head-and-shoulders region so hair gets the model's full resolution.
        const cx = face.x + face.w / 2
        const x0 = Math.max(0, Math.floor(cx - face.w * 2.4))
        const x1 = Math.min(src.width, Math.ceil(cx + face.w * 2.4))
        const y0 = Math.max(0, Math.floor(face.y - face.h * 1.6))
        const y1 = Math.min(src.height, Math.ceil(face.y + face.h * 3.6))
        const k = Math.min(1, Math.sqrt(3_000_000 / ((x1 - x0) * (y1 - y0))))
        const crop = makeCanvas(Math.round((x1 - x0) * k), Math.round((y1 - y0) * k))
        const cctx = crop.getContext('2d')!
        cctx.imageSmoothingQuality = 'high'
        cctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, crop.width, crop.height)
        const local: Face = {
          ...face,
          x: (face.x - x0) * k,
          y: (face.y - y0) * k,
          w: face.w * k,
          h: face.h * k,
          kps: face.kps.map(([x, y]) => [(x - x0) * k, (y - y0) * k] as [number, number]),
        }

        setBusy({ label: '抠出人像…' })
        const alpha = await matte(crop, 'modnet')
        setBusy({ label: '处理发丝边缘…' })
        const fgData = await foreground(crop, alpha)
        const fg = makeCanvas(crop.width, crop.height)
        fg.getContext('2d')!.putImageData(fgData, 0, 0)
        let edge = 0
        const last = (crop.height - 1) * crop.width
        for (let x = 0; x < crop.width; x++) if (alpha[last + x] > 128) edge++
        setSubject({
          name: file.name,
          fg,
          face: local,
          anchor: findAnchor(local, alpha, crop.width, crop.height),
          stats: faceStats(fg, local),
          cutAtBottom: y1 === src.height && edge > crop.width * 0.1,
        })
        setAdj(NO_ADJUST)
      } catch (err) {
        console.error(err)
        toast(`处理失败：${err instanceof Error ? err.message : err}`)
      } finally {
        setBusy(null)
      }
    },
    [toast],
  )

  const { dragging, dropProps } = useFiles(process)

  // Retouching touches every pixel, so debounce it behind the sliders.
  useEffect(() => {
    if (!subject) return setRetouched(null)
    const t = setTimeout(() => setRetouched(applyBeauty(subject.fg, beauty, subject.face.w)), 120)
    return () => clearTimeout(t)
  }, [subject, beauty])
  const fg = retouched ?? subject?.fg ?? null

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !subject || !fg) return
    const scale = Math.max(1, (PREVIEW_H * (window.devicePixelRatio || 1)) / spec.h)
    const r = renderPhoto(fg, subject.anchor, spec, bg, adj, outfit, scale)
    c.width = r.width
    c.height = r.height
    c.getContext('2d')!.drawImage(r, 0, 0)
  }, [subject, fg, spec, bg, adj, outfit])

  const cutOff = !!subject && fg !== null && bodyCutOff(fg, subject.cutAtBottom && outfit.id === 'none', subject.anchor, spec, adj)
  const checks = useMemo(
    () => (subject ? runChecks(subject.face, subject.anchor, spec, adj, subject.stats, cutOff) : []),
    [subject, spec, adj, cutOff],
  )

  const paper = PAPERS.find((p) => p.id === paperId)!
  const mixSpec = SPECS.find((s) => s.id === mixId && s.mm)
  // The 300 dpi sheet is heavy; rebuild it only once dragging / sliding settles.
  const [sheet, setSheet] = useState<ReturnType<typeof renderSheet> | null>(null)
  useEffect(() => {
    if (!subject || !fg || !spec.mm) return setSheet(null)
    const t = setTimeout(() => {
      const at300 = (s: Spec) => renderPhoto(fg, subject.anchor, s, bg, adj, outfit, 300 / s.dpi)
      setSheet(
        renderSheet({ photo: at300(spec), mm: spec.mm! }, paper, mixSpec ? { photo: at300(mixSpec), mm: mixSpec.mm! } : undefined),
      )
    }, 300)
    return () => clearTimeout(t)
  }, [subject, fg, spec, bg, adj, outfit, paper, mixSpec])
  const sheetUrl = useMemo(() => sheet?.canvas.toDataURL('image/jpeg', 0.7), [sheet])

  const fileName = (suffix: string) => `证件照-${spec.name}${suffix}.jpg`.replace(/[ /]/g, '')

  const savePhoto = async () => {
    if (!subject || !fg) return
    const photo = renderPhoto(fg, subject.anchor, spec, bg, adj, outfit)
    const kb = Number(limitKB)
    if (kb > 0) {
      const blob = await jpegUnder(photo, kb, spec.dpi)
      if (!blob) return toast(`压不到 ${kb}KB 以内，请放宽大小限制`)
      download(blob, fileName(''))
      toast(`已导出 ${spec.w}×${spec.h}px，${Math.ceil(blob.size / 1024)}KB`)
    } else {
      download(await toJpeg(photo, 0.95, spec.dpi), fileName(''))
    }
  }

  const saveSheet = async () => {
    if (!sheet) return
    download(await toJpeg(sheet.canvas, 0.95, 300), fileName(`-${paper.name}${mixSpec ? `+${mixSpec.name}` : ''}排版`))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = (e.clientX - drag.current.x) / rect.width
    const dy = (e.clientY - drag.current.y) / rect.height
    drag.current = { x: e.clientX, y: e.clientY }
    setAdj((a) => ({ ...a, dx: a.dx + dx, dy: a.dy + dy }))
  }
  const onWheel = (e: React.WheelEvent) => {
    setAdj((a) => ({ ...a, zoom: Math.min(1.6, Math.max(0.6, a.zoom * Math.exp(-e.deltaY * 0.001))) }))
  }

  const fileInput = (label: string) => (
    <label className="btn">
      <ImagePlus size={16} /> {label}
      <input
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) process(files)
        }}
      />
    </label>
  )

  return (
    <main className="workspace">
      <section className={`stage${dragging ? ' dragging' : ''}`} {...dropProps}>
        {subject ? (
          <div
            className="photo"
            style={{ aspectRatio: `${spec.w} / ${spec.h}` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onWheel={onWheel}
          >
            <canvas ref={canvasRef} />
            {guides && (
              <>
                <div className="guide" style={{ top: `${spec.top * 100}%` }}>
                  <span>头顶</span>
                </div>
                <div className="guide" style={{ top: `${(spec.top + spec.head) * 100}%` }}>
                  <span>下巴</span>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="start">
            <DropZone title="上传一张正脸照片" sub="点击选择、拖进来或直接粘贴 · 照片只在本地处理，不上传" onFiles={process} />
            <button className="btn primary" onClick={() => setCamera(true)}>
              <CameraIcon size={16} /> 用摄像头拍一张
            </button>
          </div>
        )}
        {subject && !busy && (
          <div className="hint">
            {cutOff ? '原照片拍到肩膀就截断了，下方会留空：可以放大一点、换正装，或换一张拍到胸口的照片' : '拖动照片调整位置，滚轮缩放'}
          </div>
        )}
        {busy && <BusyOverlay busy={busy} />}
      </section>

      <aside className="panel">
        <Group title="规格">
          <div className="chips">
            {SPECS.map((s) => (
              <button key={s.id} className={`chip${specId === s.id ? ' on' : ''}`} onClick={() => pickSpec(s.id)}>
                {s.name}
              </button>
            ))}
            <button className={`chip${specId === 'custom' ? ' on' : ''}`} onClick={() => setSpecId('custom')}>
              自定义
            </button>
          </div>
          {specId === 'custom' && (
            <Row label="尺寸 px">
              <div className="custom">
                <input className="text num" type="number" value={custom.w} onChange={(e) => setCustom((c) => ({ ...c, w: +e.target.value }))} />
                ×
                <input className="text num" type="number" value={custom.h} onChange={(e) => setCustom((c) => ({ ...c, h: +e.target.value }))} />
              </div>
            </Row>
          )}
          <p className="meta">
            {spec.mm ? `${spec.mm.map((v) => Math.round(v)).join('×')} mm · ` : ''}
            {spec.w}×{spec.h} px
            {spec.maxKB ? ` · 常见要求 ≤${spec.maxKB}KB` : ''}
          </p>
          {spec.note && <p className="meta">{spec.note}</p>}
          <p className="meta">常见规格仅供参考，正式报名、办证请以官方要求为准。</p>
        </Group>

        {subject && (
          <Group title="合规自检">
            <ul className="checks">
              {checks.map((c) => (
                <li key={c.text} className={c.ok ? 'ok' : 'bad'}>
                  {c.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  {c.text}
                </li>
              ))}
            </ul>
          </Group>
        )}

        <Group title="背景色">
          <Swatches colors={BG_COLORS} value={bg} onChange={setBg} />
        </Group>

        <Group title="美颜">
          {BEAUTY_SLIDERS.map((s) => (
            <Row key={s.key} label={`${s.name} ${beauty[s.key]}`}>
              <input
                type="range"
                min={s.min}
                max={s.max}
                value={beauty[s.key]}
                onChange={(e) => setBeauty((b) => ({ ...b, [s.key]: +e.target.value }))}
              />
            </Row>
          ))}
          <button className="reset" onClick={() => setBeauty(NO_BEAUTY)}>
            <RotateCcw size={12} /> 还原
          </button>
        </Group>

        <Group title="换正装">
          <div className="chips">
            {SUITS.map((s) => (
              <button key={s.id} className={`chip${outfit.id === s.id ? ' on' : ''}`} onClick={() => setOutfit((o) => ({ ...o, id: s.id }))}>
                {s.name}
              </button>
            ))}
          </div>
          {outfit.id !== 'none' && (
            <>
              <Row label={`大小 ${Math.round(outfit.scale * 100)}%`}>
                <input
                  type="range"
                  min={70}
                  max={140}
                  value={Math.round(outfit.scale * 100)}
                  onChange={(e) => setOutfit((o) => ({ ...o, scale: +e.target.value / 100 }))}
                />
              </Row>
              <Row label="上下">
                <input
                  type="range"
                  min={-40}
                  max={40}
                  value={Math.round(outfit.dy * 100)}
                  onChange={(e) => setOutfit((o) => ({ ...o, dy: +e.target.value / 100 }))}
                />
              </Row>
            </>
          )}
          <p className="meta">正装是按脸的大小自动画上去的，领口不贴合时用“大小”“上下”微调。</p>
        </Group>

        <Group title="微调">
          <Row label={`缩放 ${Math.round(adj.zoom * 100)}%`}>
            <input type="range" min={60} max={160} value={Math.round(adj.zoom * 100)} onChange={(e) => setAdj((a) => ({ ...a, zoom: +e.target.value / 100 }))} />
          </Row>
          <Row label={`旋转 ${adj.rotate}°`}>
            <input type="range" min={-10} max={10} step={0.5} value={adj.rotate} onChange={(e) => setAdj((a) => ({ ...a, rotate: +e.target.value }))} />
          </Row>
          <Row label="参考线">
            <Segment
              value={guides ? 'y' : 'n'}
              items={[
                ['y', '显示'],
                ['n', '隐藏'],
              ]}
              onChange={(v) => setGuides(v === 'y')}
            />
          </Row>
          <button className="reset" onClick={() => setAdj(NO_ADJUST)}>
            <RotateCcw size={12} /> 恢复自动位置
          </button>
        </Group>

        <Group title="导出">
          <Row label="大小限制">
            <div className="custom">
              <input className="text num" type="number" min={5} placeholder="不限" value={limitKB} onChange={(e) => setLimitKB(e.target.value)} />
              KB
            </div>
          </Row>
          <div className="buttons">
            <button className="btn primary" disabled={!subject} onClick={savePhoto}>
              <Download size={16} /> 下载照片
            </button>
            {fileInput('换一张')}
            <button className="btn" onClick={() => setCamera(true)}>
              <CameraIcon size={16} /> 拍照
            </button>
          </div>
        </Group>

        {spec.mm && (
          <Group title="冲印排版">
            <Segment value={paperId} items={PAPERS.map((p) => [p.id, p.name] as [string, string])} onChange={setPaperId} />
            <Row label="混排">
              <select className="text" value={mixId} onChange={(e) => setMixId(e.target.value)}>
                <option value="">不混排</option>
                {SPECS.filter((s) => s.mm && s.id !== spec.id).map((s) => (
                  <option key={s.id} value={s.id}>
                    + {s.name}
                  </option>
                ))}
              </select>
            </Row>
            {sheetUrl && sheet && (
              <>
                <img className="sheet" src={sheetUrl} alt="排版预览" />
                <p className="meta">
                  一张{paper.name}放 {sheet.countA} 张{spec.name}
                  {mixSpec ? ` + ${sheet.countB} 张${mixSpec.name}` : ''}，300dpi，冲印时选“不裁剪 / 原尺寸”
                </p>
              </>
            )}
            <div className="buttons">
              <button className="btn" disabled={!sheet} onClick={saveSheet}>
                <Printer size={16} /> 下载排版
              </button>
            </div>
          </Group>
        )}
      </aside>
      {camera && (
        <Camera
          onClose={() => setCamera(false)}
          onShot={(f) => {
            setCamera(false)
            process([f])
          }}
        />
      )}
    </main>
  )
}
