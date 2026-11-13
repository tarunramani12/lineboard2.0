import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { navState, type Ctx } from '../components/ProjectLayout'
import { Badge, Choice, Dialog, EmptyState, Icon, Permission, useAction } from '../components/ui'
import { ASPECT_PRESETS, normalizeRatio } from '../lib/aspect'
import {
  CAMERA_FORMATS, DELIVERY_FORMATS, FRAME_RATES, RESOLUTIONS, bibleOwnerTeam, canEditBibleArea, draftFrom, reorderIds, removeMoodFiles, sameDraft, uploadMoodImage, type BibleArea,
  useBibleFormat, useMoodUrls, useMoodboard, type FormatDraft, type MoodItem,
} from '../lib/bible'
import { ReportButton } from '../components/ReportButton'
import { bibleFileName, buildBiblePdf } from '../lib/biblePdf'
import { friendlyError } from '../lib/errors'
import { isOwnerOrAdmin, type Bundle } from '../lib/project'
import { SECTIONS } from '../lib/sections'
import { ImageProblem, compressImage, mb, totalBytes, useFrames } from '../lib/storyboard'
import { supabase } from '../lib/supabase'

const errText = (e: unknown) => (e instanceof ImageProblem || (e instanceof Error && !('code' in e)) ? (e as Error).message : friendlyError(e))

