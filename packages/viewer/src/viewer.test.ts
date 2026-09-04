import { describe, expect, it } from 'vitest'
import { Viewer } from './viewer.js'
import {
  PRIORITY_PREFETCH,
  PRIORITY_THUMBNAIL,
  PRIORITY_VISIBLE,
  emptyOverlay,
  thumbKey,
  tileKey,
  type PageInfo,
  type Viewport,
  type WorkerRequest,
  type WorkerResponse,
} from './types.js'

/**
 * A Worker that records what it was told and lets a test hand back replies.
 * Nothing here touches PDFium — this exercises the viewer's half of the
 * protocol: keys, priorities, cancellation and cache bookkeeping.
 */
class FakeWorker {
  sent: WorkerRequest[] = []
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null
  terminated = false

  postMessage(msg: WorkerRequest) {
    this.sent.push(msg)
  }

  terminate() {
    this.terminated = true
  }

  reply(msg: WorkerResponse) {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>)
  }

  tiles(): Array<Extract<WorkerRequest, { type: 'tile' }>> {
    return this.sent.filter((m): m is Extract<WorkerRequest, { type: 'tile' }> => m.type === 'tile')
  }

  cancels(): string[] {
    return this.sent.flatMap((m) => (m.type === 'cancel' ? m.keys : []))
  }

  clear() {
    this.sent = []
  }
}

const closed: string[] = []
/**
 * A fake bitmap WITH dimensions.
 *
 * It used to be `{ id, close }` only, which made `bmp.width * scale` in the
 * placeholder path evaluate to NaN — so the scaled-placeholder maths was never
 * really under test, and a drawImage with NaN dimensions draws nothing.
 */
const bmp = (id: string, width = 512, height = 512) =>
  ({ id, width, height, close: () => closed.push(id) }) as unknown as ImageBitmap

function stubCanvas(dpr = 1) {
  const drawn: Array<[number, number]> = []
  const sized: Array<[number, number, number, number]> = []
  const fills: Array<{ style: string; x: number; y: number; w: number; h: number }> = []
  const styleRef = { value: '' }
  const ctx = new Proxy(
    { drawn },
    {
      get(t: Record<string, unknown>, k: string) {
        if (k === 'drawn') return drawn
        if (k === 'sized') return sized
        if (k === 'fills') return fills
        if (k === 'fillRect') {
          return (x: number, y: number, w: number, h: number) =>
            fills.push({ style: String(styleRef.value), x, y, w, h })
        }
        if (k === 'drawImage') {
          return (_b: unknown, x: number, y: number, w?: number, h?: number) => {
            drawn.push([x, y])
            if (w !== undefined && h !== undefined) sized.push([x, y, w, h])
          }
        }
        // The real canvas carries a devicePixelRatio transform; the viewer
        // reads it to decide what a whole pixel is.
        if (k === 'getTransform') return () => ({ a: dpr })
        if (typeof t[k] === 'function') return t[k]
        return () => undefined
      },
      set(_t: unknown, k: string, value: unknown) {
        if (k === 'fillStyle') styleRef.value = String(value)
        return true
      },
    },
  )
  return { getContext: () => ctx, drawn, sized, fills } as unknown as HTMLCanvasElement & {
    drawn: Array<[number, number]>
    sized: Array<[number, number, number, number]>
    fills: Array<{ style: string; x: number; y: number; w: number; h: number }>
  }
}

const SIZES: PageInfo[] = [
  { width: 3456, height: 2592 }, // E-size plan
  { width: 3456, height: 2592 },
  { width: 612, height: 792 }, // a details sheet — deliberately different
  { width: 3456, height: 2592 },
]

const view = (over: Partial<Viewport> = {}): Viewport => ({ ox: 0, oy: 0, zoom: 1, vw: 1100, vh: 760, ...over })

function boot(opts: Parameters<typeof makeViewer>[0] = {}, dpr = 1) {
  const h = makeViewer(opts, dpr)
  h.worker.reply({ type: 'booted', pageCount: SIZES.length, sizes: SIZES })
  return h
}

function makeViewer(opts: ConstructorParameters<typeof Viewer>[3] = {}, dpr = 1) {
  const worker = new FakeWorker()
  const raster = stubCanvas(dpr)
  const overlay = stubCanvas(dpr)
  const viewer = new Viewer(raster, overlay, worker as unknown as Worker, opts)
  return { worker, viewer, raster, overlay }
}

