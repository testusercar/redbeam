/**
 * Pattern direction, pattern origin, and direction zones.
 *
 * These are INPUTS TO THE LAYOUT ENGINE (Phase 06), not decoration. A ceiling
 * of baffles or planks runs in a direction and starts from an origin, and one
 * sheet can carry several zones each running differently. Every piece count
 * downstream is a function of what this module returns.
 *
 * Ported from okular-redbeam `part/redbeamscopepanel.cpp`:
 *   redbeamPatternOriginPoint                      -> patternOriginPoint
 *   redbeamPatternDirectionLine                    -> patternDirectionLine
 *   redbeamScopeDefaultDirectionFromSpecifications -> scopeDefaultDirectionFromSpecifications
 *   redbeamDirectionLineForTargetPage              -> scope-default vector handling
 *   the `lineAngleModulo180` lambda                -> axisAngleDegrees
 *   the `directionForArea` lambda                  -> resolvePatternDirection precedence
 *   the `directionZoneKeyForArea` lambda           -> directionGroupKey
 *   the origin selection loop in redbeamComputeLayout -> resolvePatternOrigin
 * and `part/redbeamautomationbridge.cpp`:
 *   redbeamScopeDefaultDirectionIsUsable           -> isScopeDefaultDirectionUsable
 *
 * COORDINATES
 * -----------
 * Everything stored is in NORMALIZED page coordinates [0,1], exactly like every
 * other markup and like `markups.geometry_json`. Nothing here ever sees a raw
 * PDFium coordinate; page boxes are origin-centred on real sheets and that is
 * the viewer's problem, not this module's (see docs/PORTING.md).
 *
 * ANGLE CONVENTION
 * ----------------
 * An angle is `atan2(dy, dx)` in degrees, computed on deltas in PDF POINTS on
 * the target page, folded into [0, 180).
 *
 *   - y grows DOWN in normalized page space (y = 0 is the top of the sheet), so
 *     a POSITIVE angle rotates CLOCKWISE on screen. That is the opposite sign
 *     to the maths convention. 0 deg runs left-to-right; 90 deg runs top to
 *     bottom.
 *   - A pattern direction is an AXIS, not an arrow. Baffles at 30 deg and at
 *     210 deg are the same ceiling, so every angle here is modulo 180. This is
 *     the `lineAngleModulo180` rule from the Qt layout engine and it is what
 *     lets two zones be recognised as sharing an orientation.
 *   - Angles are ALWAYS taken after scaling normalized deltas by the page box.
 *     A sheet is not square; atan2 on raw normalized deltas skews the angle by
 *     the aspect ratio, and that is exactly how a ceiling ends up running the
 *     wrong way.
 */

import {
  pointInPolygon,
  regionArea,
  signedPolygonArea,
  type Point,
  type Region,
} from './geometry.js'

/** Page box in PDF points. Matches `Calibration.pageWidth` / `.pageHeight`. */
export interface PageSize {
  width: number
  height: number
}

/** Two points in PDF points on some page. */
export interface Segment {
  a: Point
  b: Point
}

/** Normalized axis-aligned bounds. */
export interface NormalizedRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** A direction as authored: two normalized points. Order is cosmetic (axis). */
export type NormalizedDirection = readonly [Point, Point]

export const pageSizeOf = (cal: { pageWidth: number; pageHeight: number }): PageSize => ({
  width: cal.pageWidth,
  height: cal.pageHeight,
})

/** Normalized [0,1] -> PDF points on `page`. */
export function toPagePoints(p: Point, page: PageSize): Point {
  return { x: p.x * page.width, y: p.y * page.height }
}

/** PDF points on `page` -> normalized [0,1]. */
export function toNormalized(p: Point, page: PageSize): Point {
  return {
    x: page.width === 0 ? 0 : p.x / page.width,
    y: page.height === 0 ? 0 : p.y / page.height,
  }
}

