/**
 * The takeoff travels with the drawing.
 *
 * Aaron, 2026-11-12: "Embed only that sheet slice so that the markups and
 * takeoffs travel with the PDF. Make it so that Bluebeam can open files edited
 * in REDBEAM and show the markups, but not the scope layouts. Only REDBEAM has
 * the enhanced layouts and counts and scope details. Bluebeam only sees the
 * scope label and overall square footage." And then: "if someone opens it in
 * Bluebeam, adds a few markups, and saves it, it doesn't overwrite or delete
 * the REDBEAM-specific metadata."
 *
 * So a drawing REDBEAM has worked on carries two layers, written into the PDF
 * itself as an incremental update (see pdfIncremental.ts):
 *
 * 1. A BLUEBEAM-NATIVE layer. Every takeoff markup is an ordinary measurement
 *    annotation written the way Revu writes its own (read off a Revu 21 save of
 *    the TEV IFC set): a Polygon with /IT /PolygonDimension, the scope as its
 *    /Subj and /Label, the quantity as "1,234.56 sf" in /Contents,
 *    /MeasurementTypes saying "show area and label", and a /Measure dictionary
 *    in Revu's shape including /TargetUnitConversion. The page gets a /VP
 *    viewport carrying the calibration, so Revu shows the sheet as scaled and
 *    measures to our numbers. That is ALL Revu is given: label and quantity.
 *
 * 2. A REDBEAM-PRIVATE layer: the sheet's slice of redbeam.db (its pages,
 *    calibrations, scale regions, markups, the scopes they belong to with
 *    their specifications, and the calculation runs with their counts and
 *    layout components) as a compressed JSON stream reachable only through
 *    private dictionary keys. Nothing Revu displays points at it. It is written
 *    in more than one place (see CARRIERS) because no editor promises to keep
 *    another application's private data, and the reader takes whichever copy
 *    survived.
 *
 * redbeam.db stays the record. The embedded slice is a copy for the drawing to
 * carry: it is read back only when the database has nothing for that drawing,
 * which is the case of a sheet emailed into another job folder.
 *
 * MARKUPS FROM OTHER APPS ARE NEVER TOUCHED. The writer removes only the
 * annotations REDBEAM itself wrote, recognised by their /NM, and appends —
 * so a Bluebeam cloud added between two REDBEAM saves is still there after the
 * second. A REDBEAM markup that somebody MOVED or relabelled in Bluebeam is
 * left exactly as they saved it rather than being snapped back, and reported.
 */
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream,
  PDFRef, PDFStream, PDFString, decodePDFRawStream,
  type PDFContext, type PDFPage,
} from 'pdf-lib'
import { appendIncrementalUpdate, newRefsSince, reserveExistingNumbers } from './pdfIncremental.js'
import {
  COUNT_RADIUS, MIN_POINTS, appearanceOps, centroidOf, regionAt, shapeForKind,
  toPdfColor, toUserSpace,
  type PageBox, type WritableMarkup, type WritableScaleRegion,
} from './pdfMarkup.js'

// ------------------------------------------------------------- the slice --

export const SLICE_FORMAT = 'redbeam.sheet-slice'
export const SLICE_VERSION = 1

/** Rows of redbeam.db, by table, exactly as SQLite returned them. */
export type SliceTables = Record<string, Array<Record<string, unknown>>>

export interface SheetSlice {
  format: typeof SLICE_FORMAT
  version: number
  documentId: string
  relativePath: string
  displayName: string
  writtenAt: string
  appVersion: string
  tables: SliceTables
  /**
   * What REDBEAM wrote for each markup it put on the sheet, keyed by /NM: the
   * markup it came from and a fingerprint of the geometry and label as
   * written. A later save compares the annotation against this to tell
   * "untouched" from "edited in another app".
   */
  annots: Record<string, { markupId: string, fp: string }>
  /** Hash of everything the write depended on; equal hash, nothing to write. */
  contentHash: string
}

/** A markup to put on the sheet, plus what its Bluebeam annotation says. */
export interface EmbedMarkup extends WritableMarkup {
  /** Net quantity in the unit of its kind: sq ft for areas, ft for runs. */
  quantity?: number | null
}

