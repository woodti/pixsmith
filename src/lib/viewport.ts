import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export interface View {
  /** CSS pixels per image pixel */
  scale: number
  /** image origin in CSS pixels, relative to the stage */
  ox: number
  oy: number
}

export interface StrokeHandlers {
  onStart: (p: [number, number]) => void
  onMove: (p: [number, number]) => void
  onEnd: () => void
}

const MARGIN = 24

/**
 * Zoom/pan for a full-stage canvas: wheel zooms at the cursor, two-finger pinch zooms and pans,
 * dragging pans when `pan` is true (or with the middle button / space held), otherwise paints.
 */
export function useViewport(stageRef: RefObject<HTMLElement | null>, imgW: number, imgH: number) {
  const [view, setView] = useState<View>({ scale: 1, ox: 0, oy: 0 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const viewRef = useRef(view)
  viewRef.current = view
  const space = useRef(false)

  const fitView = useCallback(
    (w: number, h: number): View => {
      if (!imgW || !imgH || !w || !h) return { scale: 1, ox: 0, oy: 0 }
      const scale = Math.min((w - 2 * MARGIN) / imgW, (h - 2 * MARGIN) / imgH, 4)
      return { scale, ox: (w - imgW * scale) / 2, oy: (h - imgH * scale) / 2 }
    },
    [imgW, imgH],
  )

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [stageRef])

  // Refit whenever the image or the stage size changes.
  useEffect(() => setView(fitView(size.w, size.h)), [fitView, size.w, size.h])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        space.current = true
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setView((v) => {
      const scale = Math.min(32, Math.max(0.02, v.scale * factor))
      const k = scale / v.scale
      return { scale, ox: cx - (cx - v.ox) * k, oy: cy - (cy - v.oy) * k }
    })
  }, [])

  const fit = useCallback(() => setView(fitView(size.w, size.h)), [fitView, size.w, size.h])
  const zoomBy = useCallback((f: number) => zoomAt(size.w / 2, size.h / 2, f), [zoomAt, size.w, size.h])

  const toImage = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const r = stageRef.current!.getBoundingClientRect()
      const v = viewRef.current
      return [(clientX - r.left - v.ox) / v.scale, (clientY - r.top - v.oy) / v.scale]
    },
    [stageRef],
  )

  /** Pointer + wheel props for the stage canvas. */
  // Gesture state lives in a ref: the stage re-renders on every pan step.
  const gesture = useRef({
    pointers: new Map<number, { x: number; y: number }>(),
    mode: 'none' as 'none' | 'pan' | 'paint' | 'pinch',
    pinch: { d: 0, cx: 0, cy: 0 },
  })
  const bind = (pan: boolean, stroke?: StrokeHandlers) => {
    const g = gesture.current
    const pointers = g.pointers
    const local = (e: { clientX: number; clientY: number }) => {
      const r = stageRef.current!.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    return {
      onWheel: (e: React.WheelEvent) => {
        const p = local(e)
        zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
      },
      onPointerDown: (e: React.PointerEvent) => {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        pointers.set(e.pointerId, local(e))
        if (pointers.size === 2) {
          if (g.mode === 'paint') stroke?.onEnd()
          const [a, b] = [...pointers.values()]
          g.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
          g.mode = 'pinch'
        } else if (pointers.size === 1) {
          if (pan || !stroke || e.button === 1 || space.current) g.mode = 'pan'
          else {
            g.mode = 'paint'
            stroke.onStart(toImage(e.clientX, e.clientY))
          }
        }
      },
      onPointerMove: (e: React.PointerEvent) => {
        const prev = pointers.get(e.pointerId)
        if (!prev) return
        const p = local(e)
        pointers.set(e.pointerId, p)
        if (g.mode === 'pan') setView((v) => ({ ...v, ox: v.ox + p.x - prev.x, oy: v.oy + p.y - prev.y }))
        else if (g.mode === 'paint') stroke?.onMove(toImage(e.clientX, e.clientY))
        else if (g.mode === 'pinch' && pointers.size === 2) {
          const [a, b] = [...pointers.values()]
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          const cx = (a.x + b.x) / 2
          const cy = (a.y + b.y) / 2
          const last = g.pinch
          setView((v) => {
            const scale = Math.min(32, Math.max(0.02, v.scale * (d / (last.d || d))))
            const k = scale / v.scale
            // zoom about the previous midpoint, then follow the midpoint's movement
            return { scale, ox: cx - (last.cx - v.ox) * k, oy: cy - (last.cy - v.oy) * k }
          })
          g.pinch = { d, cx, cy }
        }
      },
      onPointerUp: (e: React.PointerEvent) => {
        pointers.delete(e.pointerId)
        if (g.mode === 'paint') stroke?.onEnd()
        if (pointers.size === 0) g.mode = 'none'
      },
      onPointerCancel: (e: React.PointerEvent) => {
        pointers.delete(e.pointerId)
        if (g.mode === 'paint') stroke?.onEnd()
        g.mode = 'none'
      },
    }
  }

  return { view, size, fit, zoomBy, toImage, bind }
}

/** Sets up a stage-sized HiDPI canvas and applies the view transform; returns the context. */
export function prepareCanvas(c: HTMLCanvasElement, size: { w: number; h: number }, view: View) {
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(size.w * dpr))
  const h = Math.max(1, Math.round(size.h * dpr))
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  const ctx = c.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy)
  ctx.imageSmoothingEnabled = view.scale < 2
  ctx.imageSmoothingQuality = 'high'
  return ctx
}

let checker: CanvasPattern | null = null
/** Transparency checkerboard drawn in screen space under the image rect. */
export function drawChecker(ctx: CanvasRenderingContext2D, w: number, h: number) {
  if (!checker) {
    const t = document.createElement('canvas')
    t.width = t.height = 16
    const g = t.getContext('2d')!
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, 16, 16)
    g.fillStyle = '#dcdce0'
    g.fillRect(0, 0, 8, 8)
    g.fillRect(8, 8, 8, 8)
    checker = ctx.createPattern(t, 'repeat')
  }
  const m = ctx.getTransform()
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, w, h)
  ctx.clip()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = checker!
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()
  ctx.setTransform(m)
}

/** Round brush preview that follows the pointer (CSS pixels). */
export function useBrushCursor() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  return {
    pos,
    track: {
      onMouseMove: (e: React.MouseEvent) => {
        const r = e.currentTarget.getBoundingClientRect()
        setPos({ x: e.clientX - r.left, y: e.clientY - r.top })
      },
      onMouseLeave: () => setPos(null),
    },
  }
}
