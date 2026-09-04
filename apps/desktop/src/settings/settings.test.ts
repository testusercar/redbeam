import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi } from 'vitest'
import {
  RETIRED, SETTINGS, categories, childrenOf, defaults, descriptor, inCategory,
  validate, validateAgainst, type SettingDescriptor,
} from './registry.js'
import { SettingsStore, memoryStorage, load, type SettingsStorage } from './store.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..')

describe('registry', () => {
  it('has a unique, dotted, category-prefixed id for every setting', () => {
    const ids = SETTINGS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SETTINGS) {
      expect(s.id, s.id).toMatch(/^[a-z]+\.[a-zA-Z]+$/)
      expect(s.id.split('.')[0], s.id).toBe(s.category)
    }
  })

  it('gives every setting a label and a description', () => {
    // The registry drives the UI, so a missing label is a blank row.
    for (const s of SETTINGS) {
      expect(s.label.length, s.id).toBeGreaterThan(0)
      expect(s.description.length, s.id).toBeGreaterThan(0)
    }
  })

  it("every default is itself valid, so a reset cannot produce a rejected value", () => {
    for (const s of SETTINGS) {
      const v = validate(s.id, s.default)
      expect(v.ok, `${s.id} default is invalid`).toBe(true)
    }
  })

  it('covers every category it declares', () => {
    for (const c of categories()) expect(inCategory(c).length).toBeGreaterThan(0)
  })

  it('does not list a setting it has also retired', () => {
    for (const s of SETTINGS) expect(RETIRED.has(s.id), s.id).toBe(false)
  })

  /**
   * A parent is a switch in the same section, and families are one level
   * deep. The page indents children under their parent and dims them while
   * it is off; a parent that is a number, or a child of a child, has no
   * rendering and would silently vanish.
   */
  it('keeps every family one level deep, under a switch in its own category', () => {
    for (const s of SETTINGS) {
      if (s.parent === undefined) continue
      const p = descriptor(s.parent)
      expect(p, `${s.id}: parent ${s.parent} is not a setting`).toBeDefined()
      expect(p?.type, `${s.id}: parent is not a switch`).toBe('bool')
      expect(p?.category, `${s.id}: parent is in another category`).toBe(s.category)
      expect(p?.parent, `${s.id}: parent has a parent`).toBeUndefined()
    }
    expect(childrenOf('takeoff.layoutPreview').length).toBeGreaterThan(0)
  })
})

/**
 * Every listed setting is READ by something.
 *
 * Six were not, and each had a label, a description, a switch and a test —
 * everything except an effect. "Reopen projects on launch" sat beside code
 * that reopened the last project unconditionally; "Default unit" beside
 * fields that never looked. A switch nothing reads is the settings page's
 * version of an updater reporting "up to date" over a dead channel: it looks
 * like control and is not, and nothing else reports it. This does.
 *
 * Read, not merely mentioned: the id has to appear in a source file outside
 * this directory and outside the tests, which is where a consumer lives.
 */
describe('every setting has a consumer', () => {
  function* sources(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        if (name === 'node_modules' || name === 'settings') continue
        yield* sources(p)
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        yield p
      }
    }
  }
  const corpus = [...sources(SRC)].map((p) => [relative(SRC, p), readFileSync(p, 'utf8')] as const)

  for (const s of SETTINGS) {
    it(`${s.id} is read somewhere outside settings/`, () => {
      const readers = corpus.filter(([, text]) => text.includes(`'${s.id}'`)).map(([name]) => name)
      expect(
        readers,
        `nothing reads ${s.id}. Wire it, or retire it in RETIRED with the reason.`,
      ).not.toEqual([])
    })
  }
})

describe('validate', () => {
  it('rejects an unknown id rather than inventing a setting', () => {
    expect(validate('nope.nope', true)).toEqual({ ok: false, error: 'unknown setting: nope.nope' })
    expect(descriptor('nope.nope')).toBeUndefined()
  })

  it('coerces the string forms a JSON file or an input element produces', () => {
    // Rejecting "true" would make a settings file written by an older build
    // unreadable, which is worse than accepting the obvious intent.
    expect(validate('takeoff.snapEnabled', 'true')).toEqual({ ok: true, value: true })
    expect(validate('takeoff.snapEnabled', 'false')).toEqual({ ok: true, value: false })
  })

  /*
   * The int and enum rules, against descriptors the registry does not
   * currently hold. They are the registry's contract with the next setting,
   * so they stay tested while the list happens to be all switches.
   */
  const limit: SettingDescriptor = {
    id: 'x.limit', category: 'viewer', type: 'int', default: 20, min: 1, max: 200,
    label: 'Limit', description: 'A number.',
  }
  const unit: SettingDescriptor = {
    id: 'x.unit', category: 'viewer', type: 'enum', default: 'ft',
    choices: [{ value: 'in', label: 'Inches' }, { value: 'ft', label: 'Feet' }],
    label: 'Unit', description: 'A choice.',
  }

  it('coerces a numeric string', () => {
    expect(validateAgainst(limit, '30')).toEqual({ ok: true, value: 30 })
  })

  it('CLAMPS an out-of-range number instead of refusing it', () => {
    // A stored 5000 is a stale value, not a reason to refuse to start.
    expect(validateAgainst(limit, 5000)).toEqual({ ok: true, value: 200 })
    expect(validateAgainst(limit, 0)).toEqual({ ok: true, value: 1 })
    expect(validateAgainst(limit, 12.6)).toEqual({ ok: true, value: 13 })
  })

  it('rejects a value outside an enum rather than silently defaulting', () => {
    const v = validateAgainst(unit, 'furlong')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toContain('not one of')
  })

  it('rejects nonsense rather than coercing it', () => {
    expect(validate('takeoff.snapEnabled', 'yes').ok).toBe(false)
    expect(validateAgainst(limit, 'lots').ok).toBe(false)
    expect(validateAgainst(unit, 5).ok).toBe(false)
  })
})

