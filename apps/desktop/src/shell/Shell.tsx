/**
 * The application shell — titlebar, icon rail, and the left pane frame.
 *
 * Built to aaron-design-system archetype D (productivity app), with the Qt
 * build's proportions where the two disagree. The one that mattered: Okular
 * puts the app mark, the project, and the document tabs in ONE 40px row. The
 * v2 design study split them into two 40px rows, and on a landscape drawing
 * that second row costs the axis there is least of. One row won.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Bookmark, ChevronDown, Ellipsis, ExternalLink, FileText, Files, Folder, Glyph,
  Grid2x2, PanelRight, Search, Settings2, X, Plus, ExternalLink as PopOut,
  SlidersHorizontal, Info,
} from './icons.js'
import type { Icon } from './icons.js'
import {
  buildFileTree, filterFileTree, treeFiles, treeFolderPaths, treeRows, type TreeFolder,
} from './fileTree.js'


/**
 * A project path as "the folders above" and "the folder itself", so the row
 * can shrink the first and keep the second whole. A path with no separator
 * is all tail.
 */
export function splitProjectPath(path: string): { head: string; tail: string } {
  const trimmed = path.replace(/[\\/]+$/, '')
  const at = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (at < 0) return { head: '', tail: trimmed }
  return { head: trimmed.slice(0, at + 1), tail: trimmed.slice(at + 1) }
}

// ------------------------------------------------------------------ menus --

/**
 * Close on Escape or a click outside.
 *
 * Both, because either alone is a trap: Escape alone strands a menu when the
 * pointer has already moved on, and outside-click alone strands it for anyone
 * driving from the keyboard.
 */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onDown = (e: PointerEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [open, close])
  return ref
}

/** What the app menu can do. Anything absent is not rendered — no dead rows. */
export interface AppMenuActions {
  onOpenProject?: () => void
  onOpenDrawing?: () => void
  onContextWindow?: () => void
  onPalette?: () => void
  onSettings?: () => void
  onCloseProject?: () => void
}

/** One entry in the project switcher. Structurally a `RecentProject`. */
export interface ProjectMenuEntry {
  path: string
  name: string
  missing?: boolean
}

export interface ProjectMenuProps {
  /** Path of the project this window is showing. */
  currentPath?: string
  recents: ProjectMenuEntry[]
  /**
   * Open a project. A project IS a window, so this opens a SECOND window and
   * leaves this one alone — see the note on the switcher below.
   */
  onOpen: (path: string) => void
  onBrowse?: () => void
}

// -------------------------------------------------------- window controls --

/**
 * Minimize, maximize and close, far right — the window's own controls, drawn
 * by the app because the app draws its own title bar.
 *
 * The native frame is off (`decorations: false`), which is what removes the
 * second 40px strip above the app's own bar. That second strip was the "two
 * layers of nav" rejected in the first design round and it had quietly come
 * back as the OS chrome.
 *
 * Rendered fixed rather than inside the title bar, because the start screen has
 * no title bar and a frameless window still has to be closable from it. The
 * shell reserves the width with `data-frameless` so nothing lands underneath.
 *
 * Deliberately NOT styled like the rest of the product: 46px cells, hairline
 * glyphs, and the close button reddening on hover. These are OS furniture and
 * every user already knows what they do and where they are; making them look
 * like REDBEAM buttons would be the one place originality costs something.
 */
export function WindowControls({
  maximized, onMinimize, onToggleMaximize, onClose,
}: {
  maximized: boolean
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}) {
  return (
    <div className="wincontrols" role="group" aria-label="Window">
      <button className="wcbtn" title="Minimize" aria-label="Minimize" onClick={onMinimize}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <button
        className="wcbtn"
        title={maximized ? 'Restore' : 'Maximize'}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={onToggleMaximize}
      >
        {maximized
          ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
              <rect x="4" y="7" width="13" height="13" rx="1.5" />
              <path d="M8 4h11a1.5 1.5 0 0 1 1.5 1.5V16" />
            </svg>
            )
          : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="1.5" />
            </svg>
            )}
      </button>
      <button className="wcbtn close" title="Close" aria-label="Close" onClick={onClose}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
      </button>
    </div>
  )
}

// ------------------------------------------------------------- title bar --

