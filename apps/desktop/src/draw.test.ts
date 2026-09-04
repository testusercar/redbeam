import { describe, expect, it } from 'vitest'
import { rectPointsBetween, screenToNormalized } from './draw.js'

describe('rectPointsBetween', () => {
  it('winds the same way whichever corner was dragged from', () => {
    const a = rectPointsBetween({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.7 })
    const b = rectPointsBetween({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.3 })
    expect(a).toEqual(b)
    expect(a).toEqual([{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.6, y: 0.7 }, { x: 0.2, y: 0.7 }])
  })

  it('keeps the anchor where it was on the PAGE when the view moves mid-drag', () => {
    const page = { w: 3456, h: 2592 }
    const before = { ox: 0, oy: 0, zoom: 0.25, vw: 800, vh: 600 }
    // The press: anchor taken on the page, from where the pointer was.
    const anchor = screenToNormalized(100, 100, before, page.w, page.h)
    // A wheel pans the view 200px while the button is still down.
    const after = { ...before, ox: 200, oy: 0 }
    const corner = screenToNormalized(300, 300, after, page.w, page.h)
    const ring = rectPointsBetween(anchor, corner)
    // The anchor corner is exactly where the press landed on the sheet.
    expect(ring[0]).toEqual(anchor)
    // And the rectangle spans the sheet from there to the live corner —
    // (300 + 200) − 100 = 400 screen px, not the 200 a screen-space anchor
    // would have given after the pan carried it along.
    expect((ring[1]!.x - ring[0]!.x) * page.w * before.zoom).toBeCloseTo(400, 6)
  })
})