/** Answer every outstanding tile request with a fake bitmap. */
function fulfilTiles(h: { worker: FakeWorker }) {
  for (const t of h.worker.tiles()) {
    h.worker.reply({
      type: 'tile',
      key: t.key,
      page: t.page,
      tx: t.tx,
      ty: t.ty,
      zoom: t.zoom,
      // The size the worker was asked for, so scaled blits are measurable.
      bmp: bmp(t.key, t.tile, t.tile),
      ms: 1,
    })
  }
}

describe('Viewer — document shape', () => {
  it('exposes a page count and a per-page box', () => {
    const { viewer } = boot()
    expect(viewer.getPageCount()).toBe(4)
    expect(viewer.getPageSize(0)).toEqual({ width: 3456, height: 2592 })
    expect(viewer.getPageSize(2)).toEqual({ width: 612, height: 792 })
    expect(viewer.getPageSize(99)).toBeUndefined()
    expect(viewer.getPageSizes()).toHaveLength(4)
  })

  it('adopts the page box synchronously from the boot manifest', () => {
    const { viewer } = boot()
    viewer.loadPage(2)
    // No worker round trip yet — calibration must not read a stale plan-sized box.
    expect(viewer.pageInfo).toEqual({ width: 612, height: 792 })
    expect(viewer.currentPageIndex).toBe(2)
  })

  it('reports the page index alongside the box on onPage', () => {
    const seen: Array<{ index: number; width: number }> = []
    const h = boot({ onPage: (i) => seen.push({ index: i.index, width: i.width }) })
    h.viewer.loadPage(2)
    h.worker.reply({ type: 'page', index: 2, width: 612, height: 792 })
    expect(seen).toEqual([{ index: 2, width: 612 }])
  })

  it('refuses a page outside the document', () => {
    const errors: string[] = []
    const h = boot({ onError: (m) => errors.push(m) })
    h.viewer.loadPage(9)
    expect(errors).toHaveLength(1)
    expect(h.viewer.currentPageIndex).toBe(-1)
  })
})

describe('Viewer — page-aware tiles', () => {
  it('keys visible tiles by page', () => {
    const h = boot({ prefetchRadius: 0 })
    h.viewer.loadPage(1)
    h.worker.clear()
    h.viewer.requestVisible(view({ zoom: 0.2 }))
    const keys = h.worker.tiles().map((t) => t.key)
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every((k) => k.startsWith('p1/'))).toBe(true)
    expect(h.worker.tiles().every((t) => t.priority === PRIORITY_VISIBLE)).toBe(true)
  })

  it('does not throw page N away when you page to N+1 and back', () => {
    const h = boot({ prefetchRadius: 0 })
    h.viewer.loadPage(0)
    h.viewer.requestVisible(view({ zoom: 0.2 }))
    fulfilTiles(h)
    const onPage0 = h.viewer.stats().tiles
    expect(onPage0).toBeGreaterThan(0)

    h.viewer.loadPage(1)
    h.worker.clear()
    h.viewer.requestVisible(view({ zoom: 0.2 }))
    fulfilTiles(h)
    expect(h.viewer.stats().tiles).toBeGreaterThan(onPage0)

    // Back to 0: everything is already cached, so nothing is re-requested.
    h.viewer.loadPage(0)
    h.worker.clear()
    h.viewer.requestVisible(view({ zoom: 0.2 }))
    expect(h.worker.tiles()).toEqual([])
  })

  it('dropping one page leaves the other pages cached', () => {
    const h = boot({ prefetchRadius: 0 })
    for (const p of [0, 1]) {
      h.viewer.loadPage(p)
      h.viewer.requestVisible(view({ zoom: 0.2 }))
      fulfilTiles(h)
      h.worker.clear()
    }
    const byPage = new Map(h.viewer.stats().tilesByPage)
    h.viewer.dropPage(0)
    const after = new Map(h.viewer.stats().tilesByPage)
    expect(after.has(0)).toBe(false)
    expect(after.get(1)).toBe(byPage.get(1))
  })

  it('keeps maxTiles across pages and protects the visible one', () => {
    const h = boot({ prefetchRadius: 1, maxTiles: 8, maxPrefetchTilesPerPage: 12 })
    h.viewer.loadPage(1)
    h.viewer.requestVisible(view({ zoom: 0.3 }))
    fulfilTiles(h)
    const s = h.viewer.stats()
    expect(s.tiles).toBeLessThanOrEqual(8)
    // Whatever got evicted, the page the user is on kept its tiles.
    const byPage = new Map(s.tilesByPage)
    expect(byPage.get(1)).toBeGreaterThan(0)
  })

  it('cancels in-flight tiles for the old zoom', () => {
    const h = boot({ prefetchRadius: 0 })
    h.viewer.loadPage(0)
    h.viewer.requestVisible(view({ zoom: 0.2 }))
    const stale = h.worker.tiles().map((t) => t.key)
    h.worker.clear()
    h.viewer.requestVisible(view({ zoom: 0.4 }))
    expect(h.worker.cancels().sort()).toEqual(stale.sort())
  })

  it('blits from the active page, not whatever was cached last', () => {
    const h = boot({ prefetchRadius: 0 })
    const v = view({ zoom: 0.2 })
    h.viewer.loadPage(0)
    h.viewer.requestVisible(v)
    fulfilTiles(h)
    h.viewer.loadPage(1)
    // Page 1 has nothing cached yet, so nothing may be drawn.
    expect(h.viewer.paint(v).tilesBlitted).toBe(0)
    h.viewer.requestVisible(v)
    fulfilTiles(h)
    expect(h.viewer.paint(v).tilesBlitted).toBeGreaterThan(0)
  })
})

