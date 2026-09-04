/**
 * Repositories over the ported schema.
 *
 * Column names here are checked against packages/store/migrations — they are
 * NOT invented. Notable traps if you are working from memory of the Qt code:
 *   calibrations.feet_per_pdf_point  (not feet_per_point)
 *   pages.page_number                (not page_index)
 *   pages.width_pdf_points / height_pdf_points
 *   markups.kind                     (not markup_kind)
 *   markups.origin                   NOT NULL
 *   documents.relative_path          NOT NULL UNIQUE
 *
 * Two behaviours carried over from the Qt build:
 *   - markups are SOFT deleted (`deleted_at`), never removed, so a takeoff can
 *     be audited after the fact.
 *   - markups carry `review_state`, defaulting to 'accepted'. The review gate
 *     is a real concept in this schema; do not bypass it by writing rows that
 *     ignore the column.
 *
 * Identity is `markups.id` with a real `scope_id` foreign key — NOT parsed out
 * of a display string. See docs/PORTING.md.
 */
import type { SqlDriver } from './index.js'

export type ReviewState = 'accepted' | 'proposed' | 'rejected'

export interface ScopeRow {
  id: string
  label: string
  scopeType: string
  color: string
  specifications: Record<string, unknown>
  archivedAt: string | null
}

export interface MarkupRow {
  id: string
  scopeId: string | null
  documentId: string
  pageId: string
  kind: string
  rings: Array<Array<{ x: number; y: number }>>
  origin: string
  reviewState: ReviewState
  /**
   * Per-kind payload: a dimension's offset and label, a callout's text, a
   * highlight's opacity. Persisted in `content_json`.
   *
   * This used to be hard-coded to '{}' on write and never read back, which
   * silently discarded everything the dimension, callout and highlight tools
   * produce — the geometry survived a reload and the content did not.
   */
  content?: Record<string, unknown>
  /** Per-markup style overrides. Persisted in `style_json`. */
  style?: Record<string, unknown>
}

export interface CalibrationRow {
  documentId: string
  pageId: string
  feetPerPdfPoint: number
  source: string
}

const nowIso = () => new Date().toISOString()

// -------------------------------------------------------------- estimates ----

/**
 * An estimate is a project-owned bidding round.
 *
 * From REDBEAM_ESTIMATES_MODEL (adopted 2026-08-02): scope definitions belong
 * to an estimate rather than to the project, so the same drawings can be bid
 * twice with different scopes and neither round disturbs the other. The tables
 * have existed since migration 006 — including the one that adopts pre-estimate
 * scopes into an initial round — but nothing read them until now.
 */
export interface EstimateRow {
  id: string
  name: string
  /** 'working' by default. */
  state: string
  /** Set when this estimate was copied from another. */
  sourceEstimateId: string | null
  createdAt: string
  updatedAt: string
  exportedAt: string | null
}

export interface EstimateSummary extends EstimateRow {
  scopeCount: number
  /** Accepted, non-deleted markups across this estimate's scopes. */
  markupCount: number
}

/**
 * Estimates with their scope and markup counts, newest activity first.
 *
 * The counts are computed in SQL rather than by loading scopes and counting in
 * the client: the list is the first thing the right sidebar renders, and a
 * project with a dozen rounds would otherwise issue a query per row.
 */
export async function listEstimates(db: SqlDriver): Promise<EstimateSummary[]> {
  const rows = await db.all<{
    id: string; name: string; state: string; source_estimate_id: string | null
    created_at: string; updated_at: string; exported_at: string | null
    scope_count: number; markup_count: number
  }>(
    `SELECT e.id, e.name, e.state, e.source_estimate_id, e.created_at, e.updated_at,
            e.exported_at,
            (SELECT COUNT(*) FROM estimate_scopes es WHERE es.estimate_id = e.id) AS scope_count,
            (SELECT COUNT(*) FROM markups m
               JOIN estimate_scopes es2 ON es2.scope_id = m.scope_id
              WHERE es2.estimate_id = e.id
                AND m.deleted_at IS NULL
                AND m.review_state = 'accepted') AS markup_count
       FROM estimates e
      ORDER BY e.updated_at DESC, e.created_at DESC`,
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    state: r.state,
    sourceEstimateId: r.source_estimate_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    exportedAt: r.exported_at,
    scopeCount: r.scope_count,
    markupCount: r.markup_count,
  }))
}

