/**
 * Finish-region tracing: click inside a room, get its boundary as a ring.
 *
 * Ported in approach from the Qt build's `redbeam_trace_finish_region`
 * (`okular-redbeam/redbeam-mcp-server/index.js` in the archived Qt build, the
 * `trace_candidates`
 * function of the embedded Python). That implementation:
 *
 *   1. rasterizes the page's vector segments into a small grid,
 *   2. runs a morphological CLOSE to bridge the gaps construction drawings
 *      leave — doorways, line joins, dimension breaks,
 *   3. pulls contours back out and simplifies them.
 *
 * All three steps are kept. One thing is deliberately different: the Qt build
 * took `RETR_EXTERNAL` contours of the whole region and then *scored* them
 * against the user's rubber-band rectangle, which finds the outline of the ink
 * rather than the room. Here the fill is **seeded at the click point**, which
 * is what the feature actually means: the region you get is the one you
 * clicked in, not the highest-scoring blob nearby. Everything downstream
 * (bridge, recover, contour, simplify) is the same idea as the original.
 *
 * ## Why a raster and not a planar graph
 *
 * A planar arrangement of 400,000 segments with tolerant snapping is a much
 * bigger, much slower, much less forgiving piece of machinery, and it has to
 * be *told* how to jump a doorway. A grid gets gap bridging for free from a
 * dilate/erode pair, and its cost is bounded by the grid, not by how pathological
 * the input is. The trade is quantization: the boundary lands on a cell edge,
 * so the tolerance model below is stated in cells and PDF points, not in
 * "exact".
 *
 * ## Termination
 *
 * `docs/PORTING.md` names `_simplify` in `redbeamtakeoffonnxworker.py:305` as a
 * livelock: an unbounded `while changed:` that can never converge on a
 * rectilinear ring. Nothing here has that shape.
 *
 *   - dilate/erode: fixed pass count, radius capped.
 *   - flood fill: explicit stack, every cell entered at most once.
 *   - contour walk: consumes one boundary edge per step; edges are finite and
 *     never re-enter the pool. A step cap is asserted anyway.
 *   - simplification: Douglas-Peucker over strictly shrinking index intervals
 *     (no `while changed`), with a capped number of epsilon retries.
 *
 * Every exit is either a ring or a `{ ok: false, reason }` — never a spin.
 */

import { regionArea, signedPolygonArea, type Point, type Polygon, type Region } from './geometry.js'

/** Page box dimensions in PDF points. Tolerances below are in the same unit. */
export interface TracePageSize {
  width: number
  height: number
}

