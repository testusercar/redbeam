/**
 * The command palette.
 *
 * Presentation only — every ranking decision is in `commands.ts`, and every
 * action is a `run` the caller supplied. This file owns three things: the
 * keyboard model, the ARIA wiring, and the highlight.
 *
 * The one structural decision worth stating: results are GROUPED for reading
 * but FLAT for the keyboard. Arrow keys walk one list that ignores the group
 * headings (project-window spec §12 groups by kind; nothing says the kicker is
 * a stop), so the highlight is an index into `rows`, never into a group.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import {
  Bookmark, Calculator, ChevronRight, FileText, Folder, Glyph, Pentagon, Search,
} from '../shell/icons.js'
import type { LucideIcon } from 'lucide-react'
import { groupMatches, search } from './commands.js'
import type { Command, CommandKind, Match } from './commands.js'
import './palette.css'
import { useReturnFocus } from '../returnFocus.js'
import { useFocusTrap } from '../shell/focusTrap.js'

/*
 * One glyph per kind, and each is the glyph the rest of the shell already
 * uses for that thing — the rail's Bookmark for the sheet index, the tab
 * strip's FileText, the title menu's Folder — so a row is recognisable
 * before it is read. Commands get the one glyph that means "do", not "go".
 */
const KIND_ICON: Record<CommandKind, LucideIcon> = {
  command: ChevronRight,
  scope: Pentagon,
  estimate: Calculator,
  document: FileText,
  page: Bookmark,
  project: Folder,
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  // Mounted only while open, so mount/unmount IS open/closed.
  useReturnFocus(true)
  const trap = useFocusTrap<HTMLDivElement>(true)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const base = useId()

  // `start` is each group's offset into the flat keyboard list, worked out once
  // here so the render does not have to keep a running counter as it nests.
  const groups = useMemo(() => {
    let offset = 0
    return groupMatches(search(commands, query)).map((group) => {
      const start = offset
      offset += group.matches.length
      return { ...group, start }
    })
  }, [commands, query])
  const rows = useMemo(() => groups.flatMap((group) => group.matches), [groups])
  // Clamped rather than corrected in an effect: `commands` can shrink under us
  // while a task finishes, and a highlight pointing past the end for one frame
  // is a crash in `rows[active]`, not a cosmetic glitch.
  const index = Math.min(active, Math.max(0, rows.length - 1))

  const optionId = (at: number): string => `${base}-option-${at}`
  const listId = `${base}-results`

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setActive(0) }, [query])
  // `nearest`, so arrowing through a group that is already on screen does not
  // yank the list to re-centre a row the user can see perfectly well.
  useEffect(() => {
    document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' })
  }, [index, base, rows.length])

  const choose = (row: Match | undefined): void => {
    if (row === undefined) return
    // A row that says why it cannot run keeps the palette open, so the reason
    // stays on screen. Closing would turn "folder not found" into "nothing
    // happened".
    if (row.command.unavailable !== undefined) return
    // The palette closes either way. A command needing more information opens
    // its own popover or dialog from inside `run` (commands spec §4.5) — the
    // palette is not the place to host it, and never bypasses a confirmation.
    row.command.run()
    onClose()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
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
      choose(rows[index])
    }
  }

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
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={rows.length > 0 ? optionId(index) : undefined}
            placeholder="Search commands, sheets, scopes and projects"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {rows.length === 0 ? (
          <p className="palette-empty">Nothing matches “{query}”.</p>
        ) : (
          <div className="palette-list" id={listId} role="listbox" aria-label="Results">
            {groups.map((group) => (
              <div className="palette-group" key={group.kind} role="group" aria-label={group.label}>
                <div className="palette-kicker">
                  <span>{group.label}</span>
                  {group.note !== undefined && <span className="palette-note">{group.note}</span>}
                </div>
                {group.matches.map((match, n) => {
                  const here = group.start + n
                  const stuck = match.command.unavailable
                  return (
                    <div
                      key={match.command.id}
                      id={optionId(here)}
                      className={`palette-row${stuck !== undefined ? ' unavailable' : ''}`}
                      role="option"
                      aria-selected={here === index}
                      aria-disabled={stuck !== undefined}
                      onMouseEnter={() => setActive(here)}
                      onClick={() => choose(match)}
                    >
                      <Glyph icon={KIND_ICON[match.command.kind]} role="row" />
                      <span className="palette-text">
                        <span className="palette-title">
                          <Marked text={match.command.title} ranges={match.ranges} />
                        </span>
                        {match.command.detail !== undefined && (
                          <span className="palette-detail">{match.command.detail}</span>
                        )}
                      </span>
                      {stuck !== undefined && <span className="palette-why">{stuck}</span>}
                      {match.command.shortcut !== undefined && (
                        <kbd className="palette-key">{match.command.shortcut}</kbd>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {/*
          The keys, stated once at the foot. A palette is used by people who
          already know them and, on the first day, by people who do not; a line
          this size costs the first group nothing.
        */}
        <div className="palette-foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}

/**
 * The matched characters, marked.
 *
 * Ranges are half-open and already merged into runs by the matcher, so this
 * only has to walk them — a keyword-only hit arrives with none, which is
 * correct: nothing the user typed is in the title to point at.
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
