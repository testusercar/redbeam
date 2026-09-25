/**
 * Reading and writing a drawing's own annotations, in place.
 *
 * `export/pdfMarkup.ts` writes a COPY of the drawing for someone else to read.
 * This edits the drawing itself, so the same file can go back and forth
 * between REDBEAM and Bluebeam. That changes what "careful" means:
 *
 *  - An edit touches one annotation dictionary and nothing else. Keys this
 *    file does not know about (Bluebeam's status, custom columns, measurement
 *    data) stay as they were, and so does every other annotation, reply and
 *    page scale. Page viewports are never written here.
 *  - Some files are not ours to rewrite at all. An encrypted file is refused,
 *    because pdf-lib cannot write it back with its protection intact; a signed
 *    file is refused, because any rewrite invalidates the signature.
 *  - Some annotations are not ours to rewrite either. A Bluebeam group
 *    (`/IRT` + `/RT /Group`, or `/GroupNesting`) and a Locked annotation are
 *    refused one by one, and the rest of the batch still goes through.
 *
 * Coordinates are normalized display space in and out, like every markup.
 */
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString,
  type PDFContext, type PDFObject, type PDFPage,
} from 'pdf-lib'
import {
  buildAppearance, fromUserSpace, measureDict, toPdfColor, toUserSpace, type PageBox,
} from '../export/pdfMarkup.js'
import { decodeNote, markupIdFromName, type ScopePayload } from './payload.js'

export interface Point { x: number, y: number }

export type FileRefusal = 'locked' | 'signed' | 'unreadable'

export interface Refused {
  kind: FileRefusal
  message: string
}

export interface PdfAnnot {
  pageIndex: number
  /** Index in the page's /Annots array — the same index PDFium uses. */
  index: number
  subtype: string
  /** /NM. Empty when the annotation has none. */
  name: string
  contents: string
  /** A polygon's or polyline's vertices, normalized. Empty for anything else. */
  ring: Point[]
  flags: number
  /** Part of a Bluebeam group, as a member or as its head. */
  grouped: boolean
  /** The Locked flag (bit 8). */
  locked: boolean
  /** A revision cloud. Outside what this file rewrites. */
  cloud: boolean
  /** The /NM of the annotation this one replies to, or null. */
  replyTo: string | null
  hasMeasure: boolean
  /** From a `redbeam:` name. */
  markupId: string | null
  /** From the note, when it carries one. */
  payload: ScopePayload | null
}

export interface Inspection {
  refused: Refused | null
  pageCount: number
  /** Each page's displayed size in points: the CropBox, turned by /Rotate. */
  pageSizes: Array<{ width: number, height: number }>
  annots: PdfAnnot[]
}

export type InterchangeOp =
  /** Create or update a REDBEAM area, found by name. */
  | {
    op: 'bake'
    pageIndex: number
    name: string
    ring: readonly Point[]
    note: string
    /** Shown as the annotation's author: the scope label. */
    author: string
    color: string
    /** Null on an uncalibrated sheet: the outline and note go, no measurement. */
    feetPerPoint: number | null
  }
  /** Move the vertices of an existing polygon or polyline, anyone's. */
  | { op: 'reshape', pageIndex: number, name: string, ring: readonly Point[] }
  /**
   * Delete an annotation, with its popup and its replies. Found by name, or
   * by its /Annots index when it has none; `subtype` guards that index.
   */
  | { op: 'remove', pageIndex: number, name: string, index?: number, subtype?: string }

export type OpResult = 'created' | 'updated' | 'unchanged' | 'removed' | 'refused' | 'missing'

export interface OpOutcome {
  op: InterchangeOp['op']
  pageIndex: number
  name: string
  result: OpResult
  reason?: string
}

export type ApplyResult =
  | { ok: true, changed: boolean, bytes: Uint8Array, outcomes: OpOutcome[] }
  | { ok: false, refused: Refused }

const N = (s: string): PDFName => PDFName.of(s)

