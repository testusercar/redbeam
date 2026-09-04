/**
 * Crash reports, in Settings (plan TH.8).
 *
 * A report nobody can find is a report that was never written. The crash
 * screen names the file it just saved, but the case this exists for is the
 * other one: the app died without a screen — a Rust panic, or a rejected
 * promise that left the window looking healthy — and somebody is being asked,
 * days later, whether anything was recorded.
 *
 * So the answer lives somewhere findable, and "none" is an answer worth
 * showing rather than an empty section. It is a card under "This copy",
 * beside the version: both are facts about the installed build, not
 * preferences.
 */
import { useEffect, useState } from 'react'
import { crashFolder, listCrashReports } from '../crash.js'

interface Report {
  file: string
  written_at: string
  kind: string
  message: string
}

/** `crash-1757000000-render.txt` → a date somebody can compare to their memory. */
export function reportWhen(writtenAt: string): string {
  const seconds = Number(writtenAt.split(' ')[0])
  if (!Number.isFinite(seconds) || seconds <= 0) return 'unknown time'
  return new Date(seconds * 1000).toLocaleString()
}

/** What kind of failure this was, in words rather than a slug. */
export function reportKind(kind: string): string {
  switch (kind) {
    case 'rust-panic': return 'The app stopped'
    case 'render': return 'A window failed to draw'
    case 'rejection': return 'Background work failed'
    default: return 'Something failed'
  }
}

export function DiagnosticsRow({ desktop }: { desktop: boolean }) {
  const [reports, setReports] = useState<Report[] | null>(null)
  const [folder, setFolder] = useState<string | null>(null)

  useEffect(() => {
    if (!desktop) { setReports([]); return }
    void listCrashReports().then(setReports)
    void crashFolder().then(setFolder)
  }, [desktop])

  return (
    <div className="prefs-card">
      <div className="prefs-cardtext">
        <div className="prefs-cardtitle">Problem reports</div>
        {reports === null && <div className="prefs-cardnote">Looking…</div>}
        {reports !== null && reports.length === 0 && (
          <div className="prefs-cardnote">
            Nothing has been recorded. REDBEAM writes a file here when it stops
            unexpectedly or when background work fails.
          </div>
        )}
        {reports !== null && reports.length > 0 && (
          <>
            <div className="prefs-cardnote">
              {reports.length} report{reports.length === 1 ? '' : 's'}. Send the newest
              to whoever maintains REDBEAM — each file says what it contains.
            </div>
            <ul className="prefs-reports">
              {/* Newest first, capped: this is a prompt to send one, not a log
                  viewer, and twenty rows would bury the recent one. */}
              {reports.slice(0, 5).map((r) => (
                <li key={r.file}>
                  <span className="prefs-reportkind">{reportKind(r.kind)}</span>
                  <span className="prefs-reportwhen">{reportWhen(r.written_at)}</span>
                  <span className="prefs-reportmsg selectable">{r.message}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {folder !== null && (
          <div className="prefs-cardnote selectable">Saved in {folder}</div>
        )}
      </div>
    </div>
  )
}
