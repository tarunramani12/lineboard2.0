import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { Ctx } from './ProjectLayout'
import { Choice, ListPicker } from './ui'
import { useCastCrew } from '../lib/castcrew'
import { friendlyError } from '../lib/errors'
import {
  FIELD_LABEL, LENSES, MOVEMENTS, SHOT_FIELDS, SHOT_TYPES, SIZES, STATUS_TEXT, canChangeStatus, canEditShotsAs, canEditShotsFor, emptyShot, sizeName,
  shotLabel, slotAfter, teamsIEdit, useShots, type Shot, type ShotDraft, type ShotField, type ShotStatus,
} from '../lib/shots'
import { removeFolder } from '../lib/storyboard'
import { supabase } from '../lib/supabase'
import type { Scene } from '../lib/types'

export interface ShotFormProps {
  shot: Shot | null                 // null = a new shot
  scene: Scene
  sceneIndex: number
  inScene: Shot[]
  after: string | null              // for a new shot: place it after this one (null = at the end)
  onClose: () => void
  onSaved: () => void
  openShot: (id: string) => void
}

/** The shot's details form. It draws no dialog of its own: ShotWorkspace puts it in the shot dialog. */
export function ShotForm({ shot: shot0, scene, sceneIndex, inScene, after, onClose, onSaved, openShot }: ShotFormProps) {
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
    <>
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
    </>
  )
}
