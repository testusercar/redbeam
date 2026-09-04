/**
 * The two stylesheets must not both define the same bare selector.
 *
 * `styles.css` is the pre-shell component layer and `shell/shell.css` is the
 * shell. Both are loaded app-wide, both use unprefixed class names, and CSS
 * settles equal specificity by source order — which is decided by the bundler,
 * not by either file.
 *
 * This cost an afternoon once. Both files declared a bare `.stage`; the older
 * one said `position: relative` where the shell said `position: absolute;
 * inset: 0`. Inside the shell's grid that collapsed the stage to zero content
 * height, because its only children are absolutely-positioned canvases. The
 * PDF renderer was working perfectly the whole time, painting into a box
 * 240px tall, and nothing anywhere reported an error.
 *
 * The rule is deliberately narrow: only BARE single-class selectors collide
 * dangerously, because a compound selector (`.pane .pagestrip`) already wins on
 * specificity and is a legitimate override. This test would not have caught a
 * specificity mistake — it catches the coin-flip.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// fileURLToPath, not `url.pathname`: this repo lives under "Dev Projects", and
// a raw pathname keeps the %20.
const HERE = dirname(fileURLToPath(import.meta.url))

/** Selectors of the form `.thing` and `.thing:hover` — nothing compound. */
function bareClasses(css: string): Set<string> {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = new Set<string>()
  // A hand scan rather than one regex: a `/g` regex cannot use the brace it
  // consumed as the next match's left boundary, so nested at-rule blocks
  // (`@container { .thing { … } }`) were being skipped — and shell.css puts
  // several rules there.
  let selector = ''
  for (const ch of src) {
    if (ch === '{' || ch === '}') {
      if (ch === '{') addBare(selector, out)
      selector = ''
      continue
    }
    selector += ch
  }
  return out
}

function addBare(block: string, out: Set<string>): void {
  for (const selector of block.split(',')) {
    const s = selector.trim()
    if (s === '' || s.startsWith('@')) continue
    // A bare class: one leading `.name`, then only pseudo-classes or
    // pseudo-elements. Anything with a space, `>`, or a second class is a
    // compound selector and outranks a bare one on its own merits.
    const bare = /^\.([a-zA-Z][\w-]*)((?::{1,2}[\w-]+(?:\([^)]*\))?)*)$/.exec(s)
    if (bare?.[1] !== undefined) out.add(bare[1])
  }
}

describe('stylesheet collisions', () => {
  const shell = readFileSync(join(HERE, 'shell', 'shell.css'), 'utf8')
  const legacy = readFileSync(join(HERE, 'styles.css'), 'utf8')

  it('parses bare selectors and ignores compound ones', () => {
    const found = bareClasses(`
      .alpha { color: red }
      .beta:hover, .gamma::before { color: red }
      .one .two { color: red }
      .three > .four { color: red }
      .five.six { color: red }
      @media (min-width: 1px) { .seven { color: red } }
    `)
    expect([...found].sort()).toEqual(['alpha', 'beta', 'gamma', 'seven'])
  })

  it('has no bare class defined by both styles.css and shell.css', () => {
    const collisions = [...bareClasses(legacy)].filter((c) => bareClasses(shell).has(c)).sort()
    expect(
      collisions,
      `Both stylesheets define these bare selectors, so whichever the bundler `
      + `emits last silently wins:\n  ${collisions.map((c) => `.${c}`).join('\n  ')}\n`
      + `Move the rule into the sheet that owns the component, or make one of `
      + `them compound.`,
    ).toEqual([])
  })

  it('keeps the stage owned by the shell alone', () => {
    // The specific regression: the shell positions the stage absolutely so it
    // fills its grid area. Anything else defining `.stage` can undo that.
    expect(bareClasses(legacy).has('stage')).toBe(false)
    expect(shell).toMatch(/\.stage\s*\{[^}]*position:\s*absolute/)
    expect(shell).toMatch(/\.stage\s*\{[^}]*inset:\s*0/)
  })
})

/**
 * There is no modal layer, in either sheet.
 *
 * `.modal` was a fixed, scrimmed layer at z-index 300 in shell.css, and five
 * surfaces in styles.css were shaped to sit in it. Aaron's rule is that the
 * palette is the only overlay the app has; a `.modal` rule reappearing in
 * either sheet is a dialog on its way back.
 */
describe('the modal layer', () => {
  it('is gone from both sheets', () => {
    for (const sheet of ['./styles.css', './shell/shell.css']) {
      const css = readFileSync(fileURLToPath(new URL(sheet, import.meta.url)), 'utf8')
      expect(css, `${sheet} defines .modal`).not.toMatch(/^\.modal\b/m)
    }
  })
})
