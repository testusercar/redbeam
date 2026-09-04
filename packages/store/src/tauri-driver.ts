/**
 * SqlDriver backed by the Rust core, which owns the one SQLite connection.
 *
 * The desktop app is one project per window, with optional extra "context"
 * windows onto the SAME project. sql.js cannot serve that: each window holds
 * its own in-memory copy and they diverge on the first edit. So the Rust
 * process owns the connection and every window is a view over it, reached
 * through four Tauri commands.
 *
 * The IPC contract is fixed — the Rust side is built against it:
 *
 *   db_open(projectPath: string)
 *
 * Argument keys are camelCase. Tauri's command macro lower-camel-cases the
 * payload key it looks for, so `{ projectPath }` binds to a Rust parameter
 * named `project_path` with no attribute on either side. (An earlier revision
 * of the core carried `rename_all = "snake_case"`, which forced snake_case keys
 * and disagreed with the window commands next door; that was removed so the
 * whole crate uses one convention.)
 *
 * Command NAMES are verbatim (`db_open`, not `dbOpen`), and `OpenInfo` is
 * serialized by serde as written, so its fields arrive snake_case and are
 * camelized at this boundary — see `camelizeKeys`. Row keys are NOT camelized:
 * they are SQL column names the repositories read directly.
 */
import { invoke as tauriInvoke, isTauri } from '@tauri-apps/api/core'
import type { SqlDriver } from './index.js'

/** The shape of `invoke` this driver needs. Injectable so tests need no runtime. */
export type TauriInvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

/** db_open's result, camelCased at the boundary. */
export interface DbOpenInfo {
  schemaVersion: number
  applied: number
  /** Statements the native driver could not apply. Expected to be empty. */
  skipped: string[]
  dbPath: string
}

export interface TauriSqlDriverOptions {
  /** Override the IPC transport (tests, or a proxy that adds tracing). */
  invoke?: TauriInvokeFn
  /**
   * The project this driver speaks for, when it is not being opened here.
   *
   * `TauriSqlDriver.open()` sets this itself and is how the app builds one.
   * Naming a project the core has not opened is not a way around the guard —
   * the core compares it against the connection it actually holds and refuses
   * the mismatch.
   */
  projectPath?: string
}

const defaultInvoke: TauriInvokeFn = (cmd, args) => tauriInvoke(cmd, args ?? {})

/**
 * Is this page actually running inside a Tauri webview?
 *
 * Checked, not assumed. `invoke` dereferences `window.__TAURI_INTERNALS__`
 * directly, so the presence of that object with a callable `invoke` is the
 * only thing that really predicts success; `isTauri()` (which reads the
 * `globalThis.isTauri` flag) is a secondary signal. Both are wrapped, because
 * in a plain Node context `window` is not merely absent — touching it throws.
 *
 * The browser path is a supported mode, not a failure: the app falls back to
 * sql.js there for fast iteration.
 */
export function isTauriAvailable(): boolean {
  try {
    const g = globalThis as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }
    if (typeof g.__TAURI_INTERNALS__?.invoke === 'function') return true
  } catch {
    /* fall through to the flag check */
  }
  try {
    return isTauri() === true
  } catch {
    return false
  }
}

/** snake_case -> camelCase for one key. Leaves already-camel keys alone. */
export function snakeToCamel(key: string): string {
  return key.replace(/_+([a-z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/_+$/, '')
}

/**
 * Recursively camelCase the keys of a plain object graph.
 *
 * For IPC ENVELOPES only. Never call this on a result row — see the file
 * header.
 */
export function camelizeKeys<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camelizeKeys(v)) as unknown as T
  if (value === null || typeof value !== 'object') return value as T
  // Anything with a prototype of its own (Date, Uint8Array, class instances)
  // is data, not an envelope — leave it intact.
  const proto = Object.getPrototypeOf(value) as unknown
  if (proto !== Object.prototype && proto !== null) return value as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[snakeToCamel(k)] = camelizeKeys(v)
  }
  return out as T
}

function abbreviate(sql: string): string {
  const flat = sql.replace(/\s+/g, ' ').trim()
  return flat.length > 300 ? `${flat.slice(0, 300)}...` : flat
}

function paramError(index: number, why: string, sql: string): string {
  return `SQL parameter ${index} is ${why}\nSQL: ${abbreviate(sql)}`
}

/**
 * Marshal one bound parameter for the IPC hop.
 *
 * SQLite takes five value types; JSON takes fewer. Anything that would land on
 * the Rust side as a shape it cannot bind is rejected HERE, with its index, so
 * the failure names the offending argument instead of surfacing as a serde
 * error about a statement 400 characters long. repo.ts already JSON.stringify's
 * every structured column, so a raw object arriving here is a bug in the
 * caller, not a case to be helpful about.
 */
function toIpcParam(value: unknown, index: number, sql: string): unknown {
  if (value === undefined || value === null) return null

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error(paramError(index, `a non-finite number (${String(value)})`, sql))
      }
      return value
    case 'bigint':
      if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new Error(paramError(index, `a bigint (${value}) outside the safe integer range`, sql))
      }
      return Number(value)
    default:
      break
  }

  if (value instanceof Date) return value.toISOString()

  // Everything else — objects, arrays, Uint8Array — is refused. The core binds
  // parameters from JSON and rejects arrays and objects outright ("stringify it
  // first"), so sending one would only move the same failure across the IPC hop
  // and lose the argument index on the way. There are no BLOB columns in the
  // ported schema for a byte array to target.
  throw new Error(
    paramError(
      index,
      `an unsupported type ${Object.prototype.toString.call(value)} — bind a string, number, ` +
        `boolean, null or Date (JSON columns must be stringified by the caller)`,
      sql,
    ),
  )
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

