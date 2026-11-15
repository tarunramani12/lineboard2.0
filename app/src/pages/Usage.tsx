import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { friendlyError } from '../lib/errors'
import { agoText, bytesText, supabaseRef, useIsAppAdmin, useOverview, useUsagePeople, useUsageProjects, type Overview } from '../lib/usage'
import { AccountBar } from './Account'
import { PageHeader } from '../components/PageHeader'

/** Free plan file storage, from the hosting notes (100 GB on the Pro plan). Shown so the owner sees how close the app is. */
const FREE_FILE_BYTES = 1073741824

function Tile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="lb-card">
      <span className="lb-label">{label}</span>
      <span className="lb-heading">{value}</span>
      {note && <span className="lb-caption">{note}</span>}
    </div>
  )
}

function Totals({ o }: { o: Overview }) {
  const used = Math.min(100, Math.round((o.storage_bytes / FREE_FILE_BYTES) * 100))
  return (
    <>
      <section className="lb-stack" aria-label="People">
        <h2 className="lb-heading">People</h2>
        <div className="lb-cards">
          <Tile label="Accounts" value={o.accounts} note={`${o.accounts_new_7d} new this week, ${o.accounts_new_30d} this month`} />
          <Tile label="Signed in, last 7 days" value={o.accounts_active_7d} note={`${o.accounts_active_30d} in the last 30 days`} />
          <Tile label="People in projects" value={o.people_in_projects} note={`${o.memberships} memberships in all`} />
          <Tile label="Project owners" value={o.owners} note={`${o.avg_projects_per_owner} projects each on average`} />
          <Tile label="Admins" value={o.admins} note="People who are admin of at least one project" />
        </div>
      </section>
      <section className="lb-stack" aria-label="Projects">
        <h2 className="lb-heading">Projects</h2>
        <div className="lb-cards">
          <Tile label="Projects" value={o.projects} note={`${o.projects_active_30d} used in the last 30 days`} />
          <Tile label="People per project" value={o.avg_people_per_project} note={`most in one project: ${o.max_people_in_a_project}`} />
          <Tile label="Script locked" value={o.projects_script_locked} note={`${o.projects_read_only} read only`} />
          <Tile label="Scenes" value={o.scenes} note={`${o.shots} shots, ${o.storyboard_frames} storyboard frames`} />
          <Tile label="Cast and crew rows" value={o.cast_crew_rows} note={`${o.locations} locations, ${o.schedules} schedules, ${o.call_sheets} call sheets`} />
        </div>
      </section>
      <section className="lb-stack" aria-label="Storage and email">
        <h2 className="lb-heading">Storage and email</h2>
        <div className="lb-cards">
          <Tile label="Files stored" value={bytesText(o.storage_bytes)} note={`${o.storage_files} files, ${used}% of the 1 GB free plan (100 GB on Pro)`} />
          {Object.entries(o.storage_by_bucket).map(([b, n]) => (
            <Tile key={b} label={`Storage: ${b}`} value={bytesText(n)} />
          ))}
          <Tile label="Emails sent, 30 days" value={o.emails_sent_30d} note="The free sending plan allows 3,000 a month" />
          <Tile label="Emails waiting or failed" value={`${o.emails_waiting} / ${o.emails_failed}`} note="Waiting / could not send" />
          <Tile label="Requests to join waiting" value={o.join_requests_waiting} />
        </div>
      </section>
    </>
  )
}

export default function Usage() {
  const { user } = useAuth()
  const admin = useIsAppAdmin(user?.id)
  const ok = admin.data === true
  const overview = useOverview(ok)
  const projects = useUsageProjects(ok)
  const people = useUsagePeople(ok)
  const ref = supabaseRef(import.meta.env.VITE_SUPABASE_URL)

  if (admin.isLoading) return <><AccountBar back /><main className="lb-account lb-account--wide"><p className="lb-caption">Loading</p></main></>
  if (!ok) return <Navigate to="/" replace />

  return (
    <>
      <AccountBar back />
      <main className="lb-account lb-account--wide">
        <PageHeader title="Usage" info={overview.data ? <span>Updated {agoText(overview.data.generated_at)}</span> : undefined} />
        {overview.isError && <p className="lb-error" role="alert">{friendlyError(overview.error)}</p>}
        {overview.isLoading && <p className="lb-caption">Loading the totals</p>}
        {overview.data && <Totals o={overview.data} />}

        <section className="lb-stack" aria-label="Cost">
          <h2 className="lb-heading">Cost and egress</h2>
          <p className="lb-caption">
            The Supabase bill and the data downloaded (egress) cannot be read from inside the app, and Supabase does not give a figure per person.
            Open the usage page to see the real numbers
            {ref ? <> (<a href={`https://supabase.com/dashboard/project/${ref}`} target="_blank" rel="noreferrer">Supabase dashboard</a>, then Settings, Usage)</> : ''}.
            Tracking egress per person is a later step.
          </p>
        </section>

        <section className="lb-stack" aria-label="Projects list">
          <h2 className="lb-heading">All projects</h2>
          {projects.isError && <p className="lb-error" role="alert">{friendlyError(projects.error)}</p>}
          <div className="lb-dtable-wrap">
            <table className="lb-dtable">
              <thead><tr><th>Project</th><th>Owner</th><th>People</th><th>Admins</th><th>Scenes</th><th>Shots</th><th>Frames</th><th>Files</th><th>Last used</th></tr></thead>
              <tbody>
                {(projects.data ?? []).map((p) => (
                  <tr key={p.project_id}>
                    <td>{p.name}{p.status === 'read_only' ? ' (read only)' : ''}</td>
                    <td>{p.owner_name || p.owner_email}<span className="lb-caption"> {p.owner_name ? p.owner_email : ''}</span></td>
                    <td>{p.people}</td><td>{p.admins}</td><td>{p.scenes}</td><td>{p.shots}</td><td>{p.frames}</td>
                    <td>{bytesText(Number(p.storage_bytes))} of {p.image_cap_mb} MB</td>
                    <td>{agoText(p.last_active_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lb-stack" aria-label="People list">
          <h2 className="lb-heading">All accounts</h2>
          {people.isError && <p className="lb-error" role="alert">{friendlyError(people.error)}</p>}
          <div className="lb-dtable-wrap">
            <table className="lb-dtable">
              <thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Last signed in</th><th>Owns</th><th>Admin of</th><th>Member of</th><th>Files in own projects</th></tr></thead>
              <tbody>
                {(people.data ?? []).map((p) => (
                  <tr key={p.account_id}>
                    <td>{p.display_name || 'No name'}</td><td>{p.email}</td>
                    <td>{agoText(p.created_at)}</td><td>{agoText(p.last_sign_in_at)}</td>
                    <td>{p.projects_owned}</td><td>{p.projects_admin}</td><td>{p.projects_member}</td>
                    <td>{bytesText(Number(p.storage_bytes))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <p><Link to="/" className="lb-btn">Back to projects</Link></p>
      </main>
    </>
  )
}
