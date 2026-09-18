/**
 * Layout preview rendering (plan 06.9).
 *
 * Draws the panel grid the engine computed, on top of the drawing, so a piece
 * count can be checked by eye rather than trusted. This is the whole point of
 * a preview: 662 is unfalsifiable as a number and obvious as a picture — a
 * grid that runs off the ceiling, or seams that jump across a gap between two
 * areas, is visible in a second and invisible in a total.
 *
 * Cells arrive in PDF POINTS, because that is the space the engine works in.
 * They are converted to screen here and nowhere else.
 */
import type { PanelCell, PanelPieceSummary, Point, RunLayoutEntry } from '@redbeam/domain'
import type { Viewport } from '@redbeam/viewer'
import { normalizedToScreen } from '../draw.js'

export interface LayoutDrawOptions {
  /** Scope colour; the grid is tinted with it so two scopes stay distinct. */
  color: string
  /** Page box in PDF points, to get from engine space back to normalized. */
  pageWidth: number
  pageHeight: number
  /**
   * Draw the FULL grid cell as well as the covered part. Off by default: the
   * full cell extends past the ceiling edge, which is accurate but reads as
   * material that is not there.
   *
   * The run path's `showOverflow` is the same idea, and the workspace sets
   * both from one preference — "material past the edge" is one question, and
   * an estimator asking it does not care whether the product happens to be a
   * grid of cells or a set of runs.
   */
  showFullCells?: boolean
  /** Label each cell with its stock kind. Suppressed when zoomed out. */
  labels?: boolean
  /** Below this zoom, per-cell labels are noise rather than information. */
  labelMinZoom?: number
  /** Multiplier on every stroke width: the line-weight setting, times zoom when weights follow it. */
  lineWeight?: number
  /**
   * A run product's face width in PDF points. Pieces are drawn as bands that
   * wide once the band would be at least 2px on screen, and as lines below
   * that. Kenneth, 2026-09-10: "add a baffle width ... so the visual width
   * shows on the drawings".
   */
  componentWidthPoints?: number
  /**
   * What of a RUN layout to draw. Each defaults to the reading an estimator
   * does most often, and each is a global preference rather than a per-scope
   * one — someone checking waste wants overhang on everywhere, and someone
   * checking coverage wants it off everywhere.
   */
  showOverflow?: boolean
  showRails?: boolean
  showTrim?: boolean
  showSeams?: boolean
}

// Labels off: the stock kind printed on every part panel ("half-width",
// "half-length") read as tape stuck across the ceiling. The hatch says
// which panels are cut, and the Parts page counts them.
const DEFAULTS = { showFullCells: false, labels: false, labelMinZoom: 0.9 }

/** PDF points -> screen, via normalized. */
function toScreen(p: Point, v: Viewport, o: LayoutDrawOptions) {
  return normalizedToScreen(p.x / o.pageWidth, p.y / o.pageHeight, v, o.pageWidth, o.pageHeight)
}

function tracePath(
  ctx: CanvasRenderingContext2D,
  ring: readonly Point[],
  v: Viewport,
  o: LayoutDrawOptions,
): void {
  if (ring.length === 0) return
  ring.forEach((p, i) => {
    const s = toScreen(p, v, o)
    if (i === 0) ctx.moveTo(s.x, s.y)
    else ctx.lineTo(s.x, s.y)
  })
  ctx.closePath()
}

/**
 * Draw one scope's laid-out cells.
 *
 * A HALF piece is drawn differently from a full one, because that difference
 * is what someone is checking: 194 halves and 565 fulls is a materially
 * different order from 759 fulls, and the two look identical unless the
 * preview says so.
 */
