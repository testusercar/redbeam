import { describe, it, expect } from 'vitest'
import { hitTest, insertVertexAt, removeVertexAt } from './hit.js'
import type { Markup } from '@redbeam/domain'
import type { Viewport } from '@redbeam/viewer'

// zoom 1, no offset, 1000x1000pt page -> normalized 0.1 lands at screen 100
const view: Viewport = { ox: 0, oy: 0, zoom: 1, vw: 1000, vh: 1000 }
const W = 1000
const H = 1000

const mk = (id: string, kind: Markup['kind'], ring: Array<{ x: number; y: number }>): Markup => ({
  id, scopeId: null, documentId: 'd', pageId: 'p', kind, rings: [ring],
})

const square = mk('sq', 'area', [
  { x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.3 }, { x: 0.1, y: 0.3 },
])

describe('hitTest', () => {
  it('hits a vertex', () => {
    expect(hitTest(101, 102, [square], view, W, H)).toEqual({ markupId: 'sq', part: 'vertex', index: 0 })
  })

  it('hits an edge between vertices', () => {
    const h = hitTest(200, 101, [square], view, W, H)
    expect(h).toEqual({ markupId: 'sq', part: 'edge', index: 0 })
  })

  it('hits the interior', () => {
    expect(hitTest(200, 200, [square], view, W, H)).toEqual({ markupId: 'sq', part: 'inside', index: -1 })
  })

  it('misses outside the shape', () => {
    expect(hitTest(500, 500, [square], view, W, H)).toBeNull()
  })

  it('prefers a vertex over the interior it sits in', () => {
    // a small markup whose vertex lands inside the big square
    const inner = mk('in', 'area', [
      { x: 0.2, y: 0.2 }, { x: 0.25, y: 0.2 }, { x: 0.25, y: 0.25 },
    ])
    const h = hitTest(200, 200, [square, inner], view, W, H)
    expect(h!.part).toBe('vertex')
    expect(h!.markupId).toBe('in')
  })

  it('prefers the topmost (last) markup on overlap', () => {
    const other = mk('top', 'area', [
      { x: 0.15, y: 0.15 }, { x: 0.35, y: 0.15 }, { x: 0.35, y: 0.35 }, { x: 0.15, y: 0.35 },
    ])
    expect(hitTest(250, 250, [square, other], view, W, H)!.markupId).toBe('top')
  })

  it('treats a polyline as open — no closing edge', () => {
    const line = mk('ln', 'polyline', [{ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.5 }])
    expect(hitTest(200, 500, [line], view, W, H)!.part).toBe('edge')
    // midway along where a closing edge WOULD be if it were closed: still a miss
    expect(hitTest(200, 700, [line], view, W, H)).toBeNull()
  })

  it('hits a count marker near its point', () => {
    const dot = mk('c1', 'count', [{ x: 0.5, y: 0.5 }])
    expect(hitTest(502, 501, [dot], view, W, H)).toEqual({ markupId: 'c1', part: 'vertex', index: 0 })
    expect(hitTest(560, 500, [dot], view, W, H)).toBeNull()
  })
})

describe('insertVertexAt', () => {
  it('inserts a midpoint after the edge index', () => {
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
    const out = insertVertexAt(ring, 0)
    expect(out).toHaveLength(4)
    expect(out[1]).toEqual({ x: 5, y: 0 })
  })

  it('wraps for the closing edge', () => {
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
    const out = insertVertexAt(ring, 2)
    expect(out).toHaveLength(4)
    expect(out[3]).toEqual({ x: 5, y: 5 })
  })
})

describe('removeVertexAt', () => {
  it('removes a vertex from a polygon with room to spare', () => {
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    expect(removeVertexAt(ring, 1, 'area')).toHaveLength(3)
  })

  it('refuses to take a polygon below 3 vertices', () => {
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
    expect(removeVertexAt(ring, 0, 'area')).toBeNull()
  })

  it('refuses to take a polyline below 2 vertices', () => {
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
    expect(removeVertexAt(ring, 0, 'polyline')).toBeNull()
  })

  it('does not mutate the input', () => {
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    removeVertexAt(ring, 1, 'area')
    expect(ring).toHaveLength(4)
  })
})
