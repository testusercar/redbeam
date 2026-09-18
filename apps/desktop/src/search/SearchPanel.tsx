/**
 * Project search — the fourth panel of the left rail.
 *
 * Built to board 3 of docs/design/prompt-settings-icons-2026-09-18 (round
 * two, Aaron, 2026-09-18). The rail owns finding things — files, sheets,
 * thumbnails — and text search is the fourth way of finding a sheet, so it
 * lives where the other three do: a field at the top, results in the body, a
 * line of truth in the footer. Nothing here is positioned; the pane it
 * renders into decides where it is.
 *
 * THE HIGHLIGHT GATE. A highlight is a markup, and a markup belongs to a
 * scope. The pane used to put highlights into whatever scope happened to be
 * active, and with no takeoff scope in hand it still picked one. Now the
 * pane asks: a "Highlight into" chooser heads the results, empty by default;
 * while it is empty every highlight control is disabled, and pressing one
 * opens the chooser as a question rather than doing nothing. The choice is
 * the pane's for the session and never touches the dock's takeoff scope.
 *
 * Two things this deliberately does NOT do: pretend a degraded result is a
 * full one, and pretend an empty result over a half-indexed project means the
 * words are not there. Both are ways a search box lies.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SearchHit, SearchReport } from '@redbeam/store'
import { useReturnFocus } from '../returnFocus.js'
import { ChevronDown, Glyph, Highlighter, Plus, Search } from '../shell/icons.js'

/**
 * How far a search reaches. Kenneth, 2026-09-10: the search "is searching
 * everything in that folder, which works, but you should also have one for
 * the page". The four are nested, so a term not found on the sheet is one
 * click from being looked for on the next sheet over.
 */
export type SearchScope = 'sheet' | 'document' | 'folder' | 'project'

/** A scope the pane can highlight into: what the chooser shows. */
export interface HighlightTarget {
  id: string
  label: string
  color: string
  product: string
  markups: number
}

export interface SearchPanelProps {
  /** Runs the query over the chosen reach. Null while no project is open. */
  onSearch: ((query: string, scope: SearchScope) => Promise<SearchReport>) | null
  /** Jump to a hit. `pageNumber` is ZERO-based, as stored. */
  onGoToHit: (hit: SearchHit) => void
  /**
   * Put these hits on the sheet as highlight markups in the scope named, one
   * per matched box. Resolves to the ids made, so the pane can take them
   * back. Absent, the panel offers no highlighting.
   */
  onMarkHits?: (hits: SearchHit[], scopeId: string) => Promise<string[]>
  /** Take highlights back — the ids `onMarkHits` returned. */
  onUnmarkHits?: (ids: string[]) => Promise<void>
  /** The round's scopes, for the chooser. */
  targets?: HighlightTarget[]
  /** "New scope for these…": name one, and the pane highlights into it once it exists. */
  onNewTarget?: () => void
  /** The open document, whose hits are listed first whatever the scope. */
  currentDocumentId?: string | null
  /** The sheet a page id is: its number and its title. Null when the index does not know it. */
  sheetFor?: (pageId: string) => { number: string; title: string } | null
  /** Close the pane. Escape on an empty field asks for this. */
  onClose: () => void
  /**
   * Bumped by the caller each time search is asked for while the pane is
   * already open — Ctrl+F with the pane up — so the field takes focus again.
   */
  focusNonce?: number
  /** A query handed in from outside — the prompt's "Search the sheets for…". */
  seed?: string
  /** The project-wide indexer's progress while it runs. */
  indexing?: { done: number; total: number; document: string | null } | null
}

/** Characters before a query is worth running. One letter matches every page. */
const MIN_QUERY = 2
/** How long the field is left alone between keystrokes before a search runs. */
const DEBOUNCE_MS = 250

const REACHES: ReadonlyArray<{ id: SearchScope; label: string }> = [
  { id: 'sheet', label: 'This sheet' },
  { id: 'document', label: 'Document' },
  { id: 'folder', label: 'Folder' },
  { id: 'project', label: 'Project' },
]

