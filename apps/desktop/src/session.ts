/**
 * Where you were, per project.
 *
 * A relaunch used to land on the first sheet of the first document with the
 * first scope selected, whatever you had been doing. On a 29-sheet set that is
 * a real cost every time the app restarts — and during development it restarts
 * a lot, so the person testing pays it repeatedly to get back to the one sheet
 * they were looking at.
 *
 * Deliberately NOT in the project database. This is where a particular person
 * at a particular machine was looking; it is not part of the takeoff, it does
 * not belong in a file two estimators share, and losing it costs nothing.
 * localStorage, guarded the way the settings store is, is the right weight.
 */

const KEY = 'redbeam.session.v1'

export interface ProjectSession {
  /** Relative path, not the row id: ids are derived and can be re-derived. */
  documentPath?: string
  /** Zero-based, matching the viewer. */
  pageIndex?: number
  activeScopeId?: string
}

type Store = Record<string, ProjectSession>

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed as Store : {}
  } catch {
    // A place in a document is never worth failing a launch over.
    return {}
  }
}

export function readSession(projectPath: string): ProjectSession {
  return read()[projectPath] ?? {}
}

/** Merge a patch into this project's remembered place. */
export function writeSession(projectPath: string, patch: ProjectSession): void {
  try {
    const all = read()
    const next = { ...all[projectPath], ...patch }
    // Undefined means "no opinion", not "forget it": a patch that only carries
    // a page must not erase the remembered document.
    for (const k of Object.keys(next) as Array<keyof ProjectSession>) {
      if (next[k] === undefined) delete next[k]
    }
    all[projectPath] = next
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* see above */ }
}
