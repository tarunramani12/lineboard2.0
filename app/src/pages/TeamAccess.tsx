import { useState, type FormEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Ctx } from '../components/ProjectLayout'
import { Badge, Dialog, EmptyState, Field, Icon, Permission, rowOpen, useAction } from '../components/ui'
import { friendlyError } from '../lib/errors'
import { kickEmail } from '../lib/email'
import { usePendingJoinRequests, type PendingJoinRequest } from '../lib/joinRequests'
import {
  hodTeamIds, isOwner, isOwnerOrAdmin, useInvitesAndCodes, useScenes, type Bundle, type PersonRow,
} from '../lib/project'
import { SECTION_KEYS, SECTION_LABELS } from '../lib/sections'
import { supabase } from '../lib/supabase'
import type { AccessLevel, SceneAccessMode, Team } from '../lib/types'

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

function useRefresh(pid: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['project', pid] })
    void qc.invalidateQueries({ queryKey: ['invites-codes', pid] })
    void qc.invalidateQueries({ queryKey: ['scene-access', pid] })
  }
}

export default function TeamAccess() {
  const { b, pid } = useOutletContext<Ctx>()
  const admin = isOwnerOrAdmin(b)
  const myHod = hodTeamIds(b)
  const teams = admin ? b.teams : b.teams.filter((t) => myHod.includes(t.id))
  const ic = useInvitesAndCodes(pid, teams.map((t) => t.id), true)

  if (teams.length === 0) {
    return (
      <>
        <div className="lb-page-head"><h1 className="lb-title">Team and access</h1><Permission level="locked" why="No access" /></div>
        <EmptyState title="Team and access is for the owner, admins and heads of department">
          Ask the owner to make you head of department if you need to add people to a team.
        </EmptyState>
      </>
    )
  }
  return (
    <>
      <div className="lb-page-head">
        <h1 className="lb-title">Team and access</h1>
        <Permission level="edit" team={admin ? 'Owner and admins' : 'Your team'} />
      </div>
      {!admin && <p className="lb-caption">You manage your own team. The owner sets what each team can see and who reads which scenes.</p>}
      <JoinRequests pid={pid} />
      {teams.map((t) => <TeamCard key={t.id} team={t} b={b} pid={pid} invites={ic.data?.invites ?? []} codes={ic.data?.codes ?? []} />)}
      {admin && <Matrix b={b} pid={pid} />}
      {admin && <ScriptSharing b={b} pid={pid} />}
    </>
  )
}

