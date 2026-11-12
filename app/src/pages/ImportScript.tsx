import { useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { Ctx } from '../components/ProjectLayout'
import { Badge, Banner, EmptyState, Icon, Permission } from '../components/ui'
import { ELEMENT_LABELS, LINES_PER_PAGE, estimateLines } from '../lib/fountain'
import { friendlyError } from '../lib/errors'
import { readDocx, readPdf } from '../lib/importDocs'
import {
  FLAG_TEXT, mergeIntoPrevious, parseScriptFile, sceneFlags, splitAt, toPayload,
  type ImportResult, type ImportedScene,
} from '../lib/importScript'
import {
  autoMatch, buildPlan, defaultCut, diffElements, normalizeHeading, sameElements,
  type CutChoice, type MatchHow, type OldScene,
} from '../lib/matchDraft'
import { isOwner, useScenes } from '../lib/project'
import { useSceneLocks, useSceneTexts } from '../lib/script'
import { supabase } from '../lib/supabase'

const FORMAT_NAME = { fdx: 'Final Draft (.fdx)', fountain: 'Fountain', text: 'Plain text', pdf: 'a PDF', docx: 'a Word file' } as const
type How = MatchHow | 'manual'
const HOW_TEXT: Record<How, string> = { number: 'matched by number', heading: 'matched by heading', similar: 'matched because the lines are alike', manual: 'matched by you' }

export default function ImportScript() {
  const { b, pid } = useOutletContext<Ctx>()
  const nav = useNavigate()
  const qc = useQueryClient()
  const existing = useScenes(pid).data ?? []
  const existingIds = useMemo(() => existing.map((s) => s.id), [existing])
  const oldTexts = useSceneTexts(pid, existingIds)
  const oldLocks = useSceneLocks(pid, existingIds)
  const owner = isOwner(b)
  const locked = b.project.script_locked
  const hasExisting = existing.length > 0

  const [fileName, setFileName] = useState('')
  const [pasted, setPasted] = useState('')
  const [reading, setReading] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [scenes, setScenes] = useState<ImportedScene[]>([])
  const [keepNumbers, setKeepNumbers] = useState(true)
  const [open, setOpen] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // matching a new draft to the scenes already here
  const [stage, setStage] = useState<'review' | 'match'>('review')
  const [matches, setMatches] = useState<Map<number, string | null>>(new Map())
  const [how, setHow] = useState<Map<number, How>>(new Map())
  const [cuts, setCuts] = useState<Map<string, CutChoice>>(new Map())
  const [diffOpen, setDiffOpen] = useState<number | null>(null)

  const flags = useMemo(() => sceneFlags(scenes), [scenes])
  const hasNumbers = scenes.some((s) => s.include && s.number)
  const useNumbers = keepNumbers && !hasExisting
  const included = scenes.filter((s) => s.include && (useNumbers || !s.omitted))
  const dupes = useNumbers && included.some((s) => flags.get(s.key)?.includes('dupnumber'))
  const flagged = scenes.filter((s) => (flags.get(s.key) ?? []).length > 0).length

  const oldScenes: OldScene[] = useMemo(() => existing.map((s) => ({
    id: s.id, number: s.display_number, heading: s.heading, status: s.status,
    elements: oldTexts.data?.get(s.id)?.elements ?? [],
  })), [existing, oldTexts.data])
  const oldById = useMemo(() => new Map(oldScenes.map((o) => [o.id, o])), [oldScenes])
  const matchedIds = useMemo(() => new Set([...matches.values()].filter(Boolean) as string[]), [matches])
  const cutScenes = oldScenes.filter((o) => !matchedIds.has(o.id))
  const planned = useMemo(
    () => (stage === 'match' ? buildPlan(oldScenes, scenes, matches, cuts, locked) : null),
    [stage, oldScenes, scenes, matches, cuts, locked],
  )
  const planIds = new Set((planned?.plan ?? []).flatMap((p) => ('id' in p ? [p.id] : [])))
  const busyScenes = oldScenes.filter((o) => {
    const l = oldLocks.data?.get(o.id)
    return l && l.holder !== b.me.account_id && planIds.has(o.id)
  })
  const nameOf = (uid: string) => b.people.find((p) => p.account_id === uid)?.name ?? 'Someone'

  function load(name: string, text: string | ImportResult) {
    setError(null)
    const r = typeof text === 'string' ? parseScriptFile(name, text) : text
    setFileName(name); setResult(r); setScenes(r.scenes); setOpen(null); setStage('review')
    setKeepNumbers(r.scenes.some((s) => s.number))
  }
  async function onFile(f: File | undefined) {
    if (!f) return
    if (f.size > 8 * 1024 * 1024) { setError('That file is larger than 8 MB. A script is much smaller than this. Check that it is the right file.'); return }
    const lower = f.name.toLowerCase()
    try {
      if (lower.endsWith('.pdf') || f.type === 'application/pdf') { setReading('Reading the PDF'); load(f.name, await readPdf(await f.arrayBuffer())) }
      else if (lower.endsWith('.docx')) { setReading('Reading the Word file'); load(f.name, await readDocx(await f.arrayBuffer())) }
      else if (lower.endsWith('.doc')) setError('Older Word files (.doc) cannot be read. Open it in Word and save it as .docx, or save as PDF or plain text.')
      else load(f.name, await f.text())
    } catch (e) { setError(e instanceof Error && !/^(Invalid|Missing|Unexpected)/.test(e.message) ? e.message : 'The file could not be read.') }
    finally { setReading(null) }
  }
  const patch = (key: number, p: Partial<ImportedScene>) => setScenes((all) => all.map((s) => (s.key === key ? { ...s, ...p } : s)))

  function goMatch() {
    const incl = scenes.filter((s) => s.include)
    const auto = autoMatch(oldScenes, incl)
    setMatches(new Map(incl.map((s) => [s.key, auto.get(s.key)?.oldId ?? null])))
    setHow(new Map([...auto].map(([k, m]) => [k, m.how as How])))
    setCuts(new Map()); setDiffOpen(null); setError(null)
    setStage('match')
  }
  function setMatch(key: number, oldId: string | null) {
    setMatches((m) => new Map(m).set(key, oldId))
    setHow((h) => { const n = new Map(h); if (oldId) n.set(key, 'manual'); else n.delete(key); return n })
  }

  async function confirmImport() {
    setBusy(true); setError(null)
    try {
      const payload = toPayload(scenes, useNumbers)
      const { data, error: e } = await supabase.rpc('import_script', { pid, scenes_in: payload, lock_after: useNumbers && hasNumbers })
      if (e) throw e
      done({ imported: data as number })
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  async function applyDraft() {
    if (!planned) return
    setBusy(true); setError(null)
    try {
      const { data, error: e } = await supabase.rpc('apply_draft', { pid, plan: planned.plan })
      if (e) throw e
      const r = data as { updated: number; inserted: number; omitted: number; removed: number }
      const parts = [`${r.updated} updated`, `${r.inserted} new`]
      if (r.omitted) parts.push(`${r.omitted} marked omitted`)
      if (r.removed) parts.push(`${r.removed} removed`)
      done({ draft: `The new draft was applied: ${parts.join(', ')}.` })
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  function done(state: { imported?: number; draft?: string }) {
    for (const k of ['scenes', 'scene_text', 'scene_locks', 'project']) void qc.invalidateQueries({ queryKey: [k, pid] })
    nav(`/p/${pid}/script`, { replace: true, state })
  }

  const head = (
    <div className="lb-page-head">
      <h1 className="lb-title">{hasExisting ? 'Import a script or a new draft' : 'Import a script'}</h1>
      <Permission level={owner ? 'edit' : 'locked'} why="Owner only" />
    </div>
  )

  if (!owner) {
    return (
      <>
        {head}
        <EmptyState title="Only the owner can import a script" action={<Link to={`/p/${pid}/script`} className="lb-btn">Back to the script</Link>}>
          The owner reads the file, checks the scenes found, and confirms.
        </EmptyState>
      </>
    )
  }

  // ---- step 1: choose the file
  if (!result) {
    return (
      <>
        {head}
        <p className="lb-caption">
          Read a script from a Final Draft file (.fdx), a Fountain file (.fountain), a PDF, a Word file (.docx) or plain text. The file is read on this device.
          Nothing is saved or sent anywhere until you confirm.
        </p>
        {hasExisting && (
          <Banner lead="This project already has scenes">
            {locked
              ? `The script is locked, so a new draft is matched to the ${existing.length} scenes already here. Their numbers and shots stay with them.`
              : `You can match the new draft to the ${existing.length} scenes already here, or add the new scenes after them.`}
          </Banner>
        )}
        <section className="lb-card lb-stack" style={{ padding: 16 }}>
          <h2 className="lb-heading">From a file</h2>
          <input id="imp-file" type="file" className="lb-input"
            disabled={reading !== null} onChange={(e) => void onFile(e.target.files?.[0])} />
          {reading && <span className="lb-caption" role="status">{reading}…</span>}
          <span className="lb-caption">PDF and Word files are read by their layout and styles, which is less exact than Fountain or Final Draft. Expect to check headings and speakers on the next screen.</span>
        </section>
        <section className="lb-card lb-stack" style={{ padding: 16 }}>
          <h2 className="lb-heading">Or paste text</h2>
          <textarea className="lb-input lb-script-input lb-textarea" aria-label="Pasted script" rows={8} value={pasted}
            placeholder={'INT. KITCHEN - NIGHT\n\nRain on the window.\n\nANNA\nNot yet.'} onChange={(e) => setPasted(e.target.value)} />
          <div><button className="lb-btn" disabled={!pasted.trim()} onClick={() => load('pasted.txt', pasted)}>Read pasted text</button></div>
        </section>
        {error && <p className="lb-error" role="alert">{error}</p>}
        <div><Link to={`/p/${pid}/script`} className="lb-btn">Cancel</Link></div>
      </>
    )
  }

  // ---- step 3: match the new draft to the scenes already here, and let the owner approve
  if (stage === 'match' && planned) {
    const s = planned.summary
    const incl = scenes.filter((x) => x.include)
    return (
      <>
        {head}
        <p className="lb-caption">
          <b>{fileName}</b> against the {existing.length} scenes already in the project.
          {locked ? ' Scene numbers do not change. A new scene is numbered from its place (2A, or the next whole number at the end), and changed lines are marked in the current revision.' : ' The script is not locked, so scenes have no numbers to keep.'}
          {' '}Nothing is saved until you apply the draft.
        </p>
        <Banner lead="Summary">
          {s.unchanged} unchanged, {s.updated} changed, {s.inserted} new{s.omitted ? `, ${s.omitted} marked omitted` : ''}{s.removed ? `, ${s.removed} removed` : ''}{s.kept ? `, ${s.kept} left as they are` : ''}.
        </Banner>
        {busyScenes.length > 0 && (
          <Banner kind="alert" lead="Scenes being edited">
            {busyScenes.map((o) => `${o.number ? 'Scene ' + o.number : o.heading || 'A scene'} (${nameOf(oldLocks.data!.get(o.id)!.holder)})`).join(', ')}.
            Wait until they finish, or ask them to save and close, then apply the draft.
          </Banner>
        )}

        <section className="lb-box" aria-label="New draft">
          <div className="lb-mt-head">New draft, in script order</div>
          {incl.map((n, i) => {
            const oid = matches.get(n.key) ?? null
            const o = oid ? oldById.get(oid) : undefined
            const h = how.get(n.key)
            const headChanged = o ? normalizeHeading(o.heading) !== normalizeHeading(n.heading) : false
            const textChanged = o ? !sameElements(o.elements, n.elements) : false
            const label = !o ? 'New scene' : n.omitted ? 'Cut in the new draft' : headChanged && textChanged ? 'Heading and text changed' : headChanged ? 'Heading changed' : textChanged ? 'Text changed' : 'Unchanged'
            const isOpen = diffOpen === n.key
            const skipped = !o && n.omitted
            return (
              <div key={n.key} className="lb-mt">
                <div className="lb-mt-row">
                  <span className="lb-imp-num" title="Position in the new draft">{i + 1}</span>
                  <span className="lb-mt-title">{n.heading || <span className="lb-muted">No heading</span>}{n.omitted && ' (omitted)'}</span>
                  <label className="lb-mt-pick">
                    <span className="lb-label">Is the same as</span>
                    <select className="lb-input" value={oid ?? ''} aria-label={`Match for scene ${i + 1} of the new draft`} onChange={(e) => setMatch(n.key, e.target.value || null)}>
                      <option value="">{n.omitted ? 'Nothing (skipped)' : 'A new scene'}</option>
                      {oldScenes.filter((x) => x.id === oid || !matchedIds.has(x.id)).map((x) => (
                        <option key={x.id} value={x.id}>{x.number ? `${x.number}  ` : ''}{x.heading || 'No heading'}{x.status === 'omitted' ? ' (omitted)' : ''}</option>
                      ))}
                    </select>
                  </label>
                  <span className="lb-row lb-mt-tools">
                    {skipped ? <Badge kind="omitted">Skipped</Badge> : <Badge kind={!o ? 'locked' : label === 'Unchanged' ? 'plain' : 'conflict'}>{label}</Badge>}
                    {h === 'similar' && <Badge kind="conflict">Check this match</Badge>}
                    {o && h && h !== 'similar' && <span className="lb-caption">{HOW_TEXT[h]}</span>}
                    {o && !n.omitted && (textChanged || headChanged) && (
                      <button className="lb-btn lb-btn--sm" aria-expanded={isOpen} onClick={() => setDiffOpen(isOpen ? null : n.key)}>{isOpen ? 'Hide changes' : 'Show changes'}</button>
                    )}
                  </span>
                </div>
                {isOpen && o && (
                  <div className="lb-mt-diff">
                    {headChanged && (
                      <div className="lb-diff-line lb-diff-del"><span className="lb-diff-mark">−</span><span className="lb-imp-line">{o.heading}</span></div>
                    )}
                    {headChanged && (
                      <div className="lb-diff-line lb-diff-add"><span className="lb-diff-mark">+</span><span className="lb-imp-line">{n.heading}</span></div>
                    )}
                    {diffElements(o.elements, n.elements).map((d, k) => (
                      <div key={k} className={'lb-diff-line lb-diff-' + d.change}>
                        <span className="lb-diff-mark">{d.change === 'add' ? '+' : d.change === 'del' ? '−' : ''}</span>
                        <span className="lb-imp-kind">{ELEMENT_LABELS[d.el.kind]}</span>
                        <span className="lb-imp-line">{d.el.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </section>

        {cutScenes.length > 0 && (
          <section className="lb-box" aria-label="Scenes not in the new draft">
            <div className="lb-mt-head">In the project but not in the new draft</div>
            {cutScenes.map((o) => {
              const choice = cuts.get(o.id) ?? defaultCut(o, locked)
              return (
                <div key={o.id} className="lb-mt">
                  <div className="lb-mt-row">
                    <span className="lb-imp-num">{o.number ?? '–'}</span>
                    <span className="lb-mt-title">{o.heading || <span className="lb-muted">No heading</span>}</span>
                    {o.status === 'omitted' ? (
                      <span className="lb-caption" style={{ gridColumn: 'span 2' }}>Already omitted. It stays as it is.</span>
                    ) : (
                      <label className="lb-mt-pick" style={{ gridColumn: 'span 2' }}>
                        <span className="lb-label">What happens to it</span>
                        <select className="lb-input" value={choice} aria-label={`What happens to ${o.heading || 'this scene'}`} onChange={(e) => setCuts((c) => new Map(c).set(o.id, e.target.value as CutChoice))}>
                          {locked
                            ? <option value="omit">Mark it omitted (keeps its number)</option>
                            : <option value="remove">Remove it, and its text</option>}
                          <option value="keep">Keep it as it is</option>
                        </select>
                      </label>
                    )}
                  </div>
                </div>
              )
            })}
          </section>
        )}

        {error && <p className="lb-error" role="alert">{error}</p>}
        <div className="lb-actions" style={{ justifyContent: 'space-between' }}>
          <button className="lb-btn" onClick={() => setStage('review')}>Back</button>
          <span className="lb-row">
            <Link to={`/p/${pid}/script`} className="lb-btn">Cancel</Link>
            <button className="lb-btn lb-btn--primary" disabled={busy || planned.plan.length === 0 || busyScenes.length > 0} onClick={applyDraft}>
              <Icon name="check" /> {busy ? 'Applying' : 'Apply the new draft'}
            </button>
          </span>
        </div>
      </>
    )
  }

  // ---- step 2: review the scenes found in the file
  const lines = scenes.filter((s) => s.include).reduce((n, s) => n + estimateLines(s.heading, s.elements), 0)
  const pages = Math.max(1, Math.round(lines / LINES_PER_PAGE))
  return (
    <>
      {head}
      <p className="lb-caption">
        <b>{fileName}</b> read as {FORMAT_NAME[result.format]}. Found <b>{scenes.length}</b> {scenes.length === 1 ? 'scene' : 'scenes'}, about {pages} {pages === 1 ? 'page' : 'pages'}.
        Nothing is saved yet.
      </p>
      {result.notes.map((n) => <Banner key={n} lead="Note">{n}</Banner>)}
      {flagged > 0 && <Banner kind="alert" lead={`${flagged} ${flagged === 1 ? 'scene needs' : 'scenes need'} a look`}>Fix the heading, merge the scene into the one before it, split it, or leave it out. Scenes read from PDF or Word files, or from text without proper headings, are the usual cause.</Banner>}
      {hasExisting && <Banner lead="This project already has scenes">
        {locked
          ? `Next you match this draft to the ${existing.length} scenes already here, so numbers and anything attached stay with their scenes.`
          : `Match this draft to the ${existing.length} scenes already here, or add its scenes after them.`}
      </Banner>}

      {!hasExisting && (
        <section className="lb-card lb-stack" style={{ padding: 16 }}>
          <h2 className="lb-heading">Scene numbers</h2>
          {hasNumbers ? (
            <>
              <label className="lb-radio"><input type="radio" name="numbers" checked={keepNumbers} onChange={() => setKeepNumbers(true)} />
                <span><b>Keep the numbers in the file and lock the script.</b> A production script keeps its numbers (42A, omitted scenes). Scenes without a number are numbered at the lock.</span></label>
              <label className="lb-radio"><input type="radio" name="numbers" checked={!keepNumbers} onChange={() => setKeepNumbers(false)} />
                <span><b>Import as an unnumbered draft.</b> The numbers in the file are dropped and omitted scenes are left out. You lock the script yourself later.</span></label>
            </>
          ) : (
            <p className="lb-caption">The file has no scene numbers, so the scenes arrive as an unnumbered draft. You can lock the script later to number them.</p>
          )}
        </section>
      )}

      <section className="lb-box" aria-label="Scenes found">
        {scenes.map((s, i) => {
          const f = flags.get(s.key) ?? []
          const isOpen = open === s.key
          const preview = s.elements.find((e) => e.kind === 'action' || e.kind === 'dialogue')?.text ?? ''
          return (
            <div key={s.key} className={'lb-imp' + (s.include ? '' : ' is-out')}>
              <div className="lb-imp-row">
                <input type="checkbox" aria-label={`Include scene ${i + 1}`} checked={s.include} onChange={(e) => patch(s.key, { include: e.target.checked })} />
                <span className="lb-imp-num" title={s.number ? 'Number from the file' : 'No number in the file'}>{s.number ?? i + 1}</span>
                <input className="lb-input lb-script-input" aria-label={`Heading of scene ${i + 1}`} value={s.heading} placeholder="Scene heading"
                  disabled={s.omitted} onChange={(e) => patch(s.key, { heading: e.target.value })} />
                <span className="lb-row lb-imp-tools">
                  {s.omitted && <Badge kind="omitted">Omitted</Badge>}
                  {f.map((x) => <Badge key={x} kind="conflict">{FLAG_TEXT[x]}</Badge>)}
                  <button className="lb-btn lb-btn--sm" onClick={() => setOpen(isOpen ? null : s.key)} aria-expanded={isOpen}>{isOpen ? 'Hide text' : 'Show text'}</button>
                  {i > 0 && <button className="lb-btn lb-btn--sm" onClick={() => setScenes((all) => mergeIntoPrevious(all, i))}>Merge into previous</button>}
                </span>
              </div>
              {!isOpen && <p className="lb-caption lb-imp-preview">{s.elements.length} {s.elements.length === 1 ? 'line' : 'lines'}{preview ? ` · ${preview.slice(0, 110)}${preview.length > 110 ? '…' : ''}` : ''}</p>}
              {isOpen && (
                <div className="lb-imp-text">
                  {s.elements.length === 0 && <p className="lb-caption">No text in this scene.</p>}
                  {s.elements.map((e, k) => (
                    <div key={k} className="lb-imp-el">
                      <span className="lb-imp-kind">{ELEMENT_LABELS[e.kind]}</span>
                      <span className="lb-imp-line">{e.text}</span>
                      {k > 0 && <button className="lb-btn lb-btn--sm lb-btn--quiet" onClick={() => setScenes((all) => splitAt(all, i, k))}>Start a new scene here</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </section>

      {error && <p className="lb-error" role="alert">{error}</p>}
      {dupes && <p className="lb-error" role="alert">Two scenes use the same number. Fix one, leave one out, or import as an unnumbered draft.</p>}
      <div className="lb-actions" style={{ justifyContent: 'space-between' }}>
        <button className="lb-btn" onClick={() => { setResult(null); setScenes([]); setPasted('') }}>Choose another file</button>
        <span className="lb-row">
          <Link to={`/p/${pid}/script`} className="lb-btn">Cancel</Link>
          {hasExisting ? (
            <>
              {!locked && <button className="lb-btn" disabled={busy || included.length === 0} onClick={confirmImport}>Add after the existing scenes</button>}
              <button className="lb-btn lb-btn--primary" disabled={busy || included.length === 0 || oldTexts.isLoading} onClick={goMatch}>Next: match to the current script</button>
            </>
          ) : (
            <button className="lb-btn lb-btn--primary" disabled={busy || included.length === 0 || dupes} onClick={confirmImport}>
              <Icon name="check" /> {busy ? 'Importing' : `Import ${included.length} ${included.length === 1 ? 'scene' : 'scenes'}${useNumbers && hasNumbers ? ' and lock' : ''}`}
            </button>
          )}
        </span>
      </div>
    </>
  )
}
