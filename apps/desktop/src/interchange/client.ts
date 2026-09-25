/** The page side of `worker.ts`: one request, one promise. */
import type { ApplyResult, Inspection, InterchangeOp } from './pdfInterchange.js'

export type InterchangeRequest =
  | { id: number, type: 'inspect', url: string }
  | { id: number, type: 'apply', url: string, ops: InterchangeOp[] }

export type InterchangeResponse =
  | { id: number, ok: true, type: 'inspect', fingerprint: string, inspection: Inspection }
  | { id: number, ok: true, type: 'apply', fingerprint: string, result: ApplyResult }
  | { id: number, ok: false, error: string }

export interface InterchangeClient {
  inspect(url: string): Promise<{ fingerprint: string, inspection: Inspection }>
  apply(url: string, ops: InterchangeOp[]): Promise<{ fingerprint: string, result: ApplyResult }>
  dispose(): void
}

export function createInterchangeClient(makeWorker: () => Worker): InterchangeClient {
  let worker: Worker | null = null
  let next = 1
  const waiting = new Map<number, { resolve: (r: InterchangeResponse) => void, reject: (e: Error) => void }>()

  const get = (): Worker => {
    if (worker !== null) return worker
    const w = makeWorker()
    w.onmessage = (e: MessageEvent<InterchangeResponse>) => {
      const p = waiting.get(e.data.id)
      if (p === undefined) return
      waiting.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data)
      else p.reject(new Error(e.data.error))
    }
    w.onerror = (e) => {
      for (const p of waiting.values()) p.reject(new Error(e.message || 'the interchange worker failed'))
      waiting.clear()
    }
    worker = w
    return w
  }

  type Unsent = { type: 'inspect', url: string } | { type: 'apply', url: string, ops: InterchangeOp[] }
  const send = (req: Unsent): Promise<InterchangeResponse> =>
    new Promise((resolve, reject) => {
      const id = next++
      waiting.set(id, { resolve, reject })
      get().postMessage({ ...req, id })
    })

  return {
    async inspect(url) {
      const r = await send({ type: 'inspect', url })
      if (!r.ok || r.type !== 'inspect') throw new Error('unexpected reply')
      return { fingerprint: r.fingerprint, inspection: r.inspection }
    },
    async apply(url, ops) {
      const r = await send({ type: 'apply', url, ops })
      if (!r.ok || r.type !== 'apply') throw new Error('unexpected reply')
      return { fingerprint: r.fingerprint, result: r.result }
    },
    dispose() {
      worker?.terminate()
      worker = null
      for (const p of waiting.values()) p.reject(new Error('closed'))
      waiting.clear()
    },
  }
}
