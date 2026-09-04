/**
 * Scope roll-up to ORDERABLE quantities (plan 06 integration).
 *
 * scope.ts answers "how much area" — the measurement layer, proven against the
 * Qt build. This answers "how many pieces do I buy", which is the layer the
 * bid actually needs, and it is where the product type finally matters.
 *
 * The grouping here is the load-bearing part and is easy to get subtly wrong:
 *
 *   - Groups are keyed by PAGE as well as by direction. Normalized coordinates
 *     repeat on every sheet, so two markups at the same 0..1 position on
 *     different sheets must never share a grid.
 *   - Under a scope-default direction, directionGroupKey carries the AREA id,
 *     so every area lays out on its own grid rather than one grid spanning the
 *     sheet. On the C-MT-02 fixture that distinction is the difference between
 *     54 panels and 49 — seams do not run across a gap between two ceilings.
 *   - Cutouts join their area's group as nested rings. regionArea's even/odd
 *     rule then treats them as holes, and the cell clipper sees the opening.
 */

import { resolveScaleForRings, type ScaleRegion } from './scaleRegion.js'
import { ringToPoints, type Calibration, type Markup, type Scope } from './scope.js'
import type { Point, Region } from './geometry.js'
import {
  directionGroupKey, resolvePatternDirection, type PageSize,
  type NormalizedDirection,
} from './pattern.js'
import { layoutPanels, scopeDefaultGridLine, type PanelCell, type PanelLayoutGroup } from './panels.js'
import {
  layoutRuns, resolveRunInputs, runQuantities, summarizeRuns,
  type RunGroup, type RunLayoutEntry,
} from './runs.js'
import type { Segment } from './pattern.js'
import {
  measureToFeet, missingRequiredMeasures, readGranularity,
  readProductType, type ProductType, type Specifications,
} from './specs.js'

/** One orderable line. `unit` is EA for pieces, matching the Qt BOM. */
export interface PieceQuantity {
  itemKey: string
  label: string
  quantity: number
  unit: string
}

export interface PieceResult {
  productType: ProductType
  quantities: PieceQuantity[]
  /**
   * The laid-out cells, for the preview. Empty when nothing was laid out.
   * Carried on the result rather than recomputed by the renderer: a preview
   * drawn from a second layout run could disagree with the count beside it.
   */
  cells: PanelCell[]
  /**
   * Why nothing could be calculated, in the estimator's words. Empty means the
   * numbers are real. Non-empty means they are ABSENT, not zero — a scope
   * missing its panel width has no panel count, and reporting 0 would read as
   * "nothing to order".
   */
  blockers: string[]
  /**
   * The laid-out runs, for products made of runs rather than panel cells.
   *
   * Planks, baffles and cassettes produce no `cells` — their geometry is a set
   * of cut pieces along a run, not a grid — so a preview built only on `cells`
   * had nothing to draw for them and silently drew nothing. The counts were
   * right and the picture was blank, which is the one combination that makes a
   * number impossible to check by eye.
   */
  runs: RunLayoutEntry[]
}

export interface PieceOptions {
  /**
   * The scope's default pattern direction, in normalized coordinates, with the
   * page it was drawn on. Without a direction there is no grid and no layout:
   * the Qt build blocks with "add an Area, Page, or Scope Default Orientation"
   * rather than guessing, and so does this.
   */
  /**
   * Lay each area out on its own grid instead of one shared across the sheet.
   *
   * Runs already do this: `selectAutomaticOrigin` starts from the region's own
   * centre and searches for the phase that covers it in the fewest pieces, so
   * a plank scope is optimised per area whatever this says. Panels are the
   * ones pinned to the sheet, because that is what the Qt build does and what
   * the golden fixtures capture.
   */
  perAreaOrigin?: boolean
  /**
   * A direction stated for a whole sheet, by page id — the FIRST one set on
   * that sheet for this scope. Beaten by an area's own, beats the scope
   * default. See `directionFrom`.
   */
  pageDirections?: ReadonlyMap<string, NormalizedDirection>
  /**
   * Scale regions by page id (plan 14.2).
   *
   * A markup inside a region is laid out at that region's scale rather than
   * the sheet's, which is what a details page carrying four details at four
   * scales requires. Omitted means every sheet has one scale, which is the
   * ordinary case and the one the golden fixtures capture.
   */
  scaleRegions?: ReadonlyMap<string, readonly ScaleRegion[]>
  /** A direction stated for one area, by markup id. Beats everything. */
  areaDirections?: ReadonlyMap<string, NormalizedDirection>
  scopeDirection?: NormalizedDirection | null
  /** Page box used for any page not listed in `pageSizes`. */
  pageSize: PageSize
  /**
   * Per-page calibration and page box (plan 06.11).
   *
   * A scope spans sheets, and sheets are not drawn at one scale — a details
   * page is not at the plan's scale, and a page box can differ across a set.
   * Without these, every markup in the scope is converted with the OPEN page's
   * calibration, so a ceiling drawn at 1/4" on sheet 10 is measured at the 1/8"
   * of sheet 9 and comes out at four times its area. The numbers look
   * plausible, which is what makes it expensive.
   *
   * Absent, both fall back to the `cal` argument and `pageSize`, which is
   * correct for the single-page case and is what the fixtures exercise.
   */
  calibrations?: ReadonlyMap<string, Calibration> | undefined
  pageSizes?: ReadonlyMap<string, PageSize> | undefined
}

