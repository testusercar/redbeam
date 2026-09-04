/**
 * The app must never be see-through by accident.
 *
 * The window is created with `"transparent": true` so DWM can paint Mica
 * behind it. Transparency and BACKDROP are separate things: on Windows 10 the
 * Mica request is a silent no-op and the window stays transparent. So any
 * surface that becomes translucent without checking first is a hole onto the
 * user's desktop on every machine that cannot draw the backdrop — and the app
 * would look broken rather than plain.
 *
 * `backdrop.ts` sets `data-backdrop` only after Rust confirms the effect
 * applied. This holds the stylesheet to the other half of that bargain: every
 * rule that removes an opaque ground is gated on the attribute. It is a source
 * assertion for the same reason `classnames.test.ts` is — nothing at runtime
 * reports a surface that is transparent when it should not be, and the machine
 * this is authored on is the one machine where the bug cannot reproduce.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { BACKDROP_ATTR } from './backdrop.js'

// fileURLToPath, not `url.pathname`: this repo lives under "Dev Projects".
const HERE = dirname(fileURLToPath(import.meta.url))
const SHEETS = ['styles.css', 'shell/shell.css', 'theme/redbeam.css', 'ads/tokens.css']

/** Every rule in the app's own sheets, as `selector` + `body`, comments gone. */
function rules(): Array<{ selector: string, body: string }> {
  const out: Array<{ selector: string, body: string }> = []
  for (const sheet of SHEETS) {
    const css = readFileSync(join(HERE, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      out.push({ selector: (m[1] ?? '').trim(), body: (m[2] ?? '').trim() })
    }
  }
  return out
}

/** Declarations that remove a surface's own ground. */
const CLEARS_GROUND = /(?:^|;)\s*background(?:-color)?\s*:\s*(transparent|none)\s*(?:;|$)/

describe('the system backdrop', () => {
  const all = rules()

  it('reads the attribute the stylesheet is written against', () => {
    // If these drift apart the gate silently never matches, and the app is
    // simply always opaque — a failure that looks like success.
    expect(BACKDROP_ATTR).toBe('data-backdrop')
    const gated = all.filter((r) => r.selector.includes(BACKDROP_ATTR))
    expect(gated.length).toBeGreaterThan(0)
  })

  it('never clears a surface ground outside the gate', () => {
    const ungated = all
      .filter((r) => CLEARS_GROUND.test(r.body))
      .filter((r) => !r.selector.includes(BACKDROP_ATTR))
      // A rule that is only ever a child of something painted is not a window
      // ground. Only the shell's own full-window surfaces matter here.
      //
      // `.rail` and `.pane` are gone — they merged into `.side`. `.startscreen`
      // was added after it was missed: the start screen is a full-window
      // surface too, and clearing its ground ungated made the FIRST screen
      // anyone sees a hole onto the desktop on any machine without Mica.
      .filter((r) => /(^|[\s,])(body|html|\.shellapp|\.titlebar|\.side|\.workspace|\.startscreen)\b/.test(r.selector))
      .map((r) => r.selector)
    expect(
      ungated,
      'These clear a window-level ground without checking that a backdrop exists.\n'
      + 'On a machine with no Mica the window is still transparent, so this is a\n'
      + 'hole onto the desktop:\n  ' + ungated.join('\n  '),
    ).toEqual([])
  })

  /**
   * The drawing is not decoration. A sheet composited over the wallpaper would
   * let whatever is on someone's desktop modulate the contrast between a markup
   * and the paper beneath it, in a tool whose job is judging what is on the
   * sheet.
   */
  it('never lets the drawing go translucent', () => {
    const viewport = all.filter((r) => /(^|[\s,])\.viewport\b/.test(r.selector))
    expect(viewport.length).toBeGreaterThan(0)
    for (const r of viewport) {
      expect(CLEARS_GROUND.test(r.body), `${r.selector} clears the drawing's ground`).toBe(false)
      expect(r.selector.includes(BACKDROP_ATTR), `${r.selector} veils the drawing`).toBe(false)
    }
  })
})