describe('Viewer — seamless compositing', () => {
  /*
   * Tile seams and soft text came from ONE line: `drawImage` at a fractional
   * destination. `ox`/`oy` are continuous (wheel deltas, zoom anchoring), so
   * `tx * tileSize - ox` was fractional, canvas resampled every tile, and
   * adjacent tiles landed at different sub-pixel phases — a visible line down
   * every boundary and a half-pixel blur over a raster PDFium had already
   * produced at exactly the right size.
   */
  it('blits every tile at a whole device pixel, whatever the scroll offset', () => {
    const h = boot()
    h.viewer.loadPage(0)
    // Offsets a real wheel event produces: nothing lands on an integer.
    const v = view({ ox: 137.4, oy: 88.62 })
    h.viewer.requestVisible(v)
    fulfilTiles(h)
    h.raster.drawn.length = 0
    h.viewer.paint(v)

    expect(h.raster.drawn.length).toBeGreaterThan(0)
    for (const [x, y] of h.raster.drawn) {
      expect(Number.isInteger(x), `x=${x} is fractional — canvas will resample`).toBe(true)
      expect(Number.isInteger(y), `y=${y} is fractional — canvas will resample`).toBe(true)
    }
  })

  it('rasterises at DEVICE resolution, not CSS resolution', () => {
    /*
     * The bug this pins: tiles used to be requested at a CSS-pixel zoom and
     * then blown up by the canvas's devicePixelRatio transform, so on a 1.5x
     * display every drawing was rendered at 67% of native and upscaled. Two
     * thirds of the pixels were never drawn — no amount of filtering recovers
     * that, and it is what "the viewport resolution is too low" was.
     */
    // prefetchRadius 0: neighbour pages are speculated at FIT zoom, which is a
    // different number and would drown the assertion.
    const h = boot({ prefetchRadius: 0 }, 1.5)
    h.viewer.loadPage(0)
    h.worker.clear()
    h.viewer.requestVisible(view({ zoom: 2 }))
    const visible = h.worker.tiles().filter((t) => t.page === 0)
    expect(visible.length).toBeGreaterThan(0)
    for (const t of visible) {
      expect(t.zoom, 'tiles must be rasterised at zoom x dpr').toBe(3)
    }
  })

  it('blits on the device pixel grid', () => {
    // The raster is composited under an identity transform, so its coordinates
    // ARE device pixels and a whole number is a whole device pixel.
    const h = boot({}, 1.5)
    h.viewer.loadPage(0)
    const v = view({ ox: 137.4, oy: 88.62 })
    h.viewer.requestVisible(v)
    fulfilTiles(h)
    h.raster.drawn.length = 0
    h.viewer.paint(v)

    expect(h.raster.drawn.length).toBeGreaterThan(0)
    for (const [x, y] of h.raster.drawn) {
      expect(Number.isInteger(x), `x=${x} is not a whole device pixel`).toBe(true)
      expect(Number.isInteger(y), `y=${y} is not a whole device pixel`).toBe(true)
    }
  })

  it('places every tile on one lattice, so neighbours cannot gap or overlap', () => {
    const h = boot()
    h.viewer.loadPage(0)
    const v = view({ ox: 137.4, oy: 88.62 })
    h.viewer.requestVisible(v)
    fulfilTiles(h)
    h.raster.drawn.length = 0
    h.viewer.paint(v)

    // Rounding each tile independently would pass the integer test above and
    // still leave 1px seams, because neighbours would round in opposite
    // directions. Sharing one residue proves the offset was rounded ONCE.
    const xs = h.raster.drawn.map(([x]) => ((x % 256) + 256) % 256)
    const ys = h.raster.drawn.map(([, y]) => ((y % 256) + 256) % 256)
    expect(new Set(xs).size, `column origins are not on one lattice: ${[...new Set(xs)]}`).toBe(1)
    expect(new Set(ys).size, `row origins are not on one lattice: ${[...new Set(ys)]}`).toBe(1)
  })

  it('paints identically whether given a fractional or a pre-rounded offset', () => {
    // The raster and the overlay must snap by the SAME amount, or every markup
    // sits up to half a pixel off the geometry it annotates.
    const h = boot()
    h.viewer.loadPage(0)
    const v = view({ ox: 137.4, oy: 88.62 })
    h.viewer.requestVisible(v)
    fulfilTiles(h)

    h.raster.drawn.length = 0
    h.viewer.paint(v)
    const fromFractional = [...h.raster.drawn]

    h.raster.drawn.length = 0
    h.viewer.paint(view({ ox: 137, oy: 89 }))
    expect(h.raster.drawn).toEqual(fromFractional)
    expect(fromFractional.length).toBeGreaterThan(0)
  })

  it('never blits a tile rasterised at a different zoom', () => {
    // Zoom is part of the tile key, so a cached tile is only ever drawn 1:1.
    // That is what makes disabling smoothing correct rather than merely fast.
    const h = boot()
    h.viewer.loadPage(0)
    h.viewer.requestVisible(view({ zoom: 0.5 }))
    fulfilTiles(h)
    h.raster.drawn.length = 0
    // Nothing is cached at 0.75, and the 0.5 tiles must not stand in for it.
    expect(h.viewer.paint(view({ zoom: 0.75 })).tilesBlitted).toBe(0)
    expect(h.raster.drawn).toEqual([])
  })
})