/**
 * Read a scope's default direction out of its specifications.
 *
 * Real projects store it as a nested object — {sourcePage, x1, y1, x2, y2} —
 * which is exactly why Specifications is Record<string, unknown> rather than
 * a string map. Returns null when it is absent or malformed rather than
 * substituting an axis, because a guessed direction silently moves every seam.
 */
/**
 * Three places a pattern direction can be stated, and why there are three.
 *
 * On a real ceiling plan one orientation usually governs a whole floor: you
 * say it once and everything follows. The exceptions are exceptions — a
 * corridor running the other way, a feature ceiling turned 45 degrees. So the
 * first direction set on a sheet is taken to be the general statement and
 * applies to every area of that scope on it, and each one after that is read
 * as a correction to the specific area it was set from. The common case costs
 * one gesture and the exception costs one more, with no mode to remember.
 *
 * That fixes the precedence, it does not merely suggest it: AREA beats PAGE
 * beats SCOPE. If page beat area, the second gesture would silently do
 * nothing, which is the one outcome that would make the rule unusable.
 *
 * SCOPE is still the cross-sheet fallback — an orientation carried to sheets
 * nobody has stated one on — so a page with no page direction yet takes the
 * general gesture even when the scope already has a default.
 */
export function directionFrom(raw: unknown): NormalizedDirection | null {
  if (raw === null || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const n = (k: string): number | null => (typeof d[k] === 'number' && Number.isFinite(d[k]) ? d[k] : null)
  const x1 = n('x1'), y1 = n('y1'), x2 = n('x2'), y2 = n('y2')
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null
  if (x1 === x2 && y1 === y2) return null   // a zero-length vector is no direction
  return [{ x: x1, y: y1 }, { x: x2, y: y2 }]
}

export function scopeDefaultDirectionFrom(specs: Specifications): NormalizedDirection | null {
  return directionFrom(specs['scopeDefaultDirection'])
}

/** Where the per-sheet and per-area directions live in a scope's specs. */
export const PAGE_DIRECTIONS_KEY = 'pageDirections'
export const AREA_DIRECTIONS_KEY = 'areaDirections'

function directionMap(specs: Specifications, key: string): Map<string, NormalizedDirection> {
  const out = new Map<string, NormalizedDirection>()
  const raw = specs[key]
  if (raw === null || typeof raw !== 'object') return out
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const dir = directionFrom(value)
    if (dir !== null) out.set(id, dir)
  }
  return out
}

/** Directions stated for a whole sheet, by page id. */
export function pageDirectionsFrom(specs: Specifications): Map<string, NormalizedDirection> {
  return directionMap(specs, PAGE_DIRECTIONS_KEY)
}

/** Directions stated for one area, by markup id. */
export function areaDirectionsFrom(specs: Specifications): Map<string, NormalizedDirection> {
  return directionMap(specs, AREA_DIRECTIONS_KEY)
}

/**
 * Build the layout groups for a scope's markups on one calibration.
 *
 * Exported because the grouping, not the cell maths, is where a piece count
 * goes wrong, and it deserves to be testable on its own.
 */
export function layoutGroupsFor(
  markups: readonly Markup[],
  cal: Calibration,
  opts: PieceOptions,
): PanelLayoutGroup[] {
  return groupRegions(markups, cal, opts).map((g) => ({
    // Carried so a preview can tell which cells belong to the sheet it draws.
    pageId: g.pageId,
    region: g.region,
    directionLine: g.directionLine,
    feetPerPoint: g.calibration.feetPerPoint,
  }))
}

