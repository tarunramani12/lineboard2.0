import { useRef, useState } from 'react'
import { Dialog } from './ui'
import { FrameEditor } from './FrameEditor'
import { ShotForm, type ShotFormProps } from './ShotForm'
import type { Frame } from '../lib/storyboard'
import type { Scene } from '../lib/types'
import type { Shot } from '../lib/shots'

/**
 * The one dialog of a shot: Details (the shot's fields) and Frame (its storyboard picture) as two tabs.
 * Both are mounted and one is hidden, so what was typed or drawn survives a switch. A save in either closes the dialog,
 * as each used to. Closing it any other way goes through the frame editor, which gives back pictures uploaded and not kept.
 */
export function ShotWorkspace({ tab: first, frame, urls, ratio, usedByOthers, capBytes, showUsage, canEditFrame, pid, ...form }: ShotFormProps & {
  tab: 'details' | 'frame'
  frame: Frame | undefined; urls: Map<string, string> | undefined; ratio: string
  usedByOthers: number; capBytes: number; showUsage: boolean; canEditFrame: boolean; pid: string
}) {
  const [tab, setTab] = useState(first)
  const closeFrame = useRef<(() => void) | null>(null)
  const shot: Shot | null = form.shot
  const scene: Scene = form.scene
  const close = () => { if (closeFrame.current) closeFrame.current(); else form.onClose() }
  const title = shot ? 'Shot' : 'New shot'
  return (
    <Dialog bare wide title={title} onClose={close}>
      <div className="lb-seg" role="group" aria-label="Part of the shot">
        <button type="button" aria-pressed={tab === 'details'} aria-current={tab === 'details' ? 'true' : undefined} onClick={() => setTab('details')}>Details</button>
        <button type="button" aria-pressed={tab === 'frame'} aria-current={tab === 'frame' ? 'true' : undefined} disabled={!shot} onClick={() => setTab('frame')}>Frame</button>
      </div>
      <div className="lb-tabbody" hidden={tab !== 'details'}>
        <ShotForm {...form} onClose={close} />
      </div>
      <div className="lb-tabbody" hidden={tab !== 'frame'}>
        {shot
          ? <FrameEditor shot={shot} scene={scene} frame={frame} canEdit={canEditFrame} urls={urls} usedByOthers={usedByOthers} capBytes={capBytes} showUsage={showUsage}
              pid={pid} ratio={ratio} onClose={form.onClose} onSaved={form.onSaved} closeRef={closeFrame} />
          : <p className="lb-caption">Save the shot first, then add its frame here.</p>}
      </div>
    </Dialog>
  )
}