/** Normalized [0,1] axis-aligned frame, y down — the same convention as markups. */
export interface TraceFrame {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface TraceOptions {
  /**
   * Side of the square search frame around the click, in PDF points.
   *
   * Bounds the work: nothing outside it is rasterized. On the Barclays sheet
   * (3456 x 2592 pt, calibrated 0.100299 ft/pt) the default 1200 pt is a
   * ~120 ft box, which comfortably contains any room and is 1/8 of the sheet.
   */
  frameSizePoints?: number
  /**
   * Widest gap in the drawing's ink that should still be treated as closed,
   * in PDF points. This is the single most important knob; see the tolerance
   * notes on `traceRegion`.
   */
  bridgeGapPoints?: number
  /** Page calibration. When given, `bridgeGapFeet` takes over from `bridgeGapPoints`. */
  feetPerPoint?: number
  /** Bridge gap expressed the way an estimator thinks about it. Needs `feetPerPoint`. */
  bridgeGapFeet?: number
  /** Cells across the frame's longer side. Higher is more faithful and slower. */
  gridCells?: number
  /** Hard ceiling on total cells, whatever `gridCells` and the frame ask for. */
  maxGridCells?: number
  /** Times the frame may double when the fill escapes it. */
  maxExpansions?: number
  /** Segments rasterized before extraction is treated as truncated. */
  maxSegments?: number
  /** Radius, in cells, of the search for a free cell when the click lands on ink. */
  seedSearchCells?: number
  /** Smallest fill, in cells, that counts as a region rather than a crack. */
  minAreaCells?: number
  /** Fill larger than this share of the frame is treated as "not a room". */
  maxFillFraction?: number
  /** Douglas-Peucker tolerance in PDF points. Raised to 1.2 cells if the grid is coarser. */
  simplifyPoints?: number
  /** Vertices per ring after simplification. Exceeding it relaxes epsilon, bounded. */
  maxVertices?: number
  /** Cells the finished fill grows back into wall, undoing the raster's own thickness. */
  recoverCells?: number
  /** Rings returned, outer plus holes. */
  maxRings?: number
  /** Holes smaller than this share of the outer ring are dropped as noise. */
  minHoleFraction?: number
}

export type TraceFailureReason =
  /** Nothing to rasterize — the page has no vector geometry in the frame. */
  | 'no-segments'
  /** The click is not on the page. */
  | 'seed-outside-page'
  /** The click landed on ink and no free cell was found nearby. */
  | 'seed-on-ink'
  /** The fill reached the edge of the search frame and the frame cannot grow further. */
  | 'open'
  /** The enclosed area is too small to be a region. */
  | 'too-small'
  /** The fill swallowed the frame — the click was not inside anything. */
  | 'too-large'
  /** A fill with no traceable boundary. Should not happen; reported rather than assumed. */
  | 'no-boundary'
  /** A ring that collapsed to fewer than three distinct vertices. */
  | 'degenerate'

export interface TraceDiagnostics {
  frame: TraceFrame
  gridWidth: number
  gridHeight: number
  /** Size of one cell in PDF points. The floor on every tolerance below. */
  cellPoints: number
  /** Bridge radius actually used, in cells. */
  bridgeCells: number
  expansions: number
  segmentsRasterized: number
  segmentsSkipped: number
  truncated: boolean
  filledCells: number
  /** Cells on the frame border the fill reached. Non-zero means it escaped. */
  escapedCells: number
  ringCount: number
  rawVertexCount: number
  vertexCount: number
  ms: number
}

export interface TraceSuccess {
  ok: true
  /**
   * Rings in NORMALIZED page coordinates [0,1], y down — exactly the shape
   * `Markup.rings` holds and `regionArea` consumes, so a traced region
   * measures identically to a hand-drawn one. Outer ring first; any further
   * rings are interior obstacles at odd nesting depth (columns, casework).
   */
  region: Region
  /** The outer ring, for callers that only want one. Also `region[0]`. */
  ring: Polygon
  /** Enclosed area in PDF points squared, openings already removed. */
  areaPoints2: number
  diagnostics: TraceDiagnostics
}

export interface TraceFailure {
  ok: false
  reason: TraceFailureReason
  message: string
  diagnostics: TraceDiagnostics
}

export type TraceResult = TraceSuccess | TraceFailure

export interface TraceInput {
  /**
   * Flat segment list `[x1, y1, x2, y2, ...]` in normalized page coordinates
   * [0,1], y down. This is exactly `PageGeometry.segments` from
   * `@redbeam/viewer`'s `geometry.ts`; it is `ArrayLike<number>` rather than a
   * `Float32Array` so tests can pass a plain array and the domain package
   * stays free of any viewer import.
   */
  segments: ArrayLike<number>
  /** The click, normalized [0,1], y down. */
  seed: Point
  /** Page box in PDF points. Every tolerance in `options` is in this unit. */
  page: TracePageSize
  options?: TraceOptions
  now?: () => number
}

export const TRACE_DEFAULTS = {
  frameSizePoints: 1200,
  bridgeGapPoints: 24,
  bridgeGapFeet: 3.5,
  gridCells: 512,
  maxGridCells: 4_000_000,
  maxExpansions: 2,
  maxSegments: 500_000,
  seedSearchCells: 6,
  minAreaCells: 40,
  maxFillFraction: 0.85,
  simplifyPoints: 2,
  maxVertices: 240,
  recoverCells: 1,
  maxRings: 16,
  minHoleFraction: 0.005,
} as const

/** Ceiling on the bridge radius in cells. Beyond this, closing costs more than it buys. */
const MAX_BRIDGE_CELLS = 48
/** Ceiling on raw contour vertices before a ring is called degenerate. */
const MAX_RAW_VERTICES = 400_000
/** Epsilon relaxations allowed when a simplified ring is still too detailed. */
const MAX_SIMPLIFY_RETRIES = 8
/**
 * Free cells tried when the click lands on ink. Small on purpose: this is a
 * nudge off a wall, not a search for the nearest room.
 */
const MAX_SEED_CANDIDATES = 8

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// --------------------------------------------------------------- grid ops --

/**
 * Chebyshev (square-structuring-element) dilation of a binary mask.
 *
 * Separable and O(w*h) regardless of radius: a forward and a backward pass per
 * axis, each tracking the last set index. Cells outside the mask count as
 * empty, which is what makes the erosion below leave the border alone instead
 * of eating it.
 */
export function dilateBinary(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src.slice()
  const mid = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let last = -1 - r
    for (let x = 0; x < w; x++) {
      if (src[row + x]) last = x
      if (x - last <= r) mid[row + x] = 1
    }
    last = w + r
    for (let x = w - 1; x >= 0; x--) {
      if (src[row + x]) last = x
      if (last - x <= r) mid[row + x] = 1
    }
  }
  const out = new Uint8Array(w * h)
  for (let x = 0; x < w; x++) {
    let last = -1 - r
    for (let y = 0; y < h; y++) {
      if (mid[y * w + x]) last = y
      if (y - last <= r) out[y * w + x] = 1
    }
    last = h + r
    for (let y = h - 1; y >= 0; y--) {
      if (mid[y * w + x]) last = y
      if (last - y <= r) out[y * w + x] = 1
    }
  }
  return out
}

