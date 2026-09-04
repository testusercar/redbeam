/**
 * Every number below is derived by hand, on the same 612x792 page, so a wrong
 * grouping shows up as an arithmetic disagreement rather than as a plausible
 * total nobody can check.
 */
import { describe, expect, it } from 'vitest'
import { bucketByScale, totalsByRegion } from './scopeByRegion.js'
import type { ScaleRegion } from './scaleRegion.js'
import type { Markup } from './scope.js'

const PAGE = { width: 612, height: 792 }
const size = () => PAGE

/** A square of `frac` of the page, with its lower-left at (ox, oy). */
const square = (
  id: string, ox: number, oy: number, frac: number,
  kind: Markup['kind'] = 'area', pageId = 'd-p0',
): Markup => ({
  id, scopeId: 's', documentId: 'd', pageId, kind,
  rings: [[
    { x: ox, y: oy }, { x: ox + frac, y: oy },
    { x: ox + frac, y: oy + frac }, { x: ox, y: oy + frac },
  ]],
})

const region = (
  id: string, r: [number, number, number, number], feetPerPoint: number,
): ScaleRegion => ({
  id, pageId: 'd-p0', label: id, feetPerPoint,
  rect: { x0: r[0], y0: r[1], x1: r[2], y1: r[3] },
})

/** Left half at 0.25 ft/pt, right half at 0.5 — two details, two scales. */
const TWO_DETAILS = new Map([['d-p0', [
  region('left', [0, 0, 0.5, 1], 0.25),
  region('right', [0.5, 0, 1, 1], 0.5),
]]])

describe('bucketByScale', () => {
  it('separates markups that sit in different details', () => {
    const b = bucketByScale(
      [square('a', 0.1, 0.1, 0.2), square('b', 0.6, 0.1, 0.2)], TWO_DETAILS, () => null,
    )
    expect(b).toHaveLength(2)
    expect(b.map((x) => x.regionId).sort()).toEqual(['left', 'right'])
  })

  it('keeps markups in the same detail together', () => {
    // So their cutouts can subtract from each other.
    const b = bucketByScale(
      [square('a', 0.05, 0.1, 0.15), square('b', 0.3, 0.1, 0.15)], TWO_DETAILS, () => null,
    )
    expect(b).toHaveLength(1)
    expect(b[0]!.markups).toHaveLength(2)
  })

  it('buckets by page as well, since a scope crosses sheets', () => {
    const b = bucketByScale(
      [square('a', 0.1, 0.1, 0.2), square('b', 0.1, 0.1, 0.2, 'area', 'd-p1')],
      new Map(), () => 0.1,
    )
    expect(b).toHaveLength(2)
  })

  it('is ordered reproducibly', () => {
    // A roll-up must produce the same number in the same order every time the
    // project is opened.
    const ms = [square('b', 0.6, 0.1, 0.2), square('a', 0.1, 0.1, 0.2)]
    const first = bucketByScale(ms, TWO_DETAILS, () => null).map((x) => x.regionId)
    const again = bucketByScale([...ms].reverse(), TWO_DETAILS, () => null).map((x) => x.regionId)
    expect(first).toEqual(again)
  })

  it('records a markup that crosses a scale boundary', () => {
    const b = bucketByScale([square('straddle', 0.4, 0.4, 0.2)], TWO_DETAILS, () => null)
    expect(b[0]!.straddling).toEqual(['straddle'])
  })
})

