export interface Spec {
  id: string
  name: string
  /** output size in pixels */
  w: number
  h: number
  /** physical size; omitted for online-upload-only specs */
  mm?: [number, number]
  dpi: number
  /** head height (crown to chin) as a fraction of photo height */
  head: number
  /** gap above the crown as a fraction of photo height */
  top: number
  bg: string
  /** file size limit some upload systems enforce, KB */
  maxKB?: number
  note?: string
}

// Common sizes; official requirements change, so the UI reminds people to double-check.
export const SPECS: Spec[] = [
  { id: '1in', name: '一寸', w: 295, h: 413, mm: [25, 35], dpi: 300, head: 0.6, top: 0.1, bg: '#ffffff' },
  { id: '2in', name: '二寸', w: 413, h: 579, mm: [35, 49], dpi: 300, head: 0.58, top: 0.1, bg: '#ffffff' },
  { id: 's1in', name: '小一寸', w: 260, h: 378, mm: [22, 32], dpi: 300, head: 0.6, top: 0.1, bg: '#ffffff' },
  { id: 'l1in', name: '大一寸', w: 390, h: 567, mm: [33, 48], dpi: 300, head: 0.62, top: 0.09, bg: '#ffffff' },
  { id: 's2in', name: '小二寸', w: 413, h: 531, mm: [35, 45], dpi: 300, head: 0.62, top: 0.09, bg: '#ffffff' },
  {
    id: 'idcard',
    name: '身份证',
    w: 358,
    h: 441,
    mm: [26, 32],
    dpi: 350,
    head: 0.7,
    top: 0.07,
    bg: '#ffffff',
    note: '身份证、社保卡照片多数需要到指定机构现场采集，这里的照片适合自行上传的场景',
  },
  { id: 'driver', name: '驾驶证', w: 260, h: 378, mm: [22, 32], dpi: 300, head: 0.62, top: 0.09, bg: '#ffffff' },
  {
    id: 'passport',
    name: '护照 / 港澳通行证',
    w: 390,
    h: 567,
    mm: [33, 48],
    dpi: 300,
    head: 0.64,
    top: 0.08,
    bg: '#ffffff',
    note: '出入境证件照要求不露齿、不戴首饰、头发不遮眉，办理时以出入境窗口要求为准',
  },
  { id: 'usvisa', name: '美国签证', w: 600, h: 600, mm: [51, 51], dpi: 300, head: 0.6, top: 0.1, bg: '#ffffff', maxKB: 240 },
  { id: 'jpvisa', name: '日本签证', w: 531, h: 531, mm: [45, 45], dpi: 300, head: 0.72, top: 0.08, bg: '#ffffff' },
  { id: 'schengen', name: '申根签证', w: 413, h: 531, mm: [35, 45], dpi: 300, head: 0.76, top: 0.06, bg: '#f0f0f0' },
  { id: 'teacher', name: '教师资格证', w: 295, h: 413, dpi: 300, head: 0.6, top: 0.1, bg: '#ffffff', maxKB: 200 },
  { id: 'cet', name: '四六级 / 计算机等级', w: 144, h: 192, dpi: 300, head: 0.6, top: 0.1, bg: '#438edb', maxKB: 20 },
  { id: 'civil', name: '公务员考试', w: 295, h: 413, dpi: 300, head: 0.6, top: 0.1, bg: '#438edb', maxKB: 100 },
  { id: 'resume', name: '简历照', w: 413, h: 579, mm: [35, 49], dpi: 300, head: 0.52, top: 0.12, bg: '#438edb' },
]

export const BG_COLORS: { name: string; color: string }[] = [
  { name: '白', color: '#ffffff' },
  { name: '蓝', color: '#438edb' },
  { name: '深蓝', color: '#1c4e9c' },
  { name: '红', color: '#d8222c' },
  { name: '浅灰', color: '#f0f0f0' },
]

export interface Paper {
  id: string
  name: string
  /** landscape, inches */
  inch: [number, number]
}

export const PAPERS: Paper[] = [
  { id: '6', name: '6 寸相纸', inch: [6, 4] },
  { id: '5', name: '5 寸相纸', inch: [5, 3.5] },
]
