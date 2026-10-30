import { MATTE_SIZE, YUNET_SIZE, modnetSize, type Backend, type DeviceInfo, type Face, type MatteModel, type ModelId } from './models'
import type { Request, Response } from './worker'
import { makeCanvas } from '../lib/image'

type Progress = (loaded: number, total: number) => void
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: Progress }
// Distributive Omit so each request variant keeps its own fields.
type Body = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()
const backends = new Map<ModelId, Backend>()
const listeners = new Set<() => void>()

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<Response>) => {
      const msg = e.data
      const p = pending.get(msg.id)
      if (!p) return
      if (msg.type === 'progress') p.onProgress?.(msg.loaded, msg.total)
      else {
        pending.delete(msg.id)
        if (msg.type === 'done') p.resolve(msg.result)
        else p.reject(new Error(msg.message))
      }
    }
    worker.postMessage({ id: 0, type: 'init', modelBase: new URL('models/', document.baseURI).href } satisfies Request)
  }
  return worker
}

function call<T>(body: Body, transfer: Transferable[] = [], onProgress?: Progress) {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress })
    getWorker().postMessage({ ...body, id }, transfer)
  })
}

let deviceInfo: Promise<DeviceInfo> | null = null
export const device = () => (deviceInfo ??= call<DeviceInfo>({ type: 'device' }))

export const isLoaded = (m: ModelId) => backends.has(m)
export const backendOf = (m: ModelId) => backends.get(m)

/** Re-render hook for the showcase page when a model finishes loading. */
export function onModelsChange(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export async function loadModel(model: ModelId, onProgress?: Progress) {
  if (backends.has(model)) return backends.get(model)!
  const backend = await call<Backend>({ type: 'load', model }, [], onProgress)
  backends.set(model, backend)
  listeners.forEach((fn) => fn())
  return backend
}

export function pixels(src: CanvasImageSource, sw: number, sh: number, w: number, h: number, dw = w, dh = h) {
  const c = makeCanvas(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, dw, dh)
  return ctx.getImageData(0, 0, w, h).data
}

/** Alpha matte (0–255) at the source canvas resolution. */
export async function matte(src: HTMLCanvasElement, model: MatteModel) {
  const { w, h } = model === 'modnet' ? modnetSize(src.width, src.height) : { w: MATTE_SIZE, h: MATTE_SIZE }
  const rgba = pixels(src, src.width, src.height, w, h)
  const mask = await call<Float32Array>({ type: 'matte', model, rgba, w, h }, [rgba.buffer])

  const small = new ImageData(w, h)
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] * 255
    small.data[i * 4] = v
    small.data[i * 4 + 1] = v
    small.data[i * 4 + 2] = v
    small.data[i * 4 + 3] = 255
  }
  const tmp = makeCanvas(w, h)
  tmp.getContext('2d')!.putImageData(small, 0, 0)
  const full = pixels(tmp, w, h, src.width, src.height)
  const alpha = new Uint8Array(src.width * src.height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = full[i * 4]
  return alpha
}

/** Faces in source-canvas coordinates, best first. */
export async function detectFaces(src: HTMLCanvasElement): Promise<Face[]> {
  const S = YUNET_SIZE
  const k = Math.min(S / src.width, S / src.height)
  const rgba = pixels(src, src.width, src.height, S, S, src.width * k, src.height * k)
  const faces = await call<Face[]>({ type: 'faces', rgba }, [rgba.buffer])
  return faces.map((f) => ({
    ...f,
    x: f.x / k,
    y: f.y / k,
    w: f.w / k,
    h: f.h / k,
    kps: f.kps.map(([x, y]) => [x / k, y / k] as [number, number]),
  }))
}

/** RGBA with decontaminated edge colours and the matte as alpha. */
export async function foreground(src: HTMLCanvasElement, alpha: Uint8Array) {
  const rgba = pixels(src, src.width, src.height, src.width, src.height)
  const a = alpha.slice()
  const out = await call<Uint8ClampedArray>(
    { type: 'foreground', rgba, alpha: a, w: src.width, h: src.height },
    [rgba.buffer, a.buffer],
  )
  return new ImageData(out as Uint8ClampedArray<ArrayBuffer>, src.width, src.height)
}

/** Fills the masked pixels (non-zero = remove) with plausible background. */
export async function inpaint(src: HTMLCanvasElement, hole: Uint8Array) {
  const rgba = pixels(src, src.width, src.height, src.width, src.height)
  const m = hole.slice()
  const out = await call<Uint8ClampedArray>(
    { type: 'inpaint', rgba, mask: m, w: src.width, h: src.height },
    [rgba.buffer, m.buffer],
  )
  return new ImageData(out as Uint8ClampedArray<ArrayBuffer>, src.width, src.height)
}

export async function upscale(src: HTMLCanvasElement, scale: 2 | 4, onProgress?: Progress) {
  const rgba = pixels(src, src.width, src.height, src.width, src.height)
  const out = await call<Uint8ClampedArray>(
    { type: 'upscale', rgba, w: src.width, h: src.height, scale },
    [rgba.buffer],
    onProgress,
  )
  return new ImageData(out as Uint8ClampedArray<ArrayBuffer>, src.width * scale, src.height * scale)
}
