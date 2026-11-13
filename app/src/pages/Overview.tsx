import { Link, useOutletContext } from 'react-router-dom'
import type { Ctx } from '../components/ProjectLayout'
import { Badge, Banner, EmptyState } from '../components/ui'
import { useBreakdown } from '../lib/breakdown'
import { useCallSheets, canEditSheets } from '../lib/callsheets'
import { isOwner, levelFor, useScenes } from '../lib/project'
import { dayEntries, formatDate, toIso, useScheduleData } from '../lib/schedule'
import { useShots } from '../lib/shots'

export default function Overview() {
  const { b, pid } = useOutletContext<Ctx>()
  const scenes = useScenes(pid)
  const tagged = (useBreakdown(pid).data?.items.length ?? 0) > 0
  const active = scenes.data?.filter((s) => s.status === 'active').length ?? 0
  const total = scenes.data?.length ?? 0
  const others = b.people.filter((p) => !p.former).length
  const sched = useScheduleData(pid).data
  const shots = useShots(pid).data ?? []
  const sheets = useCallSheets(pid, canEditSheets(b)).data
  const today = toIso(new Date())
  // the next shoot day with something on it: the first day from today on, in any schedule
  const days = (sched?.days ?? []).filter((d) => d.day_date >= today).sort((a, z) => a.day_date.localeCompare(z.day_date))
  const next = days.find((d) => dayEntries(d.id, sched?.placements ?? [], sched?.shotPlacements ?? [], shots).length > 0)
  const nextScenes = next ? dayEntries(next.id, sched?.placements ?? [], sched?.shotPlacements ?? [], shots).map((e) => scenes.data?.find((s) => s.id === e.scene_id)).filter((s): s is NonNullable<typeof s> => Boolean(s)) : []
  const nextNo = next ? (sched?.days ?? []).filter((d) => d.schedule_id === next.schedule_id).sort((a, z) => a.day_date.localeCompare(z.day_date)).findIndex((d) => d.id === next.id) + 1 : 0
  const sheet = next ? sheets?.sheets.get(next.id) : undefined
  const published = [...(sheets?.sheets.values() ?? [])].filter((x) => x.rev_no > 0).sort((a, z) => (z.published_at ?? '').localeCompare(a.published_at ?? ''))
  const latest = published[0]
  const latestDay = latest ? sched?.days.find((d) => d.id === latest.day_id) : undefined
  const seesSchedule = levelFor(b, 'schedule') !== 'none', seesSheets = levelFor(b, 'call_sheets') !== 'none'
  const suggestLock = isOwner(b) && !b.project.script_locked && total > 0 && (others > 1 || tagged)

  return (
    <>
      <div className="lb-page-head">
        <h1 className="lb-title">Overview</h1>
        {b.project.script_locked ? <Badge kind="locked">Script locked</Badge> : <Badge kind="plain">Script unlocked</Badge>}
      </div>
      {suggestLock && (
        <Banner lead="Consider locking the script" action={<Link to="script" className="lb-btn lb-btn--sm">Go to the script</Link>}>
          {others > 1 ? 'Other people are on the project.' : 'The breakdown has entries.'} Locking freezes scene numbers so their work stays attached.
        </Banner>
      )}
      <div className="lb-cards">
        <div className="lb-card lb-stack">
          <span className="lb-label">Scenes</span>
          <span className="lb-number-lg">{scenes.isLoading ? '–' : active}</span>
          <span className="lb-caption">{total > active ? `${total - active} omitted · ` : ''}{b.project.script_locked ? 'numbers locked' : 'not numbered until you lock the script'}</span>
        </div>
        <div className="lb-card lb-stack">
          <span className="lb-label">Next shoot day</span>
          {!seesSchedule ? <><span className="lb-heading">Not open to your team</span><span className="lb-caption">The admin can change this in Team and access.</span></>
            : next ? (
              <Link to="schedule" className="lb-tilelink">
                <span className="lb-number-lg">DAY {nextNo}</span>
                <span className="lb-body-strong">{formatDate(next.day_date, true)}{next.location ? ` · ${next.location}` : ''}</span>
                <span className="lb-caption">{nextScenes.length ? `Scenes ${nextScenes.map((x) => x.display_number ?? '–').join(', ')}` : 'No scenes yet'}{seesSheets ? (sheet && sheet.rev_no > 0 ? ` · call sheet revision ${sheet.rev_no}` : ' · no call sheet published') : ''}</span>
              </Link>
            ) : <><span className="lb-heading">Nothing scheduled</span><span className="lb-caption">{(sched?.schedules.length ?? 0) ? 'Place scenes on a shoot day in Schedule.' : 'Create a schedule to plan the shoot days.'}</span></>}
        </div>
        <div className="lb-card lb-stack">
          <span className="lb-label">Latest call sheet</span>
          {!seesSheets ? <><span className="lb-heading">Not open to your team</span><span className="lb-caption">The admin can change this in Team and access.</span></>
            : latest ? (
              <Link to={`callsheets?day=${latest.day_id}`} className="lb-tilelink">
                <span className="lb-number-lg">REV {latest.rev_no}</span>
                <span className="lb-body-strong">{latestDay ? formatDate(latestDay.day_date, true) : 'Shoot day'}</span>
                <span className="lb-caption">Published {latest.published_at ? new Date(latest.published_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</span>
              </Link>
            ) : <><span className="lb-heading">None yet</span><span className="lb-caption">{canEditSheets(b) ? 'Start a call sheet for a shoot day.' : 'When one is published it appears here.'}</span></>}
        </div>
        <div className="lb-card lb-stack">
          <span className="lb-label">Alerts</span>
          {b.project.script_locked ? <span className="lb-heading">All clear</span> : <span className="lb-heading">Script unlocked</span>}
          <span className="lb-caption">{b.project.script_locked ? 'No stale links or changed scenes.' : 'Scenes are not numbered until the script is locked.'}</span>
        </div>
      </div>
      <section className="lb-box">
        <div className="lb-section-pad lb-spread">
          <h2 className="lb-heading">On this project</h2>
          <span className="lb-caption">{others} {others === 1 ? 'person' : 'people'}</span>
        </div>
        {b.people.length === 0 ? <EmptyState title="Nobody yet" /> : b.people.map((p) => {
          const teams = b.memberTeams.filter((l) => l.member_id === p.id).map((l) => b.teams.find((t) => t.id === l.team_id)?.name).filter(Boolean)
          return (
            <div key={p.id} className="lb-tr" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
              <span><span className="lb-body-strong">{p.name}</span> <span className="lb-caption">{teams.join(', ') || 'No team'}</span></span>
              <Badge kind="plain">{p.role === 'member' ? 'Member' : 'Admin'}</Badge>
            </div>
          )
        })}
      </section>
    </>
  )
}
