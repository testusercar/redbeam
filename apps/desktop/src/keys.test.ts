import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isTextEntry, survivesTextEntry } from './keys.js'

const el = (tagName: string, contentEditable = false) =>
  ({ tagName, isContentEditable: contentEditable }) as unknown as EventTarget

describe('isTextEntry', () => {
  it('recognises the places a person types', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isTextEntry(el(tag)), tag).toBe(true)
    }
    expect(isTextEntry(el('DIV', true))).toBe(true)
  })

  it('does not claim the drawing, a button, or nothing at all', () => {
    expect(isTextEntry(el('CANVAS'))).toBe(false)
    expect(isTextEntry(el('BUTTON'))).toBe(false)
    expect(isTextEntry(el('DIV'))).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})

describe('survivesTextEntry', () => {
  const key = (k: string, mod = false) => ({ key: k, ctrlKey: mod, metaKey: false })

  it('keeps the shortcuts that open somewhere else', () => {
    expect(survivesTextEntry(key('Escape'))).toBe(true)
    expect(survivesTextEntry(key(',', true))).toBe(true)
    expect(survivesTextEntry(key('f', true))).toBe(true)
    expect(survivesTextEntry(key('F', true))).toBe(true)
  })

  /**
   * These are the ones that took a keystroke away from the field, because the
   * handler called preventDefault on its way past. Typing "area" into the
   * sheet filter switched the tool three times and landed on Cutout.
   */
  it('gives back everything that edits, selects, deletes or draws', () => {
    for (const k of ['a', 'x', 'l', 'c', 'v', 's', 'k', 'Enter', 'Delete', 'Backspace']) {
      expect(survivesTextEntry(key(k)), k).toBe(false)
    }
    for (const k of ['a', 'c', 'v', 'z', 'y']) {
      expect(survivesTextEntry(key(k, true)), `Ctrl+${k}`).toBe(false)
    }
  })
})

describe('the workspace key handler', () => {
  it('asks before doing anything else', () => {
    const source = readFileSync(fileURLToPath(new URL('./Workspace.tsx', import.meta.url)), 'utf8')
    const at = source.indexOf('const onKey = (e: KeyboardEvent) => {')
    expect(at, 'the key handler has moved').toBeGreaterThan(-1)
    const guard = source.indexOf('if (isTextEntry(e.target) && !survivesTextEntry(e)) return', at)
    expect(guard, 'the guard is gone').toBeGreaterThan(-1)
    // Before the first shortcut, or it is not a guard.
    expect(guard).toBeLessThan(source.indexOf('e.preventDefault()', at))
  })
})
