/**
 * Bug reports from the app.
 *
 * POST /reports takes one report as JSON. It is written to R2 first, under
 * `reports/`, and that write is the report: an answer of 200 means it is on
 * disk. Filing it in the REDBEAM reports database in Notion comes second and
 * only when the Worker has a NOTION_TOKEN secret. A Notion failure does not
 * fail the request, because the report is already kept.
 *
 * A screenshot is stored beside the report and served from
 * GET /shots/<uuid>.<png|jpg>, so the Notion row can show it. The name is a
 * random UUID the Worker chose, which is the only way to find it. Report
 * JSON is never served.
 *
 * No Cloudflare types and no globals beyond fetch and crypto, so the parsing
 * and the Notion request are tested with plain objects.
 */

export const REPORT_KINDS = {
  broke: 'Something broke',
  quantity: 'A quantity is wrong',
  looks: 'Something looks wrong',
  slow: 'It is slow',
  other: 'Something else',
} as const

export type ReportKind = keyof typeof REPORT_KINDS
export type Machine = 'x64' | 'ARM' | 'Unknown'

export interface Report {
  kind: ReportKind
  summary: string
  details: string
  version: string
  machine: Machine
  os: string
  /** Where the person was, in words: "Project · document · sheet". Optional. */
  where: string
  contact: string
  screenshot: { type: 'image/png' | 'image/jpeg'; bytes: Uint8Array } | null
}

/** A request body larger than this is refused before it is parsed. */
export const MAX_BODY_BYTES = 6 * 1024 * 1024
/** The decoded screenshot. A full-HD PNG of a drawing is under 2 MB. */
export const MAX_SHOT_BYTES = 4 * 1024 * 1024

const LIMITS = { summary: 200, details: 8000, version: 32, os: 120, where: 400, contact: 120 }

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  // Control characters other than newline and tab are noise from a paste.
  return value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max)
}

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** A data URL for a PNG or JPEG, decoded, or a reason it is not one. */
export function parseScreenshot(value: unknown): Report['screenshot'] | string {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return 'screenshot must be a data URL'
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(value)
  if (match === null) return 'screenshot must be a PNG or JPEG data URL'
  const bytes = decodeBase64(match[2] ?? '')
  if (bytes === null) return 'screenshot is not valid base64'
  if (bytes.length > MAX_SHOT_BYTES) return 'screenshot is larger than 4 MB'
  return { type: match[1] as 'image/png' | 'image/jpeg', bytes }
}

/** The request body as a Report, or the reason it is not one. */
export function parseReport(body: unknown): Report | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'body must be a JSON object'
  const o = body as Record<string, unknown>
  const kind = typeof o['kind'] === 'string' && o['kind'] in REPORT_KINDS ? (o['kind'] as ReportKind) : null
  if (kind === null) return `kind must be one of ${Object.keys(REPORT_KINDS).join(', ')}`
  const summary = text(o['summary'], LIMITS.summary)
  if (summary === '') return 'summary is required'
  const machine: Machine = o['machine'] === 'x64' || o['machine'] === 'ARM' ? o['machine'] : 'Unknown'
  const screenshot = parseScreenshot(o['screenshot'])
  if (typeof screenshot === 'string') return screenshot
  return {
    kind,
    summary,
    details: text(o['details'], LIMITS.details),
    version: text(o['version'], LIMITS.version) || 'unknown',
    machine,
    os: text(o['os'], LIMITS.os),
    where: text(o['where'], LIMITS.where),
    contact: text(o['contact'], LIMITS.contact),
    screenshot,
  }
}

export const SHOT_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg)$/

export function shotKey(id: string, type: 'image/png' | 'image/jpeg'): string {
  return `reports/shots/${id}.${type === 'image/png' ? 'png' : 'jpg'}`
}

/** `reports/2026-10-16/<id>.json`: a day's reports list together in the dashboard. */
export function reportKey(id: string, at: Date): string {
  return `reports/${at.toISOString().slice(0, 10)}/${id}.json`
}

/** What is kept in R2: the report without the image bytes, plus where they went. */
export function storedReport(report: Report, id: string, at: Date, shotUrl: string | null) {
  const { screenshot: _shot, ...rest } = report
  return { id, received_at: at.toISOString(), ...rest, kind_label: REPORT_KINDS[report.kind], screenshot: shotUrl }
}

/** Notion caps one rich-text run at 2000 characters. */
function runs(value: string): Array<{ type: 'text'; text: { content: string } }> {
  const out: Array<{ type: 'text'; text: { content: string } }> = []
  for (let i = 0; i < value.length; i += 2000) out.push({ type: 'text', text: { content: value.slice(i, i + 2000) } })
  return out
}

/**
 * The page to create in the REDBEAM reports database. The property names are
 * that database's: Report (title), Note, Status, Machine, Version, Screenshot.
 */
export function notionPage(report: Report, databaseId: string, shotUrl: string | null, id: string) {
  const title = `${REPORT_KINDS[report.kind]}: ${report.summary}`
  const facts = [
    `Kind: ${REPORT_KINDS[report.kind]}`,
    `Version: ${report.version}`,
    `Machine: ${report.machine}${report.os === '' ? '' : ` · ${report.os}`}`,
    ...(report.where === '' ? [] : [`Where: ${report.where}`]),
    ...(report.contact === '' ? [] : [`From: ${report.contact}`]),
    `Report id: ${id}`,
  ]
  const children: unknown[] = []
  if (report.details !== '') {
    for (const para of report.details.split(/\n{2,}/)) {
      if (para.trim() === '') continue
      children.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: runs(para) } })
    }
  }
  for (const fact of facts) {
    children.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: runs(fact) } })
  }
  if (shotUrl !== null) {
    children.push({ object: 'block', type: 'image', image: { type: 'external', external: { url: shotUrl } } })
  }
  return {
    parent: { database_id: databaseId },
    properties: {
      Report: { title: runs(title.slice(0, 2000)) },
      Note: { rich_text: runs((report.details || report.summary).slice(0, 2000)) },
      Status: { select: { name: 'New' } },
      Machine: { select: { name: report.machine } },
      Version: { rich_text: runs(report.version) },
      ...(shotUrl === null ? {} : {
        Screenshot: { files: [{ name: shotUrl.split('/').pop() ?? 'screenshot', type: 'external', external: { url: shotUrl } }] },
      }),
    },
    children: children.slice(0, 100),
  }
}

/** File the report in Notion. Returns the page URL, or null on any failure. */
export async function fileInNotion(
  page: ReturnType<typeof notionPage>, token: string, fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'notion-version': '2022-06-28',
      },
      body: JSON.stringify(page),
    })
    if (!res.ok) return null
    const json = await res.json() as { url?: unknown }
    return typeof json.url === 'string' ? json.url : null
  } catch {
    return null
  }
}
