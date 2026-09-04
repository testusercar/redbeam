/**
 * Comparing a takeoff against what a person quoted (plan 07.2).
 *
 * Phase 07's whole point: every accuracy claim so far has been
 * self-consistency. The Qt build and this one producing 662 panels proves the
 * two agree, not that either is right. A human estimator's number, arrived at
 * off the same drawings and quoted for money, is a different kind of evidence.
 *
 * The comparison is deliberately not symmetric with a test assertion. A
 * disagreement is not automatically the app's error — a quote can round, can
 * carry a waste allowance, can include something drawn nowhere, can be wrong.
 * So this produces a REPORT to be explained, which is what the milestone asks
 * for: "with every disagreement explained".
 */

export interface GroundTruthScope {
  tag: string
  product: string
  measure: 'area' | 'linear' | 'count'
  quantity: number
  unit: string
  specifications: Record<string, string>
}

export interface GroundTruth {
  project: string
  source: {
    document: string
    quoteNumber: string
    quotedAt: string
    /**
     * Commercial terms and the person who signed the quote.
     *
     * Optional because the checked-in fixture is redacted: this repository is
     * public, and a client's quoted total and the estimator's name are not.
     * Declaring them required would have the type promise a `number` where
     * every actual instance has `undefined` — a reader would get the trap
     * rather than the compile error. The QUANTITIES are what the oracle
     * asserts, and those are all present.
     */
    quotedBy?: string | undefined
    currency?: string | undefined
    quotedTotal?: number | undefined
    [key: string]: unknown
  }
  scopes: GroundTruthScope[]
}

export type DeltaStatus =
  /** Within tolerance of the quoted quantity. */
  | 'agrees'
  /** We measured more than was quoted. */
  | 'over'
  /** We measured less. */
  | 'under'
  /** Quoted, but we have no takeoff for it at all. */
  | 'missing'
  /** We produced a quantity for something that was never quoted. */
  | 'unquoted'

export interface DeltaRow {
  tag: string
  unit: string
  quoted: number | null
  ours: number | null
  /** Signed difference as a percentage of the quoted quantity. */
  percent: number | null
  status: DeltaStatus
}

/**
 * Half a percent.
 *
 * A quote is written to the nearest unit — 180 SF, not 180.4 — so an exact
 * match is not the right test. Tight enough that a real disagreement still
 * shows: the CL03 gap this was written against is sixty times this.
 */
export const QUOTE_TOLERANCE = 0.005

/**
 * The delta, worst first.
 *
 * `ours` is keyed by the same tag as the quote, which means the caller has to
 * MAP its scopes onto the quote's deliberately. The app's Barclays scopes are
 * named differently and only one matches by string, so matching on names would
 * silently compare the wrong pairs and report agreement that does not exist.
 */
export function compareToGroundTruth(
  truth: GroundTruth,
  ours: Readonly<Record<string, number>>,
): DeltaRow[] {
  const rows: DeltaRow[] = []

  for (const scope of truth.scopes) {
    const mine = ours[scope.tag]
    if (mine === undefined) {
      // NOT zero. Zero is a measurement; "not measured" is not, and showing
      // -100% would read as the app disagreeing when it has simply not been
      // pointed at the drawing yet.
      rows.push({
        tag: scope.tag, unit: scope.unit, quoted: scope.quantity,
        ours: null, percent: null, status: 'missing',
      })
      continue
    }
    const percent = scope.quantity === 0
      ? (mine === 0 ? 0 : Number.POSITIVE_INFINITY)
      : ((mine - scope.quantity) / scope.quantity) * 100
    const within = Math.abs(percent) <= QUOTE_TOLERANCE * 100
    rows.push({
      tag: scope.tag,
      unit: scope.unit,
      quoted: scope.quantity,
      ours: mine,
      percent,
      status: within ? 'agrees' : percent > 0 ? 'over' : 'under',
    })
  }

  const quoted = new Set(truth.scopes.map((s) => s.tag))
  for (const [tag, quantity] of Object.entries(ours)) {
    if (quoted.has(tag)) continue
    // The direction nobody looks for: material in the takeoff that was never
    // in the bid.
    rows.push({
      tag, unit: '', quoted: null, ours: quantity, percent: null, status: 'unquoted',
    })
  }

  // Worst first. Forty rows of agreement hide the one that is not.
  const severity: Record<DeltaStatus, number> = {
    missing: 3, unquoted: 2, over: 1, under: 1, agrees: 0,
  }
  return rows.sort((a, b) => {
    const bySize = Math.abs(b.percent ?? 0) - Math.abs(a.percent ?? 0)
    if (bySize !== 0) return bySize
    return severity[b.status] - severity[a.status]
  })
}
