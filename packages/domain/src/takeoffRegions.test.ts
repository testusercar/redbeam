/**
 * Piece LAYOUT at a region's scale, not the sheet's (plan 14.2, second half).
 *
 * Areas became region-aware before layout did, which left the two disagreeing
 * on a sheet carrying more than one scale: the quantity said one thing and the
 * piece count another, both confidently, and nothing on screen said which to
 * believe. This is the case that closes it.
 *
 * Every number below is derived by hand on a 612x792 page.
 */
import { describe, expect, it } from 'vitest'
import { calculatePieces } from './takeoff.js'
import type { ScaleRegion } from './scaleRegion.js'

/** 0.1 ft per point: ten points is a foot and the arithmetic stays legible. */
const cal = { feetPerPoint: 0.1, pageWidth: 612, pageHeight: 792 } as never
const box = { width: 612, height: 792 }

/** A `wFt` x `hFt` rectangle with its top-left at (`nx`, `ny`) normalized. */
const rect = (id: string, nx: number, ny: number, wFt: number, hFt: number) => {
  const x0 = nx
  const x1 = nx + (wFt * 10) / 612
  const y0 = ny
  const y1 = ny + (hFt * 10) / 792
  return {
    id, scopeId: 's', documentId: 'd', pageId: 'd-p0', kind: 'area',
    rings: [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]],
  } as never
}

const region = (
  id: string, r: [number, number, number, number], feetPerPoint: number,
): ScaleRegion => ({
  id, pageId: 'd-p0', label: id, feetPerPoint,
  rect: { x0: r[0], y0: r[1], x1: r[2], y1: r[3] },
})

/** 6in planks on 6in centres, 12ft stock, no offcut reuse. */
const PLANK = {
  productType: 'planks', plankWidth: '6', plankWidthUnit: 'in',
  stockLength: '12', stockLengthUnit: 'ft', yieldGranularity: 'full',
}

const ALONG_X = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]

function pieces(markups: unknown[], regions?: ScaleRegion[]) {
  const r = calculatePieces(
    { id: 's', label: 'S', scopeType: 'area', color: '#000', specifications: PLANK } as never,
    markups as never, cal,
    {
      scopeDirection: ALONG_X, pageSize: box,
      calibrations: new Map([['d-p0', cal]]),
      pageSizes: new Map([['d-p0', box]]),
      ...(regions === undefined ? {} : { scaleRegions: new Map([['d-p0', regions]]) }),
    } as never,
  )
  expect(r.blockers, 'blocked, so nothing below would mean anything').toEqual([])
  return Object.fromEntries(r.quantities.map((q) => [q.itemKey, q.quantity])) as
    Record<string, number | undefined>
}

