/**
 * The only decision in the crash reporter worth testing on its own: when NOT
 * to write.
 *
 * The rest is a call across the bridge and a file write, both of which fail by
 * doing nothing, which is the correct behaviour for something invoked from an
 * error handler. This is the part that has a judgement in it — and it is the
 * part that turns a crash loop into a folder somebody has to clean out.
 */
import { describe, expect, it } from 'vitest'
import { isRepeat } from './crash.js'

const at = (message: string, ms: number) => ({ message, at: ms })

describe('isRepeat', () => {
  it('writes the first occurrence of anything', () => {
    expect(isRepeat('boom', 1_000, null)).toBe(false)
  })

  it('suppresses the same failure moments later', () => {
    // A failing render remounts and throws again; a rejected promise in a
    // retry loop fires every few hundred milliseconds. Twenty copies of one
    // stack teach nothing the first did not.
    expect(isRepeat('boom', 1_500, at('boom', 1_000))).toBe(true)
  })

  it('writes a DIFFERENT failure immediately', () => {
    // The second error is often the informative one — the first knocks
    // something over and the second says what fell. Suppressing by time alone
    // would lose it.
    expect(isRepeat('crunch', 1_500, at('boom', 1_000))).toBe(false)
  })

  it('writes the same failure again once the window has passed', () => {
    // The same error an hour later is a second incident, not an echo, and a
    // reporter that stayed quiet would hide that it is recurring.
    expect(isRepeat('boom', 1_000 + 10_001, at('boom', 1_000))).toBe(false)
  })

  it('treats the boundary as still inside the window', () => {
    expect(isRepeat('boom', 1_000 + 9_999, at('boom', 1_000))).toBe(true)
  })
})
