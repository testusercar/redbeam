/**
 * Open a GitHub issue for each bug report waiting in the Worker's inbox.
 *
 * The app posts reports to the update Worker, which has no GitHub
 * credential. This runs in .github/workflows/reports.yml with that run's own
 * GITHUB_TOKEN: read GET /reports/inbox, open one issue per report, then
 * DELETE /reports/inbox/<id> so it is not filed twice.
 *
 * The repo is public, so an issue carries what the person typed and which
 * build they were on, and nothing else. The screenshot, where they were (a
 * client's project and sheet names) and their name stay in R2, under the
 * report's dated key, and the issue says which of those were sent.
 *
 * What the person typed goes inside a fenced block. Outside one, an
 * "@name" would notify a stranger and "#12" would link an unrelated issue.
 *
 *   SYNC_KEY=… GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node workers/updater/file-reports.mjs
 */
import { pathToFileURL } from 'node:url'

export const LABEL = 'bug report'
const MARKER = /<!-- redbeam-report:([0-9a-f-]{36}) -->/

/** A fence longer than any run of backticks in the text, so the text cannot close it. */
export function fence(text) {
  const longest = Math.max(0, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length))
  return '`'.repeat(Math.max(3, longest + 1))
}

/** The issue for one stored report (the JSON the Worker keeps). */
export function issueFor(report) {
  const kind = report.kind_label || 'Bug report'
  const machine = [report.machine, report.os].filter((p) => p).join(' · ')
  const received = String(report.received_at ?? '')
  const said = [
    report.summary,
    ...(report.details ? ['', report.details] : []),
    '',
    `REDBEAM ${report.version}${machine === '' ? '' : ` · ${machine}`}`,
  ].join('\n')
  const f = fence(said)
  const kept = [
    ...(report.screenshot ? ['a screenshot'] : []),
    ...(report.where ? ['where they were in the app'] : []),
    ...(report.contact ? ['their name'] : []),
  ]
  const day = received.slice(0, 10)
  const body = [
    `<!-- redbeam-report:${report.id} -->`,
    `**${kind}**, reported from the app${day === '' ? '' : ` on ${day}`}.`,
    '',
    `${f}text`,
    said,
    f,
    '',
    kept.length === 0
      ? `Report \`${report.id}\`.`
      : `Report \`${report.id}\`. It also came with ${joinWords(kept)}, kept privately in the \`redbeam-updates\` bucket at \`reports/${day}/${report.id}.json\`.`,
  ].join('\n')
  const title = `${kind}: ${String(report.summary ?? '').replace(/\s+/g, ' ')}`.slice(0, 250)
  return { title, body, labels: [LABEL] }
}

function joinWords(words) {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/** Report ids that already have an issue, read from the marker in each body. */
export function filedIds(issues) {
  const ids = new Set()
  for (const issue of issues) {
    const m = MARKER.exec(String(issue.body ?? ''))
    if (m !== null) ids.add(m[1])
  }
  return ids
}

/**
 * One pass: every report in the inbox becomes an issue, or is already one.
 * Returns how many were filed and how many failed; never throws for one bad
 * report, so the rest still go.
 */
export async function fileReports({ endpoint, syncKey, repo, token, fetchImpl = fetch, log = console.log }) {
  const worker = { authorization: `Bearer ${syncKey}` }
  const github = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'redbeam-reports',
  }
  const api = `https://api.github.com/repos/${repo}`

  const res = await fetchImpl(`${endpoint}/reports/inbox`, { headers: worker })
  if (!res.ok) throw new Error(`GET /reports/inbox answered ${res.status}`)
  const { reports } = await res.json()
  if (!Array.isArray(reports) || reports.length === 0) return { filed: 0, failed: 0, seen: 0 }

  // The label, once. 422 means it is already there.
  const label = await fetchImpl(`${api}/labels`, {
    method: 'POST',
    headers: { ...github, 'content-type': 'application/json' },
    body: JSON.stringify({ name: LABEL, color: 'd73a4a', description: 'Sent from Report a bug in the app' }),
  })
  if (!label.ok && label.status !== 422) throw new Error(`creating the label answered ${label.status}`)

  // A run that opened an issue and then lost the DELETE must not open it again.
  const existing = await fetchImpl(`${api}/issues?labels=${encodeURIComponent(LABEL)}&state=all&per_page=100`, { headers: github })
  if (!existing.ok) throw new Error(`listing issues answered ${existing.status}`)
  const already = filedIds(await existing.json())

  let filed = 0
  let failed = 0
  for (const report of reports) {
    const id = String(report?.id ?? '')
    if (!/^[0-9a-f-]{36}$/.test(id)) { failed++; continue }
    if (!already.has(id)) {
      const made = await fetchImpl(`${api}/issues`, {
        method: 'POST',
        headers: { ...github, 'content-type': 'application/json' },
        body: JSON.stringify(issueFor(report)),
      })
      if (!made.ok) {
        log(`report ${id}: GitHub answered ${made.status}`)
        failed++
        continue
      }
      const issue = await made.json()
      log(`report ${id} -> ${issue.html_url}`)
      filed++
    }
    const done = await fetchImpl(`${endpoint}/reports/inbox/${id}`, { method: 'DELETE', headers: worker })
    if (!done.ok) { log(`report ${id}: inbox DELETE answered ${done.status}`); failed++ }
  }
  return { filed, failed, seen: reports.length }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const need = (name) => {
    const v = process.env[name]
    if (v === undefined || v === '') { console.error(`${name} is not set.`); process.exit(1) }
    return v
  }
  const options = {
    endpoint: process.env.REDBEAM_UPDATES || 'https://redbeam-updates.trackchairking.workers.dev',
    syncKey: need('SYNC_KEY'),
    repo: need('GITHUB_REPOSITORY'),
    token: need('GITHUB_TOKEN'),
  }
  let failed = 0
  // A page at a time; filed reports leave the inbox, so the next GET is the next page.
  for (let page = 0; page < 8; page++) {
    const r = await fileReports(options)
    failed = r.failed
    // Empty, or nothing on this page moved: the rest waits for the next run.
    if (r.seen === 0 || r.failed === r.seen) break
  }
  if (failed > 0) { console.error(`${failed} report(s) were not filed; they stay in the inbox for the next run.`); process.exit(1) }
}
