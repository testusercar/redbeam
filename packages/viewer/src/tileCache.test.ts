import { describe, expect, it } from 'vitest'
import { TileCache } from './tileCache.js'
import { parseTileKey, thumbKey, tileKey } from './types.js'

/** ImageBitmap stand-in: records whether close() was called, and how often. */
const bmp = (id: string) => ({ id, closed: 0 })
type Bmp = ReturnType<typeof bmp>

function cacheOf(max: number) {
  const disposed: string[] = []
  const c = new TileCache<Bmp>({
    max,
    dispose: (b) => {
      b.closed++
      disposed.push(b.id)
    },
  })
  return { c, disposed }
}

describe('tileKey', () => {
  it('separates pages that would otherwise collide', () => {
    expect(tileKey(0, 1, 2, 3)).not.toBe(tileKey(1, 1, 2, 3))
  })

  it('is stable and round-trips', () => {
    expect(tileKey(7, 0.25, 3, 4)).toBe('p7/0.250/3/4')
    expect(parseTileKey(tileKey(7, 0.25, 3, 4))).toEqual({ page: 7, zoom: 0.25, tx: 3, ty: 4 })
  })

  it('quantizes zoom the same way it always did', () => {
    expect(tileKey(0, 1.00001, 0, 0)).toBe(tileKey(0, 1.00002, 0, 0))
    expect(tileKey(0, 1.0, 0, 0)).not.toBe(tileKey(0, 1.01, 0, 0))
  })

  it('never collides with a thumbnail key', () => {
    expect(parseTileKey(thumbKey(7, 120))).toBeNull()
    expect(thumbKey(7, 120)).not.toBe(tileKey(7, 120, 0, 0))
  })
})

describe('TileCache', () => {
  it('keeps pages independent — dropping N leaves N+1 alone', () => {
    const { c, disposed } = cacheOf(100)
    for (let tx = 0; tx < 4; tx++) {
      c.set(tileKey(3, 1, tx, 0), 3, bmp(`3-${tx}`))
      c.set(tileKey(4, 1, tx, 0), 4, bmp(`4-${tx}`))
    }
    expect(c.deletePage(3)).toBe(4)
    expect(c.size).toBe(4)
    expect(disposed.sort()).toEqual(['3-0', '3-1', '3-2', '3-3'])
    expect([...c.countByPage()]).toEqual([[4, 4]])
    expect(c.has(tileKey(4, 1, 0, 0))).toBe(true)
  })

  it('evicts least-recently-used once over the bound', () => {
    const { c, disposed } = cacheOf(3)
    c.set('a', 0, bmp('a'))
    c.set('b', 0, bmp('b'))
    c.set('c', 0, bmp('c'))
    c.get('a') // touch
    c.set('d', 0, bmp('d'))
    expect(disposed).toEqual(['b'])
    expect(c.keys()).toEqual(['c', 'a', 'd'])
  })

  it('protects the active page from speculative neighbour tiles', () => {
    const { c, disposed } = cacheOf(4)
    c.activePage = 5
    // Visible page first, so a plain LRU would evict exactly these.
    c.set(tileKey(5, 1, 0, 0), 5, bmp('v0'))
    c.set(tileKey(5, 1, 1, 0), 5, bmp('v1'))
    // Then a burst of prefetch from both neighbours.
    c.set(tileKey(6, 0.2, 0, 0), 6, bmp('n0'))
    c.set(tileKey(6, 0.2, 1, 0), 6, bmp('n1'))
    c.set(tileKey(4, 0.2, 0, 0), 4, bmp('p0'))
    c.set(tileKey(4, 0.2, 1, 0), 4, bmp('p1'))

    expect(disposed).toEqual(['n0', 'n1'])
    expect(c.has(tileKey(5, 1, 0, 0))).toBe(true)
    expect(c.has(tileKey(5, 1, 1, 0))).toBe(true)
  })

  it('falls back to evicting the active page when nothing else is left', () => {
    const { c, disposed } = cacheOf(2)
    c.activePage = 1
    c.set('a', 1, bmp('a'))
    c.set('b', 1, bmp('b'))
    c.set('c', 1, bmp('c'))
    expect(disposed).toEqual(['a'])
    expect(c.size).toBe(2)
  })

  it('follows the active page as the user pages', () => {
    const { c, disposed } = cacheOf(2)
    c.activePage = 1
    c.set('p1a', 1, bmp('p1a'))
    c.activePage = 2 // paged forward: page 1 is now the evictable one
    c.set('p2a', 2, bmp('p2a'))
    c.set('p2b', 2, bmp('p2b'))
    expect(disposed).toEqual(['p1a'])
  })

  it('disposes exactly once per bitmap and never a live one', () => {
    const { c } = cacheOf(2)
    const a = bmp('a')
    c.set('k', 0, a)
    c.set('k', 0, a) // same value re-set: must NOT close the bitmap in use
    expect(a.closed).toBe(0)
    const b = bmp('b')
    c.set('k', 0, b) // replaced: the old one goes
    expect(a.closed).toBe(1)
    c.clear()
    expect(b.closed).toBe(1)
    expect(a.closed).toBe(1)
  })

  it('retainPages keeps only the window', () => {
    const { c } = cacheOf(100)
    for (const p of [0, 1, 2, 3]) c.set(`k${p}`, p, bmp(`k${p}`))
    expect(c.retainPages([1, 2])).toBe(2)
    expect([...c.countByPage()].map(([p]) => p).sort()).toEqual([1, 2])
  })

  it('honours a lowered bound immediately', () => {
    const { c, disposed } = cacheOf(4)
    for (const k of ['a', 'b', 'c', 'd']) c.set(k, 0, bmp(k))
    c.max = 2
    expect(c.size).toBe(2)
    expect(disposed).toEqual(['a', 'b'])
  })
})
