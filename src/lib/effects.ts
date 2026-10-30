import { makeCanvas } from './image'

export type BgKind = 'transparent' | 'color' | 'gradient' | 'image' | 'blur'
export type Shadow = 'none' | 'drop' | 'ground'

export interface Effects {
  bg: BgKind
  color: string
  gradient: [string, string]
  /** user-supplied background, drawn cover-fit */
  image: HTMLCanvasElement | null
  /** blur radius for the "blurred original" background, % of the output's long edge */
  blur: number
  /** sticker outline width, % of the subject's long edge (0 = off) */
  stroke: number
  strokeColor: string
  shadow: Shadow
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** fg drawn as a flat silhouette in one colour. */
function silhouette(fg: CanvasImageSource, w: number, h: number, color: string) {
  const c = makeCanvas(w, h)
  const ctx = c.getContext('2d')!
  ctx.drawImage(fg, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  return c
}

/** Morphological dilation approximated by stamping the silhouette around circles. */
function outline(fg: HTMLCanvasElement, radius: number, color: string) {
  const pad = Math.ceil(radius) + 2
  const sil = silhouette(fg, fg.width, fg.height, color)
  const c = makeCanvas(fg.width + 2 * pad, fg.height + 2 * pad)
  const ctx = c.getContext('2d')!
  for (const r of [radius, radius * 0.5]) {
    const n = Math.max(12, Math.min(48, Math.round(r * 2)))
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      ctx.drawImage(sil, pad + Math.cos(a) * r, pad + Math.sin(a) * r)
    }
  }
  ctx.drawImage(sil, pad, pad)
  // Harden the soft alpha so the outline edge is crisp like a die-cut sticker.
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] < 60 ? 0 : d[i] > 140 ? 255 : (d[i] - 60) * 3.2
  ctx.putImageData(img, 0, 0)
  return { canvas: c, pad }
}

/**
 * Large-radius blur of the background only, without ctx.filter (not everywhere yet):
 * cut the subject out, downscale in halves, then upscale in doubles for a smooth result.
 * Downscaling averages premultiplied colour, so the hole left by the subject is filled from
 * its surroundings; redrawing a few times restores full opacity.
 */
function blurredBackground(src: HTMLCanvasElement, fg: HTMLCanvasElement, radius: number) {
  const bg = makeCanvas(src.width, src.height)
  const b = bg.getContext('2d')!
  b.drawImage(src, 0, 0)
  b.globalCompositeOperation = 'destination-out'
  b.drawImage(fg, 0, 0)

  const k = Math.max(1 / 128, Math.min(1, 2 / Math.max(1, radius)))
  const levels: HTMLCanvasElement[] = [bg]
  for (let scale = 0.5; scale >= k; scale *= 0.5) {
    const prev = levels[levels.length - 1]
    const next = makeCanvas(Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale)))
    const ctx = next.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(prev, 0, 0, next.width, next.height)
    levels.push(next)
  }
  let cur = levels[levels.length - 1]
  for (let i = levels.length - 2; i >= 0; i--) {
    const up = makeCanvas(levels[i].width, levels[i].height)
    const ctx = up.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    for (let n = 0; n < (i === levels.length - 2 ? 6 : 1); n++) ctx.drawImage(cur, 0, 0, up.width, up.height)
    cur = up
  }
  return cur
}

export function strokePx(fx: Effects, subject: Rect) {
  return fx.stroke > 0 ? (Math.max(subject.w, subject.h) * fx.stroke) / 100 : 0
}

/**
 * Final composite in output space: `region` is the output rectangle in source-image coordinates
 * (it may extend past the image), `subject` the tight box around the cut-out.
 */
export function compose(fg: HTMLCanvasElement, src: HTMLCanvasElement, region: Rect, subject: Rect, fx: Effects) {
  const c = makeCanvas(region.w, region.h)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'

  if (fx.bg === 'color') {
    ctx.fillStyle = fx.color
    ctx.fillRect(0, 0, region.w, region.h)
  } else if (fx.bg === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, region.w, region.h)
    g.addColorStop(0, fx.gradient[0])
    g.addColorStop(1, fx.gradient[1])
    ctx.fillStyle = g
    ctx.fillRect(0, 0, region.w, region.h)
  } else if (fx.bg === 'image' && fx.image) {
    const k = Math.max(region.w / fx.image.width, region.h / fx.image.height)
    const w = fx.image.width * k
    const h = fx.image.height * k
    ctx.drawImage(fx.image, (region.w - w) / 2, (region.h - h) / 2, w, h)
  } else if (fx.bg === 'blur') {
    ctx.drawImage(blurredBackground(src, fg, (Math.max(region.w, region.h) * fx.blur) / 100), -region.x, -region.y)
  }

  const ox = -region.x
  const oy = -region.y
  const size = Math.max(subject.w, subject.h)

  if (fx.shadow === 'ground') {
    const cx = ox + subject.x + subject.w / 2
    const cy = oy + subject.y + subject.h
    const rx = subject.w * 0.48
    const ry = Math.max(4, subject.w * 0.07)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1, ry / rx)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
    g.addColorStop(0, 'rgba(0,0,0,0.38)')
    g.addColorStop(0.6, 'rgba(0,0,0,0.16)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, rx, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  const drop = () => {
    if (fx.shadow !== 'drop') return
    ctx.shadowColor = 'rgba(0,0,0,0.32)'
    ctx.shadowBlur = size * 0.04
    ctx.shadowOffsetY = size * 0.02
  }
  const r = strokePx(fx, subject)
  if (r > 0) {
    const o = outline(fg, r, fx.strokeColor)
    ctx.save()
    drop()
    ctx.drawImage(o.canvas, ox - o.pad, oy - o.pad)
    ctx.restore()
    ctx.drawImage(fg, ox, oy)
  } else {
    ctx.save()
    drop()
    ctx.drawImage(fg, ox, oy)
    ctx.restore()
  }
  return c
}
