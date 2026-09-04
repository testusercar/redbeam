/**
 * Documents and pages — the project's file catalog.
 *
 * A REDBEAM project is a folder. Ingest walks it, and every file it finds
 * becomes a `documents` row; every page of a PDF becomes a `pages` row. This
 * module owns that mapping.
 *
 * Column names are read from packages/store/migrations, not remembered:
 *   documents.relative_path        NOT NULL UNIQUE  <- the project identity of a file
 *   documents.availability         NOT NULL         <- 'local' | 'online_only' | 'unavailable'
 *   documents.missing              NOT NULL DEFAULT 0
 *   pages.page_number              (not page_index) <- ZERO based, see below
 *   pages.width_pdf_points / height_pdf_points      <- nullable REAL
 *
 * # Three rules this module exists to enforce
 *
 * 1. **Ingest is idempotent.** Opening the same project twice must not double
 *    the catalog. Identity is `relative_path` for a file and
 *    `(document_id, page_number)` for a page, and every write is an upsert on
 *    exactly those keys.
 *
 * 2. **Nothing is ever deleted.** A file that has gone is marked
 *    `missing = 1, availability = 'unavailable'`. Markups, calibrations and
 *    quantities hang off `documents.id` by foreign key with ON DELETE CASCADE
 *    — deleting the row because the file moved would silently destroy a
 *    takeoff. The Qt build made the same call (`reconcileDocumentCatalog`) and
 *    it is carried across deliberately.
 *
 * 3. **Page boxes are per page, not per document.** A details sheet is not the
 *    same size as a plan, and every normalized coordinate and every calibration
 *    is relative to its own page's box. There is no document-level width or
 *    height here, and there must never be one.
 *
 * # page_number is zero based
 *
 * The Qt build's MCP surface documents it: "Navigate to a zero-based page
 * number" (`redbeam-mcp-server/index.js`), and `catalogPages` validates
 * `pageNumber >= 0`. It therefore lines up 1:1 with the viewer's page index,
 * and a page *label* — which is what a human reads — is a separate nullable
 * column. Do not add one silently.
 */
import type { SqlDriver } from './index.js'

// ----------------------------------------------------------------- types --

/**
 * Ported from `availabilityForPath` in the Qt build. Note that it is NOT
 * `'available'`: `repo.ts::ensureDocumentAndPage` writes that string, which is
 * outside this vocabulary. Anything reading `availability` should treat an
 * unknown value as `'local'` rather than assume.
 */
export type DocumentAvailability = 'local' | 'online_only' | 'unavailable'

/** Ported from `classifyStatus`. */
export type DocumentStatus = 'current' | 'draft' | 'superseded'

export interface DocumentRow {
  id: string
  relativePath: string
  displayName: string
  kind: string
  status: string
  sizeBytes: number
  modifiedAtObserved: string | null
  contentFingerprint: string | null
  fileDateHint: string | null
  availability: string
  preferredWorkingCopy: boolean
  missing: boolean
  createdAt: string
  updatedAt: string
}

/**
 * One page's geometry, as the viewer reports it.
 *
 * `widthPdfPoints` / `heightPdfPoints` are that page's own box. They are
 * required and must be positive — the Qt build refuses a descriptor without
 * them, because a zero box makes every normalized coordinate on the page
 * meaningless rather than merely wrong.
 */
export interface PageSpec {
  /** Zero based. */
  pageNumber: number
  widthPdfPoints: number
  heightPdfPoints: number
  label?: string | null
  rotation?: number
  nativeTextAvailable?: boolean
}

export interface PageRow extends Required<Omit<PageSpec, 'label'>> {
  id: string
  documentId: string
  label: string | null
}

/** A file found by a project scan, ready to become a `documents` row. */
export interface IngestDocument {
  /** Forward-slashed, relative to the project root. The identity of the file. */
  relativePath: string
  displayName?: string
  kind?: string
  status?: string
  sizeBytes?: number
  /** RFC 3339. */
  modifiedAt?: string | null
  contentFingerprint?: string | null
  fileDateHint?: string | null
  availability?: string
  /** Page geometry, when it is already known. Filled in later otherwise. */
  pages?: PageSpec[]
}

export interface PageWriteResult {
  inserted: number
  updated: number
  /** Specs refused for a non-positive box or a negative page number. */
  rejected: number
}