export async function createEstimate(db: SqlDriver, id: string, name: string): Promise<void> {
  const now = nowIso()
  await db.run(
    `INSERT INTO estimates(id, name, state, notes_json, created_at, updated_at)
     VALUES(?,?,'working','{}',?,?)`,
    [id, name.trim(), now, now],
  )
}

/** Scope ids belonging to an estimate, in the order the estimate holds them. */
export async function listEstimateScopeIds(db: SqlDriver, estimateId: string): Promise<string[]> {
  const rows = await db.all<{ scope_id: string }>(
    `SELECT scope_id FROM estimate_scopes WHERE estimate_id = ? ORDER BY position, created_at`,
    [estimateId],
  )
  return rows.map((r) => r.scope_id)
}

/**
 * The estimate a scope belongs to.
 *
 * `estimate_scopes.scope_id` is UNIQUE, so a scope is in exactly one round —
 * that is what makes copying an estimate safe.
 */
export async function estimateIdForScope(db: SqlDriver, scopeId: string): Promise<string | null> {
  const rows = await db.all<{ estimate_id: string }>(
    `SELECT estimate_id FROM estimate_scopes WHERE scope_id = ?`, [scopeId],
  )
  return rows[0]?.estimate_id ?? null
}

export async function addScopeToEstimate(
  db: SqlDriver,
  estimateId: string,
  scopeId: string,
  opts: { copiedFromScopeId?: string } = {},
): Promise<void> {
  const rows = await db.all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM estimate_scopes WHERE estimate_id = ?`, [estimateId],
  )
  await db.run(
    `INSERT OR IGNORE INTO estimate_scopes(estimate_id, scope_id, copied_from_scope_id, position, created_at)
     VALUES(?,?,?,?,?)`,
    [estimateId, scopeId, opts.copiedFromScopeId ?? null, rows[0]?.n ?? 0, nowIso()],
  )
}

/** Rename a bidding round. */
export async function renameEstimate(db: SqlDriver, id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  // A round with no name cannot be told from another round with no name, and
  // the list is how you choose which bid you are working on.
  if (trimmed === '') throw new Error('an estimate needs a name')
  await db.run(
    'UPDATE estimates SET name = ?, updated_at = ? WHERE id = ?',
    [trimmed, nowIso(), id],
  )
}

/** How many live markups these scopes carry between them. */
async function markupCountFor(db: SqlDriver, scopeIds: readonly string[]): Promise<number> {
  if (scopeIds.length === 0) return 0
  const rows = await db.all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM markups
      WHERE deleted_at IS NULL AND scope_id IN (${scopeIds.map(() => '?').join(',')})`,
    [...scopeIds],
  )
  return rows[0]?.n ?? 0
}

/**
 * Delete a bidding round.
 *
 * `estimate_scopes.scope_id` is UNIQUE, so a scope belongs to exactly ONE
 * round — which is why copying a round mints new scope rows rather than
 * sharing them. It also means deleting a round takes every scope in it: there
 * is no other round for them to survive in.
 *
 * So this REFUSES while any of those scopes still carries takeoff. Deleting a
 * round is a filing decision; destroying traced work is not, and an estimator
 * who has spent an afternoon on a ceiling should not lose it to a click on the
 * round it happens to live in. Delete the markups, or copy the round, first.
 *
 * Scopes carrying nothing are ARCHIVED rather than deleted. They cost nothing
 * to keep, they are already out of every list, and a specification somebody
 * typed is worth more than the row it occupies.
 */
