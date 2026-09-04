/**
 * Run-based products — planks, baffles and baffle cassettes — rolled up to
 * orderable quantities (plan 06.6, 06.7, 06.8).
 *
 * pieces.ts is the geometry: region + origin + direction -> cut pieces, with
 * their connectors, joints and caps. It has been complete for a while and
 * nothing called it. This is the layer above: read the scope's specifications,
 * lay every group out, and count what has to be bought.
 *
 * Ported from okular-redbeam `part/redbeamscopepanel.cpp`:
 *   the Planks / Baffle / Baffle Cassette arm of
 *   redbeamPrepareLayoutInputs                       -> resolveRunInputs
 *   redbeamQuantitySummaryForLayouts (non-panel arm)  -> summarizeRuns
 *   redbeamConnectorPointKey                          -> connectorKey
 *   redbeamPathPerimeterPdfPoints                     -> regionPerimeterPoints
 *   the quantity emission in redbeamCalculationPayload -> runQuantities
 *
 * # Confidence
 *
 * These counts are a faithful port and they are NOT verified against the Qt
 * build, because no golden fixture covers a run product — every scope in every
 * project the oracle can reach is `panels`. bom.ts already carries that
 * distinction as a per-line confidence, and it stays true here: what changes is
 * that an estimator now gets numbers with a warning attached instead of a
 * blocker and nothing at all. A blocker that says "unverified" is not more
 * honest than an unverified number; it is the same claim with the work removed.
 */

import type { Point, Region } from './geometry.js'
import type { Segment } from './pattern.js'
import { buildRunLayout, type Piece, type RegionLayout } from './pieces.js'
import { fractionApproximately, orderStockPieceCount, roundUpQuantity } from './panels.js'
import { regionArea } from './geometry.js'
import {
  measureToFeet, readBool, readString, type ProductType, type Specifications,
} from './specs.js'
import { parseNumberOrFraction, unitToFeet } from './units.js'
import type { PieceQuantity } from './takeoff.js'

// ---------------------------------------------------------------------------
// Specification resolution
// ---------------------------------------------------------------------------

/** Everything the run engine needs, in FEET. Converted to points by the caller. */
export interface RunInputs {
  spacingFeet: number
  stockLengthFeet: number
  maxConnectorSpacingFeet: number
  /** Profile or plank width. Presentation only today; carried for parity. */
  componentWidthFeet: number
  /** Length of one stick of perimeter trim. 0 means trim is not being counted. */
  perimeterTrimLengthFeet: number
  railLengthFeet: number
  railSpacingFeet: number
  yieldGranularity: string
  alignSeams: boolean
}

/** An optional measure: the value in feet, or 0 when absent or unusable. */
function optionalFeet(specs: Specifications, valueKey: string): number {
  const feet = measureToFeet(specs, {
    valueKey, unitKey: `${valueKey}Unit`, label: valueKey,
  })
  return feet ?? 0
}

/**
 * Resolve the layout inputs for one run product, or null when the scope cannot
 * be laid out at all.
 *
 * Three quirks are ported rather than tidied, because the Qt build is the
 * oracle and a "correction" here would silently disagree with it:
 *
 *  - PLANKS ignore their own `maxConnectorSpacing` and use the stock length.
 *    The spec editor still offers "Conn. Max" on a plank scope, so a value
 *    typed there has no effect on the count. That is the shipped behaviour.
 *  - A BAFFLE CASSETTE takes its perimeter trim length from `cassetteWidth`,
 *    not from `perimeterTrimLength`.
 *  - A plain BAFFLE reads no trim length at all, so it never reports trim.
 */
