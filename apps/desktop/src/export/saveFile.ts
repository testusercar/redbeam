/**
 * Where a file goes when it leaves the app.
 *
 * On the desktop: a native Save As, then the bytes written where the person
 * said. Every export used to hand a blob to the webview's downloader, which
 * dropped it in Downloads under a name nobody chose and said nothing. Aaron:
 * "it should prompt you where to save it by default instead of saving it to
 * the downloads folder."
 *
 * In the browser build there is no dialog to show, so the downloader is the
 * fallback there and only there.
 */
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../tauri/window.js'

export interface SaveOutcome {
  /** Where it was written, or null when the person cancelled. */
  path: string | null
  /** True when the browser downloader was used and the path is unknown. */
  downloaded: boolean
}

export interface SaveFileOptions {
  /** The name offered in the dialog, extension included. */
  name: string
  /** A filter for the dialog: what the file is, and its extensions. */
  filter?: { name: string; extensions: string[] }
  /** The MIME type, for the browser fallback. */
  type: string
}

/** Test seam: the desktop call, injectable. */
export type SaveInvoke = (defaultName: string, bytes: Uint8Array, filter?: SaveFileOptions['filter']) => Promise<string | null>

const desktopSave: SaveInvoke = (defaultName, bytes, filter) => invoke<string | null>('project_save_file', {
  defaultName,
  bytes: Array.from(bytes),
  filterName: filter?.name ?? null,
  extensions: filter?.extensions ?? null,
})

export async function saveFile(
  data: Uint8Array | string,
  opts: SaveFileOptions,
  deps: { desktop?: boolean; save?: SaveInvoke } = {},
): Promise<SaveOutcome> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const desktop = deps.desktop ?? isTauri()
  if (desktop) {
    const path = await (deps.save ?? desktopSave)(opts.name, bytes, opts.filter)
    return { path, downloaded: false }
  }
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: opts.type }))
  const a = document.createElement('a')
  a.href = url
  a.download = opts.name
  a.click()
  // Revoked late: revoking synchronously races the download in WebView2 and
  // produces an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return { path: null, downloaded: true }
}

/** What to say once a save has finished, for a status line. */
export function saveOutcomeText(o: SaveOutcome, what: string): string {
  if (o.downloaded) return `${what} downloaded`
  if (o.path === null) return `${what} not saved`
  return `saved ${o.path}`
}
