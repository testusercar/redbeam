/**
 * REDBEAM update channel.
 *
 * GET /health                               — worker is up; channel empty | invalid | published
 * GET /:target/:arch/:current_version       — Tauri updater manifest (204 when current)
 * GET /manifest                             — the manifest, always, for a person publishing
 * GET /files/:name                          — an installer or its .sig, from R2
 * POST /reports                             — a bug report from the app (see reports.ts)
 * GET /shots/:uuid.:ext                     — a report's screenshot, by its random name
 * GET /reports/inbox                        — reports with no issue yet (SYNC_KEY only)
 * DELETE /reports/inbox/:uuid               — an issue now exists for it (SYNC_KEY only)
 *
 * R2 holds `manifest.json` plus the installers named in it. The manifest is
 * public, and the signing key never comes near this worker. The one secret
 * is SYNC_KEY, which only the inbox routes read.
 *
 * An empty bucket is not "up to date". The version check and `/manifest`
 * answer 503. `/health` still answers 200 so a person can see the worker
 * itself is up.
 */
import { manifestStatus, parseManifest, safeAssetName, type UpdateManifest } from './manifest.js'
import {
  INBOX_PAGE, MAX_BODY_BYTES, REPORT_ID, SHOT_NAME, inboxKey, parseReport, reportKey, shotKey, storedReport,
} from './reports.js'

export interface R2ObjectBody {
  text(): Promise<string>
  body: ReadableStream
  httpMetadata?: { contentType?: string }
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
  put(key: string, value: string | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  list(options: { prefix: string; limit: number }): Promise<{ objects: Array<{ key: string }> }>
  delete(key: string): Promise<void>
}

export interface Env {
  UPDATES: R2Bucket
  /**
   * Secret. The Reports workflow's key to the inbox. worker.yml sets it, and
   * reports.yml derives the same value, from CLOUDFLARE_API_TOKEN, so there
   * is no extra secret to keep. Unset, the inbox routes are 404.
   */
  SYNC_KEY?: string
}

/*
 * The app posts from its own origin (tauri.localhost), so the report routes
 * answer CORS. Nothing they return is private: a report id. The inbox routes
 * are for the workflow, not a browser, and do not answer CORS.
 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

function reportJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...CORS_HEADERS } })
}

/** POST /reports. 200 only once the report is in R2. */
async function receiveReport(request: Request, env: Env, url: URL): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return reportJson(413, { ok: false, error: 'report is larger than 6 MB' })
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) return reportJson(413, { ok: false, error: 'report is larger than 6 MB' })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return reportJson(400, { ok: false, error: 'body is not JSON' })
  }
  const report = parseReport(body)
  if (typeof report === 'string') return reportJson(400, { ok: false, error: report })

  const id = crypto.randomUUID()
  const at = new Date()
  let shotUrl: string | null = null
  try {
    if (report.screenshot !== null) {
      const key = shotKey(id, report.screenshot.type)
      await env.UPDATES.put(key, report.screenshot.bytes, { httpMetadata: { contentType: report.screenshot.type } })
      shotUrl = `${url.origin}/shots/${key.split('/').pop()}`
    }
    const stored = JSON.stringify(storedReport(report, id, at, shotUrl), null, 2)
    const httpMetadata = { contentType: 'application/json; charset=utf-8' }
    await env.UPDATES.put(reportKey(id, at), stored, { httpMetadata })
    await env.UPDATES.put(inboxKey(id), stored, { httpMetadata })
  } catch {
    return reportJson(503, { ok: false, error: 'reports could not be stored' })
  }

  return reportJson(200, { ok: true, id, filed: 'kept' })
}

function syncAllowed(request: Request, env: Env): boolean {
  const key = env.SYNC_KEY ?? ''
  if (key.length < 32) return false
  const given = request.headers.get('authorization') ?? ''
  const want = `Bearer ${key}`
  if (given.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i)
  return diff === 0
}

/** GET /reports/inbox and DELETE /reports/inbox/:uuid, for the Reports workflow. */
async function inbox(request: Request, env: Env, method: string, id: string | undefined): Promise<Response> {
  // Without the key the routes do not exist, rather than being refused.
  if (!syncAllowed(request, env)) return new Response('not found', { status: 404 })
  try {
    if (id === undefined && method === 'GET') {
      const listed = await env.UPDATES.list({ prefix: 'reports/inbox/', limit: INBOX_PAGE })
      const reports: unknown[] = []
      for (const { key } of listed.objects) {
        const object = await env.UPDATES.get(key)
        if (object === null) continue
        try { reports.push(JSON.parse(await object.text())) } catch { /* a bad copy; the dated report is the record */ }
      }
      return json(200, JSON.stringify({ reports }))
    }
    if (id !== undefined && REPORT_ID.test(id) && method === 'DELETE') {
      await env.UPDATES.delete(inboxKey(id))
      return json(204, null)
    }
  } catch {
    return json(503, unavailable('unreachable'))
  }
  return new Response('not found', { status: 404 })
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-cache',
}

