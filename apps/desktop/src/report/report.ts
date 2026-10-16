/**
 * Reporting a bug.
 *
 * Problem reports (crash.ts) are what the app writes when IT notices a
 * failure. This is the other half: what a person writes when they notice one
 * the app cannot — a quantity that is wrong, a sheet that drew badly, a
 * button that did nothing. Those are most of the bugs in a takeoff tool, and
 * none of them throw.
 *
 * A report goes to the update channel's Worker (`POST /reports`), the one
 * host every installed copy already talks to, which keeps it in R2. A
 * workflow then opens a GitHub issue for it. Nothing about the project
 * goes unless the person leaves "where you were" ticked, and the dialog
 * shows exactly what that line says before it is sent.
 *
 * No React and no DOM here, so the rules are argued with in report.test.ts.
 */
import conf from '../../src-tauri/tauri.conf.json'
import { APP_VERSION } from '../update/updates.js'

export type ReportKind = 'broke' | 'quantity' | 'looks' | 'slow' | 'other'

/** The five kinds, in the order the dialog and the prompt offer them. */
export const REPORT_KINDS: ReadonlyArray<{ value: ReportKind; label: string; hint: string; placeholder: string }> = [
  {
    value: 'broke', label: 'Something broke', hint: 'an error, a freeze, a button that did nothing',
    placeholder: 'Calibrate stopped responding after the second click',
  },
  {
    value: 'quantity', label: 'A quantity is wrong', hint: 'a count, a length or an area that does not match the drawing',
    placeholder: 'Trim on A-101 says 24 sticks; the room needs 12',
  },
  {
    value: 'looks', label: 'Something looks wrong', hint: 'a sheet, a markup or a panel drawn badly',
    placeholder: 'The layout preview runs past the ceiling edge on A-201',
  },
  {
    value: 'slow', label: 'It is slow', hint: 'a sheet, a search or a save that takes too long',
    placeholder: 'Opening PKG A takes about a minute',
  },
  {
    value: 'other', label: 'Something else', hint: 'anything that got in the way',
    placeholder: 'What happened, in a sentence',
  },
]

export function kindLabel(kind: ReportKind): string {
  return REPORT_KINDS.find((k) => k.value === kind)?.label ?? 'Something else'
}

export type Machine = 'x64' | 'ARM' | 'Unknown'

/** Facts about this copy and where the person was. Gathered, never typed. */
export interface ReportContext {
  version: string
  machine: Machine
  os: string
  /** "Project · document · sheet", or '' with nothing open. */
  where: string
}

export interface ReportDraft {
  kind: ReportKind
  summary: string
  details: string
  contact: string
  /** Send `where`. Off means the line is not sent at all. */
  includeWhere: boolean
  /** A PNG or JPEG data URL, pasted, dropped or captured. */
  screenshot: string | null
}

export const EMPTY_DRAFT: ReportDraft = {
  kind: 'broke', summary: '', details: '', contact: '', includeWhere: true, screenshot: null,
}

export const SUMMARY_MAX = 200
export const DETAILS_MAX = 8000

/** The reason the draft cannot be sent yet, or null when it can. */
export function draftProblem(draft: ReportDraft): string | null {
  if (draft.summary.trim() === '') return 'Say what happened in a sentence.'
  if (draft.summary.trim().length > SUMMARY_MAX) return `Keep the first line under ${SUMMARY_MAX} characters; the rest goes in the details.`
  if (draft.details.length > DETAILS_MAX) return `The details are over ${DETAILS_MAX} characters.`
  return null
}

/** The JSON body the Worker reads. Field names are the Worker's (workers/updater/src/reports.ts). */
export interface ReportPayload {
  kind: ReportKind
  summary: string
  details: string
  version: string
  machine: Machine
  os: string
  where: string
  contact: string
  screenshot: string | null
}

export function buildPayload(draft: ReportDraft, ctx: ReportContext): ReportPayload {
  return {
    kind: draft.kind,
    summary: draft.summary.trim(),
    details: draft.details.trim(),
    version: ctx.version,
    machine: ctx.machine,
    os: ctx.os,
    where: draft.includeWhere ? ctx.where : '',
    contact: draft.contact.trim(),
    screenshot: draft.screenshot,
  }
}

/** The report as plain text, for the clipboard when it cannot be sent. */
export function reportAsText(p: ReportPayload): string {
  const lines = [
    `${kindLabel(p.kind)}: ${p.summary}`,
    '',
    ...(p.details === '' ? [] : [p.details, '']),
    `REDBEAM ${p.version} · ${p.machine}${p.os === '' ? '' : ` · ${p.os}`}`,
    ...(p.where === '' ? [] : [`Where: ${p.where}`]),
    ...(p.contact === '' ? [] : [`From: ${p.contact}`]),
    ...(p.screenshot === null ? [] : ['(A screenshot was attached in the app and is not in this text.)']),
  ]
  return lines.join('\n')
}

/**
 * Where reports go: the update channel's host. Read from the same
 * tauri.conf.json endpoint the updater uses, so moving the Worker moves both.
 * Null when this build has no channel at all.
 */
