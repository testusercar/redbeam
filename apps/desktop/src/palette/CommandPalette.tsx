/**
 * The command prompt: one field that can drive the whole app.
 *
 * Built to board 1 of docs/design/prompt-settings-icons-2026-09-18 (Aaron,
 * 2026-09-18: "I love it. Build it."). A Raycast, not a terminal:
 *
 *  - NOUNS AND VERBS ARE SEPARATE. A scope is one row. Enter opens it; Tab
 *    opens its actions one level down, in one panel. Not five rows of
 *    "Take off in…", "Rename…", "Colour…".
 *  - THE EMPTY STATE IS SUGGESTIONS, NOT A CATALOGUE. What fits the sheet and
 *    the scope on screen, then what you ran last. Typing finds everything.
 *  - FILTERING IS A CONTROL, NOT A CHEAT-SHEET. The "All ▾" menu narrows to a
 *    kind. The prefixes `>` `#` `:` `@` `/` `=` `~` still work for anyone who
 *    learned them, and `?` still lists them; they are no longer advertised on
 *    every group.
 *  - NOTHING SHOUTS. A row that cannot run right now is hidden until it is
 *    searched for by name, and then it is greyed with its reason in the
 *    subtitle. Never amber.
 *  - STEPS. A command that needs more does not open a dialog: the choice so
 *    far is a chip in the field, typing filters the next choice, Backspace on
 *    an empty field steps out, and a text argument is typed into the field.
 *  - GROUPED FOR READING, FLAT FOR THE KEYBOARD. Arrow keys walk one list
 *    that ignores the group headings.
 *
 * Presentation and the keyboard model only — every ranking decision is in
 * `commands.ts`, and every action is a `run` the caller supplied.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import {
  Area, ArrowUndo, ChevronDown, ChevronRight, Close, Palette, Commit, Compass, Copy, Count, Crop, Cutout, DocumentPdf,
  Export, Eye, EyeOff, Files, Folder, Glyph, Hand, Leave, Maximize, Move, Next, Open,
  Pencil, Plus, Polyline, Previous, Refresh, Rename, Reset, Round, Ruler, Search, SearchText, Setting, Settings2,
  Sheet, SlidersHorizontal, Trash2, TriangleAlert, Window, WindowNew, X, ZoomIn, ZoomOut, Crosshair, Scan, Layers,
  StretchHorizontal, Bookmark, Type,
} from '../shell/icons.js'
import type { Icon } from '../shell/icons.js'
import { PREFIXES, groupMatches, narrow, parseQuery, search, isNext } from './commands.js'
import type { Command, CommandKind, Group, Match, Outcome, PaletteMode, Refusal, Step } from './commands.js'
import { pushRecent, readRecent } from './recent.js'
import './palette.css'
import { useReturnFocus } from '../returnFocus.js'
import { useFocusTrap } from '../shell/focusTrap.js'

/** The type tag on the right of a row: the noun the rest of the app uses. */
const KIND_LABEL: Record<CommandKind, string> = {
  command: 'Command', scope: 'Scope', estimate: 'Round', document: 'Document', page: 'Sheet', project: 'Project',
}

/** The noun's glyph. A scope is its colour dot, drawn by the row itself. */
const NOUN_ICON: Record<Exclude<CommandKind, 'command' | 'scope'>, Icon> = {
  estimate: Round, document: DocumentPdf, page: Sheet, project: Folder,
}

/**
 * The verb's glyph, from the dictionary (board 3). A command may carry its
 * own `icon`; the rest are read off the title's first verb, and a family of
 * generated commands off its id.
 */
