/**
 * Writing a takeoff back into the drawing (plan 10.3).
 *
 * The quantities and the report can already leave the app. The MARKUPS could
 * not: they live in SQLite, so a takeoff was checkable only by someone sitting
 * in front of REDBEAM. That is the wrong shape for the job — a ceiling scope
 * gets argued about with a GC six months later, and the artefact that settles
 * it is the marked-up sheet, not a spreadsheet. This produces one: the source
 * PDF with real PDF annotations on it, which Bluebeam, Acrobat and a browser
 * all read.
 *
 * THE COORDINATE PROBLEM is the whole of this file, and it is worth stating
 * plainly because getting it wrong is silent — every markup lands somewhere,
 * just not where it was drawn.
 *
 * Markups are stored NORMALIZED to [0,1]. Three things have to be undone:
 *
 *  1. The Y AXIS. Normalized y runs DOWN from the top, because the viewer
 *     composites the overlay onto a PDFium raster and PDFium renders in device
 *     space; `ringToPoints` applies no flip, so the stored convention is the
 *     raster's. PDF user space runs UP from the bottom.
 *  2. The BOX ORIGIN. A page box is not required to start at (0,0) — this set
 *     has origin-centred CropBoxes, and assuming a zero origin is exactly the
 *     bug that broke geometry extraction once already. Normalization threw the
 *     origin away, so it has to be read back off the page here.
 *  3. The ROTATION. PDFium renders a /Rotate 90 page ROTATED, and the markup
 *     was drawn on what was displayed, so normalized coordinates are in
 *     DISPLAY space while annotations are written in USER space. On a rotated
 *     page the two disagree about which axis is which.
 */
import {
  PDFDocument, PDFName, PDFString, PDFArray,
  type PDFContext, type PDFDict, type PDFPage, type PDFRef,
} from 'pdf-lib'

export interface WritablePoint { x: number, y: number }

export interface WritableMarkup {
  id: string
  /** Zero-based, matching `pages.page_number`. */
  pageIndex: number
  kind: string
  /** Normalized rings; the first is the outline. */
  rings: ReadonlyArray<ReadonlyArray<WritablePoint>>
  /** Shown as the annotation's author, which is a column Bluebeam sorts by. */
  scopeLabel: string
  /** `#rrggbb`. */
  color: string
  /** Free text in the annotation body — the measurement, usually. */
  note?: string
}

export interface WriteOptions {
  /** Stamped on the document so a sheet says what produced its markups. */
  producer?: string
  /** Fill opacity. Drawings are dense; a solid fill hides what is underneath. */
  fillOpacity?: number
  /**
   * Page index to feet per PDF point (plan 10.4).
   *
   * Per PAGE, not per document, because a details sheet is not at the scale of
   * the plan next to it. A page with no entry gets no viewport and no
   * annotation measurement, which reads as "unscaled" rather than as a wrong
   * scale — the failure that matters here is a sheet that measures confidently
   * to the wrong number.
   */
  pageScales?: ReadonlyMap<number, number>
  /**
   * Page index to the scale REGIONS on it (plan 10.4, extended).
   *
   * A details sheet carries several scales, and PDF's own model for that is an
   * array of viewports, so this maps onto the format directly rather than
   * needing anything invented.
   */
  pageRegions?: ReadonlyMap<number, readonly WritableScaleRegion[]>
}

/** A page box in PDF user space. `x`/`y` are the LOWER-LEFT corner. */
export interface PageBox { x: number, y: number, width: number, height: number }

/**
 * Normalized display coordinates to PDF user space.
 *
 * Derived by asking, for each rotation, where the unrotated page's corners end
 * up on screen. Rotation is CLOCKWISE for display, so at 90 the unrotated top
 * edge lands on the right of the screen and the display's X axis runs along the
 * page's own Y axis — which is why `p.y` scales `width` there and not `height`.
 *
 * Each case is a bijection of the unit square onto the box, so the tests check
 * that corners land on corners rather than re-deriving the algebra.
 */
