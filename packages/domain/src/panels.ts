/**
 * Panel layout: the grid, the cell, and how much stock each cell consumes.
 *
 * Ported from okular-redbeam `part/redbeamscopepanel.cpp`:
 *   redbeamPanelGranularityIndex          -> panelGranularityIndex
 *   redbeamPanelGranularityForIndex       -> panelGranularityForIndex
 *   redbeamRoundUpQuantity                -> roundUpQuantity
 *   redbeamFractionApproximately          -> fractionApproximately
 *   redbeamPieceFractionLabel             -> pieceFractionLabel
 *   redbeamOrderStockPieceCount           -> orderStockPieceCount
 *   redbeamPanelCellPath                  -> panelCellPath
 *   redbeamAutomaticPanelGridOrigin       -> automaticPanelGridOrigin
 *   redbeamPanelLocalBoundsForPath        -> localBoundsOf
 *   redbeamPanelClampedStockStart         -> clampedStockStart
 *   redbeamPanelStockSelectionForCell     -> panelStockSelectionForCell
 *   redbeamBuildPanelCells                -> buildPanelCells
 *   the Panels branch of redbeamQuantitySummaryForLayout(s) -> summarizePanelCells
 *
 * WHAT REPLACED QPainterPath's BOOLEAN OPS
 * ----------------------------------------
 * The Qt engine leans on QPainterPath::intersected / subtracted / contains /
 * intersects. There is no such thing here and pulling in a clipping library
 * would break `check:domain-purity`. Three observations make the general
 * boolean op unnecessary rather than merely approximated:
 *
 *  1. A grid cell is a CONVEX rectangle, and a half-stock candidate is another
 *     convex rectangle. Sutherland-Hodgman clips an arbitrary (possibly
 *     concave) subject against a convex window, so clipping REGION-against-CELL
 *     is the tractable direction. On a concave subject it can emit zero-width
 *     bridge edges along the window boundary; those contribute exactly zero to
 *     the shoelace sum, so the AREA is exact, not estimated.
 *  2. Every subtraction the C++ performs is between a candidate rectangle and
 *     the clipped region, and only its AREA is ever read. area(A - B) is
 *     area(A) - area(A ∩ B); with A convex the intersection is a clip. So no
 *     subtraction primitive is needed at all.
 *  3. `intersects(cell) || contains(cellCentre)` in the C++ is a fast reject in
 *     front of the real test `clippedArea > minUsefulArea`. A cell that fails
 *     the fast reject has zero clipped area and would fail the real test too,
 *     so dropping it changes nothing but speed.
 *
 * The one thing genuinely given up is a UNION. Rings are carried as a list and
 * classified by nesting depth (regionArea's rule), which double-counts the lap
 * if two AREA markups physically overlap. That is the same limitation
 * scope.ts::areaSquareFeet already ships with, and it is why the two numbers
 * agree; if overlapping areas ever have to be supported, both must change
 * together. It is not a panel-count-only concern.
 *
 * COORDINATES
 * -----------
 * Everything here is in PDF POINTS, like the C++. Callers convert normalized
 * rings with scope.ts::ringToPoints and convert feet to points by dividing by
 * `Calibration.feetPerPoint`.
 *
 * Internally the region is rotated into the grid's own (along, offset) frame
 * once per group. That frame is orthonormal, so areas and lengths are
 * unchanged, and every cell becomes an axis-aligned rectangle — which is what
 * makes the clip a four-plane Sutherland-Hodgman rather than a general one.
 */

import { signedPolygonArea, pointInPolygon, type Point, type Region } from './geometry.js'
import { toPagePoints, type PageSize, type Segment, type NormalizedDirection } from './pattern.js'

// ---------------------------------------------------------------------------
// 06.1 — allowed piece fractions and yield granularity
// ---------------------------------------------------------------------------

/**
 * redbeamAllowedPieceFractions lives in pieces.ts as `allowedPieceFractions`.
 * It is the YIELD ladder — half / quarter / third / full — and it belongs to
 * the run-based products. Panels do not use it: a panel is cut in two axes, not
 * along one run, so its granularity is the binary rule below and its ordering
 * rule is orderStockPieceCount(). Do not wire the yield ladder into panels.
 */

/** Panel granularity is BINARY, unlike yield granularity: 0 = full, 1 = half. */
export function panelGranularityIndex(panelGranularity: string): 0 | 1 {
  const n = panelGranularity.trim().toLowerCase()
  return n === 'half' || n === 'halflength' || n === 'halfwidth' ? 1 : 0
}

export function panelGranularityForIndex(index: number): 'full' | 'half' {
  return index === 1 ? 'half' : 'full'
}

/**
 * Round a quantity up to a whole piece, with a hair of slack.
 *
 * The 0.0001 is load-bearing: without it an accumulated 4.0000000001 panels
 * orders five. It is a tolerance against float drift, not a discount.
 */
export function roundUpQuantity(value: number): number {
  return Math.max(0, Math.trunc(Math.ceil(value - 0.0001)))
}

/**
 * Whether a stock fraction reads as one of the nameable fractions.
 *
 * The 0.035 window is wide on purpose — a placed piece measured off a drawing
 * is never exactly 0.75 — and the bands do not overlap, since the closest pair
 * (2/3 and 0.75) are 0.083 apart.
 */
export function fractionApproximately(fraction: number, target: number): boolean {
  return Math.abs(fraction - target) < 0.035
}

/** Display label for a stock fraction. Falls back to two decimals. */
export function pieceFractionLabel(fraction: number): string {
  if (fractionApproximately(fraction, 1.0)) return 'Full'
  if (fractionApproximately(fraction, 0.75)) return '3/4'
  if (fractionApproximately(fraction, 2.0 / 3.0)) return '2/3'
  if (fractionApproximately(fraction, 0.5)) return 'Half'
  if (fractionApproximately(fraction, 1.0 / 3.0)) return '1/3'
  if (fractionApproximately(fraction, 0.25)) return '1/4'
  return fraction.toFixed(2)
}