/**
 * The same grouping, for run products.
 *
 * Runs need the PAGE that panels can ignore: connectors shared between two runs
 * are one bracket to buy, and the identity of a shared location is its position
 * on a specific sheet. PDF points repeat on every page, so a page-blind key
 * would silently merge two brackets on two floors into one.
 */
export function runGroupsFor(
  markups: readonly Markup[],
  cal: Calibration,
  opts: PieceOptions,
): RunGroup[] {
  return groupRegions(markups, cal, opts).map((g) => ({
    pageId: g.pageId,
    region: g.region,
    direction: { x: g.directionLine.b.x - g.directionLine.a.x, y: g.directionLine.b.y - g.directionLine.a.y },
    feetPerPoint: g.calibration.feetPerPoint,
  }))
}

interface GroupedRegion {
  pageId: string
  region: Region
  /** The calibration this group's rings were converted with. */
  calibration: Calibration
  /** The grid seed, in this page's own PDF points. */
  directionLine: Segment
}

/**
 * Group a scope's areas and cutouts into independent install regions.
 *
 * Shared by both product families so the grouping — which is where a piece
 * count actually goes wrong — cannot drift between them.
 *
 * EVERY page is resolved on its own terms: its own calibration, its own page
 * box, and therefore its own direction line in its own points. A markup on a
 * page with no calibration is skipped rather than measured at another page's
 * scale — a missing scale is reported by the caller as a blocker, and a wrong
 * one is not reported at all.
 */
function groupRegions(
  markups: readonly Markup[],
  cal: Calibration,
  opts: PieceOptions,
): GroupedRegion[] {
  const scopeDirection = opts.scopeDirection ?? null
  const pageDirections = opts.pageDirections
  const areaDirections = opts.areaDirections
  // Any of the three is enough to lay something out. A scope with no default
  // but a direction stated on this sheet is not blocked.
  if (!scopeDirection && (pageDirections?.size ?? 0) === 0 && (areaDirections?.size ?? 0) === 0) {
    return []
  }

  /**
   * AREA beats PAGE beats SCOPE — see `directionFrom`.
   *
   * Forced, not chosen: the first direction on a sheet is the general
   * statement and each one after it corrects a specific area, so if page beat
   * area the second gesture would silently do nothing.
   */
  const directionFor = (m: Markup): NormalizedDirection | null =>
    areaDirections?.get(m.id) ?? pageDirections?.get(m.pageId) ?? scopeDirection

  const calFor = (pageId: string): Calibration | null =>
    opts.calibrations?.get(pageId) ?? (opts.calibrations === undefined ? cal : null)
  const sizeFor = (pageId: string): PageSize =>
    opts.pageSizes?.get(pageId) ?? opts.pageSize

  /**
   * The scale a markup is laid out at: its REGION's, else its page's.
   *
   * Areas became region-aware before layout did, which left the two disagreeing
   * on a sheet carrying more than one scale — the quantity said one thing and
   * the piece count another, both confidently.
   *
   * A page with no regions returns the page calibration OBJECT unchanged
   * rather than a rebuilt one, so nothing moves where nothing has been drawn.
   * The golden fixtures go through this path.
   */
  const scaleFor = (m: Markup): { cal: Calibration | null, regionId: string | null } => {
    const pageCal = calFor(m.pageId)
    const regions = opts.scaleRegions?.get(m.pageId) ?? []
    if (regions.length === 0) return { cal: pageCal, regionId: null }
    const resolved = resolveScaleForRings(m.rings, regions, pageCal?.feetPerPoint ?? null)
    if (resolved.feetPerPoint === null) return { cal: null, regionId: null }
    if (resolved.regionId === null) return { cal: pageCal, regionId: null }
    const size = sizeFor(m.pageId)
    return {
      cal: {
        feetPerPoint: resolved.feetPerPoint,
        pageWidth: size.width,
        pageHeight: size.height,
      },
      regionId: resolved.regionId,
    }
  }

  /*
   * Keyed by page AND direction: with per-area directions two markups on one
   * sheet no longer necessarily share a grid line, so a cache on the page
   * alone would hand the second one the first one's direction.
   */
  const lineCache = new Map<string, Segment | null>()
  const lineFor = (pageId: string, dir: NormalizedDirection): Segment | null => {
    const key = `${pageId}|${dir[0].x},${dir[0].y},${dir[1].x},${dir[1].y}`
    const hit = lineCache.get(key)
    if (hit !== undefined) return hit
    const line = scopeDefaultGridLine(dir, sizeFor(pageId))
    lineCache.set(key, line)
    return line
  }

  const byKey = new Map<string, GroupedRegion>()
  for (const m of markups) {
    if (m.kind !== 'area' && m.kind !== 'cutout') continue
    const probe: Point | undefined = m.rings[0]?.[0]
    if (!probe) continue

    /*
     * A cutout takes its OWNER's scale, not its own.
     *
     * It is a hole in a particular area and has to be measured in the same
     * space as the thing it opens; resolving it independently would let a
     * cutout whose centroid strayed over a region boundary punch a hole of the
     * wrong size, or none at all.
     */
    const scaleSource = m.kind === 'cutout'
      ? (markups.find((x) => x.id === ownerAreaId(m, markups)) ?? m)
      : m
    const { cal: pageCal, regionId } = scaleFor(scaleSource)
    const dir = directionFor(m)
    if (dir === null) continue
    const directionLine = lineFor(m.pageId, dir)
    if (pageCal === null || directionLine === null) continue

    const pageSize = sizeFor(m.pageId)
    const resolution = resolvePatternDirection(probe, {
      page: pageSize,
      scopeDirection: dir,
      // The default direction was drawn on ONE page; its own box is what its
      // normalized coordinates mean. That is the fallback page size, not this
      // markup's page.
      scopeDirectionPage: opts.pageSize,
    })
    if (!resolution) continue

    // A cutout must land in the SAME group as the area it opens, so it is
    // keyed by that area rather than by its own id. Keying it by itself would
    // give the opening its own grid and stop it ever punching a hole.
    const owner = m.kind === 'cutout' ? ownerAreaId(m, markups) ?? m.id : m.id
    /*
     * The region is NOT part of the key, and does not need to be:
     * `directionGroupKey` already ends in the area id, so every area is its
     * own group and two details can never share one. Adding the region here
     * looked prudent and was dead — a perturbation test proved it changed
     * nothing, which is the only reason this comment is not a claim that it
     * matters.
     */
    const key = `${m.pageId}|${directionGroupKey(resolution, owner)}`

    const rings = m.rings.map((ring) => ringToPoints(ring, pageCal))
    const existing = byKey.get(key)
    if (existing) existing.region.push(...rings)
    else byKey.set(key, { pageId: m.pageId, region: rings, calibration: pageCal, directionLine })
  }

  return [...byKey.values()]
}

