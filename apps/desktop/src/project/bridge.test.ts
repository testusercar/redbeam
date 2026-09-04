import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  BROWSER_RECENTS_KEY,
  createProjectBridge,
  projectNameFromPath,
  type KeyValueStore,
} from './bridge.js'
import { describeScan, shouldReconcile, toIngestDocuments } from './ingest.js'
import type { ScanResult } from './types.js'

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
}

/** What `project_scan` actually sends: serde's snake_case, verbatim. */
const RAW_SCAN = {
  root: 'C:\\Jobs\\260415',
  truncated: false,
  unreadable: [],
  scanned_at: '2026-08-28T12:00:00.000Z',
  files: [
    {
      relative_path: 'PKG A/ARCH/A-101.pdf',
      absolute_path: 'C:\\Jobs\\260415\\PKG A\\ARCH\\A-101.pdf',
      display_name: 'A-101.pdf',
      kind: 'drawing',
      status: 'current',
      size_bytes: 4_200_000,
      modified_at: '2026-04-15T10:00:00.000Z',
      content_fingerprint: 'abc123',
      availability: 'local',
      file_date_hint: '2026-04-15',
    },
  ],
}

describe('projectNameFromPath', () => {
  it('takes the folder name from either separator', () => {
    expect(projectNameFromPath('C:\\Jobs\\260415 - REDBEAM')).toBe('260415 - REDBEAM')
    expect(projectNameFromPath('C:/Jobs/260415 - REDBEAM')).toBe('260415 - REDBEAM')
    expect(projectNameFromPath('C:/Jobs/260415 - REDBEAM/')).toBe('260415 - REDBEAM')
  })

  it('drops a trailing separator of either kind', () => {
    expect(projectNameFromPath('C:\\Jobs\\260415 - REDBEAM\\')).toBe('260415 - REDBEAM')
    expect(projectNameFromPath('C:/Jobs/260415 - REDBEAM/')).toBe('260415 - REDBEAM')
    expect(projectNameFromPath('C:\\Jobs\\260415 - REDBEAM\\\\')).toBe('260415 - REDBEAM')
  })

  it('falls back to the whole string when there is no separator', () => {
    expect(projectNameFromPath('260415')).toBe('260415')
  })

  /*
   * The branded report puts this string in its <title> and <h1>, and for a
   * while it printed a full Windows path there instead: the call sites in
   * Workspace split on the character class [/], which contains a forward
   * slash and nothing else, so a backslash path came back whole. This is the
   * real path that exposed it.
   */
  it('names a deep Windows project folder, not its path', () => {
    const path =
      'C:\\Users\\aaron\\Dev Projects\\260807 - REDBEAM ML Training\\' +
      'REDBEAM TAKEOFF TRAINING DATASET\\00045 - Barclays Toronto'
    expect(projectNameFromPath(path)).toBe('00045 - Barclays Toronto')
    expect(projectNameFromPath(path)).not.toContain('\\')
  })
})

/**
 * The helper above was correct the whole time — Workspace just did not call
 * it. Four places need the project's display name, and two of them put it in
 * the branded report: the BOM panel's export button and the automation
 * bridge's `export` action. A report the agent generates and one a person
 * generates have to carry the same name, so the guard is that Workspace holds
 * exactly one copy of this and everything reads that.
 */
