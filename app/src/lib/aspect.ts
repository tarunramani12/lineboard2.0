/** Aspect ratio of a project's storyboard frames, stored on the project as text such as "16:9" or "2.39:1". */
export const DEFAULT_ASPECT = '16:9'
export const ASPECT_PRESETS = ['16:9', '1.85:1', '2.39:1', '2:1', '21:9', '4:3', '3:2', '1:1', '9:16']
export const STAGE_LONG = 1280 // pixels on the long side of the drawing stage

const PART = '(\\d{1,2}(?:\\.\\d{1,3})?)'
const RATIO = new RegExp(`^${PART}:${PART}$`)

/** Width divided by height. A value that cannot be read gives 16:9. */
export function ratioValue(r: string | null | undefined): number {
  const m = RATIO.exec(r ?? '')
  if (!m) return 16 / 9
  const v = Number(m[1]) / Number(m[2])
  return Number.isFinite(v) && v > 0 ? v : 16 / 9
}

/** Turn what a person types (2.39, 2,39:1, 16/9, 4 x 3) into "w:h", or null if it is not a sensible shape. */
export function normalizeRatio(input: string): string | null {
  const t = input.trim().replace(',', '.').replace(/\s*(?:\/|x|×|to)\s*/i, ':').replace(/\s+/g, '')
  const one = new RegExp(`^${PART}$`).exec(t)
  const r = one ? `${one[1]}:1` : t
  const m = RATIO.exec(r)
  if (!m) return null
  const w = Number(m[1]), h = Number(m[2])
  if (!(w > 0) || !(h > 0) || w / h > 4 || h / w > 4) return null
  return `${m[1]}:${m[2]}`
}

/** Pixel size of the drawing stage for a ratio: the long side is always 1280. */
export function stageSize(r: string | null | undefined): { w: number; h: number } {
  const v = ratioValue(r)
  return v >= 1 ? { w: STAGE_LONG, h: Math.max(1, Math.round(STAGE_LONG / v)) } : { w: Math.max(1, Math.round(STAGE_LONG * v)), h: STAGE_LONG }
}

/** The same ratio as a CSS aspect-ratio value. */
export const cssRatio = (r: string | null | undefined) => String(Math.round(ratioValue(r) * 1000) / 1000)
