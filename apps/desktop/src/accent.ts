/**
 * Stamping the user's Windows accent onto the theme.
 *
 * `theme/redbeam.css` defines `--rb-accent` as Windows' DEFAULT blue. That is a
 * correct answer, not a placeholder — an install where no accent was ever
 * chosen should look like the system too — and it means the app is never
 * waiting on this to paint. When the read comes back, the tokens are replaced
 * and everything keyed to them follows in one repaint.
 *
 * Stamped on `documentElement` rather than written into the sheet, so it beats
 * the `.ads` block on specificity without touching it, and so a second window
 * gets the same values from the same command rather than a copy that could
 * drift.
 */
import { isTauri } from './tauri/window.js'

export interface SystemAccent {
  /** SystemAccentColorLight2 — the accent on a dark ground. */
  light2: string
  /** SystemAccentColorLight1 — hover and pressed. */
  light1: string
  base: string
  /** False when Windows published no palette and its default is in use. */
  from_system: boolean
  /** `palette`, `dwm` or `default` — where the colour came from. */
  source?: 'palette' | 'dwm' | 'default'
}

/** What the last read found, for Settings › About. `'browser'` before any, or outside the desktop. */
let last: SystemAccent | null | 'browser' = 'browser'

/**
 * One line saying where the accent came from, so a wrong colour can be
 * diagnosed from the About page rather than a registry export.
 */
export function accentReport(): { text: string; colour: string | null } {
  if (last === 'browser') return { text: 'Not read here: the browser build paints Windows’ default blue.', colour: null }
  if (last === null) return { text: 'Windows’ default blue. The accent could not be read from Windows.', colour: null }
  const where = last.source === 'dwm' ? 'DWM accent, lightened here' : last.source === 'palette' ? 'theme palette' : 'default'
  return last.from_system
    ? { text: `From Windows (${where}) · ${last.light2}`, colour: last.light2 }
    : { text: 'Windows’ default blue. No accent is set in Windows.', colour: last.light2 }
}

/** `#rrggbb`, and nothing else, ever reaches a style property. */
export function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

/**
 * Ask for the accent and apply it.
 *
 * Never throws: an accent is decoration, and an estimator with a takeoff open
 * does not care that a colour could not be read. Failure leaves Windows'
 * default blue in place, which is a complete way for the app to look.
 */
export async function applySystemAccent(): Promise<SystemAccent | null> {
  if (!isTauri()) return null
  /*
   * Asked more than once. The first read runs at module load, before the
   * Tauri bridge has always answered, and a read that failed there left the
   * default blue on screen for the whole session — Aaron, 2026-09-18: the
   * built Settings page wore blue switches on a machine whose accent is
   * orange. Five tries over ~4s covers a slow start; a read that still
   * fails leaves Windows' default, which is a complete way to look.
   */
  for (let attempt = 0; attempt < 5; attempt++) {
    const accent = await readOnce()
    if (accent !== null) return accent
    await new Promise((r) => setTimeout(r, 250 * 2 ** attempt))
  }
  last = null
  return null
}

/** One read of the accent, stamped when it is well-formed. Null on any failure. */
async function readOnce(): Promise<SystemAccent | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const accent = await invoke<SystemAccent>('system_accent')
    // Validated before it is stamped: these values come from the registry, and
    // a malformed one written into a custom property would take out every
    // colour that resolves through it rather than just itself.
    if (!isHex(accent.light2) || !isHex(accent.light1)) return null
    /*
     * Stamped on the root AND the body. `theme/redbeam.css` sets the token
     * inside the `.ads` block, which is the body — and a custom property set
     * on the body shadows one inherited from the root for everything inside
     * it. Stamping the root alone made `getComputedStyle(html)` report the
     * user's accent while every control in the app kept Windows' default
     * blue. Aaron, 2026-09-18: "use the windows accent color for all accent
     * colored items."
     */
    for (const el of [document.documentElement, document.body]) {
      el.style.setProperty('--rb-accent', accent.light2)
      el.style.setProperty('--rb-accent-2', accent.light1)
    }
    last = accent
    return accent
  } catch {
    return null
  }
}

/**
 * Re-read when the window comes back: an accent changed in Windows Settings
 * mid-session lands on the next return to the app rather than the next
 * launch. Cheap, and idempotent.
 */
export function followSystemAccent(): void {
  if (!isTauri()) return
  window.addEventListener('focus', () => { void readOnce() })
}
