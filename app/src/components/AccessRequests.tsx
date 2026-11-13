import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Badge, Dialog, Icon, useAction } from './ui'
import { friendlyError } from '../lib/errors'
import { levelWords, pageLabel, requestablePages, useAccessRequests, useDraftViewers, useGrants } from '../lib/accessRequests'
import { hodTeamIds, isOwnerOrAdmin, levelFor, type Bundle } from '../lib/project'
import { supabase } from '../lib/supabase'
import type { SectionKey } from '../lib/types'

const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : friendlyError(e))
const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** For people who are not owner or admin: ask for a page they cannot open. */
export function RequestAccessCard({ b, pid }: { b: Bundle; pid: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const act = useAction()
  const reqs = useAccessRequests(pid)
  const mine = (reqs.data ?? []).filter((r) => r.member_id === b.me.id)
  const pending = new Map(mine.filter((r) => r.status === 'pending').map((r) => [r.section, r]))
  const lastDeclined = new Set(mine.filter((r) => r.status === 'declined').map((r) => r.section))
  const pages = requestablePages()   // every section, with what the person holds now
  const [asks, setAsks] = useState<Record<string, 'view' | 'edit'>>({})
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['access-requests', pid] }) }
  async function ask(key: SectionKey, level: 'view' | 'edit') {
    await act.run(async () => { const { error } = await supabase.rpc('request_access', { pid, sec: key, ask: level }); if (error) throw error; refresh() }, errText)
  }
  async function withdraw(id: string) {
    await act.run(async () => { const { error } = await supabase.rpc('withdraw_access_request', { rid: id }); if (error) throw error; refresh() }, errText)
  }
  if (isOwnerOrAdmin(b)) return null
  return (
    <section className="lb-card lb-stack" aria-label="Request access">
      <div className="lb-spread">
        <h2 className="lb-heading" style={{ margin: 0 }}>Request access</h2>
        {pending.size > 0 && <Badge kind="stale">{pending.size} waiting</Badge>}
      </div>
      <p className="lb-caption">See what you can open, and ask for more. The head of your team decides. If you are a head, an admin decides.</p>
      <div className="lb-row"><button className="lb-btn" onClick={() => { act.setError(null); setOpen(true) }}><Icon name="lock" /> Request access</button></div>
      {open && (
        <Dialog title="Request access to a page" onClose={() => setOpen(false)}>
          {act.error && <p className="lb-error" role="alert">{act.error}</p>}
          <ul className="lb-unlist">
            {pages.map((p) => {
              const r = pending.get(p.key)
              const now = levelFor(b, p.key)
              const want = now === 'view' ? 'edit' : (asks[p.key] ?? 'view')
              return (
                <li key={p.key} style={{ justifyContent: 'space-between', minHeight: 44, gap: 12, flexWrap: 'wrap' }}>
                  <span className="lb-stack" style={{ gap: 0 }}>
                    <strong>{p.label}</strong>
                    <span className="lb-caption">{now === 'edit' ? 'You can read and write' : now === 'view' ? 'You can read' : 'No access'}{!r && now !== 'edit' && lastDeclined.has(p.key) ? ' · declined before' : ''}</span>
                  </span>
                  {now === 'edit' ? null : r
                    ? <span className="lb-row"><Badge kind="stale">Asked for {levelWords(r.asked)} {fmt(r.created_at)}</Badge><button className="lb-btn lb-btn--sm" disabled={act.busy} onClick={() => void withdraw(r.id)}>Withdraw</button></span>
                    : (
                      <span className="lb-row">
                        <select className="lb-input" style={{ width: 'auto' }} aria-label={`What to ask for on ${p.label}`} value={want} disabled={now === 'view'} onChange={(e) => setAsks((cur) => ({ ...cur, [p.key]: e.target.value as 'view' | 'edit' }))}>
                          {now === 'none' && <option value="view">Read only</option>}
                          <option value="edit">Read and write</option>
                        </select>
                        <button className="lb-btn lb-btn--sm" disabled={act.busy} onClick={() => void ask(p.key, want)}>Request</button>
                      </span>
                    )}
                </li>
              )
            })}
          </ul>
          <div className="lb-actions"><button className="lb-btn" onClick={() => setOpen(false)}>Close</button></div>
        </Dialog>
      )}
    </section>
  )
}

