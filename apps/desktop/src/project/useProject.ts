/**
 * Project lifecycle as a hook.
 *
 * Owns the picker's state — recents, which project is open, what went wrong —
 * and nothing else. It deliberately does NOT open the database or run an
 * ingest: those belong to whoever wires the app together, because both have
 * process-wide effects (the core swaps its single SQLite connection) and this
 * hook must not be the second place that can trigger them.
 *
 * Instead it reports what it resolved through `onOpened`, and the integrator
 * does:
 *
 * ```ts
 * const project = useProject({
 *   onOpened: async (info) => {
 *     const db = await openDatabase(info.dbPath)
 *     const scan = await projectBridge.scanProject(info.path)
 *     await ingestDocuments(db.driver, toIngestDocuments(scan), {
 *       reconcile: !scan.truncated,
 *     })
 *   },
 * })
 * ```
 *
 * An `onOpened` that throws leaves `error` set and `project` null, so a failed
 * migration does not leave the UI claiming a project is open.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { projectBridge, type ProjectBridge } from './bridge.js'
import type { DrawingPickOutcome, PickOutcome, ProjectInfo, RecentProject } from './types.js'

export interface UseProjectOptions {
  /** Override for tests, or to point at a traced bridge. */
  bridge?: ProjectBridge
  /**
   * Called once a folder has been resolved, before the project is announced as
   * open. Throwing here surfaces as `error` and the project stays closed.
   */
  onOpened?: (project: ProjectInfo) => void | Promise<void>
  /** Open this path on mount — e.g. from the window's query string. */
  initialPath?: string | null
}

export interface UseProjectState {
  project: ProjectInfo | null
  recents: RecentProject[]
  /** True while an open is in flight. */
  busy: boolean
  /** Path being opened, for per-row feedback in the recents list. */
  busyPath: string | null
  error: string | null
  /** True when the Rust core is reachable. */
  desktop: boolean
  /** True until the first recents load settles. */
  loading: boolean

  open: (path: string, options?: { create?: boolean }) => Promise<void>
  openRecent: (project: RecentProject) => Promise<void>
  browse: () => Promise<PickOutcome>
  /** Open a PDF; the project is the folder it lives in. */
  openDrawing: () => Promise<DrawingPickOutcome>
  forget: (project: RecentProject) => Promise<void>
  clearRecents: () => Promise<void>
  refreshRecents: () => Promise<void>
  close: () => void
  dismissError: () => void
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)

export function useProject(opts: UseProjectOptions = {}): UseProjectState {
  const bridge = opts.bridge ?? projectBridge
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [recents, setRecents] = useState<RecentProject[]>([])
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Kept in a ref so `open` does not change identity every time the caller
  // re-creates its callback inline, which would restart the mount effect.
  const onOpenedRef = useRef(opts.onOpened)
  onOpenedRef.current = opts.onOpened

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const refreshRecents = useCallback(async () => {
    try {
      const list = await bridge.listRecents()
      if (aliveRef.current) setRecents(list)
    } catch (err) {
      // A recents list that cannot be read is not a reason to block the app.
      console.warn('[project] could not read recent projects:', err)
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [bridge])

  const open = useCallback(
    async (path: string, options: { create?: boolean } = {}) => {
      setBusyPath(path)
      setError(null)
      try {
        const info = await bridge.openProject(path, { create: options.create ?? false })
        // Announce to the integrator BEFORE marking the project open, so a
        // failure here never leaves the UI showing a project whose database
        // did not actually come up.
        await onOpenedRef.current?.(info)
        if (!aliveRef.current) return
        setProject(info)
        await refreshRecents()
      } catch (err) {
        if (aliveRef.current) {
          setError(message(err))
          setProject(null)
        }
      } finally {
        if (aliveRef.current) setBusyPath(null)
      }
    },
    [bridge, refreshRecents],
  )

  const openRecent = useCallback(
    async (recent: RecentProject) => {
      await open(recent.path)
    },
    [open],
  )

  const browse = useCallback(async (): Promise<PickOutcome> => {
    try {
      return await bridge.pickFolder()
    } catch (err) {
      return { supported: false, path: null, reason: message(err) }
    }
  }, [bridge])

  /**
   * Open a drawing set, and take the project from where it lives.
   *
   * The picker used to demand a project FOLDER, which is the wrong first
   * question — an estimator is handed a PDF, not a project. The folder is our
   * bookkeeping and it can be derived. Cancelling is not an error and does not
   * touch state.
   */
  const openDrawing = useCallback(async (): Promise<DrawingPickOutcome> => {
    let outcome: DrawingPickOutcome
    try {
      outcome = await bridge.pickDrawing()
    } catch (err) {
      const failed = { supported: false, project: null, relativePath: null, reason: message(err) }
      if (aliveRef.current) setError(message(err))
      return failed
    }
    if (outcome.project !== null) await open(outcome.project.path)
    else if (outcome.reason !== null && aliveRef.current) setError(outcome.reason)
    return outcome
  }, [bridge, open])

  const forget = useCallback(
    async (recent: RecentProject) => {
      try {
        const remaining = await bridge.forgetRecent(recent.path)
        if (aliveRef.current) setRecents(remaining)
      } catch (err) {
        if (aliveRef.current) setError(message(err))
      }
    },
    [bridge],
  )

  const clearRecents = useCallback(async () => {
    try {
      await bridge.clearRecents()
      if (aliveRef.current) setRecents([])
    } catch (err) {
      if (aliveRef.current) setError(message(err))
    }
  }, [bridge])

  const close = useCallback(() => {
    // Only the UI's view of the project. The core keeps its connection until
    // the next db_open replaces it — closing it here would break any context
    // window still reading through it.
    setProject(null)
    setError(null)
  }, [])

  const dismissError = useCallback(() => setError(null), [])

  const initialPath = opts.initialPath ?? null
  useEffect(() => {
    void (async () => {
      await refreshRecents()
      if (initialPath !== null && initialPath !== '') await open(initialPath)
    })()
    // `open` and `refreshRecents` are stable for a stable bridge; re-running
    // this on every render would reopen the project in a loop.
  }, [refreshRecents, open, initialPath])

  return {
    project,
    recents,
    busy: busyPath !== null,
    busyPath,
    error,
    desktop: bridge.desktop,
    loading,
    open,
    openRecent,
    browse,
    openDrawing,
    forget,
    clearRecents,
    refreshRecents,
    close,
    dismissError,
  }
}
