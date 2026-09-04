/**
 * The command palette: one field that can drive the whole app.
 *
 * Presentation and the keyboard model only — every ranking decision is in
 * `commands.ts`, and every action is a `run` the caller supplied. What lives
 * here:
 *
 *  - GROUPED FOR READING, FLAT FOR THE KEYBOARD. Arrow keys walk one list that
 *    ignores the group headings, so the highlight is an index into `rows`.
 *  - RECENTS FIRST on an untyped palette, and a note on every group that says
 *    how to narrow to it — the prefixes `>` `#` `:` `@` `/` `=` `~`, listed by `?`.
 *  - STEPS. A command that needs more does not open a dialog: what has been
 *    chosen so far sits in the field as chips, typing filters the next choice,
 *    Backspace on an empty field goes back one step, and a text argument is
 *    typed into the same field.
 *  - NEVER SILENT. A row that cannot run says why and stays listed; a refusal
 *    from the store keeps the palette open with the reason; a query that
 *    matches nothing says so in quotes and offers the search it cannot do.
 *  - TOGGLES FLIP AND STAY, so five switches are five Enters.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import {
  Bookmark, Calculator, ChevronRight, FileText, Folder, Glyph, Pentagon, Search, TriangleAlert,
  Info, X,
} from '../shell/icons.js'
import type { Icon } from '../shell/icons.js'
import { GROUP_PREFIX, PREFIXES, groupMatches, narrow, parseQuery, search, isNext,
} from './commands.js'
import type { Command, CommandKind, Group, Match, Outcome, Refusal, Step } from './commands.js'
import { pushRecent, readRecent } from './recent.js'
import './palette.css'
import { useReturnFocus } from '../returnFocus.js'
import { useFocusTrap } from '../shell/focusTrap.js'

/*
 * One glyph per kind, and each is the glyph the rest of the shell already
 * uses for that thing. Commands get the one glyph that means "do", not "go".
 */
const KIND_ICON: Record<CommandKind, Icon> = {
  command: ChevronRight,
  scope: Pentagon,
  estimate: Calculator,
  document: FileText,
  page: Bookmark,
  project: Folder,
}

/** How many rows a group shows once something is typed; the rest are counted. */
const PER_GROUP = 10

interface Taken { label: string; step: Step }

