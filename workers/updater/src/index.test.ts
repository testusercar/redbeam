import { describe, expect, it } from 'vitest'
import worker, { type Env } from './index.js'

const MANIFEST = JSON.stringify({
  version: '0.3.1',
  notes: 'Seed follow-up.',
  pub_date: '2026-09-24T00:00:00Z',
  platforms: {
    'windows-x86_64': {
      signature: 'sig',
      url: 'https://redbeam-updates.trackchairking.workers.dev/files/REDBEAM_0.3.1_x64-setup.exe',
    },
  },
})

function envWith(objects: Record<string, string> | 'throw'): Env {
  return {
    UPDATES: {
      async get(key: string) {
        if (objects === 'throw') throw new Error('r2 down')
        const text = objects[key]
        if (text === undefined) return null
        return {
          async text() {
            return text
          },
          body: new ReadableStream(),
          httpMetadata: { contentType: 'application/json' },
        }
      },
    },
  }
}

async function get(path: string, env: Env): Promise<Response> {
  return worker.fetch(new Request(`https://updates.example${path}`), env)
}

describe('empty bucket', () => {
  const env = envWith({})

  it('says the worker is up and the channel is empty', async () => {
    const res = await get('/health', env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, channel: 'empty' })
  })

  it('does not tell a version check that the copy is up to date', async () => {
    const res = await get('/windows/x86_64/0.3.0', env)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'no manifest published' })
  })

  it('reports the same absence on /manifest', async () => {
    const res = await get('/manifest', env)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'no manifest published' })
  })
})

describe('published manifest', () => {
  const env = envWith({ 'manifest.json': MANIFEST })

  it('reports the channel as published', async () => {
    const res = await get('/health', env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, channel: 'published' })
  })

  it('returns the manifest once to an older client and 204 to a current one', async () => {
    const older = await get('/windows/x86_64/0.3.0', env)
    expect(older.status).toBe(200)
    expect(await older.json()).toMatchObject({ version: '0.3.1' })
    const current = await get('/windows/aarch64/0.3.1', env)
    expect(current.status).toBe(204)
    expect(await current.text()).toBe('')
  })
})

describe('bad manifest and a bucket that cannot be read', () => {
  it('names an invalid manifest instead of claiming nothing was published', async () => {
    const env = envWith({ 'manifest.json': '{not json' })
    const health = await get('/health', env)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true, channel: 'invalid' })
    const check = await get('/windows/x86_64/0.3.0', env)
    expect(check.status).toBe(503)
    expect(await check.json()).toEqual({ error: 'manifest is not valid' })
  })

  it('answers 503 when R2 throws, on health and on a version check', async () => {
    const env = envWith('throw')
    const health = await get('/health', env)
    expect(health.status).toBe(503)
    expect(await health.json()).toEqual({ ok: false, channel: 'unreachable' })
    const check = await get('/windows/x86_64/0.3.0', env)
    expect(check.status).toBe(503)
    expect(await check.json()).toEqual({ error: 'updates bucket unreachable' })
  })
})

describe('installer names', () => {
  it('refuses a name that is not a REDBEAM asset', async () => {
    const res = await get('/files/manifest.json', envWith({}))
    expect(res.status).toBe(404)
  })
})
