import { useState } from 'react'
import type { Scene } from '../lib/types'
import { Dialog, Icon, SceneChip } from './ui'

/** Scroll to a scene's block on the page (blocks carry id="scene-<id>"; the CSS leaves room for the fixed header). */
export function goToScene(id: string) {
  document.getElementById('scene-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** A quick-bar button that lists the scenes and jumps to the one you pick. */
export function SceneJump({ scenes }: { scenes: Scene[] }) {
  const [open, setOpen] = useState(false)
  if (scenes.length === 0) return null
  return (
    <>
      <button type="button" className="lb-btn lb-btn--icon" aria-label="Go to a scene" title="Go to a scene" aria-haspopup="dialog" onClick={() => setOpen(true)}><Icon name="scenes" /></button>
      {open && (
        <Dialog title="Go to a scene" sheet onClose={() => setOpen(false)}>
          <div className="lb-menulist">
            {scenes.map((s, i) => (
              <button key={s.id} type="button" className="lb-menuitem" onClick={() => { setOpen(false); setTimeout(() => goToScene(s.id), 50) }}>
                <SceneChip n={s.display_number} position={i + 1} omitted={s.status === 'omitted'} />
                <span>{s.heading || 'No heading yet'}</span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </>
  )
}