export interface EmbedInput {
  documentId: string
  relativePath: string
  displayName: string
  appVersion: string
  tables: SliceTables
  markups: readonly EmbedMarkup[]
  pageScales: ReadonlyMap<number, number>
  pageRegions?: ReadonlyMap<number, readonly WritableScaleRegion[]>
  /** For tests; defaults to the clock. */
  now?: () => Date
}

export interface EmbedResult {
  /** Null when the file already carries exactly this; nothing to write. */
  bytes: Uint8Array | null
  /** REDBEAM markups somebody changed in another app, left as they saved them. */
  editedElsewhere: string[]
  /** Annotations from other apps that were kept. */
  foreignKept: number
}

// ------------------------------------------------------------- hashing --

/** cyrb53: a fast, well-mixed 53-bit string hash. Not cryptographic. */
export function hash53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

const hashHex = (text: string): string => hash53(text).toString(16).padStart(14, '0')

/** Stable JSON: keys sorted, so equal data hashes equal. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`
}

// ------------------------------------------------------------- identity --

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function lettersOf(n: number, count: number): string {
  let out = ''
  let v = n
  for (let i = 0; i < count; i++) {
    out += LETTERS[v % 26]
    v = Math.floor(v / 26)
  }
  return out
}

/**
 * The /NM REDBEAM gives a markup's annotation.
 *
 * Revu names its own markups with sixteen upper-case letters and shows the
 * name as the markup's ID, so ours look the same: "RB", twelve letters from
 * the markup id, and two check letters over those fourteen. Deterministic, so
 * the same markup always gets the same name; checkable, so a REDBEAM
 * annotation is recognisable even in a file whose private data an editor
 * threw away. A random Revu name passes the check about once in 450,000.
 */
export function redbeamNm(markupId: string): string {
  const body = 'RB' + lettersOf(hash53(markupId, 7), 12)
  return body + lettersOf(hash53(body, 11), 2)
}

export function isRedbeamNm(nm: string): boolean {
  if (!/^RB[A-Z]{14}$/.test(nm)) return false
  const body = nm.slice(0, 14)
  return nm.slice(14) === lettersOf(hash53(body, 11), 2)
}

// ------------------------------------------------- Bluebeam's measure dict --

/** One point of paper in feet: 1/72 in, 1/864 ft. Revu's TargetUnitConversion. */
const FEET_PER_PAPER_POINT = 1 / 864

function revuNumberFormat(ctx: PDFContext, unit: string, conversion: number, fd = false): PDFDict {
  return ctx.obj({
    Type: 'NumberFormat',
    U: PDFString.of(unit),
    C: conversion,
    D: 100,
    ...(fd ? { FD: true } : {}),
    SS: PDFString.of(''),
  }) as PDFDict
}

/** "1 in = 8 ft", or "1 in = 8'-0"" style figures trimmed to what they need. */
export function scaleRatioText(feetPerPoint: number): string {
  const feetPerInch = Math.round(feetPerPoint * 72 * 10000) / 10000
  return `1 in = ${feetPerInch} ft`
}

/**
 * A /Measure dictionary in the shape Revu 21 writes.
 *
 * /X converts a point of the page to feet, which is the calibration; /D and
 * /A then convert feet to the displayed length and area units, so their
 * conversion is 1. /T and /V (angle, volume) are not ours to use but Revu
 * writes them on every measurement and a dictionary without them is one it
 * has to guess about. /TargetUnitConversion is a paper point in the target
 * unit, which is how Revu reconstructs the "1 in = 8 ft" it shows.
 */
export function revuMeasure(ctx: PDFContext, feetPerPoint: number): PDFDict {
  return ctx.obj({
    Type: 'Measure',
    Subtype: 'RL',
    R: PDFString.of(scaleRatioText(feetPerPoint)),
    X: [revuNumberFormat(ctx, 'ft', feetPerPoint)],
    D: [revuNumberFormat(ctx, 'ft', 1)],
    A: [revuNumberFormat(ctx, 'sf', 1, true)],
    T: [revuNumberFormat(ctx, '°', 1, true)],
    V: [revuNumberFormat(ctx, 'cu ft', 1, true)],
    TargetUnitConversion: FEET_PER_PAPER_POINT,
  }) as PDFDict
}