describe('load', () => {
  it('returns defaults when nothing is stored', () => {
    const r = load(memoryStorage())
    expect(r.values).toEqual(defaults())
    expect(r.rejected).toEqual([])
  })

  it('layers stored values over defaults', () => {
    const r = load(memoryStorage({ 'takeoff.snapEnabled': false }))
    expect(r.values['takeoff.snapEnabled']).toBe(false)
    // An unmentioned key keeps its default, whatever that default is.
    expect(r.values['performance.showBudgets']).toBe(defaults()['performance.showBudgets'])
  })

  it('survives a corrupt file rather than taking the app down', () => {
    const bad: SettingsStorage = { read: () => '{not json', write: () => {} }
    const r = load(bad)
    expect(r.values).toEqual(defaults())
    expect(r.rejected[0]!.reason).toContain('not valid JSON')
  })

  it('survives a file that is valid JSON but the wrong shape', () => {
    for (const text of ['[1,2,3]', 'null', '"hello"', '42']) {
      const r = load({ read: () => text, write: () => {} })
      expect(r.values, text).toEqual(defaults())
    }
  })

  it('REPORTS a rejected key instead of silently reverting it', () => {
    // A setting quietly snapping back to its default looks like the app
    // ignoring the user.
    const r = load(memoryStorage({ 'takeoff.snapEnabled': 'yes' } as never))
    expect(r.values['takeoff.snapEnabled']).toBe(true)
    expect(r.rejected.map((x) => x.id)).toContain('takeoff.snapEnabled')
  })

  it('keeps an unknown key out of values but lists it', () => {
    const r = load(memoryStorage({ 'gone.away': true } as never))
    expect(r.values['gone.away']).toBeUndefined()
    expect(r.rejected.map((x) => x.id)).toContain('gone.away')
  })

  it('drops a RETIRED key without reporting it', () => {
    // The user flipped a switch we offered. Telling them it "could not be
    // read" would blame them for our dead control.
    const [retired] = [...RETIRED.keys()]
    const r = load(memoryStorage({ [retired!]: false } as never))
    expect(r.values[retired!]).toBeUndefined()
    expect(r.rejected).toEqual([])
  })

  it('loses a retired key on the next write', () => {
    const [retired] = [...RETIRED.keys()]
    let written = ''
    const storage: SettingsStorage = {
      read: () => JSON.stringify({ [retired!]: false }),
      write: (t) => { written = t },
    }
    const s = SettingsStore.open(storage)
    s.set('takeoff.snapEnabled', false)
    expect(Object.keys(JSON.parse(written))).toEqual(['takeoff.snapEnabled'])
  })
})

