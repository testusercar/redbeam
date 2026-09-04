/**
 * A PDF opened for reading, with no canvas and no viewport.
 *
 * The `Viewer` is built around a stage: it boots a worker, paints tiles into
 * two canvases and prioritises everything by what is on screen. Two jobs need
 * the worker and none of that — indexing every sheet's text when a project
 * opens, and rasterising the pages an export needs a picture of — and both
 * have to reach documents that are not the one on the stage. So this speaks
 * the worker protocol directly: boot, ask, wait, close.
 *
 * One document per worker, and the worker is thrown away with it. PDFium
 * init costs about a second, which is fine for work that runs one document
 * at a time in the background and nothing for work that runs once per export.
 */
import PdfWorker from '@redbeam/viewer/worker?worker'
import {
  PRIORITY_TEXT, PRIORITY_THUMBNAIL,
  type PageInfo, type WorkerRequest, type WorkerResponse,
} from '@redbeam/viewer'

export interface HeadlessPageText {
  text: string
  /** True when the page has no text layer — a scanned raster. */
  scanned: boolean
}

export interface HeadlessDocument {
  pageCount: number
  /** Page boxes in PDF points, by page index, as the worker read them at boot. */
  sizes: readonly PageInfo[]
  /** The page's text layer. */
  text(page: number): Promise<HeadlessPageText>
  /** The page rendered `width` pixels wide, the height following the page box. */
  raster(page: number, width: number): Promise<ImageBitmap>
  /** Terminate the worker. Anything still pending rejects. */
  close(): void
}

export interface HeadlessOptions {
  /** Where the PDFium module is served from. The app serves it at the root. */
  wasmUrl?: string
  /** Test seam: something that behaves like `new PdfWorker()`. */
  createWorker?: () => Worker
}

type Waiter = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }

/**
 * Open a document headlessly. Rejects when the worker cannot load it.
 *
 * The URL is whatever the worker can `fetch` — a blob URL from the core's
 * bytes on the desktop, `/sample.pdf` in the browser.
 */
export function openHeadlessDocument(
  pdfUrl: string,
  opts: HeadlessOptions = {},
): Promise<HeadlessDocument> {
  const worker = opts.createWorker !== undefined ? opts.createWorker() : new PdfWorker()
  const waiters = new Map<string, Waiter>()
  let closed = false
  let seq = 0

  const send = (m: WorkerRequest) => worker.postMessage(m)

  const failAll = (why: string) => {
    for (const w of waiters.values()) w.reject(new Error(why))
    waiters.clear()
  }

  const ask = (key: string, m: WorkerRequest): Promise<WorkerResponse> => {
    if (closed) return Promise.reject(new Error('document is closed'))
    return new Promise<WorkerResponse>((resolve, reject) => {
      waiters.set(key, { resolve, reject })
      send(m)
    })
  }

  return new Promise<HeadlessDocument>((resolveOpen, rejectOpen) => {
    let booted = false

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data
      switch (m.type) {
        case 'booted': {
          booted = true
          // Text and thumbnails sit behind the scheduler's quiet gate, which
          // waits for tile activity that will never come here. Zero it.
          send({ type: 'config', quietMs: 0 })
          const doc: HeadlessDocument = {
            pageCount: m.pageCount,
            sizes: m.sizes,
            async text(page) {
              const key = `text-${page}-${seq++}`
              const r = await ask(key, { type: 'text', key, page, priority: PRIORITY_TEXT })
              if (r.type !== 'text') throw new Error(`unexpected ${r.type} for a text request`)
              if (r.error !== undefined) throw new Error(r.error)
              return { text: r.text, scanned: r.scanned }
            },
            async raster(page, width) {
              const key = `thumb-${page}-${width}-${seq++}`
              const r = await ask(key, { type: 'thumb', key, page, width, priority: PRIORITY_THUMBNAIL })
              if (r.type !== 'thumb') throw new Error(`unexpected ${r.type} for a raster request`)
              return r.bmp
            },
            close() {
              if (closed) return
              closed = true
              failAll('document was closed')
              worker.terminate()
            },
          }
          resolveOpen(doc)
          return
        }
        case 'text':
        case 'thumb': {
          const w = waiters.get(m.key)
          if (w === undefined) return
          waiters.delete(m.key)
          w.resolve(m)
          return
        }
        case 'error': {
          if (!booted) {
            closed = true
            worker.terminate()
            rejectOpen(new Error(m.message))
            return
          }
          // The worker does not say which job failed on the generic channel,
          // so everything waiting is told. A per-job failure comes back on
          // the job's own message and is handled above.
          failAll(m.message)
          return
        }
        default:
          return
      }
    }
    worker.onerror = (ev) => {
      const why = ev.message || 'the PDF worker failed'
      if (!booted) {
        closed = true
        worker.terminate()
        rejectOpen(new Error(why))
      } else {
        failAll(why)
      }
    }

    send({ type: 'boot', wasmUrl: opts.wasmUrl ?? '/pdfium.wasm', pdfUrl })
  })
}
