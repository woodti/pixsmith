import type { Face } from '../ai/models'
import { makeCanvas } from '../lib/image'
import type { Paper, Spec } from './specs'
import { drawSuit, type SuitId } from './suits'

/** Where the head sits in the source image. */
export interface Anchor {
  /** horizontal centre of the face */
  cx: number
  /** crown (top of hair) */
  top: number
  /** chin */
  chin: number
  /** roll of the eye line, radians */
  roll: number
  /** face width, used to size outfits */
  fw: number
  /** highest shoulder point below the chin, if the matte shows one */
  shoulder?: number
}

export interface Adjust {
  zoom: number
  dx: number
  dy: number
  rotate: number
}

export const NO_ADJUST: Adjust = { zoom: 1, dx: 0, dy: 0, rotate: 0 }

export interface Outfit {
  id: SuitId
  /** size multiplier */
  scale: number
  /** vertical offset in face widths */
  dy: number
}

export const NO_OUTFIT: Outfit = { id: 'none', scale: 1, dy: 0 }

export function findAnchor(face: Face, alpha: Uint8Array, w: number, h: number): Anchor {
  const [re, le] = face.kps
  const roll = Math.atan2(le[1] - re[1], le[0] - re[0])
  const cx = (re[0] + le[0]) / 2
  const chin = face.y + face.h

  // Crown: first row above the face where the matte covers a decent share of the face width.
  const x0 = Math.max(0, Math.round(face.x + face.w * 0.15))
  const x1 = Math.min(w - 1, Math.round(face.x + face.w * 0.85))
  const need = Math.max(2, (x1 - x0) * 0.08)
  let top = face.y
  for (let y = 0; y < Math.min(h, face.y + face.h / 2); y++) {
    let n = 0
    for (let x = x0; x <= x1; x++) if (alpha[y * w + x] > 128) n++
    if (n >= need) {
      top = y
      break
    }
  }
  // Guard against hats/updos or a matte that missed the hair: keep the crown in a sane range.
  const faceH = chin - face.y
  top = Math.min(top, face.y - faceH * 0.05)
  top = Math.max(top, face.y - faceH * 0.6)
  // Shoulders: scanning down from the chin beside the neck, the first opaque pixel.
  let shoulder: number | undefined
  for (const side of [-1, 1]) {
    const x = Math.round(cx + side * face.w * 1.15)
    if (x < 0 || x >= w) continue
    for (let y = Math.max(0, Math.round(chin)); y < h; y++) {
      if (alpha[y * w + x] > 128) {
        shoulder = Math.min(shoulder ?? Infinity, y)
        break
      }
    }
  }
  return { cx, top, chin, roll: Math.abs(roll) < (20 * Math.PI) / 180 ? roll : 0, fw: face.w, shoulder }
}

/**
 * True when the source photo ends (e.g. cropped at the shoulders) above the bottom of the output,
 * leaving a strip of plain background under the body.
 */
export function bodyCutOff(fg: HTMLCanvasElement, cutAtBottom: boolean, anchor: Anchor, spec: Spec, adj: Adjust) {
  if (!cutAtBottom) return false
  const k = (spec.head / (anchor.chin - anchor.top)) * adj.zoom
  const bottom = spec.top + adj.dy + (fg.height - anchor.top) * k
  return bottom < 0.98
}

/**
 * Fades out the person's own shoulders and clothes beside the neck (from the chin down to the
 * collar), so the drawn outfit replaces them instead of sitting on top with skin peeking out.
 */
function withoutShoulders(fg: HTMLCanvasElement, cx: number, chin: number, collar: number, neck: number) {
  const c = makeCanvas(fg.width, fg.height)
  const ctx = c.getContext('2d')!
  ctx.drawImage(fg, 0, 0)
  ctx.globalCompositeOperation = 'destination-out'
  // a short fade: a long one leaves a translucent skin-coloured smear on the new background
  const g = ctx.createLinearGradient(0, chin, 0, chin + Math.max(4, (collar - chin) * 0.3))
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(0,0,0,1)')
  ctx.fillStyle = g
  for (const side of [-1, 1]) {
    const edge = cx + side * neck
    ctx.save()
    ctx.beginPath()
    if (side < 0) ctx.rect(0, chin, Math.max(0, edge), fg.height - chin)
    else ctx.rect(edge, chin, fg.width - edge, fg.height - chin)
    ctx.clip()
    ctx.fillRect(0, chin, fg.width, fg.height - chin)
    ctx.restore()
  }
  return c
}

