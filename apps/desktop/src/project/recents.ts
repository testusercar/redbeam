/**
 * Presentation logic for the recents list.
 *
 * Pure functions, no React and no DOM, so the behaviour that actually matters —
 * what a 200-entry list does, what a missing project looks like, how a path too
 * long for the panel is shortened — is unit tested rather than eyeballed.
 */
import type { RecentProject } from './types.js'

/** Above this many entries the list shows a filter box. */
export const FILTER_THRESHOLD = 8

/** Rows rendered before the "show all" affordance appears. */
export const INITIAL_VISIBLE = 40

/**
 * Case-insensitive substring match on name and path.
 *
 * Path as well as name because a bid package is very often `260415` in three
 * different folders and the name alone cannot tell them apart.
 */
export function filterRecents(projects: RecentProject[], query: string): RecentProject[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return projects
  return projects.filter(
    (p) =>
      p.name.toLowerCase().includes(needle) || p.path.toLowerCase().includes(needle),
  )
}

/**
 * Drop duplicate paths, keeping the first (newest) occurrence.
 *
 * Case-insensitive, matching the Rust side: Windows and macOS both treat
 * `C:/Jobs/A` and `c:/jobs/a` as one folder, and listing it twice is a bug the
 * user cannot fix.
 */
export function dedupeRecents(projects: RecentProject[]): RecentProject[] {
  const seen = new Set<string>()
  const out: RecentProject[] = []
  for (const project of projects) {
    const key = project.path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(project)
  }
  return out
}

/**
 * Shorten a path to fit, eliding the middle.
 *
 * The middle is what goes: the drive and the folder name are the two parts that
 * identify a project, and cutting either end would leave two different projects
 * looking identical.
 */
export function shortenPath(path: string, maxLength = 52): string {
  if (path.length <= maxLength || maxLength < 8) return path
  const keep = maxLength - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${path.slice(0, head)}…${path.slice(path.length - tail)}`
}

/**
 * "just now" / "14m ago" / "3h ago" / "yesterday" / "12 Aug" / "12 Aug 2025".
 *
 * `now` is a parameter rather than `Date.now()` so a test can pin it and a
 * render can stay deterministic.
 */
export function formatLastOpened(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''

  const seconds = Math.round((now - then) / 1000)
  // A clock that has gone backwards (a resynced machine, a project opened on
  // another box) reads as "just now" rather than a negative age.
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 172_800) return 'yesterday'

  const date = new Date(then)
  const sameYear = new Date(now).getUTCFullYear() === date.getUTCFullYear()
  const month = MONTHS[date.getUTCMonth()] ?? ''
  return sameYear
    ? `${date.getUTCDate()} ${month}`
    : `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * What a project path has to look like before Open is worth enabling.
 *
 * Absolute only, and that is the fix for the wart this feature exists to close:
 * a relative path resolved against the binary's working directory, which is how
 * the database ended up at `src-tauri/redbeam.db`. Accepted forms are
 * `C:\...`, `C:/...`, a UNC share, and a POSIX absolute path.
 */
export function isPlausibleProjectPath(path: string): boolean {
  const trimmed = path.trim()
  if (trimmed === '') return false
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return true
  if (/^\\\\[^\\]/.test(trimmed)) return true
  if (trimmed.startsWith('/')) return true
  return false
}

/** A one-line explanation of why Open is disabled, or null when it is not. */
export function projectPathProblem(path: string): string | null {
  const trimmed = path.trim()
  if (trimmed === '') return null
  if (isPlausibleProjectPath(trimmed)) return null
  return 'enter a full path, for example C:\\Jobs\\260415 — REDBEAM'
}