/**
 * Turn a rejected invoke into an Error that still carries the SQLite message.
 *
 * Tauri rejects with whatever the Rust command put in `Err(...)`, usually a
 * bare string. `migrate()` in ./index.ts tests the message against
 * /no such module/i to decide whether a statement is skippable, so the
 * original text MUST survive wrapping — dropping it would turn a reported skip
 * into a hard migration failure.
 */
function wrapIpcError(cmd: string, sql: string | null, err: unknown): Error {
  const detail =
    err instanceof Error ? err.message : typeof err === 'string' ? err : safeStringify(err)
  const wrapped = new Error(
    sql === null ? `${cmd}: ${detail}` : `${cmd}: ${detail}\nSQL: ${abbreviate(sql)}`,
  )
  wrapped.cause = err
  return wrapped
}

/**
 * SqlDriver over the Rust core.
 *
 * Implements exactly the interface repositories and commands already consume,
 * so nothing downstream changes when a window swaps sql.js for this.
 */
export class TauriSqlDriver implements SqlDriver {
  private readonly invoke: TauriInvokeFn
  /** db_open's result, or null until open() has run. */
  info: DbOpenInfo | null = null
  /**
   * The project this driver speaks for, sent with EVERY statement.
   *
   * The core holds one connection for the whole process, so before this the
   * destination of a write was decided by whatever was open at the moment it
   * landed — not by who issued it. A folder scan that outlived its project
   * therefore ingested into the next one, and on 2026-09-03 that put 625
   * documents from two other jobs into the Barclays project's database and
   * Barclays' three into CoreWeave's.
   *
   * Passing it on every call lets the core refuse, under the same lock as the
   * write, rather than obey. A late scan now fails loudly instead of
   * cataloguing one client's drawings under another's bid.
   */
  private projectPath: string | null = null

  constructor(opts: TauriSqlDriverOptions = {}) {
    this.invoke = opts.invoke ?? defaultInvoke
    this.projectPath = opts.projectPath ?? null
  }

  /**
   * Open (or create) the project database in the core and run its migrations.
   *
   * Resolves with the driver; `driver.info` holds the schema version and the
   * skipped-statement list. Skips are surfaced, never swallowed — a native
   * build restores FTS5 and should report none, and if it ever does report
   * some, the caller has to be able to tell the user what is missing.
   */
  static async open(projectPath: string, opts: TauriSqlDriverOptions = {}): Promise<TauriSqlDriver> {
    const driver = new TauriSqlDriver(opts)
    driver.info = await driver.openProject(projectPath)
    return driver
  }

  private async openProject(projectPath: string): Promise<DbOpenInfo> {
    let raw: unknown
    try {
      // Both spellings — see the ARGUMENT KEYS note in the file header.
      raw = await this.invoke<unknown>('db_open', { projectPath })
      this.projectPath = projectPath
    } catch (err) {
      throw wrapIpcError('db_open', null, err)
    }
    if (raw === null || typeof raw !== 'object') {
      throw new Error(`db_open returned ${safeStringify(raw)}, expected an object`)
    }
    const camel = camelizeKeys<Partial<DbOpenInfo>>(raw)
    return {
      schemaVersion: Number(camel.schemaVersion ?? 0),
      applied: Number(camel.applied ?? 0),
      skipped: Array.isArray(camel.skipped) ? camel.skipped.map(String) : [],
      dbPath: String(camel.dbPath ?? ''),
    }
  }

  async exec(sql: string): Promise<void> {
    try {
      await this.invoke<void>('db_exec', { projectPath: this.forProject(), sql })
    } catch (err) {
      throw wrapIpcError('db_exec', sql, err)
    }
  }

  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const bound = params.map((p, i) => toIpcParam(p, i, sql))
    let rows: unknown
    try {
      rows = await this.invoke<unknown>('db_all', { projectPath: this.forProject(), sql, params: bound })
    } catch (err) {
      throw wrapIpcError('db_all', sql, err)
    }
    if (!Array.isArray(rows)) {
      throw new Error(
        `db_all returned ${safeStringify(rows)}, expected an array of rows\nSQL: ${abbreviate(sql)}`,
      )
    }
    // Rows are handed back with their SQL column names untouched. See header.
    return rows as T[]
  }

  /**
   * The project every statement is tagged with.
   *
   * Throws rather than sending an empty string: the core resolves '' to an
   * in-memory database, so an untagged statement would not be refused — it
   * would be answered by a different database that happens to be empty.
   */
  private forProject(): string {
    if (this.projectPath === null) {
      throw new Error('this driver has no project open — call open() before running statements')
    }
    return this.projectPath
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    const bound = params.map((p, i) => toIpcParam(p, i, sql))
    try {
      await this.invoke<void>('db_run', { projectPath: this.forProject(), sql, params: bound })
    } catch (err) {
      throw wrapIpcError('db_run', sql, err)
    }
  }
}
