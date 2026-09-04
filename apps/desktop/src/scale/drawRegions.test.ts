/**
 * The drawing has to agree with the arithmetic.
 *
 * Resolution gives the SMALLEST containing region, so a detail inside a detail
 * wins. If the painter drew them in the other order the outer box would cover
 * the inner one and the sheet would show a scale that is not the one being
 * used — a picture that lies about the number beside it.
 */
import { describe, expect, it, vi } from 'vitest'
import { drawScaleRegions } from './drawRegions.js'
import type { ScaleRegion } from '@redbeam/domain'

const region = (
  id: string, r: [number, number, number, number], feetPerPoint: number, label = '',
): ScaleRegion => ({
  id, pageId: 'd-p0', label, feetPerPoint,
  rect: { x0: r[0], y0: r[1], x1: r[2], y1: r[3] },
})

/** A canvas context that records what it was asked to draw. */
function fakeCtx() {
  const strokes: Array<[number, number, number, number]> = []
  const texts: string[] = []
  return {
    calls: { strokes, texts },
    ctx: {
      save: vi.fn(), restore: vi.fn(),
      setLineDash: vi.fn(), measureText: () => ({ width: 40 }),
      fillRect: vi.fn(),
      strokeRect: (x: number, y: number, w: number, h: number) => { strokes.push([x, y, w, h]) },
      fillText: (t: string) => { texts.push(t) },
      lineWidth: 0, strokeStyle: '', fillStyle: '', font: '', textBaseline: '',
    } as unknown as CanvasRenderingContext2D,
  }
}

const view = { ox: 0, oy: 0, zoom: 1 }
const opts = { pageWidth: 1000, pageHeight: 1000, active: true }

describe('drawScaleRegions', () => {
  it('draws nothing when there is nothing to draw', () => {
    const { ctx, calls } = fakeCtx()
    drawScaleRegions(ctx, [], view, opts)
    expect(calls.strokes).toEqual([])
  })

  it('places a region where it was drawn', () => {
    const { ctx, calls } = fakeCtx()
    drawScaleRegions(ctx, [region('a', [0.1, 0.2, 0.5, 0.6], 0.25)], view, opts)
    expect(calls.strokes[0]).toEqual([100, 200, 400, 400])
  })

  it('does not care which way the box was dragged', () => {
    // Dragged up-and-left is the same region, and a negative width would
    // stroke nothing.
    const { ctx, calls } = fakeCtx()
    drawScaleRegions(ctx, [region('a', [0.5, 0.6, 0.1, 0.2], 0.25)], view, opts)
    expect(calls.strokes[0]).toEqual([100, 200, 400, 400])
  })

  it('paints the larger region first, so a nested one stays visible', () => {
    // The property that matters: resolution gives the smallest containing
    // region, so the picture must show it rather than the box over it.
    const { ctx, calls } = fakeCtx()
    drawScaleRegions(ctx, [
      region('inner', [0.4, 0.4, 0.6, 0.6], 0.01, 'inner'),
      region('outer', [0, 0, 1, 1], 0.25, 'outer'),
    ], view, opts)
    expect(calls.texts.map((t) => t.split(' ·')[0])).toEqual(['outer', 'inner'])
  })

  it('writes the scale on the box', () => {
    // A region whose scale you have to click to discover is one people forget
    // is there while drawing inside it.
    const { ctx, calls } = fakeCtx()
    // 1/4" = 1'-0" is 4 feet per drawing inch, so 4/72 feet per point.
    drawScaleRegions(ctx, [region('a', [0, 0, 1, 1], 4 / 72)], view, opts)
    expect(calls.texts[0]).toContain('1/4"')
  })

  it('names a labelled region and its scale together', () => {
    const { ctx, calls } = fakeCtx()
    drawScaleRegions(ctx, [region('a', [0, 0, 1, 1], 4 / 72, 'Detail 3')], view, opts)
    expect(calls.texts[0]).toMatch(/^Detail 3 · /)
  })

  it('follows the viewport', () => {
    const { ctx, calls } = fakeCtx()
    drawScaleRegions(ctx, [region('a', [0, 0, 0.5, 0.5], 0.25)], { ox: 30, oy: 40, zoom: 2 }, opts)
    expect(calls.strokes[0]).toEqual([30, 40, 1000, 1000])
  })
})
