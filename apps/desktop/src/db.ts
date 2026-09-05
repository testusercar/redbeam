/**
 * Database wiring — picks a driver for the environment.
 *
 * Under Tauri the Rust core owns a single SQLite connection and every window is
 * a view over it. In a plain browser we fall back to sql.js so the app still
 * runs for fast iteration, at the cost of being single-window and lacking FTS5.
 *
 * These are not interchangeable in one respect worth stating plainly: sql.js
 * holds the database in memory PER PAGE. Two browser tabs on one project would
 * diverge silently. That is exactly why the desktop path exists, and why the
 * browser path is a development convenience rather than a supported mode.
 */
import {
  migrate,
  migrationsFromGlob,
  SqlJsDriver,
  TauriSqlDriver,
  isTauriAvailable,
  type MigrateResult,
  type SqlDriver,
} from '@redbeam/store'

const DB_NAME = 'redbeam'
const STORE = 'db'
const KEY = 'project'

const migrationSql = import.meta.glob('../../../packages/store/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export type DbBackend = 'tauri' | 'sqljs'

export interface OpenedDb {
  driver: SqlDriver
  backend: DbBackend
  migration: MigrateResult
  /** Where the data actually lives — a file path under Tauri, IndexedDB otherwise. */
  location: string
  /** Persist current state. A no-op under Tauri: the core writes through. */
  save: () => Promise<void>
  reset: () => Promise<void>
  /** This window is done with the project. Under Tauri the core drops the connection once every window is. */
  close: () => Promise<void>
}

// ------------------------------------------------------------------ tauri --

async function openTauri(projectPath: string): Promise<OpenedDb> {
  const driver = await TauriSqlDriver.open(projectPath)
  const info = driver.info!

  const migration: MigrateResult = {
    applied: info.applied,
    // The core reports what it could not apply, in the same shape. With native
    // SQLite this should be empty — FTS5 is compiled in — so anything here is
    // a real regression, not the known sql.js gap.
    skipped: info.skipped.map((statement) => ({
      version: 0,
      statement,
      reason: 'reported by the core',
    })),
  }
  if (migration.skipped.length > 0) {
    console.warn('[store] core skipped statements — unexpected on native SQLite:', info.skipped)
  }

  return {
    driver,
    backend: 'tauri',
    migration,
    location: info.dbPath,
    save: async () => {},
    reset: async () => {
      throw new Error('reset is not supported on the desktop store; delete the project database file')
    },
    close: () => driver.close(),
  }
}

// ------------------------------------------------------------------ sql.js --

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function loadBytes(): Promise<Uint8Array | undefined> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
    tx.onsuccess = () => resolve(tx.result as Uint8Array | undefined)
    tx.onerror = () => reject(tx.error)
  })
}

async function storeBytes(bytes: Uint8Array): Promise<void> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(bytes, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function openSqlJs(): Promise<OpenedDb> {
  const existing = await loadBytes()
  const driver = await SqlJsDriver.open(existing, { locateFile: () => '/sql-wasm.wasm' })
  const migration = await migrate(driver, migrationsFromGlob(migrationSql))

  if (migration.skipped.length > 0) {
    // Expected here: stock sql.js ships FTS3, not FTS5, so page_text_fts cannot
    // be created and full-text search is unavailable in browser mode.
    console.warn(
      `[store] ${migration.skipped.length} statement(s) skipped — sql.js lacks a module:`,
      migration.skipped.map((s) => s.reason),
    )
  }

  return {
    driver,
    backend: 'sqljs',
    migration,
    location: 'IndexedDB (browser fallback)',
    save: async () => {
      await storeBytes(driver.export())
    },
    reset: async () => {
      const db = await idb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).delete(KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    },
    // The in-memory database has nothing to release; the last save is the close.
    close: async () => { await storeBytes(driver.export()) },
  }
}

// ------------------------------------------------------------------- open --

export async function openDatabase(projectPath = '.'): Promise<OpenedDb> {
  if (isTauriAvailable()) {
    try {
      return await openTauri(projectPath)
    } catch (err) {
      // Do not silently fall back: on the desktop the sql.js path is
      // single-window and would diverge across windows. Fail loudly instead.
      throw new Error(
        `Could not open the project database through the desktop core: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return openSqlJs()
}

/**
 * Coalesce saves. Only meaningful for sql.js, which must re-export the whole
 * database; the Tauri core writes through on every statement.
 */
export function debounceSave(save: () => Promise<void>, ms = 400): () => void {
  let t: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (t) clearTimeout(t)
    t = setTimeout(() => {
      void save()
    }, ms)
  }
}
