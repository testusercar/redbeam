import { describe, expect, it } from 'vitest'
import { cropFor, pageIndexOf, sheetsToSnapshot, type SnapshotMarkup } from './snapshots.js'

const mk = (scopeId: string | null, pageId: string, kind: string, ring: Array<[number, number]>): SnapshotMarkup => ({
  scopeId, documentId: pageId.split('-p')[0]!, pageId, kind, rings: [ring.map(([x, y]) => ({ x, y }))],
})

describe('pageIndexOf', () => {
  it('reads the zero-based page off a page id', () => {
    expect(pageIndexOf('doc-1-p0')).toBe(0)
    expect(pageIndexOf('d1-p12')).toBe(12)
    expect(pageIndexOf('nonsense')).toBeNull()
  })
})

describe('sheetsToSnapshot', () => {
  it('collects takeoff for the round scopes, one entry per sheet', () => {
    const sheets = sheetsToSnapshot([
      mk('s1', 'd1-p0', 'area', [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]]),
      mk('s1', 'd1-p0', 'cutout', [[0.12, 0.12], [0.14, 0.12], [0.14, 0.14]]),
      mk('s2', 'd1-p3', 'polyline', [[0.5, 0.5], [0.6, 0.5]]),
      // Another round's scope, a dimension, and an unscoped markup: none count.
      mk('other', 'd1-p4', 'area', [[0, 0], [1, 0], [1, 1]]),
      mk(null, 'd1-p0', 'dimension', [[0, 0], [1, 1]]),
      mk('s1', 'd1-p5', 'shape', [[0, 0], [1, 0], [1, 1]]),
    ], new Set(['s1', 's2']))
    expect([...sheets.keys()]).toEqual(['d1-p0', 'd1-p3'])
    expect(sheets.get('d1-p0')?.markups).toHaveLength(2)
    expect(sheets.get('d1-p3')?.pageIndex).toBe(3)
  })
})

describe('cropFor', () => {
  it('frames the takeoff with a margin and clamps to the sheet', () => {
    const crop = cropFor([mk('s1', 'd1-p0', 'area', [[0.0, 0.0], [0.5, 0.0], [0.5, 0.25]])], 0.2)
    expect(crop.x0).toBe(0)
    expect(crop.y0).toBe(0)
    expect(crop.x1).toBeCloseTo(0.6, 5)
    expect(crop.y1).toBeCloseTo(0.35, 5)
  })

  it('never crops tighter than a few per cent of the sheet around a single dot', () => {
    const crop = cropFor([mk('s1', 'd1-p0', 'count', [[0.5, 0.5]])], 0.2)
    expect(crop).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 })
  })

  it('gives a tiny mark its surroundings rather than a 1px picture', () => {
    const crop = cropFor([mk('s1', 'd1-p0', 'area', [[0.50, 0.50], [0.51, 0.50], [0.51, 0.51]])], 0.2)
    expect(crop.x1 - crop.x0).toBeGreaterThan(0.08)
  })
})
