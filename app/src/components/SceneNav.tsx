import { Icon, SceneChip, SwipeRow } from './ui'
import type { Scene } from '../lib/types'

/**
 * The scene list beside the script. Open it shows each scene's number and heading, closed only the number.
 * Pressing a scene scrolls the script to it. A person who may change scenes can swipe a row: delete before the lock,
 * omit (and restore) after it.
 */
export function SceneNav({ scenes, activeId, collapsed, onToggle, onGo, canEdit, locked, onDelete, onStatus, showToggle = true }: {
  scenes: Scene[]; activeId: string | null; collapsed: boolean; onToggle: () => void; onGo: (id: string) => void
  canEdit: boolean; locked: boolean; onDelete: (s: Scene) => Promise<void>; onStatus: (s: Scene, status: 'active' | 'omitted') => Promise<void>; showToggle?: boolean
}) {
  return (
    <nav className={'lb-scenenav' + (collapsed ? ' is-collapsed' : '')} aria-label="Scenes">
      <div className="lb-scenenav-head">
        {showToggle && (
          <button type="button" className="lb-iconbtn" onClick={onToggle} aria-expanded={!collapsed} aria-label={collapsed ? 'Show scene names' : 'Hide scene names'} title={collapsed ? 'Show scene names' : 'Hide scene names'}>
            <Icon name="panel" />
          </button>
        )}
        {!collapsed && <span className="lb-label">Scenes <span className="lb-muted">{scenes.filter((s) => s.status === 'active').length}</span></span>}
      </div>
      {scenes.length === 0 && !collapsed && <p className="lb-caption" style={{ padding: '4px 12px' }}>No scenes yet.</p>}
      {scenes.map((s, i) => {
        const omitted = s.status === 'omitted'
        const numbered = s.display_number !== null
        const verb = omitted ? 'Restore' : locked && numbered ? 'Omit' : 'Delete'
        const label = `${s.display_number ?? i + 1} ${s.heading || ''}`.trim()
        const row = (
          <button type="button" data-swipe className={'lb-scenenav-row' + (activeId === s.id ? ' is-active' : '') + (omitted ? ' is-omitted' : '')} aria-current={activeId === s.id ? 'true' : undefined}
            onClick={() => onGo(s.id)} title={collapsed ? label + (omitted ? ' (omitted)' : '') : undefined} aria-label={collapsed ? `Scene ${label}${omitted ? ', omitted' : ''}` : undefined}>
            <SceneChip n={s.display_number} position={i + 1} omitted={omitted} />
            {!collapsed && <span className="lb-scenenav-name">{s.heading || <span className="lb-muted">No heading yet</span>}{omitted && <span className="lb-caption"> · Omitted</span>}</span>}
          </button>
        )
        return (
          <SwipeRow key={s.id} label={`scene ${label}`} verb={verb} canDelete={canEdit && !collapsed}
            confirmText="The scene, its text, its shots and their storyboard pictures are removed. This cannot be undone."
            {...(verb === 'Delete' ? { onDelete: () => onDelete(s) } : { onRequest: () => void onStatus(s, omitted ? 'active' : 'omitted') })}>
            {row}
          </SwipeRow>
        )
      })}
    </nav>
  )
}
