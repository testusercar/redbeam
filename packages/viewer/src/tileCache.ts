/**
 * Page-aware LRU cache for rasterized tiles.
 *
 * Two properties matter here and neither was true before:
 *
 * 1. Entries are tagged with their page, so dropping page N leaves page N+1
 *    alone. Paging back and forth no longer throws away everything.
 * 2. Eviction protects the active page. Prefetched neighbour tiles share one
 *    `max` bound with the tiles the user is actually looking at, so a plain
 *    global LRU would let speculation evict the visible page. Overflow therefore
 *    takes the oldest *non-active* entry first, and only falls back to the
 *    active page when nothing else is left (which is the honest case: the
 *    active page alone no longer fits).
 *
 * Values are disposed through an injected callback rather than calling
 * `ImageBitmap.close()` directly, which keeps this file DOM-free and testable.
 */
export interface TileCacheOptions<V> {
  max: number
  dispose?: (value: V) => void
}

interface Entry<V> {
  page: number
  value: V
}

export class TileCache<V> {
  private readonly entries = new Map<string, Entry<V>>()
  private readonly dispose: (value: V) => void
  private _max: number
  private _evicted = 0

  /** Page whose tiles are protected from overflow eviction. -1 protects none. */
  activePage = -1

  constructor(opts: TileCacheOptions<V>) {
    if (opts.max < 1) throw new Error('TileCache max must be >= 1')
    this._max = opts.max
    this.dispose = opts.dispose ?? (() => {})
  }

  get max(): number {
    return this._max
  }

  set max(n: number) {
    this._max = Math.max(1, Math.floor(n))
    this.trim()
  }

  /** Look up and mark as most recently used. */
  get(key: string): V | undefined {
    const e = this.entries.get(key)
    if (!e) return undefined
    this.entries.delete(key)
    this.entries.set(key, e)
    return e.value
  }

  /** Look up without touching recency — used by the paint loop's fast path. */
  peek(key: string): V | undefined {
    return this.entries.get(key)?.value
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  set(key: string, page: number, value: V): void {
    const prev = this.entries.get(key)
    if (prev) {
      this.entries.delete(key)
      if (prev.value !== value) this.dispose(prev.value)
    }
    this.entries.set(key, { page, value })
    this.trim()
  }

  delete(key: string): boolean {
    const e = this.entries.get(key)
    if (!e) return false
    this.entries.delete(key)
    this.dispose(e.value)
    return true
  }

  /** Drop every tile belonging to one page. Returns how many went. */
  deletePage(page: number): number {
    let n = 0
    for (const [k, e] of [...this.entries]) {
      if (e.page === page) { this.entries.delete(k); this.dispose(e.value); n++ }
    }
    return n
  }

  /** Drop every tile that is not on one of `keep`. */
  retainPages(keep: Iterable<number>): number {
    const set = new Set(keep)
    let n = 0
    for (const [k, e] of [...this.entries]) {
      if (!set.has(e.page)) { this.entries.delete(k); this.dispose(e.value); n++ }
    }
    return n
  }

  private trim() {
    while (this.entries.size > this._max) {
      const victim = this.pickVictim()
      if (victim === undefined) break
      const e = this.entries.get(victim)!
      this.entries.delete(victim)
      this.dispose(e.value)
      this._evicted++
    }
  }

  /** Oldest non-active-page entry; failing that, the oldest entry at all. */
  private pickVictim(): string | undefined {
    let fallback: string | undefined
    for (const [k, e] of this.entries) {
      if (fallback === undefined) fallback = k
      if (e.page !== this.activePage) return k
    }
    return fallback
  }

  clear(): void {
    for (const e of this.entries.values()) this.dispose(e.value)
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }

  get evictions(): number {
    return this._evicted
  }

  /** How many cached tiles belong to each page. Diagnostic. */
  countByPage(): Map<number, number> {
    const out = new Map<number, number>()
    for (const e of this.entries.values()) out.set(e.page, (out.get(e.page) ?? 0) + 1)
    return out
  }

  keys(): string[] {
    return [...this.entries.keys()]
  }
}
