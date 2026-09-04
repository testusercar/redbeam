import { describe, expect, it } from 'vitest'
import { Viewer } from './viewer.js'
import {
  PRIORITY_GEOMETRY,
  PRIORITY_INDEX,
  PRIORITY_TEXT,
  PRIORITY_THUMBNAIL,
  PRIORITY_VISIBLE,
  type PageInfo,
  type WorkerRequest,
  type WorkerResponse,
} from './types.js'
import type { OutlineNode } from './outline.js'

/** Kept separate from viewer.test.ts so the index protocol has its own harness. */
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
  indexes(): Array<Extract<WorkerRequest, { type: 'index' }>> {
    return this.sent.filter((m): m is Extract<WorkerRequest, { type: 'index' }> => m.type === 'index')
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

const OUTLINE: OutlineNode[] = [
  { title: 'A-101', page: 0, children: [] },
  { title: 'A-102', page: 1, children: [] },
  { title: 'S-201', page: 2, children: [] },
]

function mount() {
  const w = new FakeWorker()
  const v = new Viewer(stubCanvas(), stubCanvas(), w as unknown as Worker, { prefetchRadius: 0 })
  w.reply({ type: 'booted', pageCount: SIZES.length, sizes: SIZES })
  return { v, w }
}

const indexReply = (over: Partial<Extract<WorkerResponse, { type: 'index' }>> = {}): WorkerResponse => ({
  type: 'index',
  outline: OUTLINE,
  labels: ['A-101', 'A-102', 'S-201'],
  shape: 'per-sheet',
  ms: 3,
  ...over,
})

describe('Viewer — document index', () => {
  it('asks the worker once and resolves with outline, labels and shape', async () => {
    const { v, w } = mount()
    const p = v.requestIndex()
    expect(w.indexes()).toHaveLength(1)
    w.reply(indexReply())
    const idx = await p
    expect(idx.shape).toBe('per-sheet')
    expect(idx.outline).toEqual(OUTLINE)
    expect(idx.labels).toEqual(['A-101', 'A-102', 'S-201'])
  })

  it('joins a second caller to the walk already in flight', async () => {
    const { v, w } = mount()
    const a = v.requestIndex()
    const b = v.requestIndex()
    // One message, not two: a sheet list and a page-label strip asking at the
    // same moment must not cost two bookmark walks.
    expect(w.indexes()).toHaveLength(1)
    w.reply(indexReply())
    expect(await a).toBe(await b)
  })

  it('serves the cached index without going back to the worker', async () => {
    const { v, w } = mount()
    const p = v.requestIndex()
    w.reply(indexReply())
    const first = await p
    const second = await v.requestIndex()
    expect(second).toBe(first)
    expect(w.indexes()).toHaveLength(1)
    expect(v.getIndex()).toBe(first)
  })

  it('has no index until one has been extracted', () => {
    const { v } = mount()
    expect(v.getIndex()).toBeUndefined()
  })

  it('rejects only the waiting caller when extraction fails', async () => {
    const { v, w } = mount()
    const p = v.requestIndex()
    w.reply(indexReply({ error: 'FPDFBookmark_GetFirstChild failed' }))
    await expect(p).rejects.toThrow('FPDFBookmark_GetFirstChild failed')
    expect(v.getIndex()).toBeUndefined()
  })

  it('lets a caller try again after a failure', async () => {
    const { v, w } = mount()
    await expect(
      (() => {
        const p = v.requestIndex()
        w.reply(indexReply({ error: 'boom' }))
        return p
      })(),
    ).rejects.toThrow('boom')
    // A rejected promise must not be the answer forever.
    const retry = v.requestIndex()
    expect(w.indexes()).toHaveLength(2)
    w.reply(indexReply())
    expect((await retry).shape).toBe('per-sheet')
  })

  it('rejects a pending request when the viewer is destroyed', async () => {
    const { v } = mount()
    const p = v.requestIndex()
    v.destroy()
    await expect(p).rejects.toThrow('viewer destroyed')
  })

  it('sits ahead of every speculative job and behind the tile on screen', () => {
    expect(PRIORITY_INDEX).toBeGreaterThan(PRIORITY_VISIBLE)
    expect(PRIORITY_INDEX).toBeLessThan(PRIORITY_THUMBNAIL)
    expect(PRIORITY_INDEX).toBeLessThan(PRIORITY_TEXT)
    expect(PRIORITY_INDEX).toBeLessThan(PRIORITY_GEOMETRY)
  })
})
