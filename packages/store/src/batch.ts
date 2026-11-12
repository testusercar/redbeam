/**
 * Several statements, one commit.
 *
 * Its own module rather than in `index.ts` so the modules that batch
 * (`search.ts`, `documents.ts`) do not import a value from the barrel that
 * re-exports them.
 */
import type { SqlDriver } from './index.js'

export interface SqlStatement {
  sql: string
  params?: unknown[]
}

/**
 * Run statements together: in one transaction where the driver can, in order
 * either way.
 *
 * On the desktop every statement run alone is a commit of its own, and since
 * the project moved to a rollback journal (0.3.5) a commit is a journal file
 * created, flushed and deleted inside what is usually a SharePoint-synced job
 * folder. That cost ~13 ms per statement, six statements per indexed sheet.
 * A batch is one IPC call and one commit.
 *
 * Deliberately not `BEGIN`/`COMMIT` issued from here: the desktop shares one
 * connection between every window and every effect, so another write could
 * land between two awaited statements and be swept into (or rolled back with)
 * this transaction. The driver runs a batch under its own lock instead.
 */
export async function runBatch(db: SqlDriver, statements: readonly SqlStatement[]): Promise<void> {
  if (statements.length === 0) return
  if (db.batch) {
    await db.batch(statements)
    return
  }
  for (const s of statements) await db.run(s.sql, s.params ?? [])
}
