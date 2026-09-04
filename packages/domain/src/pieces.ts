/**
 * The run layout and yield engine: region + origin + direction -> orderable pieces.
 *
 * This is what turns a drawn ceiling into a purchase order. Every number a
 * baffle or plank estimate ships — piece counts, stock consumed, connector
 * counts, where the seams fall — comes out of this module.
 *
 * Ported from okular-redbeam `part/redbeamscopepanel.cpp`:
 *   redbeamDot / redbeamCross / redbeamPointOnLayoutLine -> local vector helpers
 *   redbeamPathBounds                                    -> regionBounds
 *   redbeamAppendUniqueBreak                             -> appendClampedBreak
 *   redbeamGenerateLayoutSegments                        -> generateLayoutSegments
 *   redbeamAllowedPieceFractions                         -> allowedPieceFractions
 *   redbeamRoundStockFractionToAllowed                   -> roundStockFractionToAllowed
 *   redbeamPieceFamilyForFraction                        -> pieceFamilyForFraction
 *   redbeamConnectorPointsForSegment                     -> connectorPointsForSegment
 *   redbeamBuildBafflePieces                             -> buildPieces
 *   redbeamSelectAutomaticOrigin                         -> selectAutomaticOrigin
 *   the per-group body of redbeamComputeLayoutForScope   -> buildRunLayout
 *
 * UNITS
 * -----
 * Everything here is PDF POINTS on one page, exactly like the Qt layer. The
 * caller converts feet -> points with the page calibration
 * (`points = feet / cal.feetPerPoint`) before calling in, and converts back
 * afterwards. Nothing in this module knows about feet, and passing feet in
 * would silently produce a plausible-looking layout at the wrong scale.
 *
 * GEOMETRY MODEL
 * --------------
 * QPainterPath is replaced by `Region` (an array of rings, even/odd nesting)
 * from geometry.ts. The Qt code had to call toSubpathPolygons() and explicitly
 * avoid toFillPolygons(), because the fill decomposition inserts artificial
 * bridge edges across a cutout and the layout clipper then treated those bridges
 * as real boundaries — diagonal seams through a rectilinear ceiling. With
 * explicit rings that failure mode cannot occur: a ring IS a boundary.
 *
 * TERMINATION
 * -----------
 * The Qt build livelocks in this area (`_simplify` spinning forever on
 * rectilinear input, with a cancel that reports success while still burning a
 * core). Every loop below has a bound stated in a comment next to it, and the
 * two places where the C++ iteration count is driven by a ratio of user inputs
 * rather than by input size raise a RangeError instead of grinding. See
 * MAX_LAYOUT_LINES and MAX_CONNECTORS_PER_PIECE.
 */

import type { Point, Region } from './geometry.js'
import { normalizedBoundingRect, pointInRegion } from './pattern.js'
import type { Segment } from './pattern.js'

// ---------------------------------------------------------------------------
// Constants carried over from the C++
// ---------------------------------------------------------------------------

/**
 * A run shorter than this is not a piece of anything. `minUsefulPiecePdfPoints`
 * in redbeamBuildBafflePieces. Half a PDF point is ~1/140 inch on a quarter
 * scale sheet: it is clipper noise, not material.
 */
export const MIN_USEFUL_PIECE_POINTS = 0.5

/** `intersectionEpsilon` — degenerate edge / parallel test in the clipper. */
const INTERSECTION_EPSILON = 1e-7

/** `breakMergeTolerance` — two cut candidates this close are one cut. */
const BREAK_MERGE_TOLERANCE = 0.01

/** How close a piece end must be to a run end to count as a capped end. */
const CAP_TOLERANCE_POINTS = 0.25

/**
 * Ceiling on layout lines generated for one region.
 *
 * The C++ loop runs `floor(minOffset/spacing) - 1 .. ceil(maxOffset/spacing) + 1`
 * with no cap, so its cost is (region span / spacing) and a spacing typo — feet
 * typed into an inches field, or a calibration off by a factor of a hundred —
 * turns a preview into a hang. 20000 lines is already two orders of magnitude
 * past any real ceiling (a 3456pt sheet at 6" o.c. on a 1/4" scale drawing is
 * about 280 lines).
 *
 * This raises rather than truncating on purpose: a truncated layout silently
 * UNDER-orders material, which is the one failure mode that costs money
 * quietly. Callers already have a "cannot lay out this scope" path.
 */
