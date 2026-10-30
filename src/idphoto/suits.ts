// Procedurally drawn outfits, so there are no third-party image assets to license.
// Coordinates are in units of face width, origin at the centre of the collar, y pointing down.

export type SuitId = 'none' | 'navy' | 'black' | 'grey' | 'women' | 'shirt'

export const SUITS: { id: SuitId; name: string }[] = [
  { id: 'none', name: '不换' },
  { id: 'navy', name: '藏青西装' },
  { id: 'black', name: '黑色西装' },
  { id: 'grey', name: '灰色西装' },
  { id: 'women', name: '女士西装' },
  { id: 'shirt', name: '白衬衫' },
]

interface Palette {
  jacket: string
  jacketDark: string
  tie?: string
  tieDark?: string
}

const PALETTES: Record<Exclude<SuitId, 'none' | 'shirt'>, Palette> = {
  navy: { jacket: '#1f2a44', jacketDark: '#141c30', tie: '#8c1c2b', tieDark: '#6a1220' },
  black: { jacket: '#1b1b1d', jacketDark: '#0c0c0d', tie: '#24345c', tieDark: '#172443' },
  grey: { jacket: '#4a4d55', jacketDark: '#363940', tie: '#26334f', tieDark: '#1a243a' },
  women: { jacket: '#1d1d20', jacketDark: '#0e0e10' },
}

type Pt = [number, number]

function path(ctx: CanvasRenderingContext2D, pts: Pt[], close = true) {
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1])
  if (close) ctx.closePath()
}

const mirror = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [-x, y])

/**
 * Body silhouette: neck opening, then shoulders that run wide past the photo edge so the
 * person's own clothes and shoulders are fully covered.
 */
function body(ctx: CanvasRenderingContext2D, neck: number) {
  ctx.beginPath()
  ctx.moveTo(-neck, -0.06)
  ctx.bezierCurveTo(-0.7, 0.02, -1.2, 0.1, -1.6, 0.26)
  ctx.bezierCurveTo(-2.1, 0.46, -2.6, 0.7, -3.2, 1.1)
  ctx.lineTo(-3.2, 5)
  ctx.lineTo(3.2, 5)
  ctx.lineTo(3.2, 1.1)
  ctx.bezierCurveTo(2.6, 0.7, 2.1, 0.46, 1.6, 0.26)
  ctx.bezierCurveTo(1.2, 0.1, 0.7, 0.02, neck, -0.06)
  ctx.closePath()
}

function shirtFront(ctx: CanvasRenderingContext2D, depth: number) {
  const g = ctx.createLinearGradient(0, 0, 0, depth)
  g.addColorStop(0, '#f4f5f7')
  g.addColorStop(1, '#dfe2e7')
  ctx.fillStyle = g
  path(ctx, [
    [-0.42, -0.04],
    [0.42, -0.04],
    [0.2, depth],
    [-0.2, depth],
  ])
  ctx.fill()
}

function collar(ctx: CanvasRenderingContext2D) {
  const wing: Pt[] = [
    [-0.4, -0.1],
    [-0.02, 0.3],
    [-0.16, 0.4],
    [-0.5, 0.14],
  ]
  for (const pts of [wing, mirror(wing)]) {
    path(ctx, pts)
    ctx.fillStyle = '#fafbfc'
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'
    ctx.lineWidth = 0.012
    ctx.stroke()
  }
  // band behind the neck
  ctx.beginPath()
  ctx.moveTo(-0.4, -0.1)
  ctx.quadraticCurveTo(0, -0.02, 0.4, -0.1)
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'
  ctx.lineWidth = 0.02
  ctx.stroke()
}

function tie(ctx: CanvasRenderingContext2D, p: Palette) {
  const g = ctx.createLinearGradient(-0.15, 0, 0.15, 0)
  g.addColorStop(0, p.tieDark!)
  g.addColorStop(0.5, p.tie!)
  g.addColorStop(1, p.tieDark!)
  ctx.fillStyle = g
  path(ctx, [
    [-0.09, 0.27],
    [0.09, 0.27],
    [0.065, 0.42],
    [-0.065, 0.42],
  ])
  ctx.fill()
  path(ctx, [
    [-0.065, 0.42],
    [0.065, 0.42],
    [0.16, 1.32],
    [0, 1.46],
    [-0.16, 1.32],
  ])
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 0.01
  ctx.beginPath()
  ctx.moveTo(-0.065, 0.42)
  ctx.lineTo(0.065, 0.42)
  ctx.stroke()
}