/** For owner, admins and heads of department: approve or decline page requests; admins can take a personal grant away. */
export function AccessRequestsPanel({ b, pid }: { b: Bundle; pid: string }) {
  const qc = useQueryClient()
  const admin = isOwnerOrAdmin(b)
  const reqs = useAccessRequests(pid)
  const grants = useGrants(pid, admin)
  const act = useAction()
  const nameOf = (mid: string) => b.people.find((p) => p.id === mid)?.name ?? 'Someone'
  const teamOf = (mid: string) => b.memberTeams.filter((l) => l.member_id === mid).map((l) => b.teams.find((t) => t.id === l.team_id)?.name).filter(Boolean).join(', ')
  const waiting = (reqs.data ?? []).filter((r) => r.status === 'pending' && r.member_id !== b.me.id)
  const list = (grants.data ?? []).filter((g) => g.member_id !== b.me.id)
  const refresh = () => { for (const k of ['access-requests', 'grants', 'project']) void qc.invalidateQueries({ queryKey: [k, pid] }) }
  async function decide(id: string, approve: boolean, give: 'view' | 'edit' = 'view') {
    await act.run(async () => { const { error } = await supabase.rpc('decide_access_request', { rid: id, approve, give }); if (error) throw error; refresh() }, errText)
  }
  async function revoke(mid: string, section: SectionKey) {
    await act.run(async () => { const { error } = await supabase.from('member_section_grants').delete().eq('member_id', mid).eq('section', section); if (error) throw error; refresh() }, errText)
  }
  if (!admin && hodTeamIds(b).length === 0) return null
  return (
    <section className="lb-card lb-stack" style={{ padding: 16 }} aria-label="Requests for page access">
      <div className="lb-spread">
        <h2 className="lb-heading" style={{ margin: 0 }}>Requests for page access</h2>
        {waiting.length > 0 && <Badge kind="stale">{waiting.length} waiting</Badge>}
      </div>
      {act.error && <p className="lb-error" role="alert">{act.error}</p>}
      {waiting.length === 0 ? <p className="lb-caption">No one is waiting. When a member asks for a page they appear here.</p> : (
        <ul className="lb-unlist">
          {waiting.map((r) => {
            const canGiveWrite = admin || levelFor(b, r.section) === 'edit'   // a head gives at most what they hold themselves
            return (
              <li key={r.id} style={{ justifyContent: 'space-between' }}>
                <span className="lb-stack" style={{ gap: 2 }}>
                  <strong>{nameOf(r.member_id)} <span className="lb-muted">{teamOf(r.member_id)}</span></strong>
                  <span className="lb-caption">Asks for {levelWords(r.asked)} on {pageLabel(r.section)} on {fmt(r.created_at)}.</span>
                </span>
                <span className="lb-row">
                  <button className={'lb-btn lb-btn--sm' + (r.asked === 'view' || !canGiveWrite ? ' lb-btn--primary' : '')} disabled={act.busy} onClick={() => void decide(r.id, true, 'view')}>Give read only</button>
                  {canGiveWrite && <button className={'lb-btn lb-btn--sm' + (r.asked === 'edit' ? ' lb-btn--primary' : '')} disabled={act.busy} onClick={() => void decide(r.id, true, 'edit')}>Give read and write</button>}
                  <button className="lb-btn lb-btn--sm" disabled={act.busy} onClick={() => void decide(r.id, false)}>Decline</button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {admin && list.length > 0 && (
        <>
          <h3 className="lb-label">Pages given to one person</h3>
          <ul className="lb-unlist">
            {list.map((g) => (
              <li key={g.member_id + g.section} style={{ justifyContent: 'space-between' }}>
                <span>{nameOf(g.member_id)} <span className="lb-muted">has {levelWords(g.level)} access to {pageLabel(g.section)}</span></span>
                <button className="lb-btn lb-btn--sm" disabled={act.busy} onClick={() => void revoke(g.member_id, g.section)}>Remove</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** Admins: who besides the schedule editors may see draft (unlocked) schedules. */
export function ScheduleDrafts({ b, pid }: { b: Bundle; pid: string }) {
  const qc = useQueryClient()
  const q = useDraftViewers(pid)
  const act = useAction()
  const on = new Set((q.data ?? []).map((v) => v.member_id))
  const people = b.people.filter((p) => !p.former && p.role === 'member')
  async function toggle(mid: string, allow: boolean) {
    await act.run(async () => {
      const r = allow ? await supabase.from('schedule_draft_viewers').insert({ member_id: mid, project_id: pid }) : await supabase.from('schedule_draft_viewers').delete().eq('member_id', mid)
      if (r.error) throw r.error
      await qc.invalidateQueries({ queryKey: ['draft-viewers', pid] })
    }, errText)
  }
  const editsSchedule = (mid: string) => b.memberTeams.some((l) => l.member_id === mid && (l.is_hod || l.can_edit) && b.access.some((a) => a.team_id === l.team_id && a.section === 'schedule' && a.level === 'edit'))
  return (
    <section className="lb-box">
      <div className="lb-section-pad lb-stack">
        <h2 className="lb-heading">Who sees draft schedules</h2>
        <p className="lb-caption">Cast and crew see only locked schedules. People who edit the Schedule, the admins always see drafts. Tick anyone else who should see the entire schedule.</p>
        {act.error && <p className="lb-error" role="alert">{act.error}</p>}
      </div>
      {people.length === 0 && <div className="lb-section-pad"><p className="lb-caption">No members yet.</p></div>}
      {people.map((p) => (
        <label key={p.id} className="lb-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', minHeight: 44, cursor: 'pointer' }}>
          <span className="lb-body-strong">{p.name}</span>
          {editsSchedule(p.id)
            ? <span className="lb-caption">Edits the schedule</span>
            : <input type="checkbox" style={{ width: 22, height: 22 }} checked={on.has(p.id)} disabled={act.busy} aria-label={`${p.name} sees draft schedules`} onChange={(e) => void toggle(p.id, e.target.checked)} />}
        </label>
      ))}
    </section>
  )
}