const LOCKED_FLAG = 128
const NOT_A_MARKUP = new Set(['Link', 'Popup', 'Widget'])

/** A PDF text string: literal when it is plain ASCII, UTF-16 otherwise. */
function pdfText(s: string): PDFString | PDFHexString {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e\n\r\t]*$/.test(s) ? PDFString.of(s) : PDFHexString.fromText(s)
}

function textOf(dict: PDFDict, key: string): string {
  const v = dict.lookup(N(key))
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : ''
}

function numbersOf(dict: PDFDict, key: string): number[] {
  const a = dict.lookup(N(key))
  if (!(a instanceof PDFArray)) return []
  const out: number[] = []
  for (let i = 0; i < a.size(); i++) {
    const n = a.lookup(i)
    if (n instanceof PDFNumber) out.push(n.asNumber())
  }
  return out
}

function nameOf(dict: PDFDict, key: string): string | null {
  const v = dict.lookup(N(key))
  return v instanceof PDFName ? v.decodeText() : null
}

function numberOf(dict: PDFDict, key: string, fallback: number): number {
  const v = dict.lookup(N(key))
  return v instanceof PDFNumber ? v.asNumber() : fallback
}

// ------------------------------------------------------------------ open --

async function openPdf(bytes: Uint8Array): Promise<{ doc: PDFDocument } | { refused: Refused }> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (err) {
    const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err)
    if (/encrypt/i.test(msg)) {
      return { refused: { kind: 'locked', message: 'This drawing is password protected, so REDBEAM will not write to it.' } }
    }
    return { refused: { kind: 'unreadable', message: 'This drawing could not be read as a PDF.' } }
  }
  if (doc.isEncrypted) {
    return { refused: { kind: 'locked', message: 'This drawing is password protected, so REDBEAM will not write to it.' } }
  }
  if (isSigned(doc)) {
    return { refused: { kind: 'signed', message: 'This drawing is signed. Writing to it would break the signature.' } }
  }
  return { doc }
}

/**
 * Any signature at all: the catalog's /Perms, the AcroForm's SignaturesExist
 * bit, or a signature field with a value. Checked broadly, because the cost of
 * a false "signed" is one refused write and the cost of a missed one is a
 * broken signature on an issued set.
 */
function isSigned(doc: PDFDocument): boolean {
  const catalog = doc.catalog
  if (catalog.has(N('Perms'))) return true
  const acro = catalog.lookup(N('AcroForm'))
  if (acro instanceof PDFDict) {
    if ((numberOf(acro, 'SigFlags', 0) & 1) === 1) return true
    const seen = new Set<PDFDict>()
    const walk = (fields: PDFObject | undefined): boolean => {
      if (!(fields instanceof PDFArray)) return false
      for (let i = 0; i < fields.size(); i++) {
        const f = fields.lookup(i)
        if (!(f instanceof PDFDict) || seen.has(f)) continue
        seen.add(f)
        if (nameOf(f, 'FT') === 'Sig' && f.has(N('V'))) return true
        if (walk(f.lookup(N('Kids')))) return true
      }
      return false
    }
    if (walk(acro.lookup(N('Fields')))) return true
  }
  for (const page of doc.getPages()) {
    for (const e of annotEntries(page)) {
      if (nameOf(e.dict, 'Subtype') === 'Widget' && nameOf(e.dict, 'FT') === 'Sig' && e.dict.has(N('V'))) return true
    }
  }
  return false
}

// ----------------------------------------------------------------- read --

interface Entry {
  index: number
  ref: PDFRef | null
  dict: PDFDict
}

function annotsArray(page: PDFPage): PDFArray | null {
  const a = page.node.lookup(N('Annots'))
  return a instanceof PDFArray ? a : null
}

function annotEntries(page: PDFPage): Entry[] {
  const arr = annotsArray(page)
  if (arr === null) return []
  const out: Entry[] = []
  for (let i = 0; i < arr.size(); i++) {
    const raw = arr.get(i)
    const dict = arr.lookup(i)
    if (dict instanceof PDFDict) out.push({ index: i, ref: raw instanceof PDFRef ? raw : null, dict })
  }
  return out
}

