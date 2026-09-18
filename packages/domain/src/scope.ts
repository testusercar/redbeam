/**
 * Scope / markup / calibration domain types and the quantity roll-up.
 *
 * Types mirror the SQLite schema in packages/store/migrations (ported from
 * okular-redbeam). Keep them in sync: the store is the system of record and
 * source PDFs are read-only, per the original architecture decision.
 *
 * This module is deliberately dependency-free — no DOM, no SQL, no rendering.
 * That constraint is what made the C++ domain layer portable in the first place
 * and it is enforced here by `npm run check:domain-purity`.
 */

import { regionArea, regionEdgeLengths, regionPerimeter, polylineLength, trimPiecesForEdges, type Point, type Polygon, type Region } from './geometry.js'
import { clipRingToRings, ringsOverlap, subtractRings } from './clip.js'
import { unitToFeet } from './units.js'

export type ScopeType = 'area' | 'linear' | 'count'
/**
 * `shape` is a freeform annotation polygon: it is drawn, selected and moved
 * like any other markup but contributes NOTHING to a quantity. Keeping it in
 * the same table and the same tooling — rather than a parallel "annotations"
 * concept — is what lets it be selected, undone and scoped alongside real
 * takeoff geometry; keeping it out of every calculation is what stops it
 * inflating a bid.
 */
export type MarkupKind =
  | 'area' | 'polyline' | 'count' | 'cutout'
  | 'shape' | 'calibration'
  // Annotation kinds. Like `shape`, none of these is takeoff geometry and none
  // reaches a quantity; they carry their payload in `content`.
  | 'dimension' | 'callout' | 'highlight'

export interface Calibration {
  /** Drawing feet represented by one PDF point on this page. */
  feetPerPoint: number
  pageWidth: number
  pageHeight: number
}

export interface Scope {
  id: string
  label: string
  scopeType: ScopeType
  color: string
  /** Free-form product specs (panel size, yield granularity, etc.). */
  specifications: Record<string, unknown>
  archivedAt?: string | null
}

export interface Markup {
  id: string
  scopeId: string | null
  documentId: string
  pageId: string
  kind: MarkupKind
  /**
   * Rings in NORMALIZED page coordinates [0,1].
   * For `polyline` and `count` only the first ring is meaningful.
   */
  rings: Region
}

export interface QuantityResult {
  itemKey: string
  label: string
  quantity: number
  unit: string
  details?: Record<string, unknown>
}

/** Convert a normalized ring to PDF points using the page box. */
export function ringToPoints(ring: Point[], cal: Calibration): Point[] {
  return ring.map((p) => ({ x: p.x * cal.pageWidth, y: p.y * cal.pageHeight }))
}

/**
 * Rings that actually participate in the area calculation, for markups that
 * are all on the SAME PAGE.
 *
 * A cutout removes the part of it that lies inside an area, and only that
 * part. The Qt build subtracted cutouts into a QPainterPath and got this
 * for free; reconstructing from explicit rings lost it twice over:
 *
 *  - a cutout drawn on blank paper sat at nesting depth 0 and regionArea()
 *    ADDED it as material. Caught early, and filtered by whether its first
 *    vertex was inside an area;
 *  - a cutout that STARTED inside an area and ran past its edge passed that
 *    filter, and the part outside sat at depth 1 under its own ring alone,
 *    which even/odd counts as material. Kenneth, 2026-09-10: "the cutout tool
 *    appears to be adding product instead of removing it". And one that
 *    started outside and ran in was dropped: "it doesn't actually work".
 *
 * So the cutouts are CLIPPED now: the material is the union of the areas
 * with every overlapping cutout subtracted (clip.ts). A cutout that touches
 * no area does nothing, as before. With no overlapping cutout the area rings
 * are returned exactly as drawn.
 *
 * Callers with markups from more than one page must use areaSquareFeet, which
 * groups first. Passing mixed pages here treats two sheets as one plane.
 */
export function effectiveAreaRings(markups: Markup[], cal: Calibration): Region {
  const areaRings: Region = []
  const cutRings: Region = []
  for (const m of markups) {
    if (m.kind === 'area') for (const r of m.rings) areaRings.push(ringToPoints(r, cal))
    else if (m.kind === 'cutout') for (const r of m.rings) cutRings.push(ringToPoints(r, cal))
  }
  if (areaRings.length === 0) return []

  const applicable = cutRings.filter((c) => areaRings.some((a) => ringsOverlap(c, a)))
  if (applicable.length === 0) return areaRings
  return subtractRings(areaRings, applicable)
}

