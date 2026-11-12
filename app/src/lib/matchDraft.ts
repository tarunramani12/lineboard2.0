// Matching a new draft to the scenes already in the project. Pure functions: the screen shows the
// result, the owner can change any match, and only then is the plan sent to the database.
import type { Element } from './fountain'
import type { ImportedScene } from './importScript'

export interface OldScene {
  id: string; number: string | null; heading: string; status: 'active' | 'omitted'; elements: Element[]
}
export type MatchHow = 'number' | 'heading' | 'similar'
export interface Match { oldId: string; how: MatchHow }
export type CutChoice = 'omit' | 'remove' | 'keep'

export function normalizeHeading(h: string): string {
  return h.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}
const words = (s: string) => new Set(normalizeHeading(s).split(' ').filter(Boolean))
function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0
  let n = 0
  for (const x of a) if (b.has(x)) n++
  return n / (a.size + b.size - n)
}
const lineSet = (els: Element[]) => new Set(els.map((e) => e.text.trim().toLowerCase()).filter(Boolean))

/** How alike two scenes are, from 0 to 1: the better of heading words and script lines. */
export function similarity(oldS: OldScene, neu: ImportedScene): number {
  const h = jaccard(words(oldS.heading), words(neu.heading))
  const t = oldS.elements.length >= 2 && neu.elements.length >= 2 ? jaccard(lineSet(oldS.elements), lineSet(neu.elements)) : 0
  return Math.max(h, t * 0.95)
}

/** Match by number first, then by heading, then by how alike the scenes are. New scene key -> old scene. */
export function autoMatch(old: OldScene[], neu: ImportedScene[]): Map<number, Match> {
  const out = new Map<number, Match>()
  const usedOld = new Set<string>()

  // 1. the same scene number
  for (const n of neu) {
    if (!n.number) continue
    const o = old.find((x) => x.number === n.number && !usedOld.has(x.id))
    if (o) { out.set(n.key, { oldId: o.id, how: 'number' }); usedOld.add(o.id) }
  }
  // 2. the same heading, in order (a heading that appears twice pairs first with first, second with second)
  const free = () => neu.filter((n) => !out.has(n.key) && !n.omitted && normalizeHeading(n.heading))
  const byHeading = new Map<string, OldScene[]>()
  for (const o of old) {
    if (usedOld.has(o.id) || o.status === 'omitted') continue
    const k = normalizeHeading(o.heading)
    if (!k) continue
    byHeading.set(k, [...(byHeading.get(k) ?? []), o])
  }
  for (const n of free()) {
    const list = byHeading.get(normalizeHeading(n.heading))
    const o = list?.shift()
    if (o) { out.set(n.key, { oldId: o.id, how: 'heading' }); usedOld.add(o.id) }
  }
  // 3. scenes that are alike: a renamed heading with the same lines, or a lightly changed heading
  const pairs: { n: ImportedScene; o: OldScene; s: number }[] = []
  for (const n of neu) {
    if (out.has(n.key) || n.omitted) continue
    for (const o of old) {
      if (usedOld.has(o.id) || o.status === 'omitted') continue
      const s = similarity(o, n)
      if (s >= 0.7) pairs.push({ n, o, s })
    }
  }
  pairs.sort((a, b) => b.s - a.s)
  for (const p of pairs) {
    if (out.has(p.n.key) || usedOld.has(p.o.id)) continue
    out.set(p.n.key, { oldId: p.o.id, how: 'similar' }); usedOld.add(p.o.id)
  }
  return out
}

export const sameElements = (a: Element[], b: Element[]) =>
  a.length === b.length && a.every((e, i) => e.kind === b[i].kind && e.text === b[i].text)

export interface DiffLine { change: 'same' | 'add' | 'del'; el: Element }
/** Line by line: what stayed, what was added and what was taken out. */
export function diffElements(a: Element[], b: Element[]): DiffLine[] {
  const key = (e: Element) => `${e.kind}|${e.text}`
  const n = a.length, m = b.length
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = key(a[i]) === key(b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: DiffLine[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (key(a[i]) === key(b[j])) { out.push({ change: 'same', el: b[j] }); i++; j++ }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ change: 'del', el: a[i++] })
    else out.push({ change: 'add', el: b[j++] })
  }
  while (i < n) out.push({ change: 'del', el: a[i++] })
  while (j < m) out.push({ change: 'add', el: b[j++] })
  return out
}