export function reportEndpoint(endpoints: readonly string[] = conf.plugins?.updater?.endpoints ?? []): string | null {
  const first = endpoints[0]
  if (first === undefined) return null
  try {
    return `${new URL(first).origin}/reports`
  } catch {
    return null
  }
}

export type SendResult =
  | { ok: true; id: string; filed: 'notion' | 'kept' }
  | { ok: false; reason: string }

/**
 * Post the report. Never throws: the caller is a dialog that must keep the
 * person's words on screen whatever happened.
 */
export async function sendReport(
  payload: ReportPayload,
  fetchImpl: typeof fetch = fetch,
  endpoint: string | null = reportEndpoint(),
): Promise<SendResult> {
  if (endpoint === null) return { ok: false, reason: 'This copy has no report channel.' }
  let res: Response
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, reason: 'REDBEAM could not reach the report service. Check the connection and try again.' }
  }
  let body: unknown = null
  try { body = await res.json() } catch { /* a proxy's HTML error page */ }
  const o = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  if (res.ok && o['ok'] === true && typeof o['id'] === 'string') {
    return { ok: true, id: o['id'], filed: o['filed'] === 'notion' ? 'notion' : 'kept' }
  }
  const error = typeof o['error'] === 'string' ? o['error'] : `the service answered ${res.status}`
  return { ok: false, reason: `Not sent: ${error}.` }
}

/**
 * x64 or ARM, from the WebView's client hints. WebView2 is Chromium, so
 * `getHighEntropyValues` is there on every supported Windows; anywhere it is
 * not, the answer is honestly Unknown.
 */
export function machineFrom(architecture: unknown): Machine {
  if (architecture === 'arm') return 'ARM'
  if (architecture === 'x86') return 'x64'
  return 'Unknown'
}

/** Windows 11 reports platformVersion 13 and up; 10 reports 1 to 10. */
export function osFrom(platform: unknown, platformVersion: unknown): string {
  if (platform !== 'Windows') return typeof platform === 'string' ? platform : ''
  const major = Number(String(platformVersion ?? '').split('.')[0])
  if (!Number.isFinite(major) || major <= 0) return 'Windows'
  return major >= 13 ? 'Windows 11' : 'Windows 10'
}

interface UAData {
  platform?: string
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>
}

export async function gatherContext(where: string): Promise<ReportContext> {
  let machine: Machine = 'Unknown'
  let os = ''
  try {
    const ua = (navigator as unknown as { userAgentData?: UAData }).userAgentData
    const v = await ua?.getHighEntropyValues?.(['architecture', 'platformVersion'])
    machine = machineFrom(v?.['architecture'])
    os = osFrom(ua?.platform, v?.['platformVersion'])
  } catch { /* stays Unknown */ }
  return { version: APP_VERSION, machine, os, where }
}

/** The line that says where the person was. Empty parts drop out. */
export function whereLine(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.map((p) => (p ?? '').trim()).filter((p) => p !== '').join(' · ')
}

/**
 * A picture of the drawing as it is on screen: the raster and the markup
 * overlay, flattened, scaled to at most `maxWidth` and saved as JPEG. A
 * full-size PNG of a 4K stage is several megabytes of mostly white paper;
 * this is a few hundred kilobytes and still shows which line is wrong.
 */
export function captureStage(
  layers: ReadonlyArray<HTMLCanvasElement | null>, maxWidth = 1600,
): string | null {
  const base = layers[0]
  if (base === null || base === undefined || base.width === 0 || base.height === 0) return null
  const scale = Math.min(1, maxWidth / base.width)
  const out = document.createElement('canvas')
  out.width = Math.round(base.width * scale)
  out.height = Math.round(base.height * scale)
  const ctx = out.getContext('2d')
  if (ctx === null) return null
  ctx.fillStyle = '#F2F0EB'
  ctx.fillRect(0, 0, out.width, out.height)
  for (const layer of layers) {
    if (layer !== null && layer.width > 0) ctx.drawImage(layer, 0, 0, out.width, out.height)
  }
  try {
    return out.toDataURL('image/jpeg', 0.85)
  } catch {
    return null
  }
}

/**
 * An image from a paste or a drop, as a data URL the Worker accepts. A
 * screenshot from Snipping Tool arrives as PNG; anything not PNG or JPEG is
 * redrawn as PNG; anything over the Worker's 4 MB is redrawn smaller.
 */
export async function imageFileToDataUrl(file: Blob, maxBytes = 3_500_000): Promise<string | null> {
  const read = (b: Blob) => new Promise<string | null>((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null)
    r.onerror = () => resolve(null)
    r.readAsDataURL(b)
  })
  if ((file.type === 'image/png' || file.type === 'image/jpeg') && file.size <= maxBytes) return read(file)
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 2400 / bitmap.width)
    const c = document.createElement('canvas')
    c.width = Math.round(bitmap.width * scale)
    c.height = Math.round(bitmap.height * scale)
    c.getContext('2d')?.drawImage(bitmap, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.85)
  } catch {
    return null
  }
}

/** Kilobytes or megabytes, for "Screenshot · 412 KB". */
export function dataUrlSize(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  const b64 = comma < 0 ? '' : dataUrl.slice(comma + 1)
  const bytes = Math.floor(b64.length * 3 / 4)
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`
}
