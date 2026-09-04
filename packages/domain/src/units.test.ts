import { describe, it, expect } from 'vitest'
import { unitToFeet, parseNumberOrFraction, formatMeasureValue, isLengthUnit } from './units.js'

describe('unitToFeet', () => {
  it('converts every supported unit', () => {
    expect(unitToFeet(12, 'in')).toBeCloseTo(1, 12)
    expect(unitToFeet(5, 'ft')).toBe(5)
    expect(unitToFeet(304.8, 'mm')).toBeCloseTo(1, 12)
    expect(unitToFeet(30.48, 'cm')).toBeCloseTo(1, 12)
    expect(unitToFeet(1, 'm')).toBeCloseTo(3.280839895, 12)
  })

  it('is case and whitespace insensitive', () => {
    expect(unitToFeet(12, '  IN ')).toBeCloseTo(1, 12)
  })

  it('rejects unknown units rather than guessing', () => {
    expect(unitToFeet(1, 'furlong')).toBeNull()
    expect(unitToFeet(1, '')).toBeNull()
    expect(isLengthUnit('yd')).toBe(false)
  })
})

describe('parseNumberOrFraction', () => {
  it('parses plain numbers', () => {
    expect(parseNumberOrFraction('5')).toBe(5)
    expect(parseNumberOrFraction(' 12.75 ')).toBeCloseTo(12.75, 12)
    expect(parseNumberOrFraction('-3')).toBe(-3)
  })

  it('parses bare fractions', () => {
    expect(parseNumberOrFraction('1/2')).toBeCloseTo(0.5, 12)
    expect(parseNumberOrFraction('3/4')).toBeCloseTo(0.75, 12)
  })

  it('parses mixed fractions', () => {
    expect(parseNumberOrFraction('5 1/2')).toBeCloseTo(5.5, 12)
    expect(parseNumberOrFraction('12 3/16')).toBeCloseTo(12.1875, 12)
  })

  it('normalizes the unicode minus sign', () => {
    expect(parseNumberOrFraction('−3')).toBe(-3)
  })

  it('strips thousands separators', () => {
    expect(parseNumberOrFraction('1,250')).toBe(1250)
  })

  it('rejects malformed input instead of silently truncating', () => {
    // parseFloat('5abc') would be 5 — that must NOT happen for measure input
    expect(parseNumberOrFraction('5abc')).toBeNull()
    expect(parseNumberOrFraction('')).toBeNull()
    expect(parseNumberOrFraction('   ')).toBeNull()
    expect(parseNumberOrFraction('1/2/3')).toBeNull()
    expect(parseNumberOrFraction('1/0')).toBeNull()
    expect(parseNumberOrFraction('abc')).toBeNull()
  })
})

describe('formatMeasureValue', () => {
  it('trims trailing zeros and a trailing dot', () => {
    expect(formatMeasureValue(5)).toBe('5')
    expect(formatMeasureValue(5.5)).toBe('5.5')
    expect(formatMeasureValue(5.25)).toBe('5.25')
    expect(formatMeasureValue(0.1)).toBe('0.1')
  })

  it('caps at six decimal places', () => {
    expect(formatMeasureValue(1 / 3)).toBe('0.333333')
  })

  it('round-trips through parseNumberOrFraction', () => {
    for (const v of [0, 1, 5.5, 12.1875, 1234.5]) {
      expect(parseNumberOrFraction(formatMeasureValue(v))).toBeCloseTo(v, 6)
    }
  })
})
