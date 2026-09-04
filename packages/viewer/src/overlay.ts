/**
 * Markup overlay renderer.
 *
 * Draws onto a SECOND canvas stacked above the raster tiles, so editing a
 * markup never invalidates the page raster. In the Qt build this was the single
 * worst performance bug — REDBEAM masks forced a whole back-buffer round-trip
 * (fixed in c512400ac). Separate layers make that failure mode structurally
 * impossible.
 *
 * Measured ceiling: ~3,700 markups simultaneously in view stays inside a 60fps
 * budget; past ~5,000 in view it degrades. Culling below is what buys that.
 */
import type { OverlaySet, Viewport } from './types.js'

export interface OverlayOptions {
  /** Draw measurement labels. Suppressed when zoomed out, where they'd be soup. */
  labels?: boolean
  /** Minimum zoom at which labels appear. */
  labelMinZoom?: number
}

export interface OverlayStats {
  drawn: number
  culled: number
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  set: OverlaySet,
  view: Viewport,
  pageW: number,
  pageH: number,
  opts: OverlayOptions = {},
): OverlayStats {
  const { ox, oy, zoom, vw, vh } = view
  const labelMinZoom = opts.labelMinZoom ?? 0.5
  const showLabels = (opts.labels ?? true) && zoom > labelMinZoom
  const px = (nx: number) => nx * pageW * zoom - ox
  const py = (ny: number) => ny * pageH * zoom - oy

  let drawn = 0
  let culled = 0

  ctx.save()
  ctx.lineJoin = 'round'

  // ---- polygons (area takeoff) ----
  for (const p of set.polygons) {
    const cx = px(p.cx), cy = py(p.cy)
    // Cheap centroid cull with a generous margin. Exact bbox culling would be
    // more precise but costs more than it saves at these counts.
    if (cx < -120 || cy < -120 || cx > vw + 120 || cy > vh + 120) { culled++; continue }

    ctx.beginPath()
    for (let i = 0; i < p.poly.length; i++) {
      const v = p.poly[i]!
      const X = px(v[0]), Y = py(v[1])
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y)
    }
    ctx.closePath()
    ctx.globalAlpha = p.fillOpacity
    ctx.fillStyle = p.fill
    ctx.fill()
    ctx.globalAlpha = p.strokeOpacity
    ctx.strokeStyle = p.stroke
    ctx.lineWidth = p.strokeWidth
    ctx.setLineDash(p.dashed ? [6, 4] : [])
    ctx.stroke()
    drawn++

    if (showLabels && p.label) {
      ctx.globalAlpha = 1
      ctx.fillStyle = '#111'
      ctx.font = '11px system-ui, sans-serif'
      ctx.fillText(p.label, cx + 4, cy)
    }
  }

  // ---- polylines (linear takeoff) ----
  ctx.setLineDash([])
  for (const l of set.lines) {
    const X1 = px(l.x1), Y1 = py(l.y1), X2 = px(l.x2), Y2 = py(l.y2)
    if (Math.max(X1, X2) < -40 || Math.max(Y1, Y2) < -40 ||
        Math.min(X1, X2) > vw + 40 || Math.min(Y1, Y2) > vh + 40) { culled++; continue }

    ctx.globalAlpha = l.opacity
    ctx.strokeStyle = l.color
    ctx.lineWidth = l.width
    ctx.setLineDash(l.dashed ? [6, 4] : [])
    ctx.beginPath()
    ctx.moveTo(X1, Y1)
    ctx.lineTo(X2, Y2)
    ctx.stroke()
    drawn++

    if (showLabels && l.label) {
      ctx.globalAlpha = 1
      ctx.fillStyle = '#111'
      ctx.font = '11px system-ui, sans-serif'
      ctx.fillText(l.label, (X1 + X2) / 2 + 3, (Y1 + Y2) / 2 - 3)
    }
  }

  // ---- dots (counts) ----
  ctx.setLineDash([])
  for (const d of set.dots) {
    const X = px(d.x), Y = py(d.y)
    if (X < -10 || Y < -10 || X > vw + 10 || Y > vh + 10) { culled++; continue }
    ctx.globalAlpha = d.opacity
    ctx.fillStyle = d.color
    ctx.beginPath()
    if (d.shape === 'circle') {
      ctx.arc(X, Y, d.r, 0, Math.PI * 2)
    } else if (d.shape === 'square') {
      ctx.rect(X - d.r, Y - d.r, d.r * 2, d.r * 2)
    } else {
      ctx.moveTo(X, Y - d.r); ctx.lineTo(X + d.r, Y)
      ctx.lineTo(X, Y + d.r); ctx.lineTo(X - d.r, Y)
    }
    ctx.fill()
    drawn++
  }

  ctx.restore()
  return { drawn, culled }
}
