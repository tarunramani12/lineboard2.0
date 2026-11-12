import { useState } from 'react'
import { friendlyError } from '../lib/errors'
import { downloadBlob, type Paper } from '../lib/reportPdf'

/** One PDF export, always on A4. The report is built only when the button is pressed. */
export function ReportButton({ label, file, build, disabled }: { label: string; file: string; build: (size: Paper) => Promise<Blob>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function go() {
    setBusy(true); setError(null)
    try { downloadBlob(await build('a4'), `${file}.pdf`) } catch (e) { setError(e instanceof Error && !('code' in e) ? e.message : friendlyError(e)) } finally { setBusy(false) }
  }
  return (
    <span className="lb-row" style={{ gap: 6 }}>
      <button className="lb-btn" disabled={busy || disabled} onClick={() => void go()}>{busy ? 'Making the PDF' : label}</button>
      {error && <span className="lb-error" role="alert">{error}</span>}
    </span>
  )
}
