import { describe, it, expect } from 'vitest'
import { unitToFeet, parseNumberOrFraction, formatMeasureValue, isLengthUnit, parseLengthInput, formatLength } from './units.js'

describe('formatLength', () => {
  it('writes imperial lengths as feet and inches to the sixteenth', () => {
    expect(formatLength(7.239583, 'ft')).toBe('7′ 2 7/8″')
    expect(formatLength(10, 'ft')).toBe('10′ 0″')
    expect(formatLength(120, 'in')).toBe('10′ 0″')
    expect(formatLength(3.5, 'ft')).toBe('3′ 6″')
    expect(formatLength(0.5, 'ft')).toBe('0′ 6″')
  })
  it('keeps a short inch value in inches', () => {
    expect(formatLength(4, 'in')).toBe('4″')
    expect(formatLength(11.5, 'in')).toBe('11 1/2″')
    expect(formatLength(12, 'in')).toBe('1′ 0″')
  })
  it('rounds to the precision asked for and reduces the fraction', () => {
    expect(formatLength(2.0625, 'in', 16)).toBe('2 1/16″')
    expect(formatLength(2.03, 'in', 8)).toBe('2″')
    expect(formatLength(2.09375, 'in', 32)).toBe('2 3/32″')
    expect(formatLength(6.75, 'in')).toBe('6 3/4″')
  })
  it('keeps metric in its own unit', () => {
    expect(formatLength(300, 'mm')).toBe('300 mm')
    expect(formatLength(2.4, 'm')).toBe('2.4 m')
    expect(formatLength(0.3048, 'm')).toBe('0.305 m')
    expect(formatLength(30, 'cm')).toBe('30 cm')
  })
  it('carries a sign and survives an odd unit', () => {
    expect(formatLength(-1.5, 'ft')).toBe('-1′ 6″')
    expect(formatLength(3, 'furlong')).toBe('3″')
  })
  it('reads back what it wrote', () => {
    const p = parseLengthInput(formatLength(7.239583, 'ft'))
    expect(p?.unit).toBe('ft')
    expect(p?.value).toBeCloseTo(7.239583, 3)
  })
})

describe('parseLengthInput', () => {
  const ft = (value: number) => ({ value, unit: 'ft', explicit: true })

  it('reads feet and inches in every way they are written', () => {
    expect(parseLengthInput(`5'6"`)).toEqual(ft(5.5))
    expect(parseLengthInput(`5' 6"`)).toEqual(ft(5.5))
    expect(parseLengthInput(`5'-6"`)).toEqual(ft(5.5))
    expect(parseLengthInput(`5'6`)).toEqual(ft(5.5))
    expect(parseLengthInput(`5' 6 1/2"`)).toEqual(ft(5 + 6.5 / 12))
    expect(parseLengthInput(`12'`)).toEqual(ft(12))
    expect(parseLengthInput(`10' 1/2"`)).toEqual(ft(10 + 0.5 / 12))
    expect(parseLengthInput(`5’6”`)).toEqual(ft(5.5))   // typographic quotes
  })

  it('reads inches alone', () => {
    expect(parseLengthInput(`66"`)).toEqual({ value: 66, unit: 'in', explicit: true })
    expect(parseLengthInput(`5 1/2"`)).toEqual({ value: 5.5, unit: 'in', explicit: true })
    expect(parseLengthInput(`1/2"`)).toEqual({ value: 0.5, unit: 'in', explicit: true })
    expect(parseLengthInput(`8 in`)).toEqual({ value: 8, unit: 'in', explicit: true })
    expect(parseLengthInput(`8in`)).toEqual({ value: 8, unit: 'in', explicit: true })
  })

  it('reads unit words, whatever the case', () => {
    expect(parseLengthInput('5.5ft')).toEqual(ft(5.5))
    expect(parseLengthInput('5.5 FT')).toEqual(ft(5.5))
    expect(parseLengthInput('2.4m')).toEqual({ value: 2.4, unit: 'm', explicit: true })
    expect(parseLengthInput('300mm')).toEqual({ value: 300, unit: 'mm', explicit: true })
    expect(parseLengthInput('30 cm')).toEqual({ value: 30, unit: 'cm', explicit: true })
    expect(parseLengthInput('3 metres')).toEqual({ value: 3, unit: 'm', explicit: true })
  })

  it('falls back to the given unit for a bare number, and says so', () => {
    expect(parseLengthInput('7 1/2', 'in')).toEqual({ value: 7.5, unit: 'in', explicit: false })
    expect(parseLengthInput('20')).toEqual({ value: 20, unit: 'ft', explicit: false })
  })

  it('keeps the sign on negative feet-and-inches', () => {
    expect(parseLengthInput(`-5'6"`)).toEqual(ft(-5.5))
  })

  it('rejects what is not a length', () => {
    expect(parseLengthInput('')).toBeNull()
    expect(parseLengthInput('abc')).toBeNull()
    expect(parseLengthInput('5 furlongs')).toBeNull()
    expect(parseLengthInput(`5'x`)).toBeNull()
  })
})

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