const VERBS: ReadonlyArray<[RegExp, Icon]> = [
  [/^take off/i, Crosshair],
  [/^commit/i, Commit],
  [/^(export|save report|save marked|save )/i, Export],
  [/^(rename|name$)/i, Rename],
  [/^(duplicate|copy)/i, Copy],
  [/^(delete|remove)/i, Trash2],
  [/^(add|new |create)/i, Plus],
  [/^(set scale|apply this sheet|apply to|calibrate|draw a scale|remove a scale|scale )/i, Ruler],
  [/^(direction|set direction)/i, Compass],
  [/^(configure|scope setup|set product|set what|seams|settings, at)/i, SlidersHorizontal],
  [/^fit/i, Maximize],
  [/^zoom in/i, ZoomIn],
  [/^zoom out/i, ZoomOut],
  [/^(show|reveal)/i, Eye],
  [/^hide/i, EyeOff],
  [/^(reset|restore|reopen)/i, Reset],
  [/^(search|find)/i, SearchText],
  [/^colour/i, Palette],
  [/^settings$/i, Settings2],
  [/^(open|go to)/i, Open],
  [/^next/i, Next],
  [/^previous/i, Previous],
  [/^(refresh|rescan)/i, Refresh],
  [/^(leave|close project)/i, Leave],
  [/^close/i, Close],
  [/^move/i, Move],
  [/^new context window/i, WindowNew],
  [/^(every markup|markups|select its markups)/i, Layers],
  [/^(parts|results|quantities)/i, Round],
  [/^(undo)/i, ArrowUndo],
  [/^archive/i, Trash2],
  // Anywhere in the title, once no verb led.
  [/colour/i, Palette],
  [/scale/i, Ruler],
  [/markup/i, Layers],
  [/sheet|page/i, Sheet],
]
const BY_ID: ReadonlyArray<[RegExp, Icon]> = [
  [/^tool-pan/, Hand], [/^tool-area/, Area], [/^tool-cutout/, Cutout], [/^tool-polyline/, Polyline],
  [/^tool-count/, Count], [/^tool-dimension/, Ruler], [/^tool-scale-region|^region/, Crop], [/^tool-text|^tool-note/, Type],
  [/^tool-/, Pencil], [/^pane-/, Files], [/^fit-width/, StretchHorizontal], [/^scan|^index/, Scan],
  [/^bookmark/, Bookmark], [/^context-window/, WindowNew], [/^window/, Window],
]
function iconFor(c: Command, fallback: Icon = ChevronRight): Icon | null {
  if (c.icon !== undefined) return c.icon as Icon
  if (c.kind === 'scope') return null
  if (c.kind !== 'command') return NOUN_ICON[c.kind]
  if ((c.keywords ?? []).includes('setting')) return Setting
  for (const [re, icon] of BY_ID) if (re.test(c.id)) return icon
  for (const [re, icon] of VERBS) if (re.test(c.title)) return icon
  return fallback
}

/** How many rows a group shows once something is typed; the rest are counted. */
const PER_GROUP = 8

/** The filter control's choices: a kind, or everything. */
const FILTERS: ReadonlyArray<{ mode: PaletteMode; label: string }> = [
  { mode: 'all', label: 'All' },
  { mode: 'commands', label: 'Commands' },
  { mode: 'scopes', label: 'Scopes' },
  { mode: 'pages', label: 'Sheets' },
  { mode: 'documents', label: 'Documents' },
  { mode: 'settings', label: 'Settings' },
  { mode: 'projects', label: 'Projects' },
]

interface Taken { label: string; step: Step }

/** One thing the actions panel can do to the armed row. */
interface Action { id: string; title: string; detail?: string; icon: Icon | null; color?: string; key?: string; command?: Command; run?: () => void | Promise<void> }