/** Which annotations on a page belong to a group, as members or heads. */
function groupedOnPage(entries: readonly Entry[]): Set<PDFDict> {
  const grouped = new Set<PDFDict>()
  const byRef = new Map<string, PDFDict>()
  for (const e of entries) if (e.ref !== null) byRef.set(e.ref.toString(), e.dict)
  for (const e of entries) {
    if (e.dict.has(N('GroupNesting'))) grouped.add(e.dict)
    if (nameOf(e.dict, 'RT') !== 'Group') continue
    grouped.add(e.dict)
    const irt = e.dict.get(N('IRT'))
    const head = irt instanceof PDFRef ? byRef.get(irt.toString()) : irt instanceof PDFDict ? irt : undefined
    if (head !== undefined) grouped.add(head)
  }
  return grouped
}

function boxOf(page: PDFPage): PageBox {
  return page.getCropBox() as PageBox
}

function ringOf(dict: PDFDict, box: PageBox, rotation: number): Point[] {
  const v = numbersOf(dict, 'Vertices')
  const out: Point[] = []
  for (let i = 0; i + 1 < v.length; i += 2) out.push(fromUserSpace({ x: v[i]!, y: v[i + 1]! }, box, rotation))
  return out
}

function isCloud(dict: PDFDict): boolean {
  if (nameOf(dict, 'IT') === 'PolygonCloud') return true
  const be = dict.lookup(N('BE'))
  return be instanceof PDFDict && nameOf(be, 'S') === 'C'
}

function readAnnot(page: PDFPage, pageIndex: number, e: Entry, grouped: Set<PDFDict>): PdfAnnot | null {
  const subtype = nameOf(e.dict, 'Subtype') ?? 'Unknown'
  if (NOT_A_MARKUP.has(subtype)) return null
  const name = textOf(e.dict, 'NM')
  const contents = textOf(e.dict, 'Contents')
  const flags = numberOf(e.dict, 'F', 0)
  const irt = e.dict.lookup(N('IRT'))
  const polygonal = subtype === 'Polygon' || subtype === 'PolyLine'
  return {
    pageIndex,
    index: e.index,
    subtype,
    name,
    contents,
    ring: polygonal ? ringOf(e.dict, boxOf(page), page.getRotation().angle) : [],
    flags,
    grouped: grouped.has(e.dict),
    locked: (flags & LOCKED_FLAG) !== 0,
    cloud: isCloud(e.dict),
    replyTo: irt instanceof PDFDict && nameOf(e.dict, 'RT') !== 'Group' ? textOf(irt, 'NM') : null,
    hasMeasure: e.dict.has(N('Measure')),
    markupId: markupIdFromName(name),
    payload: decodeNote(contents),
  }
}

function readAll(doc: PDFDocument): PdfAnnot[] {
  const out: PdfAnnot[] = []
  doc.getPages().forEach((page, pageIndex) => {
    const entries = annotEntries(page)
    const grouped = groupedOnPage(entries)
    for (const e of entries) {
      const a = readAnnot(page, pageIndex, e, grouped)
      if (a !== null) out.push(a)
    }
  })
  return out
}

/** Every markup annotation in the file, or why the file will not be written. */
export async function inspectPdf(bytes: Uint8Array): Promise<Inspection> {
  const opened = await openPdf(bytes)
  if ('refused' in opened) return { refused: opened.refused, pageCount: 0, pageSizes: [], annots: [] }
  const pageSizes = opened.doc.getPages().map((page) => {
    const box = boxOf(page)
    const turned = Math.round(page.getRotation().angle / 90) % 2 !== 0
    return turned ? { width: box.height, height: box.width } : { width: box.width, height: box.height }
  })
  return { refused: null, pageCount: opened.doc.getPageCount(), pageSizes, annots: readAll(opened.doc) }
}

// ---------------------------------------------------------------- write --

const LINE_WIDTH = 1.5
const SAME_POINT = 0.01 // user-space points

