/**
 * The Reports workflow's half: turning an inbox report into a GitHub issue
 * on a public repo, and never filing one twice.
 */
import { describe, expect, it } from 'vitest'
import { LABEL, fence, fileReports, filedIds, issueFor } from '../file-reports.mjs'

const STORED = {
  id: '0b6f3c1e-9d2a-4e5b-8c7d-1a2b3c4d5e6f',
  received_at: '2026-10-16T17:02:11.000Z',
  kind: 'quantity',
  kind_label: 'A quantity is wrong',
  summary: 'Trim count doubled on A-101',
  details: 'Drew one area.\n\nThe trim line says 24 sticks. cc @someone #12',
  version: '0.3.2',
  machine: 'ARM',
  os: 'Windows 11',
  where: 'Barclays · PKG A ARCH · A-101',
  contact: 'Kenneth',
  screenshot: 'https://updates.example/shots/0b6f3c1e-9d2a-4e5b-8c7d-1a2b3c4d5e6f.png',
}

describe('the issue', () => {
  const issue = issueFor(STORED)

  it('is titled by kind and summary, and labelled', () => {
    expect(issue.title).toBe('A quantity is wrong: Trim count doubled on A-101')
    expect(issue.labels).toEqual([LABEL])
  })

  it('carries what the person typed and the build, inside a fence', () => {
    const inFence = issue.body.split('```text\n')[1]?.split('\n```')[0] ?? ''
    expect(inFence).toContain('cc @someone #12')
    expect(inFence).toContain('REDBEAM 0.3.2 · ARM · Windows 11')
  })

  it('keeps the screenshot, the project and the name out of a public repo', () => {
    expect(issue.body).not.toContain('Barclays')
    expect(issue.body).not.toContain('Kenneth')
    expect(issue.body).not.toContain('/shots/')
    expect(issue.body).toContain('a screenshot, where they were in the app and their name')
    expect(issue.body).toContain(`reports/2026-10-16/${STORED.id}.json`)
  })

  it('says nothing is kept when nothing else was sent', () => {
    const plain = issueFor({ ...STORED, where: '', contact: '', screenshot: null })
    expect(plain.body).not.toContain('kept privately')
  })

  it('cannot be broken out of by backticks in the text', () => {
    expect(fence('plain')).toBe('```')
    expect(fence('a ```` b')).toBe('`````')
    const body = issueFor({ ...STORED, details: '````\n@everyone' }).body
    expect(body).toContain('`````text\n')
  })

  it('carries everything once the repo is private', () => {
    const body = issueFor(STORED, { full: true }).body
    const inFence = body.split('```text\n')[1]?.split('\n```')[0] ?? ''
    expect(inFence).toContain('Where: Barclays · PKG A ARCH · A-101')
    expect(inFence).toContain('From: Kenneth')
    expect(body).toContain(`![Screenshot](${STORED.screenshot})`)
    expect(body).not.toContain('kept privately')
  })

  it('shows only a picture the Worker named', () => {
    const body = issueFor({ ...STORED, screenshot: 'https://evil.example/x.png' }, { full: true }).body
    expect(body).not.toContain('![Screenshot]')
  })

  it('is found again by its marker', () => {
    expect(filedIds([{ body: issue.body }, { body: null }, { body: 'unrelated' }])).toEqual(new Set([STORED.id]))
  })
})

type Call = { url: string; method: string; body?: unknown }

function fakeServices(inbox: unknown[], existing: unknown[] = [], failCreate = false, isPrivate = false) {
  const calls: Call[] = []
  const left = [...inbox]
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method, ...(init.body === undefined ? {} : { body: JSON.parse(String(init.body)) }) })
    if (url.endsWith('/reports/inbox')) return new Response(JSON.stringify({ reports: left }))
    if (url.includes('/reports/inbox/')) return new Response(null, { status: 204 })
    if (url.endsWith('/labels')) return new Response('{}', { status: 422 })
    if (url.includes('/issues?')) return new Response(JSON.stringify(existing))
    if (url === 'https://api.github.com/repos/o/r') return new Response(JSON.stringify({ private: isPrivate }))
    if (url.endsWith('/issues')) {
      return failCreate
        ? new Response('{}', { status: 403 })
        : new Response(JSON.stringify({ html_url: 'https://github.com/o/r/issues/1' }), { status: 201 })
    }
    return new Response('?', { status: 500 })
  }) as typeof fetch
  return { calls, fetchImpl }
}

const OPTS = { endpoint: 'https://updates.example', syncKey: 'k', repo: 'o/r', token: 't', log: () => {} }

describe('filing', () => {
  it('opens an issue, then clears the inbox copy', async () => {
    const { calls, fetchImpl } = fakeServices([STORED])
    expect(await fileReports({ ...OPTS, fetchImpl })).toEqual({ filed: 1, failed: 0, seen: 1 })
    const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/issues'))
    expect(created?.url).toBe('https://api.github.com/repos/o/r/issues')
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: `https://updates.example/reports/inbox/${STORED.id}` })
  })

  it('puts the project and the picture in only when the repo is private', async () => {
    const created = async (isPrivate: boolean) => {
      const { calls, fetchImpl } = fakeServices([STORED], [], false, isPrivate)
      await fileReports({ ...OPTS, fetchImpl })
      return String((calls.find((c) => c.method === 'POST' && c.url.endsWith('/issues'))?.body as { body: string }).body)
    }
    expect(await created(false)).not.toContain('Barclays')
    expect(await created(true)).toContain('Barclays')
  })

  it('does not open a second issue for a report already filed', async () => {
    const { calls, fetchImpl } = fakeServices([STORED], [{ body: issueFor(STORED).body }])
    expect(await fileReports({ ...OPTS, fetchImpl })).toEqual({ filed: 0, failed: 0, seen: 1 })
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/issues'))).toBe(false)
    expect(calls.at(-1)?.method).toBe('DELETE')
  })

  it('leaves a report in the inbox when GitHub refuses it', async () => {
    const { calls, fetchImpl } = fakeServices([STORED], [], true)
    expect(await fileReports({ ...OPTS, fetchImpl })).toEqual({ filed: 0, failed: 1, seen: 1 })
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('does nothing on GitHub when the inbox is empty', async () => {
    const { calls, fetchImpl } = fakeServices([])
    expect(await fileReports({ ...OPTS, fetchImpl })).toEqual({ filed: 0, failed: 0, seen: 0 })
    expect(calls).toHaveLength(1)
  })
})
