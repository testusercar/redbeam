import { describe, it, expect } from 'vitest'
import {
  areaSquareFeet, perimeterFeet, linearFeet, countEach,
  calculateScopeQuantities, calibrationFromReference,
  markupCountsInScope, scopeToolWarning, countableKinds, TAKEOFF_KINDS,
  type Calibration, type Markup, type Scope,
} from './scope.js'

// 1 pt = 1 ft, page 1000x1000 pt, so normalized 0.1 == 100 pt == 100 ft.
const cal: Calibration = { feetPerPoint: 1, pageWidth: 1000, pageHeight: 1000 }

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
]

const mk = (
  kind: Markup['kind'],
  ring: Array<{ x: number; y: number }>,
  scopeId = 's1',
  pageId = 'p',
): Markup => ({
  id: `m${Math.random()}`, scopeId, documentId: 'd', pageId, kind, rings: [ring],
})

describe('areaSquareFeet', () => {
  it('measures a plain area markup', () => {
    // 0.2 x 0.2 of a 1000pt page = 200 x 200 pt = 40,000 sq ft at 1ft/pt
    expect(areaSquareFeet([mk('area', rect(0.1, 0.1, 0.2, 0.2))], cal)).toBeCloseTo(40000, 6)
  })

  it('subtracts a cutout that lies inside the area', () => {
    const markups = [
      mk('area', rect(0.1, 0.1, 0.2, 0.2)),      // 40,000
      mk('cutout', rect(0.15, 0.15, 0.05, 0.05)), // 2,500
    ]
    expect(areaSquareFeet(markups, cal)).toBeCloseTo(37500, 6)
  })

  it('IGNORES a cutout drawn outside every area — it must not add material', () => {
    // Regression: ring-based nesting puts a stray cutout at depth 0, which
    // regionArea() would count as material. The Qt build could not hit this
    // because it subtracted into a path.
    const markups = [
      mk('area', rect(0.1, 0.1, 0.2, 0.2)),        // 40,000
      mk('cutout', rect(0.7, 0.7, 0.1, 0.1)),      // far away — must be ignored
    ]
    expect(areaSquareFeet(markups, cal)).toBeCloseTo(40000, 6)
  })

  it('returns zero when there are only cutouts and no area', () => {
    expect(areaSquareFeet([mk('cutout', rect(0.1, 0.1, 0.2, 0.2))], cal)).toBe(0)
  })

  it('sums two disjoint area markups', () => {
    const markups = [
      mk('area', rect(0.1, 0.1, 0.1, 0.1)),   // 10,000
      mk('area', rect(0.5, 0.5, 0.1, 0.1)),   // 10,000
    ]
    expect(areaSquareFeet(markups, cal)).toBeCloseTo(20000, 6)
  })

  it('applies a cutout to whichever area contains it', () => {
    const markups = [
      mk('area', rect(0.1, 0.1, 0.1, 0.1)),      // 10,000
      mk('area', rect(0.5, 0.5, 0.2, 0.2)),      // 40,000
      mk('cutout', rect(0.55, 0.55, 0.1, 0.1)),  // 10,000, inside the second
    ]
    expect(areaSquareFeet(markups, cal)).toBeCloseTo(40000, 6)
  })

  it('ignores polyline and count markups', () => {
    const markups = [
      mk('area', rect(0.1, 0.1, 0.1, 0.1)),
      mk('polyline', [{ x: 0, y: 0 }, { x: 0.5, y: 0 }]),
      mk('count', [{ x: 0.3, y: 0.3 }]),
    ]
    expect(areaSquareFeet(markups, cal)).toBeCloseTo(10000, 6)
  })

  it('does NOT let a cutout on another sheet punch a hole', () => {
    // The Qt basis is "union of areas minus intersecting cutouts PER PAGE".
    // Normalized coordinates make cross-sheet overlap likely rather than rare,
    // since every sheet spans the same 0..1 box — and nothing on screen would
    // reveal it, because the offending markup is on a page the estimator is
    // not looking at. Measured on the real Turkish Airlines fixture, an
    // unrelated-page cutout removed 226 of 4,128 SF before this was fixed.
    const markups = [
      mk('area', rect(0.1, 0.1, 0.2, 0.2), 's1', 'page-1'),      // 40,000
      mk('cutout', rect(0.15, 0.15, 0.05, 0.05), 's1', 'page-2'), // other sheet
    ]
    expect(areaSquareFeet(markups, cal)).toBeCloseTo(40000, 6)
  })

  it('still subtracts a cutout on the SAME sheet', () => {
    const markups = [
      mk('area', rect(0.1, 0.1, 0.2, 0.2), 's1', 'page-1'),
      mk('cutout', rect(0.15, 0.15, 0.05, 0.05), 's1', 'page-1'),
    ]
    expect(areaSquareFeet(markups, cal)).toBeCloseTo(37500, 6)
  })

  it('sums pages rather than treating them as one plane', () => {
    const markups = [
      mk('area', rect(0.1, 0.1, 0.1, 0.1), 's1', 'page-1'),  // 10,000
      mk('area', rect(0.1, 0.1, 0.1, 0.1), 's1', 'page-2'),  // 10,000, identical box
    ]
    // Coplanar, these two identical rings would union to 10,000. On separate
    // sheets they are 20,000 of material.
    expect(areaSquareFeet(markups, cal)).toBeCloseTo(20000, 6)
  })

  it('scales with calibration', () => {
    const half: Calibration = { ...cal, feetPerPoint: 0.5 }
    // area scales with the SQUARE of the scale factor
    expect(areaSquareFeet([mk('area', rect(0.1, 0.1, 0.2, 0.2))], half)).toBeCloseTo(10000, 6)
  })
})

