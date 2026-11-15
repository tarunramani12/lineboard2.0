import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Choice, Icon, SceneChip, useAction } from './ui'
import PhotoDraw, { PhotoWithDrawing } from './PhotoDraw'
import { friendlyError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { ImageProblem, compressImage, mb, type Stroke } from '../lib/storyboard'
import {
  AVAIL_LABEL, COST_KINDS, COST_STATUS_LABEL, CURRENCIES, costTotals, removeLocationFiles, totalsText, uploadLocationPhoto, useLocationUrls,
  type AvailKind, type CostStatus, type Loc, type LocationsData, type SceneRank,
} from '../lib/locations'
import type { Scene } from '../lib/types'

export interface TabProps { loc: Loc; data: LocationsData; canEdit: boolean; pid: string; refresh: () => void }
const errText = (e: unknown) => friendlyError(e)
const today = () => new Date().toISOString().slice(0, 10)

// ---------------------------------------------------------------- Scenes
export function ScenesTab({ loc, data, canEdit, scenes, refresh }: TabProps & { scenes: Scene[] }) {
  const links = data.scenes.get(loc.id) ?? []
  const act = useAction()
  const [pick, setPick] = useState('')
  const byId = useMemo(() => new Map(scenes.map((s) => [s.id, s])), [scenes])
  const free = scenes.filter((s) => s.status === 'active' && !links.some((l) => l.scene_id === s.id))
  const nameOf = (id: string) => data.locs.find((l) => l.id === id)?.name ?? 'another location'
  async function add() {
    if (!pick) return
    const elsewhere = data.firstOf.get(pick)
    await act.run(async () => {
      const { error } = await supabase.from('location_scenes').insert({ location_id: loc.id, scene_id: pick, project_id: loc.project_id, rank: elsewhere ? 'alternate' : 'first' })
      if (error) throw error
      setPick(''); refresh()
    }, errText)
  }
  async function rank(sceneId: string, r: SceneRank) {
    await act.run(async () => {
      const { error } = await supabase.from('location_scenes').update({ rank: r }).eq('location_id', loc.id).eq('scene_id', sceneId)
      if (error) throw error
      refresh()
    }, (e) => /duplicate|unique|one_first/i.test(String((e as { message?: string })?.message)) ? 'Another location is already this scene\'s first choice. Make that one an alternate first.' : errText(e))
  }
  async function drop(sceneId: string) {
    await act.run(async () => {
      const { error } = await supabase.from('location_scenes').delete().eq('location_id', loc.id).eq('scene_id', sceneId)
      if (error) throw error
      refresh()
    }, errText)
  }
  return (
    <div className="lb-stack">
      {links.length === 0 && <p className="lb-caption">No scenes are linked to this location yet.</p>}
      <ul className="lb-unlist">
        {links.map((l) => {
          const s = byId.get(l.scene_id)
          return (
            <li key={l.scene_id} style={{ gap: 10, minHeight: 48 }}>
              <SceneChip n={s?.display_number ?? null} position={s ? scenes.indexOf(s) + 1 : undefined} />
              <span className="lb-grow" style={{ flex: 1, minWidth: 0 }}>{s?.heading || 'Scene'}</span>
              {canEdit
                ? <select className="lb-input" style={{ width: 'auto' }} aria-label="Choice" value={l.rank} onChange={(e) => void rank(l.scene_id, e.target.value as SceneRank)}><option value="first">First choice</option><option value="alternate">Alternate</option></select>
                : <span className="lb-caption">{l.rank === 'first' ? 'First choice' : 'Alternate'}</span>}
              {canEdit && <button type="button" className="lb-btn lb-btn--sm lb-btn--quiet" aria-label="Remove scene" onClick={() => void drop(l.scene_id)}><Icon name="cross" /></button>}
            </li>
          )
        })}
      </ul>
      {canEdit && (
        <div className="lb-field">
          <label htmlFor="ls-pick">Add a scene</label>
          <span className="lb-row" style={{ flexWrap: 'nowrap' }}>
            <select id="ls-pick" className="lb-input" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{free.length ? 'Choose a scene' : scenes.length ? 'Every scene is linked' : 'No scenes you can see'}</option>
              {free.map((s) => <option key={s.id} value={s.id}>{s.display_number ?? scenes.indexOf(s) + 1} {s.heading}{data.firstOf.has(s.id) ? ` (first choice: ${nameOf(data.firstOf.get(s.id)!)})` : ''}</option>)}
            </select>
            <button type="button" className="lb-btn" disabled={!pick || act.busy} onClick={() => void add()}>Add</button>
          </span>
          <span className="lb-caption">A scene has one first-choice location. A scene that already has one is added here as an alternate.</span>
        </div>
      )}
      {act.error && <p className="lb-error" role="alert">{act.error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- Photos
export function PhotosTab({ loc, data, canEdit, pid, refresh }: TabProps) {
  const photos = data.photos.get(loc.id) ?? []
  const urls = useLocationUrls(photos.map((p) => p.path))
  const act = useAction()
  const [open, setOpen] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const used = photos.reduce((n, p) => n + p.bytes, 0)
  const current = photos.find((p) => p.id === open)

  async function add(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    for (const file of Array.from(files)) {
      let path: string | null = null
      try {
        setWorking('Compressing the picture')
        const { blob } = await compressImage(file)
        setWorking('Uploading')
        path = await uploadLocationPhoto(pid, loc.id, blob)
        const { error: e } = await supabase.from('location_photos').insert({ location_id: loc.id, project_id: pid, path, bytes: blob.size, position: photos.length + 1 })
        if (e) throw e
        path = null
      } catch (e) {
        if (path) void removeLocationFiles([path])
        setError(e instanceof ImageProblem ? e.message : errText(e))
        break
      }
    }
    setWorking(null); if (input.current) input.current.value = ''; refresh()
  }
  async function saveStrokes(s: Stroke[]) {
    if (!current) return
    const ok = await act.run(async () => {
      const { error: e } = await supabase.from('location_photos').update({ strokes: s }).eq('id', current.id)
      if (e) throw e
      return true
    }, errText)
    if (ok) { setOpen(null); refresh() }
  }
  async function caption(id: string, text: string) {
    const { error: e } = await supabase.from('location_photos').update({ caption: text.trim() }).eq('id', id)
    if (e) setError(errText(e)); else refresh()
  }
  async function drop(id: string, path: string) {
    const { error: e } = await supabase.from('location_photos').delete().eq('id', id)
    if (e) { setError(errText(e)); return }
    void removeLocationFiles([path]); refresh()
  }
  return (
    <div className="lb-stack">
      {photos.length === 0 && <p className="lb-caption">No photos yet.{canEdit ? ' Add some from the camera or the photo library.' : ''}</p>}
      <div className="lb-photos">
        {photos.map((p) => {
          const url = urls.data?.get(p.path)
          return (
            <div key={p.id} className="lb-photocard">
              <button type="button" className="lb-photobtn" aria-label={`Open photo${p.caption ? ': ' + p.caption : ''}`} onClick={() => setOpen(p.id)}>
                {url ? <PhotoWithDrawing url={url} strokes={p.strokes} alt={p.caption || 'Location photo'} /> : <span className="lb-caption">Loading</span>}
              </button>
              {canEdit
                ? <input className="lb-input" style={{ minHeight: 36 }} defaultValue={p.caption} maxLength={200} placeholder="Caption" aria-label="Caption" onBlur={(e) => { if (e.target.value.trim() !== p.caption) void caption(p.id, e.target.value) }} />
                : p.caption && <span className="lb-caption">{p.caption}</span>}
              {canEdit && <button type="button" className="lb-btn lb-btn--sm lb-btn--quiet" onClick={() => void drop(p.id, p.path)}>Remove</button>}
            </div>
          )
        })}
      </div>
      {canEdit && (
        <div className="lb-row">
          <input ref={input} type="file" accept="image/*" multiple className="lb-sr" id="lp-file" onChange={(e) => void add(e.target.files)} />
          <label htmlFor="lp-file" className="lb-btn" aria-disabled={Boolean(working)}><Icon name="plus" /> {working ?? 'Add photo'}</label>
          <span className="lb-caption">{photos.length ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}, ${mb(used)} MB. ` : ''}Open a photo to draw on it.</span>
        </div>
      )}
      {error && <p className="lb-error" role="alert">{error}</p>}
      {current && urls.data?.get(current.path) && (
        <PhotoDraw url={urls.data.get(current.path)!} strokes={current.strokes} canEdit={canEdit} busy={act.busy} error={act.error} onSave={(s) => void saveStrokes(s)} onClose={() => { act.setError(null); setOpen(null) }} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Availability
export function AvailabilityTab({ loc, data, canEdit, refresh }: TabProps) {
  const rows = [...(data.avail.get(loc.id) ?? [])].sort((a, b) => a.start_date.localeCompare(b.start_date))
  const act = useAction()
  const [from, setFrom] = useState(today()), [to, setTo] = useState(today()), [kind, setKind] = useState<AvailKind>('unavailable'), [note, setNote] = useState('')
  async function add() {
    await act.run(async () => {
      if (to < from) throw new Error('The end date is before the start date.')
      const { error } = await supabase.from('location_availability').insert({ location_id: loc.id, project_id: loc.project_id, start_date: from, end_date: to, kind, note: note.trim() })
      if (error) throw error
      setNote(''); refresh()
    }, (e) => (e instanceof Error && !('code' in e) ? e.message : errText(e)))
  }
  async function drop(id: string) {
    await act.run(async () => { const { error } = await supabase.from('location_availability').delete().eq('id', id); if (error) throw error; refresh() }, errText)
  }
  return (
    <div className="lb-stack">
      {rows.length === 0 && <p className="lb-caption">No dates recorded. Add when the location can or cannot be used. The Schedule warns when a scene is placed on a day it is not available.</p>}
      <ul className="lb-unlist">
        {rows.map((r) => (
          <li key={r.id} style={{ gap: 10, minHeight: 48 }}>
            <b>{r.start_date === r.end_date ? r.start_date : `${r.start_date} to ${r.end_date}`}</b>
            <span className="lb-badge">{AVAIL_LABEL[r.kind]}</span>
            <span className="lb-grow" style={{ flex: 1, minWidth: 0 }}>{r.note}</span>
            {canEdit && <button type="button" className="lb-btn lb-btn--sm lb-btn--quiet" aria-label="Remove dates" onClick={() => void drop(r.id)}><Icon name="cross" /></button>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="lb-costrow">
          <div className="lb-field"><label htmlFor="la-from">From</label><input id="la-from" type="date" className="lb-input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="lb-field"><label htmlFor="la-to">To</label><input id="la-to" type="date" className="lb-input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="lb-field"><label htmlFor="la-kind">Is</label>
            <select id="la-kind" className="lb-input" value={kind} onChange={(e) => setKind(e.target.value as AvailKind)}>{(Object.keys(AVAIL_LABEL) as AvailKind[]).map((k) => <option key={k} value={k}>{AVAIL_LABEL[k]}</option>)}</select></div>
          <div className="lb-field"><label htmlFor="la-note">Note</label><input id="la-note" className="lb-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></div>
          <button type="button" className="lb-btn" disabled={act.busy} onClick={() => void add()}>Add dates</button>
        </div>
      )}
      {act.error && <p className="lb-error" role="alert">{act.error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- Costs (Admins and Production only; the database hides them from everyone else)
interface Draft { id: string | null; kind: string; amount: string; currency: string; quantity: string; status: CostStatus; due_date: string; paid_date: string; note: string }
const blank = (): Draft => ({ id: null, kind: 'Location fee', amount: '', currency: 'EUR', quantity: '1', status: 'quoted', due_date: '', paid_date: '', note: '' })

export function CostsTab({ loc, data, canEdit, refresh }: TabProps) {
  const costs = data.costs.get(loc.id) ?? []
  const qc = useQueryClient()
  const act = useAction()
  const [adding, setAdding] = useState<Draft | null>(null)
  const kinds = useMemo(() => [...COST_KINDS, ...new Set([...data.costs.values()].flat().map((c) => c.kind).filter((k) => !COST_KINDS.includes(k)))], [data.costs])
  const totals = totalsText(costTotals(costs))
  async function save(d: Draft) {
    const ok = await act.run(async () => {
      const amount = Number(d.amount === '' ? 0 : d.amount), quantity = Number(d.quantity || 1)
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter the amount as a number of 0 or more.')
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('The quantity must be more than 0.')
      const row = { kind: d.kind.trim() || 'Other', amount, currency: d.currency.slice(0, 3).toUpperCase() || 'EUR', quantity, status: d.status, due_date: d.due_date || null, paid_date: d.paid_date || null, note: d.note.trim() }
      const r = d.id ? await supabase.from('location_costs').update(row).eq('id', d.id) : await supabase.from('location_costs').insert({ ...row, location_id: loc.id, project_id: loc.project_id })
      if (r.error) throw r.error
      return true
    }, (e) => (e instanceof Error && !('code' in e) ? e.message : errText(e)))
    if (ok) { setAdding(null); refresh(); void qc.invalidateQueries({ queryKey: ['locations'] }) }
  }
  async function drop(id: string) {
    await act.run(async () => { const { error } = await supabase.from('location_costs').delete().eq('id', id); if (error) throw error; refresh() }, errText)
  }
  return (
    <div className="lb-stack">
      {costs.length === 0 && !adding && <p className="lb-caption">No cost lines yet. A location needs at least one before it can be locked; a free location gets a No charge line of 0.</p>}
      {costs.map((c) => (
        <CostLine key={c.id} initial={{ id: c.id, kind: c.kind, amount: String(c.amount), currency: c.currency, quantity: String(c.quantity), status: c.status, due_date: c.due_date ?? '', paid_date: c.paid_date ?? '', note: c.note }}
          kinds={kinds} canEdit={canEdit} busy={act.busy} onSave={(d) => void save(d)} onRemove={() => void drop(c.id)} />
      ))}
      {adding && <CostLine initial={adding} kinds={kinds} canEdit busy={act.busy} onSave={(d) => void save(d)} onCancel={() => setAdding(null)} />}
      {canEdit && !adding && <div><button type="button" className="lb-btn" onClick={() => { act.setError(null); setAdding(blank()) }}><Icon name="plus" /> Add cost line</button></div>}
      {totals && <p><b>Total</b> {totals}</p>}
      {act.error && <p className="lb-error" role="alert">{act.error}</p>}
    </div>
  )
}

function CostLine({ initial, kinds, canEdit, busy, onSave, onRemove, onCancel }: {
  initial: Draft; kinds: string[]; canEdit: boolean; busy: boolean; onSave: (d: Draft) => void; onRemove?: () => void; onCancel?: () => void
}) {
  const [d, setD] = useState(initial)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const dirty = JSON.stringify(d) !== JSON.stringify(initial) || initial.id === null
  const id = (initial.id ?? 'new') + '-'
  const dis = !canEdit
  return (
    <div className="lb-costrow">
      <div className="lb-field"><label htmlFor={id + 'k'}>Kind</label><Choice id={id + 'k'} noun="kind" value={d.kind} options={kinds} disabled={dis} maxLength={60} onChange={(v) => set('kind', v)} /></div>
      <div className="lb-field"><label htmlFor={id + 'a'}>Amount</label><input id={id + 'a'} className="lb-input" inputMode="decimal" value={d.amount} disabled={dis} onChange={(e) => set('amount', e.target.value)} /></div>
      <div className="lb-field"><label htmlFor={id + 'c'}>Currency</label>
        <select id={id + 'c'} className="lb-input" value={d.currency} disabled={dis} onChange={(e) => set('currency', e.target.value)}>{[...new Set([...CURRENCIES, d.currency])].map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
      <div className="lb-field"><label htmlFor={id + 'q'}>Days or quantity</label><input id={id + 'q'} className="lb-input" inputMode="decimal" value={d.quantity} disabled={dis} onChange={(e) => set('quantity', e.target.value)} /></div>
      <div className="lb-field"><label htmlFor={id + 's'}>Status</label>
        <select id={id + 's'} className="lb-input" value={d.status} disabled={dis} onChange={(e) => set('status', e.target.value as CostStatus)}>{(Object.keys(COST_STATUS_LABEL) as CostStatus[]).map((s) => <option key={s} value={s}>{COST_STATUS_LABEL[s]}</option>)}</select></div>
      <div className="lb-field"><label htmlFor={id + 'd'}>Due</label><input id={id + 'd'} type="date" className="lb-input" value={d.due_date} disabled={dis} onChange={(e) => set('due_date', e.target.value)} /></div>
      <div className="lb-field"><label htmlFor={id + 'p'}>Paid</label><input id={id + 'p'} type="date" className="lb-input" value={d.paid_date} disabled={dis} onChange={(e) => set('paid_date', e.target.value)} /></div>
      <div className="lb-field"><label htmlFor={id + 'n'}>Note</label><input id={id + 'n'} className="lb-input" value={d.note} maxLength={200} disabled={dis} onChange={(e) => set('note', e.target.value)} /></div>
      {canEdit && (
        <span className="lb-row" style={{ gap: 6 }}>
          <button type="button" className="lb-btn lb-btn--sm" disabled={busy || !dirty} onClick={() => onSave(d)}>Save line</button>
          {onCancel && <button type="button" className="lb-btn lb-btn--sm lb-btn--quiet" onClick={onCancel}>Cancel</button>}
          {onRemove && <button type="button" className="lb-btn lb-btn--sm lb-btn--quiet" aria-label="Remove cost line" onClick={onRemove}><Icon name="cross" /></button>}
        </span>
      )}
    </div>
  )
}
