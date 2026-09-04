/**
 * Ranking for the command palette.
 *
 * The design package deletes the permanent menu bar on the condition that this
 * exists (project-window spec §12), so the palette is the only way to reach
 * most of the application. That makes the ranking load-bearing rather than a
 * nicety: if the first row is wrong, the feature the menu bar used to expose is
 * effectively gone.
 *
 * No React and no DOM here on purpose — the whole ranking argument lives in one
 * file so it can be argued with in `commands.test.ts` instead of through the UI.
 *
 * The palette searches destinations as well as actions (§12: commands,
 * projects, documents, pages, scopes), and a large share of what an estimator
 * types at it is a sheet number — `AE6-01-02`, `A-101`, `M2.01`. Sheet numbers
 * are punctuated codes, not words, and a generic subsequence matcher gets them
 * wrong in both directions: it will not find `AE6-01-02` from `ae60102`, and it
 * will happily find `A-102` from `a101` by scattering the digits. The two rules
 * marked SHEET RULE below are the whole of the fix.
 */

export type CommandKind = 'command' | 'document' | 'page' | 'scope' | 'estimate' | 'project'

export interface Command {
  id: string
  kind: CommandKind
  /** What the user reads, e.g. "Fit width" or "AE6-01-02 ARCHITECTURAL CEILING PLAN". */
  title: string
  /** Optional second line: a sheet number, a file path, a scope's product type. */
  detail?: string
  /** Keyboard shortcut to display, e.g. "Ctrl+1". Display only. */
  shortcut?: string
  /** Extra words that should match but are not displayed — synonyms, aliases. */
  keywords?: string[]
  /**
   * Reachable by typing, but not offered on an untyped palette.
   *
   * For long generated families — the 46 scale presets, one command each —
   * where the individual rows are worth having and the set of them is not.
   * Listed unconditionally they filled the untyped palette to its row limit
   * and pushed the estimates, scopes and documents below it off the bottom,
   * so opening the palette to reach a scope showed a wall of scales instead.
   */
  whenTyped?: boolean
  /**
   * Why this row cannot run right now — a project on an offline drive.
   *
   * Listed, dimmed and saying so, rather than left out: a row that is not
   * there reads as "never existed", and the person typing a job's name is
   * asking whether it was ever opened here. Enter on it does nothing and the
   * palette stays open, which is the honest version of "did nothing".
   */
  unavailable?: string
  run: () => void
}

export interface Match {
  command: Command
  score: number
  /** Half-open `[start, end)` index ranges in `title` that matched, for highlighting. */
  ranges: Array<[number, number]>
}

/* ------------------------------------------------------------- weights -- */

/*
 * Ordered by what the palette is meant to reward: an exact prefix, then a word
 * boundary, then contiguity, then earliness. The numbers encode that ordering
 * and nothing else — BOUNDARY beats CONTIGUOUS per character, and LEAD is
 * capped so position can never outweigh either.
 */
const MATCH = 16
const BOUNDARY = 12
const CONTIGUOUS = 10
const GAP_OPEN = 6
const GAP_EXTEND = 1
const LEAD = 1
const LEAD_CAP = 12
const PREFIX = 96

/*
 * "A match found only in keywords scores below any match in the title" is a
 * hard guarantee, not a tendency, so it is enforced by disjoint score bands
 * rather than by a constant penalty a long enough keyword could out-earn. Raw
 * scores are bounded by MATCH + BOUNDARY + CONTIGUOUS (38) per query character,
 * so a query would have to run to ~260 characters to reach the ceiling; the
 * clamp catches it if one ever does.
 */
const KEYWORD_CEILING = 10_000
const TITLE_FLOOR = KEYWORD_CEILING + 1

/** Enough rows to scroll through; far more than anyone reads. */
const DEFAULT_LIMIT = 50

/*
 * Separators are the punctuation that holds a code together. In the TARGET they
 * are free to skip, so `AE6-01-02` is reachable from `ae60102`; in the QUERY
 * they are deleted before matching, so `a-101`, `a 101` and `a101` are one
 * query. Deleting them from the query costs the matcher a word break it could
 * otherwise lean on — earned back by the target-side boundary bonus, which is
 * where word structure actually lives.
 */
const SEPARATOR = /[-./_\s]/
const SEPARATORS = /[-./_\s]+/g

const isSeparator = (c: string): boolean => c !== '' && SEPARATOR.test(c)
const isDigit = (c: string): boolean => c >= '0' && c <= '9'
const isUpper = (c: string): boolean => c !== c.toLowerCase() && c === c.toUpperCase()
const isLower = (c: string): boolean => c !== c.toUpperCase() && c === c.toLowerCase()

const normalize = (query: string): string => query.toLowerCase().replace(SEPARATORS, '')

/* ---------------------------------------------------------------- scan -- */

interface Scan {
  lower: string
  /** `lower` with separators removed — what an "exact prefix" is tested against. */
  compact: string
  boundary: boolean[]
  /** True where a run of digits begins. See SHEET RULE 1. */
  digitRunStart: boolean[]
  /** Non-separator characters strictly before index i. Length n + 1. */
  nonSep: number[]
  /** Nearest matchable index before j with only separators in between, or -1. */
  adjacent: number[]
}

