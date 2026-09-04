/**
 * Turning a live calculation into a committed one.
 *
 * Everything a takeoff shows is recomputed from the markups every time
 * anything changes, which is right for working and useless for bidding: change
 * a spec and the number you sent last week is simply gone, with nothing to
 * compare against and no way to say what moved. `calculation_runs`,
 * `quantity_results` and `layout_components` have been in the schema since the
 * beginning and nothing ever wrote one.
 *
 * A committed run is the answer at a moment, with the evidence behind it: the
 * specification it was computed from, the calibration, which markups it read,
 * and every piece it placed. That last part is why a run carries components
 * and not just totals — "299 planks" is not checkable, and 299 line segments
 * are.
 */
import type { PieceResult, Scope } from '@redbeam/domain'
import type { CalculationInput, LayoutComponentInput, QuantityResultInput } from '@redbeam/store'

/**
 * Which engine produced a number.
 *
 * A frozen quantity is only meaningful with one: two runs that disagree are a
 * bug if the engine is the same and a changelog entry if it is not.
 */
export const ENGINE_VERSION = 'redbeam-ts/1'

export interface CommitSource {
  documentId: string
  /** The markups the calculation actually read, so the run can be reproduced. */
  markups: ReadonlyArray<{
    id: string
    pageId: string
    kind: string
    rings: ReadonlyArray<ReadonlyArray<{ x: number, y: number }>>
  }>
  calibrations: ReadonlyMap<string, number>
}

/**
 * Every piece the layout placed, as component rows.
 *
 * A run product contributes its cut pieces and its rails; a panel product
 * contributes its cells. Both carry the geometry that was installed and the
 * stock it came out of, because the question asked of a frozen bid is usually
 * "where did that number come from" and a total cannot answer it.
 */
export function componentsOf(result: PieceResult, documentId: string): LayoutComponentInput[] {
  const out: LayoutComponentInput[] = []

  for (const entry of result.runs) {
    const push = (kind: string, pieces: PieceResult['runs'][number]['layout']['pieces']) => {
      for (const piece of pieces) {
        out.push({
          documentId,
          pageId: entry.pageId,
          componentKind: kind,
          geometry: { start: piece.insideSegment.a, end: piece.insideSegment.b },
          properties: {
            family: piece.family,
            stockFraction: piece.stockFraction,
            startCap: piece.startCap,
            // The stock this was cut from, which is what was ordered — it
            // differs from the installed length wherever a piece overhangs.
            stockStart: piece.fullSegment.a,
            stockEnd: piece.fullSegment.b,
            feetPerPoint: entry.feetPerPoint,
          },
        })
      }
    }
    push('run_piece', entry.layout.pieces)
    push('suspension_rail', entry.layout.railPieces)
  }

  for (const cell of result.cells) {
    out.push({
      documentId,
      pageId: cell.pageId ?? null,
      componentKind: 'panel_cell',
      geometry: { region: cell.clippedRegion },
      properties: {
        gridRow: cell.gridRow,
        gridColumn: cell.gridColumn,
        coverageFraction: cell.coverageFraction,
        stockFraction: cell.stockFraction,
        stockPath: cell.stockPath,
      },
    })
  }

  return out
}

/**
 * Assemble the record. Pure, so what gets frozen can be argued with in a test
 * rather than inspected in a database after the fact.
 *
 * `quantities` is the scope roll-up AND the piece counts together, because
 * that is what the panel shows and therefore what somebody believes they are
 * committing. Freezing a subset of what was on screen would be a trap.
 */
export function calculationFor(
  scope: Scope,
  result: PieceResult,
  rollup: readonly QuantityResultInput[],
  source: CommitSource,
): CalculationInput {
  const mine = source.markups.filter((m) => m.rings.length > 0)
  return {
    scopeId: scope.id,
    engineVersion: ENGINE_VERSION,
    specificationsSnapshot: { ...scope.specifications },
    calibrationSnapshot: Object.fromEntries(source.calibrations),
    sourceSnapshot: {
      documentId: source.documentId,
      markupIds: mine.map((m) => m.id),
      pageIds: [...new Set(mine.map((m) => m.pageId))],
    },
    // The geometry itself, not a reference to it: a markup that is later moved
    // or deleted must not silently change what a frozen bid was based on.
    geometrySnapshot: {
      markups: mine.map((m) => ({ id: m.id, pageId: m.pageId, kind: m.kind, rings: m.rings })),
    },
    warnings: result.blockers,
    resultSummary: { productType: result.productType, componentCount: result.runs.length },
    quantities: [...rollup, ...result.quantities.map((q) => ({
      itemKey: q.itemKey, label: q.label, quantity: q.quantity, unit: q.unit,
    }))],
    components: componentsOf(result, source.documentId),
  }
}

/**
 * What changed between a committed run and what the app is showing now.
 *
 * Keyed on `itemKey`, so a row that disappeared reads as a change rather than
 * quietly vanishing from the comparison — an item that stopped being produced
 * is exactly the kind of movement worth seeing.
 */
export interface QuantityDelta {
  itemKey: string
  label: string
  unit: string
  committed: number | null
  live: number | null
}

export function deltaBetween(
  committed: readonly QuantityResultInput[],
  live: readonly QuantityResultInput[],
): QuantityDelta[] {
  const byKey = new Map<string, QuantityDelta>()
  for (const q of committed) {
    byKey.set(q.itemKey, {
      itemKey: q.itemKey, label: q.label, unit: q.unit, committed: q.quantity, live: null,
    })
  }
  for (const q of live) {
    const hit = byKey.get(q.itemKey)
    if (hit) hit.live = q.quantity
    else {
      byKey.set(q.itemKey, {
        itemKey: q.itemKey, label: q.label, unit: q.unit, committed: null, live: q.quantity,
      })
    }
  }
  // Only what MOVED. A list where nothing changed is best said in one line,
  // and a list of forty identical rows hides the one that is not.
  return [...byKey.values()].filter((d) => d.committed !== d.live)
}
