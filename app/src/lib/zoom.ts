import { useCallback, useEffect, useState } from 'react'

/** Zoom for the script page, like a word processor: steps from 50 to 200 percent, or "fit" to fill the width. */
export const ZOOM_STEPS = [50, 75, 100, 125, 150, 200] as const
export const ZOOM_MIN = 50
export const ZOOM_MAX = 200
export const PAGE_WIDTH = 860 // the script page at 100 percent, in CSS pixels
export type ZoomValue = number | 'fit'

export function clampZoom(n: number): number {
  if (!Number.isFinite(n)) return 100
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n)))
}

/** The next step up (dir 1) or down (dir -1) from the current percentage. Between steps it moves to the nearest step in that direction. */
export function stepZoom(current: number, dir: 1 | -1): number {
  const c = clampZoom(current)
  if (dir === 1) return ZOOM_STEPS.find((s) => s > c) ?? ZOOM_MAX
  return [...ZOOM_STEPS].reverse().find((s) => s < c) ?? ZOOM_MIN
}

/** Percentage at which the page just fills the width. A page that is already narrower than 100 percent stays at 100. */
export function fitWidthZoom(containerPx: number): number {
  if (!Number.isFinite(containerPx) || containerPx <= 0) return 100
  return Math.min(ZOOM_MAX, Math.max(100, Math.floor((containerPx / PAGE_WIDTH) * 100)))
}

export function parseZoom(raw: string | null): ZoomValue {
  if (raw === 'fit') return 'fit'
  const n = raw === null ? NaN : Number(raw)
  return Number.isFinite(n) ? clampZoom(n) : 100
}

/** Pinch: scale the starting percentage by how far the two fingers moved apart, in steps of 5. */
export function pinchZoom(startPercent: number, startDist: number, dist: number): number {
  if (startDist <= 0 || dist <= 0) return clampZoom(startPercent)
  return clampZoom(Math.round((startPercent * dist) / startDist / 5) * 5)
}

const KEY = 'lb-script-zoom'

/**
 * Script zoom state. Remembered on this device. The element passed to `setEl` is the one that pinches and is measured for "fit".
 * Keyboard: Ctrl or Cmd with plus, minus and 0 while the Script page is open.
 */
export function useScriptZoom() {
  const [value, setValueState] = useState<ZoomValue>(() => { try { return parseZoom(localStorage.getItem(KEY)) } catch { return 100 } })
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(0)

  const setValue = useCallback((v: ZoomValue) => {
    setValueState(v)
    try { localStorage.setItem(KEY, String(v)) } catch { /* private window */ }
  }, [])

  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [el])

  const percent = value === 'fit' ? fitWidthZoom(width) : value

  const step = useCallback((dir: 1 | -1) => setValue(stepZoom(percent, dir)), [percent, setValue])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (e.key === '+' || e.key === '=') { e.preventDefault(); step(1) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); step(-1) }
      else if (e.key === '0') { e.preventDefault(); setValue(100) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, setValue])

  useEffect(() => {
    if (!el) return
    const pts = new Map<number, { x: number; y: number }>()
    let start: { dist: number; pct: number } | null = null
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 2) start = { dist: dist(), pct: percent }
    }
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 2 && start) setValue(pinchZoom(start.pct, start.dist, dist()))
    }
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) start = null }
    const noGesture = (e: Event) => e.preventDefault() // Safari's own page pinch
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('gesturestart', noGesture)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('gesturestart', noGesture)
    }
  }, [el, percent, setValue])

  return { value, percent, setValue, step, setEl }
}