type Loaded =
  | { state: 'unreachable' }
  | { state: 'empty' }
  | { state: 'invalid' }
  | { state: 'published'; text: string; manifest: UpdateManifest }

async function loadManifest(env: Env): Promise<Loaded> {
  let object: R2ObjectBody | null
  try {
    object = await env.UPDATES.get('manifest.json')
  } catch {
    return { state: 'unreachable' }
  }
  if (object === null) return { state: 'empty' }
  const text = await object.text()
  const manifest = parseManifest(text)
  if (manifest === null) return { state: 'invalid' }
  return { state: 'published', text, manifest }
}

function unavailable(state: 'empty' | 'invalid' | 'unreachable'): string {
  const error =
    state === 'empty'
      ? 'no manifest published'
      : state === 'invalid'
        ? 'manifest is not valid'
        : 'updates bucket unreachable'
  return JSON.stringify({ error })
}

function json(status: number, body: string | null): Response {
  if (status === 204 || body === null) return new Response(null, { status })
  return new Response(body, { status, headers: JSON_HEADERS })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const method = request.method.toUpperCase()
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter((p) => p !== '')

    if (parts.length === 1 && parts[0] === 'reports') {
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
      if (method === 'POST') return receiveReport(request, env, url)
      return new Response('method not allowed', { status: 405, headers: { allow: 'POST, OPTIONS', ...CORS_HEADERS } })
    }

    if (parts[0] === 'reports' && parts[1] === 'inbox' && parts.length <= 3) {
      return inbox(request, env, method, parts[2])
    }

    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
    }

    if (parts.length === 2 && parts[0] === 'shots') {
      const match = SHOT_NAME.exec(decodeURIComponent(parts[1] ?? ''))
      if (match === null) return new Response('not found', { status: 404 })
      const type = match[2] === 'png' ? 'image/png' : 'image/jpeg'
      let object: R2ObjectBody | null
      try {
        object = await env.UPDATES.get(shotKey(match[1] ?? '', type))
      } catch {
        return json(503, unavailable('unreachable'))
      }
      if (object === null) return new Response('not found', { status: 404 })
      const headers = new Headers({ 'content-type': type, 'cache-control': 'private, max-age=86400' })
      if (method === 'HEAD') return new Response(null, { status: 200, headers })
      return new Response(object.body, { status: 200, headers })
    }

    if (parts.length === 1 && parts[0] === 'health') {
      const loaded = await loadManifest(env)
      if (loaded.state === 'unreachable') {
        return json(503, JSON.stringify({ ok: false, channel: 'unreachable' }))
      }
      const channel = loaded.state === 'published' ? 'published' : loaded.state
      return json(200, JSON.stringify({ ok: true, channel }))
    }

    if (parts.length === 1 && parts[0] === 'manifest') {
      const loaded = await loadManifest(env)
      if (loaded.state !== 'published') return json(503, unavailable(loaded.state))
      return json(200, loaded.text)
    }

    if (parts.length === 2 && parts[0] === 'files') {
      const name = safeAssetName(decodeURIComponent(parts[1] ?? ''))
      if (name === null) return new Response('not found', { status: 404 })
      let object: R2ObjectBody | null
      try {
        object = await env.UPDATES.get(name)
      } catch {
        return json(503, unavailable('unreachable'))
      }
      if (object === null) return new Response('not found', { status: 404 })
      const headers = new Headers()
      headers.set('content-type', object.httpMetadata?.contentType ?? 'application/octet-stream')
      headers.set('cache-control', 'public, max-age=300')
      if (method === 'HEAD') return new Response(null, { status: 200, headers })
      return new Response(object.body, { status: 200, headers })
    }

    if (parts.length === 3) {
      const current = decodeURIComponent(parts[2] ?? '')
      const loaded = await loadManifest(env)
      if (loaded.state !== 'published') return json(503, unavailable(loaded.state))
      const status = manifestStatus(loaded.manifest, current)
      if (status === 204) return json(204, null)
      return json(200, loaded.text)
    }

    return new Response('not found', { status: 404 })
  },
}
