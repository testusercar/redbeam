/**
 * The PDF's own annotations: markups other software left on the sheet.
 *
 * A Bluebeam or Acrobat polygon is an annotation object in the page's /Annots
 * array, drawn by PDFium along with the page and otherwise invisible to this
 * app: it cannot be selected, measured or moved, so an estimator handed a
 * marked-up set had to redraw every shape. Kenneth, 2026-09-10: "give me the
 * option to right click on existing markups from other PDF software to turn
 * them into Redbeam markups. Currently they are flattened and ineditable."
 *
 * This reads them: subtype, rectangle, the vertices of a polygon or polyline,
 * the strokes of an ink annotation, and the subject, contents and author. All
 * geometry comes back NORMALIZED to the page box, y down, the way every
 * markup is stored, so a converted annotation measures exactly like one drawn
 * here. The page box is read, never assumed: an origin-centred crop box is
 * real (see text.ts), and a polygon at (0,0) on one is mid-sheet.
 *
 * Annotations that were FLATTENED into the page's content stream are not
 * annotations any more and do not appear here; for those the tracer works
 * from the lines they left. Two different problems, two different tools.
 *
 * Injected backend, as with text: the tests run without wasm.
 */

import { normalizeBox, type NormBox, type PageBox } from './text.js'

export interface AnnotPoint {
  x: number
  y: number
}

/** The minimum PDFium surface this needs. Page-space points, y up. */
export interface AnnotBackend {
  /** FPDFPage_GetAnnotCount */
  count(page: number): number
  /** FPDFPage_GetAnnot. 0 when PDFium refuses. */
  open(page: number, index: number): number
  /** FPDFPage_CloseAnnot */
  close(annot: number): void
  /** FPDFAnnot_GetSubtype */
  subtype(annot: number): number
  /** FPDFAnnot_GetRect, already unpacked. Null on failure. */
  rect(annot: number): PageBox | null
  /** FPDFAnnot_GetVertices: a polygon's or polyline's points. */
  vertices(annot: number): AnnotPoint[]
  /** FPDFAnnot_GetLine: a line annotation's two ends, or null. */
  line(annot: number): [AnnotPoint, AnnotPoint] | null
  /** FPDFAnnot_GetInkListPath for every path: an ink annotation's strokes. */
  inkPaths(annot: number): AnnotPoint[][]
  /** FPDFAnnot_GetStringValue for a dictionary key. '' when absent. */
  stringValue(annot: number, key: string): string
  /** FPDFAnnot_GetColor, the stroke colour, or null when unset. */
  color(annot: number): { r: number; g: number; b: number; a: number } | null
  /** FPDFAnnot_GetFlags. Optional: a backend without it reports 0. */
  flags?(annot: number): number
  /** The page's own box. */
  pageBox(page: number): PageBox
}

/** What an annotation's geometry is, for whoever converts it. */
export type AnnotShape = 'polygon' | 'polyline' | 'ink' | 'rect' | 'other'

export interface PageAnnotation {
  /** Index in the page's /Annots array. */
  index: number
  /** PDFium's FPDF_ANNOT_* code. */
  subtype: number
  /** The subtype's name: "Polygon", "Square", "Ink", "FreeText"… */
  subtypeName: string
  shape: AnnotShape
  /** Normalized [0,1], y down. Every annotation has one. */
  rect: NormBox
  /** Normalized. A polygon's or polyline's vertices, or a line's two ends. */
  vertices: AnnotPoint[]
  /** Normalized. An ink annotation's strokes. */
  ink: AnnotPoint[][]
  /** /Subj: what Bluebeam calls the markup's subject. */
  subject: string
  /** /Contents: the markup's note. */
  contents: string
  /** /T: the author. */
  author: string
  /**
   * /NM: the annotation's name. Bluebeam and Acrobat keep it when a markup is
   * moved or stretched, which is what lets a shape be followed across saves.
   * Empty when the annotation has none.
   */
  name: string
  /** /F as read from the file, before any hidden flag this session sets. */
  flags: number
  /** Stroke colour as #rrggbb, or null when the annotation states none. */
  color: string | null
}