/** Erosion, as dilation of the complement. Outside the mask reads as foreground. */
export function erodeBinary(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src.slice()
  const inv = new Uint8Array(w * h)
  for (let i = 0; i < inv.length; i++) inv[i] = src[i] ? 0 : 1
  const grown = dilateBinary(inv, w, h, r)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = grown[i] ? 0 : 1
  return out
}

/**
 * Morphological close: dilate then erode.
 *
 * This is the step that makes the whole thing work on real drawings. A doorway
 * is a hole in the wall, a wall corner is two strokes that stop 0.3 pt short of
 * each other, a dimension line breaks for its text. Closing fills any gap
 * narrower than about 2r cells while leaving wall thickness roughly as drawn,
 * so the fill cannot leak through them.
 */
export function closeBinary(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src.slice()
  return erodeBinary(dilateBinary(src, w, h, r), w, h, r)
}

/**
 * Rasterize one segment into `mask` with Bresenham, clipped to the grid.
 *
 * The step count is bounded by the Chebyshev distance between the clipped
 * endpoints, and a guard caps it regardless — a NaN endpoint must not be able
 * to hang the worker.
 */
function drawSegment(
  mask: Uint8Array,
  w: number,
  h: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return false
  // Trivial reject before rounding, so a segment crossing the frame from far
  // outside still gets drawn but one entirely outside costs almost nothing.
  if ((ax < 0 && bx < 0) || (ax > w - 1 && bx > w - 1)) return false
  if ((ay < 0 && by < 0) || (ay > h - 1 && by > h - 1)) return false

  let x0 = Math.round(ax)
  let y0 = Math.round(ay)
  const x1 = Math.round(bx)
  const y1 = Math.round(by)
  const dx = Math.abs(x1 - x0)
  const sx = x0 < x1 ? 1 : -1
  const dy = -Math.abs(y1 - y0)
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  const limit = dx - dy + 2
  for (let step = 0; step <= limit; step++) {
    if (x0 >= 0 && x0 < w && y0 >= 0 && y0 < h) mask[y0 * w + x0] = 1
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
  return true
}

// ------------------------------------------------------------ flood + fill --

interface FillResult {
  fill: Uint8Array
  count: number
  escaped: number
}

/**
 * 4-connected flood over free space, from `start`.
 *
 * Explicit stack sized to the grid: every cell is pushed at most once because
 * it is marked on push, so the loop runs at most `w*h` times by construction.
 * `escaped` counts cells the fill reached on the frame border, which is how a
 * region that is not actually enclosed gets detected instead of silently
 * returning the whole sheet.
 */
export function floodFree(wall: Uint8Array, w: number, h: number, start: number): FillResult {
  const fill = new Uint8Array(w * h)
  if (wall[start]) return { fill, count: 0, escaped: 0 }
  const stack = new Int32Array(w * h)
  let top = 0
  stack[top++] = start
  fill[start] = 1
  let count = 0
  let escaped = 0
  while (top > 0) {
    const i = stack[--top]!
    count++
    const x = i % w
    const y = (i - x) / w
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) escaped++
    if (x > 0 && !wall[i - 1] && !fill[i - 1]) {
      fill[i - 1] = 1
      stack[top++] = i - 1
    }
    if (x < w - 1 && !wall[i + 1] && !fill[i + 1]) {
      fill[i + 1] = 1
      stack[top++] = i + 1
    }
    if (y > 0 && !wall[i - w] && !fill[i - w]) {
      fill[i - w] = 1
      stack[top++] = i - w
    }
    if (y < h - 1 && !wall[i + w] && !fill[i + w]) {
      fill[i + w] = 1
      stack[top++] = i + w
    }
  }
  return { fill, count, escaped }
}

// ---------------------------------------------------------------- contour --

/** Grid-space lattice ring: integer corner coordinates in 0..w, 0..h. */
export type LatticeRing = Array<[number, number]>

/**
 * Every closed boundary cycle of a filled mask, in lattice (cell-corner) space.
 *
 * Each filled cell contributes a directed edge for every side whose neighbour
 * is empty, oriented so the filled cell is on the right of travel (y down).
 * Those edges partition into closed cycles: the outer boundary comes out with
 * positive signed area, holes negative.
 *
 * Where two filled cells touch only diagonally a lattice point carries two
 * outgoing edges. The tie is broken by turn direction so the walk goes *around*
 * the pinch rather than doubling back into it, which keeps the component as one
 * ring instead of two — otherwise the second lobe would come back as a "hole"
 * and be subtracted from its own area.
 *
 * Terminates by construction: each step consumes an edge and edges are never
 * returned to the pool. The step cap exists to make a violated assumption
 * loud rather than fatal.
 */