const fmt2 = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** /Contents, as Revu words a measurement: "2,064.78 sf", "80.00 ft". */
export function quantityText(kind: string, quantity: number | null | undefined): string {
  if (quantity === null || quantity === undefined || !Number.isFinite(quantity)) return ''
  if (kind === 'polyline') return `${fmt2(quantity)} ft`
  if (kind === 'count') return `${Math.round(quantity)} EA`
  return `${fmt2(quantity)} sf`
}

/**
 * Revu's MeasurementTypes bits (Area=1, Length=2, Count=8192, Label=128):
 * which values the on-page caption shows.
 */
const MEASUREMENT_TYPES: Record<string, number> = { polygon: 1 | 128, polyline: 2 | 128 }

// ------------------------------------------------------------ fingerprints --

const vertsOf = (a: PDFDict): number[] => {
  const v = a.lookup(PDFName.of('Vertices'))
  if (!(v instanceof PDFArray)) return []
  const out: number[] = []
  for (let i = 0; i < v.size(); i++) {
    const n = v.lookup(i)
    out.push(n instanceof PDFNumber ? n.asNumber() : NaN)
  }
  return out
}

const textOf = (a: PDFDict, key: string): string => {
  const v = a.lookup(PDFName.of(key))
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : ''
}

/**
 * What "this annotation is as REDBEAM left it" is judged on: its geometry,
 * to a tenth of a point, and its label. Not /Contents — Revu rewrites the
 * measurement text in its own format when it saves, and that is not an edit.
 */
export function annotFingerprint(a: PDFDict): string {
  const verts = vertsOf(a).map((n) => Math.round(n * 10) / 10)
  const rect = a.lookup(PDFName.of('Rect'))
  const geom = verts.length > 0 || !(rect instanceof PDFArray)
    ? verts
    : [0, 1, 2, 3].map((i) => {
      const n = rect.lookup(i)
      return n instanceof PDFNumber ? Math.round(n.asNumber() * 10) / 10 : NaN
    })
  return hashHex(`${geom.join(',')}|${textOf(a, 'Label')}`)
}

// --------------------------------------------------------------- carriers --

/**
 * Where the private slice lives.
 *
 * PieceInfo is ISO 32000's own mechanism for exactly this — "private data of
 * the conforming product that created it", keyed by application — and a
 * conforming editor is expected to carry an entry it does not understand.
 * The per-annotation key covers the opposite failure: an editor that rebuilds
 * the document catalog but copies annotations whole. Either one is enough to
 * get the slice back.
 */
const KEY = 'REDBEAM'

function privateStream(ctx: PDFContext, json: string): PDFRef {
  return ctx.register(ctx.flateStream(json, { Type: 'REDBEAM#20Slice' }))
}

function pieceInfo(ctx: PDFContext, when: string, sliceRef: PDFRef): PDFDict {
  return ctx.obj({
    [KEY]: ctx.obj({
      LastModified: PDFString.of(when),
      Private: ctx.obj({ Format: PDFString.of(SLICE_FORMAT), Slice: sliceRef }),
    }),
  }) as PDFDict
}

const pdfDate = (d: Date): string =>
  `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`