export function renderPhoto(
  fg: HTMLCanvasElement,
  anchor: Anchor,
  spec: Spec,
  bg: string,
  adj: Adjust,
  outfit: Outfit = NO_OUTFIT,
  scale = 1,
) {
  const W = Math.round(spec.w * scale)
  const H = Math.round(spec.h * scale)
  const c = makeCanvas(W, H)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const k = ((spec.head * H) / (anchor.chin - anchor.top)) * adj.zoom
  ctx.translate(W / 2 + adj.dx * W, spec.top * H + adj.dy * H)
  ctx.rotate(-anchor.roll + (adj.rotate * Math.PI) / 180)
  ctx.scale(k, k)
  ctx.translate(-anchor.cx, -anchor.top)
  ctx.imageSmoothingQuality = 'high'
  if (outfit.id === 'none') {
    ctx.drawImage(fg, 0, 0)
    return c
  }
  const head = anchor.chin - anchor.top
  const u = anchor.fw * 1.08 * outfit.scale
  // Collar a little below the chin, raised if needed so the suit's shoulders cover the real ones
  // (the suit's shoulder line sits ~0.11u below the collar at the scan position).
  let collar = anchor.chin + head * 0.1
  if (anchor.shoulder !== undefined) collar = Math.max(anchor.chin, Math.min(collar, anchor.shoulder - 0.16 * u))
  collar += outfit.dy * anchor.fw
  // YuNet's box bottom tends to sit a bit below the real chin, so start the fade slightly higher
  ctx.drawImage(withoutShoulders(fg, anchor.cx, anchor.chin - head * 0.06, collar, 0.36 * u), 0, 0)
  ctx.translate(anchor.cx, collar)
  ctx.scale(u, u)
  drawSuit(ctx, outfit.id)
  return c
}

const MM_PER_INCH = 25.4
const DPI = 300

interface Placed {
  photo: HTMLCanvasElement
  mm: [number, number]
}

/**
 * Grid of photos on a sheet of photo paper at 300 dpi. With a second photo, `b` fills the left
 * columns and `a` the rest. Tries both paper orientations and keeps the one that fits more.
 */
export function renderSheet(a: Placed, paper: Paper, b?: Placed) {
  const px = (mm: number) => (mm / MM_PER_INCH) * DPI
  const gap = px(2)
  const margin = px(2.5)
  const sizeA = a.mm.map(px) as [number, number]
  const sizeB = b ? (b.mm.map(px) as [number, number]) : null
  const fit = (avail: number, item: number) => Math.max(0, Math.floor((avail + gap) / (item + gap)))

  type Plan = { W: number; H: number; colsB: number; rowsB: number; colsA: number; rowsA: number }
  const plans: Plan[] = []
  for (const [W, H] of [
    [paper.inch[0] * DPI, paper.inch[1] * DPI],
    [paper.inch[1] * DPI, paper.inch[0] * DPI],
  ]) {
    const innerW = W - 2 * margin
    const innerH = H - 2 * margin
    if (!sizeB) {
      plans.push({ W, H, colsB: 0, rowsB: 0, colsA: fit(innerW, sizeA[0]), rowsA: fit(innerH, sizeA[1]) })
      continue
    }
    for (let colsB = 1; colsB <= fit(innerW, sizeB[0]); colsB++) {
      const rest = innerW - colsB * (sizeB[0] + gap)
      plans.push({ W, H, colsB, rowsB: fit(innerH, sizeB[1]), colsA: fit(rest, sizeA[0]), rowsA: fit(innerH, sizeA[1]) })
    }
  }
  const area = (p: Plan) =>
    p.colsA * p.rowsA * sizeA[0] * sizeA[1] + (sizeB ? p.colsB * p.rowsB * sizeB[0] * sizeB[1] : 0)
  const valid = plans.filter((p) => p.colsA * p.rowsA > 0 && (!sizeB || p.colsB * p.rowsB > 0))
  const best = (valid.length ? valid : plans).reduce((x, y) => (area(y) > area(x) ? y : x))

  const c = makeCanvas(Math.round(best.W), Math.round(best.H))
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.strokeStyle = '#d4d4d8'
  ctx.lineWidth = 1

  const blockB = sizeB ? best.colsB * (sizeB[0] + gap) : 0
  const blockA = best.colsA * (sizeA[0] + gap) - (best.colsA ? gap : 0)
  let x = (best.W - blockB - blockA) / 2
  const put = (photo: HTMLCanvasElement, size: [number, number], cols: number, rows: number) => {
    const blockH = rows * (size[1] + gap) - gap
    const y0 = (best.H - blockH) / 2
    for (let col = 0; col < cols; col++) {
      for (let r = 0; r < rows; r++) {
        const px0 = Math.round(x + col * (size[0] + gap))
        const py0 = Math.round(y0 + r * (size[1] + gap))
        ctx.drawImage(photo, px0, py0, Math.round(size[0]), Math.round(size[1]))
        ctx.strokeRect(px0 - 0.5, py0 - 0.5, Math.round(size[0]) + 1, Math.round(size[1]) + 1)
      }
    }
    x += cols * (size[0] + gap)
  }
  if (b && sizeB) put(b.photo, sizeB, best.colsB, best.rowsB)
  put(a.photo, sizeA, best.colsA, best.rowsA)
  return { canvas: c, countA: best.colsA * best.rowsA, countB: best.colsB * best.rowsB }
}
