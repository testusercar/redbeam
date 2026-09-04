/**
 * Page-text indexing and in-document / project-wide search.
 *
 * Column names are checked against packages/store/migrations, not remembered:
 *
 *   page_text(page_id, document_id, content, source, indexed_at)
 *   page_text_fts(page_id UNINDEXED, document_id UNINDEXED, content)   -- fts5
 *   pages(id, document_id, page_number, native_text_available, text_indexed_at, ...)
 *   documents(id, relative_path, ...)
 *
 * `page_text.page_id` is the primary key, so indexing is an upsert on it.
 * `page_text_fts` has no rowid the app knows, so a re-index is DELETE + INSERT
 * by page_id — the same shape the Qt build used.
 *
 * ## Two search modes, and why the caller is told which one answered
 *
 * The desktop core runs native SQLite with FTS5 present. The browser's sql.js
 * driver ships FTS3, so `CREATE VIRTUAL TABLE ... USING fts5` is skipped at
 * migration time (reported via `MigrateResult.skipped`, never silently). Rather
 * than let search break there, it falls back to a LIKE scan over `page_text` —
 * and every result carries `mode` plus, when degraded, the concrete
 * consequences, so the UI can say "search is limited here" instead of quietly
 * returning worse answers. See `LIKE_CONSEQUENCES`.
 *
 * ## FTS5 query safety
 *
 * User input is NOT FTS5 syntax. Handing it to MATCH raw is both a crash
 * surface (an unbalanced quote is a parse error — the defect the Qt build
 * shipped) and an injection surface (`content : x`, `NEAR(...)`, `*` prefix
 * expansion, boolean operators). `toFts5Match` turns the input into a list of
 * quoted phrases, which FTS5 ANDs together: every operator character becomes a
 * literal. Tokens with nothing indexable in them are dropped rather than
 * emitted as empty phrases, because older SQLite builds raise a parse error on
 * those instead of ignoring them.
 */
import type { SqlDriver } from './index.js'

// ------------------------------------------------------------------ types --

/** Axis-aligned box in normalized page coordinates: [0,1], y down from the top. */
export interface NormBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A character range in a page's text. Offsets are UTF-16 code units. */
export interface TextSpan {
  start: number
  length: number
}

/**
 * The shape `@redbeam/viewer`'s `TextRun` already has.
 *
 * Declared structurally rather than imported: the store must not depend on the
 * viewer (or on a DOM), and the viewer must not depend on SQL. The app wires
 * the two together.
 */
export interface TextRunLike extends NormBox, TextSpan {}

export interface PageLayout {
  runs: readonly TextRunLike[]
}

export type SearchMode = 'fts5' | 'like'

export interface SearchHit {
  pageId: string
  documentId: string
  /**
   * ZERO-based, straight from `pages.page_number`.
   *
   * Not 1-based, despite what an earlier version of this comment said: the
   * value is passed through unchanged, `page_number` is zero-based (the Qt MCP
   * surface says so, and the viewer's page index matches it), and a UI that
   * treated this as 1-based would jump one sheet past every hit. Add one only
   * at the point of display.
   */
  pageNumber: number
  relativePath: string
  /** Plain text around the first match. No markup — see `snippetSpans`. */
  snippet: string
  /** Highlight ranges within `snippet`. */
  snippetSpans: TextSpan[]
  /** Highlight ranges within the page's full text. */
  spans: TextSpan[]
  /**
   * Boxes for `spans`, normalized [0,1], y down — the same convention every
   * markup uses, so the UI can scroll to and highlight a hit directly.
   *
   * `null`, not `[]`, when no layout was available for the page: the schema has
   * nowhere to persist run geometry (page_text stores content only), so boxes
   * come from a layout the caller supplies — freshly extracted by the viewer,
   * which is cheap for the handful of pages that actually matched. `null` means
   * "not resolved"; `[]` means "resolved, and the match has no geometry".
   */
  boxes: NormBox[] | null
}

