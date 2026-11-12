import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { navState, type Ctx } from '../components/ProjectLayout'
import { Badge, Choice, EmptyState, Icon, Permission, SceneChip, rowOpen } from '../components/ui'
import {
  CATEGORIES, canEditBreakdownFor, countByCategory, detectCast, teamsIEditBreakdown, usedNames, useBreakdown,
  type BItem, type BScene, type Category,
} from '../lib/breakdown'
import { friendlyError } from '../lib/errors'
import { isOwnerOrAdmin, levelFor, useScenes } from '../lib/project'
import { ReportButton } from '../components/ReportButton'
import { buildReportPdf, fileSafe } from '../lib/reportPdf'
import { breakdownReport } from '../lib/reports'
import { canReadScene, revisionLabel, useMyScriptAccess, useSceneTexts } from '../lib/script'
import { SECTIONS } from '../lib/sections'
import { supabase } from '../lib/supabase'
import type { Scene } from '../lib/types'

const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : friendlyError(e))

// ---- One element of a scene --------------------------------------------------------------------

function ItemRow({ item, editable, teamName, onChanged }: { item: BItem; editable: boolean; teamName: string; onChanged: () => void }) {
  const [qty, setQty] = useState(String(item.quantity))
  const [notes, setNotes] = useState(item.notes)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setQty(String(item.quantity)); setNotes(item.notes) }, [item.quantity, item.notes, item.updated_at])
  const min = item.category === 'equipment' ? 0 : 1

  async function save() {
    const q = Math.round(Number(qty))
    if (!Number.isFinite(q) || q < min || q > 999) { setError(`Quantity must be from ${min} to 999.`); setQty(String(item.quantity)); return }
    if (q === item.quantity && notes === item.notes) return
    setError(null)
    const { data, error: e } = await supabase.from('breakdown_items').update({ quantity: q, notes }).eq('id', item.id).eq('updated_at', item.updated_at).select('id')
    if (e) { setError(errText(e)); return }
    if (!data?.length) setError('Someone changed this just now. It has been refreshed. Try again.')
    onChanged()
  }
  async function remove() {
    const { data, error: e } = await supabase.from('breakdown_items').delete().eq('id', item.id).select('id')
    if (e) { setError(errText(e)); return }
    if (!data?.length) { setError('You do not have permission to do that.'); return }
    onChanged()
  }
  return (
    <div className="lb-bditem">
      <span className="lb-bditem-name">
        {item.name}
        {item.ref_team_id && <Badge kind="plain">Whole team</Badge>}
        {item.category === 'equipment' && item.quantity === 0 && <Badge kind="omitted">Not counted</Badge>}
      </span>
      {editable ? (
        <>
          <input className="lb-input lb-bdqty" type="number" inputMode="numeric" min={min} max={999} value={qty} aria-label={`Quantity of ${item.name}`}
            onChange={(e) => setQty(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLElement).blur() }} />
          <input className="lb-input" value={notes} maxLength={500} placeholder="Notes" aria-label={`Notes for ${item.name}`}
            onChange={(e) => setNotes(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLElement).blur() }} />
        </>
      ) : (
        <>
          <span className="lb-bdqty-ro">×{item.quantity}</span>
          <span className="lb-caption">{item.notes || '–'}</span>
        </>
      )}
      <span className="lb-caption lb-bdteam" title={editable ? 'Your team can edit this' : 'Owned by another team. Read only.'}>
        <Icon name={editable ? 'pencil' : 'lock'} /> {teamName}
      </span>
      {editable ? <button className="lb-btn lb-btn--sm lb-btn--quiet" aria-label={`Remove ${item.name}`} onClick={remove}>Remove</button> : <span />}
      {error && <p className="lb-error lb-bderr" role="alert">{error}</p>}
    </div>
  )
}

// ---- A scene's form ---------------------------------------------------------------------------

interface DialogProps {
  scene: Scene; sceneIndex: number; items: BItem[]; allItems: BItem[]; form: BScene | undefined
  castSuggestions: string[]; canReadText: boolean; onClose: () => void; onChanged: () => void
}