// ---------------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------------

/**
 * Fold an angle into [0, 180).
 *
 * Port of the `lineAngleModulo180` lambda in redbeamComputeLayout. The
 * while-loops are kept rather than a modulo so behaviour on negative and very
 * large inputs is identical to the C++.
 */
export function normalizeAxisDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0
  let d = degrees
  while (d < 0) d += 180
  while (d >= 180) d -= 180
  return d
}

/** Axis angle of a PDF-point segment, degrees in [0,180). See ANGLE CONVENTION. */
export function axisAngleDegrees(seg: Segment): number {
  return normalizeAxisDegrees((Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x) * 180) / Math.PI)
}

/** Unit vector along a PDF-point segment, or null for a zero-length segment. */
export function directionUnitVector(seg: Segment): Point | null {
  const dx = seg.b.x - seg.a.x
  const dy = seg.b.y - seg.a.y
  const len = Math.hypot(dx, dy)
  if (!(len > 0)) return null
  return { x: dx / len, y: dy / len }
}

/**
 * Axis angle of a direction authored in normalized coordinates.
 * Null for a zero-length direction — the Qt `length() > 0.0` guard.
 */
export function normalizedDirectionAngle(
  direction: NormalizedDirection,
  page: PageSize,
): number | null {
  const seg = { a: toPagePoints(direction[0], page), b: toPagePoints(direction[1], page) }
  if (directionUnitVector(seg) === null) return null
  return axisAngleDegrees(seg)
}

/**
 * Build a normalized direction that reads back as `degrees` on `page`.
 *
 * Inverse of normalizedDirectionAngle: the point-space delta is
 * (cos, sin) * lengthPoints, then divided by the page box. Round-tripping an
 * angle through this and back must not drift, which is what pins the
 * aspect-ratio handling above.
 */
export function normalizedDirectionFromAngle(
  degrees: number,
  page: PageSize,
  at: Point = { x: 0.5, y: 0.5 },
  lengthPoints = 1,
): NormalizedDirection {
  const theta = (normalizeAxisDegrees(degrees) * Math.PI) / 180
  const dx = Math.cos(theta) * lengthPoints
  const dy = Math.sin(theta) * lengthPoints
  return [
    at,
    {
      x: at.x + (page.width === 0 ? 0 : dx / page.width),
      y: at.y + (page.height === 0 ? 0 : dy / page.height),
    },
  ]
}

/** True when two axis angles are the same orientation within `toleranceDegrees`. */
export function sameAxis(a: number, b: number, toleranceDegrees = 1e-9): boolean {
  const d = Math.abs(normalizeAxisDegrees(a) - normalizeAxisDegrees(b))
  return Math.min(d, 180 - d) <= toleranceDegrees
}

// ---------------------------------------------------------------------------
// Pattern direction
// ---------------------------------------------------------------------------

/**
 * Port of redbeamPatternDirectionLine.
 *
 * The Qt version takes the FIRST TWO points of the annotation and ignores any
 * others, and returns a default (zero-length) QLineF when there are fewer than
 * two. Every call site then tests `length() > 0.0`, so null here is the same
 * contract with the test made unmissable.
 */
export function patternDirectionLine(
  points: readonly Point[] | undefined | null,
  page: PageSize,
): Segment | null {
  const a = points?.[0]
  const b = points?.[1]
  if (!a || !b) return null
  const seg = { a: toPagePoints(a, page), b: toPagePoints(b, page) }
  return directionUnitVector(seg) === null ? null : seg
}

/** The `scopeDefaultDirection` vector persisted on a scope's specifications. */
export interface ScopeDefaultDirectionVector {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Page the vector was authored on, when the writer recorded it. */
  sourcePage?: number
}

