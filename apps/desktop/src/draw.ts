/**
 * Drawing state machine and in-progress rendering.
 *
 * Geometry is captured in NORMALIZED page coordinates [0,1] — the same
 * convention as the Qt build and the `markups.geometry_json` column — so a
 * markup is independent of zoom and viewport.
 */
import type { Viewport } from '@redbeam/viewer'

/**
 * `direction` sets the scope's default pattern orientation: two clicks along
 * the axis the material runs. It is not a markup — nothing is stored on the
 * page — but the layout engine cannot produce a piece count without it, and
 * the engine refuses to guess because a substituted axis silently moves every
 * seam.
 */
export type Tool =
  | 'pan' | 'area' | 'cutout' | 'polyline' | 'count' | 'shape'
  // `calibrate` measures a known length to derive ONE page's scale.
  // `scale-region` draws a box that carries its own scale, for the details
  // sheet where four details sit at four scales and one page number is right
  // for one of them.
  // `dimension` measures a distance and writes it on the sheet. It is NOT
  // takeoff: it reaches no scope and no quantity, which is why it carries no
  // scope id and is drawn on the annotation layer rather than the overlay.
  | 'calibrate' | 'direction' | 'scale-region' | 'dimension'

export interface DraftState {
  tool: Tool
  /** Vertices placed so far, normalized. */
  points: Array<{ x: number; y: number }>
  /** Live cursor position, normalized — drawn as a rubber-band segment. */
  cursor: { x: number; y: number } | null
}

export const emptyDraft = (tool: Tool = 'pan'): DraftState => ({ tool, points: [], cursor: null })

/** Screen pixel -> normalized page coordinate. */
export function screenToNormalized(
  sx: number,
  sy: number,
  view: Viewport,
  pageW: number,
  pageH: number,
): { x: number; y: number } {
  return {
    x: (view.ox + sx) / (pageW * view.zoom),
    y: (view.oy + sy) / (pageH * view.zoom),
  }
}

/** Normalized page coordinate -> screen pixel. */
export function normalizedToScreen(
  nx: number,
  ny: number,
  view: Viewport,
  pageW: number,
  pageH: number,
): { x: number; y: number } {
  return { x: nx * pageW * view.zoom - view.ox, y: ny * pageH * view.zoom - view.oy }
}

/** Minimum vertices before a draft can be committed. */
export function isCommittable(d: DraftState): boolean {
  switch (d.tool) {
    case 'area':
    case 'cutout':
    case 'shape': return d.points.length >= 3
    case 'polyline': return d.points.length >= 2
    case 'calibrate':
    case 'direction': return d.points.length === 2
    case 'count': return d.points.length >= 1
    default: return false
  }
}

/**
 * Draw the in-progress geometry. Rendered on the overlay canvas AFTER the
 * committed markups, so the draft always sits on top.
 */
export function drawDraft(
  ctx: CanvasRenderingContext2D,
  d: DraftState,
  view: Viewport,
  pageW: number,
  pageH: number,
): void {
  if (d.tool === 'pan' || d.points.length === 0) return
  const pt = (p: { x: number; y: number }) => normalizedToScreen(p.x, p.y, view, pageW, pageH)

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  const stroke = d.tool === 'calibrate' ? '#ffd24a'
    : d.tool === 'direction' ? '#71b591'
    : d.tool === 'cutout' ? '#ff7a59'
    : d.tool === 'shape' ? '#9b8cff'
    : '#39a2ff'

  if (d.tool === 'count') {
    for (const p of d.points) {
      const s = pt(p)
      ctx.fillStyle = stroke
      ctx.beginPath()
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    return
  }

  // path so far, plus a rubber band to the cursor
  const pts = d.cursor ? [...d.points, d.cursor] : d.points
  ctx.beginPath()
  pts.forEach((p, i) => {
    const s = pt(p)
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y)
  })

  if ((d.tool === 'area' || d.tool === 'cutout' || d.tool === 'shape') && d.points.length >= 2) {
    ctx.closePath()
    // a cutout is an opening: outline only, so it reads as removed material
    if (d.tool === 'area' || d.tool === 'shape') {
      ctx.globalAlpha = d.tool === 'shape' ? 0.10 : 0.14
      ctx.fillStyle = stroke
      ctx.fill()
    }
  }

  ctx.globalAlpha = 1
  ctx.strokeStyle = stroke
  ctx.lineWidth = 2
  ctx.setLineDash(d.cursor ? [5, 4] : [])
  ctx.stroke()

  // vertex handles
  ctx.setLineDash([])
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1.5
  for (const p of d.points) {
    const s = pt(p)
    ctx.beginPath()
    ctx.rect(s.x - 3, s.y - 3, 6, 6)
    ctx.fill()
    ctx.stroke()
  }

  ctx.restore()
}

/** Length of a two-point draft in PDF points — the calibration input. */
export function draftLengthPdfPoints(d: DraftState, pageW: number, pageH: number): number {
  if (d.points.length < 2) return 0
  const a = d.points[0]!
  const b = d.points[1]!
  return Math.hypot((b.x - a.x) * pageW, (b.y - a.y) * pageH)
}

/**
 * The four corners of a dragged rectangle, in normalized page space.
 *
 * Wound so the ring is a simple closed quad regardless of which way the drag
 * went — dragging up-and-left must give the same shape as down-and-right, and
 * a reversed winding would put a bow-tie through the area calculation.
 */
export function rectPoints(
  r: { x0: number; y0: number; x1: number; y1: number },
  view: Viewport,
  pageW: number,
  pageH: number,
): Array<{ x: number; y: number }> {
  const left = Math.min(r.x0, r.x1)
  const right = Math.max(r.x0, r.x1)
  const top = Math.min(r.y0, r.y1)
  const bottom = Math.max(r.y0, r.y1)
  return [
    screenToNormalized(left, top, view, pageW, pageH),
    screenToNormalized(right, top, view, pageW, pageH),
    screenToNormalized(right, bottom, view, pageW, pageH),
    screenToNormalized(left, bottom, view, pageW, pageH),
  ]
}
