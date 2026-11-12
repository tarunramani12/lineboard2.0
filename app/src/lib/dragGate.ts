/**
 * Lets a whole list row be dragged, not only its handle.
 * With a mouse the drag starts once the pointer has moved a few pixels, so a plain click still opens the row.
 * With touch or a pen it starts after a short press and hold, so scrolling and swiping a row still work.
 * Dragging itself is done by the page: `begin` gets the row element and the pointer to follow.
 */
let dragging = false
let endedAt = 0
export const justDragged = () => Date.now() - endedAt < 350

if (typeof window !== 'undefined') {
  // While a row is held and dragged, the page must not scroll under the finger.
  window.addEventListener('touchmove', (e) => { if (dragging && e.cancelable) e.preventDefault() }, { passive: false })
}

const SKIP = 'button, select, input, textarea, a, label, [contenteditable]'

export function armRowDrag(e: React.PointerEvent, begin: (el: HTMLElement, pointerId: number) => void, enabled = true) {
  const hit = (e.target as HTMLElement).closest(SKIP)
  // a row's title is a button, and it can still start a drag
  if (!enabled || e.button !== 0 || (hit && !hit.classList.contains('lb-shotdesc'))) return
  const el = e.currentTarget as HTMLElement
  const id = e.pointerId, x0 = e.clientX, y0 = e.clientY, touch = e.pointerType !== 'mouse'
  let timer = 0
  const stop = () => { window.clearTimeout(timer); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop) }
  const go = () => {
    stop(); dragging = true; document.body.classList.add('lb-row-dragging')
    try { window.getSelection()?.removeAllRanges() } catch { /* nothing selected */ }
    begin(el, id)
    const end = () => { dragging = false; endedAt = Date.now(); document.body.classList.remove('lb-row-dragging'); window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', end, true) }
    window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true)
  }
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    const d = Math.hypot(ev.clientX - x0, ev.clientY - y0)
    if (touch) { if (d > 9) stop() } else if (d > 6) go()
  }
  window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop)
  if (touch) timer = window.setTimeout(go, 380)
}
