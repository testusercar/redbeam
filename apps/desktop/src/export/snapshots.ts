/**
 * Pictures of the takeoff, one per sheet that carries any.
 *
 * A quantity on its own is a claim; the client presentation carries the
 * sheet it was measured on with the takeoff drawn over it, so the number can
 * be checked by eye. Each sheet with markups for the round's scopes is
 * rendered headlessly, the markups are drawn in their scope's colour, and
 * the result is cropped to the takeoff with a margin — a ceiling in one
 * corner of a 36x48 sheet should fill the picture, not sit in it.
 *
 * Everything reaches this through arguments — the bytes, the worker, the
 * markups — so the composition can be checked without a project.
 */
import { openHeadlessDocument, type HeadlessDocument } from '../project/headlessDocument.js'

export interface SnapshotMarkup {
  scopeId: string | null
  documentId: string
  pageId: string
  kind: string
  rings: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>
}

export interface SnapshotScope { id: string; label: string; color: string }

export interface SnapshotDocument { id: string; relativePath: string; displayName: string }

export interface TakeoffSnapshot {
  documentId: string
  documentName: string
  pageIndex: number
  /** The sheet's label, from the sheet index — "A-101" — or "Page 3". */
  sheetLabel: string
  /** Scopes drawn on this picture, in the order given. */
  scopes: SnapshotScope[]
  png: Uint8Array
  width: number
  height: number
}

export interface SnapshotOptions {
  documents: readonly SnapshotDocument[]
  markups: readonly SnapshotMarkup[]
  scopes: readonly SnapshotScope[]
  /** Sheet label for a page id. */
  sheetLabelFor: (documentId: string, pageIndex: number) => string
  resolveUrl: (doc: { relativePath: string }) => Promise<string | null>
  releaseUrl: (url: string) => void
  /** Test seam. Defaults to a headless worker. */
  openDocument?: (url: string) => Promise<HeadlessDocument>
  /** Pixels across the FULL page before cropping. 2000 keeps text legible. */
  renderWidth?: number
  /** Margin around the takeoff, as a fraction of its own size. */
  margin?: number
  /** Called after each sheet, so a long export can say where it is. */
  onProgress?: (done: number, total: number) => void
  isCancelled?: () => boolean
}

/** Zero-based page index out of a page id, which is `${documentId}-p${n}`. */
export function pageIndexOf(pageId: string): number | null {
  const m = /-p(\d+)$/.exec(pageId)
  return m === null ? null : Number(m[1])
}

const TAKEOFF = new Set(['area', 'cutout', 'polyline', 'count'])

/** Which sheets need a picture: every page carrying takeoff for these scopes. */
export function sheetsToSnapshot(
  markups: readonly SnapshotMarkup[],
  scopeIds: ReadonlySet<string>,
): Map<string, { documentId: string; pageIndex: number; markups: SnapshotMarkup[] }> {
  const out = new Map<string, { documentId: string; pageIndex: number; markups: SnapshotMarkup[] }>()
  for (const m of markups) {
    if (m.scopeId === null || !scopeIds.has(m.scopeId) || !TAKEOFF.has(m.kind)) continue
    const index = pageIndexOf(m.pageId)
    if (index === null) continue
    const entry = out.get(m.pageId) ?? { documentId: m.documentId, pageIndex: index, markups: [] }
    entry.markups.push(m)
    out.set(m.pageId, entry)
  }
  return out
}

