/**
 * Two-layer canvas compositor.
 *
 *   layer 0 (raster)  — cached PDFium tiles, blitted. ~0.0-0.2ms per frame.
 *   layer 1 (overlay) — markup vectors, redrawn each frame. ~4.8ms at 2,500 in view.
 *
 * The viewer owns NO domain state. It is handed an OverlaySet and a Viewport
 * and draws them. Keep it that way — the Qt build's overlay manager held global
 * static maps keyed by raw page pointers, which is how it ended up with a
 * use-after-free when TilesManager reallocated. Everything here is keyed by
 * page *index*; no native handle ever crosses into this file.
 */
import { drawOverlay, type OverlayOptions, type OverlayStats } from './overlay.js'
import type { NormClip } from './geometry.js'
import type { DocumentIndex } from './outline.js'
import type { PageText } from './text.js'
import { TileCache } from './tileCache.js'
import {
  PRIORITY_PREFETCH,
  PRIORITY_GEOMETRY,
  PRIORITY_TEXT,
  PRIORITY_THUMBNAIL,
  PRIORITY_VISIBLE,
  emptyOverlay,
  geometryKey,
  textKey,
  thumbKey,
  tileKey,
  type OverlaySet,
  type PageGeometryResult,
  type PageInfo,
  type PageMetrics,
  type Viewport,
  type WorkerRequest,
  type WorkerResponse,
} from './types.js'

export interface ViewerOptions {
  tileSize?: number
  /** Cap on cached tiles before least-recently-used eviction. Across all pages. */
  maxTiles?: number
  /** Cap on cached thumbnails. Separate cache; never competes with tiles. */
  maxThumbnails?: number
  /** Default thumbnail width in device pixels. */
  thumbnailWidth?: number
  /** How many pages either side of the current one to speculatively rasterize. */
  prefetchRadius?: number
  /** Safety cap on speculative tiles per neighbour page. */
  maxPrefetchTilesPerPage?: number
  /** PDFium page handles kept open in the worker. */
  maxOpenPages?: number
  /** Quiet window with no visible-tile work before the worker starts speculative jobs. */
  quietMs?: number
  overlay?: OverlayOptions
  /** Document is open: page count and every page box are known. */
  onReady?: (info: { pageCount: number; sizes: readonly PageInfo[] }) => void
  /** A page became current. `index` says which — page boxes differ across a set. */
  onPage?: (info: PageMetrics) => void
  onTile?: (ms: number) => void
  onThumbnail?: (index: number, bmp: ImageBitmap) => void
  onError?: (message: string) => void
}

export interface PaintStats {
  rasterMs: number
  overlayMs: number
  tilesBlitted: number
  /**
   * Tiles drawn from a previous zoom as a placeholder. Non-zero means the
   * frame is showing something scaled while the sharp raster is still coming.
   */
  tilesStale: number
  overlay: OverlayStats
}

export interface ViewerStats {
  pageCount: number
  activePage: number
  tiles: number
  tilesByPage: Array<[number, number]>
  tileEvictions: number
  thumbnails: number
  /** Pages whose text layer has been extracted and cached. */
  textPages: number
  pending: number
}

export interface WorkerStats {
  /** Page handles opened since boot. */
  opened: number
  /** Page handles closed since boot. `opened - closed` must equal `open`. */
  closed: number
  open: number
  pages: number[]
  queued: number
}

interface PendingTile {
  page: number
  zoom: number
  priority: number
}

/**
 * The context's own device-pixel scale.
 *
 * Read off the transform rather than `window.devicePixelRatio`: the canvas is
 * the authority on what it was sized for, the viewer has no window in a test,
 * and the two can legitimately disagree for a frame after a monitor change.
 * Falls back to 1 when the transform is unavailable.
 */
function deviceScale(rc: CanvasRenderingContext2D): number {
  const a = rc.getTransform?.()?.a
  return typeof a === 'number' && Number.isFinite(a) && a > 0 ? a : 1
}

/**
 * The same viewport expressed in device pixels.
 *
 * Callers work in CSS pixels — that is where hit-testing, snapping and markup
 * geometry live, and it is the right space for them. Rasterisation is the
 * opposite: a tile rendered at a CSS-pixel zoom is then blown up by the
 * canvas's devicePixelRatio transform, so on a 1.5x display every drawing was
 * being rendered at 67% of native and upscaled. That is not softness that can
 * be tuned away; it is two thirds of the pixels never being drawn.
 *
 * So the tile pipeline — requests, keys, ranges and blits — runs entirely in
 * device space, and the conversion happens here, once.
 */
function toDevice(v: Viewport, d: number): Viewport {
  return d === 1
    ? v
    : { ox: v.ox * d, oy: v.oy * d, zoom: v.zoom * d, vw: v.vw * d, vh: v.vh * d }
}

/**
 * Ceilings for rendering a page as a single bitmap instead of a tile grid.
 *
 * 4096 is the conservative floor for a texture side across the GPUs a jobsite
 * laptop actually has; 8 megapixels is roughly a 4K screen's worth, which is
 * the most that can be visible at once anyway.
 */
