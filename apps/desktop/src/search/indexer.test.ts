import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate, SqlJsDriver, textIndexCoverage, type Migration } from '@redbeam/store'
import type { HeadlessDocument } from '../project/headlessDocument.js'
import { indexProject, type IndexProgress } from './indexer.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', '..', '..', '..', 'packages', 'store', 'migrations')

function loadMigrations(): Migration[] {
  return readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().map((f) => {
    const m = /^(\d+)_([a-z0-9]+)\.sql$/i.exec(f)!
    return { version: Number(m[1]), name: m[2]!, sql: readFileSync(join(migrationsDir, f), 'utf8') }
  })
}

let db: SqlJsDriver
beforeEach(async () => {
  db = await SqlJsDriver.open()
  await migrate(db, loadMigrations())
})

const doc = (id: string, relativePath: string, missing = false) => ({
  id, relativePath, displayName: relativePath.split('/').pop()!, missing,
})

/** A fake worker: `pages` text per page; `opened` counts boots; `closed` counts closes. */
function fakeOpener(texts: Record<string, string[]>) {
  const opened: string[] = []
  const closed: string[] = []
  const openDocument = async (url: string): Promise<HeadlessDocument> => {
    const pages = texts[url]
    if (pages === undefined) throw new Error(`cannot open ${url}`)
    opened.push(url)
    return {
      pageCount: pages.length,
      sizes: pages.map(() => ({ width: 3456, height: 2592 })),
      text: async (i) => ({ text: pages[i]!, scanned: pages[i] === '' }),
      raster: async () => { throw new Error('not rendered here') },
      close: () => { closed.push(url) },
    }
  }
  return { openDocument, opened, closed }
}

const urlOf = (d: { relativePath: string }) => Promise.resolve(`blob:${d.relativePath}`)

describe('indexProject', () => {
  it('reads every page of every document and records its text', async () => {
    const fake = fakeOpener({
      'blob:A-101.pdf': ['REFLECTED CEILING PLAN C-MT-01', 'LEGEND'],
      'blob:A-201.pdf': ['WALL PANEL WP-12'],
    })
    const progress: IndexProgress[] = []
    const out = await indexProject({
      db,
      documents: [doc('d1', 'A-101.pdf'), doc('d2', 'A-201.pdf')],
      resolveUrl: urlOf,
      releaseUrl: () => {},
      openDocument: fake.openDocument,
      onProgress: (p) => progress.push(p),
    })
    expect(out.indexedPages).toBe(3)
    expect(out.failures).toEqual([])
    expect(out.cancelled).toBe(false)
    const coverage = await textIndexCoverage(db)
    expect(coverage.indexedPageCount).toBe(3)
    expect(coverage.totalPageCount).toBe(3)
    expect(progress[0]).toEqual({ done: 0, total: 2, document: null })
    expect(progress.at(-1)).toEqual({ done: 2, total: 2, document: null })
    expect(progress.some((p) => p.document === 'A-101.pdf')).toBe(true)
    // Every worker it started, it stopped.
    expect(fake.closed).toEqual(fake.opened)
  })

  it('does not reopen a document it finished before', async () => {
    const fake = fakeOpener({ 'blob:A-101.pdf': ['one', 'two'] })
    const completed = new Set<string>()
    const run = () => indexProject({
      db, documents: [doc('d1', 'A-101.pdf')], resolveUrl: urlOf, releaseUrl: () => {},
      openDocument: fake.openDocument, completed,
    })
    await run()
    expect(completed.has('d1')).toBe(true)
    const again = await run()
    expect(again.indexedPages).toBe(0)
    expect(again.skippedDocuments).toBe(1)
    expect(fake.opened).toHaveLength(1)
  })

  it('does not call a document done while one of its pages failed', async () => {
    const opener = async (): Promise<HeadlessDocument> => ({
      pageCount: 2,
      sizes: [{ width: 1, height: 1 }, { width: 1, height: 1 }],
      text: async (i) => { if (i === 1) throw new Error('bad xref'); return { text: 'one', scanned: false } },
      raster: async () => { throw new Error('no') },
      close: () => {},
    })
    const completed = new Set<string>()
    const out = await indexProject({
      db, documents: [doc('d1', 'A-101.pdf')], resolveUrl: urlOf, releaseUrl: () => {},
      openDocument: opener, completed,
    })
    expect(out.indexedPages).toBe(1)
    expect(out.failures).toEqual([{ relativePath: 'A-101.pdf page 2', reason: 'bad xref' }])
    expect(completed.has('d1')).toBe(false)
  })

  it('skips only the pages already indexed when a document is half done', async () => {
    const fake = fakeOpener({ 'blob:A-101.pdf': ['one', 'two', 'three'] })
    // The page shown on screen was indexed by the viewer already.
    await db.run(
      "INSERT INTO documents(id, relative_path, display_name, kind, status, size_bytes, availability, created_at, updated_at) VALUES('d1','A-101.pdf','A-101.pdf','drawing','active',0,'local','t','t')",
    )
    await db.run(
      "INSERT INTO pages(id, document_id, page_number, width_pdf_points, height_pdf_points, created_at, updated_at) VALUES('d1-p1','d1',1,3456,2592,'t','t')",
    )
    await db.run(
      "INSERT INTO page_text(page_id, document_id, content, source, indexed_at) VALUES('d1-p1','d1','two','native','t')",
    )
    const out = await indexProject({
      db, documents: [doc('d1', 'A-101.pdf')], resolveUrl: urlOf, releaseUrl: () => {},
      openDocument: fake.openDocument,
    })
    expect(out.indexedPages).toBe(2)
    expect((await textIndexCoverage(db, 'd1')).indexedPageCount).toBe(3)
  })

  it('leaves a missing document alone and reports one it cannot open', async () => {
    const fake = fakeOpener({ 'blob:A-101.pdf': ['one'] })
    const out = await indexProject({
      db,
      documents: [doc('d1', 'A-101.pdf'), doc('d2', 'gone.pdf', true), doc('d3', 'locked.pdf')],
      resolveUrl: urlOf, releaseUrl: () => {}, openDocument: fake.openDocument,
    })
    expect(out.indexedPages).toBe(1)
    expect(out.failures).toEqual([{ relativePath: 'locked.pdf', reason: 'cannot open blob:locked.pdf' }])
  })

  it('stops when cancelled and says so', async () => {
    const fake = fakeOpener({ 'blob:A-101.pdf': ['one'], 'blob:A-201.pdf': ['two'] })
    let calls = 0
    const out = await indexProject({
      db, documents: [doc('d1', 'A-101.pdf'), doc('d2', 'A-201.pdf')],
      resolveUrl: urlOf, releaseUrl: () => {}, openDocument: fake.openDocument,
      isCancelled: () => ++calls > 1,
    })
    expect(out.cancelled).toBe(true)
    expect(fake.opened).toHaveLength(1)
  })

  it('records a scanned page as needing OCR so coverage counts it as looked at', async () => {
    const fake = fakeOpener({ 'blob:scan.pdf': [''] })
    await indexProject({
      db, documents: [doc('d1', 'scan.pdf')], resolveUrl: urlOf, releaseUrl: () => {},
      openDocument: fake.openDocument,
    })
    const rows = await db.all<{ source: string }>('SELECT source FROM page_text')
    expect(rows).toEqual([{ source: 'ocr-needed' }])
  })
})
