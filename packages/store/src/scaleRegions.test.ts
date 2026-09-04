import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate, type Migration } from './index.js'
import { SqlJsDriver } from './sqljs.js'
import { ingestDocuments } from './documents.js'
import { getCalibration } from './repo.js'
import {
  applyScaleToPages, deleteScaleRegion, listAllScaleRegions, listScaleRegions,
  saveScaleRegion, type ScaleRegionRow,
} from './scaleRegions.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', 'migrations')

function loadMigrations(): Migration[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const m = /^(\d+)_([a-z0-9]+)\.sql$/i.exec(f)!
      return { version: Number(m[1]), name: m[2]!, sql: readFileSync(join(migrationsDir, f), 'utf8') }
    })
}

let db: SqlJsDriver
let docId: string
const pages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ pageNumber: i, widthPdfPoints: 612, heightPdfPoints: 792 }))

beforeEach(async () => {
  db = await SqlJsDriver.open()
  await migrate(db, loadMigrations())
  await ingestDocuments(db, [{
    relativePath: 'A-401.pdf', displayName: 'A-401.pdf', kind: 'drawing', status: 'current',
    sizeBytes: 1, contentFingerprint: 'fp', availability: 'local', pages: pages(6),
  }])
  const row = await db.all<{ id: string }>('SELECT id FROM documents LIMIT 1')
  docId = row[0]!.id
})

const region = (over: Partial<ScaleRegionRow> = {}): ScaleRegionRow => ({
  id: 'sr-1', documentId: docId, pageId: `${docId}-p0`, label: 'Detail 3',
  x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4, feetPerPdfPoint: 0.25, source: 'preset:arch-1-4',
  ...over,
})

describe('scale regions', () => {
  it('round-trips a region', async () => {
    await saveScaleRegion(db, region())
    const got = await listScaleRegions(db, `${docId}-p0`)
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ label: 'Detail 3', feetPerPdfPoint: 0.25, x0: 0.1, x1: 0.4 })
  })

  it('normalizes a rectangle dragged the other way', async () => {
    // Otherwise x0 > x1 reaches every reader as a region containing nothing,
    // and the detail silently measures at the page scale instead.
    await saveScaleRegion(db, region({ x0: 0.4, y0: 0.4, x1: 0.1, y1: 0.1 }))
    expect(await listScaleRegions(db, `${docId}-p0`)).toMatchObject([
      { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4 },
    ])
  })

  it('keeps four regions on one sheet', async () => {
    // The case the feature exists for.
    for (let i = 0; i < 4; i++) {
      await saveScaleRegion(db, region({ id: `sr-${i}`, feetPerPdfPoint: 0.25 / (i + 1) }))
    }
    expect(await listScaleRegions(db, `${docId}-p0`)).toHaveLength(4)
  })

  it('updates a region in place rather than duplicating it', async () => {
    await saveScaleRegion(db, region())
    await saveScaleRegion(db, region({ feetPerPdfPoint: 0.5, label: 'Detail 3 revised' }))
    const got = await listScaleRegions(db, `${docId}-p0`)
    expect(got).toHaveLength(1)
    expect(got[0]!.feetPerPdfPoint).toBe(0.5)
  })

  it('deletes one', async () => {
    await saveScaleRegion(db, region())
    await deleteScaleRegion(db, 'sr-1')
    expect(await listScaleRegions(db, `${docId}-p0`)).toEqual([])
  })

  it('keeps regions on the page they were drawn on', async () => {
    await saveScaleRegion(db, region({ id: 'a', pageId: `${docId}-p0` }))
    await saveScaleRegion(db, region({ id: 'b', pageId: `${docId}-p1` }))
    expect(await listScaleRegions(db, `${docId}-p0`)).toHaveLength(1)
    expect(await listAllScaleRegions(db)).toHaveLength(2)
  })

  it('returns them in a stable order', async () => {
    // Resolution breaks ties on id, so the order must not depend on the
    // database: a quantity that changes between runs cannot be explained.
    await saveScaleRegion(db, region({ id: 'z' }))
    await saveScaleRegion(db, region({ id: 'a' }))
    expect((await listScaleRegions(db, `${docId}-p0`)).map((r) => r.id)).toEqual(['a', 'z'])
  })

  it('refuses a region with no scale', async () => {
    // The CHECK constraint. A zero would divide a measurement into nothing.
    await expect(saveScaleRegion(db, region({ feetPerPdfPoint: 0 }))).rejects.toThrow()
  })
})

describe('applyScaleToPages', () => {
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => ({
      documentId: docId, pageId: `${docId}-p${from + i}`,
    }))

  it('sets one scale across a selection', async () => {
    // The 400-series gesture: select the sheets, set the scale once.
    const written = await applyScaleToPages(db, range(1, 4), 0.1111, 'preset:arch-1-8')
    expect(written).toHaveLength(4)
    for (let p = 1; p <= 4; p++) {
      expect((await getCalibration(db, `${docId}-p${p}`))?.feetPerPdfPoint).toBe(0.1111)
    }
  })

  it('touches only the pages it was given', async () => {
    // No propagation to neighbours, ever. A page nobody selected stays
    // uncalibrated and visibly so.
    await applyScaleToPages(db, range(1, 2), 0.1111, 'preset:arch-1-8')
    expect(await getCalibration(db, `${docId}-p0`)).toBeNull()
    expect(await getCalibration(db, `${docId}-p3`)).toBeNull()
  })

  it('overwrites a scale a page already had', async () => {
    await applyScaleToPages(db, range(0, 0), 0.25, 'reference-line')
    await applyScaleToPages(db, range(0, 0), 0.1111, 'preset:arch-1-8')
    expect((await getCalibration(db, `${docId}-p0`))?.feetPerPdfPoint).toBe(0.1111)
    expect((await getCalibration(db, `${docId}-p0`))?.source).toBe('preset:arch-1-8')
  })

  it('writes nothing at all when one page in the selection fails', async () => {
    // A half-applied scale is the bad state: some sheets measure and some do
    // not, and nothing on screen says which.
    const withGhost = [...range(0, 1), { documentId: docId, pageId: 'no-such-page' }]
    await expect(applyScaleToPages(db, withGhost, 0.1111, 'preset:arch-1-8')).rejects.toThrow()
    expect(await getCalibration(db, `${docId}-p0`)).toBeNull()
    expect(await getCalibration(db, `${docId}-p1`)).toBeNull()
  })

  it('refuses a scale that is not a scale', async () => {
    await expect(applyScaleToPages(db, range(0, 1), 0, 'x')).rejects.toThrow(/refusing/)
    await expect(applyScaleToPages(db, range(0, 1), -1, 'x')).rejects.toThrow(/refusing/)
    await expect(applyScaleToPages(db, range(0, 1), NaN, 'x')).rejects.toThrow(/refusing/)
  })

  it('does nothing, quietly, for an empty selection', async () => {
    expect(await applyScaleToPages(db, [], 0.1111, 'x')).toEqual([])
  })
})
