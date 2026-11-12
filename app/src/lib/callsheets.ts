import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { levelFor, type Bundle } from './project'
import { DEPARTMENT_ORDER } from './sections'
import type { CrewRow } from './castcrew'
import type { Scene } from './types'
import { headingParts, matchCast, type ShootDay } from './schedule'

export interface CallSheet { id: string; project_id: string; day_id: string; rev_no: number; published_at: string | null; published_by: string | null; created_at: string }
export interface SheetDraft { sheet_id: string; general_call: string; hospital: string; notes: string; updated_at: string }
export interface SheetRevision { id: string; sheet_id: string; rev_no: number; snapshot: SheetSnapshot; note: string; published_by: string | null; published_at: string }

export interface SnapScene { id: string; number: string; heading: string; ie: string; tod: string; pages: string; partial?: string; cast: string[] }
export interface SnapCast { id: string; character: string; actor: string; call: string; makeup: string }
export interface SnapPerson { id: string; name: string; role: string; call: string }
export interface SnapCrew { department: string; people: SnapPerson[] }
export interface SheetSnapshot {
  v: 1; project: string; schedule: string; day_no: number; day_count: number; date: string; location: string
  general_call: string; hospital: string; notes: string
  scenes: SnapScene[]; cast: SnapCast[]; crew: SnapCrew[]
}

/** Edit access on Call sheets: the team's edit level plus HOD or an edit grant. Owner and admins always. */
export const canEditSheets = (b: Bundle) => levelFor(b, 'call_sheets') === 'edit'

export function useCallSheets(pid: string | undefined, editor: boolean) {
  return useQuery({
    queryKey: ['callsheets', pid, editor],
    enabled: Boolean(pid),
    refetchInterval: 20_000,
    queryFn: async () => {
      const [s, r, d] = await Promise.all([
        supabase.from('call_sheets').select('*').eq('project_id', pid!),
        supabase.from('call_sheet_revisions').select('*').eq('project_id', pid!).order('rev_no'),
        editor ? supabase.from('call_sheet_drafts').select('*').eq('project_id', pid!) : Promise.resolve({ data: [], error: null }),
      ])
      for (const x of [s, r, d]) if (x.error) throw x.error
      const revisions = new Map<string, SheetRevision[]>()
      for (const x of r.data as SheetRevision[]) revisions.set(x.sheet_id, [...(revisions.get(x.sheet_id) ?? []), x])
      return {
        sheets: new Map((s.data as CallSheet[]).map((x) => [x.day_id, x])),
        revisions,
        drafts: new Map(((d.data ?? []) as SheetDraft[]).map((x) => [x.sheet_id, x])),
      }
    },
  })
}

export interface SnapshotInput {
  project: string; schedule: string; days: ShootDay[]; day: ShootDay
  draft: Pick<SheetDraft, 'general_call' | 'hospital' | 'notes'>
  scenes: Scene[]                                   // the scenes of the day, in order
  sceneInfo: (s: Scene) => { pages: string; cast: string[] }
  partialOf?: (s: Scene) => string                   // for example "2 of 3 shots" when only some shots are on this day
  castRows: CrewRow[]; crewRows: CrewRow[]
  sceneLabel: (s: Scene) => string
}