export interface SearchOptions {
  /** Restrict to one document. Omit to search the whole project. */
  documentId?: string
  /** Hard cap on hits. Clamped to 1..500, matching the Qt build. */
  limit?: number
  /** Target snippet length in characters. */
  snippetChars?: number
  /** Cap on highlight spans reported per page. */
  maxSpansPerPage?: number
  /**
   * Resolve a page's run geometry so hits carry boxes. Called only for pages
   * that matched. Returning undefined leaves `boxes` null for that hit.
   */
  layout?: (pageId: string) => PageLayout | undefined | Promise<PageLayout | undefined>
  /** Force a mode. `'like'` is how a UI previews the degraded experience. */
  mode?: SearchMode
  /**
   * `'relevance'` orders by FTS5's bm25 rank. Honoured only in fts5 mode; the
   * LIKE path has no ranking and says so through `degraded`.
   */
  orderBy?: 'page' | 'relevance'
}

export interface SearchReport {
  query: string
  mode: SearchMode
  /** Null when the full-text index answered. */
  degraded: { reason: string; consequences: string[] } | null
  hits: SearchHit[]
  /** More rows existed than `limit` allowed. */
  truncated: boolean
  /** Pages with a `page_text` row, and pages total, in the searched scope. */
  indexedPageCount: number
  totalPageCount: number
  /**
   * Rows in `page_text_fts`. Divergence from `indexedPageCount` means an
   * indexing write half-landed; re-index those pages. Zero in LIKE mode.
   */
  ftsPageCount: number
  /** Query tokens that carry nothing indexable and were left out of the MATCH. */
  droppedTokens: string[]
  /** The MATCH expression actually executed. Empty in LIKE mode. */
  matchExpression: string
}

export const LIKE_CONSEQUENCES = [
  'Matches any substring, not whole words — "plan" also matches "planning".',
  'Reads every indexed page instead of using an index; slow on a large project.',
  'No relevance ranking; hits come back in page order.',
  'Case-insensitive for ASCII only — accented letters must match exactly.',
]

// ------------------------------------------------------------ capability --

const ftsCache = new WeakMap<object, boolean>()

/**
 * Is the FTS5 index actually present?
 *
 * Asked of sqlite_master rather than by probing a MATCH, because the migration
 * runner's failure mode is precisely that the CREATE VIRTUAL TABLE was skipped
 * — the table is absent, not broken. Cached per driver; a driver's module set
 * cannot change under it.
 */
export async function hasFts5(db: SqlDriver): Promise<boolean> {
  const cached = ftsCache.get(db as unknown as object)
  if (cached !== undefined) return cached
  const rows = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='page_text_fts'",
  )
  const ok = rows.length > 0
  ftsCache.set(db as unknown as object, ok)
  return ok
}

/** Forget the cached capability. For tests that create tables mid-flight. */
export function resetFts5Cache(db: SqlDriver): void {
  ftsCache.delete(db as unknown as object)
}

// -------------------------------------------------------------- indexing --

export interface PageTextRecord {
  pageId: string
  documentId: string
  content: string
  /** `page_text.source`. 'native' for a PDF text layer, 'ocr' for a scan. */
  source?: string
}

const nowIso = () => new Date().toISOString()

/**
 * Store one page's extracted text.
 *
 * `page_text` is written first because it is the system of record; the FTS
 * table is derived from it. If the FTS write fails after it, the page is
 * searchable in LIKE mode and missing from the index — which is exactly what
 * `SearchReport.ftsPageCount` vs `indexedPageCount` makes visible rather than
 * leaving it to be discovered as a mysteriously absent result. (`SqlDriver` has
 * no transaction primitive; adding one is a change to the driver contract, and
 * therefore not this module's call to make.)
 *
 * `pages.native_text_available` is kept in step with what indexing actually
 * found. The Qt build set that flag at page-sync time from `hasTextPage()`,
 * which is false for any page whose text was never requested, so project
 * summaries claimed a searchable set had no native text.
 */
