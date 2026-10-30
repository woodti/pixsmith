/// <reference lib="webworker" />
/// <reference types="@webgpu/types" />
import * as ort from 'onnxruntime-web/webgpu'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import { MODELS, YUNET_SIZE, type Backend, type DeviceInfo, type Face, type MatteModel, type ModelId } from './models'
import { estimateForeground } from '../lib/foreground'

ort.env.wasm.wasmPaths = { wasm: wasmUrl }
ort.env.wasm.numThreads = 1

const CACHE = 'pixsmith-models-v1'
const sessions = new Map<ModelId, Promise<{ session: ort.InferenceSession; backend: Backend }>>()
/** models/ directory, resolved against the page (the worker's own URL lives under assets/) */
let modelBase = ''

export type Request =
  | { id: number; type: 'init'; modelBase: string }
  | { id: number; type: 'device' }
  | { id: number; type: 'load'; model: ModelId }
  | { id: number; type: 'matte'; model: MatteModel; rgba: Uint8ClampedArray; w: number; h: number }
  | { id: number; type: 'faces'; rgba: Uint8ClampedArray }
  | { id: number; type: 'foreground'; rgba: Uint8ClampedArray; alpha: Uint8Array; w: number; h: number }
  | { id: number; type: 'inpaint'; rgba: Uint8ClampedArray; mask: Uint8Array; w: number; h: number }
  | { id: number; type: 'upscale'; rgba: Uint8ClampedArray; w: number; h: number; scale: 2 | 4 }

export type Response =
  | { id: number; type: 'progress'; loaded: number; total: number }
  | { id: number; type: 'done'; result?: unknown }
  | { id: number; type: 'error'; message: string }

const post = (msg: Response, transfer: Transferable[] = []) => self.postMessage(msg, transfer)

let deviceInfo: Promise<DeviceInfo> | null = null
function device() {
  deviceInfo ??= (async () => {
    try {
      const gpu = (navigator as Navigator & { gpu?: GPU }).gpu as GPU | undefined
      const adapter = await gpu?.requestAdapter()
      if (!adapter) return { webgpu: false, f16: false }
      const info = adapter.info
      return {
        webgpu: true,
        f16: adapter.features.has('shader-f16'),
        adapter: [info?.vendor, info?.architecture].filter(Boolean).join(' ') || undefined,
      }
    } catch {
      return { webgpu: false, f16: false }
    }
  })()
  return deviceInfo
}

async function fetchFile(url: string, expected: number, onChunk: (n: number) => void) {
  let cache: Cache | null = null
  try {
    cache = await caches.open(CACHE)
    const hit = await cache.match(url)
    if (hit) {
      const buf = new Uint8Array(await hit.arrayBuffer())
      onChunk(buf.length)
      return buf
    }
  } catch {
    cache = null
  }
  const res = await fetch(url)
  if (!res.ok || !res.body || res.headers.get('content-type')?.includes('text/html')) {
    throw new Error(`模型下载失败（HTTP ${res.status}）`)
  }
  const chunks: Uint8Array[] = []
  const reader = res.body.getReader()
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    onChunk(value.length)
    if (got > expected * 1.5 + 1e6) throw new Error('模型文件大小不符')
  }
  const buf = concat(chunks, got)
  try {
    await cache?.put(url, new Response(buf.slice()))
  } catch {
    // quota or private mode: just skip caching
  }
  return buf
}

function concat(chunks: Uint8Array[], total: number) {
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

async function download(id: number, model: ModelId) {
  const { files, size } = MODELS[model]
  let loaded = 0
  let last = 0
  const onChunk = (n: number) => {
    loaded += n
    if (loaded - last > 256 * 1024 || loaded >= size) {
      last = loaded
      post({ id, type: 'progress', loaded: Math.min(loaded, size), total: size })
    }
  }
  const parts: Uint8Array[] = []
  for (const f of files) parts.push(await fetchFile(modelBase + f, size, onChunk))
  return parts.length === 1 ? parts[0] : concat(parts, parts.reduce((n, p) => n + p.length, 0))
}

async function createSession(id: number, model: ModelId) {
  const info = MODELS[model]
  const dev = await device()
  const gpuOk = dev.webgpu && (!info.fp16 || dev.f16)
  if (info.device === 'gpu-only' && !gpuOk) throw new Error('当前浏览器不支持 WebGPU（或不支持半精度），无法使用高清模式')
  const bytes = await download(id, model)
  if (info.device !== 'wasm' && gpuOk) {
    try {
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] })
      return { session, backend: 'webgpu' as Backend }
    } catch (err) {
      if (info.device === 'gpu-only') throw err
      console.warn(`${model}: WebGPU failed, falling back to CPU`, err)
    }
  }
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
  return { session, backend: 'wasm' as Backend }
}

