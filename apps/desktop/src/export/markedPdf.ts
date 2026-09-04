/**
 * Turning the open drawing into a marked-up PDF.
 *
 * `writeMarkupsToPdf` knows about geometry and nothing about a project. This
 * is the part between it and the app: which markups belong to this file, what
 * each one should say on it, and what the resulting file is called.
 *
 * Everything it touches arrives as an argument — the bytes reader and the
 * saver included — so the whole path can be exercised without Tauri, a
 * WebView2 download, or a real PDF on disk.
 */
import { pageNumberFrom } from '@redbeam/store'
import { polylineLength, signedPolygonArea, squarePointsToSquareFeet } from '@redbeam/domain'
import { writeMarkupsToPdf, type WritableMarkup } from './pdfMarkup.js'

export interface ExportableMarkup {
  id: string
  pageId: string
  /** Null on a markup drawn before a scope was chosen for it. */
  scopeId: string | null
  kind: string
  rings: ReadonlyArray<ReadonlyArray<{ x: number, y: number }>>
}

export interface ExportableScope { id: string, label: string, color: string }

export interface MarkedPdfRequest {
  documentId: string
  /** The file's name, which becomes the basis of the saved one. */
  documentName: string
  markups: readonly ExportableMarkup[]
  scopes: readonly ExportableScope[]
  /** Page id to feet per PDF point. A page with no entry is uncalibrated. */
  calibrations: ReadonlyMap<string, number>
  /** Page id to its box in points, for turning normalized rings into an area. */
  pageBoxes: ReadonlyMap<string, { width: number, height: number }>
  readBytes: () => Promise<Uint8Array>
  save: (fileName: string, bytes: Uint8Array) => void
}

const fmt = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 1 })

/**
 * What the annotation says when somebody clicks it.
 *
 * The scope is already the author, so the body carries the measurement — the
 * thing a person opening the sheet in six months actually wants. An
 * uncalibrated page says so rather than showing a number in points dressed up
 * as feet, which would be worse than saying nothing.
 */
export function noteFor(
  markup: ExportableMarkup,
  feetPerPoint: number | undefined,
  box: { width: number, height: number } | undefined,
): string {
  if (markup.kind === 'cutout') return 'Deduction'
  // A count is one of something. There is no measurement to state, and a
  // length or an area on it would be a number nobody asked for.
  if (markup.kind === 'count') return '1 EA'
  const ring = markup.rings[0]
  if (ring === undefined) return ''
  if (markup.kind === 'polyline') {
    if (ring.length < 2) return ''
    if (feetPerPoint === undefined || box === undefined) return 'Not calibrated'
    return `${fmt(polylineLength([...ring], box.width, box.height) * feetPerPoint)} LF`
  }
  if (ring.length < 3) return ''
  if (feetPerPoint === undefined || box === undefined) return 'Not calibrated'
  const points = ring.map((p) => ({ x: p.x * box.width, y: p.y * box.height }))
  const sf = squarePointsToSquareFeet(Math.abs(signedPolygonArea(points)), feetPerPoint)
  return `${fmt(sf)} SF`
}

/**
 * Write the drawing out with its markups on it.
 *
 * Resolves to a message to show the user, or null when the file was saved.
 * Failures are returned rather than thrown because every one of them is
 * something a person can act on — a drawing with nothing on it, a file that
 * has gone missing — and none of them is a crash.
 */
export async function exportMarkedPdf(req: MarkedPdfRequest): Promise<string | null> {
  const byScope = new Map(req.scopes.map((s) => [s.id, s]))

  const writable: WritableMarkup[] = []
  for (const m of req.markups) {
    // A scope spans documents, so the list handed in routinely holds rows from
    // other files. `pageNumberFrom` returns null for those rather than a
    // position, which is what keeps them off this sheet.
    const pageIndex = pageNumberFrom(m.pageId, req.documentId)
    if (pageIndex === null) continue
    const scope = m.scopeId === null ? undefined : byScope.get(m.scopeId)
    writable.push({
      id: m.id,
      pageIndex,
      kind: m.kind,
      rings: m.rings,
      // An orphaned markup still belongs on the sheet — it is evidence of
      // work, and hiding it would make the export disagree with the app.
      scopeLabel: scope?.label ?? 'Unassigned',
      color: scope?.color ?? '#888888',
      note: noteFor(m, req.calibrations.get(m.pageId), req.pageBoxes.get(m.pageId)),
    })
  }

  if (writable.length === 0) return 'This drawing has no markups to write.'

  let source: Uint8Array
  try {
    source = await req.readBytes()
  } catch {
    // The usual cause is a drawing that has moved or gone offline since it was
    // ingested, which is worth saying plainly rather than as a stack trace.
    return `${req.documentName} could not be read from the project folder.`
  }

  // The page scale, keyed the way the writer addresses pages. Built from the
  // calibrations we actually hold, so a page nobody calibrated goes out
  // unscaled rather than borrowing a neighbouring sheet's scale.
  const pageScales = new Map<number, number>()
  for (const [pageId, feetPerPoint] of req.calibrations) {
    const index = pageNumberFrom(pageId, req.documentId)
    if (index !== null) pageScales.set(index, feetPerPoint)
  }

  const out = await writeMarkupsToPdf(source, writable, {
    producer: 'REDBEAM',
    pageScales,
  })
  req.save(markedFileName(req.documentName), out)
  return null
}

/**
 * The saved file's name.
 *
 * Suffixed rather than replaced, so it sorts next to the original and nobody
 * has to guess which drawing it came from — and never the same name, because
 * an export that looks like the consultant's issued file is one somebody will
 * eventually send back to them as if it were.
 */
export function markedFileName(documentName: string): string {
  const base = documentName.replace(/\.pdf$/i, '')
  return `${base} (REDBEAM markups).pdf`.replace(/[/:*?"<>|\\]/g, '-')
}
