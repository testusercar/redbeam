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
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const accent = await invoke<SystemAccent>('system_accent')
    // Validated before it is stamped: these values come from the registry, and
    // a malformed one written into a custom property would take out every
    // colour that resolves through it rather than just itself.
    if (!isHex(accent.light2) || !isHex(accent.light1)) return null
    const root = document.documentElement
    root.style.setProperty('--rb-accent', accent.light2)
    root.style.setProperty('--rb-accent-2', accent.light1)
    return accent
  } catch {
    return null
  }
}
