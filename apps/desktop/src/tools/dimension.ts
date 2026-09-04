/**
 * Dimension tool: draft state machine, rendering, hit-testing.
 *
 * Ported from okular-redbeam `RedbeamAutomationBridge::createPolylineMeasurement`
 * (dimension branch) and the Slash line ending in `gui/pagepainter.cpp`
 * (`LineAnnotPainter::drawLineEndSlash`).
 *
 * The measurement itself lives in `@redbeam/domain` — nothing in this file
 * computes a length. Geometry is NORMALIZED page coordinates [0,1]; hit-testing
 * is SCREEN pixels, matching `hit.ts`, so tolerances stay constant with zoom.
 */
import {
  DEFAULT_DIMENSION_CONTENT,
  DIMENSION_COLOR,
  applyOrtho,
  dimensionLine,
  dimensionValueText,
  distanceToSegment,
  offsetPointsFor,
  type DimensionContent,
  type Markup,
  type OrthoMode,
  type Point,
} from '@redbeam/domain'
import type { Viewport } from '@redbeam/viewer'
import { normalizedToScreen } from '../draw.js'
import { EDGE_GRAB_PX, VERTEX_GRAB_PX } from '../hit.js'

export type { DimensionContent, OrthoMode } from '@redbeam/domain'

/**
 * A committed dimension.
 *
 * `rings[0]` is exactly the two measured points, stored the same way a
 * two-point polyline is — that is what lets the two agree by construction.
 * `content` is the parsed `markups.content_json`.
 */
export interface DimensionMarkup extends Omit<Markup, 'kind'> {
  kind: 'dimension'
  content: DimensionContent
}

// -------------------------------------------------------------- draft ------

export interface DimensionDraft {
  /** First measured point, normalized. */
  a: Point | null
  /** Second measured point once placed, normalized. */
  b: Point | null
  /** Live cursor, normalized — already ortho-constrained. */
  cursor: Point | null
  ortho: OrthoMode
  /** Perpendicular offset in PDF points, carried into content on commit. */
  offsetPoints: number
}

export const emptyDimensionDraft = (
  ortho: OrthoMode = 'none',
  offsetPoints = 0,
): DimensionDraft => ({ a: null, b: null, cursor: null, ortho, offsetPoints })

/** Pointer moved. Applies the ortho constraint against the first point. */
export function dimensionDraftMove(
  d: DimensionDraft,
  p: Point,
  pageW: number,
  pageH: number,
): DimensionDraft {
  if (d.a === null) return { ...d, cursor: p }
  return { ...d, cursor: applyOrtho(d.a, p, pageW, pageH, d.ortho) }
}

/** Click. First places the anchor, second closes the dimension. */
export function dimensionDraftPlace(
  d: DimensionDraft,
  p: Point,
  pageW: number,
  pageH: number,
): DimensionDraft {
  if (d.a === null) return { ...d, a: p, cursor: p }
  if (d.b === null) {
    const b = applyOrtho(d.a, p, pageW, pageH, d.ortho)
    return { ...d, b, cursor: b }
  }
  return d
}

/** Drop the last placed point (Backspace). */
export function dimensionDraftBack(d: DimensionDraft): DimensionDraft {
  if (d.b !== null) return { ...d, b: null }
  if (d.a !== null) return { ...d, a: null, cursor: null }
  return d
}

export function isDimensionCommittable(d: DimensionDraft): boolean {
  const b = d.b ?? d.cursor
  if (d.a === null || b === null) return false
  return d.a.x !== b.x || d.a.y !== b.y
}

/**
 * Freeze a draft into storable parts. Returns null when there is nothing
 * measurable — a zero-length dimension is a misclick, not a markup.
 */
export function commitDimension(
  d: DimensionDraft,
  pageW: number,
  pageH: number,
): { rings: Point[][]; content: DimensionContent } | null {
  if (!isDimensionCommittable(d)) return null
  const a = d.a!
  const b = applyOrtho(a, (d.b ?? d.cursor)!, pageW, pageH, d.ortho)
  return {
    rings: [[a, b]],
    content: {
      ...DEFAULT_DIMENSION_CONTENT,
      offsetPoints: d.offsetPoints,
      ortho: d.ortho === 'auto' ? recordedAxis(a, b) : d.ortho,
    },
  }
}

