import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { navState, type Ctx } from '../components/ProjectLayout'
import { Badge, Choice, EmptyState, Icon, ListPicker, Permission, SceneChip, SwipeRow, rowOpen } from '../components/ui'
import { useCastCrew } from '../lib/castcrew'
import { friendlyError } from '../lib/errors'
import { isOwnerOrAdmin, levelFor, useScenes } from '../lib/project'
import { revisionLabel } from '../lib/script'
import { SECTIONS } from '../lib/sections'
import { ReportButton } from '../components/ReportButton'
import { buildReportPdf, fileSafe } from '../lib/reportPdf'
import { shotsReport } from '../lib/reports'
import {
  FIELD_LABEL, LENSES, MOVEMENTS, SHOT_FIELDS, SHOT_TYPES, SIZES, STATUS_TEXT, canChangeStatus, canEditShotsAs, canEditShotsFor, emptyShot, sizeName,
  reorderChanges, shotLabel, slotAfter, teamsIEdit, useShots, type Shot, type ShotDraft, type ShotField, type ShotStatus,
} from '../lib/shots'
import { removeFolder } from '../lib/storyboard'
import { armRowDrag } from '../lib/dragGate'
import { FoldAll } from '../components/FoldAll'
import { useFolded } from '../lib/folded'
import { supabase } from '../lib/supabase'
import type { Scene } from '../lib/types'

/** A shape and a word, never colour alone. */
function StatusMark({ status }: { status: ShotStatus }) {
  return (
    <span className={'lb-shotstatus lb-shotstatus--' + status}>
      {status === 'done' ? <Icon name="check" /> : status === 'dropped' ? <Icon name="cross" /> : <span className="lb-ring" aria-hidden="true" />}
      {STATUS_TEXT[status]}
    </span>
  )
}

interface DialogProps {
  shot: Shot | null                 // null = a new shot
  scene: Scene
  sceneIndex: number
  inScene: Shot[]
  after: string | null              // for a new shot: place it after this one (null = at the end)
  onClose: () => void
  onSaved: () => void
  openShot: (id: string) => void
}

