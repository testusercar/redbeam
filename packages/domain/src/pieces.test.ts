import { describe, it, expect } from 'vitest'
import {
  MAX_CONNECTORS_PER_PIECE,
  MAX_LAYOUT_LINES,
  allowedPieceFractions,
  buildPieces,
  buildRunLayout,
  connectorPointsForSegment,
  coveredLengthPoints,
  generateLayoutSegments,
  leftNormal,
  pieceCountsByFamily,
  pieceFamilyForFraction,
  roundStockFractionToAllowed,
  segmentLength,
  selectAutomaticOrigin,
  stockUnitsUsed,
  type PieceBuildOptions,
} from './pieces.js'
import type { Point, Region } from './geometry.js'
import type { Segment } from './pattern.js'

/*
 * NO GOLDEN FIXTURE EXISTS FOR BAFFLES OR PLANKS.
 *
 * Both fixtures in fixtures/ are `panels`, so nothing here has been compared
 * against the Qt build. Every expectation below is either (a) an arithmetic
 * identity of the ported algorithm, (b) an invariant that must hold for any
 * correct implementation, or (c) a degenerate-input guard. Where a number could
 * only come from the oracle it is NOT asserted, and the test says so in its
 * name. See the report for the list of behaviours still pending a fixture.
 */

const rect = (left: number, top: number, right: number, bottom: number): Point[] => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]

/** A 100x100 pt region. Small numbers keep the arithmetic checkable by hand. */
const SQUARE: Region = [rect(0, 0, 100, 100)]

const EAST: Point = { x: 1, y: 0 }

const seg = (ax: number, ay: number, bx: number, by: number): Segment => ({
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
})

const opts = (over: Partial<PieceBuildOptions> = {}): PieceBuildOptions => ({
  stockLengthPoints: 40,
  yieldGranularity: 'full',
  alignSeams: false,
  origin: { x: 0, y: 0 },
  maxConnectorSpacingPoints: 0,
  ...over,
})

/** Where the cuts land: the start of every piece after the first. */
const cutPositions = (pieces: readonly { insideSegment: Segment }[]): number[] =>
  pieces.slice(1).map((p) => p.insideSegment.a.x)

// ---------------------------------------------------------------------------
// allowedPieceFractions
// ---------------------------------------------------------------------------

describe('allowedPieceFractions', () => {
  it('returns ascending fractions per granularity', () => {
    expect(allowedPieceFractions('full')).toEqual([1.0])
    expect(allowedPieceFractions('half')).toEqual([0.5, 1.0])
    expect(allowedPieceFractions('quarter')).toEqual([0.25, 0.5, 0.75, 1.0])
  })

  it('still understands "third", which specs.readGranularity collapses to "full"', () => {
    // The Qt engine accepts four granularities; readGranularity in specs.ts
    // only round-trips three. A Qt project storing "third" reads back as "full"
    // and over-orders. Keeping the vocabulary here makes that a one-line fix
    // in specs.ts rather than a re-port.
    expect(allowedPieceFractions('third')).toEqual([1 / 3, 2 / 3, 1.0])
  })

  it('normalizes case and whitespace, and treats anything unknown as full', () => {
    expect(allowedPieceFractions('  QUARTER ')).toEqual([0.25, 0.5, 0.75, 1.0])
    expect(allowedPieceFractions('')).toEqual([1.0])
    expect(allowedPieceFractions('eighth')).toEqual([1.0])
  })
})

