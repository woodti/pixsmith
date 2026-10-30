import { useEffect, useRef, useState } from 'react'
import { Camera as CameraIcon, RefreshCw, X } from 'lucide-react'

/** Full-screen camera with a head guide; hands back a JPEG File of the (unmirrored) frame. */
export default function Camera({ onShot, onClose }: { onShot: (f: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [error, setError] = useState('')
  const [count, setCount] = useState(0)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    setError('')
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
      })
      .catch(() => setError('打不开摄像头：请允许浏览器使用摄像头，或改用上传照片'))
    if (!navigator.mediaDevices) setError('当前浏览器不支持摄像头，请改用上传照片')
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [facing])

  const capture = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    c.toBlob((b) => b && onShot(new File([b], '拍照.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.95)
  }

  const shoot = () => {
    // a short countdown leaves time to settle after tapping
    let n = 3
    setCount(n)
    const t = setInterval(() => {
      n--
      setCount(n)
      if (n === 0) {
        clearInterval(t)
        capture()
      }
    }, 700)
  }

  return (
    <div className="camera">
      <video ref={videoRef} autoPlay playsInline muted className={facing === 'user' ? 'mirror' : ''} />
      <div className="camera-guide">
        <div className="oval" />
        <p>头顶和下巴放进框内，正对镜头，光线均匀</p>
      </div>
      {count > 0 && <div className="countdown">{count}</div>}
      {error && <div className="camera-error">{error}</div>}
      <div className="camera-bar">
        <button className="round" title="关闭" onClick={onClose}>
          <X size={20} />
        </button>
        <button className="shutter" title="拍照" disabled={!!error || count > 0} onClick={shoot}>
          <CameraIcon size={26} />
        </button>
        <button className="round" title="切换前后摄像头" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>
          <RefreshCw size={20} />
        </button>
      </div>
    </div>
  )
}
