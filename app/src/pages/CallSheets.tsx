import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { navState, type Ctx } from '../components/ProjectLayout'
import { Badge, Banner, EmptyState, Icon, Permission, SceneChip } from '../components/ui'
import { useBreakdown } from '../lib/breakdown'
import { useCastCrew } from '../lib/castcrew'
import { callSheetPdf } from '../lib/callsheetPdf'
import {
  NO_DIFF, buildSnapshot, canEditSheets, diffCount, diffSnapshots, useCallSheets, type SheetDiff, type SheetRevision, type SheetSnapshot,
} from '../lib/callsheets'
import { friendlyError } from '../lib/errors'
import { estimateLines } from '../lib/fountain'
import { levelFor, useScenes } from '../lib/project'
import { dayEntries, eighthsLabel, eighthsOf, formatDate, formatRange, shotDayId, useScheduleData } from '../lib/schedule'
import { useSceneTexts } from '../lib/script'
import { SECTIONS } from '../lib/sections'
import { STATUS_TEXT, canChangeStatus, shotLabel, sizeName, useShots, type ShotStatus } from '../lib/shots'
import { supabase } from '../lib/supabase'

const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : friendlyError(e))
const KEY = 'lineboard.callsheets.schedule.'
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

function Mark({ diff, k }: { diff: SheetDiff; k: string }) {
  return diff.changed.has(k) ? <span className="lb-chg" title="Changed since the previous revision">Changed</span> : null
}