/** FPDF_ANNOT_* as PDFium numbers them (fpdf_annot.h). */
export const ANNOT_SUBTYPE_NAMES: readonly string[] = [
  'Unknown', 'Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon',
  'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret',
  'Ink', 'Popup', 'FileAttachment', 'Sound', 'Movie', 'Widget', 'Screen',
  'PrinterMark', 'TrapNet', 'Watermark', 'ThreeD', 'RichMedia', 'XFAWidget', 'Redact',
]

const TEXT = 1, LINK = 2, LINE = 4, SQUARE = 5, CIRCLE = 6, POLYGON = 7, POLYLINE = 8
const HIGHLIGHT = 9, UNDERLINE = 10, SQUIGGLY = 11, STRIKEOUT = 12, STAMP = 13
const INK = 15, POPUP = 16, WIDGET = 20, FREETEXT = 3, REDACT = 28

/**
 * Annotations that are not markups: a sticky note's icon, a link, a popup
 * window, a form field. Listing them would offer to "convert" a hyperlink.
 */
const NOT_A_MARKUP = new Set([TEXT, LINK, POPUP, WIDGET])

function shapeOf(subtype: number): AnnotShape {
  switch (subtype) {
    case POLYGON: return 'polygon'
    case POLYLINE: case LINE: return 'polyline'
    case INK: return 'ink'
    case SQUARE: case CIRCLE: case HIGHLIGHT: case UNDERLINE: case SQUIGGLY:
    case STRIKEOUT: case STAMP: case FREETEXT: case REDACT:
      return 'rect'
    default: return 'other'
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

/**
 * Every markup annotation on a page, normalized to its box.
 *
 * `page` is the PDFium page HANDLE (the worker resolves the index to one),
 * `index` the page's index for the record. An annotation PDFium refuses to
 * open is skipped rather than failing the page: one bad object must not
 * hide the other forty.
 */
export function extractPageAnnotations(backend: AnnotBackend, page: number, _index: number): PageAnnotation[] {
  const box = backend.pageBox(page)
  const w = box.right - box.left
  const h = box.top - box.bottom
  const norm = (p: AnnotPoint): AnnotPoint =>
    !(w > 0) || !(h > 0)
      ? { x: 0, y: 0 }
      : { x: clamp01((p.x - box.left) / w), y: clamp01((box.top - p.y) / h) }

  const out: PageAnnotation[] = []
  const n = backend.count(page)
  for (let i = 0; i < n; i++) {
    const a = backend.open(page, i)
    if (!a) continue
    try {
      const subtype = backend.subtype(a)
      if (NOT_A_MARKUP.has(subtype)) continue
      const shape = shapeOf(subtype)
      const rawRect = backend.rect(a)
      const rect = rawRect === null ? { x0: 0, y0: 0, x1: 0, y1: 0 } : normalizeBox(box, rawRect)

      let vertices: AnnotPoint[] = []
      if (subtype === POLYGON || subtype === POLYLINE) vertices = backend.vertices(a).map(norm)
      else if (subtype === LINE) {
        const ends = backend.line(a)
        vertices = ends === null ? [] : [norm(ends[0]), norm(ends[1])]
      }
      const ink = subtype === INK ? backend.inkPaths(a).map((path) => path.map(norm)) : []
      const c = backend.color(a)

      out.push({
        index: i,
        subtype,
        subtypeName: ANNOT_SUBTYPE_NAMES[subtype] ?? 'Unknown',
        shape,
        rect,
        vertices,
        ink,
        subject: backend.stringValue(a, 'Subj'),
        contents: backend.stringValue(a, 'Contents'),
        author: backend.stringValue(a, 'T'),
        name: backend.stringValue(a, 'NM'),
        flags: backend.flags?.(a) ?? 0,
        color: c === null ? null : `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`,
      })
    } finally {
      backend.close(a)
    }
  }
  return out
}

/**
 * PDFium's annotation surface, marshalled the way the text backend is: one
 * malloc per call for the out-params, read back off the heap, freed. Strings
 * come back UTF-16LE with a terminator, sized by a first call with no buffer.
 *
 * Here rather than in the worker so a test can drive real PDFium with it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function createPdfiumAnnotBackend(P: any, pageBox: (page: number) => PageBox): AnnotBackend {
  const malloc = (n: number): number => P.pdfium.wasmExports.malloc(n) as number
  const free = (ptr: number): void => { P.pdfium.wasmExports.free(ptr) }
  const points = (ptr: number, n: number): AnnotPoint[] => {
    const f32: Float32Array = P.pdfium.HEAPF32
    const i = ptr >> 2
    const out: AnnotPoint[] = []
    for (let k = 0; k < n; k++) out.push({ x: f32[i + k * 2]!, y: f32[i + k * 2 + 1]! })
    return out
  }
  return {
    count: (page) => P.FPDFPage_GetAnnotCount(page) as number,
    open: (page, i) => P.FPDFPage_GetAnnot(page, i) as number,
    close: (a) => { P.FPDFPage_CloseAnnot(a) },
    subtype: (a) => P.FPDFAnnot_GetSubtype(a) as number,
    rect: (a) => {
      const ptr = malloc(16)
      try {
        if (!P.FPDFAnnot_GetRect(a, ptr)) return null
        const f32: Float32Array = P.pdfium.HEAPF32
        const i = ptr >> 2
        // FS_RECTF { left, top, right, bottom }
        return { left: f32[i]!, top: f32[i + 1]!, right: f32[i + 2]!, bottom: f32[i + 3]! }
      } finally {
        free(ptr)
      }
    },
    vertices: (a) => {
      const n = P.FPDFAnnot_GetVertices(a, 0, 0) as number
      if (!(n > 0)) return []
      const ptr = malloc(n * 8)
      try {
        P.FPDFAnnot_GetVertices(a, ptr, n)
        return points(ptr, n)
      } finally {
        free(ptr)
      }
    },
    line: (a) => {
      if (typeof P.FPDFAnnot_GetLine !== 'function') return null
      const ptr = malloc(16)
      try {
        if (!P.FPDFAnnot_GetLine(a, ptr, ptr + 8)) return null
        const [s, e] = points(ptr, 2)
        return [s!, e!]
      } finally {
        free(ptr)
      }
    },
    inkPaths: (a) => {
      const paths = P.FPDFAnnot_GetInkListCount(a) as number
      const out: AnnotPoint[][] = []
      for (let k = 0; k < paths; k++) {
        const n = P.FPDFAnnot_GetInkListPath(a, k, 0, 0) as number
        if (!(n > 0)) continue
        const ptr = malloc(n * 8)
        try {
          P.FPDFAnnot_GetInkListPath(a, k, ptr, n)
          out.push(points(ptr, n))
        } finally {
          free(ptr)
        }
      }
      return out
    },
    stringValue: (a, key) => {
      // Bytes including the UTF-16 terminator; 2 means an empty string.
      const len = P.FPDFAnnot_GetStringValue(a, key, 0, 0) as number
      if (!(len > 2)) return ''
      const ptr = malloc(len)
      try {
        P.FPDFAnnot_GetStringValue(a, key, ptr, len)
        const heap: Uint8Array = P.pdfium.HEAPU8
        return new TextDecoder('utf-16le').decode(heap.subarray(ptr, ptr + len - 2))
      } finally {
        free(ptr)
      }
    },
    color: (a) => {
      const ptr = malloc(16)
      try {
        // FPDFANNOT_COLORTYPE_Color is 0: the stroke, not the interior.
        if (!P.FPDFAnnot_GetColor(a, 0, ptr, ptr + 4, ptr + 8, ptr + 12)) return null
        const u32: Uint32Array = P.pdfium.HEAPU32
        const i = ptr >> 2
        return { r: u32[i]!, g: u32[i + 1]!, b: u32[i + 2]!, a: u32[i + 3]! }
      } finally {
        free(ptr)
      }
    },
    flags: (a) => (typeof P.FPDFAnnot_GetFlags === 'function' ? (P.FPDFAnnot_GetFlags(a) as number) >>> 0 : 0),
    pageBox,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
