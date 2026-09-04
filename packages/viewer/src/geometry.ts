/**
 * Page vector-path extraction.
 *
 * PDFium exposes a page's drawing as a list of page objects; the ones that
 * matter here are paths, and a path is a list of MOVETO / LINETO / BEZIERTO
 * segments in the object's own space. Turning that into something the domain
 * layer can trace against — a flat list of straight segments in normalized page
 * coordinates — is this file's whole job. It is PDFium-free and testable in
 * plain Node behind an injected backend, exactly like `text.ts` and `PagePool`.
 *
 * ## The page box origin, again
 *
 * `docs/PORTING.md` records that the Qt build normalized as `x / width`, which
 * is only correct when the page box starts at (0,0). It does not. Measured on
 * the Barclays PKG A sheet (page 48 of `apps/desktop/public/sample.pdf`):
 *
 *     FPDF_GetPageBoundingBox -> left -1728, bottom -1296.12,
 *                                right +1728, top  +1296.12
 *     FPDF_GetPageWidthF/HeightF -> 3456 x 2592.24
 *
 * The width and height are right and tell you nothing about the offset. Path
 * points come out of `FPDFPathSegment_GetPoint` in that origin-centred space,
 * so dividing by the width puts the whole left half of the sheet at a negative
 * coordinate. Measured directly: of the 775,322 path points on that page,
 * **616,033 (79%) normalize outside [0,1]** without the origin subtracted, and
 * only **18** with it. That is the signature — the bug does not look like a
 * small error, it looks like the sheet folded in half.
 *
 * So the box is read per page and its origin folded into the transform, the
 * same way `text.ts` does it and the same way the Qt build's Python eventually
 * had to (`extract_path_segments`, `box_left`/`box_bottom`).
 *
 * ## Cost, measured on that page
 *
 * 368,743 page objects (368,294 paths, 444 text, 5 images), 775,322 path
 * segments. Whole-page walk with every point transformed and normalized:
 * **~700 ms**, yielding 405,784 straight segments. With a 0.15-wide clip
 * around a click it is **~330 ms** for 6,545 segments, because 332,150 path
 * objects are rejected on their bounds before a single segment is read.
 *
 * So this is firmly background work: it is queued through the same scheduler as
 * tiles at `PRIORITY_GEOMETRY`, below text, and never runs while the user is
 * panning. An interactive trace should pass a clip.
 *
 * These numbers are re-measured on every run by `geometryReal.test.ts`, which
 * drives this file's real PDFium backend over the real sheet.
 */

import type { PageBox } from './text.js'