function session(id: number, model: ModelId) {
  let s = sessions.get(model)
  if (!s) {
    s = createSession(id, model)
    s.catch(() => sessions.delete(model))
    sessions.set(model, s)
  }
  return s
}

function toTensor(rgba: Uint8ClampedArray, w: number, h: number, mean: number[], std: number[], bgr = false, raw = false) {
  const n = w * h
  const out = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = rgba[i * 4 + (bgr ? 2 - c : c)]
      out[c * n + i] = raw ? v : (v / 255 - mean[c]) / std[c]
    }
  }
  return new ort.Tensor('float32', out, [1, 3, h, w])
}

async function matte(id: number, model: MatteModel, rgba: Uint8ClampedArray, w: number, h: number) {
  const { session: s } = await session(id, model)
  const input =
    model === 'modnet'
      ? toTensor(rgba, w, h, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
      : model === 'isnet'
        ? toTensor(rgba, w, h, [0.485, 0.456, 0.406], [1, 1, 1])
        : toTensor(rgba, w, h, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
  const out = await s.run({ [s.inputNames[0]]: input })
  const data = (await out[s.outputNames[0]].getData()) as Float32Array
  const mask = new Float32Array(w * h)
  if (model === 'modnet') {
    for (let i = 0; i < mask.length; i++) mask[i] = Math.min(1, Math.max(0, data[i]))
  } else if (model === 'birefnet') {
    for (let i = 0; i < mask.length; i++) mask[i] = 1 / (1 + Math.exp(-data[i]))
  } else {
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < mask.length; i++) {
      lo = Math.min(lo, data[i])
      hi = Math.max(hi, data[i])
    }
    const span = hi - lo || 1
    for (let i = 0; i < mask.length; i++) mask[i] = (data[i] - lo) / span
  }
  return mask
}

async function faces(id: number, rgba: Uint8ClampedArray): Promise<Face[]> {
  const S = YUNET_SIZE
  const { session: s } = await session(id, 'yunet')
  const out = await s.run({ [s.inputNames[0]]: toTensor(rgba, S, S, [], [], true, true) })
  const found: Face[] = []
  for (const stride of [8, 16, 32]) {
    const cols = S / stride
    const cls = out[`cls_${stride}`].data as Float32Array
    const obj = out[`obj_${stride}`].data as Float32Array
    const bbox = out[`bbox_${stride}`].data as Float32Array
    const kps = out[`kps_${stride}`].data as Float32Array
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])))
      if (score < 0.6) continue
      const c = i % cols
      const r = Math.floor(i / cols)
      const cx = (c + bbox[i * 4]) * stride
      const cy = (r + bbox[i * 4 + 1]) * stride
      const w = Math.exp(bbox[i * 4 + 2]) * stride
      const h = Math.exp(bbox[i * 4 + 3]) * stride
      const pts: [number, number][] = []
      for (let k = 0; k < 5; k++) pts.push([(c + kps[i * 10 + k * 2]) * stride, (r + kps[i * 10 + k * 2 + 1]) * stride])
      found.push({ score, x: cx - w / 2, y: cy - h / 2, w, h, kps: pts })
    }
  }
  // greedy NMS
  found.sort((a, b) => b.score - a.score)
  const kept: Face[] = []
  for (const f of found) {
    if (kept.every((k) => iou(k, f) < 0.3)) kept.push(f)
  }
  return kept
}

function iou(a: Face, b: Face) {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  return inter / (a.w * a.h + b.w * b.h - inter)
}