/**
 * Port of redbeamScopeDefaultDirectionFromSpecifications.
 *
 * WS2.2 in the Qt build: scopes are project-owned, but the Scope Default
 * Orientation historically lived only as an annotation inside ONE document, so
 * a scope spanning several PDFs stayed blocked everywhere else (Round 3 defect
 * #02). The direction vector is therefore also persisted on the scope itself
 * under the specifications key "scopeDefaultDirection". This is how a default
 * direction is derived when none has been drawn on the page in hand.
 *
 * Coercion matches QJsonValue::toDouble(): a missing or non-numeric member
 * reads as 0. An absent or empty object is "no default", not "the zero vector".
 */
export function scopeDefaultDirectionFromSpecifications(
  scope: { specifications?: Record<string, unknown> | null } | null | undefined,
): ScopeDefaultDirectionVector | null {
  const raw = scope?.specifications?.['scopeDefaultDirection']
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (Object.keys(obj).length === 0) return null
  const num = (key: string): number => {
    const v = obj[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  const sourcePage = obj['sourcePage']
  const out: ScopeDefaultDirectionVector = {
    x1: num('x1'),
    y1: num('y1'),
    x2: num('x2'),
    y2: num('y2'),
  }
  if (typeof sourcePage === 'number' && Number.isFinite(sourcePage)) out.sourcePage = sourcePage
  return out
}

/** Port of redbeamScopeDefaultDirectionIsUsable: a zero vector is not a direction. */
export function isScopeDefaultDirectionUsable(
  vector: ScopeDefaultDirectionVector | null | undefined,
): boolean {
  if (!vector) return false
  return vector.x2 - vector.x1 !== 0 || vector.y2 - vector.y1 !== 0
}

/** The persisted scope default as an authored normalized direction, if usable. */
export function scopeDefaultDirection(
  scope: { specifications?: Record<string, unknown> | null } | null | undefined,
): NormalizedDirection | null {
  const v = scopeDefaultDirectionFromSpecifications(scope)
  if (!v || !isScopeDefaultDirectionUsable(v)) return null
  return [
    { x: v.x1, y: v.y1 },
    { x: v.x2, y: v.y2 },
  ]
}

// ---------------------------------------------------------------------------
// Pattern origin
// ---------------------------------------------------------------------------

/** Anything with normalized rings. `Markup` satisfies this structurally. */
export interface PatternOriginMarkup {
  id?: string
  rings: Region
}

/** Bounding rect of every ring, normalized. Null when there is no geometry. */
export function normalizedBoundingRect(rings: Region | undefined | null): NormalizedRect | null {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  let seen = false
  for (const ring of rings ?? []) {
    for (const p of ring) {
      seen = true
      if (p.x < left) left = p.x
      if (p.x > right) right = p.x
      if (p.y < top) top = p.y
      if (p.y > bottom) bottom = p.y
    }
  }
  return seen ? { left, top, right, bottom } : null
}

/**
 * Port of redbeamPatternOriginPoint, in PDF points on `page`.
 *
 * The origin markup in the Qt build is a GeomCircle placed by a PickPoint
 * engine with center=true, so the click point is recoverable only as the
 * CENTRE OF ITS BOUNDING RECTANGLE — not as a stored vertex. That is why this
 * is a bounding-rect midpoint and not `points[0]`, and it stays that way so an
 * origin drawn as a dot, a circle or a small box all mean the same thing.
 *
 * Qt returns QPointF(0,0) for a null annotation, because a default-constructed
 * Okular::NormalizedRect is all zeros. That is reproduced exactly. Callers gate
 * on having an origin at all (see resolvePatternOrigin) rather than relying on
 * it — (0,0) is a legitimate page corner, never a sentinel.
 */
export function patternOriginPoint(
  markup: PatternOriginMarkup | null | undefined,
  page: PageSize,
): Point {
  const rect = markup ? normalizedBoundingRect(markup.rings) : null
  const r = rect ?? { left: 0, top: 0, right: 0, bottom: 0 }
  return {
    x: (r.left + r.right) * 0.5 * page.width,
    y: (r.top + r.bottom) * 0.5 * page.height,
  }
}

/** Same rule, left normalized — for containment tests and for drawing. */
export function patternOriginPointNormalized(
  markup: PatternOriginMarkup | null | undefined,
): Point | null {
  const rect = markup ? normalizedBoundingRect(markup.rings) : null
  if (!rect) return null
  return { x: (rect.left + rect.right) * 0.5, y: (rect.top + rect.bottom) * 0.5 }
}

export interface PatternOriginResolution {
  /** PDF points on the target page. */
  point: Point
  /** The same point, normalized [0,1]. */
  normalized: Point
  source: 'placed' | 'derived'
  /** Set only when an origin markup was used. */
  originId?: string
}

/**
 * The origin for one region.
 *
 * Placed: the FIRST origin markup whose point falls inside the region wins.
 * That is the Qt loop verbatim — it iterates originRefs and `break`s on the
 * first hit, so array order decides. Two origins inside one region is a user
 * error for the preflight to catch, not something to average.
 *
 * Derived (no origin placed): the centre of the region's bounding rectangle.
 * In the Qt build that is `baseOrigin = bounds.center()` inside
 * redbeamSelectAutomaticOrigin, which then phase-shifts it along the direction
 * and its normal hunting for the best yield. The phase search is NOT ported —
 * it needs redbeamGenerateLayoutSegments and redbeamBuildBafflePieces, which
 * docs/PORTING.md holds back until golden fixtures exist. The bounding-rect
 * centre is the stable, quantity-free part of that rule; anything wanting the
 * yield-optimised origin must wait for the piece engine.
 */
export function resolvePatternOrigin(
  origins: readonly PatternOriginMarkup[],
  regionRings: Region,
  page: PageSize,
): PatternOriginResolution | null {
  for (const origin of origins) {
    const n = patternOriginPointNormalized(origin)
    if (!n) continue
    if (!pointInRegion(n, regionRings)) continue
    const out: PatternOriginResolution = {
      point: toPagePoints(n, page),
      normalized: n,
      source: 'placed',
    }
    if (origin.id !== undefined) out.originId = origin.id
    return out
  }

  const rect = normalizedBoundingRect(regionRings)
  if (!rect) return null
  const n = { x: (rect.left + rect.right) * 0.5, y: (rect.top + rect.bottom) * 0.5 }
  return { point: toPagePoints(n, page), normalized: n, source: 'derived' }
}

// ---------------------------------------------------------------------------
// Direction zones
// ---------------------------------------------------------------------------

/**
 * A region of one page whose contents run in their own direction, overriding
 * the page and scope defaults.
 *
 * In the Qt build a zone is not a first-class object: it is an area annotation
 * plus a Pattern Direction bound to that area's shape key — the pairing the MCP
 * tool `redbeam_create_direction_zone` creates in one shot. Because the binding
 * was by shape identity, a point could never be ambiguous and there was no
 * overlap rule to port. Zones here ARE regions, so overlap is possible and has
 * to be decided explicitly. See compareZonePrecedence.
 */
export interface DirectionZone {
  id: string
  /**
   * Zone boundary, normalized. Even/odd across rings, so a ring drawn inside
   * another ring is a hole and is NOT part of the zone — the fill rule
   * QPainterPath::contains() used, and the rule regionArea() already uses.
   */
  rings: Region
  /** Two normalized points. Order is cosmetic; the direction is an axis. */
  direction: NormalizedDirection
  /** Higher wins an overlap. Defaults to 0. */
  priority?: number
}

/** Even/odd containment across a region's rings. */
export function pointInRegion(p: Point, rings: Region | undefined | null): boolean {
  let crossings = 0
  for (const ring of rings ?? []) {
    if (ring.length >= 3 && pointInPolygon(p, ring)) crossings++
  }
  return crossings % 2 === 1
}

/**
 * Granularity at which two zone areas count as the same size, in normalized
 * units. A full page is 1.0, so 1e-9 is far below anything a person can draw
 * and far above float noise.
 */
export const ZONE_AREA_EPSILON = 1e-9

/** Material area of a zone in normalized units, holes removed. */
export function zoneArea(zone: DirectionZone): number {
  const rings = zone.rings.filter((r) => r.length >= 3)
  if (rings.length === 0) return 0
  if (rings.length === 1) return Math.abs(signedPolygonArea(rings[0]!))
  return regionArea(rings)
}

/**
 * OVERLAP RULE — stated, because an unstated one silently miscounts a ceiling.
 *
 * For any probe point the zones containing it are totally ordered by:
 *   1. `priority` descending (absent = 0). An explicit override always wins.
 *   2. smaller material area first. The most SPECIFIC zone wins: a small zone
 *      drawn inside a large one is an estimator carving out an exception, and
 *      that should work without depending on a draw order nobody can see.
 *      Comparing normalized areas is safe — every zone on a page shares one
 *      page box, and scaling all of them by width*height cannot reorder them.
 *   3. later position in the array wins. Callers pass zones in creation order,
 *      so the newest of two identical zones governs, matching how markup layers
 *      already resolve ties in hit.ts.
 *
 * The comparison is total and deterministic; there is no "first match happens
 * to win" path. Ambiguity is not hidden either: a resolution carries EVERY zone
 * containing the probe, and findOverlappingZonePairs reports overlap for a
 * preflight.
 */
export function compareZonePrecedence(
  a: DirectionZone,
  b: DirectionZone,
  aIndex: number,
  bIndex: number,
): number {
  const pa = a.priority ?? 0
  const pb = b.priority ?? 0
  if (pa !== pb) return pb - pa
  // Quantized, not a raw float compare. Two zones an estimator drew the same
  // size differ in the 17th digit, and letting that noise pick the winner would
  // hand the ceiling to whichever zone rounded lower — invisibly, and with a
  // different direction. Quantizing to ZONE_AREA_EPSILON keeps the order total
  // and transitive (it compares integers) while making a human-scale tie an
  // actual tie, which then falls to declaration order.
  const aa = Math.round(zoneArea(a) / ZONE_AREA_EPSILON)
  const ab = Math.round(zoneArea(b) / ZONE_AREA_EPSILON)
  if (aa !== ab) return aa - ab
  return bIndex - aIndex
}

/** Every zone containing `probe`, best first under the overlap rule. */
export function zonesContaining(probe: Point, zones: readonly DirectionZone[]): DirectionZone[] {
  const hits: Array<{ zone: DirectionZone; index: number }> = []
  zones.forEach((zone, index) => {
    if (pointInRegion(probe, zone.rings)) hits.push({ zone, index })
  })
  hits.sort((l, r) => compareZonePrecedence(l.zone, r.zone, l.index, r.index))
  return hits.map((h) => h.zone)
}

export interface ZoneResolution {
  zone: DirectionZone
  /** Every zone containing the probe, winner first. length > 1 means overlap. */
  candidates: DirectionZone[]
}

/** Resolve a normalized point to the zone that governs it, or null. */
export function resolveDirectionZone(
  probe: Point,
  zones: readonly DirectionZone[],
): ZoneResolution | null {
  const candidates = zonesContaining(probe, zones)
  const zone = candidates[0]
  return zone ? { zone, candidates } : null
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = cross(p3, p4, p1)
  const d2 = cross(p3, p4, p2)
  const d3 = cross(p1, p2, p3)
  const d4 = cross(p1, p2, p4)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  const onSeg = (a: Point, b: Point, c: Point) =>
    Math.min(a.x, b.x) <= c.x &&
    c.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= c.y &&
    c.y <= Math.max(a.y, b.y)
  if (d1 === 0 && onSeg(p3, p4, p1)) return true
  if (d2 === 0 && onSeg(p3, p4, p2)) return true
  if (d3 === 0 && onSeg(p1, p2, p3)) return true
  if (d4 === 0 && onSeg(p1, p2, p4)) return true
  return false
}

function zonesOverlap(a: DirectionZone, b: DirectionZone): boolean {
  for (const ring of a.rings) {
    for (const p of ring) if (pointInRegion(p, b.rings)) return true
  }
  for (const ring of b.rings) {
    for (const p of ring) if (pointInRegion(p, a.rings)) return true
  }
  for (const ra of a.rings) {
    if (ra.length < 2) continue
    for (let i = 0; i < ra.length; i++) {
      const a1 = ra[i]!
      const a2 = ra[(i + 1) % ra.length]!
      for (const rb of b.rings) {
        if (rb.length < 2) continue
        for (let j = 0; j < rb.length; j++) {
          const b1 = rb[j]!
          const b2 = rb[(j + 1) % rb.length]!
          if (segmentsIntersect(a1, a2, b1, b2)) return true
        }
      }
    }
  }
  return false
}

/**
 * Zone pairs that share ground. A preflight surface, not a resolution rule.
 *
 * The Qt build blocked outright ("multiple Area Orientations target the same
 * Area; keep one Area Orientation") because it could not resolve ambiguity.
 * Here it resolves deterministically instead, but overlapping zones running at
 * different angles are still almost always a mistake, so they stay reportable.
 * Pairs whose directions share an axis are reported too: they change no
 * quantity by themselves, but they still split one ceiling into two layout
 * groups (see directionGroupKey).
 */
export function findOverlappingZonePairs(
  zones: readonly DirectionZone[],
  page: PageSize,
): Array<{ a: string; b: string; sameAxis: boolean }> {
  const out: Array<{ a: string; b: string; sameAxis: boolean }> = []
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const za = zones[i]!
      const zb = zones[j]!
      if (!zonesOverlap(za, zb)) continue
      const aa = normalizedDirectionAngle(za.direction, page)
      const ab = normalizedDirectionAngle(zb.direction, page)
      out.push({
        a: za.id,
        b: zb.id,
        sameAxis: aa !== null && ab !== null && sameAxis(aa, ab, 1e-6),
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type PatternDirectionSource = 'zone' | 'page' | 'scope' | 'scope-specification'

export interface PatternDirectionContext {
  /** Page box of the page being laid out, in PDF points. */
  page: PageSize
  /** Direction zones on this page, in creation order. */
  zones?: readonly DirectionZone[]
  /** One page-wide override, normalized. */
  pageDirection?: NormalizedDirection | null
  /** The scope default orientation as drawn in some document, normalized. */
  scopeDirection?: NormalizedDirection | null
  /**
   * Page box the scope default was drawn on. redbeamDirectionLineForTargetPage
   * scales a scope default by its SOURCE page and carries only the resulting
   * vector to the target page, discarding position. Defaults to `page` when the
   * default was drawn on the page in hand.
   */
  scopeDirectionPage?: PageSize | null
  /** Falls back to specifications.scopeDefaultDirection when no default is drawn. */
  scope?: { specifications?: Record<string, unknown> | null } | null
}

export interface PatternDirectionResolution {
  source: PatternDirectionSource
  /** Set only when a zone won. */
  zoneId?: string
  /** Unit vector in PDF points on the target page. */
  unit: Point
  /** Axis angle, degrees in [0,180), y-down. See ANGLE CONVENTION. */
  angleDegrees: number
  /** Ids of every zone containing the probe, winner first. length > 1 = overlap. */
  candidateZoneIds: string[]
}

function resolutionFrom(
  direction: NormalizedDirection,
  page: PageSize,
  source: PatternDirectionSource,
  zoneId: string | undefined,
  candidateZoneIds: string[],
): PatternDirectionResolution | null {
  const seg = patternDirectionLine([direction[0], direction[1]], page)
  if (!seg) return null
  const unit = directionUnitVector(seg)
  if (!unit) return null
  const out: PatternDirectionResolution = {
    source,
    unit,
    angleDegrees: axisAngleDegrees(seg),
    candidateZoneIds,
  }
  if (zoneId !== undefined) out.zoneId = zoneId
  return out
}

/**
 * Which direction governs a normalized point on a page.
 *
 * Precedence, carried across from the comment block in redbeamComputeLayout:
 *   - explicit shape (here: zone) directions apply only inside their own zone;
 *   - an explicit page direction applies to everything on the page that no zone
 *     claims;
 *   - the scope default applies only when neither a zone nor a page direction
 *     exists;
 *   - the scope's persisted `scopeDefaultDirection` specification is the last
 *     resort, so a scope spanning several PDFs is not blocked in every document
 *     but the one its default was drawn in (Round 3 defect #02).
 *
 * Returns null when nothing resolves. That is the layout blocker the Qt build
 * phrased as "add an Area, Page, or Scope Default Orientation": a caller must
 * refuse to lay out, never guess a direction.
 */
export function resolvePatternDirection(
  probe: Point,
  ctx: PatternDirectionContext,
): PatternDirectionResolution | null {
  const zoneHit = resolveDirectionZone(probe, ctx.zones ?? [])
  const candidateZoneIds = zoneHit ? zoneHit.candidates.map((z) => z.id) : []

  if (zoneHit) {
    const r = resolutionFrom(
      zoneHit.zone.direction,
      ctx.page,
      'zone',
      zoneHit.zone.id,
      candidateZoneIds,
    )
    // A zone whose direction is degenerate falls through rather than blocking
    // the page: it is an unfinished zone, not a statement that nothing runs
    // here. The Qt engine has the same shape — every direction call site tests
    // length() > 0 and keeps looking.
    if (r) return r
  }

  if (ctx.pageDirection) {
    const r = resolutionFrom(ctx.pageDirection, ctx.page, 'page', undefined, candidateZoneIds)
    if (r) return r
  }

  if (ctx.scopeDirection) {
    // Position is discarded and only the vector crosses pages, exactly like
    // redbeamDirectionLineForTargetPage: the scope default is an orientation,
    // not a place, and the source sheet may be a different size.
    const src = ctx.scopeDirectionPage ?? ctx.page
    const seg = patternDirectionLine([ctx.scopeDirection[0], ctx.scopeDirection[1]], src)
    const unit = seg ? directionUnitVector(seg) : null
    if (seg && unit) {
      return { source: 'scope', unit, angleDegrees: axisAngleDegrees(seg), candidateZoneIds }
    }
  }

  const spec = scopeDefaultDirection(ctx.scope ?? null)
  if (spec) {
    // The synthetic scope default in the Qt build is materialised as an
    // annotation ON THE TARGET PAGE, so the specification vector is read in the
    // target page's box, not in a remembered source box.
    const r = resolutionFrom(spec, ctx.page, 'scope-specification', undefined, candidateZoneIds)
    if (r) return r
  }

  return null
}

/**
 * Layout grouping key. Port of the `directionZoneKeyForArea` lambda.
 *
 * Two areas are laid out as one run only when their keys match. Page- and
 * scope-default areas stay SEPARATE groups even when they share an orientation:
 * the Qt comment is explicit that cross-area alignment must be an explicit
 * future pattern-field choice, and merging them here would move seams and
 * therefore piece counts. Do not "simplify" this to group by angle.
 */
export function directionGroupKey(
  resolution: PatternDirectionResolution,
  areaId: string,
): string {
  switch (resolution.source) {
    case 'zone':
      return `zone:${resolution.zoneId ?? 'unknown'}:area:${areaId}`
    case 'page':
      return `page:area:${areaId}`
    default:
      return `scope:area:${areaId}`
  }
}
