import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate, type Migration } from './index.js'
import { SqlJsDriver } from './sqljs.js'
import { ensureDocumentAndPage, upsertScope } from './repo.js'
import {
  freezeLayout, latestCalculation, latestFrozenCalculation, listCalculationQuantities,
  listCalculations, listLayoutComponents, recordCalculation, type CalculationInput,
} from './calculations.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', 'migrations')

const loadMigrations = (): Migration[] =>
  readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const m = /^(\d+)_([a-z0-9]+)\.sql$/i.exec(f)!
      return { version: Number(m[1]), name: m[2]!, sql: readFileSync(join(migrationsDir, f), 'utf8') }
    })

const DOC = { id: 'doc-1', relativePath: 'sample.pdf', displayName: 'Sample' }
const PAGE = { id: 'page-1', documentId: 'doc-1', pageNumber: 1, width: 3456, height: 2592 }

let db: SqlJsDriver

const input = (over: Partial<CalculationInput> = {}): CalculationInput => ({
  scopeId: 's1',
  engineVersion: 'redbeam-runs-1',
  specificationsSnapshot: { productType: 'baffle', spacing: '2' },
  calibrationSnapshot: { 'page-1': { feetPerPoint: 0.1 } },
  sourceSnapshot: { documentId: 'doc-1' },
  geometrySnapshot: { pages: [{ pageId: 'page-1' }] },
  warnings: [],
  resultSummary: { netSquareFeet: 100 },
  quantities: [
    { itemKey: 'primary_stock', label: 'Baffle stock', quantity: 12, unit: 'EA' },
    { itemKey: 'end_caps', label: 'End caps', quantity: 8, unit: 'EA' },
  ],
  components: [
    {
      documentId: 'doc-1', pageId: 'page-1', componentKind: 'primary',
      geometry: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      properties: { stockFraction: 1, family: 'full' },
    },
    {
      documentId: 'doc-1', pageId: 'page-1', componentKind: 'suspension_rail',
      geometry: { start: { x: 0, y: 0 }, end: { x: 0, y: 10 } },
      properties: { stockFraction: 0.5 },
    },
  ],
  ...over,
})

beforeEach(async () => {
  db = await SqlJsDriver.open()
  await migrate(db, loadMigrations())
  await ensureDocumentAndPage(db, DOC, PAGE)
  await upsertScope(db, {
    id: 's1', label: 'CL03 Baffle', scopeType: 'area', color: '#E8555A',
    specifications: {}, archivedAt: null,
  })
})

describe('recording a calculation', () => {
  it('stores the run, its quantities and its components together', async () => {
    const id = await recordCalculation(db, input())

    const run = await latestCalculation(db, 's1')
    expect(run?.id).toBe(id)
    expect(run?.engineVersion).toBe('redbeam-runs-1')
    expect(run?.resultSummary).toEqual({ netSquareFeet: 100 })

    const quantities = await listCalculationQuantities(db, id)
    expect(quantities.map((q) => q.itemKey)).toEqual(['primary_stock', 'end_caps'])
    expect(quantities[0]?.quantity).toBe(12)

    const components = await listLayoutComponents(db, id)
    expect(components.map((c) => c.componentKind)).toEqual(['primary', 'suspension_rail'])
    expect(components[0]?.geometry).toEqual({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } })
    expect(components[1]?.properties).toEqual({ stockFraction: 0.5 })
  })

  /**
   * A run whose quantities landed and whose components did not would be a
   * frozen bid with no evidence behind it — worse than no record at all.
   */
  it('writes nothing at all when a component is rejected', async () => {
    await expect(recordCalculation(db, input({
      components: [{
        documentId: 'doc-1', pageId: 'page-does-not-exist', componentKind: 'primary',
        geometry: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      }],
    }))).rejects.toThrow()

    expect(await listCalculations(db, 's1')).toEqual([])
  })

  it('keeps every run rather than replacing the last', async () => {
    await recordCalculation(db, input(), '2026-09-01T10:00:00Z')
    await recordCalculation(db, input(), '2026-09-01T11:00:00Z')
    const runs = await listCalculations(db, 's1')
    expect(runs).toHaveLength(2)
    expect(runs[0]?.createdAt).toBe('2026-09-01T11:00:00Z')
  })

  it('reports no calculation for a scope that has never had one', async () => {
    expect(await latestCalculation(db, 's1')).toBeNull()
    expect(await latestFrozenCalculation(db, 's1')).toBeNull()
  })
})

