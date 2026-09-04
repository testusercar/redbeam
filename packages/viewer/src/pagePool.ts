/**
 * Bounded pool of open PDFium page handles, with LRU eviction.
 *
 * A page handle is a native resource: PDFium parses the page's content stream
 * on FPDF_LoadPage and holds it until FPDF_ClosePage. Keeping one handle open
 * meant every page change re-parsed; keeping all of them open on a 200-sheet
 * set is unbounded native memory. So: keep a few, close what falls out.
 *
 * This class is deliberately free of PDFium — `open`/`close` are injected — so
 * the eviction bookkeeping, which is where the leak would be, is testable in
 * plain Node. The Qt build's equivalent was a global static map keyed by raw
 * page pointers, which is exactly how it got a use-after-free when the tile
 * manager reallocated. Nothing outside this class ever stores a handle; jobs
 * carry a page *index* and resolve it to a handle at the moment they run.
 */
export interface PagePoolOptions<H> {
  /** Maximum handles kept open at once. Must be >= 1. */
  max: number
  open: (index: number) => H
  close: (handle: H) => void
  /** Page box, read once per open. */
  measure: (handle: H) => { width: number; height: number }
}

export interface PageEntry<H> {
  handle: H
  width: number
  height: number
}

export class PagePool<H> {
  private readonly entries = new Map<number, PageEntry<H>>()
  private readonly opts: PagePoolOptions<H>
  private _opened = 0
  private _closed = 0

  constructor(opts: PagePoolOptions<H>) {
    if (opts.max < 1) throw new Error('PagePool max must be >= 1')
    this.opts = opts
  }

  /**
   * Get the handle for `index`, opening it if necessary and evicting the least
   * recently used page if that pushes us over the bound.
   *
   * Only one job runs at a time in the worker, and a job acquires its page at
   * the start and does not yield until it is done with it, so eviction can
   * never close a handle that is mid-render. The entry just returned is the
   * most-recently-used, so it is never the eviction candidate.
   */
  acquire(index: number): PageEntry<H> {
    const hit = this.entries.get(index)
    if (hit) {
      // Re-insert to move to the MRU end of the Map's insertion order.
      this.entries.delete(index)
      this.entries.set(index, hit)
      return hit
    }
    const handle = this.opts.open(index)
    const { width, height } = this.opts.measure(handle)
    const entry: PageEntry<H> = { handle, width, height }
    this.entries.set(index, entry)
    this._opened++
    this.trim()
    return entry
  }

  private trim() {
    while (this.entries.size > this.opts.max) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.drop(oldest.value)
    }
  }

  /** Close and forget one page. Safe to call for a page that is not open. */
  drop(index: number): boolean {
    const entry = this.entries.get(index)
    if (!entry) return false
    this.entries.delete(index)
    this.opts.close(entry.handle)
    this._closed++
    return true
  }

  closeAll(): number {
    let n = 0
    for (const index of [...this.entries.keys()]) if (this.drop(index)) n++
    return n
  }

  has(index: number): boolean {
    return this.entries.has(index)
  }

  /** Open pages, least-recently-used first. */
  get pages(): number[] {
    return [...this.entries.keys()]
  }

  get openCount(): number {
    return this.entries.size
  }

  get opened(): number {
    return this._opened
  }

  get closed(): number {
    return this._closed
  }

  /**
   * Handles that were opened, not closed, and are no longer tracked — i.e.
   * leaked. Must always be 0; asserted in the tests and reported by the
   * worker's `stats` message so it can be checked against a live PDFium too.
   */
  get leaked(): number {
    return this._opened - this._closed - this.entries.size
  }
}
