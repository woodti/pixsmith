export type ModelId = 'modnet' | 'isnet' | 'birefnet' | 'yunet' | 'migan' | 'esrgan'
export type MatteModel = 'modnet' | 'isnet' | 'birefnet'

export interface ModelInfo {
  /** files under public/models, concatenated in order (large models are split for static hosting) */
  files: string[]
  size: number
  /** short model name for the showcase */
  label: string
  name: string
  /** what the model does, for the showcase page */
  task: string
  license: string
  source: string
  /**
   * wasm: always CPU (small, fast enough).
   * gpu: WebGPU when available, CPU otherwise.
   * gpu-only: needs WebGPU with shader-f16.
   */
  device: 'wasm' | 'gpu' | 'gpu-only'
  /** fp16 weights; WebGPU needs shader-f16 to run them */
  fp16?: boolean
}

export const MODELS: Record<ModelId, ModelInfo> = {
  modnet: {
    label: 'MODNet',
    files: ['modnet.onnx'],
    size: 25888640,
    name: '人像抠图模型',
    task: '人像抠图（发丝级）',
    license: 'Apache-2.0',
    source: 'https://github.com/ZHKKKe/MODNet',
    device: 'wasm',
  },
  isnet: {
    label: 'IS-Net',
    files: ['isnet_fp16.onnx'],
    size: 90661254,
    name: '通用抠图模型',
    task: '物品、动物等通用抠图',
    license: 'Apache-2.0',
    source: 'https://github.com/xuebinqin/DIS',
    device: 'gpu',
    fp16: true,
  },
  birefnet: {
    label: 'BiRefNet lite',
    files: ['birefnet_lite_fp16.onnx.part0', 'birefnet_lite_fp16.onnx.part1'],
    size: 114538221,
    name: '高清抠图模型',
    task: '高精度通用抠图（需 WebGPU）',
    license: 'MIT',
    source: 'https://github.com/ZhengPeng7/BiRefNet',
    device: 'gpu-only',
    fp16: true,
  },
  yunet: {
    label: 'YuNet',
    files: ['yunet.onnx'],
    size: 232589,
    name: '人脸检测模型',
    task: '人脸与五官定位',
    license: 'MIT',
    source: 'https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet',
    device: 'wasm',
  },
  migan: {
    label: 'MI-GAN',
    files: ['migan_pipeline_v2.onnx'],
    size: 28079181,
    name: '消除模型',
    task: '擦掉物体后自动补全背景',
    license: 'MIT',
    source: 'https://github.com/Picsart-AI-Research/MI-GAN',
    device: 'gpu',
  },
  esrgan: {
    label: 'Real-ESRGAN general v3',
    files: ['realesr-general-x4v3.onnx'],
    size: 4866420,
    name: '超分辨率模型',
    task: '放大 4 倍并去模糊、去噪',
    license: 'BSD-3-Clause',
    source: 'https://github.com/xinntao/Real-ESRGAN',
    device: 'gpu',
  },
}

export const YUNET_SIZE = 640
export const MATTE_SIZE = 1024

/** MODNet wants the short edge near 512 and both sides divisible by 32. */
export function modnetSize(w: number, h: number) {
  const r = 512 / Math.min(w, h)
  return {
    w: Math.max(32, Math.round((w * r) / 32) * 32),
    h: Math.max(32, Math.round((h * r) / 32) * 32),
  }
}

export interface Face {
  score: number
  x: number
  y: number
  w: number
  h: number
  /** right eye, left eye, nose, right mouth corner, left mouth corner (viewer's left first) */
  kps: [number, number][]
}

export type Backend = 'webgpu' | 'wasm'

export interface DeviceInfo {
  webgpu: boolean
  f16: boolean
  adapter?: string
}
