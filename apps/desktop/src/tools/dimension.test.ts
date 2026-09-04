import { describe, it, expect } from 'vitest'
import type { Viewport } from '@redbeam/viewer'
import { linearFeet, type Calibration, type Markup } from '@redbeam/domain'
import {
  DEFAULT_DIMENSION_DRAW,
  LABEL_GRAB_PX,
  commitDimension,
  dimensionDraftBack,
  dimensionDraftMove,
  dimensionDraftPlace,
  dimensionOffsetFromDrag,
  dimensionScreenGeometry,
  drawDimension,
  drawDimensionDraft,
  emptyDimensionDraft,
  hitTestDimension,
  isDimensionCommittable,
  type DimensionMarkup,
} from './dimension.js'
import { recordingContext } from './testContext.js'

// zoom 1, no offset, 1000x1000pt page -> normalized 0.1 lands at screen 100,
// matching hit.test.ts so the two suites read the same way.
const view: Viewport = { ox: 0, oy: 0, zoom: 1, vw: 1000, vh: 1000 }
const W = 1000
const H = 1000

const dim = (
  id: string,
  a: { x: number; y: number },
  b: { x: number; y: number },
  offsetPoints = 0,
): DimensionMarkup => ({
  id,
  scopeId: null,
  documentId: 'd',
  pageId: 'p',
  kind: 'dimension',
  rings: [[a, b]],
  content: { offsetPoints, ortho: 'none', label: null },
})

describe('draft state machine', () => {
  it('places an anchor then closes the dimension', () => {
    let d = emptyDimensionDraft()
    expect(isDimensionCommittable(d)).toBe(false)
    d = dimensionDraftPlace(d, { x: 0.1, y: 0.1 }, W, H)
    expect(d.a).toEqual({ x: 0.1, y: 0.1 })
    expect(isDimensionCommittable(d)).toBe(false)
    d = dimensionDraftPlace(d, { x: 0.4, y: 0.1 }, W, H)
    expect(d.b).toEqual({ x: 0.4, y: 0.1 })
    expect(isDimensionCommittable(d)).toBe(true)
    // a third click is ignored — a dimension is exactly two points, matching
    // createPolylineMeasurement()'s points.mid(0, 2)
    d = dimensionDraftPlace(d, { x: 0.9, y: 0.9 }, W, H)
    expect(d.b).toEqual({ x: 0.4, y: 0.1 })
  })

  it('is committable off the live cursor before the second click', () => {
    let d = dimensionDraftPlace(emptyDimensionDraft(), { x: 0.1, y: 0.1 }, W, H)
    d = dimensionDraftMove(d, { x: 0.4, y: 0.2 }, W, H)
    expect(isDimensionCommittable(d)).toBe(true)
    expect(commitDimension(d, W, H)!.rings[0]).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.2 }])
  })

  it('refuses a zero-length dimension', () => {
    let d = dimensionDraftPlace(emptyDimensionDraft(), { x: 0.2, y: 0.2 }, W, H)
    d = dimensionDraftPlace(d, { x: 0.2, y: 0.2 }, W, H)
    expect(isDimensionCommittable(d)).toBe(false)
    expect(commitDimension(d, W, H)).toBeNull()
  })

  it('applies the ortho constraint on move and on place', () => {
    let d = emptyDimensionDraft('horizontal')
    d = dimensionDraftPlace(d, { x: 0.1, y: 0.1 }, W, H)
    d = dimensionDraftMove(d, { x: 0.5, y: 0.9 }, W, H)
    expect(d.cursor).toEqual({ x: 0.5, y: 0.1 })
    d = dimensionDraftPlace(d, { x: 0.5, y: 0.9 }, W, H)
    expect(d.b).toEqual({ x: 0.5, y: 0.1 })
  })

  it('records which axis auto actually locked', () => {
    let d = emptyDimensionDraft('auto')
    d = dimensionDraftPlace(d, { x: 0.1, y: 0.1 }, W, H)
    d = dimensionDraftPlace(d, { x: 0.5, y: 0.2 }, W, H)
    expect(commitDimension(d, W, H)!.content.ortho).toBe('horizontal')

    let v = emptyDimensionDraft('auto')
    v = dimensionDraftPlace(v, { x: 0.1, y: 0.1 }, W, H)
    v = dimensionDraftPlace(v, { x: 0.2, y: 0.5 }, W, H)
    expect(commitDimension(v, W, H)!.content.ortho).toBe('vertical')
  })

  it('backs out one point at a time', () => {
    let d = dimensionDraftPlace(emptyDimensionDraft(), { x: 0.1, y: 0.1 }, W, H)
    d = dimensionDraftPlace(d, { x: 0.4, y: 0.1 }, W, H)
    d = dimensionDraftBack(d)
    expect(d.b).toBeNull()
    expect(d.a).not.toBeNull()
    d = dimensionDraftBack(d)
    expect(d.a).toBeNull()
    expect(dimensionDraftBack(d)).toEqual(d)
  })

  it('carries the offset into content', () => {
    let d = emptyDimensionDraft('none', 24)
    d = dimensionDraftPlace(d, { x: 0.1, y: 0.1 }, W, H)
    d = dimensionDraftPlace(d, { x: 0.4, y: 0.1 }, W, H)
    expect(commitDimension(d, W, H)!.content).toEqual({
      offsetPoints: 24,
      ortho: 'none',
      label: null,
    })
  })
})

