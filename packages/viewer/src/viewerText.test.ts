import { describe, expect, it } from 'vitest'
import { Viewer } from './viewer.js'
import { PRIORITY_TEXT, PRIORITY_VISIBLE, textKey, type PageInfo, type WorkerRequest, type WorkerResponse } from './types.js'
import type { PageBox, TextRun } from './text.js'

/** Kept separate from viewer.test.ts so the text protocol has its own harness. */
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
  texts(): Array<Extract<WorkerRequest, { type: 'text' }>> {
    return this.sent.filter((m): m is Extract<WorkerRequest, { type: 'text' }> => m.type === 'text')
  }
  cancels(): string[] {
    return this.sent.flatMap((m) => (m.type === 'cancel' ? m.keys : []))
  }
}

function stubCanvas() {
  const ctx = new Proxy(
    {},
    {
      get: (_t, k) => (k === 'drawImage' ? () => undefined : () => undefined),
      set: () => true,
    },
  )
  return { getContext: () => ctx } as unknown as HTMLCanvasElement
}

const SIZES: PageInfo[] = [
  { width: 3456, height: 2592 },
  { width: 3456, height: 2592 },
  { width: 612, height: 792 },
]

const BOX: PageBox = { left: -1728, bottom: -1296.12, right: 1728, top: 1296.12 }
const RUNS: TextRun[] = [{ start: 0, length: 5, x0: 0.1, y0: 0.2, x1: 0.2, y1: 0.22 }]

function mount() {
  const w = new FakeWorker()
  const v = new Viewer(stubCanvas(), stubCanvas(), w as unknown as Worker, { prefetchRadius: 0 })
  w.reply({ type: 'booted', pageCount: SIZES.length, sizes: SIZES })
  return { v, w }
}

const textReply = (page: number, text = 'STAIR A'): WorkerResponse => ({
  type: 'text',
  key: textKey(page),
  page,
  text,
  runs: RUNS,
  box: BOX,
  charCount: text.length,
  scanned: false,
  ms: 51,
})

describe('Viewer — text layer', () => {
  it('queues extraction behind everything else by default', () => {
    const { v, w } = mount()
    void v.requestText(1)
    expect(w.texts()).toHaveLength(1)
    expect(w.texts()[0]!.priority).toBe(PRIORITY_TEXT)
    expect(PRIORITY_TEXT).toBeGreaterThan(PRIORITY_VISIBLE)
  })

  it('resolves with the extracted page and caches it', async () => {
    const { v, w } = mount()
    const p = v.requestText(1)
    w.reply(textReply(1))
    const pt = await p
    expect(pt.text).toBe('STAIR A')
    expect(pt.runs).toEqual(RUNS)
    expect(pt.box).toEqual(BOX)
    expect(v.hasText(1)).toBe(true)
    expect(v.getText(1)!.text).toBe('STAIR A')
    // A second request is served from cache, not re-queued.
    await v.requestText(1)
    expect(w.texts()).toHaveLength(1)
  })

  it('re-extracts on force', async () => {
    const { v, w } = mount()
    const p = v.requestText(1)
    w.reply(textReply(1))
    await p
    const p2 = v.requestText(1, { force: true })
    expect(w.texts()).toHaveLength(2)
    w.reply(textReply(1, 'LOBBY'))
    expect((await p2).text).toBe('LOBBY')
  })

  it('coalesces concurrent requests and promotes rather than duplicating', async () => {
    const { v, w } = mount()
    const a = v.requestText(2)
    const b = v.requestText(2, { priority: PRIORITY_VISIBLE })
    // Two messages: the original, then a promotion carrying the new priority.
    expect(w.texts().map((t) => t.priority)).toEqual([PRIORITY_TEXT, PRIORITY_VISIBLE])
    expect(w.texts()[0]!.key).toBe(w.texts()[1]!.key)
    w.reply(textReply(2))
    expect((await a).text).toBe((await b).text)
  })

  it('rejects the waiting request when extraction fails, without touching others', async () => {
    const { v, w } = mount()
    const bad = v.requestText(0)
    const good = v.requestText(1)
    w.reply({ ...(textReply(0) as Extract<WorkerResponse, { type: 'text' }>), error: 'FPDFText_LoadPage failed' })
    await expect(bad).rejects.toThrow('FPDFText_LoadPage failed')
    w.reply(textReply(1))
    await expect(good).resolves.toBeTruthy()
    expect(v.hasText(0)).toBe(false)
  })

  it('rejects a page outside the document', async () => {
    const { v } = mount()
    await expect(v.requestText(99)).rejects.toThrow('out of range')
  })

  it('cancels extraction for pages nobody wants, using its own key space', async () => {
    const { v, w } = mount()
    const dropped = v.requestText(0)
    const kept = v.requestText(1)
    expect(v.cancelText([1])).toBe(1)
    expect(w.cancels()).toEqual([textKey(0)])
    await expect(dropped).rejects.toThrow('cancelled')
    w.reply(textReply(1))
    await expect(kept).resolves.toBeTruthy()
  })

  it('settles pending requests when the viewer is destroyed', async () => {
    const { v } = mount()
    const p = v.requestText(1)
    v.destroy()
    await expect(p).rejects.toThrow('destroyed')
  })

  it('counts cached text pages in stats', async () => {
    const { v, w } = mount()
    const p = v.requestText(1)
    expect(v.stats().pending).toBe(1)
    w.reply(textReply(1))
    await p
    expect(v.stats().textPages).toBe(1)
    expect(v.stats().pending).toBe(0)
  })
})
