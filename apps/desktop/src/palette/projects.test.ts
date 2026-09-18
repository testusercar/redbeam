import { describe, expect, it, vi } from 'vitest'
import { groupMatches, search } from './commands.js'
import {
  LISTED_UNTYPED, NOT_FOUND, projectCommands, type ProjectEntry,
} from './projects.js'

const entry = (n: number, over: Partial<ProjectEntry> = {}): ProjectEntry => ({
  path: `C:\\Jobs\\26041${n} - Job ${n}`, name: `26041${n} - Job ${n}`, ...over,
})

const ids = (cmds: ReturnType<typeof projectCommands>, query = '') =>
  search(cmds, query).map((m) => m.command.id)
/** The project rows alone: not the New / Manage / browse rows beside them. */
const projectIds = (cmds: ReturnType<typeof projectCommands>, query = '') =>
  ids(cmds, query).filter((id) => id.startsWith('project:C:'))

describe('projectCommands', () => {
  it('lists a recent project under the Projects group and opens it', () => {
    const onOpen = vi.fn()
    const cmds = projectCommands({ currentPath: 'C:\\Jobs\\here', recents: [entry(1)], onOpen })
    const [group] = groupMatches(search(cmds, ''))
    expect(group?.kind).toBe('project')
    expect(group?.matches[0]?.command.title).toBe('260411 - Job 1')
    group?.matches[0]?.command.run?.()
    expect(onOpen).toHaveBeenCalledWith('C:\\Jobs\\260411 - Job 1')
  })

  it('never lists the project this window is already showing', () => {
    // Case-insensitively, as the Rust side dedupes: a row for where you
    // already are is a row that does nothing.
    const here = entry(1)
    const cmds = projectCommands({
      currentPath: here.path.toUpperCase(), recents: [here, entry(2)], onOpen: () => {},
    })
    expect(ids(cmds)).toEqual(['project:C:\\Jobs\\260412 - Job 2'])
  })

  it('is findable by the words people use for it', () => {
    const cmds = projectCommands({ currentPath: '', recents: [entry(1)], onOpen: () => {}, onBrowse: () => {} })
    for (const typed of ['switch project', 'open project']) {
      const found = ids(cmds, typed)
      expect(found, typed).toContain('project:C:\\Jobs\\260411 - Job 1')
      expect(found, typed).toContain('project:browse')
    }
  })

  it('caps what an untyped palette shows, and keeps the rest a keystroke away', () => {
    // Two hundred recents listed unconditionally would push the scopes and
    // sheets off the bottom of the untyped list, the way the scale presets
    // once did.
    const recents = Array.from({ length: LISTED_UNTYPED + 4 }, (_, i) => entry(i))
    const cmds = projectCommands({ currentPath: '', recents, onOpen: () => {} })
    expect(projectIds(cmds)).toHaveLength(LISTED_UNTYPED)
    // The most recent ones are the ones listed.
    expect(projectIds(cmds)[0]).toBe('project:C:\\Jobs\\260410 - Job 0')
    expect(ids(cmds, 'job 8')).toContain('project:C:\\Jobs\\260418 - Job 8')
    // The rest are one row away, with everything that can be done to each.
    expect(ids(cmds)).toContain('project:manage')
  })

  it('opens a hub on Enter and the project itself on Shift+Enter', () => {
    const onOpen = vi.fn()
    const hide = vi.fn()
    const cmds = projectCommands({ currentPath: '', recents: [entry(1)], onOpen, actions: { hide } })
    const [row] = search(cmds, 'job 1')
    expect(row?.command.step?.kind).toBe('choose')
    row?.command.alt?.run()
    expect(onOpen).toHaveBeenCalledWith('C:\\Jobs\\260411 - Job 1')
    const hub = row?.command.step?.kind === 'choose' ? row.command.step.options() : []
    expect(hub.map((c) => c.title)).toEqual(['Open in a second window', 'Hide from recents'])
    void hub[1]?.run?.()
    expect(hide).toHaveBeenCalledWith('C:\\Jobs\\260411 - Job 1')
  })

  it('lists a missing folder, saying why, and lets it be hidden rather than opened', () => {
    // Somebody typing the job's name and finding nothing would conclude it
    // was never opened here. The truth is that the drive is offline. Its row
    // is not `unavailable`: Enter reaches its hub, which cannot open it but
    // can hide it, which is what a row for a gone folder is for.
    const cmds = projectCommands({ currentPath: '', recents: [entry(1, { missing: true })], onOpen: () => {}, actions: { hide: () => {} } })
    const [hit] = search(cmds, 'job 1')
    expect(hit?.command.detail).toContain(NOT_FOUND)
    expect(hit?.command.detail).toContain('C:\\Jobs')
    expect(hit?.command.unavailable).toBeUndefined()
    expect(hit?.command.alt).toBeUndefined()
    const hub = hit?.command.step?.kind === 'choose' ? hit.command.step.options() : []
    expect(hub.map((c) => c.title)).toEqual(['Hide from recents'])
  })

  it('does not spend an untyped slot on a missing folder', () => {
    const recents = [entry(0, { missing: true }), ...Array.from({ length: LISTED_UNTYPED }, (_, i) => entry(i + 1))]
    const cmds = projectCommands({ currentPath: '', recents, onOpen: () => {} })
    const untyped = projectIds(cmds)
    expect(untyped).toHaveLength(LISTED_UNTYPED)
    expect(untyped).not.toContain('project:C:\\Jobs\\260410 - Job 0')
  })

  it('offers to browse only where a folder dialog exists', () => {
    const onBrowse = vi.fn()
    expect(ids(projectCommands({ currentPath: '', recents: [], onOpen: () => {} }))).toEqual([])
    const cmds = projectCommands({ currentPath: '', recents: [], onOpen: () => {}, onBrowse })
    expect(ids(cmds)).toEqual(['project:browse'])
    cmds[0]?.run?.()
    expect(onBrowse).toHaveBeenCalledOnce()
  })

  it('lists no recents when the window has no way to open one', () => {
    expect(projectCommands({ currentPath: '', recents: [entry(1)] })).toEqual([])
  })
})