/** The area whose ring contains this cutout's first vertex, if any. */
function ownerAreaId(cutout: Markup, markups: readonly Markup[]): string | null {
  const probe = cutout.rings[0]?.[0]
  if (!probe) return null
  for (const m of markups) {
    if (m.kind !== 'area' || m.pageId !== cutout.pageId) continue
    const ring = m.rings[0]
    if (ring && containsPoint(ring, probe)) return m.id
  }
  return null
}

/** Even/odd point-in-ring on normalized coordinates. */
function containsPoint(ring: readonly Point[], p: Point): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Roll a scope up to orderable pieces.
 *
 * Returns blockers rather than zeros when the scope is not ready. A missing
 * panel width means there is no panel count, and a 0 in a BOM reads as
 * "nothing to order" — which is a different and much more expensive claim.
 */
/**
 * Why a scope with everything set produced no layout groups.
 *
 * Returning no quantities AND no blockers says "there is nothing to compute",
 * which is true when nothing has been drawn and a lie when something has.
 * A scope with a calibrated sheet, a direction and two drawn areas reported
 * exactly the same empty result as an untouched one — no number and no reason
 * for its absence, which is the worst answer of the three.
 *
 * Grouping drops a markup only when its page has no calibration this
 * calculation can see, so that is what it says.
 */
function noGroups(mine: readonly Markup[]): string[] {
  if (mine.length === 0) return []
  return ['a scale on the sheet these markups are drawn on']
}

