/**
 * Takeoff geometry in PDF points.
 *
 * Ported from okular-redbeam `part/redbeamscopepanel.cpp`:
 *   redbeamSignedPolygonAreaPdfPointsSquared
 *   redbeamPathAreaPdfPointsSquared
 *   redbeamPathPerimeterPdfPoints
 *   redbeamPolylineLengthPdfPoints
 *
 * The comments below are carried over from the C++ because they record bugs
 * that were found the hard way against real drawings. Do not "simplify" the
 * nesting-depth logic without reading them.
 */

export interface Point {
  x: number
  y: number
}

/** A closed ring. First and last point need not be duplicated. */
export type Polygon = Point[]

/**
 * A region: one or more rings. Rings at even nesting depth are material,
 * rings at odd nesting depth are openings (cutouts).
 *
 * This replaces QPainterPath. We keep explicit rings rather than a path object
 * because the Qt code had to fight QPainterPath::toFillPolygons() inserting
 * artificial bridge edges — see pathBoundaryPolygons in the original.
 */
export type Region = Polygon[]

/** Shoelace. Sign carries winding direction. */
export function signedPolygonArea(polygon: Polygon): number {
  if (polygon.length < 3) return 0
  let twiceArea = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    twiceArea += a.x * b.y - b.x * a.y
  }
  return twiceArea * 0.5
}

/**
 * Even-odd point-in-polygon (ray casting).
 *
 * Replaces QPainterPath::contains(), which uses the same fill rule for a
 * single closed subpath.
 */
export function pointInPolygon(point: Point, polygon: Polygon): boolean {
  if (polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!
    const pj = polygon[j]!
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x
    if (intersects) inside = !inside
  }
  return inside
}

/**
 * Material area with openings removed.
 *
 * Summing signed areas does NOT work: the boolean-subtract that creates a
 * cutout does not reliably survive as reverse winding once rings are extracted,
 * so a naive sum ADDS every opening instead of removing it. Classify rings by
 * nesting depth instead: even depth is material, odd depth is an opening.
 * This also stays correct when one cutout splits a region into disjoint pieces.
 */
export function regionArea(region: Region): number {
  const rings = region.filter((r) => r.length >= 3)
  if (rings.length === 0) return 0
  if (rings.length === 1) return Math.abs(signedPolygonArea(rings[0]!))

  let area = 0
  for (let index = 0; index < rings.length; index++) {
    const ring = rings[index]!
    // Probe with a VERTEX, not an interior point. Rings produced by a boolean
    // op never cross, so a ring sits wholly inside or wholly outside every
    // other ring and any one of its vertices settles it. An interior point
    // would not: the natural interior point of an outer ring can land inside
    // that ring's own hole, which would count the outer ring as nested and
    // drive the whole region negative.
    const probe = ring[0]!
    let depth = 0
    for (let other = 0; other < rings.length; other++) {
      if (other !== index && pointInPolygon(probe, rings[other]!)) depth++
    }
    const magnitude = Math.abs(signedPolygonArea(ring))
    area += depth % 2 === 0 ? magnitude : -magnitude
  }
  return Math.max(0, area)
}

/** Perimeter of every ring in the region, each treated as closed. */
export function regionPerimeter(region: Region): number {
  let perimeter = 0
  for (const ring of region) {
    if (ring.length < 2) continue
    for (let i = 1; i < ring.length; i++) {
      perimeter += distance(ring[i - 1]!, ring[i]!)
    }
    const first = ring[0]!
    const last = ring[ring.length - 1]!
    if (first.x !== last.x || first.y !== last.y) {
      perimeter += distance(last, first)
    }
  }
  return perimeter
}

/**
 * Length of an open polyline given in NORMALIZED page coordinates [0,1],
 * scaled to PDF points by the page box.
 */
export function polylineLength(points: Point[], pageWidth: number, pageHeight: number): number {
  if (points.length < 2) return 0
  let length = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    length += distance(
      { x: a.x * pageWidth, y: a.y * pageHeight },
      { x: b.x * pageWidth, y: b.y * pageHeight },
    )
  }
  return length
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** PDF points squared -> square feet, at a given scale (drawing units per point). */
export function squarePointsToSquareFeet(areaPoints2: number, feetPerPoint: number): number {
  return areaPoints2 * feetPerPoint * feetPerPoint
}

/** PDF points -> linear feet. */
export function pointsToFeet(lengthPoints: number, feetPerPoint: number): number {
  return lengthPoints * feetPerPoint
}

/**
 * Shortest distance from `p` to the segment `a`-`b`.
 *
 * Used for hit-testing markup edges. Handles the degenerate zero-length
 * segment (a == b), which happens for a single-point count markup and for
 * duplicate vertices a user can create by clicking twice in the same spot.
 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  // projection parameter, clamped to the segment
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Nearest edge of a ring to `p`, as the index of the edge's FIRST vertex.
 * `closed` controls whether the last->first edge is considered.
 */
export function nearestEdge(
  p: Point,
  ring: Point[],
  closed: boolean,
): { index: number; distance: number } | null {
  if (ring.length < 2) return null
  let best = -1
  let bestD = Infinity
  const last = closed ? ring.length : ring.length - 1
  for (let i = 0; i < last; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    const d = distanceToSegment(p, a, b)
    if (d < bestD) { bestD = d; best = i }
  }
  return best < 0 ? null : { index: best, distance: bestD }
}