function streamText(stream: unknown): string | null {
  if (!(stream instanceof PDFStream)) return null
  try {
    const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents()
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

function parseSlice(text: string | null): SheetSlice | null {
  if (text === null) return null
  try {
    const v = JSON.parse(text) as Partial<SheetSlice>
    if (v.format !== SLICE_FORMAT || typeof v.documentId !== 'string') return null
    if (typeof v.version !== 'number' || v.version > SLICE_VERSION) return null
    if (v.tables === null || typeof v.tables !== 'object') return null
    return { annots: {}, contentHash: '', ...v } as SheetSlice
  } catch {
    return null
  }
}

function sliceFromPieceInfo(holder: PDFDict): SheetSlice | null {
  const pi = holder.lookup(PDFName.of('PieceInfo'))
  if (!(pi instanceof PDFDict)) return null
  const ours = pi.lookup(PDFName.of(KEY))
  if (!(ours instanceof PDFDict)) return null
  const priv = ours.lookup(PDFName.of('Private'))
  if (!(priv instanceof PDFDict)) return null
  return parseSlice(streamText(priv.lookup(PDFName.of('Slice'))))
}

// ----------------------------------------------------------------- reading --

export interface RedbeamAnnot {
  pageIndex: number
  nm: string
  /** The markup it was written from, when the file still says. */
  markupId: string | null
  label: string
  contents: string
  /** PDF user space. */
  vertices: number[]
  fp: string
}

export interface SheetEmbedReading {
  slice: SheetSlice | null
  /** Which carrier the slice came from. */
  source: 'catalog' | 'annotation' | null
  redbeamAnnots: RedbeamAnnot[]
  /** Markup annotations REDBEAM did not write: Bluebeam's, Acrobat's. */
  foreignAnnots: number
  /**
   * REDBEAM annotations are on the sheet but no copy of the slice is. Some
   * editor saved the file and dropped REDBEAM's private data; the markups it
   * shows are still there, the scope detail is not.
   */
  privateDataLost: boolean
}

const NOT_MARKUP = new Set(['Link', 'Popup', 'Widget'])

function annotsOn(page: PDFPage): PDFDict[] {
  const arr = page.node.lookup(PDFName.of('Annots'))
  if (!(arr instanceof PDFArray)) return []
  const out: PDFDict[] = []
  for (let i = 0; i < arr.size(); i++) {
    const a = arr.lookup(i)
    if (a instanceof PDFDict) out.push(a)
  }
  return out
}

function isOurs(a: PDFDict): boolean {
  return isRedbeamNm(textOf(a, 'NM')) || a.lookup(PDFName.of(KEY)) instanceof PDFDict
}

function subtypeOf(a: PDFDict): string {
  const s = a.lookup(PDFName.of('Subtype'))
  return s instanceof PDFName ? s.decodeText() : ''
}

function readDoc(doc: PDFDocument): SheetEmbedReading {
  let slice = sliceFromPieceInfo(doc.catalog)
  let source: SheetEmbedReading['source'] = slice === null ? null : 'catalog'
  const redbeamAnnots: RedbeamAnnot[] = []
  let foreignAnnots = 0
  doc.getPages().forEach((page, pageIndex) => {
    for (const a of annotsOn(page)) {
      if (NOT_MARKUP.has(subtypeOf(a))) continue
      if (!isOurs(a)) { foreignAnnots++; continue }
      const own = a.lookup(PDFName.of(KEY))
      const markupId = own instanceof PDFDict ? textOf(own, 'MarkupId') || null : null
      if (slice === null && own instanceof PDFDict) {
        const s = parseSlice(streamText(own.lookup(PDFName.of('Slice'))))
        if (s !== null) { slice = s; source = 'annotation' }
      }
      redbeamAnnots.push({
        pageIndex,
        nm: textOf(a, 'NM'),
        markupId,
        label: textOf(a, 'Label'),
        contents: textOf(a, 'Contents'),
        vertices: vertsOf(a),
        fp: annotFingerprint(a),
      })
    }
  })
  if (slice !== null) {
    for (const r of redbeamAnnots) {
      if (r.markupId === null) r.markupId = slice.annots[r.nm]?.markupId ?? null
    }
  }
  return {
    slice,
    source,
    redbeamAnnots,
    foreignAnnots,
    privateDataLost: slice === null && redbeamAnnots.length > 0,
  }
}

/** Load a PDF the way this module needs: no metadata rewrite, no throw on encryption. */
async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false })
}

/**
 * What REDBEAM left in a PDF, if anything.
 *
 * Never throws for a drawing that simply has nothing of ours in it; throws
 * only when pdf-lib cannot parse the file at all, which the caller treats as
 * "nothing embedded" since PDFium may still render it.
 */
export async function readSheetEmbed(bytes: Uint8Array): Promise<SheetEmbedReading> {
  return readDoc(await load(bytes))
}

// ----------------------------------------------------------------- writing --