export function calculatePieces(
  scope: Scope,
  markups: readonly Markup[],
  cal: Calibration,
  opts: PieceOptions,
): PieceResult {
  const specs = scope.specifications as Specifications
  const product = readProductType(specs)
  const mine = markups.filter((m) => m.scopeId === scope.id)

  const blockers = missingRequiredMeasures(product, specs)
  if (product === 'custom_assembly') {
    // Quantified by hand. Not a blocker and not a zero — there is simply no
    // machine calculation to make, which is what the Qt build says too.
    return { productType: product, quantities: [], cells: [], runs: [], blockers: [] }
  }
  if (blockers.length > 0) return { productType: product, quantities: [], cells: [], runs: [], blockers }

  /*
   * Blocked only when there is NO direction anywhere.
   *
   * A scope with no cross-sheet default but a direction stated on this sheet
   * is not missing anything, and reporting it as blocked would be a plain
   * falsehood about work already done.
   */
  const pageDirections = opts.pageDirections ?? pageDirectionsFrom(specs)
  const areaDirections = opts.areaDirections ?? areaDirectionsFrom(specs)
  if (opts.scopeDirection == null && pageDirections.size === 0 && areaDirections.size === 0) {
    return {
      productType: product,
      quantities: [],
      cells: [],
      runs: [],
      blockers: ['a pattern direction — add a Scope Default Orientation, or run the pattern along a markup edge'],
    }
  }
  // Read from the scope when the caller did not pass them: they are stored on
  // the scope, so a caller should not have to take them apart to be correct.
  const withDirections: PieceOptions = { ...opts, pageDirections, areaDirections }

  if (product === 'panels') {
    const width = measureToFeet(specs, { valueKey: 'panelWidth', unitKey: 'panelWidthUnit', label: 'Panel W' })
    const length = measureToFeet(specs, { valueKey: 'panelLength', unitKey: 'panelLengthUnit', label: 'Panel L' })
    if (width === null || length === null) {
      return { productType: product, quantities: [], cells: [], runs: [], blockers: ['Panel W', 'Panel L'] }
    }
    const groups = layoutGroupsFor(mine, cal, withDirections)
    if (groups.length === 0) return { productType: product, quantities: [], cells: [], runs: [], blockers: noGroups(mine) }

    const result = layoutPanels(groups, {
      panelWidthFeet: width,
      panelLengthFeet: length,
      feetPerPoint: cal.feetPerPoint,
      panelGranularity: readGranularity(specs, 'panelGranularity'),
      ...(opts.perAreaOrigin === true ? { perAreaOrigin: true } : {}),
    })
    return {
      productType: product,
      blockers: [],
      cells: result.cells,
      // A panel product's geometry is its cells; it has no runs.
      runs: [],
      quantities: [
        { itemKey: 'panel_count', label: 'Panels', quantity: result.panelCount, unit: 'EA' },
        { itemKey: 'panel_full', label: 'Full panels', quantity: result.fullPieceCount, unit: 'EA' },
        { itemKey: 'panel_half', label: 'Half panels', quantity: result.halfPieceCount, unit: 'EA' },
      ].filter((q) => q.quantity > 0),
    }
  }

  /*
   * Planks, baffles and cassettes.
   *
   * These used to return a blocker reading "not verified against the Qt build
   * yet" and no numbers at all, even though pieces.ts had been a complete port
   * for months. That was the wrong shape of honesty: a blocker says "this
   * cannot be computed", and it can — what is true is that nobody has checked
   * it against the oracle, which is a CONFIDENCE, and bom.ts already carries
   * confidence per line. So the numbers are produced, and every line they
   * produce is still marked unverified downstream.
   */
  const inputs = resolveRunInputs(product, specs)
  if (inputs === null) {
    // resolveRunInputs only returns null when a required measure is missing or
    // unusable, and missingRequiredMeasures above already reported those — so
    // reaching here means a measure parsed as a number but not as a length.
    return {
      productType: product,
      quantities: [],
      cells: [],
      runs: [],
      blockers: ['a usable spacing and stock length'],
    }
  }

  const groups = runGroupsFor(mine, cal, withDirections)
  if (groups.length === 0) return { productType: product, quantities: [], cells: [], runs: [], blockers: noGroups(mine) }

  let entries
  try {
    entries = layoutRuns(groups, inputs)
  } catch (err) {
    // pieces.ts raises rather than grinding when a spacing is so small relative
    // to the region that the layout would be unbounded — a units mistake, most
    // often feet typed into an inches field. Report it as a blocker in the
    // estimator's terms rather than letting it reach a boundary as a crash.
    return {
      productType: product,
      quantities: [],
      cells: [],
      runs: [],
      blockers: [err instanceof RangeError ? err.message : 'a layout this scope can produce'],
    }
  }

  const summary = summarizeRuns(entries, inputs)
  return {
    productType: product,
    blockers: [],
    // A run product has no panel cells: its geometry is the cut pieces along
    // each run, which is what `runs` carries to the preview.
    cells: [],
    runs: entries,
    quantities: runQuantities(product, summary),
  }
}