describe('totalsByRegion', () => {
  it('measures each detail at its own scale', () => {
    /*
     * Two identical squares, 0.2 of the page each, one in each detail.
     *
     *   0.2 x 612 = 122.4 pt wide, 0.2 x 792 = 158.4 pt tall
     *   left  at 0.25  ft/pt: 30.6 x 39.6 ft = 1211.76 SF
     *   right at 0.5   ft/pt: 61.2 x 79.2 ft = 4847.04 SF
     *   total                                = 6058.8  SF
     *
     * A single page scale of 0.25 would give 2423.52, and of 0.5 would give
     * 9694.08. Neither is close, so the test cannot pass by accident.
     */
    const t = totalsByRegion(
      [square('a', 0.1, 0.1, 0.2), square('b', 0.6, 0.1, 0.2)],
      TWO_DETAILS, () => null, size,
    )
    expect(t.areaSquareFeet).toBeCloseTo(6058.8, 2)
  })

  it('subtracts a cutout from the detail it was drawn in', () => {
    // The reason markups are grouped by region rather than measured alone.
    // The hole is a quarter of the square's side, so a sixteenth of its area:
    // 1211.76 - 1211.76/16 = 1136.025.
    const t = totalsByRegion(
      [square('a', 0.1, 0.1, 0.2), square('hole', 0.15, 0.15, 0.05, 'cutout')],
      TWO_DETAILS, () => null, size,
    )
    expect(t.areaSquareFeet).toBeCloseTo(1136.025, 2)
  })

  it('falls back to the page scale outside every region', () => {
    // 0.2 of the page at 0.1 ft/pt: 12.24 x 15.84 = 193.8816 SF.
    const t = totalsByRegion([square('a', 0.1, 0.1, 0.2)], new Map(), () => 0.1, size)
    expect(t.areaSquareFeet).toBeCloseTo(193.8816, 3)
  })

  it('measures nothing it has no scale for, and says which', () => {
    // The rule that governs the whole feature. NOT the nearest region, not
    // zero-as-a-number: excluded from the total and named.
    const t = totalsByRegion(
      [square('inside', 0.1, 0.1, 0.2), square('outside', 0.6, 0.1, 0.2)],
      new Map([['d-p0', [region('left', [0, 0, 0.5, 1], 0.25)]]]),
      () => null, size,
    )
    expect(t.areaSquareFeet).toBeCloseTo(1211.76, 2)
    expect(t.unscaled).toEqual(['outside'])
  })

  it('reports a straddling markup while still returning a number', () => {
    // It has to produce something — refusing the whole roll-up over one
    // ambiguous markup would be worse — but it must not do so silently.
    const t = totalsByRegion([square('s', 0.4, 0.4, 0.2)], TWO_DETAILS, () => null, size)
    expect(t.straddling).toEqual(['s'])
    expect(t.areaSquareFeet).toBeGreaterThan(0)
  })

  it('adds up across sheets as well as details', () => {
    // Same square on two pages at the same scale: exactly twice.
    const one = totalsByRegion([square('a', 0.1, 0.1, 0.2)], new Map(), () => 0.1, size)
    const two = totalsByRegion(
      [square('a', 0.1, 0.1, 0.2), square('b', 0.1, 0.1, 0.2, 'area', 'd-p1')],
      new Map(), () => 0.1, size,
    )
    expect(two.areaSquareFeet).toBeCloseTo(one.areaSquareFeet * 2, 6)
  })

  it('cannot measure a page whose box is unknown', () => {
    // Normalized geometry means nothing without the box it was normalized
    // against, so this is unscaled rather than zero.
    const t = totalsByRegion([square('a', 0.1, 0.1, 0.2)], new Map(), () => 0.1, () => null)
    expect(t.areaSquareFeet).toBe(0)
    expect(t.unscaled).toEqual(['a'])
  })

  it('measures a run at its detail scale too', () => {
    // 0.2 of the width then 0.2 of the height, at 0.5 ft/pt:
    // 122.4 pt + 158.4 pt = 280.8 pt = 140.4 ft.
    const run: Markup = {
      id: 'r', scopeId: 's', documentId: 'd', pageId: 'd-p0', kind: 'polyline',
      rings: [[{ x: 0.6, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.8, y: 0.3 }]],
    }
    expect(totalsByRegion([run], TWO_DETAILS, () => null, size).linearFeet)
      .toBeCloseTo(140.4, 2)
  })
})
