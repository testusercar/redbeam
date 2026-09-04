import { describe, expect, it } from 'vitest'
import { regionArea } from './geometry.js'
import {
  boundaryRings,
  closeBinary,
  dilateBinary,
  erodeBinary,
  floodFree,
  simplifyRing,
  traceRegion,
  TRACE_DEFAULTS,
  type TraceOptions,
} from './trace.js'

// The real Barclays PKG A sheet, so tolerances in points mean what they mean
// on an actual drawing rather than on a unit square.
const PAGE = { width: 3456, height: 2592.24 }
/** Calibration measured in the app: 0.100299 drawing feet per PDF point. */
const FEET_PER_POINT = 0.100299

const px = (x: number) => x / PAGE.width
const py = (y: number) => y / PAGE.height

/** Segments from PDF-point coordinates, so tests read in the drawing's units. */
function segs(...lines: Array<[number, number, number, number]>): number[] {
  const out: number[] = []
  for (const [x1, y1, x2, y2] of lines) out.push(px(x1), py(y1), px(x2), py(y2))
  return out
}

/**
 * Four walls of a rectangle, optionally with a gap of `gap` points centred in
 * the bottom wall — a doorway.
 */
function room(
  left: number,
  top: number,
  right: number,
  bottom: number,
  gap = 0,
): Array<[number, number, number, number]> {
  const walls: Array<[number, number, number, number]> = [
    [left, top, right, top],
    [right, top, right, bottom],
    [left, bottom, left, top],
  ]
  if (gap <= 0) {
    walls.push([right, bottom, left, bottom])
  } else {
    const mid = (left + right) / 2
    walls.push([left, bottom, mid - gap / 2, bottom])
    walls.push([mid + gap / 2, bottom, right, bottom])
  }
  return walls
}

const ROOM = { left: 700, top: 800, right: 1400, bottom: 1300 }
const ROOM_AREA = (ROOM.right - ROOM.left) * (ROOM.bottom - ROOM.top)
const SEED = { x: px((ROOM.left + ROOM.right) / 2), y: py((ROOM.top + ROOM.bottom) / 2) }

describe('grid morphology', () => {
  it('dilates by Chebyshev radius', () => {
    const m = new Uint8Array(25)
    m[12] = 1 // centre of 5x5
    const d = dilateBinary(m, 5, 5, 1)
    // A 3x3 block, 9 cells.
    expect(d.reduce((a: number, b) => a + b, 0)).toBe(9)
    expect(d[6]).toBe(1)
    expect(d[0]).toBe(0)
  })

  it('erosion is the dual, and leaves the mask border alone', () => {
    const m = new Uint8Array(25).fill(1)
    // Everything set: erosion must not eat the border, because cells outside
    // the mask read as foreground. Otherwise every close() would shrink the
    // frame edge and the fill would "escape" through a border it invented.
    expect(erodeBinary(m, 5, 5, 1).reduce((a: number, b) => a + b, 0)).toBe(25)
  })

  it('closes a one-cell gap in a line without thickening the line', () => {
    const w = 9
    const h = 9
    const m = new Uint8Array(w * h)
    for (let x = 0; x < w; x++) if (x !== 4) m[4 * w + x] = 1
    const c = closeBinary(m, w, h, 1)
    expect(c[4 * w + 4]).toBe(1)
    // The rows above and below stay clear: close is not dilate. (Only away
    // from the mask border — erosion treats outside as foreground so that a
    // close near the frame edge cannot open a hole the fill escapes through.)
    expect(c[3 * w + 4]).toBe(0)
    expect(c[5 * w + 4]).toBe(0)
  })

  it('leaves a gap wider than 2r open', () => {
    const w = 15
    const h = 3
    const m = new Uint8Array(w * h)
    for (let x = 0; x < w; x++) if (x < 4 || x > 10) m[1 * w + x] = 1
    expect(closeBinary(m, w, h, 2)[1 * w + 7]).toBe(0)
  })
})

