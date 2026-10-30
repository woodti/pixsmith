import type { Face } from '../ai/models'
import type { FaceStats } from './beauty'
import type { Adjust, Anchor } from './compose'
import type { Spec } from './specs'

export interface Check {
  ok: boolean
  text: string
}

/** Heuristic photo-requirement checks from the face landmarks and the current framing. */
export function runChecks(face: Face, anchor: Anchor, spec: Spec, adj: Adjust, stats: FaceStats, cutOff: boolean): Check[] {
  const [re, le, nose, rm, lm] = face.kps
  const eyeDist = Math.hypot(le[0] - re[0], le[1] - re[1]) || 1
  const eyeMid = [(re[0] + le[0]) / 2, (re[1] + le[1]) / 2]
  const mouthY = (rm[1] + lm[1]) / 2
  const out: Check[] = []

  const yaw = (nose[0] - eyeMid[0]) / eyeDist
  out.push(Math.abs(yaw) < 0.12 ? { ok: true, text: '正脸面对镜头' } : { ok: false, text: '脸有点侧，正对镜头效果更好' })

  const pitch = (nose[1] - eyeMid[1]) / (mouthY - eyeMid[1] || 1)
  out.push(
    pitch < 0.42
      ? { ok: false, text: '好像在低头，下巴微收、平视镜头即可' }
      : pitch > 0.78
        ? { ok: false, text: '好像在抬头，平视镜头即可' }
        : { ok: true, text: '头部没有明显俯仰' },
  )

  const roll = (anchor.roll * 180) / Math.PI - adj.rotate
  out.push(
    Math.abs(roll) < 1
      ? { ok: true, text: '头部端正' }
      : { ok: true, text: `已自动扶正 ${Math.abs((anchor.roll * 180) / Math.PI).toFixed(1)}°` },
  )

  const head = spec.head * adj.zoom
  out.push(
    Math.abs(adj.zoom - 1) <= 0.1
      ? { ok: true, text: `头部占照片高度 ${Math.round(head * 100)}%，符合规格` }
      : { ok: false, text: `头部${adj.zoom > 1 ? '偏大' : '偏小'}（${Math.round(head * 100)}%，建议 ${Math.round(spec.head * 100)}% 左右）` },
  )

  if (spec.top + adj.dy < 0.03) out.push({ ok: false, text: '头顶太贴近上边缘' })
  if (Math.abs(adj.dx) > 0.06) out.push({ ok: false, text: '人像没有居中' })

  const srcHead = anchor.chin - anchor.top
  const outHead = spec.head * spec.h * adj.zoom
  out.push(
    srcHead >= outHead * 0.9
      ? { ok: true, text: '原图清晰度足够' }
      : { ok: false, text: '原图分辨率偏低，照片可能发虚，建议用更清晰的原图' },
  )

  if (stats.mean < 90) out.push({ ok: false, text: '脸部偏暗，可以在“美颜”里调亮' })
  else if (stats.mean > 215) out.push({ ok: false, text: '脸部过亮，可以在“美颜”里调暗' })
  else out.push({ ok: true, text: '曝光正常' })

  const side = Math.abs(stats.left - stats.right) / Math.max(1, stats.mean)
  out.push(side > 0.25 ? { ok: false, text: '脸部左右明暗不均，尽量在均匀光线下拍' } : { ok: true, text: '光线均匀' })

  if (cutOff) out.push({ ok: false, text: '原照片拍到肩膀就截断，下方会留空' })
  return out
}