export async function indexPageText(db: SqlDriver, rec: PageTextRecord): Promise<{ fts: boolean }> {
  const at = nowIso()
  const hasText = rec.content.trim().length > 0
  await db.run(
    `INSERT INTO page_text(page_id, document_id, content, source, indexed_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(page_id) DO UPDATE SET
       content=excluded.content, source=excluded.source, indexed_at=excluded.indexed_at`,
    [rec.pageId, rec.documentId, rec.content, rec.source ?? 'native', at],
  )
  await db.run('UPDATE pages SET native_text_available=?, text_indexed_at=?, updated_at=? WHERE id=?', [
    hasText ? 1 : 0,
    at,
    at,
    rec.pageId,
  ])
  const fts = await hasFts5(db)
  if (fts) {
    await db.run('DELETE FROM page_text_fts WHERE page_id=?', [rec.pageId])
    await db.run('INSERT INTO page_text_fts(page_id, document_id, content) VALUES(?,?,?)', [
      rec.pageId,
      rec.documentId,
      rec.content,
    ])
  }
  return { fts }
}

/** Index a batch. Sequential on purpose: the drivers own a single connection. */
export async function indexPageTexts(db: SqlDriver, recs: readonly PageTextRecord[]): Promise<{ fts: boolean }> {
  for (const r of recs) await indexPageText(db, r)
  return { fts: await hasFts5(db) }
}

export async function getPageText(db: SqlDriver, pageId: string): Promise<string | null> {
  const rows = await db.all<{ content: string }>('SELECT content FROM page_text WHERE page_id = ?', [pageId])
  return rows[0]?.content ?? null
}

/** Drop a page from both the store and the index. */
export async function clearPageText(db: SqlDriver, pageId: string): Promise<void> {
  await db.run('DELETE FROM page_text WHERE page_id = ?', [pageId])
  if (await hasFts5(db)) await db.run('DELETE FROM page_text_fts WHERE page_id = ?', [pageId])
  await db.run('UPDATE pages SET native_text_available=0, text_indexed_at=NULL WHERE id=?', [pageId])
}

export interface IndexCoverage {
  indexedPageCount: number
  totalPageCount: number
  ftsPageCount: number
  /** Pages indexed but whose text layer was empty — scans, needing OCR. */
  emptyTextPageCount: number
}

/**
 * How much of the project is searchable.
 *
 * Part of every answer, because an empty result over a barely-indexed project
 * must not read as "the text is not in the drawings".
 */
export async function textIndexCoverage(db: SqlDriver, documentId?: string): Promise<IndexCoverage> {
  const scope = documentId ? ' WHERE document_id = ?' : ''
  const p = documentId ? [documentId] : []
  const indexed = await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM page_text${scope}`, p)
  const total = await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM pages${scope}`, p)
  const empty = await db.all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM page_text WHERE TRIM(content) = ''${documentId ? ' AND document_id = ?' : ''}`,
    p,
  )
  let ftsPageCount = 0
  if (await hasFts5(db)) {
    const f = await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM page_text_fts${scope}`, p)
    ftsPageCount = Number(f[0]?.n ?? 0)
  }
  return {
    indexedPageCount: Number(indexed[0]?.n ?? 0),
    totalPageCount: Number(total[0]?.n ?? 0),
    ftsPageCount,
    emptyTextPageCount: Number(empty[0]?.n ?? 0),
  }
}

// ----------------------------------------------------------- query safety --

/** Anything the default unicode61 tokenizer would keep. Everything else splits. */
const INDEXABLE = /[\p{L}\p{N}]/u

/**
 * Control characters, stripped before anything reaches MATCH.
 *
 * A NUL is not merely useless in a query, it is fatal: SQLite's FTS5
 * expression parser walks the expression as a C string, so ANY embedded U+0000
 * — leading, trailing or in the middle — aborts the statement with
 * "unterminated string", whatever the surrounding quoting looks like. Verified
 * against SQLite 3.51.1. Parameter binding does not protect against this,
 * because the string is well-formed SQL text; it is the FTS5 grammar that
 * chokes. The rest of C0/C1 goes with it: none of it can be typed deliberately
 * and none of it is indexable.
 */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g