function sameRing(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]!.x - b[i]!.x) > SAME_POINT || Math.abs(a[i]!.y - b[i]!.y) > SAME_POINT) return false
  }
  return true
}

function userRing(dict: PDFDict): Point[] {
  const v = numbersOf(dict, 'Vertices')
  const out: Point[] = []
  for (let i = 0; i + 1 < v.length; i += 2) out.push({ x: v[i]!, y: v[i + 1]! })
  return out
}

function sameColor(dict: PDFDict, key: string, rgb: readonly number[]): boolean {
  const c = numbersOf(dict, key)
  return c.length === 3 && c.every((v, i) => Math.abs(v - rgb[i]!) < 1e-3)
}

/** Remove the appearance streams an annotation owns, so a rewrite leaves no orphans. */
function dropAppearance(ctx: PDFContext, dict: PDFDict): void {
  const ap = dict.lookup(N('AP'))
  if (!(ap instanceof PDFDict)) return
  for (const key of ['N', 'R', 'D']) {
    const v = ap.get(N(key))
    if (v instanceof PDFRef) ctx.delete(v)
  }
}

/**
 * An appearance for somebody else's shape after its vertices moved: their
 * stroke colour, their interior if they had one, their line width. Dashes and
 * other styling are not redrawn, which is why clouds are refused outright.
 */
function foreignAppearance(ctx: PDFContext, dict: PDFDict, pts: readonly Point[], closed: boolean): { rect: number[], ref: PDFRef } {
  const stroke = numbersOf(dict, 'C')
  const fill = numbersOf(dict, 'IC')
  const bs = dict.lookup(N('BS'))
  const border = numbersOf(dict, 'Border')
  const width = bs instanceof PDFDict ? numberOf(bs, 'W', 1) : border[2] ?? 1
  const opacity = numberOf(dict, 'CA', 1)
  const f = (n: number): string => (Math.round(n * 1000) / 1000).toString()
  const rgb = (c: number[]): string => (c.length === 3 ? c.map(f).join(' ') : '0 0 0')
  const path = pts.map((p, i) => `${f(p.x)} ${f(p.y)} ${i === 0 ? 'm' : 'l'}`).join('\n')
  const hasFill = closed && fill.length === 3
  const ops = ['/GS gs', `${rgb(stroke)} RG`, ...(hasFill ? [`${rgb(fill)} rg`] : []), `${f(width)} w`, path,
    ...(closed ? ['h'] : []), hasFill ? 'B' : 'S'].join('\n')
  const pad = width
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const rect = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
  const stream = ctx.flateStream(ops, {
    Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: rect,
    Resources: ctx.obj({ ExtGState: ctx.obj({ GS: ctx.obj({ Type: 'ExtGState', ca: opacity, CA: opacity }) }) }),
  })
  return { rect, ref: ctx.register(stream) }
}

interface Located {
  page: PDFPage
  entries: Entry[]
  entry: Entry | undefined
  grouped: Set<PDFDict>
}

function locate(doc: PDFDocument, pageIndex: number, name: string, index?: number, subtype?: string): Located | null {
  const page = doc.getPages()[pageIndex]
  if (page === undefined) return null
  const entries = annotEntries(page)
  const entry = name !== ''
    ? entries.find((e) => textOf(e.dict, 'NM') === name)
    : entries.find((e) => e.index === index && textOf(e.dict, 'NM') === '' && (subtype === undefined || nameOf(e.dict, 'Subtype') === subtype))
  return { page, entries, entry, grouped: groupedOnPage(entries) }
}

function refusalFor(dict: PDFDict, grouped: Set<PDFDict>): string | null {
  if (grouped.has(dict)) return 'it is grouped in Bluebeam'
  if ((numberOf(dict, 'F', 0) & LOCKED_FLAG) !== 0) return 'it is locked'
  return null
}

