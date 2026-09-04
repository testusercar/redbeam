/**
 * Getting a failure onto disk (plan TH.8).
 *
 * The error boundary already shows a render error and offers to copy it. That
 * is enough only while the window is still open: reload it — which is the first
 * thing anybody does — and the evidence is gone. So a report is written too.
 *
 * And the boundary is not the only way this app fails. It writes to SQLite,
 * ingests folders and builds PDFs asynchronously, and a rejected promise in any
 * of those reaches no `componentDidCatch`. What it produces is worse than a
 * crash: a window that looks fine and has quietly stopped doing the thing that
 * was asked of it. Those are caught here.
 *
 * Reports go to a folder and nowhere else. See `src-tauri/src/crash.rs` for
 * what a file contains and why it says so in its own header.
 */
import { isTauri } from './tauri/window.js'

/**
 * What failed, constrained to the three that mean something different.
 *
 * `render` is a component that threw; `rejection` is async work that gave up
 * without anybody catching it. The Rust side writes `rust-panic` itself, since
 * by then there is no frontend left to ask.
 */
export type CrashKind = 'render' | 'rejection'

/**
 * The last message written, to stop a loop filling the folder.
 *
 * A failing render can remount and throw the same error repeatedly; an
 * unhandled rejection in a retry loop can fire every few hundred milliseconds.
 * Twenty copies of one stack teach nothing the first did not, and the disk they
 * fill belongs to somebody trying to work.
 */
let last: { message: string, at: number } | null = null
const REPEAT_WINDOW_MS = 10_000

/** True when this exact failure was already recorded moments ago. */
export function isRepeat(
  message: string, now: number, previous: { message: string, at: number } | null,
): boolean {
  return previous !== null
    && previous.message === message
    && now - previous.at < REPEAT_WINDOW_MS
}

/**
 * Write a crash report. Returns the file, or null when there is nowhere to
 * write — a browser tab, or a report suppressed as a repeat.
 *
 * Never throws. It is called from an error handler, and a reporter that fails
 * loudly replaces the original failure with its own.
 */
export async function reportCrash(
  kind: CrashKind, message: string, detail: string,
): Promise<string | null> {
  if (!isTauri()) return null
  const now = Date.now()
  if (isRepeat(message, now, last)) return null
  last = { message, at: now }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string | null>('crash_report', { kind, message, detail })
  } catch {
    return null
  }
}

/**
 * Catch what the error boundary cannot.
 *
 * Called once at startup. `unhandledrejection` is the one that matters: React
 * never sees it, so without this the app carries on looking healthy.
 */
export function installCrashHandlers(): void {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown
    const message = reason instanceof Error ? reason.message : String(reason)
    const detail = reason instanceof Error ? (reason.stack ?? '') : ''
    // Logged as well as written: the console copy is what a `tauri dev`
    // terminal shows, and is there before anybody thinks to look in a folder.
    console.error('[redbeam] unhandled rejection', reason)
    void reportCrash('rejection', message, detail)
  })

  window.addEventListener('error', (event) => {
    // Resource load failures (a missing image) also fire this, and are not
    // crashes. Only an ErrorEvent carrying a real Error is.
    if (!(event.error instanceof Error)) return
    console.error('[redbeam] uncaught error', event.error)
    void reportCrash('rejection', event.error.message, event.error.stack ?? '')
  })
}

/** Reports on disk, newest first. Empty in a browser tab. */
export async function listCrashReports(): Promise<Array<{
  file: string, written_at: string, kind: string, message: string
}>> {
  if (!isTauri()) return []
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke('crash_reports')
  } catch {
    return []
  }
}

/** Where they live, so somebody can be told where to look. */
export async function crashFolder(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string | null>('crash_dir')
  } catch {
    return null
  }
}