export const MAX_LAYOUT_LINES = 20000

/**
 * Ceiling on connectors placed along one piece. Same reasoning: the C++ count
 * is `ceil(pieceLength / maxConnectorSpacing)` and maxConnectorSpacing is a
 * user-entered measure, so a bad unit makes it unbounded in practice.
 */
export const MAX_CONNECTORS_PER_PIECE = 512

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const along = (from: Point, unit: Point, distance: number): Point => ({
  x: from.x + unit.x * distance,
  y: from.y + unit.y * distance,
})

/** Unit vector, or null when the input has no length. The `setLength(1.0)` guard. */
function unitVector(v: Point): Point | null {
  const length = Math.hypot(v.x, v.y)
  if (!(length > 0) || !Number.isFinite(length)) return null
  return { x: v.x / length, y: v.y / length }
}

/** Left normal, matching `QPointF normal(-direction.y(), direction.x())`. */
export function leftNormal(direction: Point): Point {
  return { x: -direction.y, y: direction.x }
}

/** Length of a segment in whatever units its points carry. */
export function segmentLength(seg: Segment): number {
  return Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y)
}

interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * Port of redbeamPathBounds plus the `isValid() && !isEmpty()` test every call
 * site pairs with it.
 *
 * QRectF::isValid() is `width > 0 && height > 0`, so a region collapsed to a
 * line or a point is rejected outright — it has no interior to lay anything
 * into, and its corner projections would give a zero-width offset band.
 *
 * normalizedBoundingRect is plain min/max over ring vertices despite its name;
 * it is reused here on PDF-point rings rather than duplicated.
 */
function regionBounds(region: Region): Bounds | null {
  const rect = normalizedBoundingRect(region)
  if (!rect) return null
  const width = rect.right - rect.left
  const height = rect.bottom - rect.top
  if (!(width > 0) || !(height > 0)) return null
  return { ...rect, width, height }
}

// ---------------------------------------------------------------------------
// Layout segments
// ---------------------------------------------------------------------------

/**
 * Clamp a candidate cut into the run's along-range, dropping anything outside.
 *
 * Port of redbeamAppendUniqueBreak. The C++ name is a misnomer — it does not
 * deduplicate; uniqueness is imposed after sorting, by BREAK_MERGE_TOLERANCE.
 * The 0.05 slack accepts an intersection that floats a hair past the extended
 * range and then pins it to the range.
 */
function appendClampedBreak(breaks: number[], value: number, minAlong: number, maxAlong: number): void {
  if (!Number.isFinite(value) || value < minAlong - 0.05 || value > maxAlong + 0.05) return
  breaks.push(Math.min(maxAlong, Math.max(minAlong, value)))
}

/**
 * Lay parallel lines across a region at `spacingPoints` and clip them to it.
 *
 * `direction` is a vector along the run; it is normalized here, so
 * `resolvePatternDirection(...).unit` plugs straight in and so does a raw
 * `{x: b.x - a.x, y: b.y - a.y}` delta. `origin` is the pattern origin: it sets
 * BOTH the phase of the line grid (via the normal) and the zero for seam
 * alignment downstream (via the direction), which is why the same point must be
 * handed to buildPieces.
 *
 * Returns one Segment per clipped run, in line order then along-order.
 *
 * @throws RangeError when the spacing is so small relative to the region that
 *         the line count exceeds MAX_LAYOUT_LINES. See that constant.
 */
