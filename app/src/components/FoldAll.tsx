import { Icon } from './ui'
import { useTopbarHeight } from '../lib/useTopbarHeight'

/**
 * Collapse or expand every scene on a list page at once. Icon only.
 * It is pinned: put it as the FIRST child of the block that holds the whole list (.lb-foldscope). It starts at the top left of that
 * block and then stays on screen just under the top bar while the list scrolls, so it never has to be reached by scrolling back up.
 */
export function FoldAll({ ids, fold }: { ids: string[]; fold: { isOpen: (id: string) => boolean; setAll: (open: boolean, ids: string[]) => void } }) {
  const top = useTopbarHeight()
  if (ids.length < 2) return null
  const allOpen = ids.every((id) => fold.isOpen(id))
  const label = allOpen ? 'Collapse all' : 'Expand all'
  return (
    <div className="lb-foldpin" style={{ top: top + 6 }}>
      <button type="button" className="lb-btn lb-btn--icon" aria-label={label} title={label} onClick={() => fold.setAll(!allOpen, ids)}><Icon name={allOpen ? 'collapse' : 'expand'} /></button>
    </div>
  )
}
