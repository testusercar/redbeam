/**
 * Project search — the fourth panel of the left rail.
 *
 * It was a drawer of its own that slid in from the RIGHT, over the estimates,
 * with its own close button: a second sidebar, on the side the product had
 * already given to something else. The rail owns finding things — files,
 * sheets, thumbnails — and text search is the fourth way of finding a sheet,
 * so it lives where the other three do and behaves as they do: a field at the
 * top, results in the body, a line of truth in the footer. Nothing here is
 * positioned; the pane it renders into decides where it is.
 *
 * Two things this deliberately does NOT do: pretend a degraded result is a
 * full one, and pretend an empty result over a half-indexed project means the
 * words are not there. Both are ways a search box lies, and an estimator who
 * trusts a lie here misses scope.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchHit, SearchReport } from '@redbeam/store'
import { useReturnFocus } from '../returnFocus.js'
import { FileText, Glyph, Search } from '../shell/icons.js'

export interface SearchPanelProps {
  /** Runs the query. Null while no project is open. */
  onSearch: ((query: string) => Promise<SearchReport>) | null
  /** Jump to a hit. `pageNumber` is ZERO-based, as stored. */
  onGoToHit: (hit: SearchHit) => void
  /** Close the pane. Escape on an empty field asks for this. */
  onClose: () => void
  /**
   * Bumped by the caller each time search is asked for while the pane is
   * already open — Ctrl+F with the pane up — so the field takes focus again.
   * A pane that stays open cannot use "mounted" as its cue.
   */
  focusNonce?: number
  /**
   * A query handed in from outside — the palette, when it matched nothing
   * and offered the search it cannot do. Applied whenever it or `focusNonce`
   * changes, so the same words offered twice run twice.
   */
  seed?: string
  /**
   * The project-wide indexer's progress while it runs. The footer says how
   * far it has got and a bar shows it, so an empty result on a half-read set
   * reads as "not finished" rather than "not there".
   */
  indexing?: { done: number; total: number; document: string | null } | null
}

/** Characters before a query is worth running. One letter matches every page. */
const MIN_QUERY = 2
/** How long the field is left alone between keystrokes before a search runs. */
const DEBOUNCE_MS = 250

export function SearchPanel({ onSearch, onGoToHit, onClose, focusNonce = 0, seed = '', indexing = null }: SearchPanelProps) {
  useReturnFocus(true)
  const [query, setQuery] = useState('')
  const [report, setReport] = useState<SearchReport | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  /*
   * Which search is the latest. Results arrive out of order on a slow LIKE
   * scan — the query for "cei" can land after the one for "ceiling" — and
   * a stale report painted over a fresh one shows hits for a word nobody is
   * still typing.
   */
  const seq = useRef(0)

  useEffect(() => { inputRef.current?.focus() }, [focusNonce])
  useEffect(() => { if (seed !== '') setQuery(seed) }, [seed, focusNonce])

  const run = useCallback(async (raw: string) => {
    const q = raw.trim()
    const mine = ++seq.current
    if (q.length < MIN_QUERY || !onSearch) { setReport(null); setBusy(false); return }
    setBusy(true)
    let next: SearchReport
    try {
      next = await onSearch(q)
    } catch (err) {
      next = {
        query: q, mode: 'like', hits: [], truncated: false,
        indexedPageCount: 0, totalPageCount: 0, ftsPageCount: 0,
        droppedTokens: [], matchExpression: '',
        degraded: {
          reason: err instanceof Error ? err.message : String(err),
          consequences: ['No results were returned.'],
        },
      } as SearchReport
    }
    if (mine !== seq.current) return
    setReport(next)
    setBusy(false)
  }, [onSearch])

  /*
   * Search as you type, after a pause. Enter runs at once for anyone who
   * would rather not wait, and for a query the pause already ran it is a
   * harmless repeat.
   */
  useEffect(() => {
    const t = setTimeout(() => { void run(query) }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, run])

  const coverage = report
    ? report.totalPageCount > 0
      ? Math.round((report.indexedPageCount / report.totalPageCount) * 100)
      : 0
    : 0
  const partial = report !== null && report.totalPageCount > 0 && coverage < 100
  const groups = report === null ? [] : groupHits(report.hits)

  return (
    <>
      <div className="panesearch">
        <Glyph icon={Search} role="small" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run(query)
            // Escape clears first and closes second — the same two-step every
            // find field uses, so a mistyped query is not a lost pane.
            if (e.key === 'Escape') { if (query !== '') setQuery(''); else onClose() }
          }}
          placeholder="Search every sheet"
          aria-label="Search text across the project"
        />
      </div>

      <div className="panebody">
        {report === null && (
          <div className="paneempty">
            <div>Find text on any sheet.</div>
            <div className="panehint">
              Notes, schedules, tags like C-MT-01 and specification clauses —
              every page with readable text, across all the drawings in this
              project.
              {onSearch === null && ' Open a project to search it.'}
            </div>
          </div>
        )}

        {report !== null && report.degraded !== null && (
          <DegradedNote reason={report.degraded.reason} consequences={report.degraded.consequences} />
        )}

        {report !== null && report.droppedTokens.length > 0 && (
          <div className="searchnote">Ignored: {report.droppedTokens.join(', ')}</div>
        )}

        {report !== null && report.hits.length === 0 && (
          <div className="paneempty">
            <div>No matches for “{report.query}”.</div>
            {partial && (
              <div className="panehint">
                Only {coverage}% of pages are indexed, so this is not proof the
                words are absent. Sheets whose text has not been read yet
                cannot match.
              </div>
            )}
          </div>
        )}

        {/*
          Hits grouped by document, in the same group-head grammar as the
          file list and a divided index. A flat list repeated the file name
          on every row, which on a set with one drawing was 40 rows of the
          same file name and nothing else to tell them apart by.
        */}
        {groups.map((g) => (
          <section key={g.relativePath} className="sheetgroup">
            <div className="sheetgrouphead" role="presentation" title={g.relativePath}>
              <Glyph icon={FileText} role="small" />
              <span className="grow">{g.name}</span>
              <span>{g.hits.length}</span>
            </div>
            {g.hits.map((h) => (
              <button key={h.pageId} className="hitrow" onClick={() => onGoToHit(h)}>
                <span className="hitpage">p{h.pageNumber + 1}</span>
                <span className="hittext">{highlight(h.snippet, h.snippetSpans)}</span>
              </button>
            ))}
          </section>
        ))}
      </div>

      {indexing !== null && indexing.total > 0 && (
        <div
          className="paneprogress"
          role="progressbar"
          aria-label="Indexing"
          aria-valuemin={0}
          aria-valuemax={indexing.total}
          aria-valuenow={indexing.done}
        >
          <span style={{ width: `${Math.round((Math.min(1, indexing.done / indexing.total)) * 100)}%` }} />
        </div>
      )}
      <div className="panefoot">
        {busy
          ? 'Searching…'
          : report === null
            ? (onSearch === null
                ? 'No project open'
                : indexing !== null && indexing.total > 0
                  ? `Indexing ${indexing.done} of ${indexing.total} documents`
                    + (indexing.document !== null ? ` — ${indexing.document}` : '')
                  : 'Matches appear as you type')
            : summary(report, partial ? coverage : null)}
      </div>
    </>
  )
}