/**
 * Stock pieces that must be PRODUCED to yield these placed fractions.
 *
 * Production rule: fractional cuts may come off the same stock piece. This is
 * NOT an installed-length assumption — each fraction is still a separate piece
 * in the field. Four quarter pieces are one ordered panel and four installed
 * ones.
 *
 * The nesting is deliberately conservative and asymmetric:
 *  - thirds pair with two-thirds one-for-one, and the two-third piece is what
 *    gets ordered, so the leftover third rides along free;
 *  - a 3/4 pairs with a 1/4 the same way;
 *  - an ODD half consumes a whole panel and is then allowed to absorb up to two
 *    quarters from its own offcut — hence `quarter -= 2`, not `quarter -= 1`.
 * Anything outside the named fractions drops the whole calculation into a
 * plain sum-and-round-up, because mixed arbitrary offcuts cannot be nested by
 * this rule and pretending otherwise would UNDER-order.
 */
export function orderStockPieceCount(stockFractions: readonly number[]): number {
  let full = 0
  let threeQuarter = 0
  let twoThird = 0
  let half = 0
  let third = 0
  let quarter = 0
  let fallbackTotal = 0
  let fallback = false

  for (const fraction of stockFractions) {
    if (fractionApproximately(fraction, 1.0)) full++
    else if (fractionApproximately(fraction, 0.75)) threeQuarter++
    else if (fractionApproximately(fraction, 2.0 / 3.0)) twoThird++
    else if (fractionApproximately(fraction, 0.5)) half++
    else if (fractionApproximately(fraction, 1.0 / 3.0)) third++
    else if (fractionApproximately(fraction, 0.25)) quarter++
    else {
      fallback = true
      fallbackTotal += Math.max(0, fraction)
    }
  }

  if (fallback) {
    const total =
      fallbackTotal + full + threeQuarter * 0.75 + twoThird * (2.0 / 3.0) +
      half * 0.5 + third * (1.0 / 3.0) + quarter * 0.25
    return roundUpQuantity(total)
  }

  let produced = full
  if (twoThird > 0 || third > 0) {
    const pairedThirds = Math.min(twoThird, third)
    third -= pairedThirds
    produced += twoThird
    produced += roundUpQuantity(third / 3.0)
  }

  if (threeQuarter > 0 || half > 0 || quarter > 0) {
    const pairedQuarters = Math.min(threeQuarter, quarter)
    quarter -= pairedQuarters
    produced += threeQuarter
    produced += Math.trunc(half / 2)
    half %= 2
    if (half > 0) {
      produced++
      quarter = Math.max(0, quarter - 2)
    }
    produced += roundUpQuantity(quarter / 4.0)
  }

  return produced
}

// ---------------------------------------------------------------------------
// 06.2 — the panel grid
// ---------------------------------------------------------------------------

/** A point in the grid's own frame: `along` the run, `offset` across it. */
export interface LocalPoint {
  along: number
  offset: number
}

/** Local-frame span of some geometry. `valid` is false when it had no points. */
export interface PanelLocalBounds {
  minAlong: number
  maxAlong: number
  minOffset: number
  maxOffset: number
  valid: boolean
}

export type PanelStockKind = 'full' | 'half-length' | 'half-width'

export interface PanelStockSelection {
  /** Stock rectangle in PDF points, four corners. */
  path: Point[]
  /** Fraction of one stock panel this cell consumes: 1 or 0.5. */
  fraction: number
  kind: PanelStockKind
  requiredLengthFraction: number
  requiredWidthFraction: number
  halfLengthFit: boolean
  halfWidthFit: boolean
  halfLengthUncoveredFraction: number
  halfWidthUncoveredFraction: number
  halfLengthOverageFraction: number
  halfWidthOverageFraction: number
  halfLengthScore: number
  halfWidthScore: number
  /** Diagnostic strings, verbatim from the Qt build. See selectionReason note. */
  selectionReason: string
  halfLengthReason: string
  halfWidthReason: string
}

export interface PanelCell {
  /**
   * The sheet this cell was laid out on.
   *
   * A scope spans sheets and the cells of every one of them are returned in a
   * single flat list, so without this a preview cannot tell which of them
   * belong to the sheet it is drawing — and it drew all of them, in the
   * current page's coordinate space. A region traced on sheet 9 appeared as a
   * ghost on sheet 1, in roughly the right shape and the wrong place, on a
   * page where nothing could select or move it.
   *
   * Optional because a cell can be built without a group, in tests and in
   * `buildPanelCells` directly; `layoutPanels` sets it for every cell it
   * returns.
   */
  pageId?: string
  gridRow: number
  gridColumn: number
  /** The whole grid cell, PDF points. */
  fullPath: Point[]
  /** Region ∩ cell as rings, PDF points. Rings may be holes; see `clippedArea`. */
  clippedRegion: Region
  /** Signed area of `clippedRegion` in PDF points squared, holes removed. */
  clippedArea: number
  /** The stock piece actually consumed, PDF points. */
  stockPath: Point[]
  coverageFraction: number
  stockFraction: number
  stockKind: PanelStockKind
  requiredLengthFraction: number
  requiredWidthFraction: number
  halfLengthFit: boolean
  halfWidthFit: boolean
  halfLengthUncoveredFraction: number
  halfWidthUncoveredFraction: number
  halfLengthOverageFraction: number
  halfWidthOverageFraction: number
  halfLengthScore: number
  halfWidthScore: number
  selectionReason: string
  halfLengthReason: string
  halfWidthReason: string
}

/** The orthonormal frame a grid is laid out in, plus its cell size. */
interface GridFrame {
  origin: Point
  direction: Point
  normal: Point
  panelLength: number
  panelWidth: number
}

const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y

