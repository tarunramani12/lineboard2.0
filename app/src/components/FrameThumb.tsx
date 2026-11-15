import { useEffect, useRef, useState } from 'react'
import { Icon } from './ui'
import { cssRatio, stageSize } from '../lib/aspect'
import { loadImage, paintFrame, toDraw, type Frame } from '../lib/storyboard'

/** A small picture of a frame: the flattened image when it is done, otherwise the layers and drawing painted on the spot. */
export function FrameThumb({ frame, urls, offline, ratio, small }: { frame: Frame | undefined; urls: Map<string, string> | undefined; offline: boolean; ratio: string; small?: boolean }) {
  const rs = { aspectRatio: cssRatio(ratio) }
  const sz = stageSize(ratio); const tw = small ? 240 : 480, th = Math.max(1, Math.round(tw * sz.h / sz.w))
  const ref = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const flatUrl = frame?.done && frame.flat_path ? urls?.get(frame.flat_path) : undefined
  useEffect(() => {
    setFailed(false)
    if (!frame || frame.done) return
    if (frame.layers.length > 0 && !urls) return   // photos need their links; a drawing alone does not
    let live = true
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    paintFrame(ctx, c.width, c.height, [], frame.strokes)
    Promise.all(frame.layers.map(async (l) => {
      const img = await loadImage(urls?.get(l.path) ?? '')
      return toDraw(l, img, img.naturalWidth, img.naturalHeight)
    })).then((ls) => { if (live) paintFrame(ctx, c.width, c.height, ls, frame.strokes) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [frame, urls])
  if (!frame) return <div className="lb-frame lb-frame--empty" style={rs}><span className="lb-caption">{small ? '' : 'No frame yet'}</span></div>
  if (offline || failed) return <div className="lb-frame lb-frame--empty" style={rs}><Icon name="cloudoff" /><span className="lb-caption">{offline ? 'Offline. Frames are blank.' : 'The picture did not load.'}</span></div>
  if (frame.done) return flatUrl ? <img className="lb-frame" style={rs} src={flatUrl} alt="Finished frame" loading="lazy" /> : <div className="lb-frame lb-frame--empty" style={rs}><span className="lb-caption">Loading</span></div>
  return <canvas ref={ref} className="lb-frame" style={rs} width={tw} height={th} aria-label="Frame sketch" />
}