function bake(doc: PDFDocument, op: Extract<InterchangeOp, { op: 'bake' }>, fillOpacity: number): OpOutcome {
  const base = { op: op.op, pageIndex: op.pageIndex, name: op.name } as const
  const where = locate(doc, op.pageIndex, op.name)
  if (where === null) return { ...base, result: 'missing', reason: 'the page is not in this file' }
  if (op.ring.length < 3) return { ...base, result: 'refused', reason: 'an area needs three points' }
  const ctx = doc.context
  const box = boxOf(where.page)
  const pts = op.ring.map((p) => toUserSpace(p, box, where.page.getRotation().angle))
  const color = toPdfColor(op.color)
  const vertices = ctx.obj(pts.flatMap((p) => [p.x, p.y]))
  const measured = op.feetPerPoint !== null && op.feetPerPoint > 0

  const existing = where.entry?.dict
  if (existing !== undefined) {
    const why = refusalFor(existing, where.grouped)
    if (why !== null) return { ...base, result: 'refused', reason: why }
    const same = sameRing(userRing(existing), pts)
      && textOf(existing, 'Contents') === op.note
      && textOf(existing, 'T') === op.author
      && sameColor(existing, 'C', color)
      && existing.has(N('Measure')) === measured
    if (same) return { ...base, result: 'unchanged' }
    dropAppearance(ctx, existing)
    const { rect, apRef } = buildAppearance(ctx, pts, color, 'polygon', { lineWidth: LINE_WIDTH, fillOpacity })
    existing.set(N('Vertices'), vertices)
    existing.set(N('Rect'), ctx.obj(rect))
    existing.set(N('AP'), ctx.obj({ N: apRef }))
    existing.set(N('C'), ctx.obj([...color]))
    existing.set(N('IC'), ctx.obj([...color]))
    existing.set(N('T'), pdfText(op.author))
    existing.set(N('Contents'), pdfText(op.note))
    existing.set(N('M'), PDFString.fromDate(new Date()))
    if (measured) {
      existing.set(N('IT'), N('PolygonDimension'))
      existing.set(N('Measure'), measureDict(ctx, op.feetPerPoint!))
    } else {
      existing.delete(N('IT'))
      existing.delete(N('Measure'))
    }
    return { ...base, result: 'updated' }
  }

  const { rect, apRef } = buildAppearance(ctx, pts, color, 'polygon', { lineWidth: LINE_WIDTH, fillOpacity })
  const now = PDFString.fromDate(new Date())
  const annot = ctx.obj({
    Type: 'Annot',
    Subtype: 'Polygon',
    Rect: rect,
    Vertices: vertices,
    C: [...color],
    IC: [...color],
    CA: 1,
    F: 4,
    Border: [0, 0, LINE_WIDTH],
    // Only a calibrated sheet gets a measurement. An intent with no scale
    // behind it would invite a reader to measure in points.
    ...(measured ? { IT: N('PolygonDimension'), Measure: measureDict(ctx, op.feetPerPoint!) } : {}),
    T: pdfText(op.author),
    Subj: PDFString.of('Area'),
    Contents: pdfText(op.note),
    NM: pdfText(op.name),
    CreationDate: now,
    M: now,
    AP: ctx.obj({ N: apRef }),
  })
  const ref = ctx.register(annot)
  let arr = annotsArray(where.page)
  if (arr === null) {
    arr = ctx.obj([])
    where.page.node.set(N('Annots'), arr)
  }
  arr.push(ref)
  return { ...base, result: 'created' }
}