export function boundaryRings(fill: Uint8Array, w: number, h: number, maxRings: number): LatticeRing[] {
  const lw = w + 1
  const pointCount = lw * (h + 1)
  // At most two boundary edges leave any lattice point; -1 means "none".
  const out0 = new Int32Array(pointCount).fill(-1)
  const out1 = new Int32Array(pointCount).fill(-1)
  const tails: number[] = []
  const heads: number[] = []
  const used: boolean[] = []

  const addEdge = (fromX: number, fromY: number, toX: number, toY: number) => {
    const from = fromY * lw + fromX
    const id = tails.length
    tails.push(from)
    heads.push(toY * lw + toX)
    used.push(false)
    if (out0[from] === -1) out0[from] = id
    else if (out1[from] === -1) out1[from] = id
    // A third outgoing edge is geometrically impossible for a cell mask; if it
    // ever did occur, dropping it beats corrupting the walk.
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!fill[y * w + x]) continue
      if (y === 0 || !fill[(y - 1) * w + x]) addEdge(x, y, x + 1, y)
      if (x === w - 1 || !fill[y * w + x + 1]) addEdge(x + 1, y, x + 1, y + 1)
      if (y === h - 1 || !fill[(y + 1) * w + x]) addEdge(x + 1, y + 1, x, y + 1)
      if (x === 0 || !fill[y * w + x - 1]) addEdge(x, y + 1, x, y)
    }
  }

  const px = (id: number) => id % lw
  const py = (id: number) => (id - (id % lw)) / lw

  /**
   * Pick the outgoing edge at `point`, given the direction we arrived in.
   *
   * Ranked by turn: the sense that hugs the outside of a diagonal pinch first,
   * then straight on, then the opposite turn, then the U-turn. Directions are
   * axis-aligned unit vectors, so the cross product is exactly -1, 0 or +1.
   */
  const pickEdge = (point: number, inX: number, inY: number): number => {
    let best = -1
    let bestRank = 99
    for (let slot = 0; slot < 2; slot++) {
      const id = slot === 0 ? out0[point]! : out1[point]!
      if (id === -1 || used[id]) continue
      const to = heads[id]!
      const ox = px(to) - px(point)
      const oy = py(to) - py(point)
      const cross = inX * oy - inY * ox
      const dot = inX * ox + inY * oy
      const rank = cross < 0 ? 0 : cross > 0 ? 2 : dot > 0 ? 1 : 3
      if (rank < bestRank) {
        bestRank = rank
        best = id
      }
    }
    return best
  }

  const rings: LatticeRing[] = []
  // Every step consumes an edge and no edge is ever returned to the pool, so
  // the total work across all rings is bounded by the edge count. The cap is
  // belt and braces: it makes a violated assumption loud instead of fatal.
  const maxSteps = tails.length + 8
  let steps = 0
  for (let seed = 0; seed < tails.length && rings.length < maxRings; seed++) {
    if (used[seed]) continue
    const ring: LatticeRing = []
    let edge = seed
    while (edge !== -1 && !used[edge]) {
      if (steps++ > maxSteps) break
      used[edge] = true
      const from = tails[edge]!
      const to = heads[edge]!
      ring.push([px(to), py(to)])
      if (ring.length > MAX_RAW_VERTICES) break
      edge = pickEdge(to, px(to) - px(from), py(to) - py(from))
    }
    if (ring.length >= 4) rings.push(ring)
  }
  return rings
}


// -------------------------------------------------------- simplification --

/**
 * Bounded Douglas-Peucker over a closed ring.
 *
 * `docs/PORTING.md` says not to port `_simplify` from the Qt takeoff worker: it
 * is a `while changed:` that never assigns its result unless three vertices
 * survive, so a rectilinear ring — which is every room on a floor plan — spins
 * forever. This is the replacement it asks for.
 *
 * There is no convergence loop at all. The recursion is over index intervals
 * that strictly shrink, driven by an explicit stack, so the number of splits is
 * bounded by the vertex count. The only repetition is the epsilon relaxation
 * when a ring is still too detailed, and that is capped at
 * MAX_SIMPLIFY_RETRIES doublings.
 */
export function simplifyRing(ring: Polygon, epsilon: number, maxVertices: number = TRACE_DEFAULTS.maxVertices): Polygon {
  if (ring.length <= 3) return ring.slice()
  let eps = Math.max(epsilon, 0)
  let result = douglasPeucker(ring, eps)
  for (let retry = 0; retry < MAX_SIMPLIFY_RETRIES && result.length > maxVertices; retry++) {
    // Scale by the overshoot rather than doubling blindly. A flat doubling can
    // burn every retry and still miss the target on a ring with no collinear
    // runs at all (a circle), which is precisely the input that would tempt
    // somebody to write an unbounded `while (tooDetailed)` loop instead.
    const factor = Math.max(2, result.length / maxVertices)
    eps = eps > 0 ? eps * factor : 1e-6
    result = douglasPeucker(ring, eps)
  }
  return result
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1)
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * DP over the ring, anchored at the two vertices furthest apart.
 *
 * A closed ring has no natural endpoints, and anchoring at index 0 lets DP
 * shave a real corner that happens to sit next to the arbitrary start. The
 * diameter pair is stable under rotation of the input.
 */