describe('roundStockFractionToAllowed', () => {
  const quarter = allowedPieceFractions('quarter')

  it('takes the smallest allowed fraction that covers the need', () => {
    expect(roundStockFractionToAllowed(0.1, quarter)).toBe(0.25)
    expect(roundStockFractionToAllowed(0.3, quarter)).toBe(0.5)
    expect(roundStockFractionToAllowed(0.6, quarter)).toBe(0.75)
    expect(roundStockFractionToAllowed(0.8, quarter)).toBe(1.0)
  })

  it('lets a floating-point exact fraction match its own bucket', () => {
    // Without the 0.0001 slack, 0.5 + 1ulp would buy a whole stock length.
    expect(roundStockFractionToAllowed(0.5 + 1e-5, quarter)).toBe(0.5)
  })

  it('buys a whole stock when nothing covers it', () => {
    expect(roundStockFractionToAllowed(2.0, quarter)).toBe(1.0)
    expect(roundStockFractionToAllowed(1.5, allowedPieceFractions('full'))).toBe(1.0)
  })

  it('returns zero for a non-positive or non-finite need', () => {
    expect(roundStockFractionToAllowed(0, quarter)).toBe(0)
    expect(roundStockFractionToAllowed(-1, quarter)).toBe(0)
    expect(roundStockFractionToAllowed(Number.NaN, quarter)).toBe(0)
  })
})

describe('pieceFamilyForFraction', () => {
  it('labels the fractions the granularities can actually produce', () => {
    expect(pieceFamilyForFraction(1.0)).toBe('full')
    expect(pieceFamilyForFraction(0.5)).toBe('half')
    expect(pieceFamilyForFraction(1 / 3)).toBe('third')
    expect(pieceFamilyForFraction(2 / 3)).toBe('third')
    // Quarter is the FALL-THROUGH, not a 0.25 test — so 0.75 is a "quarter"
    // piece because |0.75 - 2/3| = 0.083 misses the 0.08 third window.
    expect(pieceFamilyForFraction(0.25)).toBe('quarter')
    expect(pieceFamilyForFraction(0.75)).toBe('quarter')
  })

  it('keeps the overlapping-window quirk: 0.26 is labelled a third', () => {
    // |0.26 - 1/3| = 0.073 < 0.08. Unreachable from the shipped granularities,
    // but it drives piece colour and cut-list grouping, so it is ported as-is.
    expect(pieceFamilyForFraction(0.26)).toBe('third')
  })

  it('treats 0.999 as a full length', () => {
    expect(pieceFamilyForFraction(0.999)).toBe('full')
    expect(pieceFamilyForFraction(0.998)).toBe('quarter')
  })
})

// ---------------------------------------------------------------------------
// generateLayoutSegments
// ---------------------------------------------------------------------------

