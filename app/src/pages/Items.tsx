import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { navState, type Ctx } from '../components/ProjectLayout'
import { Badge, Choice, EmptyState, Icon, Permission, SwipeRow, rowOpen } from '../components/ui'
import { useBreakdown } from '../lib/breakdown'
import { friendlyError } from '../lib/errors'
import {
  KINDS, STATUSES, STATUS_LABEL, canEditItemFor, canSeeCosts, formatMoney, suggestFromBreakdown, teamsIEditItems, useItems,
  type Item, type ItemCost, type ItemKind, type ItemStatus,
} from '../lib/items'
import { isOwnerOrAdmin, levelFor, useScenes } from '../lib/project'
import { formatRange, scenesOnAnyDay, useScheduleData } from '../lib/schedule'
import { useShots } from '../lib/shots'
import { SECTIONS } from '../lib/sections'
import { ReportButton } from '../components/ReportButton'
import { buildReportPdf, fileSafe } from '../lib/reportPdf'
import { itemsReport } from '../lib/reports'
import { supabase } from '../lib/supabase'

const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : friendlyError(e))
const SCHED_KEY = 'lineboard.items.schedule.'
const CURRENCIES = ['EUR', 'USD', 'GBP', 'INR']

interface DialogProps {
  kind: ItemKind; pid: string; scheduleId: string; item: Item | null; cost: ItemCost | undefined; links: string[]
  sceneOptions: { id: string; label: string }[]; categories: string[]; suppliers: string[]; defaultTeam: string
  onClose: () => void; onSaved: () => void
}