/**
 * A degraded search says so in one line and explains on request.
 *
 * The four consequences of a substring scan are all true and all worth
 * knowing, and shown in full they cost the pane six rows before the first
 * hit — on every search, for the whole life of a project whose index has
 * not been built. The reason stays on screen; the consequences open.
 */
function DegradedNote({ reason, consequences }: { reason: string; consequences: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="searchnote">
      <div className="searchnotehead">
        <strong>Limited search</strong>
        <button className="hlink" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Less' : 'Why'}
        </button>
      </div>
      <div>{reason}</div>
      {open && (
        // Name the consequences, not just the mode: "substring" means
        // nothing to someone who does not know what FTS5 would have done.
        <ul>
          {consequences.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      )}
    </div>
  )
}

/**
 * The footer's one line: what came back, and how much of the project it was
 * asked of. The search MODE is not repeated here — the note above the hits
 * already says when it is limited, and the word "substring" cost the line
 * its second half at the pane's floor.
 */
function summary(report: SearchReport, coverage: number | null): string {
  const n = report.hits.length
  const sheets = new Set(report.hits.map((h) => h.pageId)).size
  const head = n === 0
    ? 'No matches'
    : `${n}${report.truncated ? '+' : ''} ${n === 1 ? 'match' : 'matches'} on ${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}`
  return coverage === null ? head : `${head} · ${coverage}% indexed`
}

export interface HitGroup {
  relativePath: string
  /** The file name alone: the folder is one line above, in the group head. */
  name: string
  hits: SearchHit[]
}

/**
 * Hits by document, in the order the first hit of each arrived.
 *
 * The report is already in page order within a document, so keeping arrival
 * order keeps that; sorting groups by name would put SPECIFICATIONS.pdf
 * above the drawing that matched first for no reason a reader can see.
 */
export function groupHits(hits: ReadonlyArray<SearchHit>): HitGroup[] {
  const out = new Map<string, HitGroup>()
  for (const h of hits) {
    const g = out.get(h.relativePath)
    if (g !== undefined) { g.hits.push(h); continue }
    out.set(h.relativePath, {
      relativePath: h.relativePath,
      name: h.relativePath.split('/').pop() ?? h.relativePath,
      hits: [h],
    })
  }
  return [...out.values()]
}

/** Render a snippet with its match ranges marked, without trusting HTML. */
export function highlight(text: string, spans: ReadonlyArray<{ start: number; length: number }>) {
  if (spans.length === 0) return text
  const out: Array<string | JSX.Element> = []
  let at = 0
  spans.forEach((s, i) => {
    if (s.start > at) out.push(text.slice(at, s.start))
    out.push(<mark key={i}>{text.slice(s.start, s.start + s.length)}</mark>)
    at = s.start + s.length
  })
  if (at < text.length) out.push(text.slice(at))
  return out
}