/** Unit direction and its left normal, or null for a degenerate line. */
function frameAxes(directionLine: Segment): { direction: Point; normal: Point } | null {
  const dx = directionLine.b.x - directionLine.a.x
  const dy = directionLine.b.y - directionLine.a.y
  const length = Math.hypot(dx, dy)
  if (!(length > 0)) return null
  const direction = { x: dx / length, y: dy / length }
  return { direction, normal: { x: -direction.y, y: direction.x } }
}

const toLocal = (p: Point, f: GridFrame): LocalPoint => {
  const rel = { x: p.x - f.origin.x, y: p.y - f.origin.y }
  return { along: dot(rel, f.direction), offset: dot(rel, f.normal) }
}

const toPage = (p: LocalPoint, f: GridFrame): Point => ({
  x: f.origin.x + f.direction.x * p.along + f.normal.x * p.offset,
  y: f.origin.y + f.direction.y * p.along + f.normal.y * p.offset,
})

/**
 * The four corners of a cell (or of a half-stock rectangle), in PDF points.
 *
 * Port of redbeamPanelCellPath. Corner ORDER is preserved from the C++ —
 * start/start, end/start, end/end, start/end — so the ring winds the same way
 * and any consumer that cares about winding sees what Qt drew.
 */
export function panelCellPath(
  origin: Point,
  direction: Point,
  normal: Point,
  startAlong: number,
  endAlong: number,
  startOffset: number,
  endOffset: number,
): Point[] {
  const at = (along: number, offset: number): Point => ({
    x: origin.x + direction.x * along + normal.x * offset,
    y: origin.y + direction.y * along + normal.y * offset,
  })
  return [
    at(startAlong, startOffset),
    at(endAlong, startOffset),
    at(endAlong, endOffset),
    at(startAlong, endOffset),
  ]
}

/** Axis-aligned bounds of a region in PDF points. Null when it has no points. */
function regionBounds(region: Region): { min: Point; max: Point } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const ring of region) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
}

/**
 * Grid origin when no pattern origin has been placed.
 *
 * Port of redbeamAutomaticPanelGridOrigin. Two things about it are
 * load-bearing and neither is obvious:
 *
 *  - The SEED is `directionLine.a`, the direction line's own first point, not
 *    the region. For a scope-default direction the Qt build rebases the line at
 *    PDF page point (0,0) before it ever gets here (see scopeDefaultGridLine),
 *    so the grid is anchored to the SHEET, not to the markup. Anchor it to the
 *    region's corner instead and every count moves.
 *  - The floor() snaps the origin to a whole number of panels from the seed, so
 *    the grid LINES are unchanged by this function — it only picks which cell
 *    is numbered (0,0). That is why the ±1 padding in buildPanelCells is safe
 *    and why an origin one panel out cannot change a count.
 */
export function automaticPanelGridOrigin(
  region: Region,
  directionLine: Segment,
  panelWidthPoints: number,
  panelLengthPoints: number,
  /**
   * Lay this area out on its own, rather than on a grid shared with the sheet.
   *
   * The seed is what fixes the grid's PHASE. `directionLine.a` is the sheet
   * origin for a scope-default direction, so every area on the page lands on
   * one grid: panels line up across a corridor between two ceilings, and an
   * area that happens to start mid-cell wastes a row it did not need to.
   *
   * Seeding from the area's own first corner instead makes the phase a
   * property of the area, so each one starts a whole panel at its own edge.
   * That is fewer part-panels per area — and a different total, which is why
   * it is a choice and not a correction: the sheet-wide grid is what the Qt
   * build does and what the golden fixtures capture, and two estimators
   * comparing a bid need to know which they are looking at.
   */
  perArea = false,
): Point {
  const bounds = regionBounds(region)
  const axes = frameAxes(directionLine)
  if (!bounds || !axes || !(panelWidthPoints > 0) || !(panelLengthPoints > 0)) {
    return directionLine.a
  }
  const { direction, normal } = axes
  const seed = perArea ? { x: bounds.min.x, y: bounds.min.y } : directionLine.a
  const corners: Point[] = [
    { x: bounds.min.x, y: bounds.min.y },
    { x: bounds.max.x, y: bounds.min.y },
    { x: bounds.min.x, y: bounds.max.y },
    { x: bounds.max.x, y: bounds.max.y },
  ]

  let minAlong = Infinity
  let minOffset = Infinity
  for (const corner of corners) {
    const relative = { x: corner.x - seed.x, y: corner.y - seed.y }
    minAlong = Math.min(minAlong, dot(relative, direction))
    minOffset = Math.min(minOffset, dot(relative, normal))
  }

  const along = Math.floor(minAlong / panelLengthPoints) * panelLengthPoints
  const offset = Math.floor(minOffset / panelWidthPoints) * panelWidthPoints
  return {
    x: seed.x + direction.x * along + normal.x * offset,
    y: seed.y + direction.y * along + normal.y * offset,
  }
}

/**
 * The Qt QLineF for a SCOPE-DEFAULT direction: the vector measured on the page
 * it was drawn on, rebased at PDF page point (0,0).
 *
 * Port of the scope-default branch of redbeamDirectionLineForTargetPage. The
 * rebasing looks cosmetic — every other consumer only reads the vector — but
 * automaticPanelGridOrigin seeds off p1(), so this is precisely what pins the
 * panel grid to the sheet origin for every scope-default area. Both golden
 * fixtures depend on it: seed the grid anywhere else and C-MT-02 comes out 49
 * or 61 instead of 54.
 */
export function scopeDefaultGridLine(
  direction: NormalizedDirection,
  sourcePage: PageSize,
): Segment | null {
  const a = toPagePoints(direction[0], sourcePage)
  const b = toPagePoints(direction[1], sourcePage)
  const vector = { x: b.x - a.x, y: b.y - a.y }
  if (!(Math.hypot(vector.x, vector.y) > 0)) return null
  return { a: { x: 0, y: 0 }, b: vector }
}

