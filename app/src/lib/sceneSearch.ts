// Scene search for the Shot list, Storyboard and Script pages. Pure functions, no screen code.
import type { Element } from './fountain'

export interface SceneSearchable {
  /** The scene number as shown (display number, or its place in the list while unnumbered). */
  number: string | number | null
  heading: string
  /** The scene's words (action, dialogue, cues). Leave out when the person may not read the scene. */
  text?: string
}

const clean = (s: string) => s.trim().toLowerCase()

/** All the words of a scene as one string, one line per element. */
export function sceneText(elements: Element[]): string {
  return elements.map((e) => e.text).join('\n')
}

/**
 * Does the scene match what was typed? Matches the heading, the text (when given) and the scene number.
 * A number matches the scene itself and its lettered siblings ("12" finds 12 and 12A, not 120).
 * An empty search matches everything.
 */
export function matchScene(query: string, s: SceneSearchable): boolean {
  const q = clean(query)
  if (!q) return true
  const n = s.number === null ? '' : clean(String(s.number))
  if (n && (n === q || (n.startsWith(q) && !/\d/.test(n.slice(q.length))))) return true
  if (clean(s.heading).includes(q)) return true
  return Boolean(s.text && clean(s.text).includes(q))
}

export interface Part { text: string; hit: boolean }

/** Splits text into pieces so the typed words can be marked. Ignores capitals. */
export function highlight(text: string, query: string): Part[] {
  const q = clean(query)
  if (!q || !text) return [{ text, hit: false }]
  const low = text.toLowerCase()
  const parts: Part[] = []
  let at = 0
  for (;;) {
    const i = low.indexOf(q, at)
    if (i < 0) break
    if (i > at) parts.push({ text: text.slice(at, i), hit: false })
    parts.push({ text: text.slice(i, i + q.length), hit: true })
    at = i + q.length
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false })
  return parts
}