/** Area rings of `markups` on the cutout's page and in its scope, in points. */
function areasAround(cutout: Markup, markups: readonly Markup[], cal: Calibration): Polygon[] {
  const out: Polygon[] = []
  for (const m of markups) {
    if (m.kind !== 'area' || m.pageId !== cutout.pageId || m.scopeId !== cutout.scopeId) continue
    for (const r of m.rings) out.push(ringToPoints(r, cal))
  }
  return out
}

/**
 * What ONE cutout removes, in square feet: the part of it inside the areas
 * of its own scope on its own sheet. Zero for a cutout beside every area.
 *
 * For the markups list, which shows each shape's own measurement. Measuring
 * a lone cutout with areaSquareFeet gives 0, there being no area in the list
 * for it to open, which is how every cutout read "-0.0 SF" while the
 * scope's total was right.
 */
export function cutoutSquareFeet(cutout: Markup, markups: readonly Markup[], cal: Calibration): number {
  if (cutout.kind !== 'cutout') return 0
  const areas = areasAround(cutout, markups, cal)
  if (areas.length === 0) return 0
  let points2 = 0
  for (const r of cutout.rings) points2 += regionArea(clipRingToRings(ringToPoints(r, cal), areas))
  return points2 * cal.feetPerPoint * cal.feetPerPoint
}

/**
 * True when the cutout removes anything: some area of its scope on its
 * sheet shares interior with it. The rule `effectiveAreaRings` applies,
 * exposed so a cutout that subtracts nothing can be pointed at.
 */
export function cutoutSubtracts(cutout: Markup, markups: readonly Markup[]): boolean {
  if (cutout.kind !== 'cutout') return false
  // Normalized coordinates are fine for an overlap test: the question is
  // topological and the page box scales both rings alike.
  for (const m of markups) {
    if (m.kind !== 'area' || m.pageId !== cutout.pageId || m.scopeId !== cutout.scopeId) continue
    for (const a of m.rings) for (const c of cutout.rings) if (ringsOverlap(c, a)) return true
  }
  return false
}

/**
 * Net area in square feet, with `cutout` markups removed as openings via the
 * even/odd nesting rule in regionArea().
 *
 * Grouped BY PAGE, matching the Qt build's stated basis: "union of areas minus
 * intersecting cutouts per page". Without the grouping, a cutout on one sheet
 * punches a hole in an area that happens to overlap it in normalized
 * coordinates on a different sheet — and normalized coordinates make that
 * likely, not rare, since every sheet spans the same 0..1 box.
 *
 * Measured on the Turkish Airlines Lounge fixture: a cutout placed on an
 * unrelated page removed 226 SF of 4,128 before this grouping existed. Nothing
 * on screen would have shown it, because the offending markup is on a sheet
 * the estimator is not looking at.
 */
export function areaSquareFeet(markups: Markup[], cal: Calibration): number {
  const byPage = new Map<string, Markup[]>()
  for (const m of markups) {
    const list = byPage.get(m.pageId)
    if (list) list.push(m)
    else byPage.set(m.pageId, [m])
  }

  let total = 0
  for (const page of byPage.values()) {
    const rings = effectiveAreaRings(page, cal)
    if (rings.length === 0) continue
    total += regionArea(rings) * cal.feetPerPoint * cal.feetPerPoint
  }
  return total
}

/** Total perimeter in linear feet across every area markup. */
export function perimeterFeet(markups: Markup[], cal: Calibration): number {
  const rings: Region = []
  for (const m of markups) {
    if (m.kind !== 'area') continue
    for (const ring of m.rings) rings.push(ringToPoints(ring, cal))
  }
  return regionPerimeter(rings) * cal.feetPerPoint
}

/**
 * Perimeter trim pieces across every area markup, cut per EDGE: each edge of
 * each ring — cutouts included, since a cutout's edge is trimmed too — is
 * divided by the trim length and rounded up on its own, and the pieces are
 * summed (Aaron, 2026-09-18: "divide each segment of the perimeter by the
 * total length of the desired trim to get the number of unique parts").
 */
export function perimeterTrimPieces(markups: Markup[], cal: Calibration, trimLengthFeet: number): number {
  if (!(trimLengthFeet > 0)) return 0
  const rings: Region = []
  for (const m of markups) {
    if (m.kind !== 'area') continue
    for (const ring of m.rings) rings.push(ringToPoints(ring, cal))
  }
  return trimPiecesForEdges(regionEdgeLengths(rings).map((d) => d * cal.feetPerPoint), trimLengthFeet)
}

/** Total length in linear feet across every polyline markup. */
export function linearFeet(markups: Markup[], cal: Calibration): number {
  let total = 0
  for (const m of markups) {
    if (m.kind !== 'polyline') continue
    const ring = m.rings[0]
    if (!ring) continue
    total += polylineLength(ring, cal.pageWidth, cal.pageHeight) * cal.feetPerPoint
  }
  return total
}

