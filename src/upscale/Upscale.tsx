import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, ImagePlus, Maximize, Minus, Plus, Sparkles } from 'lucide-react'
import { backendOf, upscale } from '../ai/client'
import { baseName, download, loadImage, makeCanvas, toBlob, toJpeg } from '../lib/image'
import { useFiles } from '../lib/useFiles'
import { prepareCanvas, useViewport } from '../lib/viewport'
import { BusyOverlay, DropZone, Group, Row, Segment, ensureModels, type Busy } from '../ui'

/** Output is capped so the canvas stays within mobile browser limits. */
const MAX_OUT = 16_000_000
/** On CPU every input pixel costs ~0.1 ms, so keep inputs small. */
const MAX_IN_CPU = 400_000

interface Doc {
  name: string
  src: HTMLCanvasElement
  result: HTMLCanvasElement | null
  scale: 2 | 4
}

export default function Upscale({ toast }: { toast: (msg: string) => void }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [scale, setScale] = useState<2 | 4>(4)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [split, setSplit] = useState(0.5)
  const stageRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragSplit = useRef(false)
  const shown = doc ? (doc.result ?? doc.src) : null
  const W = doc ? doc.src.width * (doc.result ? doc.scale : 1) : 0
  const H = doc ? doc.src.height * (doc.result ? doc.scale : 1) : 0
  const vp = useViewport(stageRef, W, H)

  const open = useCallback(
    async (files: File[]) => {
      try {
        const src = await loadImage(files[0], MAX_OUT)
        setDoc({ name: files[0].name, src, result: null, scale })
        setSplit(0.5)
      } catch {
        toast('图片无法读取')
      }
    },
    [toast, scale],
  )
  const { dragging, dropProps } = useFiles(open)

  const run = async () => {
    if (!doc) return
    try {
      const backend = await ensureModels(['esrgan'], setBusy).then(() => backendOf('esrgan'))
      const limit = Math.min(MAX_OUT / (scale * scale), backend === 'webgpu' ? Infinity : MAX_IN_CPU)
      let input = doc.src
      const px = input.width * input.height
      if (px > limit) {
        const k = Math.sqrt(limit / px)
        input = makeCanvas(Math.round(input.width * k), Math.round(input.height * k))
        const ctx = input.getContext('2d')!
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(doc.src, 0, 0, input.width, input.height)
        toast(
          backend === 'webgpu'
            ? `图片较大，先缩到 ${input.width}×${input.height} 再放大`
            : `当前设备没有 WebGPU，用 CPU 计算较慢，先缩到 ${input.width}×${input.height} 再放大`,
        )
      }
      setBusy({ label: '正在放大…', progress: 0 })
      const t0 = performance.now()
      const out = await upscale(input, scale, (done, total) => {
        const elapsed = (performance.now() - t0) / 1000
        const left = done ? Math.round((elapsed / done) * (total - done)) : 0
        setBusy({ label: `正在放大… ${done}/${total}${done ? `，约剩 ${left} 秒` : ''}`, progress: done / total })
      })
      const result = makeCanvas(out.width, out.height)
      result.getContext('2d')!.putImageData(out, 0, 0)
      setDoc((d) => d && { ...d, src: input, result, scale })
    } catch (err) {
      console.error(err)
      toast(`处理失败：${err instanceof Error ? err.message : err}`)
    } finally {
      setBusy(null)
    }
  }

  const draw = useCallback(() => {
    const c = canvasRef.current
    if (!c || !doc || !shown) return
    const ctx = prepareCanvas(c, vp.size, vp.view)
    ctx.imageSmoothingEnabled = true
    if (!doc.result) {
      ctx.drawImage(doc.src, 0, 0)
      return
    }
    ctx.drawImage(doc.result, 0, 0)
    // left of the divider: the original, simply stretched, for comparison
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, W * split, H)
    ctx.clip()
    ctx.drawImage(doc.src, 0, 0, W, H)
    ctx.restore()
  }, [doc, shown, vp.size, vp.view, split, W, H])
  useEffect(draw, [draw])

  const save = async (type: 'png' | 'jpg') => {
    if (!doc?.result) return
    const blob = type === 'png' ? await toBlob(doc.result) : await toJpeg(doc.result, 0.95)
    download(blob, `${baseName(doc.name)}-${doc.scale}x.${type}`)
  }

  const handleX = vp.view.ox + W * split * vp.view.scale

  return (
    <main className="workspace">
      <section ref={stageRef} className={`stage${dragging ? ' dragging' : ''}`} {...dropProps}>
        {doc ? (
          <>
            <canvas ref={canvasRef} className="fill" style={{ cursor: 'grab' }} {...vp.bind(true)} />
            {doc.result && (
              <div
                className="split"
                style={{ left: handleX }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  dragSplit.current = true
                }}
                onPointerMove={(e) => {
                  if (!dragSplit.current) return
                  const r = stageRef.current!.getBoundingClientRect()
                  setSplit(Math.min(1, Math.max(0, (e.clientX - r.left - vp.view.ox) / (W * vp.view.scale))))
                }}
                onPointerUp={() => (dragSplit.current = false)}
              >
                <span className="split-label l">原图</span>
                <span className="split-knob" />
                <span className="split-label r">AI 放大</span>
              </div>
            )}
            <div className="stage-tools">
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
          <DropZone title="上传一张模糊或太小的图片" sub="放大 2 倍或 4 倍，同时去掉模糊、噪点和压缩痕迹 · 图片只在本地处理，不上传" onFiles={open} />
        )}
        {doc?.result && !busy && <div className="hint">拖动中间的分隔线对比，滚轮放大看细节</div>}
        {busy && <BusyOverlay busy={busy} />}
      </section>

      <aside className="panel">
        <Group title="放大倍数">
          <Segment
            value={String(scale) as '2' | '4'}
            items={[
              ['2', '2 倍'],
              ['4', '4 倍'],
            ]}
            onChange={(v) => setScale(Number(v) as 2 | 4)}
          />
          {doc && (
            <p className="meta">
              {doc.src.width}×{doc.src.height} → {doc.src.width * scale}×{doc.src.height * scale} px
            </p>
          )}
          <div className="buttons">
            <button className="btn primary" disabled={!doc || !!busy} onClick={run}>
              <Sparkles size={16} /> {doc?.result ? '重新放大' : '开始放大'}
            </button>
          </div>
          <p className="meta">
            有 WebGPU 的电脑几秒出结果；没有时用 CPU 计算，会自动把大图先缩小，避免等太久。
            适合截图、老照片、小头像；人脸会被“修”得比较光滑。
          </p>
        </Group>

        <Group title="导出">
          <div className="buttons">
            <button className="btn primary" disabled={!doc?.result} onClick={() => save('png')}>
              <Download size={16} /> 下载 PNG
            </button>
            <button className="btn" disabled={!doc?.result} onClick={() => save('jpg')}>
              <Download size={16} /> JPG
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
        </Group>
        <Group title="说明">
          <Row label="模型">
            <span className="meta inline">Real-ESRGAN general v3（5MB）</span>
          </Row>
        </Group>
      </aside>
    </main>
  )
}
