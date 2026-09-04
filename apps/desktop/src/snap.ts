/**
 * Snapping: vertex, drawing content, and orthogonal constraint.
 *
 * Content snapping reads the rendered raster rather than the PDF's vector
 * geometry. That is what the Qt build did too (`annotator.snapToContent`,
 * budgeted at 4ms) and it has a real advantage: it snaps to whatever the
 * estimator can actually see, including raster underlays and xrefs, not just
 * paths PDFium chose to expose.
 *
 * All coordinates here are SCREEN pixels relative to the stage. Callers convert
 * to normalized page space after snapping, so snap tolerance stays constant on
 * screen regardless of zoom — which is what feels right when drawing.
 */

export type SnapKind = 'none' | 'vertex' | 'content' | 'ortho'

export interface SnapResult {
  x: number
  y: number
  kind: SnapKind
}

export interface SnapOptions {
  /** Raster canvas to sample drawing content from. */
  raster: HTMLCanvasElement
  /** Existing vertices in screen space to snap to (own markup + neighbours). */
  vertices: Array<{ x: number; y: number }>
  /** Previous vertex, used for the orthogonal constraint. */
  anchor: { x: number; y: number } | null
  /** Constrain to 0/45/90 degrees from the anchor (Shift). */
  ortho: boolean
  /** Search radius in screen px. */
  radius: number
  /** Luminance below which a pixel counts as ink. 0-255. */
  inkThreshold: number
  enabled: boolean
}

export const DEFAULT_SNAP: Pick<SnapOptions, 'radius' | 'inkThreshold' | 'enabled'> = {
  radius: 12,
  inkThreshold: 160,
  enabled: true,
}

/** Perf budget mirroring the Qt build's 4ms scope for snapToContent. */
const BUDGET_MS = 4
let warned = 0

export function snapPoint(sx: number, sy: number, o: SnapOptions): SnapResult {
  if (!o.enabled) return { x: sx, y: sy, kind: 'none' }
  const t0 = performance.now()
  try {
    // 1. vertex snap wins — it is exact, and closing a polygon on its own
    //    start vertex is the single most common intent.
    const v = nearestVertex(sx, sy, o.vertices, o.radius)
    if (v) return { ...v, kind: 'vertex' }

    // 2. orthogonal constraint from the anchor
    if (o.ortho && o.anchor) {
      const p = constrainOrtho(sx, sy, o.anchor)
      return { ...p, kind: 'ortho' }
    }

    // 3. snap to the nearest ink in the rendered page
    const c = nearestInk(sx, sy, o)
    if (c) return { ...c, kind: 'content' }

    return { x: sx, y: sy, kind: 'none' }
  } finally {
    const ms = performance.now() - t0
    if (ms > BUDGET_MS && warned < 5) {
      warned++
      console.warn(`[snap] ${ms.toFixed(1)}ms over ${BUDGET_MS}ms budget`)
    }
  }
}

export function nearestVertex(
  sx: number,
  sy: number,
  vertices: Array<{ x: number; y: number }>,
  radius: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null
  let bestD = radius * radius
  for (const v of vertices) {
    const dx = v.x - sx
    const dy = v.y - sy
    const d = dx * dx + dy * dy
    if (d <= bestD) { bestD = d; best = v }
  }
  return best
}

/** Project onto the nearest of 0/45/90/135 degrees from the anchor. */
// exported for tests
export function constrainOrtho(sx: number, sy: number, a: { x: number; y: number }): { x: number; y: number } {
  const dx = sx - a.x
  const dy = sy - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x: sx, y: sy }
  const step = Math.PI / 4
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len }
}

/**
 * Nearest dark pixel within the radius.
 *
 * Reads one small square of ImageData per call — at radius 12 that is a 25x25
 * region, which is cheap. Scanning outward by ring would let us early-exit, but
 * a full scan of 625 pixels is already well inside budget and keeps the
 * nearest-match logic obvious.
 */
function nearestInk(sx: number, sy: number, o: SnapOptions): { x: number; y: number } | null {
  const ctx = o.raster.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  /*
   * getImageData works in BACKING-STORE pixels; sx and sy arrive in CSS
   * pixels. The raster canvas is sized at devicePixelRatio, so on a 1.5x
   * display this read the page a third of the way up and to the left of the
   * cursor — it snapped, confidently, to whatever ink happened to be there.
   * That is why snapping felt broken rather than merely imprecise.
   *
   * The ratio is measured off the canvas rather than read from
   * `devicePixelRatio` so it stays correct if the two ever disagree — during a
   * resize, or on a display change before the next paint.
   */
  const scale = o.raster.width / (o.raster.clientWidth || o.raster.width)
  const dx = sx * scale
  const dy = sy * scale
  const r = Math.max(1, Math.round(o.radius * scale))
  const x0 = Math.round(dx) - r
  const y0 = Math.round(dy) - r
  const size = r * 2 + 1

  // Clamp to the canvas or getImageData returns transparent padding that
  // would read as "not ink" and quietly disable snapping near the edges.
  const cx0 = Math.max(0, x0)
  const cy0 = Math.max(0, y0)
  const cw = Math.min(o.raster.width - cx0, size - (cx0 - x0))
  const ch = Math.min(o.raster.height - cy0, size - (cy0 - y0))
  if (cw <= 0 || ch <= 0) return null

  const img = ctx.getImageData(cx0, cy0, cw, ch)
  const d = img.data

  let best: { x: number; y: number } | null = null
  let bestD = Infinity

  for (let yy = 0; yy < ch; yy++) {
    for (let xx = 0; xx < cw; xx++) {
      const i = (yy * cw + xx) * 4
      const a = d[i + 3]!
      if (a === 0) continue
      // Rec. 601 luma is plenty for "is this ink".
      const lum = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!
      if (lum > o.inkThreshold) continue

      const px = cx0 + xx
      const py = cy0 + yy
      const dist = (px - dx) * (px - dx) + (py - dy) * (py - dy)
      if (dist < bestD) { bestD = dist; best = { x: px, y: py } }
    }
  }
  // Back to CSS pixels: the caller works in the same space the pointer does.
  if (best && bestD <= r * r) return { x: best.x / scale, y: best.y / scale }
  return null
}

/** Draw the snap indicator so the user can see what they are about to hit. */
export function drawSnapIndicator(
  ctx: CanvasRenderingContext2D,
  snap: SnapResult | null,
): void {
  if (!snap || snap.kind === 'none') return
  const color = snap.kind === 'vertex' ? '#ffd24a' : snap.kind === 'ortho' ? '#8fd7ff' : '#5ec27a'
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  if (snap.kind === 'vertex') {
    ctx.strokeRect(snap.x - 5, snap.y - 5, 10, 10)
  } else {
    ctx.beginPath()
    ctx.moveTo(snap.x - 7, snap.y)
    ctx.lineTo(snap.x + 7, snap.y)
    ctx.moveTo(snap.x, snap.y - 7)
    ctx.lineTo(snap.x, snap.y + 7)
    ctx.stroke()
  }
  ctx.restore()
}
