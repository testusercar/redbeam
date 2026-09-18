/**
 * Snap anchors from a page's own vector geometry: where its lines END.
 *
 * Snapping used to be vertices, then ortho, then any dark pixel within 12px
 * ("snap to content"). Ink is everywhere on a drawing — hatching, text,
 * dimension strings, the grid — so the cursor was pulled onto whatever line
 * was nearest, which on a wall was the far face rather than the corner.
 * Kenneth, 2026-09-10: "it's snapping further out because it snaps to all
 * the lines".
 *
 * A line's END is a place: a wall corner, a column edge, where a soffit
 * stops. The page's geometry is already extractable (the tracer uses it), so
 * this takes every segment's two endpoints, buckets them on a uniform grid
 * in normalized page space, and answers "nearest endpoint within r pixels"
 * from the few cells around the cursor. Built once per sheet, in the
 * background; queried per pointer move.
 *
 * A grid rather than a k-d tree because the query radius is tiny (12px of a
 * sheet that is thousands of points wide), so at most a 3x3 cell window is
 * ever visited and the build is a counting sort.
 */

export interface AnchorGrid {
  /** Cells per side. */
  readonly cells: number
  /** Endpoint x, y pairs, normalized, sorted by cell. */
  readonly xy: Float32Array
  /** CSR row starts: endpoints of cell c are xy[2*start[c] .. 2*start[c+1]). */
  readonly start: Int32Array
  readonly count: number
}

/**
 * Bucket the endpoints of `segments` (x0 y0 x1 y1 per segment, normalized).
 *
 * Endpoints closer than `mergeEps` to one already in the same cell are
 * dropped: every wall is two lines meeting at a corner and every corner
 * would otherwise be there four times over.
 */
export function buildAnchorGrid(segments: Float32Array, cells = 256, mergeEps = 1e-4): AnchorGrid {
  const n = Math.floor(segments.length / 4)
  const cellOf = (x: number, y: number): number => {
    const cx = Math.min(cells - 1, Math.max(0, Math.floor(x * cells)))
    const cy = Math.min(cells - 1, Math.max(0, Math.floor(y * cells)))
    return cy * cells + cx
  }
  // Pass 1: count per cell.
  const counts = new Int32Array(cells * cells + 1)
  const px = new Float32Array(n * 2), py = new Float32Array(n * 2), pc = new Int32Array(n * 2)
  let k = 0
  for (let i = 0; i < n; i++) {
    for (let e = 0; e < 2; e++) {
      const x = segments[i * 4 + e * 2]!, y = segments[i * 4 + e * 2 + 1]!
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) continue
      const c = cellOf(x, y)
      px[k] = x; py[k] = y; pc[k] = c; k++
      counts[c + 1]!++
    }
  }
  // Prefix sums give each cell its row start.
  const start = new Int32Array(cells * cells + 1)
  for (let c = 0; c < cells * cells; c++) start[c + 1] = start[c]! + counts[c + 1]!
  // Pass 2: scatter, dropping near-duplicates within the cell.
  const fill = new Int32Array(cells * cells)
  const xy = new Float32Array(k * 2)
  const eps2 = mergeEps * mergeEps
  for (let i = 0; i < k; i++) {
    const c = pc[i]!, x = px[i]!, y = py[i]!
    const base = start[c]!
    let dup = false
    for (let j = 0; j < fill[c]!; j++) {
      const dx = xy[(base + j) * 2]! - x, dy = xy[(base + j) * 2 + 1]! - y
      if (dx * dx + dy * dy <= eps2) { dup = true; break }
    }
    if (dup) continue
    const at = base + fill[c]!
    xy[at * 2] = x; xy[at * 2 + 1] = y
    fill[c]!++
  }
  // Rows were sized for every endpoint; compact them to what survived.
  const outStart = new Int32Array(cells * cells + 1)
  let total = 0
  const out = new Float32Array(k * 2)
  for (let c = 0; c < cells * cells; c++) {
    outStart[c] = total
    const base = start[c]!
    for (let j = 0; j < fill[c]!; j++) {
      out[total * 2] = xy[(base + j) * 2]!
      out[total * 2 + 1] = xy[(base + j) * 2 + 1]!
      total++
    }
  }
  outStart[cells * cells] = total
  return { cells, xy: out.subarray(0, total * 2), start: outStart, count: total }
}

/**
 * The nearest anchor to a normalized point, within an ellipse of `rx` by
 * `ry` (the pixel radius expressed in each axis's normalized units, which
 * differ on a non-square page). Null when none.
 */
export function nearestAnchor(
  grid: AnchorGrid,
  nx: number,
  ny: number,
  rx: number,
  ry: number,
): { x: number; y: number } | null {
  if (grid.count === 0 || !(rx > 0) || !(ry > 0)) return null
  const { cells, xy, start } = grid
  const c0 = Math.max(0, Math.floor((nx - rx) * cells)), c1 = Math.min(cells - 1, Math.floor((nx + rx) * cells))
  const r0 = Math.max(0, Math.floor((ny - ry) * cells)), r1 = Math.min(cells - 1, Math.floor((ny + ry) * cells))
  let best: { x: number; y: number } | null = null
  let bestD = 1
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = r * cells + c
      for (let i = start[cell]!; i < start[cell + 1]!; i++) {
        const x = xy[i * 2]!, y = xy[i * 2 + 1]!
        // Distance in radius units, so the ellipse is a unit circle.
        const dx = (x - nx) / rx, dy = (y - ny) / ry
        const d = dx * dx + dy * dy
        if (d <= bestD) { bestD = d; best = { x, y } }
      }
    }
  }
  return best
}
