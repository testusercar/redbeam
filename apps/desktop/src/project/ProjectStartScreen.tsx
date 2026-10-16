/**
 * The screen a window shows when it is not yet showing a project.
 *
 * Built to board 1 of docs/design/prompt-settings-icons-2026-09-18 (round
 * two, Aaron, 2026-09-18), with one change he made to it: opening a drawing
 * set is NOT the primary action and does NOT make a project. Before a
 * project is open the window has one job — get the estimator into the right
 * job in one action — and the three ways in, in the order they happen, are:
 *
 *   1. continue yesterday's job: the recents, left, one row each, the most
 *      recent armed so launch → Enter is the whole morning routine;
 *   2. reopen or start a job from its folder: the primary card, in the accent;
 *   3. look at a drawing set someone handed over: the second card. It opens
 *      the PDF for viewing, with no project behind it; the first markup
 *      action asks for the drawing's project folder.
 *
 * Everything else about a recent job — rename, pin, show in Explorer, remove
 * from the list, set its data aside — is a right-click, not three links on
 * the row's face. A missing job says so and offers Locate. The whole window
 * is a drop target. The version sits in the footer, where a start window
 * keeps it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ProjectPicker } from './ProjectPicker.js'
import { filterRecents, formatLastOpened } from './recents.js'
import type { PickOutcome, RecentProject } from './types.js'
import {
  DocumentPdf, Folder, FolderOpen, Glyph, Info, Open, Pin, Rename, Search, TextField, Trash2, WindowNew, X,
} from '../shell/icons.js'
import { isTauri } from '../tauri/window.js'
import { APP_VERSION } from '../update/updates.js'

export interface ProjectStartScreenProps {
  recents: RecentProject[]
  onOpenPath: (path: string, options: { create: boolean }) => void | Promise<void>
  onOpenRecent: (project: RecentProject) => void
  /** Open a recent job in a second window, leaving this one on the start page. */
  onOpenRecentElsewhere?: (project: RecentProject) => void
  onForgetRecent?: (project: RecentProject) => void
  /** Name a project; an empty name goes back to the folder name. */
  onRenameRecent?: (project: RecentProject, name: string) => void
  /** Set a project's Redbeam data aside and forget it. Desktop only. */
  onRemoveData?: (project: RecentProject) => void
  /** Show the job's folder in Explorer. Desktop only. */
  onRevealRecent?: (project: RecentProject) => void
  /** A missing job: pick where it went. Desktop only. */
  onLocateRecent?: (project: RecentProject) => void
  /** Pick a project folder. */
  onBrowse?: () => Promise<PickOutcome>
  /** Pick a drawing to VIEW. No project is made. Desktop only. */
  onViewDrawing?: () => void
  /** A file or folder dropped on the window. Desktop only. */
  onDropPath?: (path: string) => void
  /** Path currently being opened, if any. */
  busyPath?: string | null
  busy?: boolean
  error?: string | null
  /** Shown above everything — e.g. "browser mode: data lives in IndexedDB". */
  notice?: string | null
  now?: number
}

/** Pinned jobs, by path — this estimator's, on this machine. */
const PINS_KEY = 'redbeam.pinned-projects'
function readPins(): string[] {
  try {
    const raw = localStorage.getItem(PINS_KEY)
    const list: unknown = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
  } catch { return [] }
}
function writePins(pins: string[]): void {
  try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)) } catch { /* a private window keeps no pins */ }
}

/** The folder a job lives in, with the head elided: "…\Team Site - Ramp\Bentall Towers 1 & 2". */
function shortFolder(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.length <= 3 ? path : `…\\${parts.slice(-2).join('\\')}`
}

