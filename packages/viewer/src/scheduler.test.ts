import { describe, expect, it } from 'vitest'
import { Scheduler } from './scheduler.js'
import type { Job } from './jobQueue.js'
import { PRIORITY_PREFETCH, PRIORITY_THUMBNAIL, PRIORITY_VISIBLE, tileKey } from './types.js'

const tile = (page: number, tx: number, priority: number): Job => ({
  kind: 'tile',
  key: tileKey(page, 1, tx, 0),
  page,
  priority,
  tx,
  ty: 0,
  tile: 512,
  zoom: 1,
})

/**
 * A harness with a hand-cranked clock and hand-cranked timers, so the quiet
 * gate can be tested without waiting on real time.
 */
function harness(quietMs = 60) {
  let clock = 1000
  const ran: string[] = []
  const timers: Array<{ at: number; fn: () => void }> = []
  /** Resolvers for jobs the test wants to hold open mid-render. */
  const holds = new Map<string, () => void>()
  let hold: Set<string> = new Set()

  const sched = new Scheduler({
    quietMs,
    now: () => clock,
    setTimer: (fn, ms) => void timers.push({ at: clock + ms, fn }),
    yieldTo: () => Promise.resolve(),
    run: (job) => {
      ran.push(job.key)
      if (!hold.has(job.key)) return Promise.resolve()
      return new Promise<void>((resolve) => holds.set(job.key, resolve))
    },
  })

  return {
    sched,
    ran,
    /** Make `run` block for these job keys until `release` is called. */
    holdKeys(...keys: string[]) {
      hold = new Set(keys)
    },
    async release(key: string) {
      holds.get(key)?.()
      holds.delete(key)
      await flush()
    },
    /**
     * Advance the fake clock and fire any timers that came due, repeatedly —
     * a woken drain that re-gates schedules another timer, and pending ones
     * that are not yet due must survive.
     */
    async advance(ms: number) {
      // Let any in-flight drain settle at the OLD time first. A drain suspended
      // at its yield point would otherwise resume seeing the new clock and
      // treat a job it ran long ago as having just finished.
      await flush()
      clock += ms
      for (let pass = 0; pass < 10; pass++) {
        const due = timers.filter((t) => t.at <= clock)
        if (due.length === 0) break
        for (const t of due) timers.splice(timers.indexOf(t), 1)
        for (const t of due) t.fn()
        await flush()
      }
    },
  }
}

/** Let queued microtasks settle. */
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('Scheduler', () => {
  it('runs a visible tile before speculation that was queued first', async () => {
    const h = harness(60)
    h.sched.enqueue(tile(6, 0, PRIORITY_PREFETCH))
    h.sched.enqueue(tile(6, 1, PRIORITY_PREFETCH))
    h.sched.enqueue(tile(5, 0, PRIORITY_VISIBLE))
    await flush()
    expect(h.ran).toEqual([tileKey(5, 1, 0, 0)])
    await h.advance(70)
    expect(h.ran).toEqual([tileKey(5, 1, 0, 0), tileKey(6, 1, 0, 0), tileKey(6, 1, 1, 0)])
  })

  it('holds speculation at boot too, before any visible tile is asked for', async () => {
    const h = harness(60)
    h.sched.enqueue({ kind: 'thumb', key: 'th0', page: 0, priority: PRIORITY_THUMBNAIL, width: 120 })
    await flush()
    expect(h.ran).toEqual([])
    h.sched.enqueue(tile(0, 0, PRIORITY_VISIBLE))
    await flush()
    expect(h.ran).toEqual([tileKey(0, 1, 0, 0)])
  })

  it('pre-empts at the job boundary — a tile requested mid-render jumps the queue', async () => {
    const h = harness(0)
    const running = tileKey(6, 1, 0, 0)
    h.holdKeys(running)
    h.sched.enqueue(tile(6, 0, PRIORITY_PREFETCH)) // starts, and blocks
    h.sched.enqueue(tile(6, 1, PRIORITY_PREFETCH))
    await flush()
    expect(h.ran).toEqual([running])

    // The user pans while that prefetch is still in PDFium.
    h.sched.enqueue(tile(5, 0, PRIORITY_VISIBLE))
    await flush()
    expect(h.ran).toEqual([running]) // cannot interrupt a render in flight

    await h.release(running)
    expect(h.ran).toEqual([running, tileKey(5, 1, 0, 0), tileKey(6, 1, 1, 0)])
  })

  it('will not START speculation while visible work is recent', async () => {
    const h = harness(60)
    h.sched.enqueue(tile(5, 0, PRIORITY_VISIBLE))
    await flush()
    expect(h.ran).toEqual([tileKey(5, 1, 0, 0)])

    h.sched.enqueue(tile(6, 0, PRIORITY_PREFETCH))
    await flush()
    expect(h.ran).toHaveLength(1) // still inside the quiet window

    await h.advance(30)
    expect(h.ran).toHaveLength(1)

    await h.advance(40) // now past quietMs since the last visible tile
    expect(h.ran).toEqual([tileKey(5, 1, 0, 0), tileKey(6, 1, 0, 0)])
  })

  it('keeps deferring speculation for as long as the user keeps panning', async () => {
    const h = harness(60)
    h.sched.enqueue(tile(6, 0, PRIORITY_PREFETCH))
    for (let i = 0; i < 5; i++) {
      h.sched.enqueue(tile(5, i, PRIORITY_VISIBLE))
      await h.advance(20) // 20ms apart: never a 60ms gap
    }
    expect(h.ran).toEqual([0, 1, 2, 3, 4].map((i) => tileKey(5, 1, i, 0)))

    await h.advance(70) // user stops
    expect(h.ran[h.ran.length - 1]).toBe(tileKey(6, 1, 0, 0))
  })

  it('gates thumbnails the same way, but runs them before prefetch', async () => {
    const h = harness(60)
    h.sched.enqueue(tile(6, 0, PRIORITY_PREFETCH))
    h.sched.enqueue({ kind: 'thumb', key: 'th9', page: 9, priority: PRIORITY_THUMBNAIL, width: 120 })
    h.sched.enqueue(tile(5, 0, PRIORITY_VISIBLE))
    await flush()
    expect(h.ran).toEqual([tileKey(5, 1, 0, 0)])
    await h.advance(70)
    expect(h.ran).toEqual([tileKey(5, 1, 0, 0), 'th9', tileKey(6, 1, 0, 0)])
  })

  it('never runs a cancelled job', async () => {
    const h = harness(60)
    const doomed = tile(6, 0, PRIORITY_PREFETCH)
    h.sched.enqueue(doomed)
    h.sched.enqueue(tile(7, 0, PRIORITY_PREFETCH))
    expect(h.sched.cancel([doomed.key])).toBe(1)
    await h.advance(70)
    expect(h.ran).toEqual([tileKey(7, 1, 0, 0)])
  })

  it('drains everything eventually and does not re-enter', async () => {
    const h = harness(0)
    for (let i = 0; i < 6; i++) h.sched.enqueue(tile(5, i, PRIORITY_VISIBLE))
    await flush()
    expect(h.ran).toHaveLength(6)
    expect(new Set(h.ran).size).toBe(6)
    expect(h.sched.running).toBe(false)
    expect(h.sched.queue.size).toBe(0)
  })
})
