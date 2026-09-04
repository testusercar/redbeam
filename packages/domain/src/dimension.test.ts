import { describe, it, expect } from 'vitest'
import {
  DEFAULT_DIMENSION_CONTENT,
  applyOrtho,
  canonicalUnitToken,
  dimensionContentsText,
  dimensionFeet,
  dimensionLengthPdfPoints,
  dimensionLine,
  dimensionValueText,
  formatFeetInches,
  offsetPointsFor,
  parseDimensionContent,
  parseLabeledFeet,
  parseMeasureFeet,
  parseMeasureInput,
  resolveOrthoAxis,
  serializeDimensionContent,
} from './dimension.js'
import { linearFeet, type Calibration, type Markup } from './scope.js'
import { polylineLength } from './geometry.js'

// A real sheet: 3456 x 2592 pt, deliberately NOT square so anything that
// confuses normalized units with page units shows up.
const cal: Calibration = { feetPerPoint: 0.100299, pageWidth: 3456, pageHeight: 2592 }

const a = { x: 0.12, y: 0.31 }
const b = { x: 0.64, y: 0.77 }

describe('measurement agrees with the linear path', () => {
  it('a dimension and a polyline over the same two points report the same length', () => {
    const polyline: Markup = {
      id: 'p', scopeId: 's', documentId: 'd', pageId: 'pg', kind: 'polyline', rings: [[a, b]],
    }
    const viaPolyline = linearFeet([polyline], cal)
    const viaDimension = dimensionFeet(a, b, cal)
    // Not "close to" — the same number. Both go through polylineLength().
    expect(viaDimension).toBe(viaPolyline)
  })

  it('delegates to polylineLength rather than re-deriving the formula', () => {
    expect(dimensionLengthPdfPoints(a, b, cal.pageWidth, cal.pageHeight))
      .toBe(polylineLength([a, b], cal.pageWidth, cal.pageHeight))
  })

  it('agrees for a degenerate zero-length dimension', () => {
    expect(dimensionFeet(a, a, cal)).toBe(0)
  })

  it('the label offset does not move the quantity', () => {
    const base = dimensionFeet(a, b, cal)
    for (const offset of [-240, -12, 0, 0.5, 96]) {
      const line = dimensionLine(a, b, offset, cal.pageWidth, cal.pageHeight)
      expect(line.lengthPdfPoints * cal.feetPerPoint).toBe(base)
    }
  })

  it('the ortho constraint changes the geometry, and therefore the quantity, only once', () => {
    const constrained = applyOrtho(a, b, cal.pageWidth, cal.pageHeight, 'horizontal')
    expect(constrained).toEqual({ x: b.x, y: a.y })
    // applying it again is idempotent
    expect(applyOrtho(a, constrained, cal.pageWidth, cal.pageHeight, 'horizontal')).toEqual(constrained)
  })
})

describe('dimensionLine', () => {
  it('leaves the line on the measured points at zero offset', () => {
    const l = dimensionLine(a, b, 0, cal.pageWidth, cal.pageHeight)
    expect(l.lineA).toEqual(a)
    expect(l.lineB).toEqual(b)
    expect(l.mid).toEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  })

  it('offsets perpendicular in PDF points, not normalized units', () => {
    // horizontal span on a 2:1 page: the offset must be a pure y shift of
    // exactly `offset` PDF points, i.e. offset/pageHeight normalized.
    const p0 = { x: 0.2, y: 0.5 }
    const p1 = { x: 0.8, y: 0.5 }
    const l = dimensionLine(p0, p1, 100, 3456, 2592)
    expect(l.lineA.x).toBeCloseTo(0.2, 12)
    expect(l.lineA.y).toBeCloseTo(0.5 + 100 / 2592, 12)
    expect(l.lineB.y).toBeCloseTo(0.5 + 100 / 2592, 12)
  })

  it('reports the direction angle in PDF-point space', () => {
    const l = dimensionLine({ x: 0, y: 0 }, { x: 1, y: 1 }, 0, 3456, 2592)
    expect(l.angle).toBeCloseTo(Math.atan2(2592, 3456), 12)
  })

  it('does not produce NaN for a zero-length dimension', () => {
    const l = dimensionLine(a, a, 50, cal.pageWidth, cal.pageHeight)
    expect(Number.isFinite(l.lineA.x)).toBe(true)
    expect(Number.isFinite(l.lineA.y)).toBe(true)
    expect(l.lengthPdfPoints).toBe(0)
  })

  it('offsetPointsFor inverts the offset', () => {
    const l = dimensionLine(a, b, 137.5, cal.pageWidth, cal.pageHeight)
    expect(offsetPointsFor(a, b, l.mid, cal.pageWidth, cal.pageHeight)).toBeCloseTo(137.5, 9)
  })
})