function buildAnnot(
  ctx: PDFContext,
  page: PDFPage,
  markup: EmbedMarkup,
  feetPerPoint: number | undefined,
  alpha: number,
  nm: string,
  when: string,
): PDFDict | null {
  const shape = shapeForKind(markup.kind)
  const ring = markup.rings[0]
  if (shape === null || ring === undefined || ring.length < MIN_POINTS[shape]) return null
  const box = page.getCropBox() as PageBox
  const rotation = page.getRotation().angle
  const pts = ring.map((p) => toUserSpace(p, box, rotation))
  const lineWidth = 1.5
  const pad = lineWidth + (shape === 'circle' ? COUNT_RADIUS : 0)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const rect = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
  const color = toPdfColor(markup.color)

  // A cutout is a deduction: drawn so a reader can see it, but deliberately
  // NOT a measurement, or Revu would add its area to the scope's total
  // instead of taking it away. The net figure is on the area it belongs to.
  const isCutout = markup.kind === 'cutout'
  const measured = feetPerPoint !== undefined && !isCutout && shape !== 'circle'
  const fill = shape === 'polyline' ? null : color
  const ap = ctx.register(ctx.flateStream(
    appearanceOps(pts, color, lineWidth, shape),
    {
      Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: rect,
      Resources: ctx.obj({
        ExtGState: ctx.obj({ GS: ctx.obj({ Type: 'ExtGState', ca: isCutout ? 0 : alpha, CA: 1 }) }),
      }),
    },
  ))

  const label = isCutout ? `${markup.scopeLabel} (deduction)` : markup.scopeLabel
  const contents = isCutout ? 'Deduction' : quantityText(markup.kind, markup.quantity)
  const subtype = shape === 'polygon' ? 'Polygon' : shape === 'polyline' ? 'PolyLine' : 'Circle'
  const intent = measured ? (shape === 'polygon' ? 'PolygonDimension' : 'PolyLineDimension') : null

  return ctx.obj({
    Type: 'Annot',
    Subtype: subtype,
    Rect: rect,
    ...(shape === 'circle' ? {} : { Vertices: pts.flatMap((p) => [p.x, p.y]) }),
    C: color,
    ...(fill === null || isCutout ? {} : { IC: fill }),
    CA: 1,
    ...(fill === null || isCutout ? {} : { FillOpacity: alpha }),
    F: 4,
    BS: ctx.obj({ Type: 'Border', W: lineWidth, S: PDFName.of(isCutout ? 'D' : 'S') }),
    // Bluebeam's columns: Subject groups the Markups List and its summaries,
    // Label is what the caption prints beside the quantity, Author is who.
    Subj: PDFString.of(label),
    Label: PDFString.of(label),
    T: PDFString.of('REDBEAM'),
    Contents: PDFString.of(contents),
    NM: PDFString.of(nm),
    M: PDFString.of(when),
    CreationDate: PDFString.of(when),
    ...(intent === null ? {} : {
      IT: PDFName.of(intent),
      Measure: revuMeasure(ctx, feetPerPoint!),
      MeasurementTypes: MEASUREMENT_TYPES[shape] ?? 129,
      Cap: true,
    }),
    DS: PDFString.of('font: Helvetica 12pt; text-align:center; color:#000000'),
    AP: ctx.obj({ N: ap }),
  }) as PDFDict
}

