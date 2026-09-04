/**
 * Perf budgets and rolling measurement (plan TH.10).
 *
 * Two problems with what this replaces:
 *
 * 1. The frame time was pushed into React state on EVERY paint. A re-render
 *    per frame means the measurement changes what it measures, and the number
 *    it reports is partly the cost of reporting it. Recording is now free —
 *    a ring-buffer write — and the UI samples on its own slow cadence.
 *
 * 2. It reported only the LAST frame. A single sample says nothing about
 *    jitter, and jitter is the thing people actually feel: a 60fps average
 *    with an occasional 90ms hitch reads as broken, and a last-frame readout
 *    will usually miss the hitch entirely. p95 and max are what matter.
 *
 * Deliberately dependency-free and DOM-free so it is testable.
 */

/** A named budget, in milliseconds. */
export interface Budget {
  key: string
  label: string
  /** Milliseconds. A sample above this is a breach. */
  ms: number
  why: string
}

/**
 * Budgets are per-OPERATION, not per-frame, except `frame` itself.
 *
 * The numbers come from what the operation competes with, not from a round
 * number: a tile that misses its budget delays the page the user is looking
 * at, while geometry extraction is allowed to be slow because it runs behind
 * the quiet gate and nothing waits on it.
 */
export const BUDGETS: Record<string, Budget> = {
  frame: {
    key: 'frame',
    label: 'Frame',
    ms: 16.7,
    why: 'one 60Hz frame — above this, panning visibly stutters',
  },
  tile: {
    key: 'tile',
    label: 'Tile',
    ms: 120,
    why: 'a tile the user is waiting to see; beyond this the page reads as blank',
  },
  text: {
    key: 'text',
    label: 'Text',
    ms: 400,
    why: 'find-in-page waits on this for the current sheet',
  },
  geometry: {
    key: 'geometry',
    label: 'Geometry',
    ms: 900,
    why: 'a full sheet is ~700ms; it runs behind the quiet gate so nothing waits',
  },
}

/** Rolling window size. Bounded so a long session cannot grow memory. */
export const WINDOW = 240

export interface Stats {
  count: number
  /** Samples currently in the window. */
  window: number
  p50: number
  p95: number
  max: number
  /** Samples in the window above budget. */
  over: number
  /** Fraction of the window over budget, 0..1. */
  overRatio: number
  budgetMs: number
}

const EMPTY: Omit<Stats, 'budgetMs'> = {
  count: 0, window: 0, p50: 0, p95: 0, max: 0, over: 0, overRatio: 0,
}

/**
 * A fixed-size ring of samples for one budget.
 *
 * Recording is O(1) with no allocation. Percentiles are computed only when
 * asked, which is on the UI's slow cadence rather than per sample.
 */
export class Meter {
  private readonly ring = new Float64Array(WINDOW)
  private next = 0
  private filled = 0
  /** Total ever recorded, which outlives the window. */
  private total = 0

  constructor(readonly budget: Budget) {}

  record(ms: number): void {
    // A negative or non-finite sample is a broken clock, not a fast frame.
    // Dropping it is better than letting it drag a percentile down.
    if (!Number.isFinite(ms) || ms < 0) return
    this.ring[this.next] = ms
    this.next = (this.next + 1) % WINDOW
    if (this.filled < WINDOW) this.filled++
    this.total++
  }

  stats(): Stats {
    if (this.filled === 0) return { ...EMPTY, budgetMs: this.budget.ms }
    const sorted = Array.from(this.ring.subarray(0, this.filled)).sort((a, b) => a - b)
    let over = 0
    for (const v of sorted) if (v > this.budget.ms) over++
    return {
      count: this.total,
      window: this.filled,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: sorted[sorted.length - 1]!,
      over,
      overRatio: over / this.filled,
      budgetMs: this.budget.ms,
    }
  }

  reset(): void {
    this.next = 0
    this.filled = 0
    this.total = 0
  }
}

/**
 * Nearest-rank percentile on an ascending array.
 *
 * Nearest-rank rather than interpolated because these are latency samples: an
 * interpolated p95 reports a duration that never actually occurred, which is
 * the wrong thing to show next to "max".
 */
export function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0
  const rank = Math.ceil(q * sortedAsc.length)
  const i = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))
  return sortedAsc[i]!
}

/** Every meter, keyed by budget. */
export class PerfRegistry {
  private readonly meters = new Map<string, Meter>()

  constructor(budgets: Record<string, Budget> = BUDGETS) {
    for (const b of Object.values(budgets)) this.meters.set(b.key, new Meter(b))
  }

  record(key: string, ms: number): void {
    this.meters.get(key)?.record(ms)
  }

  /** Time a synchronous block and record it. Returns whatever it returned. */
  measure<T>(key: string, fn: () => T, now: () => number = () => performance.now()): T {
    const t0 = now()
    try {
      return fn()
    } finally {
      this.record(key, now() - t0)
    }
  }

  stats(key: string): Stats | null {
    const m = this.meters.get(key)
    return m ? m.stats() : null
  }

  all(): Array<{ budget: Budget; stats: Stats }> {
    return [...this.meters.values()].map((m) => ({ budget: m.budget, stats: m.stats() }))
  }

  reset(): void {
    for (const m of this.meters.values()) m.reset()
  }
}

/**
 * How a budget should read in the UI.
 *
 * A single slow sample is not a problem worth colouring red — every session
 * has one. A budget is "breached" when it is missed often enough to be felt,
 * which is what the ratio thresholds encode.
 */
export type Verdict = 'idle' | 'ok' | 'watch' | 'breach'

export const WATCH_RATIO = 0.05
export const BREACH_RATIO = 0.2

export function verdict(s: Stats): Verdict {
  if (s.window === 0) return 'idle'
  if (s.overRatio >= BREACH_RATIO) return 'breach'
  if (s.overRatio >= WATCH_RATIO) return 'watch'
  return 'ok'
}

/** One-line summary, e.g. "Frame p50 8.1 / p95 21.4 ms · 7% over 16.7". */
export function summarize(budget: Budget, s: Stats): string {
  if (s.window === 0) return `${budget.label} —`
  const pct = Math.round(s.overRatio * 100)
  return `${budget.label} p50 ${s.p50.toFixed(1)} / p95 ${s.p95.toFixed(1)} ms · ${pct}% over ${budget.ms}`
}