describe('Viewer — zoom never blanks the page', () => {
  /*
   * Zoom is part of the tile key, so the moment the zoom changes every lookup
   * misses. Before this the page dropped to bare background until the worker
   * caught up, which reads as the viewer breaking rather than working — and it
   * is the one thing Chrome's PDF view never does.
   */
  const zoomed = (h: ReturnType<typeof boot>, from: number, to: number) => {
    h.viewer.loadPage(0)
    h.viewer.requestVisible(view({ zoom: from }))
    fulfilTiles(h)
    h.viewer.paint(view({ zoom: from }))
    h.raster.drawn.length = 0
    return h.viewer.paint(view({ zoom: to }))
  }

  it('keeps showing the previous raster, scaled, while the new one renders', () => {
    const h = boot()
    const stats = zoomed(h, 0.5, 0.75)
    expect(stats.tilesBlitted, 'nothing is cached at the new zoom yet').toBe(0)
    expect(stats.tilesStale, 'so the previous zoom must stand in').toBeGreaterThan(0)
    expect(h.raster.drawn.length).toBeGreaterThan(0)
  })

  it('scales the placeholder by the zoom ratio', () => {
    const h = boot()
    h.viewer.loadPage(0)
    h.viewer.requestVisible(view({ zoom: 0.5, ox: 0, oy: 0 }))
    fulfilTiles(h)
    h.viewer.paint(view({ zoom: 0.5, ox: 0, oy: 0 }))
    h.raster.sized.length = 0
    h.viewer.paint(view({ zoom: 1, ox: 0, oy: 0 }))

    // At 0.5 the page fits one bitmap of 1728x1296; shown at zoom 1 it must be
    // drawn at exactly double, which is what makes the placeholder line up
    // with the sharp tiles that replace it.
    expect(h.raster.sized.length).toBeGreaterThan(0)
    const [, , w, hh] = h.raster.sized[0]!
    expect(w).toBe(1728 * 2)
    expect(hh).toBe(1728 * 2)
  })

  it('drops the placeholder when the page changes, not just the zoom', () => {
    // Another page's raster is a different drawing, not a stale version of
    // this one. Showing it would be a lie about what is on screen.
    const h = boot()
    h.viewer.loadPage(0)
    h.viewer.requestVisible(view({ zoom: 0.5 }))
    fulfilTiles(h)
    h.viewer.paint(view({ zoom: 0.5 }))
    h.viewer.loadPage(1)
    h.raster.drawn.length = 0
    const stats = h.viewer.paint(view({ zoom: 0.75 }))
    expect(stats.tilesStale).toBe(0)
    expect(h.raster.drawn).toEqual([])
  })

  it('never mixes placeholder and fresh raster in one frame', () => {
    /*
     * THE invariant. Drawing each fresh tile as it arrived meant a frame could
     * be half blurred placeholder and half sharp raster, with the boundary
     * sitting exactly on a tile edge — so the grid became visible precisely
     * while the user was watching it. Chrome holds the scaled snapshot and
     * swaps the new raster in whole.
     */
    const h = boot()
    h.viewer.loadPage(0)
    h.viewer.requestVisible(view({ zoom: 2 }))
    fulfilTiles(h)
    h.viewer.paint(view({ zoom: 2 }))

    // Answer exactly one tile of the new zoom, then paint.
    h.worker.clear()
    h.viewer.requestVisible(view({ zoom: 3 }))
    const first = h.worker.tiles()[0]!
    h.worker.reply({
      type: 'tile', key: first.key, page: first.page, tx: first.tx, ty: first.ty,
      zoom: first.zoom, bmp: bmp(first.key, first.tile, first.tile), ms: 1,
    })

    const partial = h.viewer.paint(view({ zoom: 3 }))
    expect(partial.tilesBlitted, 'a partial set must not be drawn').toBe(0)
    expect(partial.tilesStale, 'the placeholder carries the frame instead').toBeGreaterThan(0)
    expect(
      partial.tilesStale > 0 && partial.tilesBlitted > 0,
      'this frame mixes stale and fresh raster',
    ).toBe(false)
  })

  it('swaps the whole new zoom in at once, when it is complete', () => {
    const h = boot()
    h.viewer.loadPage(0)
    h.viewer.requestVisible(view({ zoom: 2 }))
    fulfilTiles(h)
    h.viewer.paint(view({ zoom: 2 }))

    h.viewer.requestVisible(view({ zoom: 3 }))
    fulfilTiles(h)
    const done = h.viewer.paint(view({ zoom: 3 }))
    expect(done.tilesBlitted).toBeGreaterThan(0)
    expect(done.tilesStale, 'the placeholder is gone in the same frame').toBe(0)
  })

  it('still fills in progressively on a cold page, where there is no placeholder', () => {
    // Nothing to hold, so something beats nothing and there is no seam to
    // reveal against — a blank sheet filling in is how every viewer loads.
    const h = boot()
    h.viewer.loadPage(0)
    h.viewer.requestVisible(view({ zoom: 3 }))
    const first = h.worker.tiles().filter((t) => t.page === 0)[0]!
    h.worker.reply({
      type: 'tile', key: first.key, page: first.page, tx: first.tx, ty: first.ty,
      zoom: first.zoom, bmp: bmp(first.key, first.tile, first.tile), ms: 1,
    })
    const cold = h.viewer.paint(view({ zoom: 3 }))
    expect(cold.tilesStale).toBe(0)
    expect(cold.tilesBlitted, 'a cold page still shows what it has').toBe(1)
  })
})