/** Axis-aligned box in normalized page coordinates: [0,1], y down from the top. */
export interface NormClip {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A PDF transform, `FS_MATRIX` order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Matrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** PDFium page-object type constants. */
export const PAGEOBJ_TEXT = 1
export const PAGEOBJ_PATH = 2
export const PAGEOBJ_IMAGE = 3
export const PAGEOBJ_SHADING = 4
export const PAGEOBJ_FORM = 5

/** PDFium path-segment type constants. */
export const SEGMENT_UNKNOWN = -1
export const SEGMENT_LINETO = 0
export const SEGMENT_BEZIERTO = 1
export const SEGMENT_MOVETO = 2

/**
 * The minimum PDFium surface extraction needs. Injected so tests need no wasm,
 * and so the wasm pointer arithmetic stays in the worker where it belongs.
 *
 * Handles (`obj`, `seg`) are opaque numbers. Nothing here stores one past the
 * call that produced it — the same rule `pdf.worker.ts` follows for page
 * handles, and for the same reason the Qt build's static pointer maps went
 * stale.
 */
export interface GeometryBackend {
  /** The page's own box. Origin-centred crop boxes are real; do not assume 0,0. */
  pageBox(page: number): PageBox
  countObjects(page: number): number
  getObject(page: number, index: number): number
  objectType(obj: number): number
  /** FPDFPageObj_GetMatrix. `null` when PDFium refuses, treated as identity. */
  objectMatrix(obj: number): Matrix | null
  /** FPDFPageObj_GetBounds, in page space. Used only as a fast reject. */
  objectBounds(obj: number): PageBox | null
  /** FPDFFormObj_CountObjects — children of a Form XObject. */
  formCount(obj: number): number
  formObject(obj: number, index: number): number
  pathSegmentCount(obj: number): number
  pathSegment(obj: number, index: number): number
  segmentType(seg: number): number
  segmentClose(seg: number): boolean
  /** FPDFPathSegment_GetPoint, in the object's own space. */
  segmentPoint(seg: number): { x: number; y: number } | null
}

export interface ExtractGeometryOptions {
  /**
   * Restrict extraction to this normalized window. Objects whose bounds miss it
   * are rejected before their segments are walked, which is the difference
   * between 550 ms and something interactive on the heavy sheet.
   */
  clip?: NormClip
  /**
   * Straight segments shorter than this, in PDF points, are dropped.
   *
   * Not an optimization dressed up as a filter: a 0.5 pt tick cannot bound a
   * room, but on a hatched sheet there are hundreds of thousands of them and
   * each one costs a slot in the output and a Bresenham walk in the tracer.
   * Zero disables the filter.
   */
  minLengthPoints?: number
  /** Chords a cubic bezier is flattened into. */
  curveSteps?: number
  /** Hard ceiling on emitted segments. Truncation is reported, never silent. */
  maxSegments?: number
  /**
   * How deep to follow Form XObjects. Nested forms are legal and their contents
   * are in form-local space until every ancestor matrix is composed in.
   */
  maxDepth?: number
  /**
   * How far outside the page box a point may sit and still be kept, in
   * normalized units. Content outside the crop box is clipped away by the
   * renderer, so it is not on the sheet and must not be on the trace either.
   */
  overflow?: number
  now?: () => number
}

export interface PageGeometry {
  /** Page index, 0-based. Matches the tile/thumbnail/text key space. */
  page: number
  /**
   * Straight segments as `[x1, y1, x2, y2, ...]` in normalized page
   * coordinates [0,1], y DOWN from the top — the same convention every markup
   * and overlay uses. Flat and `Float32Array` rather than an array of objects
   * because the heavy sheet yields ~400,000 of them: 6.5 MB flat and one
   * transfer, versus tens of megabytes of objects and a structured clone.
   */
  segments: Float32Array
  segmentCount: number
  /** The box the segments were normalized against. Kept for diagnostics. */
  box: PageBox
  clip: NormClip
  pageObjects: number
  pathObjects: number
  /** Path objects rejected by the clip before their segments were walked. */
  clippedObjects: number
  droppedShort: number
  droppedOffPage: number
  /** `maxSegments` was reached; the page's geometry is incomplete. */
  truncated: boolean
  ms: number
}

export const FULL_PAGE: NormClip = { x0: 0, y0: 0, x1: 1, y1: 1 }

export const GEOMETRY_DEFAULTS = {
  minLengthPoints: 1,
  curveSteps: 6,
  maxSegments: 500_000,
  maxDepth: 8,
  overflow: 0.02,
} as const

/** Compose so a point is transformed by `inner`, then by `outer`. */
export function multiplyMatrix(inner: Matrix, outer: Matrix): Matrix {
  return {
    a: inner.a * outer.a + inner.b * outer.c,
    b: inner.a * outer.b + inner.b * outer.d,
    c: inner.c * outer.a + inner.d * outer.c,
    d: inner.c * outer.b + inner.d * outer.d,
    e: inner.e * outer.a + inner.f * outer.c + outer.e,
    f: inner.e * outer.b + inner.f * outer.d + outer.f,
  }
}

export function transformPoint(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
}

/**
 * PDF user space -> normalized [0,1], y down.
 *
 * The origin subtraction is the whole point; see the file header. NOT clamped,
 * unlike `text.ts`'s box normalizer: a clamped path point becomes a spurious
 * wall along the edge of the sheet, and a wall the drawing does not have is
 * worse for tracing than a missing one. Off-page points are dropped instead.
 */
export function normalizePathPoint(box: PageBox, x: number, y: number): { x: number; y: number } {
  const w = box.right - box.left
  const h = box.top - box.bottom
  if (!(w > 0) || !(h > 0)) return { x: 0, y: 0 }
  return { x: (x - box.left) / w, y: (box.top - y) / h }
}

function clipsOverlap(a: NormClip, b: NormClip): boolean {
  return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1)
}

