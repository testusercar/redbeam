/**
 * Scope quantities when a sheet carries more than one scale.
 *
 * `areaSquareFeet` and its neighbours in scope.ts are the ported Qt engine and
 * take ONE calibration, applying it to everything they are handed. That is
 * correct for a plan and wrong for a details sheet, where four details sit at
 * four scales and one number is right for one of them.
 *
 * The grouping is the whole idea. Markups are bucketed by page AND by the
 * scale region they resolve into, and each bucket is measured by the ported
 * functions at its own scale. Grouping by region rather than measuring each
 * markup alone is not a shortcut — it is what keeps CUTOUTS working. A hole
 * drawn inside detail 3 has to subtract from detail 3's area, and it can only
 * do that if the two are aggregated together.
 *
 * Nothing here invents a scale. A bucket that resolves to no scale at all is
 * returned as `unscaled` and contributes NOTHING to the total, so a sheet with
 * an uncalibrated corner reports a smaller number and says why, rather than
 * quietly measuring that corner at whatever scale was nearest.
 */
import { areaSquareFeet, perimeterFeet, linearFeet, type Calibration, type Markup } from './scope.js'
import { resolveScaleForRings, type ScaleRegion } from './scaleRegion.js'

export interface RegionBucket {
  pageId: string
  /** Null when the page scale supplied it, or when there is no scale. */
  regionId: string | null
  feetPerPoint: number | null
  markups: Markup[]
  /** Markups whose extent crosses a scale boundary. */
  straddling: string[]
}

export interface PageGeometry {
  width: number
  height: number
}

/**
 * Bucket markups by the scale that applies to them.
 *
 * `pageScale` and `pageSize` are looked up per page, because a scope follows a
 * ceiling across sheets that are not the same size and not at the same scale.
 */
export function bucketByScale(
  markups: readonly Markup[],
  regionsByPage: ReadonlyMap<string, readonly ScaleRegion[]>,
  pageScale: (pageId: string) => number | null,
): RegionBucket[] {
  const buckets = new Map<string, RegionBucket>()

  for (const m of markups) {
    const regions = regionsByPage.get(m.pageId) ?? []
    const resolved = resolveScaleForRings(m.rings, regions, pageScale(m.pageId))
    // Keyed on the SCALE as well as the region, so two regions at the same
    // scale still measure separately — they are different details, and their
    // cutouts must not cross between them.
    const key = `${m.pageId}::${resolved.regionId ?? 'page'}`
    let bucket = buckets.get(key)
    if (bucket === undefined) {
      bucket = {
        pageId: m.pageId,
        regionId: resolved.regionId,
        feetPerPoint: resolved.feetPerPoint,
        markups: [],
        straddling: [],
      }
      buckets.set(key, bucket)
    }
    bucket.markups.push(m)
    if (resolved.warning !== null) bucket.straddling.push(m.id)
  }

  // Sorted so a roll-up is reproducible: the same project must produce the
  // same number in the same order every time it is opened.
  return [...buckets.values()].sort((a, b) =>
    a.pageId.localeCompare(b.pageId) || (a.regionId ?? '').localeCompare(b.regionId ?? ''))
}

export interface RegionAwareTotals {
  areaSquareFeet: number
  perimeterFeet: number
  linearFeet: number
  /** Markups that could not be measured because nothing gave them a scale. */
  unscaled: string[]
  /** Markups drawn across a boundary between two different scales. */
  straddling: string[]
}

/**
 * Roll a scope up across sheets and scale regions.
 *
 * Each bucket is measured by the ported engine at its own scale and the
 * results are summed — areas add across details the same way they add across
 * sheets, because they are separate pieces of the same ceiling.
 */
export function totalsByRegion(
  markups: readonly Markup[],
  regionsByPage: ReadonlyMap<string, readonly ScaleRegion[]>,
  pageScale: (pageId: string) => number | null,
  pageSize: (pageId: string) => PageGeometry | null,
): RegionAwareTotals {
  const out: RegionAwareTotals = {
    areaSquareFeet: 0, perimeterFeet: 0, linearFeet: 0, unscaled: [], straddling: [],
  }

  for (const bucket of bucketByScale(markups, regionsByPage, pageScale)) {
    out.straddling.push(...bucket.straddling)
    const size = pageSize(bucket.pageId)
    if (bucket.feetPerPoint === null || size === null) {
      // No scale, or no page box to normalize against. Either way it is not
      // measurable, and adding a zero would be indistinguishable from a real
      // zero — which is the difference between "nothing here" and "we could
      // not tell".
      out.unscaled.push(...bucket.markups.map((m) => m.id))
      continue
    }
    const cal: Calibration = {
      feetPerPoint: bucket.feetPerPoint,
      pageWidth: size.width,
      pageHeight: size.height,
    }
    out.areaSquareFeet += areaSquareFeet(bucket.markups, cal)
    out.perimeterFeet += perimeterFeet(bucket.markups, cal)
    out.linearFeet += linearFeet(bucket.markups, cal)
  }

  return out
}
