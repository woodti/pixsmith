import { makeCanvas } from '../lib/image'

export interface Beauty {
  /** −50…50 */
  bright: number
  contrast: number
  saturation: number
  /** 0…100 */
  smooth: number
  whiten: number
}

export const NO_BEAUTY: Beauty = { bright: 0, contrast: 0, saturation: 0, smooth: 0, whiten: 0 }

export const isNeutral = (b: Beauty) => Object.values(b).every((v) => v === 0)

/** Soft skin likelihood from YCbCr, 0–1. */
function skin(r: number, g: number, b: number) {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  const dcb = Math.max(0, Math.abs(cb - 102) - 18) / 10
  const dcr = Math.max(0, Math.abs(cr - 153) - 18) / 10
  return Math.max(0, 1 - Math.hypot(dcb, dcr))
}

function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    let sum = 0
    const row = y * w
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / (2 * r + 1)
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1)
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

/** Returns a retouched copy of the cut-out; faceW (px) scales the smoothing radius. */
export function applyBeauty(fg: HTMLCanvasElement, b: Beauty, faceW: number) {
  const w = fg.width
  const h = fg.height
  const out = makeCanvas(w, h)
  const ctx = out.getContext('2d')!
  ctx.drawImage(fg, 0, 0)
  if (isNeutral(b)) return out
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const n = w * h

  if (b.smooth > 0) {
    const r = Math.max(1, Math.round(faceW / 50))
    const ch = [0, 1, 2].map((c) => {
      const a = new Float32Array(n)
      for (let i = 0; i < n; i++) a[i] = d[i * 4 + c]
      return boxBlur(boxBlur(a, w, h, r), w, h, r)
    })
    const k = b.smooth / 100
    for (let i = 0; i < n; i++) {
      if (d[i * 4 + 3] < 8) continue
      const R = d[i * 4]
      const G = d[i * 4 + 1]
      const B = d[i * 4 + 2]
      const diff = Math.abs(0.299 * (R - ch[0][i]) + 0.587 * (G - ch[1][i]) + 0.114 * (B - ch[2][i]))
      // edge-preserving: strong detail (eyes, brows, lips) keeps its sharpness
      const wgt = k * skin(R, G, B) * Math.exp(-(diff * diff) / 200)
      d[i * 4] = R + (ch[0][i] - R) * wgt
      d[i * 4 + 1] = G + (ch[1][i] - G) * wgt
      d[i * 4 + 2] = B + (ch[2][i] - B) * wgt
    }
  }

  const bright = b.bright * 1.4
  const cf = (259 * (b.contrast * 1.5 + 255)) / (255 * (259 - b.contrast * 1.5))
  const sat = 1 + b.saturation / 50
  const white = b.whiten / 100
  for (let i = 0; i < n; i++) {
    if (d[i * 4 + 3] === 0) continue
    let R = d[i * 4]
    let G = d[i * 4 + 1]
    let B = d[i * 4 + 2]
    if (white > 0) {
      // only lift mid/bright skin tones so dark hair that happens to be skin-hued stays put
      const l0 = 0.299 * R + 0.587 * G + 0.114 * B
      const s = skin(R, G, B) * white * 0.45 * Math.min(1, Math.max(0, (l0 - 60) / 50))
      R += (255 - R) * s
      G += (255 - G) * s
      B += (255 - B) * s
    }
    R = cf * (R + bright - 128) + 128
    G = cf * (G + bright - 128) + 128
    B = cf * (B + bright - 128) + 128
    const l = 0.299 * R + 0.587 * G + 0.114 * B
    d[i * 4] = l + (R - l) * sat
    d[i * 4 + 1] = l + (G - l) * sat
    d[i * 4 + 2] = l + (B - l) * sat
  }
  ctx.putImageData(img, 0, 0)
  return out
}

export interface FaceStats {
  /** mean luminance over the face box, 0–255 */
  mean: number
  left: number
  right: number
}

export function faceStats(fg: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number }): FaceStats {
  const x0 = Math.max(0, Math.round(box.x + box.w * 0.2))
  const x1 = Math.min(fg.width, Math.round(box.x + box.w * 0.8))
  const y0 = Math.max(0, Math.round(box.y + box.h * 0.25))
  const y1 = Math.min(fg.height, Math.round(box.y + box.h * 0.75))
  if (x1 <= x0 || y1 <= y0) return { mean: 128, left: 128, right: 128 }
  const d = fg.getContext('2d')!.getImageData(x0, y0, x1 - x0, y1 - y0).data
  const w = x1 - x0
  let sl = 0
  let sr = 0
  let nl = 0
  let nr = 0
  for (let i = 0; i < d.length / 4; i++) {
    const l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
    if (i % w < w / 2) {
      sl += l
      nl++
    } else {
      sr += l
      nr++
    }
  }
  const left = sl / Math.max(1, nl)
  const right = sr / Math.max(1, nr)
  return { mean: (left + right) / 2, left, right }
}
