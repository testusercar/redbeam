import { describe, it, expect } from 'vitest'
import {
  axisAngleDegrees,
  compareZonePrecedence,
  directionGroupKey,
  findOverlappingZonePairs,
  isScopeDefaultDirectionUsable,
  normalizeAxisDegrees,
  normalizedBoundingRect,
  normalizedDirectionAngle,
  normalizedDirectionFromAngle,
  patternDirectionLine,
  patternOriginPoint,
  pointInRegion,
  resolveDirectionZone,
  resolvePatternDirection,
  resolvePatternOrigin,
  sameAxis,
  scopeDefaultDirection,
  scopeDefaultDirectionFromSpecifications,
  zoneArea,
  zonesContaining,
  type DirectionZone,
  type PageSize,
} from './pattern.js'
import type { Point, Region } from './geometry.js'

// A real sheet, deliberately not square: PKG A ARCH page 48 is 3456x2592pt.
// Every angle test that would pass on a square page is worthless.
const PAGE: PageSize = { width: 3456, height: 2592 }
const SQUARE: PageSize = { width: 1000, height: 1000 }

const rect = (l: number, t: number, r: number, b: number): Point[] => [
  { x: l, y: t },
  { x: r, y: t },
  { x: r, y: b },
  { x: l, y: b },
]

const zone = (
  id: string,
  rings: Region,
  direction: [Point, Point],
  priority?: number,
): DirectionZone => (priority === undefined ? { id, rings, direction } : { id, rings, direction, priority })

const EAST: [Point, Point] = [
  { x: 0.1, y: 0.5 },
  { x: 0.9, y: 0.5 },
]
const SOUTH: [Point, Point] = [
  { x: 0.5, y: 0.1 },
  { x: 0.5, y: 0.9 },
]

// ---------------------------------------------------------------------------
// Angle convention
// ---------------------------------------------------------------------------

