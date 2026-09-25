import { describe, expect, it } from 'vitest'
import { nestingChoiceCopy } from './NestingChoice.js'

describe('nestingChoiceCopy', () => {
  it('names the parent and offers both openings', () => {
    const copy = nestingChoiceCopy('Bid Package')
    expect(copy.title).toMatch(/inside a REDBEAM project/)
    expect(copy.body).toContain('Bid Package')
    expect(copy.parent).toBe('Open Bid Package')
    expect(copy.own).toMatch(/on its own/)
  })
})