/** Number of count markups. */
export function countEach(markups: Markup[]): number {
  return markups.filter((m) => m.kind === 'count').length
}

/**
 * Roll a scope up to quantities.
 *
 * NOTE: this covers the measurement quantities only (SF / LF / EA). The piece
 * and BOM layer — redbeamAllowedPieceFractions, redbeamBuildBafflePieces,
 * redbeamQuantityBomText and the layout/yield engine in the Qt build — is NOT
 * ported yet. That is the largest remaining chunk and it must be ported against
 * golden fixtures captured from the Qt build, not re-derived. See docs/PORTING.md.
 */
export function calculateScopeQuantities(
  scope: Scope,
  markups: Markup[],
  cal: Calibration,
): QuantityResult[] {
  const mine = markups.filter((m) => m.scopeId === scope.id)
  const out: QuantityResult[] = []

  switch (scope.scopeType) {
    case 'area': {
      out.push({ itemKey: 'area_sf', label: 'Area', quantity: areaSquareFeet(mine, cal), unit: 'SF' })
      out.push({ itemKey: 'perimeter_lf', label: 'Perimeter', quantity: perimeterFeet(mine, cal), unit: 'LF' })
      break
    }
    case 'linear': {
      out.push({ itemKey: 'length_lf', label: 'Length', quantity: linearFeet(mine, cal), unit: 'LF' })
      break
    }
    case 'count': {
      out.push({ itemKey: 'count_ea', label: 'Count', quantity: countEach(mine), unit: 'EA' })
      break
    }
  }
  return out
}

/**
 * Whether a markup of this kind contributes to any quantity in this scope type.
 *
 * This is the guard behind the silent no-op: calculateScopeQuantities emits
 * only the rows matching the scope type, so a polyline drawn into an `area`
 * scope feeds nothing, appears in no row, and looks exactly like a markup that
 * was counted. The estimator sees their linear run on screen and assumes it is
 * in the number. It is not.
 *
 * `shape` is deliberately false everywhere and is NOT a mistake to warn about —
 * it is annotation by design. Callers should treat it separately.
 */
export function markupCountsInScope(scopeType: ScopeType, kind: MarkupKind): boolean {
  switch (scopeType) {
    // cutout counts in the sense that it CHANGES the area result
    case 'area': return kind === 'area' || kind === 'cutout'
    case 'linear': return kind === 'polyline'
    case 'count': return kind === 'count'
  }
}

/**
 * The kinds that can ever reach a quantity in SOME scope type.
 *
 * Everything else — shape, calibration, dimension, callout, highlight — is
 * annotation or setup, and drawing one is never a scope mismatch.
 */
export const TAKEOFF_KINDS: readonly MarkupKind[] = ['area', 'cutout', 'polyline', 'count'] as const

/**
 * Human-readable warning when a tool will produce a markup this scope ignores,
 * or null when the pairing is fine.
 *
 * Non-takeoff kinds return null: warning about a dimension or a callout would
 * train people to dismiss the one warning that actually costs money.
 */
export function scopeToolWarning(scope: Scope, kind: MarkupKind): string | null {
  if (!TAKEOFF_KINDS.includes(kind)) return null
  if (markupCountsInScope(scope.scopeType, kind)) return null
  const wants: Record<ScopeType, string> = {
    area: 'area and cutout markups',
    linear: 'linear markups',
    count: 'count markups',
  }
  const article = scope.scopeType === 'area' ? 'an' : 'a'
  return `"${scope.label}" is ${article} ${scope.scopeType} scope and counts only ${wants[scope.scopeType]}. This ${kind} will not appear in any quantity.`
}

/** Markup kinds that produce a quantity in this scope type, for tool UI. */
export function countableKinds(scopeType: ScopeType): MarkupKind[] {
  const all: MarkupKind[] = ['area', 'cutout', 'polyline', 'count']
  return all.filter((k) => markupCountsInScope(scopeType, k))
}

/**
 * Build a page calibration from a measured reference: the user draws a line of
 * known real-world length and states what it should be.
 */
export function calibrationFromReference(
  pixelLengthPoints: number,
  knownValue: number,
  knownUnit: string,
  pageWidth: number,
  pageHeight: number,
): Calibration | null {
  const feet = unitToFeet(knownValue, knownUnit)
  if (feet === null || pixelLengthPoints <= 0 || !Number.isFinite(feet)) return null
  return { feetPerPoint: feet / pixelLengthPoints, pageWidth, pageHeight }
}
