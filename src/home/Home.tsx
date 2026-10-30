import { useEffect, useState } from 'react'
import { Cpu, Eraser, IdCard, Lock, Scissors, Sparkles, Trash2, Zap } from 'lucide-react'
import { backendOf, device, onModelsChange } from '../ai/client'
import { MODELS, type DeviceInfo, type ModelId } from '../ai/models'

const CACHE = 'pixsmith-models-v1'

const TOOLS = [
  {
    id: 'cutout',
    icon: <Scissors size={22} />,
    name: '抠图',
    desc: '一键去背景，人像发丝级；换背景、白边贴纸、商品投影、批量导出',
    models: ['MODNet', 'IS-Net', 'BiRefNet'],
  },
  {
    id: 'idphoto',
    icon: <IdCard size={22} />,
    name: '证件照',
    desc: '自动定位头部、换底色、美颜、换正装、合规自检，6 寸相纸排版',
    models: ['YuNet', 'MODNet'],
  },
  {
    id: 'erase',
    icon: <Eraser size={22} />,
    name: 'AI 消除',
    desc: '涂抹路人、杂物、水印，自动补全背景',
    models: ['MI-GAN'],
  },
  {
    id: 'upscale',
    icon: <Sparkles size={22} />,
    name: '变清晰',
    desc: '放大 2 / 4 倍，去模糊、去噪点、去压缩痕迹',
    models: ['Real-ESRGAN'],
  },
]

async function cachedModels() {
  const base = new URL('models/', document.baseURI).href
  const out = new Set<ModelId>()
  try {
    const cache = await caches.open(CACHE)
    for (const [id, m] of Object.entries(MODELS) as [ModelId, (typeof MODELS)[ModelId]][]) {
      const hits = await Promise.all(m.files.map((f) => cache.match(base + f)))
      if (hits.every(Boolean)) out.add(id)
    }
  } catch {
    // Cache API unavailable (private mode / insecure context)
  }
  return out
}

export default function Home() {
  const [dev, setDev] = useState<DeviceInfo | null>(null)
  const [cached, setCached] = useState<Set<ModelId>>(new Set())
  const [, setTick] = useState(0)

  useEffect(() => {
    device().then(setDev)
    cachedModels().then(setCached)
    return onModelsChange(() => {
      setTick((t) => t + 1)
      cachedModels().then(setCached)
    })
  }, [])

  const clear = async () => {
    try {
      await caches.delete(CACHE)
    } catch {
      // ignore
    }
    setCached(new Set())
  }

  const total = Object.values(MODELS).reduce((n, m) => n + m.size, 0)
  const cachedSize = [...cached].reduce((n, id) => n + MODELS[id].size, 0)

  return (
    <main className="home">
      <section className="hero">
        <h1>浏览器里的 AI 图片工具箱</h1>
        <p>
          抠图、证件照、消除、变清晰——所有 AI 模型都下载到你的浏览器里运行。
          <br />
          照片不上传任何服务器，免费、开源、可离线。
        </p>
        <div className="badges">
          <span>
            <Lock size={14} /> 图片不出本机
          </span>
          <span>
            <Zap size={14} /> WebGPU / WebAssembly
          </span>
          <span>
            <Cpu size={14} /> {Object.keys(MODELS).length} 个开源模型
          </span>
        </div>
      </section>

      <section className="tools">
        {TOOLS.map((t) => (
          <a key={t.id} className="tool" href={`#${t.id}`}>
            <span className="tool-icon">{t.icon}</span>
            <strong>{t.name}</strong>
            <span className="tool-desc">{t.desc}</span>
            <span className="tool-models">{t.models.join(' · ')}</span>
          </a>
        ))}
      </section>

      <section className="lab">
        <div className="lab-head">
          <h2>你的设备</h2>
        </div>
        <div className="device">
          <div>
            <span className="k">WebGPU</span>
            <span className={dev?.webgpu ? 'ok' : 'warn'}>
              {dev ? (dev.webgpu ? `可用${dev.adapter ? `（${dev.adapter}）` : ''}` : '不可用，使用 CPU 计算') : '检测中…'}
            </span>
          </div>
          <div>
            <span className="k">半精度 shader-f16</span>
            <span className={dev?.f16 ? 'ok' : 'warn'}>{dev ? (dev.f16 ? '支持' : '不支持（高清抠图不可用）') : '…'}</span>
          </div>
          <div>
            <span className="k">CPU 线程</span>
            <span>{navigator.hardwareConcurrency || '?'}（推理使用 1 个，在后台线程运行，不卡页面）</span>
          </div>
        </div>

        <div className="lab-head">
          <h2>模型</h2>
          <button className="reset" onClick={clear} disabled={!cached.size}>
            <Trash2 size={12} /> 清除已缓存模型（{(cachedSize / 1e6).toFixed(0)} / {(total / 1e6).toFixed(0)} MB）
          </button>
        </div>
        <div className="models">
          {(Object.entries(MODELS) as [ModelId, (typeof MODELS)[ModelId]][]).map(([id, m]) => {
            const backend = backendOf(id)
            return (
              <div key={id} className="model">
                <div className="model-main">
                  <a href={m.source} target="_blank" rel="noreferrer">
                    {m.label}
                  </a>
                  <span>{m.task}</span>
                </div>
                <div className="model-meta">
                  <span>{(m.size / 1e6).toFixed(m.size < 1e6 ? 1 : 0)} MB</span>
                  <span>{m.license}</span>
                  <span className={backend ? 'ok' : cached.has(id) ? '' : 'dim'}>
                    {backend ? `运行于 ${backend === 'webgpu' ? 'GPU' : 'CPU'}` : cached.has(id) ? '已缓存' : '用到时下载'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
        <p className="meta">
          模型来自各自的开源项目，按原许可使用；用 ONNX Runtime Web 在浏览器中推理。模型首次使用时下载，之后从浏览器缓存读取，可离线使用。
        </p>
      </section>
    </main>
  )
}
