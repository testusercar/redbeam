/**
 * Bill of materials (plan 06.12).
 *
 * The last step: turn per-scope piece counts into the ordered list someone
 * actually sends to a supplier.
 *
 * # Every line carries its own confidence
 *
 * This is the part that matters. Our panel counts reproduce the Qt build
 * exactly on golden fixtures; our baffle and plank counts are ported but have
 * never been checked against it, because every scope in every project the
 * oracle can reach is `panels` and no fixture exists for the others.
 *
 * A BOM that printed both in the same column would be claiming a confidence
 * it does not have, and the number that gets ordered is the number someone
 * pays for. So each line says where it stands, and an unverified line is not
 * silently mixed into a total that looks authoritative.
 */

import type { PieceQuantity, PieceResult } from './takeoff.js'
import type { Scope } from './scope.js'
import { PRODUCT_TYPE_LABEL, type ProductType } from './specs.js'

/**
 * How much a line can be trusted.
 *
 * `verified`   reproduces the Qt build on a golden fixture.
 * `unverified` no golden fixture reproduces it. That is not the same as
 *              unchecked: the run products are validated against arithmetic
 *              in runs.validation.test.ts, on eleven shapes whose answers are
 *              derivable on paper, and the offcut convention has since been
 *              settled with the estimator. What is still unproven is that the
 *              whole pipeline reproduces the Qt build on a real plank scope,
 *              and no Qt project has one to capture from.
 * `blocked`    cannot be computed; the scope is missing something.
 */
export type LineConfidence = 'verified' | 'unverified' | 'blocked'

export interface BomLine {
  scopeId: string
  scopeLabel: string
  productType: ProductType
  productLabel: string
  itemKey: string
  label: string
  /** Null when blocked — a blocked line has no quantity, and 0 is a claim. */
  quantity: number | null
  unit: string
  confidence: LineConfidence
  /** Why it is blocked or unverified, in the estimator's words. */
  note?: string
}

export interface Bom {
  lines: BomLine[]
  /**
   * Totals per unit, over VERIFIED lines only.
   *
   * Unverified quantities are deliberately excluded rather than added in: a
   * total that silently mixes a checked number with an unchecked one is less
   * trustworthy than either, and hides which is which.
   */
  totals: Array<{ unit: string; quantity: number }>
  counts: Record<LineConfidence, number>
  /** True when anything at all is not `verified`. Drives the UI warning. */
  needsAttention: boolean
}

/**
 * Product types whose piece counts are proven against the Qt build.
 *
 * Panels only, and that is not a placeholder — see fixtures/ and
 * packages/domain/src/panels.test.ts. Move a type in here when, and only when,
 * a golden fixture covers it.
 */
const VERIFIED_PRODUCTS: readonly ProductType[] = ['panels'] as const

export interface ScopePieces {
  scope: Scope
  result: PieceResult
}

export function buildBom(entries: readonly ScopePieces[]): Bom {
  const lines: BomLine[] = []

  for (const { scope, result } of entries) {
    const productLabel = PRODUCT_TYPE_LABEL[result.productType]
    const base = {
      scopeId: scope.id,
      scopeLabel: scope.label,
      productType: result.productType,
      productLabel,
    }

    if (result.blockers.length > 0) {
      lines.push({
        ...base,
        itemKey: 'blocked',
        label: `needs ${result.blockers.join(', ')}`,
        // Null, not 0. A blocked scope has no count; printing 0 in a BOM reads
        // as "nothing to order", which is a different and far more expensive
        // claim than "this is not configured yet".
        quantity: null,
        unit: '',
        confidence: 'blocked',
        note: result.blockers.join('; '),
      })
      continue
    }

    const verified = VERIFIED_PRODUCTS.includes(result.productType)
    for (const q of result.quantities) {
      lines.push({
        ...base,
        ...lineOf(q),
        confidence: verified ? 'verified' : 'unverified',
        ...(verified
          ? {}
          : {
            // Precise about WHICH kind of doubt: "not checked" would now be
            // untrue, and an estimator deciding whether to trust a number
            // needs to know it was checked against arithmetic and not against
            // the build the bid will be compared to.
            note: `${productLabel} piece counts match arithmetic but are not `
              + 'verified against the Qt build',
          }),
      })
    }
  }

  const totals = new Map<string, number>()
  for (const l of lines) {
    if (l.confidence !== 'verified' || l.quantity === null) continue
    // Only the ordered total, not its full/half breakdown: summing both would
    // count the same panels twice.
    if (!TOTALLED_ITEMS.includes(l.itemKey)) continue
    totals.set(l.unit, (totals.get(l.unit) ?? 0) + l.quantity)
  }

  const counts: Record<LineConfidence, number> = { verified: 0, unverified: 0, blocked: 0 }
  for (const l of lines) counts[l.confidence]++

  return {
    lines,
    totals: [...totals].map(([unit, quantity]) => ({ unit, quantity })),
    counts,
    needsAttention: counts.unverified > 0 || counts.blocked > 0,
  }
}

/**
 * Item keys that roll into a unit total.
 *
 * `panel_full` and `panel_half` are a BREAKDOWN of `panel_count`, not
 * additional material. Including them would count the same panels twice —
 * a 662-panel ceiling would total 1,421.
 *
 * `primary_stock` is the run products' equivalent of `panel_count`: the planks
 * or baffle sticks to order. It is listed here even though it is inert today —
 * every run line is `unverified` and the totals only sum verified ones — so
 * that promoting a run product to verified does not silently leave its stock
 * out of the total. Connectors, caps, joiners and trim are deliberately absent
 * for the same reason as the panel breakdown: they are separate materials, not
 * more of the primary one, and a single "EA" total that mixed them would mean
 * nothing.
 */
const TOTALLED_ITEMS: readonly string[] = ['panel_count', 'primary_stock'] as const

function lineOf(q: PieceQuantity): Pick<BomLine, 'itemKey' | 'label' | 'quantity' | 'unit'> {
  return { itemKey: q.itemKey, label: q.label, quantity: q.quantity, unit: q.unit }
}

/**
 * Render a BOM as tab-separated text.
 *
 * Confidence is a COLUMN, not a footnote: pasted into a spreadsheet, a
 * footnote is lost and an unverified count becomes indistinguishable from a
 * checked one.
 */
export function bomToTsv(bom: Bom): string {
  const rows = [['scope', 'product', 'item', 'quantity', 'unit', 'confidence', 'note'].join('\t')]
  for (const l of bom.lines) {
    rows.push([
      l.scopeLabel,
      l.productLabel,
      l.label,
      l.quantity === null ? '' : String(l.quantity),
      l.unit,
      l.confidence,
      l.note ?? '',
    ].join('\t'))
  }
  return rows.join('\n')
}