function jacket(ctx: CanvasRenderingContext2D, p: Palette, women: boolean) {
  const g = ctx.createLinearGradient(-2.2, 0, 2.2, 0)
  g.addColorStop(0, p.jacketDark)
  g.addColorStop(0.32, p.jacket)
  g.addColorStop(0.68, p.jacket)
  g.addColorStop(1, p.jacketDark)
  const depth = women ? 1.25 : 1.55
  // jacket body with a V opening
  ctx.save()
  body(ctx, 0.42)
  ctx.clip()
  ctx.fillStyle = g
  path(ctx, [
    [-2, -0.5],
    [-0.42, -0.5],
    [-0.42, -0.02],
    [0, depth],
    [0.42, -0.02],
    [0.42, -0.5],
    [3.3, -0.5],
    [3.3, 5],
    [-3.3, 5],
  ])
  ctx.fill()
  ctx.restore()

  // lapels: slightly lighter, with a notch
  const lapel: Pt[] = women
    ? [
        [-0.42, -0.02],
        [0, depth],
        [-0.12, depth - 0.02],
        [-0.62, 0.62],
        [-0.56, 0.12],
      ]
    : [
        [-0.42, -0.02],
        [0, depth],
        [-0.14, depth - 0.04],
        [-0.6, 0.66],
        [-0.68, 0.56],
        [-0.56, 0.48],
        [-0.55, 0.1],
      ]
  for (const pts of [lapel, mirror(lapel)]) {
    path(ctx, pts)
    ctx.fillStyle = p.jacket
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.lineWidth = 0.014
    ctx.stroke()
    // highlight along the lapel roll
    ctx.beginPath()
    ctx.moveTo(pts[0][0] * 0.98, pts[0][1] + 0.02)
    ctx.lineTo(pts[1][0], pts[1][1] - 0.05)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 0.02
    ctx.stroke()
  }
  // button
  ctx.fillStyle = p.jacketDark
  ctx.beginPath()
  ctx.arc(0, depth + 0.18, 0.045, 0, Math.PI * 2)
  ctx.fill()
}

function shirtOnly(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(-2.2, 0, 2.2, 0)
  g.addColorStop(0, '#d9dce2')
  g.addColorStop(0.3, '#f6f7f9')
  g.addColorStop(0.7, '#f6f7f9')
  g.addColorStop(1, '#d9dce2')
  body(ctx, 0.4)
  ctx.fillStyle = g
  ctx.fill()
  // placket and buttons
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'
  ctx.lineWidth = 0.012
  ctx.beginPath()
  ctx.moveTo(-0.07, 0.36)
  ctx.lineTo(-0.07, 4)
  ctx.moveTo(0.07, 0.36)
  ctx.lineTo(0.07, 4)
  ctx.stroke()
  ctx.fillStyle = '#e6e8ec'
  for (let i = 0; i < 4; i++) {
    ctx.beginPath()
    ctx.arc(0, 0.5 + i * 0.5, 0.035, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'
    ctx.stroke()
  }
  collar(ctx)
}

/** Draws the outfit; the caller sets up a transform where 1 unit = face width and (0,0) = collar centre. */
export function drawSuit(ctx: CanvasRenderingContext2D, id: SuitId) {
  if (id === 'none') return
  ctx.save()
  ctx.lineJoin = 'round'
  if (id === 'shirt') shirtOnly(ctx)
  else {
    const p = PALETTES[id]
    const women = id === 'women'
    shirtFront(ctx, women ? 1.3 : 1.6)
    collar(ctx)
    if (!women) tie(ctx, p)
    jacket(ctx, p, women)
  }
  ctx.restore()
}
