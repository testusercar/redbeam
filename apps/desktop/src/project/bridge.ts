/**
 * The TypeScript side of `src-tauri/src/project.rs`.
 *
 * Every function here has a browser fallback, because the app is expected to
 * run in a plain tab for fast iteration and the picker must degrade rather than
 * throw. What each fallback does is stated at its call site; the short version:
 * the browser can remember a list of paths and let you type one, but it cannot
 * open a folder dialog and cannot read a folder, so it says so.
 *
 * # Permissions
 *
 * None of these calls need a capability grant. They invoke application
 * commands defined in this app's own crate, and Tauri v2's ACL gates the
 * webview hop for `core:*` and `plugin:*` commands only. In particular this
 * file deliberately does NOT import `@tauri-apps/plugin-fs` or
 * `@tauri-apps/plugin-dialog`: doing so would pull the filesystem and dialog
 * surfaces into the webview and require `fs:` / `dialog:` permissions, when the
 * Rust side can do the same work with none.
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { isTauri } from '../tauri/window.js'
import type {
  DrawingPickOutcome, PickOutcome, ProjectInfo, RecentProject, ScanResult,
} from './types.js'

/** The shape of `invoke` this module needs. Injectable so tests need no runtime. */
export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

/** The slice of `Storage` the browser fallback uses. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ProjectBridgeOptions {
  invoke?: InvokeFn
  /** Override the environment check. */
  desktop?: boolean
  /** Where browser-mode recents live. Defaults to `localStorage`. */
  storage?: KeyValueStore | null
  now?: () => Date
}

export const BROWSER_RECENTS_KEY = 'redbeam.recent-projects'

/** Kept in step with `MAX_RECENTS` in project.rs. */
export const MAX_RECENTS = 200

const BROWSER_NO_DIALOG =
  'a browser tab cannot open a file dialog — type a project folder path instead'

const BROWSER_NO_SCAN =
  'a browser tab cannot read a folder; run the desktop app to ingest a project'

const BROWSER_NO_READ =
  'a browser tab cannot read a project file; run the desktop app'

export interface ProjectBridge {
  /** True when the Rust core is reachable. */
  readonly desktop: boolean
  pickFolder(): Promise<PickOutcome>
  /** Open a PDF and take its folder as the project. */
  pickDrawing(): Promise<DrawingPickOutcome>
  openProject(path: string, options?: { create?: boolean }): Promise<ProjectInfo>
  listRecents(): Promise<RecentProject[]>
  forgetRecent(path: string): Promise<RecentProject[]>
  clearRecents(): Promise<void>
  scanProject(path: string, extensions?: string[]): Promise<ScanResult>
  /**
   * A document's bytes, for the paths that need the file itself rather than a
   * URL to it — PDF write-back, so far.
   *
   * Rejects in browser mode. A caller that treats "no bytes" as "empty file"
   * would write a valid, blank PDF over a real drawing's name, so this is one
   * of the few places where failing is better than degrading.
   */
  readDocument(projectPath: string, relativePath: string): Promise<Uint8Array>
}

// ------------------------------------------------------------- utilities --

/** Folder name of a path, tolerating either separator and a trailing slash. */
export function projectNameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const name = cut >= 0 ? trimmed.slice(cut + 1) : trimmed
  return name === '' ? trimmed : name
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const nullableStr = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

const bool = (value: unknown): boolean => value === true

function toProjectInfo(raw: unknown): ProjectInfo {
  const r = asRecord(raw)
  const path = str(r.path)
  return {
    path,
    name: str(r.name) || projectNameFromPath(path),
    dbPath: str(r.db_path),
    created: bool(r.created),
    hasDatabase: bool(r.has_database),
  }
}

function toRecent(raw: unknown): RecentProject {
  const r = asRecord(raw)
  const path = str(r.path)
  return {
    path,
    name: str(r.name) || projectNameFromPath(path),
    lastOpenedAt: str(r.last_opened_at),
    missing: bool(r.missing),
  }
}

function toScanResult(raw: unknown): ScanResult {
  const r = asRecord(raw)
  const files = Array.isArray(r.files) ? r.files : []
  return {
    root: str(r.root),
    truncated: bool(r.truncated),
    unreadable: Array.isArray(r.unreadable) ? r.unreadable.map((u) => str(u)) : [],
    scannedAt: str(r.scanned_at),
    files: files.map((file) => {
      const f = asRecord(file)
      return {
        relativePath: str(f.relative_path),
        absolutePath: str(f.absolute_path),
        displayName: str(f.display_name),
        kind: str(f.kind, 'other'),
        status: str(f.status, 'current'),
        sizeBytes: typeof f.size_bytes === 'number' ? f.size_bytes : 0,
        modifiedAt: nullableStr(f.modified_at),
        contentFingerprint: nullableStr(f.content_fingerprint),
        availability: str(f.availability, 'local'),
        fileDateHint: nullableStr(f.file_date_hint),
      }
    }),
  }
}

// -------------------------------------------------------- browser recents --

function readBrowserRecents(storage: KeyValueStore | null): RecentProject[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(BROWSER_RECENTS_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((entry) => {
      const r = asRecord(entry)
      const path = str(r.path)
      return {
        path,
        name: str(r.name) || projectNameFromPath(path),
        lastOpenedAt: str(r.lastOpenedAt),
        // A browser cannot check whether the folder exists, so it never claims
        // one is missing. Saying "missing" on no evidence would be worse than
        // saying nothing.
        missing: false,
      }
    })
  } catch {
    // A corrupt list is a nuisance, not a reason to refuse to start.
    return []
  }
}

