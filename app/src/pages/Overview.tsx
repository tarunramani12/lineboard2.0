import { Link, useOutletContext } from 'react-router-dom'
import type { Ctx } from '../components/ProjectLayout'
import { Badge } from '../components/ui'
import { useBreakdown } from '../lib/breakdown'
import { useCallSheets, canEditSheets } from '../lib/callsheets'
import { isOwner, levelFor, useScenes } from '../lib/project'
import { dayEntries, formatDate, toIso, useScheduleData } from '../lib/schedule'
import { useShots } from '../lib/shots'
import { PageHeader } from '../components/PageHeader'

/** The basics of the project, the coming shoot days with their call sheets, and anything waiting for this person. */
export default function Overview() {
  const { b, joinPending, accessPending } = useOutletContext<Ctx>()
  const pid = b.project.id
  const scenes = useScenes(pid)
  const tagged = (useBreakdown(pid).data?.items.length ?? 0) > 0
  const active = scenes.data?.filter((s) => s.status === 'active').length ?? 0
  const total = scenes.data?.length ?? 0
  const people = b.people.filter((p) => !p.former).length
  const sched = useScheduleData(pid).data
  const shots = useShots(pid).data ?? []
  const sheets = useCallSheets(pid, canEditSheets(b)).data
  const today = toIso(new Date())
  const seesSchedule = levelFor(b, 'schedule') !== 'none', seesSheets = levelFor(b, 'call_sheets') !== 'none'

  // upcoming shoot days that have something on them, in date order, each with its call sheet
  const upcoming = (sched?.days ?? [])
    .filter((d) => d.day_date >= today && dayEntries(d.id, sched?.placements ?? [], sched?.shotPlacements ?? [], shots).length > 0)
    .sort((a, z) => a.day_date.localeCompare(z.day_date))
    .slice(0, 5)
  const dayNo = (d: NonNullable<typeof sched>['days'][number]) => (sched?.days ?? []).filter((x) => x.schedule_id === d.schedule_id).sort((a, z) => a.day_date.localeCompare(z.day_date)).findIndex((x) => x.id === d.id) + 1

  // anything waiting for this person
  const notes: { key: string; text: string; to: string }[] = []
  if (joinPending > 0) notes.push({ key: 'join', text: `${joinPending} ${joinPending === 1 ? 'request to join' : 'requests to join'} waiting for you`, to: 'team' })
  if (accessPending > 0) notes.push({ key: 'access', text: `${accessPending} ${accessPending === 1 ? 'request' : 'requests'} for page access waiting for you`, to: 'team' })
  if (isOwner(b) && !b.project.script_locked && total > 0 && (people > 1 || tagged)) notes.push({ key: 'lock', text: 'Consider locking the script so scene numbers stay fixed', to: 'script' })

  return (
    <>
      <PageHeader title="Overview" info={b.project.script_locked ? <Badge kind="locked">Script locked</Badge> : <Badge kind="plain">Script unlocked</Badge>} />

      <section className="lb-box lb-stack" aria-label="Notifications" style={{ padding: 16 }}>
        <h2 className="lb-heading" style={{ margin: 0 }}>Notifications {notes.length > 0 && <span className="lb-tag lb-tag--new">{notes.length} NEW</span>}</h2>
        {notes.length === 0
          ? <p className="lb-caption">Nothing is waiting for you.</p>
          : notes.map((n) => <Link key={n.key} to={n.to} className="lb-notice">{n.text}<span aria-hidden="true">›</span></Link>)}
      </section>

      <div className="lb-cards">
        <div className="lb-card lb-stack">
          <span className="lb-label">Scenes</span>
          <span className="lb-number-lg">{scenes.isLoading ? '–' : active}</span>
          <span className="lb-caption">{total > active ? `${total - active} omitted · ` : ''}{b.project.script_locked ? 'numbers locked' : 'not numbered until the script is locked'}</span>
        </div>
      </div>

      <section className="lb-box lb-stack" aria-label="Upcoming shoot days" style={{ padding: 16 }}>
        <h2 className="lb-heading" style={{ margin: 0 }}>Upcoming shoot days</h2>
        {!seesSchedule
          ? <p className="lb-caption">The schedule is not open to your team. The admin can change this in Team and access.</p>
          : upcoming.length === 0
            ? <p className="lb-caption">{(sched?.schedules.length ?? 0) ? 'Nothing is scheduled from today on. Place scenes on a shoot day in Schedule.' : 'No schedule yet.'}</p>
            : upcoming.map((d) => {
              const sheet = sheets?.sheets.get(d.id)
              const ready = Boolean(sheet && sheet.rev_no > 0)
              return (
                <Link key={d.id} to={seesSheets && ready ? `callsheets?day=${d.id}` : 'schedule'} className="lb-notice">
                  <span><b>Day {dayNo(d)}</b> {formatDate(d.day_date, true)}{d.location ? ` · ${d.location}` : ''}</span>
                  {seesSheets && <Badge kind={ready ? 'revised' : 'omitted'}>{ready ? `Call sheet revision ${sheet!.rev_no}` : 'Call sheet not ready'}</Badge>}
                </Link>
              )
            })}
      </section>
    </>
  )
}
