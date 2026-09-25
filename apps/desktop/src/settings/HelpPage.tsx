/**
 * How REDBEAM is used, and a small dialog for saying what went wrong.
 *
 * Written from the screens that exist: the start window, the sheet index,
 * the dock, the estimates sidebar, the updater, and Settings. Feedback is
 * collected in a dialog the size of the release-notes one, and not delivered
 * — see `submitFeedback`.
 */
import { useEffect, useState, type ClipboardEvent, type FormEvent } from 'react'
import { useReturnFocus } from '../returnFocus.js'
import { useFocusTrap } from '../shell/focusTrap.js'

/**
 * Posting waits on a Worker-side Notion token for database
 * 178c8ca253ba4826a25aee041a02301d
 * (https://app.notion.com/p/178c8ca253ba4826a25aee041a02301d).
 * Do not embed a token in the app, and do not report a successful post:
 * nothing is sent.
 */
function submitFeedback(_note: string, _screenshot: string): void {
  // Unwired on purpose. The Worker has no Notion token yet.
}

export function HelpBody({ onFeedback }: { onFeedback: () => void }) {
  return (
    <div className="prefs-help">
      <section className="prefs-run" aria-labelledby="help-open">
        <h3 className="prefs-runtitle" id="help-open">Opening a job</h3>
        <p>
          The start window lists recent projects. Open a folder to continue a job or start one.
          View a drawing opens that PDF without making a project. The first markup asks which
          folder the drawing belongs to.
        </p>
        <p>
          Reopen the last project on launch is off unless you turn it on under Startup.
          A second project opens in its own window.
        </p>
      </section>

      <section className="prefs-run" aria-labelledby="help-sheets">
        <h3 className="prefs-runtitle" id="help-sheets">Sheets and scale</h3>
        <p>
          The left side is Files, Contents, Thumbnails, and Search. Contents is the sheet index.
          Click a sheet to open it. A sheet with takeoff shows a dot in that scope's colour.
          Search reads the text of the set on the desktop app.
        </p>
        <p>
          The dock shows the sheet's scale. Pick a scale there, or choose Calibrate from the drawing…
          and type the length of the line you drew. Right-click a sheet, or several, and choose
          Set scale… to use one scale for that selection. A sheet with no scale is not measured.
          A details sheet can hold scale regions, each with its own scale.
        </p>
        <p>
          The wheel scrolls the sheet. Shift and the wheel scroll sideways. Ctrl and the wheel, or a
          pinch, zoom. Scroll wheel zooms, under Drawing, makes the wheel zoom instead. Pan (H) moves
          the sheet. Select (V) picks markups. Dimension measures one length and does not belong to a scope.
        </p>
      </section>

      <section className="prefs-run" aria-labelledby="help-scopes">
        <h3 className="prefs-runtitle" id="help-scopes">Rounds and scopes</h3>
        <p>
          The right side is the estimate. A round owns its scopes. Name a round, then name a scope
          in that round. The scope page shows parts, setup, and markups together.
        </p>
        <p>
          Setup asks which product the scope is: Panels, Planks, Baffle Cassette, Baffle, Linear parts,
          or Custom Assembly. The fields are the ones that product measures. Parts, on the scope,
          are what gets ordered. The round shows one figure per scope: area, perimeter, and count.
        </p>
        <p>
          Commit saves the numbers as they were, so a later change to the scope can be compared with
          what you already sent. Export, on the round, lets you check the estimate name, the project
          name, and a note per scope, then Save PDF. CSV and TSV are in that page's menu. A scope with
          no takeoff is left out. What you type there is not written back to the project.
        </p>
      </section>

      <section className="prefs-run" aria-labelledby="help-takeoff">
        <h3 className="prefs-runtitle" id="help-takeoff">Takeoff</h3>
        <p>
          Choose a scope and press Take off on the dock. Area, Cutout, Linear, Count, and Highlight
          draw on the sheet. Direction sets the way the material runs. Done leaves takeoff.
        </p>
        <p>
          Snap while drawing is on. Hold Alt to place a point where the cursor is. Snap to the drawing's
          lines can be turned off under Takeoff. Show the layout preview draws the pieces over the sheet,
          including material past the edge, suspension rails, perimeter trim, and seams, unless you turn
          those off.
        </p>
        <p>
          If a scope shows no measurement, the sheet has no scale, the markup sits on an unscaled sheet,
          or setup is missing a measure that product needs. The scope page says which.
        </p>
      </section>

      <section className="prefs-run" aria-labelledby="help-updates">
        <h3 className="prefs-runtitle" id="help-updates">Updates and Settings</h3>
        <p>
          An installed copy checks for an update when it starts, again every four hours, and when you
          return to the window after at least half an hour. Nothing downloads until you ask.
        </p>
        <p>
          When an update is available, Ready to update sits at the bottom of the left side, directly
          above Settings. Click that block to install it. What's new on the same block shows the
          release notes before you install. Restart when the block says the new version is staged.
          Settings, About, has the same check, the version you are on, and problem reports written
          when the app stops. Ctrl+, opens Settings. Ctrl+K opens the command palette.
        </p>
        <p>
          In a browser there are no file dialogs. Full-text search and a second window are desktop-only.
        </p>
      </section>

      <section className="prefs-run" aria-labelledby="help-feedback">
        <h3 className="prefs-runtitle" id="help-feedback">Feedback</h3>
        <p>A few words about what happened, and a screenshot.</p>
        <p>
          <button type="button" className="st-btn" onClick={onFeedback}>Send feedback</button>
        </p>
      </section>
    </div>
  )
}

