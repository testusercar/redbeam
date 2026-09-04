/**
 * Turning a folder scan into catalog input.
 *
 * The database work itself lives in `@redbeam/store`'s `documents.ts`
 * (`ingestDocuments`). This file is the frontend half: it maps the Rust scan
 * onto that function's input, decides whether the scan is authoritative enough
 * to reconcile against, and — because page boxes come from PDFium and PDFium
 * runs here, not in the core — knows how to measure a document's pages.
 */
import { invoke } from '@tauri-apps/api/core'
import type { PageInfo, WorkerRequest, WorkerResponse } from '@redbeam/viewer'
import type { ScanResult, ScannedFile } from './types.js'

/**
 * One page's geometry. Structurally identical to `PageSpec` in
 * `@redbeam/store`'s `documents.ts`, declared here so this directory does not
 * depend on the store's barrel export landing first.
 *
 * **Per page, not per document.** A drawing set mixes a 3456x2592pt plan with
 * an 8.5x11 details sheet in one file, and every normalized coordinate and
 * every calibration is relative to its own page's box.
 */
export interface PageSpecLike {
  /** Zero based, matching the viewer's page index and `pages.page_number`. */
  pageNumber: number
  widthPdfPoints: number
  heightPdfPoints: number
  label?: string | null
  rotation?: number
  nativeTextAvailable?: boolean
}

/** Structurally identical to `IngestDocument` in `@redbeam/store`. */
export interface IngestDocumentLike {
  relativePath: string
  displayName?: string
  kind?: string
  status?: string
  sizeBytes?: number
  modifiedAt?: string | null
  contentFingerprint?: string | null
  fileDateHint?: string | null
  availability?: string
  pages?: PageSpecLike[]
}

/** Map one scanned file onto the catalog's input shape. */
export function toIngestDocument(file: ScannedFile): IngestDocumentLike {
  return {
    relativePath: file.relativePath,
    displayName: file.displayName,
    kind: file.kind,
    status: file.status,
    sizeBytes: file.sizeBytes,
    modifiedAt: file.modifiedAt,
    contentFingerprint: file.contentFingerprint,
    fileDateHint: file.fileDateHint,
    availability: file.availability,
  }
}

export function toIngestDocuments(scan: ScanResult): IngestDocumentLike[] {
  return scan.files.map(toIngestDocument)
}

/**
 * May this scan be used to flag documents missing?
 *
 * Only when the walk was complete. A truncated scan, or one that could not read
 * a directory, has simply not looked everywhere — and treating "not seen" as
 * "gone" would flag a whole subtree of live drawings as missing, hiding them
 * from the takeoff for a reason the user has no way to guess.
 */
export function shouldReconcile(scan: ScanResult): boolean {
  return !scan.truncated && scan.unreadable.length === 0
}

/** A one-line account of what a scan found, for the status bar. */
export function describeScan(scan: ScanResult): string {
  const parts = [`${scan.files.length} file${scan.files.length === 1 ? '' : 's'}`]
  if (scan.truncated) parts.push('scan truncated')
  if (scan.unreadable.length > 0) {
    parts.push(`${scan.unreadable.length} folder(s) unreadable`)
  }
  return parts.join(' · ')
}

// ------------------------------------------------------------ page probe --

export interface PageProbeOptions {
  /**
   * Build a fresh PDFium worker. One per document, terminated as soon as the
   * page boxes are read — a pool would keep every document of a 200-file set
   * open at once, which is exactly the page-handle leak the viewer's
   * `pagePool` exists to avoid.
   *
   * Typically `() => new PdfWorker()` with
   * `import PdfWorker from '@redbeam/viewer/worker?worker'`.
   */
  createWorker: () => Worker
  /** URL the worker can `fetch` the PDFium wasm from. */
  wasmUrl: string
  /**
   * URL the worker can `fetch` this document from.
   *
   * Deliberately the caller's problem, because every answer costs something
   * and the choice belongs to whoever owns the app's permissions:
   *
   *   - a blob URL built from bytes read in Rust — no new permission, but the
   *     whole file crosses the IPC hop;
   *   - Tauri's asset protocol via `convertFileSrc` — cheap, but needs
   *     `core:asset:default` plus an `app.security.assetProtocol` scope in
   *     `tauri.conf.json`, which is a real widening of the grant;
   *   - a dev-server path, in browser mode.
   *
   * Returning null skips the document; its pages are recorded later, when it is
   * first opened in the viewer.
   */
  resolveUrl: (file: IngestDocumentLike) => string | null | Promise<string | null>
  /**
   * Release a URL once the document has been measured. Called for every URL
   * `resolveUrl` produced, including on failure — a blob URL that is never
   * revoked pins the whole file for the life of the window, and a 200-sheet
   * ingest would pin all of them.
   */
  releaseUrl?: (url: string) => void
  /** Give up on one document after this long. Defaults to 30s. */
  timeoutMs?: number
}