/** The crop, in normalized page space, around a set of markups. */
export function cropFor(
  markups: readonly SnapshotMarkup[],
  margin: number,
): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0
  for (const m of markups) {
    for (const ring of m.rings) {
      for (const p of ring) {
        if (p.x < x0) x0 = p.x
        if (p.y < y0) y0 = p.y
        if (p.x > x1) x1 = p.x
        if (p.y > y1) y1 = p.y
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return { x0: 0, y0: 0, x1: 1, y1: 1 }
  // The margin is a share of the LARGER side, so a long thin run does not
  // get a sliver of context on its short axis. Never less than a few
  // per cent of the sheet, so a single count dot still shows its surroundings.
  const pad = Math.max((Math.max(x1 - x0, y1 - y0)) * margin, 0.04)
  return {
    x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad),
    x1: Math.min(1, x1 + pad), y1: Math.min(1, y1 + pad),
  }
}

/** Draw the takeoff over a rendered page, in page-pixel space. */
export function drawTakeoff(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  markups: readonly SnapshotMarkup[],
  colorOf: (scopeId: string | null) => string,
  pageW: number,
  pageH: number,
  lineWidth: number,
): void {
  const at = (p: { x: number; y: number }) => ({ x: p.x * pageW, y: p.y * pageH })
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const m of markups) {
    const color = colorOf(m.scopeId)
    const ring = m.rings[0]
    if (ring === undefined || ring.length === 0) continue
    if (m.kind === 'count') {
      const s = at(ring[0]!)
      ctx.globalAlpha = 1
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(s.x, s.y, lineWidth * 3, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    ring.forEach((p, i) => { const s = at(p); if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y) })
    if (m.kind === 'area' || m.kind === 'cutout') {
      ctx.closePath()
      if (m.kind === 'area') {
        ctx.globalAlpha = 0.22
        ctx.fillStyle = color
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.setLineDash(m.kind === 'cutout' ? [lineWidth * 4, lineWidth * 3] : [])
    ctx.stroke()
  }
  ctx.restore()
}

async function toPng(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Render every sheet that carries takeoff for the given scopes.
 *
 * Documents are opened one at a time and closed as soon as their sheets are
 * done. A document that cannot be read is skipped, not fatal: a report with
 * eleven pictures and a note is better than no report.
 */
export async function renderTakeoffSnapshots(opts: SnapshotOptions): Promise<{
  snapshots: TakeoffSnapshot[]
  failures: Array<{ document: string; reason: string }>
}> {
  const scopeIds = new Set(opts.scopes.map((s) => s.id))
  const colorOf = (id: string | null) => opts.scopes.find((s) => s.id === id)?.color ?? '#888888'
  const sheets = sheetsToSnapshot(opts.markups, scopeIds)
  const byDocument = new Map<string, Array<{ pageIndex: number; markups: SnapshotMarkup[] }>>()
  for (const entry of sheets.values()) {
    const list = byDocument.get(entry.documentId) ?? []
    list.push({ pageIndex: entry.pageIndex, markups: entry.markups })
    byDocument.set(entry.documentId, list)
  }

  const open = opts.openDocument ?? ((url: string) => openHeadlessDocument(url))
  const renderWidth = opts.renderWidth ?? 2000
  const margin = opts.margin ?? 0.18
  const cancelled = opts.isCancelled ?? (() => false)
  const total = sheets.size
  let done = 0
  const snapshots: TakeoffSnapshot[] = []
  const failures: Array<{ document: string; reason: string }> = []

  for (const [documentId, pages] of byDocument) {
    if (cancelled()) break
    const doc = opts.documents.find((d) => d.id === documentId)
    if (doc === undefined) {
      failures.push({ document: documentId, reason: 'not in this project' })
      done += pages.length
      continue
    }
    let url: string | null = null
    let opened: HeadlessDocument | null = null
    try {
      url = await opts.resolveUrl(doc)
      if (url === null) throw new Error('the file could not be read')
      opened = await open(url)
      pages.sort((a, b) => a.pageIndex - b.pageIndex)
      for (const page of pages) {
        if (cancelled()) break
        const bmp = await opened.raster(page.pageIndex, renderWidth)
        const crop = cropFor(page.markups, margin)
        const sx = Math.floor(crop.x0 * bmp.width)
        const sy = Math.floor(crop.y0 * bmp.height)
        const sw = Math.max(1, Math.ceil((crop.x1 - crop.x0) * bmp.width))
        const sh = Math.max(1, Math.ceil((crop.y1 - crop.y0) * bmp.height))
        const canvas = new OffscreenCanvas(sw, sh)
        const ctx = canvas.getContext('2d')
        if (ctx === null) throw new Error('no 2D context')
        ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh)
        ctx.translate(-sx, -sy)
        // Line weight follows the crop, so a tight crop is not drowned in ink
        // and a whole-sheet crop is not drawn in hairlines.
        drawTakeoff(ctx, page.markups, colorOf, bmp.width, bmp.height, Math.max(2, sw / 400))
        bmp.close()
        const seen = new Set<string>()
        const scopesHere = page.markups
          .map((m) => m.scopeId)
          .filter((id): id is string => id !== null && !seen.has(id) && (seen.add(id), true))
          .map((id) => opts.scopes.find((s) => s.id === id))
          .filter((s): s is SnapshotScope => s !== undefined)
        snapshots.push({
          documentId,
          documentName: doc.displayName || doc.relativePath,
          pageIndex: page.pageIndex,
          sheetLabel: opts.sheetLabelFor(documentId, page.pageIndex),
          scopes: scopesHere,
          png: await toPng(canvas),
          width: sw,
          height: sh,
        })
        done++
        opts.onProgress?.(done, total)
      }
    } catch (err) {
      failures.push({
        document: doc.displayName || doc.relativePath,
        reason: err instanceof Error ? err.message : String(err),
      })
      done += pages.length
      opts.onProgress?.(done, total)
    } finally {
      opened?.close()
      if (url !== null) opts.releaseUrl(url)
    }
  }
  return { snapshots, failures }
}
