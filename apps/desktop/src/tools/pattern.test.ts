import { describe, it, expect } from 'vitest'
import type { Viewport } from '@redbeam/viewer'
import {
  canClosePatternRegion,
  closePatternRegion,
  commitPatternDraft,
  drawPatternDraft,
  drawPatternItems,
  emptyPatternDraft,
  formatAxisAngle,
  hitTestPattern,
  isPatternDraftCommittable,
  originMarkupsOf,
  patternDraftAddPoint,
  patternDraftSetCursor,
  patternDraftUndo,
  patternItemAngle,
  patternOverlaySet,
  patternToolStatus,
  zonesOf,
  type PatternItem,
} from './pattern.js'
import { resolvePatternDirection, resolvePatternOrigin } from '@redbeam/domain'
import { recordingContext } from './testContext.js'

// zoom 1, no offset, 1000x1000pt page -> normalized 0.1 lands at screen 100.
// Same fixture shape as hit.test.ts so the two hit-testers stay comparable.
const view: Viewport = { ox: 0, oy: 0, zoom: 1, vw: 1000, vh: 1000 }
const W = 1000
const H = 1000
const PAGE = { width: W, height: H }
const SHEET = { width: 3456, height: 2592 }

const p = (x: number, y: number) => ({ x, y })

const zoneItem = (
  id: string,
  ring: Array<{ x: number; y: number }>,
  direction: [{ x: number; y: number }, { x: number; y: number }],
  priority?: number,
): PatternItem =>
  priority === undefined
    ? { kind: 'zone', id, rings: [ring], direction }
    : { kind: 'zone', id, rings: [ring], direction, priority }

const square = [p(0.1, 0.1), p(0.3, 0.1), p(0.3, 0.3), p(0.1, 0.3)]

// ---------------------------------------------------------------------------
// Draft state machine
// ---------------------------------------------------------------------------

