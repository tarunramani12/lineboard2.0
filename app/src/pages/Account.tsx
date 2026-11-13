import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { passwordProblem, useAuth } from '../lib/auth'
import { friendlyError } from '../lib/errors'
import { kickEmail } from '../lib/email'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { Badge, Banner, Choice, Dialog, EmptyState, Field, Icon, Wordmark, useAction, useOnline } from '../components/ui'
import { CREW_ROLES } from '../lib/castcrew'
import { useMyJoinRequests, whoDecides, type CodeLookup } from '../lib/joinRequests'
import { DEPARTMENT_ORDER } from '../lib/sections'

export function AuthFrame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="lb-account">
      <div className="lb-stack" style={{ alignItems: 'flex-start' }}>
        <Wordmark large />
        <p className="lb-caption">From script to call sheet, shared with the crew.</p>
      </div>
      <div className="lb-card lb-card--zebra lb-stack" style={{ padding: 24 }}>
        <h1 className="lb-heading">{title}</h1>
        {!supabaseConfigured && (
          <Banner kind="alert" lead="Not connected">The app has no backend address. Add it to app/.env.local.</Banner>
        )}
        {children}
      </div>
      {footer && <div className="lb-caption" style={{ textAlign: 'center' }}>{footer}</div>}
    </main>
  )
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <main className="lb-account"><p className="lb-caption">Loading</p></main>
  if (!user) return <Navigate to="/signin" replace state={{ from: loc.pathname + loc.search }} />
  return <>{children}</>
}

export function SignIn() {
  const { user } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const from = (loc.state as { from?: string } | null)?.from || '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, run } = useAction()
  useEffect(() => { if (user) nav(from, { replace: true }) }, [user, from, nav])

  async function submit(e: FormEvent) {
    e.preventDefault()
    await run(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw error
    }, friendlyError)
  }
  return (
    <AuthFrame title="Sign in" footer={<>New here? <Link to="/signup" className="lb-body-strong">Create an account</Link></>}>
      <form className="lb-stack" onSubmit={submit}>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="lb-error" role="alert">{error}</p>}
        <button className="lb-btn lb-btn--primary lb-btn--block" disabled={busy}>{busy ? 'Signing in' : 'Sign in'}</button>
        <Link to="/forgot" className="lb-caption">Forgot your password?</Link>
      </form>
    </AuthFrame>
  )
}

export function SignUp() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [touched, setTouched] = useState(false)
  const { busy, error, run } = useAction()
  useEffect(() => { if (user) nav('/', { replace: true }) }, [user, nav])
  const pwProblem = touched ? passwordProblem(password) : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (passwordProblem(password)) return
    await run(async () => {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password,
        options: { data: { display_name: name.trim() }, emailRedirectTo: window.location.origin + '/' },
      })
      if (error) throw error
      // No session means the email must be confirmed first.
      if (!data.session) setSent(true)
    }, friendlyError)
  }

  if (sent) {
    return (
      <AuthFrame title="Check your email" footer={<Link to="/signin" className="lb-body-strong">Back to sign in</Link>}>
        <p>We sent a link to <b>{email.trim()}</b>. Open it to confirm your address, then sign in.</p>
        <p className="lb-caption">No message after a few minutes? Check spam, or try again.</p>
      </AuthFrame>
    )
  }
  return (
    <AuthFrame title="Create an account" footer={<>Already have one? <Link to="/signin" className="lb-body-strong">Sign in</Link></>}>
      <form className="lb-stack" onSubmit={submit}>
        <Field label="Full name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          hint="If someone invited you, use the address they invited." />
        <Field label="Password" type="password" autoComplete="new-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} error={pwProblem} hint="At least 8 characters, with a letter and a number." />
        {error && <p className="lb-error" role="alert">{error}</p>}
        <button className="lb-btn lb-btn--primary lb-btn--block" disabled={busy}>{busy ? 'Creating account' : 'Create account'}</button>
      </form>
    </AuthFrame>
  )
}

