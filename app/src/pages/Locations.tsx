import { lazy, Suspense, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { navState, useMedia, type Ctx } from '../components/ProjectLayout'
import { Badge, Choice, EmptyState, Icon, PageMenu, Permission, SwipeRow, rowOpen } from '../components/ui'
import { AvailabilityTab, CostsTab, PhotosTab, ScenesTab } from '../components/LocationTabs'
import { friendlyError } from '../lib/errors'
import { isOwnerOrAdmin, levelFor, useScenes } from '../lib/project'
import { canSeeCosts } from '../lib/items'
import { ReportButton, useReportDownload } from '../components/ReportButton'
import { buildReportPdf, fileSafe } from '../lib/reportPdf'
import { locationsReport } from '../lib/reports'
import { SECTIONS } from '../lib/sections'
import { supabase } from '../lib/supabase'
import { MET_CREDIT, useWeather, withinForecast } from '../lib/weather'
import {
  KIND_DEFAULTS, PERMIT_LABEL, PICKABLE, STATUSES, STATUS_LABEL, canSeeLocationContacts, costTotals, googleMapsUrl, openInMapsUrl, removeLocationFolder,
  searchAddress, totalsText, useLocations, type Found, type Loc, type LocContact, type LocLink, type LocStatus, type LocationsData, type PermitStatus,
} from '../lib/locations'

const LocationMap = lazy(() => import('../components/LocationMap'))
const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : friendlyError(e))

interface Draft {
  name: string; kind: string; int_ext: Loc['int_ext']; status: LocStatus; address: string; lat: number | null; lng: number | null
  parking: string; access_restrictions: string; hospital: string; permit_required: boolean; permit_status: PermitStatus; permit_no: string
  agreement_signed: boolean; notes: string; links: LocLink[]
  c_name: string; c_role: string; c_phone: string; c_email: string
}
const draftFrom = (l: Loc | null, c: LocContact | undefined): Draft => ({
  name: l?.name ?? '', kind: l?.kind ?? '', int_ext: l?.int_ext ?? '', status: l?.status ?? 'idea', address: l?.address ?? '', lat: l?.lat ?? null, lng: l?.lng ?? null,
  parking: l?.parking ?? '', access_restrictions: l?.access_restrictions ?? '', hospital: l?.hospital ?? '', permit_required: l?.permit_required ?? false,
  permit_status: l?.permit_status ?? 'none', permit_no: l?.permit_no ?? '', agreement_signed: l?.agreement_signed ?? false, notes: l?.notes ?? '', links: l?.links ?? [],
  c_name: c?.name ?? '', c_role: c?.role ?? '', c_phone: c?.phone ?? '', c_email: c?.email ?? '',
})

/** The forecast for the pin on a chosen date, from MET Norway (about 9 days ahead). */
function ForecastPanel({ lat, lng }: { lat: number | null; lng: number | null }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const w = useWeather(lat, lng, date)
  return (
    <div className="lb-field">
      <label htmlFor="lc-wdate">Weather on</label>
      <span className="lb-row">
        <input id="lc-wdate" type="date" className="lb-input" style={{ width: 'auto' }} value={date} onChange={(e) => setDate(e.target.value)} />
        <span className="lb-caption" role="status">
          {lat == null || lng == null ? 'Place a pin to see the forecast.'
            : !date ? 'Choose a date.'
            : !withinForecast(date) ? 'The forecast reaches about 9 days ahead.'
            : w.isLoading ? 'Loading the forecast'
            : w.isError ? 'The forecast is not available right now.'
            : w.data?.summary ? w.data.summary : 'No forecast for that day.'}
        </span>
      </span>
      {w.data?.summary && <span className="lb-caption">{MET_CREDIT}</span>}
    </div>
  )
}

type Tab = 'details' | 'scenes' | 'photos' | 'dates' | 'costs'

