import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { levelFor, type Bundle } from './project'
import type { CrewRow } from './castcrew'
import { LINES_PER_PAGE } from './fountain'

export interface Schedule { id: string; project_id: string; name: string; start_date: string; end_date: string; notes: string; created_at: string; locked: boolean; locked_by: string | null; locked_at: string | null }
export interface ShootDay { id: string; project_id: string; schedule_id: string; day_date: string; location: string; notes: string }
export interface Placement { schedule_id: string; scene_id: string; project_id: string; day_id: string; sort_order: number }
export interface ShotPlacement { schedule_id: string; shot_id: string; project_id: string; day_id: string; sort_order: number }
export interface Unavailable { id: string; project_id: string; row_id: string; on_date: string; note: string }

export function useScheduleData(pid: string | undefined) {
  return useQuery({
    queryKey: ['schedule', pid],
    enabled: Boolean(pid),
    refetchInterval: 20_000,
    queryFn: async () => {
      const [s, d, p, u, sp] = await Promise.all([
        supabase.from('schedules').select('*').eq('project_id', pid!),
        supabase.from('shoot_days').select('*').eq('project_id', pid!),
        supabase.from('schedule_scenes').select('*').eq('project_id', pid!),
        supabase.from('cast_unavailable').select('*').eq('project_id', pid!),
        supabase.from('schedule_shots').select('*').eq('project_id', pid!),
      ])
      for (const r of [s, d, p, u]) if (r.error) throw r.error
      // Until the shot-days table exists in the database, every shot simply follows its scene.
      const shotRows = sp.error && /schedule_shots|42P01/.test(`${sp.error.message} ${sp.error.code}`) ? [] : (() => { if (sp.error) throw sp.error; return sp.data as ShotPlacement[] })()
      return {
        schedules: (s.data as Schedule[]).sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name)),
        days: (d.data as ShootDay[]).sort((a, b) => a.day_date.localeCompare(b.day_date)),
        placements: (p.data as Placement[]).sort((a, b) => a.sort_order - b.sort_order),
        shotPlacements: shotRows,
        unavailable: (u.data as Unavailable[]).sort((a, b) => a.on_date.localeCompare(b.on_date)),
      }
    },
  })
}

/** Edit access on Schedule: the team's edit level plus HOD or an edit grant. Owner and admins always. */
export const canEditSchedule = (b: Bundle) => levelFor(b, 'schedule') === 'edit'

/** "INT. KITCHEN - NIGHT" gives interior or exterior and the time of day, for the strip. */
export function headingParts(heading: string): { ie: 'INT' | 'EXT' | 'INT/EXT' | ''; tod: string } {
  const h = heading.trim().toUpperCase().replace(/^\./, '')
  const ie = /^(INT\.?\/EXT|INT\.?\/EXT\.|I\/E)/.test(h) ? 'INT/EXT' : /^INT\b/.test(h) ? 'INT' : /^EXT\b/.test(h) ? 'EXT' : ''
  const tail = h.split(/\s[-–—]\s/).slice(1).join(' - ').trim()
  const m = tail.match(/\b(DAWN|MORNING|DAY|AFTERNOON|DUSK|EVENING|NIGHT|LATER|CONTINUOUS|SAME)\b/)
  return { ie, tod: m ? m[1] : '' }
}

/** Page length in eighths of a page, the way a stripboard shows it: "1 3/8". */
export function pageLength(lines: number): string {
  const eighths = Math.max(1, Math.round((lines / LINES_PER_PAGE) * 8))
  const whole = Math.floor(eighths / 8), rest = eighths % 8
  if (!whole) return `${rest}/8`
  return rest ? `${whole} ${rest}/8` : String(whole)
}
export const eighthsOf = (lines: number) => Math.max(1, Math.round((lines / LINES_PER_PAGE) * 8))
export function eighthsLabel(e: number): string {
  const whole = Math.floor(e / 8), rest = e % 8
  if (!whole) return `${rest}/8`
  return rest ? `${whole} ${rest}/8` : String(whole)
}

