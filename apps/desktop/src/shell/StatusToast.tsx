/**
 * The workspace's status line, shown as a transient over the drawing.
 *
 * There is no status bar in the shell — the design rejected a permanent strip
 * — and for a while there was nothing in its place: `status` was set from
 * thirty call sites and read by the automation bridge alone. A refusal to
 * delete a round, a failed commit, "Create an estimate first" — none of it
 * reached the person who pressed the button. This is where it reaches them.
 *
 * Over the drawing, not the chrome, because that is where the eye is when the
 * message arrives; top-centre because the dock owns the bottom and every menu
 * opens upward from it. A problem stays up long enough to be read twice; a
 * result fades. `role="status"` so a screen reader hears both without being
 * interrupted.
 */
import { useEffect, useState } from 'react'
import { Glyph, TriangleAlert } from './icons.js'
import { statusHold, statusTone } from './statusTone.js'

export function StatusToast({ text, at }: { text: string; at: number }) {
  const [shownAt, setShownAt] = useState(0)
  const tone = statusTone(text)

  // Keyed on WHEN, not what: the same line said twice is two events.
  useEffect(() => {
    if (at === 0) return
    setShownAt(at)
    const timer = setTimeout(() => setShownAt((cur) => (cur === at ? 0 : cur)), statusHold(tone))
    return () => clearTimeout(timer)
  }, [at, tone])

  if (shownAt === 0 || shownAt !== at) return null
  return (
    <div className={`statustoast ${tone}`} role="status" aria-live="polite">
      {tone === 'problem' && <Glyph icon={TriangleAlert} role="row" />}
      <span className="selectable">{text}</span>
    </div>
  )
}