export function generateLayoutSegments(
  region: Region,
  origin: Point,
  direction: Point,
  spacingPoints: number,
): Segment[] {
  const segments: Segment[] = []
  if (region.length === 0 || !(spacingPoints > 0)) return segments

  const dir = unitVector(direction)
  if (!dir) return segments
  const normal = leftNormal(dir)

  const bounds = regionBounds(region)
  if (!bounds) return segments

  const corners: Point[] = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.left, y: bounds.bottom },
    { x: bounds.right, y: bounds.bottom },
  ]
  let minOffset = Infinity
  let maxOffset = -Infinity
  let minAlong = Infinity
  let maxAlong = -Infinity
  for (const corner of corners) {
    const relative = sub(corner, origin)
    minOffset = Math.min(minOffset, dot(relative, normal))
    maxOffset = Math.max(maxOffset, dot(relative, normal))
    minAlong = Math.min(minAlong, dot(relative, dir))
    maxAlong = Math.max(maxAlong, dot(relative, dir))
  }

  // Overshoot the bounding box along the run so a line entering the region at a
  // shallow angle still starts outside it. Without the margin the first "break"
  // would be the box edge rather than the region edge.
  const margin = Math.max(bounds.width, bounds.height) + spacingPoints * 2
  minAlong -= margin
  maxAlong += margin

  const startIndex = Math.floor(minOffset / spacingPoints) - 1
  const endIndex = Math.ceil(maxOffset / spacingPoints) + 1
  const lineCount = endIndex - startIndex + 1
  if (!Number.isFinite(lineCount) || lineCount > MAX_LAYOUT_LINES) {
    throw new RangeError(
      `layout spacing of ${spacingPoints} pt over a ${Math.round(bounds.width)}x${Math.round(bounds.height)} pt region ` +
        `would need ${Number.isFinite(lineCount) ? lineCount : 'unbounded'} rows (limit ${MAX_LAYOUT_LINES}). ` +
        'Check the spacing units and the page calibration.',
    )
  }

  // BOUND: lineCount iterations, and lineCount was just proven finite and
  // <= MAX_LAYOUT_LINES. The index is integer and strictly increasing.
  for (let index = startIndex; index <= endIndex; index++) {
    const offset = index * spacingPoints
    const lineOrigin = along(origin, normal, offset)

    // Seed with the extended run extents so a line lying wholly inside the
    // region still yields one span.
    const breaks: number[] = [minAlong, maxAlong]

    // BOUND: sum over rings of ring.length. Purely input size, no ratios.
    for (const ring of region) {
      if (ring.length < 2) continue
      for (let pointIndex = 0; pointIndex < ring.length; pointIndex++) {
        const a = ring[pointIndex]!
        const b = ring[(pointIndex + 1) % ring.length]!
        const edge = sub(b, a)
        if (Math.hypot(edge.x, edge.y) <= INTERSECTION_EPSILON) continue

        const relative = sub(a, lineOrigin)
        const denominator = cross(dir, edge)
        if (Math.abs(denominator) <= INTERSECTION_EPSILON) {
          // Edge is parallel to the run. It only matters when it is COLLINEAR
          // with this line, in which case both its ends are cut candidates —
          // that is what makes a run stop at a wall it runs alongside.
          if (Math.abs(cross(relative, dir)) <= INTERSECTION_EPSILON) {
            appendClampedBreak(breaks, dot(sub(a, lineOrigin), dir), minAlong, maxAlong)
            appendClampedBreak(breaks, dot(sub(b, lineOrigin), dir), minAlong, maxAlong)
          }
          continue
        }
        const alongValue = cross(relative, edge) / denominator
        const edgeFraction = cross(relative, dir) / denominator
        if (edgeFraction >= -1e-6 && edgeFraction <= 1.0 + 1e-6) {
          appendClampedBreak(breaks, alongValue, minAlong, maxAlong)
        }
      }
    }

    breaks.sort((x, y) => x - y)
    const uniqueBreaks: number[] = []
    // BOUND: breaks.length, fixed before the loop starts.
    for (const value of breaks) {
      const last = uniqueBreaks[uniqueBreaks.length - 1]
      if (last === undefined || Math.abs(value - last) > BREAK_MERGE_TOLERANCE) uniqueBreaks.push(value)
    }

    // BOUND: uniqueBreaks.length - 1.
    for (let breakIndex = 1; breakIndex < uniqueBreaks.length; breakIndex++) {
      const startAlong = uniqueBreaks[breakIndex - 1]!
      const endAlong = uniqueBreaks[breakIndex]!
      if (endAlong <= startAlong + MIN_USEFUL_PIECE_POINTS) continue
      const midAlong = (startAlong + endAlong) * 0.5
      // The midpoint decides whether this span is material or a void. Spans
      // alternate in a convex region but NOT in a region with cutouts, so the
      // test is per-span rather than a parity flip.
      if (!pointInRegion(along(lineOrigin, dir, midAlong), region)) continue
      segments.push({
        a: along(lineOrigin, dir, startAlong),
        b: along(lineOrigin, dir, endAlong),
      })
    }
  }

  return segments
}

// ---------------------------------------------------------------------------
// Yield granularity
// ---------------------------------------------------------------------------