function douglasPeucker(ring: Polygon, eps: number): Polygon {
  const n = ring.length
  const first = ring[0]!
  let far = 0
  let farD = -1
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(ring[i]!.x - first.x, ring[i]!.y - first.y)
    if (d > farD) {
      farD = d
      far = i
    }
  }
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[far] = 1
  // Two open chains: 0..far and far..n-1 wrapping back to 0.
  simplifyChain(ring, 0, far, eps, keep)
  simplifyChainWrapped(ring, far, n, eps, keep)
  const out: Polygon = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i]!)
  return out
}

/** Iterative DP on `ring[lo..hi]`. Intervals strictly shrink; the stack is bounded by n. */
function simplifyChain(ring: Polygon, lo: number, hi: number, eps: number, keep: Uint8Array): void {
  if (hi - lo < 2) return
  const stack: number[] = [lo, hi]
  let guard = 4 * ring.length + 16
  while (stack.length > 0) {
    if (guard-- <= 0) return
    const end = stack.pop()!
    const start = stack.pop()!
    if (end - start < 2) continue
    const a = ring[start]!
    const b = ring[end]!
    let best = -1
    let bestD = eps
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(ring[i]!, a, b)
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    if (best < 0) continue
    keep[best] = 1
    stack.push(start, best, best, end)
  }
}

/** DP on the wrapping chain `ring[from..n-1] + ring[0]`, using a virtual index n. */
function simplifyChainWrapped(ring: Polygon, from: number, n: number, eps: number, keep: Uint8Array): void {
  const chain: Polygon = []
  const index: number[] = []
  for (let i = from; i < n; i++) {
    chain.push(ring[i]!)
    index.push(i)
  }
  chain.push(ring[0]!)
  index.push(0)
  const sub = new Uint8Array(chain.length)
  sub[0] = 1
  sub[chain.length - 1] = 1
  simplifyChain(chain, 0, chain.length - 1, eps, sub)
  for (let i = 0; i < chain.length; i++) if (sub[i]) keep[index[i]!] = 1
}

/** Drop consecutive duplicate vertices. Single pass. */
function dedupe(ring: Polygon, eps: number): Polygon {
  const out: Polygon = []
  for (const p of ring) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) <= eps && Math.abs(last.y - p.y) <= eps) continue
    out.push(p)
  }
  while (out.length > 1) {
    const a = out[0]!
    const b = out[out.length - 1]!
    if (Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps) out.pop()
    else break
  }
  return out
}

// ------------------------------------------------------------------ trace --

/**
 * Trace the closed region enclosing `seed`.
 *
 * ## Tolerance model
 *
 * There are exactly three tolerances and they are all lengths in PDF points,
 * converted to grid cells once:
 *
 *   - **cell size** = frame side / `gridCells`. Nothing finer than one cell can
 *     be resolved, so this is the floor on every other tolerance. At the
 *     defaults (1200 pt frame, 512 cells) a cell is 2.34 pt — about 2.8 inches
 *     at the Barclays sheet's 0.100299 ft/pt.
 *   - **bridge gap** (`bridgeGapPoints`, or `bridgeGapFeet` with calibration).
 *     Any opening in the ink narrower than this is treated as closed. It is the
 *     answer to "walls are two parallel lines and doorways leave gaps": the
 *     wall's two lines are already separate strokes and do not need bridging,
 *     but the door opening between them does. The default 24 pt is ~2.4 ft at
 *     the sheet's calibration — wider than a jamb break or a mitre gap,
 *     narrower than a 3 ft door leaf, so a *cased opening* still reads as open.
 *     Callers who want doors closed pass `bridgeGapFeet: 3.5`.
 *   - **simplify epsilon** (`simplifyPoints`), raised to 1.2 cells when the
 *     grid is coarser than that. It is what turns the raster's staircase back
 *     into straight walls.
 *
 * ## What it fails on, honestly
 *
 *   - **A gap wider than the bridge.** The fill escapes into the corridor and
 *     the frame doubles, twice, then returns `reason: 'open'`. That is correct
 *     behaviour for a room open to a corridor, and a wrong answer for a room
 *     whose only defect is one 4 ft break in a wall. Raising `bridgeGapPoints`
 *     fixes the second and breaks the first; there is no setting that gets both.
 *   - **Hatching that crosses the interior.** A hatch line spanning the room
 *     splits the free space, and the fill returns only the strip the click
 *     landed in. Filtering short segments at extraction
 *     (`minLengthPoints`) removes stipple but not continuous hatch.
 *   - **Furniture and fixtures.** Anything drawn as closed ink inside the room
 *     comes back as an interior ring and is subtracted as an opening. Right for
 *     a column, wrong for a desk.
 *   - **Rooms smaller than `minAreaCells`.** Reported as `'too-small'` rather
 *     than returned as a sliver.
 *   - **The boundary lands on the inner face of the wall**, because that is
 *     where the free space stops. For a floor finish that is the correct line.
 *     For a wall-centreline take-off it is half a wall thin, everywhere.
 */
