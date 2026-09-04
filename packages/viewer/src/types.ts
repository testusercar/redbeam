import type { NormClip } from './geometry.js'
import type { OutlineNode, OutlineShape } from './outline.js'
import type { PageBox, TextRun } from './text.js'

export interface PageInfo {
  /** Page box width in PDF points. */
  width: number
  /** Page box height in PDF points. */
  height: number
}

/**
 * A page box tagged with the page it belongs to.
 *
 * Page boxes differ across a real drawing set — a details sheet is not the same
 * size as a plan — so there is deliberately no document-level page size. All
 * normalized geometry, and therefore all calibration, is relative to the box of
 * one specific page.
 */
export interface PageMetrics extends PageInfo {
  index: number
}

export interface Viewport {
  /** Scroll offset in device pixels from the page origin, at `zoom`. */
  ox: number
  oy: number
  /** Device pixels per PDF point. */
  zoom: number
  /** Canvas size in device pixels. */
  vw: number
  vh: number
}

export type TileKey = string

/**
 * Tile identity. The page index is part of the key — without it, two pages of
 * the same set share tile slots and paging back and forth silently serves the
 * wrong raster.
 */
export function tileKey(page: number, zoom: number, tx: number, ty: number): TileKey {
  return `p${page}/${zoom.toFixed(3)}/${tx}/${ty}`
}

export function parseTileKey(key: TileKey): { page: number; zoom: number; tx: number; ty: number } | null {
  const m = /^p(-?\d+)\/(-?[\d.]+)\/(-?\d+)\/(-?\d+)$/.exec(key)
  if (!m) return null
  return { page: Number(m[1]), zoom: Number(m[2]), tx: Number(m[3]), ty: Number(m[4]) }
}

/**
 * The pixel size of one tile's bitmap, clipped to the page.
 *
 * A tile bitmap is filled white before PDFium draws into it, because that white
 * IS the paper — PDFium paints no background of its own. So a bitmap that runs
 * past the page edge contributes white beyond the page, and where the scaled
 * page is smaller than one tile the whole tile shows as a white square with a
 * small page in its corner. A letter-size sheet at 24% did exactly that.
 *
 * Clipping to the intersection makes the raster exactly the page at every zoom.
 * Edge tiles are simply smaller, which the blit handles for free by drawing
 * each bitmap at its natural size from the same tile origin.
 */
export function tileExtent(
  fullW: number,
  fullH: number,
  tile: number,
  tx: number,
  ty: number,
): { bw: number; bh: number } {
  return {
    // At least 1: PDFium refuses a zero-dimension bitmap, and a tile wholly
    // past the page should never be requested in the first place.
    bw: Math.max(1, Math.min(tile, fullW - tx * tile)),
    bh: Math.max(1, Math.min(tile, fullH - ty * tile)),
  }
}

/** Identity of a cached thumbnail render. Deliberately disjoint from tile keys. */
export function thumbKey(page: number, width: number): string {
  return `t${page}/${width}`
}

/**
 * Identity of a text-extraction job. Disjoint from both key spaces above, so a
 * `cancel` for a scrolled-away thumbnail can never drop a text job and vice
 * versa — they share one queue.
 */
export function textKey(page: number): string {
  return `x${page}`
}

/**
 * Identity of a geometry-extraction job. Disjoint from the tile, thumbnail and
 * text key spaces for the same reason they are disjoint from each other: they
 * share one queue, and a `cancel` for a scrolled-away page must not be able to
 * drop somebody else's job.
 *
 * The clip is part of the identity. Two traces in different corners of the same
 * sheet are different extractions and must not share a slot — a whole-page
 * result would answer a windowed request with far more geometry than asked for,
 * but a windowed result answering a whole-page request would silently be
 * missing most of the page.
 */
/**
 * One page's extracted vector geometry, as handed to a caller.
 *
 * Mirrors the `geometry` worker response minus its routing fields. `segments`
 * is a flat `[x1,y1,x2,y2,...]` Float32Array in normalized page coordinates,
 * transferred rather than cloned — do not hold it past the call that needs it
 * without copying.
 */