/** Everything a call sheet shows, gathered from the shoot day, the breakdown and the cast and crew list. */
export function buildSnapshot(i: SnapshotInput): SheetSnapshot {
  const scenes: SnapScene[] = i.scenes.map((s) => {
    const hp = headingParts(s.heading); const info = i.sceneInfo(s)
    return { id: s.id, number: i.sceneLabel(s), heading: s.heading, ie: hp.ie, tod: hp.tod, pages: info.pages, partial: i.partialOf?.(s) ?? '', cast: info.cast }
  })
  const names: string[] = []
  for (const s of scenes) for (const n of s.cast) if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n)
  const cast: SnapCast[] = []
  const seen = new Set<string>()
  for (const n of names) {
    const rows = matchCast(n, i.castRows)
    if (rows.length) for (const r of rows) { if (!seen.has(r.id)) { seen.add(r.id); cast.push({ id: r.id, character: r.role, actor: r.name, call: r.call_time, makeup: r.makeup_time }) } }
    else cast.push({ id: 'name:' + n.toLowerCase(), character: n, actor: '', call: '', makeup: '' })
  }
  const byDept = new Map<string, SnapPerson[]>()
  for (const r of i.crewRows) {
    if (r.kind !== 'crew' || (!r.name && !r.account_id)) continue
    const dept = r.department || 'Crew'
    byDept.set(dept, [...(byDept.get(dept) ?? []), { id: r.id, name: r.name || 'Not named', role: r.role, call: r.call_time }])
  }
  const order = (d: string) => { const k = DEPARTMENT_ORDER.indexOf(d); return k < 0 ? 99 : k }
  const crew = [...byDept.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([department, people]) => ({ department, people: people.sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)) }))
  return {
    v: 1, project: i.project, schedule: i.schedule, day_no: i.days.findIndex((d) => d.id === i.day.id) + 1, day_count: i.days.length,
    date: i.day.day_date, location: i.day.location, general_call: i.draft.general_call, hospital: i.draft.hospital, notes: i.draft.notes, scenes, cast, crew,
  }
}

export interface SheetDiff { changed: Set<string>; removed: { scenes: string[]; cast: string[]; crew: string[] } }
export const NO_DIFF: SheetDiff = { changed: new Set(), removed: { scenes: [], cast: [], crew: [] } }

/** JSON with the keys in a fixed order. The database stores jsonb with its own key order, so plain JSON.stringify would call equal lines different. */
export function stable(x: unknown): string {
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']'
  if (x && typeof x === 'object') return '{' + Object.keys(x as object).sort().map((k) => JSON.stringify(k) + ':' + stable((x as Record<string, unknown>)[k])).join(',') + '}'
  return JSON.stringify(x) ?? 'null'
}

/** Which lines differ from the previous version. Keys: date, location, general_call, hospital, notes, scene:<id>, cast:<id>, crew:<id>. */
export function diffSnapshots(prev: SheetSnapshot | null | undefined, next: SheetSnapshot): SheetDiff {
  if (!prev) return NO_DIFF
  const changed = new Set<string>()
  for (const k of ['date', 'location', 'general_call', 'hospital', 'notes'] as const) if (prev[k] !== next[k]) changed.add(k)
  const sig = stable
  const pScenes = new Map(prev.scenes.map((s) => [s.id, s])), nScenes = new Map(next.scenes.map((s) => [s.id, s]))
  for (const s of next.scenes) { const p = pScenes.get(s.id); if (!p || sig(p) !== sig(s)) changed.add('scene:' + s.id) }
  const pCast = new Map(prev.cast.map((c) => [c.id, c])), nCast = new Map(next.cast.map((c) => [c.id, c]))
  for (const c of next.cast) { const p = pCast.get(c.id); if (!p || sig(p) !== sig(c)) changed.add('cast:' + c.id) }
  const pPeople = new Map(prev.crew.flatMap((d) => d.people.map((p) => [p.id, { ...p, department: d.department }] as const)))
  const nPeople = new Map(next.crew.flatMap((d) => d.people.map((p) => [p.id, { ...p, department: d.department }] as const)))
  for (const [id, p] of nPeople) { const o = pPeople.get(id); if (!o || sig(o) !== sig(p)) changed.add('crew:' + id) }
  return {
    changed,
    removed: {
      scenes: prev.scenes.filter((s) => !nScenes.has(s.id)).map((s) => `${s.number} ${s.heading}`),
      cast: prev.cast.filter((c) => !nCast.has(c.id)).map((c) => c.character),
      crew: [...pPeople.entries()].filter(([id]) => !nPeople.has(id)).map(([, p]) => p.name),
    },
  }
}
export const diffCount = (d: SheetDiff) => d.changed.size + d.removed.scenes.length + d.removed.cast.length + d.removed.crew.length
