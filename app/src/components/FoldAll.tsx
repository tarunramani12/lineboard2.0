import { Icon } from './ui'

/** Collapse or expand every scene on a list page at once. Icon only; it lives in the quick bar of a PageHeader. */
export function FoldAll({ ids, fold }: { ids: string[]; fold: { isOpen: (id: string) => boolean; setAll: (open: boolean, ids: string[]) => void } }) {
  if (ids.length < 2) return null
  const allOpen = ids.every((id) => fold.isOpen(id))
  const label = allOpen ? 'Collapse all' : 'Expand all'
  return <button type="button" className="lb-btn lb-btn--icon" aria-label={label} title={label} onClick={() => fold.setAll(!allOpen, ids)}><Icon name={allOpen ? 'collapse' : 'expand'} /></button>
}