describe('pattern draft', () => {
  it('places an origin with one click', () => {
    let d = emptyPatternDraft('pattern-origin')
    expect(d.phase).toBe('vector')
    expect(isPatternDraftCommittable(d)).toBe(false)
    d = patternDraftAddPoint(d, p(0.4, 0.6))
    expect(isPatternDraftCommittable(d)).toBe(true)
    expect(commitPatternDraft(d)).toEqual({
      kind: 'origin',
      point: p(0.4, 0.6),
      rings: [[p(0.4, 0.6)]],
    })
  })

  it('stores an origin as rings, so it round-trips through the origin rule', () => {
    const commit = commitPatternDraft(
      patternDraftAddPoint(emptyPatternDraft('pattern-origin'), p(0.4, 0.6)),
    )
    if (commit?.kind !== 'origin') throw new Error('expected an origin commit')
    const region = [[p(0, 0), p(1, 0), p(1, 1), p(0, 1)]]
    const resolved = resolvePatternOrigin([{ id: 'o', rings: commit.rings }], region, PAGE)
    expect(resolved?.source).toBe('placed')
    expect(resolved?.normalized).toEqual(p(0.4, 0.6))
  })

  it('needs two distinct points for a direction', () => {
    let d = emptyPatternDraft('pattern-direction')
    d = patternDraftAddPoint(d, p(0.2, 0.2))
    expect(isPatternDraftCommittable(d)).toBe(false)
    d = patternDraftAddPoint(d, p(0.2, 0.2))
    // a zero-length direction is not a direction — the Qt length() > 0 guard
    expect(isPatternDraftCommittable(d)).toBe(false)
    d = patternDraftUndo(d)
    d = patternDraftAddPoint(d, p(0.8, 0.2))
    expect(commitPatternDraft(d)).toEqual({
      kind: 'direction',
      direction: [p(0.2, 0.2), p(0.8, 0.2)],
    })
  })

  it('ignores a click once the direction is full rather than sliding it', () => {
    let d = emptyPatternDraft('pattern-direction')
    d = patternDraftAddPoint(d, p(0.2, 0.2))
    d = patternDraftAddPoint(d, p(0.8, 0.2))
    d = patternDraftAddPoint(d, p(0.5, 0.9))
    expect(d.vector).toEqual([p(0.2, 0.2), p(0.8, 0.2)])
  })

  it('authors a zone as boundary then direction', () => {
    let d = emptyPatternDraft('direction-zone')
    expect(d.phase).toBe('region')
    for (const v of square) d = patternDraftAddPoint(d, v)
    expect(canClosePatternRegion(d)).toBe(true)
    d = closePatternRegion(d)
    expect(d.phase).toBe('vector')
    expect(isPatternDraftCommittable(d)).toBe(false)
    d = patternDraftAddPoint(d, p(0.12, 0.2))
    d = patternDraftAddPoint(d, p(0.28, 0.2))
    const commit = commitPatternDraft(d)
    expect(commit).toEqual({
      kind: 'zone',
      rings: [square],
      direction: [p(0.12, 0.2), p(0.28, 0.2)],
    })
  })

  it('will not close a boundary of fewer than three vertices', () => {
    let d = emptyPatternDraft('direction-zone')
    d = patternDraftAddPoint(d, p(0.1, 0.1))
    d = patternDraftAddPoint(d, p(0.3, 0.1))
    expect(canClosePatternRegion(d)).toBe(false)
    expect(closePatternRegion(d).phase).toBe('region')
  })

  it('undo walks back out of the direction phase into the boundary', () => {
    let d = emptyPatternDraft('direction-zone')
    for (const v of square) d = patternDraftAddPoint(d, v)
    d = closePatternRegion(d)
    d = patternDraftAddPoint(d, p(0.12, 0.2))
    d = patternDraftUndo(d)
    expect(d.vector).toEqual([])
    d = patternDraftUndo(d)
    expect(d.phase).toBe('region')
    d = patternDraftUndo(d)
    expect(d.boundary).toHaveLength(3)
  })

  it('undo on an empty draft is a no-op', () => {
    const d = emptyPatternDraft('pattern-direction')
    expect(patternDraftUndo(d)).toEqual(d)
  })

  it('never mutates the draft it is given', () => {
    const d = emptyPatternDraft('direction-zone')
    const next = patternDraftAddPoint(d, p(0.1, 0.1))
    expect(d.boundary).toEqual([])
    expect(next).not.toBe(d)
    expect(patternDraftSetCursor(d, p(0.5, 0.5)).cursor).toEqual(p(0.5, 0.5))
    expect(d.cursor).toBeNull()
  })

  it('reports a prop-shaped status for the toolbar', () => {
    let d = emptyPatternDraft('direction-zone')
    expect(patternToolStatus(d)).toMatchObject({
      tool: 'direction-zone',
      phase: 'region',
      pointsPlaced: 0,
      canCommit: false,
      canUndo: false,
      canCloseRegion: false,
    })
    for (const v of square) d = patternDraftAddPoint(d, v)
    expect(patternToolStatus(d).canCloseRegion).toBe(true)
    expect(patternToolStatus(d).pointsPlaced).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Items / labels
// ---------------------------------------------------------------------------

describe('pattern items', () => {
  const items: PatternItem[] = [
    zoneItem('z', square, [p(0.12, 0.2), p(0.28, 0.2)]),
    { kind: 'direction', id: 'pd', direction: [p(0.5, 0.1), p(0.5, 0.9)], level: 'page' },
    { kind: 'origin', id: 'o', point: p(0.2, 0.2) },
  ]

  it('projects zones into the domain shape, preserving order', () => {
    const zones = zonesOf([...items, zoneItem('z2', square, [p(0, 0), p(1, 1)], 5)])
    expect(zones.map((z) => z.id)).toEqual(['z', 'z2'])
    expect(zones[0]!.priority).toBeUndefined()
    expect(zones[1]!.priority).toBe(5)
  })

  it('projects origins into the shape the origin rule wants', () => {
    expect(originMarkupsOf(items)).toEqual([{ id: 'o', rings: [[p(0.2, 0.2)]] }])
  })

  it('labels an angle, and has no angle for an origin', () => {
    expect(patternItemAngle(items[1]!, PAGE)).toBe(90)
    expect(patternItemAngle(items[2]!, PAGE)).toBeNull()
    expect(formatAxisAngle(90)).toBe('90.0°')
    expect(formatAxisAngle(null)).toBe('—')
  })

  it('labels the angle of a non-square sheet in PDF points, not normalized', () => {
    const diagonal: PatternItem = {
      kind: 'direction',
      id: 'd',
      direction: [p(0.1, 0.1), p(0.2, 0.2)],
      level: 'page',
    }
    // normalized delta is 45 degrees; on a 3456x2592 sheet the real axis is not
    expect(patternItemAngle(diagonal, SHEET)).toBeCloseTo(36.87, 2)
    expect(patternItemAngle(diagonal, PAGE)).toBeCloseTo(45, 9)
  })

  it('feeds the domain resolver directly from items', () => {
    const r = resolvePatternDirection(p(0.2, 0.2), {
      page: PAGE,
      zones: zonesOf(items),
      pageDirection: [p(0.5, 0.1), p(0.5, 0.9)],
    })
    // inside the zone, so the zone wins over the page default
    expect(r?.source).toBe('zone')
    expect(r?.angleDegrees).toBe(0)

    const outside = resolvePatternDirection(p(0.8, 0.8), {
      page: PAGE,
      zones: zonesOf(items),
      pageDirection: [p(0.5, 0.1), p(0.5, 0.9)],
    })
    expect(outside?.source).toBe('page')
    expect(outside?.angleDegrees).toBe(90)
  })
})

// ---------------------------------------------------------------------------
// Overlay projection
// ---------------------------------------------------------------------------

describe('patternOverlaySet', () => {
  const items: PatternItem[] = [
    zoneItem('z', square, [p(0.12, 0.2), p(0.28, 0.2)]),
    { kind: 'direction', id: 'pd', direction: [p(0.5, 0.1), p(0.5, 0.9)], level: 'scope' },
    { kind: 'origin', id: 'o', point: p(0.2, 0.2) },
  ]

  it('emits viewer primitives in normalized coordinates', () => {
    const set = patternOverlaySet(items, PAGE)
    expect(set.polygons).toHaveLength(1)
    expect(set.dots).toEqual([
      { x: 0.2, y: 0.2, color: '#00a651', opacity: 1, r: 5, shape: 'diamond' },
    ])
    for (const poly of set.polygons) {
      for (const [x, y] of poly.poly) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(1)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(1)
      }
    }
  })

  it('caches a centroid on every polygon, as the culling pass requires', () => {
    const poly = patternOverlaySet(items, PAGE).polygons[0]!
    expect(poly.cx).toBeCloseTo(0.2, 12)
    expect(poly.cy).toBeCloseTo(0.2, 12)
  })

  it('dashes an inherited scope default and not a page direction', () => {
    const scopeItems: PatternItem[] = [
      { kind: 'direction', id: 'sd', direction: [p(0.5, 0.1), p(0.5, 0.9)], level: 'scope' },
    ]
    // shaft first, then the four arrow barbs; only the shaft carries the dash
    const scopeLines = patternOverlaySet(scopeItems, PAGE).lines
    expect(scopeLines).toHaveLength(5)
    expect(scopeLines[0]!.dashed).toBe(true)
    expect(scopeLines.slice(1).every((l) => !l.dashed)).toBe(true)
    const pageItems: PatternItem[] = [
      { kind: 'direction', id: 'pd', direction: [p(0.5, 0.1), p(0.5, 0.9)], level: 'page' },
    ]
    expect(patternOverlaySet(pageItems, PAGE).lines[0]!.dashed).toBe(false)
  })

  it('builds arrow barbs in PDF points so the head is not sheared', () => {
    // A horizontal direction on a 4:3 sheet: the two barbs at one tip must be
    // mirror images in POINT space, which they are not if built normalized.
    const horizontal: PatternItem[] = [
      { kind: 'direction', id: 'd', direction: [p(0.2, 0.5), p(0.8, 0.5)], level: 'page' },
    ]
    const lines = patternOverlaySet(horizontal, SHEET).lines
    const barbs = lines.slice(1)
    expect(barbs).toHaveLength(4)
    const dy = barbs.map((b) => (b.y2 - b.y1) * SHEET.height)
    const dx = barbs.map((b) => (b.x2 - b.x1) * SHEET.width)
    expect(Math.abs(dy[0]!)).toBeCloseTo(Math.abs(dy[1]!), 9)
    expect(Math.abs(dx[0]!)).toBeCloseTo(Math.abs(dx[1]!), 9)
    // barb arms are the length they were asked to be, in points
    expect(Math.hypot(dx[0]!, dy[0]!)).toBeCloseTo(Math.hypot(14, 14 * 0.45), 6)
  })
})

// ---------------------------------------------------------------------------
// Hit-testing
// ---------------------------------------------------------------------------

describe('hitTestPattern', () => {
  const items: PatternItem[] = [
    zoneItem('z', square, [p(0.15, 0.2), p(0.25, 0.2)]),
    { kind: 'origin', id: 'o', point: p(0.5, 0.5) },
  ]

  it('hits an origin near its point', () => {
    expect(hitTestPattern(502, 498, items, view, W, H)).toEqual({
      id: 'o',
      kind: 'origin',
      part: 'vertex',
      target: 'point',
      index: 0,
    })
    expect(hitTestPattern(560, 500, items, view, W, H)).toBeNull()
  })

  it('prefers a direction endpoint over the zone interior it sits in', () => {
    expect(hitTestPattern(150, 200, items, view, W, H)).toEqual({
      id: 'z',
      kind: 'zone',
      part: 'vertex',
      target: 'direction',
      index: 0,
    })
  })

  it('hits a zone boundary vertex', () => {
    expect(hitTestPattern(101, 102, items, view, W, H)).toEqual({
      id: 'z',
      kind: 'zone',
      part: 'vertex',
      target: 'boundary',
      index: 0,
    })
  })

  it('hits the direction shaft before the boundary edge', () => {
    expect(hitTestPattern(200, 201, items, view, W, H)).toEqual({
      id: 'z',
      kind: 'zone',
      part: 'edge',
      target: 'direction',
      index: 0,
    })
  })

  it('hits a boundary edge', () => {
    expect(hitTestPattern(200, 101, items, view, W, H)).toEqual({
      id: 'z',
      kind: 'zone',
      part: 'edge',
      target: 'boundary',
      index: 0,
    })
  })

  it('hits the zone interior', () => {
    expect(hitTestPattern(120, 280, items, view, W, H)).toEqual({
      id: 'z',
      kind: 'zone',
      part: 'inside',
      target: 'boundary',
      index: -1,
    })
  })

  it('treats a hole as outside the zone', () => {
    const donut: PatternItem[] = [
      {
        kind: 'zone',
        id: 'd',
        rings: [
          [p(0.1, 0.1), p(0.9, 0.1), p(0.9, 0.9), p(0.1, 0.9)],
          [p(0.4, 0.4), p(0.6, 0.4), p(0.6, 0.6), p(0.4, 0.6)],
        ],
        direction: [p(0.15, 0.2), p(0.85, 0.2)],
      },
    ]
    expect(hitTestPattern(500, 500, donut, view, W, H)).toBeNull()
    expect(hitTestPattern(200, 700, donut, view, W, H)?.part).toBe('inside')
  })

  it('misses everything on blank paper', () => {
    expect(hitTestPattern(900, 900, items, view, W, H)).toBeNull()
  })

  it('gives the topmost item when two overlap', () => {
    const stacked: PatternItem[] = [
      zoneItem('under', [p(0.1, 0.6), p(0.9, 0.6), p(0.9, 0.9), p(0.1, 0.9)], [
        p(0.2, 0.75),
        p(0.8, 0.75),
      ]),
      zoneItem('over', [p(0.2, 0.62), p(0.5, 0.62), p(0.5, 0.88), p(0.2, 0.88)], [
        p(0.25, 0.86),
        p(0.45, 0.86),
      ]),
    ]
    expect(hitTestPattern(300, 700, stacked, view, W, H)?.id).toBe('over')
  })
})

// ---------------------------------------------------------------------------
// Painters
// ---------------------------------------------------------------------------

describe('painters', () => {
  const items: PatternItem[] = [
    zoneItem('z', square, [p(0.15, 0.2), p(0.25, 0.2)]),
    { kind: 'direction', id: 'pd', direction: [p(0.5, 0.1), p(0.5, 0.9)], level: 'scope' },
    { kind: 'origin', id: 'o', point: p(0.5, 0.5) },
  ]

  const countOf = (calls: Array<{ name: string }>, name: string) =>
    calls.filter((c) => c.name === name).length

  it('paints items and balances save/restore', () => {
    const rec = recordingContext()
    drawPatternItems(rec.ctx, items, view, W, H)
    expect(countOf(rec.calls, 'save')).toBe(1)
    expect(countOf(rec.calls, 'restore')).toBe(1)
    expect(rec.text.length).toBeGreaterThan(0)
  })

  it('labels a direction with its axis angle', () => {
    const rec = recordingContext()
    drawPatternItems(rec.ctx, items, view, W, H)
    expect(rec.text).toContain('90.0°')
  })

  it('suppresses labels below the label zoom, like the viewer overlay', () => {
    const rec = recordingContext()
    drawPatternItems(rec.ctx, items, { ...view, zoom: 0.2 }, W, H)
    expect(rec.text).toHaveLength(0)
  })

  it('paints a draft in every phase without throwing', () => {
    let d = emptyPatternDraft('direction-zone')
    const empty = recordingContext()
    drawPatternDraft(empty.ctx, d, view, W, H)
    expect(empty.calls).toHaveLength(0)

    for (const v of square) d = patternDraftAddPoint(d, v)
    d = patternDraftSetCursor(d, p(0.05, 0.2))
    const region = recordingContext()
    drawPatternDraft(region.ctx, d, view, W, H)
    expect(countOf(region.calls, 'stroke')).toBeGreaterThan(0)

    d = patternDraftSetCursor(closePatternRegion(d), p(0.28, 0.2))
    d = patternDraftAddPoint(d, p(0.12, 0.2))
    const vector = recordingContext()
    drawPatternDraft(vector.ctx, d, view, W, H)
    expect(countOf(vector.calls, 'save')).toBe(1)
    expect(countOf(vector.calls, 'restore')).toBe(1)
  })
})