export function TitleBar({
  projectName, appMenu, projectMenu, children, workOpen, onToggleWork,
}: {
  projectName: string
  appMenu?: AppMenuActions
  projectMenu?: ProjectMenuProps
  children?: ReactNode
  workOpen: boolean
  onToggleWork: () => void
}) {
  const [appOpen, setAppOpen] = useState(false)
  const [projOpen, setProjOpen] = useState(false)
  const appRef = useDismiss(appOpen, () => setAppOpen(false))
  const projRef = useDismiss(projOpen, () => setProjOpen(false))

  const item = (
    label: string,
    icon: ReactNode,
    run: (() => void) | undefined,
    hint?: string,
  ) =>
    run === undefined ? null : (
      <button className="menuitem" role="menuitem" onClick={() => { setAppOpen(false); run() }}>
        {icon}
        <span className="grow">{label}</span>
        {hint !== undefined && <span className="hint">{hint}</span>}
      </button>
    )

  return (
    /*
     * The bar AND the tab strip are drag regions.
     *
     * Tauri only drags when the pointer went down on the element carrying the
     * attribute, so tabs, menus and buttons keep working. The bar alone was not
     * enough: the strip is `flex: 1` and covers every pixel the bar would
     * otherwise expose, so there was nothing left to grab and the window could
     * not be moved at all. The strip's own empty space is the surface a person
     * actually aims at.
     */
    <header className="titlebar" data-tauri-drag-region>
      {/*
        The mark sits in its own divided cell, as the Title Bar frame draws it —
        and it is the app menu, which is the one thing every desktop app puts
        behind its icon and this one used to render as decoration.
      */}
      <div className="titlelead">
      <div className="titlecell" ref={appRef}>
        <button
          className="brand"
          aria-haspopup="menu"
          aria-expanded={appOpen}
          title="Application menu"
          aria-label="Application menu"
          onClick={() => setAppOpen((v) => !v)}
          disabled={appMenu === undefined}
        >RB</button>
        {appOpen && appMenu !== undefined && (
          <div className="titlemenu" role="menu" aria-label="Application">
            {item('Open project…', <Glyph icon={Folder} role="row" />, appMenu.onOpenProject, 'Ctrl+O')}
            {item('Add drawing…', <Glyph icon={FileText} role="row" />, appMenu.onOpenDrawing)}
            {item('New context window', <Glyph icon={PopOut} role="row" />, appMenu.onContextWindow)}
            <div className="menusep" />
            {item('Command palette', <Glyph icon={Search} role="row" />, appMenu.onPalette, 'Ctrl+K')}
            {item('Settings', <Glyph icon={SlidersHorizontal} role="row" />, appMenu.onSettings, 'Ctrl+,')}
            <div className="menusep" />
            {item('Close project', <Glyph icon={X} role="row" />, appMenu.onCloseProject)}
          </div>
        )}
      </div>

      <div className="projectcell" ref={projRef}>
        <button
          className="projectpick"
          aria-haspopup="menu"
          aria-expanded={projOpen}
          title="Switch project"
          onClick={() => setProjOpen((v) => !v)}
          disabled={projectMenu === undefined}
        >
          <Glyph icon={Folder} role="inline" />
          <span className="projectname">{projectName}</span>
          <Glyph icon={ChevronDown} role="small" />
        </button>
        {projOpen && projectMenu !== undefined && (
          <ProjectMenu {...projectMenu} onDone={() => setProjOpen(false)} />
        )}
      </div>
      </div>

      {/*
        The tabs and the panel toggle share one cell spanning the drawing and
        the estimates columns. The bar is a SUBGRID of the shell (see
        `.titlebar`): the mark and the project switcher share the FIRST column,
        which is the sidebar's — so the switcher is exactly as wide as the
        panel beneath it — and everything else is this cell. Without the
        wrapper the tabs and the toggle would each claim a column of their own.
      */}
      <div className="titlemain" data-tauri-drag-region>
        {children}

        <button
          className="titleicon paneltoggle"
          aria-pressed={workOpen}
          title={workOpen ? 'Hide the estimate panel' : 'Show the estimate panel'}
          aria-label={workOpen ? 'Hide the estimate panel' : 'Show the estimate panel'}
          onClick={onToggleWork}
        >
          <Glyph icon={PanelRight} role="inline" />
        </button>
      </div>
    </header>
  )
}