export type PlanItem =
  | { op: 'update'; id: string; heading: string; elements: { kind: string; text: string }[] }
  | { op: 'insert'; number: string | null; heading: string; elements: { kind: string; text: string }[] }
  | { op: 'keep' | 'omit' | 'remove'; id: string }

export interface PlanSummary { updated: number; unchanged: number; inserted: number; omitted: number; removed: number; kept: number }

export function defaultCut(o: OldScene, locked: boolean): CutChoice {
  return o.status === 'omitted' ? 'keep' : locked ? 'omit' : 'remove'
}

const els = (e: Element[]) => e.map((x) => ({ kind: x.kind, text: x.text }))

/**
 * The plan in final script order. matches: new scene key -> old scene id (null = a new scene).
 * Old scenes that nothing matched are cut (omitted when locked, removed when not) unless the owner keeps them.
 */
export function buildPlan(
  old: OldScene[], neu: ImportedScene[], matches: Map<number, string | null>, cuts: Map<string, CutChoice>, locked: boolean,
): { plan: PlanItem[]; summary: PlanSummary } {
  const included = neu.filter((n) => n.include)
  const matchedOld = new Map<string, number>() // old id -> new key
  for (const n of included) { const id = matches.get(n.key); if (id) matchedOld.set(id, n.key) }
  const oldById = new Map(old.map((o) => [o.id, o]))
  const takenNumbers = new Set(old.map((o) => o.number).filter(Boolean) as string[])

  const summary: PlanSummary = { updated: 0, unchanged: 0, inserted: 0, omitted: 0, removed: 0, kept: 0 }
  const items = new Map<number, PlanItem>()
  for (const n of included) {
    const oid = matches.get(n.key) ?? null
    const heading = n.heading.trim().toUpperCase()
    if (oid) {
      const o = oldById.get(oid)!
      if (n.omitted) { items.set(n.key, { op: 'omit', id: oid }); summary.omitted++ } else {
        items.set(n.key, { op: 'update', id: oid, heading, elements: els(n.elements) })
        if (sameElements(o.elements, n.elements) && normalizeHeading(o.heading) === normalizeHeading(heading) && o.status === 'active') summary.unchanged++
        else summary.updated++
      }
    } else if (!n.omitted) {
      // after the lock a new scene is numbered by its place, unless the file brings a number that is free
      let number: string | null = null
      if (locked && n.number && !takenNumbers.has(n.number)) { number = n.number; takenNumbers.add(n.number) }
      items.set(n.key, { op: 'insert', number, heading, elements: els(n.elements) })
      summary.inserted++
    }
  }

  // old scenes the new draft does not have: cut, kept, or already omitted. Keep them near where they were.
  const anchor = new Map<number | 'start', PlanItem[]>()
  const removals: PlanItem[] = []
  old.forEach((o, idx) => {
    if (matchedOld.has(o.id)) return
    const choice = cuts.get(o.id) ?? defaultCut(o, locked)
    if (choice === 'remove' && !locked) { removals.push({ op: 'remove', id: o.id }); summary.removed++; return }
    const item: PlanItem = { op: choice === 'omit' && o.status === 'active' ? 'omit' : 'keep', id: o.id }
    if (item.op === 'omit') summary.omitted++; else summary.kept++
    let at: number | 'start' = 'start'
    for (let k = idx - 1; k >= 0; k--) { const key = matchedOld.get(old[k].id); if (key !== undefined && items.has(key)) { at = key; break } }
    anchor.set(at, [...(anchor.get(at) ?? []), item])
  })

  const plan: PlanItem[] = [...(anchor.get('start') ?? [])]
  for (const n of included) {
    const it = items.get(n.key)
    if (it) plan.push(it)
    plan.push(...(anchor.get(n.key) ?? []))
  }
  plan.push(...removals)
  return { plan, summary }
}