export function CommandPalette({
  commands, onClose, onSearchText, initialQuery = '', context,
}: {
  commands: Command[]
  onClose: () => void
  /** What the field holds when the palette opens: a prefix, or a command to find. */
  initialQuery?: string
  /** Full-text search over the sheets, offered under the results. */
  onSearchText?: (query: string) => void
  /** Where the estimator is — "A24.00 · CLG02 active" — for the suggestions' heading and the foot. */
  context?: string
}) {
  // Mounted only while open, so mount/unmount IS open/closed.
  useReturnFocus(true)
  const trap = useFocusTrap<HTMLDivElement>(true)
  const [query, setQuery] = useState(initialQuery)
  const [active, setActive] = useState(0)
  const [taken, setTaken] = useState<Taken[]>([])
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [recent, setRecent] = useState<string[]>(() => readRecent())
  const [filter, setFilter] = useState<PaletteMode>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [actionAt, setActionAt] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const base = useId()

  const step = taken[taken.length - 1]?.step
  const parsed = useMemo(() => parseQuery(query), [query])
  const mode: PaletteMode = parsed.mode !== 'all' ? parsed.mode : filter
  const typed = parsed.query.trim() !== ''
  const pageCount = useMemo(() => commands.reduce((n, c) => Math.max(n, (c.page ?? -1) + 1), 0), [commands])

  /*
   * The rows, and their groups, for whatever state the palette is in: a
   * step's choices, a page number, the prefix help, or the search.
   */
  const { groups, rows, empty } = useMemo((): { groups: Group[]; rows: Match[]; empty: boolean } => {
    const plain = (c: Command): Match => ({ command: c, score: 0, ranges: [] })
    if (step?.kind === 'text') {
      const text = query.trim()
      const why = step.validate?.(text) ?? null
      const row: Match = plain({
        id: 'step:text', kind: 'command', title: step.describe(text), icon: Commit,
        ...(why !== null ? { unavailable: why } : step.rule !== undefined ? { detail: `${step.rule} · it is` } : {}),
        run: () => step.run(text),
      })
      return { groups: [{ kind: 'command', label: step.label, matches: [row] }], rows: [row], empty: false }
    }
    if (step?.kind === 'choose') {
      const found = search(step.options(), query, { limit: 200 })
      const g: Group = { kind: 'command', label: step.label, ...(step.note !== undefined ? { note: step.note } : {}), matches: found }
      return { groups: found.length > 0 ? [g] : [], rows: found, empty: found.length === 0 }
    }
    if (mode === 'help') {
      const found: Match[] = PREFIXES.map((p) => plain({
        id: `prefix:${p.key}`, kind: 'command', title: p.label,
        ...(p.example !== undefined ? { detail: p.example } : {}),
        shortcut: p.key, stay: true,
        run: () => { setQuery(p.key === '?' ? '' : p.key) },
      }))
      return { groups: [{ kind: 'command', label: 'Prefixes', note: 'type one, then keep typing', matches: found }], rows: found, empty: false }
    }
    if (mode === 'page-number') {
      const n = Number.parseInt(parsed.query.trim(), 10)
      if (!Number.isFinite(n)) {
        return { groups: [{ kind: 'page', label: 'Go to page', note: `1 to ${pageCount}`, matches: [] }], rows: [], empty: false }
      }
      const hit = commands.find((c) => c.page === n - 1)
      const row: Match = hit !== undefined
        ? plain({ ...hit, title: `Page ${n} · ${hit.title}` })
        : plain({
          id: `page:${n}`, kind: 'page', title: `Page ${n}`,
          detail: pageCount === 0 ? 'no drawing open' : `the set has ${pageCount} page${pageCount === 1 ? '' : 's'}`,
          unavailable: pageCount === 0 ? 'no drawing' : 'out of range', run: () => {},
        })
      return { groups: [{ kind: 'page', label: 'Go to page', matches: [row] }], rows: [row], empty: false }
    }
    const pool = narrow(commands, mode)
    if (!typed) {
      /*
       * Untyped: what fits here, then what you ran last. Nothing that cannot
       * run, nothing that only appears when typed for, and no catalogue. When
       * there is neither, the kinds are listed so the field is not empty.
       */
      const ready = (c: Command) => c.unavailable === undefined
      const out: Group[] = []
      if (mode === 'all') {
        const suggested = pool.filter((c) => c.suggest !== undefined && ready(c)).map(plain)
        if (suggested.length > 0) out.push({ kind: 'suggest', label: context === undefined ? 'Suggested' : `On ${context}`, matches: suggested })
        const byId = new Map(pool.map((c) => [c.id, c]))
        const last = recent.map((id) => byId.get(id)).filter((c): c is Command => c !== undefined && ready(c) && c.suggest === undefined).map(plain)
        if (last.length > 0) out.push({ kind: 'recent', label: 'Recent', matches: last })
      }
      if (out.length === 0) {
        const found = search(pool.filter(ready), '', { limit: 60 })
        out.push(...groupMatches(found))
      }
      const flat = out.flatMap((g) => g.matches)
      return { groups: out, rows: flat, empty: false }
    }
    const found = search(pool, parsed.query, { limit: 500 })
    // The best hit's kind leads, so Enter lands on what was typed for.
    const lead = found[0]?.command.kind
    const grouped = groupMatches(found, [], lead)
    const capped = grouped.map((g) => (g.matches.length > PER_GROUP
      ? { ...g, note: `${PER_GROUP} of ${g.matches.length} · keep typing`, matches: g.matches.slice(0, PER_GROUP) }
      : g))
    if (onSearchText !== undefined && mode === 'all') {
      capped.push({
        kind: 'search', label: 'Search', matches: [plain({
          id: 'search:text', kind: 'command', title: `Search the sheets for “${parsed.query.trim()}”`,
          detail: 'full text, every page', icon: SearchText, shortcut: 'Ctrl ↵',
          run: () => { onSearchText(parsed.query.trim()) },
        })],
      })
    }
    const flat = capped.flatMap((g) => g.matches)
    return { groups: capped, rows: flat, empty: found.length === 0 }
  }, [commands, query, parsed, mode, step, typed, recent, pageCount, context, onSearchText])

  // `start` is each group's offset into the flat keyboard list.
  const offsets = useMemo(() => {
    let offset = 0
    return groups.map((g) => { const start = offset; offset += g.matches.length; return start })
  }, [groups])

  // Clamped rather than corrected in an effect: `commands` can shrink under us.
  const index = Math.min(active, Math.max(0, rows.length - 1))
  const armed = rows[index]?.command
  const optionId = (at: number): string => `${base}-option-${at}`
  const listId = `${base}-results`

  useEffect(() => { inputRef.current?.focus() }, [taken])
  useEffect(() => { setActive(0); setRefusal(null); setActionsOpen(false) }, [query, taken])
  useEffect(() => {
    document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' })
  }, [index, base, rows.length])

  /** What Tab offers on the armed row: its primary, its other way, and everything a noun's hub lists. */
  const actions = useMemo((): Action[] => {
    if (armed === undefined || armed.unavailable !== undefined) return []
    const out: Action[] = []
    const noun = armed.kind !== 'command'
    if (noun && armed.alt !== undefined) out.push({ id: 'primary', title: armed.alt.label, icon: Open, key: '↵', run: armed.alt.run })
    else if (!noun && armed.alt !== undefined) out.push({ id: 'alt', title: armed.alt.label, icon: WindowNew, key: 'Shift ↵', run: armed.alt.run })
    if (noun && armed.step?.kind === 'choose') {
      for (const c of armed.step.options()) {
        if (c.unavailable !== undefined) continue
        // The hub's own "open" is the primary already listed.
        if (armed.alt !== undefined && c.title.replace(/…$/, '') === armed.alt.label) continue
        out.push({ id: c.id, title: c.title.replace(/…$/, ''), ...(c.detail !== undefined ? { detail: c.detail } : {}), icon: iconFor(c), ...(c.color !== undefined ? { color: c.color } : {}), command: c })
      }
    }
    return out
  }, [armed])

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
   * Run a row. A noun with an "open" opens on Enter — its actions are Tab's.
   * A command with a step advances into it. A refusal from the store is shown
   * and the palette stays. A toggle stays.
   */
  const choose = async (row: Match | undefined, opts: { close?: boolean; alt?: boolean; hub?: boolean } = {}): Promise<void> => {
    if (row === undefined) return
    const c = row.command
    if (c.unavailable !== undefined) return
    if (opts.alt && c.alt !== undefined) { c.alt.run(); onClose(); return }
    const noun = c.kind !== 'command'
    if (noun && c.alt !== undefined && !opts.hub) { c.alt.run(); onClose(); return }
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
    if (!c.id.startsWith('step:') && !c.id.startsWith('prefix:') && !c.id.startsWith('page:') && !c.id.startsWith('search:')) setRecent(pushRecent(c.id))
    if (c.stay && !opts.close) {
      // The row updates in place — the caller rebuilds `commands` — and the
      // field keeps what was typed so the next Enter flips the next thing.
      return
    }
    onClose()
  }

  /** An action from the panel: a command runs or enters its step; a plain run runs and closes. */
  const act = async (a: Action | undefined): Promise<void> => {
    if (a === undefined) return
    setActionsOpen(false)
    if (a.command !== undefined) {
      if (a.command.step !== undefined) {
        // The noun's chip first, then the verb's: "SF02 › Rename".
        if (armed !== undefined) setTaken((t) => [...t, { label: armed.title, step: armed.step! }])
        enter(a.command, a.title)
        return
      }
      await choose({ command: a.command, score: 0, ranges: [] })
      return
    }
    if (a.run !== undefined) { await a.run(); onClose() }
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (actionsOpen) {
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); setActionsOpen(false); return }
      if (event.key === 'ArrowDown') { event.preventDefault(); setActionAt((n) => (n + 1) % Math.max(1, actions.length)); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActionAt((n) => (n + actions.length - 1) % Math.max(1, actions.length)); return }
      if (event.key === 'Enter') { event.preventDefault(); void act(actions[actionAt]); return }
      return
    }
    if (filterOpen) {
      if (event.key === 'Escape') { event.preventDefault(); setFilterOpen(false); return }
    }
    if (event.key === 'Escape') {
      // Escape CANCELS: the whole palette, steps and all. One press, out.
      // Backspace on an empty field is the way back a step.
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'Backspace' && query === '' && taken.length > 0) { event.preventDefault(); back(); return }
    if (event.key === 'Tab') {
      event.preventDefault()
      if (actions.length > 0) { setActionAt(0); setActionsOpen(true) }
      return
    }
    if (rows.length === 0) return
    // Wrapping, because the fastest way to the last row of a short list is up.
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((at) => (Math.min(at, rows.length - 1) + 1) % rows.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((at) => (Math.min(at, rows.length - 1) + rows.length - 1) % rows.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (event.ctrlKey && onSearchText !== undefined && typed && step === undefined) { onSearchText(parsed.query.trim()); onClose(); return }
      void choose(rows[index], { close: event.ctrlKey, alt: event.shiftKey })
    }
  }

  /* Inside a step, the step's verb stands for its choices: the presets under "Set scale" all wear the ruler. */
  const stepIcon: Icon | undefined = step === undefined
    ? undefined
    : (iconFor({ id: '', kind: 'command', title: taken[0]?.label ?? '' }, Search) ?? Search)
  const placeholder = step?.kind === 'text'
    ? step.placeholder
    : step?.kind === 'choose' ? `Choose · ${step.label}` : 'Search commands, sheets, scopes…'
  const filterLabel = FILTERS.find((f) => f.mode === mode)?.label ?? 'All'
  const enterLabel = step?.kind === 'text' ? step.label
    : step?.kind === 'choose' ? 'Choose'
      : armed === undefined ? 'Open'
        : armed.kind !== 'command' && armed.alt !== undefined ? 'Open'
          : armed.step !== undefined ? 'Next' : 'Run'
  const count = typed && step === undefined && mode !== 'help' && mode !== 'page-number'
    ? rows.filter((r) => !r.command.id.startsWith('search:')).length
    : null

  return (
    <div
      className="palette-scrim"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
      onKeyDown={onKeyDown}
    >
      <div className="palette-panel" role="dialog" aria-modal="true" aria-label="Command prompt" ref={trap}>
        <div className="pp-field">
          <Glyph icon={stepIcon ?? Search} role="card" />
          {/* What has been chosen so far, as chips; the last is the step now open. */}
          {taken.map((t, i) => (
            <span key={i} className={`pp-chip${i === taken.length - 1 ? ' current' : ''}`}>{t.label}</span>
          ))}
          <input
            ref={inputRef}
            className="pp-input"
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
          {step === undefined && (
            <span className="pp-filterwrap">
              <button
                type="button"
                className="pp-filter"
                aria-haspopup="listbox"
                aria-expanded={filterOpen}
                title="Show only one kind"
                onClick={() => setFilterOpen((v) => !v)}
              >
                {filterLabel}<Glyph icon={ChevronDown} role="small" />
              </button>
              {filterOpen && (
                <div className="pp-filtermenu" role="listbox" aria-label="Show only">
                  {FILTERS.map((f) => (
                    <button
                      key={f.mode}
                      type="button"
                      role="option"
                      aria-selected={f.mode === mode}
                      className="pp-filteritem"
                      onClick={() => {
                        setFilter(f.mode)
                        // A typed prefix would override the control; drop it.
                        if (parsed.mode !== 'all') setQuery(parsed.query)
                        setFilterOpen(false)
                        inputRef.current?.focus()
                      }}
                    >{f.label}</button>
                  ))}
                </div>
              )}
            </span>
          )}
          {step?.kind === 'choose' && <span className="pp-stepnote">{step.label}</span>}
        </div>

        {step?.kind === 'choose' && step.warn !== undefined && (
          <div className="pp-warn" role="status">
            <Glyph icon={TriangleAlert} role="row" />
            <span>{step.warn}</span>
          </div>
        )}

        {refusal !== null && (
          <div className="pp-refusal" role="alert">
            <Glyph icon={X} role="row" />
            <span className="grow">{refusal.reason}</span>
          </div>
        )}
        {refusal?.alternative !== undefined && (
          <div className="pp-list" role="listbox" aria-label="Instead">
            <div className="pp-group"><span>Instead</span></div>
            <Row
              id={`${base}-alt`}
              match={{ command: refusal.alternative, score: 0, ranges: [] }}
              armed={false}
              typed={typed}
              onArm={() => {}}
              onChoose={() => { const alt = refusal.alternative; if (alt !== undefined) void choose({ command: alt, score: 0, ranges: [] }) }}
            />
          </div>
        )}

        {empty && rows.length === 0 ? (
          <div className="pp-empty">
            <p className="pp-emptyline">Nothing matches “{parsed.query.trim()}”.</p>
          </div>
        ) : (
          <div className="pp-list" id={listId} role="listbox" aria-label="Results">
            {groups.map((group, gi) => (
              <div key={`${group.kind}:${group.label}`} role="group" aria-label={group.label}>
                <div className="pp-group">
                  <span>{group.label}</span>
                  {group.note !== undefined && <span className="pp-groupnote">{group.note}</span>}
                </div>
                {group.matches.map((match, n) => {
                  const here = (offsets[gi] ?? 0) + n
                  return (
                    <Row
                      key={`${match.command.id}:${n}`}
                      id={optionId(here)}
                      match={match}
                      armed={here === index}
                      typed={typed}
                      {...(stepIcon !== undefined ? { stepIcon } : {})}
                      onArm={() => setActive(here)}
                      onChoose={() => void choose(match)}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {actionsOpen && armed !== undefined && (
          <div className="pp-actions" role="menu" aria-label={`${armed.title} actions`}>
            <div className="pp-actionshead">
              {armed.color !== undefined && <span className="pp-dot" style={{ background: armed.color }} />}
              <b>{armed.title}</b>
              {armed.detail !== undefined && <span>{armed.detail.split(' · ')[0]}</span>}
            </div>
            {actions.map((a, i) => (
              <button
                key={a.id}
                type="button"
                role="menuitem"
                className={`pp-action${i === actionAt ? ' armed' : ''}${/^(delete|remove)/i.test(a.title) ? ' danger' : ''}`}
                onMouseEnter={() => setActionAt(i)}
                onClick={() => void act(a)}
              >
                {a.icon === null
                  ? <span className="pp-dot" style={{ background: a.color ?? 'currentColor' }} />
                  : <Glyph icon={a.icon} role="inline" />}
                <span className="grow">{a.title}</span>
                {a.key !== undefined && <kbd>{a.key}</kbd>}
                {a.key === undefined && a.command?.step !== undefined && <Glyph icon={ChevronRight} role="small" />}
              </button>
            ))}
          </div>
        )}

        {/* The keys, stated once at the foot, for the state the palette is in. */}
        <div className="pp-foot" aria-hidden="true">
          <span className="pp-brand"><span className="pp-mark">RB</span>{count !== null ? `${count} result${count === 1 ? '' : 's'}` : (context ?? 'REDBEAM')}</span>
          <span className="grow" />
          {step?.kind === 'text'
            ? <><span className="pp-key">{enterLabel} <kbd>↵</kbd></span><span className="pp-key">Back <kbd>⌫</kbd></span></>
            : step?.kind === 'choose'
              ? <><span className="pp-key">Choose <kbd>↵</kbd></span><span className="pp-key">Back <kbd>⌫</kbd></span></>
              : <>
                <span className="pp-key">{enterLabel} <kbd>↵</kbd></span>
                {actions.length > 0 && <span className="pp-key">Actions <kbd>Tab</kbd></span>}
              </>}
        </div>
      </div>
    </div>
  )
}

function Row({
  id, match, armed, typed, stepIcon, onArm, onChoose,
}: {
  id: string
  match: Match
  armed: boolean
  typed: boolean
  /** Inside a step: the step's own glyph stands for its choices, and the type tag is dropped. */
  stepIcon?: Icon
  onArm: () => void
  onChoose: () => void
}) {
  const c = match.command
  const stuck = c.unavailable
  const icon = iconFor(c, stepIcon ?? ChevronRight)
  const sub = stuck !== undefined ? stuck : c.suggest !== undefined && !typed ? c.suggest : c.detail
  const tagless = stepIcon !== undefined || c.id.startsWith('search:') || c.id.startsWith('step:') || c.id.startsWith('prefix:')
  return (
    <div
      id={id}
      className={`pp-row${armed ? ' armed' : ''}${stuck !== undefined ? ' off' : ''}`}
      role="option"
      aria-selected={armed}
      aria-disabled={stuck !== undefined}
      onMouseEnter={onArm}
      onClick={onChoose}
    >
      {icon === null
        ? <span className="pp-dot" style={{ background: c.color ?? 'var(--rb-ink-3)' }} aria-hidden="true" />
        : <Glyph icon={icon} role="card" />}
      <span className="pp-text">
        <span className="pp-title"><Marked text={c.title} ranges={match.ranges} /></span>
        {sub !== undefined && <span className="pp-sub">{sub}</span>}
      </span>
      <span className="pp-right">
        {tagless ? null : <span className="pp-kind">{KIND_LABEL[c.kind]}</span>}
        {c.shortcut !== undefined && c.shortcut.split(/\s+/).map((k, i) => <kbd key={i}>{k}</kbd>)}
      </span>
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