// ---------------------------------------------------------------------------
// Clipping (the QPainterPath replacement)
// ---------------------------------------------------------------------------

/**
 * Sutherland-Hodgman clip of one ring against an axis-aligned rectangle, in the
 * grid's local frame.
 *
 * Correct for a CONCAVE subject as long as the WINDOW is convex, which a cell
 * always is. On a concave subject the output can double back along a window
 * edge; those bridges have zero width and so contribute zero to the shoelace
 * sum. The area is therefore exact to floating point, not an estimate.
 */
function clipRingToRect(
  ring: readonly LocalPoint[],
  minAlong: number,
  maxAlong: number,
  minOffset: number,
  maxOffset: number,
): LocalPoint[] {
  // edge index -> inside test and the crossing point on that edge
  const inside = [
    (p: LocalPoint) => p.along >= minAlong,
    (p: LocalPoint) => p.along <= maxAlong,
    (p: LocalPoint) => p.offset >= minOffset,
    (p: LocalPoint) => p.offset <= maxOffset,
  ]
  const cross = [
    (s: LocalPoint, e: LocalPoint): LocalPoint =>
      ({ along: minAlong, offset: s.offset + ((e.offset - s.offset) * (minAlong - s.along)) / (e.along - s.along) }),
    (s: LocalPoint, e: LocalPoint): LocalPoint =>
      ({ along: maxAlong, offset: s.offset + ((e.offset - s.offset) * (maxAlong - s.along)) / (e.along - s.along) }),
    (s: LocalPoint, e: LocalPoint): LocalPoint =>
      ({ offset: minOffset, along: s.along + ((e.along - s.along) * (minOffset - s.offset)) / (e.offset - s.offset) }),
    (s: LocalPoint, e: LocalPoint): LocalPoint =>
      ({ offset: maxOffset, along: s.along + ((e.along - s.along) * (maxOffset - s.offset)) / (e.offset - s.offset) }),
  ]

  let output: LocalPoint[] = [...ring]
  for (let edge = 0; edge < 4; edge++) {
    const input = output
    if (input.length === 0) return []
    output = []
    const isInside = inside[edge]!
    const crossing = cross[edge]!
    for (let i = 0; i < input.length; i++) {
      const current = input[i]!
      const previous = input[(i + input.length - 1) % input.length]!
      const currentIn = isInside(current)
      const previousIn = isInside(previous)
      if (currentIn) {
        if (!previousIn) output.push(crossing(previous, current))
        output.push(current)
      } else if (previousIn) {
        output.push(crossing(previous, current))
      }
    }
  }
  return output
}

const localRingArea = (ring: readonly LocalPoint[]): number => {
  if (ring.length < 3) return 0
  let twice = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    twice += a.along * b.offset - b.along * a.offset
  }
  return Math.abs(twice * 0.5)
}

/**
 * +1 for material rings, -1 for openings, by nesting depth.
 *
 * Same rule as regionArea(), but computed ONCE on the unclipped region and then
 * reused for every cell. Re-deriving nesting from clipped rings would be
 * unstable exactly where it matters: a clipped ring's probe vertex frequently
 * lands ON a cell edge, where point-in-polygon is a coin flip, and a hole that
 * flips sign turns into 2x its own area of phantom material.
 */
function ringSigns(region: Region): number[] {
  const signs: number[] = []
  for (let index = 0; index < region.length; index++) {
    const ring = region[index]!
    if (ring.length < 3) { signs.push(0); continue }
    // Probe with a VERTEX, not an interior point — see regionArea().
    const probe = ring[0]!
    let depth = 0
    for (let other = 0; other < region.length; other++) {
      const otherRing = region[other]!
      if (other !== index && otherRing.length >= 3 && pointInPolygon(probe, otherRing)) depth++
    }
    signs.push(depth % 2 === 0 ? 1 : -1)
  }
  return signs
}

// ---------------------------------------------------------------------------
// Stock selection (06.1 applied to a cell)
// ---------------------------------------------------------------------------

function localBoundsOf(rings: readonly LocalPoint[][]): PanelLocalBounds {
  const bounds: PanelLocalBounds = {
    minAlong: Infinity, maxAlong: -Infinity,
    minOffset: Infinity, maxOffset: -Infinity,
    valid: false,
  }
  for (const ring of rings) {
    for (const p of ring) {
      bounds.minAlong = Math.min(bounds.minAlong, p.along)
      bounds.maxAlong = Math.max(bounds.maxAlong, p.along)
      bounds.minOffset = Math.min(bounds.minOffset, p.offset)
      bounds.maxOffset = Math.max(bounds.maxOffset, p.offset)
      bounds.valid = true
    }
  }
  return bounds
}

const clamp = (lo: number, value: number, hi: number): number =>
  Math.min(Math.max(value, lo), hi)

/**
 * Where a half-stock piece starts along its axis.
 *
 * Port of redbeamPanelClampedStockStart. Prefers a CENTRED piece, then pulls it
 * back so it still covers the installed geometry and still sits inside the
 * cell. When those two cannot both hold — the installed span is wider than half
 * stock, which the caller has already ruled out for a fitting candidate but not
 * for the losing one it still has to score — containment is abandoned and only
 * the cell bound is honoured.
 */
export function clampedStockStart(
  requiredMin: number,
  requiredMax: number,
  cellStart: number,
  cellEnd: number,
  stockSize: number,
): number {
  const latestStartInsideCell = cellEnd - stockSize
  if (!(stockSize > 0) || latestStartInsideCell < cellStart) return cellStart

  const allowedStartMin = Math.max(cellStart, requiredMax - stockSize)
  const allowedStartMax = Math.min(latestStartInsideCell, requiredMin)
  const centeredStart = (requiredMin + requiredMax - stockSize) * 0.5
  if (allowedStartMin <= allowedStartMax) {
    return clamp(allowedStartMin, centeredStart, allowedStartMax)
  }
  return clamp(cellStart, centeredStart, latestStartInsideCell)
}