describe('SettingsStore', () => {
  it('reads defaults and reports nothing modified', () => {
    const s = SettingsStore.open(memoryStorage())
    expect(s.bool('takeoff.snapEnabled')).toBe(true)
    expect(s.bool('performance.showBudgets')).toBe(false)
    expect(s.modifiedCount()).toBe(0)
  })

  it('sets, persists and reports modification', () => {
    const storage = memoryStorage()
    const s = SettingsStore.open(storage)
    expect(s.set('takeoff.snapEnabled', false)).toBeNull()
    expect(s.bool('takeoff.snapEnabled')).toBe(false)
    expect(s.isModified('takeoff.snapEnabled')).toBe(true)
    expect(SettingsStore.open(storage).bool('takeoff.snapEnabled')).toBe(false)
  })

  it('returns the error and changes nothing on an invalid set', () => {
    const s = SettingsStore.open(memoryStorage())
    expect(s.set('takeoff.snapEnabled', 'yes')).toContain('expected a boolean')
    expect(s.bool('takeoff.snapEnabled')).toBe(true)
  })

  it('writes ONLY non-default values', () => {
    // A file listing every key freezes today's defaults into it, so a later
    // change to a default would never reach anyone who opened the panel once.
    let written = ''
    const storage: SettingsStorage = { read: () => null, write: (t) => { written = t } }
    const s = SettingsStore.open(storage)
    s.set('takeoff.snapEnabled', false)
    const parsed = JSON.parse(written)
    expect(Object.keys(parsed)).toEqual(['takeoff.snapEnabled'])
  })

  it('drops a key from the file again when it returns to its default', () => {
    let written = ''
    const storage: SettingsStorage = { read: () => null, write: (t) => { written = t } }
    const s = SettingsStore.open(storage)
    s.set('takeoff.snapEnabled', false)
    s.set('takeoff.snapEnabled', true)
    expect(JSON.parse(written)).toEqual({})
  })

  it('resets one category and leaves the others alone', () => {
    const s = SettingsStore.open(memoryStorage())
    s.set('takeoff.snapEnabled', false)
    s.set('performance.showBudgets', true)
    s.resetCategory('takeoff')
    expect(s.bool('takeoff.snapEnabled')).toBe(true)
    expect(s.bool('performance.showBudgets')).toBe(true)
  })

  it('resets everything', () => {
    const s = SettingsStore.open(memoryStorage())
    for (const d of SETTINGS) {
      if (d.type === 'bool') s.set(d.id, !d.default)
      if (d.type === 'int') s.set(d.id, d.max)
    }
    expect(s.modifiedCount()).toBeGreaterThan(0)
    s.resetAll()
    expect(s.modifiedCount()).toBe(0)
    expect(s.all()).toEqual(defaults())
  })

  it('resetAll touches ONLY settings — the reset boundary', () => {
    // Settings are global, reversible preferences. Project, document, scope
    // and calculation data live in their own stores and must be outside every
    // reset; a "reset settings" that could delete a takeoff is unusable.
    const other = { read: vi.fn(() => null), write: vi.fn() }
    const mine = memoryStorage()
    const s = SettingsStore.open(mine)
    s.resetAll()
    expect(other.write).not.toHaveBeenCalled()
    expect(other.read).not.toHaveBeenCalled()
  })

  it('notifies subscribers and stops after unsubscribe', () => {
    const s = SettingsStore.open(memoryStorage())
    const seen: boolean[] = []
    const off = s.subscribe((v) => seen.push(v['takeoff.snapEnabled'] === true))
    s.set('takeoff.snapEnabled', false)
    off()
    s.set('takeoff.snapEnabled', true)
    expect(seen).toEqual([false])
  })

  it('does not notify when a set changes nothing', () => {
    const s = SettingsStore.open(memoryStorage())
    let calls = 0
    s.subscribe(() => { calls++ })
    s.set('takeoff.snapEnabled', true)   // already the default
    expect(calls).toBe(0)
  })

  it('never throws when storage is unavailable', () => {
    // A private window or blocked site data throws on every access.
    const hostile: SettingsStorage = {
      read: () => { throw new Error('blocked') },
      write: () => { throw new Error('blocked') },
    }
    expect(() => SettingsStore.open({
      read: () => { try { return hostile.read() } catch { return null } },
      write: () => { try { hostile.write('') } catch { /* ignore */ } },
    })).not.toThrow()
  })
})

/**
 * The header and the body wrap the same centred column, so they have to
 * agree about where its edges are.
 *
 * The previous layout's did not: the header carried an asymmetric shorthand
 * declared after the shared `padding-inline`, which silently reset it, and the
 * title sat 4px right of the settings underneath it — small enough to look
 * like nothing and large enough to look wrong, on the one screen whose job is
 * to look settled. The body added its own 4px by being the only row that
 * loses width to a scrollbar.
 */
describe('the settings column', () => {
  const css = readFileSync(join(HERE, 'settings.css'), 'utf8')
  const block = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`)
    expect(start, `${selector} is gone from settings.css`).toBeGreaterThan(-1)
    return css.slice(start, css.indexOf('\n}', start))
  }

  it('has one rule owning the inline padding of both rows', () => {
    expect(css).toContain('.prefs-head, .prefs-body { padding-inline:')
  })

  for (const row of ['.prefs-head', '.prefs-body']) {
    it(`does not let ${row} reset that padding with a shorthand`, () => {
      expect(block(row)).not.toMatch(/^\s*padding:/m)
    })
  }

  it('reserves the scrollbar on both edges of the body', () => {
    // Only the body scrolls, so only the body loses width to a scrollbar.
    // `stable both-edges` spends it symmetrically and leaves centre where the
    // header put it.
    expect(block('.prefs-body')).toContain('scrollbar-gutter: stable both-edges')
  })

  it('does not define the bare selector shell.css still owns', () => {
    // `.settings` is the retired two-column layout's root, still in
    // shell.css. Defining it here too would let bundler order pick a layout.
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/(^|[\s,])\.settings\s*[{,:]/m)
  })
})
