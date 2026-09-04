/**
 * The two bits of the problem-reports row that turn stored data into something
 * a person can act on: when it happened, and what kind of failure it was.
 *
 * Both are shown to somebody deciding whether the report in front of them is
 * the one they remember, so both have to degrade honestly on data that is not
 * what was expected.
 */
import { describe, expect, it } from 'vitest'
import { reportKind, reportWhen } from './DiagnosticsRow.js'

describe('reportWhen', () => {
  it('turns the stored seconds into a time somebody can compare', () => {
    // The file stores unix seconds with a trailing note; the row shows a date.
    expect(reportWhen('1757000000 (unix seconds)')).toContain('2025')
  })

  it('says the time is unknown rather than inventing 1970', () => {
    // A report from an older build, or one whose header was truncated. "01/01/1970"
    // reads as a real timestamp and sends somebody looking for a crash that
    // never happened.
    expect(reportWhen('')).toBe('unknown time')
    expect(reportWhen('not a number')).toBe('unknown time')
    expect(reportWhen('0')).toBe('unknown time')
  })
})

describe('reportKind', () => {
  it('says what happened in words, not in a slug', () => {
    // The person reading this is deciding whether to send the file, not
    // debugging it.
    expect(reportKind('rust-panic')).toBe('The app stopped')
    expect(reportKind('render')).toBe('A window failed to draw')
    expect(reportKind('rejection')).toBe('Background work failed')
  })

  it('still says something for a kind it does not know', () => {
    // A report written by a newer build than the one reading it.
    expect(reportKind('something-new')).toBe('Something failed')
  })
})
