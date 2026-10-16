import { describe, expect, it } from 'vitest'
import worker, { type Env } from './index.js'
import { notionPage, parseReport, parseScreenshot, reportKey } from './reports.js'

// A 1x1 PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const REPORT = {
  kind: 'quantity',
  summary: 'Trim count doubled on A-101',
  details: 'Drew one area.\n\nThe trim line says 24 sticks.',
  version: '0.3.2',
  machine: 'ARM',
  os: 'Windows 11',
  where: 'Barclays · PKG A ARCH · A-101',
  contact: 'Kenneth',
}

function memoryEnv(extra: Partial<Env> = {}): Env & { objects: Map<string, { value: string | Uint8Array; type?: string }> } {
  const objects = new Map<string, { value: string | Uint8Array; type?: string }>()
  return {
    objects,
    UPDATES: {
      async get(key: string) {
        const o = objects.get(key)
        if (o === undefined) return null
        return {
          async text() { return typeof o.value === 'string' ? o.value : new TextDecoder().decode(o.value) },
          body: new ReadableStream(),
          httpMetadata: o.type === undefined ? {} : { contentType: o.type },
        }
      },
      async put(key: string, value: string | Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
        objects.set(key, { value, ...(options?.httpMetadata?.contentType === undefined ? {} : { type: options.httpMetadata.contentType }) })
        return {}
      },
    },
    ...extra,
  }
}

function post(body: unknown, env: Env): Promise<Response> {
  return worker.fetch(new Request('https://updates.example/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), env)
}

describe('parseReport', () => {
  it('keeps what the app sends', () => {
    const r = parseReport(REPORT)
    if (typeof r === 'string') throw new Error(r)
    expect(r.kind).toBe('quantity')
    expect(r.machine).toBe('ARM')
    expect(r.screenshot).toBeNull()
  })

  it('refuses a report with nothing said', () => {
    expect(parseReport({ ...REPORT, summary: '   ' })).toBe('summary is required')
  })

  it('refuses an unknown kind', () => {
    expect(parseReport({ ...REPORT, kind: 'rant' })).toMatch(/^kind must be one of/)
  })

  it('reads an unknown machine as Unknown rather than refusing', () => {
    const r = parseReport({ ...REPORT, machine: 'mips' })
    expect(typeof r !== 'string' && r.machine).toBe('Unknown')
  })

  it('caps long text', () => {
    const r = parseReport({ ...REPORT, summary: 'x'.repeat(5000) })
    expect(typeof r !== 'string' && r.summary.length).toBe(200)
  })
})

describe('parseScreenshot', () => {
  it('decodes a PNG data URL', () => {
    const s = parseScreenshot(PNG)
    expect(typeof s === 'object' && s !== null && s.type).toBe('image/png')
  })

  it('refuses anything that is not a PNG or JPEG', () => {
    expect(parseScreenshot('data:image/svg+xml;base64,PHN2Zz4=')).toMatch(/PNG or JPEG/)
    expect(parseScreenshot('https://example.com/a.png')).toMatch(/PNG or JPEG/)
  })
})

describe('POST /reports', () => {
  it('keeps the report and its screenshot in R2', async () => {
    const env = memoryEnv()
    const res = await post({ ...REPORT, screenshot: PNG }, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const body = await res.json() as { ok: boolean; id: string; filed: string }
    expect(body).toMatchObject({ ok: true, filed: 'kept' })
    const keys = [...env.objects.keys()]
    expect(keys.some((k) => k === reportKey(body.id, new Date()))).toBe(true)
    expect(keys).toContain(`reports/shots/${body.id}.png`)
    const stored = JSON.parse(String(env.objects.get(reportKey(body.id, new Date()))?.value))
    expect(stored.summary).toBe(REPORT.summary)
    expect(stored.screenshot).toBe(`https://updates.example/shots/${body.id}.png`)
  })

  it('serves the screenshot by its random name, and nothing else under reports/', async () => {
    const env = memoryEnv()
    const { id } = await (await post({ ...REPORT, screenshot: PNG }, env)).json() as { id: string }
    const shot = await worker.fetch(new Request(`https://updates.example/shots/${id}.png`), env)
    expect(shot.status).toBe(200)
    expect(shot.headers.get('content-type')).toBe('image/png')
    const json = await worker.fetch(new Request(`https://updates.example/files/${encodeURIComponent(reportKey(id, new Date()))}`), env)
    expect(json.status).toBe(404)
    const guess = await worker.fetch(new Request('https://updates.example/shots/../reports.png'), env)
    expect(guess.status).toBe(404)
  })

  it('answers the CORS preflight', async () => {
    const res = await worker.fetch(new Request('https://updates.example/reports', { method: 'OPTIONS' }), memoryEnv())
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  })

  it('says why a report was refused', async () => {
    const res = await post({ ...REPORT, summary: '' }, memoryEnv())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: 'summary is required' })
    expect((await post('not json', memoryEnv())).status).toBe(400)
  })

  it('is 503, not 200, when R2 will not take the report', async () => {
    const env = memoryEnv()
    env.UPDATES.put = async () => { throw new Error('r2 down') }
    const res = await post(REPORT, env)
    expect(res.status).toBe(503)
  })

  it('keeps the report when Notion refuses it', async () => {
    const env = memoryEnv({ NOTION_TOKEN: 'secret', NOTION_DATABASE_ID: 'db' })
    const real = globalThis.fetch
    globalThis.fetch = (async () => new Response('{"message":"unauthorized"}', { status: 401 })) as typeof fetch
    try {
      const res = await post(REPORT, env)
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true, filed: 'kept' })
      expect(env.objects.size).toBe(1)
    } finally {
      globalThis.fetch = real
    }
  })

  it('files it in Notion when the token is set', async () => {
    const env = memoryEnv({ NOTION_TOKEN: 'secret', NOTION_DATABASE_ID: 'db' })
    const real = globalThis.fetch
    let sent: { url: string; init: RequestInit } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent = { url, init }
      return new Response('{"url":"https://notion.so/page"}', { status: 200 })
    }) as typeof fetch
    try {
      const res = await post(REPORT, env)
      expect(await res.json()).toMatchObject({ ok: true, filed: 'notion' })
      expect(sent!.url).toBe('https://api.notion.com/v1/pages')
      expect((sent!.init.headers as Record<string, string>)['authorization']).toBe('Bearer secret')
    } finally {
      globalThis.fetch = real
    }
  })
})

describe('notionPage', () => {
  it('fills the REDBEAM reports columns', () => {
    const r = parseReport(REPORT)
    if (typeof r === 'string') throw new Error(r)
    const page = notionPage(r, 'db', 'https://updates.example/shots/x.png', 'id-1')
    expect(page.parent).toEqual({ database_id: 'db' })
    expect(page.properties.Report.title[0]?.text.content).toBe('A quantity is wrong: Trim count doubled on A-101')
    expect(page.properties.Status).toEqual({ select: { name: 'New' } })
    expect(page.properties.Machine).toEqual({ select: { name: 'ARM' } })
    expect(page.properties.Version.rich_text[0]?.text.content).toBe('0.3.2')
    expect('Screenshot' in page.properties).toBe(true)
    // Two paragraphs of details, the facts as bullets, and the picture last.
    expect(page.children.at(-1)).toMatchObject({ type: 'image' })
  })

  it('leaves the Screenshot column empty when there is no picture', () => {
    const r = parseReport(REPORT)
    if (typeof r === 'string') throw new Error(r)
    expect('Screenshot' in notionPage(r, 'db', null, 'id').properties).toBe(false)
  })
})
