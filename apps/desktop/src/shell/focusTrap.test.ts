import { describe, expect, it } from 'vitest'
import { cycle } from './focusTrap.js'

describe('cycle', () => {
  it('moves forward one control at a time', () => {
    expect(cycle(4, 0, false)).toBe(1)
    expect(cycle(4, 2, false)).toBe(3)
  })

  it('wraps from the last control to the first', () => {
    expect(cycle(4, 3, false)).toBe(0)
  })

  it('wraps from the first control to the last going backwards', () => {
    expect(cycle(4, 0, true)).toBe(3)
    expect(cycle(4, 2, true)).toBe(1)
  })

  /** Focus on the scrim, or on nothing: Tab enters at the top, Shift+Tab at the bottom. */
  it('enters the dialog from outside it', () => {
    expect(cycle(4, -1, false)).toBe(0)
    expect(cycle(4, -1, true)).toBe(3)
    expect(cycle(4, 9, false)).toBe(0)
  })

  it('has nowhere to go in an empty dialog', () => {
    expect(cycle(0, -1, false)).toBe(-1)
  })

  it('stays put on a dialog with one control', () => {
    expect(cycle(1, 0, false)).toBe(0)
    expect(cycle(1, 0, true)).toBe(0)
  })
})
