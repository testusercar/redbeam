/**
 * Which edits writing the takeoff into a drawing makes.
 *
 * Only AREAS are baked. A length, a count, a seam, a rail, trim and the panel
 * grid are not areas in Bluebeam's sense, and writing them as polygons would
 * put quantities in its markup list that are not what REDBEAM measured. An
 * area with holes is skipped for the same reason: a PDF polygon has no holes,
 * and its outline alone would overstate the area.
 */
import { signedPolygonArea, squarePointsToSquareFeet } from '@redbeam/domain'
import type { InterchangeOp, PdfAnnot, Point } from './pdfInterchange.js'
import { annotationName, encodeNote, markupIdFromName, type ScopePayload } from './payload.js'
import type { InterchangeRecord, Layout, LiveMarkup } from './reconcile.js'

export interface BakeScope {
  id: string
  label: string
  color: string
  scopeType: string
}

export interface BakeInput {
  markups: readonly LiveMarkup[]
  /** This document's markups deleted here, with the record they carried. */
  deleted: ReadonlyArray<{ id: string, interchange: InterchangeRecord | null }>
  annots: readonly PdfAnnot[]
  scopes: ReadonlyMap<string, BakeScope>
  layoutOf: (markupId: string) => Layout
  /** Feet per point for an outline on a page: its scale region's, else the page's. */
  feetPerPoint: (pageIndex: number, ring: readonly Point[]) => number | null
  /** Page index to its box in points. */
  pageBox: (pageIndex: number) => { width: number, height: number } | null
  pageCount: number
  now: string
}

export interface BakePlan {
  ops: InterchangeOp[]
  /** The record each markup will carry once its op succeeds, keyed by the op's name. */
  records: Map<string, { markupId: string, record: InterchangeRecord }>
  /** Markups not written, and why, for the status line. */
  skipped: { holes: number, offFile: number }
}

const fmt = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 1 })

export function areaSummary(label: string, ring: readonly Point[], fpp: number | null, box: { width: number, height: number } | null): string {
  if (fpp === null || box === null) return `${label} · not calibrated`
  const pts = ring.map((p) => ({ x: p.x * box.width, y: p.y * box.height }))
  return `${label} · ${fmt(squarePointsToSquareFeet(Math.abs(signedPolygonArea(pts)), fpp))} SF`
}

export function planBake(input: BakeInput): BakePlan {
  const ops: InterchangeOp[] = []
  const records: BakePlan['records'] = new Map()
  const skipped = { holes: 0, offFile: 0 }
  const present = new Set(input.annots.map((a) => `${a.pageIndex}|${a.name}`))

  for (const m of input.markups) {
    const rec = m.interchange
    if (m.pageIndex < 0 || m.pageIndex >= input.pageCount) { skipped.offFile++; continue }

    if (rec !== null && rec.origin === 'foreign') {
      const ring = m.rings[0]
      if (ring === undefined) continue
      ops.push({ op: 'reshape', pageIndex: rec.pageIndex, name: rec.name, ring })
      records.set(`${rec.pageIndex}|${rec.name}`, { markupId: m.id, record: { ...rec, ring: [...ring], at: input.now } })
      continue
    }

    if (m.kind !== 'area') continue
    if (m.rings.length !== 1 || (m.rings[0]?.length ?? 0) < 3) { skipped.holes++; continue }
    const ring = m.rings[0]!
    const scope = m.scopeId === null ? undefined : input.scopes.get(m.scopeId)
    const layout = input.layoutOf(m.id)
    const payload: ScopePayload = {
      v: 1,
      markup: m.id,
      kind: 'area',
      scope: scope === undefined ? null : { id: scope.id, label: scope.label, color: scope.color, type: scope.scopeType },
      ...(layout.direction === undefined ? {} : { direction: layout.direction }),
      ...(layout.origin === undefined ? {} : { origin: layout.origin }),
      ring: ring.map((p) => ({ x: p.x, y: p.y })),
    }
    const label = scope?.label ?? 'Unassigned'
    const fpp = input.feetPerPoint(m.pageIndex, ring)
    const name = rec?.name ?? annotationName(m.id)
    const pageIndex = rec?.pageIndex ?? m.pageIndex
    ops.push({
      op: 'bake',
      pageIndex,
      name,
      ring,
      note: encodeNote(areaSummary(label, ring, fpp, input.pageBox(m.pageIndex)), payload),
      author: label,
      color: scope?.color ?? '#888888',
      feetPerPoint: fpp,
    })
    records.set(`${pageIndex}|${name}`, {
      markupId: m.id,
      record: { name, pageIndex, origin: 'redbeam', ring: [...ring], payload, at: input.now },
    })
  }

  // What REDBEAM wrote and has since deleted here comes out of the file too.
  // Somebody else's markup never does: removing that is an explicit command.
  for (const d of input.deleted) {
    const rec = d.interchange
    const name = rec?.origin === 'redbeam' ? rec.name : annotationName(d.id)
    const pageIndex = rec?.pageIndex
    for (const a of input.annots) {
      if (a.name !== name || (pageIndex !== undefined && a.pageIndex !== pageIndex)) continue
      if (rec === null && markupIdFromName(a.name) !== d.id) continue
      if (present.has(`${a.pageIndex}|${a.name}`)) ops.push({ op: 'remove', pageIndex: a.pageIndex, name: a.name })
    }
  }

  return { ops, records, skipped }
}