describe('ortho', () => {
  it('auto picks the dominant axis measured in PDF points, not normalized', () => {
    // dx normalized 0.10, dy normalized 0.12 -> normalized says vertical.
    // In points: 0.10*3456 = 345.6 vs 0.12*2592 = 311.0 -> horizontal wins.
    const anchor = { x: 0.1, y: 0.1 }
    const p = { x: 0.2, y: 0.22 }
    expect(resolveOrthoAxis(anchor, p, 3456, 2592)).toBe('horizontal')
    expect(applyOrtho(anchor, p, 3456, 2592, 'auto')).toEqual({ x: 0.2, y: 0.1 })
  })

  it('locks y for a horizontal run and x for a vertical run', () => {
    const anchor = { x: 0.1, y: 0.1 }
    const p = { x: 0.5, y: 0.9 }
    expect(applyOrtho(anchor, p, 1000, 1000, 'horizontal')).toEqual({ x: 0.5, y: 0.1 })
    expect(applyOrtho(anchor, p, 1000, 1000, 'vertical')).toEqual({ x: 0.1, y: 0.9 })
    expect(applyOrtho(anchor, p, 1000, 1000, 'none')).toEqual(p)
  })
})

describe('formatFeetInches', () => {
  it('matches the Qt build', () => {
    expect(formatFeetInches(0)).toBe(`0' - 0"`)
    expect(formatFeetInches(1)).toBe(`1' - 0"`)
    expect(formatFeetInches(12.5)).toBe(`12' - 6"`)
    expect(formatFeetInches(0.625)).toBe(`0' - 7 1/2"`)
    // 1/8 granularity, reduced: 3/8 stays, 4/8 becomes 1/2, 2/8 becomes 1/4
    expect(formatFeetInches(1 + 3 / 8 / 12)).toBe(`1' - 0 3/8"`)
    expect(formatFeetInches(1 + 2 / 8 / 12)).toBe(`1' - 0 1/4"`)
    expect(formatFeetInches(1 + 4 / 8 / 12)).toBe(`1' - 0 1/2"`)
  })

  it('rounds to the nearest eighth', () => {
    // 0.0651 ft = 0.7812 in -> 6.25 eighths -> 6 eighths -> 3/4"
    expect(formatFeetInches(0.0651)).toBe(`0' - 0 3/4"`)
  })

  it('refuses negative and non-finite input the way the C++ does', () => {
    expect(formatFeetInches(-1)).toBe('--')
    expect(formatFeetInches(Number.NaN)).toBe('--')
    expect(formatFeetInches(Number.POSITIVE_INFINITY)).toBe('--')
  })
})

describe('label text', () => {
  it('says so when the page is not calibrated', () => {
    expect(dimensionValueText(500, 0)).toBe('set scale first')
    expect(dimensionContentsText(500, 0)).toBe('Redbeam Dimension: set scale first')
  })

  it('emits the round-trip contents format', () => {
    // 124.6 pt at 0.100299 ft/pt = 12.4972... ft -> 12' - 6"
    expect(dimensionContentsText(124.6, 0.100299)).toBe(`Redbeam Dimension: 12' - 6"`)
  })

  it('round-trips through parseLabeledFeet to within the 1/8 inch it displays', () => {
    const feet = 124.6 * 0.100299
    const text = dimensionContentsText(124.6, 0.100299)
    const back = parseLabeledFeet(text)
    expect(back).not.toBeNull()
    expect(Math.abs(back! - feet)).toBeLessThan(1 / 8 / 12)
  })

  it('also reads the LF form the scope panel writes', () => {
    expect(parseLabeledFeet('Redbeam Length: 1,234.5 LF')).toBe(1234.5)
    expect(parseLabeledFeet('Redbeam Dimension: 100 LF')).toBe(100)
    expect(parseLabeledFeet('not a redbeam label')).toBeNull()
  })
})

