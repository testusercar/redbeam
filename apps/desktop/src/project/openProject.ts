/**
 * Opening a project: scan the folder, ingest what is there, report what is not.
 *
 * Extracted from the workspace component so the ORDER of operations is
 * testable. The individual pieces are each covered — the Rust scan, the store's
 * ingest, the document query — but the sequence between them is where the
 * mistakes live: reconciling on a truncated scan, ingesting before the schema
 * exists, or reporting success when the folder could not be read.
 */
import type { SqlDriver } from '@redbeam/store'
import { ingestDocuments, listDocuments, type DocumentRow } from '@redbeam/store'
import { shouldReconcile, toIngestDocuments } from './ingest.js'
import type { ScanResult } from './types.js'

export interface ProjectScanner {
  scanProject(path: string, extensions?: string[]): Promise<ScanResult>
}

export interface OpenProjectResult {
  documents: DocumentRow[]
  /** Human-readable problem worth showing, or null when all was well. */
  note: string | null
  /** Did the scan see the whole folder? Drives whether we reconciled. */
  complete: boolean
  created: number
  updated: number
}

/**
 * Scan and ingest, then return the project's documents.
 *
 * Never throws for a folder problem: a project that cannot be scanned still
 * opens, showing whatever was ingested previously, with the problem named. The
 * alternative — refusing to open — would lock an estimator out of a takeoff
 * they have already done because a network share blipped.
 */
export async function openProjectDocuments(
  db: SqlDriver,
  scanner: ProjectScanner,
  projectPath: string,
  /**
   * Has this open been superseded? Checked immediately before the ingest.
   *
   * The scan is the slow part — 152 seconds on a synced share — and the caller
   * cannot abandon it, only ignore its result. Ignoring the result is not
   * enough, because the WRITE happens in here: a scan whose project the user
   * has already left still ingested, and the store's one connection sent it
   * wherever it pointed by then. That is how the Barclays project came to hold
   * 625 documents belonging to two other jobs.
   *
   * The core refuses such a write now (`StoreState::with_project`), so this is
   * the second of two layers: this one keeps a stale scan from being ATTEMPTED,
   * and the core keeps it from LANDING. Either alone would do; a defect that
   * files one client's drawings under another's bid earns both.
   */
  isCancelled: () => boolean = () => false,
): Promise<OpenProjectResult> {
  let note: string | null = null
  let complete = true
  let created = 0
  let updated = 0

  try {
    const scan = await scanner.scanProject(projectPath)
    complete = shouldReconcile(scan)

    if (!complete) {
      // A truncated or partially unreadable scan must NOT reconcile: absence of
      // a file in this scan is not evidence the file is gone, and reconciling
      // would mark the whole project missing on a transient failure.
      note = 'Folder scan was incomplete, so documents were not reconciled. Existing takeoffs are untouched.'
    }

    const docs = toIngestDocuments(scan)
    // Last possible moment: the scan above is where the minutes went, and the
    // user may have opened something else during it.
    if (isCancelled()) {
      return { documents: [], note: null, complete: false, created: 0, updated: 0 }
    }
    if (docs.length > 0 || complete) {
      const counts = await ingestDocuments(db, docs, { reconcile: complete })
      created = counts.created ?? 0
      updated = counts.updated ?? 0
      /*
       * The scan looked complete and still lost most of the catalog, so
       * reconciliation refused it. Saying so matters: the alternative is a
       * project that silently behaves as though nothing happened while the
       * folder it is reading is only half there — which on a cloud-synced
       * folder is a state that can persist for minutes.
       */
      if (counts.reconcileSkipped !== undefined) {
        note = `The folder scan accounted for ${counts.reconcileSkipped} fewer documents `
          + 'than this project has, so none were marked missing. If it is synced from '
          + 'OneDrive or SharePoint, it may still be downloading.'
      }
    }
  } catch (err) {
    complete = false
    note = `Could not scan the project folder: ${err instanceof Error ? err.message : String(err)}`
  }

  const documents = await listDocuments(db)
  if (documents.length === 0 && note === null) {
    note = 'No PDFs found in this project folder.'
  }
  return { documents, note, complete, created, updated }
}
