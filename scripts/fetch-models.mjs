// Downloads the ONNX models into public/models (git-ignored). Runs before dev/build.
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const RELEASE = process.env.MODEL_BASE || 'https://github.com/woodti/pixsmith/releases/download/models-v1'
const HF = 'https://huggingface.co'

const MODELS = [
  // MODNet portrait matting, Apache-2.0 — https://github.com/ZHKKKe/MODNet
  { file: 'modnet.onnx', url: `${HF}/Xenova/modnet/resolve/main/onnx/model.onnx`, size: 25888640 },
  // YuNet face detector, MIT — https://github.com/opencv/opencv_zoo
  {
    file: 'yunet.onnx',
    url: `${HF}/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx`,
    size: 232589,
  },
  // IS-Net general use, Apache-2.0 — https://github.com/xuebinqin/DIS, converted to fp16 by scripts/convert_isnet.py
  { file: 'isnet_fp16.onnx', url: `${RELEASE}/isnet_fp16.onnx`, size: 90661254 },
  // BiRefNet lite, MIT — https://github.com/ZhengPeng7/BiRefNet; split in two to stay under static-host file limits
  {
    file: 'birefnet_lite_fp16.onnx',
    url: `${HF}/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx`,
    size: 114538221,
    split: 2,
  },
  // MI-GAN inpainting pipeline, MIT — https://github.com/Picsart-AI-Research/MI-GAN
  { file: 'migan_pipeline_v2.onnx', url: `${HF}/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx`, size: 28079181 },
  // Real-ESRGAN general x4v3, BSD-3-Clause — https://github.com/xinntao/Real-ESRGAN
  {
    file: 'realesr-general-x4v3.onnx',
    url: `${HF}/vlad-grig/realesr-general-x4v3-onnx/resolve/main/onnx/model.onnx`,
    size: 4866420,
  },
]

const dir = new URL('../public/models/', import.meta.url)
mkdirSync(dir, { recursive: true })

const partSizes = (size, n) => Array.from({ length: n }, (_, i) => (i < n - 1 ? Math.ceil(size / n) : size - Math.ceil(size / n) * (n - 1)))
const sizeOf = (u) => (existsSync(u) ? statSync(u).size : -1)

for (const m of MODELS) {
  const outputs = m.split
    ? partSizes(m.size, m.split).map((size, i) => ({ url: new URL(`${m.file}.part${i}`, dir), size }))
    : [{ url: new URL(m.file, dir), size: m.size }]
  if (outputs.every((o) => sizeOf(o.url) === o.size)) continue

  process.stdout.write(`downloading ${m.file} ... `)
  const res = await fetch(m.url)
  if (!res.ok || !res.body) throw new Error(`${m.url}: HTTP ${res.status}`)
  const tmp = new URL(m.file + '.download', dir)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
  const size = statSync(tmp).size
  if (size !== m.size) throw new Error(`${m.file}: expected ${m.size} bytes, got ${size}`)
  if (!m.split) renameSync(tmp, outputs[0].url)
  else {
    let start = 0
    for (const o of outputs) {
      await pipeline(createReadStream(tmp, { start, end: start + o.size - 1 }), createWriteStream(o.url))
      start += o.size
    }
    rmSync(tmp)
  }
  console.log(`${(size / 1e6).toFixed(1)} MB`)
}
