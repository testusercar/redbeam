/**
 * Priority queue for rasterization jobs inside the worker.
 *
 * The worker used to rasterize straight out of `onmessage`, which made the
 * message order the execution order. That is fine with one page and no
 * speculation; it is wrong the moment prefetch exists, because six speculative
 * neighbour tiles posted at time T would all render before a visible tile
 * requested at T+1. On the heavy PKG A page that is 6 x ~400ms of the user
 * staring at background.
 *
 * So `onmessage` only enqueues, and a drain loop takes the best job each pass.
 * Ordering: lowest priority number first, then FIFO within a priority.
 */
import type { NormClip } from './geometry.js'

export type JobKind = 'tile' | 'thumb' | 'text' | 'geometry' | 'index'

export interface TileJob {
  kind: 'tile'
  key: string
  page: number
  priority: number
  tx: number
  ty: number
  tile: number
  zoom: number
}

export interface ThumbJob {
  kind: 'thumb'
  key: string
  page: number
  priority: number
  width: number
}

/**
 * Text-layer extraction. It shares this queue rather than getting a mechanism
 * of its own precisely so the priority rules apply to it: one queue is the only
 * way "never delay a visible tile" can be a guarantee instead of a hope.
 */
export interface TextJob {
  kind: 'text'
  key: string
  page: number
  priority: number
}

/**
 * Vector-path extraction. Shares this queue for the same reason TextJob does,
 * and it matters more here: a whole-page walk is ~550ms of atomic work on the
 * heavy sheet, so it MUST be behind the quiet gate rather than racing tiles.
 */
export interface GeometryJob {
  kind: 'geometry'
  key: string
  page: number
  priority: number
  clip?: NormClip
  minLengthPoints?: number
  curveSteps?: number
  maxSegments?: number
}

/**
 * Bookmark outline plus page labels.
 *
 * The only job with no `page`, and that is the point: it touches the document
 * catalog, never a page handle, so it must not reach the page pool at all. The
 * worker's `run` branches on this kind before it acquires a handle — a job that
 * evicted a page the user is looking at in order to read a bookmark title would
 * be a strange way to build a sheet list.
 */
export interface IndexJob {
  kind: 'index'
  key: string
  priority: number
}

export type Job = TileJob | ThumbJob | TextJob | GeometryJob | IndexJob

export class JobQueue {
  private readonly jobs = new Map<string, Job & { seq: number }>()
  private seq = 0

  /**
   * Add a job, or upgrade one already queued.
   *
   * Re-requesting a queued prefetch tile as a visible tile must promote it, not
   * duplicate it — otherwise the same bitmap gets rasterized twice and the
   * expensive copy is the one the user is waiting on. The sequence number is
   * kept, so a job that has been waiting keeps its place among its new peers.
   */
  enqueue(job: Job): void {
    const existing = this.jobs.get(job.key)
    if (existing) {
      if (job.priority < existing.priority) existing.priority = job.priority
      return
    }
    this.jobs.set(job.key, { ...job, seq: this.seq++ })
  }

  /** The job that would run next, without removing it. */
  peek(): Job | undefined {
    let best: (Job & { seq: number }) | undefined
    for (const j of this.jobs.values()) {
      if (!best || j.priority < best.priority || (j.priority === best.priority && j.seq < best.seq)) best = j
    }
    return best
  }

  take(): Job | undefined {
    const best = this.peek()
    if (best) this.jobs.delete(best.key)
    return best
  }

  cancel(keys: Iterable<string>): number {
    let n = 0
    for (const k of keys) if (this.jobs.delete(k)) n++
    return n
  }

  cancelWhere(pred: (job: Job) => boolean): number {
    let n = 0
    for (const [k, j] of [...this.jobs]) if (pred(j)) { this.jobs.delete(k); n++ }
    return n
  }

  has(key: string): boolean {
    return this.jobs.has(key)
  }

  priorityOf(key: string): number | undefined {
    return this.jobs.get(key)?.priority
  }

  clear(): void {
    this.jobs.clear()
  }

  get size(): number {
    return this.jobs.size
  }

  /** Queue contents in the order they would run. Test/diagnostic helper. */
  order(): Job[] {
    return [...this.jobs.values()]
      .sort((a, b) => (a.priority - b.priority) || (a.seq - b.seq))
      .map(({ seq: _seq, ...j }) => j as Job)
  }
}