describe('generateLayoutSegments', () => {
  it('returns nothing for degenerate inputs', () => {
    expect(generateLayoutSegments([], { x: 0, y: 0 }, EAST, 25)).toEqual([])
    expect(generateLayoutSegments(SQUARE, { x: 0, y: 0 }, EAST, 0)).toEqual([])
    expect(generateLayoutSegments(SQUARE, { x: 0, y: 0 }, EAST, -25)).toEqual([])
    expect(generateLayoutSegments(SQUARE, { x: 0, y: 0 }, { x: 0, y: 0 }, 25)).toEqual([])
  })

  it('returns nothing for a region with no interior', () => {
    // A ring collapsed to a line: QRectF::isValid() is width > 0 && height > 0.
    const line: Region = [[{ x: 0, y: 0 }, { x: 100, y: 0 }]]
    expect(generateLayoutSegments(line, { x: 0, y: 0 }, EAST, 25)).toEqual([])
  })

  it('lays rows across a square and clips each to the region', () => {
    // Origin offset by half a spacing so no row lands on the boundary, where
    // even/odd containment of the midpoint is a coin flip.
    const segments = generateLayoutSegments(SQUARE, { x: 0, y: 12.5 }, EAST, 25)
    expect(segments).toHaveLength(4)
    for (const s of segments) {
      expect(segmentLength(s)).toBeCloseTo(100, 9)
      expect(s.a.x).toBeCloseTo(0, 9)
      expect(s.b.x).toBeCloseTo(100, 9)
    }
    expect(segments.map((s) => s.a.y).sort((a, b) => a - b)).toEqual([12.5, 37.5, 62.5, 87.5])
  })

  it('shifts every row when the origin moves along the normal', () => {
    const shifted = generateLayoutSegments(SQUARE, { x: 0, y: 5 }, EAST, 25)
    expect(shifted.map((s) => s.a.y).sort((a, b) => a - b)).toEqual([5, 30, 55, 80])
  })

  it('runs rows along the direction, not along the page axes', () => {
    const south: Point = { x: 0, y: 1 }
    const segments = generateLayoutSegments(SQUARE, { x: 12.5, y: 0 }, south, 25)
    expect(segments).toHaveLength(4)
    for (const s of segments) {
      expect(s.a.x).toBeCloseTo(s.b.x, 9)
      expect(segmentLength(s)).toBeCloseTo(100, 9)
    }
  })

  it('treats a direction as an axis: reversing it gives the same rows', () => {
    const forward = generateLayoutSegments(SQUARE, { x: 0, y: 12.5 }, EAST, 25)
    const reverse = generateLayoutSegments(SQUARE, { x: 0, y: 12.5 }, { x: -1, y: 0 }, 25)
    expect(reverse).toHaveLength(forward.length)
    const ys = (list: Segment[]) => list.map((s) => s.a.y).sort((a, b) => a - b)
    expect(ys(reverse)).toEqual(ys(forward))
  })

  it('splits a row into two runs where a cutout interrupts it', () => {
    const withHole: Region = [rect(0, 0, 100, 100), rect(40, 5, 60, 95)]
    const segments = generateLayoutSegments(withHole, { x: 0, y: 12.5 }, EAST, 25)
    // Every one of the four rows crosses the opening, so each yields two runs.
    expect(segments).toHaveLength(8)
    const row = segments.filter((s) => Math.abs(s.a.y - 12.5) < 1e-9)
    expect(row).toHaveLength(2)
    expect(row.map((s) => [s.a.x, s.b.x])).toEqual([
      [0, 40],
      [60, 100],
    ])
  })

  it('normalizes the direction, so its magnitude does not change the layout', () => {
    const unit = generateLayoutSegments(SQUARE, { x: 0, y: 12.5 }, EAST, 25)
    const long = generateLayoutSegments(SQUARE, { x: 0, y: 12.5 }, { x: 1000, y: 0 }, 25)
    expect(long).toEqual(unit)
  })

  it('raises rather than grinding when the spacing is absurd for the region', () => {
    // The Qt loop is (region span / spacing) with no cap, so a unit typo hangs
    // the app. Truncating instead would silently under-order material.
    expect(() => generateLayoutSegments(SQUARE, { x: 0, y: 0 }, EAST, 0.001)).toThrow(RangeError)
    expect(() => generateLayoutSegments(SQUARE, { x: 0, y: 0 }, EAST, 0.001)).toThrow(
      String(MAX_LAYOUT_LINES),
    )
  })
})

// ---------------------------------------------------------------------------
// connectorPointsForSegment
// ---------------------------------------------------------------------------

describe('connectorPointsForSegment', () => {
  it('places nothing when there is no spacing or no length', () => {
    expect(connectorPointsForSegment(seg(0, 0, 40, 0), 0)).toEqual([])
    expect(connectorPointsForSegment(seg(0, 0, 40, 0), -5)).toEqual([])
    expect(connectorPointsForSegment(seg(0, 0, 0, 0), 10)).toEqual([])
  })

  it('places interior supports, never at the clipped ends', () => {
    // Endpoint-inclusive spacing drew dotted diagonals wherever a row was
    // clipped by a sloped edge; these are interior support locations.
    const points = connectorPointsForSegment(seg(0, 0, 40, 0), 15)
    expect(points).toHaveLength(3)
    const xs = points.map((p) => p.x)
    expect(xs[0]).toBeCloseTo(40 / 6, 9)
    expect(xs[1]).toBeCloseTo(20, 9)
    expect(xs[2]).toBeCloseTo((40 * 5) / 6, 9)
    for (const p of points) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(40)
    }
  })

  it('keeps centre-to-centre spacing within the maximum', () => {
    for (const max of [5, 9, 13, 40, 97]) {
      const points = connectorPointsForSegment(seg(0, 0, 100, 0), max)
      for (let i = 1; i < points.length; i++) {
        expect(points[i]!.x - points[i - 1]!.x).toBeLessThanOrEqual(max + 1e-9)
      }
      // Edge distance is half the support spacing for that run.
      const gap = points.length > 1 ? points[1]!.x - points[0]!.x : 100
      expect(points[0]!.x).toBeCloseTo(gap / 2, 9)
    }
  })

  it('always places at least one support on a real piece', () => {
    expect(connectorPointsForSegment(seg(0, 0, 5, 0), 1000)).toHaveLength(1)
  })

  it('raises rather than emitting an unbounded support list', () => {
    expect(() => connectorPointsForSegment(seg(0, 0, 100, 0), 0.01)).toThrow(RangeError)
    expect(() => connectorPointsForSegment(seg(0, 0, 100, 0), 0.01)).toThrow(
      String(MAX_CONNECTORS_PER_PIECE),
    )
  })
})