function ItemDialog({ kind, pid, scheduleId, item, cost, links, sceneOptions, categories, suppliers, defaultTeam, onClose, onSaved }: DialogProps) {
  const { b } = useOutletContext<Ctx>()
  const info = KINDS[kind]
  const mine = teamsIEditItems(b, kind)
  const editable = item ? canEditItemFor(b, kind, item.team_id) : mine.length > 0
  const seeCost = canSeeCosts(b)
  const canCost = seeCost && levelFor(b, info.section) === 'edit'
  const [name, setName] = useState(item?.name ?? '')
  const [qty, setQty] = useState(String(item?.quantity ?? 1))
  const [category, setCategory] = useState(item?.category ?? '')
  const [status, setStatus] = useState<ItemStatus>(item?.status ?? 'needed')
  const [supplier, setSupplier] = useState(item?.supplier ?? '')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [teamId, setTeamId] = useState(item?.team_id ?? defaultTeam)
  const [amount, setAmount] = useState(cost ? String(cost.amount) : '')
  const [currency, setCurrency] = useState(cost?.currency ?? 'EUR')
  const [costNote, setCostNote] = useState(cost?.note ?? '')
  const [picked, setPicked] = useState<Set<string>>(new Set(links))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const dis = !editable || busy

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  async function save() {
    const q = Number(qty)
    if (!name.trim()) { setError('Enter a name.'); return }
    if (!Number.isInteger(q) || q < 1) { setError('The quantity must be a whole number, at least 1.'); return }
    if (amount.trim() && !(Number(amount) >= 0)) { setError('The cost must be a number, 0 or more.'); return }
    setBusy(true); setError(null)
    try {
      const body = { name: name.trim(), quantity: q, category: category.trim(), status, supplier: supplier.trim(), notes }
      let id = item?.id
      if (item) {
        const patch: Record<string, unknown> = { ...body }
        if (teamId !== item.team_id) patch.team_id = teamId
        const { data, error: e } = await supabase.from('schedule_items').update(patch).eq('id', item.id).eq('updated_at', item.updated_at).select('id')
        if (e) throw e
        if (!data?.length) throw new Error('Someone saved this item while you were editing it. Close it and open it again.')
      } else {
        const { data, error: e } = await supabase.from('schedule_items').insert({ project_id: pid, schedule_id: scheduleId, kind, team_id: teamId, ...body }).select('id').single()
        if (e) throw e
        id = data.id as string
      }
      if (id) {
        const before = new Set(links)
        const add = [...picked].filter((s) => !before.has(s)), drop = [...before].filter((s) => !picked.has(s))
        if (drop.length) { const { error: e } = await supabase.from('schedule_item_scenes').delete().eq('item_id', id).in('scene_id', drop); if (e) throw e }
        if (add.length) { const { error: e } = await supabase.from('schedule_item_scenes').insert(add.map((scene_id) => ({ item_id: id, scene_id, project_id: pid }))); if (e) throw e }
        if (canCost) {
          if (!amount.trim()) { if (cost) { const { error: e } = await supabase.from('schedule_item_costs').delete().eq('item_id', id); if (e) throw e } }
          else {
            const { error: e } = await supabase.from('schedule_item_costs').upsert({ item_id: id, project_id: pid, amount: Number(amount), currency: (currency || 'EUR').toUpperCase().slice(0, 3), note: costNote.trim() })
            if (e) throw e
          }
        }
      }
      onSaved(); onClose()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  async function remove() {
    if (!item) return
    setBusy(true); setError(null)
    try {
      const { data, error: e } = await supabase.from('schedule_items').delete().eq('id', item.id).select('id')
      if (e) throw e
      if (!data?.length) throw new Error('You do not have permission to do that.')
      onSaved(); onClose()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  const field = (id: string, text: string, node: React.ReactNode, hint?: string) => <div className="lb-field"><label htmlFor={id}>{text}</label>{node}{hint && <span className="lb-caption">{hint}</span>}</div>
  const teamChoices = item && !mine.some((t) => t.id === item.team_id) ? [b.teams.find((t) => t.id === item.team_id)!, ...mine] : mine
  const canPick = !dis && (item ? isOwnerOrAdmin(b) : mine.length > 1)

  return (
    <div className="lb-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="lb-dialog lb-dialog--wide" role="dialog" aria-modal="true" aria-label={item ? `Edit ${info.one}` : `New ${info.one}`}>
        <h2 className="lb-heading" style={{ margin: 0 }}>{item ? item.name : `Add ${info.one === 'prop' ? 'a prop' : 'an item'}`}</h2>
        <div className="lb-shotgrid">
          {field('it-name', 'Name', <input id="it-name" className="lb-input" autoFocus={!item} value={name} maxLength={120} disabled={dis} onChange={(e) => setName(e.target.value)} />)}
          {field('it-qty', 'Quantity', <input id="it-qty" type="number" min={1} max={9999} className="lb-input" value={qty} disabled={dis} onChange={(e) => setQty(e.target.value)} />, 'At least 1.')}
        </div>
        <div className="lb-shotgrid">
          {field('it-cat', 'Category', <Choice id="it-cat" noun="category" value={category} options={categories} disabled={dis} maxLength={60} onChange={setCategory} />)}
          {field('it-status', 'Status', (
            <select id="it-status" className="lb-input" value={status} disabled={dis} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          ))}
        </div>
        {field('it-sup', 'Supplier', <Choice id="it-sup" noun="supplier" value={supplier} options={suppliers} disabled={dis} maxLength={120} onChange={setSupplier} />, 'Where it comes from: a rental house, a shop, the production office.')}
        <div className="lb-field">
          <span className="lb-label">Scenes</span>
          {sceneOptions.length === 0 ? <span className="lb-caption">No scenes are on shoot days in this schedule yet. Place scenes in Schedule to link them here.</span> : (
            <div className="lb-checks" role="group" aria-label="Scenes this is used in">
              {sceneOptions.map((s) => (
                <label key={s.id} className="lb-check">
                  <input type="checkbox" checked={picked.has(s.id)} disabled={dis} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n })} />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {field('it-notes', 'Notes', <textarea id="it-notes" className="lb-input lb-textarea" rows={2} maxLength={500} value={notes} disabled={dis} onChange={(e) => setNotes(e.target.value)} />)}
        {seeCost ? (
          <div className="lb-field">
            <span className="lb-label">Cost</span>
            <div className="lb-shotgrid">
              <span className="lb-row"><input id="it-cost" aria-label="Cost amount" type="number" min={0} step="0.01" className="lb-input" style={{ flex: 1 }} value={amount} disabled={dis || !canCost} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                <select aria-label="Currency" className="lb-input" style={{ width: 'auto' }} value={currency} disabled={dis || !canCost} onChange={(e) => setCurrency(e.target.value)}>{[...new Set([...CURRENCIES, currency])].map((c) => <option key={c}>{c}</option>)}</select></span>
              <input aria-label="Cost note" className="lb-input" value={costNote} maxLength={200} disabled={dis || !canCost} onChange={(e) => setCostNote(e.target.value)} placeholder="Note, for example per day" />
            </div>
          </div>
        ) : null}
        {canPick ? (
          <div className="lb-field">
            <label htmlFor="it-team">Managed by</label>
            <select id="it-team" className="lb-input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>{teamChoices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </div>
        ) : null}
        {item && <p className="lb-caption">Last edited {new Date(item.updated_at).toLocaleString()}.</p>}
        {error && <p className="lb-error" role="alert">{error}</p>}
        <div className="lb-actions" style={{ justifyContent: 'space-between' }}>
          <span className="lb-row">{item && editable && <button className="lb-btn lb-btn--danger" disabled={busy} onClick={() => (confirm ? void remove() : setConfirm(true))}>{confirm ? `Really delete this ${info.one}` : 'Delete'}</button>}</span>
          <span className="lb-row"><button className="lb-btn" onClick={onClose}>Close</button>{editable && <button className="lb-btn lb-btn--primary" disabled={busy} onClick={save}>{busy ? 'Saving' : item ? 'Save' : 'Add'}</button>}</span>
        </div>
      </div>
    </div>
  )
}

export default function ItemsPage({ kind }: { kind: ItemKind }) {
  const { b, pid } = useOutletContext<Ctx>()
  const info = KINDS[kind]
  const qc = useQueryClient()
  const def = SECTIONS.find((s) => s.path === info.path)!
  const st = navState(b, def)
  const level = levelFor(b, info.section)
  const seeCost = canSeeCosts(b)
  const mine = teamsIEditItems(b, kind)
  const sched = useScheduleData(pid)
  const itemsQ = useItems(pid, kind, seeCost)
  const bd = useBreakdown(pid)
  const scenesQ = useScenes(pid)
  const shotsQ = useShots(pid)
  const schedules = useMemo(() => sched.data?.schedules ?? [], [sched.data])
  const [chosen, setChosen] = useState<string>(() => { try { return localStorage.getItem(SCHED_KEY + pid) ?? '' } catch { return '' } })
  const current = schedules.find((s) => s.id === chosen) ?? schedules[0]
  const [open, setOpen] = useState<{ id: string | null } | null>(null)
  const [statusFilter, setStatusFilter] = useState<'' | ItemStatus>('')
  const [catFilter, setCatFilter] = useState('')
  const [ignored, setIgnored] = useState<Set<string>>(new Set())
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyFrom, setCopyFrom] = useState('')
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['items', pid] }) }
  function choose(id: string) { setChosen(id); setIgnored(new Set()); try { localStorage.setItem(SCHED_KEY + pid, id) } catch { /* private window */ } }

  const all = useMemo(() => itemsQ.data?.items ?? [], [itemsQ.data])
  const links = itemsQ.data?.links ?? new Map<string, string[]>()
  const costs = itemsQ.data?.costs ?? new Map<string, ItemCost>()
  const items = all.filter((i) => i.schedule_id === current?.id)
  const sceneRows = useMemo(() => {
    if (!current) return [] as { id: string; label: string }[]
    const ids = scenesOnAnyDay((sched.data?.placements ?? []).filter((p) => p.schedule_id === current.id), (sched.data?.shotPlacements ?? []).filter((p) => p.schedule_id === current.id), shotsQ.data ?? [])
    return (scenesQ.data ?? []).filter((s) => ids.has(s.id)).map((s, _i, arr) => ({ id: s.id, label: `${s.display_number ?? (scenesQ.data ?? []).indexOf(s) + 1}  ${s.heading || 'No heading'}`, n: arr.length }))
  }, [current, sched.data, scenesQ.data, shotsQ.data])
  const sceneSet = useMemo(() => new Set(sceneRows.map((s) => s.id)), [sceneRows])
  const suggestions = useMemo(
    () => suggestFromBreakdown(bd.data?.items ?? [], info.breakdown, sceneSet, items.map((i) => i.name)).filter((s) => !ignored.has(s.key)),
    [bd.data, info.breakdown, sceneSet, items, ignored],
  )
  const categories = useMemo(() => [...info.categories, ...new Set(all.map((i) => i.category).filter((c) => c && !info.categories.includes(c)))], [info.categories, all])
  const suppliers = useMemo(() => [...new Set(all.map((i) => i.supplier).filter(Boolean))].sort((a, z) => a.localeCompare(z)), [all])
  const own = mine.find((t) => b.myLinks.some((l) => l.team_id === t.id))
  const defaultTeam = (own ?? mine.find((t) => t.name === (kind === 'prop' ? 'Art' : 'Camera')) ?? mine[0])?.id ?? ''
  const teamName = (id: string) => b.teams.find((t) => t.id === id)?.name ?? 'No team'

  const head = (
    <div className="lb-page-head">
      <h1 className="lb-title">{info.title}</h1>
      {st.locked ? <Permission level="locked" why="No access" /> : <Permission level={level === 'edit' ? 'edit' : 'view'} />}
    </div>
  )
  if (st.locked) {
    return (
      <>
        {head}
        <EmptyState title={`${info.title} is not open to your team`} action={isOwnerOrAdmin(b) ? <Link className="lb-btn" to="../team">Open Team and access</Link> : undefined}>The admin can change this in Team and access.</EmptyState>
      </>
    )
  }

  async function addSuggestions(list: typeof suggestions) {
    if (!current || list.length === 0) return
    setError(null); setNote(null)
    const mineIds = new Set(mine.map((t) => t.id))
    const added: string[] = []
    for (const s of list) {
      const team = mineIds.has(s.team_id) ? s.team_id : defaultTeam
      if (!team) continue
      const { data, error: e } = await supabase.from('schedule_items').insert({ project_id: pid, schedule_id: current.id, kind, team_id: team, name: s.name, quantity: s.quantity }).select('id').single()
      if (e) { setError(errText(e)); break }
      await supabase.from('schedule_item_scenes').insert(s.sceneIds.map((scene_id) => ({ item_id: data.id as string, scene_id, project_id: pid })))
      added.push(s.name)
    }
    if (added.length) setNote(`${added.length} added from the breakdown.`)
    refresh()
  }
  async function copy() {
    if (!current || !copyFrom) return
    setError(null); setNote(null)
    const src = all.filter((i) => i.schedule_id === copyFrom)
    const have = new Set(items.map((i) => i.name.trim().toLowerCase()))
    const ok = src.filter((i) => canEditItemFor(b, kind, i.team_id) && !have.has(i.name.trim().toLowerCase()))
    if (ok.length) {
      const { error: e } = await supabase.from('schedule_items').insert(ok.map((i) => ({ project_id: pid, schedule_id: current.id, kind, team_id: i.team_id, name: i.name, quantity: i.quantity, category: i.category, supplier: i.supplier, notes: i.notes })))
      if (e) { setError(errText(e)); return }
    }
    const skipped = src.length - ok.length
    setNote(`${ok.length} copied${skipped ? `. ${skipped} skipped because they are already on this list or managed by a team you cannot edit for` : ''}. Each list is edited on its own from now on.`)
    refresh()
  }

  const shown = items.filter((i) => (!statusFilter || i.status === statusFilter) && (!catFilter || i.category === catFilter))
  const openItem = open?.id ? all.find((i) => i.id === open.id) ?? null : null
  const total = items.reduce((n, i) => n + i.quantity, 0)
  const others = schedules.filter((s) => s.id !== current?.id)

  return (
    <>
      {head}
      <p className="lb-caption">{kind === 'equipment'
        ? 'One equipment list for each schedule. Each team lists its own equipment and sees only its own. The head of department edits it. Cost is visible only to the admins and the Production team.'
        : 'One prop list for each schedule. Each team adds its own and only that team edits it. Cost is visible only to the admins and the Production team.'}</p>
      {error && <p className="lb-error" role="alert">{error}</p>}
      {note && <p className="lb-caption" role="status">{note}</p>}
      {sched.isLoading || itemsQ.isLoading ? <p className="lb-caption" role="status">Loading</p> : !current ? (
        <EmptyState title="No schedule yet" action={<Link className="lb-btn lb-btn--primary" to="../schedule">Open Schedule</Link>}>{info.title} lists belong to a schedule. Create a schedule first, then come back here.</EmptyState>
      ) : (
        <>
          <div className="lb-row">
            {schedules.length > 1 && (
              <select className="lb-input" style={{ width: 'auto', maxWidth: '100%' }} aria-label="Schedule" value={current.id} onChange={(e) => choose(e.target.value)}>
                {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <span className="lb-caption">{current.name}, {formatRange(current.start_date, current.end_date)}</span>
            <span style={{ flex: 1 }} />
            <ReportButton label={`Download ${info.title.toLowerCase()} PDF`} file={`${fileSafe(b.project.name)}-${info.path}-${fileSafe(current.name)}`} disabled={items.length === 0}
              build={(size) => buildReportPdf(itemsReport({ project: b.project.name, size, kind, schedule: current, items, costs: seeCost ? costs : null, teams: b.teams, links, scenes: scenesQ.data ?? [] }))} />
            {mine.length > 0 && <button className="lb-btn lb-btn--primary" onClick={() => setOpen({ id: null })}><Icon name="plus" /> Add {info.one === 'prop' ? 'prop' : 'item'}</button>}
          </div>

          {mine.length > 0 && others.length > 0 && (
            <div className="lb-row">
              <select className="lb-input" style={{ width: 'auto', maxWidth: '100%' }} aria-label="Copy from schedule" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">Copy from another schedule…</option>
                {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="lb-btn" disabled={!copyFrom} onClick={() => void copy()}>Copy items</button>
            </div>
          )}

          {mine.length > 0 && suggestions.length > 0 && (
            <section className="lb-card lb-stack" style={{ padding: 16 }} aria-label="Suggestions from the breakdown">
              <div className="lb-spread">
                <h2 className="lb-heading" style={{ margin: 0 }}>From the breakdown <span className="lb-muted">{suggestions.length}</span></h2>
                <button className="lb-btn lb-btn--sm" onClick={() => void addSuggestions(suggestions)}>Add all</button>
              </div>
              <p className="lb-caption">The breakdown lists these for scenes shot in this schedule. Add the ones you need, or ignore them.</p>
              <ul className="lb-unlist">
                {suggestions.map((s) => (
                  <li key={s.key} style={{ justifyContent: 'space-between' }}>
                    <span><strong>{s.name}</strong> <span className="lb-muted">x{s.quantity}, {s.sceneIds.length} {s.sceneIds.length === 1 ? 'scene' : 'scenes'}</span></span>
                    <span className="lb-row">
                      <button className="lb-btn lb-btn--sm lb-btn--primary" onClick={() => void addSuggestions([s])}>Add</button>
                      <button className="lb-btn lb-btn--sm" onClick={() => setIgnored((p) => new Set(p).add(s.key))}>Ignore</button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="lb-row">
            <select className="lb-input" style={{ width: 'auto' }} aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | ItemStatus)}>
              <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <select className="lb-input" style={{ width: 'auto' }} aria-label="Category" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
              <option value="">All categories</option>{[...new Set(items.map((i) => i.category).filter(Boolean))].sort().map((c) => <option key={c}>{c}</option>)}
            </select>
            <span style={{ flex: 1 }} />
            <span className="lb-caption">{items.length} {items.length === 1 ? 'line' : 'lines'}, {total} in all</span>
          </div>

          {items.length === 0 ? (
            <EmptyState title={`No ${info.plural} on this list yet`}>{mine.length > 0 ? `Add them one at a time${suggestions.length ? ', or use the breakdown suggestions above' : ''}${others.length ? ', or copy from another schedule' : ''}.` : `The teams that edit ${info.title} add to this list.`}</EmptyState>
          ) : (
            <div className="lb-sheet">
              <div className={'lb-thead lb-itrow lb-ithead' + (seeCost ? ' has-cost' : '')}><span>Name</span><span>Qty</span><span>Category</span><span>Status</span><span>Supplier</span>{seeCost && <span>Cost</span>}<span className="lb-cclock" /></div>
              {shown.map((i) => {
                const editable = canEditItemFor(b, kind, i.team_id)
                const c = costs.get(i.id)
                return (
                  <SwipeRow key={i.id} label={i.name} canDelete={editable} confirmText="The item is removed from this list. This cannot be undone."
                    onDelete={async () => { const { data, error: e } = await supabase.from('schedule_items').delete().eq('id', i.id).select('id'); if (e) throw new Error(errText(e)); if (!data?.length) throw new Error('You do not have permission to do that.'); refresh() }}>
                  <div className={'lb-itrow lb-ccitem is-click' + (seeCost ? ' has-cost' : '')} {...rowOpen(() => setOpen({ id: i.id }))}>
                    <button className="lb-shotdesc" onClick={() => setOpen({ id: i.id })} aria-label={`Open ${i.name}`}>
                      {i.name}
                    </button>
                    <span className="lb-shotcell">{i.quantity}</span>
                    <span className="lb-shotcell">{i.category || <span className="lb-muted">–</span>}</span>
                    <span className="lb-shotcell"><Badge kind={i.status === 'ready' || i.status === 'returned' ? 'plain' : i.status === 'confirmed' ? 'revised' : 'stale'}>{STATUS_LABEL[i.status]}</Badge></span>
                    <span className="lb-shotcell">{i.supplier || <span className="lb-muted">–</span>}</span>
                    {seeCost && <span className="lb-shotcell">{c ? formatMoney(c.amount, c.currency) : <span className="lb-muted">–</span>}</span>}
                    <span className="lb-cclock">{!editable && <span className="lb-rolock" title="Managed by another team"><Icon name="lock" /><span className="lb-sr">Read only</span></span>}</span>
                  </div>
                  </SwipeRow>
                )
              })}
              {shown.length === 0 && <p className="lb-caption" style={{ padding: 16 }}>No lines match.</p>}
              <p className="lb-caption" style={{ padding: '8px 16px 0' }}>Managed by: {[...new Set(items.map((i) => teamName(i.team_id)))].join(', ')}.</p>
            </div>
          )}

          {open && (open.id === null || openItem) && (
            <ItemDialog key={open.id ?? 'new'} kind={kind} pid={pid} scheduleId={current.id} item={openItem} cost={openItem ? costs.get(openItem.id) : undefined}
              links={openItem ? links.get(openItem.id) ?? [] : []} sceneOptions={sceneRows.map(({ id, label }) => ({ id, label }))}
              categories={categories} suppliers={suppliers} defaultTeam={defaultTeam} onClose={() => setOpen(null)} onSaved={refresh} />
          )}
        </>
      )}
    </>
  )
}

export const PropsPage = () => <ItemsPage kind="prop" />
export const EquipmentPage = () => <ItemsPage kind="equipment" />