describe('perimeterFeet / linearFeet / countEach', () => {
  it('measures perimeter of area markups only', () => {
    const markups = [
      mk('area', rect(0.1, 0.1, 0.2, 0.2)),         // 4 x 200pt = 800
      mk('cutout', rect(0.15, 0.15, 0.05, 0.05)),   // not counted
    ]
    expect(perimeterFeet(markups, cal)).toBeCloseTo(800, 6)
  })

  it('measures polyline length', () => {
    const m = mk('polyline', [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 0.4 }])
    expect(linearFeet([m], cal)).toBeCloseTo(300 + 400, 6)
  })

  it('counts count markups', () => {
    expect(countEach([mk('count', [{ x: 0.1, y: 0.1 }]), mk('count', [{ x: 0.2, y: 0.2 }])])).toBe(2)
  })
})

describe('calculateScopeQuantities', () => {
  const areaScope: Scope = { id: 's1', label: 'A', scopeType: 'area', color: '#000', specifications: {} }

  it('only counts markups belonging to the scope', () => {
    const markups = [
      mk('area', rect(0.1, 0.1, 0.1, 0.1), 's1'),
      mk('area', rect(0.5, 0.5, 0.1, 0.1), 's2'),   // different scope
    ]
    const rows = calculateScopeQuantities(areaScope, markups, cal)
    expect(rows.find((r) => r.itemKey === 'area_sf')!.quantity).toBeCloseTo(10000, 6)
  })

  it('emits the unit set matching the scope type', () => {
    const linear: Scope = { ...areaScope, scopeType: 'linear' }
    const count: Scope = { ...areaScope, scopeType: 'count' }
    expect(calculateScopeQuantities(areaScope, [], cal).map((r) => r.unit)).toEqual(['SF', 'LF'])
    expect(calculateScopeQuantities(linear, [], cal).map((r) => r.unit)).toEqual(['LF'])
    expect(calculateScopeQuantities(count, [], cal).map((r) => r.unit)).toEqual(['EA'])
  })
})

describe('calibrationFromReference', () => {
  it('derives feet per point', () => {
    // a 100pt line declared to be 50 ft
    const c = calibrationFromReference(100, 50, 'ft', 1000, 800)
    expect(c!.feetPerPoint).toBeCloseTo(0.5, 12)
    expect(c!.pageWidth).toBe(1000)
  })

  it('handles inches', () => {
    // 100pt declared as 600 in = 50 ft
    expect(calibrationFromReference(100, 600, 'in', 1000, 800)!.feetPerPoint).toBeCloseTo(0.5, 12)
  })

  it('rejects a bad unit or a zero-length reference', () => {
    expect(calibrationFromReference(100, 50, 'furlong', 1000, 800)).toBeNull()
    expect(calibrationFromReference(0, 50, 'ft', 1000, 800)).toBeNull()
    expect(calibrationFromReference(-5, 50, 'ft', 1000, 800)).toBeNull()
  })
})