const fixed = (value: number, digits: number): string =>
  Number.isFinite(value) ? value.toFixed(digits) : String(value)

interface CandidateHalf {
  path: Point[]
  kind: PanelStockKind
  reason: string
  start: number
  startFraction: number
  stockAxisFraction: number
  crossAxisFraction: number
  halfAxisUtilization: number
  overageArea: number
  uncoveredArea: number
  uncoveredFraction: number
  overageFraction: number
  score: number
  fit: boolean
}

interface StockSelectionInput {
  frame: GridFrame
  /** Region ∩ cell, in local coordinates, paired with each ring's sign. */
  clippedRings: readonly LocalPoint[][]
  clippedSigns: readonly number[]
  clippedArea: number
  fullPanelArea: number
  startAlong: number
  endAlong: number
  startOffset: number
  endOffset: number
  granularity: string
}

/**
 * Full vs half stock for one cell.
 *
 * Port of redbeamPanelStockSelectionForCell. The rule is a STRICT BINARY span
 * test, carried over verbatim from the C++ comment:
 *
 *   FULL        = [0,L]     x [0,W]
 *   HALF_LENGTH = [s,s+L/2] x [0,W]
 *   HALF_WIDTH  = [0,L]     x [t,t+W/2]
 *
 * A cell is HALF only when the installed geometry's local bounding SPAN fits
 * one half rectangle within a microscopic tolerance. Not its area, its span —
 * an L-shaped sliver hugging two opposite edges of a cell spans the full panel
 * and orders a full panel, however little material it actually is. That is the
 * fabricator's constraint, not a rounding choice, and softening it here would
 * under-order.
 *
 * The overage/uncovered scores are computed for BOTH candidates even when
 * neither fits, because the Qt build surfaces them in its per-cell diagnostics.
 * They never affect the count: whichever half wins, the fraction is 0.5.
 */
