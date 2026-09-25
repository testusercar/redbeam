/// <reference lib="webworker" />
/**
 * Markup interchange off the main thread. pdf-lib parses the whole file, and
 * on a 100 MB drawing set that is seconds of work the window must not wait on.
 *
 * The worker fetches the drawing from the same blob URL the viewer booted
 * from, so the bytes it edits are exactly the bytes on screen, and it reports
 * their SHA-256 so the core can refuse a write over a file saved since.
 */
import { applyInterchange, inspectPdf } from './pdfInterchange.js'
import type { InterchangeRequest, InterchangeResponse } from './client.js'

const post = (msg: InterchangeResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer)

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

self.onmessage = async (e: MessageEvent<InterchangeRequest>) => {
  const m = e.data
  try {
    const bytes = new Uint8Array(await (await fetch(m.url)).arrayBuffer())
    const fingerprint = await sha256Hex(bytes)
    if (m.type === 'inspect') {
      post({ id: m.id, ok: true, type: 'inspect', fingerprint, inspection: await inspectPdf(bytes) })
      return
    }
    const result = await applyInterchange(bytes, m.ops)
    const transfer = result.ok && result.changed ? [result.bytes.buffer] : []
    post({ id: m.id, ok: true, type: 'apply', fingerprint, result }, transfer)
  } catch (err) {
    post({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