export function Forgot() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const { busy, error, run } = useAction()
  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await run(async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/reset' })
      if (error) throw error
      return true
    }, friendlyError)
    if (ok) setSent(true)
  }
  return (
    <AuthFrame title="Reset your password" footer={<Link to="/signin" className="lb-body-strong">Back to sign in</Link>}>
      {sent ? (
        <p>If an account exists for <b>{email.trim()}</b>, a reset link is on its way. Open it on this device.</p>
      ) : (
        <form className="lb-stack" onSubmit={submit}>
          <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <p className="lb-error" role="alert">{error}</p>}
          <button className="lb-btn lb-btn--primary lb-btn--block" disabled={busy}>{busy ? 'Sending' : 'Send reset link'}</button>
        </form>
      )}
    </AuthFrame>
  )
}

export function Reset() {
  const { user, recovering, loading } = useAuth()
  const nav = useNavigate()
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const { busy, error, run } = useAction()
  const problem = password ? passwordProblem(password) : null
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (passwordProblem(password)) return
    const ok = await run(async () => {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      return true
    }, friendlyError)
    if (ok) { setDone(true); setTimeout(() => nav('/', { replace: true }), 1200) }
  }
  if (loading) return <AuthFrame title="Reset your password"><p className="lb-caption">Loading</p></AuthFrame>
  if (!user || !recovering) {
    return (
      <AuthFrame title="Reset your password" footer={<Link to="/forgot" className="lb-body-strong">Send a new link</Link>}>
        <p>Open the link from your reset email on this device. If it has expired, ask for a new one.</p>
      </AuthFrame>
    )
  }
  return (
    <AuthFrame title="Choose a new password">
      {done ? <p>Password changed. Taking you to your projects.</p> : (
        <form className="lb-stack" onSubmit={submit}>
          <Field label="New password" type="password" autoComplete="new-password" required value={password}
            onChange={(e) => setPassword(e.target.value)} error={problem} hint="At least 8 characters, with a letter and a number." />
          {error && <p className="lb-error" role="alert">{error}</p>}
          <button className="lb-btn lb-btn--primary lb-btn--block" disabled={busy || Boolean(problem)}>Save password</button>
        </form>
      )}
    </AuthFrame>
  )
}

export function AccountBar({ back }: { back?: boolean }) {
  const { user } = useAuth()
  const online = useOnline()
  return (
    <>
      <header className="lb-topbar">
        <span className="lb-stripes" aria-hidden="true" />
        {back && <Link to="/" className="lb-topback lb-phone-only" aria-label="All projects"><Icon name="chev" /></Link>}
        <Link to="/" style={{ textDecoration: 'none' }} aria-label="LineBoard, all projects"><Wordmark onDark /></Link>
        <div className="lb-grow" />
        {back && <Link to="/" className="lb-btn lb-btn--sm lb-phone-hide">All projects</Link>}
        <Link to="/settings" className="lb-btn lb-btn--sm lb-phone-hide">{user?.email ?? 'Account'}</Link>
        <Link to="/settings" className="lb-avatar lb-phone-only" aria-label="Account">{(user?.email ?? '?').charAt(0).toUpperCase()}</Link>
      </header>
      {!online && <Banner kind="quiet" lead="Offline">You can read what you opened before. Editing needs a connection.</Banner>}
    </>
  )
}

interface ProjectRow { id: string; role: string; projects: { id: string; name: string; status: string; script_locked: boolean } | null }