export function ProjectStartScreen({
  recents,
  onOpenPath,
  onOpenRecent,
  onOpenRecentElsewhere,
  onForgetRecent,
  onRenameRecent,
  onRemoveData,
  onRevealRecent,
  onLocateRecent,
  onBrowse,
  onViewDrawing,
  onDropPath,
  busyPath = null,
  busy = false,
  error = null,
  notice = null,
  now,
}: ProjectStartScreenProps) {
  const [query, setQuery] = useState('')
  const [pins, setPins] = useState<string[]>(() => readPins())
  const [armed, setArmed] = useState(0)
  const [pathOpen, setPathOpen] = useState(false)
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const timestamp = now ?? Date.now()
  const hasDialogs = onBrowse !== undefined || onViewDrawing !== undefined
  const showPath = pathOpen || !hasDialogs

  /* Pinned first, then the rest by recency, then the filter over both. */
  const rows = useMemo(() => {
    const matched = filterRecents(recents, query)
    const pinned = matched.filter((p) => pins.includes(p.path))
    const rest = matched.filter((p) => !pins.includes(p.path))
    return [...pinned, ...rest]
  }, [recents, pins, query])
  const at = Math.min(armed, Math.max(0, rows.length - 1))

  useEffect(() => { filterRef.current?.focus() }, [])
  useEffect(() => { setArmed(0) }, [query])
  useEffect(() => {
    if (menu === null) return
    const onDown = (e: PointerEvent) => { if (menuRef.current !== null && !menuRef.current.contains(e.target as Node)) setMenu(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey) }
  }, [menu])

  /*
   * The whole window is a drop target. Tauri delivers dropped paths on its
   * own event; the hover and leave events dress the window while a file is
   * over it. A build without the event bus simply never dresses.
   */
  useEffect(() => {
    if (!isTauri() || onDropPath === undefined) return
    let stop: Array<() => void> = []
    let cancelled = false
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        const drop = await listen<{ paths?: string[] }>('tauri://drag-drop', (e) => {
          setDragging(false)
          const first = e.payload?.paths?.[0]
          if (typeof first === 'string') onDropPath(first)
        })
        const enter = await listen('tauri://drag-enter', () => setDragging(true))
        const leave = await listen('tauri://drag-leave', () => setDragging(false))
        if (cancelled) { drop(); enter(); leave() } else stop = [drop, enter, leave]
      } catch { /* no event bus: no drop */ }
    })()
    return () => { cancelled = true; for (const s of stop) s() }
  }, [onDropPath])

  /* Ctrl+O browses for a job, as the card says. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'o' || onBrowse === undefined || busy) return
      e.preventDefault()
      void onBrowse().then((o) => { if (o.supported && o.path !== null) void onOpenPath(o.path, { create: false }) })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBrowse, onOpenPath, busy])

  useEffect(() => {
    if (onRemoveData === undefined) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target instanceof HTMLElement ? e.target : null
      const typing = target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      if (typing && target !== filterRef.current) return
      if (query !== '') return
      if (renaming !== null || confirming !== null) return
      const p = rows[at]
      if (p === undefined) return
      e.preventDefault()
      setConfirming(p.path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onRemoveData, query, renaming, confirming, rows, at])

  const togglePin = useCallback((path: string) => {
    setPins((p) => { const next = p.includes(path) ? p.filter((x) => x !== path) : [...p, path]; writePins(next); return next })
  }, [])
  const open = (p: RecentProject) => { if (!p.missing && !busy) onOpenRecent(p) }
  const shownName = (p: RecentProject) => p.displayName ?? p.name
  const menuFor = menu === null ? null : rows.find((p) => p.path === menu.path) ?? null

  return (
    <div className={`startscreen st${dragging ? ' dropping' : ''}`}>
      {/* No title bar on this screen, so the strip the window controls sit in
          is the only place left to grab. */}
      <div className="startdrag" data-tauri-drag-region />

      <div className="st-body">
        <div className="st-left">
          <header className="st-head">
            <div className="st-mark" aria-hidden="true">RB</div>
            <div>
              <h1 className="st-title">REDBEAM</h1>
              <p className="st-tag">Quantity takeoff from construction drawings</p>
            </div>
          </header>

          {notice !== null && notice !== '' && <p className="st-notice">{notice}</p>}
          {error !== null && error !== '' && (
            <div className="st-error" role="alert" data-testid="project-error">
              <Glyph icon={Info} role="row" />
              <span>{error}</span>
            </div>
          )}

          <h2 className="st-sec">Open recent</h2>
          <label className="st-find">
            <Glyph icon={Search} role="inline" />
            <input
              ref={filterRef}
              value={query}
              placeholder={recents.length === 0 ? 'No jobs opened yet' : 'Filter jobs'}
              aria-label="Filter recent projects"
              disabled={recents.length === 0}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (renaming !== null) return
                if (e.key === 'ArrowDown') { e.preventDefault(); setArmed((n) => Math.min(n + 1, Math.max(0, rows.length - 1))) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setArmed((n) => Math.max(n - 1, 0)) }
                else if (e.key === 'Enter') { e.preventDefault(); const p = rows[at]; if (p !== undefined) open(p) }
                else if (e.key === 'F2') { e.preventDefault(); const p = rows[at]; if (p !== undefined && onRenameRecent !== undefined) setRenaming(p.path) }
                else if (e.key === 'Escape' && query !== '') setQuery('')
              }}
            />
            <span className="st-keys"><kbd>↑↓</kbd><kbd>↵</kbd></span>
          </label>

          <div className="st-list" role="listbox" aria-label="Recent projects">
            {recents.length === 0 && (
              <div className="st-empty">Open a project folder, or a drawing set, and it will be here tomorrow.</div>
            )}
            {recents.length > 0 && rows.length === 0 && (
              <div className="st-empty">No job matches “{query.trim()}”.</div>
            )}
            {rows.map((p, i) => {
              const isBusy = busyPath !== null && busyPath === p.path
              const pinned = pins.includes(p.path)
              if (renaming === p.path) {
                return (
                  <div key={p.path} className="st-row renaming">
                    <span className="st-ico"><Glyph icon={Folder} role="card" /></span>
                    <input
                      autoFocus
                      className="st-rename"
                      defaultValue={p.displayName ?? ''}
                      placeholder={p.name}
                      aria-label={`New name for ${p.name}`}
                      onBlur={(e) => { onRenameRecent?.(p, e.target.value); setRenaming(null) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { onRenameRecent?.(p, (e.target as HTMLInputElement).value); setRenaming(null) }
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                    />
                  </div>
                )
              }
              if (confirming === p.path) {
                return (
                  <div key={p.path} className="st-row confirming">
                    <span className="st-ico"><Glyph icon={Trash2} role="card" /></span>
                    <span className="st-rowtext">
                      <span className="st-name">Set aside the REDBEAM data for {shownName(p)}?</span>
                      <span className="st-path">The takeoff moves into the folder’s .redbeam/removed folder. The drawings are not touched.</span>
                    </span>
                    <button className="st-btn danger" onClick={() => { setConfirming(null); onRemoveData?.(p) }}>Set aside</button>
                    <button className="st-btn subtle" onClick={() => setConfirming(null)}>Cancel</button>
                  </div>
                )
              }
              return (
                <div
                  key={p.path}
                  role="option"
                  aria-selected={i === at}
                  className={`st-row${onRemoveData !== undefined ? ' has-trash' : ''}${i === at ? ' armed' : ''}${p.missing ? ' missing' : ''}${isBusy ? ' busy' : ''}`}
                  title={p.path}
                  onMouseEnter={() => setArmed(i)}
                  onClick={() => open(p)}
                  onDoubleClick={() => open(p)}
                  onContextMenu={(e) => { e.preventDefault(); setArmed(i); setMenu({ path: p.path, x: e.clientX, y: e.clientY }) }}
                >
                  <span className="st-ico"><Glyph icon={Folder} role="card" filled={i === at} /></span>
                  <span className="st-rowtext">
                    <span className="st-name">{shownName(p)}</span>
                    <span className="st-path">{p.missing ? `${p.path} · not found` : shortFolder(p.path)}</span>
                  </span>
                  {p.missing && onLocateRecent !== undefined
                    ? <button className="st-link" onClick={(e) => { e.stopPropagation(); onLocateRecent(p) }}>Locate…</button>
                    : <span className="st-when">{isBusy ? 'opening…' : formatLastOpened(p.lastOpenedAt, timestamp)}</span>}
                  {onRemoveData !== undefined && (
                    <button
                      className="st-pin st-trash"
                      title="Set REDBEAM data aside"
                      aria-label={`Set REDBEAM data for ${shownName(p)} aside`}
                      onClick={(e) => { e.stopPropagation(); setConfirming(p.path) }}
                    ><Glyph icon={Trash2} role="inline" /></button>
                  )}
                  <button
                    className={`st-pin${pinned ? ' on' : ''}`}
                    title={pinned ? 'Unpin' : 'Pin to top'}
                    aria-label={pinned ? `Unpin ${shownName(p)}` : `Pin ${shownName(p)} to top`}
                    aria-pressed={pinned}
                    onClick={(e) => { e.stopPropagation(); togglePin(p.path) }}
                  ><Glyph icon={Pin} role="inline" filled={pinned} /></button>
                </div>
              )
            })}
          </div>
          {recents.length > rows.length && query === '' && (
            <div className="st-count">{rows.length} of {recents.length}</div>
          )}
        </div>

        <div className="st-right">
          <h2 className="st-sec">Get started</h2>
          {onBrowse !== undefined && (
            <button
              type="button"
              className="st-card primary"
              disabled={busy}
              onClick={() => void onBrowse().then((o) => {
                if (o.supported && o.path !== null) void onOpenPath(o.path, { create: false })
              })}
            >
              <span className="st-cardico"><Glyph icon={FolderOpen} role="empty" /></span>
              <span className="st-cardtext">
                <span className="st-cardtitle">{busy ? 'Opening…' : 'Open a project folder'}</span>
                <span className="st-carddesc">A job’s folder, with its drawings. REDBEAM keeps one redbeam.db beside them and never modifies them.</span>
              </span>
              <kbd>Ctrl O</kbd>
            </button>
          )}
          {onViewDrawing !== undefined && (
            <button type="button" className="st-card" disabled={busy} onClick={onViewDrawing}>
              <span className="st-cardico"><Glyph icon={DocumentPdf} role="empty" /></span>
              <span className="st-cardtext">
                <span className="st-cardtitle">Open a drawing set to look at</span>
                <span className="st-carddesc">A PDF on its own, for viewing. No project is made until you take something off, and then it asks which folder.</span>
              </span>
            </button>
          )}
          {hasDialogs && (
            <button type="button" className="st-card" aria-expanded={showPath} onClick={() => setPathOpen((v) => !v)}>
              <span className="st-cardico"><Glyph icon={TextField} role="empty" /></span>
              <span className="st-cardtext">
                <span className="st-cardtitle">Open a folder by path</span>
                <span className="st-carddesc">For a remote session, or a path from a ticket.</span>
              </span>
            </button>
          )}
          {showPath && (
            <section className="st-pathcard">
              <ProjectPicker
                {...(onBrowse ? { onBrowse } : {})}
                onOpen={onOpenPath}
                busy={busy}
                error={null}
                heading={hasDialogs ? '' : 'Open a folder by path'}
                defaultPath={recents.find((p) => !p.missing)?.path ?? ''}
              />
            </section>
          )}
          {onDropPath !== undefined && (
            <div className="st-drop"><b>Drop a PDF or a folder anywhere on this window</b> to open it</div>
          )}
        </div>
      </div>

      <footer className="st-foot">
        <span>REDBEAM {APP_VERSION}</span>
      </footer>

      {menu !== null && menuFor !== null && (
        <div className="dockmenu st-menu" role="menu" aria-label={shownName(menuFor)} ref={menuRef} style={{ left: menu.x, top: menu.y }} onClick={() => setMenu(null)}>
          <button className="menuitem" role="menuitem" disabled={menuFor.missing} onClick={() => open(menuFor)}>
            <Glyph icon={Open} role="row" /><span className="grow">Open</span><span className="hint">↵</span>
          </button>
          {onOpenRecentElsewhere !== undefined && (
            <button className="menuitem" role="menuitem" disabled={menuFor.missing} onClick={() => onOpenRecentElsewhere(menuFor)}>
              <Glyph icon={WindowNew} role="row" /><span className="grow">Open in a new window</span>
            </button>
          )}
          <div className="menusep" />
          <button className="menuitem" role="menuitem" onClick={() => togglePin(menuFor.path)}>
            <Glyph icon={Pin} role="row" /><span className="grow">{pins.includes(menuFor.path) ? 'Unpin' : 'Pin to top'}</span>
          </button>
          {onRenameRecent !== undefined && (
            <button className="menuitem" role="menuitem" onClick={() => setRenaming(menuFor.path)}>
              <Glyph icon={Rename} role="row" /><span className="grow">Rename</span><span className="hint">F2</span>
            </button>
          )}
          {onRevealRecent !== undefined && !menuFor.missing && (
            <button className="menuitem" role="menuitem" onClick={() => onRevealRecent(menuFor)}>
              <Glyph icon={FolderOpen} role="row" /><span className="grow">Show in Explorer</span>
            </button>
          )}
          {onLocateRecent !== undefined && menuFor.missing && (
            <button className="menuitem" role="menuitem" onClick={() => onLocateRecent(menuFor)}>
              <Glyph icon={Search} role="row" /><span className="grow">Locate…</span>
            </button>
          )}
          <div className="menusep" />
          {onForgetRecent !== undefined && (
            <button className="menuitem" role="menuitem" title="The project folder is not touched." onClick={() => onForgetRecent(menuFor)}>
              <Glyph icon={X} role="row" /><span className="grow">Remove from this list</span>
            </button>
          )}
          {onRemoveData !== undefined && !menuFor.missing && (
            <button className="menuitem danger" role="menuitem" onClick={() => setConfirming(menuFor.path)}>
              <Glyph icon={Trash2} role="row" /><span className="grow">Set REDBEAM data aside…</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