export function panelStockSelectionForCell(input: StockSelectionInput): PanelStockSelection {
  const { frame, clippedRings, clippedSigns, clippedArea, fullPanelArea } = input
  const { startAlong, endAlong, startOffset, endOffset } = input
  const { origin, direction, normal } = frame

  const fullPath = panelCellPath(origin, direction, normal, startAlong, endAlong, startOffset, endOffset)
  const base: PanelStockSelection = {
    path: fullPath,
    fraction: 1.0,
    kind: 'full',
    requiredLengthFraction: 0,
    requiredWidthFraction: 0,
    halfLengthFit: false,
    halfWidthFit: false,
    halfLengthUncoveredFraction: 1,
    halfWidthUncoveredFraction: 1,
    halfLengthOverageFraction: 1,
    halfWidthOverageFraction: 1,
    halfLengthScore: Number.MAX_VALUE,
    halfWidthScore: Number.MAX_VALUE,
    selectionReason: 'full-default',
    halfLengthReason: '',
    halfWidthReason: '',
  }

  const bail = (reason: string, rejectReason: string): PanelStockSelection => ({
    ...base, selectionReason: reason, halfLengthReason: rejectReason, halfWidthReason: rejectReason,
  })

  if (!(clippedArea > 0) || !(fullPanelArea > 0)) {
    return bail('full-invalid-area', 'reject-invalid-area')
  }

  const panelLength = endAlong - startAlong
  const panelWidth = endOffset - startOffset
  if (!(panelLength > 0) || !(panelWidth > 0)) {
    return bail('full-invalid-panel-size', 'reject-invalid-panel-size')
  }

  const clippedBounds = localBoundsOf(clippedRings)
  if (clippedBounds.valid) {
    base.requiredLengthFraction = clamp(0, (clippedBounds.maxAlong - clippedBounds.minAlong) / panelLength, 2)
    base.requiredWidthFraction = clamp(0, (clippedBounds.maxOffset - clippedBounds.minOffset) / panelWidth, 2)
  }

  // The required fractions are filled in BEFORE this gate, so a full-granularity
  // scope still reports how much of the cell the installed geometry needs. The
  // Review UI reads those even when no half was ever on the table.
  if (panelGranularityIndex(input.granularity) === 0) {
    return { ...base, selectionReason: 'full-panel-granularity-full',
      halfLengthReason: 'reject-panel-granularity-full', halfWidthReason: 'reject-panel-granularity-full' }
  }
  if (!clippedBounds.valid) {
    return { ...base, selectionReason: 'full-invalid-bounds',
      halfLengthReason: 'reject-invalid-bounds', halfWidthReason: 'reject-invalid-bounds' }
  }

  const halfLength = panelLength * 0.5
  const halfWidth = panelWidth * 0.5
  const requiredAlongSpan = clippedBounds.maxAlong - clippedBounds.minAlong
  const requiredOffsetSpan = clippedBounds.maxOffset - clippedBounds.minOffset
  const eps = Math.max(1.0e-6, Math.min(panelLength, panelWidth) * 1.0e-6)
  const epsLengthFraction = eps / panelLength
  const epsWidthFraction = eps / panelWidth
  const halfLengthValid = requiredAlongSpan <= halfLength + eps && requiredOffsetSpan <= panelWidth + eps
  const halfWidthValid = requiredAlongSpan <= panelLength + eps && requiredOffsetSpan <= halfWidth + eps

  /** Area of (region ∩ cell) ∩ stockRect — the only boolean result anyone reads. */
  const coveredBy = (a0: number, a1: number, o0: number, o1: number): number => {
    let area = 0
    for (let i = 0; i < clippedRings.length; i++) {
      const clippedRing = clipRingToRect(clippedRings[i]!, a0, a1, o0, o1)
      area += (clippedSigns[i] ?? 1) * localRingArea(clippedRing)
    }
    return Math.max(0, area)
  }

  const buildCandidate = (kind: PanelStockKind, fit: boolean): CandidateHalf => {
    let start: number
    let startFraction: number
    let stockAxisFraction: number
    let crossAxisFraction: number
    let halfAxisUtilization: number
    let path: Point[]
    let covered: number
    let stockArea: number
    if (kind === 'half-length') {
      start = clampedStockStart(clippedBounds.minAlong, clippedBounds.maxAlong, startAlong, endAlong, halfLength)
      startFraction = (start - startAlong) / panelLength
      stockAxisFraction = base.requiredLengthFraction
      crossAxisFraction = base.requiredWidthFraction
      halfAxisUtilization = clamp(0, requiredAlongSpan / halfLength, 2)
      path = panelCellPath(origin, direction, normal, start, start + halfLength, startOffset, endOffset)
      covered = coveredBy(start, start + halfLength, startOffset, endOffset)
      stockArea = halfLength * panelWidth
    } else {
      start = clampedStockStart(clippedBounds.minOffset, clippedBounds.maxOffset, startOffset, endOffset, halfWidth)
      startFraction = (start - startOffset) / panelWidth
      stockAxisFraction = base.requiredWidthFraction
      crossAxisFraction = base.requiredLengthFraction
      halfAxisUtilization = clamp(0, requiredOffsetSpan / halfWidth, 2)
      path = panelCellPath(origin, direction, normal, startAlong, endAlong, start, start + halfWidth)
      covered = coveredBy(startAlong, endAlong, start, start + halfWidth)
      stockArea = panelLength * halfWidth
    }
    // area(stock - installed) and area(installed - stock). See the header: with
    // a convex stock rectangle both reduce to a clip, so no subtraction op.
    const overageArea = Math.max(0, stockArea - covered)
    const uncoveredArea = Math.max(0, clippedArea - covered)
    const uncoveredFraction = uncoveredArea / fullPanelArea
    const overageFraction = overageArea / fullPanelArea
    const candidate: CandidateHalf = {
      path, kind, reason: '', start, startFraction, stockAxisFraction, crossAxisFraction,
      halfAxisUtilization, overageArea, uncoveredArea, uncoveredFraction, overageFraction,
      // Uncovered material is weighted 100x overage: leaving ceiling bare is a
      // defect, wasting half a panel is only money.
      score: overageFraction * 10.0 + uncoveredFraction * 1000.0 - halfAxisUtilization,
      fit,
    }
    const isHalfLength = kind === 'half-length'
    const stockAxisLimit = isHalfLength ? 0.5 + epsLengthFraction : 0.5 + epsWidthFraction
    const crossAxisLimit = 1.0 + (isHalfLength ? epsWidthFraction : epsLengthFraction)
    const prefix = `${isHalfLength ? 'half-length' : 'half-width'}-${fit ? 'valid' : 'invalid'}-span-fit`
    candidate.reason =
      `${prefix} reqL=${fixed(base.requiredLengthFraction, 6)} reqW=${fixed(base.requiredWidthFraction, 6)} ` +
      `stockAxis=${fixed(stockAxisFraction, 6)} stockAxisLimit=${fixed(stockAxisLimit, 6)} ` +
      `crossAxis=${fixed(crossAxisFraction, 6)} crossAxisLimit=${fixed(crossAxisLimit, 6)} ` +
      `eps=${eps} start=${fixed(startFraction, 6)} ` +
      `overage=${fixed(overageFraction, 6)} uncovered=${fixed(uncoveredFraction, 6)}`
    return candidate
  }

  const halfLengthCandidate = buildCandidate('half-length', halfLengthValid)
  const halfWidthCandidate = buildCandidate('half-width', halfWidthValid)

  const selection: PanelStockSelection = {
    ...base,
    halfLengthFit: halfLengthCandidate.fit,
    halfWidthFit: halfWidthCandidate.fit,
    halfLengthUncoveredFraction: halfLengthCandidate.uncoveredFraction,
    halfWidthUncoveredFraction: halfWidthCandidate.uncoveredFraction,
    halfLengthOverageFraction: halfLengthCandidate.overageFraction,
    halfWidthOverageFraction: halfWidthCandidate.overageFraction,
    halfLengthScore: halfLengthCandidate.score,
    halfWidthScore: halfWidthCandidate.score,
    halfLengthReason: halfLengthCandidate.reason,
    halfWidthReason: halfWidthCandidate.reason,
  }

  let best: CandidateHalf | null = null
  if (halfLengthCandidate.fit && halfWidthCandidate.fit) {
    const overageTie = Math.max(1.0e-9, fullPanelArea * 1.0e-9)
    if (halfLengthCandidate.overageArea < halfWidthCandidate.overageArea - overageTie) {
      best = halfLengthCandidate
      selection.selectionReason = 'half-length-lower-overage-strict-span-fit'
    } else if (halfWidthCandidate.overageArea < halfLengthCandidate.overageArea - overageTie) {
      best = halfWidthCandidate
      selection.selectionReason = 'half-width-lower-overage-strict-span-fit'
    } else if (halfLengthCandidate.halfAxisUtilization > halfWidthCandidate.halfAxisUtilization + eps) {
      best = halfLengthCandidate
      selection.selectionReason = 'half-length-higher-half-axis-utilization'
    } else if (halfWidthCandidate.halfAxisUtilization > halfLengthCandidate.halfAxisUtilization + eps) {
      best = halfWidthCandidate
      selection.selectionReason = 'half-width-higher-half-axis-utilization'
    } else {
      // Deterministic tie-break. An unstable one would flip a panel's
      // orientation between two identical calculations and look like a bug.
      best = halfLengthCandidate
      selection.selectionReason = 'half-length-stable-strict-tie'
    }
  } else if (halfLengthCandidate.fit) {
    best = halfLengthCandidate
    selection.selectionReason = 'half-length-only-strict-span-fit'
  } else if (halfWidthCandidate.fit) {
    best = halfWidthCandidate
    selection.selectionReason = 'half-width-only-strict-span-fit'
  }

  if (best) {
    selection.path = best.path
    selection.fraction = 0.5
    selection.kind = best.kind
    return selection
  }

  selection.selectionReason =
    `full-required-span-exceeds-half reqL=${fixed(base.requiredLengthFraction, 6)} ` +
    `reqW=${fixed(base.requiredWidthFraction, 6)} epsL=${epsLengthFraction} epsW=${epsWidthFraction}`
  return selection
}