/** A PDF-space bounds rectangle, normalized and normalized-ordered. */
function boundsToClip(box: PageBox, b: PageBox): NormClip {
  const p = normalizePathPoint(box, Math.min(b.left, b.right), Math.max(b.bottom, b.top))
  const q = normalizePathPoint(box, Math.max(b.left, b.right), Math.min(b.bottom, b.top))
  return { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) }
}

interface Emitter {
  push(ax: number, ay: number, bx: number, by: number): boolean
}

/**
 * Extract one page's straight-line geometry.
 *
 * ## What is filtered, and why
 *
 * 1. **Only PATH objects** (and FORM objects, recursively). Text is `text.ts`'s
 *    job; a glyph's outline is not a wall and there are thousands of them.
 *    Images and shadings have no vector boundary at all.
 * 2. **Beziers flattened** to `curveSteps` chords. Door swings and radiused
 *    walls are real boundaries and have to be there; the tracer only speaks
 *    straight lines.
 * 3. **Segments shorter than `minLengthPoints`.** Stipple, hatch ticks and
 *    zero-length join artifacts. They cannot bound a region and there are
 *    hundreds of thousands of them.
 * 4. **Objects outside `clip`**, rejected on their bounds before any segment is
 *    read. For a trace this is the whole page's worth of savings.
 * 5. **Points more than `overflow` outside the page box.** The renderer clips
 *    them; a segment running off to a coordinate the sheet does not have would
 *    otherwise streak across the raster.
 * 6. **Everything past `maxSegments`.** Reported as `truncated`, so a caller
 *    can tell "this page has no walls there" from "we stopped looking".
 *
 * Fill/stroke mode and stroke width are deliberately NOT used to filter. On
 * this sheet the walls are strokes and the poché is fill, but that is a
 * convention of one CAD exporter, and a filter that silently drops a filled
 * wall is a takeoff that silently loses a room.
 */
