/**
 * Driver tests. Everything here runs without a Tauri runtime: `invoke` is
 * either injected or mocked at the module boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TauriSqlDriver,
  isTauriAvailable,
  snakeToCamel,
  camelizeKeys,
  type TauriInvokeFn,
} from './tauri-driver.js'
import { migrate, type SqlDriver } from './index.js'

// Partial mock: `invoke` is a spy, `isTauri` stays real so the availability
// test exercises the actual implementation.
const invokeSpy = vi.fn()
vi.mock('@tauri-apps/api/core', async (importActual) => {
  const actual = await importActual<typeof import('@tauri-apps/api/core')>()
  return { ...actual, invoke: (...args: unknown[]) => invokeSpy(...args) }
})

type Call = { cmd: string; args: Record<string, unknown> }

/** An injected transport that records calls and replays canned results. */
function recorder(results: Record<string, unknown> = {}) {
  const calls: Call[] = []
  const invoke: TauriInvokeFn = async (cmd, args) => {
    calls.push({ cmd, args: args ?? {} })
    return results[cmd] as never
  }
  return { calls, invoke }
}

beforeEach(() => {
  invokeSpy.mockReset()
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__
  delete (globalThis as Record<string, unknown>).isTauri
})

describe('availability detection', () => {
  it('is false in a plain (non-Tauri) context', () => {
    expect(isTauriAvailable()).toBe(false)
  })

  it('is true when the IPC internals expose a callable invoke', () => {
    ;(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: () => {} }
    expect(isTauriAvailable()).toBe(true)
  })

  it('does not accept internals without a callable invoke', () => {
    ;(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = { metadata: {} }
    expect(isTauriAvailable()).toBe(false)
  })

  it('falls back to the isTauri() flag', () => {
    ;(globalThis as Record<string, unknown>).isTauri = true
    expect(isTauriAvailable()).toBe(true)
  })
})

/**
 * Every statement carries the project it is for — see the note on
 * `TauriSqlDriver.projectPath`. These tests exercise the IPC marshalling, so
 * they name a project rather than opening one.
 */
const PROJECT = 'C:/proj'

describe('command shape', () => {
  it('sends exec / all / run under the agreed names and argument keys', async () => {
    const { calls, invoke } = recorder({ db_all: [] })
    const db = new TauriSqlDriver({ invoke, projectPath: PROJECT })

    await db.exec('CREATE TABLE t(a)')
    await db.all('SELECT * FROM t WHERE a = ?', ['x'])
    await db.run('INSERT INTO t(a) VALUES(?)', ['y'])

    expect(calls).toEqual([
      { cmd: 'db_exec', args: { projectPath: PROJECT, sql: 'CREATE TABLE t(a)' } },
      { cmd: 'db_all', args: { projectPath: PROJECT, sql: 'SELECT * FROM t WHERE a = ?', params: ['x'] } },
      { cmd: 'db_run', args: { projectPath: PROJECT, sql: 'INSERT INTO t(a) VALUES(?)', params: ['y'] } },
    ])
  })

  it('sends an empty params array when the caller omits params', async () => {
    const { calls, invoke } = recorder({ db_all: [] })
    const db = new TauriSqlDriver({ invoke, projectPath: PROJECT })
    await db.all('SELECT 1')
    await db.run('DELETE FROM t')
    expect(calls[0]!.args.params).toEqual([])
    expect(calls[1]!.args.params).toEqual([])
  })

  it('uses the real @tauri-apps/api invoke when no transport is injected', async () => {
    invokeSpy.mockResolvedValue([])
    const db = new TauriSqlDriver({ projectPath: PROJECT })
    await db.all('SELECT 1', [])
    expect(invokeSpy).toHaveBeenCalledWith('db_all', { projectPath: PROJECT, sql: 'SELECT 1', params: [] })
  })

  it('satisfies the SqlDriver interface the repositories consume', () => {
    const db: SqlDriver = new TauriSqlDriver({ invoke: recorder().invoke, projectPath: PROJECT })
    expect(typeof db.exec).toBe('function')
    expect(typeof db.all).toBe('function')
    expect(typeof db.run).toBe('function')
  })
})

describe('parameter marshalling', () => {
  async function bound(params: unknown[]): Promise<unknown[]> {
    const { calls, invoke } = recorder({ db_all: [] })
    await new TauriSqlDriver({ invoke, projectPath: PROJECT }).all('SELECT ?', params)
    return calls[0]!.args.params as unknown[]
  }

  it('passes SQLite-native values through untouched', async () => {
    expect(await bound(['a', 1, 0.100299, true, false])).toEqual(['a', 1, 0.100299, true, false])
  })

  it('normalises undefined and null to null', async () => {
    expect(await bound([undefined, null])).toEqual([null, null])
  })

  it('sends a Date as an ISO string', async () => {
    const d = new Date('2026-08-27T12:00:00.000Z')
    expect(await bound([d])).toEqual(['2026-08-27T12:00:00.000Z'])
  })

  it('refuses a Uint8Array — the core rejects array parameters and there are no BLOB columns', async () => {
    await expect(bound([new Uint8Array([1, 2, 255])])).rejects.toThrow(
      /SQL parameter 0 is an unsupported type \[object Uint8Array\]/,
    )
  })

  it('converts a safe bigint to a number', async () => {
    expect(await bound([123n])).toEqual([123])
  })

  it('rejects a structured value, naming the index — repo.ts must stringify', async () => {
    await expect(bound([{ x: 1 }])).rejects.toThrow(/SQL parameter 0 is an unsupported type/)
  })

  it('rejects NaN rather than sending null and writing a silent wrong row', async () => {
    await expect(bound([Number.NaN])).rejects.toThrow(/parameter 0 is a non-finite number/)
  })

  it('rejects a bigint beyond the safe integer range', async () => {
    await expect(bound([2n ** 70n])).rejects.toThrow(/outside the safe integer range/)
  })

  it('marshals run() parameters by the same rules', async () => {
    const { calls, invoke } = recorder()
    await new TauriSqlDriver({ invoke, projectPath: PROJECT }).run('UPDATE t SET a = ?', [undefined])
    expect(calls[0]!.args.params).toEqual([null])
  })
})

describe('row marshalling', () => {
  it('round-trips a REAL as a number, not a string', async () => {
    const { invoke } = recorder({
      db_all: [{ document_id: 'doc-1', page_id: 'page-1', feet_per_pdf_point: 0.100299, source: 'reference-line' }],
    })
    const db = new TauriSqlDriver({ invoke, projectPath: PROJECT })
    const rows = await db.all<{ feet_per_pdf_point: number }>('SELECT * FROM calibrations')
    expect(typeof rows[0]!.feet_per_pdf_point).toBe('number')
    expect(rows[0]!.feet_per_pdf_point).toBe(0.100299)
    // 300px * 0.100299 must still be exactly the quantity the README pins.
    expect(300 * rows[0]!.feet_per_pdf_point).toBeCloseTo(30.0897, 10)
  })

  it('leaves row keys in snake_case — repo.ts reads SQL column names', async () => {
    const { invoke } = recorder({
      db_all: [{ id: 'm1', document_id: 'doc-1', page_id: 'p1', geometry_json: '[]', review_state: 'accepted' }],
    })
    const rows = await new TauriSqlDriver({ invoke, projectPath: PROJECT }).all('SELECT * FROM markups')
    expect(Object.keys(rows[0]!)).toEqual(['id', 'document_id', 'page_id', 'geometry_json', 'review_state'])
  })

  it('does not coerce a TEXT column that happens to look numeric', async () => {
    const { invoke } = recorder({ db_all: [{ label: '100' }] })
    const rows = await new TauriSqlDriver({ invoke, projectPath: PROJECT }).all<{ label: string }>('SELECT label FROM scopes')
    expect(rows[0]!.label).toBe('100')
    expect(typeof rows[0]!.label).toBe('string')
  })

  it('preserves NULL as null', async () => {
    const { invoke } = recorder({ db_all: [{ scope_id: null }] })
    const rows = await new TauriSqlDriver({ invoke, projectPath: PROJECT }).all<{ scope_id: string | null }>('SELECT scope_id FROM markups')
    expect(rows[0]!.scope_id).toBeNull()
  })

  it('fails loudly if db_all returns something that is not an array', async () => {
    const { invoke } = recorder({ db_all: { oops: true } })
    await expect(new TauriSqlDriver({ invoke, projectPath: PROJECT }).all('SELECT 1')).rejects.toThrow(/expected an array of rows/)
  })
})

describe('db_open', () => {
  it('camelCases the envelope Rust returns', async () => {
    const { calls, invoke } = recorder({
      db_open: { schema_version: 6, applied: 6, skipped: [], db_path: 'C:/proj/redbeam.db' },
    })
    const db = await TauriSqlDriver.open('C:/proj', { invoke })

    // ONE spelling. Tauri's command macro lower-camel-cases the payload key it
    // looks for, so `projectPath` binds to the Rust parameter `project_path`
    // with no attribute on either side. If this ever regresses to sending both
    // keys, the crate has drifted back to mixed conventions — fix the Rust,
    // not this test.
    expect(calls[0]).toEqual({
      cmd: 'db_open',
      args: { projectPath: 'C:/proj' },
    })
    expect(db.info).toEqual({
      schemaVersion: 6,
      applied: 6,
      skipped: [],
      dbPath: 'C:/proj/redbeam.db',
    })
  })

  it('surfaces skipped statements rather than swallowing them', async () => {
    const { invoke } = recorder({
      db_open: { schema_version: 6, applied: 1, skipped: ['CREATE VIRTUAL TABLE page_text_fts'], db_path: 'x.db' },
    })
    const db = await TauriSqlDriver.open('C:/proj', { invoke })
    expect(db.info!.skipped).toEqual(['CREATE VIRTUAL TABLE page_text_fts'])
  })

  it('tolerates a partial envelope instead of producing NaN fields', async () => {
    const { invoke } = recorder({ db_open: { schema_version: 6 } })
    const db = await TauriSqlDriver.open('C:/proj', { invoke })
    expect(db.info).toEqual({ schemaVersion: 6, applied: 0, skipped: [], dbPath: '' })
  })

  it('rejects a non-object envelope', async () => {
    const { invoke } = recorder({ db_open: 'nope' })
    await expect(TauriSqlDriver.open('C:/proj', { invoke })).rejects.toThrow(/expected an object/)
  })

  it('leaves info null until open() has run', () => {
    expect(new TauriSqlDriver({ invoke: recorder().invoke, projectPath: PROJECT }).info).toBeNull()
  })
})

describe('key conversion helpers', () => {
  it('converts snake_case keys', () => {
    expect(snakeToCamel('schema_version')).toBe('schemaVersion')
    expect(snakeToCamel('feet_per_pdf_point')).toBe('feetPerPdfPoint')
    expect(snakeToCamel('db_path')).toBe('dbPath')
  })

  it('leaves already-camel and single-word keys alone', () => {
    expect(snakeToCamel('applied')).toBe('applied')
    expect(snakeToCamel('schemaVersion')).toBe('schemaVersion')
  })

  it('handles digits and trailing underscores', () => {
    expect(snakeToCamel('page_2_id')).toBe('page2Id')
    expect(snakeToCamel('trailing_')).toBe('trailing')
  })

  it('recurses into nested plain objects and arrays', () => {
    expect(camelizeKeys({ a_b: { c_d: [{ e_f: 1 }] } })).toEqual({ aB: { cD: [{ eF: 1 }] } })
  })

  it('leaves non-plain values intact', () => {
    const d = new Date(0)
    expect(camelizeKeys(d)).toBe(d)
    expect(camelizeKeys(null)).toBeNull()
    expect(camelizeKeys(3)).toBe(3)
  })
})

describe('error handling', () => {
  it('wraps a rejected invoke with the command and the statement', async () => {
    const invoke: TauriInvokeFn = async () => {
      throw 'UNIQUE constraint failed: markups.id'
    }
    await expect(new TauriSqlDriver({ invoke, projectPath: PROJECT }).run('INSERT INTO markups(id) VALUES(?)', ['m1'])).rejects.toThrow(
      /db_run: UNIQUE constraint failed: markups\.id[\s\S]*INSERT INTO markups/,
    )
  })

  it('keeps the original rejection as the cause', async () => {
    const boom = new Error('database is locked')
    const invoke: TauriInvokeFn = async () => {
      throw boom
    }
    await expect(new TauriSqlDriver({ invoke, projectPath: PROJECT }).exec('VACUUM')).rejects.toMatchObject({ cause: boom })
  })

  it('preserves "no such module" so migrate() can still record a skip', async () => {
    // migrate() pattern-matches err.message. If wrapping ate the text, an
    // otherwise-skippable statement would abort the whole migration.
    const invoke: TauriInvokeFn = async (cmd, args) => {
      const sql = String((args as { sql?: string }).sql ?? '')
      if (cmd === 'db_all') return [] as never
      if (/VIRTUAL TABLE/i.test(sql)) throw 'no such module: fts5'
      return undefined as never
    }
    const db = new TauriSqlDriver({ invoke, projectPath: PROJECT })
    const result = await migrate(db, [
      {
        version: 1,
        name: 'init',
        sql: 'CREATE TABLE t(a);\nCREATE VIRTUAL TABLE page_text_fts USING fts5(body);\n',
      },
    ])
    expect(result.applied).toBe(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.reason).toMatch(/no such module: fts5/)
  })
})