/**
 * The sheet colour drawn under the tiles.
 *
 * Sampled from the design comps, and deliberately not pure white: a hard white
 * against true-black chrome is a harsher edge than any drawing needs, and no
 * printed sheet is #fff either.
 */
const PAPER = '#F2F0EB'

const SINGLE_TILE_MAX_SIDE = 4096
const SINGLE_TILE_MAX_AREA = 8_000_000

export class Viewer {
  private worker: Worker
  private tiles: TileCache<ImageBitmap>
  private thumbs: TileCache<ImageBitmap>
  private pending = new Map<string, PendingTile>()
  private pendingThumbs = new Map<string, number>()
  private page: PageInfo = { width: 0, height: 0 }
  private activeIndex = -1
  private sizes: PageInfo[] = []
  private count = 0
  private overlaySet: OverlaySet = emptyOverlay()
  private prefetchSig = ''
  private statsWaiters: Array<(s: WorkerStats) => void> = []
  private texts = new Map<number, PageText>()
  private textWaiters = new Map<string, Array<{ resolve: (t: PageText) => void; reject: (e: Error) => void }>>()
  /**
   * Geometry is NOT cached by page the way text is: a windowed request and a
   * full-page request for the same page are different answers, and caching the
   * first would hand a caller far less geometry than it asked for. The job key
   * already carries the clip, so waiters are keyed by it too.
   */
  private geometryWaiters = new Map<string, Array<{ resolve: (g: PageGeometryResult) => void; reject: (e: Error) => void }>>()
  /**
   * The sheet index, once. Unlike text there is no per-page dimension to key
   * on — the outline and the labels are properties of the document — so the
   * cache is one slot and the in-flight promise is one promise.
   */
  private index: DocumentIndex | null = null
  private indexPending: Promise<DocumentIndex> | null = null
  private indexWaiters: Array<{ resolve: (i: DocumentIndex) => void; reject: (e: Error) => void }> = []

  readonly tileSize: number
  private readonly prefetchRadius: number
  private readonly maxPrefetchTilesPerPage: number
  private readonly thumbnailWidth: number
  private readonly opts: ViewerOptions

  constructor(
    private raster: HTMLCanvasElement,
    private overlayCanvas: HTMLCanvasElement,
    worker: Worker,
    opts: ViewerOptions = {},
  ) {
    this.worker = worker
    this.tileSize = opts.tileSize ?? 512
    this.prefetchRadius = opts.prefetchRadius ?? 1
    this.maxPrefetchTilesPerPage = opts.maxPrefetchTilesPerPage ?? 12
    this.thumbnailWidth = opts.thumbnailWidth ?? 120
    this.opts = opts
    this.tiles = new TileCache<ImageBitmap>({ max: opts.maxTiles ?? 400, dispose: (b) => b.close() })
    this.thumbs = new TileCache<ImageBitmap>({ max: opts.maxThumbnails ?? 64, dispose: (b) => b.close() })
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data)