/**
 * The project switcher.
 *
 * This control used to be wired straight to Close Project: clicking the name of
 * the project you were working on threw it away and dropped you on the start
 * screen. It looked like a dropdown and behaved like a destructive action.
 *
 * Choosing a project here opens a SECOND WINDOW and leaves this one exactly as
 * it was. That is the window model, not a nicety: a window is a project — its
 * database, its undo stack and every id in the workspace belong to it — so
 * "switch" would mean tearing all of that down. An estimator comparing two bid
 * packages wants both on screen, which is what two windows are for.
 */
function ProjectMenu({
  currentPath, recents, onOpen, onBrowse, onDone,
}: ProjectMenuProps & { onDone: () => void }) {
  const others = recents.filter((r) => r.path !== currentPath)
  return (
    <div className="titlemenu projectmenu" role="menu" aria-label="Projects">
      {others.length === 0 && (
        <div className="menuhead">No other projects yet</div>
      )}
      {others.length > 0 && <div className="menuhead">Recent</div>}
      {others.map((r) => (
        <button
          key={r.path}
          className={`menuitem${r.missing === true ? ' missing' : ''}`}
          role="menuitem"
          disabled={r.missing === true}
          title={r.missing === true ? `${r.path} — folder not found` : r.path}
          onClick={() => { onDone(); onOpen(r.path) }}
        >
          <Glyph icon={Folder} role="row" />
          <span className="grow projectrow">
            <span className="projectrowname">{r.name}</span>
            <span className="projectrowpath">
              {/* The project folder never truncates; the folders above it do. */}
              <span className="projectrowhead">{splitProjectPath(r.path).head}</span>
              <span className="projectrowtail">{splitProjectPath(r.path).tail}</span>
            </span>
          </span>
          {/* Said, not only dimmed: a folder on an offline drive is a fact
              about the entry, and a greyed row alone reads as "disabled". */}
          {r.missing === true && <span className="hint">not found</span>}
        </button>
      ))}
      {onBrowse !== undefined && (
        <>
          <div className="menusep" />
          <button className="menuitem" role="menuitem" onClick={() => { onDone(); onBrowse() }}>
            <Glyph icon={Plus} role="row" />
            <span className="grow">Open another project…</span>
          </button>
        </>
      )}
      <div className="menunote">
        <Glyph icon={Info} role="row" />
        <span>Opens a second window. This one stays as it is.</span>
      </div>
    </div>
  )
}

// --------------------------------------------------------- document tabs --

export interface ShellTab {
  id: string
  name: string
  relativePath: string
  missing?: boolean
}

