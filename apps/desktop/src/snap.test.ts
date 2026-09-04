import { describe, it, expect } from 'vitest'
import { nearestVertex, constrainOrtho, snapPoint, DEFAULT_SNAP } from './snap.js'

describe('nearestVertex', () => {
  const verts = [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 100, y: 140 }]

  it('snaps to a vertex inside the radius', () => {
    expect(nearestVertex(104, 103, verts, 12)).toEqual({ x: 100, y: 100 })
  })

  it('returns null when nothing is close enough', () => {
    expect(nearestVertex(120, 120, verts, 12)).toBeNull()
  })

  it('picks the nearest when several are in range', () => {
    // equidistant-ish but (140,100) is closer
    expect(nearestVertex(136, 100, verts, 20)).toEqual({ x: 140, y: 100 })
  })

  it('treats the radius as inclusive', () => {
    expect(nearestVertex(110, 100, verts, 10)).toEqual({ x: 100, y: 100 })
  })

  it('handles an empty vertex list', () => {
    expect(nearestVertex(0, 0, [], 12)).toBeNull()
  })
})

describe('constrainOrtho', () => {
  const a = { x: 100, y: 100 }

  it('snaps a near-horizontal drag to horizontal', () => {
    const p = constrainOrtho(200, 104, a)
    expect(p.y).toBeCloseTo(100, 6)
    expect(p.x).toBeGreaterThan(100)
  })

  it('snaps a near-vertical drag to vertical', () => {
    const p = constrainOrtho(103, 200, a)
    expect(p.x).toBeCloseTo(100, 6)
    expect(p.y).toBeGreaterThan(100)
  })

  it('snaps a diagonal drag to 45 degrees', () => {
    const p = constrainOrtho(200, 195, a)
    expect(p.x - a.x).toBeCloseTo(p.y - a.y, 6)
  })

  it('preserves the drag length', () => {
    const p = constrainOrtho(200, 104, a)
    const original = Math.hypot(200 - 100, 104 - 100)
    expect(Math.hypot(p.x - a.x, p.y - a.y)).toBeCloseTo(original, 6)
  })

  it('is a no-op at zero length', () => {
    expect(constrainOrtho(100, 100, a)).toEqual({ x: 100, y: 100 })
  })

  it('works in every quadrant', () => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const p = constrainOrtho(a.x + dx! * 50 + 3, a.y + dy! * 50 - 2, a)
      // must land on one of the 8 principal directions
      const ang = Math.atan2(p.y - a.y, p.x - a.x)
      const k = ang / (Math.PI / 4)
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9)
    }
  })
})

/**
 * Content snapping across a device-pixel ratio.
 *
 * This path had no test, which is how it shipped reading the raster in the
 * wrong coordinate space: `getImageData` works in BACKING-STORE pixels and the
 * cursor arrives in CSS pixels, so on a 1.5x or 2x display every content snap
 * sampled a region up and to the left of the cursor and locked onto whatever
 * ink was there. It did not fail — it succeeded at the wrong place, which is
 * why it read as "snapping is broken" rather than as a bug.
 */
describe('snapPoint against the raster', () => {
  /** A canvas whose backing store is `dpr` times its CSS box, with one ink dot. */
  function rasterWithInk(cssSize: number, dpr: number, ink: { x: number; y: number }) {
    const w = cssSize * dpr
    const data = new Uint8ClampedArray(w * w * 4)
    // Everything is opaque white except the one dark pixel.
    for (let i = 0; i < w * w; i++) {
      data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255
    }
    const i = (ink.y * w + ink.x) * 4
    data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255

    return {
      width: w,
      height: w,
      clientWidth: cssSize,
      clientHeight: cssSize,
      getContext: () => ({
        getImageData: (x: number, y: number, cw: number, ch: number) => {
          const out = new Uint8ClampedArray(cw * ch * 4)
          for (let yy = 0; yy < ch; yy++) {
            for (let xx = 0; xx < cw; xx++) {
              const src = ((y + yy) * w + (x + xx)) * 4
              const dst = (yy * cw + xx) * 4
              out[dst] = data[src]!; out[dst + 1] = data[src + 1]!
              out[dst + 2] = data[src + 2]!; out[dst + 3] = data[src + 3]!
            }
          }
          return { data: out, width: cw, height: ch }
        },
      }),
    } as unknown as HTMLCanvasElement
  }

  const opts = (raster: HTMLCanvasElement) => ({
    ...DEFAULT_SNAP, raster, vertices: [], anchor: null, ortho: false,
  })

  it('snaps to ink at the CSS position it appears at, at 2x', () => {
    // Ink at device (100,100) is at CSS (50,50) on a 2x canvas.
    const raster = rasterWithInk(200, 2, { x: 100, y: 100 })
    const r = snapPoint(54, 54, opts(raster))
    expect(r.kind).toBe('content')
    expect(r.x).toBeCloseTo(50, 6)
    expect(r.y).toBeCloseTo(50, 6)
  })

  it('gives the same answer at 1x', () => {
    const raster = rasterWithInk(200, 1, { x: 50, y: 50 })
    const r = snapPoint(54, 54, opts(raster))
    expect(r.kind).toBe('content')
    expect(r.x).toBeCloseTo(50, 6)
    expect(r.y).toBeCloseTo(50, 6)
  })

  /** The radius is a SCREEN distance, so it must not stretch with the ratio. */
  it('does not reach further on a high-density display', () => {
    const far = { x: 2 * (50 + DEFAULT_SNAP.radius + 6), y: 2 * 50 }
    const raster = rasterWithInk(200, 2, far)
    expect(snapPoint(50, 50, opts(raster)).kind).toBe('none')
  })

  it('leaves the point alone when snapping is off', () => {
    const raster = rasterWithInk(200, 2, { x: 100, y: 100 })
    const r = snapPoint(54, 54, { ...opts(raster), enabled: false })
    expect(r).toEqual({ x: 54, y: 54, kind: 'none' })
  })
})