export async function deleteEstimate(db: SqlDriver, id: string): Promise<void> {
  const scopeIds = await listEstimateScopeIds(db, id)
  const withWork = await markupCountFor(db, scopeIds)
  if (withWork > 0) {
    throw new Error(
      `this round has ${withWork} markup${withWork === 1 ? '' : 's'} that exist nowhere else`,
    )
  }
  const now = nowIso()
  await db.run('BEGIN')
  try {
    if (scopeIds.length > 0) {
      await db.run(
        `UPDATE scopes SET archived_at = ?, updated_at = ?
          WHERE archived_at IS NULL AND id IN (${scopeIds.map(() => '?').join(',')})`,
        [now, now, ...scopeIds],
      )
    }
    await db.run('DELETE FROM estimate_scopes WHERE estimate_id = ?', [id])
    await db.run('DELETE FROM estimates WHERE id = ?', [id])
    await db.run('COMMIT')
  } catch (err) {
    await db.run('ROLLBACK')
    throw err
  }
}

/**
 * Take a scope out of a round.
 *
 * A scope belongs to exactly one round, so removing it from that one leaves it
 * in none — unreachable from the panel, taking its markups somewhere nothing
 * lists. It is archived instead: out of the way, and still there.
 */
export async function removeScopeFromEstimate(
  db: SqlDriver,
  estimateId: string,
  scopeId: string,
): Promise<void> {
  const now = nowIso()
  await db.run('BEGIN')
  try {
    await db.run(
      'DELETE FROM estimate_scopes WHERE estimate_id = ? AND scope_id = ?',
      [estimateId, scopeId],
    )
    await db.run(
      'UPDATE scopes SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL',
      [now, now, scopeId],
    )
    await db.run('COMMIT')
  } catch (err) {
    await db.run('ROLLBACK')
    throw err
  }
}

/**
 * Copy an estimate: its scope DEFINITIONS, and nothing else.
 *
 * The model is explicit that "markups and calculated quantities are not
 * silently copied into a new bidding round", and that is the point of the
 * feature — you re-bid the same scopes against changed drawings, and a copied
 * takeoff would be quantities nobody measured. Each copied scope is a new row
 * with a new id that remembers where it came from, so the source round is
 * untouched by any later edit to the copy.
 *
 * `newScopeId` mints an id per source scope. The caller supplies it so this
 * function needs no id generator and stays testable with fixed ids.
 */
export async function copyEstimate(
  db: SqlDriver,
  sourceId: string,
  newEstimateId: string,
  name: string,
  newScopeId: (sourceScopeId: string, index: number) => string,
): Promise<void> {
  const now = nowIso()
  /*
   * All of it or none of it.
   *
   * This wrote the estimate row and then its scopes one at a time with nothing
   * holding them together, so a failure partway through left an estimate that
   * claimed to be a copy and was missing half the work — and the only way to
   * notice would be to count the scopes against the original by eye.
   */
  await db.run('BEGIN')
  try {
  await db.run(
    `INSERT INTO estimates(id, name, state, source_estimate_id, notes_json, created_at, updated_at)
     VALUES(?,?,'working',?,'{}',?,?)`,
    [newEstimateId, name.trim(), sourceId, now, now],
  )
  const scopes = await db.all<{
    id: string; label: string; scope_type: string; color: string; specifications_json: string
  }>(
    `SELECT s.id, s.label, s.scope_type, s.color, s.specifications_json
       FROM scopes s JOIN estimate_scopes es ON es.scope_id = s.id
      WHERE es.estimate_id = ? AND s.archived_at IS NULL
      ORDER BY es.position, es.created_at`,
    [sourceId],
  )
  for (let i = 0; i < scopes.length; i++) {
    const src = scopes[i]!
    const id = newScopeId(src.id, i)
    await db.run(
      `INSERT INTO scopes(id, label, scope_type, color, specifications_json, archived_at, created_at, updated_at)
       VALUES(?,?,?,?,?,NULL,?,?)`,
      [id, src.label, src.scope_type, src.color, src.specifications_json, now, now],
    )
    await db.run(
      `INSERT INTO estimate_scopes(estimate_id, scope_id, copied_from_scope_id, position, created_at)
       VALUES(?,?,?,?,?)`,
      [newEstimateId, id, src.id, i, now],
    )
  }
    await db.run('COMMIT')
  } catch (err) {
    await db.run('ROLLBACK')
    throw err
  }
}

