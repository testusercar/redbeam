/**
 * Index every sheet's text as soon as the project is open.
 *
 * Text used to be extracted for a page when that page was SHOWN, and for a
 * whole document only when its sheet labels needed reading. Search then
 * reported honest coverage — "12 of 693 pages indexed" — and honest coverage
 * of two per cent is still a search that finds nothing. An estimator looking
 * for every sheet that says "C-MT-01" needs the whole set read, and the set
 * is known the moment the folder has been scanned. Aaron: "Begin search
 * indexing as soon as a project file is created."
 *
 * One document at a time, in a worker of its own, so the sheet on screen is
 * never competing with it for the viewer's worker. A page already in
 * `page_text` is skipped, and a document this indexer has finished before is
 * not even opened: the caller keeps that list (`completed`), because the
 * store cannot tell "every page indexed" from "every page that was ever
 * viewed indexed" — the viewer writes a page row only for the sheets it
 * showed, so a page count from the store is a count of visits, not of pages.
 *
 * Everything it touches arrives as an argument, so the sequence can be
 * exercised with a fake database and a fake worker.
 */
import {
  ensureDocumentAndPage, indexPageText, pageIdFor, type DocumentRow, type SqlDriver,
} from '@redbeam/store'
import type { HeadlessDocument } from '../project/headlessDocument.js'

export interface IndexProgress {
  /** Documents finished, including ones skipped as already indexed. */
  done: number
  total: number
  /** What is being read now, for the tooltip. Null between documents. */
  document: string | null
}

export interface IndexOutcome {
  indexedPages: number
  /** Documents left alone because every page was already recorded. */
  skippedDocuments: number
  /** Documents that could not be read, with why. Never fatal to the run. */
  failures: Array<{ relativePath: string; reason: string }>
  cancelled: boolean
}

export interface IndexProjectOptions {
  db: SqlDriver
  documents: readonly Pick<DocumentRow, 'id' | 'relativePath' | 'displayName' | 'missing'>[]
  /** A URL the worker can fetch for this document, or null when it cannot be read. */
  resolveUrl: (doc: { relativePath: string }) => Promise<string | null>
  releaseUrl: (url: string) => void
  openDocument: (url: string) => Promise<HeadlessDocument>
  onProgress?: (p: IndexProgress) => void
  isCancelled?: () => boolean
  /**
   * Documents this indexer has read to the end before, so they are skipped
   * without being opened. Keyed however the caller likes — the workspace
   * keys by document id and content fingerprint, so a replaced drawing is
   * read again. Absent means every document is opened every time.
   */
  completed?: { has: (documentId: string) => boolean; add: (documentId: string) => void }
}

/** Page ids of this document that already carry text. */
async function indexedPages(db: SqlDriver, documentId: string): Promise<Set<string>> {
  const rows = await db.all<{ page_id: string }>(
    'SELECT page_id FROM page_text WHERE document_id = ?', [documentId],
  )
  return new Set(rows.map((r) => r.page_id))
}

export async function indexProject(opts: IndexProjectOptions): Promise<IndexOutcome> {
  const { db } = opts
  const cancelled = opts.isCancelled ?? (() => false)
  const docs = opts.documents.filter((d) => !d.missing)
  const out: IndexOutcome = { indexedPages: 0, skippedDocuments: 0, failures: [], cancelled: false }
  const report = (done: number, document: string | null) =>
    opts.onProgress?.({ done, total: docs.length, document })

  report(0, null)
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]!
    if (cancelled()) { out.cancelled = true; break }

    if (opts.completed?.has(doc.id) === true) {
      out.skippedDocuments++
      report(i + 1, null)
      continue
    }
    const have = await indexedPages(db, doc.id)

    report(i, doc.displayName || doc.relativePath)
    let url: string | null = null
    let opened: HeadlessDocument | null = null
    try {
      url = await opts.resolveUrl(doc)
      if (url === null) throw new Error('the file could not be read')
      opened = await opts.openDocument(url)
      let complete = true
      for (let page = 0; page < opened.pageCount; page++) {
        if (cancelled()) { out.cancelled = true; complete = false; break }
        const pageId = pageIdFor(doc.id, page)
        const size = opened.sizes[page]
        // page_text has a foreign key to pages, so the row has to exist first.
        // Written for every page, so the sheet index and search coverage know
        // the document's true length before any page has been viewed.
        await ensureDocumentAndPage(db, doc, {
          id: pageId, documentId: doc.id, pageNumber: page,
          width: size?.width ?? 0, height: size?.height ?? 0,
        })
        if (have.has(pageId)) continue
        try {
          const pt = await opened.text(page)
          await indexPageText(db, {
            pageId, documentId: doc.id, content: pt.text,
            source: pt.scanned ? 'ocr-needed' : 'native',
          })
          out.indexedPages++
        } catch (err) {
          // One unreadable sheet is not a reason to stop reading the rest —
          // nor to call the document done, so it is tried again next open.
          complete = false
          out.failures.push({
            relativePath: `${doc.relativePath} page ${page + 1}`,
            reason: err instanceof Error ? err.message : String(err),
          })
        }
      }
      if (complete) opts.completed?.add(doc.id)
    } catch (err) {
      out.failures.push({
        relativePath: doc.relativePath,
        reason: err instanceof Error ? err.message : String(err),
      })
    } finally {
      opened?.close()
      if (url !== null) opts.releaseUrl(url)
    }
    if (out.cancelled) break
    report(i + 1, null)
  }
  return out
}