// ---------------------------------------------------------------------------
// The grid builder
// ---------------------------------------------------------------------------

/**
 * Every grid cell the region actually reaches, with its stock selection.
 *
 * Port of redbeamBuildPanelCells. `region` is ONE direction group's rings in
 * PDF points — see directionGroupKey(): under a scope-default or page-default
 * direction every area markup is its OWN group, so a caller that merges them
 * loses cells wherever two markups share a cell. That is not a rounding
 * difference; on the C-MT-02 fixture it is 54 panels vs 49.
 *
 * The inclusion test is `clippedArea > max(1.0, fullPanelArea * 0.0025)` —
 * a quarter of one percent of a panel. It is deliberately near-zero: a cell the
 * ceiling barely touches still needs a panel cut for it. Raising it under-orders.
 */
export function buildPanelCells(
  region: Region,
  origin: Point,
  directionLine: Segment,
  panelWidthPoints: number,
  panelLengthPoints: number,
  panelGranularity: string,
): PanelCell[] {
  const cells: PanelCell[] = []
  const bounds = regionBounds(region)
  const axes = frameAxes(directionLine)
  if (!bounds || !axes || !(panelWidthPoints > 0) || !(panelLengthPoints > 0)) return cells
  if (bounds.min.x === bounds.max.x && bounds.min.y === bounds.max.y) return cells

  const frame: GridFrame = {
    origin,
    direction: axes.direction,
    normal: axes.normal,
    panelLength: panelLengthPoints,
    panelWidth: panelWidthPoints,
  }

  const corners: Point[] = [
    { x: bounds.min.x, y: bounds.min.y },
    { x: bounds.max.x, y: bounds.min.y },
    { x: bounds.min.x, y: bounds.max.y },
    { x: bounds.max.x, y: bounds.max.y },
  ]
  let minAlong = Infinity, maxAlong = -Infinity, minOffset = Infinity, maxOffset = -Infinity
  for (const corner of corners) {
    const local = toLocal(corner, frame)
    minAlong = Math.min(minAlong, local.along)
    maxAlong = Math.max(maxAlong, local.along)
    minOffset = Math.min(minOffset, local.offset)
    maxOffset = Math.max(maxOffset, local.offset)
  }

  // The ±1 padding is inherited from the C++. It cannot add a cell — the area
  // test rejects anything the region does not reach — but it does guard the
  // case where a boundary vertex lands exactly on a grid line and floor()/ceil()
  // disagree with where the material is.
  const columnStart = Math.floor(minAlong / panelLengthPoints) - 1
  const columnEnd = Math.ceil(maxAlong / panelLengthPoints) + 1
  const rowStart = Math.floor(minOffset / panelWidthPoints) - 1
  const rowEnd = Math.ceil(maxOffset / panelWidthPoints) + 1

  const fullPanelArea = panelWidthPoints * panelLengthPoints
  const minUsefulArea = Math.max(1.0, fullPanelArea * 0.0025)

  const signs = ringSigns(region)
  const localRegion = region.map((ring) => ring.map((p) => toLocal(p, frame)))

  for (let row = rowStart; row < rowEnd; row++) {
    const startOffset = row * panelWidthPoints
    const endOffset = (row + 1) * panelWidthPoints
    for (let column = columnStart; column < columnEnd; column++) {
      const startAlong = column * panelLengthPoints
      const endAlong = (column + 1) * panelLengthPoints

      const clippedRings: LocalPoint[][] = []
      const clippedSigns: number[] = []
      let clippedArea = 0
      for (let i = 0; i < localRegion.length; i++) {
        if (signs[i] === 0) continue
        const clipped = clipRingToRect(localRegion[i]!, startAlong, endAlong, startOffset, endOffset)
        if (clipped.length < 3) continue
        clippedRings.push(clipped)
        clippedSigns.push(signs[i]!)
        clippedArea += signs[i]! * localRingArea(clipped)
      }
      clippedArea = Math.max(0, clippedArea)
      if (clippedArea <= minUsefulArea) continue

      const selection = panelStockSelectionForCell({
        frame, clippedRings, clippedSigns, clippedArea, fullPanelArea,
        startAlong, endAlong, startOffset, endOffset, granularity: panelGranularity,
      })

      cells.push({
        gridRow: row,
        gridColumn: column,
        fullPath: panelCellPath(frame.origin, frame.direction, frame.normal, startAlong, endAlong, startOffset, endOffset),
        clippedRegion: clippedRings.map((ring) => ring.map((p) => toPage(p, frame))),
        clippedArea,
        stockPath: selection.path,
        coverageFraction: clamp(0, clippedArea / fullPanelArea, 1),
        stockFraction: selection.fraction,
        stockKind: selection.kind,
        requiredLengthFraction: selection.requiredLengthFraction,
        requiredWidthFraction: selection.requiredWidthFraction,
        halfLengthFit: selection.halfLengthFit,
        halfWidthFit: selection.halfWidthFit,
        halfLengthUncoveredFraction: selection.halfLengthUncoveredFraction,
        halfWidthUncoveredFraction: selection.halfWidthUncoveredFraction,
        halfLengthOverageFraction: selection.halfLengthOverageFraction,
        halfWidthOverageFraction: selection.halfWidthOverageFraction,
        halfLengthScore: selection.halfLengthScore,
        halfWidthScore: selection.halfWidthScore,
        selectionReason: selection.selectionReason,
        halfLengthReason: selection.halfLengthReason,
        halfWidthReason: selection.halfWidthReason,
      })
    }
  }

  return cells
}

