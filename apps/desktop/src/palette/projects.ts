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
  /** A name the estimator gave it, shown over `name`. */
  displayName?: string | null
  /** The folder is gone — an offline drive, a moved job. */
  missing?: boolean
}

/**
 * What can be done TO a project from the prompt, beyond opening it. Each is
 * absent where the build cannot do it (the browser build has no Explorer),
 * and the hub lists only what is present.
 */
export interface ProjectActions {
  /** Name it; an empty name goes back to the folder name. */
  rename?: (path: string, name: string) => Promise<void> | void
  /** Drop it from the recents list. The folder is untouched. */
  hide?: (path: string) => Promise<void> | void
  /** Set its Redbeam data aside and forget it. Not undoable from here. */
  removeData?: (path: string) => Promise<void> | void
  /** Show the folder in the file manager. */
  reveal?: (path: string) => Promise<void> | void
  /** Make a folder a project (creating it if need be) and open it. */
  create?: (path: string) => Promise<string | void> | string | void
}

export interface ProjectCommandSource {
  /** The project this window is showing. Never listed: you are already there. */
  currentPath: string
  recents: ReadonlyArray<ProjectEntry>
  /** Open a project in a second window. Absent when the window cannot. */
  onOpen?: (path: string) => void
  /** Choose a folder, then open it. Absent where there is no file dialog. */
  onBrowse?: () => void
  actions?: ProjectActions
}

/** A plausible absolute folder path, on either platform. */
const looksLikeFolder = (t: string): boolean => /^([A-Za-z]:[\\/]|\\\\|\/)/.test(t.trim()) && t.trim().length > 3

/**
 * Everything the prompt can do to one project: Enter on a project row opens
 * this; Shift+Enter opens the project itself. Aaron, 2026-09-11: "project
 * CRUD does not work in the command prompt … all I can do is select recent
 * projects. I can't edit them, hide them."
 */
export function projectHub(p: ProjectEntry, src: ProjectCommandSource): Command[] {
  const { onOpen, actions } = src
  const shown = p.displayName ?? p.name
  const out: Command[] = []
  if (onOpen !== undefined && p.missing !== true) {
    out.push({
      id: `project:${p.path}:open`, kind: 'command', title: 'Open in a second window',
      detail: OPENS_ELSEWHERE, run: () => onOpen(p.path),
    })
  }
  if (actions?.rename !== undefined) {
    const rename = actions.rename
    out.push({
      id: `project:${p.path}:rename`, kind: 'command', title: 'Rename…',
      detail: 'shown instead of the folder name; the folder is not touched',
      step: {
        kind: 'text', label: 'Rename project', placeholder: p.name, initial: p.displayName ?? '',
        rule: 'empty goes back to the folder name',
        describe: (t) => (t.trim() === '' ? `Call it ${p.name} again` : `Call it “${t.trim()}”`),
        run: async (t) => { await rename(p.path, t.trim()) },
      },
    })
  }
  if (actions?.reveal !== undefined && p.missing !== true) {
    const reveal = actions.reveal
    out.push({ id: `project:${p.path}:reveal`, kind: 'command', title: 'Show in Explorer', detail: p.path, run: async () => { await reveal(p.path) } })
  }
  if (actions?.hide !== undefined) {
    const hide = actions.hide
    out.push({
      id: `project:${p.path}:hide`, kind: 'command', title: 'Hide from recents',
      detail: 'the folder is not touched; open it again to list it again', run: async () => { await hide(p.path) },
    })
  }
  if (actions?.removeData !== undefined && p.missing !== true) {
    const removeData = actions.removeData
    out.push({
      id: `project:${p.path}:remove`, kind: 'command', title: 'Set its Redbeam data aside',
      detail: 'moves redbeam.db into .redbeam/removed-…; the drawings stay; not undoable from here',
      step: {
        kind: 'choose', label: 'Set data aside', note: `for ${shown}`,
        warn: 'The takeoff leaves the project and can only be put back by hand.',
        options: () => [{
          id: `project:${p.path}:remove:yes`, kind: 'command', title: `Set aside ${shown}'s data`,
          detail: 'and forget the project', run: async () => { await removeData(p.path) },
        }],
      },
    })
  }
  return out
}

/** A project row: Enter lists what can be done to it; Shift+Enter opens it. */
function projectRow(p: ProjectEntry, src: ProjectCommandSource): Command {
  const missing = p.missing === true
  const command: Command = {
    id: `project:${p.path}`,
    kind: 'project',
    title: p.displayName ?? p.name,
    detail: p.displayName !== undefined && p.displayName !== null && p.displayName !== p.name ? `${p.name} · ${p.path}` : p.path,
    keywords: ['project', 'switch project', 'open project', p.name],
    step: {
      kind: 'choose', label: p.displayName ?? p.name, note: 'what to do with it',
      options: () => projectHub(p, src),
    },
  }
  if (src.onOpen !== undefined && !missing) {
    const onOpen = src.onOpen
    command.run = () => onOpen(p.path)
    command.alt = { label: 'Open in a second window', run: () => onOpen(p.path) }
  }
  if (missing) command.unavailable = NOT_FOUND
  return command
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
  const { onOpen, onBrowse, actions } = src

  if (onOpen !== undefined || actions !== undefined) {
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
      // dimmed, and says why Enter will not take them there. Its hub still
      // offers Hide and Rename, which is what a row for a gone folder is for.
      const command = projectRow(p, src)
      // Not `unavailable`: its hub still offers Hide and Rename, and Enter
      // has to reach them. The row says the folder is gone instead.
      if (missing) { delete command.unavailable; command.detail = `${NOT_FOUND} · ${p.path}` }
      // Only live entries spend one of the untyped slots.
      if (missing || listed >= LISTED_UNTYPED) command.whenTyped = true
      else listed += 1
      out.push(command)
    }
    // This project too, for what can be done to it, under a name that says so.
    const mine = src.recents.find((p) => p.path.toLowerCase() === here)
    if (mine !== undefined && actions !== undefined) {
      const { onOpen: _open, ...withoutOpen } = src
      out.push({
        id: 'project:this', kind: 'project', title: `This project: ${mine.displayName ?? mine.name}`,
        detail: 'rename it, show its folder', keywords: ['project', 'rename', 'this'],
        step: { kind: 'choose', label: mine.displayName ?? mine.name, note: 'this project', options: () => projectHub(mine, withoutOpen) },
      })
    }
  }

  if (actions?.create !== undefined) {
    const create = actions.create
    out.push({
      id: 'project:new', kind: 'project', title: 'New project…',
      detail: 'a folder of drawings, made a project; opens in a second window',
      keywords: ['new project', 'create', 'folder'],
      step: {
        kind: 'text', label: 'New project', placeholder: 'C:\\Jobs\\260415 - Midrise',
        rule: 'an absolute folder path; it is created if it does not exist',
        validate: (t) => (looksLikeFolder(t) ? null : 'an absolute path, like C:\\Jobs\\260415'),
        describe: (t) => (looksLikeFolder(t) ? `Make ${t.trim()} a project and open it` : 'New project'),
        run: async (t) => { const r = await create(t.trim()); return typeof r === 'string' ? r : undefined },
      },
    })
  }

  if (src.recents.length > LISTED_UNTYPED) {
    out.push({
      id: 'project:manage', kind: 'project', title: 'Manage projects…',
      detail: `all ${src.recents.length} recent projects, with what can be done to each`,
      keywords: ['projects', 'recent', 'manage', 'list'],
      step: {
        kind: 'choose', label: 'Projects', note: 'newest first',
        options: () => src.recents.map((p) => projectRow(p, src)),
      },
    })
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