describe('the committed geometry is the measured geometry', () => {
  const cal: Calibration = { feetPerPoint: 0.100299, pageWidth: 3456, pageHeight: 2592 }

  it('a committed dimension and a polyline over the same points agree exactly', () => {
    let d = emptyDimensionDraft('none', 137)
    d = dimensionDraftPlace(d, { x: 0.12, y: 0.31 }, cal.pageWidth, cal.pageHeight)
    d = dimensionDraftPlace(d, { x: 0.64, y: 0.77 }, cal.pageWidth, cal.pageHeight)
    const committed = commitDimension(d, cal.pageWidth, cal.pageHeight)!

    // the same ring, stored as a linear markup
    const polyline: Markup = {
      id: 'p', scopeId: 's', documentId: 'd', pageId: 'pg',
      kind: 'polyline', rings: committed.rings,
    }
    const g = dimensionScreenGeometry(
      committed.rings[0]![0]!, committed.rings[0]![1]!,
      committed.content.offsetPoints, view, cal.pageWidth, cal.pageHeight,
    )
    expect(g.lengthPdfPoints * cal.feetPerPoint).toBe(linearFeet([polyline], cal))
  })
})

describe('screen geometry', () => {
  it('offsets the line but not the measured points', () => {
    const g = dimensionScreenGeometry({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 40, view, W, H)
    expect(g.a).toEqual({ x: 200, y: 500 })
    expect(g.b).toEqual({ x: 800, y: 500 })
    expect(g.lineA.x).toBeCloseTo(200, 9)
    expect(g.lineA.y).toBeCloseTo(540, 9)
    expect(g.mid).toEqual({ x: 500, y: g.lineA.y })
    expect(g.lengthPdfPoints).toBeCloseTo(600, 9)
  })

  it('scales with zoom without moving the measurement', () => {
    const zoomed: Viewport = { ...view, zoom: 2 }
    const g = dimensionScreenGeometry({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 0, zoomed, W, H)
    expect(g.lengthPx).toBeCloseTo(1200, 9)
    expect(g.lengthPdfPoints).toBeCloseTo(600, 9)
  })

  it('inverts a label drag back into an offset', () => {
    const m = dim('d', { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 })
    expect(dimensionOffsetFromDrag(m, 500, 560, view, W, H)).toBeCloseTo(60, 9)
  })
})

describe('hit-testing', () => {
  const m = dim('d', { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 40)

  it('hits the measured points, not the offset line ends', () => {
    expect(hitTestDimension(200, 500, [m], view, W, H))
      .toEqual({ markupId: 'd', part: 'vertex', index: 0 })
    expect(hitTestDimension(800, 500, [m], view, W, H))
      .toEqual({ markupId: 'd', part: 'vertex', index: 1 })
  })

  it('hits the offset dimension line, not the span between the measured points', () => {
    expect(hitTestDimension(300, 540, [m], view, W, H))
      .toEqual({ markupId: 'd', part: 'edge', index: 0 })
    // the measured span itself is empty once the line is offset
    expect(hitTestDimension(300, 500, [m], view, W, H)).toBeNull()
  })

  it('gives the label priority over the line it sits on', () => {
    expect(hitTestDimension(500, 540, [m], view, W, H))
      .toEqual({ markupId: 'd', part: 'label', index: -1 })
    // just outside the label grab radius, the line takes it
    expect(hitTestDimension(500 + LABEL_GRAB_PX + 2, 540, [m], view, W, H)?.part).toBe('edge')
  })

  it('misses cleanly and prefers the topmost markup', () => {
    expect(hitTestDimension(50, 50, [m], view, W, H)).toBeNull()
    const top = dim('top', { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 40)
    expect(hitTestDimension(200, 500, [m, top], view, W, H)?.markupId).toBe('top')
  })

  it('ignores a markup with a malformed ring instead of throwing', () => {
    const broken = { ...dim('b', { x: 0, y: 0 }, { x: 1, y: 1 }), rings: [[]] }
    expect(hitTestDimension(200, 500, [broken, m], view, W, H)?.markupId).toBe('d')
  })
})

describe('rendering', () => {
  it('draws witness lines, the dimension line, two slash ticks and a label', () => {
    const ctx = recordingContext()
    drawDimension(ctx.ctx, dim('d', { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 40), view, W, H, {
      feetPerPoint: 0.1,
    })
    // 2 witness + 1 dimension line + 2 ticks
    expect(ctx.calls.filter((c) => c.name === 'stroke').length).toBe(5)
    expect(ctx.text).toEqual([`60' - 0"`])
  })

  it('suppresses the witness lines at zero offset', () => {
    const ctx = recordingContext()
    drawDimension(ctx.ctx, dim('d', { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 0), view, W, H, {
      feetPerPoint: 0.1,
    })
    expect(ctx.calls.filter((c) => c.name === 'stroke').length).toBe(3)
  })

  it('says so when the page is not calibrated', () => {
    const ctx = recordingContext()
    drawDimension(ctx.ctx, dim('d', { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }), view, W, H)
    expect(ctx.text).toEqual(['set scale first'])
  })

  it('prefers a label override over the measured value', () => {
    const ctx = recordingContext()
    const m = dim('d', { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 })
    m.content.label = 'EQ'
    drawDimension(ctx.ctx, m, view, W, H, { feetPerPoint: 0.1 })
    expect(ctx.text).toEqual(['EQ'])
  })

  it('clamps the tick to half the segment on a very short dimension', () => {
    const ctx = recordingContext()
    // 4px long at zoom 1; the default 9px tick would dwarf the line. The Qt
    // clamp is min(tick, segment / 2), so the tick is 2px and reaches 1px
    // either side of a horizontal dimension. Unclamped it would reach 4.5px.
    drawDimension(ctx.ctx, dim('d', { x: 0.5, y: 0.5 }, { x: 0.504, y: 0.5 }), view, W, H,
      { showLabel: false })
    const ys = ctx.calls
      .filter((c) => c.name === 'lineTo' || c.name === 'moveTo')
      .map((c) => c.args[1] as number)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2, 9)
  })

  it('draws nothing for an empty draft and a dot for a lone anchor', () => {
    const empty = recordingContext()
    drawDimensionDraft(empty.ctx, emptyDimensionDraft(), view, W, H)
    expect(empty.calls.length).toBe(0)

    const anchored = recordingContext()
    drawDimensionDraft(
      anchored.ctx,
      dimensionDraftPlace(emptyDimensionDraft(), { x: 0.3, y: 0.3 }, W, H),
      view, W, H,
    )
    expect(anchored.calls.some((c) => c.name === 'arc')).toBe(true)
  })

  it('draws the draft dashed until the second point lands', () => {
    const live = recordingContext()
    let d = dimensionDraftPlace(emptyDimensionDraft(), { x: 0.2, y: 0.5 }, W, H)
    d = dimensionDraftMove(d, { x: 0.8, y: 0.5 }, W, H)
    drawDimensionDraft(live.ctx, d, view, W, H)
    expect(live.calls.some((c) => c.name === 'setLineDash' && (c.args[0] as number[]).length > 0))
      .toBe(true)
  })

  it('leaves the context state balanced', () => {
    const ctx = recordingContext()
    drawDimension(ctx.ctx, dim('d', { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 40), view, W, H, {
      feetPerPoint: 0.1,
    })
    expect(ctx.calls.filter((c) => c.name === 'save').length)
      .toBe(ctx.calls.filter((c) => c.name === 'restore').length)
  })

  it('does not mutate the caller-supplied options', () => {
    const options = { ...DEFAULT_DIMENSION_DRAW, feetPerPoint: 0.1 }
    const snapshot = { ...options }
    drawDimension(
      recordingContext().ctx,
      dim('d', { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }),
      view, W, H, options,
    )
    expect(options).toEqual(snapshot)
  })
})