export interface DocumentIngestResult {
  documentId: string
  relativePath: string
  /** True when this call created the row. */
  created: boolean
  /** True when an existing row was recognised at a new path by fingerprint. */
  moved: boolean
  previousRelativePath: string | null
  /** True when a row previously flagged `missing` came back. */
  restored: boolean
  pages: PageWriteResult
}

export interface IngestSummary {
  documents: DocumentIngestResult[]
  created: number
  updated: number
  moved: number
  restored: number
  /** Rows flagged `missing` because the scan did not find them. */
  markedMissing: number
  /**
   * How many documents reconciliation REFUSED to mark missing, because the
   * scan had lost an implausible share of the catalog. Absent when the pass
   * ran normally. See the note at the reconcile step.
   */
  reconcileSkipped?: number
  pagesWritten: number
}

export interface IngestOptions {
  /**
   * Flag documents the scan did not find as missing. Defaults to true.
   *
   * **Pass false for a partial scan.** A truncated walk, an unreadable
   * directory, or a filtered extension list is not evidence that a document is
   * gone, and marking it missing would hide a real drawing from the takeoff.
   */
  reconcile?: boolean
  /**
   * Fill in page geometry for a document that has none yet.
   *
   * Ingest cannot do this itself: page boxes come from PDFium, which runs in
   * the viewer's worker in the frontend, and there is no PDF parser on the
   * database side. Callers that can open the file pass a probe; callers that
   * cannot leave it out, and the pages are written later by
   * {@link recordPages} when the document is first opened.
   */
  probePages?: (doc: IngestDocument, documentId: string) => Promise<PageSpec[] | null>
  /** Injected for tests. Defaults to `new Date().toISOString()`. */
  now?: () => string
}

// ------------------------------------------------------------- identities --

/**
 * Stable document id for a path.
 *
 * Derived rather than random so that re-ingesting a folder into a fresh
 * database reproduces the same ids — which is what makes a golden fixture of a
 * catalog comparable at all. A moved file keeps its ORIGINAL id (see
 * {@link ingestDocuments}); this only names rows that are genuinely new.
 *
 * Two independent 32-bit FNV-1a passes, concatenated. Written as two 32-bit
 * lanes rather than one 64-bit one because JavaScript's bitwise operators are
 * 32 bit and a hand-rolled 64-bit multiply is a bug farm for no benefit here.
 * A collision would surface loudly as a PRIMARY KEY violation on insert, not
 * as two files quietly sharing a takeoff.
 */
export function documentIdForPath(relativePath: string): string {
  const a = fnv1a32(relativePath, 0x811c9dc5)
  const b = fnv1a32(relativePath, 0x01000193)
  return `doc-${hex8(a)}${hex8(b)}`
}

/** Stable page id. `(document_id, page_number)` is the real unique key. */
export function pageIdFor(documentId: string, pageNumber: number): string {
  return `${documentId}-p${pageNumber}`
}

/**
 * The inverse of `pageIdFor`.
 *
 * Page ids are BUILT everywhere else and never taken apart, which is the right
 * default. PDF write-back is the exception: it has to address a page by
 * position in the file, and a markup records only the id.
 *
 * It returns null rather than a number when the id does not belong to the
 * document asked about. A scope spans documents, so a list of markups routinely
 * contains rows from another file, and reading a position out of one of those
 * would put a markup on a sheet it was never drawn on — which is the failure
 * this exists to make impossible rather than merely unlikely.
 */
export function pageNumberFrom(pageId: string, documentId: string): number | null {
  const prefix = `${documentId}-p`
  if (!pageId.startsWith(prefix)) return null
  const rest = pageId.slice(prefix.length)
  // `Number('')` is 0 and `Number(' 1')` is 1; neither is a page id.
  if (!/^\d+$/.test(rest)) return null
  return Number(rest)
}

/**
 * FNV-1a over the UTF-16 code units of `text`, one byte at a time so a
 * non-ASCII path (accents in a job name are routine) still folds every bit of
 * the character into the hash.
 */
function fnv1a32(text: string, basis: number): number {
  let hash = basis >>> 0
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    hash = Math.imul(hash ^ (unit & 0xff), 0x01000193) >>> 0
    hash = Math.imul(hash ^ (unit >>> 8), 0x01000193) >>> 0
  }
  return hash >>> 0
}

const hex8 = (value: number) => (value >>> 0).toString(16).padStart(8, '0')

