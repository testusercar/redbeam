import { JobQueue, type Job } from './jobQueue.js'
import { PRIORITY_VISIBLE } from './types.js'

/**
 * Decides what the worker rasterizes next.
 *
 * Split out of the worker so the ordering rules can be tested in Node without
 * PDFium. The rules exist to make one guarantee: speculative work never delays
 * a tile the user is looking at.
 *
 *   1. Strict priority. The queue, not the message arrival order, decides. Six
 *      prefetch tiles posted at T lose to one visible tile requested at T+1.
 *   2. Pre-emption at job boundaries. `yieldTo` hands control back to the event
 *      loop after every job, so a visible-tile message that arrived mid-render
 *      is delivered and jumps the queue before the next job starts.
 *   3. A quiet gate, because (2) is not enough on its own. PDFium renders
 *      atomically — a job already running cannot be interrupted, and at fit
 *      zoom nothing is culled, so a speculative tile on the heavy E-size sheet
 *      can hold the worker for ~400ms. So speculative work does not START until
 *      the queue has seen no visible-tile activity for `quietMs`. While the user
 *      pans or zooms, prefetch and thumbnails never begin at all.
 *
 * The cost of (3) is that speculation is deferred, not dropped, while the user
 * keeps moving. That is the intended trade.
 */
export interface SchedulerOptions {
  run: (job: Job) => Promise<void>
  queue?: JobQueue
  /** Idle window with no visible-tile work before speculative jobs may start. */
  quietMs?: number
  now?: () => number
  /** Hand control back to the event loop between jobs. */
  yieldTo?: () => Promise<void>
  setTimer?: (fn: () => void, ms: number) => void
}

export class Scheduler {
  readonly queue: JobQueue
  quietMs: number

  private readonly run: (job: Job) => Promise<void>
  private readonly now: () => number
  private readonly yieldTo: () => Promise<void>
  private readonly setTimer: (fn: () => void, ms: number) => void

  private lastVisibleAt: number
  private draining = false
  private waking = false

  constructor(opts: SchedulerOptions) {
    this.queue = opts.queue ?? new JobQueue()
    this.run = opts.run
    this.quietMs = opts.quietMs ?? 60
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
    this.yieldTo = opts.yieldTo ?? (() => new Promise<void>((r) => setTimeout(r, 0)))
    this.setTimer = opts.setTimer ?? ((fn, ms) => void setTimeout(fn, ms))
    // Start the clock as if visible work just happened. Otherwise the very
    // first speculative job — a thumbnail strip that renders before the first
    // tile request lands, say — sails through the gate and holds the worker
    // while the page the user opened is still waiting for its first tile.
    this.lastVisibleAt = this.now()
  }

  /** Mark the clock: the user is actively looking at something. */
  noteVisibleActivity() {
    this.lastVisibleAt = this.now()
  }

  enqueue(job: Job) {
    if (job.priority === PRIORITY_VISIBLE) this.noteVisibleActivity()
    this.queue.enqueue(job)
    void this.drain()
  }

  cancel(keys: Iterable<string>): number {
    return this.queue.cancel(keys)
  }

  get running(): boolean {
    return this.draining
  }

  async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      for (;;) {
        const next = this.queue.peek()
        if (!next) break
        if (next.priority > PRIORITY_VISIBLE) {
          const idle = this.now() - this.lastVisibleAt
          if (idle < this.quietMs) {
            this.scheduleWake(this.quietMs - idle)
            break
          }
        }
        const job = this.queue.take()
        if (!job) break
        if (job.priority === PRIORITY_VISIBLE) this.noteVisibleActivity()
        await this.run(job)
        if (job.priority === PRIORITY_VISIBLE) this.noteVisibleActivity()
        await this.yieldTo()
      }
    } finally {
      this.draining = false
    }
  }

  private scheduleWake(ms: number) {
    if (this.waking) return
    this.waking = true
    this.setTimer(() => {
      this.waking = false
      void this.drain()
    }, Math.max(1, Math.ceil(ms)))
  }
}
