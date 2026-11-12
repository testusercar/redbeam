/**
 * Between redbeam.db and a drawing's embedded takeoff.
 *
 * `sheetEmbed` knows PDF and nothing about a project. This is the other half:
 * which rows of redbeam.db make up one drawing's slice, what each markup's
 * Bluebeam annotation should say, when the file needs writing at all, and how
 * a slice found in a PDF gets back into a database that has nothing for it.
 *
 * Everything that touches the outside world arrives as an argument — the
 * database, reading and writing the file — so it runs under test with sql.js
 * and an in-memory "disk".
 */
import type { SqlDriver } from '@redbeam/store'
import { pageNumberFrom } from '@redbeam/store'
import { polylineLength, regionArea, squarePointsToSquareFeet } from '@redbeam/domain'
import {
  embedSheet, readSheetEmbed, type EmbedMarkup, type SheetEmbedReading, type SheetSlice, type SliceTables,
} from './sheetEmbed.js'
import type { WritableScaleRegion } from './pdfMarkup.js'

/**
 * The tables a drawing's slice is cut from, and how each is filtered to it.
 *
 * Scope rows travel whole (specifications, layout settings) because a markup
 * without its scope is a shape without a meaning. Calculation runs travel for
 * the scopes on this sheet, with their quantity results (the counts) and only
 * THIS drawing's layout components.
 */
const SLICE_QUERIES: ReadonlyArray<readonly [string, string]> = [
  ['documents', 'SELECT * FROM documents WHERE id = ?1'],
  ['pages', 'SELECT * FROM pages WHERE document_id = ?1'],
  ['calibrations', 'SELECT * FROM calibrations WHERE document_id = ?1'],
  ['scale_regions', 'SELECT * FROM scale_regions WHERE document_id = ?1'],
  ['markups', 'SELECT * FROM markups WHERE document_id = ?1 AND deleted_at IS NULL'],
  ['scopes', `SELECT * FROM scopes WHERE id IN (
     SELECT scope_id FROM markups WHERE document_id = ?1 AND deleted_at IS NULL AND scope_id IS NOT NULL)`],
  ['calculation_runs', `SELECT * FROM calculation_runs WHERE scope_id IN (
     SELECT scope_id FROM markups WHERE document_id = ?1 AND deleted_at IS NULL AND scope_id IS NOT NULL)`],
  ['quantity_results', `SELECT * FROM quantity_results WHERE calculation_run_id IN (
     SELECT id FROM calculation_runs WHERE scope_id IN (
       SELECT scope_id FROM markups WHERE document_id = ?1 AND deleted_at IS NULL AND scope_id IS NOT NULL))`],
  ['layout_components', 'SELECT * FROM layout_components WHERE document_id = ?1'],
]

/** Volatile columns that change without the takeoff changing. */
const VOLATILE = new Set(['modified_at_observed', 'content_fingerprint', 'size_bytes', 'availability',
  'text_indexed_at', 'updated_at'])

/** This drawing's rows of redbeam.db. A table the database lacks is left out. */
export async function sliceTables(db: SqlDriver, documentId: string): Promise<SliceTables> {
  const out: SliceTables = {}
  for (const [table, sql] of SLICE_QUERIES) {
    try {
      const rows = await db.all<Record<string, unknown>>(sql.replace(/\?1/g, '?'),
        Array.from({ length: (sql.match(/\?1/g) ?? []).length }, () => documentId))
      out[table] = rows.map((r) => {
        const row: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(r)) if (!VOLATILE.has(k) || table !== 'documents') row[k] = v
        return row
      })
    } catch {
      // An older database without that table simply has nothing to carry.
    }
  }
  return out
}

interface MarkupRowLike {
  id: string
  page_id: string
  scope_id: string | null
  kind: string
  geometry_json: string
}

interface ScopeRowLike { id: string, label: string, color: string }

const parseRings = (json: string): Array<Array<{ x: number, y: number }>> => {
  try {
    const v = JSON.parse(json) as unknown
    return Array.isArray(v) ? v as Array<Array<{ x: number, y: number }>> : []
  } catch {
    return []
  }
}

/**
 * The Bluebeam-facing markups for a slice: one per takeoff markup, with the
 * scope as its label and its NET quantity. An area's holes are drawn as
 * deductions so the shape on the sheet matches the number beside it.
 */