const defaultNow = () => new Date().toISOString()

// ------------------------------------------------------------- sanitizers --

/**
 * PDF page labels arrive with embedded control characters (Round 3 defect #11:
 * every PKG-B label carried a trailing NUL). Strip them before they reach the
 * catalog, FTS snippets, and JSON responses.
 *
 * Ported with its comment from `redbeamprojectsession.cpp`, where the defect
 * was found against a real drawing set.
 */
export function sanitizePageLabel(label: string | null | undefined): string | null {
  if (label === null || label === undefined) return null
  let out = ''
  for (const ch of label) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) continue
    out += ch
  }
  out = out.trim()
  return out.length > 0 ? out : null
}

/** A page spec is usable only if it names a real box on a real page. */
export function isUsablePageSpec(spec: PageSpec): boolean {
  return (
    Number.isInteger(spec.pageNumber) &&
    spec.pageNumber >= 0 &&
    Number.isFinite(spec.widthPdfPoints) &&
    Number.isFinite(spec.heightPdfPoints) &&
    spec.widthPdfPoints > 0 &&
    spec.heightPdfPoints > 0
  )
}

// ------------------------------------------------------------------ reads --

interface RawDocument {
  id: string
  relative_path: string
  display_name: string
  kind: string
  status: string
  size_bytes: number
  modified_at_observed: string | null
  content_fingerprint: string | null
  file_date_hint: string | null
  availability: string
  preferred_working_copy: number
  missing: number
  created_at: string
  updated_at: string
}

const DOCUMENT_COLUMNS = `id, relative_path, display_name, kind, status, size_bytes,
   modified_at_observed, content_fingerprint, file_date_hint, availability,
   preferred_working_copy, missing, created_at, updated_at`