function LocationDialog({ loc, data, canEdit, seeContacts, seeCosts, onClose, onSaved }: {
  loc: Loc | null; data: LocationsData; canEdit: boolean; seeContacts: boolean; seeCosts: boolean; onClose: () => void; onSaved: (id: string) => void
}) {
  const { pid } = useOutletContext<Ctx>()
  const qc = useQueryClient()
  const sq = useScenes(pid)
  const contact = loc ? data.contacts.get(loc.id) : undefined
  const [d, setD] = useState<Draft>(() => draftFrom(loc, contact))
  const [id, setId] = useState<string | null>(loc?.id ?? null)
  const [tab, setTab] = useState<Tab>('details')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<Found[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const locked = (loc?.status ?? 'idea') === 'locked'
  const current = loc ? data.locs.find((l) => l.id === loc.id) ?? loc : null
  const dis = !canEdit || busy || locked
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['locations', pid] }) }
  const start = useMemo(() => JSON.stringify(draftFrom(loc, contact)), [loc, contact])
  const dirty = JSON.stringify(d) !== start || !loc

  async function save(): Promise<string | null> {
    setBusy(true); setError(null)
    try {
      if (!d.name.trim()) throw new Error('Enter a name for the location.')
      for (const l of d.links) if (l.url.trim() && !/^https?:\/\//i.test(l.url.trim())) throw new Error('A link must start with http:// or https://.')
      const links = d.links.filter((l) => l.url.trim()).map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      let lid = id
      if (!loc || !lid) {
        const { data: row, error: e } = await supabase.from('locations').insert({
          project_id: pid, name: d.name.trim(), kind: d.kind, int_ext: d.int_ext, status: d.status === 'locked' ? 'idea' : d.status, address: d.address.trim(), lat: d.lat, lng: d.lng,
          parking: d.parking, access_restrictions: d.access_restrictions, hospital: d.hospital, permit_required: d.permit_required, permit_status: d.permit_status,
          permit_no: d.permit_no.trim(), agreement_signed: d.agreement_signed, notes: d.notes, links,
        }).select('id').single()
        if (e) throw e
        lid = row.id as string; setId(lid)
      } else {
        const patch = locked ? { notes: d.notes } : {
          name: d.name.trim(), kind: d.kind, int_ext: d.int_ext, status: d.status, address: d.address.trim(), lat: d.lat, lng: d.lng, parking: d.parking,
          access_restrictions: d.access_restrictions, hospital: d.hospital, permit_required: d.permit_required, permit_status: d.permit_status, permit_no: d.permit_no.trim(),
          agreement_signed: d.agreement_signed, notes: d.notes, links,
        }
        const { data: rows, error: e } = await supabase.from('locations').update(patch).eq('id', lid).eq('updated_at', (current ?? loc).updated_at).select('id')
        if (e) throw e
        if (!rows?.length) throw new Error('Someone saved this location while you were editing it. Close it and open it again.')
      }
      if (seeContacts && lid && !locked) {
        const had = Boolean(contact)
        const any = d.c_name.trim() || d.c_role.trim() || d.c_phone.trim() || d.c_email.trim()
        if (!any) { if (had) { const { error: e } = await supabase.from('location_contacts').delete().eq('location_id', lid); if (e) throw e } }
        else if (d.c_name !== (contact?.name ?? '') || d.c_role !== (contact?.role ?? '') || d.c_phone !== (contact?.phone ?? '') || d.c_email !== (contact?.email ?? '')) {
          const { error: e } = await supabase.from('location_contacts').upsert({ location_id: lid, project_id: pid, name: d.c_name.trim(), role: d.c_role.trim(), phone: d.c_phone.trim(), email: d.c_email.trim() })
          if (e) throw e
        }
      }
      refresh(); onSaved(lid)
      return lid
    } catch (e) { setError(errText(e)); return null } finally { setBusy(false) }
  }
  async function setStatus(next: LocStatus) {
    const lid = (dirty && !locked ? await save() : id)
    if (!lid) return
    setBusy(true); setError(null)
    try {
      const { error: e } = await supabase.from('locations').update({ status: next }).eq('id', lid)
      if (e) throw e
      if (next === 'locked') set('status', 'locked'); else set('status', next)
      refresh(); onSaved(lid)
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  async function remove() {
    if (!id) return
    setBusy(true); setError(null)
    try {
      const { data: rows, error: e } = await supabase.from('locations').delete().eq('id', id).select('id')
      if (e) throw e
      if (!rows?.length) throw new Error('This location could not be deleted. A locked location has to be unlocked first.')
      void removeLocationFolder(`${pid}/${id}`).catch(() => undefined)
      refresh(); onClose()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  async function find() {
    setSearching(true); setError(null); setFound(null)
    try { const r = await searchAddress(d.address.trim()); setFound(r); if (!r.length) setError('That address was not found. Try a nearer place name, or click the map to place the pin.') }
    catch (e) { setError(errText(e)) } finally { setSearching(false) }
  }

  const kinds = useMemo(() => [...KIND_DEFAULTS, ...new Set(data.locs.map((l) => l.kind).filter((k) => k && !KIND_DEFAULTS.includes(k)))], [data.locs])
  const tabs: [Tab, string][] = [['details', 'Details'], ['scenes', 'Scenes'], ['photos', 'Photos'], ['dates', 'Availability'], ...(seeCosts ? [['costs', 'Costs'] as [Tab, string]] : [])]
  const field = (fid: string, text: string, node: React.ReactNode, hint?: string) => <div className="lb-field"><label htmlFor={fid}>{text}</label>{node}{hint && <span className="lb-caption">{hint}</span>}</div>
  const tabProps = current ? { loc: current, data, canEdit, pid, refresh } : null

  return (
    <div className="lb-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="lb-dialog lb-dialog--wide" role="dialog" aria-modal="true" aria-label={loc ? 'Location' : 'New location'}>
        <div className="lb-spread">
          <h2 className="lb-heading" style={{ margin: 0 }}>{loc ? (current?.name || 'Location') : 'Add a location'}</h2>
          <span className="lb-row">{locked && <Badge kind="locked">Locked</Badge>}</span>
        </div>
        <div className="lb-seg lb-tabs" role="group" aria-label="Sections of this location">
          {tabs.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} aria-current={tab === k ? 'true' : undefined} disabled={k !== 'details' && !loc} onClick={() => setTab(k)}>{l}</button>)}
        </div>

        {tab === 'details' && (
          <>
            {locked && <p className="lb-caption">This location is locked. Only the notes can change. Unlock it to change the rest.</p>}
            <div className="lb-shotgrid">
              {field('lc-name', 'Name', <input id="lc-name" className="lb-input" value={d.name} maxLength={120} disabled={dis} onChange={(e) => set('name', e.target.value)} />)}
              {field('lc-kind', 'Type', <Choice id="lc-kind" noun="type" value={d.kind} options={kinds} disabled={dis} maxLength={60} onChange={(v) => set('kind', v)} />)}
            </div>
            <div className="lb-shotgrid">
              {field('lc-ie', 'Inside or outside', <select id="lc-ie" className="lb-input" value={d.int_ext} disabled={dis} onChange={(e) => set('int_ext', e.target.value as Loc['int_ext'])}><option value="">Not set</option><option value="INT">Inside</option><option value="EXT">Outside</option><option value="INT/EXT">Both</option></select>)}
              {field('lc-status', 'Status', locked
                ? <span className="lb-input lb-input--ro">{STATUS_LABEL.locked}</span>
                : <select id="lc-status" className="lb-input" value={d.status} disabled={dis} onChange={(e) => set('status', e.target.value as LocStatus)}>{PICKABLE.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>,
                locked ? undefined : 'Use Lock location when the deal is agreed.')}
            </div>
            {field('lc-addr', 'Address', (
              <span className="lb-row" style={{ flexWrap: 'nowrap' }}>
                <input id="lc-addr" className="lb-input" value={d.address} maxLength={300} disabled={dis} onChange={(e) => set('address', e.target.value)} />
                {canEdit && !locked && <button type="button" className="lb-btn" disabled={!d.address.trim() || searching} onClick={() => void find()}>{searching ? 'Searching' : 'Find on map'}</button>}
              </span>
            ), canEdit && !locked ? 'Find on map places the pin. You can also click the map.' : undefined)}
            {found && found.length > 0 && (
              <ul className="lb-unlist" aria-label="Matches">
                {found.map((f, i) => <li key={i + f.label} className="is-click" style={{ minHeight: 44 }}><button type="button" className="lb-shotdesc" onClick={() => { set('lat', f.lat); set('lng', f.lng); if (!d.address.trim()) set('address', f.label); setFound(null) }}>{f.label}</button></li>)}
              </ul>
            )}
            <Suspense fallback={<p className="lb-caption">Loading the map</p>}>
              <LocationMap label="Pin on the map" height={240} pins={d.lat != null && d.lng != null ? [{ id: id ?? 'new', name: d.name || 'Location', lat: d.lat, lng: d.lng, locked }] : []}
                onPlace={!dis ? (lat, lng) => { set('lat', lat); set('lng', lng) } : undefined} />
            </Suspense>
            <div className="lb-row">
              {d.lat != null && d.lng != null
                ? <><a className="lb-btn lb-btn--sm" href={openInMapsUrl({ name: d.name, address: d.address, lat: d.lat, lng: d.lng })} target="_blank" rel="noopener noreferrer">Open in Maps</a>
                  {!dis && <button type="button" className="lb-btn lb-btn--sm lb-btn--quiet" onClick={() => { set('lat', null); set('lng', null) }}>Remove pin</button>}</>
                : <span className="lb-caption">No pin yet.</span>}
            </div>
            <ForecastPanel lat={d.lat} lng={d.lng} />
            <div className="lb-shotgrid">
              {field('lc-park', 'Parking and unit base', <textarea id="lc-park" className="lb-input lb-textarea" rows={2} value={d.parking} maxLength={500} disabled={dis} onChange={(e) => set('parking', e.target.value)} />, 'Printed on the call sheet.')}
              {field('lc-acc', 'Access and restrictions', <textarea id="lc-acc" className="lb-input lb-textarea" rows={2} value={d.access_restrictions} maxLength={500} disabled={dis} onChange={(e) => set('access_restrictions', e.target.value)} />, 'Hours, load-in, noise or neighbour rules. Printed on the call sheet.')}
            </div>
            {field('lc-hosp', 'Nearest hospital', (
              <span className="lb-row" style={{ flexWrap: 'nowrap' }}>
                <input id="lc-hosp" className="lb-input" value={d.hospital} maxLength={300} disabled={dis} onChange={(e) => set('hospital', e.target.value)} placeholder="Name and address" />
                {d.hospital.trim() && <a className="lb-btn lb-btn--sm" href={googleMapsUrl(d.hospital.trim())} target="_blank" rel="noopener noreferrer">Open in Maps</a>}
              </span>
            ), 'Printed on every call sheet that uses this location, with a link that opens in maps.')}
            <div className="lb-shotgrid">
              <div className="lb-field"><span className="lb-label">Permit</span>
                <label className="lb-check"><input type="checkbox" checked={d.permit_required} disabled={dis} onChange={(e) => set('permit_required', e.target.checked)} /> A permit is needed</label></div>
              {d.permit_required && field('lc-ps', 'Permit status', <select id="lc-ps" className="lb-input" value={d.permit_status} disabled={dis} onChange={(e) => set('permit_status', e.target.value as PermitStatus)}>{(Object.keys(PERMIT_LABEL) as PermitStatus[]).map((p) => <option key={p} value={p}>{PERMIT_LABEL[p]}</option>)}</select>)}
            </div>
            {d.permit_required && field('lc-pn', 'Permit number', <input id="lc-pn" className="lb-input" value={d.permit_no} maxLength={60} disabled={dis} onChange={(e) => set('permit_no', e.target.value)} />)}
            <div className="lb-field"><span className="lb-label">Agreement</span>
              <label className="lb-check"><input type="checkbox" checked={d.agreement_signed} disabled={dis} onChange={(e) => set('agreement_signed', e.target.checked)} /> The location agreement is signed</label></div>
            {seeContacts && (
              <>
                <div className="lb-shotgrid">
                  {field('lc-cn', 'Contact person', <input id="lc-cn" className="lb-input" value={d.c_name} maxLength={120} disabled={dis} onChange={(e) => set('c_name', e.target.value)} />)}
                  {field('lc-cr', 'Role', <input id="lc-cr" className="lb-input" value={d.c_role} maxLength={80} disabled={dis} onChange={(e) => set('c_role', e.target.value)} placeholder="Owner, manager" />)}
                </div>
                <div className="lb-shotgrid">
                  {field('lc-cp', 'Phone', <input id="lc-cp" type="tel" className="lb-input" value={d.c_phone} maxLength={40} disabled={dis} onChange={(e) => set('c_phone', e.target.value)} />)}
                  {field('lc-ce', 'Email', <input id="lc-ce" type="email" className="lb-input" value={d.c_email} maxLength={200} disabled={dis} onChange={(e) => set('c_email', e.target.value)} />, 'Contact details never appear on the call sheet.')}
                </div>
              </>
            )}
            <div className="lb-field">
              <span className="lb-label">Links</span>
              {d.links.map((l, i) => (
                <span key={i} className="lb-row" style={{ flexWrap: 'nowrap' }}>
                  <input className="lb-input" style={{ flex: '0 1 30%' }} aria-label="Link name" placeholder="Name" value={l.label} maxLength={60} disabled={dis} onChange={(e) => set('links', d.links.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
                  <input className="lb-input" aria-label="Link address" placeholder="https://" value={l.url} maxLength={500} disabled={dis} onChange={(e) => set('links', d.links.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))} />
                  {l.url && /^https?:\/\//i.test(l.url) && <a className="lb-btn lb-btn--sm" href={l.url} target="_blank" rel="noopener noreferrer">Open</a>}
                  {!dis && <button type="button" className="lb-btn lb-btn--sm lb-btn--quiet" aria-label="Remove link" onClick={() => set('links', d.links.filter((_, k) => k !== i))}><Icon name="cross" /></button>}
                </span>
              ))}
              {!dis && d.links.length < 20 && <div><button type="button" className="lb-btn lb-btn--sm" onClick={() => set('links', [...d.links, { label: '', url: '' }])}><Icon name="plus" /> Add link</button></div>}
            </div>
            {field('lc-notes', 'Notes', <textarea id="lc-notes" className="lb-input lb-textarea" rows={4} value={d.notes} maxLength={3000} disabled={!canEdit || busy} onChange={(e) => set('notes', e.target.value)} />, 'Power, sun direction, noise, anything the crew should know.')}
          </>
        )}
        {tab !== 'details' && tabProps && (
          tab === 'scenes' ? <ScenesTab {...tabProps} scenes={sq.data ?? []} /> :
          tab === 'photos' ? <PhotosTab {...tabProps} /> :
          tab === 'dates' ? <AvailabilityTab {...tabProps} /> :
          <CostsTab {...tabProps} canEdit={canEdit} />
        )}
        {!loc && tab === 'details' && <p className="lb-caption">Save the location first, then add scenes, photos, dates and costs.</p>}
        {error && <p className="lb-error" role="alert">{error}</p>}
        <div className="lb-actions" style={{ justifyContent: 'space-between' }}>
          <span className="lb-row">
            {loc && canEdit && !locked && <button className="lb-btn lb-btn--danger" disabled={busy} onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}>{confirmDelete ? 'Really delete this location' : 'Delete'}</button>}
            {loc && canEdit && !locked && <button className="lb-btn" disabled={busy} onClick={() => void setStatus('locked')}><Icon name="lock" /> Lock location</button>}
            {loc && canEdit && locked && <button className="lb-btn" disabled={busy} onClick={() => void setStatus('scouted')}><Icon name="unlock" /> Unlock</button>}
          </span>
          <span className="lb-row">
            <button className="lb-btn" onClick={onClose}>Close</button>
            {canEdit && tab === 'details' && <button className="lb-btn lb-btn--primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving' : loc ? 'Save' : 'Add'}</button>}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function Locations() {
  const { b, pid } = useOutletContext<Ctx>()
  const qc = useQueryClient()
  const def = SECTIONS.find((s) => s.path === 'locations')!
  const st = navState(b, def)
  const level = levelFor(b, 'locations')
  const canEdit = level === 'edit'
  const seeCosts = canSeeCosts(b)
  const seeContacts = canSeeLocationContacts(b)
  const q = useLocations(pid)
  const data = q.data
  const phone = useMedia('(max-width: 639px)')
  const [open, setOpen] = useState<{ id: string | null } | null>(null)
  const [show, setShow] = useState<'all' | LocStatus>('all')
  const [view, setView] = useState<'list' | 'map'>('list')
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['locations', pid] }) }
  const scenesQ = useScenes(pid)
  const makePdf = (size: 'a4' | 'letter') => buildReportPdf(locationsReport({ project: b.project.name, size, data: data!, scenes: scenesQ.data ?? [], withContacts: seeContacts, withCosts: seeCosts }))
  const pdf = useReportDownload(fileSafe(b.project.name) + '-locations', makePdf)

  const head = (
    <div className="lb-page-head">
      <h1 className="lb-title">Locations</h1>
      {st.locked ? <Permission level="locked" why="No access" /> : <Permission level={canEdit ? 'edit' : 'view'} />}
      {phone && !st.locked && <PageMenu label="Locations actions" items={[{ label: 'Add location', icon: 'plus', hidden: !canEdit, onClick: () => setOpen({ id: null }) }, { label: 'Download locations PDF', icon: 'download', hidden: !data || data.locs.length === 0, onClick: () => void pdf.go() }]} />}
    </div>
  )
  if (st.locked) {
    return (
      <>
        {head}
        <EmptyState title="Locations is not open to your team" action={isOwnerOrAdmin(b) ? <Link className="lb-btn" to="../team">Open Team and access</Link> : undefined}>The admin can change this in Team and access.</EmptyState>
      </>
    )
  }

  const locs = data?.locs ?? []
  const shown = locs.filter((l) => show === 'all' || l.status === show)
  const counts = (s: LocStatus) => locs.filter((l) => l.status === s).length
  const pins = shown.filter((l) => l.lat != null && l.lng != null).map((l) => ({ id: l.id, name: l.name, lat: l.lat!, lng: l.lng!, locked: l.status === 'locked' }))
  const openLoc = open?.id && data ? data.locs.find((l) => l.id === open.id) ?? null : null

  return (
    <>
      {head}
      <p className="lb-caption lb-phone-hide">Find, compare and lock film locations. Each location holds its address, a map pin, photos you can draw on, linked scenes, dates it is free, and, for Admins and Production, its costs.</p>
      <div className="lb-row">
        <div className="lb-seg lb-seg--scroll" role="group" aria-label="Status">
          <button type="button" aria-pressed={show === 'all'} onClick={() => setShow('all')}>All {locs.length}</button>
          {STATUSES.map((s) => <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)}>{STATUS_LABEL[s]} {counts(s)}</button>)}
        </div>
        <span className="lb-grow" style={{ flex: 1 }} />
        <div className="lb-seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
          <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>Map</button>
        </div>
        {!phone && data && data.locs.length > 0 && <ReportButton label="Download locations PDF" file={fileSafe(b.project.name) + '-locations'} build={makePdf} />}
        {!phone && canEdit && <button className="lb-btn lb-btn--primary" onClick={() => setOpen({ id: null })}><Icon name="plus" /> Add location</button>}
      </div>
      {pdf.error && <p className="lb-error" role="alert">{pdf.error}</p>}
      {q.isError && <p className="lb-error" role="alert">The locations could not load. Check your connection.</p>}
      {view === 'map' && (
        pins.length
          ? <Suspense fallback={<p className="lb-caption">Loading the map</p>}><LocationMap label="All locations" height={phone ? 320 : 440} pins={pins} onPick={(id) => setOpen({ id })} /></Suspense>
          : <EmptyState title="No pins yet">Add an address and press Find on map in a location to see it here.</EmptyState>
      )}
      {locs.length === 0 && !q.isLoading && <EmptyState title="No locations yet">{canEdit ? 'Add the places you are considering. Move each one from Idea to Locked as the hunt goes on.' : 'The production team adds locations here.'}</EmptyState>}
      {view === 'list' && shown.length > 0 && data && (
        <div className="lb-sheet">
          {shown.map((l) => {
            const nScenes = data.scenes.get(l.id)?.length ?? 0
            const total = seeCosts ? totalsText(costTotals(data.costs.get(l.id) ?? [])) : ''
            return (
              <SwipeRow key={l.id} label={l.name} canDelete={canEdit && l.status !== 'locked'} confirmText="The location, its photos, dates, costs and scene links are removed. This cannot be undone."
                onDelete={async () => {
                  const { data: rows, error } = await supabase.from('locations').delete().eq('id', l.id).select('id')
                  if (error) throw new Error(errText(error))
                  if (!rows?.length) throw new Error('You do not have permission to do that.')
                  void removeLocationFolder(`${pid}/${l.id}`).catch(() => undefined)
                  refresh()
                }}>
                <div className={'lb-locrow is-click' + (l.status === 'rejected' ? ' is-rejected' : '')} {...rowOpen(() => setOpen({ id: l.id }))}>
                  <button className="lb-shotdesc" onClick={() => setOpen({ id: l.id })}>{l.name}</button>
                  <span className="lb-shotcell">{[l.kind, l.int_ext && (l.int_ext === 'INT' ? 'Inside' : l.int_ext === 'EXT' ? 'Outside' : 'Inside and outside')].filter(Boolean).join(', ') || <span className="lb-muted lb-dash">–</span>}</span>
                  <span className="lb-shotcell">{l.address || <span className="lb-muted lb-dash">–</span>}{nScenes > 0 && <span className="lb-muted"> · {nScenes} {nScenes === 1 ? 'scene' : 'scenes'}</span>}{total && <span className="lb-muted"> · {total}</span>}</span>
                  <Badge kind={l.status === 'locked' ? 'locked' : l.status === 'rejected' ? 'omitted' : 'plain'}>{STATUS_LABEL[l.status]}</Badge>
                </div>
              </SwipeRow>
            )
          })}
        </div>
      )}
      {shown.length === 0 && locs.length > 0 && view === 'list' && <p className="lb-caption">No locations with that status.</p>}
      {open && data && (open.id === null || openLoc) && (
        <LocationDialog key={open.id ?? 'new'} loc={openLoc} data={data} canEdit={canEdit} seeContacts={seeContacts} seeCosts={seeCosts} onClose={() => setOpen(null)} onSaved={(id) => { if (open.id === null) setOpen({ id }) }} />
      )}
    </>
  )
}
