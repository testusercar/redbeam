/**
 * Storage for scale regions, and for setting one scale across many pages.
 *
 * Two gestures, from the same requirement — that a scale is set deliberately,
 * once, over whatever it actually applies to:
 *
 *   - A SERIES of pages. The whole 400-series is 1/8" = 1'-0", and setting it
 *     forty times is data entry. `applyScaleToPages` writes one number to a
 *     list of page ids in a single transaction, so a partly-applied scale is
 *     not a state the app can be left in.
 *   - A REGION of a page. A details sheet carries four scales, and one number
 *     for the page is right for one of them.
 *
 * Neither infers anything. `applyScaleToPages` writes only the pages it was
 * handed, and a region covers only what was drawn. There is deliberately no
 * "apply to similar pages", no "detect scale", and no propagation to a
 * neighbour: a page nobody set stays uncalibrated and visibly so.
 */
import type { SqlDriver } from './index.js'

const nowIso = (): string => new Date().toISOString()

export interface ScaleRegionRow {
  id: string
  documentId: string
  pageId: string
  label: string
  x0: number
  y0: number
  x1: number
  y1: number
  feetPerPdfPoint: number
  source: string
}

interface RawRow {
  id: string
  document_id: string
  page_id: string
  label: string
  x0: number
  y0: number
  x1: number
  y1: number
  feet_per_pdf_point: number
  source: string
}

const toRow = (r: RawRow): ScaleRegionRow => ({
  id: r.id,
  documentId: r.document_id,
  pageId: r.page_id,
  label: r.label,
  x0: r.x0,
  y0: r.y0,
  x1: r.x1,
  y1: r.y1,
  feetPerPdfPoint: r.feet_per_pdf_point,
  source: r.source,
})

const SELECT = `SELECT id, document_id, page_id, label, x0, y0, x1, y1,
                       feet_per_pdf_point, source FROM scale_regions`

/**
 * Every scale region in the project, ordered so resolution is deterministic.
 *
 * Read wholesale for the same reason calibrations are: a scope spans documents,
 * and the roll-up has to measure each markup at its own page's — now its own
 * REGION's — scale without knowing in advance which files it is about to see.
 */
export async function listAllScaleRegions(db: SqlDriver): Promise<ScaleRegionRow[]> {
  return (await db.all<RawRow>(`${SELECT} ORDER BY page_id, id`)).map(toRow)
}

export async function listScaleRegions(db: SqlDriver, pageId: string): Promise<ScaleRegionRow[]> {
  return (await db.all<RawRow>(`${SELECT} WHERE page_id = ? ORDER BY id`, [pageId])).map(toRow)
}

/**
 * Write a region. Corners are normalized on the way in, so a rectangle dragged
 * up-and-left is stored as the same row as one dragged down-and-right —
 * otherwise `x0 > x1` reaches every reader as a region that contains nothing.
 */
export async function saveScaleRegion(db: SqlDriver, r: ScaleRegionRow): Promise<void> {
  const now = nowIso()
  await db.run(
    `INSERT INTO scale_regions(id, document_id, page_id, label, x0, y0, x1, y1,
                               feet_per_pdf_point, source, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       label=excluded.label, x0=excluded.x0, y0=excluded.y0,
       x1=excluded.x1, y1=excluded.y1,
       feet_per_pdf_point=excluded.feet_per_pdf_point,
       source=excluded.source, updated_at=excluded.updated_at`,
    [
      r.id, r.documentId, r.pageId, r.label,
      Math.min(r.x0, r.x1), Math.min(r.y0, r.y1),
      Math.max(r.x0, r.x1), Math.max(r.y0, r.y1),
      r.feetPerPdfPoint, r.source, now, now,
    ],
  )
}

export async function deleteScaleRegion(db: SqlDriver, id: string): Promise<void> {
  await db.run('DELETE FROM scale_regions WHERE id = ?', [id])
}

/**
 * Set one scale on a list of pages, all or nothing.
 *
 * The transaction is the point. Applying a scale to forty sheets and failing
 * on the thirty-first would leave a set where some pages measure and some do
 * not, and nothing on screen would say which — an estimator would find it by
 * noticing a quantity that looks wrong. Either the whole selection is set or
 * none of it is.
 *
 * Returns the pages it wrote, so the caller can say "38 sheets" rather than
 * "done" and the number can be checked against what was selected.
 */
export async function applyScaleToPages(
  db: SqlDriver,
  pages: ReadonlyArray<{ documentId: string, pageId: string }>,
  feetPerPdfPoint: number,
  source: string,
): Promise<string[]> {
  if (!Number.isFinite(feetPerPdfPoint) || feetPerPdfPoint <= 0) {
    throw new Error(`refusing to write a scale of ${feetPerPdfPoint}`)
  }
  if (pages.length === 0) return []

  const now = nowIso()
  await db.run('BEGIN')
  try {
    for (const p of pages) {
      await db.run(
        `INSERT INTO calibrations(id, document_id, page_id, feet_per_pdf_point,
                                  source, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(document_id, page_id) DO UPDATE SET
           feet_per_pdf_point=excluded.feet_per_pdf_point,
           source=excluded.source, updated_at=excluded.updated_at`,
        [`cal-${p.pageId}`, p.documentId, p.pageId, feetPerPdfPoint, source, now, now],
      )
    }
    await db.run('COMMIT')
  } catch (err) {
    await db.run('ROLLBACK')
    throw err
  }
  return pages.map((p) => p.pageId)
}
