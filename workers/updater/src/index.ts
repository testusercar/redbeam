/**
 * REDBEAM update channel.
 *
 * GET /health                               — worker is up; channel empty | invalid | published
 * GET /:target/:arch/:current_version       — Tauri updater manifest (204 when current)
 * GET /manifest                             — the manifest, always, for a person publishing
 * GET /files/:name                          — an installer or its .sig, from R2
 *
 * R2 holds `manifest.json` plus the installers named in it. Nothing here is
 * a secret: the manifest is public, and the signing key never comes near
 * this worker.
 *
 * An empty bucket is not "up to date". The version check and `/manifest`
 * answer 503. `/health` still answers 200 so a person can see the worker
 * itself is up.
 */
import { manifestStatus, parseManifest, safeAssetName, type UpdateManifest } from './manifest.js'

export interface R2ObjectBody {
  text(): Promise<string>
  body: ReadableStream
  httpMetadata?: { contentType?: string }
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
}

export interface Env {
  UPDATES: R2Bucket
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
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
    }
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter((p) => p !== '')

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