function toDocumentRow(r: RawDocument): DocumentRow {
  return {
    id: r.id,
    relativePath: r.relative_path,
    displayName: r.display_name,
    kind: r.kind,
    status: r.status,
    sizeBytes: r.size_bytes,
    modifiedAtObserved: r.modified_at_observed,
    contentFingerprint: emptyToNull(r.content_fingerprint),
    fileDateHint: emptyToNull(r.file_date_hint),
    availability: r.availability,
    preferredWorkingCopy: r.preferred_working_copy !== 0,
    missing: r.missing !== 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/**
 * The Qt build binds `''` rather than NULL to the optional TEXT columns, and
 * this port keeps that so the two agree byte for byte. An empty string is not
 * a fingerprint, so it is normalized away on the way out.
 */
function emptyToNull(value: string | null): string | null {
  return value === null || value === '' ? null : value
}

export interface ListDocumentsOptions {
  /** Defaults to true: a missing document is still part of the project. */
  includeMissing?: boolean
  kind?: string
  status?: string
  /** Substring match on relative_path and display_name, case-insensitive. */
  search?: string
  limit?: number
}

/** Every document in the project, ordered by path. */
export async function listDocuments(
  db: SqlDriver,
  opts: ListDocumentsOptions = {},
): Promise<DocumentRow[]> {
  const where: string[] = []
  const params: unknown[] = []

  if (opts.includeMissing === false) where.push('missing = 0')
  if (opts.kind !== undefined) {
    where.push('kind = ?')
    params.push(opts.kind)
  }
  if (opts.status !== undefined) {
    where.push('status = ?')
    params.push(opts.status)
  }
  if (opts.search !== undefined && opts.search.trim() !== '') {
    where.push('(lower(relative_path) LIKE ? OR lower(display_name) LIKE ?)')
    const needle = `%${opts.search.trim().toLowerCase()}%`
    params.push(needle, needle)
  }

  let sql = `SELECT ${DOCUMENT_COLUMNS} FROM documents`
  if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`
  sql += ' ORDER BY relative_path'
  if (opts.limit !== undefined) {
    sql += ' LIMIT ?'
    params.push(opts.limit)
  }

  const rows = await db.all<RawDocument>(sql, params)
  return rows.map(toDocumentRow)
}

export async function getDocumentByPath(
  db: SqlDriver,
  relativePath: string,
): Promise<DocumentRow | null> {
  const rows = await db.all<RawDocument>(
    `SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE relative_path = ?`,
    [relativePath],
  )
  const row = rows[0]
  return row ? toDocumentRow(row) : null
}

export async function getDocumentById(db: SqlDriver, id: string): Promise<DocumentRow | null> {
  const rows = await db.all<RawDocument>(`SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE id = ?`, [
    id,
  ])
  const row = rows[0]
  return row ? toDocumentRow(row) : null
}

export async function countDocuments(db: SqlDriver): Promise<number> {
  const rows = await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM documents')
  return rows[0]?.n ?? 0
}

interface RawPage {
  id: string
  document_id: string
  page_number: number
  label: string | null
  width_pdf_points: number | null
  height_pdf_points: number | null
  rotation: number
  native_text_available: number
}

/** Every page of one document, in page order. */
export async function listPages(db: SqlDriver, documentId: string): Promise<PageRow[]> {
  const rows = await db.all<RawPage>(
    `SELECT id, document_id, page_number, label, width_pdf_points, height_pdf_points,
            rotation, native_text_available
     FROM pages WHERE document_id = ? ORDER BY page_number`,
    [documentId],
  )
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    pageNumber: r.page_number,
    // Nullable in the schema: a document can be cataloged before it has ever
    // been opened, and only then does PDFium report its boxes.
    widthPdfPoints: r.width_pdf_points ?? 0,
    heightPdfPoints: r.height_pdf_points ?? 0,
    label: r.label,
    rotation: r.rotation,
    nativeTextAvailable: r.native_text_available !== 0,
  }))
}

export async function countPages(db: SqlDriver, documentId?: string): Promise<number> {
  const rows =
    documentId === undefined
      ? await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM pages')
      : await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM pages WHERE document_id = ?', [
          documentId,
        ])
  return rows[0]?.n ?? 0
}

// ----------------------------------------------------------------- writes --

/**
 * Write a document's pages, upserting on `(document_id, page_number)`.
 *
 * Ported from `catalogPages` in `redbeamprojectsession.cpp`. Existing page ids
 * are reused rather than regenerated, because `markups.page_id` and
 * `calibrations.page_id` are foreign keys onto them — a fresh id per rescan
 * would orphan every markup on the page.
 *
 * Specs that do not describe a real page box are counted in
 * {@link PageWriteResult.rejected} and skipped. The Qt build failed the whole
 * batch instead; skipping is kinder to a 300-page set with one bad page, and
 * the count makes the difference visible rather than silent.
 */
export async function recordPages(
  db: SqlDriver,
  documentId: string,
  pages: PageSpec[],
  now: () => string = defaultNow,
): Promise<PageWriteResult> {
  const existing = new Map<number, string>()
  const rows = await db.all<{ page_number: number; id: string }>(
    'SELECT page_number, id FROM pages WHERE document_id = ?',
    [documentId],
  )
  for (const row of rows) existing.set(row.page_number, row.id)

  const result: PageWriteResult = { inserted: 0, updated: 0, rejected: 0 }
  const timestamp = now()

  for (const spec of pages) {
    if (!isUsablePageSpec(spec)) {
      result.rejected++
      continue
    }
    const known = existing.get(spec.pageNumber)
    const id = known ?? pageIdFor(documentId, spec.pageNumber)

    await db.run(
      `INSERT INTO pages(id, document_id, page_number, label, width_pdf_points,
                         height_pdf_points, rotation, native_text_available,
                         created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(document_id, page_number) DO UPDATE SET
         label = excluded.label,
         width_pdf_points = excluded.width_pdf_points,
         height_pdf_points = excluded.height_pdf_points,
         rotation = excluded.rotation,
         native_text_available = excluded.native_text_available,
         updated_at = excluded.updated_at`,
      [
        id,
        documentId,
        spec.pageNumber,
        sanitizePageLabel(spec.label),
        spec.widthPdfPoints,
        spec.heightPdfPoints,
        spec.rotation ?? 0,
        spec.nativeTextAvailable ? 1 : 0,
        timestamp,
        timestamp,
      ],
    )

    if (known === undefined) {
      result.inserted++
      existing.set(spec.pageNumber, id)
    } else {
      result.updated++
    }
  }

  return result
}

/**
 * Create or refresh one document row.
 *
 * `id` is only consulted when the row does not already exist at this path —
 * an existing document keeps the identity every markup already points at.
 * `created_at` and `preferred_working_copy` are insert-only for the same
 * reason the Qt build makes them insert-only: a rescan is not allowed to
 * overwrite a user's choice of working copy or rewrite history.
 */
export async function upsertDocument(
  db: SqlDriver,
  doc: IngestDocument,
  id: string,
  now: () => string = defaultNow,
): Promise<void> {
  const timestamp = now()
  await db.run(
    `INSERT INTO documents(id, relative_path, display_name, kind, status, size_bytes,
                           modified_at_observed, content_fingerprint,
                           base_content_fingerprint, annotation_fingerprint, issue_date,
                           file_date_hint, availability, preferred_working_copy, missing,
                           created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,'','','',?,?,0,0,?,?)
     ON CONFLICT(id) DO UPDATE SET
       relative_path = excluded.relative_path,
       display_name = excluded.display_name,
       kind = excluded.kind,
       status = excluded.status,
       size_bytes = excluded.size_bytes,
       modified_at_observed = excluded.modified_at_observed,
       content_fingerprint = excluded.content_fingerprint,
       file_date_hint = excluded.file_date_hint,
       availability = excluded.availability,
       missing = 0,
       updated_at = excluded.updated_at`,
    [
      id,
      doc.relativePath,
      doc.displayName ?? basename(doc.relativePath),
      doc.kind ?? 'drawing',
      doc.status ?? 'current',
      Math.max(0, Math.trunc(doc.sizeBytes ?? 0)),
      doc.modifiedAt ?? null,
      doc.contentFingerprint ?? '',
      doc.fileDateHint ?? '',
      doc.availability ?? 'local',
      timestamp,
      timestamp,
    ],
  )
}

function basename(relativePath: string): string {
  const cut = relativePath.lastIndexOf('/')
  return cut >= 0 ? relativePath.slice(cut + 1) : relativePath
}

/**
 * Flag a document as gone without removing it.
 *
 * Every markup, calibration and quantity on the document is reached through
 * `documents.id` with ON DELETE CASCADE. Deleting the row would take the whole
 * takeoff with it, which is why nothing here ever issues a DELETE.
 */
export async function markDocumentMissing(
  db: SqlDriver,
  documentId: string,
  now: () => string = defaultNow,
): Promise<void> {
  await db.run(
    "UPDATE documents SET missing = 1, availability = 'unavailable', updated_at = ? WHERE id = ?",
    [now(), documentId],
  )
}

/** The inverse: a document that came back. */
export async function markDocumentAvailable(
  db: SqlDriver,
  documentId: string,
  availability: DocumentAvailability = 'local',
  now: () => string = defaultNow,
): Promise<void> {
  await db.run('UPDATE documents SET missing = 0, availability = ?, updated_at = ? WHERE id = ?', [
    availability,
    now(),
    documentId,
  ])
}

// ---------------------------------------------------------------- ingest --

/**
 * Below this many catalogued documents, a large proportional loss is ordinary
 * — deleting two of three files is a thing people do. The guard is about a
 * scan losing a JOB FOLDER, which is never small.
 */
export const RECONCILE_MIN_CATALOG = 10

/**
 * The share of a catalog a single scan may account missing before it is
 * disbelieved. Half: a cloud folder mid-hydration loses far more than this,
 * and a person cleaning up a project deletes far less in one go.
 */
export const RECONCILE_MAX_LOSS = 0.5

interface ExistingDocument {
  id: string
  relativePath: string
  fingerprint: string
  missing: boolean
  matched: boolean
}

/**
 * Reconcile a folder scan against the catalog.
 *
 * Ported from `reconcileDocumentCatalog` in `shell/redbeamproject.cpp`, which
 * is the Qt build's answer to exactly this problem. The matching order is the
 * part that matters:
 *
 * 1. **By `relative_path`.** The common case, and the reason a second ingest of
 *    an unchanged folder writes updates and inserts nothing.
 * 2. **By `content_fingerprint`**, but only onto a candidate that has not
 *    already been matched and whose own path is no longer in the scan. That is
 *    how a renamed or moved file keeps its id — and with it, every markup drawn
 *    on it. Without this step, moving a sheet into a subfolder would silently
 *    orphan its whole takeoff behind a `missing` row.
 * 3. **Otherwise it is new**, and gets {@link documentIdForPath}.
 *
 * Anything in the catalog that the scan did not account for is flagged
 * `missing`, never deleted — and only when `reconcile` is true.
 */
export async function ingestDocuments(
  db: SqlDriver,
  files: IngestDocument[],
  opts: IngestOptions = {},
): Promise<IngestSummary> {
  const now = opts.now ?? defaultNow
  const reconcile = opts.reconcile !== false

  const existingRows = await db.all<{
    id: string
    relative_path: string
    content_fingerprint: string | null
    missing: number
  }>('SELECT id, relative_path, content_fingerprint, missing FROM documents')

  const existing: ExistingDocument[] = existingRows.map((r) => ({
    id: r.id,
    relativePath: r.relative_path,
    fingerprint: r.content_fingerprint ?? '',
    missing: r.missing !== 0,
    matched: false,
  }))

  const byPath = new Map<string, number>()
  const byFingerprint = new Map<string, number[]>()
  existing.forEach((row, index) => {
    if (!byPath.has(row.relativePath)) byPath.set(row.relativePath, index)
    if (row.fingerprint !== '') {
      const bucket = byFingerprint.get(row.fingerprint)
      if (bucket) bucket.push(index)
      else byFingerprint.set(row.fingerprint, [index])
    }
  })

  const scannedPaths = new Set(files.map((f) => f.relativePath))

  const summary: IngestSummary = {
    documents: [],
    created: 0,
    updated: 0,
    moved: 0,
    restored: 0,
    markedMissing: 0,
    pagesWritten: 0,
  }

  for (const file of files) {
    let index = byPath.get(file.relativePath) ?? -1
    // A path hit onto an already-matched row means an earlier file in this same
    // scan claimed that identity (a swap: A took B's old path). Treat this one
    // as new rather than fighting over the row.
    if (index >= 0 && existing[index]!.matched) index = -1

    let moved = false
    const fingerprint = file.contentFingerprint ?? ''
    if (index < 0 && fingerprint !== '') {
      for (const candidate of byFingerprint.get(fingerprint) ?? []) {
        const row = existing[candidate]!
        // Only adopt a row whose own file is no longer where it was. Adopting a
        // row that is still present would give two files one identity.
        if (!row.matched && !scannedPaths.has(row.relativePath)) {
          index = candidate
          moved = true
          break
        }
      }
    }

    const previous = index >= 0 ? existing[index]! : null
    if (previous) previous.matched = true

    const documentId = previous?.id ?? documentIdForPath(file.relativePath)
    const created = previous === null
    const restored = previous?.missing === true

    await upsertDocument(db, file, documentId, now)

    let pages: PageWriteResult = { inserted: 0, updated: 0, rejected: 0 }
    let specs = file.pages ?? null
    if (specs === null && opts.probePages) {
      specs = await opts.probePages(file, documentId)
    }
    if (specs !== null && specs.length > 0) {
      pages = await recordPages(db, documentId, specs, now)
    }

    summary.documents.push({
      documentId,
      relativePath: file.relativePath,
      created,
      moved,
      previousRelativePath: moved ? (previous?.relativePath ?? null) : null,
      restored,
      pages,
    })
    if (created) summary.created++
    else summary.updated++
    if (moved) summary.moved++
    if (restored) summary.restored++
    summary.pagesWritten += pages.inserted + pages.updated
  }

  /*
   * A scan that loses most of a project is a scan problem, not a deletion.
   *
   * `shouldReconcile` already refuses a scan that was truncated or hit an
   * unreadable directory. It cannot see the case that actually bit us: a
   * CLOUD-SYNCED folder — OneDrive or SharePoint with Files On-Demand —
   * enumerates a different number of files depending on how much of it is
   * hydrated, and reports nothing wrong while doing it. The walk completes,
   * claims fewer files, and reconciliation dutifully marks hundreds of live
   * drawings missing. On the Ontario Line project that was 736 documents.
   *
   * Half of a job folder does not disappear between two opens. When a scan
   * says it has, the scan is the thing to disbelieve — so reconciliation is
   * skipped and the caller is told, rather than a takeoff quietly losing the
   * sheets it was drawn on.
   */
  const wouldMarkMissing = existing.filter((row) => !row.matched && !row.missing).length
  const implausible = reconcile
    && existing.length >= RECONCILE_MIN_CATALOG
    && wouldMarkMissing / existing.length > RECONCILE_MAX_LOSS
  if (implausible) summary.reconcileSkipped = wouldMarkMissing

  if (reconcile && !implausible) {
    for (const row of existing) {
      if (row.matched || row.missing) continue
      await markDocumentMissing(db, row.id, now)
      summary.markedMissing++
    }
  }

  return summary
}
