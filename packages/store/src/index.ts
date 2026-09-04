/**
 * Project store — schema and migration runner.
 *
 * The SQL in ../migrations is ported VERBATIM from okular-redbeam
 * `shell/redbeamproject.cpp` (29 tables across 6 migration blocks). It is
 * generated, not hand-written: regenerate with tools/extract-schema.py.
 *
 * This module defines the driver interface only. Binding it to a concrete
 * SQLite (wa-sqlite in the browser, @tauri-apps/plugin-sql on the desktop,
 * better-sqlite3 in tests) is deliberately left to the host so the schema and
 * migration logic stay portable.
 */

export interface SqlDriver {
  exec(sql: string): Promise<void>
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  run(sql: string, params?: unknown[]): Promise<void>
}

export interface Migration {
  version: number
  name: string
  sql: string
}

export interface MigrateResult {
  applied: number
  /**
   * Statements skipped because the driver lacks a SQLite module (e.g. stock
   * sql.js ships FTS3 but not FTS5, so `page_text_fts` cannot be created).
   *
   * These are surfaced, never swallowed: a caller that needs the capability
   * must be able to tell the user it is missing. A native SQLite driver will
   * apply the same migrations with an empty list.
   */
  skipped: Array<{ version: number; statement: string; reason: string }>
}

/** Split generated migration SQL into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s.length > 0)
}

/**
 * Apply any migrations newer than the recorded schema version.
 *
 * Runs statement-by-statement rather than as one blob so that a single
 * unsupported statement does not abort an otherwise-applicable migration.
 * The migration files carry their own `INSERT OR IGNORE INTO schema_migrations`
 * rows, matching the Qt build.
 */
export async function migrate(db: SqlDriver, migrations: Migration[]): Promise<MigrateResult> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  )
  const rows = await db.all<{ version: number }>('SELECT version FROM schema_migrations')
  const done = new Set(rows.map((r) => r.version))

  const result: MigrateResult = { applied: 0, skipped: [] }

  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version)) continue
    for (const stmt of splitStatements(m.sql)) {
      try {
        await db.exec(stmt)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/no such module/i.test(msg)) {
          result.skipped.push({ version: m.version, statement: stmt, reason: msg })
          continue
        }
        throw new Error(`migration ${m.version} (${m.name}) failed on:\n${stmt}\n\n${msg}`)
      }
    }
    await db.run('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(?, datetime(\'now\'))', [
      m.version,
    ])
    result.applied++
  }
  return result
}

export async function schemaVersion(db: SqlDriver): Promise<number> {
  const rows = await db.all<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')
  return rows[0]?.v ?? 0
}

/**
 * Vite-style eager import of the migration SQL. Hosts without a bundler should
 * build the array themselves and pass it to migrate().
 */
export function migrationsFromGlob(glob: Record<string, string>): Migration[] {
  return Object.entries(glob)
    .map(([path, sql]) => {
      const m = /(\d+)_([a-z0-9]+)\.sql$/i.exec(path)
      return {
        version: m ? Number(m[1]) : 0,
        name: m ? m[2]! : path,
        sql,
      }
    })
    .filter((m) => m.version > 0)
    .sort((a, b) => a.version - b.version)
}
export * from './repo.js'
export * from './calculations.js'
export * from './review.js'
export * from './sqljs.js'
export * from './commands.js'
export * from './tauri-driver.js'
export * from './sync.js'
export * from './search.js'
export * from './documents.js'
export * from './scaleRegions.js'