export function traceRegion(input: TraceInput): TraceResult {
  const now = input.now ?? defaultNow
  const t0 = now()
  const o = input.options ?? {}
  const page = input.page
  const pageW = page.width > 0 ? page.width : 1
  const pageH = page.height > 0 ? page.height : 1

  const gridCells = Math.max(16, Math.floor(o.gridCells ?? TRACE_DEFAULTS.gridCells))
  const maxGridCells = Math.max(1024, Math.floor(o.maxGridCells ?? TRACE_DEFAULTS.maxGridCells))
  const maxExpansions = Math.max(0, Math.floor(o.maxExpansions ?? TRACE_DEFAULTS.maxExpansions))
  const maxSegments = Math.max(0, Math.floor(o.maxSegments ?? TRACE_DEFAULTS.maxSegments))
  const seedSearch = Math.max(0, Math.floor(o.seedSearchCells ?? TRACE_DEFAULTS.seedSearchCells))
  const minAreaCells = Math.max(1, Math.floor(o.minAreaCells ?? TRACE_DEFAULTS.minAreaCells))
  const maxFillFraction = clamp(o.maxFillFraction ?? TRACE_DEFAULTS.maxFillFraction, 0.01, 1)
  const maxVertices = Math.max(4, Math.floor(o.maxVertices ?? TRACE_DEFAULTS.maxVertices))
  const recoverCells = clamp(Math.floor(o.recoverCells ?? TRACE_DEFAULTS.recoverCells), 0, 8)
  const maxRings = Math.max(1, Math.floor(o.maxRings ?? TRACE_DEFAULTS.maxRings))
  const minHoleFraction = clamp(o.minHoleFraction ?? TRACE_DEFAULTS.minHoleFraction, 0, 1)
  const simplifyPoints = Math.max(0, o.simplifyPoints ?? TRACE_DEFAULTS.simplifyPoints)

  const feetPerPoint = o.feetPerPoint
  const bridgePoints =
    feetPerPoint !== undefined && feetPerPoint > 0
      ? (o.bridgeGapFeet ?? TRACE_DEFAULTS.bridgeGapFeet) / feetPerPoint
      : (o.bridgeGapPoints ?? TRACE_DEFAULTS.bridgeGapPoints)

  const emptyDiag = (extra: Partial<TraceDiagnostics> = {}): TraceDiagnostics => ({
    frame: { x0: 0, y0: 0, x1: 1, y1: 1 },
    gridWidth: 0,
    gridHeight: 0,
    cellPoints: 0,
    bridgeCells: 0,
    expansions: 0,
    segmentsRasterized: 0,
    segmentsSkipped: 0,
    truncated: false,
    filledCells: 0,
    escapedCells: 0,
    ringCount: 0,
    rawVertexCount: 0,
    vertexCount: 0,
    ms: now() - t0,
    ...extra,
  })

  const segCount = Math.floor(input.segments.length / 4)
  if (segCount === 0) {
    return { ok: false, reason: 'no-segments', message: 'no vector geometry to trace against', diagnostics: emptyDiag() }
  }
  const seed = input.seed
  if (!(seed.x >= 0 && seed.x <= 1 && seed.y >= 0 && seed.y <= 1)) {
    return {
      ok: false,
      reason: 'seed-outside-page',
      message: `click (${seed.x}, ${seed.y}) is not inside the page`,
      diagnostics: emptyDiag(),
    }
  }

  let frameSize = Math.max(1, o.frameSizePoints ?? TRACE_DEFAULTS.frameSizePoints)
  let last: TraceFailure | null = null

  for (let attempt = 0; attempt <= maxExpansions; attempt++) {
    const outcome = attemptTrace({
      segments: input.segments,
      segCount,
      seed,
      pageW,
      pageH,
      frameSize,
      bridgePoints,
      gridCells,
      maxGridCells,
      maxSegments,
      seedSearch,
      minAreaCells,
      maxFillFraction,
      simplifyPoints,
      maxVertices,
      recoverCells,
      maxRings,
      minHoleFraction,
      expansions: attempt,
      t0,
      now,
    })
    if (outcome.ok) return outcome
    last = outcome
    // Only an escape is worth retrying, and only while the frame can still
    // grow. Everything else is a verdict, not a symptom of too small a window.
    const frameCoversPage = frameSize >= Math.max(pageW, pageH)
    if (outcome.reason !== 'open' || frameCoversPage) return outcome
    frameSize *= 2
  }
  return (
    last ?? {
      ok: false,
      reason: 'open',
      message: 'region is not enclosed within the search frame',
      diagnostics: emptyDiag(),
    }
  )
}

