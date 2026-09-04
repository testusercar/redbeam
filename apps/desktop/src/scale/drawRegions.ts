/**
 * Painting scale regions on the sheet.
 *
 * A region governs every measurement inside it, so it has to be visible
 * whether or not anyone is thinking about scale at that moment — an estimator
 * drawing an area needs to know they have crossed into a detail at 1/4" before
 * the quantity tells them.
 *
 * Drawn as an outline with its scale written on it and no fill. A filled box
 * over a details sheet hides the drawing it exists to describe, and these are
 * large: four of them can cover most of a page.
 */
import type { ScaleRegion } from '@redbeam/domain'
import { scaleLabel } from '@redbeam/domain'

export interface RegionView {
  ox: number
  oy: number
  zoom: number
}

export interface DrawRegionOptions {
  pageWidth: number
  pageHeight: number
  /** Dimmed unless the scale tool is in hand — context, not the takeoff. */
  active: boolean
}

const DASH = [7, 5]

/** Normalized to screen, matching the overlay's transform. */
function toScreen(
  p: { x: number, y: number }, view: RegionView, pageWidth: number, pageHeight: number,
): { x: number, y: number } {
  return {
    x: p.x * pageWidth * view.zoom + view.ox,
    y: p.y * pageHeight * view.zoom + view.oy,
  }
}

export function drawScaleRegions(
  ctx: CanvasRenderingContext2D,
  regions: readonly ScaleRegion[],
  view: RegionView,
  opts: DrawRegionOptions,
): void {
  if (regions.length === 0) return
  ctx.save()

  /*
   * Largest first, so a region nested inside another paints on top of it.
   * Same order the resolution uses — a detail inside a detail wins there, and
   * the drawing has to agree with the arithmetic or the picture lies.
   */
  const ordered = [...regions].sort((a, b) => {
    const areaOf = (r: ScaleRegion) =>
      Math.abs(r.rect.x1 - r.rect.x0) * Math.abs(r.rect.y1 - r.rect.y0)
    return areaOf(b) - areaOf(a)
  })

  for (const region of ordered) {
    const a = toScreen({ x: region.rect.x0, y: region.rect.y0 }, view, opts.pageWidth, opts.pageHeight)
    const b = toScreen({ x: region.rect.x1, y: region.rect.y1 }, view, opts.pageWidth, opts.pageHeight)
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    const w = Math.abs(b.x - a.x)
    const h = Math.abs(b.y - a.y)

    ctx.setLineDash(DASH)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = opts.active ? 'rgba(226,72,61,0.95)' : 'rgba(226,72,61,0.45)'
    ctx.strokeRect(x, y, w, h)

    // The scale itself, on the box. A region whose scale you have to click to
    // discover is one people will forget is there.
    const text = region.label === ''
      ? scaleLabel(region.feetPerPoint)
      : `${region.label} · ${scaleLabel(region.feetPerPoint)}`
    ctx.setLineDash([])
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
    const metrics = ctx.measureText(text)
    const padX = 5
    const boxH = 16
    // Inside the top-left corner, so it stays on screen when the region is
    // partly scrolled off — a label drawn above the box vanishes first.
    ctx.fillStyle = opts.active ? 'rgba(226,72,61,0.92)' : 'rgba(226,72,61,0.55)'
    ctx.fillRect(x, y, metrics.width + padX * 2, boxH)
    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + padX, y + boxH / 2)
  }

  ctx.restore()
}
