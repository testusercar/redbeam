import { describe, expect, it } from 'vitest'
import { SqlJsDriver } from './sqljs.js'
import { runBatch, type SqlStatement } from './batch.js'
import type { SqlDriver } from './index.js'

const rows = async (db: SqlDriver) =>
  (await db.all<{ x: number }>('SELECT x FROM probe ORDER BY x')).map((r) => r.x)

describe('runBatch', () => {
  it('runs every statement, in order', async () => {
    const db = await SqlJsDriver.open()
    await db.exec('CREATE TABLE probe (x INTEGER PRIMARY KEY)')
    await runBatch(db, [
      { sql: 'INSERT INTO probe VALUES (?)', params: [1] },
      { sql: 'INSERT INTO probe VALUES (?)', params: [2] },
      { sql: 'UPDATE probe SET x = ? WHERE x = ?', params: [3, 2] },
    ])
    expect(await rows(db)).toEqual([1, 3])
  })

  it('is all or none on a driver that can batch', async () => {
    const db = await SqlJsDriver.open()
    await db.exec('CREATE TABLE probe (x INTEGER PRIMARY KEY)')
    await db.run('INSERT INTO probe VALUES (1)')
    await expect(runBatch(db, [
      { sql: 'INSERT INTO probe VALUES (?)', params: [2] },
      { sql: 'INSERT INTO probe VALUES (?)', params: [1] },
    ])).rejects.toThrow()
    expect(await rows(db)).toEqual([1])
    // Usable afterwards, and not left inside a transaction.
    await db.run('INSERT INTO probe VALUES (5)')
    await db.exec('BEGIN')
    await db.exec('ROLLBACK')
    expect(await rows(db)).toEqual([1, 5])
  })

  it('falls back to one statement at a time on a driver without batch', async () => {
    const seen: SqlStatement[] = []
    const db: SqlDriver = {
      exec: async () => {},
      all: async () => [],
      run: async (sql, params) => { seen.push({ sql, params: params ?? [] }) },
    }
    await runBatch(db, [{ sql: 'A', params: [1] }, { sql: 'B' }])
    expect(seen).toEqual([{ sql: 'A', params: [1] }, { sql: 'B', params: [] }])
  })

  it('does nothing for nothing', async () => {
    let called = false
    const db: SqlDriver = {
      exec: async () => {}, all: async () => [], run: async () => {},
      batch: async () => { called = true },
    }
    await runBatch(db, [])
    expect(called).toBe(false)
  })
})