/**
 * Read every page's box out of a PDF, via the viewer's PDFium worker.
 *
 * Returns a probe suitable for `ingestDocuments`' `probePages` option. A
 * document that cannot be opened yields null rather than throwing: one corrupt
 * or still-downloading file must not abort the ingest of the other 199.
 */
export function createWorkerPageProbe(
  opts: PageProbeOptions,
): (doc: IngestDocumentLike) => Promise<PageSpecLike[] | null> {
  const timeoutMs = opts.timeoutMs ?? 30_000

  return async (doc) => {
    let pdfUrl: string | null
    try {
      pdfUrl = await opts.resolveUrl(doc)
    } catch {
      return null
    }
    if (pdfUrl === null || pdfUrl === '') return null

    const worker = opts.createWorker()
    try {
      const sizes = await readPageSizes(worker, opts.wasmUrl, pdfUrl, timeoutMs)
      return sizes.map((size, index) => ({
        pageNumber: index,
        widthPdfPoints: size.width,
        heightPdfPoints: size.height,
      }))
    } catch (err) {
      console.warn(`[ingest] could not read pages of ${doc.relativePath}:`, err)
      return null
    } finally {
      worker.terminate()
      opts.releaseUrl?.(pdfUrl)
    }
  }
}

/**
 * A `resolveUrl` that pulls the file's bytes through the core and wraps them in
 * a blob URL.
 *
 * This is the option that costs no new Tauri permission —
 * `project_read_document` is an application command, and the ACL does not gate
 * those. The price is that the file is resident in memory on both sides while
 * it is read, which is why the Rust side caps it. For a build willing to grant
 * `core:asset:default` and set `app.security.assetProtocol`, `convertFileSrc`
 * is cheaper; this exists so ingest works before that decision is made.
 *
 * Blob URLs are revoked as soon as the probe finishes — a 200-sheet set would
 * otherwise pin every file it ever measured for the life of the window.
 */
export function createCoreBlobUrlResolver(projectPath: string): {
  resolveUrl: (doc: IngestDocumentLike) => Promise<string | null>
  releaseUrl: (url: string) => void
  /** Revoke anything still outstanding — e.g. an ingest that was abandoned. */
  release: () => void
} {
  const issued = new Set<string>()

  return {
    async resolveUrl(doc) {
      try {
        const bytes = await invoke<ArrayBuffer | Uint8Array | number[]>(
          'project_read_document',
          { path: projectPath, relativePath: doc.relativePath },
        )
        const url = URL.createObjectURL(
          new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' }),
        )
        issued.add(url)
        return url
      } catch (err) {
        console.warn(`[ingest] could not read ${doc.relativePath}:`, err)
        return null
      }
    },
    releaseUrl(url) {
      if (!issued.delete(url)) return
      URL.revokeObjectURL(url)
    },
    release() {
      for (const url of issued) URL.revokeObjectURL(url)
      issued.clear()
    },
  }
}

/**
 * Normalize whatever `invoke` handed back into an `ArrayBuffer`.
 *
 * `tauri::ipc::Response` carrying `Vec<u8>` arrives as an `ArrayBuffer` and is
 * used as-is — no copy on the path that matters. The other two branches are
 * there because a transport that falls back to JSON yields a number array, and
 * that should still work rather than produce a blob full of `[object Object]`.
 */
function toArrayBuffer(value: ArrayBuffer | Uint8Array | number[]): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value
  const view = value instanceof Uint8Array ? value : new Uint8Array(value)
  const out = new ArrayBuffer(view.byteLength)
  new Uint8Array(out).set(view)
  return out
}

function readPageSizes(
  worker: Worker,
  wasmUrl: string,
  pdfUrl: string,
  timeoutMs: number,
): Promise<PageInfo[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }

    function onMessage(event: MessageEvent<WorkerResponse>) {
      const data = event.data
      if (data.type === 'booted') {
        cleanup()
        // `sizes` is authoritative for every page: the worker reports the whole
        // set at boot, so no per-page round trip is needed here.
        resolve(data.sizes.slice(0, data.pageCount))
      } else if (data.type === 'error') {
        cleanup()
        reject(new Error(data.message))
      }
    }

    function onError(event: ErrorEvent) {
      cleanup()
      reject(new Error(event.message || 'worker failed'))
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    const boot: WorkerRequest = { type: 'boot', wasmUrl, pdfUrl }
    worker.postMessage(boot)
  })
}
