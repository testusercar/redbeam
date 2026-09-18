import { describe, it, expect } from 'vitest'
import { clipRingToRings, ringsOverlap, subtractRings, unionRings } from './clip.js'
import { regionArea, type Polygon } from './geometry.js'

const rect = (x: number, y: number, w: number, h: number): Polygon => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
]

describe('ringsOverlap', () => {
  it('is true for rings that share interior', () => {
    expect(ringsOverlap(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBe(true)
  })
  it('is false for rings that only touch along an edge', () => {
    expect(ringsOverlap(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toBe(false)
  })
  it('is false for rings apart', () => {
    expect(ringsOverlap(rect(0, 0, 10, 10), rect(20, 20, 5, 5))).toBe(false)
  })
  it('is true for a ring inside another', () => {
    expect(ringsOverlap(rect(0, 0, 10, 10), rect(2, 2, 3, 3))).toBe(true)
  })
})

describe('clipRingToRings', () => {
  it('keeps the part of the subject inside the clip', () => {
    // 10x10 straddling the right edge of a 10x10: 5x10 inside.
    const got = clipRingToRings(rect(5, 0, 10, 10), [rect(0, 0, 10, 10)])
    expect(got).toHaveLength(1)
    expect(regionArea(got)).toBeCloseTo(50, 9)
  })
  it('is empty when they do not overlap', () => {
    expect(clipRingToRings(rect(20, 20, 5, 5), [rect(0, 0, 10, 10)])).toEqual([])
  })
  it('clips against the UNION of the clip rings, so two areas can share one cutout', () => {
    const got = clipRingToRings(rect(5, 2, 10, 4), [rect(0, 0, 10, 10), rect(12, 0, 10, 10)])
    // 5 wide inside the first, 3 wide inside the second, 4 tall.
    expect(regionArea(got)).toBeCloseTo(20 + 12, 9)
  })
  it('drops the closing repeat of the first vertex', () => {
    const [ring] = clipRingToRings(rect(2, 2, 3, 3), [rect(0, 0, 10, 10)])
    expect(ring).toHaveLength(4)
  })
})

describe('subtractRings', () => {
  it('returns the material verbatim when there is nothing to subtract', () => {
    const a = rect(0, 0, 10, 10)
    const got = subtractRings([a], [])
    expect(got).toEqual([a])
    expect(got[0]).not.toBe(a)
  })
  it('makes a hole of an opening wholly inside', () => {
    const got = subtractRings([rect(0, 0, 10, 10)], [rect(2, 2, 3, 3)])
    expect(got).toHaveLength(2)
    expect(regionArea(got)).toBeCloseTo(100 - 9, 9)
  })
  it('makes a notch of an opening across the edge, not a hole', () => {
    const got = subtractRings([rect(0, 0, 10, 10)], [rect(5, 2, 10, 4)])
    expect(got).toHaveLength(1)
    expect(regionArea(got)).toBeCloseTo(100 - 20, 9)
  })
  it('takes several openings out at once, holes and notches together', () => {
    const got = subtractRings(
      [rect(0, 0, 10, 10)],
      [rect(1, 1, 2, 2), rect(6, 6, 2, 2), rect(-5, 4, 8, 1)],
    )
    expect(regionArea(got)).toBeCloseTo(100 - 4 - 4 - 3, 9)
  })
  it('removes everything when the opening covers the material', () => {
    expect(subtractRings([rect(0, 0, 10, 10)], [rect(-1, -1, 12, 12)])).toEqual([])
  })
  it('unions overlapping material before subtracting', () => {
    const cut = subtractRings([rect(0, 0, 10, 10), rect(5, 0, 10, 10)], [rect(7, 7, 1, 1)])
    expect(regionArea(cut)).toBeCloseTo(150 - 1, 9)
  })
})

describe('unionRings', () => {
  it('merges overlapping rings into one', () => {
    const got = unionRings([rect(0, 0, 10, 10), rect(5, 0, 10, 10)])
    expect(got).toHaveLength(1)
    expect(regionArea(got)).toBeCloseTo(150, 9)
  })
})