export function embedMarkupsFor(tables: SliceTables, documentId: string): {
  markups: EmbedMarkup[]
  pageScales: Map<number, number>
  pageRegions: Map<number, WritableScaleRegion[]>
} {
  const scopes = new Map((tables.scopes ?? []).map((s) => [String(s.id), s as unknown as ScopeRowLike]))
  const boxes = new Map((tables.pages ?? []).map((p) => [String(p.id), {
    width: Number(p.width_pdf_points ?? 0), height: Number(p.height_pdf_points ?? 0),
  }]))
  const fppByPage = new Map((tables.calibrations ?? []).map((c) => [String(c.page_id), Number(c.feet_per_pdf_point)]))

  const pageScales = new Map<number, number>()
  for (const [pageId, fpp] of fppByPage) {
    const i = pageNumberFrom(pageId, documentId)
    if (i !== null && fpp > 0) pageScales.set(i, fpp)
  }
  const pageRegions = new Map<number, WritableScaleRegion[]>()
  for (const r of tables.scale_regions ?? []) {
    const i = pageNumberFrom(String(r.page_id), documentId)
    if (i === null) continue
    const list = pageRegions.get(i) ?? []
    list.push({
      rect: { x0: Number(r.x0), y0: Number(r.y0), x1: Number(r.x1), y1: Number(r.y1) },
      feetPerPoint: Number(r.feet_per_pdf_point),
      label: String(r.label ?? ''),
    })
    pageRegions.set(i, list)
  }

  const markups: EmbedMarkup[] = []
  for (const raw of (tables.markups ?? []) as unknown as MarkupRowLike[]) {
    const pageIndex = pageNumberFrom(raw.page_id, documentId)
    if (pageIndex === null) continue
    const rings = parseRings(raw.geometry_json)
    if (rings.length === 0) continue
    const scope = raw.scope_id === null ? undefined : scopes.get(raw.scope_id)
    const label = scope?.label ?? 'Unassigned'
    const color = scope?.color ?? '#888888'
    const box = boxes.get(raw.page_id)
    const fpp = fppByPage.get(raw.page_id)
    let quantity: number | null = null
    if (box !== undefined && box.width > 0 && box.height > 0 && fpp !== undefined) {
      if (raw.kind === 'area') {
        const region = rings.map((ring) => ring.map((p) => ({ x: p.x * box.width, y: p.y * box.height })))
        quantity = squarePointsToSquareFeet(regionArea(region), fpp)
      } else if (raw.kind === 'polyline') {
        quantity = polylineLength([...rings[0]!], box.width, box.height) * fpp
      }
    }
    if (raw.kind === 'count') quantity = 1
    markups.push({ id: raw.id, pageIndex, kind: raw.kind, rings: [rings[0]!], scopeLabel: label, color, quantity })
    if (raw.kind === 'area') {
      rings.slice(1).forEach((hole, n) => {
        markups.push({ id: `${raw.id}#hole${n + 1}`, pageIndex, kind: 'cutout', rings: [hole], scopeLabel: label, color })
      })
    }
  }
  return { markups, pageScales, pageRegions }
}

export interface DrawingFile {
  /** The drawing's bytes as they are now, and a token naming that version. */
  read: () => Promise<{ bytes: Uint8Array, version: string }>
  /**
   * Replace the drawing, but only if it is still the version `read` returned.
   * Resolves false when somebody (Bluebeam, OneDrive) changed it in between.
   */
  write: (bytes: Uint8Array, expectedVersion: string) => Promise<boolean>
}

export type EmbedOutcome =
  | { kind: 'written', editedElsewhere: string[], foreignKept: number }
  | { kind: 'unchanged' }
  | { kind: 'nothing-to-embed' }
  | { kind: 'busy' }
  | { kind: 'failed', message: string }

/**
 * Write a drawing's slice into its PDF, if it needs it.
 *
 * A drawing REDBEAM has never marked up and that carries nothing of ours is
 * left alone: writing an empty slice into every sheet somebody merely opened
 * would touch hundreds of synced files for nothing.
 */
