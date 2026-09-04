import { describe, expect, it } from 'vitest'
import { PagePool } from './pagePool.js'

/**
 * Stand-in for PDFium's page handles. `live` is the set of handles the native
 * side would still consider valid; closing one twice, or letting the pool
 * forget one without closing, both show up here.
 */
function fakeNative() {
  let next = 1000
  const live = new Set<number>()
  const opens: number[] = []
  const closes: number[] = []
  const doubleClosed: number[] = []
  const sizes = new Map<number, { width: number; height: number }>()
  const handleToIndex = new Map<number, number>()
  return {
    live,
    opens,
    closes,
    doubleClosed,
    setSize(index: number, width: number, height: number) {
      sizes.set(index, { width, height })
    },
    open(index: number) {
      const h = next++
      live.add(h)
      handleToIndex.set(h, index)
      opens.push(index)
      return h
    },
    close(h: number) {
      if (!live.has(h)) doubleClosed.push(h)
      live.delete(h)
      closes.push(handleToIndex.get(h)!)
    },
    measure(h: number) {
      const index = handleToIndex.get(h)!
      return sizes.get(index) ?? { width: 612 + index, height: 792 + index }
    },
  }
}

const poolOf = (max: number) => {
  const nat = fakeNative()
  const pool = new PagePool<number>({ max, open: nat.open, close: nat.close, measure: nat.measure })
  return { nat, pool }
}

describe('PagePool', () => {
  it('reports per-page boxes, not one document-level size', () => {
    const { nat, pool } = poolOf(3)
    nat.setSize(0, 3456, 2592) // E-size plan
    nat.setSize(1, 612, 792) // details sheet
    expect(pool.acquire(0)).toMatchObject({ width: 3456, height: 2592 })
    expect(pool.acquire(1)).toMatchObject({ width: 612, height: 792 })
  })

  it('opens each page once while it stays resident', () => {
    const { nat, pool } = poolOf(3)
    pool.acquire(2)
    pool.acquire(2)
    pool.acquire(2)
    expect(nat.opens).toEqual([2])
    expect(pool.openCount).toBe(1)
  })

  it('holds the bound and closes exactly what it evicts', () => {
    const { nat, pool } = poolOf(3)
    for (const i of [0, 1, 2, 3, 4]) pool.acquire(i)
    expect(pool.openCount).toBe(3)
    expect(pool.pages).toEqual([2, 3, 4])
    expect(nat.closes).toEqual([0, 1]) // least recently used went first
    expect(nat.live.size).toBe(3)
    expect(nat.doubleClosed).toEqual([])
  })

  it('evicts least-recently-USED, not least-recently-opened', () => {
    const { nat, pool } = poolOf(3)
    pool.acquire(0)
    pool.acquire(1)
    pool.acquire(2)
    pool.acquire(0) // touch 0 — it must now outlive 1
    pool.acquire(3)
    expect(pool.pages).toEqual([2, 0, 3])
    expect(nat.closes).toEqual([1])
  })

  it('re-opens an evicted page rather than serving a stale handle', () => {
    const { nat, pool } = poolOf(2)
    const first = pool.acquire(0).handle
    pool.acquire(1)
    pool.acquire(2) // evicts 0
    expect(nat.live.has(first)).toBe(false)
    const again = pool.acquire(0).handle
    expect(again).not.toBe(first)
    expect(nat.live.has(again)).toBe(true)
  })

  it('paging back and forth within the bound never re-opens', () => {
    const { nat, pool } = poolOf(4)
    for (const i of [5, 6, 5, 6, 7, 6, 5]) pool.acquire(i)
    expect(nat.opens).toEqual([5, 6, 7])
    expect(nat.closes).toEqual([])
  })

  it('leaks nothing across a long random walk', () => {
    const { nat, pool } = poolOf(4)
    let seed = 42
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let i = 0; i < 2000; i++) pool.acquire(Math.floor(rnd() * 40))
    expect(pool.openCount).toBe(4)
    expect(pool.leaked).toBe(0)
    expect(pool.opened - pool.closed).toBe(pool.openCount)
    expect(nat.live.size).toBe(pool.openCount)
    expect(nat.doubleClosed).toEqual([])

    pool.closeAll()
    expect(pool.openCount).toBe(0)
    expect(nat.live.size).toBe(0)
    expect(pool.opened).toBe(pool.closed)
    expect(pool.leaked).toBe(0)
    expect(nat.doubleClosed).toEqual([])
  })

  it('closeAll is idempotent and drop() of an absent page is a no-op', () => {
    const { nat, pool } = poolOf(2)
    pool.acquire(0)
    expect(pool.closeAll()).toBe(1)
    expect(pool.closeAll()).toBe(0)
    expect(pool.drop(99)).toBe(false)
    expect(nat.doubleClosed).toEqual([])
    expect(pool.leaked).toBe(0)
  })

  it('refuses a nonsensical bound', () => {
    expect(() => poolOf(0)).toThrow()
  })
})
