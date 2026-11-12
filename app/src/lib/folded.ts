import { useCallback, useState } from 'react'

/**
 * Which scenes are open on a list page (Shot list, Storyboard). The choice is remembered for the browser session.
 * Until a scene is touched it is closed, on every screen size. Tapping the scene opens it.
 */
export function useFolded(pid: string, page: string) {
  const key = `lb-open:${pid}:${page}`
  const [over, setOver] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, boolean> } catch { return {} }
  })
  const save = useCallback((next: Record<string, boolean>) => {
    setOver(next)
    try { sessionStorage.setItem(key, JSON.stringify(next)) } catch { /* private mode: the choice just is not remembered */ }
  }, [key])
  const isOpen = (id: string) => over[id] ?? false
  const toggle = (id: string) => save({ ...over, [id]: !isOpen(id) })
  const setAll = (open: boolean, ids: string[]) => save(Object.fromEntries(ids.map((i) => [i, open])))
  return { isOpen, toggle, setAll }
}