export interface PageGeometryResult {
  page: number
  segments: Float32Array
  segmentCount: number
  box: PageBox
  clip: NormClip
  pageObjects: number
  pathObjects: number
  /** True when maxSegments cut the extraction short — the region is partial. */
  truncated: boolean
  ms: number
}

/**
 * Identity of the document-index job.
 *
 * A constant, not a function, because there is exactly one per document: the
 * outline and the page labels are properties of the file, not of a page. The
 * queue's own de-duplication is what makes a second `index` request while the
 * first is still queued collapse into one walk rather than two. Disjoint from
 * every other key space above for the usual reason — one queue, and a `cancel`
 * for a scrolled-away page must never be able to drop it.
 */
export const INDEX_KEY = 'i'

export function geometryKey(page: number, clip?: NormClip): string {
  if (!clip) return `v${page}`
  const r = (n: number) => n.toFixed(4)
  return `v${page}/${r(clip.x0)},${r(clip.y0)},${r(clip.x1)},${r(clip.y1)}`
}

/**
 * Job priority. Lower runs first. The whole point is that a speculative
 * neighbour-page tile can never get in front of a tile the user is looking at.
 */
export const PRIORITY_VISIBLE = 0
/**
 * Document index — the bookmark outline and the page labels. Ahead of every
 * other speculative job, behind the tile on screen.
 *
 * It is not background indexing: it is the sheet list, which is chrome the user
 * is looking at and which cannot be drawn at all until this lands. And it is
 * cheap in a way nothing else in this ladder is — one walk over a structure the
 * size of the sheet count, plus one page-label lookup per page, with NO page
 * loads (`FPDF_GetPageLabel` takes a page index, not a handle). So making it
 * wait behind 64 thumbnail renders — ~30ms each — would trade seconds of empty
 * sheet list for milliseconds of saved work.
 *
 * It is deliberately NOT PRIORITY_VISIBLE. Enqueueing at VISIBLE also resets
 * the scheduler's quiet clock (`noteVisibleActivity`), which would make opening
 * the sheet list look, to the scheduler, like the user started panning. Sitting
 * here instead means it inherits the quiet gate: it does not start mid-pan, and
 * it runs the moment the user stops.
 */
export const PRIORITY_INDEX = 1
export const PRIORITY_THUMBNAIL = 2
export const PRIORITY_PREFETCH = 3
/**
 * Text-layer extraction. Last, deliberately.
 *
 * Nothing on screen is waiting for it: tiles are the page, thumbnails are the
 * strip, and prefetch is the page the user is about to reach. Extraction feeds
 * the search index, which is consumed minutes later, so it yields to all three.
 * It also inherits the scheduler's quiet gate — like any priority above
 * VISIBLE it does not even START while the user is panning or zooming, which
 * matters because FPDFText_LoadPage is atomic and costs ~47ms on the heavy
 * sheet (see text.ts for the measurements).
 *
 * A caller that IS waiting — the user opened find-in-page — passes an explicit
 * higher priority to `Viewer.requestText`; the job message carries `priority`
 * exactly like tiles do.
 */
export const PRIORITY_TEXT = 4
/**
 * Vector-path extraction for region tracing. Below even text.
 *
 * Measured on the heavy PKG A sheet: 368,743 page objects, 775,322 path
 * segments, ~700ms for a whole-page walk. That is an order of magnitude worse
 * than a tile and it is atomic — once it starts, nothing else in the worker
 * runs until it finishes. So it sits at the very back of the queue and inherits
 * the scheduler's quiet gate like every other speculative job.
 *
 * A caller who IS waiting — the user just clicked the region-trace tool —
 * passes an explicit higher priority, and should pass a `clip` as well: with a
 * window around the click the object-bounds prefilter rejects most of the sheet
 * before any segment is read.
 */
export const PRIORITY_GEOMETRY = 5

/** Overlay primitives. Mirrors RedbeamOverlayManager in the Qt build. */
export type DotShape = 'circle' | 'square' | 'diamond'

export interface LineOverlay {
  x1: number; y1: number; x2: number; y2: number   // normalized [0,1]
  color: string
  opacity: number
  width: number
  dashed: boolean
  label?: string
}