export function extractPageGeometry(
  backend: GeometryBackend,
  pageHandle: number,
  pageIndex: number,
  opts: ExtractGeometryOptions = {},
): PageGeometry {
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const t0 = now()
  const box = backend.pageBox(pageHandle)
  const clip = opts.clip ?? FULL_PAGE
  const minLength = Math.max(0, opts.minLengthPoints ?? GEOMETRY_DEFAULTS.minLengthPoints)
  const curveSteps = Math.max(1, Math.min(32, Math.floor(opts.curveSteps ?? GEOMETRY_DEFAULTS.curveSteps)))
  const maxSegments = Math.max(0, Math.floor(opts.maxSegments ?? GEOMETRY_DEFAULTS.maxSegments))
  const maxDepth = Math.max(0, Math.floor(opts.maxDepth ?? GEOMETRY_DEFAULTS.maxDepth))
  const overflow = Math.max(0, opts.overflow ?? GEOMETRY_DEFAULTS.overflow)

  const pageW = box.right - box.left
  const pageH = box.top - box.bottom
  // The filter is stated in PDF points but applied in normalized units, so
  // convert once rather than un-normalizing every segment.
  const minLenNormX = pageW > 0 ? minLength / pageW : 0
  const minLenNormY = pageH > 0 ? minLength / pageH : 0

  const out = new Float32Array(Math.max(4, maxSegments * 4))
  let n = 0
  let droppedShort = 0
  let droppedOffPage = 0
  let truncated = false

  const lo = -overflow
  const hi = 1 + overflow
  const clipX0 = clip.x0 - overflow
  const clipY0 = clip.y0 - overflow
  const clipX1 = clip.x1 + overflow
  const clipY1 = clip.y1 + overflow

  const emitter: Emitter = {
    push(ax, ay, bx, by) {
      if (n >= maxSegments) {
        truncated = true
        return false
      }
      if (ax < lo || ax > hi || ay < lo || ay > hi || bx < lo || bx > hi || by < lo || by > hi) {
        droppedOffPage++
        return true
      }
      // Both endpoints outside the clip on the same side: it cannot cross.
      if ((ax < clipX0 && bx < clipX0) || (ax > clipX1 && bx > clipX1)) return true
      if ((ay < clipY0 && by < clipY0) || (ay > clipY1 && by > clipY1)) return true
      if (minLength > 0) {
        const dx = (bx - ax) / (minLenNormX || 1)
        const dy = (by - ay) / (minLenNormY || 1)
        if (dx * dx + dy * dy < 1) {
          droppedShort++
          return true
        }
      }
      const at = n * 4
      out[at] = ax
      out[at + 1] = ay
      out[at + 2] = bx
      out[at + 3] = by
      n++
      return true
    },
  }

  const pageObjects = backend.countObjects(pageHandle)
  let pathObjects = 0
  let clippedObjects = 0

  const visit = (obj: number, parent: Matrix, depth: number, prefiltered: boolean): boolean => {
    const type = backend.objectType(obj)
    const own = backend.objectMatrix(obj) ?? IDENTITY
    const matrix = multiplyMatrix(own, parent)

    if (type === PAGEOBJ_FORM) {
      if (depth >= maxDepth) return true
      const count = backend.formCount(obj)
      for (let i = 0; i < count; i++) {
        // No bounds prefilter inside a form: PDFium reports a child's bounds in
        // a space that depends on the container chain, so the reliable clip
        // test for nested geometry is the transformed points themselves.
        if (!visit(backend.formObject(obj, i), matrix, depth + 1, false)) return false
      }
      return true
    }
    if (type !== PAGEOBJ_PATH) return true
    pathObjects++

    if (!prefiltered && depth === 0) {
      const b = backend.objectBounds(obj)
      if (b) {
        const bc = boundsToClip(box, b)
        if (!clipsOverlap(bc, { x0: clipX0, y0: clipY0, x1: clipX1, y1: clipY1 })) {
          clippedObjects++
          return true
        }
      }
    }
    return walkPath(backend, obj, matrix, box, curveSteps, emitter)
  }

  for (let i = 0; i < pageObjects; i++) {
    const obj = backend.getObject(pageHandle, i)
    if (!obj) continue
    if (!visit(obj, IDENTITY, 0, false)) break
  }

  return {
    page: pageIndex,
    segments: out.subarray(0, n * 4).slice(),
    segmentCount: n,
    box,
    clip,
    pageObjects,
    pathObjects,
    clippedObjects,
    droppedShort,
    droppedOffPage,
    truncated,
    ms: now() - t0,
  }
}

/**
 * Walk one path object's segments, emitting straight chords.
 *
 * The shape of this loop is ported from the Qt build's `extract_path_segments`.
 * PDFium reports one cubic bezier as THREE consecutive BEZIERTO segments
 * carrying the two control points and the endpoint, which is why the index
 * advances by three there and here. A segment flagged `close` that does not
 * already sit on the subpath start gets the closing chord emitted explicitly —
 * PDFium does not hand it to you.
 *
 * Bounded: the loop index strictly increases every iteration.
 */
