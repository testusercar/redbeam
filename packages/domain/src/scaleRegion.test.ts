/**
 * The rule under test throughout: a scale is never invented. Every case that
 * could plausibly be resolved by borrowing a nearby number resolves to null
 * instead, because an uncalibrated markup that blocks is recoverable and one
 * that quietly measures at the wrong scale is not.
 */
import { describe, expect, it } from 'vitest'
import {
  conflictingRegions, rectContains, resolveScaleForRings, scaleAt,
  type ScaleRegion,
} from './scaleRegion.js'

const region = (
  id: string, rect: [number, number, number, number], feetPerPoint: number,
): ScaleRegion => ({
  id, pageId: 'd-p0', label: id, feetPerPoint,
  rect: { x0: rect[0], y0: rect[1], x1: rect[2], y1: rect[3] },
})

/** Four details on one sheet, in the four quadrants, at four scales. */
const DETAIL_SHEET: ScaleRegion[] = [
  region('tl', [0, 0, 0.5, 0.5], 0.25),
  region('tr', [0.5, 0, 1, 0.5], 0.125),
  region('bl', [0, 0.5, 0.5, 1], 0.0625),
  region('br', [0.5, 0.5, 1, 1], 0.03125),
]

const ringAt = (cx: number, cy: number, r = 0.05) => [[
  { x: cx - r, y: cy - r }, { x: cx + r, y: cy - r },
  { x: cx + r, y: cy + r }, { x: cx - r, y: cy + r },
]]