function SceneDialog({ scene, sceneIndex, items, allItems, form, castSuggestions, canReadText, onClose, onChanged }: DialogProps) {
  const { b, pid } = useOutletContext<Ctx>()
  const mine = teamsIEditBreakdown(b)
  const canForm = mine.length > 0
  const [draft, setDraft] = useState({ location: form?.location ?? '', story_date: form?.story_date ?? '', synopsis: form?.synopsis ?? '', notes: form?.notes ?? '' })
  const [formAt, setFormAt] = useState(form?.updated_at ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState(false)
  const [teamId, setTeamId] = useState(mine[0]?.id ?? '')
  const [qty, setQty] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [dept, setDept] = useState('')
  const dirty = draft.location !== (form?.location ?? '') || draft.story_date !== (form?.story_date ?? '') || draft.synopsis !== (form?.synopsis ?? '') || draft.notes !== (form?.notes ?? '')
  const teamName = (id: string) => b.teams.find((t) => t.id === id)?.name ?? 'No team'
  const nameOf = (uid: string | null) => b.people.find((p) => p.account_id === uid)?.name ?? 'Someone'
  const set = (k: keyof typeof draft, v: string) => { setSavedNote(false); setDraft((d) => ({ ...d, [k]: v })) }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  async function saveForm() {
    setBusy(true); setError(null)
    try {
      if (form) {
        const { data, error: e } = await supabase.from('breakdown_scenes').update(draft).eq('scene_id', scene.id).eq('updated_at', form.updated_at).select('updated_at')
        if (e) throw e
        if (!data?.length) throw new Error(`${nameOf(form.updated_by)} saved this scene's details while you were editing. Close and reopen the scene to see their version.`)
        setFormAt(data[0].updated_at as string)
      } else {
        const { data, error: e } = await supabase.from('breakdown_scenes').insert({ scene_id: scene.id, project_id: pid, ...draft }).select('updated_at')
        if (e) throw e
        setFormAt(data?.[0]?.updated_at as string)
      }
      setSavedNote(true); onChanged()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }

  async function add(category: Category, name: string, extra: { quantity?: number; ref_team_id?: string } = {}) {
    const n = name.trim()
    if (!n) return
    if (!teamId) { setError('Choose the team that owns this element.'); return }
    setBusy(true); setError(null)
    try {
      const { error: e } = await supabase.from('breakdown_items').insert({
        project_id: pid, scene_id: scene.id, team_id: teamId, category, name: n, quantity: extra.quantity ?? 1, ...(extra.ref_team_id ? { ref_team_id: extra.ref_team_id } : {}),
      })
      if (e) throw e
      onChanged()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  const have = (category: Category) => new Set(items.filter((i) => i.category === category).map((i) => i.name.toLowerCase()))
  const newCast = castSuggestions.filter((n) => !have('cast').has(n.toLowerCase()))
  async function addAllCast() {
    if (!teamId) { setError('Choose the team that owns this element.'); return }
    setBusy(true); setError(null)
    try {
      const { error: e } = await supabase.from('breakdown_items').insert(newCast.map((name) => ({ project_id: pid, scene_id: scene.id, team_id: teamId, category: 'cast', name, quantity: 1 })))
      if (e) throw e
      onChanged()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }

  const field = (id: string, text: string, node: React.ReactNode) => <div className="lb-field"><label htmlFor={id}>{text}</label>{node}</div>
  return (
    <div className="lb-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="lb-dialog lb-dialog--wide" role="dialog" aria-modal="true" aria-label={`Breakdown for scene ${scene.display_number ?? sceneIndex + 1}`}>
        <div className="lb-spread">
          <h2 className="lb-heading" style={{ margin: 0 }}>Breakdown: scene {scene.display_number ?? sceneIndex + 1}</h2>
          {scene.revised_in ? <Badge kind="conflict"><Icon name="warn" /> Scene revised ({revisionLabel(scene.revised_in)})</Badge> : null}
        </div>
        <p className="lb-caption">{scene.heading || 'No heading yet'}</p>
        {!canForm && <p className="lb-caption"><Icon name="lock" /> You can read this breakdown. Only teams with edit access to Breakdown can change it.</p>}

        <div className="lb-shotgrid">
          {field('bd-loc', 'Location', <input id="bd-loc" className="lb-input" value={draft.location} maxLength={200} disabled={!canForm || busy} onChange={(e) => set('location', e.target.value)} placeholder="Anna's kitchen" />)}
          {field('bd-date', 'Story date', <input id="bd-date" className="lb-input" value={draft.story_date} maxLength={100} disabled={!canForm || busy} onChange={(e) => set('story_date', e.target.value)} placeholder="Day 3, evening" />)}
        </div>
        {field('bd-syn', 'Synopsis', <textarea id="bd-syn" className="lb-input lb-textarea" rows={2} value={draft.synopsis} maxLength={1000} disabled={!canForm || busy} onChange={(e) => set('synopsis', e.target.value)} />)}
        {field('bd-notes', 'Notes', <textarea id="bd-notes" className="lb-input lb-textarea" rows={2} value={draft.notes} maxLength={3000} disabled={!canForm || busy} onChange={(e) => set('notes', e.target.value)} />)}
        {canForm && (
          <div className="lb-row">
            <button className="lb-btn" disabled={busy || !dirty} onClick={saveForm}>Save scene details</button>
            {savedNote && !dirty && <span className="lb-caption" role="status">Saved</span>}
            {form && <span className="lb-caption">Last edited by {nameOf(form.updated_by)} on {new Date(formAt ?? form.updated_at).toLocaleString()}.</span>}
          </div>
        )}

        {canForm && mine.length > 1 && (
          <div className="lb-field">
            <label htmlFor="bd-team">New elements belong to</label>
            <select id="bd-team" className="lb-input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>{mine.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </div>
        )}

        {CATEGORIES.map((c) => {
          const list = items.filter((i) => i.category === c.key)
          const options = usedNames(allItems, c.key, c.defaults)
          return (
            <section key={c.key} className="lb-bdsec" aria-label={c.label}>
              <h3 className="lb-sp-h">{c.label} <span className="lb-caption">{list.length}</span></h3>
              {c.key === 'cast' && canReadText && newCast.length > 0 && canForm && (
                <div className="lb-bdsuggest">
                  <span className="lb-caption">From the script: {newCast.join(', ')}</span>
                  <button className="lb-btn lb-btn--sm" disabled={busy} onClick={addAllCast}>Add {newCast.length === 1 ? 'this speaker' : 'all speakers'}</button>
                </div>
              )}
              {list.length === 0 && <p className="lb-caption">None yet.</p>}
              {list.map((i) => (
                <ItemRow key={i.id} item={i} editable={canEditBreakdownFor(b, i.team_id)} teamName={i.ref_team_id ? `${teamName(i.ref_team_id)} (all)` : teamName(i.team_id)} onChanged={onChanged} />
              ))}
              {canForm && (
                <div className="lb-bdadd">
                  <Choice id={`bd-add-${c.key}`} noun={c.one} value={picked[c.key] ?? ''} options={options} disabled={busy} maxLength={120}
                    onChange={(v) => setPicked((p) => ({ ...p, [c.key]: v }))} />
                  <input className="lb-input lb-bdqty" type="number" min={c.key === 'equipment' ? 0 : 1} max={999} value={qty[c.key] ?? '1'} aria-label={`Quantity to add to ${c.label}`}
                    onChange={(e) => setQty((q) => ({ ...q, [c.key]: e.target.value }))} />
                  <button className="lb-btn lb-btn--sm" disabled={busy || !(picked[c.key] ?? '')} onClick={async () => {
                    const q = Math.round(Number(qty[c.key] ?? 1))
                    if (!Number.isFinite(q) || q < (c.key === 'equipment' ? 0 : 1) || q > 999) { setError('Quantity must be 1 or more' + (c.key === 'equipment' ? ' (0 lists it without counting it)' : '') + '.'); return }
                    await add(c.key, picked[c.key], { quantity: q })
                    setPicked((p) => ({ ...p, [c.key]: '' })); setQty((x) => ({ ...x, [c.key]: '1' }))
                  }}><Icon name="plus" /> Add</button>
                  {c.key === 'crew' && (
                    <span className="lb-row">
                      <select className="lb-input" aria-label="Add a whole department" value={dept} disabled={busy} onChange={(e) => setDept(e.target.value)}>
                        <option value="">Whole department…</option>
                        {b.teams.filter((t) => !list.some((i) => i.ref_team_id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <button className="lb-btn lb-btn--sm" disabled={busy || !dept} onClick={async () => { await add('crew', teamName(dept), { ref_team_id: dept }); setDept('') }}>Add team</button>
                    </span>
                  )}
                </div>
              )}
            </section>
          )
        })}
        {error && <p className="lb-error" role="alert">{error}</p>}
        <div className="lb-actions"><button className="lb-btn lb-btn--primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  )
}

// ---- The page ---------------------------------------------------------------------------------

export default function Breakdown() {
  const { b, pid } = useOutletContext<Ctx>()
  const qc = useQueryClient()
  const scenes = useScenes(pid).data ?? []
  const q = useBreakdown(pid)
  const items = useMemo(() => q.data?.items ?? [], [q.data])
  const forms = useMemo(() => q.data?.forms ?? new Map(), [q.data])
  const everything = isOwnerOrAdmin(b)
  const access = useMyScriptAccess(b.me.id, everything)
  const texts = useSceneTexts(pid, scenes.map((s) => s.id))
  const def = SECTIONS.find((s) => s.path === 'breakdown')!
  const st = navState(b, def)
  const level = levelFor(b, 'breakdown')
  const [open, setOpen] = useState<string | null>(null)
  const [teamFilter, setTeamFilter] = useState('')
  const [showOmitted, setShowOmitted] = useState(false)
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['breakdown', pid] }) }

  const bySceneId = useMemo(() => {
    const m = new Map<string, BItem[]>()
    for (const i of items) m.set(i.scene_id, [...(m.get(i.scene_id) ?? []), i])
    return m
  }, [items])

  const head = (
    <div className="lb-page-head">
      <h1 className="lb-title">Breakdown</h1>
      {st.locked ? <Permission level="locked" why="No access" /> : <Permission level={level === 'edit' ? 'edit' : 'view'} />}
    </div>
  )
  if (st.locked) {
    return (
      <>
        {head}
        <EmptyState title="The breakdown is not open to your team" action={isOwnerOrAdmin(b) ? <Link className="lb-btn" to="../team">Open Team and access</Link> : undefined}>
          The owner can change this in Team and access.
        </EmptyState>
      </>
    )
  }

  const shown = scenes
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => (showOmitted || s.status !== 'omitted') && (!teamFilter || (bySceneId.get(s.id) ?? []).some((x) => x.team_id === teamFilter || x.ref_team_id === teamFilter)))
  const omittedCount = scenes.filter((s) => s.status === 'omitted').length
  const openScene = open ? scenes.find((s) => s.id === open) : undefined
  const teamName = (id: string) => b.teams.find((t) => t.id === id)?.name ?? 'No team'

  return (
    <>
      {head}
      <div className="lb-row" style={{ justifyContent: 'flex-end' }}>
        <ReportButton label="Download breakdown PDF" file={fileSafe(b.project.name) + '-breakdown'} disabled={scenes.length === 0}
          build={(size) => buildReportPdf(breakdownReport({ project: b.project.name, size, scenes, items: q.data?.items ?? [], forms: q.data?.forms ?? new Map(), teams: b.teams }))} />
      </div>
      <p className="lb-caption">One form for each scene: where and when it happens, and everything it needs, by department. Each element belongs to the team that added it, and only that team edits it. Quantities of equipment at 0 are listed but not counted.</p>
      {scenes.length > 0 && (
        <div className="lb-row">
          <label className="lb-row" htmlFor="bd-filter">Show scenes tagged by
            <select id="bd-filter" className="lb-input" style={{ width: 'auto' }} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="">All teams</option>
              {b.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {omittedCount > 0 && <label className="lb-radio"><input type="checkbox" checked={showOmitted} onChange={(e) => setShowOmitted(e.target.checked)} /><span>Show {omittedCount} omitted</span></label>}
          {teamFilter && <span className="lb-caption">{shown.length} {shown.length === 1 ? 'scene' : 'scenes'} for {teamName(teamFilter)}</span>}
        </div>
      )}
      {!scenes.length && <EmptyState title="No scenes yet" action={<Link className="lb-btn" to="../script">Open the Script</Link>}>The breakdown fills from the scenes of the script. Write or import the script first.</EmptyState>}
      {scenes.length > 0 && (
        <div className="lb-sheet">
          {shown.map(({ s, i }) => {
            const its = bySceneId.get(s.id) ?? []
            const counts = countByCategory(its)
            const f = forms.get(s.id)
            return (
              <div key={s.id} className="lb-bdrow is-click" {...rowOpen(() => setOpen(s.id))}>
                <SceneChip n={s.display_number} position={i + 1} omitted={s.status === 'omitted'} />
                <div className="lb-bdmain">
                  <button className="lb-shotdesc" onClick={() => setOpen(s.id)} aria-label={`Open breakdown for scene ${s.display_number ?? i + 1}`}>{s.heading || <span className="lb-muted">No heading yet</span>}</button>
                  <span className="lb-caption">{[f?.location, f?.story_date].filter(Boolean).join(' · ') || 'No location or date yet'}</span>
                  <span className="lb-bdchips">
                    {CATEGORIES.filter((c) => counts.get(c.key)).map((c) => <span key={c.key} className="lb-bdchip">{c.label} {counts.get(c.key)}</span>)}
                    {its.length === 0 && <span className="lb-caption">Nothing tagged yet</span>}
                  </span>
                </div>
                {s.revised_in ? <Badge kind="conflict"><Icon name="warn" /> Revised ({revisionLabel(s.revised_in)})</Badge> : <span />}
              </div>
            )
          })}
          {shown.length === 0 && <p className="lb-caption" style={{ padding: 16 }}>No scenes match.</p>}
        </div>
      )}
      {openScene && (
        <SceneDialog
          key={openScene.id} scene={openScene} sceneIndex={scenes.findIndex((s) => s.id === openScene.id)}
          items={bySceneId.get(openScene.id) ?? []} allItems={items} form={forms.get(openScene.id)}
          canReadText={canReadScene(everything, access.data, openScene.id)}
          castSuggestions={canReadScene(everything, access.data, openScene.id) ? detectCast(texts.data?.get(openScene.id)?.elements ?? []) : []}
          onClose={() => setOpen(null)} onChanged={refresh}
        />
      )}
    </>
  )
}
