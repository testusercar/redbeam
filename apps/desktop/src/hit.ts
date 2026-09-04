/**
 * Hit-testing and selection rendering for committed markups.
 *
 * Works in SCREEN space so tolerances are constant in pixels regardless of
 * zoom — the same reason snapping works in screen space.
 */
import { distanceToSegment, nearestEdge, pointInPolygon, type Markup } from '@redbeam/domain'
import type { Viewport } from '@redbeam/viewer'
import { normalizedToScreen } from './draw.js'

export type HitPart = 'vertex' | 'edge' | 'inside'

export interface Hit {
  markupId: string
  part: HitPart
  /** Vertex index for 'vertex'; index of the edge's first vertex for 'edge'. */
  index: number
}

export const VERTEX_GRAB_PX = 7
export const EDGE_GRAB_PX = 6

function toScreenRing(ring: Array<{ x: number; y: number }>, v: Viewport, w: number, h: number) {
  return ring.map((p) => normalizedToScreen(p.x, p.y, v, w, h))
}

/**
 * Topmost hit at a screen point.
 *
 * Precedence is vertex > edge > inside, and later markups win ties because
 * they are drawn on top. Without the vertex-first rule you could never grab a
 * vertex that sits inside another markup's fill.
 */
export function hitTest(
  sx: number,
  sy: number,
  markups: Markup[],
  view: Viewport,
  pageW: number,
  pageH: number,
): Hit | null {
  const p = { x: sx, y: sy }

  // pass 1: vertices, newest first
  for (let i = markups.length - 1; i >= 0; i--) {
    const m = markups[i]!
    const ring = toScreenRing(m.rings[0] ?? [], view, pageW, pageH)
    for (let vi = 0; vi < ring.length; vi++) {
      const v = ring[vi]!
      if (Math.hypot(v.x - sx, v.y - sy) <= VERTEX_GRAB_PX) {
        return { markupId: m.id, part: 'vertex', index: vi }
      }
    }
  }

  // pass 2: edges
  for (let i = markups.length - 1; i >= 0; i--) {
    const m = markups[i]!
    if (m.kind === 'count') continue
    const ring = toScreenRing(m.rings[0] ?? [], view, pageW, pageH)
    if (ring.length < 2) continue
    const closed = m.kind === 'area' || m.kind === 'cutout'
    const e = nearestEdge(p, ring, closed)
    if (e && e.distance <= EDGE_GRAB_PX) {
      return { markupId: m.id, part: 'edge', index: e.index }
    }
  }

  // pass 3: interiors (closed shapes only)
  for (let i = markups.length - 1; i >= 0; i--) {
    const m = markups[i]!
    if (m.kind !== 'area' && m.kind !== 'cutout') continue
    const ring = toScreenRing(m.rings[0] ?? [], view, pageW, pageH)
    if (pointInPolygon(p, ring)) return { markupId: m.id, part: 'inside', index: -1 }
  }

  // count markups have no edges or interior — treat a near-miss as a hit
  for (let i = markups.length - 1; i >= 0; i--) {
    const m = markups[i]!
    if (m.kind !== 'count') continue
    const a = m.rings[0]?.[0]
    if (!a) continue
    const s = normalizedToScreen(a.x, a.y, view, pageW, pageH)
    if (Math.hypot(s.x - sx, s.y - sy) <= VERTEX_GRAB_PX + 3) {
      return { markupId: m.id, part: 'vertex', index: 0 }
    }
  }

  return null
}

/**
 * Draw selection handles.
 *
 * Vertex handles are drawn only for a SINGLE selection. With several markups
 * selected the handles would be ambiguous — dragging one would silently reshape
 * whichever markup owned that vertex — so a multi-selection gets outlines only,
 * and reshaping requires narrowing to one.
 */