describe('measure input parsing', () => {
  it('parses "7 1/2 in" — the case the codebase keeps getting wrong', () => {
    expect(parseMeasureInput('7 1/2 in', 'ft')).toEqual({ valueText: '7.5', unit: 'in' })
    expect(parseMeasureFeet('7 1/2 in')).toBeCloseTo(0.625, 12)
  })

  it('parses feet-and-inches', () => {
    expect(parseMeasureFeet(`12' - 6"`)).toBeCloseTo(12.5, 12)
    expect(parseMeasureFeet(`8'`)).toBe(8)
  })

  it('quantizes to 6 decimals, because the C++ round-trips through a formatted string', () => {
    // redbeamParseMeasureInput hands back valueText, not a double, and
    // redbeamFormatMeasureValue caps it at 6 places. 12' - 6 1/2" is
    // 12.5416666... ft and comes back as exactly 12.541667. Faithful, not a bug.
    expect(parseMeasureFeet(`12' - 6 1/2"`)).toBe(12.541667)
    expect(parseMeasureFeet(`12' - 6 1/2"`)).toBeCloseTo(12 + 6.5 / 12, 5)
  })

  it('normalizes typographic prime and quote characters', () => {
    expect(parseMeasureFeet('12′ - 6″')).toBeCloseTo(12.5, 12)
    expect(parseMeasureFeet('12’ - 6”')).toBeCloseTo(12.5, 12)
  })

  it('handles metric and long unit words', () => {
    expect(parseMeasureInput('3 m', 'ft')).toEqual({ valueText: '3', unit: 'm' })
    expect(parseMeasureInput('5 inches', 'ft')).toEqual({ valueText: '5', unit: 'in' })
    expect(parseMeasureInput('250 mm', 'ft')).toEqual({ valueText: '250', unit: 'mm' })
    expect(parseMeasureFeet('3 m')).toBeCloseTo(3 * 3.280839895, 12)
  })

  it('falls back to the given unit when none is written', () => {
    expect(parseMeasureInput('5', 'ft')).toEqual({ valueText: '5', unit: 'ft' })
    expect(parseMeasureInput('5', 'nonsense')).toEqual({ valueText: '5', unit: 'in' })
    expect(parseMeasureInput('', 'ft')).toEqual({ valueText: '', unit: 'ft' })
  })

  it('rejects garbage rather than silently taking a prefix', () => {
    expect(parseMeasureInput('5abc', 'ft')).toBeNull()
    expect(parseMeasureInput('abc', 'ft')).toBeNull()
    expect(parseMeasureFeet('')).toBeNull()
  })

  it('canonicalizes unit tokens', () => {
    expect(canonicalUnitToken("'")).toBe('ft')
    expect(canonicalUnitToken('FEET')).toBe('ft')
    expect(canonicalUnitToken('"')).toBe('in')
    expect(canonicalUnitToken('Inches')).toBe('in')
    expect(canonicalUnitToken('cm')).toBe('cm')
    expect(canonicalUnitToken('furlong')).toBe('')
  })
})

describe('content_json', () => {
  it('round-trips', () => {
    const content = { offsetPoints: -42.5, ortho: 'vertical' as const, label: 'CLR' }
    expect(parseDimensionContent(serializeDimensionContent(content))).toEqual(content)
  })

  it('accepts a parsed object as well as a string', () => {
    expect(parseDimensionContent({ offsetPoints: 3, ortho: 'horizontal', label: null }))
      .toEqual({ offsetPoints: 3, ortho: 'horizontal', label: null })
  })

  it('falls back on anything it cannot read, without throwing', () => {
    for (const bad of ['', '{', 'null', null, undefined, 42, [], { offsetPoints: 'x', ortho: 'diagonal' }]) {
      expect(parseDimensionContent(bad)).toEqual(DEFAULT_DIMENSION_CONTENT)
    }
  })

  it('treats an empty label override as absent', () => {
    expect(parseDimensionContent({ label: '' }).label).toBeNull()
  })
})