/**
 * Documents an estimate actually touches, derived from its markups.
 *
 * The model calls this the contributing file set, and says a document leaves
 * the estimate view when it no longer carries an accepted markup for it — so
 * this is DERIVED on every read rather than stored. A stored list goes stale
 * the moment somebody deletes the last markup on a sheet, and then the estimate
 * claims a drawing it no longer measures.
 */
export async function estimateDocuments(
  db: SqlDriver,
  estimateId: string,
): Promise<Array<{ documentId: string; relativePath: string; markupCount: number }>> {
  const rows = await db.all<{ document_id: string; relative_path: string; n: number }>(
    `SELECT m.document_id, d.relative_path, COUNT(*) AS n
       FROM markups m
       JOIN estimate_scopes es ON es.scope_id = m.scope_id
       JOIN documents d ON d.id = m.document_id
      WHERE es.estimate_id = ? AND m.deleted_at IS NULL AND m.review_state = 'accepted'
      GROUP BY m.document_id, d.relative_path
      ORDER BY n DESC, d.relative_path`,
    [estimateId],
  )
  return rows.map((r) => ({
    documentId: r.document_id,
    relativePath: r.relative_path,
    markupCount: r.n,
  }))
}

// ---------------------------------------------------------------- scopes ----

export async function upsertScope(db: SqlDriver, s: ScopeRow): Promise<void> {
  await db.run(
    `INSERT INTO scopes(id, label, scope_type, color, specifications_json, archived_at, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       label=excluded.label, scope_type=excluded.scope_type, color=excluded.color,
       specifications_json=excluded.specifications_json, archived_at=excluded.archived_at,
       updated_at=excluded.updated_at`,
    [s.id, s.label, s.scopeType, s.color, JSON.stringify(s.specifications), s.archivedAt, nowIso(), nowIso()],
  )
}

/**
 * List scopes, newest-archived last.
 *
 * `includeArchived` exists because archiving is otherwise a one-way trip: the
 * row survives but nothing can see it, so an estimator who archives the wrong
 * scope has no way back short of SQL.
 */
export async function listScopes(
  db: SqlDriver,
  opts: { includeArchived?: boolean } = {},
): Promise<ScopeRow[]> {
  const where = opts.includeArchived === true ? '' : 'WHERE archived_at IS NULL'
  const rows = await db.all<{
    id: string; label: string; scope_type: string; color: string
    specifications_json: string; archived_at: string | null
  }>(
    `SELECT id, label, scope_type, color, specifications_json, archived_at
     FROM scopes ${where} ORDER BY archived_at IS NULL DESC, label`,
  )
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    scopeType: r.scope_type,
    color: r.color,
    specifications: safeParse(r.specifications_json, {}) as Record<string, unknown>,
    archivedAt: r.archived_at,
  }))
}

/**
 * Archive or restore a scope.
 *
 * Archiving does NOT touch the markups that point at it. They keep their
 * scope_id, so restoring the scope brings its takeoff back intact; the
 * alternative — nulling scope_id on archive — silently destroys the
 * association and cannot be undone by restoring.
 */
export async function setScopeArchived(
  db: SqlDriver,
  id: string,
  archived: boolean,
): Promise<void> {
  await db.run(
    'UPDATE scopes SET archived_at = ?, updated_at = ? WHERE id = ?',
    [archived ? nowIso() : null, nowIso(), id],
  )
}

/** Number of markups still pointing at a scope, archived or not. */
export async function countMarkupsForScope(db: SqlDriver, id: string): Promise<number> {
  const rows = await db.all<{ n: number }>(
    'SELECT COUNT(*) AS n FROM markups WHERE scope_id = ? AND deleted_at IS NULL',
    [id],
  )
  return rows[0]?.n ?? 0
}

// --------------------------------------------------------------- markups ----

