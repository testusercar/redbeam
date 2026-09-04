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
  /**
   * What Enter does when the command needs more before it can run: a next
   * step, collected in the palette's own field rather than in a dialog. A
   * choose step lists rows (each may have a step of its own); a text step
   * takes what is typed.
   */
  step?: Step
  /**
   * Enter runs and keeps the palette open — a toggle, whose row updates in
   * place so five switches are five Enters. Ctrl+Enter runs and closes.
   */
  stay?: boolean
  /** Shift+Enter: the same thing, somewhere else — a document in a context window. */
  alt?: { label: string; run: () => void }
  /** The 0-based page this row goes to, for `:47`. */
  page?: number
  /**
   * Run. A returned string or Refusal is a REFUSAL: the store would not do
   * it, and the palette stays open with the reason — and the nearest thing
   * that works, when there is one — rather than closing on nothing. Absent on
   * a command whose whole job is its `step`.
   */
  run?: () => Outcome | Promise<Outcome>
}

export type Outcome = void | string | Refusal | Next
export interface Refusal {
  reason: string
  /** The nearest thing that works, offered as a row under the reason. */
  alternative?: Command
}
/**
 * A step that leads to another. Returned by a `run` when the thing just done
 * has an obvious next question — a scope was named, so what product is it —
 * and the palette enters the next command's step without closing. This is
 * what lets a whole workflow happen inside the palette: add, then configure,
 * then configure again, one Enter each. Aaron: "you should be able to do
 * complete CRUD workflows within the command palette without leaving it."
 */
export interface Next {
  next: Command
  /** The chip shown for the step just finished; the command's title otherwise. */
  chip?: string
}
export const isNext = (o: unknown): o is Next =>
  typeof o === 'object' && o !== null && 'next' in o