describe('scope / tool guard', () => {
  const s = (scopeType: Scope['scopeType'], label = 'CL03'): Scope =>
    ({ id: 'x', label, scopeType, color: '#000', specifications: {} })

  it('knows which kinds count in each scope type', () => {
    expect(markupCountsInScope('area', 'area')).toBe(true)
    expect(markupCountsInScope('area', 'cutout')).toBe(true)
    expect(markupCountsInScope('area', 'polyline')).toBe(false)
    expect(markupCountsInScope('linear', 'polyline')).toBe(true)
    expect(markupCountsInScope('linear', 'area')).toBe(false)
    expect(markupCountsInScope('count', 'count')).toBe(true)
    expect(markupCountsInScope('count', 'area')).toBe(false)
  })

  it('warns about the pairing that silently produces nothing', () => {
    // The whole point: a polyline in an area scope draws on screen, survives a
    // save, and contributes to no row. It looks counted and is not.
    const w = scopeToolWarning(s('area'), 'polyline')
    expect(w).toContain('CL03')
    expect(w).toContain('will not appear in any quantity')
    expect(w).toContain('is an area scope')
    expect(scopeToolWarning(s('count'), 'area')).toContain('is a count scope')
  })

  it('stays quiet when the pairing is right', () => {
    expect(scopeToolWarning(s('area'), 'area')).toBeNull()
    expect(scopeToolWarning(s('area'), 'cutout')).toBeNull()
    expect(scopeToolWarning(s('linear'), 'polyline')).toBeNull()
    expect(scopeToolWarning(s('count'), 'count')).toBeNull()
  })

  it('never warns about an annotation or a calibration', () => {
    // A shape, dimension, callout or highlight is annotation by design, not a
    // mis-click; a calibration is not takeoff geometry at all. Warning about
    // any of them would train people to dismiss the warning that matters.
    const quiet = ['shape', 'calibration', 'dimension', 'callout', 'highlight'] as const
    for (const t of ['area', 'linear', 'count'] as const) {
      for (const k of quiet) expect(scopeToolWarning(s(t), k), `${k} in ${t}`).toBeNull()
    }
  })

  it('the quiet kinds are exactly the ones outside TAKEOFF_KINDS', () => {
    // Pins the two lists together: adding a kind without deciding which side
    // it falls on will fail here rather than silently warning or silently not.
    const all: Array<Markup['kind']> = [
      'area', 'cutout', 'polyline', 'count', 'shape', 'calibration',
      'dimension', 'callout', 'highlight',
    ]
    for (const k of all) {
      const warns = all.some(() => false) || scopeToolWarning(s('area'), k) !== null
      expect(warns, k).toBe(TAKEOFF_KINDS.includes(k) && !markupCountsInScope('area', k))
    }
  })

  it('lists countable kinds for the tool UI, excluding shape', () => {
    expect(countableKinds('area')).toEqual(['area', 'cutout'])
    expect(countableKinds('linear')).toEqual(['polyline'])
    expect(countableKinds('count')).toEqual(['count'])
    for (const t of ['area', 'linear', 'count'] as const) {
      expect(countableKinds(t)).not.toContain('shape')
    }
  })

  it('agrees with what calculateScopeQuantities actually counts', () => {
    // Guard against the two drifting apart: if a kind is reported countable it
    // must actually move a number, and if it is not it must not.
    const ring = rect(0.1, 0.1, 0.2, 0.2)
    for (const t of ['area', 'linear', 'count'] as const) {
      for (const k of ['area', 'polyline', 'count'] as const) {
        const rows = calculateScopeQuantities(s(t), [mk(k, ring, 'x')], cal)
        const moved = rows.some((r) => r.quantity > 0)
        expect(moved, `${k} in a ${t} scope`).toBe(markupCountsInScope(t, k))
      }
    }
  })
})

describe('shape markups never reach a quantity', () => {
  // A shape is annotation. If it ever counts as area, a cloud drawn around a
  // question on a drawing silently inflates the bid.
  it('is excluded from area, perimeter, length and count', () => {
    const markups = [
      mk('area', rect(0.1, 0.1, 0.1, 0.1)),
      mk('shape', rect(0.5, 0.5, 0.2, 0.2)),
    ]
    expect(areaSquareFeet(markups, cal)).toBeCloseTo(10000, 6)
    expect(perimeterFeet(markups, cal)).toBeCloseTo(400, 6)
    expect(linearFeet(markups, cal)).toBe(0)
    expect(countEach(markups)).toBe(0)
  })

  it('cannot act as a cutout', () => {
    // Overlapping an area with a shape must not subtract from it.
    const markups = [
      mk('area', rect(0.1, 0.1, 0.2, 0.2)),
      mk('shape', rect(0.15, 0.15, 0.05, 0.05)),
    ]
    expect(areaSquareFeet(markups, cal)).toBeCloseTo(40000, 6)
  })
})