// ---------------------------------------------------------------------------
// buildPieces
// ---------------------------------------------------------------------------

describe('buildPieces', () => {
  it('returns nothing without a usable stock length', () => {
    const runs = [seg(0, 0, 120, 0)]
    expect(buildPieces(runs, opts({ stockLengthPoints: 0 }))).toEqual([])
    expect(buildPieces(runs, opts({ stockLengthPoints: -40 }))).toEqual([])
  })

  it('returns nothing for a stock length under the minimum useful piece', () => {
    // Same answer as the C++ — every candidate piece would be too short to
    // place, so it appends nothing — reached in O(1) instead of
    // O(runLength / stock). This is the livelock class, not a behaviour change.
    expect(buildPieces([seg(0, 0, 1000, 0)], opts({ stockLengthPoints: 0.4 }))).toEqual([])
  })

  it('skips a run shorter than one useful piece', () => {
    expect(buildPieces([seg(0, 0, 0.4, 0)], opts())).toEqual([])
  })

  it('skips a zero-length run', () => {
    expect(buildPieces([seg(10, 10, 10, 10)], opts())).toEqual([])
  })

  it('accepts an empty run list', () => {
    expect(buildPieces([], opts())).toEqual([])
  })

  it('cuts an exact multiple of the stock length with no overage', () => {
    const pieces = buildPieces([seg(0, 0, 120, 0)], opts())
    expect(pieces).toHaveLength(3)
    expect(stockUnitsUsed(pieces)).toBeCloseTo(3, 9)
    expect(coveredLengthPoints(pieces)).toBeCloseTo(120, 9)
    for (const piece of pieces) {
      expect(piece.stockFraction).toBe(1)
      expect(piece.family).toBe('full')
      // No overage: the physical stock is exactly the covered run.
      expect(segmentLength(piece.fullSegment)).toBeCloseTo(segmentLength(piece.insideSegment), 9)
    }
  })

  it('caps only the true ends of a run and joins everything between', () => {
    const pieces = buildPieces([seg(0, 0, 120, 0)], opts())
    expect(pieces.map((p) => p.startCap)).toEqual([true, false, false])
    expect(pieces.map((p) => p.endCap)).toEqual([false, false, true])
    // A joiner belongs to the piece that starts there, so a 3-piece run has 2.
    expect(pieces.flatMap((p) => p.jointPoints).map((p) => p.x)).toEqual([40, 80])
  })

  it('centres the overage of a run that fits in a single piece', () => {
    const pieces = buildPieces([seg(0, 0, 30, 0)], opts())
    expect(pieces).toHaveLength(1)
    const piece = pieces[0]!
    expect(piece.startCap).toBe(true)
    expect(piece.endCap).toBe(true)
    expect(piece.jointPoints).toEqual([])
    expect(segmentLength(piece.insideSegment)).toBeCloseTo(30, 9)
    // 40 pt of stock over a 30 pt run: 5 pt hangs past each end.
    expect(piece.fullSegment.a.x).toBeCloseTo(-5, 9)
    expect(piece.fullSegment.b.x).toBeCloseTo(35, 9)
  })

  it('buys the smallest allowed fraction that covers the tail', () => {
    // An 8 pt run against a 40 pt stock needs 0.2 of a length.
    const run = [seg(0, 0, 8, 0)]
    expect(buildPieces(run, opts({ yieldGranularity: 'full' }))[0]!.stockFraction).toBe(1)
    expect(buildPieces(run, opts({ yieldGranularity: 'half' }))[0]!.stockFraction).toBe(0.5)
    expect(buildPieces(run, opts({ yieldGranularity: 'quarter' }))[0]!.stockFraction).toBe(0.25)
    expect(buildPieces(run, opts({ yieldGranularity: 'third' }))[0]!.stockFraction).toBeCloseTo(
      1 / 3,
      9,
    )
  })

  it('labels the fractional tail piece by family', () => {
    const run = [seg(0, 0, 8, 0)]
    expect(buildPieces(run, opts({ yieldGranularity: 'half' }))[0]!.family).toBe('half')
    expect(buildPieces(run, opts({ yieldGranularity: 'quarter' }))[0]!.family).toBe('quarter')
    expect(buildPieces(run, opts({ yieldGranularity: 'third' }))[0]!.family).toBe('third')
  })

  it('never orders more stock at a finer granularity', () => {
    // Invariant, not an oracle number: a finer granularity can only ever pick a
    // fraction <= the coarser one for the same tail. If a change here makes a
    // quarter-yield estimate cost MORE than a full-yield one, it is wrong.
    const runs = [seg(0, 0, 137, 0), seg(0, 10, 58, 10), seg(0, 20, 40, 20), seg(0, 30, 9, 30)]
    const full = stockUnitsUsed(buildPieces(runs, opts({ yieldGranularity: 'full' })))
    const half = stockUnitsUsed(buildPieces(runs, opts({ yieldGranularity: 'half' })))
    const quarter = stockUnitsUsed(buildPieces(runs, opts({ yieldGranularity: 'quarter' })))
    expect(half).toBeLessThanOrEqual(full + 1e-9)
    expect(quarter).toBeLessThanOrEqual(half + 1e-9)
  })

  it('covers the whole run whatever the granularity', () => {
    const runs = [seg(0, 0, 137, 0), seg(0, 10, 58, 10)]
    for (const yieldGranularity of ['full', 'half', 'third', 'quarter']) {
      const pieces = buildPieces(runs, opts({ yieldGranularity }))
      expect(coveredLengthPoints(pieces)).toBeCloseTo(137 + 58, 6)
    }
  })

  it('never lets the physical stock be shorter than the run it covers', () => {
    const runs = [seg(0, 0, 137, 0), seg(0, 10, 58, 10), seg(0, 20, 3, 20)]
    for (const yieldGranularity of ['full', 'half', 'third', 'quarter']) {
      for (const piece of buildPieces(runs, opts({ yieldGranularity }))) {
        expect(segmentLength(piece.fullSegment)).toBeGreaterThanOrEqual(
          segmentLength(piece.insideSegment) - 1e-9,
        )
        expect(piece.stockFraction).toBeGreaterThan(0)
        expect(piece.stockFraction).toBeLessThanOrEqual(1)
      }
    }
  })

  it('leaves the pieces end to end with no gap and no overlap', () => {
    const pieces = buildPieces([seg(0, 0, 137, 0)], opts({ yieldGranularity: 'quarter' }))
    expect(pieces.length).toBeGreaterThan(1)
    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i]!.insideSegment.a.x).toBeCloseTo(pieces[i - 1]!.insideSegment.b.x, 9)
    }
    expect(pieces[0]!.insideSegment.a.x).toBeCloseTo(0, 9)
    expect(pieces[pieces.length - 1]!.insideSegment.b.x).toBeCloseTo(137, 9)
  })

  it('lays cuts on the stock grid when seams are aligned', () => {
    // The run starts 10 pt past the origin, so the first piece is trimmed to
    // 30 pt and every later cut lands on a multiple of the 40 pt stock.
    const pieces = buildPieces([seg(10, 0, 110, 0)], opts({ alignSeams: true }))
    expect(cutPositions(pieces)).toEqual([40, 80])
    for (const x of cutPositions(pieces)) expect(x % 40).toBeCloseTo(0, 9)
  })

  it('lays cuts from the run start when seams are not aligned', () => {
    const pieces = buildPieces([seg(10, 0, 110, 0)], opts({ alignSeams: false }))
    expect(cutPositions(pieces)).toEqual([50, 90])
  })

  it('hangs the seam-aligned lead piece back past the run start', () => {
    // All of the lead piece's overage goes BEFORE the run. That is the whole
    // visible effect of alignSeams and it is what puts the next seam on grid.
    const [lead] = buildPieces([seg(10, 0, 110, 0)], opts({ alignSeams: true }))
    expect(lead!.insideSegment.a.x).toBe(10)
    expect(lead!.insideSegment.b.x).toBe(40)
    expect(lead!.fullSegment.a.x).toBeCloseTo(0, 9)
    expect(lead!.fullSegment.b.x).toBeCloseTo(40, 9)
  })

  it('aligns seams across parallel runs that start at different walls', () => {
    // Two rows of a staircase-shaped region. With alignment on they cut on one
    // grid; without it each row cuts from its own wall.
    const runs = [seg(10, 0, 200, 0), seg(23, 25, 200, 25)]
    const aligned = buildPieces(runs, opts({ alignSeams: true }))
    const rowA = aligned.filter((p) => p.insideSegment.a.y === 0)
    const rowB = aligned.filter((p) => p.insideSegment.a.y === 25)
    expect(cutPositions(rowA)).toEqual(cutPositions(rowB))

    const free = buildPieces(runs, opts({ alignSeams: false }))
    const freeA = free.filter((p) => p.insideSegment.a.y === 0)
    const freeB = free.filter((p) => p.insideSegment.a.y === 25)
    expect(cutPositions(freeA)).not.toEqual(cutPositions(freeB))
  })

  it('does not trim the lead piece when the run already starts on the grid', () => {
    const pieces = buildPieces([seg(80, 0, 200, 0)], opts({ alignSeams: true }))
    expect(cutPositions(pieces)).toEqual([120, 160])
    expect(pieces[0]!.fullSegment.a.x).toBeCloseTo(80, 9)
  })

  it('measures the seam phase from the origin, not from the page corner', () => {
    const shifted = buildPieces(
      [seg(10, 0, 110, 0)],
      opts({ alignSeams: true, origin: { x: 5, y: 0 } }),
    )
    expect(cutPositions(shifted)).toEqual([45, 85])
  })

  it('runs backwards along a reversed run without changing the piece count', () => {
    const forward = buildPieces([seg(0, 0, 137, 0)], opts({ yieldGranularity: 'quarter' }))
    const reverse = buildPieces([seg(137, 0, 0, 0)], opts({ yieldGranularity: 'quarter' }))
    expect(reverse).toHaveLength(forward.length)
    expect(stockUnitsUsed(reverse)).toBeCloseTo(stockUnitsUsed(forward), 9)
    expect(coveredLengthPoints(reverse)).toBeCloseTo(coveredLengthPoints(forward), 9)
  })

  it('attaches connectors to every piece when a spacing is set', () => {
    const pieces = buildPieces([seg(0, 0, 120, 0)], opts({ maxConnectorSpacingPoints: 15 }))
    expect(pieces).toHaveLength(3)
    for (const piece of pieces) {
      expect(piece.connectorPoints).toHaveLength(3)
      for (const p of piece.connectorPoints) {
        expect(p.x).toBeGreaterThan(piece.insideSegment.a.x)
        expect(p.x).toBeLessThan(piece.insideSegment.b.x)
      }
    }
  })

  it('treats the cassette backing spacing and the baffle connector spacing as one input', () => {
    // "Backing Max" and "Conn. Max" are two labels on `maxConnectorSpacing`.
    // There is no second parameter and no product-type branch here.
    const cassette = buildPieces([seg(0, 0, 120, 0)], opts({ maxConnectorSpacingPoints: 15 }))
    const baffle = buildPieces([seg(0, 0, 120, 0)], opts({ maxConnectorSpacingPoints: 15 }))
    expect(cassette).toEqual(baffle)
  })

  it('reports piece counts by family', () => {
    const pieces = buildPieces([seg(0, 0, 108, 0)], opts({ yieldGranularity: 'half' }))
    const counts = pieceCountsByFamily(pieces)
    expect(counts.full + counts.half + counts.third + counts.quarter).toBe(pieces.length)
  })

  it('terminates on a long run against a barely-useful stock length', () => {
    // Bound: 1 + ceil(runLength / MIN_USEFUL_PIECE_POINTS) passes. A stock just
    // over the minimum is the worst case and must still return.
    const pieces = buildPieces([seg(0, 0, 500, 0)], opts({ stockLengthPoints: 0.51 }))
    expect(pieces.length).toBeGreaterThan(0)
    expect(pieces.length).toBeLessThanOrEqual(Math.ceil(500 / 0.5) + 2)
    // A tail shorter than one useful piece is dropped rather than ordered, so
    // coverage falls short of the run by less than MIN_USEFUL_PIECE_POINTS.
    expect(coveredLengthPoints(pieces)).toBeGreaterThan(500 - 0.5)
    expect(coveredLengthPoints(pieces)).toBeLessThanOrEqual(500 + 1e-9)
  })
})