export type Step =
  | {
    kind: 'choose'
    /** The chip the palette shows for the step already taken, e.g. "Set scale". */
    label: string
    /** A line beside the group of choices: what Enter will do to what. */
    note?: string
    /** Said before Enter, for a choice the undo stack cannot take back. */
    warn?: string
    options: () => Command[]
  }
  | {
    kind: 'text'
    label: string
    placeholder: string
    initial?: string
    /** The rule the text must meet, stated — "must be unique in the round" — so the row can say it is met. */
    rule?: string
    /** The rule, checked: a reason when the text does not meet it; null when it does. */
    validate?: (text: string) => string | null
    /** What Enter does with the text — the row restates it. */
    describe: (text: string) => string
    run: (text: string) => Outcome | Promise<Outcome>
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
/* Above the title floor: a fuzzy title hit scores at most 38 per query
   character, so 1,000 and 2,000 keep the bands disjoint for any query a
   person types. */
const ALIAS_BAND = 1_000
const TITLE_PREFIX_BAND = 2_000

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

  /*
   * Four bands, top down: a title the query is a PREFIX of; a keyword or
   * alias the query is a whole-word prefix of; a title the query merely
   * fuzzy-matches; a keyword it merely fuzzy-matches. The middle two are the
   * point: "hole" has to find the Cutout tool ahead of "sHOw LayOut prEview",
   * or the aliases Aaron asked for are decoration — but "fit" still finds
   * "Fit width" by its title before anything that only calls itself fit.
   */
  const lower = q.toLowerCase()
  const wordPrefix = (text: string): boolean => {
    const t = text.toLowerCase()
    return t.startsWith(lower) || t.split(/[\s-]+/).some((w) => w.startsWith(lower))
  }
  const hits: Array<Match & { at: number }> = []
  commands.forEach((command, at) => {
    const onTitle = trace(command.title, q)
    const titlePrefix = onTitle !== null && wordPrefix(command.title)
    if (titlePrefix) {
      hits.push({ command, score: TITLE_FLOOR + TITLE_PREFIX_BAND + Math.max(0, onTitle.score), ranges: onTitle.ranges, at })
      return
    }
    let best = -Infinity
    let strong = false
    for (const keyword of [...(command.keywords ?? []), ...aliasesFor(command)]) {
      const onKeyword = trace(keyword, q)
      if (onKeyword === null) continue
      if (wordPrefix(keyword)) strong = true
      if (onKeyword.score > best) best = onKeyword.score
    }
    if (strong) {
      // The title keeps its marks when it matched too; an alias hit alone
      // marks nothing, since nothing the user typed is in the title.
      hits.push({
        command, score: TITLE_FLOOR + ALIAS_BAND + Math.max(0, best), ranges: onTitle?.ranges ?? [], at,
      })
      return
    }
    if (onTitle !== null) {
      hits.push({ command, score: TITLE_FLOOR + Math.max(0, onTitle.score), ranges: onTitle.ranges, at })
      return
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

/** The prefix that narrows to a group, said in the group's note while nothing is typed. */
export const GROUP_PREFIX: Partial<Record<CommandKind, string>> = {
  command: '>', scope: '@', document: '/', page: '#', project: '~',
}

export interface Group {
  kind: CommandKind | 'recent'
  label: string
  note?: string
  matches: Match[]
}

/**
 * Grouped for reading, in a fixed order. With `recent` given — command ids,
 * newest first — an untyped palette leads with the last things run, which is
 * what a palette is reopened for; the rows still appear in their own groups.
 */
export function groupMatches(matches: Match[], recent: readonly string[] = []): Group[] {
  const out: Group[] = []
  if (recent.length > 0) {
    const byId = new Map(matches.map((m) => [m.command.id, m]))
    const rows = recent.map((id) => byId.get(id)).filter((m): m is Match => m !== undefined)
    if (rows.length > 0) out.push({ kind: 'recent', label: 'Recent', note: 'what you ran last', matches: rows })
  }
  for (const g of GROUPS) {
    const rows = matches.filter((m) => m.command.kind === g.kind)
    if (rows.length > 0) out.push({ ...g, matches: rows })
  }
  return out
}

/* ------------------------------------------------------------- prefixes -- */

export type PaletteMode =
  | 'all' | 'commands' | 'pages' | 'page-number' | 'scopes' | 'documents' | 'settings' | 'projects' | 'help'

/**
 * A leading key narrows the palette to one kind, the way Windows' own search
 * and every editor palette do; `?` lists them. No prefix searches everything,
 * ranked.
 */
export const PREFIXES: ReadonlyArray<{ key: string; mode: PaletteMode; label: string; example?: string }> = [
  { key: '>', mode: 'commands', label: 'Commands only' },
  { key: '#', mode: 'pages', label: 'Sheets, by number or title', example: '#417 · #ceiling' },
  { key: ':', mode: 'page-number', label: 'Go to a page number', example: ':47' },
  { key: '@', mode: 'scopes', label: 'Scopes, and things to do to one', example: '@cl03 take off' },
  { key: '/', mode: 'documents', label: 'Documents in this project' },
  { key: '=', mode: 'settings', label: 'Settings, as switches', example: '=snap · =seams' },
  { key: '~', mode: 'projects', label: 'Recent projects' },
  { key: '?', mode: 'help', label: 'These prefixes' },
]

export function parseQuery(raw: string): { mode: PaletteMode; query: string } {
  const first = raw.charAt(0)
  const prefix = PREFIXES.find((p) => p.key === first)
  if (prefix === undefined) return { mode: 'all', query: raw }
  return { mode: prefix.mode, query: raw.slice(1) }
}

/** The commands a mode admits. `page-number` and `help` are answered by the palette itself. */
export function narrow(commands: readonly Command[], mode: PaletteMode): Command[] {
  switch (mode) {
    case 'commands': return commands.filter((c) => c.kind === 'command' && !(c.keywords ?? []).includes('setting'))
    case 'pages': return commands.filter((c) => c.kind === 'page')
    case 'scopes': return commands.filter((c) => c.kind === 'scope' || (c.keywords ?? []).includes('scope-action'))
    case 'documents': return commands.filter((c) => c.kind === 'document')
    case 'settings': return commands.filter((c) => (c.keywords ?? []).includes('setting'))
    case 'projects': return commands.filter((c) => c.kind === 'project')
    default: return [...commands]
  }
}

/* --------------------------------------------------------------- aliases -- */

/**
 * Other names for the same thing, so a command is found by what a person
 * calls it rather than by its label. Aaron: "create logical aliases for every
 * tool and action so that everything is easily findable in the command
 * palette, and you don't have to specify exactly the right name."
 *
 * Keyed by command id; generated families match by prefix. Every alias
 * scores as a keyword does — below any hit in the title — so "hand" finds
 * Pan without outranking a command literally called Hand.
 */
export const ALIASES: Record<string, readonly string[]> = {
  // tools
  'tool-pan': ['hand', 'move', 'drag', 'grab', 'navigate', 'select', 'pointer', 'arrow', 'cursor'],
  'tool-area': ['polygon', 'region', 'fill', 'square feet', 'sf', 'ceiling', 'floor', 'surface', 'draw area', 'zone'],
  'tool-cutout': ['hole', 'opening', 'deduct', 'subtract', 'void', 'exclude', 'skylight', 'column'],
  'tool-polyline': ['linear', 'line', 'length', 'lf', 'run', 'perimeter', 'trim', 'edge', 'feet'],
  'tool-count': ['tally', 'each', 'ea', 'fixture', 'dot', 'points', 'click count', 'quantity'],
  'tool-shape': ['highlight', 'highlighter', 'marker', 'annotate', 'mark up', 'note'],
  'tool-dimension': ['measure', 'distance', 'ruler', 'how long', 'how far', 'dim', 'length of'],
  'calibrate': ['scale', 'set scale', 'reference line', 'known length', 'sheet scale', 'ratio', 'measure scale'],
  'scale-region': ['detail scale', 'region scale', 'box scale', 'second scale', 'area scale'],
  'set-direction': ['orientation', 'run direction', 'compass', 'which way', 'grain', 'angle', 'rotate layout'],
  'take-off': ['draw', 'start', 'begin', 'markup', 'quantify', 'measure up', 'takeoff mode', 'tools'],
  'leave-takeoff': ['stop', 'done drawing', 'exit', 'finish', 'put tools away'],
  // view
  'fit-page': ['fit sheet', 'whole page', 'zoom to fit', 'see all', 'reset zoom', 'fit'],
  'fit-width': ['zoom to width', 'fill width', 'wide'],
  'next-sheet': ['next page', 'forward', 'page down', 'following sheet'],
  'prev-sheet': ['previous page', 'back', 'page up', 'last sheet'],
  'close-tab': ['close document', 'close drawing', 'close file'],
  'context-window': ['pop out', 'second window', 'detach', 'new window', 'side by side'],
  'search': ['find', 'find text', 'look for', 'grep', 'search sheets', 'full text', 'ctrl f'],
  'settings': ['preferences', 'options', 'config', 'configuration', 'setup app', 'prefs'],
  'reset-settings': ['defaults', 'restore settings', 'factory'],
  'pane-estimates': ['right sidebar', 'estimates panel', 'rounds', 'bids', 'scopes panel', 'toggle panel'],
  // estimates and scopes
  'new-round': ['new estimate', 'create estimate', 'new bid', 'add round', 'start estimate', 'bid package'],
  'rename-round': ['rename estimate', 'rename bid', 'estimate name'],
  'duplicate-round': ['copy estimate', 'alternate', 'clone round', 'duplicate estimate'],
  'delete-round': ['delete estimate', 'remove estimate', 'remove round', 'drop bid'],
  'add-scope': ['new scope', 'create scope', 'add product', 'add tag', 'new product', 'add item'],
  'configure-scope': ['edit scope', 'scope setup', 'set measure', 'panel width', 'spacing', 'specification', 'specs', 'properties', 'settings for scope', 'change scope'],
  'rename-scope': ['scope name', 'retag', 'change name'],
  'set-product': ['product type', 'system', 'panels', 'planks', 'baffles', 'change product', 'material'],
  'set-counts': ['measure kind', 'area or length', 'what it counts', 'scope type', 'linear scope', 'count scope'],
  'duplicate-scope': ['copy scope', 'clone scope'],
  'remove-scope': ['delete scope', 'archive scope', 'drop scope', 'remove product', 'trash'],
  'restore-scope': ['unarchive', 'undelete', 'bring back', 'restore'],
  'commit-scope': ['freeze', 'record', 'lock in', 'save quantity', 'snapshot'],
  'commit-all': ['freeze all', 'record all', 'commit everything'],
  'specs': ['scope setup', 'setup page', 'configure', 'edit'],
  'quantities': ['parts', 'bill', 'bom', 'order', 'material list', 'pieces', 'how many'],
  // markups
  'delete-markup': ['remove markup', 'erase', 'clear selection', 'delete selected'],
  'move-markup': ['reassign', 'change scope', 'move to scope', 'recolour', 'rescope'],
  'move-none': ['unassign', 'no scope', 'detach markup'],
  'remove-region': ['delete region', 'clear scale region'],
  'set-scale': ['page scale', 'sheet scale', 'choose scale', 'scale preset'],
  'scale-range': ['scale sheets', 'scale pages', 'set scale for range'],
  'scale-all': ['scale every sheet', 'scale whole set', 'all pages'],
  // exports
  'export-estimate': ['pdf', 'csv', 'tsv', 'client', 'send', 'report', 'deliverable', 'save estimate', 'print'],
  'save-report': ['html report', 'takeoff report', 'save html'],
  'copy-bill': ['clipboard', 'excel', 'spreadsheet', 'copy tsv', 'paste'],
  'save-marked': ['marked-up pdf', 'annotated pdf', 'burn in', 'export drawing', 'save drawing'],
  // history and project
  'undo': ['revert', 'go back', 'take back', 'ctrl z'],
  'redo': ['again', 'redo last', 'ctrl y'],
  'close-project': ['close job', 'exit project', 'start screen', 'open another'],
}

/** Aliases for a generated family, by id prefix. */
const FAMILY_ALIASES: ReadonlyArray<[string, readonly string[]]> = [
  ['scope-', ['scope', 'open scope', 'go to scope', 'product']],
  ['takeoff-', ['draw in', 'take off', 'markup', 'start drawing']],
  ['move-', ['reassign to', 'move markup to', 'send to scope']],
  ['product-', ['product', 'type', 'system']],
  ['counts-', ['counts', 'measure']],
  ['restore-', ['restore', 'unarchive']],
  ['preset-', ['scale', 'ratio']],
]

/** Aliases every command of a kind carries. */
const KIND_ALIASES: Partial<Record<CommandKind, readonly string[]>> = {
  document: ['file', 'drawing', 'pdf', 'open document', 'open file', 'sheet set'],
  page: ['page', 'sheet', 'go to', 'jump'],
  scope: ['scope', 'product'],
  estimate: ['estimate', 'round', 'bid', 'open estimate'],
  project: ['project', 'job', 'folder', 'open project', 'recent'],
}

export function aliasesFor(command: Command): readonly string[] {
  const out: string[] = []
  const own = ALIASES[command.id]
  if (own !== undefined) out.push(...own)
  for (const [prefix, words] of FAMILY_ALIASES) {
    if (command.id.startsWith(prefix)) { out.push(...words); break }
  }
  const byKind = KIND_ALIASES[command.kind]
  if (byKind !== undefined) out.push(...byKind)
  return out
}