/**
 * Everything about a target the inner loop would otherwise recompute.
 *
 * Rebuilt per target per keystroke rather than cached: candidate lists are
 * hundreds of short strings, and a cache keyed on a string the caller is free
 * to rebuild every render is a memory leak waiting to be written.
 */
function scan(target: string): Scan {
  const n = target.length
  const lower = target.toLowerCase()
  const boundary: boolean[] = new Array<boolean>(n)
  const digitRunStart: boolean[] = new Array<boolean>(n)
  const nonSep: number[] = new Array<number>(n + 1)
  const adjacent: number[] = new Array<number>(n)

  nonSep[0] = 0
  let lastMatchable = -1
  for (let j = 0; j < n; j++) {
    const c = target.charAt(j)
    const p = j === 0 ? '' : target.charAt(j - 1)
    const sep = isSeparator(c)
    const digit = isDigit(c)
    const prevDigit = isDigit(p)

    digitRunStart[j] = digit && !prevDigit
    boundary[j] =
      j === 0 ||
      isSeparator(p) ||
      // camelCase and letter/digit seams count too: "A101" is two tokens to a
      // reader even with nothing between them.
      (isUpper(c) && isLower(p)) ||
      (digit && !prevDigit) ||
      (!digit && !sep && prevDigit)

    nonSep[j + 1] = (nonSep[j] ?? 0) + (sep ? 0 : 1)
    adjacent[j] = lastMatchable
    if (!sep) lastMatchable = j
  }
  return { lower, compact: lower.replace(SEPARATORS, ''), boundary, digitRunStart, nonSep, adjacent }
}

/** Cheap superset test, so the walk below only runs on plausible targets. */
function reachable(lower: string, q: string): boolean {
  let at = 0
  for (const c of q) {
    const found = lower.indexOf(c, at)
    if (found < 0) return false
    at = found + 1
  }
  return true
}

/* ----------------------------------------------------------- the match -- */

/** The best score for a match ending with q[i] at this target index. */
interface Cell { score: number; from: number }

interface Trace { score: number; ranges: Array<[number, number]> }

/**
 * Best-scoring subsequence match of `q` (already normalized) in `target`.
 *
 * A greedy left-to-right walk is not enough once the sheet rules apply: `a101`
 * against "A-102 / A-101 COMBINED PLAN" dies on the final `1` of the first code
 * and has to re-enter at the second. So this is a full walk over (query index x
 * target index), keeping the best score per cell and a parent pointer for the
 * highlight ranges.
 */
function trace(target: string, q: string): Trace | null {
  const n = target.length
  const m = q.length
  if (n === 0 || m === 0) return null
  const s = scan(target)
  if (!reachable(s.lower, q)) return null

  const layers: Array<Array<Cell | undefined>> = []
  let prev: Array<Cell | undefined> = []

  for (let i = 0; i < m; i++) {
    const qc = q.charAt(i)
    const digit = isDigit(qc)
    // SHEET RULE 1 — a query digit that OPENS a run of query digits may only
    // land where a run of target digits opens. Without it `a101` scatters
    // across "AREA 1 LEVEL 0 PLAN 1"; with it, digits are anchored to the code
    // they belong to. What it costs: a digit run can only be entered at its
    // start, so `102` will not find `AE6-01-02` — though `0102` and `ae60102`
    // both will.
    const opensDigitRun = digit && (i === 0 || !isDigit(q.charAt(i - 1)))
    // SHEET RULE 2 — inside a run of query digits, every later digit must be the
    // next target character, separators excepted. That is what lets `ae60102`
    // cross the hyphens of `AE6-01-02` while stopping `a101` from reaching the
    // trailing `1` of "A-102 LEVEL 1": skipping a SEPARATOR is always free,
    // skipping a DIGIT never is.
    const insideDigitRun = digit && !opensDigitRun

    const cur: Array<Cell | undefined> = []
    let live = false
    // Running best over every k < j for the gapped branch, carried as
    // score + nonSep[k + 1] * GAP_EXTEND so the distance term cancels at j.
    let bestGap = -Infinity
    let bestGapAt = -1

    for (let j = 0; j < n; j++) {
      if (i > 0 && j > 0) {
        const back = prev[j - 1]
        if (back !== undefined) {
          const carried = back.score + (s.nonSep[j] ?? 0) * GAP_EXTEND
          if (carried > bestGap) { bestGap = carried; bestGapAt = j - 1 }
        }
      }
      if (s.lower.charAt(j) !== qc) continue
      if (opensDigitRun && s.digitRunStart[j] !== true) continue

      const here = MATCH + (s.boundary[j] === true ? BOUNDARY : 0)
      if (i === 0) {
        cur[j] = { score: here - Math.min(j, LEAD_CAP) * LEAD, from: -1 }
        live = true
        continue
      }

      let best: Cell | undefined
      const k = s.adjacent[j] ?? -1
      const run = k >= 0 ? prev[k] : undefined
      if (run !== undefined) best = { score: run.score + here + CONTIGUOUS, from: k }
      if (!insideDigitRun && bestGapAt >= 0) {
        const gapped = bestGap - (s.nonSep[j] ?? 0) * GAP_EXTEND - GAP_OPEN + GAP_EXTEND + here
        if (best === undefined || gapped > best.score) best = { score: gapped, from: bestGapAt }
      }
      if (best !== undefined) { cur[j] = best; live = true }
    }
    if (!live) return null
    layers.push(cur)
    prev = cur
  }

  let end: Cell | undefined
  let endAt = -1
  for (let j = 0; j < n; j++) {
    const cell = prev[j]
    if (cell !== undefined && (end === undefined || cell.score > end.score)) { end = cell; endAt = j }
  }
  if (end === undefined) return null

  const hits: number[] = []
  let j = endAt
  for (let i = m - 1; i >= 0 && j >= 0; i--) {
    hits.push(j)
    const cell = layers[i]?.[j]
    if (cell === undefined) break
    j = cell.from
  }
  hits.reverse()

  // A prefix pays a lump sum, not a per-character rate, so a long mid-string
  // match cannot accumulate past it. Tested against `compact` so that `a101` is
  // a prefix of "A-101" the way a reader means it.
  const score = end.score + (s.compact.startsWith(q) ? PREFIX : 0)
  return { score, ranges: merge(hits) }
}