export function drawSelection(
  ctx: CanvasRenderingContext2D,
  markups: Markup[],
  view: Viewport,
  pageW: number,
  pageH: number,
  hoverVertex: number | null,
): void {
  const single = markups.length === 1
  for (const m of markups) drawOne(ctx, m, view, pageW, pageH, single ? hoverVertex : null, single)
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  markup: Markup | undefined,
  view: Viewport,
  pageW: number,
  pageH: number,
  hoverVertex: number | null,
  withHandles: boolean,
): void {
  if (!markup) return
  const ring = toScreenRing(markup.rings[0] ?? [], view, pageW, pageH)
  if (ring.length === 0) return

  ctx.save()

  // halo so the selection reads against any drawing
  if (ring.length >= 2) {
    ctx.beginPath()
    ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    if (markup.kind === 'area' || markup.kind === 'cutout') ctx.closePath()
    ctx.strokeStyle = 'rgba(57,162,255,0.9)'
    ctx.lineWidth = 3
    ctx.setLineDash([])
    ctx.stroke()
  }

  // vertex handles
  ctx.setLineDash([])
  if (!withHandles) { ctx.restore(); return }
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!
    const active = hoverVertex === i
    ctx.fillStyle = active ? '#39a2ff' : '#ffffff'
    ctx.strokeStyle = '#1b1d21'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.rect(p.x - 4, p.y - 4, 8, 8)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

/** Insert a vertex at the midpoint of edge `index`. */
export function insertVertexAt(
  ring: Array<{ x: number; y: number }>,
  index: number,
): Array<{ x: number; y: number }> {
  const a = ring[index]
  const b = ring[(index + 1) % ring.length]
  if (!a || !b) return ring
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const out = ring.slice()
  out.splice(index + 1, 0, mid)
  return out
}

/**
 * Remove vertex `index`, refusing to drop below the minimum that keeps the
 * markup meaningful (3 for a closed shape, 2 for a polyline).
 */
export function removeVertexAt(
  ring: Array<{ x: number; y: number }>,
  index: number,
  kind: Markup['kind'],
): Array<{ x: number; y: number }> | null {
  const min = kind === 'area' || kind === 'cutout' ? 3 : 2
  if (ring.length <= min) return null
  const out = ring.slice()
  out.splice(index, 1)
  return out
}

export { distanceToSegment }


/** Markups whose geometry falls inside a screen-space rectangle. */
export function markupsInRect(
  rect: { x0: number; y0: number; x1: number; y1: number },
  markups: Markup[],
  view: Viewport,
  pageW: number,
  pageH: number,
): string[] {
  const left = Math.min(rect.x0, rect.x1)
  const right = Math.max(rect.x0, rect.x1)
  const top = Math.min(rect.y0, rect.y1)
  const bottom = Math.max(rect.y0, rect.y1)

  const out: string[] = []
  for (const m of markups) {
    const ring = toScreenRing(m.rings[0] ?? [], view, pageW, pageH)
    if (ring.length === 0) continue
    // Fully enclosed, not merely touched. A crossing selection would sweep up
    // every markup a drag passes over, which on a dense sheet selects the
    // whole page by accident.
    const inside = ring.every((p) => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom)
    if (inside) out.push(m.id)
  }
  return out
}

/** Draw the marquee itself. */
export function drawMarquee(
  ctx: CanvasRenderingContext2D,
  rect: { x0: number; y0: number; x1: number; y1: number } | null,
): void {
  if (!rect) return
  const x = Math.min(rect.x0, rect.x1)
  const y = Math.min(rect.y0, rect.y1)
  const w = Math.abs(rect.x1 - rect.x0)
  const h = Math.abs(rect.y1 - rect.y0)
  ctx.save()
  ctx.strokeStyle = '#39a2ff'
  ctx.fillStyle = 'rgba(57,162,255,0.10)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 3])
  ctx.fillRect(x, y, w, h)
  ctx.strokeRect(x, y, w, h)
  ctx.restore()
}
