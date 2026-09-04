/**
 * Shapes crossing the project-lifecycle boundary.
 *
 * These mirror `src-tauri/src/project.rs` one for one. Serde serializes Rust
 * field names as written, so everything arrives snake_case and is camelized in
 * ./bridge.ts — deliberately by hand, one field at a time, so a rename on
 * either side is a compile error here rather than an `undefined` three
 * components away.
 */

/** A project folder that has been resolved and is ready to open. */
export interface ProjectInfo {
  /** Canonical absolute path of the project folder. */
  path: string
  /** Folder name — the project's display name. */
  name: string
  /**
   * Absolute path of the SQLite file. Hand this to `openDatabase`.
   *
   * This is the whole point of the feature: the database used to default to
   * `'.'` and land beside whatever binary happened to be running.
   */
  dbPath: string
  /** True when opening created the folder. */
  created: boolean
  /** True when the database file already existed — a reopen, not a first open. */
  hasDatabase: boolean
}

/** One entry in the recent-projects list. */
export interface RecentProject {
  path: string
  name: string
  /** RFC 3339 UTC. */
  lastOpenedAt: string
  /** The folder is gone. The entry stays so the user can see what happened. */
  missing: boolean
}

/**
 * What a folder-picker attempt produced.
 *
 * `supported: false` is a normal outcome — a browser tab, or a desktop build
 * without the dialog plugin. The UI falls back to a path field rather than
 * treating it as an error.
 */
export interface PickOutcome {
  supported: boolean
  /** null when the user cancelled, or when `supported` is false. */
  path: string | null
  reason: string | null
}

/**
 * What a drawing-picker attempt produced.
 *
 * The project is derived from where the chosen PDF lives, so this carries both
 * — the folder to open, and the file to open inside it. Landing on a file list
 * after someone has already named the file they want is a step nobody asked
 * for.
 */
export interface DrawingPickOutcome {
  supported: boolean
  /** null when the user cancelled, or when `supported` is false. */
  project: ProjectInfo | null
  /** File name of the chosen drawing, relative to the project folder. */
  relativePath: string | null
  reason: string | null
}

/** One file found by a project scan. */
export interface ScannedFile {
  /** Forward-slashed, relative to the project root. The file's identity. */
  relativePath: string
  absolutePath: string
  displayName: string
  kind: string
  status: string
  sizeBytes: number
  modifiedAt: string | null
  contentFingerprint: string | null
  /** 'local' | 'online_only' | 'unavailable' */
  availability: string
  fileDateHint: string | null
}

export interface ScanResult {
  root: string
  files: ScannedFile[]
  /**
   * The walk was cut short. A truncated scan is NOT evidence that a document is
   * gone — reconciliation must be skipped, or every unvisited drawing is
   * flagged missing.
   */
  truncated: boolean
  /** Directories that could not be read. Same rule as `truncated`. */
  unreadable: string[]
  scannedAt: string
}

/**
 * What an ingest did. Structurally compatible with `IngestSummary` from
 * `@redbeam/store`, declared here so this directory needs no store import —
 * the integrator passes the store function in as a callback.
 */
export interface IngestCounts {
  created: number
  updated: number
  moved: number
  restored: number
  markedMissing: number
  pagesWritten: number
}