// ---------------------------------------------------------------------------
// Roll-up
// ---------------------------------------------------------------------------

export interface PanelPieceSummary {
  /** Panels to ORDER. This is the number that reaches a purchase order. */
  panelCount: number
  /** Placed cells covered essentially wall-to-wall. */
  fullPanelCount: number
  /** Placed cells that are cut: a half, or a full panel trimmed to fit. */
  partialPanelCount: number
  fullPieceCount: number
  halfPieceCount: number
  /** Cells placed, before any production nesting. */
  placedCellCount: number
}

/**
 * Port of the Panels branch of redbeamQuantitySummaryForLayout(s).
 *
 * A half is always partial. A FULL piece is partial too unless it covers >= 98.5%
 * of its cell — a full panel with a corner cut off is still a cut panel on the
 * shop floor, and the mix is what the fabricator prices.
 */
export function summarizePanelCells(cells: readonly PanelCell[]): PanelPieceSummary {
  const stockFractions: number[] = []
  let fullPieceCount = 0
  let halfPieceCount = 0
  let fullPanelCount = 0
  let partialPanelCount = 0

  for (const cell of cells) {
    const stockFraction = cell.stockFraction > 0 ? cell.stockFraction : 1
    stockFractions.push(stockFraction)
    const isHalf =
      cell.stockKind === 'half-length' || cell.stockKind === 'half-width' ||
      fractionApproximately(stockFraction, 0.5)
    if (isHalf) {
      halfPieceCount++
      partialPanelCount++
    } else {
      fullPieceCount++
      if (cell.coverageFraction >= 0.985) fullPanelCount++
      else partialPanelCount++
    }
  }

  return {
    panelCount: orderStockPieceCount(stockFractions),
    fullPanelCount,
    partialPanelCount,
    fullPieceCount,
    halfPieceCount,
    placedCellCount: cells.length,
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** One direction group ready to lay out. See directionGroupKey() for grouping. */
export interface PanelLayoutGroup {
  /** The sheet this group's rings were traced on. Carried onto every cell. */
  pageId?: string
  /** The group's rings in PDF POINTS. Holes are nested rings, as in regionArea. */
  region: Region
  /**
   * The direction line in PDF points on the target page. For a scope-default
   * direction this MUST come from scopeDefaultGridLine() — its first point
   * seeds the grid, and a line seeded anywhere else moves every cell boundary.
   */
  directionLine: Segment
  /** A placed pattern origin in PDF points, or null for the automatic origin. */
  origin?: Point | null
  /**
   * This group's own calibration (plan 06.11).
   *
   * Sheets in one set are not all drawn at one scale, and a scope spans sheets.
   * Falls back to `PanelLayoutOptions.feetPerPoint`, which is the single-page
   * case and what the golden fixtures exercise.
   */
  feetPerPoint?: number | undefined
}

export interface PanelLayoutOptions {
  panelWidthFeet: number
  panelLengthFeet: number
  feetPerPoint: number
  /** "half" or "full"; anything else reads as full. */
  panelGranularity: string
  /**
   * Lay each area out on its own grid rather than one shared with the sheet.
   * See `automaticPanelGridOrigin`. Defaults to the sheet-wide grid, which is
   * what the Qt build does and what the golden fixtures capture.
   */
  perAreaOrigin?: boolean
}

export interface PanelLayoutResult extends PanelPieceSummary {
  cells: PanelCell[]
}

/**
 * Lay out every group and roll the whole scope up to a panel count.
 *
 * Groups are laid out INDEPENDENTLY and their cells concatenated. Two groups
 * that share a cell therefore contribute two cells, which is correct: they are
 * separate zones with separate seams, and the Qt build's own zone-key comment
 * says cross-area alignment must stay an explicit future choice.
 */
/** Stamp every cell with the sheet its group was traced on. */
function tagPage(pageId: string | undefined, cells: PanelCell[]): PanelCell[] {
  if (pageId === undefined) return cells
  for (const cell of cells) cell.pageId = pageId
  return cells
}

export function layoutPanels(
  groups: readonly PanelLayoutGroup[],
  options: PanelLayoutOptions,
): PanelLayoutResult {
  if (!(options.panelWidthFeet > 0) || !(options.panelLengthFeet > 0)) {
    return { ...summarizePanelCells([]), cells: [] }
  }

  const cells: PanelCell[] = []
  for (const group of groups) {
    // Per group, because a scope spans sheets and sheets are not all at one
    // scale. A panel is a fixed physical size; what changes between pages is
    // how many POINTS that size occupies.
    const feetPerPoint = group.feetPerPoint ?? options.feetPerPoint
    if (!(feetPerPoint > 0)) continue
    const panelWidthPoints = options.panelWidthFeet / feetPerPoint
    const panelLengthPoints = options.panelLengthFeet / feetPerPoint

    const origin = group.origin ??
      automaticPanelGridOrigin(
        group.region, group.directionLine, panelWidthPoints, panelLengthPoints,
        options.perAreaOrigin ?? false,
      )
    cells.push(...tagPage(group.pageId, buildPanelCells(
      group.region, origin, group.directionLine,
      panelWidthPoints, panelLengthPoints, options.panelGranularity,
    )))
  }
  return { ...summarizePanelCells(cells), cells }
}

/**
 * Net area of a region in PDF points squared, holes removed.
 *
 * Same rule and same answer as geometry.ts::regionArea; it exists here only so
 * a caller can check a cell's clipped rings without re-deriving nesting, and it
 * uses the precomputed signs for exactly the reason ringSigns() documents.
 */
export function signedRegionArea(region: Region): number {
  const signs = ringSigns(region)
  let area = 0
  for (let i = 0; i < region.length; i++) {
    const ring = region[i]!
    if (ring.length < 3) continue
    area += (signs[i] ?? 1) * Math.abs(signedPolygonArea(ring))
  }
  return Math.max(0, area)
}
