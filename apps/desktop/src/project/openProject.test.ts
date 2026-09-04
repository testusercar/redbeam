import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate, SqlJsDriver, listDocuments, listMarkups, insertMarkup, type Migration } from '@redbeam/store'
import { openProjectDocuments, type ProjectScanner } from './openProject.js'
import type { ScanResult, ScannedFile } from './types.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', '..', '..', '..', 'packages', 'store', 'migrations')

function loadMigrations(): Migration[] {
  return readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().map((f) => {
    const m = /^(\d+)_([a-z0-9]+)\.sql$/i.exec(f)!
    return { version: Number(m[1]), name: m[2]!, sql: readFileSync(join(migrationsDir, f), 'utf8') }
  })
}

const file = (relativePath: string, over: Partial<ScannedFile> = {}): ScannedFile => ({
  relativePath,
  absolutePath: `C:/proj/${relativePath}`,
  displayName: relativePath.split('/').pop()!,
  kind: 'drawing',
  status: 'active',
  sizeBytes: 1024,
  modifiedAt: '2026-08-28T00:00:00.000Z',
  contentFingerprint: `fp-${relativePath}`,
  availability: 'local',
  fileDateHint: null,
  ...over,
})

const scan = (files: ScannedFile[], over: Partial<ScanResult> = {}): ScanResult => ({
  root: 'C:/proj',
  files,
  truncated: false,
  unreadable: [],
  scannedAt: '2026-08-28T00:00:00.000Z',
  ...over,
})

const scanner = (result: ScanResult | (() => Promise<ScanResult>)): ProjectScanner => ({
  scanProject: typeof result === 'function' ? result : async () => result,
})

const DRAWINGS = [
  file('Drawings/A-201 Reflected Ceiling.pdf'),
  file('Drawings/A-514 Finish Plan.pdf'),
  file('Specs/Section 09.pdf'),
]

let db: SqlJsDriver

beforeEach(async () => {
  db = await SqlJsDriver.open()
  await migrate(db, loadMigrations())
})

describe('opening a project', () => {
  it('ingests every PDF the scan found', async () => {
    const r = await openProjectDocuments(db, scanner(scan(DRAWINGS)), 'C:/proj')
    expect(r.documents).toHaveLength(3)
    expect(r.documents.map((d) => d.relativePath).sort()).toEqual([
      'Drawings/A-201 Reflected Ceiling.pdf',
      'Drawings/A-514 Finish Plan.pdf',
      'Specs/Section 09.pdf',
    ])
    expect(r.note).toBeNull()
    expect(r.complete).toBe(true)
  })

  it('is idempotent — reopening creates nothing and keeps ids', async () => {
    const first = await openProjectDocuments(db, scanner(scan(DRAWINGS)), 'C:/proj')
    const idsBefore = first.documents.map((d) => d.id).sort()

    const second = await openProjectDocuments(db, scanner(scan(DRAWINGS)), 'C:/proj')
    expect(second.documents).toHaveLength(3)
    expect(second.created).toBe(0)
    expect(second.documents.map((d) => d.id).sort()).toEqual(idsBefore)
  })

  it('keeps a markup across a reopen', async () => {
    const first = await openProjectDocuments(db, scanner(scan(DRAWINGS)), 'C:/proj')
    const doc = first.documents.find((d) => d.relativePath.endsWith('A-514 Finish Plan.pdf'))!
    // A page row is needed before a markup can reference it.
    await db.run(
      `INSERT INTO pages(id, document_id, page_number, width_pdf_points, height_pdf_points, created_at, updated_at)
       VALUES(?,?,?,?,?,datetime('now'),datetime('now'))`,
      [`${doc.id}-p0`, doc.id, 0, 3456, 2592],
    )
    await insertMarkup(db, {
      id: 'mk-1', documentId: doc.id, pageId: `${doc.id}-p0`, scopeId: null,
      kind: 'area', rings: [[{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }]],
      origin: 'user', reviewState: 'accepted',
    })

    await openProjectDocuments(db, scanner(scan(DRAWINGS)), 'C:/proj')
    // This is the whole point of a derived, stable document id: reopening a
    // project must not orphan work already done in it.
    expect(await listMarkups(db)).toHaveLength(1)
  })

  it('does NOT reconcile a truncated scan', async () => {
    await openProjectDocuments(db, scanner(scan(DRAWINGS)), 'C:/proj')
    // The walk was cut short and saw only one file. Absence here is not
    // evidence of deletion — the other two must not be marked missing.
    const partial = await openProjectDocuments(
      db, scanner(scan([DRAWINGS[0]!], { truncated: true })), 'C:/proj',
    )
    expect(partial.complete).toBe(false)
    expect(partial.note).toMatch(/not reconciled/i)
    const missing = partial.documents.filter((d) => d.missing)
    expect(missing).toHaveLength(0)
  })

  it('does NOT reconcile when a folder could not be read', async () => {
    await openProjectDocuments(db, scanner(scan(DRAWINGS)), 'C:/proj')
    const partial = await openProjectDocuments(
      db, scanner(scan([DRAWINGS[0]!], { unreadable: ['Specs'] })), 'C:/proj',
    )
    expect(partial.complete).toBe(false)
    expect(partial.documents.filter((d) => d.missing)).toHaveLength(0)
  })

  it('opens anyway when the scan throws, naming the problem', async () => {
    await openProjectDocuments(db, scanner(scan(DRAWINGS)), 'C:/proj')
    const broken = await openProjectDocuments(
      db,
      scanner(async () => { throw new Error('network share unavailable') }),
      'C:/proj',
    )
    // Refusing to open would lock an estimator out of a takeoff they have
    // already done because a share blipped.
    expect(broken.documents).toHaveLength(3)
    expect(broken.note).toContain('network share unavailable')
    expect(broken.complete).toBe(false)
  })

  it('says so when the folder has no PDFs', async () => {
    const r = await openProjectDocuments(db, scanner(scan([])), 'C:/proj')
    expect(r.documents).toHaveLength(0)
    expect(r.note).toMatch(/no pdfs/i)
  })

  /**
   * A scan the user has walked away from must not write.
   *
   * The scan is the slow part, and the store holds ONE connection for the
   * process: a scan that finished after the user opened something else used to
   * ingest into whatever database was open by then. That is how the Barclays
   * project came to hold 625 documents from two other jobs, and CoreWeave's to
   * hold Barclays' three.
   */
  it('writes nothing when the open was superseded while scanning', async () => {
    const before = await listDocuments(db)
    const r = await openProjectDocuments(
      db, scanner(scan([file('A-101.pdf'), file('A-102.pdf')])), 'C:/proj', () => true,
    )
    expect(r.created).toBe(0)
    expect(r.updated).toBe(0)
    // The real assertion is not the counts it reports but the rows it left.
    expect(await listDocuments(db)).toHaveLength(before.length)
  })

  it('still writes when the open is current', async () => {
    const r = await openProjectDocuments(
      db, scanner(scan([file('A-101.pdf')])), 'C:/proj', () => false,
    )
    expect(r.documents.length).toBeGreaterThan(0)
  })
})
