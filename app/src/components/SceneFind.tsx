import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Icon } from './ui'
import { useTopbarHeight } from '../lib/useTopbarHeight'
import { highlight } from '../lib/sceneSearch'

/**
 * Scene search state. The search starts closed. Closing it (the cross, or Escape) also clears it,
 * so a hidden search can never leave scenes filtered out. `q` is what to match on: empty while closed.
 */
export function useSceneFind() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const close = () => { setOpen(false); setText('') }
  return { open, setOpen, text, setText, close, q: open ? text.trim() : '' }
}
export type SceneFindState = ReturnType<typeof useSceneFind>

/** The typed words marked inside a piece of text. */
export function Mark({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  return <>{highlight(text, query).map((p, i) => (p.hit ? <mark key={i} className="lb-mark">{p.text}</mark> : <span key={i}>{p.text}</span>))}</>
}

/**
 * A search button. Pressing it opens the search field; the cross clears the search and puts the button back.
 * `shown` is how many scenes match. By default it floats at the bottom right of the screen. With `inline` it takes its place
 * in a bar (the Script page): the button becomes the field in the same spot and fills the space up to the end of the bar.
 */
export function SceneFind({ find, shown, inline }: { find: SceneFindState; shown: number; inline?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const top = useTopbarHeight()
  useEffect(() => { if (find.open) input.current?.focus() }, [find.open])

  const cls = inline ? 'lb-find-inline' : 'lb-find'
  if (!find.open) {
    return (
      <div className={cls}>
        <button type="button" className={inline ? 'lb-btn lb-btn--icon' : 'lb-zoom-pill lb-find-btn'} aria-label="Search scenes" title="Search scenes" onClick={() => find.setOpen(true)}><Icon name="search" /></button>
      </div>
    )
  }
  const word = find.q ? (shown === 1 ? '1 scene matches' : `${shown} scenes match`) : 'Scene number or words'
  return (
    <div className={cls + ' is-open'} style={{ '--find-top': `${top + 8}px` } as CSSProperties}>
      <form className="lb-find-bar" role="search" onSubmit={(e) => e.preventDefault()}>
        <Icon name="search" />
        <input ref={input} className="lb-find-input" type="search" inputMode="search" enterKeyHint="search" autoComplete="off" spellCheck={false}
          aria-label="Search scenes" placeholder="Scene number or words" value={find.text}
          onChange={(e) => find.setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') find.close() }} />
        <span className="lb-find-count" role="status">{find.q ? word : ''}</span>
        <button type="button" className="lb-find-x" aria-label="Clear the search" title="Clear the search" onClick={find.close}><Icon name="cross" /></button>
      </form>
      {!find.q && <span className="lb-sr">{word}</span>}
    </div>
  )
}
