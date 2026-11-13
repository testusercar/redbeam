/**
 * Which pieces a device lands in (issue #12), on shapes worked out on paper.
 *
 * Same scheme as runs.validation.test.ts: 0.1 ft per point, so ten points is a
 * foot, and a 20ft x 10ft ceiling sits 100pt in and 200pt down the page. Every
 * area starts its pattern at its top-left corner, so the first panel's corner
 * and the first plank's edge are on the ceiling's corner and the arithmetic
 * below holds.
 */
import { describe, expect, it } from 'vitest'
import { calculatePieces } from './takeoff.js'
import {
  DEVICE_SPEC_KEY, deviceLocations, factoryCutCount, factoryCutPieces, isDeviceScope,
  type DeviceLocation,
} from './devices.js'
import type { Markup, Scope } from './scope.js'

const cal = { feetPerPoint: 0.1, pageWidth: 612, pageHeight: 792 }
const box = { width: 612, height: 792 }
const PAGE = 'd-p0'

/** A point `xFt`, `yFt` from the ceiling's top-left corner, normalized. */
const at = (xFt: number, yFt: number) => ({ x: (100 + xFt * 10) / 612, y: (200 + yFt * 10) / 792 })

const ceiling = (wFt: number, hFt: number): Markup => ({
  id: 'area', scopeId: 's', documentId: 'd', pageId: PAGE, kind: 'area',
  rings: [[at(0, 0), at(wFt, 0), at(wFt, hFt), at(0, hFt)]],
})

/** A device placed `xFt`, `yFt` from the ceiling's corner, already in points. */
const device = (xFt: number, yFt: number, pageId = PAGE): DeviceLocation => ({
  markupId: `d-${xFt}-${yFt}`, scopeId: 'lights', pageId,
  point: { x: 100 + xFt * 10, y: 200 + yFt * 10 },
})

function layout(specs: Record<string, string>) {
  const r = calculatePieces(
    { id: 's', label: 'S', scopeType: 'area', color: '#000', specifications: specs },
    [ceiling(20, 10)],
    cal,
    {
      scopeDirection: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
      pageSize: box,
      defaultPatternCorner: 'top-left',
      calibrations: new Map([[PAGE, cal]]),
      pageSizes: new Map([[PAGE, box]]),
    } as never,
  )
  expect(r.blockers, 'blocked, so nothing below would mean anything').toEqual([])
  return r
}

/** 2ft x 2ft panels: a 20 x 10 ceiling is a 10 x 5 grid, 50 whole panels. */
const PANELS = {
  productType: 'panels', panelWidth: '2', panelWidthUnit: 'ft', panelLength: '2', panelLengthUnit: 'ft',
}

/** 4in planks with a 2in reveal: 6in on centre, so 0-4in is plank and 4-6in is gap. */
const PLANKS = {
  productType: 'planks', plankWidth: '4', plankWidthUnit: 'in', revealSpacing: '2', revealSpacingUnit: 'in',
  stockLength: '12', stockLengthUnit: 'ft', yieldGranularity: 'full',
}

describe('isDeviceScope', () => {
  const scope = (scopeType: Scope['scopeType'], specs: Record<string, unknown>) =>
    ({ scopeType, specifications: specs })

  it('is a count scope with device set', () => {
    expect(isDeviceScope(scope('count', { [DEVICE_SPEC_KEY]: 'true' }))).toBe(true)
    expect(isDeviceScope(scope('count', { [DEVICE_SPEC_KEY]: true }))).toBe(true)
  })

  it('is not a count scope without it, or any other scope with it', () => {
    expect(isDeviceScope(scope('count', {}))).toBe(false)
    expect(isDeviceScope(scope('count', { [DEVICE_SPEC_KEY]: 'false' }))).toBe(false)
    // An area scope cannot be a device: its markups are ceilings, not points.
    expect(isDeviceScope(scope('area', { [DEVICE_SPEC_KEY]: 'true' }))).toBe(false)
  })
})

describe('deviceLocations', () => {
  const lights: Scope = {
    id: 'lights', label: 'Downlights', scopeType: 'count', color: '#f00',
    specifications: { productType: 'custom_assembly', [DEVICE_SPEC_KEY]: 'true' },
  }
  const exits: Scope = { ...lights, id: 'exits', label: 'Exit signs', specifications: { productType: 'custom_assembly' } }
  const count = (id: string, scopeId: string, pageId = PAGE): Markup => ({
    id, scopeId, documentId: 'd', pageId, kind: 'count', rings: [[{ x: 0.5, y: 0.25 }]],
  })

  it('places each count of a device scope in points on its page', () => {
    const got = deviceLocations([count('a', 'lights')], [lights], () => box)
    expect(got).toEqual([{ markupId: 'a', scopeId: 'lights', pageId: PAGE, point: { x: 306, y: 198 } }])
  })

  it('leaves out counts that are not devices, archived scopes and unknown pages', () => {
    const archived = { ...lights, id: 'old', archivedAt: '2026-11-01' }
    const got = deviceLocations(
      [count('a', 'exits'), count('b', 'old'), count('c', 'lights', 'elsewhere'), count('d', 'lights')],
      [lights, exits, archived],
      (pageId) => (pageId === PAGE ? box : null),
    )
    expect(got.map((d) => d.markupId)).toEqual(['d'])
  })
})

describe('factoryCutPieces, panels', () => {
  const r = layout(PANELS)

  it('lays out the 50 panels this arithmetic assumes', () => {
    expect(r.cells).toHaveLength(50)
  })

  it('marks the one panel a device sits in', () => {
    const cut = factoryCutPieces(r, [device(1, 1)])
    expect(factoryCutCount(cut)).toBe(1)
  })

  it('marks both panels when a device sits on the seam between them', () => {
    expect(factoryCutCount(factoryCutPieces(r, [device(2, 1)]))).toBe(2)
  })

  it('marks all four panels when a device sits where four meet', () => {
    expect(factoryCutCount(factoryCutPieces(r, [device(2, 2)]))).toBe(4)
  })

  it('counts a panel once however many devices are in it', () => {
    expect(factoryCutCount(factoryCutPieces(r, [device(0.5, 0.5), device(1.5, 1.5)]))).toBe(1)
  })

  it('marks nothing for a device outside the ceiling or on another sheet', () => {
    expect(factoryCutCount(factoryCutPieces(r, [device(25, 5), device(1, 1, 'd-p1')]))).toBe(0)
  })
})

describe('factoryCutPieces, planks', () => {
  const r = layout(PLANKS)

  it('marks the plank a device sits on', () => {
    // Runs go along the 20ft side; the first plank is 0 to 4in down.
    const cut = factoryCutPieces(r, [device(3, 2 / 12)])
    expect(factoryCutCount(cut)).toBe(1)
    expect(cut.missed).toEqual([])
  })

  it('marks nothing, and says so, for a device in the reveal between planks', () => {
    const d = device(3, 5 / 12)
    const cut = factoryCutPieces(r, [d])
    expect(factoryCutCount(cut)).toBe(0)
    expect(cut.missed).toEqual([d])
  })

  it('cannot test a run product with no face width, and says why', () => {
    const { componentWidthFeet: _, ...noWidth } = r
    const cut = factoryCutPieces(noWidth, [device(3, 2 / 12)])
    expect(factoryCutCount(cut)).toBe(0)
    expect(cut.blockers).toHaveLength(1)
  })
})
