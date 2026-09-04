/**
 * Projects, as palette rows.
 *
 * The palette is the only permanent menu this app has (project-window spec
 * §12), so a project you cannot reach from it is a project you have to leave
 * the window to find. These rows are built from the same recents list and the
 * same callbacks the title bar's project switcher uses, so the two can never
 * disagree about which projects exist or what opening one does.
 *
 * What opening one does is the WINDOW MODEL, not this file's decision: a
 * window is a project — its database, its undo stack and every id in the
 * workspace belong to it — so `onOpen` opens a second window and leaves this
 * one alone. The group says so on the page, in the same words the title
 * menu uses, because Enter producing a new window is a surprise if nobody
 * said it would.
 *
 * No React and no bridge here: the caller passes what it has, and the rules —
 * which entries are listed, which are only findable, what a missing folder
 * looks like — are argued with in `projects.test.ts` rather than through the
 * UI.
 */
import type { Command } from './commands.js'

/** What the caller already holds. Structurally a `RecentProject`. */
export interface ProjectEntry {
  path: string
  name: string
  /** The folder is gone — an offline drive, a moved job. */
  missing?: boolean
}

export interface ProjectCommandSource {
  /** The project this window is showing. Never listed: you are already there. */
  currentPath: string
  recents: ReadonlyArray<ProjectEntry>
  /** Open a project in a second window. Absent when the window cannot. */
  onOpen?: (path: string) => void
  /** Choose a folder, then open it. Absent where there is no file dialog. */
  onBrowse?: () => void
}

/**
 * How many recents an UNTYPED palette lists.
 *
 * The list can hold two hundred, and the row limit is fifty. Listed
 * unconditionally they would do to the untyped palette what the scale
 * presets once did — push the estimates, scopes and sheets off the bottom.
 * The five most recent are what "switch project" almost always means; the
 * rest are a keystroke away.
 */
export const LISTED_UNTYPED = 5

/** What a row for a folder that cannot be opened says. */
export const NOT_FOUND = 'Folder not found'

/** The sentence the title menu uses; one name per thing (commands spec §11). */
export const OPENS_ELSEWHERE = 'Opens a second window. This one stays as it is.'

export function projectCommands(src: ProjectCommandSource): Command[] {
  const out: Command[] = []
  const { onOpen, onBrowse } = src

  if (onOpen !== undefined) {
    // Case-insensitive, matching the Rust side: Windows treats `C:/Jobs/A`
    // and `c:/jobs/a` as one folder, and listing the open project as somewhere
    // else to go is a row that does nothing.
    const here = src.currentPath.toLowerCase()
    let listed = 0
    for (const p of src.recents) {
      if (p.path.toLowerCase() === here) continue
      const missing = p.missing === true
      // A missing folder is still a row: somebody typing the job's name and
      // finding nothing would conclude it was never opened here. It is listed,
      // dimmed, and says why Enter will not take them there.
      const command: Command = {
        id: `project:${p.path}`,
        kind: 'project',
        title: p.name,
        detail: p.path,
        keywords: ['project', 'switch project', 'open project'],
        run: () => onOpen(p.path),
      }
      if (missing) command.unavailable = NOT_FOUND
      // Only live entries spend one of the untyped slots.
      if (missing || listed >= LISTED_UNTYPED) command.whenTyped = true
      else listed += 1
      out.push(command)
    }
  }

  if (onBrowse !== undefined) {
    out.push({
      id: 'project:browse',
      kind: 'project',
      title: 'Open another project…',
      detail: 'Choose a folder',
      keywords: ['open project', 'switch project', 'browse', 'folder', 'new project'],
      run: onBrowse,
    })
  }

  return out
}
