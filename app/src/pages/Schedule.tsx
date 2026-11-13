import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { navState, type Ctx } from '../components/ProjectLayout'
import { Badge, Banner, Choice, Dialog as TitleDialog, EmptyState, Icon, Permission, SceneChip, useAction } from '../components/ui'
import { useBreakdown } from '../lib/breakdown'
import { canEditCrewFor, displayName, useCastCrew, type CrewRow } from '../lib/castcrew'
import { estimateLines } from '../lib/fountain'
import { friendlyError } from '../lib/errors'
import { levelFor, useScenes } from '../lib/project'
import {
  addDays, canEditSchedule, dayEntries, scenesOnAnyDay, eighthsLabel, eighthsOf, formatDate, formatRange, headingParts, matchCast, nextFreeDate, placeAt, useScheduleData,
  type Schedule, type ShootDay,
} from '../lib/schedule'
import { useSceneTexts } from '../lib/script'
import { shotLabel, sizeName, useShots } from '../lib/shots'
import { armRowDrag } from '../lib/dragGate'
import { SECTIONS } from '../lib/sections'
import { supabase } from '../lib/supabase'
import { ReportButton } from '../components/ReportButton'
import { buildReportPdf, fileSafe } from '../lib/reportPdf'
import { scheduleReport } from '../lib/reports'
import type { Scene } from '../lib/types'

const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : friendlyError(e))
const LAST_KEY = 'lineboard.schedule.'

function Dialog({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="lb-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="lb-dialog" role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>
  )
}

/** Every date from first to last, optionally leaving out Saturdays and Sundays. */
function datesBetween(a: string, b: string, skipWeekends: boolean): string[] {
  const out: string[] = []
  for (let d = a; d <= b && out.length < 401; d = addDays(d, 1)) {
    const wd = new Date(d + 'T00:00:00Z').getUTCDay()
    if (!(skipWeekends && (wd === 0 || wd === 6))) out.push(d)
  }
  return out
}

