/**
 * REDBEAM update channel.
 *
 * GET /:target/:arch/:current_version  — Tauri updater manifest (204 when current)
 * GET /manifest                         — the manifest, always, for a person publishing
 * GET /files/:name                      — an installer or its .sig, from R2
 *
 * R2 holds `manifest.json` plus the installers named in it. Nothing here is
 * a secret: the manifest is public, and the signing key never comes near
 * this worker.
 */
import { manifestStatus, parseManifest, safeAssetName } from './manifest.js'

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

async function readManifest(env: Env): Promise<ReturnType<typeof parseManifest>> {
  const object = await env.UPDATES.get('manifest.json')
  if (object === null) return null
  return parseManifest(await object.text())
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

    if (parts.length === 1 && parts[0] === 'manifest') {
      const object = await env.UPDATES.get('manifest.json')
      if (object === null) return json(503, JSON.stringify({ error: 'no manifest published' }))
      const text = await object.text()
      if (parseManifest(text) === null) return json(503, JSON.stringify({ error: 'manifest is not valid' }))
      return json(200, text)
    }

    if (parts.length === 2 && parts[0] === 'files') {
      const name = safeAssetName(decodeURIComponent(parts[1] ?? ''))
      if (name === null) return new Response('not found', { status: 404 })
      const object = await env.UPDATES.get(name)
      if (object === null) return new Response('not found', { status: 404 })
      const headers = new Headers()
      headers.set('content-type', object.httpMetadata?.contentType ?? 'application/octet-stream')
      headers.set('cache-control', 'public, max-age=300')
      if (method === 'HEAD') return new Response(null, { status: 200, headers })
      return new Response(object.body, { status: 200, headers })
    }

    if (parts.length === 3) {
      const current = decodeURIComponent(parts[2] ?? '')
      const manifest = await readManifest(env)
      const status = manifestStatus(manifest, current)
      if (status !== 200) {
        return json(status, status === 503 ? JSON.stringify({ error: 'no manifest published' }) : null)
      }
      const object = await env.UPDATES.get('manifest.json')
      const text = object === null ? null : await object.text()
      return json(200, text)
    }

    return new Response('not found', { status: 404 })
  },
}