const hitKey = (h: SearchHit) => `${h.pageId}:${h.spans[0]?.start ?? 0}`
const markable = (h: SearchHit) => h.boxes !== null && h.boxes.length > 0

export function SearchPanel({
  onSearch, onGoToHit, onMarkHits, onUnmarkHits, targets = [], onNewTarget, currentDocumentId = null, sheetFor,
  onClose, focusNonce = 0, seed = '', indexing = null,
}: SearchPanelProps) {
  useReturnFocus(true)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>('project')
  const [report, setReport] = useState<SearchReport | null>(null)
  const [busy, setBusy] = useState(false)
  /** The scope highlights go into. Null until chosen: the gate. */
  const [into, setInto] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  /** What this pane highlighted, by hit, so the filled glyph can take it back. */
  const [marked, setMarked] = useState<Map<string, string[]>>(new Map())
  const [armed, setArmed] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const chooserRef = useRef<HTMLDivElement>(null)
  /*
   * Which search is the latest. Results arrive out of order on a slow LIKE
   * scan, and a stale report painted over a fresh one shows hits for a word
   * nobody is still typing.
   */
  const seq = useRef(0)

  useEffect(() => { inputRef.current?.focus() }, [focusNonce])
  useEffect(() => { if (seed !== '') setQuery(seed) }, [seed, focusNonce])
  /* A scope that left the round leaves the chooser too. */
  useEffect(() => { if (into !== null && !targets.some((t) => t.id === into)) setInto(null) }, [targets, into])
  useEffect(() => {
    if (!choosing) return
    const onDown = (e: PointerEvent) => {
      if (chooserRef.current !== null && !chooserRef.current.contains(e.target as Node)) setChoosing(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [choosing])

  const run = useCallback(async (raw: string) => {
    const q = raw.trim()
    const mine = ++seq.current
    if (q.length < MIN_QUERY || !onSearch) { setReport(null); setBusy(false); return }
    setBusy(true)
    let next: SearchReport
    try {
      next = await onSearch(q, scope)
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
    setArmed(0)
  }, [onSearch, scope])

  /* Search as you type, after a pause. Enter walks the hits. */
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
  const groups = useMemo(
    () => (report === null ? [] : currentFirst(groupHits(report.hits, sheetFor), currentDocumentId)),
    [report, sheetFor, currentDocumentId],
  )
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups])
  const target = targets.find((t) => t.id === into) ?? null
  const canMark = onMarkHits !== undefined && target !== null
  const markableHits = flat.filter(markable)
  const highlighted = flat.filter((h) => marked.has(hitKey(h))).length

  /** Highlight, or ask which scope first. */
  const mark = async (hits: SearchHit[]) => {
    if (onMarkHits === undefined) return
    if (target === null) { setChoosing(true); return }
    const fresh = hits.filter((h) => markable(h) && !marked.has(hitKey(h)))
    if (fresh.length === 0) return
    const ids = await onMarkHits(fresh, target.id)
    // One id per box; the pane keeps them by hit so each hit can be taken back alone.
    setMarked((m) => {
      const next = new Map(m)
      let at = 0
      for (const h of fresh) {
        const n = h.boxes?.length ?? 0
        next.set(hitKey(h), ids.slice(at, at + n))
        at += n
      }
      return next
    })
  }
  const unmark = async (h: SearchHit) => {
    const ids = marked.get(hitKey(h))
    if (ids === undefined || onUnmarkHits === undefined) return
    await onUnmarkHits(ids)
    setMarked((m) => { const next = new Map(m); next.delete(hitKey(h)); return next })
  }

  const step = (by: 1 | -1) => {
    if (flat.length === 0) return
    const next = (armed + by + flat.length) % flat.length
    setArmed(next)
    const h = flat[next]
    if (h !== undefined) onGoToHit(h)
  }

  return (
    <>
      <div className="panesearch sr-field">
        <Glyph icon={Search} role="small" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { if (report === null) void run(query); else step(e.shiftKey ? -1 : 1) }
            // Escape clears first and closes second — the same two-step every
            // find field uses, so a mistyped query is not a lost pane.
            if (e.key === 'Escape') { if (choosing) setChoosing(false); else if (query !== '') setQuery(''); else onClose() }
          }}
          placeholder={scope === 'sheet' ? 'Search this sheet' : scope === 'project' ? 'Search every sheet' : 'Search these sheets'}
          aria-label="Search text across the project"
        />
        {report !== null && <span className="sr-count">{report.hits.length}{report.truncated ? '+' : ''}</span>}
      </div>
      {/* The reach: one tap, no dropdown. */}
      <div className="sr-reach" role="group" aria-label="Where to search">
        {REACHES.map((r) => (
          <button key={r.id} className="sr-reachitem" aria-pressed={scope === r.id} onClick={() => setScope(r.id)}>{r.label}</button>
        ))}
      </div>

      {/* The gate: where highlights go. Disabled until it is answered. */}
      {onMarkHits !== undefined && report !== null && report.hits.length > 0 && (
        <div className="sr-into" ref={chooserRef}>
          <span className="sr-intolabel">Highlight into</span>
          <button
            className={target === null ? 'sr-target unset' : 'sr-target'}
            aria-haspopup="listbox"
            aria-expanded={choosing}
            onClick={() => setChoosing((v) => !v)}
          >
            {target === null
              ? 'Choose a scope…'
              : <><span className="sr-dot" style={{ background: target.color }} /><span className="sr-targetname">{target.label}</span></>}
            <span className="grow" />
            <Glyph icon={ChevronDown} role="small" />
          </button>
          <button
            className={canMark && markableHits.length > highlighted ? 'sr-markall' : 'sr-markall off'}
            title={target === null
              ? 'Choose a scope first: a highlight is a markup, and a markup belongs to a scope'
              : `Highlight every match on the open drawing into ${target.label}`}
            onClick={() => void mark(markableHits)}
          >
            <Glyph icon={Highlighter} role="row" /> All {markableHits.length}
          </button>
          {choosing && (
            <div className="sr-chooser" role="listbox" aria-label="Highlight into">
              <div className="sr-chooserhead">
                Which scope do these highlights belong to? <b>They count nothing</b>; they mark where the words are.
              </div>
              {targets.length === 0 && <div className="sr-chooserempty">The round has no scopes yet.</div>}
              {targets.map((t) => (
                <button
                  key={t.id}
                  className="sr-choice"
                  role="option"
                  aria-selected={t.id === into}
                  onClick={() => { setInto(t.id); setChoosing(false) }}
                >
                  <span className="sr-dot" style={{ background: t.color }} />
                  <span className="grow">{t.label}<span className="sr-choicesub">{t.product} · {t.markups === 0 ? 'no markups' : `${t.markups} markup${t.markups === 1 ? '' : 's'}`}</span></span>
                </button>
              ))}
              {onNewTarget !== undefined && (
                <button className="sr-choicenew" onClick={() => { setChoosing(false); onNewTarget() }}>
                  <Glyph icon={Plus} role="small" /> New scope for these…
                </button>
              )}
            </div>
          )}
        </div>
      )}

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

        {/* Hits grouped by SHEET for the open document, by file for the others. */}
        {groups.map((g) => {
          const done = g.hits.filter((h) => marked.has(hitKey(h))).length
          const onScreen = g.hits.filter(markable).length
          return (
            <section key={g.key} className="sr-group">
              <div className="sr-grouphead" title={g.relativePath}>
                <b>{g.title}</b>
                {g.detail !== '' && <span className="sr-groupdetail">{g.detail}</span>}
                <span className="grow" />
                <span>{g.hits.length}</span>
                {done > 0 && <span className="sr-groupdetail">· {done} highlighted</span>}
                {done === 0 && !g.open && onMarkHits !== undefined && <span className="sr-groupdetail">· {onScreen} of {g.hits.length} on screen</span>}
              </div>
              {g.hits.map((h) => {
                const at = flat.indexOf(h)
                const lit = marked.has(hitKey(h))
                return (
                  <div key={hitKey(h)} className={`sr-hit${at === armed ? ' armed' : ''}`}>
                    <button className="sr-hittext" onClick={() => { setArmed(at); onGoToHit(h) }}>
                      {highlight(h.snippet, h.snippetSpans)}
                    </button>
                    {onMarkHits !== undefined && markable(h) && (
                      <button
                        className={lit ? 'sr-hitmark on' : 'sr-hitmark'}
                        title={lit ? 'Remove this highlight' : target === null ? 'Highlight this match — choose a scope first' : `Highlight this match into ${target.label}`}
                        aria-label={lit ? 'Remove this highlight' : 'Highlight this match on the sheet'}
                        aria-pressed={lit}
                        onClick={() => void (lit ? unmark(h) : mark([h]))}
                      >
                        <Glyph icon={Highlighter} role="row" filled={lit} />
                      </button>
                    )}
                  </div>
                )
              })}
            </section>
          )
        })}
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
      <div className="panefoot sr-foot">
        <span className="grow">
          {busy
            ? 'Searching…'
            : report === null
              ? (onSearch === null
                  ? 'No project open'
                  : indexing !== null && indexing.total > 0
                    ? `Indexing ${indexing.done} of ${indexing.total} documents`
                      + (indexing.document !== null ? ` — ${indexing.document}` : '')
                    : 'Matches appear as you type')
              : summary(report, partial ? coverage : null, highlighted, target?.label ?? null)}
        </span>
        {report !== null && report.hits.length > 0 && (
          <span className="sr-keys"><kbd>↵</kbd> next <kbd>⇧↵</kbd> previous</span>
        )}
      </div>
    </>
  )
}