export function DocumentTabStrip({
  tabs, activeId, onSelect, onClose, onBrowse, onPopOut,
}: {
  tabs: ShellTab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose?: (id: string) => void
  onBrowse: () => void
  /** Open this document in a context window — a second view, side by side. */
  onPopOut?: (id: string) => void
}) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  /*
   * The tab menu is FIXED to where the pointer was, not absolute inside the
   * tab: the strip clips its overflow — that is what keeps tabs from spilling
   * past the window — so a menu positioned inside a tab would be cut off at the
   * strip's edge, which for the last tab is most of the menu.
   */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const menuRef = useDismiss(menu !== null, () => setMenu(null))
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [fits, setFits] = useState(tabs.length)

  /*
   * How many tabs fit at their natural width.
   *
   * The comps are explicit that "overflow preserves label width" — tabs do not
   * compress to fit, they move into a `+N` menu. A shrinking tab strip makes
   * every filename unreadable at exactly the moment there are enough documents
   * open to need reading.
   *
   * THE MEASUREMENT IS A RATCHET IF IT READS THE RENDERED STRIP. This used to
   * sum `offsetWidth` over the strip's children — but the children ARE the
   * truncated set, so once `fits` dropped to 1 the loop only ever saw one tab
   * again and could never count its way back up. One unlucky measurement (the
   * first, before fonts load and while `clientWidth` is still 0) pinned the
   * strip at a single tab plus an overflow menu, on a bar with 900px to spare,
   * for the rest of the session. That is the bug behind "why does only one tab
   * show".
   *
   * So every tab stays mounted and the overflowing ones are tucked out of flow
   * — still laid out, still measurable, just not visible. The count is then
   * derived from the full set every time and can go back up.
   */
  useEffect(() => {
    const el = stripRef.current
    if (el === null) return
    const measure = () => {
      const all = [...el.querySelectorAll<HTMLElement>('[data-tab]')]
      if (all.length === 0) return
      // Space for the `+N` button is only reserved when there is something to
      // put in it; reserving it unconditionally cost a tab at every width.
      const reserve = ADD_W + (all.length > 1 ? OVERFLOW_W : 0)
      const budget = el.clientWidth - reserve
      let used = 0
      let n = 0
      for (const c of all) {
        used += c.offsetWidth
        if (used > budget && n > 0) break
        n++
      }
      setFits(Math.max(1, Math.min(all.length, n)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // Fonts land after first paint and change every tab's width. Without this
    // the strip is sized against fallback metrics and never re-measured.
    void document.fonts?.ready.then(measure).catch(() => {})
    return () => ro.disconnect()
  }, [tabs.length])

  const hidden = tabs.slice(fits)

  const tab = (t: ShellTab, index: number) => (
    <div
      key={t.id}
      data-tab=""
      role="tab"
      aria-selected={t.id === activeId}
      aria-hidden={index >= fits}
      className={
        `tab${t.id === activeId ? ' active' : ''}` +
        `${t.missing === true ? ' missing' : ''}` +
        // Tucked, not unmounted: it keeps its layout width so the count above
        // can grow back when the window widens.
        `${index >= fits ? ' tucked' : ''}`
      }
      title={t.missing === true ? `${t.relativePath} — file not found` : t.relativePath}
      onClick={() => onSelect(t.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        setMenu({ id: t.id, x: r.left, y: r.bottom })
      }}
    >
      <Glyph icon={FileText} role="inline" />
      <span className="tabname">{t.name}</span>
      {onClose && (
        <button
          className="tabclose"
          aria-label={`Close ${t.name}`}
          onClick={(e) => { e.stopPropagation(); onClose(t.id) }}
        ><Glyph icon={X} role="small" /></button>
      )}
    </div>
  )

  const menuTab = menu === null ? null : tabs.find((t) => t.id === menu.id) ?? null

  return (
    <>
    {menu !== null && menuTab !== null && (
      <div
        className="titlemenu tabctx"
        role="menu"
        aria-label={menuTab.name}
        ref={menuRef}
        style={{ left: menu.x, top: menu.y }}
      >
        {onPopOut !== undefined && (
          <button
            className="menuitem"
            role="menuitem"
            onClick={() => { setMenu(null); onPopOut(menuTab.id) }}
          >
            <Glyph icon={PopOut} role="row" />
            <span className="grow">Pop out to context window</span>
          </button>
        )}
        {onClose !== undefined && (
          <button
            className="menuitem"
            role="menuitem"
            onClick={() => { setMenu(null); onClose(menuTab.id) }}
          >
            <Glyph icon={X} role="row" />
            <span className="grow">Close</span>
            <span className="hint">Ctrl+W</span>
          </button>
        )}
      </div>
    )}
    <div className="tabstrip" role="tablist" ref={stripRef} data-tauri-drag-region>
      {tabs.map(tab)}

      {hidden.length > 0 && (
        <div className="taboverflow">
          <button
            className="tabmore"
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            title={`${hidden.length} more document${hidden.length === 1 ? '' : 's'}`}
            onClick={() => setOverflowOpen((v) => !v)}
          >
            <Glyph icon={Ellipsis} role="inline" />
            <span>+{hidden.length}</span>
          </button>
          {overflowOpen && (
            <>
              <div className="menuveil" onClick={() => setOverflowOpen(false)} />
              <div className="tabmenu" role="menu">
                {hidden.map((t) => (
                  <div key={t.id} className="tabmenurow">
                    <button
                      className="grow"
                      onClick={() => { onSelect(t.id); setOverflowOpen(false) }}
                    >
                      <Glyph icon={FileText} role="inline" />
                      <span className="tabname">{t.name}</span>
                    </button>
                    {onClose && (
                      <button
                        className="tabclose"
                        aria-label={`Close ${t.name}`}
                        onClick={() => onClose(t.id)}
                      ><Glyph icon={X} role="small" /></button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <button className="titleicon tabadd" onClick={onBrowse} title="Open another document" aria-label="Open another document">
        <Glyph icon={Plus} role="inline" />
      </button>
    </div>
    </>
  )
}

/** Width reserved for the `+N` control when measuring what fits. */
const OVERFLOW_W = 72
/** Width of the always-present "open another document" button. */
const ADD_W = 48

// ---------------------------------------------------------------- rail --

/**
 * Rail panels — four, in the comps' order.
 *
 * `contents` is deliberately singular. The Qt build shipped Contents and
 * Bookmarks as separate tabs because Okular did, and they are the same thing
 * wearing two names: some PDFs express a drawing index as an outline, others
 * as an inline table of contents, and an estimator does not care which the
 * publisher chose. One panel, and the discrimination happens in code — see
 * `classifyOutline` in the viewer package.
 *
 * Markups is NOT a rail mode. It was, briefly, and it does not belong here:
 * the left side is navigation only, and a scope's markups belong to that
 * scope's detail in the right sidebar.
 */
export type RailPanel = 'files' | 'thumbnails' | 'contents' | 'search'

/** Tab order is narrowing: the project, then its sheets, then pictures of them. */
const TABS: Array<{ id: RailPanel; label: string; icon: Icon }> = [
  { id: 'files', label: 'Files', icon: Files },
  { id: 'contents', label: 'Contents', icon: Bookmark },
  { id: 'thumbnails', label: 'Thumbnails', icon: Grid2x2 },
]

/**
 * The left sidebar: a tab strip, and the panel it names.
 *
 * This was two columns — a 44px icon rail and a 300px pane beside it, 344px of
 * chrome to show one list. They were also two ideas: the rail said which panel,
 * the pane repeated it in a title bar directly to its right. Now the active tab
 * carries its own label and the strip IS the header, which is 44px back for the
 * drawing and one fewer thing to read.
 *
 * Only the active tab is labelled. Four labelled tabs do not fit 300px without
 * truncating, and a truncated tab label is worse than an icon; an icon with a
 * tooltip is a Windows navigation pane, which is what this is.
 *
 * Search sits apart, at the end. It is a verb among three nouns, and keeping
 * the three document views adjacent is what makes the strip scannable.
 */
export function Sidebar({
  active, onSelect, onSettings, notes = {}, indexing = null, title, actions, children,
}: {
  active: RailPanel | null
  onSelect: (p: RailPanel) => void
  onSettings: () => void
  /**
   * The project-wide text indexer's progress, while it runs. The Search tab
   * wears a ring and says how far along it is, so a search that finds
   * nothing on a half-read set is not the first sign the reading is still
   * going on.
   */
  indexing?: { done: number; total: number; document: string | null } | null
  /**
   * Something a panel wants read, keyed by panel. Marks the tab so a note in a
   * panel you are not looking at is still found; the text goes in the tooltip.
   */
  notes?: Partial<Record<RailPanel, string>>
  /**
   * The panel's own title, when it is not simply the tab's name.
   *
   * Usually redundant — the tab beside it already says "Contents" — so a head
   * row appears ONLY when the panel has been taken over by something else, as
   * the sheet index is when a page range is waiting for its scale.
   */
  title?: string | undefined
  actions?: ReactNode
  children?: ReactNode
}) {
  const tab = (id: RailPanel, label: string, icon: Icon) => {
    const busy = id === 'search' && indexing !== null && indexing.total > 0
    const progress = busy
      ? `indexing ${indexing.done} of ${indexing.total} document${indexing.total === 1 ? '' : 's'}`
        + (indexing.document !== null ? ` — ${indexing.document}` : '')
      : undefined
    const note = notes[id] ?? progress
    const on = active === id
    return (
      <button
        key={id}
        className={`sidetab${on ? ' on' : ''}${busy ? ' indexing' : ''}`}
        title={note === undefined ? label : `${label} — ${note}`}
        aria-label={note === undefined ? label : `${label}: ${note}`}
        aria-pressed={on}
        aria-busy={busy || undefined}
        onClick={() => onSelect(id)}
      >
        <Glyph icon={icon} role="card" />
        {on && <span className="sidetablabel">{label}</span>}
        {note !== undefined && <span className="railflag" aria-hidden="true" />}
      </button>
    )
  }

  const activeLabel = TABS.find((t) => t.id === active)?.label
    ?? (active === 'search' ? 'Search' : undefined)
  const head = title !== undefined && title !== activeLabel ? title : null

  return (
    <aside className="side">
      <nav className="sidetabs" aria-label="Panels">
        {TABS.map((t) => tab(t.id, t.label, t.icon))}
        <span className="grow" />
        {tab('search', 'Search', Search)}
      </nav>

      {head !== null && (
        <div className="panehead">
          <span className="panetitle">{head}</span>
          {actions}
        </div>
      )}
      {head === null && actions !== undefined && (
        <div className="panehead paneactions">{actions}</div>
      )}

      {children}

      <button
        className="sidesettings"
        title="Settings"
        aria-label="Settings"
        onClick={onSettings}
      >
        <Glyph icon={Settings2} role="card" />
        <span>Settings</span>
      </button>
    </aside>
  )
}

// ------------------------------------------------------- project files --

export interface PanelFile {
  id: string
  name: string
  relativePath: string
  detail: string
  missing?: boolean
}

export interface PanelFolder {
  name: string
  detail: string
  files: PanelFile[]
}

/**
 * The project's documents: a filter, the folder TREE, a count.
 *
 * This IS the document browser now. The browser was a dialog over the drawing
 * holding the one thing this pane lacked — a filter — and the pane was the
 * one place the browser's list already lived. "Open another document" from
 * the tab strip and the app menu lands here with the cursor in the field.
 * Self-contained, like the sheet index: the field and the footer are outside
 * the scroller so a 693-document list cannot roll them off screen.
 *
 * The list is the tree the drawings make on disk — every folder, at every
 * depth, foldable — because that is how an estimator knows a Maxxit set from
 * "Not Used Yet". See `fileTree.ts` for the flat list it replaced.
 */
export function FileList({
  files, activeId, onOpen, onOpenContext, scanning = false, note = null,
  openIds = [], focusNonce = 0,
}: {
  files: PanelFile[]
  activeId: string | null
  onOpen: (id: string) => void
  onOpenContext?: (id: string) => void
  /** The folder is still being read; an empty list means nothing yet. */
  scanning?: boolean
  /** What the scan itself reported — a refused reconcile, an unreadable folder. */
  note?: string | null
  /** Documents with a tab, so the list can say which are already open. */
  openIds?: readonly string[]
  /**
   * Bumped by whoever wants the cursor in the filter — Ctrl+O, the + in the
   * tab strip. A nonce, because the pane may already be open and mounted, and
   * re-rendering a mounted field does not focus it.
   */
  focusNonce?: number
}) {
  const [query, setQuery] = useState('')
  /** Folder paths the person has closed. Everything opens by default. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const fieldRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (focusNonce > 0) { fieldRef.current?.focus(); fieldRef.current?.select() }
  }, [focusNonce])
  const tree = useMemo(() => buildFileTree(files), [files])
  const shown = useMemo(() => filterFileTree(tree, query), [tree, query])
  const filtering = query.trim() !== ''
  // A filter opens every folder it kept: a match hidden in a folded folder
  // is a match the pane claims not to have.
  const rows = useMemo(() => treeRows(shown, filtering ? new Set() : folded), [shown, folded, filtering])
  const total = tree.fileCount
  const matched = shown.fileCount
  const open = useMemo(() => new Set(openIds), [openIds])

  const toggle = (path: string) => setFolded((cur) => {
    const next = new Set(cur)
    if (next.has(path)) next.delete(path); else next.add(path)
    return next
  })
  const foldAll = () => setFolded(new Set(treeFolderPaths(tree)))
  const unfoldAll = () => setFolded(new Set())

  /**
   * Enter opens the only match, which is what a narrowed filter means — the
   * browser dialog did this, and it is the fast path for "open A-101".
   */
  const openSoleMatch = () => {
    const only = treeFiles(shown)
    if (only.length === 1) { onOpen(only[0]!.id); setQuery('') }
  }

  const field = (
    <div className="panesearch">
      <Glyph icon={Search} role="small" />
      <input
        ref={fieldRef}
        value={query}
        placeholder={total > 1 ? `Filter ${total} documents` : 'Filter documents'}
        aria-label="Filter documents"
        disabled={files.length === 0}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQuery('')
          if (e.key === 'Enter') openSoleMatch()
        }}
      />
    </div>
  )
  const anyFolders = tree.folders.length > 0
  const foot = (
    <div className="panefoot">
      <span className="grow">
        {scanning
          ? 'Reading the folder…'
          : filtering
            ? `${matched} of ${total} document${total === 1 ? '' : 's'}`
            : `${total} document${total === 1 ? '' : 's'}`}
      </span>
      {anyFolders && !filtering && (
        folded.size === 0
          ? <button className="hlink" onClick={foldAll}>Collapse all</button>
          : <button className="hlink" onClick={unfoldAll}>Expand all</button>
      )}
    </div>
  )

  /*
   * "Not finished looking" and "looked and found nothing" are different
   * claims, and this panel used to make the second while the first was true.
   * A folder synced from SharePoint took two and a half minutes to list —
   * every subdirectory a Files On-Demand reparse point that had to be woken —
   * and for all of it the pane stated, as a fact, that the project was empty.
   * It says what it is doing instead, and why it might be a while.
   */
  if (files.length === 0 && scanning) {
    return (
      <>
        {field}
        <div className="panebody">
          <div className="paneempty pending" role="status">
            <div>Reading the project folder…</div>
            <div className="panehint">
              A cloud-synced folder can take a few minutes: every file has to be
              woken before it can be listed.
            </div>
          </div>
        </div>
        {foot}
      </>
    )
  }
  const notice = note === null ? null : (
    <div className="panenote" role="status">
      <Glyph icon={Info} role="row" />
      <span>{note}</span>
    </div>
  )
  if (files.length === 0) {
    return (
      <>
        {field}
        <div className="panebody">
          {notice}
          <div className="paneempty">
            {/* The scan's note, when there is one, is the headline — it says
                "no PDFs" in its own words and a second line saying it again
                read as two errors. */}
            {note === null && <div>No PDFs in this project folder.</div>}
            <div className="panehint">
              Drop the drawing set into the folder, or press + in the tab strip
              to add one. Subfolders are listed as they are on disk.
            </div>
          </div>
        </div>
        {foot}
      </>
    )
  }
  const folderRow = (folder: TreeFolder, openNow: boolean) => (
    <button
      key={`d:${folder.path}`}
      className="sheetgrouphead treefolder"
      style={{ '--tree-depth': folder.depth } as CSSProperties}
      aria-expanded={openNow}
      title={folder.path}
      onClick={() => toggle(folder.path)}
    >
      <Glyph icon={ChevronDown} role="small" />
      <Glyph icon={Folder} role="small" />
      <span className="grow">{folder.name}</span>
      <span className="treecount">{folder.fileCount}</span>
    </button>
  )
  /*
    ONE LINE PER FILE, AND THE NAME IS NEVER WHAT TRUNCATES.

    The row is a grid whose name track grows to its content before the
    detail track gets anything — so at a narrow pane the qualifier
    ("12 pages") shrinks and then vanishes, and the file name is whole
    for as long as the pane can hold it at all. The first one-line
    version of this row had it the other way round: the name ellipsed
    at 300px to keep a page count intact, which is the one trade a
    file list must not make.
  */
  const fileRow = (file: PanelFile, depth: number) => (
    <button
      key={file.id}
      className={`filerow treefile${file.id === activeId ? ' active' : ''}${file.missing === true ? ' missing' : ''}`}
      style={{ '--tree-depth': depth } as CSSProperties}
      onClick={() => onOpen(file.id)}
      title={file.detail === '' ? file.relativePath : `${file.relativePath} — ${file.detail}`}
    >
      <Glyph icon={FileText} role="small" />
      <span className="filename">{file.name}</span>
      {/* Two elements, because a container query can only style what
          is INSIDE the container — see `.filedetail` for why it hides. */}
      <span className="filedetail">
        <span>
          {/* A document with a tab says so: opening it again only
              focuses the tab, and the list should not promise more. */}
          {open.has(file.id) && file.id !== activeId && <span className="fileopen">open · </span>}
          {file.detail}
        </span>
      </span>
      {file.id === activeId && onOpenContext
        ? (
          <span
            role="button"
            tabIndex={0}
            className="fileact"
            title="Open in context window"
            onClick={(e) => { e.stopPropagation(); onOpenContext(file.id) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation(); e.preventDefault(); onOpenContext(file.id)
              }
            }}
          ><Glyph icon={ExternalLink} role="small" /></span>
          )
        : null}
    </button>
  )
  return (
    <>
      {field}
      <div className="panebody" role="tree" aria-label="Project documents">
      {notice}
      {rows.length === 0 && (
        <div className="paneempty">No document matches “{query.trim()}”.</div>
      )}
      {rows.map((r) => (r.kind === 'folder' ? folderRow(r.folder, r.open) : fileRow(r.file, r.depth)))}
      </div>
      {foot}
    </>
  )
}