function writePageScale(
  ctx: PDFContext,
  page: PDFPage,
  feetPerPoint: number | null,
  regions: readonly WritableScaleRegion[],
): boolean {
  const box = page.getCropBox() as PageBox
  const rotation = page.getRotation().angle
  const ours: PDFDict[] = []
  if (feetPerPoint !== null) {
    ours.push(ctx.obj({
      Type: 'Viewport',
      BBox: [box.x, box.y, box.x + box.width, box.y + box.height],
      Name: PDFString.of('REDBEAM page scale'),
      Measure: revuMeasure(ctx, feetPerPoint),
    }) as PDFDict)
  }
  // Last containing viewport wins in Revu, so the page scale goes first and
  // regions follow largest to smallest: the app's smallest-wins rule.
  const area = (r: WritableScaleRegion['rect']): number => Math.abs(r.x1 - r.x0) * Math.abs(r.y1 - r.y0)
  for (const region of [...regions].sort((a, b) => area(b.rect) - area(a.rect))) {
    const c0 = toUserSpace({ x: region.rect.x0, y: region.rect.y0 }, box, rotation)
    const c1 = toUserSpace({ x: region.rect.x1, y: region.rect.y1 }, box, rotation)
    ours.push(ctx.obj({
      Type: 'Viewport',
      BBox: [Math.min(c0.x, c1.x), Math.min(c0.y, c1.y), Math.max(c0.x, c1.x), Math.max(c0.y, c1.y)],
      Name: PDFString.of(`REDBEAM ${region.label === '' ? 'scale region' : region.label}`),
      Measure: revuMeasure(ctx, region.feetPerPoint),
    }) as PDFDict)
  }

  // Keep viewports somebody else drew; replace only REDBEAM's own. Ours go
  // last so they win where they overlap, which is right for OUR markups, and a
  // Revu user's calibration of some other part of the sheet survives.
  const existing = page.node.lookup(PDFName.of('VP'))
  const kept: PDFDict[] = []
  let hadOurs = false
  if (existing instanceof PDFArray) {
    for (let i = 0; i < existing.size(); i++) {
      const vp = existing.lookup(i)
      if (!(vp instanceof PDFDict)) continue
      if (textOf(vp, 'Name').startsWith('REDBEAM')) { hadOurs = true; continue }
      kept.push(vp)
    }
  }
  if (ours.length === 0 && !hadOurs) return false
  page.node.set(PDFName.of('VP'), ctx.obj([...kept, ...ours]))
  return true
}

/**
 * Embed a sheet's takeoff in its PDF.
 *
 * Returns the new bytes as `source` plus an appended update, or `bytes: null`
 * when the file already carries exactly this slice — the common case of
 * closing a drawing nobody touched, which must not rewrite a synced file.
 */