/**
 * A degraded search says so in one line and explains on request.
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
        <ul>
          {consequences.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      )}
    </div>
  )
}

/** The footer's one line: what came back, how much of the project it was asked of, and where highlights went. */
function summary(report: SearchReport, coverage: number | null, highlighted: number, into: string | null): string {
  const n = report.hits.length
  const sheets = new Set(report.hits.map((h) => h.pageId)).size
  const head = n === 0
    ? 'No matches'
    : `${n}${report.truncated ? '+' : ''} ${n === 1 ? 'match' : 'matches'} · ${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}`
  const parts = [head]
  if (coverage !== null) parts.push(`${coverage}% indexed`)
  if (highlighted > 0 && into !== null) parts.push(`${highlighted} highlighted into ${into}`)
  return parts.join(' · ')
}

export interface HitGroup {
  key: string
  relativePath: string
  /** The sheet number for the open document; the file name for another. */
  title: string
  /** The sheet's title, or the page. Empty when neither is known. */
  detail: string
  /** Whether this group is on the open document — its hits can be shown on screen. */
  open: boolean
  hits: SearchHit[]
}

/**
 * Hits by sheet for the open document, by file for the others, in the order
 * the first hit of each arrived. The report is already in page order within
 * a document, so keeping arrival order keeps that.
 */