describe('rectContains', () => {
  it('does not care which corners it was given', () => {
    // A region drawn up-and-left is the same region.
    const backwards = { x0: 0.8, y0: 0.8, x1: 0.2, y1: 0.2 }
    expect(rectContains(backwards, { x: 0.5, y: 0.5 })).toBe(true)
  })

  it('includes its own edge', () => {
    // A markup snapped to the boundary of a detail belongs to that detail.
    expect(rectContains({ x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, { x: 0.5, y: 0.25 })).toBe(true)
  })
})

describe('scaleAt', () => {
  it('gives each detail on the sheet its own scale', () => {
    // The whole point of the feature: one sheet, four answers.
    expect(scaleAt({ x: 0.25, y: 0.25 }, DETAIL_SHEET, null)).toBe(0.25)
    expect(scaleAt({ x: 0.75, y: 0.25 }, DETAIL_SHEET, null)).toBe(0.125)
    expect(scaleAt({ x: 0.25, y: 0.75 }, DETAIL_SHEET, null)).toBe(0.0625)
    expect(scaleAt({ x: 0.75, y: 0.75 }, DETAIL_SHEET, null)).toBe(0.03125)
  })

  it('falls through to the page scale outside every region', () => {
    expect(scaleAt({ x: 0.5, y: 0.5 }, [region('a', [0, 0, 0.1, 0.1], 0.25)], 0.111)).toBe(0.111)
  })

  it('resolves to nothing when there is nothing to resolve to', () => {
    // NOT the nearest region, NOT the only region on the page. Null, which
    // means uncalibrated, which must block.
    expect(scaleAt({ x: 0.9, y: 0.9 }, [region('a', [0, 0, 0.1, 0.1], 0.25)], null)).toBeNull()
  })

  it('lets a region inside a region win', () => {
    // A detail within a detail. Smallest-wins is the only rule that makes
    // this predictable rather than a question of which was drawn first.
    const nested = [region('outer', [0, 0, 1, 1], 0.25), region('inner', [0.4, 0.4, 0.6, 0.6], 0.01)]
    expect(scaleAt({ x: 0.5, y: 0.5 }, nested, null)).toBe(0.01)
    expect(scaleAt({ x: 0.1, y: 0.1 }, nested, null)).toBe(0.25)
  })

  it('does not depend on the order rows came back in', () => {
    // Two identical rectangles is a mistake, but it must be a STABLE mistake:
    // a quantity that changes between runs is unexplainable to an estimator.
    const a = [region('a', [0, 0, 1, 1], 0.25), region('b', [0, 0, 1, 1], 0.5)]
    expect(scaleAt({ x: 0.5, y: 0.5 }, a, null))
      .toBe(scaleAt({ x: 0.5, y: 0.5 }, [...a].reverse(), null))
  })
})

describe('resolveScaleForRings', () => {
  it('measures a markup at the scale of the detail it sits in', () => {
    expect(resolveScaleForRings(ringAt(0.75, 0.75), DETAIL_SHEET, null).feetPerPoint)
      .toBe(0.03125)
  })

  it('names the region it used', () => {
    // So the UI can say WHICH scale a number came from, which is the question
    // somebody asks when a quantity looks wrong.
    expect(resolveScaleForRings(ringAt(0.25, 0.25), DETAIL_SHEET, null).regionId).toBe('tl')
  })

  it('says the page supplied it when no region did', () => {
    const r = resolveScaleForRings(ringAt(0.5, 0.5), [], 0.111)
    expect(r.feetPerPoint).toBe(0.111)
    expect(r.regionId).toBeNull()
  })

  it('tolerates a stray vertex outside the region', () => {
    // A region drawn by hand clips the odd corner of a markup that plainly
    // belongs to it. Blocking on that would be maddening in exactly the
    // situation this feature exists for — but the straddle is still reported.
    const one = [region('tl', [0, 0, 0.5, 0.5], 0.25)]
    const r = resolveScaleForRings(ringAt(0.48, 0.25), one, null)
    expect(r.feetPerPoint).toBe(0.25)
    expect(r.warning).not.toBeNull()
  })

  it('warns when a markup straddles two scales', () => {
    // There is no right measurement here: it is measuring two drawings at
    // once, and the number will be wrong however it resolves.
    const r = resolveScaleForRings(ringAt(0.5, 0.25, 0.1), DETAIL_SHEET, null)
    expect(r.warning).toMatch(/crosses a scale boundary/)
  })

  it('does not warn about two regions that agree', () => {
    // Adjacent regions at the same scale are not a conflict, and warning about
    // them would train somebody to ignore the warning that matters.
    const twins = [region('a', [0, 0, 0.5, 1], 0.25), region('b', [0.5, 0, 1, 1], 0.25)]
    expect(resolveScaleForRings(ringAt(0.5, 0.5, 0.2), twins, null).warning).toBeNull()
  })

  it('warns when part of a markup has no scale at all', () => {
    // Half in a detail, half on bare sheet with no page scale. The half
    // outside is not measurable, and pretending otherwise is the failure.
    const one = [region('a', [0, 0, 0.5, 1], 0.25)]
    expect(resolveScaleForRings(ringAt(0.5, 0.5, 0.2), one, null).warning).not.toBeNull()
  })

  it('gives an empty markup the page scale rather than throwing', () => {
    expect(resolveScaleForRings([], DETAIL_SHEET, 0.111).feetPerPoint).toBe(0.111)
  })
})

describe('conflictingRegions', () => {
  it('is quiet about a tidy sheet', () => {
    expect(conflictingRegions(DETAIL_SHEET)).toEqual([])
  })

  it('is quiet about nesting, which is deliberate', () => {
    const nested = [region('outer', [0, 0, 1, 1], 0.25), region('inner', [0.4, 0.4, 0.6, 0.6], 0.01)]
    expect(conflictingRegions(nested)).toEqual([])
  })

  it('reports a partial overlap between two different scales', () => {
    // Neither contains the other, so which applies depends on where a markup
    // happens to land. Worth saying while the regions are being drawn.
    const bad = [region('a', [0, 0, 0.6, 0.6], 0.25), region('b', [0.4, 0.4, 1, 1], 0.5)]
    expect(conflictingRegions(bad)).toEqual([['a', 'b']])
  })

  it('does not report an overlap between regions at the same scale', () => {
    const same = [region('a', [0, 0, 0.6, 0.6], 0.25), region('b', [0.4, 0.4, 1, 1], 0.25)]
    expect(conflictingRegions(same)).toEqual([])
  })

  it('does not report regions that merely touch', () => {
    const touching = [region('a', [0, 0, 0.5, 1], 0.25), region('b', [0.5, 0, 1, 1], 0.5)]
    expect(conflictingRegions(touching)).toEqual([])
  })
})
