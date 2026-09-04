/**
 * SqlDriver backed by sql.js (SQLite compiled to WASM).
 *
 * Works in both the browser and Node, so the same driver runs the app and the
 * store tests — the 29-table ported schema is exercised for real rather than
 * being dead SQL.
 *
 * sql.js keeps the whole database in memory; `export()` serializes it. Callers
 * decide where those bytes live (OPFS, IndexedDB, disk). That keeps this file
 * free of any storage assumption, which matters because the desktop target is
 * expected to swap to a native SQLite later.
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import type { SqlDriver } from './index.js'

let SQL: SqlJsStatic | null = null

export interface SqlJsInitOptions {
  /** Resolve the sql-wasm.wasm URL. Required in the browser. */
  locateFile?: (file: string) => string
}

export async function loadSqlJs(opts: SqlJsInitOptions = {}): Promise<SqlJsStatic> {
  if (SQL) return SQL
  SQL = await initSqlJs(opts.locateFile ? { locateFile: opts.locateFile } : {})
  return SQL
}

export class SqlJsDriver implements SqlDriver {
  constructor(readonly db: Database) {}

  static async open(bytes?: Uint8Array, opts: SqlJsInitOptions = {}): Promise<SqlJsDriver> {
    const sql = await loadSqlJs(opts)
    const db = bytes && bytes.length > 0 ? new sql.Database(bytes) : new sql.Database()
    // Foreign keys are OFF by default in SQLite and the schema leans on them
    // (ON DELETE CASCADE / RESTRICT / SET NULL). Turn them on or the cascade
    // behaviour the Qt build relied on silently does nothing.
    db.run('PRAGMA foreign_keys = ON')
    return new SqlJsDriver(db)
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql)
  }

  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql)
    try {
      if (params.length > 0) stmt.bind(params as never)
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      return rows
    } finally {
      stmt.free()
    }
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    const stmt = this.db.prepare(sql)
    try {
      stmt.run(params as never)
    } finally {
      stmt.free()
    }
  }

  /** Serialize the whole database. Caller persists these bytes. */
  export(): Uint8Array {
    return this.db.export()
  }

  close(): void {
    this.db.close()
  }
}
