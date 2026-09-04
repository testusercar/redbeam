import { describe, expect, it } from 'vitest'
import {
  extractPageGeometry,
  multiplyMatrix,
  normalizePathPoint,
  transformPoint,
  IDENTITY,
  PAGEOBJ_FORM,
  PAGEOBJ_IMAGE,
  PAGEOBJ_PATH,
  PAGEOBJ_TEXT,
  SEGMENT_BEZIERTO,
  SEGMENT_LINETO,
  SEGMENT_MOVETO,
  type GeometryBackend,
  type Matrix,
} from './geometry.js'
import type { PageBox } from './text.js'

/**
 * The real page box of the Barclays PKG A sheet, measured with
 * FPDF_GetPageBoundingBox on page 48 of apps/desktop/public/sample.pdf.
 *
 * It is origin-centred. FPDF_GetPageWidthF/HeightF report 3456 x 2592.24 and
 * say nothing at all about the offset, which is exactly how this bug shipped
 * twice.
 */
const REAL_BOX: PageBox = { left: -1728, bottom: -1296.12, right: 1728, top: 1296.12 }
/** A page box that does start at (0,0), for contrast. */
const ZERO_BOX: PageBox = { left: 0, bottom: 0, right: 3456, top: 2592.24 }

interface FakeObject {
  type: number
  matrix?: Matrix
  bounds?: PageBox
  /** [type, x, y, close] per path segment. */
  segments?: Array<[number, number, number, boolean?]>
  children?: FakeObject[]
}

function fakeBackend(objects: FakeObject[], box: PageBox = REAL_BOX): GeometryBackend {
  // Handles are 1-based indices into a flat registry, because 0 is PDFium's
  // "failed" and must never be a valid handle.
  const registry: FakeObject[] = []
  const id = (o: FakeObject) => {
    const at = registry.indexOf(o)
    if (at >= 0) return at + 1
    registry.push(o)
    return registry.length
  }
  const get = (handle: number) => registry[handle - 1]!
  for (const o of objects) id(o)
  return {
    pageBox: () => box,
    countObjects: () => objects.length,
    getObject: (_page, i) => id(objects[i]!),
    objectType: (h) => get(h).type,
    objectMatrix: (h) => get(h).matrix ?? null,
    objectBounds: (h) => get(h).bounds ?? null,
    formCount: (h) => get(h).children?.length ?? 0,
    formObject: (h, i) => id(get(h).children![i]!),
    pathSegmentCount: (h) => get(h).segments?.length ?? 0,
    // A path segment handle encodes (object, index) so the backend stays
    // stateless, matching how the worker hands back opaque PDFium pointers.
    pathSegment: (h, i) => h * 1000 + i + 1,
    segmentType: (seg) => segAt(seg)[0],
    segmentClose: (seg) => segAt(seg)[3] === true,
    segmentPoint: (seg) => ({ x: segAt(seg)[1], y: segAt(seg)[2] }),
  }

  function segAt(seg: number): [number, number, number, boolean?] {
    const h = Math.floor(seg / 1000)
    const i = (seg % 1000) - 1
    return get(h).segments![i]!
  }
}

/** A closed rectangle path in PDF user space. */
function rectPath(l: number, b: number, r: number, t: number): FakeObject {
  return {
    type: PAGEOBJ_PATH,
    segments: [
      [SEGMENT_MOVETO, l, b],
      [SEGMENT_LINETO, r, b],
      [SEGMENT_LINETO, r, t],
      [SEGMENT_LINETO, l, t],
      [SEGMENT_LINETO, l, b],
    ],
  }
}

describe('normalizePathPoint — the page-box origin', () => {
  it('maps the real origin-centred box onto [0,1]', () => {
    expect(normalizePathPoint(REAL_BOX, -1728, 1296.12)).toEqual({ x: 0, y: 0 })
    expect(normalizePathPoint(REAL_BOX, 1728, -1296.12)).toEqual({ x: 1, y: 1 })
    const mid = normalizePathPoint(REAL_BOX, 0, 0)
    expect(mid.x).toBeCloseTo(0.5, 12)
    expect(mid.y).toBeCloseTo(0.5, 12)
  })

  it('is the bug when the origin is assumed away', () => {
    // The exact mistake docs/PORTING.md records: normalize a point that lives
    // in the origin-centred box against a box assumed to start at (0,0).
    const centreOfSheet = normalizePathPoint(ZERO_BOX, 0, 0)
    expect(centreOfSheet).toEqual({ x: 0, y: 1 })
    // Everything on the left half of the sheet goes negative...
    expect(normalizePathPoint(ZERO_BOX, -1000, 0).x).toBeLessThan(0)
    // ...and everything below the middle goes past 1.
    expect(normalizePathPoint(ZERO_BOX, 0, -1000).y).toBeGreaterThan(1)
  })

  it('flips y so it grows downward, matching every markup', () => {
    // Top of the box is y = 0; PDF user space has y growing UP.
    expect(normalizePathPoint(REAL_BOX, 0, 1296.12).y).toBeCloseTo(0, 12)
    expect(normalizePathPoint(REAL_BOX, 0, -1296.12).y).toBeCloseTo(1, 12)
  })

  it('does not clamp, so an off-page point can be dropped rather than smeared on the edge', () => {
    // text.ts clamps because a highlight has to stay on screen. Here a clamped
    // point would become a wall along the sheet edge that the drawing does not
    // have, and the tracer would believe it.
    expect(normalizePathPoint(REAL_BOX, -3000, 0).x).toBeLessThan(0)
  })

  it('survives a degenerate box instead of dividing by zero', () => {
    expect(normalizePathPoint({ left: 5, bottom: 5, right: 5, top: 5 }, 5, 5)).toEqual({ x: 0, y: 0 })
  })
})

