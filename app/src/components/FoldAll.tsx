/** Open or close every scene on a list page at once. */
export function FoldAll({ ids, fold }: { ids: string[]; fold: { isOpen: (id: string) => boolean; setAll: (open: boolean, ids: string[]) => void } }) {
  if (ids.length < 2) return <span />
  const allOpen = ids.every((id) => fold.isOpen(id))
  return <button className="lb-btn lb-btn--sm" onClick={() => fold.setAll(!allOpen, ids)}>{allOpen ? 'Close all scenes' : 'Open all scenes'}</button>
}