function JoinRequests({ pid }: { pid: string }) {
  const qc = useQueryClient()
  const q = usePendingJoinRequests(pid, true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const list = q.data ?? []
  async function decide(r: PendingJoinRequest, approve: boolean) {
    setBusy(r.id); setError(null)
    const { error: e } = await supabase.rpc('decide_join_request', { rid: r.id, approve })
    setBusy(null)
    if (e) setError(friendlyError(e)); else kickEmail()
    for (const k of ['join-requests', 'project', 'castcrew', 'invites-codes']) void qc.invalidateQueries({ queryKey: [k, pid] })
  }
  return (
    <section className="lb-card lb-stack" style={{ padding: 16 }} aria-label="Requests to join">
      <div className="lb-spread">
        <h2 className="lb-heading" style={{ margin: 0 }}>Requests to join</h2>
        {list.length > 0 && <Badge kind="stale">{list.length} waiting</Badge>}
      </div>
      {error && <p className="lb-error" role="alert">{error}</p>}
      {list.length === 0 ? <p className="lb-caption">No one is waiting. When someone enters a join code they appear here, and you approve or decline them.</p> : (
        <ul className="lb-unlist">
          {list.map((r) => (
            <li key={r.id} style={{ justifyContent: 'space-between' }}>
              <span className="lb-stack" style={{ gap: 2 }}>
                <strong>{r.name} <span className="lb-muted">{r.email}</span></strong>
                <span className="lb-caption">Asks to join {r.team_name}{r.role ? ` as ${r.role}` : ''} on {fmt(r.created_at)}. {r.has_hod ? `The head of ${r.team_name} or the owner decides.` : `${r.team_name} has no head of department, so the owner or an admin decides.`}</span>
              </span>
              <span className="lb-row">
                <button className="lb-btn lb-btn--primary lb-btn--sm" disabled={busy === r.id} onClick={() => void decide(r, true)}>Approve</button>
                <button className="lb-btn lb-btn--sm" disabled={busy === r.id} onClick={() => void decide(r, false)}>Decline</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Chips({ p, b, teamId }: { p: PersonRow; b: Bundle; teamId: string }) {
  const link = b.memberTeams.find((l) => l.member_id === p.id && l.team_id === teamId)
  return (
    <span className="lb-row" style={{ gap: 4 }}>
      {p.role !== 'member' && <Badge kind="revised">{p.role}</Badge>}
      {link?.is_hod && <Badge kind="plain">HOD</Badge>}
      {link && !link.is_hod && link.can_edit && <Badge kind="plain">Edit access</Badge>}
    </span>
  )
}

function TeamCard({ team, b, pid, invites, codes }: { team: Team; b: Bundle; pid: string; invites: import('../lib/types').Invite[]; codes: import('../lib/types').JoinCode[] }) {
  const refresh = useRefresh(pid)
  const admin = isOwnerOrAdmin(b)
  const links = b.memberTeams.filter((l) => l.team_id === team.id)
  const members = links.map((l) => b.people.find((p) => p.id === l.member_id)).filter((p): p is PersonRow => Boolean(p))
  const candidates = b.people.filter((p) => !p.former && !links.some((l) => l.member_id === p.id))
  const [managing, setManaging] = useState<PersonRow | null>(null)
  const [addId, setAddId] = useState('')
  const [email, setEmail] = useState('')
  const [days, setDays] = useState('14')
  const [copied, setCopied] = useState<string | null>(null)
  const add = useAction(), inv = useAction(), code = useAction()

  async function addPerson() {
    await add.run(async () => {
      const { error } = await supabase.from('member_teams').insert({ member_id: addId, team_id: team.id })
      if (error) throw error
      setAddId(''); refresh()
    }, friendlyError)
  }
  async function invite(e: FormEvent) {
    e.preventDefault()
    await inv.run(async () => {
      const { error } = await supabase.from('invites').insert({ project_id: pid, team_id: team.id, email: email.trim().toLowerCase(), invited_by: b.me.account_id })
      if (error) throw error
      setEmail(''); refresh()
    }, friendlyError)
  }
  async function newCode() {
    await code.run(async () => {
      const expires = new Date(Date.now() + Number(days) * 86400000).toISOString()
      const { error } = await supabase.from('join_codes').insert({ team_id: team.id, created_by: b.me.account_id, expires_at: expires })
      if (error) throw error
      refresh()
    }, friendlyError)
  }
  const patch = (table: 'invites' | 'join_codes', id: string, op: 'revoke' | 'delete') => code.run(async () => {
    const r = op === 'revoke'
      ? await supabase.from(table).update({ revoked_at: new Date().toISOString() }).eq('id', id)
      : await supabase.from(table).delete().eq('id', id)
    if (r.error) throw r.error
    refresh()
  }, friendlyError)
  async function copy(c: string) {
    try { await navigator.clipboard.writeText(c); setCopied(c); setTimeout(() => setCopied(null), 1500) } catch { /* clipboard unavailable */ }
  }

  const myCodes = codes.filter((c) => c.team_id === team.id).sort((a, z) => z.created_at.localeCompare(a.created_at))
  const myInvites = invites.filter((i) => i.team_id === team.id)
  const now = Date.now()

  return (
    <section className="lb-box">
      <div className="lb-section-pad lb-spread" style={{ borderBottom: '1px solid var(--rule)' }}>
        <h2 className="lb-heading">{team.name}</h2>
        <span className="lb-row">
          {team.is_ad_team && <Badge kind="plain">AD team</Badge>}
          <span className="lb-caption">{members.length} {members.length === 1 ? 'person' : 'people'}</span>
        </span>
      </div>
      {members.length === 0 && <div className="lb-section-pad"><EmptyState title="Nobody on this team yet">Share a join code or send an invite below.</EmptyState></div>}
      {members.map((p) => (
        <div key={p.id} className="lb-tr is-click" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }} {...rowOpen(() => setManaging(p))}>
          <button type="button" className="lb-shotdesc lb-body-strong" style={{ overflowWrap: 'anywhere' }} onClick={() => setManaging(p)} aria-label={`Manage ${p.name}`}>{p.name}</button>
          <Chips p={p} b={b} teamId={team.id} />
        </div>
      ))}
      {candidates.length > 0 && (
        <div className="lb-section-pad lb-row">
          <select className="lb-input" style={{ maxWidth: 260 }} aria-label={`Add a person to ${team.name}`} value={addId} onChange={(e) => setAddId(e.target.value)}>
            <option value="">Add someone from this project</option>
            {candidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="lb-btn" disabled={!addId || add.busy} onClick={addPerson}>Add to team</button>
          {add.error && <span className="lb-error" role="alert">{add.error}</span>}
        </div>
      )}

      <div className="lb-section-pad lb-stack" style={{ borderTop: '1px solid var(--rule)' }}>
        <div className="lb-spread">
          <span className="lb-label">Join codes</span>
          <span className="lb-row">
            <select className="lb-input" style={{ width: 130, minHeight: 36 }} aria-label="Code lasts" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="1">Lasts 1 day</option><option value="7">Lasts 7 days</option><option value="14">Lasts 14 days</option><option value="30">Lasts 30 days</option>
            </select>
            <button className="lb-btn lb-btn--sm" onClick={newCode} disabled={code.busy}><Icon name="plus" /> New code</button>
          </span>
        </div>
        <p className="lb-caption">Someone who enters a code asks to join and chooses their team. {team.name} is chosen for them at first. The head of the team they choose, or the owner, approves the request. They then join as a read-only member, and only the owner or head of department can give them edit access.</p>
        {code.error && <p className="lb-error" role="alert">{code.error}</p>}
        {myCodes.length === 0 && <p className="lb-caption">No codes yet.</p>}
        {myCodes.map((c) => {
          const dead = Boolean(c.revoked_at) || new Date(c.expires_at).getTime() < now
          return (
            <div key={c.id} className="lb-row" style={{ justifyContent: 'space-between' }}>
              <span className="lb-row">
                <span className="lb-body-strong" style={{ letterSpacing: '.15em', fontSize: 18, opacity: dead ? .5 : 1 }}>{c.code}</span>
                {c.revoked_at ? <Badge kind="omitted">Revoked</Badge> : dead ? <Badge kind="omitted">Expired</Badge> : <span className="lb-caption">expires {fmt(c.expires_at)}</span>}
              </span>
              {!dead && (
                <span className="lb-row">
                  <button className="lb-btn lb-btn--sm" onClick={() => copy(c.code)}><Icon name={copied === c.code ? 'check' : 'copy'} /> {copied === c.code ? 'Copied' : 'Copy'}</button>
                  <button className="lb-btn lb-btn--sm lb-btn--danger" onClick={() => patch('join_codes', c.id, 'revoke')}>Revoke</button>
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="lb-section-pad lb-stack" style={{ borderTop: '1px solid var(--rule)' }}>
        <span className="lb-label">Email invites</span>
        <form className="lb-row" onSubmit={invite} style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 200 }}><Field label="Email address" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button className="lb-btn" disabled={inv.busy || !email.trim()}>Invite</button>
        </form>
        <p className="lb-caption">An invite is tied to one address. When that person signs up or signs in with it, they land in {team.name}. Sending the email itself is not built yet, so tell them to sign up with this address.</p>
        {inv.error && <p className="lb-error" role="alert">{inv.error}</p>}
        {myInvites.map((i) => (
          <div key={i.id} className="lb-row" style={{ justifyContent: 'space-between' }}>
            <span>{i.email} <span className="lb-caption">· waiting · expires {fmt(i.expires_at)}</span></span>
            <button className="lb-btn lb-btn--sm" onClick={() => patch('invites', i.id, 'delete')}>Cancel invite</button>
          </div>
        ))}
      </div>

      {managing && <PersonDialog p={managing} team={team} b={b} pid={pid} onClose={() => setManaging(null)} admin={admin} />}
      {admin && (
        <div className="lb-section-pad" style={{ borderTop: '1px solid var(--rule)' }}>
          <AdToggle team={team} pid={pid} />
        </div>
      )}
    </section>
  )
}

function AdToggle({ team, pid }: { team: Team; pid: string }) {
  const refresh = useRefresh(pid)
  const act = useAction()
  return (
    <div className="lb-row">
      <button className="lb-btn lb-btn--sm" disabled={act.busy} onClick={() => act.run(async () => {
        const { error } = await supabase.from('teams').update({ is_ad_team: !team.is_ad_team }).eq('id', team.id)
        if (error) throw error
        refresh()
      }, friendlyError)}>{team.is_ad_team ? 'Not the AD team' : 'Mark as the AD team'}</button>
      <span className="lb-caption">The AD team publishes call sheets and changes shot status, through the people its head of department gives edit access.</span>
      {act.error && <span className="lb-error" role="alert">{act.error}</span>}
    </div>
  )
}

function PersonDialog({ p, team, b, pid, onClose, admin }: { p: PersonRow; team: Team; b: Bundle; pid: string; onClose: () => void; admin: boolean }) {
  const refresh = useRefresh(pid)
  const act = useAction()
  const owner = isOwner(b)
  const link = b.memberTeams.find((l) => l.member_id === p.id && l.team_id === team.id)!
  const isSelf = p.id === b.me.id
  async function go(fn: () => PromiseLike<{ error: unknown }>, close = false) {
    const ok = await act.run(async () => { const r = await fn(); if (r.error) throw r.error; return true }, friendlyError)
    if (ok) { refresh(); if (close) onClose() }
  }
  return (
    <Dialog title={p.name} onClose={onClose}>
      <p>{team.name}. {p.role === 'owner' ? 'Owner of the project.' : p.role === 'admin' ? 'Admin: sees and edits everything except deleting the project.' : link.is_hod ? 'Head of department.' : link.can_edit ? 'Has edit access in this team.' : 'Read-only member.'}</p>
      {act.error && <p className="lb-error" role="alert">{act.error}</p>}
      <div className="lb-stack">
        {!link.is_hod && p.role === 'member' && (
          <button className="lb-btn" disabled={act.busy} onClick={() => go(() => supabase.from('member_teams').update({ can_edit: !link.can_edit }).eq('member_id', p.id).eq('team_id', team.id))}>
            <Icon name="pencil" /> {link.can_edit ? 'Remove edit access' : 'Give edit access'}
          </button>
        )}
        {link.can_edit || link.is_hod ? <p className="lb-caption">Edit access lets this person change the sections your team can edit.</p> : <p className="lb-caption">Giving edit access lets them change the sections this team can edit. They stay read-only everywhere else.</p>}
        {admin && p.role === 'member' && (
          <button className="lb-btn" disabled={act.busy} onClick={() => go(() => supabase.from('member_teams').update({ is_hod: !link.is_hod }).eq('member_id', p.id).eq('team_id', team.id))}>
            {link.is_hod ? 'Remove as head of department' : 'Make head of department'}
          </button>
        )}
        {owner && p.role === 'member' && (
          <button className="lb-btn" disabled={act.busy} onClick={() => go(() => supabase.from('members').update({ role: 'admin' }).eq('id', p.id))}>Make admin</button>
        )}
        {owner && p.role === 'admin' && (
          <button className="lb-btn" disabled={act.busy} onClick={() => go(() => supabase.from('members').update({ role: 'member' }).eq('id', p.id))}>Remove admin rights</button>
        )}
        {p.role !== 'owner' && (
          <button className="lb-btn lb-btn--danger" disabled={act.busy} onClick={() => go(() => supabase.from('member_teams').delete().eq('member_id', p.id).eq('team_id', team.id), true)}>Remove from {team.name}</button>
        )}
        {admin && p.role !== 'owner' && !isSelf && (
          <button className="lb-btn lb-btn--danger" disabled={act.busy} onClick={() => go(() => supabase.from('members').delete().eq('id', p.id), true)}>Remove from the project</button>
        )}
      </div>
      <div className="lb-actions"><button className="lb-btn" onClick={onClose}>Done</button></div>
    </Dialog>
  )
}

function Matrix({ b, pid }: { b: Bundle; pid: string }) {
  const refresh = useRefresh(pid)
  const act = useAction()
  const [name, setName] = useState('')
  async function setLevel(teamId: string, section: string, level: AccessLevel) {
    await act.run(async () => {
      const { error } = await supabase.from('team_section_access').update({ level }).eq('team_id', teamId).eq('section', section)
      if (error) throw error
      refresh()
    }, friendlyError)
  }
  async function addTeam(e: FormEvent) {
    e.preventDefault()
    await act.run(async () => {
      const { data, error } = await supabase.from('teams').insert({ project_id: pid, name: name.trim() }).select('id').single()
      if (error) throw error
      const rows = SECTION_KEYS.map((section) => ({ team_id: data.id as string, section, level: ((['schedule', 'call_sheets', 'cast_crew'] as string[]).includes(section) ? 'view' : 'none') as AccessLevel }))
      const r = await supabase.from('team_section_access').insert(rows)
      if (r.error) throw r.error
      setName(''); refresh()
    }, friendlyError)
  }
  const cols = `150px repeat(${SECTION_KEYS.length}, minmax(96px, 1fr))`
  return (
    <section className="lb-box">
      <div className="lb-section-pad lb-stack">
        <h2 className="lb-heading">What each team can see</h2>
        <p className="lb-caption">None hides the section's contents, View lets the team read it, Edit lets the head of department and people they give edit access change it. Everyone always sees scene numbers and headings.</p>
        {act.error && <p className="lb-error" role="alert">{act.error}</p>}
      </div>
      <div className="lb-scroll-x">
        <div className="lb-matrix" style={{ gridTemplateColumns: cols }}>
          <div className="lb-mh">Team</div>
          {SECTION_KEYS.map((k) => <div key={k} className="lb-mh">{SECTION_LABELS[k]}</div>)}
          {b.teams.map((t) => (
            <div key={t.id} style={{ display: 'contents' }}>
              <div className="lb-body-strong">{t.name}</div>
              {SECTION_KEYS.map((k) => {
                const lvl = b.access.find((a) => a.team_id === t.id && a.section === k)?.level ?? 'none'
                return (
                  <div key={k}>
                    <select className="lb-input" aria-label={`${t.name}, ${SECTION_LABELS[k]}`} value={lvl} onChange={(e) => setLevel(t.id, k, e.target.value as AccessLevel)}>
                      <option value="none">None</option><option value="view">View</option><option value="edit">Edit</option>
                    </select>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <form className="lb-section-pad lb-row" onSubmit={addTeam} style={{ borderTop: '1px solid var(--rule)', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 200 }}><Field label="New team" value={name} onChange={(e) => setName(e.target.value)} placeholder="Stunts" /></div>
        <button className="lb-btn" disabled={act.busy || !name.trim()}><Icon name="plus" /> Add team</button>
      </form>
    </section>
  )
}

function ScriptSharing({ b, pid }: { b: Bundle; pid: string }) {
  const refresh = useRefresh(pid)
  const scenes = useScenes(pid)
  const people = b.people.filter((p) => !p.former && p.role === 'member')
  const q = useQuery({
    queryKey: ['scene-access', pid],
    queryFn: async () => {
      const ids = people.map((p) => p.id)
      const [a, s] = await Promise.all([
        supabase.from('scene_access').select('member_id, mode').in('member_id', ids),
        supabase.from('scene_access_scenes').select('member_id, scene_id').in('member_id', ids),
      ])
      if (a.error) throw a.error
      if (s.error) throw s.error
      return {
        mode: new Map((a.data ?? []).map((r) => [r.member_id as string, r.mode as SceneAccessMode])),
        scenes: (s.data ?? []) as { member_id: string; scene_id: string }[],
      }
    },
    enabled: people.length > 0,
  })
  const [who, setWho] = useState<PersonRow | null>(null)
  const [mode, setMode] = useState<SceneAccessMode>('none')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const act = useAction()
  const [tagTeam, setTagTeam] = useState('')
  const [tagNote, setTagNote] = useState<string | null>(null)
  /** One step: tick every scene this team is tagged on in the breakdown. */
  async function addTagged() {
    setTagNote(null)
    const { data, error } = await supabase.from('breakdown_items').select('scene_id').eq('project_id', pid).or(`team_id.eq.${tagTeam},ref_team_id.eq.${tagTeam}`)
    if (error) { act.setError(friendlyError(error)); return }
    const ids = [...new Set((data ?? []).map((r) => r.scene_id as string))]
    setPicked((cur) => new Set([...cur, ...ids]))
    setTagNote(ids.length ? `${ids.length} ${ids.length === 1 ? 'scene' : 'scenes'} picked.` : 'That team is not tagged on any scene yet.')
  }

  function open(p: PersonRow) {
    setWho(p); act.setError(null)
    setMode(q.data?.mode.get(p.id) ?? 'none')
    setPicked(new Set(q.data?.scenes.filter((s) => s.member_id === p.id).map((s) => s.scene_id)))
  }
  async function save() {
    if (!who) return
    const ok = await act.run(async () => {
      const a = await supabase.from('scene_access').upsert({ member_id: who.id, mode })
      if (a.error) throw a.error
      const d = await supabase.from('scene_access_scenes').delete().eq('member_id', who.id)
      if (d.error) throw d.error
      if (mode === 'selected' && picked.size) {
        const i = await supabase.from('scene_access_scenes').insert([...picked].map((scene_id) => ({ member_id: who.id, scene_id })))
        if (i.error) throw i.error
      }
      return true
    }, friendlyError)
    if (ok) { refresh(); setWho(null) }
  }
  const label = (p: PersonRow) => {
    const m = q.data?.mode.get(p.id) ?? 'none'
    if (m === 'all') return 'Entire script'
    if (m === 'selected') return `${q.data?.scenes.filter((s) => s.member_id === p.id).length ?? 0} scenes`
    return 'No script text'
  }

  return (
    <section className="lb-box">
      <div className="lb-section-pad lb-stack">
        <h2 className="lb-heading">Who reads the script</h2>
        <p className="lb-caption">Everyone sees scene numbers and headings. Action and dialogue show only to the owner, admins and people you choose here. A scene added later, such as 42A, is not shared automatically with people who hold selected scenes.</p>
      </div>
      {people.length === 0 && <div className="lb-section-pad"><EmptyState title="No members yet">People who join as members appear here.</EmptyState></div>}
      {people.map((p) => (
        <div key={p.id} className="lb-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
          <span className="lb-body-strong">{p.name}</span>
          <span className="lb-caption">{label(p)}</span>
          <button className="lb-btn lb-btn--sm" onClick={() => open(p)}>Change</button>
        </div>
      ))}
      {who && (
        <Dialog title={`Script access for ${who.name}`} onClose={() => setWho(null)}>
          <div className="lb-stack" role="radiogroup" aria-label="Script access">
            {([['none', 'No script text'], ['selected', 'Selected scenes'], ['all', 'The entire script']] as const).map(([v, l]) => (
              <button key={v} type="button" className="lb-choice" role="radio" aria-checked={mode === v} onClick={() => setMode(v)}>{l}</button>
            ))}
          </div>
          {mode === 'selected' && (
            <div className="lb-row">
              <select className="lb-input" style={{ width: 'auto' }} aria-label="Pick every scene a team is tagged on" value={tagTeam} onChange={(e) => setTagTeam(e.target.value)}>
                <option value="">Scenes tagged in the breakdown by…</option>
                {b.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button type="button" className="lb-btn lb-btn--sm" disabled={!tagTeam} onClick={addTagged}>Pick these scenes</button>
              {tagNote && <span className="lb-caption" role="status">{tagNote}</span>}
            </div>
          )}
          {mode === 'selected' && (
            <div className="lb-stack" style={{ maxHeight: 240, overflowY: 'auto' }}>
              {(scenes.data ?? []).length === 0 && <p className="lb-caption">There are no scenes to pick yet.</p>}
              {(scenes.data ?? []).map((s) => (
                <label key={s.id} className="lb-row" style={{ minHeight: 44 }}>
                  <input type="checkbox" style={{ width: 20, height: 20 }} checked={picked.has(s.id)}
                    onChange={() => setPicked((cur) => { const n = new Set(cur); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n })} />
                  <span className="lb-scene">{s.display_number}</span> <span className="lb-caption">{s.heading}</span>
                </label>
              ))}
            </div>
          )}
          {act.error && <p className="lb-error" role="alert">{act.error}</p>}
          <div className="lb-actions">
            <button className="lb-btn" onClick={() => setWho(null)}>Cancel</button>
            <button className="lb-btn lb-btn--primary" disabled={act.busy} onClick={save}>Save access</button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
