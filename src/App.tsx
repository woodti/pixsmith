import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Github } from 'lucide-react'
import { desktop, RELEASES } from './lib/desktop'
import Cutout from './cutout/Cutout'
import Erase from './erase/Erase'
import Home from './home/Home'
import IdPhoto from './idphoto/IdPhoto'
import Upscale from './upscale/Upscale'

type Tab = 'home' | 'cutout' | 'idphoto' | 'erase' | 'upscale'

const TABS: { id: Tab; name: string; title: string }[] = [
  { id: 'cutout', name: '抠图', title: '免费 AI 抠图，浏览器本地处理不上传' },
  { id: 'idphoto', name: '证件照', title: '免费证件照制作：换底色、换正装、相纸排版' },
  { id: 'erase', name: '消除', title: 'AI 消除路人和杂物，浏览器本地处理' },
  { id: 'upscale', name: '变清晰', title: 'AI 图片放大变清晰，浏览器本地处理' },
]

const fromHash = (): Tab => {
  const h = location.hash.slice(1)
  return TABS.some((t) => t.id === h) ? (h as Tab) : 'home'
}

export default function App() {
  const [tab, setTab] = useState<Tab>(fromHash)
  const [toast, setToast] = useState('')
  const timer = useRef(0)

  useEffect(() => {
    const onHash = () => setTab(fromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const t = TABS.find((x) => x.id === tab)
    document.title = t ? `${t.title} · 图匠` : '图匠 · 浏览器里的 AI 图片工具箱'
  }, [tab])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(''), 3500)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <a className="home-link" href="#">
            <span className="logo" />
            <strong>图匠</strong>
          </a>
          <nav className="tabs">
            {TABS.map((t) => (
              <a key={t.id} href={`#${t.id}`} className={tab === t.id ? 'on' : ''}>
                {t.name}
              </a>
            ))}
          </nav>
          <span className="tagline">{desktop ? 'AI 在本机运行，不联网不上传' : 'AI 在你的浏览器里运行，图片不上传'}</span>
        </div>
        <div className="actions">
          {!desktop && (
            <a className="btn" href={RELEASES} target="_blank" rel="noreferrer" title="Windows / macOS / Linux，内置模型，离线可用">
              <Download size={16} /> 客户端
            </a>
          )}
          <a className="btn" href="https://github.com/woodti/pixsmith" target="_blank" rel="noreferrer">
            <Github size={16} /> 开源
          </a>
        </div>
      </header>
      {tab === 'home' && <Home />}
      {tab === 'cutout' && <Cutout toast={showToast} />}
      {tab === 'idphoto' && <IdPhoto toast={showToast} />}
      {tab === 'erase' && <Erase toast={showToast} />}
      {tab === 'upscale' && <Upscale toast={showToast} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