/** Which axis 'auto' actually locked, read back off the committed points. */
function recordedAxis(a: Point, b: Point): 'none' | 'horizontal' | 'vertical' {
  if (a.y === b.y && a.x !== b.x) return 'horizontal'
  if (a.x === b.x && a.y !== b.y) return 'vertical'
  return 'none'
}

/**
 * New offset for a dimension whose label has been dragged to `screen`.
 * Feed the result straight back into `content.offsetPoints`.
 */
export function dimensionOffsetFromDrag(
  m: DimensionMarkup,
  sx: number,
  sy: number,
  view: Viewport,
  pageW: number,
  pageH: number,
): number {
  const ring = m.rings[0]
  const a = ring?.[0]
  const b = ring?.[1]
  if (!a || !b) return m.content.offsetPoints
  const through = {
    x: (view.ox + sx) / (pageW * view.zoom),
    y: (view.oy + sy) / (pageH * view.zoom),
  }
  return offsetPointsFor(a, b, through, pageW, pageH)
}

// ------------------------------------------------------------ rendering ----

export interface DimensionDrawOptions {
  /** Scope colour. Defaults to the Qt build's dimension orange. */
  color: string
  lineWidth: number
  /** Length of the architectural slash tick, screen px. */
  tickPx: number
  /** Gap left at the measured point before the witness line starts. */
  witnessGapPx: number
  /** How far the witness line runs past the dimension line. */
  witnessOvershootPx: number
  fontPx: number
  /** Pill behind the value so it reads over dense drawing content. */
  labelBackground: string
  showLabel: boolean
  /**
   * Page calibration, feet per PDF point. 0 or negative renders
   * "set scale first", matching lengthContents() in the Qt build.
   */
  feetPerPoint: number
  /** Draw dashed — used for the in-progress draft. */
  dashed: boolean
}

export const DEFAULT_DIMENSION_DRAW: DimensionDrawOptions = {
  color: DIMENSION_COLOR,
  lineWidth: 1.6,
  tickPx: 9,
  witnessGapPx: 2,
  witnessOvershootPx: 4,
  fontPx: 11,
  labelBackground: 'rgba(20,22,26,0.82)',
  showLabel: true,
  feetPerPoint: 0,
  dashed: false,
}

/** Grab radius for the value label, screen px. Deliberately text-metric free. */
export const LABEL_GRAB_PX = 14

type Ctx = CanvasRenderingContext2D
type Screen = { x: number; y: number }

/** Everything both the renderer and the hit-tester need, in screen pixels. */
export interface DimensionScreenGeometry {
  a: Screen
  b: Screen
  lineA: Screen
  lineB: Screen
  mid: Screen
  /** Unit vector along the dimension line. */
  along: Screen
  /** Unit normal of the dimension line. */
  normal: Screen
  angle: number
  lengthPx: number
  lengthPdfPoints: number
}

export function dimensionScreenGeometry(
  a: Point,
  b: Point,
  offsetPoints: number,
  view: Viewport,
  pageW: number,
  pageH: number,
): DimensionScreenGeometry {
  const line = dimensionLine(a, b, offsetPoints, pageW, pageH)
  const toScreen = (p: Point) => normalizedToScreen(p.x, p.y, view, pageW, pageH)
  const sa = toScreen(line.a)
  const sb = toScreen(line.b)
  const sLineA = toScreen(line.lineA)
  const sLineB = toScreen(line.lineB)
  const dx = sLineB.x - sLineA.x
  const dy = sLineB.y - sLineA.y
  const len = Math.hypot(dx, dy)
  const along = len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 }
  return {
    a: sa,
    b: sb,
    lineA: sLineA,
    lineB: sLineB,
    mid: { x: (sLineA.x + sLineB.x) / 2, y: (sLineA.y + sLineB.y) / 2 },
    along,
    normal: { x: -along.y, y: along.x },
    angle: Math.atan2(dy, dx),
    lengthPx: len,
    lengthPdfPoints: line.lengthPdfPoints,
  }
}

