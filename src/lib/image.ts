export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** Decodes a file (EXIF orientation applied) into a canvas no larger than maxPixels. */
export async function loadImage(file: Blob, maxPixels: number) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const k = Math.min(1, Math.sqrt(maxPixels / (bmp.width * bmp.height)))
  const c = makeCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c
}

export function toBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败'))), type, quality),
  )
}

/** JPEG with the JFIF density set, so print shops see the intended physical size. */
export async function toJpeg(c: HTMLCanvasElement, quality: number, dpi?: number) {
  const blob = await toBlob(c, 'image/jpeg', quality)
  if (!dpi) return blob
  const bytes = new Uint8Array(await blob.arrayBuffer())
  // SOI, APP0 marker, length, "JFIF\0", version, units, Xdensity, Ydensity
  if (bytes[2] === 0xff && bytes[3] === 0xe0 && String.fromCharCode(...bytes.subarray(6, 10)) === 'JFIF') {
    bytes[13] = 1
    bytes[14] = dpi >> 8
    bytes[15] = dpi & 0xff
    bytes[16] = dpi >> 8
    bytes[17] = dpi & 0xff
  }
  return new Blob([bytes], { type: 'image/jpeg' })
}

/** Highest JPEG quality that fits under maxKB; null when even the lowest quality doesn't. */
export async function jpegUnder(c: HTMLCanvasElement, maxKB: number, dpi?: number) {
  const limit = maxKB * 1024
  let best: Blob | null = null
  let lo = 0.3
  let hi = 0.95
  const top = await toJpeg(c, hi, dpi)
  if (top.size <= limit) return top
  for (let i = 0; i < 7; i++) {
    const q = (lo + hi) / 2
    const b = await toJpeg(c, q, dpi)
    if (b.size <= limit) {
      best = b
      lo = q
    } else hi = q
  }
  if (!best) {
    const b = await toJpeg(c, 0.3, dpi)
    if (b.size <= limit) best = b
  }
  return best
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '') || 'image'
}

/** Tight bounding box of pixels with alpha above the threshold, or null if empty. */
export function alphaBounds(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number, stride = 1, threshold = 24) {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[(y * w + x) * stride + (stride - 1)] > threshold) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}