describe('Viewer — one bitmap when the page fits', () => {
  /*
   * A tile grid only earns its keep once the page is too big to raster in one
   * go. At fit zoom an E-size sheet is about 1500x1150 device pixels; cutting
   * that into sixteen 512px tiles buys nothing and costs sixteen round-trips,
   * sixteen chances to watch a tile pop in late, and fifteen interior edges
   * for a seam to show on. That is what "the tiling is still very evident"
   * was.
   */
  it('asks for exactly one tile covering the whole page at fit zoom', () => {
    const h = boot({ prefetchRadius: 0 })
    h.viewer.loadPage(0)
    h.worker.clear()
    // 3456 x 2592 at 0.4 is 1383 x 1037 — well inside the budget.
    h.viewer.requestVisible(view({ zoom: 0.4 }))
    const tiles = h.worker.tiles().filter((t) => t.page === 0)
    expect(tiles).toHaveLength(1)
    expect(tiles[0]!.tx).toBe(0)
    expect(tiles[0]!.ty).toBe(0)
    expect(tiles[0]!.tile, 'the tile must cover the long side').toBe(1383)
  })

  it('falls back to a grid once the page is too large for one bitmap', () => {
    const h = boot({ prefetchRadius: 0 })
    h.viewer.loadPage(0)
    h.worker.clear()
    // At zoom 2 the page is 6912 x 5184 — past both the side and area limits.
    h.viewer.requestVisible(view({ zoom: 2 }))
    const tiles = h.worker.tiles().filter((t) => t.page === 0)
    expect(tiles.length).toBeGreaterThan(1)
    for (const t of tiles) expect(t.tile).toBe(512)
  })

  it('never asks for a bitmap past the texture limit', () => {
    const h = boot({ prefetchRadius: 0 })
    for (const zoom of [0.1, 0.5, 0.9, 0.95, 1, 1.5, 2, 4]) {
      h.viewer.loadPage(0)
      h.worker.clear()
      h.viewer.requestVisible(view({ zoom }))
      for (const t of h.worker.tiles()) {
        expect(t.tile, `zoom ${zoom} asked for a ${t.tile}px bitmap`).toBeLessThanOrEqual(4096)
      }
    }
  })
})