/** Who owns this part. The admins can hand it to another team; everyone else just reads the name. */
function OwnerLine({ b, pid, area }: { b: Bundle; pid: string; area: BibleArea }) {
  const qc = useQueryClient()
  const act = useAction()
  const team = bibleOwnerTeam(b, area)
  const name = b.teams.find((t) => t.id === team)?.name
  const noun = area === 'format' ? 'The format' : 'The moodboard'
  async function change(v: string) {
    await act.run(async () => {
      const { error } = await supabase.rpc('set_bible_owner', { pid, area, team_in: v || null })
      if (error) throw error
      await qc.invalidateQueries({ queryKey: ['project', pid] })
    }, errText)
  }
  return (
    <div className="lb-row" style={{ alignItems: 'center' }}>
      {isOwnerOrAdmin(b) ? (
        <>
          <label className="lb-caption" htmlFor={'bb-own-' + area}>{noun} is managed by</label>
          <select id={'bb-own-' + area} className="lb-input" style={{ width: 'auto' }} value={team ?? ''} disabled={act.busy} onChange={(e) => void change(e.target.value)}>
            <option value="">Only the admins</option>
            {b.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </>
      ) : <span className="lb-caption">{noun} is managed by {name ?? 'the admins'}, its head of department and the people they allow.</span>}
      {act.error && <span className="lb-error" role="alert">{act.error}</span>}
    </div>
  )
}

// ---- Format tab --------------------------------------------------------------------------------

function FormatTab({ pid, ratio, canEdit, hasFrames }: { pid: string; ratio: string; canEdit: boolean; hasFrames: boolean }) {
  const qc = useQueryClient()
  const q = useBibleFormat(pid, true)
  const saved = useMemo(() => draftFrom(q.data), [q.data])
  const [draft, setDraft] = useState<FormatDraft>(saved)
  useEffect(() => { setDraft(saved) }, [saved])
  const act = useAction()
  const rat = useAction()
  const [pending, setPending] = useState<string | null>(null)
  const dirty = !sameDraft(draft, saved)
  const set = <K extends keyof FormatDraft>(k: K, v: FormatDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  async function save() {
    await act.run(async () => {
      const { error } = await supabase.from('project_bible').upsert({ project_id: pid, ...draft }, { onConflict: 'project_id' })
      if (error) throw error
      await qc.invalidateQueries({ queryKey: ['bible', pid] })
    }, errText)
  }
  function chooseRatio(v: string) {
    if (!v) return
    const n = normalizeRatio(v)
    if (!n) { rat.setError('That is not a usable shape. Use two numbers such as 16:9 or 2.39:1.'); return }
    if (n === ratio) { rat.setError(null); return }
    if (hasFrames) { rat.setError(null); setPending(n) } else void applyRatio(n)
  }
  async function applyRatio(n: string) {
    setPending(null)
    await rat.run(async () => {
      const { error } = await supabase.rpc('set_aspect_ratio', { pid, ratio: n })
      if (error) throw error
      await qc.invalidateQueries({ queryKey: ['project', pid] })
    }, errText)
  }
  const ratioOptions = ASPECT_PRESETS.includes(ratio) ? ASPECT_PRESETS : [...ASPECT_PRESETS, ratio]

  return (
    <div className="lb-card lb-stack" style={{ maxWidth: 720 }}>
      <div className="lb-field">
        <label htmlFor="bb-ratio">Aspect ratio</label>
        <Choice id="bb-ratio" value={ratio} onChange={chooseRatio} options={ratioOptions} disabled={!canEdit || rat.busy} maxLength={12} noun="aspect ratio" />
        <span className="lb-caption">Storyboard frames, drawings and the storyboard PDF follow this shape. Add new takes a number such as 2.39 or a pair such as 5:4.</span>
        {rat.error && <span className="lb-error" role="alert">{rat.error}</span>}
      </div>
      <div className="lb-field"><label htmlFor="bb-fps">Frame rate (frames per second)</label>
        <Choice id="bb-fps" value={draft.frame_rate} onChange={(v) => set('frame_rate', v)} options={FRAME_RATES} disabled={!canEdit} maxLength={30} noun="frame rate" /></div>
      <div className="lb-field"><label htmlFor="bb-res">Resolution</label>
        <Choice id="bb-res" value={draft.resolution} onChange={(v) => set('resolution', v)} options={RESOLUTIONS} disabled={!canEdit} maxLength={60} noun="resolution" /></div>
      <div className="lb-field"><label htmlFor="bb-cam">Camera format</label>
        <Choice id="bb-cam" value={draft.camera_format} onChange={(v) => set('camera_format', v)} options={CAMERA_FORMATS} disabled={!canEdit} maxLength={120} noun="camera format" /></div>
      <div className="lb-field"><label htmlFor="bb-del">Delivery</label>
        <Choice id="bb-del" value={draft.delivery} onChange={(v) => set('delivery', v)} options={DELIVERY_FORMATS} disabled={!canEdit} maxLength={120} noun="delivery format" /></div>
      <div className="lb-field"><label htmlFor="bb-look">Colour and look</label>
        <textarea id="bb-look" className="lb-input lb-textarea" rows={3} maxLength={3000} value={draft.look_notes} disabled={!canEdit} placeholder="Cold blues, practical lights, a LUT name" onChange={(e) => set('look_notes', e.target.value)} /></div>
      <div className="lb-field"><label htmlFor="bb-notes">Notes</label>
        <textarea id="bb-notes" className="lb-input lb-textarea" rows={4} maxLength={5000} value={draft.notes} disabled={!canEdit} onChange={(e) => set('notes', e.target.value)} /></div>
      {act.error && <p className="lb-error" role="alert">{act.error}</p>}
      {canEdit ? (
        <div className="lb-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="lb-btn lb-btn--primary" disabled={!dirty || act.busy} onClick={save}>{act.busy ? 'Saving' : 'Save changes'}</button>
          {dirty && <span className="lb-caption">Unsaved changes. The aspect ratio saves as soon as you choose it.</span>}
        </div>
      ) : <></>}
      {pending && (
        <Dialog title="Change the aspect ratio?" onClose={() => setPending(null)} badge={<Badge kind="stale">Frames keep their picture</Badge>}>
          <p>New frames and the storyboard PDF will use {pending}. Frames already marked done keep their picture and are shown inside the new shape without being stretched. Frames still being drawn use the new shape the next time they are opened.</p>
          <div className="lb-actions">
            <button className="lb-btn" onClick={() => setPending(null)}>Cancel</button>
            <button className="lb-btn lb-btn--primary" onClick={() => applyRatio(pending)}>Change to {pending}</button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

// ---- Moodboard tab -----------------------------------------------------------------------------

function CardDialog({ item, urls, canEdit, index, count, onMove, onClose, onChanged, pid }: {
  item: MoodItem; urls: Map<string, string> | undefined; canEdit: boolean; index: number; count: number
  onMove: (dir: -1 | 1) => void; onClose: () => void; onChanged: () => void; pid: string
}) {
  const [caption, setCaption] = useState(item.caption)
  const [description, setDescription] = useState(item.description)
  const act = useAction()
  const [confirm, setConfirm] = useState(false)
  async function save() {
    const ok = await act.run(async () => {
      const { error } = await supabase.from('moodboard_items').update({ caption: caption.trim(), description }).eq('id', item.id)
      if (error) throw error
      return true
    }, errText)
    if (ok) { onChanged(); onClose() }
  }
  async function remove() {
    const ok = await act.run(async () => {
      const { data, error } = await supabase.from('moodboard_items').delete().eq('id', item.id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('You do not have permission to do that.')
      if (item.image_path) await removeMoodFiles([item.image_path])
      return true
    }, errText)
    if (ok) { onChanged(); onClose() }
  }
  void pid
  const src = item.image_path ? urls?.get(item.image_path) : undefined
  return (
    <Dialog title={item.kind === 'image' ? 'Picture' : 'Note'} onClose={onClose} wide>
      {item.kind === 'image' && (src ? <img className="lb-mood-big" src={src} alt={item.caption || 'Moodboard picture'} /> : <p className="lb-caption">Loading the picture</p>)}
      <div className="lb-field"><label htmlFor="mb-cap">Caption</label>
        <input id="mb-cap" className="lb-input" value={caption} maxLength={200} disabled={!canEdit} onChange={(e) => setCaption(e.target.value)} /></div>
      <div className="lb-field"><label htmlFor="mb-desc">Description</label>
        <textarea id="mb-desc" className="lb-input lb-textarea" rows={5} maxLength={3000} value={description} disabled={!canEdit} onChange={(e) => setDescription(e.target.value)} /></div>
      {act.error && <p className="lb-error" role="alert">{act.error}</p>}
      <div className="lb-actions">
        {canEdit && (
          <>
            <button className="lb-btn" disabled={index === 0 || act.busy} onClick={() => onMove(-1)} aria-label="Move earlier">Move earlier</button>
            <button className="lb-btn" disabled={index === count - 1 || act.busy} onClick={() => onMove(1)} aria-label="Move later">Move later</button>
            <button className="lb-btn lb-btn--danger" disabled={act.busy} onClick={() => setConfirm(true)}>Delete</button>
          </>
        )}
        <button className="lb-btn" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</button>
        {canEdit && <button className="lb-btn lb-btn--primary" disabled={act.busy} onClick={save}>Save</button>}
      </div>
      {confirm && (
        <Dialog title="Delete this card?" onClose={() => setConfirm(false)}>
          <p>{item.kind === 'image' ? 'The picture and its text are removed and the space is freed. ' : ''}This cannot be undone.</p>
          <div className="lb-actions"><button className="lb-btn" onClick={() => setConfirm(false)}>Cancel</button><button className="lb-btn lb-btn--danger" disabled={act.busy} onClick={remove}>Delete card</button></div>
        </Dialog>
      )}
    </Dialog>
  )
}

function MoodTab({ pid, canEdit, capMb, otherBytes }: { pid: string; canEdit: boolean; capMb: number; otherBytes: number }) {
  const qc = useQueryClient()
  const q = useMoodboard(pid, true)
  const items = useMemo(() => q.data ?? [], [q.data])
  const paths = useMemo(() => items.flatMap((i) => (i.image_path ? [i.image_path] : [])), [items])
  const urls = useMoodUrls(paths)
  const file = useRef<HTMLInputElement>(null)
  const act = useAction()
  const [open, setOpen] = useState<string | null>(null)
  const [note, setNote] = useState(false)
  const [noteCap, setNoteCap] = useState('')
  const [noteDesc, setNoteDesc] = useState('')
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['moodboard', pid] }) }
  const used = otherBytes + items.reduce((n, i) => n + i.bytes, 0)
  const capBytes = capMb * 1048576
  const nextPos = items.reduce((m, i) => Math.max(m, i.position), -1) + 1

  async function addPictures(files: FileList | null) {
    if (!files?.length) return
    await act.run(async () => {
      let total = used
      let pos = nextPos
      for (const f of Array.from(files)) {
        const { blob } = await compressImage(f)
        if (total + blob.size > capBytes) throw new ImageProblem(`This project has reached its picture size limit of ${mb(capBytes)} MB (storyboard and moodboard together).`)
        const path = await uploadMoodImage(pid, blob)
        const { error } = await supabase.from('moodboard_items').insert({ project_id: pid, kind: 'image', image_path: path, bytes: blob.size, caption: f.name.replace(/\.[^.]+$/, '').slice(0, 200), position: pos })
        if (error) { void removeMoodFiles([path]); throw error }
        total += blob.size; pos += 1
        await qc.invalidateQueries({ queryKey: ['moodboard', pid] })
      }
    }, errText)
    if (file.current) file.current.value = ''
  }
  async function addNote() {
    const ok = await act.run(async () => {
      const { error } = await supabase.from('moodboard_items').insert({ project_id: pid, kind: 'text', caption: noteCap.trim(), description: noteDesc, position: nextPos })
      if (error) throw error
      return true
    }, errText)
    if (ok) { setNote(false); setNoteCap(''); setNoteDesc(''); refresh() }
  }
  async function move(id: string, dir: -1 | 1) {
    const ids = reorderIds(items.map((i) => i.id), id, dir)
    await act.run(async () => {
      for (let i = 0; i < ids.length; i++) {
        const cur = items.find((x) => x.id === ids[i])
        if (cur && cur.position !== i) {
          const { error } = await supabase.from('moodboard_items').update({ position: i }).eq('id', cur.id)
          if (error) throw error
        }
      }
      refresh()
    }, errText)
  }

  const openItem = items.find((i) => i.id === open)
  return (
    <div className="lb-stack">
      <div className="lb-row">
        {canEdit && (
          <>
            <button className="lb-btn lb-btn--primary" disabled={act.busy} onClick={() => file.current?.click()}><Icon name="plus" /> {act.busy ? 'Adding' : 'Add pictures'}</button>
            <button className="lb-btn" disabled={act.busy} onClick={() => { act.setError(null); setNote(true) }}><Icon name="plus" /> Add a note</button>
            <input ref={file} type="file" accept="image/*" multiple hidden aria-label="Choose pictures" onChange={(e) => void addPictures(e.target.files)} />
          </>
        )}
        <span className="lb-caption">Pictures use {mb(used)} of {mb(capBytes)} MB, shared with the storyboard.</span>
      </div>
      {act.error && <p className="lb-error" role="alert">{act.error}</p>}
      {!q.isLoading && items.length === 0 && (
        <EmptyState title="The moodboard is empty">{canEdit ? 'Add pictures for the look of the film, and notes about colour, light or mood.' : 'Nothing has been added yet.'}</EmptyState>
      )}
      <div className="lb-mood">
        {items.map((it) => (
          <button key={it.id} type="button" className="lb-mood-card" onClick={() => setOpen(it.id)}>
            {it.kind === 'image'
              ? (urls.data?.get(it.image_path ?? '') ? <img className="lb-mood-img" src={urls.data.get(it.image_path ?? '')} alt={it.caption || 'Moodboard picture'} loading="lazy" /> : <span className="lb-mood-img lb-mood-img--empty lb-caption">Loading</span>)
              : <span className="lb-mood-text">{it.description || it.caption || 'Empty note'}</span>}
            <span className="lb-mood-cap">{it.caption || (it.kind === 'image' ? 'Untitled picture' : 'Note')}</span>
            {it.kind === 'image' && it.description && <span className="lb-caption lb-mood-desc">{it.description}</span>}
          </button>
        ))}
      </div>
      {openItem && (
        <CardDialog key={openItem.id + openItem.updated_at} item={openItem} urls={urls.data} canEdit={canEdit} pid={pid}
          index={items.findIndex((i) => i.id === openItem.id)} count={items.length}
          onMove={(d) => void move(openItem.id, d)} onClose={() => setOpen(null)} onChanged={refresh} />
      )}
      {note && (
        <Dialog title="Add a note" onClose={() => setNote(false)}>
          <div className="lb-field"><label htmlFor="mb-ncap">Caption</label>
            <input id="mb-ncap" className="lb-input" value={noteCap} maxLength={200} onChange={(e) => setNoteCap(e.target.value)} placeholder="Colour palette" /></div>
          <div className="lb-field"><label htmlFor="mb-ndesc">Text</label>
            <textarea id="mb-ndesc" className="lb-input lb-textarea" rows={5} maxLength={3000} value={noteDesc} onChange={(e) => setNoteDesc(e.target.value)} /></div>
          {act.error && <p className="lb-error" role="alert">{act.error}</p>}
          <div className="lb-actions">
            <button className="lb-btn" onClick={() => setNote(false)}>Cancel</button>
            <button className="lb-btn lb-btn--primary" disabled={act.busy || (!noteCap.trim() && !noteDesc.trim())} onClick={addNote}>Add note</button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

// ---- The page ----------------------------------------------------------------------------------

export default function Bible() {
  const { b, pid } = useOutletContext<Ctx>()
  const canEditFormat = canEditBibleArea(b, 'format')
  const canEditMood = canEditBibleArea(b, 'mood')
  const [tab, setTab] = useState<'format' | 'mood'>('format')
  const def = SECTIONS.find((s) => s.path === 'bible')!
  const st = navState(b, def)
  const frames = useFrames(pid)
  const frameBytes = frames.data ? totalBytes(frames.data.values()) : 0
  const ratio = b.project.aspect_ratio ?? '16:9'
  const formatQ = useBibleFormat(pid, !st.locked)
  const moodQ = useMoodboard(pid, !st.locked)
  return (
    <>
      <div className="lb-page-head">
        <h1 className="lb-title">Project bible</h1>
        <div className="lb-row">{st.locked ? <Permission level="locked" why="No access" /> : <Permission level={(tab === 'format' ? canEditFormat : canEditMood) ? 'edit' : 'view'} />}</div>
      </div>
      {st.locked ? (
        <EmptyState title="The Project bible is not open to your team">The admin can change this in Team and access.</EmptyState>
      ) : (
        <>
          <p className="lb-caption">The shape, speed and look of the film in one place. The Camera team manages the format and the Direction team manages the moodboard, unless the admin hands a part to another team.</p>
          <div className="lb-seg" role="group" aria-label="Project bible">
            <button type="button" aria-pressed={tab === 'format'} onClick={() => setTab('format')}>Format</button>
            <button type="button" aria-pressed={tab === 'mood'} onClick={() => setTab('mood')}>Moodboard</button>
          </div>
          <div className="lb-row" style={{ justifyContent: 'space-between' }}>
            <OwnerLine b={b} pid={pid} area={tab} />
            <ReportButton label="Download Project bible PDF" file={bibleFileName(b.project.name)}
              build={() => buildBiblePdf({ project: b.project.name, ratio, format: formatQ.data ?? null, items: moodQ.data ?? [], withMoodboard: true })} />
          </div>
          {tab === 'format'
            ? <FormatTab pid={pid} ratio={ratio} canEdit={canEditFormat} hasFrames={frames.isLoading || (frames.data?.size ?? 0) > 0} />
            : <MoodTab pid={pid} canEdit={canEditMood} capMb={b.project.image_cap_mb ?? 200} otherBytes={frameBytes} />}
        </>
      )}
    </>
  )
}