/**
 * Fractions of a stock length that may be ordered.
 *
 * NOTE: the Qt engine accepts FOUR values here — "half", "quarter", "third" and
 * anything else meaning "full" — while specs.ts `readGranularity` collapses
 * anything that is not "half" or "quarter" to "full". A project saved by the Qt
 * build with yieldGranularity="third" therefore reads back as "full" and orders
 * more material. That gap is in specs.ts, not here; this function keeps the
 * full vocabulary so it is a one-line fix there rather than a re-port.
 *
 * The lists are ASCENDING and that is load-bearing: both consumers below take
 * the FIRST fraction that fits, i.e. the smallest allowed piece that covers the
 * need.
 */
export function allowedPieceFractions(yieldGranularity: string): number[] {
  const normalized = yieldGranularity.trim().toLowerCase()
  if (normalized === 'half') return [0.5, 1.0]
  if (normalized === 'quarter') return [0.25, 0.5, 0.75, 1.0]
  if (normalized === 'third') return [1.0 / 3.0, 2.0 / 3.0, 1.0]
  return [1.0]
}

/**
 * Smallest allowed fraction that covers `fraction`, else a whole stock.
 *
 * Port of redbeamRoundStockFractionToAllowed, including the 0.0001 slack that
 * lets an exact-but-floating 0.5 match the 0.5 bucket instead of rounding up to
 * a full length, and including the 0.0 return for a non-positive or non-finite
 * input.
 */
export function roundStockFractionToAllowed(fraction: number, allowedFractions: readonly number[]): number {
  if (!(fraction > 0) || !Number.isFinite(fraction)) return 0
  // BOUND: allowedFractions.length, at most 4.
  for (const allowed of allowedFractions) {
    if (allowed + 0.0001 >= fraction) return allowed
  }
  return 1.0
}

/** How a piece is labelled and coloured. Not the same axis as yield granularity. */
export type PieceFamily = 'full' | 'half' | 'third' | 'quarter'

/**
 * Port of redbeamPieceFamilyForFraction.
 *
 * QUIRK, kept deliberately: the tests are ordered and overlapping, and
 * "quarter" is the FALL-THROUGH, not a 0.25 test. So 0.25 and 0.75 are both
 * "quarter" (|0.75 - 2/3| = 0.083, just outside the 0.08 third window), while
 * an odd fraction such as 0.26 lands inside the third window and is labelled
 * "third". Only the "third" granularity can produce fractions that exercise
 * that edge, so it is invisible today — but the labelling is what drives piece
 * colour and the cut-list grouping, so it is reproduced rather than tidied.
 */