describe('Viewer — an unrendered page is paper, not a hole', () => {
  /*
   * A tile that has not arrived used to leave the window background showing
   * through. On true-black chrome that is a black rectangle appearing and
   * vanishing inside a white drawing — far more distracting than the missing
   * detail, and the single most un-Chrome-like thing about the viewer.
   */
  it('paints the page rect in paper before any tile', () => {
    const h = boot()
    h.viewer.loadPage(0)
    const v = view({ zoom: 0.4, ox: 0, oy: 0 })
    h.raster.fills.length = 0
    h.viewer.paint(v) // nothing cached: the worst case

    const paper = h.raster.fills.find((f) => f.style.toUpperCase() === '#F2F0EB')
    expect(paper, 'no paper was painted').toBeDefined()
    expect(paper!.w).toBeCloseTo(3456 * 0.4, 0)
    expect(paper!.h).toBeCloseTo(2592 * 0.4, 0)
  })

  it('puts the paper where the page is, not where the viewport is', () => {
    const h = boot()
    h.viewer.loadPage(0)
    h.raster.fills.length = 0
    h.viewer.paint(view({ zoom: 0.4, ox: 120, oy: 60 }))
    const paper = h.raster.fills.find((f) => f.style.toUpperCase() === '#F2F0EB')
    // Scrolled right and down, so the sheet's origin moves up and left.
    expect(paper!.x).toBe(-120)
    expect(paper!.y).toBe(-60)
  })

  it('paints paper under the placeholder too, so zooming never flashes black', () => {
    const h = boot()
    h.viewer.loadPage(0)
    h.viewer.requestVisible(view({ zoom: 0.4 }))
    fulfilTiles(h)
    h.viewer.paint(view({ zoom: 0.4 }))
    h.raster.fills.length = 0
    h.viewer.paint(view({ zoom: 2 })) // past the single-bitmap budget
    expect(h.raster.fills.some((f) => f.style.toUpperCase() === '#F2F0EB')).toBe(true)
  })
})