describe('matrix', () => {
  it('composes inner-then-outer', () => {
    const scale: Matrix = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }
    const move: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }
    const both = multiplyMatrix(scale, move)
    expect(transformPoint(both, 3, 4)).toEqual({ x: 16, y: 28 })
  })

  it('is the identity for the identity', () => {
    expect(transformPoint(IDENTITY, -7, 11)).toEqual({ x: -7, y: 11 })
  })
})

describe('extractPageGeometry', () => {
  const opts = { minLengthPoints: 0 }

  it('emits normalized segments in [0,1] for a rectangle on the real box', () => {
    // A 345.6 x 259.2 pt rectangle sitting one tenth in from the box origin.
    const g = extractPageGeometry(fakeBackend([rectPath(-1382.4, -1036.9, -1036.8, -777.7)]), 1, 0, opts)
    expect(g.segmentCount).toBe(4)
    for (let i = 0; i < g.segments.length; i++) {
      expect(g.segments[i]).toBeGreaterThanOrEqual(0)
      expect(g.segments[i]).toBeLessThanOrEqual(1)
    }
    // Left edge of the rect: (-1382.4 + 1728) / 3456 = 0.1
    expect(g.segments[0]).toBeCloseTo(0.1, 4)
    expect(g.box).toEqual(REAL_BOX)
  })

  it('keeps only path objects', () => {
    const g = extractPageGeometry(
      fakeBackend([
        { type: PAGEOBJ_TEXT, segments: [[SEGMENT_MOVETO, 0, 0], [SEGMENT_LINETO, 100, 100]] },
        { type: PAGEOBJ_IMAGE, segments: [[SEGMENT_MOVETO, 0, 0], [SEGMENT_LINETO, 100, 100]] },
        rectPath(-100, -100, 100, 100),
      ]),
      1,
      0,
      opts,
    )
    expect(g.pathObjects).toBe(1)
    expect(g.segmentCount).toBe(4)
  })

  it('applies the object matrix', () => {
    const g = extractPageGeometry(
      fakeBackend([
        {
          type: PAGEOBJ_PATH,
          matrix: { a: 1, b: 0, c: 0, d: 1, e: 1728, f: 1296.12 },
          segments: [
            [SEGMENT_MOVETO, -1728, -1296.12],
            [SEGMENT_LINETO, -1728, 0],
          ],
        },
      ]),
      1,
      0,
      opts,
    )
    // Translated to (0, 0) in user space, which is the centre of the sheet.
    expect(g.segments[0]).toBeCloseTo(0.5, 6)
    expect(g.segments[1]).toBeCloseTo(0.5, 6)
  })

  it('composes ancestor Form XObject matrices, so nested paths land in page space', () => {
    // A path in form-local space around the origin, inside a form that moves it
    // to the middle of the sheet. Without the composition it normalizes to 0.5
    // of nothing and gets thrown away by the clip.
    const g = extractPageGeometry(
      fakeBackend([
        {
          type: PAGEOBJ_FORM,
          matrix: { a: 1, b: 0, c: 0, d: 1, e: 500, f: 300 },
          children: [
            {
              type: PAGEOBJ_PATH,
              matrix: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 },
              segments: [
                [SEGMENT_MOVETO, 0, 0],
                [SEGMENT_LINETO, 100, 100],
              ],
            },
          ],
        },
      ]),
      1,
      0,
      opts,
    )
    expect(g.segmentCount).toBe(1)
    // (0,0) scaled by 2 then moved by (500, 300) = (500, 300).
    expect(g.segments[0]).toBeCloseTo((500 + 1728) / 3456, 6)
    // (100,100) -> (200,200) -> (700, 500).
    expect(g.segments[2]).toBeCloseTo((700 + 1728) / 3456, 6)
  })

  it('stops at maxDepth instead of following nesting forever', () => {
    let leaf: FakeObject = {
      type: PAGEOBJ_PATH,
      segments: [
        [SEGMENT_MOVETO, 0, 0],
        [SEGMENT_LINETO, 100, 100],
      ],
    }
    for (let i = 0; i < 20; i++) leaf = { type: PAGEOBJ_FORM, children: [leaf] }
    const g = extractPageGeometry(fakeBackend([leaf]), 1, 0, { ...opts, maxDepth: 3 })
    expect(g.segmentCount).toBe(0)
  })

  it('flattens a bezier into chords', () => {
    const g = extractPageGeometry(
      fakeBackend([
        {
          type: PAGEOBJ_PATH,
          segments: [
            [SEGMENT_MOVETO, 0, 0],
            [SEGMENT_BEZIERTO, 0, 400],
            [SEGMENT_BEZIERTO, 400, 400],
            [SEGMENT_BEZIERTO, 400, 0],
          ],
        },
      ]),
      1,
      0,
      { ...opts, curveSteps: 8 },
    )
    expect(g.segmentCount).toBe(8)
    // Chain: each chord starts where the last ended.
    for (let i = 1; i < g.segmentCount; i++) {
      expect(g.segments[i * 4]).toBeCloseTo(g.segments[(i - 1) * 4 + 2]!, 6)
      expect(g.segments[i * 4 + 1]).toBeCloseTo(g.segments[(i - 1) * 4 + 3]!, 6)
    }
    // Ends on the curve's endpoint.
    expect(g.segments[g.segmentCount * 4 - 2]).toBeCloseTo((400 + 1728) / 3456, 5)
  })

  it('emits the closing chord PDFium does not hand you', () => {
    const g = extractPageGeometry(
      fakeBackend([
        {
          type: PAGEOBJ_PATH,
          segments: [
            [SEGMENT_MOVETO, -400, -400],
            [SEGMENT_LINETO, 400, -400],
            [SEGMENT_LINETO, 400, 400, true],
          ],
        },
      ]),
      1,
      0,
      opts,
    )
    expect(g.segmentCount).toBe(3)
    const last = g.segmentCount - 1
    expect(g.segments[last * 4 + 2]).toBeCloseTo((-400 + 1728) / 3456, 6)
  })

  it('drops segments shorter than minLengthPoints', () => {
    const tick = (x: number): FakeObject => ({
      type: PAGEOBJ_PATH,
      segments: [
        [SEGMENT_MOVETO, x, 0],
        [SEGMENT_LINETO, x + 0.4, 0],
      ],
    })
    const g = extractPageGeometry(
      fakeBackend([tick(0), tick(100), rectPath(-500, -500, 500, 500)]),
      1,
      0,
      { minLengthPoints: 1 },
    )
    expect(g.droppedShort).toBe(2)
    expect(g.segmentCount).toBe(4)
  })

  it('rejects objects outside the clip on their bounds, without reading segments', () => {
    const far: FakeObject = {
      ...rectPath(1000, 1000, 1200, 1200),
      bounds: { left: 1000, bottom: 1000, right: 1200, top: 1200 },
    }
    const near: FakeObject = {
      ...rectPath(-1700, 1200, -1600, 1280),
      bounds: { left: -1700, bottom: 1200, right: -1600, top: 1280 },
    }
    const g = extractPageGeometry(fakeBackend([far, near]), 1, 0, {
      ...opts,
      clip: { x0: 0, y0: 0, x1: 0.1, y1: 0.1 },
    })
    expect(g.clippedObjects).toBe(1)
    expect(g.segmentCount).toBe(4)
  })

  it('drops points outside the page box rather than clamping them onto its edge', () => {
    const g = extractPageGeometry(
      fakeBackend([
        {
          type: PAGEOBJ_PATH,
          segments: [
            [SEGMENT_MOVETO, 0, 0],
            [SEGMENT_LINETO, 99999, 0],
          ],
        },
      ]),
      1,
      0,
      opts,
    )
    expect(g.segmentCount).toBe(0)
    expect(g.droppedOffPage).toBe(1)
  })

  it('reports truncation instead of silently returning half a page', () => {
    const many = Array.from({ length: 50 }, (_, i) => rectPath(-500 + i, -500, 500, 500))
    const g = extractPageGeometry(fakeBackend(many), 1, 0, { ...opts, maxSegments: 10 })
    expect(g.segmentCount).toBe(10)
    expect(g.truncated).toBe(true)
  })

  it('does not draw from the origin when a subpath starts with a LINETO', () => {
    // A path with no MOVETO has no current point. Drawing from (0,0) would
    // streak a segment from the centre of the sheet to the geometry.
    const g = extractPageGeometry(
      fakeBackend([
        {
          type: PAGEOBJ_PATH,
          segments: [
            [SEGMENT_LINETO, -1000, -1000],
            [SEGMENT_LINETO, -900, -1000],
          ],
        },
      ]),
      1,
      0,
      opts,
    )
    expect(g.segmentCount).toBe(1)
    expect(g.segments[0]).toBeCloseTo((-1000 + 1728) / 3456, 6)
  })

  it('counts objects and reports timing', () => {
    const g = extractPageGeometry(fakeBackend([rectPath(-100, -100, 100, 100)]), 1, 3, {
      ...opts,
      now: (() => {
        let t = 0
        return () => (t += 5)
      })(),
    })
    expect(g.page).toBe(3)
    expect(g.pageObjects).toBe(1)
    expect(g.ms).toBe(5)
  })
})