export async function embedSheet(source: Uint8Array, input: EmbedInput): Promise<EmbedResult> {
  const doc = await load(source)
  const ctx = doc.context
  const largestBefore = reserveExistingNumbers(doc, source)
  const before = readDoc(doc)
  const prev = before.slice

  const contentHash = hashHex(stableStringify({
    tables: input.tables,
    markups: input.markups,
    scales: [...input.pageScales.entries()],
    regions: [...(input.pageRegions?.entries() ?? [])],
    v: SLICE_VERSION,
  }))

  // Every annotation REDBEAM wrote last time must still be as it wrote it;
  // otherwise it was edited elsewhere and the file is not "unchanged".
  const editedNms = new Set<string>()
  for (const a of before.redbeamAnnots) {
    const recorded = prev?.annots[a.nm]
    if (recorded !== undefined && recorded.fp !== a.fp) editedNms.add(a.nm)
  }
  if (prev !== null && prev.contentHash === contentHash && editedNms.size === 0
    && prev.documentId === input.documentId) {
    return { bytes: null, editedElsewhere: [], foreignKept: before.foreignAnnots }
  }

  const when = pdfDate(input.now?.() ?? new Date())
  const pages = doc.getPages()
  const changed: PDFRef[] = []
  const editedElsewhere: string[] = []
  const keptNms = new Set<string>()

  // 1. Take REDBEAM's previous annotations off, keeping everything else and
  //    any of ours that somebody edited.
  pages.forEach((page) => {
    const arr = page.node.lookup(PDFName.of('Annots'))
    if (!(arr instanceof PDFArray)) return
    const keep: unknown[] = []
    let removed = false
    for (let i = 0; i < arr.size(); i++) {
      const entry = arr.get(i)
      const a = arr.lookup(i)
      if (a instanceof PDFDict && isOurs(a)) {
        const nm = textOf(a, 'NM')
        if (editedNms.has(nm)) {
          keptNms.add(nm)
          editedElsewhere.push(prev?.annots[nm]?.markupId ?? nm)
          keep.push(entry)
          continue
        }
        removed = true
        continue
      }
      keep.push(entry)
    }
    if (!removed) return
    // Written as a DIRECT array on the page even if it was indirect: the old
    // array object stays in the file untouched, and only the page changes.
    page.node.set(PDFName.of('Annots'), ctx.obj(keep as never[]))
    changed.push(page.ref)
  })

  // 2. Scales, then this save's annotations.
  const scaledPages = new Set<number>()
  for (let i = 0; i < pages.length; i++) {
    const regions = input.pageRegions?.get(i) ?? []
    const fpp = input.pageScales.get(i) ?? null
    if (writePageScale(ctx, pages[i]!, fpp, regions)) scaledPages.add(i)
  }
  for (const i of scaledPages) changed.push(pages[i]!.ref)

  const annots: SheetSlice['annots'] = {}
  // The edited ones stay recorded with their CURRENT fingerprint, so the next
  // save sees them as settled rather than as freshly edited again.
  for (const a of before.redbeamAnnots) {
    if (keptNms.has(a.nm)) annots[a.nm] = { markupId: prev?.annots[a.nm]?.markupId ?? a.markupId ?? '', fp: a.fp }
  }
  const editedMarkupIds = new Set(Object.values(annots).map((v) => v.markupId))

  const alpha = 0.28
  const annotRefs: Array<[number, PDFRef]> = []
  for (const markup of input.markups) {
    if (editedMarkupIds.has(markup.id)) continue
    const page = pages[markup.pageIndex]
    if (page === undefined) continue
    const regions = input.pageRegions?.get(markup.pageIndex) ?? []
    const ring = markup.rings[0]
    const fpp = ring === undefined || ring.length === 0
      ? input.pageScales.get(markup.pageIndex)
      : (regionAt(centroidOf(ring), regions)?.feetPerPoint ?? input.pageScales.get(markup.pageIndex))
    const nm = redbeamNm(markup.id)
    const annot = buildAnnot(ctx, page, markup, fpp, alpha, nm, when)
    if (annot === null) continue
    annot.set(PDFName.of(KEY), ctx.obj({ MarkupId: PDFString.of(markup.id) }))
    annot.set(PDFName.of('P'), page.ref)
    annots[nm] = { markupId: markup.id, fp: annotFingerprint(annot) }
    annotRefs.push([markup.pageIndex, ctx.register(annot)])
  }
  for (const [pageIndex, ref] of annotRefs) {
    const page = pages[pageIndex]!
    let arr = page.node.lookup(PDFName.of('Annots'))
    if (!(arr instanceof PDFArray)) {
      arr = ctx.obj([])
      page.node.set(PDFName.of('Annots'), arr)
    } else if (page.node.get(PDFName.of('Annots')) instanceof PDFRef) {
      // Same reasoning as above: copy an indirect array onto the page.
      const copy = ctx.obj([]) as PDFArray
      for (let i = 0; i < arr.size(); i++) copy.push(arr.get(i))
      page.node.set(PDFName.of('Annots'), copy)
      arr = copy
    }
    ;(arr as PDFArray).push(ref)
    changed.push(page.ref)
  }

  // 3. The private slice.
  const slice: SheetSlice = {
    format: SLICE_FORMAT,
    version: SLICE_VERSION,
    documentId: input.documentId,
    relativePath: input.relativePath,
    displayName: input.displayName,
    writtenAt: (input.now?.() ?? new Date()).toISOString(),
    appVersion: input.appVersion,
    tables: input.tables,
    annots,
    contentHash,
  }
  const sliceRef = privateStream(ctx, JSON.stringify(slice))

  const catalogRef = ctx.trailerInfo.Root
  // A fresh, direct PieceInfo on the catalog, carrying over every other
  // application's entry as it was.
  const merged = pieceInfo(ctx, when, sliceRef)
  const pi = doc.catalog.lookup(PDFName.of('PieceInfo'))
  if (pi instanceof PDFDict) {
    for (const [k, v] of pi.entries()) if (k.decodeText() !== KEY) merged.set(k, v)
  }
  doc.catalog.set(PDFName.of('PieceInfo'), merged)
  if (catalogRef instanceof PDFRef) changed.push(catalogRef)

  // Second carrier: every annotation of ours points at the same stream.
  for (const [, ref] of annotRefs) {
    const a = ctx.lookup(ref, PDFDict)
    ;(a.lookup(PDFName.of(KEY)) as PDFDict).set(PDFName.of('Slice'), sliceRef)
  }

  changed.push(...newRefsSince(doc, largestBefore))
  return {
    bytes: appendIncrementalUpdate(source, doc, changed),
    editedElsewhere,
    foreignKept: before.foreignAnnots,
  }
}
