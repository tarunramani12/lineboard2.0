import type { ReactNode } from 'react'
import { PageMenu, type MenuItem } from './ui'
import { useTopbarHeight } from '../lib/useTopbarHeight'

/**
 * The top of every page: an info bar and, when the page has quick actions, a quick bar under it. Both are one opaque block that
 * stays fixed under the top bar while the page scrolls.
 *  - info bar: the page name and only the facts that matter (`info`). It shows information, never buttons, except the hamburger
 *    at its right end, which holds every action of the page (`menu`).
 *  - quick bar: the quick buttons such as search, go to a scene, collapse all, zoom (`quick`).
 * Put it as the first child of the page block so it stays for the whole page.
 */
export function PageHeader({ title, info, menu, quick }: { title: string; info?: ReactNode; menu?: MenuItem[]; quick?: ReactNode }) {
  const top = useTopbarHeight()
  return (
    <div className="lb-headstack" style={{ top }}>
      <div className="lb-infobar">
        <h1 className="lb-title">{title}</h1>
        <div className="lb-infochips">{info}</div>
        {menu && <PageMenu label={`${title} actions`} items={menu} />}
      </div>
      {quick && <div className="lb-quickbar">{quick}</div>}
    </div>
  )
}
