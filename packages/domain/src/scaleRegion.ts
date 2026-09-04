/**
 * Scale REGIONS: more than one scale on a sheet.
 *
 * A calibration has been one number per page since the Qt build, and for a plan
 * that is right. It is wrong for the sheet a set actually contains most of: a
 * details page carrying four details at four scales, where a single number for
 * the page is correct for one of them and silently wrong for three.
 *
 * A region is a rectangle in normalized page coordinates with its own feet per
 * point. A markup resolves against the regions first and the page scale second.
 *
 * THE RULE THAT GOVERNS THIS FILE, and the reason it does not do more:
 * nothing here infers a scale. Not from a neighbouring region, not from the
 * page, not from a region that is nearly containing. A markup that resolves to
 * nothing is UNCALIBRATED and must block, because a drawing that measures
 * confidently to the wrong number is worse than one that refuses to measure —
 * it is wrong, and it looks right.
 *
 * `scale.ts` is the ported preset table and is deliberately untouched; this is
 * the new concept sitting beside it.
 */

/** A rectangle in normalized page coordinates, corners in any order. */
export interface ScaleRect { x0: number, y0: number, x1: number, y1: number }

export interface ScaleRegion {
  id: string
  pageId: string
  rect: ScaleRect
  feetPerPoint: number
  /** What it is — "Detail 3 / head". Shown in the page's scale list. */
  label: string
}

export function normalizeRect(r: ScaleRect): ScaleRect {
  return {
    x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1),
    x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1),
  }
}

export function rectContains(rect: ScaleRect, p: { x: number, y: number }): boolean {
  const r = normalizeRect(rect)
  return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1
}

export function rectArea(rect: ScaleRect): number {
  const r = normalizeRect(rect)
  return Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0)
}

/** Relative agreement, matching `PRESET_MATCH_TOLERANCE` in scale.ts. */
function sameScale(a: number, b: number): boolean {
  const larger = Math.max(Math.abs(a), Math.abs(b))
  return larger === 0 ? true : Math.abs(a - b) / larger <= 0.001
}

/**
 * The scale in force at a point.
 *
 * The SMALLEST containing region wins, so a region drawn inside another
 * overrides it — which is how a person expects a detail inside a detail to
 * behave, and the only rule that makes overlapping regions predictable rather
 * than a question of which was drawn first. Ties break on id, so the answer
 * never depends on the order rows came back from the database.
 *
 * Falls through to the page scale, then to null. Null is the point of the
 * function: it means uncalibrated, and it must propagate.
 */
export function scaleAt(
  point: { x: number, y: number },
  regions: readonly ScaleRegion[],
  pageScale: number | null,
): number | null {
  let best: ScaleRegion | null = null
  for (const region of regions) {
    if (!rectContains(region.rect, point)) continue
    if (best === null) { best = region; continue }
    const here = rectArea(region.rect)
    const winner = rectArea(best.rect)
    if (here < winner || (here === winner && region.id < best.id)) best = region
  }
  return best === null ? pageScale : best.feetPerPoint
}

export interface ResolvedScale {
  feetPerPoint: number | null
  /** The region that supplied it, or null when the page scale did. */
  regionId: string | null
  /**
   * Set when the markup's own extent spans two different scales. There is no
   * right measurement in that case — it is measuring two drawings at once —
   * so the only honest thing is to name it.
   */
  warning: string | null
}

/**
 * The scale for a markup, resolved at its centroid.
 *
 * Centroid rather than "every vertex must be inside", because a region drawn
 * by hand will clip a stray vertex of a markup that plainly belongs to it, and
 * blocking on that would be maddening in exactly the situation this feature
 * exists to serve.
 *
 * But a markup genuinely straddling two scales is a real measurement error, so
 * that is reported. The comparison is on the NUMBERS rather than the region
 * ids: two adjacent regions at the same scale are not a conflict, and
 * interrupting somebody about one would train them to ignore the warning.
 */
export function resolveScaleForRings(
  rings: ReadonlyArray<ReadonlyArray<{ x: number, y: number }>>,
  regions: readonly ScaleRegion[],
  pageScale: number | null,
): ResolvedScale {
  const points = rings.flat()
  if (points.length === 0) return { feetPerPoint: pageScale, regionId: null, warning: null }

  let sx = 0
  let sy = 0
  for (const p of points) { sx += p.x; sy += p.y }
  const centroid = { x: sx / points.length, y: sy / points.length }

  const feetPerPoint = scaleAt(centroid, regions, pageScale)

  const straddles = points.some((p) => {
    const here = scaleAt(p, regions, pageScale)
    if (here === null || feetPerPoint === null) return here !== feetPerPoint
    return !sameScale(here, feetPerPoint)
  })

  let regionId: string | null = null
  if (feetPerPoint !== null) {
    for (const r of regions) {
      if (rectContains(r.rect, centroid) && sameScale(r.feetPerPoint, feetPerPoint)) {
        regionId = r.id
        break
      }
    }
  }

  return {
    feetPerPoint,
    regionId,
    warning: straddles
      ? 'this markup crosses a scale boundary — part of it is drawn at a different '
        + 'scale from the one it is being measured at'
      : null,
  }
}

/**
 * Regions that overlap another at a DIFFERENT scale.
 *
 * Overlap is legal and useful when it is nesting — a detail within a detail —
 * and the smallest-wins rule makes that unambiguous. A partial overlap between
 * two different scales is something else: neither contains the other, so which
 * one applies depends on where a markup happens to sit, and that is worth
 * surfacing while the regions are being drawn rather than discovering through
 * a quantity that looks odd.
 */
export function conflictingRegions(regions: readonly ScaleRegion[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (let i = 0; i < regions.length; i++) {
    for (let j = i + 1; j < regions.length; j++) {
      const a = normalizeRect(regions[i]!.rect)
      const b = normalizeRect(regions[j]!.rect)
      if (sameScale(regions[i]!.feetPerPoint, regions[j]!.feetPerPoint)) continue
      const overlaps = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
      if (!overlaps) continue
      // Nesting is deliberate and resolved by smallest-wins; only a partial
      // overlap is ambiguous.
      const aInB = a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1
      const bInA = b.x0 >= a.x0 && b.y0 >= a.y0 && b.x1 <= a.x1 && b.y1 <= a.y1
      if (aInB || bInA) continue
      out.push([regions[i]!.id, regions[j]!.id])
    }
  }
  return out
}