    // exactOptionalPropertyTypes: only send the keys we actually have.
    if (opts.maxOpenPages !== undefined || opts.quietMs !== undefined) {
      const cfg: Extract<WorkerRequest, { type: 'config' }> = { type: 'config' }
      if (opts.maxOpenPages !== undefined) cfg.maxPages = opts.maxOpenPages
      if (opts.quietMs !== undefined) cfg.quietMs = opts.quietMs
      this.send(cfg)
    }
  }

  private send(msg: WorkerRequest, transfer?: Transferable[]) {
    this.worker.postMessage(msg, transfer ?? [])
  }

  boot(wasmUrl: string, pdfUrl: string) {
    this.send({ type: 'boot', wasmUrl, pdfUrl })
  }

  // --------------------------------------------------------------- paging --

  /**
   * Make `index` the current page.
   *
   * Unlike the single-page version this does NOT clear the tile cache. That was
   * the whole cost of paging: going 5 -> 6 -> 5 re-rasterized page 5 from
   * scratch. Tiles are keyed by page, so page 5's survive; the cache bound and
   * its active-page protection decide what actually goes.
   */
  loadPage(index: number) {
    if (index < 0 || (this.count > 0 && index >= this.count)) {
      this.opts.onError?.(`page ${index} out of range (0..${this.count - 1})`)
      return
    }
    this.activeIndex = index
    this.tiles.activePage = index
    // A different page's raster is not a stale version of this one, it is a
    // different drawing. Showing it while this page renders would be a lie.
    this.paintedZoom = null
    const known = this.sizes[index]
    if (known) this.page = known
    // Anything still queued for a page we are no longer near is wasted worker
    // time; drop it before asking for the new page.
    this.cancelPending((_key, p) => p.priority !== PRIORITY_VISIBLE && !this.nearActive(p.page))
    this.prefetchSig = ''
    this.send({ type: 'page', index })
  }

  private nearActive(page: number): boolean {
    return Math.abs(page - this.activeIndex) <= this.prefetchRadius
  }

  getPageCount(): number {
    return this.count
  }

  /** Page box for one page, in PDF points. Known for all pages once booted. */
  getPageSize(index: number): PageInfo | undefined {
    return this.sizes[index]
  }

  getPageSizes(): readonly PageInfo[] {
    return this.sizes
  }

  get currentPageIndex(): number {
    return this.activeIndex
  }

  /** Page box of the current page. */
  get pageInfo(): PageInfo {
    return this.page
  }

  setOverlay(set: OverlaySet) {
    this.overlaySet = set
  }

  // -------------------------------------------------------------- messages --

  private onMessage(m: WorkerResponse) {
    if (m.type === 'booted') {
      this.count = m.pageCount
      this.sizes = m.sizes
      if (this.activeIndex >= 0) {
        const known = this.sizes[this.activeIndex]
        if (known) this.page = known
      }
      this.opts.onReady?.({ pageCount: m.pageCount, sizes: this.sizes })
    } else if (m.type === 'page') {
      this.sizes[m.index] = { width: m.width, height: m.height }
      if (m.index === this.activeIndex) this.page = { width: m.width, height: m.height }
      this.opts.onPage?.({ index: m.index, width: m.width, height: m.height })
    } else if (m.type === 'tile') {
      this.pending.delete(m.key)
      this.tiles.set(m.key, m.page, m.bmp)
      this.opts.onTile?.(m.ms)
    } else if (m.type === 'thumb') {
      this.pendingThumbs.delete(m.key)
      this.thumbs.set(m.key, m.page, m.bmp)
      this.opts.onThumbnail?.(m.page, m.bmp)
    } else if (m.type === 'geometry') {
      const waiters = this.geometryWaiters.get(m.key) ?? []
      this.geometryWaiters.delete(m.key)
      if (m.error) {
        for (const w of waiters) w.reject(new Error(m.error))
      } else {
        const g: PageGeometryResult = {
          page: m.page, segments: m.segments, segmentCount: m.segmentCount,
          box: m.box, clip: m.clip, pageObjects: m.pageObjects,
          pathObjects: m.pathObjects, truncated: m.truncated, ms: m.ms,
        }
        for (const w of waiters) w.resolve(g)
      }
    } else if (m.type === 'text') {
      const waiters = this.textWaiters.get(m.key) ?? []
      this.textWaiters.delete(m.key)
      if (m.error) {
        for (const w of waiters) w.reject(new Error(m.error))
      } else {
        const pt: PageText = {
          page: m.page, text: m.text, runs: m.runs, box: m.box,
          charCount: m.charCount, scanned: m.scanned, ms: m.ms,
        }
        this.texts.set(m.page, pt)
        for (const w of waiters) w.resolve(pt)
      }
    } else if (m.type === 'index') {
      const waiters = this.indexWaiters
      this.indexWaiters = []
      // Cleared on failure as well as success, so a caller that saw the sheet
      // list fail can ask again rather than being handed back the same rejected
      // promise for the life of the viewer.
      this.indexPending = null
      if (m.error) {
        for (const w of waiters) w.reject(new Error(m.error))
      } else {
        const di: DocumentIndex = { outline: m.outline, labels: m.labels, shape: m.shape }
        this.index = di
        for (const w of waiters) w.resolve(di)
      }
    } else if (m.type === 'stats') {
      const waiters = this.statsWaiters
      this.statsWaiters = []
      for (const w of waiters) w({ opened: m.opened, closed: m.closed, open: m.open, pages: m.pages, queued: m.queued })
    } else if (m.type === 'error') {
      this.opts.onError?.(m.message)
    }
  }

  private cancelPending(pred: (key: string, p: PendingTile) => boolean): string[] {
    const dropped: string[] = []
    for (const [key, p] of this.pending) if (pred(key, p)) dropped.push(key)
    for (const key of dropped) this.pending.delete(key)
    if (dropped.length > 0) this.send({ type: 'cancel', keys: dropped })
    return dropped
  }

  // ----------------------------------------------------------------- tiles --

  /**
   * The last zoom this page actually painted something at.
   *
   * Kept so a zoom change can keep showing the raster it already has, scaled,
   * instead of dropping to background until the new tiles arrive — which is
   * what made zooming feel like it was breaking rather than working. Null
   * whenever there is nothing honest to show.
   */
  private paintedZoom: number | null = null

  /**
   * The tile size to use at this zoom — which is often "the whole page".
   *
   * A grid only earns its keep once the page is too big to raster in one go.
   * At fit zoom an E-size sheet is around 1500x1150 device pixels: cutting
   * that into sixteen 512px tiles buys nothing and costs sixteen round-trips,
   * sixteen chances to see a tile pop in late, and fifteen interior edges for
   * a seam to appear on. PDFium renders the whole thing in one call happily.
   *
   * Above the budget it falls back to the grid, because a single bitmap at
   * high zoom would be enormous and would block the worker while it rendered.
   * The budget is in PIXELS rather than dimensions so a long thin page cannot
   * sneak past a per-side limit.
   */
  private tileSizeAt(page: PageInfo, zoom: number): number {
    const w = Math.ceil(page.width * zoom)
    const h = Math.ceil(page.height * zoom)
    if (w <= SINGLE_TILE_MAX_SIDE && h <= SINGLE_TILE_MAX_SIDE && w * h <= SINGLE_TILE_MAX_AREA) {
      return Math.max(w, h, 1)
    }
    return this.tileSize
  }

  private tileRange(page: PageInfo, v: Viewport) {
    const tile = this.tileSizeAt(page, v.zoom)
    const cols = Math.ceil((page.width * v.zoom) / tile)
    const rows = Math.ceil((page.height * v.zoom) / tile)
    return {
      tile,
      x0: Math.max(0, Math.floor(v.ox / tile)),
      x1: Math.min(cols - 1, Math.floor((v.ox + v.vw) / tile)),
      y0: Math.max(0, Math.floor(v.oy / tile)),
      y1: Math.min(rows - 1, Math.floor((v.oy + v.vh) / tile)),
    }
  }

  /**
   * Queue any visible tiles that are neither cached nor already in flight, then
   * top up the neighbour-page prefetch.
   */
  requestVisible(cssView: Viewport) {
    if (this.page.width === 0 || this.activeIndex < 0) return
    const v = toDevice(cssView, this.deviceScale())
    // A zoom change makes every in-flight tile for this page useless. Cancelling
    // them is what keeps a prefetch from being the least of your problems during
    // a fast wheel zoom.
    this.cancelPending((_k, p) => p.page === this.activeIndex && p.zoom !== v.zoom)

    const { tile, x0, x1, y0, y1 } = this.tileRange(this.page, v)
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        this.requestTile(this.activeIndex, v.zoom, tx, ty, PRIORITY_VISIBLE, tile)
      }
    }
    this.prefetchNeighbors(v)
  }

  /** Device pixels per CSS pixel, read off the raster canvas itself. */
  private deviceScale(): number {
    const rc = this.raster.getContext('2d')
    return rc === null ? 1 : deviceScale(rc)
  }

  private requestTile(page: number, zoom: number, tx: number, ty: number, priority: number, tile: number): boolean {
    const key = tileKey(page, zoom, tx, ty)
    if (this.tiles.has(key)) return false
    const inflight = this.pending.get(key)
    if (inflight) {
      // Already queued, possibly as speculation. Promote rather than duplicate;
      // the worker's queue does the same on its side.
      if (priority < inflight.priority) {
        inflight.priority = priority
        this.send({ type: 'tile', key, page, tx, ty, tile, zoom, priority })
      }
      return false
    }
    this.pending.set(key, { page, zoom, priority })
    this.send({ type: 'tile', key, page, tx, ty, tile, zoom, priority })
    return true
  }

  /**
   * Speculatively rasterize the neighbouring pages at fit zoom.
   *
   * Prioritization, in order of what actually protects the visible page:
   *
   * 1. These go out at PRIORITY_PREFETCH. The worker runs a priority queue, not
   *    the message order, so a visible tile requested later still runs first.
   * 2. The worker will not *start* speculative work until the queue has been
   *    free of visible-tile activity for `quietMs`. PDFium renders atomically,
   *    so the only way a started prefetch cannot delay a visible tile is not to
   *    start it while the user is moving. At fit zoom nothing is culled and a
   *    tile can cost ~400ms on the heavy sheet — precisely the case not to
   *    gamble on.
   * 3. Nearest neighbour first, forward before back, because paging forward is
   *    the common motion. FIFO within a priority means enqueue order is run order.
   * 4. Capped per page, and only re-issued when the page or the viewport size
   *    changes, so panning does not re-walk this every frame.
   */
  prefetchNeighbors(v: Viewport) {
    if (this.prefetchRadius <= 0 || this.count === 0 || this.activeIndex < 0) return
    const sig = `${this.activeIndex}/${v.vw}x${v.vh}`
    if (sig === this.prefetchSig) return
    this.prefetchSig = sig

    this.cancelPending((_k, p) => p.priority !== PRIORITY_VISIBLE && !this.nearActive(p.page))

    for (const page of this.neighbourOrder()) {
      const size = this.sizes[page]
      if (!size || size.width === 0 || size.height === 0) continue
      const zoom = Math.min(v.vw / size.width, v.vh / size.height)
      const tile = this.tileSizeAt(size, zoom)
      const cols = Math.ceil((size.width * zoom) / tile)
      const rows = Math.ceil((size.height * zoom) / tile)
      let issued = 0
      for (let ty = 0; ty < rows && issued < this.maxPrefetchTilesPerPage; ty++) {
        for (let tx = 0; tx < cols && issued < this.maxPrefetchTilesPerPage; tx++) {
          this.requestTile(page, zoom, tx, ty, PRIORITY_PREFETCH, tile)
          issued++
        }
      }
    }
  }

  /** i+1, i-1, i+2, i-2, ... clamped to the document. */
  private neighbourOrder(): number[] {
    const out: number[] = []
    for (let d = 1; d <= this.prefetchRadius; d++) {
      const fwd = this.activeIndex + d
      const back = this.activeIndex - d
      if (fwd < this.count) out.push(fwd)
      if (back >= 0) out.push(back)
    }
    return out
  }

  /** Fit zoom for a page in a viewport of this size. Handy for a caller paging. */
  fitZoom(index: number, vw: number, vh: number): number {
    const size = this.sizes[index]
    if (!size || size.width === 0 || size.height === 0) return 1
    return Math.min(vw / size.width, vh / size.height)
  }

  /** Forget one page's tiles. Its thumbnail is kept — a strip still needs it. */
  dropPage(index: number): number {
    this.cancelPending((_k, p) => p.page === index)
    return this.tiles.deletePage(index)
  }

  /** Forget the tiles of every page except these. */
  retainPages(keep: Iterable<number>): number {
    const set = new Set(keep)
    this.cancelPending((_k, p) => !set.has(p.page))
    return this.tiles.retainPages(set)
  }

  // ------------------------------------------------------------ thumbnails --

  /**
   * Ask for a small whole-page render, for a thumbnail strip.
   *
   * Its own cache, its own bound, its own key space — a 200-page strip scrolling
   * past cannot evict the tiles of the page being worked on, which is the only
   * property that matters here. Returns the cached bitmap if there is one.
   */
  requestThumbnail(index: number, width = this.thumbnailWidth): ImageBitmap | undefined {
    const key = thumbKey(index, width)
    const hit = this.thumbs.get(key)
    if (hit) return hit
    if (this.pendingThumbs.has(key)) return undefined
    if (index < 0 || (this.count > 0 && index >= this.count)) return undefined
    this.pendingThumbs.set(key, index)
    this.send({ type: 'thumb', key, page: index, width, priority: PRIORITY_THUMBNAIL })
    return undefined
  }

  getThumbnail(index: number, width = this.thumbnailWidth): ImageBitmap | undefined {
    return this.thumbs.get(thumbKey(index, width))
  }

  hasThumbnail(index: number, width = this.thumbnailWidth): boolean {
    return this.thumbs.has(thumbKey(index, width))
  }

  /** Drop queued thumbnail work for pages that scrolled out of the strip. */
  cancelThumbnails(keep: Iterable<number>): number {
    const set = new Set(keep)
    const drop: string[] = []
    for (const [k, page] of this.pendingThumbs) if (!set.has(page)) drop.push(k)
    for (const k of drop) this.pendingThumbs.delete(k)
    if (drop.length > 0) this.send({ type: 'cancel', keys: drop })
    return drop.length
  }

  // ------------------------------------------------------------------ text --

  /**
   * Extract one page's text layer, cached per page for the life of the viewer.
   *
   * Queued through the same worker scheduler as tiles at PRIORITY_TEXT — last,
   * and behind the quiet gate, so background indexing of a 200-sheet set never
   * competes with the page on screen. Pass a lower number for work the user is
   * actually waiting on (find-in-page): the message carries `priority` exactly
   * as tile requests do, and the worker's queue promotes a job already waiting
   * rather than duplicating it.
   */
  requestText(index: number, opts: { priority?: number; force?: boolean } = {}): Promise<PageText> {
    if (index < 0 || (this.count > 0 && index >= this.count)) {
      return Promise.reject(new Error(`page ${index} out of range (0..${this.count - 1})`))
    }
    if (!opts.force) {
      const hit = this.texts.get(index)
      if (hit) return Promise.resolve(hit)
    }
    const key = textKey(index)
    const priority = opts.priority ?? PRIORITY_TEXT
    return new Promise<PageText>((resolve, reject) => {
      const waiting = this.textWaiters.get(key)
      if (waiting) {
        waiting.push({ resolve, reject })
        // Already queued, possibly as background indexing. Re-send only to
        // promote it; the worker's queue keeps the job's place in line.
        if (opts.priority !== undefined) this.send({ type: 'text', key, page: index, priority })
        return
      }
      this.textWaiters.set(key, [{ resolve, reject }])
      this.send({ type: 'text', key, page: index, priority })
    })
  }

  /** The cached text layer for a page, if it has been extracted. Never blocks. */
  getText(index: number): PageText | undefined {
    return this.texts.get(index)
  }

  hasText(index: number): boolean {
    return this.texts.has(index)
  }

  // ----------------------------------------------------------------- index --

  /**
   * The document's sheet index: bookmark outline, page labels, and the shape
   * the outline turned out to be.
   *
   * Safe to call from anywhere, any number of times. A second call while the
   * first is in flight joins it instead of queueing a second walk, and once it
   * has landed the cached result is returned — a sheet list that re-renders on
   * every scroll must not re-walk the bookmark tree each time.
   *
   * Runs at PRIORITY_INDEX in the worker: ahead of thumbnails, prefetch, text
   * and geometry, behind the tile on screen. The caller does not get to choose,
   * because unlike text there is no "the user is waiting" variant — the only
   * reason to ask for this is that the user is waiting.
   */
  requestIndex(): Promise<DocumentIndex> {
    if (this.index) return Promise.resolve(this.index)
    if (this.indexPending) return this.indexPending
    this.indexPending = new Promise<DocumentIndex>((resolve, reject) => {
      this.indexWaiters.push({ resolve, reject })
    })
    this.send({ type: 'index' })
    return this.indexPending
  }

  /** The sheet index if it has already been extracted. Never blocks. */
  getIndex(): DocumentIndex | undefined {
    return this.index ?? undefined
  }

  // -------------------------------------------------------------- geometry --

  /**
   * Extract one page's vector paths, for region tracing.
   *
   * Runs at PRIORITY_GEOMETRY — below tiles, thumbnails and text, behind the
   * quiet gate — because a full sheet is ~700ms of work and must never compete
   * with the page on screen. Pass a `clip` for a windowed request: on a real
   * sheet that is the difference between 405k segments and 6.5k.
   *
   * Unlike requestText there is no per-page cache; see geometryWaiters.
   */
  requestGeometry(
    index: number,
    opts: {
      clip?: NormClip
      priority?: number
      minLengthPoints?: number
      curveSteps?: number
      maxSegments?: number
    } = {},
  ): Promise<PageGeometryResult> {
    if (index < 0 || (this.count > 0 && index >= this.count)) {
      return Promise.reject(new Error(`page ${index} out of range (0..${this.count - 1})`))
    }
    const key = geometryKey(index, opts.clip)
    const priority = opts.priority ?? PRIORITY_GEOMETRY
    const msg = {
      type: 'geometry' as const, key, page: index, priority,
      ...(opts.clip ? { clip: opts.clip } : {}),
      ...(opts.minLengthPoints !== undefined ? { minLengthPoints: opts.minLengthPoints } : {}),
      ...(opts.curveSteps !== undefined ? { curveSteps: opts.curveSteps } : {}),
      ...(opts.maxSegments !== undefined ? { maxSegments: opts.maxSegments } : {}),
    }
    return new Promise<PageGeometryResult>((resolve, reject) => {
      const waiting = this.geometryWaiters.get(key)
      if (waiting) {
        waiting.push({ resolve, reject })
        if (opts.priority !== undefined) this.send(msg)
        return
      }
      this.geometryWaiters.set(key, [{ resolve, reject }])
      this.send(msg)
    })
  }

  /** Drop every queued geometry job. Anything already running finishes. */
  cancelGeometry(): number {
    const keys = [...this.geometryWaiters.keys()]
    if (keys.length === 0) return 0
    for (const key of keys) {
      const waiters = this.geometryWaiters.get(key) ?? []
      this.geometryWaiters.delete(key)
      for (const w of waiters) w.reject(new Error('geometry cancelled'))
    }
    this.send({ type: 'cancel', keys })
    return keys.length
  }

  /** Drop queued extraction for pages nobody is going to ask about. */
  cancelText(keep: Iterable<number>): number {
    const set = new Set(keep)
    const drop: string[] = []
    for (const key of this.textWaiters.keys()) {
      const page = Number(key.slice(1))
      if (!set.has(page)) drop.push(key)
    }
    for (const key of drop) {
      const waiters = this.textWaiters.get(key) ?? []
      this.textWaiters.delete(key)
      for (const w of waiters) w.reject(new Error('text extraction cancelled'))
    }
    if (drop.length > 0) this.send({ type: 'cancel', keys: drop })
    return drop.length
  }

  // ----------------------------------------------------------------- paint --

  /** Composite one frame. Returns timings so callers can budget-check. */
  paint(cssView: Viewport, background = '#3a3d42'): PaintStats {
    const rc = this.raster.getContext('2d')!
    const oc = this.overlayCanvas.getContext('2d')!

    /*
     * The raster half of this method works in DEVICE pixels; the overlay half
     * works in CSS pixels. That split is the whole point.
     *
     * Tiles are rasterised by PDFium at a device-pixel zoom, so blitting them
     * through the canvas's devicePixelRatio transform would scale them a
     * second time — the transform is reset to identity for the raster and
     * restored for the overlay, which genuinely wants CSS coordinates because
     * that is where markup geometry and hit-testing live.
     *
     * Snapping then happens on the device grid by construction: `dev.ox` is
     * rounded to a whole device pixel, and `tileSize` is a device-pixel
     * constant, so every tile lands exactly on the grid with no resampling and
     * no seam.
     */
    const d = deviceScale(rc)
    const dev = toDevice(cssView, d)
    const snapped: Viewport = { ...dev, ox: Math.round(dev.ox), oy: Math.round(dev.oy) }

    const t0 = performance.now()
    rc.save()
    rc.setTransform(1, 0, 0, 1, 0, 0)
    rc.fillStyle = background
    rc.fillRect(0, 0, snapped.vw, snapped.vh)

    let blitted = 0
    let stale = 0
    if (this.page.width > 0 && this.activeIndex >= 0) {
      /*
       * Paper first.
       *
       * A tile that has not arrived used to leave the window background
       * showing through — on this app's true-black chrome that is a black
       * rectangle appearing and vanishing inside a white drawing, which is far
       * more distracting than the missing detail itself. Painting the page
       * rect white means an unrendered region reads as blank paper: the
       * drawing arrives on a sheet instead of the sheet arriving in pieces.
       *
       * It is under everything, so a fresh tile or a scaled placeholder simply
       * covers it.
       */
      rc.fillStyle = PAPER
      rc.fillRect(
        -snapped.ox,
        -snapped.oy,
        this.page.width * snapped.zoom,
        this.page.height * snapped.zoom,
      )
      /*
       * Gather the fresh tiles BEFORE drawing any of them.
       *
       * Whether this frame shows the new zoom at all is a decision about the
       * whole set, not about each tile as it arrives — so the set has to be
       * known first.
       */
      const { tile, x0, x1, y0, y1 } = this.tileRange(this.page, snapped)
      const needed = (x1 - x0 + 1) * (y1 - y0 + 1)
      const fresh: Array<[ImageBitmap, number, number]> = []
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const bmp = this.tiles.get(tileKey(this.activeIndex, snapped.zoom, tx, ty))
          if (bmp) fresh.push([bmp, tx * tile - snapped.ox, ty * tile - snapped.oy])
        }
      }

      const hasPlaceholder = this.paintedZoom !== null && this.paintedZoom !== snapped.zoom
      const complete = fresh.length >= needed

      /*
       * The swap policy, and the reason zooming stopped looking like tiling.
       *
       * Drawing each fresh tile as it arrived meant a frame could be half
       * blurred placeholder and half sharp raster, with the boundary sitting
       * exactly on a tile edge — so the grid became visible precisely while
       * the user was watching. Chrome never shows a mixed frame: it holds the
       * scaled snapshot and swaps the new raster in whole.
       *
       * So: while a placeholder exists, the new zoom waits until it covers the
       * viewport. Without one — a cold page, where the alternative is blank
       * paper — tiles still land progressively, because something is better
       * than nothing and there is no seam to reveal against.
       */
      if (hasPlaceholder && !complete) {
        rc.imageSmoothingEnabled = true
        /*
         * Zooming OUT minifies the placeholder, and a cheap filter on a
         * downscale aliases badly — thin drawing linework breaks into a
         * shimmer, which is exactly where this looked least like Chrome.
         * Magnifying is the opposite: soft either way, and a high-quality
         * upscale costs time for nothing.
         */
        rc.imageSmoothingQuality = snapped.zoom < this.paintedZoom! ? 'high' : 'low'
        stale = this.blitScaled(rc, this.paintedZoom!, snapped)
      } else {
        // Fresh tiles are 1:1 device pixels, so smoothing could only soften a
        // raster PDFium already produced at exactly the right size.
        rc.imageSmoothingEnabled = false
        for (const [bmp, x, y] of fresh) {
          rc.drawImage(bmp, x, y)
          blitted++
        }
      }

      // Promote only once this zoom stands on its own — which, given the swap
      // policy above, is the same moment it is first drawn.
      if (complete && blitted > 0) this.paintedZoom = snapped.zoom
    }
    rc.restore()
    const t1 = performance.now()

    oc.clearRect(0, 0, cssView.vw, cssView.vh)
    // The overlay stays in CSS pixels, but snapped by the SAME amount as the
    // raster — otherwise every markup sits up to half a device pixel off the
    // geometry it annotates.
    const cssSnapped: Viewport = { ...cssView, ox: snapped.ox / d, oy: snapped.oy / d }
    const stats = drawOverlay(oc, this.overlaySet, cssSnapped, this.page.width, this.page.height, this.opts.overlay)
    const t2 = performance.now()

    return { rasterMs: t1 - t0, overlayMs: t2 - t1, tilesBlitted: blitted, tilesStale: stale, overlay: stats }
  }

  /**
   * Draw this page's tiles from another zoom, scaled to the current one.
   *
   * A tile at `from` covers `tileSize / from` points of page; at `v.zoom` that
   * same span is `tileSize * v.zoom / from` device pixels. Positions are NOT
   * rounded here: the layer is a scaled placeholder, so a whole-pixel lattice
   * buys nothing and rounding would make it drift against the sharp tiles
   * landing on top of it.
   */
  private blitScaled(rc: CanvasRenderingContext2D, from: number, v: Viewport): number {
    const scale = v.zoom / from
    // The tile size the STALE zoom was rendered at, which may differ from the
    // current one — that is the whole point of an adaptive grid.
    const fromTile = this.tileSizeAt(this.page, from)
    const step = fromTile * scale
    if (!(step > 0) || !Number.isFinite(step)) return 0
    const cols = Math.ceil((this.page.width * from) / fromTile)
    const rows = Math.ceil((this.page.height * from) / fromTile)
    const x0 = Math.max(0, Math.floor(v.ox / step))
    const x1 = Math.min(cols - 1, Math.floor((v.ox + v.vw) / step))
    const y0 = Math.max(0, Math.floor(v.oy / step))
    const y1 = Math.min(rows - 1, Math.floor((v.oy + v.vh) / step))
    let n = 0
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const bmp = this.tiles.get(tileKey(this.activeIndex, from, tx, ty))
        if (bmp) {
          // The bitmap's OWN size, scaled — edge tiles are clipped to the page
          // and are smaller than a full tile, so `step` would stretch them.
          rc.drawImage(bmp, tx * step - v.ox, ty * step - v.oy, bmp.width * scale, bmp.height * scale)
          n++
        }
      }
    }
    return n
  }

  /** Whether the tiles blitted at this zoom fill the visible range. */
  private coversViewport(v: Viewport, blitted: number): boolean {
    const { x0, x1, y0, y1 } = this.tileRange(this.page, v)
    return blitted >= (x1 - x0 + 1) * (y1 - y0 + 1)
  }

  // ----------------------------------------------------------------- stats --

  stats(): ViewerStats {
    return {
      pageCount: this.count,
      activePage: this.activeIndex,
      tiles: this.tiles.size,
      tilesByPage: [...this.tiles.countByPage()],
      tileEvictions: this.tiles.evictions,
      thumbnails: this.thumbs.size,
      textPages: this.texts.size,
      pending: this.pending.size + this.pendingThumbs.size + this.textWaiters.size,
    }
  }

  /**
   * Page-handle bookkeeping from the worker. `opened - closed === open` is the
   * leak check; anything else means a handle was dropped without FPDF_ClosePage.
   */
  workerStats(): Promise<WorkerStats> {
    return new Promise((resolve) => {
      this.statsWaiters.push(resolve)
      this.send({ type: 'stats' })
    })
  }

  destroy() {
    this.tiles.clear()
    this.thumbs.clear()
    this.pending.clear()
    this.pendingThumbs.clear()
    this.statsWaiters = []
    // A pending text request outlives the worker as a promise nobody will ever
    // settle. Reject them rather than leaving awaiters hanging forever.
    for (const waiters of this.textWaiters.values()) {
      for (const w of waiters) w.reject(new Error('viewer destroyed'))
    }
    this.textWaiters.clear()
    this.texts.clear()
    for (const w of this.indexWaiters) w.reject(new Error('viewer destroyed'))
    this.indexWaiters = []
    this.indexPending = null
    this.worker.terminate()
  }
}