describe('angle convention', () => {
  it('folds every angle into [0,180) — a direction is an axis, not an arrow', () => {
    expect(normalizeAxisDegrees(0)).toBe(0)
    expect(normalizeAxisDegrees(180)).toBe(0)
    expect(normalizeAxisDegrees(210)).toBe(30)
    expect(normalizeAxisDegrees(-30)).toBe(150)
    expect(normalizeAxisDegrees(-370)).toBeCloseTo(170, 12)
    expect(normalizeAxisDegrees(Number.NaN)).toBe(0)
  })

  it('runs left-to-right at 0 and top-to-bottom at 90 (y grows DOWN)', () => {
    expect(axisAngleDegrees({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } })).toBe(0)
    expect(axisAngleDegrees({ a: { x: 0, y: 0 }, b: { x: 0, y: 10 } })).toBe(90)
  })

  it('gives a POSITIVE angle for a clockwise-on-screen rotation', () => {
    // down-and-right. In maths convention (y up) this would be -45.
    const a = axisAngleDegrees({ a: { x: 0, y: 0 }, b: { x: 10, y: 10 } })
    expect(a).toBeCloseTo(45, 12)
    // up-and-right is the same axis as down-and-left: 135, not -45.
    expect(axisAngleDegrees({ a: { x: 0, y: 0 }, b: { x: 10, y: -10 } })).toBeCloseTo(135, 12)
  })

  it('reads the same angle whichever end the line was drawn from', () => {
    const fwd = axisAngleDegrees({ a: { x: 1, y: 2 }, b: { x: 9, y: 7 } })
    const rev = axisAngleDegrees({ a: { x: 9, y: 7 }, b: { x: 1, y: 2 } })
    expect(fwd).toBeCloseTo(rev, 12)
  })

  it('measures in PDF points, so the page aspect ratio cannot skew it', () => {
    // 45 degrees on a 3456x2592 sheet is NOT a 45-degree normalized delta.
    const dir = normalizedDirectionFromAngle(45, PAGE)
    const dx = dir[1].x - dir[0].x
    const dy = dir[1].y - dir[0].y
    expect(dy / dx).toBeCloseTo(PAGE.width / PAGE.height, 12)
    expect(normalizedDirectionAngle(dir, PAGE)).toBeCloseTo(45, 9)
    // and the naive normalized-space answer really is wrong, so the guard earns
    // its keep: atan2 on the raw normalized delta reads ~53 degrees.
    expect((Math.atan2(dy, dx) * 180) / Math.PI).toBeCloseTo(53.13, 2)
  })

  it('round-trips a direction through normalized coordinates without drifting', () => {
    for (const page of [PAGE, SQUARE, { width: 612, height: 792 }]) {
      for (let deg = 0; deg < 180; deg += 3) {
        const dir = normalizedDirectionFromAngle(deg, page)
        const back = normalizedDirectionAngle(dir, page)
        expect(back).not.toBeNull()
        expect(back!).toBeCloseTo(deg, 9)
      }
    }
  })

  it('survives repeated normalized -> points -> normalized round trips', () => {
    let dir = normalizedDirectionFromAngle(37.5, PAGE, { x: 0.25, y: 0.75 }, 400)
    const first = normalizedDirectionAngle(dir, PAGE)!
    for (let i = 0; i < 50; i++) {
      const angle = normalizedDirectionAngle(dir, PAGE)!
      dir = normalizedDirectionFromAngle(angle, PAGE, dir[0], 400)
    }
    expect(normalizedDirectionAngle(dir, PAGE)!).toBeCloseTo(first, 9)
    expect(first).toBeCloseTo(37.5, 9)
  })

  it('treats an axis and its reverse as the same orientation', () => {
    expect(sameAxis(30, 210)).toBe(true)
    expect(sameAxis(0, 179.9999999, 1e-6)).toBe(true)
    expect(sameAxis(30, 60)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Pattern direction
// ---------------------------------------------------------------------------

describe('patternDirectionLine', () => {
  it('takes the first two points and scales them to PDF points', () => {
    const seg = patternDirectionLine(
      [
        { x: 0.25, y: 0.5 },
        { x: 0.75, y: 0.5 },
        { x: 0.9, y: 0.9 },
      ],
      PAGE,
    )
    expect(seg).toEqual({ a: { x: 864, y: 1296 }, b: { x: 2592, y: 1296 } })
  })

  it('is null for fewer than two points or a zero-length line', () => {
    expect(patternDirectionLine([{ x: 0.5, y: 0.5 }], PAGE)).toBeNull()
    expect(patternDirectionLine([], PAGE)).toBeNull()
    expect(patternDirectionLine(undefined, PAGE)).toBeNull()
    expect(
      patternDirectionLine([{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }], PAGE),
    ).toBeNull()
  })
})

describe('scope default direction from specifications', () => {
  it('reads the persisted vector — the default when none is drawn on the page', () => {
    const scope = {
      specifications: {
        scopeDefaultDirection: { x1: 0.1, y1: 0.2, x2: 0.6, y2: 0.2, sourcePage: 3 },
      },
    }
    expect(scopeDefaultDirectionFromSpecifications(scope)).toEqual({
      x1: 0.1,
      y1: 0.2,
      x2: 0.6,
      y2: 0.2,
      sourcePage: 3,
    })
    expect(normalizedDirectionAngle(scopeDefaultDirection(scope)!, PAGE)).toBe(0)
  })

  it('coerces missing members to 0 like QJsonValue::toDouble', () => {
    expect(
      scopeDefaultDirectionFromSpecifications({
        specifications: { scopeDefaultDirection: { x2: 0.5 } },
      }),
    ).toEqual({ x1: 0, y1: 0, x2: 0.5, y2: 0 })
  })

  it('distinguishes "no default" from "the zero vector"', () => {
    expect(scopeDefaultDirectionFromSpecifications({ specifications: {} })).toBeNull()
    expect(
      scopeDefaultDirectionFromSpecifications({ specifications: { scopeDefaultDirection: {} } }),
    ).toBeNull()
    expect(scopeDefaultDirectionFromSpecifications(null)).toBeNull()

    const zeroVector = { x1: 0.4, y1: 0.4, x2: 0.4, y2: 0.4 }
    expect(isScopeDefaultDirectionUsable(zeroVector)).toBe(false)
    expect(
      scopeDefaultDirection({ specifications: { scopeDefaultDirection: zeroVector } }),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Pattern origin
// ---------------------------------------------------------------------------

describe('patternOriginPoint', () => {
  it('is the CENTRE of the bounding rectangle, not the first vertex', () => {
    // The Qt origin is a GeomCircle placed by a PickPoint engine, so the click
    // survives only as the bounding-rect centre.
    const circleish: Region = [rect(0.2, 0.3, 0.4, 0.5)]
    const o = patternOriginPoint({ rings: circleish }, SQUARE)
    expect(o.x).toBeCloseTo(300, 9)
    expect(o.y).toBeCloseTo(400, 9)
  })

  it('reads a one-point ring as that point', () => {
    expect(patternOriginPoint({ rings: [[{ x: 0.25, y: 0.75 }]] }, PAGE)).toEqual({
      x: 864,
      y: 1944,
    })
  })

  it('returns (0,0) for a missing origin, exactly like a default NormalizedRect', () => {
    expect(patternOriginPoint(null, PAGE)).toEqual({ x: 0, y: 0 })
    expect(patternOriginPoint({ rings: [] }, PAGE)).toEqual({ x: 0, y: 0 })
  })

  it('bounds every ring', () => {
    expect(normalizedBoundingRect([rect(0.2, 0.2, 0.4, 0.4), rect(0.6, 0.1, 0.8, 0.9)])).toEqual({
      left: 0.2,
      top: 0.1,
      right: 0.8,
      bottom: 0.9,
    })
    expect(normalizedBoundingRect([])).toBeNull()
  })
})

describe('resolvePatternOrigin', () => {
  const region: Region = [rect(0.2, 0.2, 0.8, 0.6)]

  it('uses a placed origin whose point falls inside the region', () => {
    const r = resolvePatternOrigin(
      [{ id: 'o1', rings: [[{ x: 0.3, y: 0.3 }]] }],
      region,
      SQUARE,
    )
    expect(r).toEqual({
      point: { x: 300, y: 300 },
      normalized: { x: 0.3, y: 0.3 },
      source: 'placed',
      originId: 'o1',
    })
  })

  it('ignores an origin outside the region', () => {
    const r = resolvePatternOrigin([{ id: 'far', rings: [[{ x: 0.9, y: 0.9 }]] }], region, SQUARE)
    expect(r?.source).toBe('derived')
  })

  it('takes the FIRST origin inside the region, as the Qt loop does', () => {
    const r = resolvePatternOrigin(
      [
        { id: 'a', rings: [[{ x: 0.25, y: 0.25 }]] },
        { id: 'b', rings: [[{ x: 0.7, y: 0.5 }]] },
      ],
      region,
      SQUARE,
    )
    expect(r?.originId).toBe('a')
  })

  it('derives the origin from the region bounding rectangle when none is placed', () => {
    const r = resolvePatternOrigin([], region, SQUARE)
    expect(r).toEqual({
      point: { x: 500, y: 400 },
      normalized: { x: 0.5, y: 0.4 },
      source: 'derived',
    })
  })

  it('derives from the BOUNDING rect, not the centroid — an L is the giveaway', () => {
    // An L-shaped region: centroid is well off the bounding-rect centre.
    const ell: Region = [
      [
        { x: 0, y: 0 },
        { x: 0.8, y: 0 },
        { x: 0.8, y: 0.2 },
        { x: 0.2, y: 0.2 },
        { x: 0.2, y: 0.8 },
        { x: 0, y: 0.8 },
      ],
    ]
    expect(resolvePatternOrigin([], ell, SQUARE)?.normalized).toEqual({ x: 0.4, y: 0.4 })
  })

  it('is null when there is no region at all', () => {
    expect(resolvePatternOrigin([], [], SQUARE)).toBeNull()
  })

  it('excludes a hole: an origin in the hole is not inside the region', () => {
    const donut: Region = [rect(0.1, 0.1, 0.9, 0.9), rect(0.4, 0.4, 0.6, 0.6)]
    expect(pointInRegion({ x: 0.5, y: 0.5 }, donut)).toBe(false)
    expect(pointInRegion({ x: 0.2, y: 0.2 }, donut)).toBe(true)
    const r = resolvePatternOrigin([{ id: 'inHole', rings: [[{ x: 0.5, y: 0.5 }]] }], donut, SQUARE)
    expect(r?.source).toBe('derived')
  })
})

// ---------------------------------------------------------------------------
// Direction zones
// ---------------------------------------------------------------------------

describe('zone resolution', () => {
  const big = zone('big', [rect(0.1, 0.1, 0.9, 0.9)], EAST)
  const small = zone('small', [rect(0.3, 0.3, 0.5, 0.5)], SOUTH)

  it('resolves a point to the zone containing it', () => {
    expect(resolveDirectionZone({ x: 0.2, y: 0.2 }, [big, small])?.zone.id).toBe('big')
    expect(resolveDirectionZone({ x: 0.4, y: 0.4 }, [big, small])?.zone.id).toBe('small')
  })

  it('is null outside every zone', () => {
    expect(resolveDirectionZone({ x: 0.95, y: 0.95 }, [big, small])).toBeNull()
  })

  it('excludes a hole', () => {
    const donut = zone('donut', [rect(0.1, 0.1, 0.9, 0.9), rect(0.4, 0.4, 0.6, 0.6)], EAST)
    expect(resolveDirectionZone({ x: 0.5, y: 0.5 }, [donut])).toBeNull()
    expect(resolveDirectionZone({ x: 0.2, y: 0.2 }, [donut])?.zone.id).toBe('donut')
  })

  describe('overlap rule', () => {
    it('gives the point to the SMALLER zone — most specific wins', () => {
      const hit = resolveDirectionZone({ x: 0.4, y: 0.4 }, [big, small])
      expect(hit?.zone.id).toBe('small')
      // and reports the ambiguity rather than hiding it
      expect(hit?.candidates.map((z) => z.id)).toEqual(['small', 'big'])
    })

    it('does not depend on the order the zones were drawn in', () => {
      expect(resolveDirectionZone({ x: 0.4, y: 0.4 }, [small, big])?.zone.id).toBe('small')
      expect(resolveDirectionZone({ x: 0.4, y: 0.4 }, [big, small])?.zone.id).toBe('small')
    })

    it('lets an explicit priority beat a smaller zone', () => {
      const bigPriority = zone('big', [rect(0.1, 0.1, 0.9, 0.9)], EAST, 10)
      expect(resolveDirectionZone({ x: 0.4, y: 0.4 }, [bigPriority, small])?.zone.id).toBe('big')
    })

    it('breaks a same-size, same-priority tie with the later zone', () => {
      const a = zone('a', [rect(0.2, 0.2, 0.6, 0.6)], EAST)
      const b = zone('b', [rect(0.3, 0.3, 0.7, 0.7)], SOUTH)
      expect(zoneArea(a)).toBeCloseTo(zoneArea(b), 15)
      expect(resolveDirectionZone({ x: 0.45, y: 0.45 }, [a, b])?.zone.id).toBe('b')
      expect(resolveDirectionZone({ x: 0.45, y: 0.45 }, [b, a])?.zone.id).toBe('a')
    })

    it('orders every containing zone, not just the winner', () => {
      const mid = zone('mid', [rect(0.2, 0.2, 0.7, 0.7)], EAST)
      expect(zonesContaining({ x: 0.4, y: 0.4 }, [big, mid, small]).map((z) => z.id)).toEqual([
        'small',
        'mid',
        'big',
      ])
    })

    it('compares zones by material area, so a hole makes a zone more specific', () => {
      const solid = zone('solid', [rect(0, 0, 1, 1)], EAST)
      const holed = zone('holed', [rect(0, 0, 1, 1), rect(0.2, 0.2, 0.8, 0.8)], SOUTH)
      expect(zoneArea(solid)).toBeCloseTo(1, 12)
      expect(zoneArea(holed)).toBeCloseTo(1 - 0.36, 12)
      expect(compareZonePrecedence(holed, solid, 0, 1)).toBeLessThan(0)
    })
  })

  it('reports overlapping pairs for a preflight', () => {
    expect(findOverlappingZonePairs([big, small], PAGE)).toEqual([
      { a: 'big', b: 'small', sameAxis: false },
    ])
    const apart = zone('apart', [rect(0.0, 0.0, 0.05, 0.05)], EAST)
    expect(findOverlappingZonePairs([small, apart], PAGE)).toEqual([])
  })

  it('flags an overlap even when the two zones share an axis', () => {
    const inner = zone('inner', [rect(0.3, 0.3, 0.5, 0.5)], [
      { x: 0.31, y: 0.4 },
      { x: 0.49, y: 0.4 },
    ])
    expect(findOverlappingZonePairs([big, inner], PAGE)).toEqual([
      { a: 'big', b: 'inner', sameAxis: true },
    ])
  })

  it('catches edge-crossing overlap with no vertex inside either zone', () => {
    const cross1 = zone('h', [rect(0.1, 0.4, 0.9, 0.6)], EAST)
    const cross2 = zone('v', [rect(0.4, 0.1, 0.6, 0.9)], SOUTH)
    expect(findOverlappingZonePairs([cross1, cross2], PAGE)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

describe('resolvePatternDirection', () => {
  const zones = [zone('z', [rect(0.1, 0.1, 0.4, 0.4)], SOUTH)]
  const scope = {
    specifications: { scopeDefaultDirection: { x1: 0, y1: 0, x2: 0.5, y2: 0 } },
  }

  it('prefers a zone over the page default over the scope default', () => {
    const ctx = { page: PAGE, zones, pageDirection: EAST, scopeDirection: EAST, scope }
    const inZone = resolvePatternDirection({ x: 0.2, y: 0.2 }, ctx)
    expect(inZone?.source).toBe('zone')
    expect(inZone?.zoneId).toBe('z')
    expect(inZone?.angleDegrees).toBe(90)

    const outside = resolvePatternDirection({ x: 0.8, y: 0.8 }, ctx)
    expect(outside?.source).toBe('page')
    expect(outside?.angleDegrees).toBe(0)
  })

  it('falls back to the drawn scope default when no page default exists', () => {
    const r = resolvePatternDirection({ x: 0.8, y: 0.8 }, {
      page: PAGE,
      zones,
      scopeDirection: SOUTH,
      scope,
    })
    expect(r?.source).toBe('scope')
    expect(r?.angleDegrees).toBe(90)
  })

  it('falls back to the persisted specification last of all', () => {
    const r = resolvePatternDirection({ x: 0.8, y: 0.8 }, { page: PAGE, zones, scope })
    expect(r?.source).toBe('scope-specification')
    expect(r?.angleDegrees).toBe(0)
  })

  it('returns null when nothing resolves — a caller must refuse, not guess', () => {
    expect(resolvePatternDirection({ x: 0.8, y: 0.8 }, { page: PAGE, zones })).toBeNull()
    expect(resolvePatternDirection({ x: 0.5, y: 0.5 }, { page: PAGE })).toBeNull()
  })

  it('carries a scope default across pages as a VECTOR, discarding position', () => {
    // Drawn 45 degrees on a square source sheet; read on a 4:3 target sheet the
    // angle must still be 45, because only the source page scales it.
    const drawn: [Point, Point] = [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ]
    const r = resolvePatternDirection({ x: 0.9, y: 0.9 }, {
      page: PAGE,
      scopeDirection: drawn,
      scopeDirectionPage: SQUARE,
    })
    expect(r?.source).toBe('scope')
    expect(r?.angleDegrees).toBeCloseTo(45, 12)
    // and reading it against the target page instead would be wrong
    expect(normalizedDirectionAngle(drawn, PAGE)).toBeCloseTo(36.87, 2)
  })

  it('falls through a zone with a degenerate direction instead of blocking', () => {
    const dead = zone('dead', [rect(0.1, 0.1, 0.4, 0.4)], [
      { x: 0.2, y: 0.2 },
      { x: 0.2, y: 0.2 },
    ])
    const r = resolvePatternDirection({ x: 0.2, y: 0.2 }, {
      page: PAGE,
      zones: [dead],
      pageDirection: EAST,
    })
    expect(r?.source).toBe('page')
    expect(r?.candidateZoneIds).toEqual(['dead'])
  })

  it('reports overlapping candidates on the resolution itself', () => {
    const outer = zone('outer', [rect(0.0, 0.0, 1.0, 1.0)], EAST)
    const inner = zone('inner', [rect(0.4, 0.4, 0.6, 0.6)], SOUTH)
    const r = resolvePatternDirection({ x: 0.5, y: 0.5 }, { page: PAGE, zones: [outer, inner] })
    expect(r?.zoneId).toBe('inner')
    expect(r?.candidateZoneIds).toEqual(['inner', 'outer'])
  })

  it('gives a unit vector in PDF points on the target page', () => {
    const r = resolvePatternDirection({ x: 0.5, y: 0.5 }, { page: PAGE, pageDirection: SOUTH })
    expect(r?.unit).toEqual({ x: 0, y: 1 })
    expect(Math.hypot(r!.unit.x, r!.unit.y)).toBeCloseTo(1, 15)
  })
})

describe('directionGroupKey', () => {
  it('keeps every page/scope-default area in its own layout group', () => {
    const r = resolvePatternDirection({ x: 0.5, y: 0.5 }, { page: PAGE, pageDirection: EAST })!
    expect(directionGroupKey(r, 'areaA')).not.toBe(directionGroupKey(r, 'areaB'))
    expect(directionGroupKey(r, 'areaA')).toBe('page:area:areaA')
  })

  it('keys a zone by the zone and the area together', () => {
    const zones = [zone('z1', [rect(0, 0, 1, 1)], EAST)]
    const r = resolvePatternDirection({ x: 0.5, y: 0.5 }, { page: PAGE, zones })!
    expect(directionGroupKey(r, 'areaA')).toBe('zone:z1:area:areaA')
  })
})