describe('Workspace derives the project name once', () => {
  const workspace = readFileSync(
    fileURLToPath(new URL('../Workspace.tsx', import.meta.url)),
    'utf8',
  )

  it('has no hand-rolled path splitting for the name', () => {
    expect(workspace).not.toMatch(/projectPath\s*\.?\s*\.split\(/)
    expect(workspace).toMatch(/projectNameFromPath\(projectPath\)/)
  })

  it('binds it once and passes that value everywhere', () => {
    expect(workspace.match(/projectNameFromPath\(/g)).toHaveLength(1)

    // two JSX consumers (title bar, estimates panel — the bill of materials
    // reads it from the panel it is a level of) plus the bridge's shorthand
    // `projectName,` in the renderTakeoffReport call
    expect(workspace.match(/projectName=\{projectName\}/g)).toHaveLength(2)
    expect(workspace).toMatch(/renderTakeoffReport\(\{\s*\n\s*projectName,/)
  })
})

// ------------------------------------------------------------- desktop --

describe('desktop bridge', () => {
  const calls: Array<{ cmd: string; args: Record<string, unknown> | undefined }> = []

  function bridge(responses: Record<string, unknown>) {
    calls.length = 0
    return createProjectBridge({
      desktop: true,
      storage: null,
      invoke: async (cmd, args) => {
        calls.push({ cmd, args })
        return responses[cmd] as never
      },
    })
  }

  it('camelizes what project_open returns', async () => {
    const b = bridge({
      project_open: {
        path: 'C:\\Jobs\\260415',
        name: '260415',
        db_path: 'C:\\Jobs\\260415\\redbeam.db',
        created: false,
        has_database: true,
      },
    })

    const info = await b.openProject('  C:\\Jobs\\260415  ')

    expect(info.dbPath).toBe('C:\\Jobs\\260415\\redbeam.db')
    expect(info.hasDatabase).toBe(true)
    expect(info.created).toBe(false)
    // The path is trimmed before it crosses the IPC hop.
    expect(calls[0]!.args).toEqual({ path: 'C:\\Jobs\\260415', create: false })
  })

  it('refuses an empty path without an IPC round trip', async () => {
    const b = bridge({})
    await expect(b.openProject('   ')).rejects.toThrow(/no project folder/)
    expect(calls).toHaveLength(0)
  })

  it('camelizes recents and keeps the missing flag', async () => {
    const b = bridge({
      project_recents: [
        {
          path: 'C:\\Jobs\\260415',
          name: '260415',
          last_opened_at: '2026-08-28T12:00:00.000Z',
          missing: true,
        },
      ],
    })
    const recents = await b.listRecents()
    expect(recents[0]!.lastOpenedAt).toBe('2026-08-28T12:00:00.000Z')
    expect(recents[0]!.missing).toBe(true)
  })

  it('camelizes a scan result field by field', async () => {
    const b = bridge({ project_scan: RAW_SCAN })
    const scan = await b.scanProject('C:\\Jobs\\260415')

    expect(scan.truncated).toBe(false)
    expect(scan.scannedAt).toBe('2026-08-28T12:00:00.000Z')
    expect(scan.files).toHaveLength(1)
    expect(scan.files[0]).toEqual({
      relativePath: 'PKG A/ARCH/A-101.pdf',
      absolutePath: 'C:\\Jobs\\260415\\PKG A\\ARCH\\A-101.pdf',
      displayName: 'A-101.pdf',
      kind: 'drawing',
      status: 'current',
      sizeBytes: 4_200_000,
      modifiedAt: '2026-04-15T10:00:00.000Z',
      contentFingerprint: 'abc123',
      availability: 'local',
      fileDateHint: '2026-04-15',
    })
  })

  it('omits extensions from the payload when the caller did not ask', async () => {
    const b = bridge({ project_scan: RAW_SCAN })
    await b.scanProject('C:\\Jobs\\260415')
    expect(calls[0]!.args).toEqual({ path: 'C:\\Jobs\\260415' })

    await b.scanProject('C:\\Jobs\\260415', ['pdf', 'dwg'])
    expect(calls[1]!.args).toEqual({ path: 'C:\\Jobs\\260415', extensions: ['pdf', 'dwg'] })
  })

  it('reports an unsupported dialog rather than throwing', async () => {
    const b = bridge({
      project_pick_folder: { supported: false, path: null, reason: 'no dialog in this build' },
    })
    const outcome = await b.pickFolder()
    expect(outcome.supported).toBe(false)
    expect(outcome.reason).toBe('no dialog in this build')
  })

  it('reads a cancelled dialog as a supported no-op', async () => {
    const b = bridge({ project_pick_folder: { supported: true, path: null, reason: null } })
    const outcome = await b.pickFolder()
    expect(outcome.supported).toBe(true)
    expect(outcome.path).toBeNull()
  })
})

// ------------------------------------------------------------- browser --

describe('browser fallback', () => {
  let storage: MemoryStore

  beforeEach(() => {
    storage = new MemoryStore()
  })

  function bridge() {
    return createProjectBridge({
      desktop: false,
      storage,
      invoke: async () => {
        throw new Error('the browser fallback must not invoke the core')
      },
      now: () => new Date('2026-08-28T12:00:00.000Z'),
    })
  }

  it('says a dialog is unavailable instead of crashing', async () => {
    const outcome = await bridge().pickFolder()
    expect(outcome.supported).toBe(false)
    expect(outcome.path).toBeNull()
    expect(outcome.reason).toMatch(/browser tab/)
  })

  it('remembers projects in local storage', async () => {
    const b = bridge()
    await b.openProject('C:/Jobs/260415')
    await b.openProject('C:/Jobs/260119')

    const recents = await b.listRecents()
    expect(recents.map((r) => r.path)).toEqual(['C:/Jobs/260119', 'C:/Jobs/260415'])
    expect(storage.getItem(BROWSER_RECENTS_KEY)).not.toBeNull()
  })

  it('promotes rather than duplicates on reopen', async () => {
    const b = bridge()
    await b.openProject('C:/Jobs/260415')
    await b.openProject('C:/Jobs/260119')
    await b.openProject('c:/jobs/260415')

    const recents = await b.listRecents()
    expect(recents).toHaveLength(2)
    expect(recents[0]!.path).toBe('c:/jobs/260415')
  })

  it('names the browser store honestly rather than inventing a file path', async () => {
    const info = await bridge().openProject('C:/Jobs/260415')
    expect(info.dbPath).toBe('IndexedDB (browser fallback)')
    expect(info.name).toBe('260415')
  })

  it('forgets a project', async () => {
    const b = bridge()
    await b.openProject('C:/Jobs/260415')
    await b.openProject('C:/Jobs/260119')
    const remaining = await b.forgetRecent('C:/Jobs/260415')
    expect(remaining.map((r) => r.path)).toEqual(['C:/Jobs/260119'])
    expect(await b.listRecents()).toHaveLength(1)
  })

  it('clears the list', async () => {
    const b = bridge()
    await b.openProject('C:/Jobs/260415')
    await b.clearRecents()
    expect(await b.listRecents()).toHaveLength(0)
  })

  it('survives a corrupt stored list', async () => {
    storage.setItem(BROWSER_RECENTS_KEY, '{ not json')
    expect(await bridge().listRecents()).toEqual([])
  })

  it('works with no storage at all', async () => {
    const b = createProjectBridge({ desktop: false, storage: null })
    await b.openProject('C:/Jobs/260415')
    expect(await b.listRecents()).toEqual([])
  })

  it('never claims a project is missing, because it cannot know', async () => {
    const b = bridge()
    await b.openProject('C:/Jobs/gone')
    expect((await b.listRecents())[0]!.missing).toBe(false)
  })

  it('marks its empty scan as truncated so nothing gets flagged missing', async () => {
    const scan = await bridge().scanProject('C:/Jobs/260415')
    expect(scan.files).toEqual([])
    expect(scan.truncated).toBe(true)
    expect(shouldReconcile(scan)).toBe(false)
  })
})

// -------------------------------------------------------------- ingest --

describe('scan to ingest input', () => {
  const scan: ScanResult = {
    root: 'C:/Jobs/260415',
    truncated: false,
    unreadable: [],
    scannedAt: '2026-08-28T12:00:00.000Z',
    files: [
      {
        relativePath: 'PKG A/A-101.pdf',
        absolutePath: 'C:/Jobs/260415/PKG A/A-101.pdf',
        displayName: 'A-101.pdf',
        kind: 'drawing',
        status: 'current',
        sizeBytes: 42,
        modifiedAt: '2026-04-15T10:00:00.000Z',
        contentFingerprint: 'abc',
        availability: 'local',
        fileDateHint: '2026-04-15',
      },
    ],
  }

  it('carries every catalog field across', () => {
    expect(toIngestDocuments(scan)).toEqual([
      {
        relativePath: 'PKG A/A-101.pdf',
        displayName: 'A-101.pdf',
        kind: 'drawing',
        status: 'current',
        sizeBytes: 42,
        modifiedAt: '2026-04-15T10:00:00.000Z',
        contentFingerprint: 'abc',
        fileDateHint: '2026-04-15',
        availability: 'local',
      },
    ])
  })

  it('does not carry the absolute path into the catalog', () => {
    // `documents.relative_path` is the project's identity for a file. Storing
    // an absolute path would break the moment the folder moved.
    expect(Object.keys(toIngestDocuments(scan)[0]!)).not.toContain('absolutePath')
  })

  it('only reconciles against a complete scan', () => {
    expect(shouldReconcile(scan)).toBe(true)
    expect(shouldReconcile({ ...scan, truncated: true })).toBe(false)
    expect(shouldReconcile({ ...scan, unreadable: ['C:/Jobs/260415/locked'] })).toBe(false)
  })

  it('describes what a scan found', () => {
    expect(describeScan(scan)).toBe('1 file')
    expect(describeScan({ ...scan, files: [] })).toBe('0 files')
    expect(describeScan({ ...scan, truncated: true })).toContain('truncated')
    expect(describeScan({ ...scan, unreadable: ['x'] })).toContain('unreadable')
  })
})