export default function CallSheetsPage() {
  const { b, pid } = useOutletContext<Ctx>()
  const qc = useQueryClient()
  const def = SECTIONS.find((s) => s.path === 'callsheets')!
  const st = navState(b, def)
  const level = levelFor(b, 'call_sheets')
  const editor = canEditSheets(b)
  const [sp, setSp] = useSearchParams()
  const dayId = sp.get('day')
  const sched = useScheduleData(pid)
  const sheetsQ = useCallSheets(pid, editor)
  const scenesQ = useScenes(pid)
  const bd = useBreakdown(pid)
  const crewQ = useCastCrew(pid, false)
  const shotsQ = useShots(pid, true)
  const statusEd = canChangeStatus(b)
  async function setShotStatus(id: string, status: ShotStatus) {
    setError(null)
    const { error: e } = await supabase.from('shots').update({ status }).eq('id', id)
    if (e) setError(errText(e))
    void qc.invalidateQueries({ queryKey: ['shots', pid] })
  }
  const active = useMemo(() => (scenesQ.data ?? []).filter((s) => s.status === 'active'), [scenesQ.data])
  const texts = useSceneTexts(pid, useMemo(() => active.map((s) => s.id), [active]))
  const schedules = useMemo(() => sched.data?.schedules ?? [], [sched.data])
  const [chosen, setChosen] = useState<string>(() => { try { return localStorage.getItem(KEY + pid) ?? '' } catch { return '' } })
  const dayRow = (sched.data?.days ?? []).find((d) => d.id === dayId)
  const current = schedules.find((s) => s.id === (dayRow?.schedule_id ?? chosen)) ?? schedules[0]
  const days = useMemo(() => (sched.data?.days ?? []).filter((d) => d.schedule_id === current?.id), [sched.data, current?.id])
  const day = days.find((d) => d.id === dayId)
  const [view, setView] = useState<'live' | number>('live')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [edit, setEdit] = useState<{ general_call: string; hospital: string; notes: string } | null>(null)
  useEffect(() => { setView('live'); setEdit(null); setError(null) }, [dayId])
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['callsheets', pid] }) }
  function choose(id: string) { setChosen(id); try { localStorage.setItem(KEY + pid, id) } catch { /* private window */ } }

  const sheet = day ? sheetsQ.data?.sheets.get(day.id) : undefined
  const revs: SheetRevision[] = sheet ? sheetsQ.data?.revisions.get(sheet.id) ?? [] : []
  const latest = revs[revs.length - 1]
  const draft = sheet ? sheetsQ.data?.drafts.get(sheet.id) : undefined

  const entriesOfDay = (d: string) => dayEntries(d, sched.data?.placements ?? [], sched.data?.shotPlacements ?? [], shotsQ.data ?? [])
  const sceneIdsOfDay = (d: string) => entriesOfDay(d).map((e) => e.scene_id)
  const sceneInfo = (s: { id: string; heading: string }) => {
    const els = texts.data?.get(s.id)?.elements
    return {
      pages: els ? eighthsLabel(eighthsOf(estimateLines(s.heading, els))) : '',
      cast: (bd.data?.items ?? []).filter((i) => i.scene_id === s.id && i.category === 'cast').map((i) => i.name),
    }
  }
  const lab = (s: { id: string; display_number: string | null }) => s.display_number ?? String(active.findIndex((x) => x.id === s.id) + 1)
  const live: SheetSnapshot | null = useMemo(() => {
    if (!day || !current) return null
    const entries = dayEntries(day.id, sched.data?.placements ?? [], sched.data?.shotPlacements ?? [], shotsQ.data ?? [])
    const scenes = entries.map((e) => active.find((s) => s.id === e.scene_id)).filter((s): s is NonNullable<typeof s> => Boolean(s))
    const partialOf = (s: { id: string }) => { const e = entries.find((x) => x.scene_id === s.id); const all = (shotsQ.data ?? []).filter((x) => x.scene_id === s.id).length; return e && all > 0 && e.shot_ids.length < all ? `${e.shot_ids.length} of ${all} shots` : '' }
    const rows = crewQ.data?.rows ?? []
    return buildSnapshot({
      project: b.project.name, schedule: current.name, days, day, draft: { general_call: draft?.general_call ?? '', hospital: draft?.hospital ?? '', notes: draft?.notes ?? '' },
      scenes, sceneInfo, partialOf, castRows: rows.filter((r) => r.kind === 'cast'), crewRows: rows.filter((r) => r.kind === 'crew'), sceneLabel: lab,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, current, days, draft, active, sched.data, shotsQ.data, bd.data, crewQ.data, texts.data, b.project.name])

  const head = (
    <div className="lb-page-head">
      <h1 className="lb-title">Call sheets</h1>
      {st.locked ? <Permission level="locked" why="No access" /> : <Permission level={level === 'edit' ? 'edit' : 'view'} />}
    </div>
  )
  if (st.locked) {
    return (<>{head}<EmptyState title="Call sheets are not open to your team" action={levelFor(b, 'call_sheets') === 'edit' ? undefined : <Link className="lb-btn" to="../team">Open Team and access</Link>}>The admin can change this in Team and access.</EmptyState></>)
  }
  const nameOf = (uid: string | null) => b.people.find((p) => p.account_id === uid)?.name ?? ''

  // ---- the list of shoot days
  if (!day) {
    const published = (id: string) => sheetsQ.data?.sheets.get(id)
    const visible = days.filter((d) => editor || (published(d.id)?.rev_no ?? 0) > 0)
    return (
      <>
        {head}
        <p className="lb-caption">One call sheet for each shoot day. Production and the AD team write and publish it. Everyone with access to Call sheets reads the published version.</p>
        {!b.project.script_locked && editor && <Banner lead="The script is not locked.">Scene numbers can still change. Lock the script before you publish, so the sheet and the scenes agree.</Banner>}
        {schedules.length > 1 && (
          <div className="lb-row"><select className="lb-input" style={{ width: 'auto' }} aria-label="Schedule" value={current?.id ?? ''} onChange={(e) => choose(e.target.value)}>{schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        )}
        {sched.isLoading || sheetsQ.isLoading ? <p className="lb-caption" role="status">Loading</p> : !current ? (
          <EmptyState title="No schedule yet" action={<Link className="lb-btn lb-btn--primary" to="../schedule">Open Schedule</Link>}>A call sheet is made for a shoot day. Create a schedule and add shoot days first.</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState title={editor ? 'No shoot days yet' : 'No call sheets have been published yet'}>{editor ? 'Add shoot days in Schedule, then start a call sheet for each.' : 'When Production or the AD team publishes a call sheet it appears here.'}</EmptyState>
        ) : (
          <div className="lb-stack">
            <span className="lb-caption">{current.name}, {formatRange(current.start_date, current.end_date)}</span>
            {visible.map((d) => {
              const i = days.indexOf(d); const s = published(d.id); const rv = s ? sheetsQ.data?.revisions.get(s.id) : undefined
              const n = sceneIdsOfDay(d.id).length
              return (
                <button key={d.id} className="lb-card lb-csday" onClick={() => setSp({ day: d.id })}>
                  <span className="lb-stack" style={{ gap: 2, alignItems: 'flex-start', textAlign: 'left' }}>
                    <strong>Day {i + 1}  {formatDate(d.day_date, true)}</strong>
                    <span className="lb-caption">{d.location || 'No location'}, {n} {n === 1 ? 'scene' : 'scenes'}</span>
                  </span>
                  <span className="lb-row">
                    {!s ? <Badge kind="omitted">Not started</Badge> : s.rev_no === 0 ? <Badge kind="stale">Draft</Badge> : <Badge kind="revised">Revision {s.rev_no}</Badge>}
                    {s && s.rev_no > 0 && <span className="lb-caption">sent {when(s.published_at)}{rv?.length ? '' : ''}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </>
    )
  }

  // ---- one call sheet
  const showing: SheetSnapshot | null = view === 'live' ? (editor ? live : latest?.snapshot ?? null) : revs.find((r) => r.rev_no === view)?.snapshot ?? null
  const shownRev = view === 'live' ? (editor ? null : latest ?? null) : revs.find((r) => r.rev_no === view) ?? null
  const prevSnap = view === 'live' ? latest?.snapshot : revs.find((r) => r.rev_no === (view as number) - 1)?.snapshot
  const diff = !showing ? NO_DIFF : view === 'live' && !editor ? diffSnapshots(revs[revs.length - 2]?.snapshot, showing) : diffSnapshots(view === 'live' ? latest?.snapshot : prevSnap, showing)
  const unpublished = editor && live && latest ? diffCount(diffSnapshots(latest.snapshot, live)) : 0
  const dayShots = (shotsQ.data ?? []).filter((x) => shotDayId(x, sched.data?.placements ?? [], sched.data?.shotPlacements ?? []) === day.id)
  const counts = { planned: 0, done: 0, dropped: 0 }
  for (const x of dayShots) counts[x.status]++
  const dayNo = days.indexOf(day) + 1

  async function start() {
    setBusy(true); setError(null)
    try {
      const { data, error: e } = await supabase.from('call_sheets').insert({ project_id: pid, day_id: day!.id }).select('id').single()
      if (e) throw e
      const { error: e2 } = await supabase.from('call_sheet_drafts').insert({ sheet_id: data.id, project_id: pid })
      if (e2) throw e2
      refresh()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  async function saveDetails() {
    if (!sheet || !edit) return
    setBusy(true); setError(null)
    try {
      const { error: e } = await supabase.from('call_sheet_drafts').upsert({ sheet_id: sheet.id, project_id: pid, general_call: edit.general_call, hospital: edit.hospital.trim(), notes: edit.notes })
      if (e) throw e
      setEdit(null); refresh()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  async function publish() {
    if (!sheet || !live) return
    setBusy(true); setError(null)
    try {
      const { error: e } = await supabase.rpc('publish_call_sheet', { sid: sheet.id, snap: live, note_in: note.trim() })
      if (e) throw e
      setNote(''); refresh()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  async function pdf(size: 'a4' | 'letter') {
    if (!showing) return
    setBusy(true); setError(null)
    try {
      const rev = shownRev ?? (view === 'live' ? null : null)
      const blob = await callSheetPdf(showing, { size, rev: rev?.rev_no ?? sheet?.rev_no ?? 0, sentBy: nameOf(rev?.published_by ?? sheet?.published_by ?? null), sentAt: rev?.published_at ?? sheet?.published_at ?? null, diff, draft: !rev && !(view === 'live' && !editor) })
      const url = URL.createObjectURL(blob); const a = document.createElement('a')
      a.href = url; a.download = `call-sheet-day-${dayNo}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }

  const s = showing
  return (
    <>
      {head}
      <div className="lb-row"><button className="lb-btn" onClick={() => setSp({})}>All shoot days</button></div>
      {error && <p className="lb-error" role="alert">{error}</p>}
      {!sheet && !editor && <EmptyState title="This call sheet has not been published">When it is published it appears here.</EmptyState>}
      {!sheet && editor && (
        <EmptyState title="No call sheet for this day yet" action={<button className="lb-btn lb-btn--primary" disabled={busy} onClick={() => void start()}>Start the call sheet</button>}>
          It fills in from the shoot day, the breakdown and the cast and crew list. You add the general call, the nearest hospital and notes, then publish it.
        </EmptyState>
      )}
      {sheet && s && (
        <>
          <div className="lb-spread">
            <div>
              <h2 className="lb-heading" style={{ margin: 0 }}>Call sheet, shoot day {s.day_no} of {s.day_count}</h2>
              <span className="lb-caption">{formatDate(s.date, true)}, {s.schedule}</span>
            </div>
            <span className="lb-row">
              {shownRev ? <Badge kind="revised">Revision {shownRev.rev_no}</Badge> : <Badge kind="stale">{editor ? (latest ? 'Working copy' : 'Draft') : 'Draft'}</Badge>}
              {shownRev && <span className="lb-caption">{shownRev.rev_no > 1 ? 'changed lines marked, ' : ''}sent {when(shownRev.published_at)}{nameOf(shownRev.published_by) ? ` by ${nameOf(shownRev.published_by)}` : ''}</span>}
            </span>
          </div>
          {shownRev?.note && <p className="lb-caption">Note with this revision: {shownRev.note}</p>}

          {editor && view === 'live' && (
            <Banner lead={!latest ? 'Draft.' : unpublished ? `${unpublished} ${unpublished === 1 ? 'line has' : 'lines have'} changed since revision ${latest.rev_no}.` : `No changes since revision ${latest.rev_no}.`}>
              {!latest ? 'Nobody else can see this call sheet until you publish it.' : unpublished ? 'Changed lines are marked below. Publish to send a new revision.' : ''}
            </Banner>
          )}
          <div className="lb-row">
            {revs.length > 0 && (
              <select className="lb-input" style={{ width: 'auto' }} aria-label="Revision" value={String(view === 'live' && !editor ? latest!.rev_no : view)} onChange={(e) => setView(e.target.value === 'live' ? 'live' : Number(e.target.value))}>
                {editor && <option value="live">Working copy</option>}
                {[...revs].reverse().map((r) => <option key={r.id} value={r.rev_no}>Revision {r.rev_no}, {when(r.published_at)}</option>)}
              </select>
            )}
            <span style={{ flex: 1 }} />
            <button className="lb-btn" disabled={busy} onClick={() => void pdf('a4')}>Download PDF</button>
          </div>

          {editor && view === 'live' && (
            <section className="lb-card lb-stack" style={{ padding: 16 }} aria-label="Details">
              <div className="lb-spread"><h3 className="lb-heading" style={{ margin: 0 }}>Details you add</h3>{!edit && <button className="lb-btn lb-btn--sm" onClick={() => setEdit({ general_call: draft?.general_call ?? '', hospital: draft?.hospital ?? '', notes: draft?.notes ?? '' })}><Icon name="pencil" /> Edit details</button>}</div>
              {edit ? (
                <>
                  <div className="lb-shotgrid">
                    <div className="lb-field"><label htmlFor="cs-call">General crew call</label><input id="cs-call" type="time" className="lb-input" value={edit.general_call} onChange={(e) => setEdit({ ...edit, general_call: e.target.value })} /></div>
                    <div className="lb-field"><label htmlFor="cs-hosp">Nearest hospital</label><input id="cs-hosp" className="lb-input" maxLength={300} value={edit.hospital} onChange={(e) => setEdit({ ...edit, hospital: e.target.value })} placeholder="Name, address, phone" /></div>
                  </div>
                  <div className="lb-field"><label htmlFor="cs-notes">Notes</label><textarea id="cs-notes" className="lb-input lb-textarea" rows={3} maxLength={2000} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="Parking, catering, safety, anything the crew needs" /></div>
                  <div className="lb-row"><button className="lb-btn lb-btn--primary" disabled={busy} onClick={() => void saveDetails()}>Save details</button><button className="lb-btn" onClick={() => setEdit(null)}>Cancel</button></div>
                </>
              ) : <p className="lb-caption">The general call, nearest hospital and notes. The location comes from the shoot day, the scenes and cast from the schedule and breakdown, and the call times from Cast and crew.</p>}
            </section>
          )}

          <div className="lb-cs-cards">
            <section className="lb-card lb-stack" style={{ padding: 16 }}><span className="lb-label">General crew call <Mark diff={diff} k="general_call" /></span><span className="lb-bigtime">{s.general_call || <span className="lb-muted">Not set</span>}</span></section>
            <section className="lb-card lb-stack" style={{ padding: 16 }}><span className="lb-label">Location <Mark diff={diff} k="location" /></span><strong>{s.location || <span className="lb-muted">Not set</span>}</strong><span className="lb-caption">Date <Mark diff={diff} k="date" /> {formatDate(s.date, true)}</span></section>
            <section className="lb-card lb-stack" style={{ padding: 16 }}><span className="lb-label">Scenes of the day</span>
              <span className="lb-row">{s.scenes.length ? s.scenes.map((x) => <span key={x.id}><SceneChip n={x.number} /></span>) : <span className="lb-muted">None yet</span>}</span></section>
            <section className="lb-card lb-stack" style={{ padding: 16 }}><span className="lb-label">Nearest hospital <Mark diff={diff} k="hospital" /></span><strong>{s.hospital || <span className="lb-muted">Not set</span>}</strong></section>
          </div>

          <section className="lb-card lb-stack" style={{ padding: 16 }} aria-label="Scenes">
            <h3 className="lb-heading" style={{ margin: 0 }}>Scenes</h3>
            {s.scenes.length === 0 ? <p className="lb-caption">No scenes are on this shoot day.</p> : s.scenes.map((x) => (
              <div key={x.id} className={'lb-csrow' + (diff.changed.has('scene:' + x.id) ? ' is-changed' : '')}>
                <SceneChip n={x.number} />
                <span className="lb-stack" style={{ gap: 2 }}><strong>{x.heading || 'No heading'} <Mark diff={diff} k={'scene:' + x.id} /></strong>
                  <span className="lb-caption">{[x.ie, x.tod, x.pages && `${x.pages} pages`, x.partial, x.cast.length ? x.cast.join(', ') : ''].filter(Boolean).join('  ·  ')}</span></span>
              </div>
            ))}
            {diff.removed.scenes.length > 0 && <p className="lb-caption">Removed since the previous revision: {diff.removed.scenes.join('; ')}.</p>}
          </section>

          {dayShots.length > 0 && (
            <section className="lb-card lb-stack" style={{ padding: 16 }} aria-label="Shots of the day">
              <div className="lb-spread"><h3 className="lb-heading" style={{ margin: 0 }}>Shots of the day</h3><span className="lb-caption">{counts.done} done, {counts.dropped} dropped, {counts.planned} planned</span></div>
              {sceneIdsOfDay(day.id).map((sid) => {
                const sc = active.find((x) => x.id === sid); const list = dayShots.filter((x) => x.scene_id === sid)
                if (!sc || !list.length) return null
                const si = active.indexOf(sc)
                return (
                  <div key={sid} className="lb-stack" style={{ gap: 4 }}>
                    <span className="lb-row"><SceneChip n={sc.display_number} position={si + 1} /><strong>{sc.heading}</strong></span>
                    {list.map((x) => (
                      <div key={x.id} className={'lb-csshot' + (x.status === 'dropped' ? ' is-dropped' : '')}>
                        <Link to="../shots" className="lb-stag">{shotLabel(sc, si, (shotsQ.data ?? []).filter((y) => y.scene_id === sc.id).findIndex((y) => y.id === x.id) + 1)}</Link>
                        <Link to="../shots" className="lb-csshot-text">{[sizeName(x.size), x.description].filter(Boolean).join(', ') || 'No description'}</Link>
                        <span className="lb-row lb-csshot-end">
                          {x.vfx_required && <Badge kind="plain">VFX</Badge>}{x.special_effects && <Badge kind="plain">SFX</Badge>}{x.silent && <Badge kind="plain">SILENT</Badge>}
                          {statusEd ? (
                            <span className="lb-seg" role="group" aria-label={`Status of shot ${x.description || ''}`.trim()}>
                              {(['planned', 'done', 'dropped'] as ShotStatus[]).map((st) => <button key={st} type="button" aria-pressed={x.status === st} onClick={() => void setShotStatus(x.id, st)}>{STATUS_TEXT[st]}</button>)}
                            </span>
                          ) : <Badge kind={x.status === 'planned' ? 'stale' : 'plain'}>{STATUS_TEXT[x.status]}</Badge>}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </section>
          )}

          <section className="lb-card lb-stack" style={{ padding: 16 }} aria-label="Cast">
            <h3 className="lb-heading" style={{ margin: 0 }}>Cast</h3>
            {s.cast.length === 0 ? <p className="lb-caption">The breakdown lists no cast for these scenes.</p> : (
              <div className="lb-cstable">
                <span className="lb-th">Character</span><span className="lb-th">Actor</span><span className="lb-th">Make-up</span><span className="lb-th">Call</span>
                {s.cast.map((c) => (
                  <div key={c.id} className={'lb-csrow lb-csrow--table' + (diff.changed.has('cast:' + c.id) ? ' is-changed' : '')} style={{ display: 'contents' }}>
                    <span>{c.character} <Mark diff={diff} k={'cast:' + c.id} /></span><span>{c.actor || <span className="lb-muted">Not cast yet</span>}</span><span>{c.makeup || '–'}</span><span>{c.call || s.general_call || '–'}</span>
                  </div>
                ))}
              </div>
            )}
            {diff.removed.cast.length > 0 && <p className="lb-caption">Removed: {diff.removed.cast.join(', ')}.</p>}
          </section>

          <section className="lb-card lb-stack" style={{ padding: 16 }} aria-label="Crew">
            <h3 className="lb-heading" style={{ margin: 0 }}>Crew</h3>
            {s.crew.length === 0 ? <p className="lb-caption">No crew are listed yet. Add people in Cast and crew.</p> : s.crew.map((d) => (
              <div key={d.department} className="lb-stack" style={{ gap: 2 }}>
                <span className="lb-label">{d.department}</span>
                {d.people.map((p) => (
                  <div key={p.id} className={'lb-cscrew' + (diff.changed.has('crew:' + p.id) ? ' is-changed' : '')}>
                    <span>{p.role || <span className="lb-muted">No role</span>}</span><span>{p.name} <Mark diff={diff} k={'crew:' + p.id} /></span><span>{p.call || s.general_call || '–'}</span>
                  </div>
                ))}
              </div>
            ))}
            {diff.removed.crew.length > 0 && <p className="lb-caption">Removed: {diff.removed.crew.join(', ')}.</p>}
          </section>

          {(s.notes || diff.changed.has('notes')) && (
            <section className="lb-card lb-stack" style={{ padding: 16 }} aria-label="Notes"><h3 className="lb-heading" style={{ margin: 0 }}>Notes <Mark diff={diff} k="notes" /></h3><p style={{ whiteSpace: 'pre-wrap' }}>{s.notes}</p></section>
          )}

          {editor && view === 'live' && (
            <section className="lb-card lb-stack" style={{ padding: 16 }} aria-label="Publish">
              <h3 className="lb-heading" style={{ margin: 0 }}>{latest ? `Publish revision ${latest.rev_no + 1}` : 'Publish this call sheet'}</h3>
              <p className="lb-caption">Everyone with access to Call sheets will read this version. {latest ? 'Lines that changed from the last revision are marked.' : 'Nothing is sent by email yet. People open it here or download the PDF.'}</p>
              <div className="lb-field"><label htmlFor="cs-note">What changed (optional)</label><input id="cs-note" className="lb-input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Call moved to 06:30" /></div>
              <div className="lb-row"><button className="lb-btn lb-btn--primary" disabled={busy || (Boolean(latest) && unpublished === 0)} onClick={() => void publish()}>{latest ? `Publish revision ${latest.rev_no + 1}` : 'Publish'}</button>
                {latest && unpublished === 0 && <span className="lb-caption">Nothing has changed since revision {latest.rev_no}.</span>}</div>
              {!b.project.script_locked && <p className="lb-caption"><Icon name="warn" /> The script is not locked, so scene numbers can still change.</p>}
            </section>
          )}
        </>
      )}
    </>
  )
}