export async function embedDrawing(opts: {
  db: SqlDriver
  documentId: string
  relativePath: string
  displayName: string
  appVersion: string
  file: DrawingFile
}): Promise<EmbedOutcome> {
  const tables = await sliceTables(opts.db, opts.documentId)
  const { markups, pageScales, pageRegions } = embedMarkupsFor(tables, opts.documentId)

  let current: { bytes: Uint8Array, version: string }
  try {
    current = await opts.file.read()
  } catch (err) {
    return { kind: 'failed', message: err instanceof Error ? err.message : String(err) }
  }

  try {
    if (markups.length === 0) {
      // Nothing of ours to show; only write if the file still shows OLD ours.
      const before = await readSheetEmbed(current.bytes)
      if (before.slice === null && before.redbeamAnnots.length === 0) return { kind: 'nothing-to-embed' }
    }
    const result = await embedSheet(current.bytes, {
      documentId: opts.documentId,
      relativePath: opts.relativePath,
      displayName: opts.displayName,
      appVersion: opts.appVersion,
      tables,
      markups,
      pageScales,
      pageRegions,
    })
    if (result.bytes === null) return { kind: 'unchanged' }
    const ok = await opts.file.write(result.bytes, current.version)
    if (!ok) return { kind: 'busy' }
    return { kind: 'written', editedElsewhere: result.editedElsewhere, foreignKept: result.foreignKept }
  } catch (err) {
    return { kind: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
}

/** Order matters: a row's parents go in before it does. */
const IMPORT_ORDER = ['scopes', 'calibrations', 'scale_regions', 'markups',
  'calculation_runs', 'quantity_results', 'layout_components'] as const

const IDENT = /^[a-z_][a-z0-9_]*$/

/**
 * Re-key a slice's rows onto this project's document.
 *
 * The slice was written in some other job folder, where the drawing had some
 * other id. Page ids are built from the document id, so they are rewritten
 * with it; every other id (markups, scopes, runs) is a UUID and carries over.
 */
function rekey(row: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
  if (from === to) return row
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'document_id' && v === from) out[k] = to
    else if (k === 'page_id' && typeof v === 'string' && v.startsWith(`${from}-p`)) out[k] = `${to}-p${v.slice(from.length + 2)}`
    else out[k] = v
  }
  return out
}

export interface ImportOutcome { markups: number, scopes: number }

/**
 * Bring a drawing's embedded takeoff into a database that has none for it.
 *
 * Only ever ADDS: rows that already exist are kept as they are (INSERT OR
 * IGNORE), because redbeam.db is the record and the embed is a copy. A
 * database that already has markups on this drawing is not touched at all.
 */
export async function importSlice(
  db: SqlDriver,
  documentId: string,
  slice: SheetSlice,
): Promise<ImportOutcome | null> {
  const existing = await db.all<{ n: number }>(
    'SELECT COUNT(*) AS n FROM markups WHERE document_id = ? AND deleted_at IS NULL', [documentId])
  if ((existing[0]?.n ?? 0) > 0) return null

  // Pages must exist for markups to reference; they are normally created when
  // the drawing is opened, so only missing ones are added.
  const tables: Array<readonly [string, Array<Record<string, unknown>>]> = [
    ['pages', slice.tables.pages ?? []],
    ...IMPORT_ORDER.map((t) => [t, slice.tables[t] ?? []] as const),
  ]
  let markups = 0
  let scopes = 0
  await db.exec('BEGIN')
  try {
    for (const [table, rows] of tables) {
      for (const raw of rows) {
        const row = rekey(raw, slice.documentId, documentId)
        const cols = Object.keys(row).filter((c) => IDENT.test(c))
        if (cols.length === 0) continue
        const sql = `INSERT OR IGNORE INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`
        try {
          await db.run(sql, cols.map((c) => row[c]))
        } catch {
          // A column this database does not have (an older schema) or a row
          // whose parent is missing: skip the row, keep the rest.
          continue
        }
        if (table === 'markups') markups++
        if (table === 'scopes') scopes++
      }
    }
    await db.exec('COMMIT')
  } catch (err) {
    await db.exec('ROLLBACK')
    throw err
  }
  return { markups, scopes }
}

/** A short line for the status bar after an embed, or null for silence. */
export function embedStatus(outcome: EmbedOutcome, name: string): string | null {
  switch (outcome.kind) {
    case 'written':
      return outcome.editedElsewhere.length > 0
        ? `takeoff saved into ${name}. ${outcome.editedElsewhere.length} markup(s) changed in another app were left as that app saved them`
        : `takeoff saved into ${name}`
    case 'busy':
      return `${name} changed on disk (open in Bluebeam?), so its takeoff was not saved into it this time`
    case 'failed':
      return `could not save the takeoff into ${name}: ${outcome.message}`
    default:
      return null
  }
}

/** What to tell the user when a drawing is opened, or null. */
export function openingStatus(reading: SheetEmbedReading, imported: ImportOutcome | null, name: string): string | null {
  if (imported !== null && imported.markups > 0) {
    return `loaded ${imported.markups} markup(s) and ${imported.scopes} scope(s) carried inside ${name}`
  }
  if (reading.privateDataLost) {
    return `${name} was saved by another app that dropped REDBEAM's scope detail. Its markups are still in redbeam.db`
  }
  return null
}