export function groupHits(
  hits: ReadonlyArray<SearchHit>,
  sheetFor?: (pageId: string) => { number: string; title: string } | null,
): HitGroup[] {
  const out = new Map<string, HitGroup>()
  for (const h of hits) {
    const sheet = sheetFor?.(h.pageId) ?? null
    const key = sheet !== null ? h.pageId : h.relativePath
    const g = out.get(key)
    if (g !== undefined) { g.hits.push(h); continue }
    out.set(key, {
      key,
      relativePath: h.relativePath,
      title: sheet !== null ? sheet.number : (h.relativePath.split('/').pop() ?? h.relativePath),
      detail: sheet !== null ? (sheet.title !== '' ? `${sheet.title} · p${h.pageNumber + 1}` : `p${h.pageNumber + 1}`) : 'other document',
      open: sheet !== null,
      hits: [h],
    })
  }
  return [...out.values()]
}

/**
 * The open document's groups first, the rest in arrival order. Kenneth,
 * 2026-09-10: "prioritize the current document at the top and then results
 * from other documents below". A stable move, not a sort.
 */
export function currentFirst(groups: HitGroup[], currentDocumentId: string | null): HitGroup[] {
  if (currentDocumentId === null) return groups
  const mine = groups.filter((g) => g.hits[0]?.documentId === currentDocumentId)
  if (mine.length === 0) return groups
  return [...mine, ...groups.filter((g) => g.hits[0]?.documentId !== currentDocumentId)]
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
