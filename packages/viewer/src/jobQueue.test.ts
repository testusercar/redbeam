import { describe, expect, it } from 'vitest'
import { JobQueue, type Job } from './jobQueue.js'
import { PRIORITY_PREFETCH, PRIORITY_THUMBNAIL, PRIORITY_VISIBLE, tileKey } from './types.js'

const tile = (page: number, tx: number, priority: number, zoom = 1): Job => ({
  kind: 'tile',
  key: tileKey(page, zoom, tx, 0),
  page,
  priority,
  tx,
  ty: 0,
  tile: 512,
  zoom,
})

/**
 * Not every job kind carries a page — IndexJob is document-level and has none.
 * These cases only ever queue tiles, so narrowing beats widening the union.
 */
const pageOf = (j: Job): number | undefined => ('page' in j ? j.page : undefined)

describe('JobQueue ordering', () => {
  it('runs visible tiles before speculation that was queued first', () => {
    const q = new JobQueue()
    // Prefetch for pages 6 and 4 posted first...
    q.enqueue(tile(6, 0, PRIORITY_PREFETCH))
    q.enqueue(tile(6, 1, PRIORITY_PREFETCH))
    q.enqueue(tile(4, 0, PRIORITY_PREFETCH))
    // ...then the user pans and asks for what is on screen.
    q.enqueue(tile(5, 0, PRIORITY_VISIBLE))
    q.enqueue(tile(5, 1, PRIORITY_VISIBLE))

    expect(q.take()!.key).toBe(tileKey(5, 1, 0, 0))
    expect(q.take()!.key).toBe(tileKey(5, 1, 1, 0))
    expect(pageOf(q.take()!)).toBe(6)
  })

  it('puts thumbnails between visible and prefetch', () => {
    const q = new JobQueue()
    q.enqueue(tile(6, 0, PRIORITY_PREFETCH))
    q.enqueue({ kind: 'thumb', key: 't9', page: 9, priority: PRIORITY_THUMBNAIL, width: 120 })
    q.enqueue(tile(5, 0, PRIORITY_VISIBLE))
    expect(q.order().map((j) => j.priority)).toEqual([PRIORITY_VISIBLE, PRIORITY_THUMBNAIL, PRIORITY_PREFETCH])
  })

  it('is FIFO within a priority, so enqueue order is run order', () => {
    const q = new JobQueue()
    q.enqueue(tile(7, 0, PRIORITY_PREFETCH))
    q.enqueue(tile(3, 0, PRIORITY_PREFETCH))
    q.enqueue(tile(8, 0, PRIORITY_PREFETCH))
    expect(q.order().map(pageOf)).toEqual([7, 3, 8])
  })

  it('promotes a queued prefetch instead of rasterizing it twice', () => {
    const q = new JobQueue()
    const speculative = tile(6, 0, PRIORITY_PREFETCH)
    q.enqueue(speculative)
    q.enqueue(tile(6, 1, PRIORITY_PREFETCH))
    // The user pages to 6 — the same tile is now visible.
    q.enqueue({ ...speculative, priority: PRIORITY_VISIBLE })

    expect(q.size).toBe(2)
    expect(q.priorityOf(speculative.key)).toBe(PRIORITY_VISIBLE)
    expect(q.take()!.key).toBe(speculative.key)
  })

  it('never demotes an already-visible job', () => {
    const q = new JobQueue()
    const t = tile(5, 0, PRIORITY_VISIBLE)
    q.enqueue(t)
    q.enqueue({ ...t, priority: PRIORITY_PREFETCH })
    expect(q.priorityOf(t.key)).toBe(PRIORITY_VISIBLE)
    expect(q.size).toBe(1)
  })

  it('cancels by key and by predicate', () => {
    const q = new JobQueue()
    q.enqueue(tile(1, 0, PRIORITY_PREFETCH))
    q.enqueue(tile(2, 0, PRIORITY_PREFETCH))
    q.enqueue(tile(3, 0, PRIORITY_VISIBLE))
    expect(q.cancel([tileKey(1, 1, 0, 0), 'nope'])).toBe(1)
    expect(q.cancelWhere((j) => j.priority === PRIORITY_PREFETCH)).toBe(1)
    expect(q.order().map(pageOf)).toEqual([3])
  })

  it('peek does not consume', () => {
    const q = new JobQueue()
    q.enqueue(tile(5, 0, PRIORITY_VISIBLE))
    expect(q.peek()!.key).toBe(q.peek()!.key)
    expect(q.size).toBe(1)
    expect(q.take()).toBeDefined()
    expect(q.peek()).toBeUndefined()
    expect(q.take()).toBeUndefined()
  })

  it('a tile at a new zoom is a different job from the same tile at the old one', () => {
    const q = new JobQueue()
    q.enqueue(tile(5, 0, PRIORITY_VISIBLE, 1))
    q.enqueue(tile(5, 0, PRIORITY_VISIBLE, 2))
    expect(q.size).toBe(2)
  })
})