/** Matched indices are individual; highlights are runs. */
function merge(hits: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const hit of hits) {
    const last = out[out.length - 1]
    if (last !== undefined && last[1] === hit) last[1] = hit + 1
    else out.push([hit, hit + 1])
  }
  return out
}

/* --------------------------------------------------------------- search -- */

export function search(commands: Command[], query: string, opts?: { limit?: number }): Match[] {
  const limit = Math.max(0, opts?.limit ?? DEFAULT_LIMIT)
  const q = normalize(query)

  // An empty (or all-punctuation) query shows what is there, in the order the
  // caller put it in. Which commands deserve to be on top of an untyped palette
  // is a question about recency and context, and it is not this file's to
  // answer — beyond honouring `whenTyped`, which is the caller saying a family
  // of commands is worth finding and not worth listing.
  if (q === '') {
    return commands
      .filter((command) => command.whenTyped !== true)
      .slice(0, limit)
      .map((command) => ({ command, score: 0, ranges: [] }))
  }

  const hits: Array<Match & { at: number }> = []
  commands.forEach((command, at) => {
    const onTitle = trace(command.title, q)
    if (onTitle !== null) {
      hits.push({ command, score: TITLE_FLOOR + Math.max(0, onTitle.score), ranges: onTitle.ranges, at })
      return
    }
    let best = -Infinity
    for (const keyword of command.keywords ?? []) {
      const onKeyword = trace(keyword, q)
      if (onKeyword !== null && onKeyword.score > best) best = onKeyword.score
    }
    // No ranges: nothing in the displayed title matched, and marking characters
    // the user did not type is worse than marking none.
    if (best > -Infinity) {
      hits.push({ command, score: Math.min(KEYWORD_CEILING, Math.max(1, best)), ranges: [], at })
    }
  })

  // Input index as an explicit tiebreak rather than trusting the engine's sort:
  // equal scores keeping input order is a promise the tests hold us to, and it
  // should not depend on which JS engine the desktop build happens to ship.
  hits.sort((a, b) => b.score - a.score || a.at - b.at)
  return hits.slice(0, limit).map(({ command, score, ranges }) => ({ command, score, ranges }))
}

/* --------------------------------------------------------------- groups -- */

/*
 * Group order is what you are most likely to have come for: an action first,
 * then the takeoff objects you were already working in, then the drawing set,
 * then the project you would have to leave for. Labels are the plural nouns the
 * rest of the app uses for each kind — commands spec §11 requires one name per
 * thing across buttons, menus, palette and tooltips.
 */
/*
 * A group can carry a NOTE — one line beside its label about what choosing a
 * row does. Projects have one because a window is a project, so Enter opens
 * a second window; the words are the title menu's, one name per thing.
 */
const GROUPS: ReadonlyArray<{ kind: CommandKind; label: string; note?: string }> = [
  { kind: 'command', label: 'Commands' },
  { kind: 'scope', label: 'Scopes' },
  { kind: 'estimate', label: 'Estimates' },
  { kind: 'document', label: 'Documents' },
  { kind: 'page', label: 'Pages' },
  { kind: 'project', label: 'Projects', note: 'Opens a second window. This one stays as it is.' },
]

export interface Group {
  kind: CommandKind
  label: string
  note?: string
  matches: Match[]
}

export function groupMatches(matches: Match[]): Group[] {
  return GROUPS
    .map((g) => ({ ...g, matches: matches.filter((m) => m.command.kind === g.kind) }))
    .filter((group) => group.matches.length > 0)
}