export function pieceFamilyForFraction(fraction: number): PieceFamily {
  if (fraction >= 0.999) return 'full'
  if (Math.abs(fraction - 0.5) < 0.08) return 'half'
  if (Math.abs(fraction - 1.0 / 3.0) < 0.08 || Math.abs(fraction - 2.0 / 3.0) < 0.08) return 'third'
  return 'quarter'
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

/**
 * Support / connector locations along one piece.
 *
 * `maxConnectorSpacingPoints` is ONE parameter with two labels: "Backing Max"
 * on a Baffle Cassette and "Conn. Max" on a Baffle. Both read the
 * `maxConnectorSpacing` spec key. Do not fork it — see specs.ts requiredMeasures.
 *
 * The comment from the C++, which records the fix and must survive: connectors
 * are INTERIOR support locations, not clipped run endpoints. Endpoint-inclusive
 * spacing drew visually misleading dotted diagonals wherever a row was clipped
 * by a sloped polygon edge. Evenly spaced interior points instead — edge
 * distance is half the support spacing for that run, and the maximum
 * centre-to-centre spacing still comes out <= maxConnectorSpacingPoints.
 *
 * @throws RangeError when the spacing would need more than
 *         MAX_CONNECTORS_PER_PIECE supports on a single piece.
 */
export function connectorPointsForSegment(seg: Segment, maxConnectorSpacingPoints: number): Point[] {
  const points: Point[] = []
  const length = segmentLength(seg)
  if (!(length > 0) || !(maxConnectorSpacingPoints > 0)) return points

  const connectorCount = Math.max(1, Math.ceil(length / maxConnectorSpacingPoints))
  if (!Number.isFinite(connectorCount) || connectorCount > MAX_CONNECTORS_PER_PIECE) {
    throw new RangeError(
      `connector spacing of ${maxConnectorSpacingPoints} pt would need ${connectorCount} supports on a ` +
        `${Math.round(length)} pt piece (limit ${MAX_CONNECTORS_PER_PIECE}). Check the maxConnectorSpacing units.`,
    )
  }
  const dx = seg.b.x - seg.a.x
  const dy = seg.b.y - seg.a.y
  // BOUND: connectorCount, just proven <= MAX_CONNECTORS_PER_PIECE.
  for (let index = 0; index < connectorCount; index++) {
    const t = (index + 0.5) / connectorCount
    points.push({ x: seg.a.x + dx * t, y: seg.a.y + dy * t })
  }
  return points
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

export interface Piece {
  /** The part of the piece inside the region. This is what is covered. */
  insideSegment: Segment
  /**
   * The physical stock the piece occupies, including overage that hangs past
   * the region. Equals insideSegment when the cut is exact.
   */
  fullSegment: Segment
  family: PieceFamily
  /** Fraction of one stock length consumed. Sum these to get stock ordered. */
  stockFraction: number
  /** This piece starts at the start of its run (gets an end cap, not a joiner). */
  startCap: boolean
  /** This piece ends at the end of its run. */
  endCap: boolean
  /** Joiner locations. A piece contributes its START unless it is a run start. */
  jointPoints: Point[]
  connectorPoints: Point[]
}

export interface PieceBuildOptions {
  stockLengthPoints: number
  /** "full" | "half" | "quarter" (and "third", which the Qt engine still reads). */
  yieldGranularity: string
  /**
   * Whether cuts line up across parallel runs. A real spec key, stored as the
   * TEXT "true"/"false" — read it with specs.readBool, not Boolean(). Turning
   * it on moves every seam and changes the piece mix.
   */
  alignSeams: boolean
  /** Pattern origin, in PDF points. The zero for seam phase. */
  origin: Point
  /** `maxConnectorSpacing`: "Backing Max" on a cassette, "Conn. Max" on a baffle. */
  maxConnectorSpacingPoints: number
}

/**
 * Cut a set of runs into orderable pieces against a stock length.
 *
 * Port of redbeamBuildBafflePieces. Used unchanged by baffles, baffle
 * cassettes and planks — the product types differ in which specs feed it, not
 * in how a run is cut. Planks additionally get a perpendicular rail layout;
 * see buildRunLayout.
 *
 * @throws RangeError from connectorPointsForSegment on a pathological
 *         connector spacing.
 */
export function buildPieces(segments: readonly Segment[], options: PieceBuildOptions): Piece[] {
  const pieces: Piece[] = []
  const stock = options.stockLengthPoints
  if (!(stock > 0)) return pieces

  // TERMINATION GUARD, and an exact behavioural match rather than a change.
  //
  // The C++ `while (remaining > minUseful)` decrements by the piece it just
  // placed, but when the stock length is itself <= minUseful EVERY candidate
  // piece is too short: the loop takes its "advance and continue" branch every
  // time, appends nothing, and shrinks `remaining` by `stock` per pass. So the
  // C++ produces ZERO pieces here and spends O(runLength / stock) doing it —
  // the livelock class. Returning early is the same answer at O(1).
  //
  // With this guard, the loop below has a proven bound; see it.
  if (!(stock > MIN_USEFUL_PIECE_POINTS)) return pieces

  const allowedFractions = allowedPieceFractions(options.yieldGranularity)

  // BOUND: segments.length.
  for (const segment of segments) {
    const runLength = segmentLength(segment)
    if (runLength <= MIN_USEFUL_PIECE_POINTS) continue

    const direction = unitVector(sub(segment.b, segment.a))
    if (!direction) continue

    // Seam phase is measured from the ORIGIN along the run direction, so
    // parallel runs that start at different walls still cut on one grid.
    const startProjection = dot(sub(segment.a, options.origin), direction)
    let firstAlignedLength = stock
    if (options.alignSeams) {
      let phase = startProjection % stock
      if (phase < 0) phase += stock
      // Below 0.01 pt the run already starts on the grid; trimming it would
      // emit a zero-length lead piece.
      if (phase > 0.01) firstAlignedLength = stock - phase
    }

    let cursor: Point = segment.a
    let remaining = runLength
    let firstPiece = true

    // BOUND, and why it holds:
    //   - `stock > MIN_USEFUL_PIECE_POINTS` was proven above;
    //   - the "too short to place" branch requires
    //     `min(candidate, remaining) <= MIN_USEFUL`, and the loop condition
    //     guarantees `remaining > MIN_USEFUL`, so it can only fire when the
    //     CANDIDATE is short. The only short candidate is a seam-aligned lead
    //     (`firstAlignedLength < stock`), and the branch resets
    //     `firstAlignedLength = stock` on its way out — so it fires at most
    //     once, on the first pass;
    //   - every other pass emits a piece and subtracts its inside length,
    //     which is `min(candidate, remaining) > MIN_USEFUL`.
    // Therefore at most 1 + ceil(runLength / MIN_USEFUL) passes. The counter is
    // the bound made executable rather than a second, weaker safety net.
    const maxPasses = Math.ceil(runLength / MIN_USEFUL_PIECE_POINTS) + 2
    for (let pass = 0; pass < maxPasses && remaining > MIN_USEFUL_PIECE_POINTS; pass++) {
      const candidateLength = firstPiece ? firstAlignedLength : stock
      const pieceLength = Math.min(candidateLength, remaining)
      let chosenLength = candidateLength

      if (pieceLength <= MIN_USEFUL_PIECE_POINTS) {
        cursor = along(cursor, direction, pieceLength)
        remaining -= pieceLength
        firstPiece = false
        firstAlignedLength = stock
        continue
      }

      if (pieceLength < chosenLength - 0.01) {
        // The run ended mid-stock. Buy the smallest allowed fraction that
        // covers what is left.
        const neededFraction = pieceLength / stock
        chosenLength = stock
        for (const fraction of allowedFractions) {
          if (fraction + 0.0001 >= neededFraction) {
            chosenLength = stock * fraction
            break
          }
        }
      }

      const insideLength = Math.min(pieceLength, remaining)
      const rawPhysicalLength = Math.max(chosenLength, pieceLength)
      const stockFraction = roundStockFractionToAllowed(rawPhysicalLength / stock, allowedFractions)
      const physicalLength = Math.max(insideLength, stockFraction * stock)

      // A run that fits in one piece centres its overage: the stock hangs
      // equally past both ends rather than sticking out at one wall.
      const singlePieceRun = firstPiece && insideLength >= remaining - 0.01
      // A seam-aligned lead piece puts ALL its overage before the run start,
      // which is exactly how the following seam lands on the stock grid. This
      // is the whole visible effect of alignSeams.
      const firstSeamAlignedPartial =
        options.alignSeams && firstPiece && firstAlignedLength < stock - 0.01 && !singlePieceRun

      const overageLength = Math.max(0, physicalLength - insideLength)
      const leadingOverage = singlePieceRun
        ? overageLength * 0.5
        : firstSeamAlignedPartial
          ? overageLength
          : 0
      const trailingOverage = overageLength - leadingOverage

      const insideEnd = along(cursor, direction, insideLength)
      const insideSegment: Segment = { a: cursor, b: insideEnd }
      const piece: Piece = {
        insideSegment,
        fullSegment: {
          a: along(cursor, direction, -leadingOverage),
          b: along(insideEnd, direction, trailingOverage),
        },
        stockFraction,
        family: pieceFamilyForFraction(stockFraction),
        // Component-wise, not euclidean — carried over verbatim. At 0.25 pt the
        // difference between the two never decides a real case.
        startCap:
          Math.abs(cursor.x - segment.a.x) < CAP_TOLERANCE_POINTS &&
          Math.abs(cursor.y - segment.a.y) < CAP_TOLERANCE_POINTS,
        endCap:
          Math.abs(insideEnd.x - segment.b.x) < CAP_TOLERANCE_POINTS &&
          Math.abs(insideEnd.y - segment.b.y) < CAP_TOLERANCE_POINTS,
        jointPoints: [],
        connectorPoints: connectorPointsForSegment(insideSegment, options.maxConnectorSpacingPoints),
      }
      // A joiner sits where two pieces meet, so it belongs to the piece that
      // STARTS there — and the first piece of a run starts at a wall, not a
      // joint. That is why the run's far end never gets one either.
      if (!piece.startCap) piece.jointPoints.push(cursor)
      pieces.push(piece)

      cursor = insideEnd
      remaining -= segmentLength(insideSegment)
      firstPiece = false
      firstAlignedLength = stock
    }
  }

  return pieces
}

/** Total stock lengths consumed. The unit an order is placed in. */
export function stockUnitsUsed(pieces: readonly Piece[]): number {
  return pieces.reduce((total, piece) => total + piece.stockFraction, 0)
}

/** Total run length actually covered, in PDF points. */
export function coveredLengthPoints(pieces: readonly Piece[]): number {
  return pieces.reduce((total, piece) => total + segmentLength(piece.insideSegment), 0)
}

/** Piece counts by family, for a cut list. */
export function pieceCountsByFamily(pieces: readonly Piece[]): Record<PieceFamily, number> {
  const counts: Record<PieceFamily, number> = { full: 0, half: 0, third: 0, quarter: 0 }
  for (const piece of pieces) counts[piece.family]++
  return counts
}

// ---------------------------------------------------------------------------
// Automatic origin
// ---------------------------------------------------------------------------

export interface RunLayoutOptions {
  spacingPoints: number
  stockLengthPoints: number
  yieldGranularity: string
  alignSeams: boolean
  maxConnectorSpacingPoints: number
}

export interface AutomaticOrigin {
  origin: Point
  segments: Segment[]
  pieces: Piece[]
}

/** Number of grid phases tried in each axis. `spacingSamples` / `seamSamples`. */
export const ORIGIN_SAMPLES = 8

/**
 * Pick a pattern origin when the estimator has not drawn one.
 *
 * Port of redbeamSelectAutomaticOrigin. It sweeps the grid phase across one
 * spacing (and, when seams are aligned, across one stock length too) from the
 * region centre and keeps the best layout.
 *
 * The ranking is commercial, not geometric, and the order matters:
 *   1. materially more coverage wins (tolerance: two spacings, so a difference
 *      of one row is "material" and float noise is not);
 *   2. at commercially equal coverage, FEWER ORDERED PIECES wins — fewer cuts
 *      and fewer joiners beat a hair more yield;
 *   3. then less stock consumed;
 *   4. then more coverage, as a tie-break.
 *
 * Returns null when nothing produced a piece.
 */
export function selectAutomaticOrigin(
  region: Region,
  direction: Point,
  options: RunLayoutOptions,
): AutomaticOrigin | null {
  const bounds = regionBounds(region)
  const dir = unitVector(direction)
  if (!bounds || !dir || !(options.spacingPoints > 0)) return null

  const normal = leftNormal(dir)
  const baseOrigin: Point = {
    x: (bounds.left + bounds.right) * 0.5,
    y: (bounds.top + bounds.bottom) * 0.5,
  }
  const seamSamples = options.alignSeams && options.stockLengthPoints > 0 ? ORIGIN_SAMPLES : 1
  const coverageTolerance = Math.max(0.5, options.spacingPoints * 2)

  let best: AutomaticOrigin | null = null
  let bestCoverage = -1
  let bestOrderPieces = Infinity
  let bestStock = Infinity

  // BOUND: ORIGIN_SAMPLES * seamSamples, i.e. at most 64. Both are constants.
  for (let spacingIndex = 0; spacingIndex < ORIGIN_SAMPLES; spacingIndex++) {
    const normalPhase = (spacingIndex / ORIGIN_SAMPLES) * options.spacingPoints
    for (let seamIndex = 0; seamIndex < seamSamples; seamIndex++) {
      const alongPhase = seamSamples === 1 ? 0 : (seamIndex / seamSamples) * options.stockLengthPoints
      const origin = along(along(baseOrigin, normal, normalPhase), dir, alongPhase)
      const segments = generateLayoutSegments(region, origin, dir, options.spacingPoints)
      const pieces = buildPieces(segments, {
        stockLengthPoints: options.stockLengthPoints,
        yieldGranularity: options.yieldGranularity,
        alignSeams: options.alignSeams,
        origin,
        maxConnectorSpacingPoints: options.maxConnectorSpacingPoints,
      })
      if (pieces.length === 0) continue

      const coverage = coveredLengthPoints(pieces)
      const stock = stockUnitsUsed(pieces)
      const orderPieces = pieces.length

      const materiallyBetterCoverage = coverage > bestCoverage + coverageTolerance
      const commerciallySameCoverage = Math.abs(coverage - bestCoverage) <= coverageTolerance
      const fewerOrderPieces = orderPieces < bestOrderPieces
      const sameOrderPieces = orderPieces === bestOrderPieces
      const betterStockAtSamePieces = sameOrderPieces && stock < bestStock - 0.01
      const samePiecesAndStock = sameOrderPieces && Math.abs(stock - bestStock) <= 0.01
      const betterCoverageAtSamePiecesAndStock = samePiecesAndStock && coverage > bestCoverage + 0.5

      if (
        best === null ||
        materiallyBetterCoverage ||
        (commerciallySameCoverage &&
          (fewerOrderPieces || betterStockAtSamePieces || betterCoverageAtSamePiecesAndStock))
      ) {
        bestCoverage = coverage
        bestOrderPieces = orderPieces
        bestStock = stock
        best = { origin, segments, pieces }
      }
    }
  }

  return best
}

// ---------------------------------------------------------------------------
// Whole-region layout
// ---------------------------------------------------------------------------

export interface RegionLayoutOptions extends RunLayoutOptions {
  /**
   * Pattern origin from a drawn origin markup, in PDF points. When absent the
   * origin is chosen by selectAutomaticOrigin — which is a real branch, not a
   * fallback: a drawn origin is used verbatim even if it yields worse.
   */
  origin?: Point | null
  /**
   * Planks only. Rails run PERPENDICULAR to the planks. Both of these must be
   * positive or no rails are generated; the Qt call site gates on exactly that
   * pair (`railSpacingPdfPoints > 0 && railLengthPdfPoints > 0`).
   */
  railSpacingPoints?: number | undefined
  railLengthPoints?: number | undefined
}

export interface RegionLayout {
  /** The origin actually used, drawn or chosen. */
  origin: Point
  segments: Segment[]
  pieces: Piece[]
  /** Perpendicular rail runs. Empty for everything but planks with rail specs. */
  railSegments: Segment[]
  railPieces: Piece[]
}

/**
 * Lay out one install region: the body of the per-direction-group loop in
 * redbeamComputeLayoutForScope, minus the document/annotation plumbing.
 *
 * `region` is the install region — areas unioned, cutouts removed — already in
 * PDF points. Build it from effectiveAreaRings(markups, cal) mapped through
 * ringToPoints, grouped by directionGroupKey.
 *
 * Returns null when no layout is possible (degenerate region, no direction, or
 * no origin phase produced a single piece), which is the caller's "blocked"
 * state.
 */
export function buildRunLayout(
  region: Region,
  direction: Point,
  options: RegionLayoutOptions,
): RegionLayout | null {
  const dir = unitVector(direction)
  if (!dir) return null

  let origin: Point
  let segments: Segment[]
  let pieces: Piece[]

  const drawnOrigin = options.origin ?? null
  if (drawnOrigin) {
    origin = drawnOrigin
    segments = generateLayoutSegments(region, origin, dir, options.spacingPoints)
    pieces = buildPieces(segments, {
      stockLengthPoints: options.stockLengthPoints,
      yieldGranularity: options.yieldGranularity,
      alignSeams: options.alignSeams,
      origin,
      maxConnectorSpacingPoints: options.maxConnectorSpacingPoints,
    })
  } else {
    const automatic = selectAutomaticOrigin(region, dir, options)
    if (!automatic) return null
    ;({ origin, segments, pieces } = automatic)
  }

  const railSpacing = options.railSpacingPoints ?? 0
  const railLength = options.railLengthPoints ?? 0
  let railSegments: Segment[] = []
  let railPieces: Piece[] = []
  if (railSpacing > 0 && railLength > 0) {
    // Rails run across the planks, from the same origin. The Qt call site
    // hard-codes "full" granularity, no seam alignment and no connectors:
    // a rail is structure, it is not cut to a fractional yield and it does not
    // carry supports of its own.
    const railDirection = leftNormal(dir)
    railSegments = generateLayoutSegments(region, origin, railDirection, railSpacing)
    railPieces = buildPieces(railSegments, {
      stockLengthPoints: railLength,
      yieldGranularity: 'full',
      alignSeams: false,
      origin,
      maxConnectorSpacingPoints: 0,
    })
  }

  return { origin, segments, pieces, railSegments, railPieces }
}