/** A short note and a pasted screenshot. Same card as the release notes. */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [note, setNote] = useState('')
  const [shot, setShot] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  useReturnFocus(true)
  const trap = useFocusTrap<HTMLDivElement>(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))
    if (item === undefined) return
    const file = item.getAsFile()
    if (file === null) return
    e.preventDefault()
    const reader = new FileReader()
    reader.onload = () => {
      setShot(typeof reader.result === 'string' ? reader.result : null)
      setStatus(null)
    }
    reader.readAsDataURL(file)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const words = note.trim()
    if (words === '') {
      setStatus(null)
      setProblem('Write a few words about what happened.')
      return
    }
    if (shot === null) {
      setStatus(null)
      setProblem('Paste a screenshot.')
      return
    }
    setProblem(null)
    submitFeedback(words, shot)
    setStatus('Not sent. This copy cannot deliver feedback yet.')
  }

  return (
    <div
      className="feedback"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="feedback-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        ref={trap}
      >
        <h2 id="feedback-title">Feedback</h2>
        <form className="feedback-form" onSubmit={onSubmit}>
          <label className="prefs-label" htmlFor="help-note">What happened</label>
          <textarea
            id="help-note"
            className="prefs-note"
            rows={3}
            value={note}
            placeholder="The scale on A-101 stayed blank after I calibrated."
            autoFocus
            onChange={(e) => { setNote(e.target.value); setStatus(null) }}
          />
          <span className="prefs-label" id="help-shot-label">Screenshot</span>
          <div
            className="prefs-shot"
            tabIndex={0}
            role="group"
            aria-labelledby="help-shot-label"
            onPaste={onPaste}
          >
            {shot === null
              ? <span className="prefs-desc">Paste a screenshot.</span>
              : <img src={shot} alt="Pasted screenshot" />}
          </div>
          {shot !== null && (
            <button type="button" className="st-btn subtle" onClick={() => { setShot(null); setStatus(null) }}>
              Remove screenshot
            </button>
          )}
          {problem !== null && <p className="prefs-feedbackstatus" role="alert">{problem}</p>}
          {status !== null && <p className="prefs-feedbackstatus" role="status">{status}</p>}
          <div className="feedback-actions">
            <button type="submit" className="st-btn">Send feedback</button>
            <button type="button" className="st-btn subtle" onClick={onClose}>Close</button>
          </div>
        </form>
      </div>
    </div>
  )
}
