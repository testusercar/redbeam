/**
 * REDBEAM's colour remap must outrank every selector the design system uses
 * to state its own dark palette.
 *
 * `redbeam.css` re-points `--ads-bg`, `--ads-ink-3`, `--ads-link` and the rest
 * at REDBEAM's values. For weeks that block was `.ads { … }` — specificity
 * 0,1,0 — while `tokens.css` sets its dark steps on `.ads[data-theme="dark"]`
 * (0,2,0) and `.ads:not([data-theme="light"]):not([data-theme="dark"])`
 * (0,3,0), and `main.tsx` stamps `data-theme="dark"` on the body. The system's
 * dark block therefore won, silently: every `--ads-*` consumer drew Warm
 * Graphite's #191918 ground and a blue focus ring, while the `--rb-*`
 * consumers beside them drew REDBEAM's cool grey and red. Nothing failed.
 * Two palettes shared one panel and the difference was small enough to
 * survive a design review.
 *
 * The rule this holds: any selector `tokens.css` uses to set a colour token,
 * outside the print register, must also appear on the remap block — so a
 * re-sync of the vendored system that adds a stamp fails here rather than in
 * a screenshot nobody compares.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

interface Block { selector: string, body: string, atRule: string | null }

/**
 * Every `{…}` block with its selector and the at-rule it sits under. A hand
 * scan rather than a regex, because a `/g` regex cannot use the brace it
 * consumed as the next boundary and skips nested at-rule blocks — which is
 * where the OS-preference selector lives.
 */
function blocks(css: string): Block[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Block[] = []
  const stack: string[] = []
  let selector = ''
  let body = ''
  let depth = 0
  for (const ch of src) {
    if (ch === '{') {
      const head = selector.trim()
      if (head.startsWith('@')) { stack.push(head); selector = ''; depth++; continue }
      stack.push(head)
      selector = ''
      body = ''
      depth++
      continue
    }
    if (ch === '}') {
      const head = stack.pop() ?? ''
      depth--
      if (!head.startsWith('@')) {
        out.push({ selector: head, body, atRule: stack.find((s) => s.startsWith('@')) ?? null })
      }
      body = ''
      selector = ''
      continue
    }
    if (depth > 0 && !stack[stack.length - 1]?.startsWith('@')) body += ch
    else selector += ch
  }
  return out
}

const split = (selector: string) => selector.split(',').map((s) => s.trim()).filter(Boolean)

describe('the colour remap', () => {
  const tokens = blocks(read('../ads/tokens.css'))
  const theme = blocks(read('./redbeam.css'))

  const remap = theme.find((b) => b.body.includes('--ads-bg:') && b.body.includes('--rb-'))
  const remapSelectors = remap === undefined ? [] : split(remap.selector)

  it('exists', () => {
    expect(remap, 'redbeam.css no longer re-points --ads-bg').toBeDefined()
  })

  /**
   * The print register is the one deliberate exception: paper is light, and
   * a REDBEAM print would be a design exercise nobody has done. Everything
   * else that stamps `--ads-bg` has to be matched.
   */
  it('matches every selector tokens.css uses to set the dark palette', () => {
    const stamps = tokens
      .filter((b) => b.body.includes('--ads-bg:') && b.atRule !== '@media print')
      .flatMap((b) => split(b.selector))
    expect(stamps.length).toBeGreaterThanOrEqual(3)
    for (const s of stamps) {
      expect(remapSelectors, `tokens.css sets colours on \`${s}\` and the remap does not cover it`)
        .toContain(s)
    }
  })

  /*
   * This asserted the opposite until 2026-09-03: the link had to be RED and
   * explicitly "not the system blue", because REDBEAM's accent was its own.
   * The shell is Windows' material now, and an accent Windows did not choose
   * is the one thing that still reads as foreign — so the link follows
   * `--rb-accent`, which `accent.rs` fills from the user's own palette and
   * which falls back to Windows' default rather than to a colour of ours.
   */
  it('re-points the link colour at the system accent', () => {
    expect(remap?.body).toMatch(/--ads-link:\s*var\(--rb-accent\)/)
  })
})

/**
 * Red has exactly one job left.
 *
 * It used to mean brand AND active navigation AND focus AND danger — four
 * meanings on one colour, which is why replacing it with the system accent
 * touched nineteen rules. Now: the app mark is red, danger is `--rb-bad`, and
 * everything that marks WHERE YOU ARE is the accent Windows chose. Without
 * this the next selected-state rule reaches for `--rb-red` because the token
 * still exists, and the accent quietly stops being the system's.
 */
describe('the red budget', () => {
  const SHEETS = ['../styles.css', '../shell/shell.css', '../palette/palette.css', '../settings/settings.css']

  it('is spent on the app mark and nothing else', () => {
    const offenders: string[] = []
    for (const sheet of SHEETS) {
      const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, '')
      for (const line of css.split('\n')) {
        if (!line.includes('var(--rb-red')) continue
        // The mark itself: a filled square carrying the wordmark.
        if (line.trim() === 'background: var(--rb-red);') continue
        offenders.push(`${sheet}: ${line.trim()}`)
      }
    }
    expect(
      offenders,
      'Red is the app mark only. Use --rb-accent for selection, active state and '
      + 'focus (it follows the user\'s Windows accent), and --rb-bad for danger:\n  '
      + offenders.join('\n  '),
    ).toEqual([])
  })
})