// ---------------------------------------------------------------------------
// selectAutomaticOrigin
// ---------------------------------------------------------------------------

describe('selectAutomaticOrigin', () => {
  const layout = {
    spacingPoints: 25,
    stockLengthPoints: 40,
    yieldGranularity: 'full',
    alignSeams: false,
    maxConnectorSpacingPoints: 0,
  }

  it('returns null when the region or direction is degenerate', () => {
    expect(selectAutomaticOrigin([], EAST, layout)).toBeNull()
    expect(selectAutomaticOrigin(SQUARE, { x: 0, y: 0 }, layout)).toBeNull()
    expect(selectAutomaticOrigin(SQUARE, EAST, { ...layout, spacingPoints: 0 })).toBeNull()
  })

  it('returns null when no phase yields a piece', () => {
    expect(selectAutomaticOrigin(SQUARE, EAST, { ...layout, stockLengthPoints: 0 })).toBeNull()
  })

  it('produces a layout whose pieces cover its own segments', () => {
    const result = selectAutomaticOrigin(SQUARE, EAST, layout)
    expect(result).not.toBeNull()
    const total = result!.segments.reduce((sum, s) => sum + segmentLength(s), 0)
    expect(coveredLengthPoints(result!.pieces)).toBeCloseTo(total, 6)
  })

  it('is deterministic', () => {
    // 64 fixed phases and a total order over the scores: the same input must
    // never produce two different bids.
    expect(selectAutomaticOrigin(SQUARE, EAST, layout)).toEqual(
      selectAutomaticOrigin(SQUARE, EAST, layout),
    )
  })

  it('searches a seam phase as well when seams are aligned', () => {
    const aligned = selectAutomaticOrigin(SQUARE, EAST, { ...layout, alignSeams: true })
    expect(aligned).not.toBeNull()
    expect(aligned!.pieces.length).toBeGreaterThan(0)
  })

  it('ORACLE-ONLY: which origin phase wins is unverified without a fixture', () => {
    // The ranking (coverage within two spacings, then fewest ordered pieces,
    // then least stock, then coverage) is ported faithfully, but the phase it
    // settles on for a real region has never been compared to the Qt build.
    // This asserts only that a winner exists and is one of the sampled phases.
    const result = selectAutomaticOrigin(SQUARE, EAST, layout)
    expect(result).not.toBeNull()
    const centre = { x: 50, y: 50 }
    const phase = result!.origin.y - centre.y
    expect(phase).toBeGreaterThanOrEqual(0)
    expect(phase).toBeLessThan(layout.spacingPoints)
  })
})