export interface Fts5Match {
  /** The MATCH expression. Empty when nothing survived. */
  match: string
  /** Tokens that became phrases, unquoted. */
  tokens: string[]
  /** Tokens left out because they contain nothing the tokenizer would index. */
  dropped: string[]
}

/**
 * Turn user input into a safe FTS5 MATCH expression.
 *
 * Every whitespace-separated token becomes a double-quoted phrase, with `"`
 * doubled to escape it. Inside a phrase FTS5 treats every character as text, so
 * `AND`, `OR`, `NOT`, `NEAR(`, `*`, `^`, `:`, `(`, `-` and a lone `"` are all
 * literal. Phrases juxtaposed with a space are ANDed, which preserves the word
 * semantics a user expects from a search box.
 *
 * Tokens with no letter or digit in them are dropped: they would tokenize to an
 * empty phrase, which SQLite 3.51 ignores but older builds reject as a parse
 * error. Dropping them is reported (`SearchReport.droppedTokens`) rather than
 * done silently, because "CL - 03" and "CL 03" then behave identically and the
 * user should be able to see why.
 */
export function toFts5Match(query: string): Fts5Match {
  const tokens: string[] = []
  const dropped: string[] = []
  for (const raw of query.split(/\s+/)) {
    if (!raw) continue
    const token = raw.replace(CONTROL, '')
    if (!token || !INDEXABLE.test(token)) {
      dropped.push(raw)
      continue
    }
    tokens.push(token)
  }
  const match = tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ')
  return { match, tokens, dropped }
}