describe('freezing', () => {
  it('locks every component and stamps when it happened', async () => {
    const id = await recordCalculation(db, input())
    expect((await latestCalculation(db, 's1'))?.frozen).toBe(false)

    await freezeLayout(db, id, '2026-09-02T09:00:00Z')

    const run = await latestCalculation(db, 's1')
    expect(run?.frozen).toBe(true)
    expect(run?.state).toBe('frozen')
    expect(run?.acceptedAt).toBe('2026-09-02T09:00:00Z')
    expect((await listLayoutComponents(db, id)).every((c) => c.frozen)).toBe(true)
  })

  /**
   * The whole point: the sent number stops moving. Recalculating after a freeze
   * adds a NEW run and leaves the frozen one exactly as it was, so the two can
   * be shown side by side and the caller says which it is quoting.
   */
  it('leaves the frozen run untouched when the scope is recalculated', async () => {
    const frozen = await recordCalculation(db, input(), '2026-09-01T10:00:00Z')
    await freezeLayout(db, frozen, '2026-09-01T10:05:00Z')

    const after = await recordCalculation(db, input({
      quantities: [{ itemKey: 'primary_stock', label: 'Baffle stock', quantity: 99, unit: 'EA' }],
    }), '2026-09-03T10:00:00Z')

    expect((await latestCalculation(db, 's1'))?.id).toBe(after)
    expect((await latestFrozenCalculation(db, 's1'))?.id).toBe(frozen)
    const quantities = await listCalculationQuantities(db, frozen)
    expect(quantities.find((q) => q.itemKey === 'primary_stock')?.quantity).toBe(12)
  })

  it('does not move accepted_at when a run is frozen twice', async () => {
    const id = await recordCalculation(db, input())
    await freezeLayout(db, id, '2026-09-02T09:00:00Z')
    await freezeLayout(db, id, '2026-09-05T09:00:00Z')
    expect((await latestCalculation(db, 's1'))?.acceptedAt).toBe('2026-09-02T09:00:00Z')
  })

  /**
   * An empty calculation is exactly the one that must not read as sendable —
   * `0 of 0 components frozen` is not a frozen bid.
   */
  it('does not call a run with no components frozen', async () => {
    const id = await recordCalculation(db, input({ components: [] }))
    await freezeLayout(db, id)
    expect((await latestCalculation(db, 's1'))?.frozen).toBe(false)
  })
})

/**
 * Committing five scopes in quick succession lost one of them, silently, with
 * the caller told it had succeeded.
 *
 * Each write wraps itself in BEGIN/COMMIT and the app holds ONE connection, so
 * two in flight means the second BEGIN lands inside the first transaction and
 * throws — and its rollback takes the first one down with it.
 */
describe('concurrent calculation writes', () => {
  it('records every run when several are started at once', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      await upsertScope(db, {
        id, label: id, scopeType: 'area', color: '#000', specifications: {}, archivedAt: null,
      })
    }
    const inputs = ['a', 'b', 'c', 'd', 'e'].map((scopeId) => ({
      scopeId,
      engineVersion: 'test/1',
      specificationsSnapshot: {},
      calibrationSnapshot: {},
      sourceSnapshot: {},
      geometrySnapshot: {},
      quantities: [{ itemKey: 'x', label: 'X', quantity: 1, unit: 'EA' }],
      components: [],
    }))
    // Started together, not awaited one at a time: this is what the bridge and
    // a person clicking down a list of scopes both do.
    const ids = await Promise.all(inputs.map((i) => recordCalculation(db, i)))
    expect(new Set(ids).size).toBe(5)
    const rows = await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM calculation_runs')
    expect(rows[0]?.n).toBe(5)
  })

  it('does not let one failed write poison the ones queued behind it', async () => {
    await upsertScope(db, {
      id: 'ok', label: 'ok', scopeType: 'area', color: '#000', specifications: {}, archivedAt: null,
    })
    const good = {
      scopeId: 'ok', engineVersion: 'test/1',
      specificationsSnapshot: {}, calibrationSnapshot: {},
      sourceSnapshot: {}, geometrySnapshot: {},
      quantities: [], components: [],
    }
    // A run whose scope violates a constraint, started before a valid one.
    const bad = { ...good, scopeId: 'no-such-scope' }
    const results = await Promise.allSettled([
      recordCalculation(db, bad as never),
      recordCalculation(db, good),
    ])
    expect(results[1]?.status).toBe('fulfilled')
  })
})
