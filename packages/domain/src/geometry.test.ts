import { describe, it, expect } from 'vitest'
import {
  signedPolygonArea,
  pointInPolygon,
  regionArea,
  regionPerimeter,
  polylineLength,
  squarePointsToSquareFeet,
  distanceToSegment,
  nearestEdge,
  type Polygon,
} from './geometry.js'

const rect = (x: number, y: number, w: number, h: number): Polygon => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
]

describe('signedPolygonArea', () => {
  it('is zero for degenerate rings', () => {
    expect(signedPolygonArea([])).toBe(0)
    expect(signedPolygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0)
  })

  it('matches shoelace for a unit square', () => {
    expect(Math.abs(signedPolygonArea(rect(0, 0, 1, 1)))).toBeCloseTo(1, 12)
  })

  it('flips sign with winding direction', () => {
    const cw = rect(0, 0, 10, 4)
    const ccw = [...cw].reverse()
    expect(signedPolygonArea(cw)).toBeCloseTo(-signedPolygonArea(ccw), 12)
  })

  it('agrees with an independent shoelace to 12 significant digits', () => {
    // irregular ring
    const poly: Polygon = [
      { x: 12.5, y: 3.25 }, { x: 88.125, y: 9.5 }, { x: 101.75, y: 64.0 },
      { x: 40.5, y: 91.875 }, { x: 4.25, y: 55.5 },
    ]
    let ref = 0
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!
      ref += a.x * b.y - b.x * a.y
    }
    expect(signedPolygonArea(poly)).toBeCloseTo(ref / 2, 12)
  })
})

describe('pointInPolygon', () => {
  const square = rect(0, 0, 10, 10)
  it('detects inside and outside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false)
    expect(pointInPolygon({ x: -1, y: 5 }, square)).toBe(false)
  })
})

describe('regionArea — the cutout rule', () => {
  it('returns the ring area for a single ring', () => {
    expect(regionArea([rect(0, 0, 10, 10)])).toBeCloseTo(100, 10)
  })

  it('SUBTRACTS a hole rather than adding it', () => {
    // This is the regression the C++ comment describes: summing signed areas
    // adds the opening instead of removing it.
    const outer = rect(0, 0, 10, 10)
    const hole = rect(2, 2, 3, 3)
    expect(regionArea([outer, hole])).toBeCloseTo(100 - 9, 10)
  })

  it('subtracts a hole regardless of the hole ring winding', () => {
    const outer = rect(0, 0, 10, 10)
    const holeCw = rect(2, 2, 3, 3)
    const holeCcw = [...holeCw].reverse()
    expect(regionArea([outer, holeCcw])).toBeCloseTo(91, 10)
    expect(regionArea([outer, holeCw])).toBeCloseTo(91, 10)
  })

  it('handles an island inside a hole (depth 2 is material again)', () => {
    const outer = rect(0, 0, 20, 20)   // depth 0 -> +400
    const hole = rect(4, 4, 12, 12)    // depth 1 -> -144
    const island = rect(7, 7, 6, 6)    // depth 2 -> +36
    expect(regionArea([outer, hole, island])).toBeCloseTo(400 - 144 + 36, 10)
  })

  it('handles two disjoint regions', () => {
    expect(regionArea([rect(0, 0, 5, 5), rect(100, 100, 4, 4)])).toBeCloseTo(25 + 16, 10)
  })

  it('never returns negative area', () => {
    // pathological: hole larger than the outer ring
    expect(regionArea([rect(0, 0, 2, 2), rect(-10, -10, 40, 40)])).toBeGreaterThanOrEqual(0)
  })

  it('is order-independent', () => {
    const outer = rect(0, 0, 10, 10)
    const hole = rect(2, 2, 3, 3)
    expect(regionArea([outer, hole])).toBeCloseTo(regionArea([hole, outer]), 10)
  })
})

describe('regionPerimeter', () => {
  it('closes an unclosed ring', () => {
    expect(regionPerimeter([rect(0, 0, 10, 4)])).toBeCloseTo(28, 10)
  })

  it('does not double count an explicitly closed ring', () => {
    const closed = [...rect(0, 0, 10, 4), { x: 0, y: 0 }]
    expect(regionPerimeter([closed])).toBeCloseTo(28, 10)
  })

  it('sums every ring including holes', () => {
    expect(regionPerimeter([rect(0, 0, 10, 10), rect(2, 2, 3, 3)])).toBeCloseTo(40 + 12, 10)
  })
})

describe('polylineLength', () => {
  it('is zero below two points', () => {
    expect(polylineLength([{ x: 0.5, y: 0.5 }], 1000, 800)).toBe(0)
  })

  it('scales normalized coords by the page box', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }]
    expect(polylineLength(pts, 3456, 2592)).toBeCloseTo(3456, 9)
  })

  it('accumulates multiple segments', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }]
    expect(polylineLength(pts, 100, 200)).toBeCloseTo(50 + 100, 9)
  })
})

describe('scale conversion', () => {
  it('converts square points to square feet', () => {
    // 1/4" = 1'-0"  ->  48 drawing feet per inch -> 48/72 feet per point
    const feetPerPoint = 48 / 72
    expect(squarePointsToSquareFeet(72 * 72, feetPerPoint)).toBeCloseTo(48 * 48, 9)
  })
})

describe('distanceToSegment', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 10, y: 0 }

  it('measures perpendicular distance to the middle', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, a, b)).toBeCloseTo(3, 12)
  })

  it('clamps past the ends rather than using the infinite line', () => {
    // the infinite line would say 0; the segment says 5
    expect(distanceToSegment({ x: 15, y: 0 }, a, b)).toBeCloseTo(5, 12)
    expect(distanceToSegment({ x: -4, y: 0 }, a, b)).toBeCloseTo(4, 12)
  })

  it('is zero on the segment', () => {
    expect(distanceToSegment({ x: 7, y: 0 }, a, b)).toBeCloseTo(0, 12)
  })

  it('handles a zero-length segment', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBeCloseTo(5, 12)
  })
})

describe('nearestEdge', () => {
  const square: Polygon = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ]

  it('finds the closest edge of a closed ring', () => {
    expect(nearestEdge({ x: 5, y: -1 }, square, true)!.index).toBe(0)   // bottom
    expect(nearestEdge({ x: 11, y: 5 }, square, true)!.index).toBe(1)   // right
  })

  it('considers the closing edge only when closed', () => {
    // near the left edge, which is the last->first segment
    const closed = nearestEdge({ x: -1, y: 5 }, square, true)
    expect(closed!.index).toBe(3)
    expect(closed!.distance).toBeCloseTo(1, 9)

    const open = nearestEdge({ x: -1, y: 5 }, square, false)
    expect(open!.index).not.toBe(3)
  })

  it('returns null below two vertices', () => {
    expect(nearestEdge({ x: 0, y: 0 }, [{ x: 1, y: 1 }], true)).toBeNull()
  })
})