describe('floodFree', () => {
  it('fills only inside a closed box and reports no escape', () => {
    const w = 10
    const h = 10
    const wall = new Uint8Array(w * h)
    for (let i = 0; i < w; i++) {
      wall[2 * w + i] = 1
      wall[7 * w + i] = 1
    }
    for (let j = 2; j <= 7; j++) {
      wall[j * w + 2] = 1
      wall[j * w + 7] = 1
    }
    const r = floodFree(wall, w, h, 5 * w + 5)
    expect(r.escaped).toBe(0)
    expect(r.count).toBe(4 * 4)
  })

  it('reports escaped cells when the boundary is broken', () => {
    const w = 10
    const h = 10
    const wall = new Uint8Array(w * h)
    for (let j = 2; j <= 7; j++) {
      wall[j * w + 2] = 1
      wall[j * w + 7] = 1
    }
    const r = floodFree(wall, w, h, 5 * w + 5)
    expect(r.escaped).toBeGreaterThan(0)
  })

  it('visits every cell at most once even on an empty grid', () => {
    const w = 200
    const h = 200
    const r = floodFree(new Uint8Array(w * h), w, h, 0)
    expect(r.count).toBe(w * h)
  })
})

describe('boundaryRings', () => {
  it('traces a solid rectangle as one ring with positive area', () => {
    const w = 10
    const h = 10
    const fill = new Uint8Array(w * h)
    for (let y = 3; y < 7; y++) for (let x = 2; x < 8; x++) fill[y * w + x] = 1
    const rings = boundaryRings(fill, w, h, 8)
    expect(rings).toHaveLength(1)
    // 6 wide, 4 tall -> 20 boundary edges.
    expect(rings[0]!).toHaveLength(20)
  })

  it('returns the hole as a second ring', () => {
    const w = 12
    const h = 12
    const fill = new Uint8Array(w * h)
    for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) fill[y * w + x] = 1
    fill[5 * w + 5] = 0
    const rings = boundaryRings(fill, w, h, 8)
    expect(rings).toHaveLength(2)
  })

  it('terminates on a diagonal checkerboard, the worst case for the pinch rule', () => {
    const w = 40
    const h = 40
    const fill = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x + y) % 2 === 0) fill[y * w + x] = 1
    const t0 = Date.now()
    const rings = boundaryRings(fill, w, h, 16)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(rings.length).toBeGreaterThan(0)
  })
})

describe('simplifyRing', () => {
  it('reduces a rasterized staircase back to four corners', () => {
    // The exact shape docs/PORTING.md warns about: a rectilinear ring is what
    // makes the Qt build's `_simplify` spin forever.
    const ring: Array<{ x: number; y: number }> = []
    for (let x = 0; x <= 100; x++) ring.push({ x, y: 0 })
    for (let y = 1; y <= 60; y++) ring.push({ x: 100, y })
    for (let x = 99; x >= 0; x--) ring.push({ x, y: 60 })
    for (let y = 59; y >= 1; y--) ring.push({ x: 0, y })
    const out = simplifyRing(ring, 0.5)
    expect(out.length).toBe(4)
    expect(Math.abs(regionArea([out]) - 6000)).toBeLessThan(1)
  })

  it('terminates and honours maxVertices on a ring it cannot simplify', () => {
    // A circle has no collinear runs at all, so DP keeps re-splitting until
    // epsilon relaxation stops it. That is the bounded path, not a loop.
    const ring = Array.from({ length: 4000 }, (_, i) => ({
      x: Math.cos((i / 4000) * Math.PI * 2) * 500,
      y: Math.sin((i / 4000) * Math.PI * 2) * 500,
    }))
    const t0 = Date.now()
    const out = simplifyRing(ring, 0.001, 64)
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(out.length).toBeLessThanOrEqual(64)
    // Still recognisably the circle: within 2% of pi r^2.
    expect(Math.abs(regionArea([out]) - Math.PI * 500 * 500) / (Math.PI * 500 * 500)).toBeLessThan(0.02)
  })

  it('leaves a triangle alone', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]
    expect(simplifyRing(tri, 1)).toHaveLength(3)
  })
})

