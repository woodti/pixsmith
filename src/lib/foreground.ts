// Foreground colour estimation so hair edges don't keep the old background's tint.
// Approximate Fast Foreground Colour Estimation (Forte & Pitié, ICIP 2021), "blur fusion" variant.

const MAX_PIXELS = 4_000_000

/** Returns RGBA where RGB is the estimated foreground colour and A is the matte. */
export function estimateForeground(rgba: Uint8ClampedArray, alpha: Uint8Array, w: number, h: number) {
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)))
  const sw = Math.max(1, Math.round(w * scale))
  const sh = Math.max(1, Math.round(h * scale))
  const small = scale < 1 ? downsample(rgba, alpha, w, h, sw, sh) : { rgba, alpha }
  const fg = blurFusion(small.rgba, small.alpha, sw, sh)

  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const a = alpha[i]
      out[i * 4 + 3] = a
      if (a >= 250) {
        out[i * 4] = rgba[i * 4]
        out[i * 4 + 1] = rgba[i * 4 + 1]
        out[i * 4 + 2] = rgba[i * 4 + 2]
      } else if (scale === 1) {
        out[i * 4] = fg[i * 3]
        out[i * 4 + 1] = fg[i * 3 + 1]
        out[i * 4 + 2] = fg[i * 3 + 2]
      } else {
        sampleInto(fg, sw, sh, (x + 0.5) * (sw / w) - 0.5, (y + 0.5) * (sh / h) - 0.5, out, i * 4)
      }
    }
  }
  return out
}

function blurFusion(rgba: Uint8ClampedArray, alpha8: Uint8Array, w: number, h: number) {
  const n = w * h
  const long = Math.max(w, h)
  const r1 = Math.max(8, Math.round((long * 90) / 1024))
  const r2 = Math.max(2, Math.round((long * 6) / 1024))
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = alpha8[i] / 255
  const ba1 = boxBlur(a, w, h, r1)
  const ba2 = boxBlur(a, w, h, r2)
  const img = new Float32Array(n)
  const tmp = new Float32Array(n)
  const f1 = new Float32Array(n)
  const out = new Uint8ClampedArray(n * 3)

  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) img[i] = rgba[i * 4 + c] / 255

    for (let i = 0; i < n; i++) tmp[i] = img[i] * a[i]
    const bF = boxBlur(tmp, w, h, r1)
    for (let i = 0; i < n; i++) tmp[i] = img[i] * (1 - a[i])
    const bB = boxBlur(tmp, w, h, r1)
    for (let i = 0; i < n; i++) {
      const f = bF[i] / (ba1[i] + 1e-5)
      const b = bB[i] / (1 - ba1[i] + 1e-5)
      bB[i] = b
      f1[i] = clamp01(f + a[i] * (img[i] - a[i] * f - (1 - a[i]) * b))
    }

    for (let i = 0; i < n; i++) tmp[i] = f1[i] * a[i]
    const bF2 = boxBlur(tmp, w, h, r2)
    for (let i = 0; i < n; i++) tmp[i] = bB[i] * (1 - a[i])
    const bB2 = boxBlur(tmp, w, h, r2)
    for (let i = 0; i < n; i++) {
      const f = bF2[i] / (ba2[i] + 1e-5)
      const b = bB2[i] / (1 - ba2[i] + 1e-5)
      out[i * 3 + c] = clamp01(f + a[i] * (img[i] - a[i] * f - (1 - a[i]) * b)) * 255
    }
  }
  return out
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Mean filter over a (2r+1)² window, normalised at the borders. */
function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const mid = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x]
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r)
      const hi = Math.min(w - 1, x + r)
      mid[row + x] = sum / (hi - lo + 1)
      if (x + r + 1 < w) sum += src[row + x + r + 1]
      if (x - r >= 0) sum -= src[row + x - r]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = 0; y <= Math.min(r, h - 1); y++) sum += mid[y * w + x]
    for (let y = 0; y < h; y++) {
      const lo = Math.max(0, y - r)
      const hi = Math.min(h - 1, y + r)
      out[y * w + x] = sum / (hi - lo + 1)
      if (y + r + 1 < h) sum += mid[(y + r + 1) * w + x]
      if (y - r >= 0) sum -= mid[(y - r) * w + x]
    }
  }
  return out
}

function downsample(rgba: Uint8ClampedArray, alpha: Uint8Array, w: number, h: number, sw: number, sh: number) {
  const outRgba = new Uint8ClampedArray(sw * sh * 4)
  const outA = new Uint8Array(sw * sh)
  for (let y = 0; y < sh; y++) {
    const y0 = Math.floor((y * h) / sh)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / sh))
    for (let x = 0; x < sw; x++) {
      const x0 = Math.floor((x * w) / sw)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / sw))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = yy * w + xx
          r += rgba[i * 4]
          g += rgba[i * 4 + 1]
          b += rgba[i * 4 + 2]
          a += alpha[i]
        }
      }
      const cnt = (y1 - y0) * (x1 - x0)
      const o = y * sw + x
      outRgba[o * 4] = r / cnt
      outRgba[o * 4 + 1] = g / cnt
      outRgba[o * 4 + 2] = b / cnt
      outA[o] = a / cnt
    }
  }
  return { rgba: outRgba, alpha: outA }
}

function sampleInto(src: Uint8ClampedArray, w: number, h: number, fx: number, fy: number, out: Uint8ClampedArray, o: number) {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx)))
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)))
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const tx = Math.max(0, Math.min(1, fx - x0))
  const ty = Math.max(0, Math.min(1, fy - y0))
  for (let c = 0; c < 3; c++) {
    const top = src[(y0 * w + x0) * 3 + c] * (1 - tx) + src[(y0 * w + x1) * 3 + c] * tx
    const bot = src[(y1 * w + x0) * 3 + c] * (1 - tx) + src[(y1 * w + x1) * 3 + c] * tx
    out[o + c] = top * (1 - ty) + bot * ty
  }
}
