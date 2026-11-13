import { useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { Ctx } from '../components/ProjectLayout'
import { navState } from '../components/ProjectLayout'
import { Badge, Dialog, EmptyState, Field, Icon, Permission, rowOpen, useAction } from '../components/ui'
import { friendlyError } from '../lib/errors'
import { useAuth } from '../lib/auth'
import { KIND_LABEL, MAIL_DOMAIN, senderPreview, STATUS_LABEL, useOutbox } from '../lib/email'
import type { Project } from '../lib/types'
import { isOwner, isOwnerOrAdmin, levelFor } from '../lib/project'
import { SECTIONS } from '../lib/sections'
import { removeFolder } from '../lib/storyboard'
import { RequestAccessCard } from '../components/AccessRequests'
import { removeMoodFolder } from '../lib/bible'
import { supabase } from '../lib/supabase'

/** A section that exists in the navigation but is built in a later step. */
export function SectionPage() {
  const { section } = useParams()
  const { b } = useOutletContext<Ctx>()
  const def = SECTIONS.find((s) => s.path === section)
  if (!def) return <EmptyState title="Page not found" action={<Link className="lb-btn" to="..">Back to overview</Link>} />
  const owner = b.people.find((p) => p.role === 'owner')
  const st = navState(b, def)
  const level = def.key ? levelFor(b, def.key) : 'edit'
  return (
    <>
      <div className="lb-page-head">
        <h1 className="lb-title">{def.label}</h1>
        {st.locked ? <Permission level="locked" why="No access" /> : <Permission level={level === 'edit' ? 'edit' : 'view'} />}
      </div>
      {st.locked ? (
        <EmptyState title={`${def.label} is not open to your team`}
          action={isOwnerOrAdmin(b) ? <Link className="lb-btn" to="../team">Open Team and access</Link> : undefined}>
          {owner ? `${owner.name}, the admin, can change this in Team and access.` : 'The admin can change this in Team and access.'}
        </EmptyState>
      ) : (
        <EmptyState title={`No ${def.label.toLowerCase()} yet`}>
          This section is built in a later step. It will fill from the scenes in this project.
        </EmptyState>
      )}
    </>
  )
}

export function ExportSettings() {
  const { b, pid } = useOutletContext<Ctx>()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<'delete' | 'leave' | 'transfer' | null>(null)
  const [typed, setTyped] = useState('')
  const act = useAction()
  const owner = isOwner(b)
  const [backing, setBacking] = useState<string | null>(null)
  const [backNote, setBackNote] = useState<string | null>(null)
  const [backError, setBackError] = useState<string | null>(null)
  async function makeBackup() {
    setBacking('Starting'); setBackError(null); setBackNote(null)
    try {
      const { buildBackup } = await import('../lib/backup')
      const r = await buildBackup(pid, b.project.name, setBacking)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(r.blob)
      a.download = `${b.project.name.replace(/[^\w-]+/g, '_') || 'project'}-backup-${new Date().toISOString().slice(0, 10)}.zip`
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      setBackNote(`Saved ${(r.blob.size / 1048576).toFixed(1)} MB with ${r.pictures} storyboard ${r.pictures === 1 ? 'picture' : 'pictures'}.`)
    } catch (e) { setBackError(e instanceof Error ? e.message : friendlyError(e)) } finally { setBacking(null) }
  }

  async function remove() {
    const ok = await act.run(async () => {
      await removeFolder(pid).catch(() => undefined)   // the storyboard pictures go with the project
      await removeMoodFolder(pid).catch(() => undefined)   // and the moodboard pictures
      const { error } = await supabase.from('projects').delete().eq('id', pid)
      if (error) throw error
      return true
    }, friendlyError)
    if (ok) { qc.removeQueries({ queryKey: ['project', pid] }); void qc.invalidateQueries({ queryKey: ['my-projects'] }); nav('/', { replace: true }) }
  }
  const admins = b.people.filter((p) => p.role === 'admin' && p.account_id && !p.former)
  const [heir, setHeir] = useState('')
  async function transfer() {
    const ok = await act.run(async () => {
      const { error } = await supabase.rpc('transfer_ownership', { pid, to_member: heir })
      if (error) throw error
      return true
    }, friendlyError)
    if (ok) { setDialog(null); void qc.invalidateQueries({ queryKey: ['project', pid] }); void qc.invalidateQueries({ queryKey: ['my-projects'] }) }
  }
  async function leave() {
    const ok = await act.run(async () => {
      const { error } = await supabase.from('members').delete().eq('id', b.me.id)
      if (error) throw error
      return true
    }, friendlyError)
    if (ok) { qc.removeQueries({ queryKey: ['project', pid] }); void qc.invalidateQueries({ queryKey: ['my-projects'] }); nav('/', { replace: true }) }
  }

  return (
    <>
      <div className="lb-page-head"><h1 className="lb-title">Export and settings</h1></div>
      <section className="lb-card lb-stack">
        <h2 className="lb-heading">Export</h2>
        {isOwnerOrAdmin(b) ? (
          <div className="lb-stack">
            <p>Download a full backup of this project: every table, the script and the storyboard pictures, in one zip file. Keep it somewhere safe. The free hosting plan has no backups of its own.</p>
            <div className="lb-row">
              <button className="lb-btn lb-btn--primary" disabled={backing !== null} onClick={makeBackup}>{backing ?? 'Download backup'}</button>
              {backNote && <span className="lb-caption" role="status">{backNote}</span>}
            </div>
            {backError && <p className="lb-error" role="alert">{backError}</p>}
          </div>
        ) : null}
      </section>
      {isOwnerOrAdmin(b) && <MailSettings pid={pid} project={b.project} owner={isOwner(b)} />}
      <RequestAccessCard b={b} pid={pid} />
      <section className="lb-card lb-stack" aria-label="PDFs and files">
        <h2 className="lb-heading">PDFs for each department</h2>
        <p className="lb-caption">Each department downloads its own file from its own page, with the paper size you choose. You only see the pages you have access to. A lock means your team cannot open that page.</p>
        <ul className="lb-unlist">
          {([['script', 'Script (screenplay layout, scene numbers)', 'script', 'script'], ['shots', 'Shot list', 'shots', 'shots'], ['storyboard', 'Storyboard pictures', 'storyboard', 'shots'], ['bible', 'Project bible', 'bible', 'bible'], ['breakdown', 'Breakdown', 'breakdown', 'breakdown'], ['cast', 'Cast and crew', 'cast', 'cast_crew'], ['props', 'Props, one per schedule', 'props', 'props'], ['equipment', 'Equipment, one per schedule', 'equipment', 'equipment'], ['schedule', 'Schedule', 'schedule', 'schedule'], ['callsheets', 'Call sheets, one per shoot day', 'callsheets', 'call_sheets']] as const).map(([path, label, , key]) => {
            const open = levelFor(b, key) !== 'none'
            return (
              <li key={path} className={open ? 'is-click' : undefined} style={{ justifyContent: 'space-between', minHeight: 44 }} {...(open ? rowOpen(() => nav(`/p/${pid}/${path}`)) : {})}>
                {open ? <Link className="lb-shotdesc" to={`/p/${pid}/${path}`}>{label}</Link> : <span>{label}</span>}
                {open ? <span aria-hidden="true" style={{ fontSize: 20, fontWeight: 800 }}>›</span> : <span className="lb-rolock"><Icon name="lock" /><span className="lb-sr">No access</span></span>}
              </li>
            )
          })}
        </ul>
      </section>
      {owner && (
        <section className="lb-card lb-stack">
          <h2 className="lb-heading">Transfer ownership</h2>
          <p>Hand this project to one of its admins. They become the main admin and you stay an admin. Only the admin can lock the script, delete the project or transfer it.</p>
          {admins.length === 0 && <p className="lb-caption">There is no admin yet. Make someone an admin in Team and access first.</p>}
          <div><button className="lb-btn" disabled={admins.length === 0} onClick={() => { setDialog('transfer'); setHeir(admins[0]?.id ?? ''); setTyped(''); act.setError(null) }}>Transfer ownership</button></div>
        </section>
      )}
      <section className="lb-card lb-stack">
        <h2 className="lb-heading">{owner ? 'Delete project' : 'Leave project'}</h2>
        {owner ? (
          <>
            <p>Deleting removes the project, its scenes, teams and everyone's access. It cannot be undone.</p>
            <p className="lb-caption">Download a backup above first if you may want anything back.</p>
            <div><button className="lb-btn lb-btn--danger" onClick={() => { setDialog('delete'); setTyped(''); act.setError(null) }}>Delete project</button></div>
          </>
        ) : (
          <>
            <p>You will lose access to this project. An admin or the head of department can invite you again.</p>
            <div><button className="lb-btn lb-btn--danger" onClick={() => { setDialog('leave'); act.setError(null) }}>Leave project</button></div>
          </>
        )}
      </section>
      {dialog === 'transfer' && (
        <Dialog title="Transfer ownership" onClose={() => setDialog(null)}>
          <div className="lb-field">
            <label htmlFor="heir">New owner</label>
            <select id="heir" className="lb-input" value={heir} onChange={(e) => setHeir(e.target.value)}>
              {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <p className="lb-caption">You will stay on the project as an admin. You cannot take ownership back unless the new owner transfers it to you.</p>
          <Field label="Project name" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={b.project.name} />
          {act.error && <p className="lb-error" role="alert">{act.error}</p>}
          <div className="lb-actions">
            <button className="lb-btn" onClick={() => setDialog(null)}>Keep ownership</button>
            <button className="lb-btn lb-btn--danger" disabled={act.busy || !heir || typed.trim() !== b.project.name} onClick={transfer}>Transfer project</button>
          </div>
        </Dialog>
      )}
      {dialog === 'delete' && (
        <Dialog title={`Delete ${b.project.name}?`} onClose={() => setDialog(null)}>
          <p>Type the project name to confirm. Everything in it is deleted for everyone.</p>
          <Field label="Project name" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={b.project.name} />
          {act.error && <p className="lb-error" role="alert">{act.error}</p>}
          <div className="lb-actions">
            <button className="lb-btn" onClick={() => setDialog(null)}>Keep project</button>
            <button className="lb-btn lb-btn--danger" disabled={act.busy || typed.trim() !== b.project.name} onClick={remove}>Delete project</button>
          </div>
        </Dialog>
      )}
      {dialog === 'leave' && (
        <Dialog title={`Leave ${b.project.name}?`} onClose={() => setDialog(null)}>
          <p>Your rows stay on the project, shown as your name until your head of department reassigns them.</p>
          {act.error && <p className="lb-error" role="alert">{act.error}</p>}
          <div className="lb-actions">
            <button className="lb-btn" onClick={() => setDialog(null)}>Stay</button>
            <button className="lb-btn lb-btn--danger" disabled={act.busy} onClick={leave}>Leave project</button>
          </div>
        </Dialog>
      )}
    </>
  )
}

/** Who the project's emails come from. Only the admin changes it; admins can see it and what was sent. */
function MailSettings({ pid, project, owner }: { pid: string; project: Project; owner: boolean }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const act = useAction()
  const [id, setId] = useState(project.mail_id ?? '')
  const [name, setName] = useState(project.mail_name)
  const [reply, setReply] = useState(project.reply_to)
  const [saved, setSaved] = useState(false)
  const box = useOutbox(pid, true)
  const rows = box.data ?? []
  const waiting = rows.filter((r) => r.status !== 'sent').length
  const shown = senderPreview({ name: project.name, mail_id: id.trim().toLowerCase() || null, mail_name: name.trim() })
  async function save() {
    setSaved(false)
    const ok = await act.run(async () => {
      const { error } = await supabase.rpc('set_mail_identity', { pid, new_id: id, new_name: name, new_reply: reply })
      if (error) throw error
      return true
    }, friendlyError)
    if (ok) { setSaved(true); void qc.invalidateQueries({ queryKey: ['project', pid] }) }
  }
  return (
    <section className="lb-card lb-stack" aria-label="Send notifications as">
      <h2 className="lb-heading">Send notifications as</h2>
      <p>Emails about this project, such as requests to join and call sheets, come from an address at {MAIL_DOMAIN}. Replies go to the address you choose below, so they reach you.</p>
      {project.email_paused && <p className="lb-error" role="alert">Email for this project is paused. Contact LineBoard support.</p>}
      <p className="lb-caption">What people will see: <strong>{shown}</strong></p>
      {owner ? (
        <div className="lb-stack">
          <Field label="Sending name" value={id} maxLength={30} autoCapitalize="none" autoCorrect="off" spellCheck={false}
            hint={`Letters, numbers and hyphens. The address becomes ${id.trim().toLowerCase() || 'name'}@${MAIL_DOMAIN}. Leave it empty to send from noreply@${MAIL_DOMAIN}.`}
            onChange={(e) => { setId(e.target.value); setSaved(false) }} />
          <Field label="Display name" value={name} maxLength={60} placeholder={project.name}
            hint="Shown before the address. We add (via LineBoard) so people know where it came from." onChange={(e) => { setName(e.target.value); setSaved(false) }} />
          <Field label="Reply address" type="email" value={reply} maxLength={200} placeholder={user?.email ?? ''}
            hint="Where replies go. Empty means your account email." onChange={(e) => { setReply(e.target.value); setSaved(false) }} />
          <div className="lb-row">
            <button className="lb-btn lb-btn--primary" disabled={act.busy} onClick={save}>{act.busy ? 'Saving' : 'Save'}</button>
            {saved && <span className="lb-caption" role="status">Saved.</span>}
          </div>
          {act.error && <p className="lb-error" role="alert">{act.error}</p>}
        </div>
      ) : null}
      <h3 className="lb-heading" style={{ fontSize: 16, margin: 0 }}>Recent email {waiting > 0 && <Badge kind="stale">{waiting} not sent yet</Badge>}</h3>
      {rows.length === 0 ? <p className="lb-caption">Nothing sent yet.</p> : (
        <ul className="lb-unlist">
          {rows.slice(0, 8).map((r) => (
            <li key={r.id} style={{ justifyContent: 'space-between', minHeight: 44, gap: 12 }}>
              <span>{KIND_LABEL[r.kind] ?? r.kind} to {r.to_email}</span>
              <span className="lb-caption">{STATUS_LABEL[r.status]}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="lb-caption">Free plan limit: 40 emails a day for this project. Anything over waits until the next day.</p>
    </section>
  )
}