// ---------------------------------------------------------------------------
// buildRunLayout
// ---------------------------------------------------------------------------

describe('buildRunLayout', () => {
  const base = {
    spacingPoints: 25,
    stockLengthPoints: 40,
    yieldGranularity: 'full',
    alignSeams: false,
    maxConnectorSpacingPoints: 0,
  }

  it('returns null without a usable direction', () => {
    expect(buildRunLayout(SQUARE, { x: 0, y: 0 }, base)).toBeNull()
  })

  it('uses a drawn origin verbatim rather than searching', () => {
    const drawn: Point = { x: 0, y: 12.5 }
    const result = buildRunLayout(SQUARE, EAST, { ...base, origin: drawn })
    expect(result).not.toBeNull()
    expect(result!.origin).toEqual(drawn)
    expect(result!.segments).toEqual(generateLayoutSegments(SQUARE, drawn, EAST, 25))
  })

  it('falls back to the automatic origin when none is drawn', () => {
    const result = buildRunLayout(SQUARE, EAST, base)
    expect(result).not.toBeNull()
    expect(result!.pieces.length).toBeGreaterThan(0)
  })

  it('generates no rails unless both rail specs are positive', () => {
    const none = buildRunLayout(SQUARE, EAST, { ...base, origin: { x: 0, y: 12.5 } })
    expect(none!.railSegments).toEqual([])
    expect(none!.railPieces).toEqual([])

    const spacingOnly = buildRunLayout(SQUARE, EAST, {
      ...base,
      origin: { x: 0, y: 12.5 },
      railSpacingPoints: 50,
    })
    expect(spacingOnly!.railPieces).toEqual([])

    const lengthOnly = buildRunLayout(SQUARE, EAST, {
      ...base,
      origin: { x: 0, y: 12.5 },
      railLengthPoints: 200,
    })
    expect(lengthOnly!.railPieces).toEqual([])
  })

  it('runs plank rails perpendicular to the planks, at full granularity', () => {
    const result = buildRunLayout(SQUARE, EAST, {
      ...base,
      origin: { x: 12.5, y: 12.5 },
      railSpacingPoints: 50,
      railLengthPoints: 200,
    })
    expect(result).not.toBeNull()
    expect(result!.railSegments.length).toBeGreaterThan(0)
    for (const s of result!.railSegments) {
      // Perpendicular to EAST: constant x.
      expect(s.a.x).toBeCloseTo(s.b.x, 9)
    }
    for (const piece of result!.railPieces) {
      expect(piece.stockFraction).toBe(1)
      expect(piece.family).toBe('full')
      // A rail carries no supports of its own.
      expect(piece.connectorPoints).toEqual([])
    }
  })

  it('lays rails from the same origin as the planks', () => {
    const origin: Point = { x: 12.5, y: 12.5 }
    const result = buildRunLayout(SQUARE, EAST, {
      ...base,
      origin,
      railSpacingPoints: 50,
      railLengthPoints: 200,
    })
    expect(result!.railSegments).toEqual(
      generateLayoutSegments(SQUARE, origin, leftNormal(EAST), 50),
    )
  })

  it('ORACLE-ONLY: rail and plank piece counts for a real ceiling are unverified', () => {
    // Nothing here has been compared to the Qt build: both shipped fixtures are
    // `panels`. This only pins the structural relationship — rails cross the
    // planks and are cut against their own length.
    const result = buildRunLayout(SQUARE, EAST, {
      ...base,
      origin: { x: 12.5, y: 12.5 },
      railSpacingPoints: 50,
      railLengthPoints: 200,
    })
    expect(result!.railPieces.length).toBe(result!.railSegments.length)
  })
})