function ScheduleDialog({ pid, sched, days, usedDayIds, onClose, onSaved, onDeleted }: { pid: string; sched: Schedule | null; days: ShootDay[]; usedDayIds: Set<string>; onClose: () => void; onSaved: (id: string) => void; onDeleted: () => void }) {
  const [skipWeekends, setSkipWeekends] = useState(false)
  const [name, setName] = useState(sched?.name ?? '')
  const [start, setStart] = useState(sched?.start_date ?? '')
  const [end, setEnd] = useState(sched?.end_date ?? '')
  const [notes, setNotes] = useState(sched?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  async function save() {
    if (!name.trim()) { setError('Give the schedule a name.'); return }
    if (!start || !end) { setError('Choose a start date and an end date.'); return }
    if (end < start) { setError('The end date cannot be before the start date.'); return }
    setBusy(true); setError(null)
    try {
      const body = { name: name.trim(), start_date: start, end_date: end, notes }
      let id: string
      if (sched) {
        // Days that fall outside the new dates go, if nothing is placed on them. Dates that are new get a shoot day.
        const outside = days.filter((d) => d.day_date < start || d.day_date > end)
        const busyDays = outside.filter((d) => usedDayIds.has(d.id))
        if (busyDays.length) throw new Error(`Scenes are placed on ${busyDays.map((d) => formatDate(d.day_date)).join(', ')}. Move them to another day first, or keep those dates in the schedule.`)
        if (outside.length) { const { error: e0 } = await supabase.from('shoot_days').delete().in('id', outside.map((d) => d.id)); if (e0) throw e0 }
        const { error: e } = await supabase.from('schedules').update(body).eq('id', sched.id)
        if (e) throw e
        id = sched.id
        const have = new Set(days.map((d) => d.day_date))
        const fresh = datesBetween(start, end, skipWeekends).filter((d) => !have.has(d))
        if (fresh.length) { const { error: e2 } = await supabase.from('shoot_days').insert(fresh.map((day_date) => ({ project_id: pid, schedule_id: sched.id, day_date }))); if (e2) throw e2 }
      } else {
        const { data, error: e } = await supabase.from('schedules').insert({ project_id: pid, ...body }).select('id').single()
        if (e) throw e
        id = data.id as string
        const all = datesBetween(start, end, skipWeekends)
        if (all.length) { const { error: e2 } = await supabase.from('shoot_days').insert(all.map((day_date) => ({ project_id: pid, schedule_id: id, day_date }))); if (e2) throw e2 }
      }
      onSaved(id)
      onClose()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  async function remove() {
    if (!sched) return
    setBusy(true); setError(null)
    try {
      const { data, error: e } = await supabase.from('schedules').delete().eq('id', sched.id).select('id')
      if (e) throw e
      if (!data?.length) throw new Error('You do not have permission to do that.')
      onDeleted(); onClose()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog label={sched ? 'Edit schedule' : 'New schedule'} onClose={onClose}>
      <h2 className="lb-heading" style={{ margin: 0 }}>{sched ? 'Edit schedule' : 'New schedule'}</h2>
      <div className="lb-field"><label htmlFor="sc-name">Name</label><input id="sc-name" className="lb-input" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Block 1" /></div>
      <div className="lb-shotgrid">
        <div className="lb-field"><label htmlFor="sc-start">First day</label><input id="sc-start" type="date" className="lb-input" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="lb-field"><label htmlFor="sc-end">Last day</label><input id="sc-end" type="date" className="lb-input" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} /></div>
      </div>
      <label className="lb-check" style={{ minHeight: 44 }}><input type="checkbox" checked={skipWeekends} onChange={(e) => setSkipWeekends(e.target.checked)} /><span>Leave out Saturdays and Sundays</span></label>
      <p className="lb-caption">{sched ? 'Dates added to the schedule get a shoot day automatically. Days with no scenes that fall outside the new dates are removed.' : 'A shoot day is made for every date from the first to the last day. Delete the days you will not shoot, and then place scenes on the days.'}</p>
      <div className="lb-field"><label htmlFor="sc-notes">Notes</label><textarea id="sc-notes" className="lb-input lb-textarea" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      {error && <p className="lb-error" role="alert">{error}</p>}
      <div className="lb-actions" style={{ justifyContent: 'space-between' }}>
        <span>{sched && <button className="lb-btn lb-btn--danger" disabled={busy} onClick={() => (confirm ? void remove() : setConfirm(true))}>{confirm ? 'Really delete this schedule' : 'Delete'}</button>}</span>
        <span className="lb-row"><button className="lb-btn" onClick={onClose}>Cancel</button><button className="lb-btn lb-btn--primary" disabled={busy} onClick={save}>{busy ? 'Saving' : sched ? 'Save' : 'Create schedule'}</button></span>
      </div>
      {confirm && <p className="lb-caption">Deleting removes its shoot days and the placement of every scene. The scenes themselves stay.</p>}
    </Dialog>
  )
}

function UnavailableDialog({ pid, cast, onClose, onSaved, canEditRow }: { pid: string; cast: CrewRow[]; onClose: () => void; onSaved: () => void; canEditRow: (r: CrewRow) => boolean }) {
  const choices = cast.filter(canEditRow)
  const [row, setRow] = useState(choices[0]?.id ?? '')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    if (!row) { setError('Choose a cast member.'); return }
    if (!from) { setError('Choose the date.'); return }
    const last = to || from
    if (last < from) { setError('The last date cannot be before the first.'); return }
    const dates: string[] = []
    for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= last && dates.length < 60; d = new Date(d.getTime() + 86_400_000)) dates.push(d.toISOString().slice(0, 10))
    setBusy(true); setError(null)
    try {
      const { error: e } = await supabase.from('cast_unavailable').upsert(dates.map((on_date) => ({ project_id: pid, row_id: row, on_date, note: note.trim() })), { onConflict: 'row_id,on_date' })
      if (e) throw e
      onSaved(); onClose()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog label="Mark cast unavailable" onClose={onClose}>
      <h2 className="lb-heading" style={{ margin: 0 }}>Mark cast unavailable</h2>
      {choices.length === 0 ? <p>There is no cast member you can mark. Add cast in Cast and crew first.</p> : (
        <>
          <div className="lb-field"><label htmlFor="un-row">Cast member</label>
            <select id="un-row" className="lb-input" value={row} onChange={(e) => setRow(e.target.value)}>{choices.map((r) => <option key={r.id} value={r.id}>{castLabel(r)}</option>)}</select></div>
          <div className="lb-shotgrid">
            <div className="lb-field"><label htmlFor="un-from">From</label><input id="un-from" type="date" className="lb-input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="lb-field"><label htmlFor="un-to">To (optional)</label><input id="un-to" type="date" className="lb-input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          <div className="lb-field"><label htmlFor="un-note">Reason (optional)</label><input id="un-note" className="lb-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Other job" /></div>
        </>
      )}
      {error && <p className="lb-error" role="alert">{error}</p>}
      <div className="lb-actions"><button className="lb-btn" onClick={onClose}>Cancel</button>{choices.length > 0 && <button className="lb-btn lb-btn--primary" disabled={busy} onClick={save}>{busy ? 'Saving' : 'Mark unavailable'}</button>}</div>
    </Dialog>
  )
}

const castLabel = (r: CrewRow) => (displayName(r) && r.role ? `${r.role} (${displayName(r)})` : r.role || displayName(r) || 'Unnamed')

/** Lock or unlock a schedule. Locked means finished and shared with everyone who can open the Schedule; nothing in it changes until it is unlocked. */
function LockDialog({ sched, onClose, onDone }: { sched: Schedule; onClose: () => void; onDone: () => void }) {
  const act = useAction()
  async function go() {
    const ok = await act.run(async () => {
      const { data, error } = await supabase.from('schedules').update({ locked: !sched.locked }).eq('id', sched.id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('You do not have permission to do that.')
      return true
    }, (e) => (e instanceof Error && !('code' in e) ? e.message : friendlyError(e)))
    if (ok) { onDone(); onClose() }
  }
  return (
    <TitleDialog title={sched.locked ? 'Unlock this schedule?' : 'Lock this schedule?'} onClose={onClose} badge={<Badge kind={sched.locked ? 'conflict' : 'locked'}>{sched.locked ? 'Becomes a draft' : 'Shared and frozen'}</Badge>}>
      {sched.locked
        ? <p>The schedule becomes a draft again. People who only see locked schedules stop seeing it until it is locked again, and the production team can change it.</p>
        : <p>Everyone who can open the Schedule will see it, including the cast and crew. Nobody can change it, and it cannot be deleted, until it is unlocked.</p>}
      {act.error && <p className="lb-error" role="alert">{act.error}</p>}
      <div className="lb-actions">
        <button className="lb-btn" onClick={onClose}>Cancel</button>
        <button className={'lb-btn ' + (sched.locked ? 'lb-btn--danger' : 'lb-btn--primary')} disabled={act.busy} onClick={go}>{sched.locked ? 'Unlock schedule' : 'Lock schedule'}</button>
      </div>
    </TitleDialog>
  )
}

export default function SchedulePage() {
  const { b, pid } = useOutletContext<Ctx>()
  const qc = useQueryClient()
  const def = SECTIONS.find((s) => s.path === 'schedule')!
  const st = navState(b, def)
  const level = levelFor(b, 'schedule')
  const canEditAny = canEditSchedule(b)   // may edit the Schedule section; a locked schedule is still not editable by anyone
  const data = useScheduleData(pid)
  const scenesQ = useScenes(pid)
  const bd = useBreakdown(pid)
  const crewQ = useCastCrew(pid, false)
  const active = useMemo(() => (scenesQ.data ?? []).filter((s) => s.status === 'active'), [scenesQ.data])
  const texts = useSceneTexts(pid, useMemo(() => active.map((s) => s.id), [active]))
  const schedules = useMemo(() => data.data?.schedules ?? [], [data.data])
  const [chosen, setChosen] = useState<string>(() => { try { return localStorage.getItem(LAST_KEY + pid) ?? '' } catch { return '' } })
  const sched = schedules.find((s) => s.id === chosen) ?? schedules[0]
  const locked = Boolean(sched?.locked)
  const editor = canEditAny && !locked
  const [dialog, setDialog] = useState<'new' | 'edit' | 'unavailable' | 'lock' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newDate, setNewDate] = useState('')
  const [drag, setDrag] = useState<{ id: string; day: string | null; before: string | null } | null>(null)
  const [openDel, setOpenDel] = useState<string | null>(null)
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['schedule', pid] }) }
  function choose(id: string) { setChosen(id); try { localStorage.setItem(LAST_KEY + pid, id) } catch { /* private window */ } }

  const days = useMemo(() => (data.data?.days ?? []).filter((d) => d.schedule_id === sched?.id), [data.data, sched?.id])
  const placements = useMemo(() => (data.data?.placements ?? []).filter((p) => p.schedule_id === sched?.id), [data.data, sched?.id])
  const sceneById = useMemo(() => new Map(active.map((s) => [s.id, s])), [active])
  const byDay = useMemo(() => {
    const m = new Map<string, Scene[]>(days.map((d) => [d.id, []]))
    for (const p of placements) { const s = sceneById.get(p.scene_id); if (s) m.get(p.day_id)?.push(s) }
    return m
  }, [days, placements, sceneById])
  const allShots = useShots(pid).data ?? []
  const shotPl = useMemo(() => (data.data?.shotPlacements ?? []).filter((p) => p.schedule_id === sched?.id), [data.data, sched?.id])
  const placed = new Set(placements.map((p) => p.scene_id))
  const shotsOf = (sceneId: string) => allShots.filter((x) => x.scene_id === sceneId)
  const hasOwnDay = (shotId: string) => shotPl.some((p) => p.shot_id === shotId)
  const unscheduled = active.filter((s) => !placed.has(s.id) && (shotsOf(s.id).length === 0 || shotsOf(s.id).some((x) => !hasOwnDay(x.id))))
  const present = scenesOnAnyDay(placements, shotPl, allShots)
  /** Scenes that are on a day only because some of their shots are. */
  const partialByDay = useMemo(() => new Map(days.map((d) => [d.id, dayEntries(d.id, placements, shotPl, allShots).filter((e) => !e.whole)])), [days, placements, shotPl, allShots])
  const [openShots, setOpenShots] = useState<Set<string>>(new Set())
  const cast = useMemo(() => (crewQ.data?.rows ?? []).filter((r) => r.kind === 'cast'), [crewQ.data])
  const unavail = useMemo(() => data.data?.unavailable ?? [], [data.data])
  const unavailKey = useMemo(() => new Set(unavail.map((u) => u.row_id + '|' + u.on_date)), [unavail])
  const locations = useMemo(() => {
    const fromBreakdown = [...(bd.data?.forms.values() ?? [])].map((f) => f.location).filter(Boolean)
    const fromDays = (data.data?.days ?? []).map((d) => d.location).filter(Boolean)
    return [...new Set([...fromBreakdown, ...fromDays])].sort((a, b) => a.localeCompare(b))
  }, [bd.data, data.data])

  const sceneInfo = (s: Scene) => {
    const hp = headingParts(s.heading)
    const els = texts.data?.get(s.id)?.elements
    const pages = els ? eighthsOf(estimateLines(s.heading, els)) : null
    const names = (bd.data?.items ?? []).filter((i) => i.scene_id === s.id && i.category === 'cast').map((i) => i.name)
    return { ...hp, pages, names }
  }
  const conflictsFor = (s: Scene, date: string) => {
    const names = sceneInfo(s).names
    const rows = names.flatMap((n) => matchCast(n, cast))
    return [...new Set(rows.filter((r) => unavailKey.has(r.id + '|' + date)).map((r) => r.role || displayName(r)))]
  }
  const allConflicts = days.flatMap((d) => [...(byDay.get(d.id) ?? []), ...(partialByDay.get(d.id) ?? []).map((e) => sceneById.get(e.scene_id)).filter((x): x is Scene => Boolean(x))].flatMap((s) => conflictsFor(s, d.day_date).map((c) => ({ day: d, scene: s, who: c }))))

  const head = (
    <div className="lb-page-head">
      <h1 className="lb-title">Schedule</h1>
      {st.locked ? <Permission level="locked" why="No access" /> : <Permission level={level === 'edit' ? 'edit' : 'view'} />}
    </div>
  )
  if (st.locked) {
    return (
      <>
        {head}
        <EmptyState title="Schedule is not open to your team" action={levelFor(b, 'schedule') === 'edit' ? undefined : <Link className="lb-btn" to="../team">Open Team and access</Link>}>The admin can change this in Team and access.</EmptyState>
      </>
    )
  }

  async function addDay(date: string) {
    if (!sched || !date) return
    setError(null)
    const { error: e } = await supabase.from('shoot_days').insert({ project_id: pid, schedule_id: sched.id, day_date: date })
    if (e) { setError(errText(e)); return }
    setNewDate(''); refresh()
  }
  async function patchDay(d: ShootDay, patch: Partial<ShootDay>) {
    setError(null)
    const { error: e } = await supabase.from('shoot_days').update(patch).eq('id', d.id)
    if (e) setError(errText(e))
    refresh()
  }
  async function deleteDay(d: ShootDay) {
    setError(null); setOpenDel(null)
    const { error: e } = await supabase.from('shoot_days').delete().eq('id', d.id)
    if (e) setError(errText(e))
    refresh()
  }
  /** Put a scene on a day (or take it off with day = null), before the scene `before`, or at the end. */
  async function moveScene(sceneId: string, dayId: string | null, before: string | null = null) {
    if (!sched) return
    setError(null)
    if (!dayId) {
      const { error: e } = await supabase.from('schedule_scenes').delete().eq('schedule_id', sched.id).eq('scene_id', sceneId)
      if (e) setError(errText(e))
      refresh(); return
    }
    const current = (byDay.get(dayId) ?? []).map((s) => s.id)
    const rest = current.filter((x) => x !== sceneId)
    const idx = before ? rest.indexOf(before) : rest.length
    const order = placeAt(current, sceneId, idx < 0 ? rest.length : idx)
    if (order.join() === current.join()) return
    const { error: e1 } = await supabase.from('schedule_scenes').upsert({ schedule_id: sched.id, scene_id: sceneId, project_id: pid, day_id: dayId, sort_order: order.indexOf(sceneId) * 10 }, { onConflict: 'schedule_id,scene_id' })
    if (e1) { setError(errText(e1)); refresh(); return }
    const others = order.filter((x) => x !== sceneId)
    const r = await Promise.all(others.map((id) => supabase.from('schedule_scenes').update({ sort_order: order.indexOf(id) * 10 }).eq('schedule_id', sched.id).eq('scene_id', id)))
    const bad = r.find((x) => x.error)?.error
    if (bad) setError(errText(bad))
    refresh()
  }
  /** Send one shot to a day of its own, or back to following its scene (day = null). */
  async function setShotDay(shotId: string, sceneId: string, dayId: string | null) {
    if (!sched) return
    setError(null)
    const sceneDay = placements.find((p) => p.scene_id === sceneId)?.day_id ?? null
    if (!dayId || dayId === sceneDay) {
      const { error: e } = await supabase.from('schedule_shots').delete().eq('schedule_id', sched.id).eq('shot_id', shotId)
      if (e) setError(errText(e))
    } else {
      const { error: e } = await supabase.from('schedule_shots').upsert({ schedule_id: sched.id, shot_id: shotId, project_id: pid, day_id: dayId, sort_order: 0 }, { onConflict: 'schedule_id,shot_id' })
      if (e) setError(errText(e))
    }
    refresh()
  }
  async function shift(s: Scene, dayId: string, dir: -1 | 1) {
    const list = (byDay.get(dayId) ?? []).map((x) => x.id)
    const i = list.indexOf(s.id)
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const target = dir === -1 ? list[j] : list[j + 1] ?? null
    await moveScene(s.id, dayId, target)
  }
  function beginDrag(el: HTMLElement, pointerId: number, s: Scene) {
    if (!editor) return
    try { el.setPointerCapture(pointerId) } catch { /* the pointer already ended */ }
    let state = { id: s.id, day: null as string | null, before: null as string | null }
    setDrag(state)
    const find = (ev: PointerEvent) => {
      const under = document.elementFromPoint(ev.clientX, ev.clientY)
      const strip = under?.closest<HTMLElement>('[data-strip]')
      if (strip && strip.dataset.strip !== s.id && strip.dataset.day) {
        const r = strip.getBoundingClientRect()
        const day = strip.dataset.day
        if (ev.clientY <= r.top + r.height / 2) return { day, before: strip.dataset.strip! }
        const rest = (byDay.get(day) ?? []).map((x) => x.id).filter((x) => x !== s.id)
        return { day, before: rest[rest.indexOf(strip.dataset.strip!) + 1] ?? null }
      }
      const zone = under?.closest<HTMLElement>('[data-zone]')
      if (zone) return { day: zone.dataset.zone === 'none' ? null : zone.dataset.zone!, before: null as string | null }
      return { day: undefined as string | null | undefined, before: null as string | null }
    }
    const done = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel) }
    const move = (ev: PointerEvent) => { const f = find(ev); state = { id: s.id, day: f.day ?? null, before: f.before }; setDrag(f.day === undefined ? { id: s.id, day: null, before: null } : state) }
    const up = (ev: PointerEvent) => {
      done(); const f = find(ev); setDrag(null)
      if (f.day === undefined) return
      void moveScene(s.id, f.day, f.before)
    }
    const cancel = () => { done(); setDrag(null) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', cancel)
  }

  const nextDate = sched ? nextFreeDate(sched, days.map((d) => d.day_date)) : null
  const pagesTotal = (list: Scene[]) => list.reduce((n, s) => n + (sceneInfo(s).pages ?? 0), 0)

  const lab = (s: Scene) => s.display_number ?? String((scenesQ.data ?? []).indexOf(s) + 1)
  const strip = (s: Scene, day: ShootDay | null, idx: number, count: number, entry?: { ids: string[]; whole: boolean }) => {
    const info = sceneInfo(s)
    const partial = Boolean(entry && !entry.whole)
    const sceneShots = shotsOf(s.id)
    const key = `${s.id}:${day?.id ?? ''}`
    const here = entry ? entry.ids.length : 0
    const sceneDayId = placements.find((p) => p.scene_id === s.id)?.day_id ?? null
    const dayOptions = days.map((d, i) => <option key={d.id} value={d.id}>Day {i + 1} · {formatDate(d.day_date)}</option>)
    const clash = day ? conflictsFor(s, day.day_date) : []
    const cls = 'lb-sstrip' + (info.ie ? ' lb-sstrip--' + (info.ie === 'INT/EXT' ? 'ie' : info.ie.toLowerCase()) : '') + (drag?.id === s.id ? ' is-dragging' : '')
      + (drag && drag.before === s.id ? ' drop-before' : '')
    return (
      <div key={key} className={cls + (partial ? ' is-partial' : '') + (editor && !partial ? ' is-draggable' : '')} data-strip={partial ? undefined : s.id} data-day={day?.id ?? ''}
        onPointerDown={(e) => armRowDrag(e, (el, id) => beginDrag(el, id, s), editor && !partial)}>
        {editor && !partial && <button className="lb-btn lb-btn--sm lb-btn--quiet lb-grip" aria-label={`Drag scene ${lab(s)} to another place`} title="Drag to move" onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); beginDrag(e.currentTarget as HTMLElement, e.pointerId, s) }}><span aria-hidden="true">⋮⋮</span></button>}
        <SceneChip n={s.display_number} position={(scenesQ.data ?? []).indexOf(s) + 1} />
        <span className="lb-sstrip-main">
          <span className="lb-sstrip-head">{s.heading || 'No heading'}</span>
          <span className="lb-sstrip-meta">
            {info.ie && <span className="lb-stag">{info.ie}</span>}{info.tod && <span className="lb-stag">{info.tod}</span>}
            {info.pages !== null && <span className="lb-stag">{eighthsLabel(info.pages)} pg</span>}
            {info.names.length > 0 && <span className="lb-sstrip-cast">{info.names.slice(0, 4).join(', ')}{info.names.length > 4 ? ` +${info.names.length - 4}` : ''}</span>}
            {clash.length > 0 && <Badge kind="stale">{clash.join(', ')} unavailable</Badge>}
            {day && sceneShots.length > 0 && here < sceneShots.length && <span className="lb-stag">{here} of {sceneShots.length} shots</span>}
            {!day && sceneShots.length > 0 && sceneShots.some((x) => hasOwnDay(x.id)) && <span className="lb-stag">{sceneShots.filter((x) => !hasOwnDay(x.id)).length} of {sceneShots.length} shots not scheduled</span>}
          </span>
        </span>
        {editor && !partial && (
          <span className="lb-sstrip-act">
            {day && <>
              <button className="lb-btn lb-btn--sm lb-btn--quiet" aria-label={`Move scene ${lab(s)} up`} disabled={idx === 0} onClick={() => void shift(s, day.id, -1)}>↑</button>
              <button className="lb-btn lb-btn--sm lb-btn--quiet" aria-label={`Move scene ${lab(s)} down`} disabled={idx === count - 1} onClick={() => void shift(s, day.id, 1)}>↓</button>
            </>}
            <select className="lb-input lb-sstrip-sel" aria-label={`Day for scene ${lab(s)}`} value={day?.id ?? ''} onChange={(e) => void moveScene(s.id, e.target.value || null)}>
              <option value="">{day ? 'Not scheduled' : 'Choose a day'}</option>
              {dayOptions}
            </select>
          </span>
        )}
        {sceneShots.length > 0 && (
          <span className="lb-sstrip-shots">
            <button type="button" className="lb-btn lb-btn--sm lb-btn--quiet" aria-expanded={openShots.has(key)} onClick={() => setOpenShots((p) => { const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n })}>
              {openShots.has(key) ? 'Hide shots' : `Shots ${sceneShots.length}`}
            </button>
            {openShots.has(key) && sceneShots.map((x, n) => {
              const own = shotPl.find((p) => p.shot_id === x.id)?.day_id ?? ''
              return (
                <span key={x.id} className="lb-shotday">
                  <span className="lb-stag">{shotLabel(s, (scenesQ.data ?? []).indexOf(s), n + 1)}</span>
                  <span className="lb-shotday-text">{[sizeName(x.size), x.description].filter(Boolean).join(', ') || 'No description'}</span>
                  {editor ? (
                    <select className="lb-input lb-sstrip-sel" aria-label={`Day for shot ${shotLabel(s, (scenesQ.data ?? []).indexOf(s), n + 1)}`} value={own} onChange={(e) => void setShotDay(x.id, s.id, e.target.value || null)}>
                      <option value="">{sceneDayId ? `With the scene (Day ${days.findIndex((d) => d.id === sceneDayId) + 1})` : 'Not scheduled'}</option>
                      {dayOptions}
                    </select>
                  ) : <span className="lb-caption">{own ? `Day ${days.findIndex((d) => d.id === own) + 1}` : sceneDayId ? `With the scene` : 'Not scheduled'}</span>}
                </span>
              )
            })}
          </span>
        )}
      </div>
    )
  }

  return (
    <>
      {head}
      <p className="lb-caption lb-phone-hide">A schedule is a block of shoot days. A shoot day is made for every date in the schedule. Put each scene on the day it will be shot. Open a scene's shots to send some of them to a different day. Delete the days you will not shoot. Production and the AD team edit it by default. The admin can change that in Team and access.</p>
      {error && <p className="lb-error" role="alert">{error}</p>}
      <div className="lb-row">
        {schedules.length > 1 && (
          <select className="lb-input" style={{ width: 'auto', maxWidth: '100%' }} aria-label="Schedule" value={sched?.id ?? ''} onChange={(e) => choose(e.target.value)}>
            {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <span style={{ flex: 1 }} />
        {sched && (
          <ReportButton label="Download schedule PDF" file={`${fileSafe(b.project.name)}-schedule-${fileSafe(sched.name)}`}
            build={(size) => buildReportPdf(scheduleReport({ project: b.project.name, size, schedule: sched, days, placements, shotPlacements: shotPl, shots: allShots, scenes: scenesQ.data ?? [], castOf: (s) => sceneInfo(s).names, pagesOf: (s) => { const p = sceneInfo(s).pages; return p ? eighthsLabel(p) : '' } }))} />
        )}
        {sched && (locked ? <Badge kind="locked">Locked</Badge> : canEditAny ? <Badge kind="plain">Draft</Badge> : null)}
        {editor && sched && <button className="lb-btn" onClick={() => setDialog('edit')}><Icon name="pencil" /> Edit schedule</button>}
        {canEditAny && sched && <button className="lb-btn" onClick={() => setDialog('lock')}><Icon name="lock" /> {locked ? 'Unlock schedule' : 'Lock schedule'}</button>}
        {canEditAny && <button className="lb-btn lb-btn--primary" onClick={() => setDialog('new')}><Icon name="plus" /> New schedule</button>}
      </div>

      {data.isLoading && <p className="lb-caption" role="status">Loading the schedule…</p>}
      {!data.isLoading && !sched && <EmptyState title="No schedule yet">{canEditAny ? 'Create a schedule for a block of shoot days. A film with one shoot has one schedule.' : 'The production team shares the schedule here once it is locked.'}</EmptyState>}

      {sched && (
        <>
          <section className="lb-card lb-stack" style={{ padding: 16 }}>
            <div className="lb-spread">
              <div><h2 className="lb-heading" style={{ margin: 0 }}>{sched.name}</h2><span className="lb-caption">{formatRange(sched.start_date, sched.end_date)}</span></div>
              <span className="lb-row">
                <Badge kind="plain">{days.length} {days.length === 1 ? 'shoot day' : 'shoot days'}</Badge>
                <Badge kind="plain">{[...present].filter((id) => sceneById.has(id)).length} of {active.length} scenes placed</Badge>
              </span>
            </div>
            {sched.notes && <p className="lb-caption">{sched.notes}</p>}
          </section>
          {allConflicts.length > 0 && (
            <Banner lead={`${allConflicts.length} ${allConflicts.length === 1 ? 'scene is' : 'scenes are'} on a day when cast is unavailable.`}>
              {allConflicts.slice(0, 5).map((c) => `Scene ${lab(c.scene)} on ${formatDate(c.day.day_date)}: ${c.who}`).join('. ')}{allConflicts.length > 5 ? '. And more.' : '.'}
            </Banner>
          )}
          <div className="lb-sched">
            <aside className="lb-sched-side">
              <section className="lb-card lb-stack" style={{ padding: 16 }} data-zone="none" aria-label="Unscheduled scenes">
                <h2 className="lb-heading" style={{ margin: 0 }}>Not scheduled <span className="lb-muted">{unscheduled.length}</span></h2>
                {unscheduled.length === 0 && <p className="lb-caption">{active.length === 0 ? 'There are no scenes yet. Write or import a script first.' : 'Every scene is on a shoot day.'}</p>}
                {unscheduled.map((s, i) => strip(s, null, i, unscheduled.length))}
              </section>
            </aside>
            <div className="lb-sched-days">
              {days.length === 0 && <EmptyState title="No shoot days">{editor ? 'Every shoot day was deleted. Add one below, or edit the schedule dates.' : 'No shoot days have been added.'}</EmptyState>}
              {days.map((d, di) => {
                const list = byDay.get(d.id) ?? []
                const ent = new Map(dayEntries(d.id, placements, shotPl, allShots).map((e) => [e.scene_id, e]))
                return (
                  <section key={d.id} className={'lb-card lb-stack lb-day' + (drag && drag.day === d.id && !drag.before ? ' is-over' : '')} style={{ padding: 16 }} data-zone={d.id} aria-label={`Day ${di + 1}`}>
                    <div className="lb-spread">
                      <h2 className="lb-heading" style={{ margin: 0 }}>Day {di + 1} <span className="lb-muted">{formatDate(d.day_date, true)}</span></h2>
                      <span className="lb-row">
                        <span className="lb-caption">{list.length + (partialByDay.get(d.id) ?? []).length} {list.length + (partialByDay.get(d.id) ?? []).length === 1 ? 'scene' : 'scenes'}{pagesTotal(list) ? `, ${eighthsLabel(pagesTotal(list))} pages` : ''}</span>
                        {editor && (openDel === d.id
                          ? <><button className="lb-btn lb-btn--sm lb-btn--danger" onClick={() => void deleteDay(d)}>Really delete this day</button><button className="lb-btn lb-btn--sm" onClick={() => setOpenDel(null)}>Cancel</button></>
                          : <button className="lb-btn lb-btn--sm lb-btn--quiet" aria-label={`Delete day ${di + 1}`} onClick={() => setOpenDel(d.id)}>Delete day</button>)}
                      </span>
                    </div>
                    <div className="lb-shotgrid">
                      <div className="lb-field"><label htmlFor={`loc-${d.id}`}>Location</label>
                        {editor ? <Choice id={`loc-${d.id}`} noun="location" value={d.location} options={locations} maxLength={200} onChange={(v) => void patchDay(d, { location: v })} />
                          : <span className="lb-input lb-input--ro">{d.location || 'Not set'}</span>}</div>
                      <div className="lb-field"><label htmlFor={`dn-${d.id}`}>Notes</label>
                        {editor ? <DayNotes id={`dn-${d.id}`} value={d.notes} onSave={(v) => void patchDay(d, { notes: v })} /> : <span className="lb-input lb-input--ro">{d.notes || 'None'}</span>}</div>
                    </div>
                    {openDel === d.id && list.length > 0 && <p className="lb-caption">The {list.length} {list.length === 1 ? 'scene goes' : 'scenes go'} back to Not scheduled.</p>}
                    {list.length === 0 && (partialByDay.get(d.id) ?? []).length === 0 ? <p className="lb-caption lb-dropempty">{editor ? 'No scenes yet. Drag a scene here, or choose this day on a scene.' : 'No scenes on this day.'}</p> : (
                      <>
                        {list.map((s, i) => strip(s, d, i, list.length, { ids: ent.get(s.id)?.shot_ids ?? [], whole: true }))}
                        {(partialByDay.get(d.id) ?? []).map((e) => { const sc = sceneById.get(e.scene_id); return sc ? strip(sc, d, 0, 0, { ids: e.shot_ids, whole: false }) : null })}
                      </>
                    )}
                  </section>
                )
              })}
              {editor && (
                <section className="lb-card lb-row" style={{ padding: 16 }}>
                  {nextDate === null ? <span className="lb-caption">Every date in this schedule has a shoot day. To shoot on another date, edit the schedule dates. Delete a day you will not shoot with its Delete day button.</span> : (
                    <>
                      <div className="lb-field" style={{ flex: '0 1 220px' }}><label htmlFor="nd">Add a day you deleted</label><input id="nd" type="date" className="lb-input" min={sched.start_date} max={sched.end_date} value={newDate || nextDate} onChange={(e) => setNewDate(e.target.value)} /></div>
                      <button className="lb-btn lb-btn--primary" style={{ alignSelf: 'flex-end' }} onClick={() => void addDay(newDate || nextDate)}><Icon name="plus" /> Add shoot day</button>
                    </>
                  )}
                </section>
              )}
            </div>
          </div>

          <section className="lb-card lb-stack" style={{ padding: 16 }}>
            <div className="lb-spread"><h2 className="lb-heading" style={{ margin: 0 }}>Cast availability</h2>
              {(canEditAny || cast.some((r) => canEditCrewFor(b, r.team_id))) && <button className="lb-btn" onClick={() => setDialog('unavailable')}><Icon name="plus" /> Mark unavailable</button>}</div>
            {unavail.length === 0 ? <p className="lb-caption">No one is marked unavailable. When a scene is placed on a day a cast member cannot work, the strip and the top of this page say so.</p> : (
              <ul className="lb-unlist">
                {cast.filter((r) => unavail.some((u) => u.row_id === r.id)).map((r) => (
                  <li key={r.id}><strong>{castLabel(r)}</strong>
                    <span className="lb-row">{unavail.filter((u) => u.row_id === r.id).map((u) => (
                      <span key={u.id} className="lb-chipx" title={u.note}>{formatDate(u.on_date)}{u.note ? ` · ${u.note}` : ''}
                        {(canEditAny || canEditCrewFor(b, r.team_id)) && <button className="lb-btn lb-btn--sm lb-btn--quiet" aria-label={`Remove ${formatDate(u.on_date)} for ${castLabel(r)}`} onClick={async () => { const { error: e } = await supabase.from('cast_unavailable').delete().eq('id', u.id); if (e) setError(errText(e)); refresh() }}><Icon name="cross" /></button>}
                      </span>))}</span></li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {dialog === 'lock' && sched && <LockDialog sched={sched} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'new' && <ScheduleDialog pid={pid} sched={null} days={[]} usedDayIds={new Set()} onClose={() => setDialog(null)} onSaved={(id) => { choose(id); refresh() }} onDeleted={refresh} />}
      {dialog === 'edit' && sched && <ScheduleDialog pid={pid} sched={sched} days={days} usedDayIds={new Set(placements.map((p) => p.day_id))} onClose={() => setDialog(null)} onSaved={refresh} onDeleted={() => { choose(''); refresh() }} />}
      {dialog === 'unavailable' && <UnavailableDialog pid={pid} cast={cast} canEditRow={(r) => canEditAny || canEditCrewFor(b, r.team_id)} onClose={() => setDialog(null)} onSaved={refresh} />}
    </>
  )
}

function DayNotes({ id, value, onSave }: { id: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return <input id={id} className="lb-input" value={v} maxLength={500} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onSave(v) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
}