/** Clamp a viewport so the page cannot be panned entirely off screen. */
/**
 * Keep the viewport over the page.
 *
 * When the scaled page is SMALLER than the viewport it is CENTRED, which means
 * a negative offset. Clamping to `>= 0` instead — as this did until
 * 2026-08-28 — pins the sheet to the top-left corner, and because the clamp
 * runs after every zoom it also destroys the cursor anchor: zooming out toward
 * the threshold drags the drawing into the corner regardless of where the
 * pointer is. That was reported as "the zoom origin appears to be on the top
 * left-hand corner instead of the mouse location", and this is the cause.
 */
export function clampViewport(v: Viewport, page: PageInfo): Viewport {
  return {
    ...v,
    ox: clampAxis(v.ox, page.width * v.zoom, v.vw),
    oy: clampAxis(v.oy, page.height * v.zoom, v.vh),
  }
}

/**
 * Keep one axis in range without throwing away a zoom anchor.
 *
 * This used to snap the offset to dead centre whenever the scaled page was
 * smaller than the viewport, and that is what made zooming feel like it
 * ignored the cursor. The case is not rare — at fit, a sheet fills the height
 * and is NARROWER than the viewport, so the horizontal axis was pinned to
 * centre and zooming in near the left edge slid the drawing sideways under the
 * pointer until the page finally grew wider than the window.
 *
 * A smaller page still has a legal RANGE of offsets, not a single value: every
 * one that keeps the page fully on screen. Clamping to that range preserves
 * the anchor wherever it is achievable and only overrides it at the edges,
 * which is the whole of what a clamp should do.
 */
function clampAxis(offset: number, scaled: number, viewport: number): number {
  return scaled <= viewport
    // Page smaller than the viewport: it must stay fully visible, so the
    // offset lives in [scaled - viewport, 0] — a window, not a point.
    ? Math.min(0, Math.max(scaled - viewport, offset))
    // Page larger: the usual scroll clamp, no blank margins.
    : Math.min(Math.max(0, offset), scaled - viewport)
}

/** Zoom about a fixed screen point, so the content under the cursor stays put. */
export function zoomAbout(v: Viewport, nextZoom: number, sx: number, sy: number): Viewport {
  const k = nextZoom / v.zoom
  return { ...v, zoom: nextZoom, ox: (v.ox + sx) * k - sx, oy: (v.oy + sy) * k - sy }
}