/**
 * Draw one committed dimension.
 *
 * Signature matches the other overlay draw helpers: (ctx, markup, view, pageW,
 * pageH), with style passed explicitly rather than read from module state.
 */
export function drawDimension(
  ctx: Ctx,
  m: DimensionMarkup,
  view: Viewport,
  pageW: number,
  pageH: number,
  options: Partial<DimensionDrawOptions> = {},
): void {
  const ring = m.rings[0]
  const a = ring?.[0]
  const b = ring?.[1]
  if (!a || !b) return
  const o = { ...DEFAULT_DIMENSION_DRAW, ...options }
  const g = dimensionScreenGeometry(a, b, m.content.offsetPoints, view, pageW, pageH)
  paintDimension(ctx, g, o, m.content.label)
}

/** Draw the in-progress dimension, including the rubber band to the cursor. */
export function drawDimensionDraft(
  ctx: Ctx,
  d: DimensionDraft,
  view: Viewport,
  pageW: number,
  pageH: number,
  options: Partial<DimensionDrawOptions> = {},
): void {
  if (d.a === null) return
  const b = d.b ?? d.cursor
  const o = { ...DEFAULT_DIMENSION_DRAW, dashed: d.b === null, ...options }
  // the cursor starts life on top of the anchor; a zero-length dimension has
  // no direction to draw ticks or a label along, so show the anchor instead
  if (b === null || (b.x === d.a.x && b.y === d.a.y)) {
    // just the anchor placed — show where it landed
    const s = normalizedToScreen(d.a.x, d.a.y, view, pageW, pageH)
    ctx.save()
    ctx.fillStyle = o.color
    ctx.beginPath()
    ctx.arc(s.x, s.y, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  const g = dimensionScreenGeometry(d.a, b, d.offsetPoints, view, pageW, pageH)
  paintDimension(ctx, g, o, null)
}

function paintDimension(
  ctx: Ctx,
  g: DimensionScreenGeometry,
  o: DimensionDrawOptions,
  labelOverride: string | null,
): void {
  ctx.save()
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = o.color
  ctx.lineWidth = o.lineWidth

  // witness (extension) lines, only when the dimension line is offset off the
  // measured points — otherwise they would be zero-length stubs
  if (Math.abs(g.lineA.x - g.a.x) > 0.01 || Math.abs(g.lineA.y - g.a.y) > 0.01) {
    ctx.setLineDash(o.dashed ? [4, 3] : [])
    witness(ctx, g.a, g.lineA, o)
    witness(ctx, g.b, g.lineB, o)
  }

  // the dimension line itself
  ctx.setLineDash(o.dashed ? [5, 4] : [])
  ctx.beginPath()
  ctx.moveTo(g.lineA.x, g.lineA.y)
  ctx.lineTo(g.lineB.x, g.lineB.y)
  ctx.stroke()

  // architectural slash ticks. Port of LineAnnotPainter::drawLineEndSlash:
  // a tick through the endpoint at 60 degrees to the line, clamped to half the
  // segment so a very short dimension does not grow ticks bigger than itself.
  ctx.setLineDash([])
  const size = Math.min(o.tickPx, g.lengthPx / 2)
  if (size > 0) {
    slash(ctx, g.lineA, g, size)
    slash(ctx, g.lineB, g, size)
  }

  if (o.showLabel) {
    const text = labelOverride ?? dimensionValueText(g.lengthPdfPoints, o.feetPerPoint)
    paintLabel(ctx, g, o, text)
  }

  ctx.restore()
}

function witness(ctx: Ctx, from: Screen, to: Screen, o: DimensionDrawOptions): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = Math.hypot(dx, dy)
  if (d <= o.witnessGapPx) return
  const ux = dx / d
  const uy = dy / d
  ctx.beginPath()
  ctx.moveTo(from.x + ux * o.witnessGapPx, from.y + uy * o.witnessGapPx)
  ctx.lineTo(to.x + ux * o.witnessOvershootPx, to.y + uy * o.witnessOvershootPx)
  ctx.stroke()
}

function slash(ctx: Ctx, at: Screen, g: DimensionScreenGeometry, size: number): void {
  const half = size / 2
  const xOffset = Math.cos(Math.PI / 3) * half
  ctx.beginPath()
  ctx.moveTo(at.x - g.along.x * xOffset + g.normal.x * half, at.y - g.along.y * xOffset + g.normal.y * half)
  ctx.lineTo(at.x + g.along.x * xOffset - g.normal.x * half, at.y + g.along.y * xOffset - g.normal.y * half)
  ctx.stroke()
}

function paintLabel(
  ctx: Ctx,
  g: DimensionScreenGeometry,
  o: DimensionDrawOptions,
  text: string,
): void {
  if (text.length === 0) return
  ctx.save()
  ctx.font = `${o.fontPx}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.translate(g.mid.x, g.mid.y)
  // keep the text upright: past +-90 degrees, flip it rather than read it
  // upside down
  let angle = g.angle
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI
  ctx.rotate(angle)

  const width = measureWidth(ctx, text)
  const padX = 4
  const padY = 2
  ctx.fillStyle = o.labelBackground
  ctx.beginPath()
  ctx.rect(
    -width / 2 - padX,
    -o.fontPx / 2 - padY,
    width + padX * 2,
    o.fontPx + padY * 2,
  )
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

/** measureText is absent from some headless 2D contexts; fall back to an estimate. */
function measureWidth(ctx: Ctx, text: string): number {
  const m = typeof ctx.measureText === 'function' ? ctx.measureText(text) : undefined
  const w = m?.width
  return typeof w === 'number' && Number.isFinite(w) ? w : text.length * 6
}

// ---------------------------------------------------------- hit-testing ----

export type DimensionHitPart = 'vertex' | 'edge' | 'label'

export interface DimensionHit {
  markupId: string
  /** 'vertex' = a measured point (index 0/1); 'edge' = the dimension line;
   *  'label' = the value pill, which is the handle for the offset. */
  part: DimensionHitPart
  index: number
}

/**
 * Topmost dimension hit at a screen point.
 *
 * Precedence follows `hit.ts` — vertex first so a measured point that sits
 * under the line is still grabbable — with the label inserted ahead of the
 * line because it is drawn on top of it and is the offset handle.
 *
 * The generic `hitTest()` in hit.ts would find rings[0] for a dimension too,
 * but it tests the MEASURED segment, which is the wrong target once the
 * dimension line is offset. Use this for dimensions.
 */
export function hitTestDimension(
  sx: number,
  sy: number,
  markups: DimensionMarkup[],
  view: Viewport,
  pageW: number,
  pageH: number,
): DimensionHit | null {
  const geometry = markups.map((m) => {
    const ring = m.rings[0]
    const a = ring?.[0]
    const b = ring?.[1]
    return a && b
      ? dimensionScreenGeometry(a, b, m.content.offsetPoints, view, pageW, pageH)
      : null
  })

  for (let i = markups.length - 1; i >= 0; i--) {
    const g = geometry[i]
    if (!g) continue
    if (Math.hypot(g.a.x - sx, g.a.y - sy) <= VERTEX_GRAB_PX) {
      return { markupId: markups[i]!.id, part: 'vertex', index: 0 }
    }
    if (Math.hypot(g.b.x - sx, g.b.y - sy) <= VERTEX_GRAB_PX) {
      return { markupId: markups[i]!.id, part: 'vertex', index: 1 }
    }
  }

  for (let i = markups.length - 1; i >= 0; i--) {
    const g = geometry[i]
    if (!g) continue
    if (Math.hypot(g.mid.x - sx, g.mid.y - sy) <= LABEL_GRAB_PX) {
      return { markupId: markups[i]!.id, part: 'label', index: -1 }
    }
  }

  for (let i = markups.length - 1; i >= 0; i--) {
    const g = geometry[i]
    if (!g) continue
    if (distanceToSegment({ x: sx, y: sy }, g.lineA, g.lineB) <= EDGE_GRAB_PX) {
      return { markupId: markups[i]!.id, part: 'edge', index: 0 }
    }
  }

  return null
}