function walkPath(
  backend: GeometryBackend,
  obj: number,
  matrix: Matrix,
  box: PageBox,
  curveSteps: number,
  emit: Emitter,
): boolean {
  const count = backend.pathSegmentCount(obj)
  if (count <= 0) return true

  let curX = 0
  let curY = 0
  let startX = 0
  let startY = 0
  let open = false

  const at = (i: number) => {
    const seg = backend.pathSegment(obj, i)
    if (!seg) return null
    const p = backend.segmentPoint(seg)
    if (!p) return null
    const t = transformPoint(matrix, p.x, p.y)
    const nrm = normalizePathPoint(box, t.x, t.y)
    return { type: backend.segmentType(seg), close: backend.segmentClose(seg), x: nrm.x, y: nrm.y }
  }

  for (let i = 0; i < count; i++) {
    const e = at(i)
    if (!e) continue

    if (e.type === SEGMENT_MOVETO) {
      curX = e.x
      curY = e.y
      startX = e.x
      startY = e.y
      open = true
      continue
    }
    if (!open) {
      // A path that starts with a LINETO has no current point. Treat the first
      // point as the subpath start rather than drawing from the origin, which
      // would streak a segment across the sheet.
      curX = e.x
      curY = e.y
      startX = e.x
      startY = e.y
      open = true
      continue
    }

    if (e.type === SEGMENT_LINETO) {
      if (!emit.push(curX, curY, e.x, e.y)) return false
      curX = e.x
      curY = e.y
      if (e.close && (curX !== startX || curY !== startY)) {
        if (!emit.push(curX, curY, startX, startY)) return false
        curX = startX
        curY = startY
      }
      continue
    }

    if (e.type === SEGMENT_BEZIERTO && i + 2 < count) {
      const c2 = at(i + 1)
      const end = at(i + 2)
      i += 2
      if (!c2 || !end) continue
      let px = curX
      let py = curY
      for (let s = 1; s <= curveSteps; s++) {
        const t = s / curveSteps
        const mt = 1 - t
        const qx =
          mt * mt * mt * curX + 3 * mt * mt * t * e.x + 3 * mt * t * t * c2.x + t * t * t * end.x
        const qy =
          mt * mt * mt * curY + 3 * mt * mt * t * e.y + 3 * mt * t * t * c2.y + t * t * t * end.y
        if (!emit.push(px, py, qx, qy)) return false
        px = qx
        py = qy
      }
      curX = end.x
      curY = end.y
      if (end.close && (curX !== startX || curY !== startY)) {
        if (!emit.push(curX, curY, startX, startY)) return false
        curX = startX
        curY = startY
      }
      continue
    }
  }
  return true
}

// ------------------------------------------------------------ pdfium glue --

/**
 * The slice of the `@embedpdf/pdfium` wrapper this file needs.
 *
 * Declared structurally rather than imported so `geometry.ts` still pulls in no
 * PDFium code — the module is passed in. That is what lets the integration test
 * drive the REAL backend against the real sheet in plain Node, instead of
 * testing a fake and hoping the worker's copy agrees with it.
 */
export interface PdfiumLike {
  pdfium: {
    HEAPF32: Float32Array
    wasmExports: { malloc(size: number): number; free?(ptr: number): void }
  }
  FPDF_GetPageBoundingBox(page: number, rectPtr: number): boolean
  FPDF_GetPageWidthF(page: number): number
  FPDF_GetPageHeightF(page: number): number
  FPDFPage_CountObjects(page: number): number
  FPDFPage_GetObject(page: number, index: number): number
  FPDFPageObj_GetType(obj: number): number
  FPDFPageObj_GetMatrix(obj: number, matrixPtr: number): boolean
  FPDFPageObj_GetBounds(obj: number, l: number, b: number, r: number, t: number): boolean
  FPDFFormObj_CountObjects(obj: number): number
  FPDFFormObj_GetObject(obj: number, index: number): number
  FPDFPath_CountSegments(obj: number): number
  FPDFPath_GetPathSegment(obj: number, index: number): number
  FPDFPathSegment_GetType(seg: number): number
  FPDFPathSegment_GetClose(seg: number): boolean
  FPDFPathSegment_GetPoint(seg: number, xPtr: number, yPtr: number): boolean
}

