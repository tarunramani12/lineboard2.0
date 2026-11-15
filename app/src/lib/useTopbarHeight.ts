import { useEffect, useState } from 'react'

/** Height of the sticky top bar (it is one line on a tablet and can be two on a phone), so pinned buttons sit just under it. */
export function useTopbarHeight(): number {
  const [h, setH] = useState(60)
  useEffect(() => {
    const bar = document.querySelector('.lb-topbar')
    if (!bar) return
    const read = () => setH(Math.round(bar.getBoundingClientRect().height))
    read()
    const ro = new ResizeObserver(read)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])
  return h
}