/** MI-GAN pipeline: uint8 NCHW image + mask (0 = fill, 255 = keep); it crops and resizes internally. */
async function inpaint(id: number, rgba: Uint8ClampedArray, hole: Uint8Array, w: number, h: number) {
  const { session: s } = await session(id, 'migan')
  const n = w * h
  const img = new Uint8Array(3 * n)
  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    img[i] = rgba[i * 4]
    img[n + i] = rgba[i * 4 + 1]
    img[2 * n + i] = rgba[i * 4 + 2]
    mask[i] = hole[i] ? 0 : 255
  }
  const out = await s.run({
    image: new ort.Tensor('uint8', img, [1, 3, h, w]),
    mask: new ort.Tensor('uint8', mask, [1, 1, h, w]),
  })
  const res = (await out[s.outputNames[0]].getData()) as Uint8Array
  const result = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    result[i * 4] = res[i]
    result[i * 4 + 1] = res[n + i]
    result[i * 4 + 2] = res[2 * n + i]
    result[i * 4 + 3] = 255
  }
  return result
}

/** Real-ESRGAN ×4 in overlapping tiles; scale 2 box-downsamples each tile's output. */
async function upscale(id: number, rgba: Uint8ClampedArray, w: number, h: number, scale: 2 | 4) {
  const { session: s, backend } = await session(id, 'esrgan')
  const TILE = backend === 'webgpu' ? 256 : 128
  const PAD = 12
  const OW = w * scale
  const OH = h * scale
  const out = new Uint8ClampedArray(OW * OH * 4)
  const tiles: [number, number][] = []
  for (let y = 0; y < h; y += TILE) for (let x = 0; x < w; x += TILE) tiles.push([x, y])
  let done = 0
  for (const [tx, ty] of tiles) {
    const tw = Math.min(TILE, w - tx)
    const th = Math.min(TILE, h - ty)
    const x0 = Math.max(0, tx - PAD)
    const y0 = Math.max(0, ty - PAD)
    const x1 = Math.min(w, tx + tw + PAD)
    const y1 = Math.min(h, ty + th + PAD)
    const pw = x1 - x0
    const ph = y1 - y0
    const pn = pw * ph
    const input = new Float32Array(3 * pn)
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const si = ((y0 + y) * w + x0 + x) * 4
        const di = y * pw + x
        input[di] = rgba[si] / 255
        input[pn + di] = rgba[si + 1] / 255
        input[2 * pn + di] = rgba[si + 2] / 255
      }
    }
    const res = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, ph, pw]) })
    const o = (await res[s.outputNames[0]].getData()) as Float32Array
    const RW = pw * 4
    const rn = RW * ph * 4
    const k = 4 / scale
    // copy the tile's own (unpadded) area, downsampling k×k blocks when scale is 2
    for (let y = 0; y < th * scale; y++) {
      for (let x = 0; x < tw * scale; x++) {
        const sx = (tx - x0) * 4 + x * k
        const sy = (ty - y0) * 4 + y * k
        const di = ((ty * scale + y) * OW + tx * scale + x) * 4
        for (let c = 0; c < 3; c++) {
          let v = 0
          for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) v += o[c * rn + (sy + yy) * RW + sx + xx]
          out[di + c] = (v / (k * k)) * 255
        }
        out[di + 3] = 255
      }
    }
    done++
    post({ id, type: 'progress', loaded: done, total: tiles.length })
  }
  return out
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data
  try {
    if (req.type === 'init') {
      modelBase = req.modelBase
    } else if (req.type === 'device') {
      post({ id: req.id, type: 'done', result: await device() })
    } else if (req.type === 'load') {
      const { backend } = await session(req.id, req.model)
      post({ id: req.id, type: 'done', result: backend })
    } else if (req.type === 'matte') {
      const mask = await matte(req.id, req.model, req.rgba, req.w, req.h)
      post({ id: req.id, type: 'done', result: mask }, [mask.buffer])
    } else if (req.type === 'faces') {
      post({ id: req.id, type: 'done', result: await faces(req.id, req.rgba) })
    } else if (req.type === 'foreground') {
      const rgba = estimateForeground(req.rgba, req.alpha, req.w, req.h)
      post({ id: req.id, type: 'done', result: rgba }, [rgba.buffer])
    } else if (req.type === 'inpaint') {
      const rgba = await inpaint(req.id, req.rgba, req.mask, req.w, req.h)
      post({ id: req.id, type: 'done', result: rgba }, [rgba.buffer])
    } else if (req.type === 'upscale') {
      const rgba = await upscale(req.id, req.rgba, req.w, req.h, req.scale)
      post({ id: req.id, type: 'done', result: rgba }, [rgba.buffer])
    }
  } catch (err) {
    post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
