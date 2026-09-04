/**
 * Every class a component names has a rule somewhere.
 *
 * A className with no stylesheet behind it fails silently: the element draws
 * as whatever the webview does by default, which on this ground is a grey
 * native button or a run of unstyled text. Three of these shipped in one
 * season — `hlink` (the "Commit" and "Show layout" controls), `act` (the
 * BOM's "save report" and the scale picker's "Apply"), `wswarnstack` — and
 * each read, to anyone looking, as a control from a different application.
 * Nothing reports an unmatched selector; this does.
 *
 * Only the sheets this app loads count as definitions: styles.css, the
 * shell, the palette, and the vendored primitives. The check is on the
 * TOKEN, not the selector, so a class that only ever appears compound
 * (`.wssection > h3 .grow`) still passes — the point is that someone wrote a
 * rule with that name in mind.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

const SHEETS = [
  'styles.css', 'shell/shell.css', 'palette/palette.css', 'settings/settings.css',
  'ads/primitives.css', 'theme/redbeam.css',
]

/**
 * Classes that are hooks for code, not for style, and are meant to have no
 * rule. Each entry says why, because the default answer is "write the rule".
 */
const HOOKS = new Set<string>([
  // Names what the title bar's "open another document" button IS, beside the
  // `.titleicon` shape it shares with the panel toggle. titleBar.test.ts
  // asserts the pair; the identity deliberately carries no style of its own.
  'tabadd',
])

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'src-tauri') continue
      yield* walk(p)
    } else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) {
      yield p
    }
  }
}

/** The static class tokens in every `className=` on a file. */
function classTokens(src: string): Set<string> {
  const out = new Set<string>()
  const add = (text: string) => {
    for (const t of text.split(/\s+/)) {
      if (/^[a-zA-Z][\w-]*$/.test(t)) out.add(t)
    }
  }
  // A plain string attribute.
  for (const m of src.matchAll(/className="([^"]*)"/g)) add(m[1] ?? '')
  // An expression: take only its string literals and the static segments of
  // its template literals, never the identifiers around them — and not a
  // literal being COMPARED or PASSED (`mode === 'fts5'`, `readBool(x, 'k')`),
  // which is a value, not a class.
  for (const m of src.matchAll(/className=\{([\s\S]*?)\}(?=\s|>|\/)/g)) {
    const expr = m[1] ?? ''
    for (const s of expr.matchAll(/'([^']*)'|"([^"]*)"/g)) {
      // Decided per literal, AFTER pairing its quotes: a lookbehind that
      // refused the opening quote of a compared literal went on to pair its
      // closing quote with the next literal's opening one and lost a class.
      const before = expr.slice(0, s.index).trimEnd()
      if (/(?:[=!]=|[(,])$/.test(before)) continue
      add(s[1] ?? s[2] ?? '')
    }
    for (const t of expr.matchAll(/`([^`]*)`/g)) {
      add((t[1] ?? '').replace(/\$\{[^}]*\}/g, ' '))
    }
  }
  return out
}

function definedClasses(): Set<string> {
  const out = new Set<string>()
  for (const sheet of SHEETS) {
    const css = readFileSync(join(HERE, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) out.add(m[1] ?? '')
  }
  return out
}

describe('class names', () => {
  const defined = definedClasses()

  it('parses static tokens out of every className form', () => {
    const tokens = classTokens(`
      <a className="one two" />
      <b className={\`three\${x ? ' four' : ''}\`} />
      <c className={cond ? 'five' : 'six seven'} />
      <d className={\`eight \${kind}\`} />
      <e className={mode === 'value' ? 'nine' : read(specs, 'key')} />
    `)
    expect([...tokens].sort()).toEqual(['eight', 'five', 'four', 'nine', 'one', 'seven', 'six', 'three', 'two'])
    expect(tokens.has('x')).toBe(false)
    expect(tokens.has('kind')).toBe(false)
    expect(tokens.has('value')).toBe(false)
    expect(tokens.has('key')).toBe(false)
  })

  for (const file of walk(HERE)) {
    it(`${relative(HERE, file)} names only classes a stylesheet defines`, () => {
      const missing = [...classTokens(readFileSync(file, 'utf8'))]
        .filter((c) => !defined.has(c) && !HOOKS.has(c))
        .sort()
      expect(
        missing,
        `no rule in ${SHEETS.join(', ')} for:\n  .${missing.join('\n  .')}\n`
        + 'Write the rule, or list the class in HOOKS with the reason it needs none.',
      ).toEqual([])
    })
  }
})