describe('Viewer — prefetch', () => {
  it('speculates on the neighbours at fit zoom, at prefetch priority', () => {
    const h = boot({ prefetchRadius: 1 })
    h.viewer.loadPage(1)
    h.worker.clear()
    const v = view({ zoom: 0.2 })
    h.viewer.requestVisible(v)

    const visible = h.worker.tiles().filter((t) => t.priority === PRIORITY_VISIBLE)
    const spec = h.worker.tiles().filter((t) => t.priority === PRIORITY_PREFETCH)
    expect(visible.every((t) => t.page === 1)).toBe(true)
    expect(new Set(spec.map((t) => t.page))).toEqual(new Set([0, 2]))
    // Neighbours are asked for at THEIR own fit zoom, per their own page box.
    const fit0 = h.viewer.fitZoom(0, v.vw, v.vh)
    const fit2 = h.viewer.fitZoom(2, v.vw, v.vh)
    expect(fit0).not.toBeCloseTo(fit2)
    expect(spec.filter((t) => t.page === 0).every((t) => t.zoom === fit0)).toBe(true)
    expect(spec.filter((t) => t.page === 2).every((t) => t.zoom === fit2)).toBe(true)
  })

  it('asks for every visible tile before any speculative one', () => {
    const h = boot({ prefetchRadius: 1 })
    h.viewer.loadPage(1)
    h.worker.clear()
    h.viewer.requestVisible(view({ zoom: 0.2 }))
    const prios = h.worker.tiles().map((t) => t.priority)
    const firstSpec = prios.indexOf(PRIORITY_PREFETCH)
    expect(firstSpec).toBeGreaterThan(0)
    expect(prios.slice(0, firstSpec).every((p) => p === PRIORITY_VISIBLE)).toBe(true)
    expect(prios.slice(firstSpec).every((p) => p === PRIORITY_PREFETCH)).toBe(true)
  })

  it('speculates forward before backward', () => {
    const h = boot({ prefetchRadius: 2 })
    h.viewer.loadPage(1)
    h.worker.clear()
    h.viewer.requestVisible(view({ zoom: 0.2 }))
    const order: number[] = []
    for (const t of h.worker.tiles()) {
      if (t.priority === PRIORITY_PREFETCH && order[order.length - 1] !== t.page) order.push(t.page)
    }
    expect(order).toEqual([2, 0, 3])
  })

  it('caps speculative tiles per page', () => {
    const h = boot({ prefetchRadius: 1, maxPrefetchTilesPerPage: 2, tileSize: 64 })
    h.viewer.loadPage(1)
    h.worker.clear()
    h.viewer.requestVisible(view({ zoom: 0.2 }))
    const perPage = new Map<number, number>()
    for (const t of h.worker.tiles()) {
      if (t.priority === PRIORITY_PREFETCH) perPage.set(t.page, (perPage.get(t.page) ?? 0) + 1)
    }
    for (const n of perPage.values()) expect(n).toBeLessThanOrEqual(2)
  })

  it('does not re-walk speculation on every pan frame', () => {
    const h = boot({ prefetchRadius: 1 })
    h.viewer.loadPage(1)
    h.viewer.requestVisible(view({ zoom: 0.2 }))
    h.worker.clear()
    for (let i = 0; i < 5; i++) h.viewer.requestVisible(view({ zoom: 0.2, ox: i * 3 }))
    expect(h.worker.tiles().filter((t) => t.priority === PRIORITY_PREFETCH)).toEqual([])
  })

  it('cancels speculation for pages that are no longer neighbours', () => {
    const h = boot({ prefetchRadius: 1 })
    h.viewer.loadPage(0)
    h.viewer.requestVisible(view({ zoom: 0.2 }))
    const spec0 = h.worker.tiles().filter((t) => t.priority === PRIORITY_PREFETCH).map((t) => t.key)
    expect(spec0.length).toBeGreaterThan(0)
    h.worker.clear()

    h.viewer.loadPage(3) // page 1 is now two away
    const cancelled = h.worker.cancels()
    expect(spec0.every((k) => cancelled.includes(k))).toBe(true)
  })

  it('promotes a speculative tile instead of queueing it twice', () => {
    const h = boot({ prefetchRadius: 1 })
    h.viewer.loadPage(0)
    const v = view({ zoom: 0.2 })
    h.viewer.requestVisible(v)
    const fit1 = h.viewer.fitZoom(1, v.vw, v.vh)
    h.worker.clear()

    // Page forward and land on exactly the zoom we speculated at.
    h.viewer.loadPage(1)
    h.viewer.requestVisible(view({ zoom: fit1 }))
    const forPage1 = h.worker.tiles().filter((t) => t.page === 1)
    const keys = forPage1.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length) // no duplicate keys
    expect(forPage1.every((t) => t.priority === PRIORITY_VISIBLE)).toBe(true)
  })

  it('can be turned off', () => {
    const h = boot({ prefetchRadius: 0 })
    h.viewer.loadPage(1)
    h.worker.clear()
    h.viewer.requestVisible(view({ zoom: 0.2 }))
    expect(h.worker.tiles().some((t) => t.priority === PRIORITY_PREFETCH)).toBe(false)
  })
})