const utc = (iso: string) => new Date(iso + 'T00:00:00Z')
export const toIso = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (iso: string, n: number) => toIso(new Date(utc(iso).getTime() + n * 86_400_000))
export function formatDate(iso: string, long = false): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', ...(long ? { year: 'numeric' } : {}) }).format(utc(iso))
}
export function formatRange(a: string, b: string): string {
  const f = (x: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(utc(x))
  return a === b ? f(a) : `${f(a)} to ${f(b)}`
}
/** The next date inside the schedule that has no shoot day yet, or null when every date is used. */
export function nextFreeDate(s: Pick<Schedule, 'start_date' | 'end_date'>, taken: string[]): string | null {
  const used = new Set(taken)
  const last = taken.length ? [...taken].sort().at(-1)! : null
  for (const from of [last ? addDays(last, 1) : s.start_date, s.start_date]) {
    for (let d = from; d <= s.end_date; d = addDays(d, 1)) if (!used.has(d)) return d
  }
  return null
}

/** Order of the scenes on one day after moving `id` to `index` (or removing it when day is null). */
export function placeAt(current: string[], id: string, index: number): string[] {
  const rest = current.filter((x) => x !== id)
  const i = Math.max(0, Math.min(index, rest.length))
  return [...rest.slice(0, i), id, ...rest.slice(i)]
}

/** Which cast rows a name in the breakdown points at: by character or by actor, ignoring case. */
export function matchCast(name: string, cast: CrewRow[]): CrewRow[] {
  const n = name.trim().toLowerCase()
  return n ? cast.filter((r) => r.kind === 'cast' && (r.role.trim().toLowerCase() === n || r.name.trim().toLowerCase() === n)) : []
}

// ---- Shots on their own days. A shot follows its scene unless it has a placement of its own.
export interface DayEntry { scene_id: string; shot_ids: string[]; whole: boolean }
interface ShotLite { id: string; scene_id: string; position: number }

/** The day a shot is shot on in this schedule: its own placement, else the day of its scene, else none. */
export function shotDayId(shot: ShotLite, placements: Placement[], shotPlacements: ShotPlacement[]): string | null {
  return shotPlacements.find((x) => x.shot_id === shot.id)?.day_id ?? placements.find((p) => p.scene_id === shot.scene_id)?.day_id ?? null
}

/** What is shot on a day: scenes placed there (with the shots that really are on this day) and scenes that only have some shots here. */
export function dayEntries(dayId: string, placements: Placement[], shotPlacements: ShotPlacement[], shots: ShotLite[]): DayEntry[] {
  const out: DayEntry[] = []
  const bySceneShots = new Map<string, string[]>()
  for (const sh of [...shots].sort((a, b) => a.position - b.position)) {
    if (shotDayId(sh, placements, shotPlacements) === dayId) bySceneShots.set(sh.scene_id, [...(bySceneShots.get(sh.scene_id) ?? []), sh.id])
  }
  const whole = placements.filter((p) => p.day_id === dayId).sort((a, b) => a.sort_order - b.sort_order)
  for (const p of whole) out.push({ scene_id: p.scene_id, shot_ids: bySceneShots.get(p.scene_id) ?? [], whole: true })
  const seen = new Set(whole.map((p) => p.scene_id))
  for (const [scene_id, ids] of bySceneShots) if (!seen.has(scene_id)) out.push({ scene_id, shot_ids: ids, whole: false })
  return out
}

/** Scenes that appear on at least one shoot day, either placed whole or through some of their shots. */
export function scenesOnAnyDay(placements: Placement[], shotPlacements: ShotPlacement[], shots: ShotLite[]): Set<string> {
  const set = new Set(placements.map((p) => p.scene_id))
  const byId = new Map(shots.map((s) => [s.id, s.scene_id]))
  for (const sp of shotPlacements) { const sc = byId.get(sp.shot_id); if (sc) set.add(sc) }
  return set
}