/**
 * The page's box in PDFium page space. Read, never assumed.
 *
 * On the real PKG A sheet this returns (-1728, -1296.12, 1728, 1296.12). See
 * the file header for what deriving it from FPDF_GetPageWidthF costs you.
 * `FS_RECTF` is { left, top, right, bottom } as four floats.
 */
export function readPdfiumPageBox(pdfium: PdfiumLike, pageHandle: number, scratch: number): PageBox {
  if (pdfium.FPDF_GetPageBoundingBox(pageHandle, scratch)) {
    const f32 = pdfium.pdfium.HEAPF32
    const i = scratch >> 2
    const box = { left: f32[i]!, top: f32[i + 1]!, right: f32[i + 2]!, bottom: f32[i + 3]! }
    if (box.right - box.left > 0 && box.top - box.bottom > 0) return box
  }
  // Only reached if PDFium refuses the box. Falling back to the page size is a
  // guess about the origin, which is the bug above — but a guess beats nothing.
  return {
    left: 0,
    bottom: 0,
    right: pdfium.FPDF_GetPageWidthF(pageHandle),
    top: pdfium.FPDF_GetPageHeightF(pageHandle),
  }
}

/**
 * Bind a `GeometryBackend` to a live PDFium module.
 *
 * `scratch` is a single wasm allocation reused for every out-parameter: 48
 * bytes covers an FS_MATRIX (6 floats), a bounds rect (4) and a point (2), at
 * distinct offsets. Allocating per call would dominate a 775,322-point walk.
 * The heap view is re-fetched on every read, because the wasm heap can be
 * resized underneath us and a cached typed array would then be detached.
 */
export function createPdfiumGeometryBackend(
  pdfium: PdfiumLike,
  scratch: number,
  pageBox?: (pageHandle: number) => PageBox,
): GeometryBackend {
  const heap = () => pdfium.pdfium.HEAPF32
  return {
    pageBox: pageBox ?? ((page) => readPdfiumPageBox(pdfium, page, scratch)),
    countObjects: (page) => pdfium.FPDFPage_CountObjects(page),
    getObject: (page, i) => pdfium.FPDFPage_GetObject(page, i),
    objectType: (obj) => pdfium.FPDFPageObj_GetType(obj),
    objectMatrix: (obj) => {
      if (!pdfium.FPDFPageObj_GetMatrix(obj, scratch)) return null
      const f = heap()
      const i = scratch >> 2
      return { a: f[i]!, b: f[i + 1]!, c: f[i + 2]!, d: f[i + 3]!, e: f[i + 4]!, f: f[i + 5]! }
    },
    objectBounds: (obj) => {
      // FPDFPageObj_GetBounds(obj, left, bottom, right, top) — four floats.
      if (!pdfium.FPDFPageObj_GetBounds(obj, scratch, scratch + 4, scratch + 8, scratch + 12)) return null
      const f = heap()
      const i = scratch >> 2
      return { left: f[i]!, bottom: f[i + 1]!, right: f[i + 2]!, top: f[i + 3]! }
    },
    formCount: (obj) => pdfium.FPDFFormObj_CountObjects(obj),
    formObject: (obj, i) => pdfium.FPDFFormObj_GetObject(obj, i),
    pathSegmentCount: (obj) => pdfium.FPDFPath_CountSegments(obj),
    pathSegment: (obj, i) => pdfium.FPDFPath_GetPathSegment(obj, i),
    segmentType: (seg) => pdfium.FPDFPathSegment_GetType(seg),
    segmentClose: (seg) => !!pdfium.FPDFPathSegment_GetClose(seg),
    segmentPoint: (seg) => {
      if (!pdfium.FPDFPathSegment_GetPoint(seg, scratch, scratch + 4)) return null
      const f = heap()
      return { x: f[scratch >> 2]!, y: f[(scratch >> 2) + 1]! }
    },
  }
}