export async function insertMarkup(db: SqlDriver, m: MarkupRow): Promise<void> {
  await db.run(
    `INSERT INTO markups(id, document_id, page_id, scope_id, kind, geometry_json,
                         style_json, content_json, origin, review_state, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      m.id, m.documentId, m.pageId, m.scopeId, m.kind, JSON.stringify(m.rings),
      JSON.stringify(m.style ?? {}), JSON.stringify(m.content ?? {}),
      m.origin, m.reviewState, nowIso(), nowIso(),
    ],
  )
}

/** Does this markup id exist at all, including soft-deleted rows? */
export async function markupExists(db: SqlDriver, id: string): Promise<boolean> {
  const rows = await db.all<{ id: string }>('SELECT id FROM markups WHERE id = ?', [id])
  return rows.length > 0
}

/** Replace a markup's geometry after an edit. */
export async function updateMarkupGeometry(
  db: SqlDriver,
  id: string,
  rings: MarkupRow['rings'],
): Promise<void> {
  await db.run('UPDATE markups SET geometry_json = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(rings), nowIso(), id,
  ])
}

/** Soft delete, matching the Qt build. The row stays for audit. */
export async function deleteMarkup(db: SqlDriver, id: string): Promise<void> {
  await db.run('UPDATE markups SET deleted_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), id])
}

export async function restoreMarkup(db: SqlDriver, id: string): Promise<void> {
  await db.run('UPDATE markups SET deleted_at = NULL, updated_at = ? WHERE id = ?', [nowIso(), id])
}

export interface ListMarkupOptions {
  pageId?: string
  /**
   * Every markup in one document, across its pages.
   *
   * The sheet index needs this to mark which sheets carry takeoff, and the
   * scope panel needs it to list a scope's markups grouped by sheet. Both used
   * to be answered by loading the whole project and filtering in the client,
   * which is the same query with the index thrown away.
   */
  documentId?: string
  /** Defaults to 'accepted' only — proposed markups must not reach quantities. */
  reviewStates?: ReviewState[]
  includeDeleted?: boolean
}

export async function listMarkups(db: SqlDriver, opts: ListMarkupOptions = {}): Promise<MarkupRow[]> {
  const states = opts.reviewStates ?? ['accepted']
  const where: string[] = []
  const params: unknown[] = []

  if (!opts.includeDeleted) where.push('deleted_at IS NULL')
  if (opts.pageId) { where.push('page_id = ?'); params.push(opts.pageId) }
  if (opts.documentId) { where.push('document_id = ?'); params.push(opts.documentId) }
  if (states.length > 0) {
    where.push(`review_state IN (${states.map(() => '?').join(',')})`)
    params.push(...states)
  }

  const rows = await db.all<{
    id: string; document_id: string; page_id: string; scope_id: string | null
    kind: string; geometry_json: string; origin: string; review_state: string
    style_json: string; content_json: string
  }>(
    `SELECT id, document_id, page_id, scope_id, kind, geometry_json, origin, review_state,
            style_json, content_json
     FROM markups${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at`,
    params,
  )
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    pageId: r.page_id,
    scopeId: r.scope_id,
    kind: r.kind,
    rings: safeParse(r.geometry_json, []) as MarkupRow['rings'],
    origin: r.origin,
    reviewState: r.review_state as ReviewState,
    content: safeParse(r.content_json, {}) as Record<string, unknown>,
    style: safeParse(r.style_json, {}) as Record<string, unknown>,
  }))
}

/**
 * Replace a markup's per-kind content: a dimension's offset, a callout's text.
 * Separate from geometry because editing a label must not rewrite the measured
 * span, and vice versa.
 */
export async function updateMarkupContent(
  db: SqlDriver,
  id: string,
  content: Record<string, unknown>,
): Promise<void> {
  await db.run('UPDATE markups SET content_json = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(content), nowIso(), id,
  ])
}

export async function assignMarkupScope(db: SqlDriver, id: string, scopeId: string | null): Promise<void> {
  await db.run('UPDATE markups SET scope_id = ?, updated_at = ? WHERE id = ?', [scopeId, nowIso(), id])
}

// ----------------------------------------------------------- calibration ----

export async function saveCalibration(db: SqlDriver, c: CalibrationRow): Promise<void> {
  await db.run(
    `INSERT INTO calibrations(id, document_id, page_id, feet_per_pdf_point, source, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(document_id, page_id) DO UPDATE SET
       feet_per_pdf_point=excluded.feet_per_pdf_point,
       source=excluded.source, updated_at=excluded.updated_at`,
    [`cal-${c.pageId}`, c.documentId, c.pageId, c.feetPerPdfPoint, c.source, nowIso(), nowIso()],
  )
}

export async function getCalibration(db: SqlDriver, pageId: string): Promise<CalibrationRow | null> {
  const rows = await db.all<{
    document_id: string; page_id: string; feet_per_pdf_point: number; source: string
  }>(
    `SELECT document_id, page_id, feet_per_pdf_point, source FROM calibrations WHERE page_id = ?`,
    [pageId],
  )
  const r = rows[0]
  if (!r) return null
  return {
    documentId: r.document_id,
    pageId: r.page_id,
    feetPerPdfPoint: r.feet_per_pdf_point,
    source: r.source,
  }
}

/** Remove a page's calibration entirely (used to undo a first calibration). */
/**
 * Every calibration in one document, keyed by page id.
 *
 * Calibration is per PAGE, not per document — a details sheet and a plan in
 * one set are at different scales — so anything that reports quantities across
 * sheets needs the whole map, not the open page's number. Reusing the open
 * page's calibration for a markup on another sheet is how a takeoff reports a
 * confident, wrong area.
 */
/**
 * Every calibration in the project, by page id.
 *
 * A scope spans DOCUMENTS as well as sheets — a ceiling continues from the
 * architectural set onto the interiors set — so a total that stops at the open
 * file is not a total. Reading them all at once is how the roll-up can measure
 * each page at its own scale without knowing in advance which files it is
 * about to be handed.
 */
export async function listAllCalibrations(db: SqlDriver): Promise<Map<string, number>> {
  const rows = await db.all<{ page_id: string, feet_per_pdf_point: number }>(
    'SELECT page_id, feet_per_pdf_point FROM calibrations',
  )
  return new Map(rows.map((r) => [r.page_id, r.feet_per_pdf_point]))
}

/**
 * Every page box in the project, by page id.
 *
 * Normalized geometry means nothing without the box it was normalized against,
 * and the boxes differ across a real set — a details sheet is not the size of
 * a plan. The viewer only knows the OPEN document's, so these come from the
 * store, where they were written when each page was first opened.
 */
export async function listPageBoxes(
  db: SqlDriver,
): Promise<Map<string, { width: number, height: number }>> {
  const rows = await db.all<{ id: string, width_pdf_points: number | null, height_pdf_points: number | null }>(
    'SELECT id, width_pdf_points, height_pdf_points FROM pages',
  )
  const out = new Map<string, { width: number, height: number }>()
  for (const r of rows) {
    // A page row written before its box was known is not a box. Skipping it
    // leaves the markup unmeasured, which is better than measuring it at zero.
    if (!r.width_pdf_points || !r.height_pdf_points) continue
    out.set(r.id, { width: r.width_pdf_points, height: r.height_pdf_points })
  }
  return out
}

export async function listCalibrations(
  db: SqlDriver,
  documentId: string,
): Promise<Map<string, CalibrationRow>> {
  const rows = await db.all<{
    document_id: string; page_id: string; feet_per_pdf_point: number; source: string
  }>(
    `SELECT document_id, page_id, feet_per_pdf_point, source
     FROM calibrations WHERE document_id = ?`,
    [documentId],
  )
  return new Map(rows.map((r) => [r.page_id, {
    documentId: r.document_id,
    pageId: r.page_id,
    feetPerPdfPoint: r.feet_per_pdf_point,
    source: r.source,
  }]))
}

export async function deleteCalibration(db: SqlDriver, pageId: string): Promise<void> {
  await db.run('DELETE FROM calibrations WHERE page_id = ?', [pageId])
}

// -------------------------------------------------------------- activity ----

export interface ActivityRow {
  eventType: string
  entityType: string
  entityId: string | null
  origin: string
  details?: Record<string, unknown>
}

/**
 * Append to the audit trail.
 *
 * NOTE: this is deliberately NOT change_sets. That table is a propose/decide
 * model (state defaults to 'proposed', it has decided_at and revision_of_id) —
 * it belongs to the agent review gate that pairs with markups.review_state.
 * Undo is a local editing concern and must not consume the review queue.
 */
export async function logActivity(db: SqlDriver, a: ActivityRow): Promise<void> {
  await db.run(
    `INSERT INTO activity(id, event_type, entity_type, entity_id, origin, details_json, created_at)
     VALUES(?,?,?,?,?,?,?)`,
    [
      `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      a.eventType, a.entityType, a.entityId, a.origin,
      JSON.stringify(a.details ?? {}), nowIso(),
    ],
  )
}

export async function listActivity(db: SqlDriver, limit = 100): Promise<Array<ActivityRow & { createdAt: string }>> {
  const rows = await db.all<{
    event_type: string; entity_type: string; entity_id: string | null
    origin: string; details_json: string; created_at: string
  }>(
    `SELECT event_type, entity_type, entity_id, origin, details_json, created_at
     FROM activity ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    [limit],
  )
  return rows.map((r) => ({
    eventType: r.event_type,
    entityType: r.entity_type,
    entityId: r.entity_id,
    origin: r.origin,
    details: safeParse(r.details_json, {}) as Record<string, unknown>,
    createdAt: r.created_at,
  }))
}

// -------------------------------------------------------- documents/pages ----

/**
 * The minimum needed to CREATE a page row.
 *
 * Deliberately not called `PageRow`: `documents.ts` owns that name for a read
 * page, which carries more (labels, text-index state). Two exported types with
 * one name is an ambiguity the barrel cannot resolve, and — worse — invites
 * code to assume the richer shape when it only ever had this one.
 */
export interface PageSeed {
  id: string
  documentId: string
  pageNumber: number
  width: number
  height: number
}

/** Documents and pages must exist before markups can reference them. */
export async function ensureDocumentAndPage(
  db: SqlDriver,
  doc: { id: string; relativePath: string; displayName: string },
  page: PageSeed,
): Promise<void> {
  await db.run(
    `INSERT INTO documents(id, relative_path, display_name, kind, status, size_bytes,
                           availability, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
    // Vocabularies here are the Qt build's, not invented. Verified in
    // okular-redbeam/shell/redbeamproject.cpp:
    //   availability: local | online_only | unavailable  ('available' is NOT one
    //                 of them — an earlier revision wrote it and the schema has
    //                 no CHECK to catch it)
    //   kind:         drawing | specification | submittal | other
    // `status` could not be confirmed from the Qt source; 'active' is a
    // placeholder and should be pinned once the vocabulary is known.
    [doc.id, doc.relativePath, doc.displayName, 'drawing', 'active', 0, 'local', nowIso(), nowIso()],
  )
  await db.run(
    `INSERT INTO pages(id, document_id, page_number, width_pdf_points, height_pdf_points,
                       created_at, updated_at)
     VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
    [page.id, page.documentId, page.pageNumber, page.width, page.height, nowIso(), nowIso()],
  )
}

export async function getPage(db: SqlDriver, pageId: string): Promise<PageSeed | null> {
  const rows = await db.all<{
    id: string; document_id: string; page_number: number
    width_pdf_points: number | null; height_pdf_points: number | null
  }>(
    `SELECT id, document_id, page_number, width_pdf_points, height_pdf_points FROM pages WHERE id = ?`,
    [pageId],
  )
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id,
    documentId: r.document_id,
    pageNumber: r.page_number,
    width: r.width_pdf_points ?? 0,
    height: r.height_pdf_points ?? 0,
  }
}

function safeParse(text: string, fallback: unknown): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}
