import { useState } from 'react'
import { friendlyError } from '../lib/errors'
import { downloadBlob, type Paper } from '../lib/reportPdf'
import { Icon } from './ui'

/** Shared by the icon button and the phone menu: builds the PDF only when asked, always on A4. */
export function useReportDownload(file: string, build: (size: Paper) => Promise<Blob>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function go() {
    setBusy(true); setError(null)
    try { downloadBlob(await build('a4'), `${file}.pdf`) } catch (e) { setError(e instanceof Error && !('code' in e) ? e.message : friendlyError(e)) } finally { setBusy(false) }
  }
  return { busy, error, go }
}

/** One PDF download: an icon-only button (the label is its tooltip and screen reader name). */
export function ReportButton({ label, file, build, disabled }: { label: string; file: string; build: (size: Paper) => Promise<Blob>; disabled?: boolean }) {
  const { busy, error, go } = useReportDownload(file, build)
  return (
    <span className="lb-row" style={{ gap: 6 }}>
      <button type="button" className="lb-btn lb-btn--icon" aria-label={busy ? 'Making the PDF' : label} title={label} disabled={busy || disabled} onClick={() => void go()}><Icon name="download" /></button>
      {error && <span className="lb-error" role="alert">{error}</span>}
    </span>
  )
}
