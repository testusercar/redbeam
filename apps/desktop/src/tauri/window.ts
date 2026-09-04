/**
 * Window helpers.
 *
 * REDBEAM runs as a multi-window Tauri app, but every window loads the same
 * frontend bundle — it works out what it is from the query string. That means
 * the app also runs in a plain browser tab, which is how iteration stays fast.
 * Everything here degrades to browser behaviour when Tauri is absent rather
 * than throwing.
 */

import { invoke } from '@tauri-apps/api/core'

export type WindowRole = 'main' | 'context'

export interface WindowIdentity {
  /** null when no project is addressed — e.g. a bare `npm run dev` tab. */
  projectId: string | null
  role: WindowRole
  /**
   * The document a context window was opened to show, by relative path.
   *
   * Popping a tab out and landing on a different sheet than the one you popped
   * is worse than not having the feature, so the target travels on the URL
   * rather than the new window guessing. null on a main window.
   */
  documentPath: string | null
}

/** What the Rust side reports back after opening (or focusing) a window. */
export interface OpenedWindow {
  label: string
  url: string
  /** false when a window with that label already existed and was focused. */
  created: boolean
}

/**
 * True when running inside a Tauri webview.
 *
 * Detected via the internals object Tauri injects rather than by importing
 * `isTauri` from the API package, so this stays a cheap synchronous check with
 * no import-time cost in a plain browser.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Read this window's identity out of the query string.
 *
 * Defaults to `{ projectId: null, role: 'main' }`, which is what a plain
 * `http://localhost:5180/` tab gets.
 */
export function getWindowRole(search?: string): WindowIdentity {
  const raw =
    search ?? (typeof window === 'undefined' ? '' : window.location.search)
  const params = new URLSearchParams(raw)
  const projectId = params.get('projectId')
  const role = params.get('role')
  const document = params.get('document')
  return {
    projectId: projectId === null || projectId === '' ? null : projectId,
    role: role === 'context' ? 'context' : 'main',
    documentPath: document === null || document === '' ? null : document,
  }
}

/** Build the in-app URL a window with this identity should load. */
export function windowUrl(
  projectId: string,
  role: WindowRole,
  documentPath?: string,
): string {
  const params = new URLSearchParams({ projectId, role })
  if (documentPath !== undefined && documentPath !== '') {
    params.set('document', documentPath)
  }
  return `index.html?${params.toString()}`
}

function browserFallback(
  projectId: string,
  role: WindowRole,
  label: string,
  documentPath?: string,
): OpenedWindow {
  const params = new URLSearchParams({ projectId, role })
  if (documentPath !== undefined && documentPath !== '') {
    params.set('document', documentPath)
  }
  const url = `${window.location.pathname}?${params.toString()}`
  const opened = window.open(url, label)
  return { label, url, created: opened !== null }
}

/**
 * Open — or focus, if it is already open — a window showing a project.
 *
 * @param label window identity. Defaults to `project-<projectId>`, so calling
 *   twice for the same project focuses rather than duplicates.
 */
export async function openProjectWindow(
  projectId: string,
  label = `project-${projectId}`,
): Promise<OpenedWindow> {
  if (!isTauri()) return browserFallback(projectId, 'main', label)
  return invoke<OpenedWindow>('open_project_window', { projectId, label })
}

/**
 * Open — or focus — the context window that rides alongside a project.
 *
 * `documentPath` is the drawing it should show. There is one context window per
 * project, by label, so popping out a second tab re-points the existing window
 * rather than stacking a third.
 */
export async function openContextWindow(
  projectId: string,
  documentPath?: string,
): Promise<OpenedWindow> {
  if (!isTauri()) {
    return browserFallback(projectId, 'context', `context-${projectId}`, documentPath)
  }
  return invoke<OpenedWindow>('open_context_window', {
    projectId,
    document: documentPath ?? null,
  })
}

// ------------------------------------------------------- this window --

/**
 * Controls for the window this code is running in.
 *
 * The API package is imported dynamically rather than at module scope: this
 * file is also loaded by a plain browser tab and by the tests, where pulling in
 * the window API would cost an import for something that can never be called.
 * Every one of these is a no-op outside Tauri rather than a throw — a browser
 * tab has no window to minimize and that is not an error.
 */
async function thisWindow() {
  if (!isTauri()) return null
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

/**
 * Report rather than swallow.
 *
 * These are core commands, so they go through Tauri's ACL: without
 * `core:window:allow-minimize` and friends in `capabilities/default.json`,
 * every one of them REJECTS. The buttons were wired to `void minimize()`,
 * which discards the rejection — so the frame's controls did nothing at all,
 * silently, and looked like dead pixels rather than a missing grant. A console
 * error naming the permission is the difference between a five-minute fix and
 * an afternoon.
 */
async function windowAction(name: string, run: () => Promise<void>): Promise<boolean> {
  try {
    await run()
    return true
  } catch (err) {
    console.error(
      `[window] ${name} was refused. If this is a desktop build, check that ` +
        `core:window:allow-${name.toLowerCase()} is granted in ` +
        'src-tauri/capabilities/default.json.',
      err,
    )
    return false
  }
}

export async function minimizeWindow(): Promise<boolean> {
  const w = await thisWindow()
  if (w === null) return false
  return windowAction('minimize', () => w.minimize())
}

/** Maximize, or restore if already maximized. Resolves the state afterwards. */
export async function toggleMaximizeWindow(): Promise<boolean> {
  const w = await thisWindow()
  if (w === null) return false
  await windowAction('toggle-maximize', () => w.toggleMaximize())
  return isWindowMaximized()
}

export async function closeThisWindow(): Promise<boolean> {
  const w = await thisWindow()
  if (w === null) return false
  return windowAction('close', () => w.close())
}

export async function isWindowMaximized(): Promise<boolean> {
  const w = await thisWindow()
  if (w === null) return false
  try {
    return await w.isMaximized()
  } catch {
    return false
  }
}

/**
 * Subscribe to resize, which is the only event that changes maximized state.
 *
 * Resolves a function that unsubscribes, or a no-op outside Tauri.
 */
export async function onWindowResize(fn: () => void): Promise<() => void> {
  const w = await thisWindow()
  if (w === null) return () => {}
  return w.onResized(fn)
}

/** Close a window by label. Resolves false when there was nothing to close. */
export async function closeWindow(label: string): Promise<boolean> {
  if (!isTauri()) {
    window.close()
    return true
  }
  return invoke<boolean>('close_window', { label })
}
