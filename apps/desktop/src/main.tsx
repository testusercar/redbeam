import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applySystemAccent } from './accent.js'
import { applyBackdropClass } from './backdrop.js'
import { installCrashHandlers } from './crash.js'
import App from './App.js'
import './styles.css'

/**
 * Mount the design system.
 *
 * `class="ads"` is what scopes every primitive in the system — its selectors
 * are all `.ads .ads-thing`, so without this the primitives layer loads and
 * matches nothing.
 *
 * `data-theme` goes on BOTH <html> and the surface root, per standards/09:
 * the root scroller, the viewport scrollbar and the overscroll canvas follow
 * the html stamp, and without it choosing dark on a light-OS machine leaves a
 * white flash at the edges of every scroll.
 *
 * Dark is the default rather than the system's light because of what this app
 * renders: the sheet is white paper filling most of the window, and chrome
 * that is also near-white competes with it for the eye. That is a REDBEAM
 * decision about its own surface, not a change to the system — both themes are
 * the system's own, fully specified steps.
 */
document.documentElement.setAttribute('data-theme', 'dark')
document.body.classList.add('ads')
document.body.setAttribute('data-theme', 'dark')

/*
 * The Windows 11 backdrop, if this machine has one.
 *
 * Fired here rather than awaited: nothing below depends on the answer, and the
 * app must not wait on an IPC round trip to draw. Until it resolves — and
 * forever, where there is no backdrop — every surface is opaque, so the app
 * simply appears as it always has.
 */
void applyBackdropClass()

/*
 * And the user's accent, for the same reason and in the same way: fired, not
 * awaited. Until it answers the theme carries Windows' default blue.
 */
void applySystemAccent()

/**
 * The webview's own context menu never belongs to this app.
 *
 * Right-clicking a drawing offered "Save image as / Copy image / Inspect" —
 * the browser showing through, on a canvas where the estimator meant to cancel
 * a tool. Suppressed everywhere except text fields, where a paste menu is
 * genuinely the expected thing, and anywhere that opts in by handling the
 * event itself (the tab strip has its own menu and calls preventDefault, which
 * is not the same as wanting the webview's).
 */
window.addEventListener('contextmenu', (e) => {
  const el = e.target as HTMLElement | null
  const editable = el?.closest('input, textarea, [contenteditable="true"]')
  if (editable === null || editable === undefined) e.preventDefault()
})

/*
 * Before the first render (TH.8).
 *
 * An unhandled rejection thrown while the app is starting is the one nobody
 * ever sees: there is no window yet to show an error boundary in, and the
 * console it logs to closes with the process.
 */
installCrashHandlers()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