function ShotDialog({ shot: shot0, scene, sceneIndex, inScene, after, onClose, onSaved, openShot }: DialogProps) {
  const { b, pid } = useOutletContext<Ctx>()
  const [shot, setShot] = useState(() => (shot0 ? { ...shot0, size: sizeName(shot0.size) } : shot0))   // the version my changes are measured against; replaced when I merge
  const crewList = useCastCrew(pid, false).data?.rows ?? []
  const castOptions = [...new Map(crewList.filter((r) => r.kind === 'cast' && r.role).map((r) => [r.role.toLowerCase(), { value: r.role, label: r.name ? `${r.role} (${r.name})` : r.role }])).values()].sort((a, z) => a.label.localeCompare(z.label))
  const crewOptions = [...new Map(crewList.filter((r) => r.kind === 'crew' && (r.role || r.name)).map((r) => { const v = r.role || r.name; return [v.toLowerCase(), { value: v, label: r.role && r.name ? `${r.role} (${r.name})` : v }] })).values()].sort((a, z) => a.label.localeCompare(z.label))
  const mine = teamsIEdit(b)
  const allShots = useShots(pid).data
  const opts = (f: 'size' | 'shot_type' | 'lens' | 'movement', defaults: string[]) =>
    [...defaults, ...[...new Set((allShots ?? []).map((x) => (f === 'size' ? sizeName(x[f]) : x[f])).filter((v) => v && !defaults.includes(v)))].sort()]
  const [draft, setDraft] = useState<ShotDraft>(() => (shot ? Object.fromEntries(SHOT_FIELDS.map((f) => [f, shot[f]])) as ShotDraft : emptyShot()))
  const [teamId, setTeamId] = useState(shot?.team_id ?? mine[0]?.id ?? '')
  const [status, setStatus] = useState<ShotStatus>(shot?.status ?? 'planned')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [merge, setMerge] = useState<{ latest: Shot; fields: ShotField[]; pick: Record<string, 'mine' | 'theirs'> } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const ownerEd = shot ? canEditShotsFor(b, shot.team_id) : mine.length > 0
  const vfxEd = ownerEd || canEditShotsAs(b, 'VFX')
  const soundEd = ownerEd || canEditShotsAs(b, 'Sound')
  const statusEd = canChangeStatus(b)
  const nameOf = (uid: string | null) => b.people.find((p) => p.account_id === uid)?.name ?? 'Someone'
  const teamName = (id: string) => b.teams.find((t) => t.id === id)?.name ?? 'No team'
  const owningTeam = shot ? teamName(shot.team_id) : teamName(teamId)
  const index = shot ? inScene.findIndex((s) => s.id === shot.id) : -1
  const label = shot ? shotLabel(scene, sceneIndex, index + 1) : shotLabel(scene, sceneIndex, inScene.length + 1)
  const changed: Partial<ShotDraft> = {}
  if (shot) for (const f of SHOT_FIELDS) if (draft[f] !== shot[f]) (changed as Record<string, unknown>)[f] = draft[f]
  const teamChanged = shot ? teamId !== shot.team_id : false
  const statusChanged = shot ? status !== shot.status : status !== 'planned'
  const dirty = shot ? Object.keys(changed).length > 0 || teamChanged || statusChanged : true
  const set = <K extends keyof ShotDraft>(k: K, v: ShotDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const ro = (allowed: boolean) => !allowed || busy

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  async function save() {
    setBusy(true); setError(null)
    try {
      if (!shot) {
        if (!teamId) throw new Error('Choose the team that owns this shot.')
        let slot = slotAfter(inScene, after)
        if (slot.renumber) {
          await Promise.all(inScene.map((s, i) => supabase.from('shots').update({ position: (i + 1) * 10 }).eq('id', s.id)))
          const at = inScene.findIndex((s) => s.id === after)
          slot = { position: (at + 1) * 10 + 5, renumber: false }
        }
        const { error: e } = await supabase.from('shots').insert({ project_id: pid, scene_id: scene.id, team_id: teamId, position: slot.position, ...draft, status })
        if (e) throw e
      } else {
        const patch: Record<string, unknown> = { ...changed }
        if (teamChanged) patch.team_id = teamId
        if (statusChanged) patch.status = status
        const { data, error: e } = await supabase.from('shots').update(patch).eq('id', shot.id).eq('updated_at', shot.updated_at).select('id')
        if (e) throw e
        if (!data || data.length === 0) { await startMerge(); return }
      }
      onSaved(); onClose()
    } catch (e) { setError(e instanceof Error && !('code' in e) ? e.message : friendlyError(e)) } finally { setBusy(false) }
  }
  /** Someone saved first. Take their version as the base, keep my edits where they did not touch the same field, and ask about the rest. */
  async function startMerge() {
    if (!shot) return
    const { data: latest } = await supabase.from('shots').select('*').eq('id', shot.id).single()
    if (!latest) { setError('This shot no longer exists.'); return }
    const l = latest as Shot
    const clash: ShotField[] = []
    const next = { ...draft }
    for (const f of SHOT_FIELDS) {
      const mineChanged = draft[f] !== shot[f], theirsChanged = l[f] !== shot[f]
      if (!mineChanged) (next as Record<string, unknown>)[f] = l[f]
      else if (theirsChanged && draft[f] !== l[f]) clash.push(f)
    }
    if (!teamChanged) setTeamId(l.team_id)
    if (!statusChanged) setStatus(l.status)
    const who = nameOf(l.updated_by)
    if (clash.length === 0) {
      setDraft(next); setShot(l)
      setError(`${who} saved this shot first. Their changes are merged in with yours. Look it over and save again.`)
    } else {
      setDraft(next); setError(null)
      setMerge({ latest: l, fields: clash, pick: Object.fromEntries(clash.map((f) => [f, 'mine'])) })
    }
  }
  function applyMerge() {
    if (!merge) return
    const next = { ...draft }
    for (const f of merge.fields) if (merge.pick[f] === 'theirs') (next as Record<string, unknown>)[f] = merge.latest[f]
    setDraft(next); setShot(merge.latest); setMerge(null)
    setError('Your choices are in. Save again to finish.')
  }
  async function duplicate() {
    if (!shot) return
    setBusy(true); setError(null)
    try {
      let slot = slotAfter(inScene, shot.id)
      if (slot.renumber) {
        await Promise.all(inScene.map((s, i) => supabase.from('shots').update({ position: (i + 1) * 10 }).eq('id', s.id)))
        slot = { position: (index + 1) * 10 + 5, renumber: false }
      }
      const { error: e } = await supabase.from('shots').insert({
        project_id: pid, scene_id: scene.id, team_id: shot.team_id, position: slot.position,
        ...Object.fromEntries(SHOT_FIELDS.map((f) => [f, shot[f]])),
      })
      if (e) throw e
      onSaved(); onClose()
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  async function remove() {
    if (!shot) return
    setBusy(true); setError(null)
    try {
      await removeFolder(`${pid}/${shot.id}`).catch(() => undefined)   // its storyboard pictures
      const { data, error: e } = await supabase.from('shots').delete().eq('id', shot.id).select('id')
      if (e) throw e
      if (!data?.length) throw new Error('You do not have permission to do that.')
      onSaved(); onClose()
    } catch (e) { setError(e instanceof Error && !('code' in e) ? e.message : friendlyError(e)) } finally { setBusy(false) }
  }

  const prev = index > 0 ? inScene[index - 1] : null
  const next = index >= 0 && index < inScene.length - 1 ? inScene[index + 1] : null
  const field = (id: string, text: string, node: React.ReactNode, hint?: string) => (
    <div className="lb-field"><label htmlFor={id}>{text}</label>{node}{hint && <span className="lb-caption">{hint}</span>}</div>
  )

  return (
    <div className="lb-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="lb-dialog lb-dialog--wide" role="dialog" aria-modal="true" aria-label={shot ? `Shot ${label}` : 'New shot'}>
        <div className="lb-spread">
          <h2 className="lb-heading" style={{ margin: 0 }}>{shot ? `Shot ${label}` : `New shot in scene ${scene.display_number ?? sceneIndex + 1}`}</h2>
          <span className="lb-row">
            {shot && <button className="lb-btn lb-btn--sm" disabled={!prev || dirty} onClick={() => prev && openShot(prev.id)} aria-label="Previous shot"><span aria-hidden="true">←</span> Previous</button>}
            {shot && <button className="lb-btn lb-btn--sm" disabled={!next || dirty} onClick={() => next && openShot(next.id)} aria-label="Next shot">Next <span aria-hidden="true">→</span></button>}
          </span>
        </div>
        <p className="lb-caption">{scene.heading || 'No heading yet'} · owned by {owningTeam}
          {!ownerEd && shot ? ` · you cannot change this shot${vfxEd || soundEd ? ', only the fields of your team' : ''}` : ''}</p>

        {field('sh-desc', 'Description', <input id="sh-desc" className="lb-input" value={draft.description} maxLength={500} disabled={ro(ownerEd)} onChange={(e) => set('description', e.target.value)} placeholder="Wide of the kitchen, Anna at the sink" />)}
        <div className="lb-shotgrid">
          {field('sh-size', 'Shot size', <Choice id="sh-size" noun="shot size" value={draft.size} options={opts('size', SIZES)} disabled={ro(ownerEd)} onChange={(v) => set('size', v)} />)}
          {field('sh-type', 'Shot type', <Choice id="sh-type" noun="shot type" value={draft.shot_type} options={opts('shot_type', SHOT_TYPES)} disabled={ro(ownerEd)} onChange={(v) => set('shot_type', v)} />)}
          {field('sh-lens', 'Lens', <Choice id="sh-lens" noun="lens" value={draft.lens} options={opts('lens', LENSES)} disabled={ro(ownerEd)} onChange={(v) => set('lens', v)} />)}
          {field('sh-move', 'Movement', <Choice id="sh-move" noun="movement" value={draft.movement} options={opts('movement', MOVEMENTS)} disabled={ro(ownerEd)} onChange={(v) => set('movement', v)} />)}
        </div>
        {field('sh-action', 'Action', <textarea id="sh-action" className="lb-input lb-textarea" rows={3} value={draft.action} maxLength={3000} disabled={ro(ownerEd)} onChange={(e) => set('action', e.target.value)} />)}
        <div className="lb-shotgrid">
          {field('sh-cast', 'Cast needed', <ListPicker id="sh-cast" noun="character" value={draft.cast_needed} options={castOptions} disabled={ro(ownerEd)} onChange={(v) => set('cast_needed', v)} />, castOptions.length ? 'From Cast and crew.' : 'Add cast in Cast and crew to choose from a list.')}
          {field('sh-crew', 'Crew needed', <ListPicker id="sh-crew" noun="role" value={draft.crew_needed} options={crewOptions} disabled={ro(ownerEd)} onChange={(v) => set('crew_needed', v)} />, crewOptions.length ? 'From Cast and crew.' : 'Add crew in Cast and crew to choose from a list.')}
        </div>
        <div className="lb-shotgrid">
          {field('sh-vfx', 'VFX required', <textarea id="sh-vfx" className="lb-input lb-textarea" rows={2} value={draft.vfx_required} maxLength={1000} disabled={ro(vfxEd)} onChange={(e) => set('vfx_required', e.target.value)} />, ownerEd ? 'The VFX team can also fill this in.' : undefined)}
          {field('sh-sound', 'Sound effects required', <textarea id="sh-sound" className="lb-input lb-textarea" rows={2} value={draft.sound_required} maxLength={1000} disabled={ro(soundEd)} onChange={(e) => set('sound_required', e.target.value)} />, ownerEd ? 'The Sound team can also fill this in.' : undefined)}
        </div>
        {field('sh-fx', 'Special effects', <textarea id="sh-fx" className="lb-input lb-textarea" rows={2} value={draft.special_effects} maxLength={1000} disabled={ro(ownerEd)} onChange={(e) => set('special_effects', e.target.value)} />)}
        <label className="lb-radio"><input type="checkbox" checked={draft.silent} disabled={ro(ownerEd)} onChange={(e) => set('silent', e.target.checked)} /><span>Silent shot (no sound recorded)</span></label>
        {field('sh-notes', 'Notes', <textarea id="sh-notes" className="lb-input lb-textarea" rows={2} value={draft.notes} maxLength={3000} disabled={ro(ownerEd)} onChange={(e) => set('notes', e.target.value)} />)}

        <div className="lb-shotgrid">
          <div className="lb-field">
            <span className="lb-label">Owning team</span>
            {shot && !ownerEd ? <span className="lb-input lb-input--ro">{owningTeam}</span> : (
              <select className="lb-input" aria-label="Owning team" value={teamId} disabled={busy || (shot ? mine.length < 2 : mine.length < 2)} onChange={(e) => setTeamId(e.target.value)}>
                {(shot && !mine.some((t) => t.id === shot.team_id) ? [b.teams.find((t) => t.id === shot.team_id)!, ...mine] : mine).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
          <div className="lb-field">
            <span className="lb-label">Status</span>
            <div className="lb-seg" role="group" aria-label="Status">
              {(['planned', 'done', 'dropped'] as ShotStatus[]).map((s) => (
                <button key={s} type="button" aria-pressed={status === s} aria-current={status === s ? 'true' : undefined} disabled={busy || !statusEd} onClick={() => setStatus(s)}>{STATUS_TEXT[s]}</button>
              ))}
            </div>
          </div>
        </div>
        {shot && <p className="lb-caption">Added by {nameOf(shot.created_by)}. Last edited by {nameOf(shot.updated_by)} on {new Date(shot.updated_at).toLocaleString()}.</p>}

        {merge && (
          <div className="lb-merge" role="group" aria-label="Resolve changes" ref={(el) => el?.scrollIntoView({ block: 'nearest' })}>
            <p className="lb-error" role="alert">{nameOf(merge.latest.updated_by)} saved this shot while you were editing it, and you both changed these fields. Choose which to keep. Everything else is merged already.</p>
            {merge.fields.map((f) => (
              <fieldset key={f} className="lb-mergefield">
                <legend>{FIELD_LABEL[f]}</legend>
                {(['mine', 'theirs'] as const).map((w) => (
                  <label key={w} className="lb-radio">
                    <input type="radio" name={'merge-' + f} checked={merge.pick[f] === w} onChange={() => setMerge({ ...merge, pick: { ...merge.pick, [f]: w } })} />
                    <span><b>{w === 'mine' ? 'Yours' : `${nameOf(merge.latest.updated_by)}'s`}:</b> {String(w === 'mine' ? draft[f] : merge.latest[f]) || '(empty)'}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            <button type="button" className="lb-btn lb-btn--primary" onClick={applyMerge}>Use these choices</button>
          </div>
        )}
        {error && <p className="lb-error" role="alert">{error}</p>}
        <div className="lb-actions" style={{ justifyContent: 'space-between' }}>
          <span className="lb-row">
            {shot && ownerEd && <button className="lb-btn" disabled={busy} onClick={duplicate}>Duplicate</button>}
            {shot && ownerEd && <button className="lb-btn lb-btn--danger" disabled={busy} onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))}>{confirmDelete ? 'Really delete this shot' : 'Delete'}</button>}
          </span>
          <span className="lb-row">
            <button className="lb-btn" onClick={onClose}>Close</button>
            <button className="lb-btn lb-btn--primary" disabled={busy || Boolean(merge) || !dirty || (!shot && !ownerEd) || (shot ? !(ownerEd || vfxEd || soundEd || statusEd) : false)} onClick={save}>{busy ? 'Saving' : shot ? 'Save shot' : 'Add shot'}</button>
          </span>
        </div>
      </div>
    </div>
  )
}

export default function ShotList() {
  const { b, pid } = useOutletContext<Ctx>()
  const qc = useQueryClient()
  const scenesQ = useScenes(pid)
  const shotsQ = useShots(pid)
  const scenes = useMemo(() => scenesQ.data ?? [], [scenesQ.data])
  const shots = useMemo(() => shotsQ.data ?? [], [shotsQ.data])
  const def = SECTIONS.find((s) => s.path === 'shots')!
  const st = navState(b, def)
  const level = levelFor(b, 'shots')
  const canAdd = teamsIEdit(b).length > 0
  const [dlg, setDlg] = useState<{ shotId: string | null; sceneId: string; after: string | null } | null>(null)
  const [showOmitted, setShowOmitted] = useState<Set<string>>(new Set())
  const fold = useFolded(pid, 'shots')
  const [error, setError] = useState<string | null>(null)

  const bySceneId = useMemo(() => {
    const m = new Map<string, Shot[]>()
    for (const s of shots) m.set(s.scene_id, [...(m.get(s.scene_id) ?? []), s])
    return m
  }, [shots])
  const counts = { planned: 0, done: 0, dropped: 0 }
  for (const s of shots) counts[s.status]++
  const total = shots.length
  const [drag, setDrag] = useState<{ id: string; over: string | null; after: boolean } | null>(null)
  async function dropShot(s: Shot, overId: string | null, after: boolean) {
    const list = bySceneId.get(s.scene_id) ?? []
    if (!overId || overId === s.id) return
    const rest = list.filter((x) => x.id !== s.id)
    const oi = rest.findIndex((x) => x.id === overId)
    if (oi < 0) return
    const changes = reorderChanges(list, s.id, after ? oi + 1 : oi)
    if (!changes.length) return
    setError(null)
    const r = await Promise.all(changes.map((c) => supabase.from('shots').update({ position: c.position }).eq('id', c.id)))
    const err = r.find((x) => x.error)?.error
    if (err) setError(friendlyError(err))
    refresh()
  }
  function beginDrag(target: HTMLElement, pointerId: number, s: Shot) {
    try { target.setPointerCapture(pointerId) } catch { /* the pointer already ended */ }
    let state = { id: s.id, over: null as string | null, after: false }
    setDrag(state)
    const find = (ev: PointerEvent) => {
      const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-shot]')
      if (!row || row.dataset.scene !== s.scene_id) return { over: null, after: false }
      const r = row.getBoundingClientRect()
      return { over: row.dataset.shot!, after: ev.clientY > r.top + r.height / 2 }
    }
    const move = (ev: PointerEvent) => { state = { id: s.id, ...find(ev) }; setDrag(state) }
    const up = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', cancel)
      const f = find(ev); setDrag(null); void dropShot(s, f.over, f.after)
    }
    const cancel = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', cancel); setDrag(null) }
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', cancel)
  }
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['shots', pid] }) }
  const teamName = (id: string) => b.teams.find((t) => t.id === id)?.name ?? 'No team'

  async function move(s: Shot, dir: -1 | 1) {
    const list = bySceneId.get(s.scene_id) ?? []
    const i = list.findIndex((x) => x.id === s.id)
    const other = list[i + dir]
    if (!other) return
    setError(null)
    // swap the two places. If they are tied, space the scene out first so the move is real.
    const a = s.position === other.position ? i * 10 + 10 : s.position
    const c = s.position === other.position ? (i + dir) * 10 + 10 : other.position
    const r = await Promise.all([
      supabase.from('shots').update({ position: c }).eq('id', s.id),
      supabase.from('shots').update({ position: a }).eq('id', other.id),
    ])
    const err = r.find((x) => x.error)?.error
    if (err) setError(friendlyError(err))
    refresh()
  }

  const head = (
    <div className="lb-page-head">
      <h1 className="lb-title">Shot list</h1>
      {st.locked ? <Permission level="locked" why="No access" /> : <Permission level={level === 'edit' ? 'edit' : 'view'} />}
    </div>
  )
  if (st.locked) {
    return (
      <>
        {head}
        <EmptyState title="The shot list is not open to your team"
          action={isOwnerOrAdmin(b) ? <Link className="lb-btn" to="../team">Open Team and access</Link> : undefined}>
          The admin can change this in Team and access.
        </EmptyState>
      </>
    )
  }

  const dlgScene = dlg ? scenes.find((s) => s.id === dlg.sceneId) : undefined
  const dlgShot = dlg?.shotId ? shots.find((s) => s.id === dlg.shotId) ?? null : null
  return (
    <>
      {head}
      <div className="lb-row" style={{ justifyContent: 'space-between' }}>
        <FoldAll ids={scenes.filter((sc) => (bySceneId.get(sc.id)?.length ?? 0) > 0).map((sc) => sc.id)} fold={fold} />
        <ReportButton label="Download shot list PDF" file={fileSafe(b.project.name) + '-shot-list'} disabled={total === 0}
          build={(size) => buildReportPdf(shotsReport({ project: b.project.name, size, scenes: scenesQ.data ?? [], shots, teams: b.teams }))} />
      </div>
      <p className="lb-caption lb-phone-hide">Shots are grouped by scene and numbered scene then shot, such as 42-3. The team that owns a shot edits it. Only the AD team changes whether a shot is planned, done or dropped.</p>
      {total > 0 && (
        <div className="lb-shotprogress" aria-label="Progress">
          <span><b>{counts.done}</b> done · <b>{counts.dropped}</b> dropped · <b>{counts.planned}</b> planned</span>
          <span className="lb-meter" aria-hidden="true"><span style={{ width: `${(counts.done / total) * 100}%` }} /><span className="is-dropped" style={{ width: `${(counts.dropped / total) * 100}%` }} /></span>
        </div>
      )}
      {error && <p className="lb-error" role="alert">{error}</p>}
      {!scenesQ.isLoading && scenes.length === 0 && (
        <EmptyState title="No scenes yet" action={<Link className="lb-btn" to="../script">Open the Script</Link>}>Shots belong to scenes. Write or import the script first.</EmptyState>
      )}
      {scenes.length > 0 && (
        <div className="lb-sheet">
          <div className="lb-thead lb-shotrow lb-shothead">
            <span>Shot</span><span>Description</span><span>Size · movement</span><span>Lens</span><span>Team</span><span>Status</span><span />
          </div>
          {scenes.map((sc, si) => {
            const list = bySceneId.get(sc.id) ?? []
            const omitted = sc.status === 'omitted'
            if (omitted && !showOmitted.has(sc.id)) {
              if (!list.length) return null
              return (
                <div key={sc.id} className="lb-shotscene lb-shotscene--omitted">
                  <span>Scene {sc.display_number ?? si + 1} omitted · {list.length} {list.length === 1 ? 'shot' : 'shots'} kept for reference</span>
                  <button className="lb-btn lb-btn--sm" onClick={() => setShowOmitted((s) => new Set(s).add(sc.id))}>Show</button>
                </div>
              )
            }
            return (
              <section key={sc.id} className="lb-shotscene" aria-label={`Scene ${sc.display_number ?? si + 1}`}>
                <header className="lb-shotscene-head">
                  <button className="lb-fold" aria-expanded={fold.isOpen(sc.id)} onClick={() => fold.toggle(sc.id)}>
                    <Icon name="chev" />
                    <SceneChip n={sc.display_number} position={si + 1} omitted={omitted} />
                    <h2 className="lb-sp-h">{sc.heading || <span className="lb-muted">No heading yet</span>}</h2>
                    <span className="lb-caption lb-shotcount">{list.length} {list.length === 1 ? 'shot' : 'shots'}</span>
                  </button>
                  {sc.revised_in ? <Badge kind="conflict" ><Icon name="warn" /> Scene revised ({revisionLabel(sc.revised_in)}). Check these shots.</Badge> : null}
                  {canAdd && !omitted && <button className="lb-btn lb-btn--sm" onClick={() => setDlg({ shotId: null, sceneId: sc.id, after: null })}><Icon name="plus" /> Add shot</button>}
                </header>
                {fold.isOpen(sc.id) && (
                <>
                {list.length === 0 && <p className="lb-caption lb-shotempty">No shots yet.</p>}
                {list.map((s, i) => {
                  const editable = canEditShotsFor(b, s.team_id)
                  return (
                    <SwipeRow key={s.id} label={`shot ${shotLabel(sc, si, i + 1)}`} canDelete={editable && !omitted} confirmText="The shot and its storyboard picture are removed. This cannot be undone."
                      onDelete={async () => { await removeFolder(`${pid}/${s.id}`).catch(() => undefined); const { data, error: e } = await supabase.from('shots').delete().eq('id', s.id).select('id'); if (e) throw new Error(friendlyError(e)); if (!data?.length) throw new Error('You do not have permission to do that.'); refresh() }}>
                    <div data-shot={s.id} data-scene={sc.id}
                      className={'lb-shotrow lb-shot is-click' + (s.status === 'dropped' ? ' is-dropped' : '') + (editable ? '' : ' is-other')
                        + (drag?.id === s.id ? ' is-dragging' : '') + (drag?.over === s.id ? (drag.after ? ' drop-after' : ' drop-before') : '')}
                      {...rowOpen(() => setDlg({ shotId: s.id, sceneId: sc.id, after: null }))}
                      onPointerDown={(e) => armRowDrag(e, (el, id) => beginDrag(el, id, s), editable && !omitted)}>
                      <span className="lb-shotno">{shotLabel(sc, si, i + 1)}</span>
                      <button className="lb-shotdesc" onClick={() => setDlg({ shotId: s.id, sceneId: sc.id, after: null })}>
                        {s.description || <span className="lb-muted">No description</span>}
                        {s.silent && <Badge kind="plain">Silent</Badge>}
                      </button>
                      <span className="lb-shotmeta">
                        <span className="lb-shotcell">{[sizeName(s.size), s.movement].filter(Boolean).join(' · ') || <span className="lb-muted">–</span>}</span>
                        <span className="lb-shotcell">{s.lens || <span className="lb-muted">–</span>}</span>
                        <span className="lb-shotcell lb-shotteam" title={editable ? 'Your team can edit this shot' : 'Owned by another team'}>
                          <Icon name={editable ? 'pencil' : 'lock'} /> <span className="lb-shotteamname">{teamName(s.team_id)}</span>
                        </span>
                      </span>
                      <span className="lb-shotcell"><StatusMark status={s.status} /></span>
                      <span className="lb-shottools">
                        {editable && !omitted && (
                          <>
                            <button className="lb-btn lb-btn--sm lb-btn--quiet lb-grip" aria-label={`Drag shot ${shotLabel(sc, si, i + 1)} to a new place`} title="Drag to reorder" onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); beginDrag(e.currentTarget as HTMLElement, e.pointerId, s) }}><span aria-hidden="true">⋮⋮</span></button>
                            <button className="lb-btn lb-btn--sm lb-btn--quiet" aria-label={`Move shot ${shotLabel(sc, si, i + 1)} up`} disabled={i === 0} onClick={() => move(s, -1)}>↑</button>
                            <button className="lb-btn lb-btn--sm lb-btn--quiet" aria-label={`Move shot ${shotLabel(sc, si, i + 1)} down`} disabled={i === list.length - 1} onClick={() => move(s, 1)}>↓</button>
                          </>
                        )}
                      </span>
                    </div>
                    </SwipeRow>
                  )
                })}
                {list.length > 0 && canAdd && !omitted && (
                  <div className="lb-shotend"><button className="lb-btn lb-btn--sm lb-btn--quiet" onClick={() => setDlg({ shotId: null, sceneId: sc.id, after: list[list.length - 1].id })}><Icon name="plus" /> Add a shot after {shotLabel(sc, si, list.length)}</button></div>
                )}
                </>
                )}
              </section>
            )
          })}
        </div>
      )}
      {dlg && dlgScene && (
        <ShotDialog
          key={dlg.shotId ?? `new-${dlg.sceneId}-${dlg.after}`}
          shot={dlgShot} scene={dlgScene} sceneIndex={scenes.findIndex((s) => s.id === dlgScene.id)}
          inScene={bySceneId.get(dlgScene.id) ?? []} after={dlg.after}
          onClose={() => setDlg(null)} onSaved={refresh}
          openShot={(id) => setDlg({ shotId: id, sceneId: dlgScene.id, after: null })}
        />
      )}
    </>
  )
}