export function drawPanelLayout(
  ctx: CanvasRenderingContext2D,
  cells: readonly PanelCell[],
  view: Viewport,
  options: LayoutDrawOptions,
): void {
  if (cells.length === 0) return
  const o = { ...DEFAULTS, ...options }
  const lw = o.lineWeight ?? 1

  ctx.save()

  if (o.showFullCells) {
    // The uncovered remainder of each cell: the same fill at half strength,
    // solid — material past the edge, drawn as material. No dashes anywhere
    // in the preview (Aaron, 2026-09-11: "get rid of the dashed lines").
    for (const c of cells) {
      ctx.beginPath()
      tracePath(ctx, c.fullPath, view, o)
      ctx.fillStyle = o.color
      ctx.globalAlpha = 0.07
      ctx.fill()
      ctx.globalAlpha = 0.25
      ctx.strokeStyle = o.color
      ctx.lineWidth = 0.6 * lw
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // The stock actually consumed, filled. Half pieces are darker so the split
  // is legible without reading a legend. The outline is FAINT: the fill says
  // where the panel is, and a bold grid over a plan hid the plan.
  for (const c of cells) {
    ctx.beginPath()
    tracePath(ctx, c.stockPath, view, o)
    ctx.fillStyle = o.color
    ctx.globalAlpha = c.stockKind === 'full' ? 0.14 : 0.26
    ctx.fill()
    ctx.globalAlpha = c.stockKind === 'full' ? 0.4 : 0.6
    ctx.strokeStyle = o.color
    ctx.lineWidth = (c.stockKind === 'full' ? 0.6 : 1) * lw
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  if (o.labels && view.zoom >= o.labelMinZoom) {
    ctx.fillStyle = '#ffffff'
    ctx.font = '9px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const c of cells) {
      if (c.stockKind === 'full') continue   // only the exceptions are worth labelling
      const centre = centroid(c.stockPath)
      if (!centre) continue
      const s = toScreen(centre, view, o)
      ctx.fillText(c.stockKind, s.x, s.y)
    }
  }

  ctx.restore()
}

/**
 * The parts of `full` not covered by `inside`, as up to two segments. Both
 * lie on one line with `inside` within `full`, so the ends are compared by
 * their distance along it.
 */
export function overhangs(
  full: { a: Point; b: Point },
  inside: { a: Point; b: Point },
): Array<[Point, Point]> {
  const dx = full.b.x - full.a.x, dy = full.b.y - full.a.y
  const len2 = dx * dx + dy * dy
  if (!(len2 > 0)) return []
  const t = (p: Point) => ((p.x - full.a.x) * dx + (p.y - full.a.y) * dy) / len2
  const [t0, t1] = [t(inside.a), t(inside.b)].sort((x, y) => x - y)
  const at = (k: number): Point => ({ x: full.a.x + dx * k, y: full.a.y + dy * k })
  const out: Array<[Point, Point]> = []
  const eps = 1e-6
  if (t0! > eps) out.push([at(0), at(Math.min(1, t0!))])
  if (t1! < 1 - eps) out.push([at(Math.max(0, t1!)), at(1)])
  return out
}

function centroid(ring: readonly Point[]): Point | null {
  if (ring.length === 0) return null
  let x = 0, y = 0
  for (const p of ring) { x += p.x; y += p.y }
  return { x: x / ring.length, y: y / ring.length }
}

/**
 * A one-line summary for the preview toggle.
 *
 * Takes the engine's own summary rather than recomputing the ordered count
 * from the cells. Re-deriving "two halves make a panel" in a display helper is
 * how a label starts disagreeing with the BOM it is describing.
 */
export function layoutSummary(result: PanelPieceSummary): string {
  if (result.placedCellCount === 0) return 'nothing laid out'
  return `${result.placedCellCount} cells · ${result.fullPieceCount} full + ` +
         `${result.halfPieceCount} half → ${result.panelCount} ordered`
}

/**
 * Draw a RUN product's layout — planks, baffles, cassettes.
 *
 * These have no panel cells. Their geometry is a set of cut pieces lying along
 * runs, so a preview written only against `cells` had nothing to draw for them
 * and drew nothing at all: the counts were right and the picture was blank,
 * which is the one combination that makes a number impossible to check by eye.
 *
 * What is drawn, and why each part earns its ink:
 *  - every piece's INSIDE segment, in the scope colour — this is the material,
 *    and seeing it run off the edge of a ceiling is the whole point;
 *  - a tick across each seam between consecutive pieces, because a joiner is a
 *    real ordered part and the estimator is counting them;
 *  - rails, dashed and perpendicular, under the pieces — they are structure,
 *    so they read as background rather than as more product.
 *
 * Segments arrive in PDF POINTS, the space the engine works in. They are
 * converted to screen here and nowhere else, exactly as the cell path does.
 */
export function drawRunLayout(
  ctx: CanvasRenderingContext2D,
  entries: readonly RunLayoutEntry[],
  v: Viewport,
  o: LayoutDrawOptions,
): void {
  if (entries.length === 0) return
  const show = {
    overflow: o.showOverflow ?? false,
    rails: o.showRails ?? true,
    trim: o.showTrim ?? true,
    seams: o.showSeams ?? true,
  }
  const lw = o.lineWeight ?? 1
  ctx.save()

  for (const entry of entries) {
    /*
     * The trim line: the edge of the region, which is what perimeter trim
     * follows. Drawn first and faintly — it is the boundary the product stops
     * at, so it belongs behind the product rather than on top of it.
     */
    if (show.trim) {
      ctx.strokeStyle = o.color
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 2 * lw
      ctx.beginPath()
      for (const ring of entry.region) tracePath(ctx, ring, v, o)
      ctx.stroke()
    }

    // Rails next: they sit under the product, which is how they are installed
    // and how they read. Solid and faint — a dashed rail read as a hidden
    // line on a plan that is full of them.
    if (show.rails && entry.layout.railPieces.length > 0) {
      ctx.strokeStyle = o.color
      ctx.globalAlpha = 0.22
      ctx.lineWidth = 1 * lw
      ctx.beginPath()
      for (const rail of entry.layout.railPieces) {
        const a = toScreen(rail.insideSegment.a, v, o)
        const b = toScreen(rail.insideSegment.b, v, o)
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
      }
      ctx.stroke()
    }

    /*
     * Each piece is a BAND at the product's face width — a 4" baffle reads
     * as a 4" baffle and the gap between two is the reveal — drawn along the
     * FULL segment: the installed part at full strength, and the overhang
     * past the region at half, solid, the same band. The overhang is the
     * difference between what is installed and what is ordered, so it is the
     * whole of a waste conversation; it was a dashed line at another weight
     * and read as a different thing from the piece it is the end of
     * (Kenneth: "the overflow is difficult to see"; Aaron: "the whole piece
     * at 50% past the edge, and no dashes").
     *
     * Below 2px of band the piece is a line, and the overhang a fainter line.
     */
    ctx.strokeStyle = o.color
    const bandPx = (o.componentWidthPoints ?? 0) * v.zoom
    const band = (pa: Point, pb: Point, fillAlpha: number, strokeAlpha: number) => {
      const a = toScreen(pa, v, o)
      const b = toScreen(pb, v, o)
      const dx = b.x - a.x, dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (!(len > 0)) return
      if (bandPx >= 2) {
        const nx = (-dy / len) * (bandPx / 2), ny = (dx / len) * (bandPx / 2)
        ctx.beginPath()
        ctx.moveTo(a.x + nx, a.y + ny)
        ctx.lineTo(b.x + nx, b.y + ny)
        ctx.lineTo(b.x - nx, b.y - ny)
        ctx.lineTo(a.x - nx, a.y - ny)
        ctx.closePath()
        ctx.fillStyle = o.color
        ctx.globalAlpha = fillAlpha
        ctx.fill()
        ctx.globalAlpha = strokeAlpha
        ctx.lineWidth = 1 * lw
        ctx.stroke()
      } else {
        ctx.globalAlpha = strokeAlpha
        ctx.lineWidth = 1.5 * lw
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }
    for (const piece of entry.layout.pieces) {
      if (show.overflow) {
        // The two ends past the region, if any: fullSegment minus insideSegment.
        for (const [pa, pb] of overhangs(piece.fullSegment, piece.insideSegment)) band(pa, pb, 0.11, 0.42)
      }
      band(piece.insideSegment.a, piece.insideSegment.b, 0.22, 0.85)
    }

    /*
     * Seams. A piece that does not start its run begins at a joiner, and a
     * joiner is an ordered part — so the place two pieces meet is information,
     * not decoration. Drawn as a short tick across the run.
     */
    if (!show.seams) continue
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1 * lw
    ctx.beginPath()
    for (const piece of entry.layout.pieces) {
      if (piece.startCap) continue
      const a = toScreen(piece.insideSegment.a, v, o)
      const b = toScreen(piece.insideSegment.b, v, o)
      const dx = b.x - a.x, dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (!(len > 0)) continue
      // Perpendicular to the run, 3px each side. Fixed in SCREEN space: a seam
      // mark is an annotation on the drawing, not a thing on the ceiling, so it
      // should not grow with zoom.
      const nx = (-dy / len) * 3, ny = (dx / len) * 3
      ctx.moveTo(a.x + nx, a.y + ny)
      ctx.lineTo(a.x - nx, a.y - ny)
    }
    ctx.stroke()
  }

  ctx.restore()
}