interface AttemptArgs {
  segments: ArrayLike<number>
  segCount: number
  seed: Point
  pageW: number
  pageH: number
  frameSize: number
  bridgePoints: number
  gridCells: number
  maxGridCells: number
  maxSegments: number
  seedSearch: number
  minAreaCells: number
  maxFillFraction: number
  simplifyPoints: number
  maxVertices: number
  recoverCells: number
  maxRings: number
  minHoleFraction: number
  expansions: number
  t0: number
  now: () => number
}

function attemptTrace(a: AttemptArgs): TraceResult {
  const halfX = a.frameSize / 2 / a.pageW
  const halfY = a.frameSize / 2 / a.pageH
  const frame: TraceFrame = {
    x0: clamp(a.seed.x - halfX, 0, 1),
    y0: clamp(a.seed.y - halfY, 0, 1),
    x1: clamp(a.seed.x + halfX, 0, 1),
    y1: clamp(a.seed.y + halfY, 0, 1),
  }
  const frameWpt = Math.max(1e-6, (frame.x1 - frame.x0) * a.pageW)
  const frameHpt = Math.max(1e-6, (frame.y1 - frame.y0) * a.pageH)
  let cellPt = Math.max(frameWpt, frameHpt) / a.gridCells
  let gw = Math.max(4, Math.ceil(frameWpt / cellPt))
  let gh = Math.max(4, Math.ceil(frameHpt / cellPt))
  if (gw * gh > a.maxGridCells) {
    const shrink = Math.sqrt((gw * gh) / a.maxGridCells)
    cellPt *= shrink
    gw = Math.max(4, Math.ceil(frameWpt / cellPt))
    gh = Math.max(4, Math.ceil(frameHpt / cellPt))
  }
  const bridgeCells = clamp(Math.round(a.bridgePoints / 2 / cellPt), 0, MAX_BRIDGE_CELLS)

  const diag = (extra: Partial<TraceDiagnostics>): TraceDiagnostics => ({
    frame,
    gridWidth: gw,
    gridHeight: gh,
    cellPoints: cellPt,
    bridgeCells,
    expansions: a.expansions,
    segmentsRasterized: 0,
    segmentsSkipped: 0,
    truncated: false,
    filledCells: 0,
    escapedCells: 0,
    ringCount: 0,
    rawVertexCount: 0,
    vertexCount: 0,
    ms: a.now() - a.t0,
    ...extra,
  })

  // ---- rasterize -----------------------------------------------------------
  const wall = new Uint8Array(gw * gh)
  const sx = (gw - 1) / Math.max(1e-9, frame.x1 - frame.x0)
  const sy = (gh - 1) / Math.max(1e-9, frame.y1 - frame.y0)
  let drawn = 0
  let skipped = 0
  const limit = Math.min(a.segCount, a.maxSegments)
  for (let i = 0; i < limit; i++) {
    const b = i * 4
    const ax = ((a.segments[b] as number) - frame.x0) * sx
    const ay = ((a.segments[b + 1] as number) - frame.y0) * sy
    const bx = ((a.segments[b + 2] as number) - frame.x0) * sx
    const by = ((a.segments[b + 3] as number) - frame.y0) * sy
    if (drawSegment(wall, gw, gh, ax, ay, bx, by)) drawn++
    else skipped++
  }
  const truncated = a.segCount > limit

  const closed = closeBinary(wall, gw, gh, bridgeCells)

  // ---- seed ---------------------------------------------------------------
  // A click that lands exactly on a wall is ambiguous: the free cells next to
  // it are on BOTH sides, and picking the first one found in spiral order
  // hands back whatever the scan order happened to reach — in practice the
  // corridor outside the room as often as the room itself. So collect the
  // nearest few free cells and let the flood decide: the first candidate that
  // comes back actually enclosed wins. Bounded by `maxSeedCandidates`; the
  // rasterize and close above are paid once and shared across all of them.
  const seedX = clamp(Math.round((a.seed.x - frame.x0) * sx), 0, gw - 1)
  const seedY = clamp(Math.round((a.seed.y - frame.y0) * sy), 0, gh - 1)
  const candidates: number[] = []
  if (!closed[seedY * gw + seedX]) {
    candidates.push(seedY * gw + seedX)
  } else {
    search: for (let r = 1; r <= a.seedSearch; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const x = seedX + dx
          const y = seedY + dy
          if (x < 0 || y < 0 || x >= gw || y >= gh) continue
          if (!closed[y * gw + x]) {
            candidates.push(y * gw + x)
            if (candidates.length >= MAX_SEED_CANDIDATES) break search
          }
        }
      }
    }
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'seed-on-ink',
      message: `the click landed on drawing content and no open space was found within ${a.seedSearch} cells`,
      diagnostics: diag({ segmentsRasterized: drawn, segmentsSkipped: skipped, truncated }),
    }
  }

  // ---- flood --------------------------------------------------------------
  let flood = floodFree(closed, gw, gh, candidates[0]!)
  for (let i = 1; i < candidates.length && flood.escaped > 0; i++) {
    const next = floodFree(closed, gw, gh, candidates[i]!)
    // Only an enclosed result is an improvement; a second escape tells us
    // nothing new, and keeping the first keeps the diagnostics honest about
    // where the user actually clicked.
    if (next.escaped === 0 && next.count >= a.minAreaCells) flood = next
  }
  const { fill, count, escaped } = flood
  const base = {
    segmentsRasterized: drawn,
    segmentsSkipped: skipped,
    truncated,
    filledCells: count,
    escapedCells: escaped,
  }
  if (escaped > 0) {
    return {
      ok: false,
      reason: 'open',
      message:
        `the region is not enclosed: the fill reached the edge of the ${Math.round(a.frameSize)} pt search frame ` +
        `in ${escaped} place(s). Either the click was not inside a closed space, or a gap wider than ` +
        `${a.bridgePoints.toFixed(1)} pt lets it out.`,
      diagnostics: diag(base),
    }
  }
  if (count < a.minAreaCells) {
    return {
      ok: false,
      reason: 'too-small',
      message: `enclosed area is ${count} cells, below the ${a.minAreaCells}-cell floor`,
      diagnostics: diag(base),
    }
  }
  if (count > a.maxFillFraction * gw * gh) {
    return {
      ok: false,
      reason: 'too-large',
      message: `the fill covers ${((count / (gw * gh)) * 100).toFixed(0)}% of the search frame; the click was not inside a room`,
      diagnostics: diag(base),
    }
  }

  // ---- recover the raster's own line thickness -----------------------------
  // The fill stops one cell short of the ink because rasterizing a line marks
  // the cells it passes through. Grow it back, but ONLY into cells the closed
  // wall occupies — growing into free space could punch through a bridged
  // doorway and merge two rooms.
  let region = fill
  if (a.recoverCells > 0) {
    const grown = dilateBinary(fill, gw, gh, a.recoverCells)
    region = new Uint8Array(gw * gh)
    for (let i = 0; i < region.length; i++) region[i] = fill[i] || (grown[i] && closed[i]) ? 1 : 0
  }

  // ---- contour ------------------------------------------------------------
  const lattice = boundaryRings(region, gw, gh, a.maxRings)
  if (lattice.length === 0) {
    return {
      ok: false,
      reason: 'no-boundary',
      message: 'the filled region produced no boundary',
      diagnostics: diag(base),
    }
  }
  let rawVertices = 0
  for (const r of lattice) rawVertices += r.length

  const toNorm = (p: [number, number]): Point => ({
    x: frame.x0 + (p[0] / gw) * (frame.x1 - frame.x0),
    y: frame.y0 + (p[1] / gh) * (frame.y1 - frame.y0),
  })

  // Epsilon in normalized units, never finer than the grid can express.
  const epsPoints = Math.max(a.simplifyPoints, cellPt * 1.2)
  const epsNorm = epsPoints / Math.max(a.pageW, a.pageH)
  const dupEps = 1e-9

  const scored = lattice
    .map((r) => {
      const norm = r.map(toNorm)
      return { norm, signed: signedPolygonArea(norm) }
    })
    .filter((r) => Math.abs(r.signed) > 0)
  scored.sort((p, q) => Math.abs(q.signed) - Math.abs(p.signed))
  const outerRaw = scored[0]
  if (!outerRaw) {
    return { ok: false, reason: 'degenerate', message: 'every contour collapsed', diagnostics: diag(base) }
  }
  const outerArea = Math.abs(outerRaw.signed)

  const rings: Region = []
  for (const cand of scored) {
    if (rings.length >= a.maxRings) break
    // Holes below the noise floor are hatching and stray ink, not columns.
    if (rings.length > 0 && Math.abs(cand.signed) < minHoleArea(outerArea, a.minHoleFraction)) continue
    const simplified = dedupe(simplifyRing(dedupe(cand.norm, dupEps), epsNorm, a.maxVertices), dupEps)
    if (simplified.length < 3) continue
    rings.push(simplified)
  }
  if (rings.length === 0 || (rings[0]?.length ?? 0) < 3) {
    return {
      ok: false,
      reason: 'degenerate',
      message: 'the traced ring collapsed to fewer than three vertices',
      diagnostics: diag({ ...base, ringCount: lattice.length, rawVertexCount: rawVertices }),
    }
  }

  let vertexCount = 0
  for (const r of rings) vertexCount += r.length
  const areaPoints2 = regionArea(rings.map((r) => r.map((p) => ({ x: p.x * a.pageW, y: p.y * a.pageH }))))

  return {
    ok: true,
    region: rings,
    ring: rings[0]!,
    areaPoints2,
    diagnostics: diag({ ...base, ringCount: rings.length, rawVertexCount: rawVertices, vertexCount }),
  }
}

function minHoleArea(outerArea: number, fraction: number): number {
  return outerArea * fraction
}