function writeBrowserRecents(storage: KeyValueStore | null, projects: RecentProject[]): void {
  if (!storage) return
  try {
    storage.setItem(BROWSER_RECENTS_KEY, JSON.stringify(projects.slice(0, MAX_RECENTS)))
  } catch {
    // Private browsing, or a full quota. The app works without a recents list.
  }
}

function defaultStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Some embedding contexts throw on the mere access.
    return null
  }
}

// ------------------------------------------------------------------ build --

export function createProjectBridge(opts: ProjectBridgeOptions = {}): ProjectBridge {
  const desktop = opts.desktop ?? isTauri()
  const invoke: InvokeFn =
    opts.invoke ??
    (<T>(cmd: string, args?: Record<string, unknown>) => tauriInvoke<T>(cmd, args ?? {}))
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage
  const now = opts.now ?? (() => new Date())

  return {
    desktop,

    async pickFolder(): Promise<PickOutcome> {
      if (!desktop) {
        return { supported: false, path: null, reason: BROWSER_NO_DIALOG }
      }
      const raw = await invoke<unknown>('project_pick_folder')
      const r = asRecord(raw)
      return {
        supported: bool(r.supported),
        path: nullableStr(r.path),
        reason: nullableStr(r.reason),
      }
    },

    async pickDrawing(): Promise<DrawingPickOutcome> {
      if (!desktop) {
        return { supported: false, project: null, relativePath: null, reason: BROWSER_NO_DIALOG }
      }
      const raw = await invoke<unknown>('project_pick_drawing')
      const r = asRecord(raw)
      const project = r.project === null || r.project === undefined
        ? null
        : toProjectInfo(r.project)
      return {
        supported: bool(r.supported),
        project,
        relativePath: nullableStr(r.relativePath),
        reason: nullableStr(r.reason),
      }
    },

    async openProject(path, options = {}): Promise<ProjectInfo> {
      const trimmed = path.trim()
      if (trimmed === '') throw new Error('no project folder was given')

      if (!desktop) {
        // The browser store is IndexedDB and ignores the path entirely, so the
        // folder is remembered as a label rather than resolved. The recents
        // list still works, which is the part worth having in dev.
        const info: ProjectInfo = {
          path: trimmed,
          name: projectNameFromPath(trimmed),
          dbPath: 'IndexedDB (browser fallback)',
          created: false,
          hasDatabase: false,
        }
        const existing = readBrowserRecents(storage).filter(
          (p) => p.path.toLowerCase() !== trimmed.toLowerCase(),
        )
        writeBrowserRecents(storage, [
          {
            path: info.path,
            name: info.name,
            lastOpenedAt: now().toISOString(),
            missing: false,
          },
          ...existing,
        ])
        return info
      }

      return toProjectInfo(
        await invoke<unknown>('project_open', {
          path: trimmed,
          create: options.create ?? false,
        }),
      )
    },

    async listRecents(): Promise<RecentProject[]> {
      if (!desktop) return readBrowserRecents(storage)
      const raw = await invoke<unknown>('project_recents')
      return Array.isArray(raw) ? raw.map(toRecent) : []
    },

    async forgetRecent(path): Promise<RecentProject[]> {
      if (!desktop) {
        const remaining = readBrowserRecents(storage).filter(
          (p) => p.path.toLowerCase() !== path.toLowerCase(),
        )
        writeBrowserRecents(storage, remaining)
        return remaining
      }
      const raw = await invoke<unknown>('project_forget_recent', { path })
      return Array.isArray(raw) ? raw.map(toRecent) : []
    },

    async clearRecents(): Promise<void> {
      if (!desktop) {
        writeBrowserRecents(storage, [])
        return
      }
      await invoke<void>('project_clear_recents')
    },

    async scanProject(path, extensions): Promise<ScanResult> {
      if (!desktop) {
        // `truncated: true` is load bearing, not decoration: it tells the
        // ingest not to reconcile. An empty scan treated as authoritative
        // would flag every document in the project as missing.
        return {
          root: path,
          files: [],
          truncated: true,
          unreadable: [BROWSER_NO_SCAN],
          scannedAt: now().toISOString(),
        }
      }
      return toScanResult(
        await invoke<unknown>('project_scan', {
          path,
          ...(extensions === undefined ? {} : { extensions }),
        }),
      )
    },

    async readDocument(projectPath, relativePath): Promise<Uint8Array> {
      if (!desktop) throw new Error(BROWSER_NO_READ)
      const bytes = await invoke<ArrayBuffer | Uint8Array | number[]>(
        'project_read_document',
        { path: projectPath, relativePath },
      )
      // A transport that falls back to JSON yields a number array. Handling it
      // here rather than at the call site is what keeps a caller from ending up
      // with a Uint8Array full of NaN and a PDF that will not parse.
      if (bytes instanceof Uint8Array) return bytes
      if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
      return new Uint8Array(bytes)
    },
  }
}

/** The bridge the app uses. Tests build their own with `createProjectBridge`. */
export const projectBridge: ProjectBridge = createProjectBridge()