describe('Viewer — thumbnails', () => {
  it('requests once, at thumbnail priority, and caches the result', () => {
    const got: number[] = []
    const h = boot({ onThumbnail: (i) => got.push(i) })
    expect(h.viewer.requestThumbnail(2)).toBeUndefined()
    expect(h.viewer.requestThumbnail(2)).toBeUndefined() // still in flight, not re-sent

    const reqs = h.worker.sent.filter((m) => m.type === 'thumb')
    expect(reqs).toHaveLength(1)
    expect(reqs[0]).toMatchObject({ page: 2, width: 120, priority: PRIORITY_THUMBNAIL })

    h.worker.reply({ type: 'thumb', key: thumbKey(2, 120), page: 2, width: 120, height: 155, bmp: bmp('t2'), ms: 5 })
    expect(got).toEqual([2])
    expect(h.viewer.hasThumbnail(2)).toBe(true)
    expect(h.viewer.requestThumbnail(2)).toBeDefined()
    expect(h.worker.sent.filter((m) => m.type === 'thumb')).toHaveLength(1)
  })

  it('never evicts or competes with the tile cache', () => {
    const h = boot({ prefetchRadius: 0, maxTiles: 4, maxThumbnails: 2 })
    h.viewer.loadPage(0)
    h.viewer.requestVisible(view({ zoom: 0.2 }))
    fulfilTiles(h)
    const tilesBefore = h.viewer.stats().tiles
    expect(tilesBefore).toBeGreaterThan(0)

    // Scroll a strip well past the thumbnail bound.
    for (let i = 0; i < 4; i++) {
      const page = i % SIZES.length
      h.viewer.requestThumbnail(page)
      h.worker.reply({
        type: 'thumb',
        key: thumbKey(page, 120),
        page,
        width: 120,
        height: 90,
        bmp: bmp(`th${i}`),
        ms: 1,
      })
    }
    const s = h.viewer.stats()
    expect(s.thumbnails).toBeLessThanOrEqual(2)
    expect(s.tiles).toBe(tilesBefore) // untouched
  })

  it('does not confuse thumbnail keys with tile keys', () => {
    const h = boot()
    h.viewer.requestThumbnail(1)
    const req = h.worker.sent.find((m) => m.type === 'thumb') as Extract<WorkerRequest, { type: 'thumb' }>
    expect(req.key).toBe(thumbKey(1, 120))
    expect(req.key).not.toBe(tileKey(1, 120, 0, 0))
  })

  it('cancels thumbnail work for pages that scrolled out of the strip', () => {
    const h = boot()
    h.viewer.requestThumbnail(0)
    h.viewer.requestThumbnail(1)
    h.viewer.requestThumbnail(2)
    h.worker.clear()
    expect(h.viewer.cancelThumbnails([1])).toBe(2)
    expect(h.worker.cancels().sort()).toEqual([thumbKey(0, 120), thumbKey(2, 120)].sort())
  })
})

describe('Viewer — lifecycle', () => {
  it('forwards the worker page-handle bound at construction', () => {
    const h = makeViewer({ maxOpenPages: 5, quietMs: 90 })
    expect(h.worker.sent[0]).toEqual({ type: 'config', maxPages: 5, quietMs: 90 })
  })

  it('surfaces the worker page-handle counters for a leak check', async () => {
    const h = boot()
    const p = h.viewer.workerStats()
    h.worker.reply({ type: 'stats', opened: 7, closed: 3, open: 4, pages: [1, 2, 3, 4], queued: 0 })
    const s = await p
    expect(s.opened - s.closed).toBe(s.open)
  })

  it('closes every cached bitmap on destroy', () => {
    closed.length = 0
    const h = boot({ prefetchRadius: 0 })
    h.viewer.loadPage(0)
    h.viewer.requestVisible(view({ zoom: 0.2 }))
    fulfilTiles(h)
    h.viewer.requestThumbnail(0)
    h.worker.reply({ type: 'thumb', key: thumbKey(0, 120), page: 0, width: 120, height: 90, bmp: bmp('th'), ms: 1 })

    const n = h.viewer.stats().tiles + h.viewer.stats().thumbnails
    h.viewer.destroy()
    expect(closed).toHaveLength(n)
    expect(new Set(closed).size).toBe(n) // nothing closed twice
    expect(h.worker.terminated).toBe(true)
  })

  it('still owns no domain state', () => {
    const h = boot()
    h.viewer.setOverlay(emptyOverlay())
    expect(h.viewer.paint(view()).overlay).toEqual({ drawn: 0, culled: 0 })
  })
})