export function resolveRunInputs(
  product: ProductType,
  specs: Specifications,
): RunInputs | null {
  let spacingFeet = 0
  let stockLengthFeet = 0
  let maxConnectorSpacingFeet = 0
  let componentWidthFeet = 0
  let perimeterTrimLengthFeet = 0
  let railLengthFeet = 0
  let railSpacingFeet = 0

  if (product === 'planks') {
    componentWidthFeet = optionalFeet(specs, 'plankWidth')
    stockLengthFeet = optionalFeet(specs, 'stockLength')
    if (!(componentWidthFeet > 0) || !(stockLengthFeet > 0)) return null

    const explicitSpacing = optionalFeet(specs, 'spacing')
    if (explicitSpacing > 0) {
      spacingFeet = explicitSpacing
    } else {
      // Planks butt together, so the default pitch is the plank itself plus
      // whatever reveal is specified between them.
      spacingFeet = componentWidthFeet + Math.max(0, optionalFeet(specs, 'revealSpacing'))
    }
    maxConnectorSpacingFeet = stockLengthFeet
    perimeterTrimLengthFeet = optionalFeet(specs, 'perimeterTrimLength')
    railLengthFeet = optionalFeet(specs, 'railLength')
    railSpacingFeet = optionalFeet(specs, 'maxRailSpacing')
    if (!(railSpacingFeet > 0)) railSpacingFeet = optionalFeet(specs, 'minRailSpacing')
  } else if (product === 'baffle' || product === 'baffle_cassette') {
    spacingFeet = optionalFeet(specs, 'spacing')
    stockLengthFeet = optionalFeet(specs, 'stockLength')
    maxConnectorSpacingFeet = optionalFeet(specs, 'maxConnectorSpacing')
    if (!(spacingFeet > 0) || !(stockLengthFeet > 0) || !(maxConnectorSpacingFeet > 0)) return null

    // Stored in INCHES under its own key, not as a value+unit pair.
    const profileWidthInches = parseNumberOrFraction(readString(specs, 'profileWidthInches') ?? '')
    if (profileWidthInches !== null && profileWidthInches > 0) {
      componentWidthFeet = unitToFeet(profileWidthInches, 'in') ?? 0
    }
    if (product === 'baffle_cassette') {
      perimeterTrimLengthFeet = optionalFeet(specs, 'cassetteWidth')
    }
  } else {
    return null
  }

  if (!(spacingFeet > 0) || !(stockLengthFeet > 0)) return null
  if (!(maxConnectorSpacingFeet > 0)) maxConnectorSpacingFeet = stockLengthFeet

  return {
    spacingFeet,
    stockLengthFeet,
    maxConnectorSpacingFeet,
    componentWidthFeet,
    perimeterTrimLengthFeet,
    railLengthFeet,
    railSpacingFeet,
    yieldGranularity: readString(specs, 'yieldGranularity') ?? 'full',
    alignSeams: readBool(specs, 'alignSeams'),
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Closed length of every boundary in a region, holes included.
 *
 * Holes count: perimeter trim runs around an opening just as it runs around a
 * wall, and the Qt build sums every boundary polygon for exactly that reason.
 */
export function regionPerimeterPoints(region: Region): number {
  let perimeter = 0
  for (const ring of region) {
    if (ring.length < 2) continue
    for (let i = 1; i < ring.length; i++) {
      perimeter += Math.hypot(ring[i]!.x - ring[i - 1]!.x, ring[i]!.y - ring[i - 1]!.y)
    }
    const first = ring[0]!
    const last = ring[ring.length - 1]!
    if (first.x !== last.x || first.y !== last.y) {
      perimeter += Math.hypot(first.x - last.x, first.y - last.y)
    }
  }
  return perimeter
}

/**
 * Identity of a connector location, to a tenth of a PDF point.
 *
 * Two runs that meet at a shared support must not order two connectors for the
 * one bracket. The page is part of the key because PDF points repeat on every
 * sheet.
 */
function connectorKey(pageId: string, p: Point): string {
  return `${pageId}:${Math.round(p.x * 10)},${Math.round(p.y * 10)}`
}

const segLength = (s: Segment): number => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** One direction group, with the page it was drawn on. */
export interface RunGroup {
  pageId: string
  /** Rings in PDF POINTS; holes nested, as in regionArea. */
  region: Region
  /** A vector along the run, in PDF points. */
  direction: Point
  /**
   * This page's calibration (plan 06.11).
   *
   * Carried per group rather than per scope because a scope spans sheets and
   * sheets are not all drawn at one scale. A stock length is a fixed physical
   * length; what changes between pages is how many POINTS it occupies.
   */
  feetPerPoint: number
  /** A drawn pattern origin in PDF points, or null for the automatic one. */
  origin?: Point | null
}

export interface RunLayoutEntry {
  pageId: string
  region: Region
  layout: RegionLayout
  /** The calibration this entry was laid out at. */
  feetPerPoint: number
}

export interface RunSummary {
  placedPieceCount: number
  fullPieceCount: number
  threeQuarterPieceCount: number
  twoThirdPieceCount: number
  halfPieceCount: number
  thirdPieceCount: number
  quarterPieceCount: number
  /** Every connector location placed, including ones shared between runs. */
  connectorCount: number
  /** Connectors to BUY — shared locations counted once. */
  uniqueConnectorCount: number
  endCapCount: number
  joinerCount: number
  /** Length of run actually installed. */
  netLinearFeet: number
  totalSquareFeet: number
  perimeterLinearFeet: number
  perimeterTrimPieces: number
  /** Stock to order: planks, or full-length-equivalent baffles. */
  primaryStockCount: number
  suspensionRailCount: number
  suspensionRailLinearFeet: number
}

const EMPTY_SUMMARY: RunSummary = {
  placedPieceCount: 0, fullPieceCount: 0, threeQuarterPieceCount: 0,
  twoThirdPieceCount: 0, halfPieceCount: 0, thirdPieceCount: 0, quarterPieceCount: 0,
  connectorCount: 0, uniqueConnectorCount: 0, endCapCount: 0, joinerCount: 0,
  netLinearFeet: 0, totalSquareFeet: 0, perimeterLinearFeet: 0, perimeterTrimPieces: 0,
  primaryStockCount: 0, suspensionRailCount: 0, suspensionRailLinearFeet: 0,
}

/** Which named fraction a placed piece counts as. Order matches the C++ chain. */
function bumpFamily(summary: RunSummary, fraction: number): void {
  if (fractionApproximately(fraction, 1.0)) summary.fullPieceCount++
  else if (fractionApproximately(fraction, 0.75)) summary.threeQuarterPieceCount++
  else if (fractionApproximately(fraction, 2 / 3)) summary.twoThirdPieceCount++
  else if (fractionApproximately(fraction, 0.5)) summary.halfPieceCount++
  else if (fractionApproximately(fraction, 1 / 3)) summary.thirdPieceCount++
  else if (fractionApproximately(fraction, 0.25)) summary.quarterPieceCount++
  // An unnameable fraction counts as a full piece — it consumes a whole stock
  // length that cannot be nested with anything.
  else summary.fullPieceCount++
}

/**
 * Roll laid-out groups up to what has to be ordered.
 *
 * @param feetPerPoint the page calibration; every length here is converted with
 *        it exactly once.
 */
export function summarizeRuns(
  entries: readonly RunLayoutEntry[],
  inputs: RunInputs,
): RunSummary {
  const summary: RunSummary = { ...EMPTY_SUMMARY }
  if (entries.length === 0) return summary

  const stockFractions: number[] = []
  const uniqueConnectors = new Set<string>()
  let hasExplicitRailPieces = false

  for (const entry of entries) {
    const feetPerPoint = entry.feetPerPoint
    if (!(feetPerPoint > 0)) continue
    summary.totalSquareFeet += Math.abs(regionArea(entry.region)) * feetPerPoint * feetPerPoint
    summary.perimeterLinearFeet += regionPerimeterPoints(entry.region) * feetPerPoint

    for (const piece of entry.layout.pieces) {
      summary.placedPieceCount++
      stockFractions.push(piece.stockFraction)
      summary.netLinearFeet += segLength(piece.insideSegment) * feetPerPoint
      bumpFamily(summary, piece.stockFraction)
      summary.connectorCount += piece.connectorPoints.length
      for (const p of piece.connectorPoints) uniqueConnectors.add(connectorKey(entry.pageId, p))
      summary.joinerCount += piece.jointPoints.length
      if (piece.startCap) summary.endCapCount++
      if (piece.endCap) summary.endCapCount++
    }

    if (entry.layout.railPieces.length > 0) {
      hasExplicitRailPieces = true
      for (const rail of entry.layout.railPieces) {
        summary.suspensionRailLinearFeet += segLength(rail.fullSegment) * feetPerPoint
        summary.suspensionRailCount += Math.max(1, roundUpQuantity(rail.stockFraction))
      }
    }
  }

  summary.uniqueConnectorCount = uniqueConnectors.size
  /*
   * THE OFFCUT RULE, resolved with the estimator.
   *
   * `full` reuses nothing. `half` means the stock divides into HALVES and only
   * a whole half is reusable — so a one-foot cut is charged half a plank, the
   * five feet left over from that half is scrap, and two such cuts share one
   * plank. `third` and `quarter` the same way, one lattice step further down.
   *
   * I had this wrong and it is worth recording why, because the wrong reading
   * is the more natural one. "Only offcuts half the stock length or larger are
   * used elsewhere" also describes reusing the ACTUAL remainder: cut a foot off
   * a twelve-foot plank, eleven feet is left, eleven is well over half, so cut
   * the next one from that — and on twenty thirteen-foot runs that is 23 planks
   * where the lattice gives 30. Both readings fit the sentence. Only the
   * lattice fits the shop: you do not keep returning to the same plank until it
   * is a stub, you cut it into halves and the second half is the last usable
   * piece.
   *
   * So `orderStockPieceCount` was right all along, and planks, baffles and
   * panels all use it. There is no product-by-product split.
   */
  summary.primaryStockCount = orderStockPieceCount(stockFractions)

  if (inputs.perimeterTrimLengthFeet > 0) {
    summary.perimeterTrimPieces = roundUpQuantity(
      summary.perimeterLinearFeet / inputs.perimeterTrimLengthFeet,
    )
  }

  /*
   * Rails without geometry.
   *
   * When no rail runs were laid out — because the region produced none, or
   * because only one of the two rail specs is set — but a spacing and a length
   * are both known, the Qt build falls back to an AREA estimate: linear feet of
   * rail is the area divided by the rail pitch. It is an approximation and it
   * is deliberately kept, because it is what the shipped numbers are.
   */
  if (
    !hasExplicitRailPieces &&
    inputs.railSpacingFeet > 0 &&
    inputs.railLengthFeet > 0
  ) {
    summary.suspensionRailLinearFeet = summary.totalSquareFeet / inputs.railSpacingFeet
    summary.suspensionRailCount = roundUpQuantity(
      summary.suspensionRailLinearFeet / inputs.railLengthFeet,
    )
  }

  return summary
}

/**
 * Lay out every group for a run product.
 *
 * Groups are laid out INDEPENDENTLY — separate zones have separate seams — and
 * a group that cannot produce a layout is skipped rather than failing the
 * scope, which matches how panels behave.
 */
export function layoutRuns(
  groups: readonly RunGroup[],
  inputs: RunInputs,
): RunLayoutEntry[] {
  const entries: RunLayoutEntry[] = []
  for (const group of groups) {
    const feetPerPoint = group.feetPerPoint
    if (!(feetPerPoint > 0)) continue
    const toPoints = (feet: number): number => feet / feetPerPoint
    const layout = buildRunLayout(group.region, group.direction, {
      spacingPoints: toPoints(inputs.spacingFeet),
      stockLengthPoints: toPoints(inputs.stockLengthFeet),
      yieldGranularity: inputs.yieldGranularity,
      alignSeams: inputs.alignSeams,
      maxConnectorSpacingPoints: toPoints(inputs.maxConnectorSpacingFeet),
      origin: group.origin ?? null,
      // Rails need BOTH specs; the Qt call site gates on exactly this pair.
      ...(inputs.railSpacingFeet > 0 && inputs.railLengthFeet > 0
        ? {
            railSpacingPoints: toPoints(inputs.railSpacingFeet),
            railLengthPoints: toPoints(inputs.railLengthFeet),
          }
        : {}),
    })
    if (layout === null) continue
    entries.push({ pageId: group.pageId, region: group.region, layout, feetPerPoint })
  }
  return entries
}

// ---------------------------------------------------------------------------
// Orderable quantities
// ---------------------------------------------------------------------------

/**
 * The order lines for a run scope, in the Qt build's own item vocabulary.
 *
 * `net_area` is deliberately absent even though the Qt payload carries it: the
 * scope roll-up in scope.ts already reports area, and the panel prints both
 * lists one after the other — emitting it here would show the same square
 * footage twice under two labels. `net_linear` IS emitted, because installed
 * run length is not the same measurement as the drawn area and nothing else
 * produces it.
 */
export function runQuantities(product: ProductType, summary: RunSummary): PieceQuantity[] {
  const out: PieceQuantity[] = []
  const add = (itemKey: string, label: string, quantity: number, unit: string): void => {
    if (quantity > 0) out.push({ itemKey, label, quantity, unit })
  }

  add('net_linear', 'Installed length', round1(summary.netLinearFeet), 'LF')
  add(
    'primary_stock',
    product === 'planks' ? 'Planks' : 'Baffle stock',
    summary.primaryStockCount,
    'EA',
  )
  add('perimeter_trim', 'Perimeter trim', summary.perimeterTrimPieces, 'EA')
  add('connectors', 'Connectors', summary.uniqueConnectorCount, 'EA')
  add('end_caps', 'End caps', summary.endCapCount, 'EA')
  add('joiners', 'Joiners', summary.joinerCount, 'EA')
  add('suspension_rails', 'Suspension rails', summary.suspensionRailCount, 'EA')
  return out
}

/** One decimal is the precision a linear-feet order is placed at. */
const round1 = (v: number): number => Math.round(v * 10) / 10

/** Every piece laid out, flattened — for the preview and for freeze. */
export function allPieces(entries: readonly RunLayoutEntry[]): Piece[] {
  return entries.flatMap((e) => e.layout.pieces)
}

// ---------------------------------------------------------------------------
// Components, for freezing
// ---------------------------------------------------------------------------

/**
 * One laid-out physical thing, in the shape `layout_components` stores.
 *
 * Ported from the payload built in redbeamCalculationPayload: a `primary` is a
 * cut piece of the main material, a `suspension_rail` is a rail. Panels write
 * their own `panel` components from panels.ts; this covers the run family.
 *
 * `geometry` is what is INSTALLED and `stockGeometry` is what is BOUGHT — they
 * differ by the overage that hangs past the region, and a frozen record that
 * kept only one of them could not answer either "what did we order" or "what
 * did we cover" afterwards.
 */
export interface RunComponent {
  pageId: string
  ordinal: number
  componentKind: 'primary' | 'suspension_rail'
  geometry: Segment
  stockGeometry: Segment
  stockFraction: number
  family?: string
}

/**
 * Flatten laid-out groups into the components a calculation freezes.
 *
 * The ordinal restarts per page, matching the Qt build — it is a position
 * within a page's component list, not a global sequence.
 */
export function runComponents(entries: readonly RunLayoutEntry[]): RunComponent[] {
  const out: RunComponent[] = []
  const ordinalByPage = new Map<string, number>()
  const next = (pageId: string): number => {
    const n = ordinalByPage.get(pageId) ?? 0
    ordinalByPage.set(pageId, n + 1)
    return n
  }

  for (const entry of entries) {
    for (const piece of entry.layout.pieces) {
      out.push({
        pageId: entry.pageId,
        ordinal: next(entry.pageId),
        componentKind: 'primary',
        geometry: piece.insideSegment,
        stockGeometry: piece.fullSegment,
        stockFraction: piece.stockFraction,
        family: piece.family,
      })
    }
    for (const rail of entry.layout.railPieces) {
      out.push({
        pageId: entry.pageId,
        ordinal: next(entry.pageId),
        componentKind: 'suspension_rail',
        geometry: rail.insideSegment,
        stockGeometry: rail.fullSegment,
        stockFraction: rail.stockFraction,
      })
    }
  }
  return out
}
