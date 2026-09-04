import { describe, it, expect } from 'vitest'
import { clampViewport, zoomAbout } from './viewer.js'
import type { PageInfo, Viewport } from './types.js'

const page: PageInfo = { width: 1000, height: 800 }
const view = (over: Partial<Viewport> = {}): Viewport =>
  ({ ox: 0, oy: 0, zoom: 1, vw: 600, vh: 400, ...over })

describe('clampViewport', () => {
  it('keeps a small page fully visible without forcing it to dead centre', () => {
    /*
     * The clamp used to SNAP a smaller-than-viewport page to centre, and
     * because it runs after every zoom that destroyed the cursor anchor. At
     * fit a sheet fills the height and is narrower than the window, so the
     * horizontal axis was pinned and zooming near the left edge slid the
     * drawing sideways under the pointer.
     *
     * A smaller page has a legal RANGE of offsets — every one that keeps it
     * fully on screen — so the clamp preserves an achievable anchor and only
     * overrides it at the edges. Framing is the fit's job, not the clamp's.
     */
    const anchored = clampViewport(view({ zoom: 0.1, ox: -120, oy: -60 }), page)
    expect(anchored.ox, 'inside the legal range, so untouched').toBe(-120)
    expect(anchored.oy).toBe(-60)
  })

  it('will not let a small page leave the viewport', () => {
    // Page at 0.1 is 100x80 in a 600x400 window: ox may run from -500 to 0.
    expect(clampViewport(view({ zoom: 0.1, ox: 40 }), page).ox).toBe(0)
    expect(clampViewport(view({ zoom: 0.1, ox: -9999 }), page).ox).toBe(100 - 600)
    expect(clampViewport(view({ zoom: 0.1, oy: 40 }), page).oy).toBe(0)
    expect(clampViewport(view({ zoom: 0.1, oy: -9999 }), page).oy).toBe(80 - 400)
  })

  it('still clamps a page larger than the viewport to its edges', () => {
    expect(clampViewport(view({ ox: -50 }), page).ox).toBe(0)
    expect(clampViewport(view({ ox: 99999 }), page).ox).toBe(1000 - 600)
    expect(clampViewport(view({ oy: 99999 }), page).oy).toBe(800 - 400)
  })

  it('applies each axis independently', () => {
    // A wide sheet in a tall window: horizontal scrolls, vertical has slack.
    const v = clampViewport(view({ zoom: 1, vw: 400, vh: 900, ox: 99999 }), page)
    expect(v.ox).toBe(1000 - 400)
    // Vertically the page is smaller, so oy=0 is legal and stays put.
    expect(v.oy).toBe(0)
  })
})

describe('zoomAbout', () => {
  const worldAt = (v: Viewport, sx: number, sy: number) =>
    ({ x: (v.ox + sx) / v.zoom, y: (v.oy + sy) / v.zoom })

  it('keeps the point under the cursor fixed', () => {
    const before = view({ ox: 120, oy: 80, zoom: 1 })
    const at = { sx: 250, sy: 150 }
    const w0 = worldAt(before, at.sx, at.sy)
    const after = zoomAbout(before, 2.5, at.sx, at.sy)
    const w1 = worldAt(after, at.sx, at.sy)
    expect(w1.x).toBeCloseTo(w0.x, 9)
    expect(w1.y).toBeCloseTo(w0.y, 9)
  })

  it('holds the anchor when zooming out too', () => {
    const before = view({ ox: 400, oy: 300, zoom: 3 })
    const w0 = worldAt(before, 100, 90)
    const after = zoomAbout(before, 1.2, 100, 90)
    expect(worldAt(after, 100, 90).x).toBeCloseTo(w0.x, 9)
    expect(worldAt(after, 100, 90).y).toBeCloseTo(w0.y, 9)
  })

  it('anchors on the CORNER only when the cursor is actually there', () => {
    // Regression guard for the reported symptom: (0,0) is a legitimate anchor,
    // but it must not be where every zoom ends up.
    const before = view({ ox: 200, oy: 200, zoom: 1 })
    const corner = zoomAbout(before, 2, 0, 0)
    const middle = zoomAbout(before, 2, 300, 200)
    expect(corner.ox).not.toBe(middle.ox)
    expect(corner.oy).not.toBe(middle.oy)
  })
})
