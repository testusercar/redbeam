import { describe, expect, it } from 'vitest'
import { SCOPE_PALETTE, newScope, nextScopeColor } from './scopeFactory.js'

describe('nextScopeColor', () => {
  it('starts at the head of the palette', () => {
    expect(nextScopeColor([])).toBe(SCOPE_PALETTE[0])
  })

  /**
   * The gap is reused. Counting the list was the old rule, and archiving the
   * second scope then adding one gave the newcomer the third colour while
   * the second sat unused — and the archived scope could come back.
   */
  it('takes the first colour nobody is using, not the next by count', () => {
    const existing = [{ color: SCOPE_PALETTE[0]! }, { color: SCOPE_PALETTE[2]! }]
    expect(nextScopeColor(existing)).toBe(SCOPE_PALETTE[1])
  })

  it('is case-insensitive about what is taken', () => {
    expect(nextScopeColor([{ color: SCOPE_PALETTE[0]!.toUpperCase() }])).toBe(SCOPE_PALETTE[1])
  })

  it('wraps once every colour is in use', () => {
    const all = SCOPE_PALETTE.map((color) => ({ color }))
    expect(SCOPE_PALETTE).toContain(nextScopeColor(all))
  })
})

describe('newScope', () => {
  it('is an area scope of panels, named as typed, trimmed', () => {
    const s = newScope('  C-MT-01  ', [])
    expect(s.label).toBe('C-MT-01')
    expect(s.scopeType).toBe('area')
    expect(s.specifications['productType']).toBe('panels')
    expect(s.color).toBe(SCOPE_PALETTE[0])
  })

  it('gives every scope its own id', () => {
    const ids = new Set(Array.from({ length: 20 }, () => newScope('x', []).id))
    expect(ids.size).toBe(20)
  })
})