export interface PolygonOverlay {
  /** Normalized [0,1] ring. */
  poly: Array<[number, number]>
  fill: string
  stroke: string
  fillOpacity: number
  strokeOpacity: number
  strokeWidth: number
  dashed: boolean
  label?: string
  /** Cached centroid, normalized — used for cheap viewport culling. */
  cx: number
  cy: number
}

export interface DotOverlay {
  x: number; y: number                              // normalized [0,1]
  color: string
  opacity: number
  r: number
  shape: DotShape
}

export interface OverlaySet {
  polygons: PolygonOverlay[]
  lines: LineOverlay[]
  dots: DotOverlay[]
}

export const emptyOverlay = (): OverlaySet => ({ polygons: [], lines: [], dots: [] })

/** Worker protocol. */
export type WorkerRequest =
  | { type: 'boot'; wasmUrl: string; pdfUrl: string }
  | { type: 'config'; maxPages?: number; quietMs?: number }
  | { type: 'page'; index: number }
  | {
      type: 'tile'
      key: TileKey
      page: number
      tx: number
      ty: number
      tile: number
      zoom: number
      priority: number
    }
  | { type: 'thumb'; key: string; page: number; width: number; priority: number }
  /** Extract the page's text layer. See PRIORITY_TEXT for where it sits. */
  | { type: 'text'; key: string; page: number; priority: number }
  /** Extract the page's vector paths. See PRIORITY_GEOMETRY for where it sits. */
  | {
      type: 'geometry'
      key: string
      page: number
      priority: number
      clip?: NormClip
      minLengthPoints?: number
      curveSteps?: number
      maxSegments?: number
    }
  /**
   * Extract the bookmark outline and the page labels.
   *
   * No key and no page: it is once per document, and the worker keys it with
   * INDEX_KEY so a second request while the first is queued collapses into one
   * walk. No priority either — see PRIORITY_INDEX for why the worker, not the
   * caller, decides where a job with no page and no alternative sits.
   */
  | { type: 'index' }
  /** Drop queued work by job key. Anything already running finishes. */
  | { type: 'cancel'; keys: string[] }
  | { type: 'stats' }

export type WorkerResponse =
  | { type: 'booted'; pageCount: number; sizes: PageInfo[] }
  | { type: 'page'; index: number; width: number; height: number }
  | {
      type: 'tile'
      key: TileKey
      page: number
      tx: number
      ty: number
      zoom: number
      bmp: ImageBitmap
      ms: number
    }
  | { type: 'thumb'; key: string; page: number; width: number; height: number; bmp: ImageBitmap; ms: number }
  /**
   * One page's text layer. `error` is set instead of the payload when
   * extraction threw — carried on this message rather than the generic `error`
   * response so the waiting request, and only it, gets rejected.
   */
  | {
      type: 'text'
      key: string
      page: number
      text: string
      runs: TextRun[]
      box: PageBox
      charCount: number
      scanned: boolean
      ms: number
      error?: string
    }
  /**
   * One page's vector geometry. `segments` is a flat, transferred Float32Array
   * of `[x1,y1,x2,y2,...]` in normalized page coordinates — see geometry.ts for
   * why it is flat. `error` is set instead of the payload when extraction
   * threw, carried here rather than on the generic `error` response so only the
   * waiting request is rejected.
   */
  | {
      type: 'geometry'
      key: string
      page: number
      segments: Float32Array
      segmentCount: number
      box: PageBox
      clip: NormClip
      pageObjects: number
      pathObjects: number
      truncated: boolean
      ms: number
      error?: string
    }
  /**
   * The document's sheet index: bookmark outline, per-page labels, and what
   * shape the outline turned out to be. `error` is set instead of the payload
   * when extraction threw, carried here rather than on the generic `error`
   * response so only the waiting request is rejected — the same convention
   * `text` and `geometry` use.
   */
  | {
      type: 'index'
      outline: OutlineNode[]
      labels: Array<string | null>
      shape: OutlineShape
      ms: number
      error?: string
    }
  /** Page-handle bookkeeping, for leak assertions. `opened - closed === open`. */
  | { type: 'stats'; opened: number; closed: number; open: number; pages: number[]; queued: number }
  | { type: 'error'; message: string }