function reshape(doc: PDFDocument, op: Extract<InterchangeOp, { op: 'reshape' }>): OpOutcome {
  const base = { op: op.op, pageIndex: op.pageIndex, name: op.name } as const
  const where = locate(doc, op.pageIndex, op.name)
  const dict = where?.entry?.dict
  if (where === null || dict === undefined) return { ...base, result: 'missing', reason: 'it is no longer in the file' }
  const subtype = nameOf(dict, 'Subtype')
  if (subtype !== 'Polygon' && subtype !== 'PolyLine') {
    return { ...base, result: 'refused', reason: 'only polygons and polylines can be reshaped' }
  }
  const why = refusalFor(dict, where.grouped) ?? (isCloud(dict) ? 'it is a cloud' : null)
  if (why !== null) return { ...base, result: 'refused', reason: why }
  const closed = subtype === 'Polygon'
  if (op.ring.length < (closed ? 3 : 2)) return { ...base, result: 'refused', reason: 'too few points' }
  const box = boxOf(where.page)
  const pts = op.ring.map((p) => toUserSpace(p, box, where.page.getRotation().angle))
  if (sameRing(userRing(dict), pts)) return { ...base, result: 'unchanged' }
  const ctx = doc.context
  dropAppearance(ctx, dict)
  const { rect, ref } = foreignAppearance(ctx, dict, pts, closed)
  dict.set(N('Vertices'), ctx.obj(pts.flatMap((p) => [p.x, p.y])))
  dict.set(N('Rect'), ctx.obj(rect))
  dict.set(N('AP'), ctx.obj({ N: ref }))
  dict.set(N('M'), PDFString.fromDate(new Date()))
  return { ...base, result: 'updated' }
}

function remove(doc: PDFDocument, op: Extract<InterchangeOp, { op: 'remove' }>): OpOutcome {
  const base = { op: op.op, pageIndex: op.pageIndex, name: op.name } as const
  const where = locate(doc, op.pageIndex, op.name, op.index, op.subtype)
  const target = where?.entry
  if (where === null || target === undefined) return { ...base, result: 'missing', reason: 'it is no longer in the file' }
  const why = refusalFor(target.dict, where.grouped)
  if (why !== null) return { ...base, result: 'refused', reason: why }

  // The annotation, its popup, and the replies and statuses hanging off it:
  // leaving those behind would put orphaned comments in the markup list.
  const doomed = new Set<PDFDict>([target.dict])
  const popupOf = (d: PDFDict): PDFObject | undefined => d.lookup(N('Popup'))
  for (const e of where.entries) {
    const irt = e.dict.lookup(N('IRT'))
    if (irt === target.dict && nameOf(e.dict, 'RT') !== 'Group') doomed.add(e.dict)
  }
  for (const d of [...doomed]) {
    const p = popupOf(d)
    if (p instanceof PDFDict) doomed.add(p)
  }
  const arr = annotsArray(where.page)!
  const ctx = doc.context
  for (let i = arr.size() - 1; i >= 0; i--) {
    const d = arr.lookup(i)
    if (!(d instanceof PDFDict) || !doomed.has(d)) continue
    const raw = arr.get(i)
    dropAppearance(ctx, d)
    arr.remove(i)
    if (raw instanceof PDFRef) ctx.delete(raw)
  }
  return { ...base, result: 'removed' }
}

/**
 * Apply a batch of edits and return the new file.
 *
 * `changed: false` means nothing needed writing, and `bytes` is the input
 * untouched — the caller should not rewrite a drawing to say the same thing.
 */
export async function applyInterchange(
  bytes: Uint8Array,
  ops: readonly InterchangeOp[],
  options: { fillOpacity?: number } = {},
): Promise<ApplyResult> {
  const opened = await openPdf(bytes)
  if ('refused' in opened) return { ok: false, refused: opened.refused }
  const doc = opened.doc
  const fillOpacity = options.fillOpacity ?? 0.28
  const outcomes: OpOutcome[] = []
  for (const op of ops) {
    if (op.op === 'bake') outcomes.push(bake(doc, op, fillOpacity))
    else if (op.op === 'reshape') outcomes.push(reshape(doc, op))
    else outcomes.push(remove(doc, op))
  }
  const changed = outcomes.some((o) => o.result === 'created' || o.result === 'updated' || o.result === 'removed')
  if (!changed) return { ok: true, changed: false, bytes, outcomes }
  // No object streams: the header version of an older file would not admit
  // them, and a reader is entitled to refuse the mismatch.
  return { ok: true, changed: true, bytes: await doc.save({ useObjectStreams: false }), outcomes }
}
