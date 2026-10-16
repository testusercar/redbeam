import { describe, expect, it } from 'vitest'
import {
  EMPTY_DRAFT, REPORT_KINDS, buildPayload, dataUrlSize, draftProblem, machineFrom, osFrom, reportAsText,
  reportEndpoint, sendReport, whereLine, type ReportContext,
} from './report.js'

const CTX: ReportContext = { version: '0.3.2', machine: 'ARM', os: 'Windows 11', where: 'Barclays · PKG A ARCH · A-101' }

describe('the draft', () => {
  it('cannot be sent without a sentence', () => {
    expect(draftProblem(EMPTY_DRAFT)).toMatch(/sentence/)
    expect(draftProblem({ ...EMPTY_DRAFT, summary: '   ' })).toMatch(/sentence/)
    expect(draftProblem({ ...EMPTY_DRAFT, summary: 'Trim doubled' })).toBeNull()
  })

  it('keeps the first line short and sends the rest as details', () => {
    expect(draftProblem({ ...EMPTY_DRAFT, summary: 'x'.repeat(201) })).toMatch(/under 200/)
  })
})

describe('the payload', () => {
  it('says where the person was only while that is ticked', () => {
    const draft = { ...EMPTY_DRAFT, summary: ' Trim doubled ', details: '\nOne area.\n' }
    expect(buildPayload(draft, CTX)).toMatchObject({ summary: 'Trim doubled', details: 'One area.', where: CTX.where })
    expect(buildPayload({ ...draft, includeWhere: false }, CTX).where).toBe('')
  })

  it('reads as plain text for the clipboard', () => {
    const text = reportAsText(buildPayload({ ...EMPTY_DRAFT, kind: 'quantity', summary: 'Trim doubled' }, CTX))
    expect(text.split('\n')[0]).toBe('A quantity is wrong: Trim doubled')
    expect(text).toContain('REDBEAM 0.3.2 · ARM · Windows 11')
    expect(text).toContain('Where: Barclays · PKG A ARCH · A-101')
  })
})

describe('where reports go', () => {
  it('is the update channel host, from the same tauri.conf.json', () => {
    expect(reportEndpoint(['https://redbeam-updates.trackchairking.workers.dev/{{target}}/{{arch}}/{{current_version}}']))
      .toBe('https://redbeam-updates.trackchairking.workers.dev/reports')
    expect(reportEndpoint()).toBe('https://redbeam-updates.trackchairking.workers.dev/reports')
  })

  it('is nowhere for a build with no channel', () => {
    expect(reportEndpoint([])).toBeNull()
  })
})

describe('sending', () => {
  const payload = buildPayload({ ...EMPTY_DRAFT, summary: 'Trim doubled' }, CTX)
  const answer = (status: number, body: unknown): typeof fetch =>
    (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as typeof fetch

  it('reports success only when the service kept it', async () => {
    expect(await sendReport(payload, answer(200, { ok: true, id: 'abc', filed: 'notion' }), 'https://x/reports'))
      .toEqual({ ok: true, id: 'abc', filed: 'notion' })
    expect(await sendReport(payload, answer(200, { ok: true, id: 'abc', filed: 'kept' }), 'https://x/reports'))
      .toEqual({ ok: true, id: 'abc', filed: 'kept' })
  })

  it('says why it was refused', async () => {
    const r = await sendReport(payload, answer(400, { ok: false, error: 'summary is required' }), 'https://x/reports')
    expect(r).toEqual({ ok: false, reason: 'Not sent: summary is required.' })
  })

  it('does not call a proxy error page a success', async () => {
    const r = await sendReport(payload, answer(200, '<html>captive portal</html>'), 'https://x/reports')
    expect(r.ok).toBe(false)
  })

  it('does not throw when the network is down', async () => {
    const down = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    const r = await sendReport(payload, down, 'https://x/reports')
    expect(r).toMatchObject({ ok: false })
    expect(!r.ok && r.reason).toMatch(/could not reach/)
  })

  it('sends the field names the Worker reads', async () => {
    let body: Record<string, unknown> = {}
    const capture = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body))
      return new Response('{"ok":true,"id":"x","filed":"kept"}')
    }) as typeof fetch
    await sendReport(payload, capture, 'https://x/reports')
    expect(Object.keys(body).sort()).toEqual(
      ['contact', 'details', 'kind', 'machine', 'os', 'screenshot', 'summary', 'version', 'where'],
    )
  })
})

describe('this machine, in words', () => {
  it('reads the WebView client hints', () => {
    expect(machineFrom('arm')).toBe('ARM')
    expect(machineFrom('x86')).toBe('x64')
    expect(machineFrom(undefined)).toBe('Unknown')
    expect(osFrom('Windows', '15.0.0')).toBe('Windows 11')
    expect(osFrom('Windows', '10.0.0')).toBe('Windows 10')
    expect(osFrom('Windows', '')).toBe('Windows')
  })
})

describe('the small helpers', () => {
  it('joins where the person was and drops what is not open', () => {
    expect(whereLine(['Barclays', null, ' A-101 '])).toBe('Barclays · A-101')
    expect(whereLine([undefined, ''])).toBe('')
  })

  it('sizes a picture for the card', () => {
    expect(dataUrlSize(`data:image/png;base64,${'A'.repeat(4000)}`)).toBe('3 KB')
    expect(dataUrlSize(`data:image/png;base64,${'A'.repeat(4_000_000)}`)).toBe('3.0 MB')
  })

  it('offers the same five kinds the Worker accepts', () => {
    expect(REPORT_KINDS.map((k) => k.value)).toEqual(['broke', 'quantity', 'looks', 'slow', 'other'])
  })
})