describe('layout at a region scale', () => {
  it('is unchanged when the sheet has no regions', () => {
    // 20ft x 10ft at 0.1 ft/pt: 20 runs of 20ft, two 12ft stocks each.
    expect(pieces([rect('a', 0.1, 0.1, 20, 10)])).toMatchObject({
      net_linear: 400, primary_stock: 40,
    })
  })

  it('measures a markup at its region scale, not the page scale', () => {
    /*
     * The same rectangle, inside a region at DOUBLE the page scale.
     *
     * Its extent in points is unchanged, so at 0.2 ft/pt it is 40ft x 20ft:
     *   runs   = 20ft / 0.5ft          = 40
     *   length = 40 runs x 40ft        = 1600 LF   (four times, as area does)
     *   pieces = 40 runs x ceil(40/12) = 160
     */
    const twice = [region('detail', [0, 0, 1, 1], 0.2)]
    expect(pieces([rect('a', 0.1, 0.1, 20, 10)], twice)).toMatchObject({
      net_linear: 1600, primary_stock: 160,
    })
  })

  it('falls back to the page scale outside every region', () => {
    // The region covers only the top-left corner; the markup is elsewhere.
    const corner = [region('detail', [0, 0, 0.05, 0.05], 0.2)]
    expect(pieces([rect('a', 0.3, 0.3, 20, 10)], corner)).toMatchObject({
      net_linear: 400, primary_stock: 40,
    })
  })

  it('lays two details out separately, each at its own scale', () => {
    /*
     * The case the feature exists for. Two identical rectangles, one in a
     * region at 0.1 and one at 0.2:
     *   left  20ft x 10ft  ->  400 LF
     *   right 40ft x 20ft  -> 1600 LF
     *   total              -> 2000 LF
     *
     * One shared page scale would give 800. Nothing here can pass by accident.
     */
    const two = [
      region('left', [0, 0, 0.5, 1], 0.1),
      region('right', [0.5, 0, 1, 1], 0.2),
    ]
    expect(pieces([
      rect('a', 0.05, 0.1, 20, 10),
      rect('b', 0.55, 0.1, 20, 10),
    ], two).net_linear).toBeCloseTo(2000, 6)
  })

  it('keeps a cutout with the area it opens', () => {
    /*
     * A hole is measured in its OWNER's space. Resolving it on its own would
     * let a cutout whose centroid strayed over a boundary punch a hole of the
     * wrong size, or none at all.
     *
     * 20x10 with a 10x5 hole at the page scale is 300 LF (validated in
     * runs.validation.test.ts). Inside a region at 0.2 it is exactly four
     * times the area, so 1200 LF.
     */
    const twice = [region('detail', [0, 0, 1, 1], 0.2)]
    const hole = {
      id: 'c', scopeId: 's', documentId: 'd', pageId: 'd-p0', kind: 'cutout',
      rings: [[
        { x: 0.15, y: 0.15 }, { x: 0.15 + 100 / 612, y: 0.15 },
        { x: 0.15 + 100 / 612, y: 0.15 + 50 / 792 }, { x: 0.15, y: 0.15 + 50 / 792 },
      ]],
    }
    const got = pieces([rect('a', 0.1, 0.1, 20, 10), hole], twice)
    expect(got.net_linear).toBeCloseTo(1200, 6)
  })
})

describe('panels across two regions', () => {
  /*
   * Panels share a SHEET-WIDE grid origin by default — `perAreaOrigin` is off,
   * because that is what the Qt build does and what the golden fixtures
   * capture. On a sheet carrying two scales that origin is computed in one
   * region's space and applied in the other's, so this asks whether a detail
   * is counted the same beside another detail as it is alone.
   */
  const PANELS = {
    productType: 'panels',
    panelWidth: '2', panelWidthUnit: 'ft',
    panelLength: '4', panelLengthUnit: 'ft',
    panelGranularity: 'full',
  }

  const count = (markups: unknown[], regions?: ScaleRegion[]) => {
    const r = calculatePieces(
      { id: 's', label: 'S', scopeType: 'area', color: '#000', specifications: PANELS } as never,
      markups as never, cal,
      {
        scopeDirection: ALONG_X, pageSize: box,
        calibrations: new Map([['d-p0', cal]]),
        pageSizes: new Map([['d-p0', box]]),
        ...(regions === undefined ? {} : { scaleRegions: new Map([['d-p0', regions]]) }),
      } as never,
    )
    expect(r.blockers).toEqual([])
    return r.quantities.find((q) => q.itemKey === 'panel_count')?.quantity ?? 0
  }

  const TWO = [
    region('left', [0, 0, 0.5, 1], 0.1),
    region('right', [0.5, 0, 1, 1], 0.2),
  ]

  it('counts a detail the same beside another detail as it does alone', () => {
    // If the sheet-wide origin leaked across the scale boundary, the second
    // detail would be laid out on a grid phased for the first one's scale and
    // its count would move.
    const alone = count([rect('b', 0.55, 0.1, 20, 10)], [TWO[1]!])
    const together = count([rect('a', 0.05, 0.1, 20, 10), rect('b', 0.55, 0.1, 20, 10)], TWO)
      - count([rect('a', 0.05, 0.1, 20, 10)], [TWO[0]!])
    expect(together).toBe(alone)
  })
})
