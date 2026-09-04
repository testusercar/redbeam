/**
 * What Windows shows for this window.
 *
 * An estimator works two or three bids at once, each in its own window, and
 * picks between them from the taskbar. The title was `REDBEAM — <project id>`,
 * built in Rust from the id in the window URL — a hash, not a name — so every
 * window read as a variation on "REDBEAM" and hovering the taskbar told you
 * nothing about which job you were about to raise.
 *
 * The PROJECT NAME COMES FIRST for the same reason. A taskbar tooltip and a
 * thumbnail label both truncate from the end, so a title that opens with the
 * app name spends its visible characters saying the one thing every window has
 * in common.
 */

/** The suffix, so every window is still identifiably this app. */
const APP = 'REDBEAM'

export type WindowRole = 'main' | 'context'

/**
 * `Barclays Toronto — REDBEAM`, or `Barclays Toronto — REDBEAM (sheet)` for a
 * popped-out context window.
 *
 * The role is marked because two windows on the same project are otherwise
 * identical in the taskbar, and the one you want back is usually the main one.
 */
export function windowTitle(projectName: string | null, role: WindowRole = 'main'): string {
  const name = projectName?.trim() ?? ''
  // No project yet: the start screen is not "— REDBEAM" attached to nothing.
  if (name === '') return APP
  return role === 'context' ? `${name} — ${APP} (sheet)` : `${name} — ${APP}`
}