export function Projects() {
  const { user } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const { busy, error, run, setError } = useAction()
  const waiting = useMyJoinRequests(user?.id)
  const list = useQuery({
    queryKey: ['my-projects', user?.id],
    enabled: Boolean(user),
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('members').select('id, role, projects(id, name, status, script_locked)').eq('account_id', user!.id)
      if (error) throw error
      return (data as unknown as ProjectRow[]).filter((r) => r.projects)
    },
  })

  async function create(e: FormEvent) {
    e.preventDefault()
    const id = await run(async () => {
      const { data, error } = await supabase.rpc('create_project', { project_name: name })
      if (error) throw error
      return data as string
    }, friendlyError)
    if (id) { void qc.invalidateQueries({ queryKey: ['my-projects'] }); nav('/p/' + id) }
  }

  return (
    <>
      <AccountBar />
      <main className="lb-account lb-account--wide">
        <div className="lb-page-head">
          <h1 className="lb-title">Projects</h1>
          <div className="lb-row">
            <Link to="/join" className="lb-btn">Join with a code</Link>
            <button className="lb-btn lb-btn--primary" onClick={() => { setCreating(true); setError(null) }}><Icon name="plus" /> New project</button>
          </div>
        </div>
        {list.isLoading && <p className="lb-caption">Loading your projects</p>}
        {list.isError && <p className="lb-error" role="alert">{friendlyError(list.error)}</p>}
        {(waiting.data ?? []).length > 0 && (
          <section className="lb-stack" aria-label="Requests to join">
            <h2 className="lb-heading">Requests to join</h2>
            <div className="lb-cards">
              {waiting.data!.map((r) => (
                <div key={r.id} className="lb-box lb-link-card">
                  <span className="lb-heading">{r.project_name}</span>
                  <span className="lb-row">
                    <Badge kind={r.status === 'pending' ? 'stale' : 'omitted'}>{r.status === 'pending' ? 'Waiting for approval' : 'Declined'}</Badge>
                    <Badge kind="plain">{r.team_name}</Badge>
                  </span>
                  <span className="lb-caption">{r.status === 'pending' ? `${whoDecides(r)[0].toUpperCase()}${whoDecides(r).slice(1)} will answer.` : 'Your request was not approved. You can ask again with the code.'}</span>
                  {r.status === 'pending' && <button className="lb-btn lb-btn--sm" onClick={async () => { await supabase.rpc('withdraw_join_request', { rid: r.id }); void qc.invalidateQueries({ queryKey: ['my-join-requests'] }) }}>Withdraw request</button>}
                </div>
              ))}
            </div>
          </section>
        )}
        {list.data && list.data.length === 0 && (waiting.data ?? []).length === 0 && (
          <EmptyState title="No projects yet" action={<button className="lb-btn lb-btn--primary" onClick={() => setCreating(true)}>Create your first project</button>}>
            Create a project to start planning, or join one with a code or an email invite.
          </EmptyState>
        )}
        <div className="lb-cards">
          {list.data?.map((r) => (
            <Link key={r.id} to={'/p/' + r.projects!.id} className="lb-box lb-link-card">
              <span className="lb-heading">{r.projects!.name}</span>
              <span className="lb-row">
                <Badge kind="plain">{r.role}</Badge>
                {r.projects!.script_locked && <Badge kind="locked">Script locked</Badge>}
                {r.projects!.status !== 'active' && <Badge kind="omitted">Read only</Badge>}
              </span>
            </Link>
          ))}
        </div>
      </main>
      {creating && (
        <Dialog title="New project" onClose={() => setCreating(false)}>
          <p>You become the admin. Ten department teams are created for you, and you choose what each can see.</p>
          <form className="lb-stack" onSubmit={create}>
            <Field label="Project name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            {error && <p className="lb-error" role="alert">{error}</p>}
            <div className="lb-actions">
              <button type="button" className="lb-btn" onClick={() => setCreating(false)}>Cancel</button>
              <button className="lb-btn lb-btn--primary" disabled={busy || !name.trim()}>Create project</button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  )
}

export function Join() {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [found, setFound] = useState<CodeLookup | null>(null)
  const [team, setTeam] = useState('')
  const [role, setRole] = useState('')
  const [sent, setSent] = useState<{ project: string; team: string; hod: boolean } | null>(null)
  const { busy, error, run } = useAction()
  const teams = found ? [...found.teams].sort((a, z) => {
    const i = DEPARTMENT_ORDER.indexOf(a.name), j = DEPARTMENT_ORDER.indexOf(z.name)
    return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.name.localeCompare(z.name)
  }) : []
  async function lookup(e: FormEvent) {
    e.preventDefault()
    const r = await run(async () => {
      const { data, error } = await supabase.rpc('lookup_join_code', { join_code: code })
      if (error) throw error
      return data as CodeLookup
    }, friendlyError)
    if (r) { setFound(r); setTeam(r.team_id) }
  }
  async function send(e: FormEvent) {
    e.preventDefault()
    const ok = await run(async () => {
      const { error } = await supabase.rpc('request_to_join', { join_code: code, team_in: team, role_in: role })
      if (error) throw error
      kickEmail()
      return true
    }, friendlyError)
    if (ok && found) {
      void qc.invalidateQueries({ queryKey: ['my-join-requests'] })
      const { data } = await supabase.rpc('my_join_requests')
      const mine = ((data ?? []) as { project_name: string; team_name: string; has_hod: boolean; status: string }[]).find((x) => x.status === 'pending' && x.project_name === found.project_name)
      setSent({ project: found.project_name, team: mine?.team_name ?? teams.find((t) => t.id === team)?.name ?? '', hod: mine?.has_hod ?? false })
    }
  }
  return (
    <>
      <AccountBar back />
      <main className="lb-account">
        <h1 className="lb-title">Join a project</h1>
        {sent ? (
          <div className="lb-card lb-stack" style={{ padding: 24 }}>
            <h2 className="lb-heading">Request sent</h2>
            <p>You asked to join {sent.project} as part of {sent.team}. {sent.hod ? `The head of ${sent.team}` : 'The project owner'} will answer it. The project appears in your list once it is approved.</p>
            <Link to="/" className="lb-btn lb-btn--primary">Back to projects</Link>
          </div>
        ) : !found ? (
          <form className="lb-card lb-stack" style={{ padding: 24 }} onSubmit={lookup}>
            <p className="lb-muted">Enter the code from the person who runs the project. You then choose your team and ask for access. Someone on the project approves it before you can see anything.</p>
            <Field label="Join code" required autoFocus autoCapitalize="characters" spellCheck={false} maxLength={16}
              value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.15em', fontWeight: 800 }} />
            {error && <p className="lb-error" role="alert">{error}</p>}
            <button className="lb-btn lb-btn--primary" disabled={busy || !code.trim()}>{busy ? 'Checking' : 'Continue'}</button>
          </form>
        ) : (
          <form className="lb-card lb-stack" style={{ padding: 24 }} onSubmit={send}>
            <p className="lb-muted">You are asking to join <b>{found.project_name}</b>. You join as a read-only member of the team you choose.</p>
            <div className="lb-field">
              <label htmlFor="jr-team">Which team do you belong to?</label>
              <select id="jr-team" className="lb-input" value={team} onChange={(e) => setTeam(e.target.value)}>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <span className="lb-caption">The head of this team approves your request. If it has none, the project owner does.</span>
            </div>
            <div className="lb-field">
              <label htmlFor="jr-role">Your role (optional)</label>
              <Choice id="jr-role" noun="role" value={role} options={CREW_ROLES} maxLength={120} onChange={setRole} />
              <span className="lb-caption">The job you do on this project. It appears in the cast and crew list.</span>
            </div>
            {error && <p className="lb-error" role="alert">{error}</p>}
            <div className="lb-row">
              <button type="button" className="lb-btn" onClick={() => { setFound(null) }}>Back</button>
              <button className="lb-btn lb-btn--primary" disabled={busy || !team}>{busy ? 'Sending' : 'Send request'}</button>
            </div>
          </form>
        )}
      </main>
    </>
  )
}

export function Settings() {
  const { user } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const profile = useQuery({
    queryKey: ['profile', user?.id], enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('display_name').eq('id', user!.id).single()
      if (error) throw error
      return data.display_name as string
    },
  })
  const owned = useQuery({
    queryKey: ['owned', user?.id], enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, name').eq('owner_id', user!.id)
      if (error) throw error
      return data as { id: string; name: string }[]
    },
  })
  const [name, setName] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [curPw, setCurPw] = useState('')
  const [delPw, setDelPw] = useState('')
  const [deleting, setDeleting] = useState(false)
  const profileAct = useAction(), pwAct = useAction(), delAct = useAction()
  const [saved, setSaved] = useState<string | null>(null)
  const shown = name ?? profile.data ?? ''
  const pwProblem = pw ? passwordProblem(pw) : null

  async function saveName(e: FormEvent) {
    e.preventDefault()
    await profileAct.run(async () => {
      const { error } = await supabase.from('profiles').update({ display_name: shown.trim() }).eq('id', user!.id)
      if (error) throw error
      void qc.invalidateQueries({ queryKey: ['profile'] }); void qc.invalidateQueries({ queryKey: ['project'] })
      setSaved('Name saved.')
    }, friendlyError)
  }
  /** Proves the person at the keyboard knows the current password. */
  async function confirmPassword(current: string) {
    const { error } = await supabase.auth.signInWithPassword({ email: user!.email!, password: current })
    if (error) throw new Error('The current password is not right.')
  }
  async function savePw(e: FormEvent) {
    e.preventDefault()
    if (passwordProblem(pw) || !curPw) return
    await pwAct.run(async () => {
      await confirmPassword(curPw)
      const { error } = await supabase.auth.updateUser({ password: pw })
      if (error) throw error
      setPw(''); setCurPw(''); setSaved('Password changed.')
    }, friendlyError)
  }
  async function deleteAccount() {
    const ok = await delAct.run(async () => {
      await confirmPassword(delPw)
      const { error } = await supabase.rpc('delete_my_account')
      if (error) throw error
      return true
    }, friendlyError)
    if (ok) { await supabase.auth.signOut(); nav('/signin', { replace: true }) }
  }
  const blocked = (owned.data?.length ?? 0) > 0

  return (
    <>
      <AccountBar back />
      <main className="lb-account">
        <h1 className="lb-title">Account settings</h1>
        {saved && <Banner lead="Saved">{saved}</Banner>}
        <form className="lb-card lb-stack" onSubmit={saveName}>
          <h2 className="lb-heading">Profile</h2>
          <Field label="Full name" value={shown} onChange={(e) => setName(e.target.value)} />
          <Field label="Email" value={user?.email ?? ''} readOnly className="lb-input lb-input--ro" hint="Your email is how invites find you. It cannot be changed here." />
          {profileAct.error && <p className="lb-error" role="alert">{profileAct.error}</p>}
          <div><button className="lb-btn" disabled={profileAct.busy || !shown.trim()}>Save name</button></div>
        </form>
        <form className="lb-card lb-stack" onSubmit={savePw}>
          <h2 className="lb-heading">Password</h2>
          <Field label="Current password" type="password" autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)}
            hint="Asked every time, so someone using your signed-in device cannot change it." />
          <Field label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)}
            error={pwProblem} hint="At least 8 characters, with a letter and a number." />
          {pwAct.error && <p className="lb-error" role="alert">{pwAct.error}</p>}
          <div><button className="lb-btn" disabled={pwAct.busy || !pw || !curPw || Boolean(pwProblem)}>Change password</button></div>
        </form>
        <div className="lb-card lb-stack">
          <h2 className="lb-heading">Sign out</h2>
          <div><button className="lb-btn" onClick={async () => { await supabase.auth.signOut(); qc.clear(); nav('/signin') }}>Sign out</button></div>
        </div>
        <div className="lb-card lb-stack">
          <h2 className="lb-heading lb-red">Delete account</h2>
          {blocked ? (
            <>
              <p>You own {owned.data!.length === 1 ? 'a project' : 'projects'}. An account cannot close while it owns a live project. Transfer each one to another member, or delete it, first.</p>
              <ul style={{ margin: 0, paddingLeft: 20 }}>{owned.data!.map((p) => <li key={p.id}><Link to={'/p/' + p.id + '/export'} className="lb-body-strong">{p.name}</Link></li>)}</ul>
            </>
          ) : (
            <p>Your sign-in and name are removed. Anything you entered on a project stays, shown as Former member.</p>
          )}
          <div><button className="lb-btn lb-btn--danger" disabled={blocked || owned.isLoading} onClick={() => setDeleting(true)}>Delete my account</button></div>
        </div>
      </main>
      {deleting && (
        <Dialog title="Delete your account?" onClose={() => setDeleting(false)}>
          <p>This cannot be undone. You will be signed out and cannot sign in again with this email unless you create a new account.</p>
          <Field label="Your password" type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
          {delAct.error && <p className="lb-error" role="alert">{delAct.error}</p>}
          <div className="lb-actions">
            <button className="lb-btn" onClick={() => setDeleting(false)}>Keep my account</button>
            <button className="lb-btn lb-btn--danger" disabled={delAct.busy || !delPw} onClick={deleteAccount}>Delete account</button>
          </div>
        </Dialog>
      )}
    </>
  )
}