/** Escape LIKE's own wildcards. Pairs with `ESCAPE '\'` on the statement. */
export function toLikePattern(token: string): string {
  return `%${token.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

// --------------------------------------------------------------- matching --

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Locate a term's occurrences in a page's text.
 *
 * `wholeWord` mirrors what FTS5 actually matched: its tokenizer works on word
 * boundaries, so an fts5 hit on "plan" is not a hit on "planning" and the
 * highlight must not claim otherwise. The LIKE path passes false, because there
 * a substring IS the match.
 */
export function findSpans(
  content: string,
  term: string,
  wholeWord: boolean,
  limit = 200,
): TextSpan[] {
  if (!term) return []
  const body = escapeRe(term)
  const pattern = wholeWord ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body
  let re: RegExp
  try {
    re = new RegExp(pattern, 'giu')
  } catch {
    return []
  }
  const out: TextSpan[] = []
  for (const m of content.matchAll(re)) {
    if (out.length >= limit) break
    if (m.index === undefined || m[0].length === 0) continue
    out.push({ start: m.index, length: m[0].length })
  }
  return out
}

/**
 * All highlight spans for one page, in document order and non-overlapping.
 *
 * In fts5 mode a token is first looked for whole. If it is not there literally,
 * its indexable sub-parts are tried instead: FTS5 tokenizes `24"` to `24` and
 * `CL-03` to `cl` + `03`, so those pages legitimately matched without ever
 * containing the token as typed, and reporting zero spans would leave a hit
 * with nothing to highlight.
 */
function spansForPage(content: string, tokens: readonly string[], wholeWord: boolean, max: number): TextSpan[] {
  const all: TextSpan[] = []
  for (const token of tokens) {
    let found = findSpans(content, token, wholeWord)
    if (found.length === 0 && wholeWord) {
      for (const part of token.split(/[^\p{L}\p{N}]+/u)) {
        if (part) found = found.concat(findSpans(content, part, true))
      }
    }
    all.push(...found)
  }
  all.sort((a, b) => a.start - b.start || b.length - a.length)
  const merged: TextSpan[] = []
  for (const s of all) {
    const last = merged[merged.length - 1]
    if (last && s.start <= last.start + last.length) {
      last.length = Math.max(last.length, s.start + s.length - last.start)
    } else {
      merged.push({ ...s })
    }
    if (merged.length >= max) break
  }
  return merged
}

/**
 * A readable window of text around the first match, with the highlight offsets
 * translated into it.
 *
 * Built here rather than with FTS5's `snippet()` so both modes produce the
 * identical shape, and so nothing has to round-trip through HTML markers — the
 * caller gets plain text plus offsets and can escape it properly.
 */
export function buildSnippet(
  content: string,
  spans: readonly TextSpan[],
  width: number,
): { snippet: string; snippetSpans: TextSpan[] } {
  const flat = content.replace(/\s+/g, ' ')
  // Offsets shift when whitespace collapses, so work on the original and
  // collapse only what we cut out.
  const first = spans[0]
  if (!first) {
    const head = flat.slice(0, width).trim()
    return { snippet: head + (flat.length > width ? '…' : ''), snippetSpans: [] }
  }
  const half = Math.max(8, Math.floor((width - first.length) / 2))
  let from = Math.max(0, first.start - half)
  let to = Math.min(content.length, first.start + first.length + half)
  // Do not cut a word in half at either end.
  while (from > 0 && /[\p{L}\p{N}]/u.test(content[from - 1] ?? '')) from--
  while (to < content.length && /[\p{L}\p{N}]/u.test(content[to] ?? '')) to++

  const raw = content.slice(from, to)
  // Map original offsets to offsets in the whitespace-collapsed slice.
  const map = new Int32Array(raw.length + 1)
  let snippet = ''
  let lastWasSpace = false
  for (let i = 0; i < raw.length; i++) {
    map[i] = snippet.length
    const ch = raw[i]!
    if (/\s/.test(ch)) {
      if (!lastWasSpace) snippet += ' '
      lastWasSpace = true
    } else {
      snippet += ch
      lastWasSpace = false
    }
  }
  map[raw.length] = snippet.length

  const prefix = from > 0 ? '…' : ''
  const suffix = to < content.length ? '…' : ''
  const lead = prefix.length
  const snippetSpans: TextSpan[] = []
  for (const s of spans) {
    if (s.start < from || s.start + s.length > to) continue
    const a = map[s.start - from] ?? 0
    const b = map[s.start + s.length - from] ?? a
    if (b > a) snippetSpans.push({ start: a + lead, length: b - a })
  }
  return { snippet: prefix + snippet + suffix, snippetSpans }
}

/**
 * Boxes for the runs a set of spans touches.
 *
 * Highlight granularity is the run — in practice the word — because that is the
 * finest geometry PDFium's char boxes were grouped into. A three-character
 * match inside a longer word highlights the whole word rather than inventing a
 * sub-word box by pretending the font is monospaced.
 */
export function boxesForSpans(layout: PageLayout, spans: readonly TextSpan[]): NormBox[] {
  if (spans.length === 0) return []
  const out: NormBox[] = []
  for (const r of layout.runs) {
    const hit = spans.some((s) => s.start < r.start + r.length && r.start < s.start + Math.max(1, s.length))
    if (hit) out.push({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 })
  }
  return out
}

// ----------------------------------------------------------------- search --

interface RawRow {
  page_id: string
  document_id: string
  page_number: number
  relative_path: string
  content: string
}

/**
 * Search a document or the whole project.
 *
 * Always returns a report, never throws on user input — a bad query is a result
 * with no hits and a reason, not an exception out of SQLite.
 */
export async function searchProjectText(
  db: SqlDriver,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchReport> {
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 100)))
  const snippetChars = Math.max(24, Math.floor(opts.snippetChars ?? 140))
  const maxSpans = Math.max(1, Math.floor(opts.maxSpansPerPage ?? 50))
  const wantMode: SearchMode = opts.mode ?? ((await hasFts5(db)) ? 'fts5' : 'like')
  const ftsAvailable = await hasFts5(db)
  const mode: SearchMode = wantMode === 'fts5' && ftsAvailable ? 'fts5' : 'like'

  const coverage = await textIndexCoverage(db, opts.documentId)
  const built = toFts5Match(query)

  const base = (): SearchReport => ({
    query,
    mode,
    degraded:
      mode === 'like'
        ? {
            reason: ftsAvailable
              ? 'Substring search was requested explicitly.'
              : 'This SQLite build has no FTS5 module, so page_text_fts was never created. Falling back to a LIKE scan.',
            consequences: [
              ...LIKE_CONSEQUENCES,
              ...(opts.orderBy === 'relevance' ? ['Relevance ordering was requested but is unavailable.'] : []),
            ],
          }
        : null,
    hits: [],
    truncated: false,
    indexedPageCount: coverage.indexedPageCount,
    totalPageCount: coverage.totalPageCount,
    ftsPageCount: coverage.ftsPageCount,
    droppedTokens: built.dropped,
    matchExpression: mode === 'fts5' ? built.match : '',
  })

  if (built.tokens.length === 0) return base()

  let rows: RawRow[]
  if (mode === 'fts5') {
    // `f.content` is the stored FTS5 column, so no join back to page_text is
    // needed to compute spans and snippets.
    const where = ['page_text_fts MATCH ?']
    const params: unknown[] = [built.match]
    if (opts.documentId) {
      where.push('f.document_id = ?')
      params.push(opts.documentId)
    }
    // Project-wide, page number alone interleaves documents. Grouping by the
    // document's path first is what makes a project search readable; within a
    // document it is identical to ordering by page number.
    const order = opts.orderBy === 'relevance' ? 'rank' : 'd.relative_path, p.page_number'
    params.push(limit + 1)
    rows = await db.all<RawRow>(
      `SELECT f.page_id, f.document_id, p.page_number, d.relative_path, f.content
       FROM page_text_fts f
       JOIN pages p ON p.id = f.page_id
       JOIN documents d ON d.id = f.document_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${order} LIMIT ?`,
      params,
    )
  } else {
    const where: string[] = []
    const params: unknown[] = []
    // One LIKE per token, ANDed, so multi-word queries mean the same thing in
    // both modes: all terms present somewhere on the page.
    for (const t of built.tokens) {
      where.push("t.content LIKE ? ESCAPE '\\'")
      params.push(toLikePattern(t))
    }
    if (opts.documentId) {
      where.push('t.document_id = ?')
      params.push(opts.documentId)
    }
    params.push(limit + 1)
    rows = await db.all<RawRow>(
      `SELECT t.page_id, t.document_id, p.page_number, d.relative_path, t.content
       FROM page_text t
       JOIN pages p ON p.id = t.page_id
       JOIN documents d ON d.id = t.document_id
       WHERE ${where.join(' AND ')}
       ORDER BY d.relative_path, p.page_number LIMIT ?`,
      params,
    )
  }

  const report = base()
  report.truncated = rows.length > limit
  const kept = rows.slice(0, limit)

  for (const r of kept) {
    const content = r.content ?? ''
    const spans = spansForPage(content, built.tokens, mode === 'fts5', maxSpans)
    const { snippet, snippetSpans } = buildSnippet(content, spans, snippetChars)
    let boxes: NormBox[] | null = null
    if (opts.layout) {
      const layout = await opts.layout(r.page_id)
      if (layout) boxes = boxesForSpans(layout, spans)
    }
    report.hits.push({
      pageId: r.page_id,
      documentId: r.document_id,
      pageNumber: Number(r.page_number),
      relativePath: r.relative_path,
      snippet,
      snippetSpans,
      spans,
      boxes,
    })
  }
  return report
}

/** Search one document. Thin wrapper — the same report, scoped. */
export function searchDocumentText(
  db: SqlDriver,
  documentId: string,
  query: string,
  opts: Omit<SearchOptions, 'documentId'> = {},
): Promise<SearchReport> {
  return searchProjectText(db, query, { ...opts, documentId })
}