describe('traceRegion', () => {
  const trace = (segments: number[], seed = SEED, options: TraceOptions = {}) =>
    traceRegion({ segments, seed, page: PAGE, options })

  it('traces a closed room to within 2% of its true area', () => {
    const r = trace(segs(...room(ROOM.left, ROOM.top, ROOM.right, ROOM.bottom)))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Math.abs(r.areaPoints2 - ROOM_AREA) / ROOM_AREA).toBeLessThan(0.02)
    expect(r.ring.length).toBe(4)
    expect(r.diagnostics.escapedCells).toBe(0)
  })

  it('returns rings that regionArea measures identically to a hand-drawn ring', () => {
    const r = trace(segs(...room(ROOM.left, ROOM.top, ROOM.right, ROOM.bottom)))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Exactly the path scope.ts takes: normalized rings -> PDF points -> area.
    const inPoints = r.region.map((ring) => ring.map((p) => ({ x: p.x * PAGE.width, y: p.y * PAGE.height })))
    expect(regionArea(inPoints)).toBeCloseTo(r.areaPoints2, 6)
    for (const ring of r.region) {
      for (const p of ring) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(1)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(1)
      }
    }
  })

  it('bridges a doorway narrower than the tolerance', () => {
    const r = trace(segs(...room(ROOM.left, ROOM.top, ROOM.right, ROOM.bottom, 14)))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Math.abs(r.areaPoints2 - ROOM_AREA) / ROOM_AREA).toBeLessThan(0.03)
  })

  it('bridges a real 3 ft door leaf only when calibration raises the tolerance', () => {
    const doorPoints = 3 / FEET_PER_POINT // ~29.9 pt, a 3 ft leaf on this sheet
    const walls = segs(...room(ROOM.left, ROOM.top, ROOM.right, ROOM.bottom, doorPoints))
    // maxExpansions 0 pins the cell size: an expanded frame has coarser cells,
    // and the +/- one cell of quantization moves the effective tolerance.
    expect(trace(walls, SEED, { maxExpansions: 0 }).ok).toBe(false)
    const withCal = trace(walls, SEED, {
      maxExpansions: 0,
      feetPerPoint: FEET_PER_POINT,
      bridgeGapFeet: 3.5,
    })
    expect(withCal.ok).toBe(true)
  })

  it('has a bridge threshold that tracks the tolerance it was given', () => {
    const at = (gap: number, options: TraceOptions) =>
      trace(segs(...room(ROOM.left, ROOM.top, ROOM.right, ROOM.bottom, gap)), SEED, {
        maxExpansions: 0,
        ...options,
      }).ok
    // Default 24 pt: closed at 24, open at 30.
    expect(at(24, {})).toBe(true)
    expect(at(30, {})).toBe(false)
    // 3.5 ft = 34.9 pt at this calibration: closed at 35, open at 40.
    const cal = { feetPerPoint: FEET_PER_POINT, bridgeGapFeet: 3.5 }
    expect(at(35, cal)).toBe(true)
    expect(at(40, cal)).toBe(false)
  })

  it('fails with a reason, not a spin, when a gap is too wide to bridge', () => {
    const t0 = Date.now()
    const r = trace(segs(...room(ROOM.left, ROOM.top, ROOM.right, ROOM.bottom, 220)))
    const ms = Date.now() - t0
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('open')
    expect(r.message).toContain('not enclosed')
    // Two frame expansions plus the first attempt, all bounded.
    expect(r.diagnostics.expansions).toBe(TRACE_DEFAULTS.maxExpansions)
    expect(ms).toBeLessThan(10_000)
  })

  it('terminates on open space with nothing but noise around the click', () => {
    let s = 12345
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const noise: number[] = []
    for (let i = 0; i < 4000; i++) {
      const x = rnd()
      const y = rnd()
      noise.push(x, y, x + (rnd() - 0.5) * 0.01, y + (rnd() - 0.5) * 0.01)
    }
    const t0 = Date.now()
    const r = traceRegion({ segments: noise, seed: { x: 0.5, y: 0.5 }, page: PAGE })
    const ms = Date.now() - t0
    expect(r.ok).toBe(false)
    expect(ms).toBeLessThan(10_000)
  })

  it('nudges off a click that lands on a wall, onto the enclosed side', () => {
    const walls = segs(...room(ROOM.left, ROOM.top, ROOM.right, ROOM.bottom))
    const onWall = { x: px(ROOM.left), y: py((ROOM.top + ROOM.bottom) / 2) }
    const r = traceRegion({ segments: walls, seed: onWall, page: PAGE })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // The free cells next to the wall are on BOTH sides; the one that gives an
    // enclosed region has to win, not whichever the spiral scan reached first.
    expect(Math.abs(r.areaPoints2 - ROOM_AREA) / ROOM_AREA).toBeLessThan(0.05)
  })

  it('gives up with seed-on-ink when the click is buried in solid ink', () => {
    const solid: Array<[number, number, number, number]> = []
    for (let y = 1200; y <= 1400; y += 1) solid.push([1000, y, 1200, y])
    const r = traceRegion({
      segments: segs(...solid),
      seed: { x: px(1100), y: py(1300) },
      page: PAGE,
      options: { seedSearchCells: 2 },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('seed-on-ink')
  })

  it('subtracts an interior column as an opening', () => {
    const walls = room(ROOM.left, ROOM.top, ROOM.right, ROOM.bottom)
    const col = room(1000, 1000, 1100, 1100)
    const colArea = 100 * 100
    const r = trace(segs(...walls, ...col), { x: px(800), y: py(900) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.region.length).toBe(2)
    expect(Math.abs(r.areaPoints2 - (ROOM_AREA - colArea)) / ROOM_AREA).toBeLessThan(0.03)
  })

  it('drops interior noise below the hole floor instead of subtracting it', () => {
    const walls = room(ROOM.left, ROOM.top, ROOM.right, ROOM.bottom)
    const speck = room(1000, 1000, 1012, 1012)
    const r = trace(segs(...walls, ...speck), { x: px(800), y: py(900) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.region.length).toBe(1)
    expect(Math.abs(r.areaPoints2 - ROOM_AREA) / ROOM_AREA).toBeLessThan(0.02)
  })

  it('flows around hatch ticks spaced wider than the bridge tolerance', () => {
    const walls = room(ROOM.left, ROOM.top, ROOM.right, ROOM.bottom)
    const hatch: Array<[number, number, number, number]> = []
    for (let x = ROOM.left + 60; x < ROOM.right - 60; x += 60) {
      for (let y = ROOM.top + 60; y < ROOM.bottom - 60; y += 60) hatch.push([x, y, x + 12, y + 12])
    }
    const r = trace(segs(...walls, ...hatch))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Math.abs(r.areaPoints2 - ROOM_AREA) / ROOM_AREA).toBeLessThan(0.06)
  })

  it('rejects a click that is not on the page', () => {
    const r = traceRegion({ segments: segs([0, 0, 100, 100]), seed: { x: 1.4, y: 0.2 }, page: PAGE })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('seed-outside-page')
  })

  it('reports no-segments rather than tracing nothing', () => {
    const r = traceRegion({ segments: [], seed: SEED, page: PAGE })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('no-segments')
  })

  it('reports too-small rather than returning a sliver', () => {
    const r = trace(segs(...room(ROOM.left, ROOM.top, ROOM.right, ROOM.bottom)), SEED, {
      minAreaCells: 10_000_000,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('too-small')
  })

  it('reports too-large when the fill swallows the frame', () => {
    // Two crossing lines and nothing else: the click is not inside anything,
    // but with expansion disabled the fill is still bounded by the frame.
    const r = trace(segs([0, 1300, 3456, 1300], [1100, 0, 1100, 2592]), { x: px(1500), y: py(900) }, {
      maxExpansions: 0,
      maxFillFraction: 0.1,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(['open', 'too-large']).toContain(r.reason)
  })

  it('is stable across the grid resolutions a caller might pick', () => {
    const walls = segs(...room(ROOM.left, ROOM.top, ROOM.right, ROOM.bottom))
    for (const gridCells of [256, 512, 1024]) {
      const r = trace(walls, SEED, { gridCells })
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(Math.abs(r.areaPoints2 - ROOM_AREA) / ROOM_AREA).toBeLessThan(0.03)
    }
  })

  it('caps the grid however large the frame gets', () => {
    const walls = segs(...room(200, 200, 3200, 2400))
    const r = trace(walls, { x: 0.5, y: 0.5 }, { frameSizePoints: 20_000, gridCells: 4000, maxGridCells: 250_000 })
    expect(r.diagnostics.gridWidth * r.diagnostics.gridHeight).toBeLessThanOrEqual(250_000 * 1.05)
  })
})
