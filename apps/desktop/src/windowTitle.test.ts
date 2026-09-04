/**
 * The title is read on a taskbar hover, where it is truncated from the end.
 * Everything below is about what survives that truncation.
 */
import { describe, expect, it } from 'vitest'
import { windowTitle } from './windowTitle.js'

describe('windowTitle', () => {
  it('leads with the project, because the tail is what gets cut', () => {
    // "REDBEAM — Barclays Toronto" truncates to "REDBEAM — Barcl…", which is
    // the one thing every window already has in common.
    expect(windowTitle('Barclays Toronto')).toBe('Barclays Toronto — REDBEAM')
    expect(windowTitle('Barclays Toronto').startsWith('Barclays')).toBe(true)
  })

  it('marks a popped-out sheet, since two windows on one project look alike', () => {
    // The one you want back from the taskbar is usually the main one.
    expect(windowTitle('Barclays Toronto', 'context'))
      .toBe('Barclays Toronto — REDBEAM (sheet)')
  })

  it('is just the app name before a project is open', () => {
    // The start screen is not an em dash attached to nothing.
    expect(windowTitle(null)).toBe('REDBEAM')
    expect(windowTitle('')).toBe('REDBEAM')
    expect(windowTitle('   ')).toBe('REDBEAM')
  })
})