export function CommandPalette({
  commands, onClose, onSearchText,
}: {
  commands: Command[]
  onClose: () => void
  /** Full-text search over the sheets, offered when the palette itself finds nothing. */
  onSearchText?: (query: string) => void
}) {
  // Mounted only while open, so mount/unmount IS open/closed.
  useReturnFocus(true)
  const trap = useFocusTrap<HTMLDivElement>(true)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [taken, setTaken] = useState<Taken[]>([])
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [recent, setRecent] = useState<string[]>(() => readRecent())
  const inputRef = useRef<HTMLInputElement>(null)
  const base = useId()

  const step = taken[taken.length - 1]?.step
  const parsed = useMemo(() => parseQuery(query), [query])
  const typed = parsed.query.trim() !== ''
  const pageCount = useMemo(() => commands.reduce((n, c) => Math.max(n, (c.page ?? -1) + 1), 0), [commands])

  /*
   * The rows, and their groups, for whatever state the palette is in: a
   * step's choices, a page number, the prefix help, or the search.
   */
  const { groups, rows, empty } = useMemo((): { groups: Group[]; rows: Match[]; empty: boolean } => {
    if (step?.kind === 'text') {
      const text = query.trim()
      const why = step.validate?.(text) ?? null
      const row: Match = {
        command: {
          id: 'step:text', kind: 'command', title: step.describe(text),
          ...(why !== null ? { unavailable: why } : step.rule !== undefined ? { detail: `${step.rule} · it is` } : {}),
          run: () => step.run(text),
        },
        score: 0, ranges: [],
      }
      return { groups: [{ kind: 'command', label: step.label, matches: [row] }], rows: [row], empty: false }
    }
    if (step?.kind === 'choose') {
      const found = search(step.options(), query, { limit: 200 })
      const g: Group = { kind: 'command', label: step.label, ...(step.note !== undefined ? { note: step.note } : {}), matches: found }
      return { groups: found.length > 0 ? [g] : [], rows: found, empty: found.length === 0 }
    }
    if (parsed.mode === 'help') {
      const found: Match[] = PREFIXES.map((p) => ({
        command: {
          id: `prefix:${p.key}`, kind: 'command', title: p.label,
          ...(p.example !== undefined ? { detail: p.example } : {}),
          shortcut: p.key, stay: true,
          run: () => { setQuery(p.key === '?' ? '' : p.key) },
        },
        score: 0, ranges: [],
      }))
      return { groups: [{ kind: 'command', label: 'Prefixes', note: 'type one, then keep typing', matches: found }], rows: found, empty: false }
    }
    if (parsed.mode === 'page-number') {
      const n = Number.parseInt(parsed.query.trim(), 10)
      if (!Number.isFinite(n)) {
        return { groups: [{ kind: 'page', label: 'Go to page', note: `1 to ${pageCount}`, matches: [] }], rows: [], empty: false }
      }
      const hit = commands.find((c) => c.page === n - 1)
      const row: Match = hit !== undefined
        ? { command: { ...hit, title: `Page ${n} · ${hit.title}` }, score: 0, ranges: [] }
        : {
            command: {
              id: `page:${n}`, kind: 'page', title: `Page ${n}`,
              detail: pageCount === 0 ? 'no drawing open' : `the set has ${pageCount} page${pageCount === 1 ? '' : 's'}`,
              unavailable: pageCount === 0 ? 'no drawing' : 'out of range', run: () => {},
            },
            score: 0, ranges: [],
          }
      return { groups: [{ kind: 'page', label: 'Go to page', matches: [row] }], rows: [row], empty: false }
    }
    const pool = narrow(commands, parsed.mode)
    const found = search(pool, parsed.query, { limit: typed ? 500 : 50 })
    const grouped = groupMatches(found, typed ? [] : recent)
    // Capped per group once typed, and the cap is said: "10 of 75 · keep typing".
    // Untyped, each group says the prefix that narrows to it.
    const capped = grouped.map((g) => {
      if (typed && g.matches.length > PER_GROUP) {
        return { ...g, note: `${PER_GROUP} of ${g.matches.length} · keep typing to narrow`, matches: g.matches.slice(0, PER_GROUP) }
      }
      const prefix = g.kind === 'recent' ? undefined : GROUP_PREFIX[g.kind]
      if (!typed && parsed.mode === 'all' && g.note === undefined && prefix !== undefined) return { ...g, note: `${prefix} to see only these` }
      return g
    })
    const flat = capped.flatMap((g) => g.matches)
    return { groups: capped, rows: flat, empty: flat.length === 0 && typed }
  }, [commands, query, parsed, step, typed, recent, pageCount])

  // `start` is each group's offset into the flat keyboard list.
  const offsets = useMemo(() => {
    let offset = 0
    return groups.map((g) => { const start = offset; offset += g.matches.length; return start })
  }, [groups])

  // Clamped rather than corrected in an effect: `commands` can shrink under us.
  const index = Math.min(active, Math.max(0, rows.length - 1))
  const optionId = (at: number): string => `${base}-option-${at}`
  const listId = `${base}-results`

  useEffect(() => { inputRef.current?.focus() }, [taken.length])
  useEffect(() => { setActive(0); setRefusal(null) }, [query, taken.length])
  useEffect(() => {
    document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' })
  }, [index, base, rows.length])

  const enter = (command: Command, chip: string, replaceLast = false) => {
    if (command.step === undefined) return
    // A step that led on replaces its own chip with what it produced —
    // "Spacing OC" becomes "Spacing OC 24 in" — rather than leaving both.
    setTaken((t) => [...(replaceLast ? t.slice(0, -1) : t), { label: chip, step: command.step! }])
    setQuery(command.step.kind === 'text' ? (command.step.initial ?? '') : '')
  }
  const back = () => {
    setTaken((t) => t.slice(0, -1))
    setQuery('')
  }

  /**
   * Run a row. A row that says why it cannot run keeps the palette open, so
   * the reason stays on screen. A command with a step advances into it. A
   * refusal from the store is shown and the palette stays. A toggle stays.
   */
  const choose = async (row: Match | undefined, opts: { close?: boolean; alt?: boolean } = {}): Promise<void> => {
    if (row === undefined) return
    const c = row.command
    if (c.unavailable !== undefined) return
    if (opts.alt && c.alt !== undefined) { c.alt.run(); onClose(); return }
    if (c.step !== undefined) { enter(c, c.title.replace(/…$/, '')); return }
    if (c.run === undefined) return
    let answer: Outcome
    try {
      answer = await c.run()
    } catch (err) {
      answer = err instanceof Error ? err.message : String(err)
    }
    if (typeof answer === 'string' && answer !== '') { setRefusal({ reason: answer }); return }
    if (isNext(answer)) {
      // The workflow continues: the step just taken becomes a chip and the
      // next command's step opens, with the palette still up.
      const next = answer.next
      if (next.step !== undefined) { enter(next, answer.chip ?? next.title.replace(/…$/, ''), taken.length > 0); return }
      await choose({ command: next, score: 0, ranges: [] }, opts)
      return
    }
    if (typeof answer === 'object' && answer !== null) { setRefusal(answer); return }
    if (!c.id.startsWith('step:') && !c.id.startsWith('prefix:') && !c.id.startsWith('page:')) setRecent(pushRecent(c.id))
    if (c.stay && !opts.close) {
      // The row updates in place — the caller rebuilds `commands` — and the
      // field keeps what was typed so the next Enter flips the next thing.
      return
    }
    if (c.stay && opts.close) { onClose(); return }
    // A step that ran is finished; the palette closes either way.
    onClose()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (query !== '') { setQuery(''); return }
      if (taken.length > 0) { back(); return }
      onClose()
      return
    }
    if (event.key === 'Backspace' && query === '' && taken.length > 0) { event.preventDefault(); back(); return }
    if (rows.length === 0) return
    // Wrapping, because the fastest way to the last row of a short list is up.
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((at) => (Math.min(at, rows.length - 1) + 1) % rows.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((at) => (Math.min(at, rows.length - 1) + rows.length - 1) % rows.length)
    } else if (event.key === 'Tab') {
      // Take the armed row into its next step without running it.
      const c = rows[index]?.command
      if (c?.step !== undefined && c.unavailable === undefined) { event.preventDefault(); enter(c, c.title.replace(/…$/, '')) }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void choose(rows[index], { close: event.ctrlKey, alt: event.shiftKey })
    }
  }

  const placeholder = step?.kind === 'text'
    ? step.placeholder
    : step?.kind === 'choose' ? `Choose · ${step.label}` : 'Search commands, sheets, scopes and projects'

  return (
    <div
      className="palette-scrim"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
      onKeyDown={onKeyDown}
    >
      <div className="palette-panel" role="dialog" aria-modal="true" aria-label="Command palette" ref={trap}>
        <div className="palette-field">
          <Glyph icon={Search} role="inline" />
          {/* What has been chosen so far, as chips; the last is the step now open. */}
          {taken.map((t, i) => (
            <span key={i} className={`palette-chip${i === taken.length - 1 ? ' current' : ''}`}>{t.label}</span>
          ))}
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={rows.length > 0 ? optionId(index) : undefined}
            placeholder={placeholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {taken.length === 0 && query === '' && <kbd className="palette-key">Ctrl K</kbd>}
          {step === undefined && typed && !empty && parsed.mode !== 'help' && parsed.mode !== 'page-number' && (
            <span className="palette-note">{rows.length} result{rows.length === 1 ? '' : 's'}</span>
          )}
          {step?.kind === 'choose' && <span className="palette-note">step {taken.length}</span>}
        </div>

        {step?.kind === 'choose' && step.warn !== undefined && (
          <div className="palette-warn" role="status">
            <Glyph icon={TriangleAlert} role="row" />
            <span>{step.warn}</span>
          </div>
        )}

        {refusal !== null && (
          <div className="palette-refusal" role="alert">
            <Glyph icon={X} role="row" />
            <span className="grow">{refusal.reason}</span>
          </div>
        )}
        {refusal?.alternative !== undefined && (
          <div className="palette-list" role="listbox" aria-label="Instead">
            <div className="palette-kicker"><span>Instead</span></div>
            <Row
              id={`${base}-alt`}
              match={{ command: refusal.alternative, score: 0, ranges: [] }}
              armed={false}
              onArm={() => {}}
              onChoose={() => { const alt = refusal.alternative; if (alt !== undefined) void choose({ command: alt, score: 0, ranges: [] }) }}
            />
          </div>
        )}

        {empty ? (
          <div className="palette-empty">
            <p className="palette-emptyline">Nothing matches “{parsed.query.trim()}”.</p>
            {step === undefined && onSearchText !== undefined && (
              <div className="palette-list" role="listbox" aria-label="Try">
                <div className="palette-kicker"><span>Try</span></div>
                <div
                  className="palette-row"
                  role="option"
                  aria-selected="true"
                  id={optionId(0)}
                  onClick={() => { onSearchText(parsed.query.trim()); onClose() }}
                >
                  <Glyph icon={Search} role="row" />
                  <span className="palette-text">
                    <span className="palette-title">Search every sheet for “{parsed.query.trim()}”</span>
                    <span className="palette-detail">page text, across the project — the palette matches names</span>
                  </span>
                  <kbd className="palette-key">Ctrl+F</kbd>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="palette-list" id={listId} role="listbox" aria-label="Results">
            {groups.map((group, gi) => (
              <div className="palette-group" key={`${group.kind}:${group.label}`} role="group" aria-label={group.label}>
                <div className="palette-kicker">
                  <span>{group.label}</span>
                  {group.note !== undefined && <span className="palette-note">{group.note}</span>}
                </div>
                {group.matches.map((match, n) => {
                  const here = (offsets[gi] ?? 0) + n
                  return (
                    <Row
                      key={`${match.command.id}:${n}`}
                      id={optionId(here)}
                      match={match}
                      armed={here === index}
                      onArm={() => setActive(here)}
                      onChoose={() => void choose(match)}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {/* The keys, stated once at the foot, for the state the palette is in. */}
        <div className="palette-foot" aria-hidden="true">
          {step?.kind === 'text' ? (
            <>
              <span><kbd>↵</kbd> {step.label.toLowerCase()}</span>
              <span><kbd>⌫</kbd> on empty: back</span>
              <span><kbd>esc</kbd> cancel</span>
            </>
          ) : step?.kind === 'choose' ? (
            <>
              <span><kbd>↑</kbd><kbd>↓</kbd> choose</span>
              <span><kbd>↵</kbd> {step.note ?? 'apply'}</span>
              <span><kbd>⌫</kbd> on empty: back a step</span>
              <span><kbd>esc</kbd> cancel</span>
            </>
          ) : (
            <>
              <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
              <span><kbd>↵</kbd> run</span>
              <span><kbd>Tab</kbd> next step</span>
              <span><kbd>Shift ↵</kbd> in a context window</span>
              <span><kbd>?</kbd> prefixes</span>
              <span><kbd>esc</kbd> close</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({
  id, match, armed, onArm, onChoose,
}: {
  id: string
  match: Match
  armed: boolean
  onArm: () => void
  onChoose: () => void
}) {
  const c = match.command
  const stuck = c.unavailable
  const steps = c.step === undefined ? null : c.step.kind === 'text' ? 'needs a name' : 'needs a choice'
  return (
    <div
      id={id}
      className={`palette-row${stuck !== undefined ? ' unavailable' : ''}`}
      role="option"
      aria-selected={armed}
      aria-disabled={stuck !== undefined}
      onMouseEnter={onArm}
      onClick={onChoose}
    >
      {c.kind === 'command' && c.stay === true && (c.keywords ?? []).includes('setting')
        ? <Glyph icon={Info} role="row" />
        : <Glyph icon={KIND_ICON[c.kind]} role="row" />}
      <span className="palette-text">
        <span className="palette-title"><Marked text={c.title} ranges={match.ranges} /></span>
        {c.detail !== undefined && <span className="palette-detail">{c.detail}</span>}
      </span>
      {stuck !== undefined && <span className="palette-why">{stuck}</span>}
      {stuck === undefined && steps !== null && (
        <span className="palette-arg">{steps}<Glyph icon={ChevronRight} role="small" /></span>
      )}
      {c.shortcut !== undefined && <kbd className="palette-key">{c.shortcut}</kbd>}
    </div>
  )
}

/**
 * The matched characters, marked. Ranges are half-open and already merged
 * into runs by the matcher, so this only has to walk them.
 */
function Marked({ text, ranges }: { text: string; ranges: ReadonlyArray<readonly [number, number]> }) {
  if (ranges.length === 0) return <>{text}</>
  const parts: ReactNode[] = []
  let cursor = 0
  ranges.forEach(([start, end], n) => {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(<mark key={n}>{text.slice(start, end)}</mark>)
    cursor = end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}