export function toUserSpace(
  p: WritablePoint, box: PageBox, rotation: number,
): WritablePoint {
  const rot = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360
  const { x, y, width: w, height: h } = box
  switch (rot) {
    case 90: return { x: x + p.y * w, y: y + p.x * h }
    case 180: return { x: x + (1 - p.x) * w, y: y + p.y * h }
    case 270: return { x: x + (1 - p.y) * w, y: y + (1 - p.x) * h }
    default: return { x: x + p.x * w, y: y + (1 - p.y) * h }
  }
}

/** `#rrggbb` to PDF's 0..1 triple. Anything unparseable reads as black. */
export function toPdfColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (m === null) return [0, 0, 0]
  const n = parseInt(m[1]!, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const f = (n: number): string => (Math.round(n * 1000) / 1000).toString()

/**
 * The appearance stream.
 *
 * An annotation without one is at the viewer's mercy: the spec lets a reader
 * synthesise an appearance from /Vertices, and readers disagree about whether
 * they will. Drawing it explicitly is the difference between a sheet that
 * looks right everywhere and one that looks empty in whichever viewer the GC
 * happens to use. Alpha lives in an ExtGState rather than the annotation's
 * /CA, because /CA fades the border along with the fill and the border is the
 * part that has to stay legible over a dense drawing.
 */
function appearanceOps(
  pts: readonly WritablePoint[],
  stroke: readonly [number, number, number],
  lineWidth: number,
  shape: AnnotShape,
): string {
  const rgb = stroke.map(f).join(' ')
  const head = ['/GS gs', `${rgb} RG`, `${rgb} rg`, `${f(lineWidth)} w`]

  if (shape === 'circle') {
    // A count has one point and no extent, so it gets a fixed-size ring drawn
    // around it — in POINTS, deliberately, so it stays the same size on a
    // detail sheet and a full plan rather than scaling with the drawing.
    const c = pts[0]!
    const r = COUNT_RADIUS
    const k = r * 0.5523 // circle from four Béziers
    return [...head,
      `${f(c.x + r)} ${f(c.y)} m`,
      `${f(c.x + r)} ${f(c.y + k)} ${f(c.x + k)} ${f(c.y + r)} ${f(c.x)} ${f(c.y + r)} c`,
      `${f(c.x - k)} ${f(c.y + r)} ${f(c.x - r)} ${f(c.y + k)} ${f(c.x - r)} ${f(c.y)} c`,
      `${f(c.x - r)} ${f(c.y - k)} ${f(c.x - k)} ${f(c.y - r)} ${f(c.x)} ${f(c.y - r)} c`,
      `${f(c.x + k)} ${f(c.y - r)} ${f(c.x + r)} ${f(c.y - k)} ${f(c.x + r)} ${f(c.y)} c`,
      'B',
    ].join('\n')
  }

  const path = pts.map((p, i) => `${f(p.x)} ${f(p.y)} ${i === 0 ? 'm' : 'l'}`).join('\n')
  // A polyline is a RUN, not a region: closing and filling it would draw a
  // shape the estimator never measured and add area that is not in the bid.
  return shape === 'polyline'
    ? [...head, path, 'S'].join('\n')
    : [...head, path, 'h', 'B'].join('\n')
}

/** Radius of a count marker, in points. */
const COUNT_RADIUS = 6

type AnnotShape = 'polygon' | 'polyline' | 'circle'

/**
 * Which PDF annotation a markup kind becomes.
 *
 * `null` means "not takeoff, and not this file's business": `calibration` is
 * setup, and `shape` / `dimension` / `callout` / `highlight` carry their
 * payload in `content` rather than geometry, so writing their outline alone
 * would put unlabelled boxes on a drawing.
 */
export function shapeForKind(kind: string): AnnotShape | null {
  switch (kind) {
    case 'area': case 'cutout': return 'polygon'
    case 'polyline': return 'polyline'
    case 'count': return 'circle'
    default: return null
  }
}

/** The fewest points that shape can be drawn from. */
const MIN_POINTS: Record<AnnotShape, number> = { polygon: 3, polyline: 2, circle: 1 }

const SUBTYPE: Record<AnnotShape, string> = {
  polygon: 'Polygon', polyline: 'PolyLine', circle: 'Circle',
}

/**
 * Intent, which is how a reader tells a measurement from a decoration.
 *
 * Bluebeam and Acrobat both use these to decide that a polygon is an AREA
 * measurement rather than a drawn shape, and it is what makes the annotation
 * appear in a markup list with a quantity beside it.
 */
const INTENT: Record<AnnotShape, string | null> = {
  polygon: 'PolygonDimension', polyline: 'PolyLineDimension', circle: null,
}

/**
 * A `/NumberFormat`, the unit of PDF's measurement machinery.
 *
 * `C` is the conversion from the space the array is measuring in; `D` is the
 * precision denominator, so 100 is two decimals.
 */
function numberFormat(ctx: PDFContext, unit: string, conversion: number): PDFDict {
  return ctx.obj({
    Type: 'NumberFormat',
    U: PDFString.of(unit),
    C: conversion,
    F: PDFName.of('D'), // decimal, not a fraction
    D: 100,
    RD: PDFString.of('.'),
    SS: PDFString.of(' '),
  }) as PDFDict
}

/**
 * The measurement dictionary for a page at a known scale.
 *
 * This is what turns an exported sheet from a picture of a takeoff into a
 * drawing the recipient can measure themselves and get OUR numbers. `X` and
 * `Y` convert default user space — one point — to feet, which is exactly what
 * a calibration is; `D` and `A` then format the distance and area that a
 * reader derives from them, so their conversion is 1.
 */
function measureDict(ctx: PDFContext, feetPerPoint: number): PDFDict {
  // Bluebeam shows this string verbatim as the page scale, so it is written
  // the way a drawing states one: at 72 points to the inch, one inch of paper
  // is 72 * feetPerPoint feet of building.
  const feetPerInch = feetPerPoint * 72
  return ctx.obj({
    Type: 'Measure',
    Subtype: 'RL', // rectilinear
    R: PDFString.of(`1 in = ${Math.round(feetPerInch * 1000) / 1000} ft`),
    X: ctx.obj([numberFormat(ctx, 'ft', feetPerPoint)]),
    Y: ctx.obj([numberFormat(ctx, 'ft', feetPerPoint)]),
    D: ctx.obj([numberFormat(ctx, 'ft', 1)]),
    A: ctx.obj([numberFormat(ctx, 'sq ft', 1)]),
  }) as PDFDict
}

/** What a markup is called in a reader's markup list. */
const SUBJECT: Record<string, string> = {
  area: 'Area', cutout: 'Cutout', polyline: 'Length', count: 'Count',
}

/**
 * Give the page a scale, as a measurement viewport.
 *
 * This is the difference between exporting a PICTURE of a takeoff and
 * exporting a drawing the recipient can measure themselves and arrive at our
 * numbers. Without it a GC opening the sheet in Bluebeam gets an unscaled
 * page, and any length they pull off it is in points.
 *
 * The viewport REPLACES any the source already had rather than joining it.
 * Two viewports covering the same area is ambiguous, and more to the point our
 * quantities were computed from this calibration — a sheet that measures to
 * something else while carrying our numbers would be worse than one that does
 * not measure at all.
 */
function writePageScale(
  ctx: PDFContext,
  page: PDFPage,
  box: PageBox,
  rotation: number,
  feetPerPoint: number | null,
  regions: readonly WritableScaleRegion[],
): void {
  const viewports: PDFDict[] = []

  if (feetPerPoint !== null) {
    viewports.push(ctx.obj({
      Type: 'Viewport',
      BBox: ctx.obj([box.x, box.y, box.x + box.width, box.y + box.height]),
      Name: PDFString.of('REDBEAM page scale'),
      Measure: measureDict(ctx, feetPerPoint),
    }) as PDFDict)
  }

  // ORDER IS THE SEMANTICS. Where viewports overlap, a reader takes the LAST
  // one containing the point, so the sheet-wide scale goes first and the
  // regions after it, largest to smallest. That reproduces the app's own
  // smallest-wins rule in the file, which is what stops a detail measuring at
  // the plan's scale in Bluebeam while measuring correctly in REDBEAM.
  const ordered = [...regions].sort((a, b) => rectArea(b.rect) - rectArea(a.rect))
  for (const region of ordered) {
    const corners = [
      toUserSpace({ x: region.rect.x0, y: region.rect.y0 }, box, rotation),
      toUserSpace({ x: region.rect.x1, y: region.rect.y1 }, box, rotation),
    ]
    // Re-normalized AFTER the transform: a rotation swaps which corner is
    // lower-left, and a BBox with its corners the wrong way round contains
    // nothing at all.
    const bbox = [
      Math.min(corners[0]!.x, corners[1]!.x), Math.min(corners[0]!.y, corners[1]!.y),
      Math.max(corners[0]!.x, corners[1]!.x), Math.max(corners[0]!.y, corners[1]!.y),
    ]
    viewports.push(ctx.obj({
      Type: 'Viewport',
      BBox: ctx.obj(bbox),
      Name: PDFString.of(region.label === '' ? 'REDBEAM scale region' : region.label),
      Measure: measureDict(ctx, region.feetPerPoint),
    }) as PDFDict)
  }

  if (viewports.length === 0) return
  page.node.set(PDFName.of('VP'), ctx.obj(viewports))
}

/** A region of a page carrying its own scale, in normalized coordinates. */
export interface WritableScaleRegion {
  rect: { x0: number, y0: number, x1: number, y1: number }
  feetPerPoint: number
  label: string
}

const rectArea = (r: WritableScaleRegion['rect']): number =>
  Math.abs(r.x1 - r.x0) * Math.abs(r.y1 - r.y0)

const centroidOf = (ring: readonly WritablePoint[]): WritablePoint => {
  let x = 0
  let y = 0
  for (const p of ring) { x += p.x; y += p.y }
  return { x: x / ring.length, y: y / ring.length }
}

/** Smallest containing region, matching `scaleAt` in the domain. */
function regionAt(
  p: WritablePoint, regions: readonly WritableScaleRegion[],
): WritableScaleRegion | null {
  let best: WritableScaleRegion | null = null
  for (const r of regions) {
    const x0 = Math.min(r.rect.x0, r.rect.x1)
    const x1 = Math.max(r.rect.x0, r.rect.x1)
    const y0 = Math.min(r.rect.y0, r.rect.y1)
    const y1 = Math.max(r.rect.y0, r.rect.y1)
    if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue
    if (best === null || rectArea(r.rect) < rectArea(best.rect)) best = r
  }
  return best
}

/**
 * Write markups into a copy of the source PDF.
 *
 * The source bytes are never mutated — the caller keeps the original file, and
 * a write-back that edited an issued consultant set in place would be an
 * unpleasant surprise.
 */
export async function writeMarkupsToPdf(
  source: Uint8Array,
  markups: readonly WritableMarkup[],
  options: WriteOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source)
  const pages = doc.getPages()
  const alpha = options.fillOpacity ?? 0.28
  const ctx = doc.context

  // Pages whose scale has been written, so a sheet carrying several markups
  // gets one viewport rather than one per markup.
  const scaled = new Set<number>()

  for (const markup of markups) {
    const page = pages[markup.pageIndex]
    const ring = markup.rings[0]
    const shape = shapeForKind(markup.kind)
    // A markup naming a page this document does not have is a cross-document
    // mistake rather than something to guess at; a kind with no shape is not
    // takeoff; and a ring too short for its shape has nothing to draw.
    if (page === undefined || ring === undefined || shape === null) continue
    if (ring.length < MIN_POINTS[shape]) continue

    // CropBox is what a viewer displays and therefore what the markup was
    // drawn against; pdf-lib falls back to MediaBox when there is no CropBox.
    const box = page.getCropBox() as PageBox
    const rotation = page.getRotation().angle
    const pts = ring.map((p) => toUserSpace(p, box, rotation))

    const pageRegions = options.pageRegions?.get(markup.pageIndex) ?? []
    // The scale for THIS markup: the region it sits in, else the page's. Same
    // rule the app measures by, so the annotation's own /Measure agrees with
    // the quantity that was reported for it.
    const centroid = centroidOf(ring)
    const feetPerPoint =
      regionAt(centroid, pageRegions)?.feetPerPoint ?? options.pageScales?.get(markup.pageIndex)
    if (!scaled.has(markup.pageIndex)) {
      writePageScale(
        ctx, page, box, rotation,
        options.pageScales?.get(markup.pageIndex) ?? null,
        pageRegions,
      )
      scaled.add(markup.pageIndex)
    }

    const lineWidth = 1.5
    // The stroke straddles the path, so a Rect drawn tight to the vertices
    // clips the outer half of its own border. A count marker's extent is its
    // ring, which the single vertex says nothing about.
    const pad = lineWidth + (shape === 'circle' ? COUNT_RADIUS : 0)
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const rect: [number, number, number, number] = [
      Math.min(...xs) - pad, Math.min(...ys) - pad,
      Math.max(...xs) + pad, Math.max(...ys) + pad,
    ]

    const color = toPdfColor(markup.color)
    const apStream = ctx.flateStream(appearanceOps(pts, color, lineWidth, shape), {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: rect,
      Resources: ctx.obj({
        ExtGState: ctx.obj({ GS: ctx.obj({ Type: 'ExtGState', ca: alpha, CA: 1 }) }),
      }),
    })
    const apRef = ctx.register(apStream)

    const intent = INTENT[shape]
    const annot = ctx.obj({
      Type: 'Annot',
      // A cutout is a hole in a measurement and no PDF subtype means that, so
      // it is written as a Polygon like any other and told apart by /Subj —
      // which is a column in Bluebeam's markup list.
      Subtype: SUBTYPE[shape],
      Rect: rect,
      // A circle has no vertices; its geometry is the Rect.
      ...(shape === 'circle' ? {} : { Vertices: pts.flatMap((p) => [p.x, p.y]) }),
      C: color,
      // Interior colour on a shape with an interior. A polyline is a run, and
      // giving it one would claim an area the estimator never measured.
      ...(shape === 'polyline' ? {} : { IC: color }),
      CA: 1,
      F: 4, // Print. A markup that does not print is not on the drawing.
      Border: ctx.obj([0, 0, lineWidth]),
      // Intent is how a reader tells a MEASUREMENT from a drawn shape, and it
      // is what puts the annotation in a markup list with a quantity beside it.
      ...(intent === null ? {} : { IT: PDFName.of(intent) }),
      // The annotation's own copy of the scale, so it still measures correctly
      // if it is copied onto a sheet whose page scale differs or is missing.
      ...(feetPerPoint === undefined ? {} : { Measure: measureDict(ctx, feetPerPoint) }),
      T: PDFString.of(markup.scopeLabel),
      Subj: PDFString.of(SUBJECT[markup.kind] ?? 'Markup'),
      Contents: PDFString.of(markup.note ?? ''),
      NM: PDFString.of(markup.id),
      AP: ctx.obj({ N: apRef }),
    })
    const ref: PDFRef = ctx.register(annot)

    let annots = page.node.get(PDFName.of('Annots'))
    if (!(annots instanceof PDFArray)) {
      annots = ctx.obj([])
      page.node.set(PDFName.of('Annots'), annots)
    }
    ;(annots as PDFArray).push(ref)
  }

  if (options.producer !== undefined) doc.setProducer(options.producer)
  return doc.save()
}
