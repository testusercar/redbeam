import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isReturnable } from './returnFocus.js'

const el = (tagName: string, isConnected = true) => ({ tagName, isConnected, focus() {} })

describe('isReturnable', () => {
  it('accepts the control that was focused', () => {
    expect(isReturnable(el('BUTTON'))).toBe(true)
    expect(isReturnable(el('INPUT'))).toBe(true)
  })

  /**
   * `body` is not a place anyone was — it is what is left when nothing has
   * focus. Remembering it and "restoring" to it is the bug, not the fix.
   */
  it('refuses body, and nothing at all', () => {
    expect(isReturnable(el('BODY'))).toBe(false)
    expect(isReturnable(null)).toBe(false)
    expect(isReturnable(undefined)).toBe(false)
  })

  /**
   * The row that opened a dialog can be the row the dialog deleted. Focusing a
   * detached element silently moves focus to body — exactly what this avoids.
   */
  it('refuses an element that has since been removed', () => {
    expect(isReturnable(el('BUTTON', false))).toBe(false)
  })
})

/**
 * Closing an overlay left `document.activeElement` on body: the overlay's own
 * focused control had just been unmounted and nothing claimed what it left
 * behind. Invisible with a mouse; with a keyboard every Escape cost you your
 * place, because the next Tab started at the top of the document however far
 * into the sheet list you were.
 */
describe('every overlay returns focus', () => {
  const read = (name: string) =>
    readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

  for (const [file, where] of [
    ['./palette/CommandPalette.tsx', 'the command palette'],
    ['./search/SearchPanel.tsx', 'the find drawer'],
    ['./settings/SettingsPanel.tsx', 'the settings view'],
    // Not Workspace.tsx: the dialog layer it held is gone. What used to be
    // dialogs are panes and panel levels now, which are not left and so
    // have no focus to return.
  ] as const) {
    it(`${where} does`, () => {
      const source = read(file)
      expect(source, 'does not import the hook').toContain("returnFocus.js'")
      expect(source, 'imports the hook but never calls it').toMatch(/useReturnFocus\(/)
    })
  }
})
