import { describe, it, expect } from 'vitest'
import { buildAnchorGrid, nearestAnchor } from './snapAnchors.js'

const segs = (...s: number[]) => new Float32Array(s)
/** Float32 storage rounds 0.1 to 0.10000000149; compare to that precision. */
const near = (x: number, y: number) => ({ x: expect.closeTo(x, 6), y: expect.closeTo(y, 6) })

describe('buildAnchorGrid', () => {
  it('holds both ends of every segment', () => {
    const g = buildAnchorGrid(segs(0.1, 0.1, 0.5, 0.1, 0.5, 0.1, 0.5, 0.5), 16)
    // Three distinct corners: (0.1,0.1), (0.5,0.1) shared, (0.5,0.5).
    expect(g.count).toBe(3)
  })

  it('drops endpoints outside the page', () => {
    const g = buildAnchorGrid(segs(-0.2, 0.1, 0.5, 0.1), 16)
    expect(g.count).toBe(1)
  })

  it('merges the four copies of a corner where two walls meet', () => {
    const g = buildAnchorGrid(segs(
      0.2, 0.2, 0.6, 0.2,   // wall face
      0.2, 0.2, 0.2, 0.6,   // return
      0.2000001, 0.2, 0.6, 0.21,  // the other face, a hair off
    ), 16)
    expect(g.count).toBe(4)
  })

  it('survives an empty page', () => {
    const g = buildAnchorGrid(new Float32Array(0), 16)
    expect(g.count).toBe(0)
    expect(nearestAnchor(g, 0.5, 0.5, 0.01, 0.01)).toBeNull()
  })
})

describe('nearestAnchor', () => {
  const g = buildAnchorGrid(segs(
    0.10, 0.10, 0.50, 0.10,
    0.50, 0.10, 0.50, 0.50,
    0.90, 0.90, 0.95, 0.90,
  ), 32)

  it('finds the nearest end within the radius', () => {
    expect(nearestAnchor(g, 0.503, 0.104, 0.01, 0.01)).toEqual(near(0.5, 0.1))
  })

  it('returns null when nothing is within the radius', () => {
    expect(nearestAnchor(g, 0.3, 0.3, 0.01, 0.01)).toBeNull()
  })

  it('looks across a cell boundary', () => {
    // 0.5 sits on a cell edge at 32 cells; a query just under it must still see it.
    expect(nearestAnchor(g, 0.497, 0.497, 0.01, 0.01)).toEqual(near(0.5, 0.5))
  })

  it('measures the radius per axis, so a wide page does not snap further sideways', () => {
    // 0.008 away in x: inside an rx of 0.01, outside an rx of 0.005.
    expect(nearestAnchor(g, 0.508, 0.1, 0.01, 0.001)).toEqual(near(0.5, 0.1))
    expect(nearestAnchor(g, 0.508, 0.1, 0.005, 0.001)).toBeNull()
  })

  it('picks the closer of two candidates', () => {
    expect(nearestAnchor(g, 0.93, 0.9, 0.05, 0.05)).toEqual(near(0.95, 0.9))
  })
})
