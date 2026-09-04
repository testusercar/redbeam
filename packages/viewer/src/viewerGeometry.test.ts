import { describe, expect, it } from 'vitest'
import { Viewer } from './viewer.js'
import {
  PRIORITY_GEOMETRY, PRIORITY_TEXT, PRIORITY_VISIBLE, geometryKey,
  type PageInfo, type WorkerRequest, type WorkerResponse,
} from './types.js'
import type { NormClip } from './geometry.js'
import type { PageBox } from './text.js'

/** Own harness, matching viewerText.test.ts, so the geometry protocol is pinned separately. */
class FakeWorker {
  sent: WorkerRequest[] = []
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null
  postMessage(msg: WorkerRequest) { this.sent.push(msg) }
  terminate() { /* no-op */ }
  reply(msg: WorkerResponse) { this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>) }
  geo(): Array<Extract<WorkerRequest, { type: 'geometry' }>> {
    return this.sent.filter((m): m is Extract<WorkerRequest, { type: 'geometry' }> => m.type === 'geometry')
  }
  cancels(): string[] {
    return this.sent.flatMap((m) => (m.type === 'cancel' ? m.keys : []))
  }
}

function stubCanvas() {
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true })
  return { getContext: () => ctx } as unknown as HTMLCanvasElement
}

const SIZES: PageInfo[] = [
  { width: 3456, height: 2592 },
  { width: 3456, height: 2592 },
  { width: 612, height: 792 },
]
const BOX: PageBox = { left: -1728, bottom: -1296.12, right: 1728, top: 1296.12 }
const FULL: NormClip = { x0: 0, y0: 0, x1: 1, y1: 1 }

function mount() {
  const w = new FakeWorker()
  const v = new Viewer(stubCanvas(), stubCanvas(), w as unknown as Worker, { prefetchRadius: 0 })
  w.reply({ type: 'booted', pageCount: SIZES.length, sizes: SIZES })
  return { v, w }
}

const reply = (page: number, clip: NormClip = FULL, over: Partial<Extract<WorkerResponse, { type: 'geometry' }>> = {}): WorkerResponse => ({
  type: 'geometry',
  key: geometryKey(page, clip === FULL ? undefined : clip),
  page,
  segments: new Float32Array([0, 0, 0.5, 0.5]),
  segmentCount: 1,
  box: BOX,
  clip,
  pageObjects: 12,
  pathObjects: 8,
  truncated: false,
  ms: 700,
  ...over,
})

describe('Viewer — geometry extraction', () => {
  it('queues below tiles AND below text', () => {
    // A full sheet is ~700ms of work. If it outranked text, find-in-page would
    // stall behind it; if it outranked tiles, the page on screen would.
    const { v, w } = mount()
    void v.requestGeometry(1)
    expect(w.geo()).toHaveLength(1)
    expect(w.geo()[0]!.priority).toBe(PRIORITY_GEOMETRY)
    expect(PRIORITY_GEOMETRY).toBeGreaterThan(PRIORITY_TEXT)
    expect(PRIORITY_GEOMETRY).toBeGreaterThan(PRIORITY_VISIBLE)
  })

  it('resolves with the extracted segments', async () => {
    const { v, w } = mount()
    const p = v.requestGeometry(1)
    w.reply(reply(1))
    const g = await p
    expect(g.page).toBe(1)
    expect(g.segmentCount).toBe(1)
    expect(Array.from(g.segments)).toEqual([0, 0, 0.5, 0.5])
    expect(g.box.left).toBe(-1728)
  })

  it('rejects the waiting request only, on an extraction error', async () => {
    const { v, w } = mount()
    const p = v.requestGeometry(1)
    w.reply(reply(1, FULL, { error: 'no page handle' }))
    await expect(p).rejects.toThrow('no page handle')
  })

  it('does NOT cache — a second full-page request goes back to the worker', async () => {
    const { v, w } = mount()
    const a = v.requestGeometry(1); w.reply(reply(1)); await a
    const b = v.requestGeometry(1); w.reply(reply(1)); await b
    expect(w.geo()).toHaveLength(2)
  })

  it('keys a clipped request separately from the full page', async () => {
    // The whole point of caching by page would be wrong here: a windowed
    // request and a full-page request are different answers, and serving the
    // window from a full-page cache would silently hand back a different set.
    const { v, w } = mount()
    const clip: NormClip = { x0: 0.1, y0: 0.1, x1: 0.25, y1: 0.25 }
    void v.requestGeometry(1)
    void v.requestGeometry(1, { clip })
    const keys = w.geo().map((m) => m.key)
    expect(new Set(keys).size).toBe(2)
    expect(w.geo()[1]!.clip).toEqual(clip)
  })

  it('coalesces two identical in-flight requests into one job', async () => {
    const { v, w } = mount()
    const a = v.requestGeometry(1)
    const b = v.requestGeometry(1)
    expect(w.geo()).toHaveLength(1)
    w.reply(reply(1))
    expect((await a).segmentCount).toBe((await b).segmentCount)
  })

  it('passes extraction options through', () => {
    const { v, w } = mount()
    void v.requestGeometry(1, { minLengthPoints: 4, curveSteps: 12, maxSegments: 1000 })
    const m = w.geo()[0]!
    expect(m.minLengthPoints).toBe(4)
    expect(m.curveSteps).toBe(12)
    expect(m.maxSegments).toBe(1000)
  })

  it('omits options that were not given, rather than sending undefined', () => {
    const { v, w } = mount()
    void v.requestGeometry(1)
    const m = w.geo()[0]!
    expect('clip' in m).toBe(false)
    expect('minLengthPoints' in m).toBe(false)
  })

  it('rejects an out-of-range page without touching the worker', async () => {
    const { v, w } = mount()
    await expect(v.requestGeometry(99)).rejects.toThrow('out of range')
    await expect(v.requestGeometry(-1)).rejects.toThrow('out of range')
    expect(w.geo()).toHaveLength(0)
  })

  it('cancel rejects every waiter and tells the worker to drop the jobs', async () => {
    const { v, w } = mount()
    const a = v.requestGeometry(1)
    const b = v.requestGeometry(2)
    expect(v.cancelGeometry()).toBe(2)
    await expect(a).rejects.toThrow('cancelled')
    await expect(b).rejects.toThrow('cancelled')
    expect(w.cancels()).toHaveLength(2)
    expect(v.cancelGeometry()).toBe(0)
  })

  it('surfaces truncation rather than passing off a partial sheet as complete', async () => {
    const { v, w } = mount()
    const p = v.requestGeometry(1, { maxSegments: 10 })
    w.reply(reply(1, FULL, { truncated: true, segmentCount: 10 }))
    expect((await p).truncated).toBe(true)
  })
})
