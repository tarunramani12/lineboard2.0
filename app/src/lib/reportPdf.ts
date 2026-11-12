export type Paper = 'a4' | 'letter'
export interface Col { label: string; w: number; align?: 'right' }
export interface Block { heading?: string; sub?: string; cols: Col[]; rows: string[][]; empty?: string }
export interface Report { title: string; subtitle?: string; meta?: string; size: Paper; blocks: Block[]; footer: string; landscape?: boolean }

/** A plain printable report: black on white, a table per block, header row repeated on every page, page numbers. */
export async function buildReportPdf(r: Report): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: r.size, orientation: r.landscape ? 'landscape' : 'portrait' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const M = 14, usable = W - 2 * M
  let y = M
  const LH = 4.2
  const need = (h: number) => { if (y + h > H - 14) { doc.addPage(); y = M; return true } return false }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text(r.title, M, y + 5)
  if (r.meta) { doc.setFontSize(9); doc.text(r.meta, W - M, y + 3, { align: 'right' }) }
  y += 9
  if (r.subtitle) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); const l = doc.splitTextToSize(r.subtitle, usable) as string[]; doc.text(l, M, y + 2); y += l.length * LH + 1 }
  doc.setDrawColor(0); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); y += 3

  for (const b of r.blocks) {
    const total = b.cols.reduce((n, c) => n + c.w, 0)
    const widths = b.cols.map((c) => (c.w / total) * usable)
    const xs = widths.reduce<number[]>((a, _w, i) => [...a, i === 0 ? M : a[i - 1] + widths[i - 1]], [])
    const headerRow = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
      b.cols.forEach((c, i) => doc.text(c.label.toUpperCase(), c.align === 'right' ? xs[i] + widths[i] - 2 : xs[i], y + 3, { align: c.align === 'right' ? 'right' : 'left' }))
      y += 4.5; doc.setLineWidth(0.15); doc.line(M, y, W - M, y); y += 1
    }
    let hl: string[] = []
    if (b.heading) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); hl = doc.splitTextToSize(b.heading, usable) as string[]
    }
    const sub = b.sub ? (doc.setFont('helvetica', 'normal'), doc.setFontSize(8.5), doc.splitTextToSize(b.sub, usable) as string[]) : []
    // keep a heading with the first rows of its table
    need(hl.length * 5 + sub.length * 3.8 + 22)
    if (hl.length) { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(hl, M, y + 4); y += hl.length * 5 + 1 }
    if (sub.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(sub, M, y + 3); y += sub.length * 3.8 + 1 }
    if (b.rows.length === 0) { doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.text(b.empty ?? 'Nothing to show.', M, y + 4); y += 8; continue }
    headerRow()
    for (const row of b.rows) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
      const cells = row.map((t, i) => doc.splitTextToSize(t || '', widths[i] - 2) as string[])
      const h = Math.max(...cells.map((c) => c.length), 1) * LH + 1.6
      if (need(h + 5)) headerRow()
      cells.forEach((c, i) => doc.text(c, b.cols[i].align === 'right' ? xs[i] + widths[i] - 2 : xs[i], y + 3.5, { align: b.cols[i].align === 'right' ? 'right' : 'left' }))
      y += h; doc.setDrawColor(200); doc.setLineWidth(0.1); doc.line(M, y - 0.6, W - M, y - 0.6); doc.setDrawColor(0)
    }
    y += 4
  }
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    doc.text(r.footer, M, H - 7); doc.text(`Page ${p} of ${pages}`, W - M, H - 7, { align: 'right' })
  }
  return doc.output('blob')
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a')
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000)
}
export const fileSafe = (s: string) => s.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'file'
export const stamp = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
