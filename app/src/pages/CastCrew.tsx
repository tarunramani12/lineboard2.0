import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { navState, type Ctx } from '../components/ProjectLayout'
import { Badge, Choice, EmptyState, Icon, Permission, SwipeRow, rowOpen } from '../components/ui'
import {
  CREW_ROLES, canEditCrewFor, departmentOptions, canSeeContacts, displayName, isFormer, teamsICanEditCrew, useCastCrew,
  type CrewContact, type CrewKind, type CrewRow,
} from '../lib/castcrew'
import { friendlyError } from '../lib/errors'
import { isOwnerOrAdmin, levelFor } from '../lib/project'
import { SECTIONS } from '../lib/sections'
import { ReportButton } from '../components/ReportButton'
import { buildReportPdf, fileSafe } from '../lib/reportPdf'
import { castCrewReport } from '../lib/reports'
import { supabase } from '../lib/supabase'

const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : friendlyError(e))

interface DialogProps { row: CrewRow | null; contact: CrewContact | undefined; rows: CrewRow[]; onClose: () => void; onSaved: () => void }

function RowDialog({ row, contact, rows, onClose, onSaved }: DialogProps) {
  const { b, pid } = useOutletContext<Ctx>()
  const mine = teamsICanEditCrew(b)
  const seeContacts = canSeeContacts(b)
  const editable = row ? canEditCrewFor(b, row.team_id) : mine.length > 0
  const auto = Boolean(row?.auto)
  const [kind, setKind] = useState<CrewKind>(row?.kind ?? 'crew')
  const [name, setName] = useState(row?.name ?? '')
  const [role, setRole] = useState(row?.role ?? '')
  const [dept, setDept] = useState(row?.department ?? '')
  const [teamId, setTeamId] = useState(row?.team_id ?? mine[0]?.id ?? '')
  const [call, setCall] = useState(row?.call_time ?? '')
  const [makeup, setMakeup] = useState(row?.makeup_time ?? '')
  const [notes, setNotes] = useState(row?.notes ?? '')
  const [phone, setPhone] = useState(contact?.phone ?? '')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [account, setAccount] = useState(row?.account_id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const members = b.people.filter((p) => p.account_id && !p.former)
  const roles = useMemo(() => [...CREW_ROLES, ...new Set(rows.filter((r) => r.kind === 'crew' && r.role && !CREW_ROLES.includes(r.role)).map((r) => r.role))], [rows])
  const former = row ? isFormer(row) : false
  const depts = useMemo(() => departmentOptions(b.teams.map((t) => t.name), rows), [b.teams, rows])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  function pickAccount(id: string) {
    setAccount(id)
    const p = members.find((m) => m.account_id === id)
    if (p && !name.trim()) setName(p.name)
  }

  async function save() {
    setBusy(true); setError(null)
    try {
      if (!auto && !name.trim() && !account) throw new Error('Enter a name.')
      const base = { name: name.trim(), role: role.trim(), department: kind === 'cast' ? '' : dept.trim(), call_time: call, makeup_time: makeup, notes, account_id: account || null }
      let id = row?.id
      if (row) {
        const patch: Record<string, unknown> = { ...base }
        patch.kind = kind
        if (teamId !== row.team_id) patch.team_id = teamId
        const { data, error: e } = await supabase.from('cast_crew_rows').update(patch).eq('id', row.id).eq('updated_at', row.updated_at).select('id')
        if (e) throw e
        if (!data?.length) throw new Error('Someone saved this row while you were editing it. Close it and open it again.')
      } else {
        if (!teamId) throw new Error('Choose the team that owns this row.')
        const { data, error: e } = await supabase.from('cast_crew_rows').insert({ project_id: pid, team_id: teamId, kind, ...base }).select('id').single()
        if (e) throw e
        id = data.id as string
      }
      if (seeContacts && id) {
        const had = Boolean(contact)
        if (!phone.trim() && !email.trim()) { if (had) { const { error: e } = await supabase.from('cast_crew_contacts').delete().eq('row_id', id); if (e) throw e } }
        else if (phone.trim() !== (contact?.phone ?? '') || email.trim() !== (contact?.email ?? '')) {
          const { error: e } = await supabase.from('cast_crew_contacts').upsert({ row_id: id, project_id: pid, phone: phone.trim(), email: email.trim() })
          if (e) throw e
        }
      }
      onSaved(); onClose()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  async function remove() {
    if (!row) return
    setBusy(true); setError(null)
    try {
      const { data, error: e } = await supabase.from('cast_crew_rows').delete().eq('id', row.id).select('id')
      if (e) throw e
      if (!data?.length) throw new Error('You do not have permission to do that.')
      onSaved(); onClose()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  const dis = !editable || busy
  const field = (id: string, text: string, node: React.ReactNode, hint?: string) => <div className="lb-field"><label htmlFor={id}>{text}</label>{node}{hint && <span className="lb-caption">{hint}</span>}</div>
  return (
    <div className="lb-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="lb-dialog lb-dialog--wide" role="dialog" aria-modal="true" aria-label={row ? 'Cast and crew row' : 'New cast or crew row'}>
        <div className="lb-spread">
          <h2 className="lb-heading" style={{ margin: 0 }}>{row ? (displayName(row) || row.role || 'Row') : 'Add a person'}</h2>
          <span className="lb-row">
            {auto && <Badge kind="plain">From the script</Badge>}
            {row?.account_id && <Badge kind="plain">Has an account</Badge>}
            {former && <Badge kind="omitted">Former member</Badge>}
          </span>
        </div>

        <div className="lb-field">
          <span className="lb-label">Kind</span>
          <div className="lb-seg" role="group" aria-label="Kind">
            {(['cast', 'crew'] as CrewKind[]).map((k) => <button key={k} type="button" aria-pressed={kind === k} aria-current={kind === k ? 'true' : undefined} disabled={dis} onClick={() => setKind(k)}>{k === 'cast' ? 'Cast' : 'Crew'}</button>)}
          </div>
        </div>
        <div className="lb-shotgrid">
          {field('cc-name', kind === 'cast' ? 'Actor' : 'Name', <input id="cc-name" className="lb-input" value={name} maxLength={120} disabled={dis} onChange={(e) => setName(e.target.value)} placeholder={auto ? 'Not cast yet' : ''} />)}
          {kind === 'cast'
            ? field('cc-role', 'Character', <input id="cc-role" className="lb-input" value={role} maxLength={120} disabled={dis} onChange={(e) => setRole(e.target.value)} />, auto ? 'Found in the script. You can rename it or change anything else.' : undefined)
            : field('cc-role', 'Role', <Choice id="cc-role" noun="role" value={role} options={roles} disabled={dis} maxLength={120} onChange={setRole} />, 'The job this person does.')}
        </div>
        {kind === 'crew' && field('cc-dept', 'Department', <Choice id="cc-dept" noun="department" value={dept} options={depts} disabled={dis} maxLength={60} onChange={setDept} />, 'The group this job sits in, used to sort the list. Choose Add new for a department that is not listed.')}
        <div className="lb-shotgrid">
          {field('cc-call', 'Call time', <input id="cc-call" type="time" className="lb-input" value={call} disabled={dis} onChange={(e) => setCall(e.target.value)} />)}
          {field('cc-makeup', 'Make-up time', <input id="cc-makeup" type="time" className="lb-input" value={makeup} disabled={dis} onChange={(e) => setMakeup(e.target.value)} />)}
        </div>
        {field('cc-acct', 'Linked account', (
          <select id="cc-acct" className="lb-input" value={account} disabled={dis} onChange={(e) => pickAccount(e.target.value)}>
            <option value="">No account</option>
            {members.map((m) => <option key={m.account_id!} value={m.account_id!}>{m.name}</option>)}
          </select>
        ), former ? 'This person left. Choose a member to take over the row.' : 'Optional. A person who joins with the email below is linked automatically.')}
        {seeContacts ? (
          <div className="lb-shotgrid">
            {field('cc-phone', 'Phone', <input id="cc-phone" type="tel" className="lb-input" value={phone} maxLength={40} disabled={dis} onChange={(e) => setPhone(e.target.value)} />)}
            {field('cc-email', 'Email', <input id="cc-email" type="email" className="lb-input" value={email} maxLength={200} disabled={dis} onChange={(e) => setEmail(e.target.value)} />, 'The call sheet is sent to this address.')}
          </div>
        ) : contact && (contact.phone || contact.email) ? (
          <div className="lb-shotgrid">
            {field('cc-phone', 'Phone', <input id="cc-phone" type="tel" className="lb-input" value={contact.phone ?? ''} disabled readOnly />)}
            {field('cc-email', 'Email', <input id="cc-email" type="email" className="lb-input" value={contact.email ?? ''} disabled readOnly />, 'Only you and the production team see these.')}
          </div>
        ) : null}
        {field('cc-notes', 'Notes', <textarea id="cc-notes" className="lb-input lb-textarea" rows={2} value={notes} maxLength={500} disabled={dis} onChange={(e) => setNotes(e.target.value)} />)}
        {(() => {
          const teamChoices = row && !mine.some((t) => t.id === row.team_id) ? [b.teams.find((t) => t.id === row.team_id)!, ...mine] : mine
          const canPick = !dis && (row ? isOwnerOrAdmin(b) : mine.length > 1)
          return canPick ? (
            <div className="lb-field">
              <label htmlFor="cc-team">Managed by</label>
              <select id="cc-team" className="lb-input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                {teamChoices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          ) : null
        })()}
        {row && <p className="lb-caption">Last edited {new Date(row.updated_at).toLocaleString()}.</p>}
        {error && <p className="lb-error" role="alert">{error}</p>}
        <div className="lb-actions" style={{ justifyContent: 'space-between' }}>
          <span className="lb-row">
            {row && editable && <button className="lb-btn lb-btn--danger" disabled={busy} onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))}>{confirmDelete ? 'Really delete this row' : 'Delete'}</button>}
          </span>
          <span className="lb-row">
            <button className="lb-btn" onClick={onClose}>Close</button>
            {editable && <button className="lb-btn lb-btn--primary" disabled={busy} onClick={save}>{busy ? 'Saving' : row ? 'Save' : 'Add'}</button>}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function CastCrew() {
  const { b, pid } = useOutletContext<Ctx>()
  const qc = useQueryClient()
  const seeContacts = canSeeContacts(b)
  const q = useCastCrew(pid, true)   // the database returns every contact to those who may see them, and a person's own contact to them
  const rows = useMemo(() => q.data?.rows ?? [], [q.data])
  const contacts = q.data?.contacts ?? new Map<string, CrewContact>()
  const def = SECTIONS.find((s) => s.path === 'cast')!
  const st = navState(b, def)
  const level = levelFor(b, 'cast_crew')
  const mine = teamsICanEditCrew(b)
  const [open, setOpen] = useState<{ id: string | null } | null>(null)
  const [show, setShow] = useState<'all' | CrewKind>('all')
  const [teamFilter, setTeamFilter] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['castcrew', pid] }) }

  const head = (
    <div className="lb-page-head">
      <h1 className="lb-title">Cast and crew</h1>
      {st.locked ? <Permission level="locked" why="No access" /> : <Permission level={level === 'edit' ? 'edit' : 'view'} />}
    </div>
  )
  if (st.locked) {
    return (
      <>
        {head}
        <EmptyState title="Cast and crew is not open to your team" action={isOwnerOrAdmin(b) ? <Link className="lb-btn" to="../team">Open Team and access</Link> : undefined}>The admin can change this in Team and access.</EmptyState>
      </>
    )
  }

  async function detect() {
    // The team that will manage the new rows: your own team if it can edit here, else Production, else the first team you can edit for.
    const own = mine.find((t) => b.myLinks.some((l) => l.team_id === t.id))
    const team = own ?? mine.find((t) => t.role_tag === 'production') ?? mine[0]
    if (!team) return
    setError(null); setNote(null)
    const { data, error: e } = await supabase.rpc('detect_cast', { pid, for_team: team.id })
    if (e) { setError(errText(e)); return }
    setNote(data ? `${data} ${data === 1 ? 'character' : 'characters'} added from the script. They are managed by ${team.name}. An admin can change that on each row.` : 'Every speaking character is already on the list.')
    refresh()
  }

  const shown = rows.filter((r) => (show === 'all' || r.kind === show) && (!teamFilter || r.department === teamFilter))
  const openRow = open?.id ? rows.find((r) => r.id === open.id) ?? null : null
  const counts = { cast: rows.filter((r) => r.kind === 'cast').length, crew: rows.filter((r) => r.kind === 'crew').length }
  return (
    <>
      {head}
      <p className="lb-caption lb-phone-hide">One list for the whole project. Names, roles and call times are visible to everyone who can see this page. Phone and email are visible only to the admins and the AD team. Each row is managed by one team, and only that team edits it.</p>
      <div className="lb-row">
        <div className="lb-seg" role="group" aria-label="Show">
          {([['all', `All ${rows.length}`], ['cast', `Cast ${counts.cast}`], ['crew', `Crew ${counts.crew}`]] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={show === k} aria-current={show === k ? 'true' : undefined} onClick={() => setShow(k)}>{l}</button>
          ))}
        </div>
        <select className="lb-input" style={{ width: 'auto' }} aria-label="Department" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          <option value="">All departments</option>{[...new Set(rows.filter((r) => r.kind === 'crew').map((r) => r.department).filter(Boolean))].sort().map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="lb-grow" style={{ flex: 1 }} />
        {mine.length > 0 && (
          <>
            <button className="lb-btn" onClick={detect}>Detect cast from the script</button>
            <button className="lb-btn lb-btn--primary" onClick={() => setOpen({ id: null })}><Icon name="plus" /> Add person</button>
          </>
        )}
      </div>
      <div className="lb-row" style={{ justifyContent: 'flex-end' }}>
        <ReportButton label="Download cast and crew PDF" file={fileSafe(b.project.name) + '-cast-and-crew'} disabled={rows.length === 0}
          build={(size) => buildReportPdf(castCrewReport({ project: b.project.name, size, rows, contacts, withContacts: seeContacts, teams: b.teams }))} />
      </div>
      {note && <p className="lb-caption" role="status">{note}</p>}
      {error && <p className="lb-error" role="alert">{error}</p>}
      {rows.length === 0 && !q.isLoading && <EmptyState title="Nobody on the list yet">Add people one at a time, or detect the cast from the speaking characters in the script.</EmptyState>}
      {rows.length > 0 && (
        <div className="lb-sheet">
          <div className={'lb-thead lb-ccrow lb-cchead' + (seeContacts ? '' : ' lb-ccrow--nocontact')}><span>Name</span><span>Role</span><span>Department</span><span>Call</span><span>Make-up</span>{seeContacts && <span>Contact</span>}<span className="lb-cclock" /></div>
          {shown.map((r) => {
            const editable = canEditCrewFor(b, r.team_id)
            const c = contacts.get(r.id)
            return (
              <SwipeRow key={r.id} label={displayName(r) || r.role || 'this row'} canDelete={editable} confirmText="The person is removed from the Cast and crew list. This cannot be undone."
                onDelete={async () => { const { data, error: e } = await supabase.from('cast_crew_rows').delete().eq('id', r.id).select('id'); if (e) throw new Error(errText(e)); if (!data?.length) throw new Error('You do not have permission to do that.'); refresh() }}>
              <div className={'lb-ccrow lb-ccitem is-click' + (seeContacts ? '' : ' lb-ccrow--nocontact')} {...rowOpen(() => setOpen({ id: r.id }))}>
                <button className="lb-shotdesc" onClick={() => setOpen({ id: r.id })} aria-label={`Open ${displayName(r) || r.role}`}>
                  {isFormer(r) ? <span className="lb-muted">Former member</span> : r.name || <span className="lb-muted">{r.kind === 'cast' ? 'Not cast yet' : 'No name'}</span>}
                  {r.auto && <Badge kind="plain">Script</Badge>}
                  {r.account_id && <Badge kind="plain">Account</Badge>}
                </button>
                <span className="lb-shotcell">{r.kind === 'cast' ? <><span className="lb-muted">as </span>{r.role}</> : r.role || <span className="lb-muted lb-dash">–</span>}</span>
                <span className="lb-shotcell">{r.kind === 'cast' ? <span className="lb-muted lb-dash">Cast</span> : r.department || <span className="lb-muted lb-dash">–</span>}</span>
                <span className="lb-shotcell">{r.call_time || <span className="lb-muted lb-dash">–</span>}</span>
                <span className="lb-shotcell">{r.makeup_time || <span className="lb-muted lb-dash">–</span>}</span>
                {seeContacts && <span className="lb-shotcell">{c && (c.phone || c.email) ? <>{c.phone}{c.phone && c.email ? ' · ' : ''}{c.email}</> : <span className="lb-muted lb-dash">–</span>}</span>}
                <span className="lb-cclock">{!editable && <span className="lb-rolock" title="Managed by another team"><Icon name="lock" /><span className="lb-sr">Read only</span></span>}</span>
              </div>
              </SwipeRow>
            )
          })}
          {shown.length === 0 && <p className="lb-caption" style={{ padding: 16 }}>No rows match.</p>}
        </div>
      )}
      {open && (open.id === null || openRow) && (
        <RowDialog key={open.id ?? 'new'} row={openRow} contact={openRow ? contacts.get(openRow.id) : undefined} rows={rows} onClose={() => setOpen(null)} onSaved={refresh} />
      )}
    </>
  )
}
