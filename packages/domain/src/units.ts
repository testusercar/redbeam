/**
 * Unit parsing and conversion.
 *
 * Ported from okular-redbeam `part/redbeamscopepanel.cpp`:
 *   redbeamScopeUnitToFeet, redbeamParseNumberOrFraction, redbeamFormatMeasureValue
 *
 * These are deliberately faithful ports, not re-derivations. The conversion
 * factors and the fraction-parsing behaviour are relied on by existing takeoff
 * numbers; changing them changes quantities. See units.test.ts for the pinned
 * behaviour.
 */

export type LengthUnit = 'in' | 'ft' | 'mm' | 'cm' | 'm'

/** Feet per one unit. Matches redbeamScopeUnitToFeet exactly. */
const FEET_PER_UNIT: Record<LengthUnit, number> = {
  in: 1 / 12,
  ft: 1,
  mm: 1 / 304.8,
  cm: 1 / 30.48,
  // NOTE: the C++ multiplies by this literal rather than dividing by 0.3048.
  // Kept verbatim so results stay bit-comparable with the Qt build.
  m: 3.280839895,
}

export function isLengthUnit(unit: string): unit is LengthUnit {
  return Object.prototype.hasOwnProperty.call(FEET_PER_UNIT, unit.trim().toLowerCase())
}

/**
 * Convert `value` in `unit` to feet.
 * Returns null for an unrecognised unit (the C++ returns false and leaves the
 * out-param untouched; null is the TS equivalent of that failure signal).
 */
export function unitToFeet(value: number, unit: string): number | null {
  const normalized = unit.trim().toLowerCase()
  if (!isLengthUnit(normalized)) return null
  const factor = FEET_PER_UNIT[normalized]
  return normalized === 'm' ? value * factor : value * factor
}

/**
 * Parse a number that may be written as a mixed fraction: "5", "5 1/2", "1/2",
 * "-3 3/4". Handles U+2212 MINUS SIGN and strips thousands separators.
 *
 * Faithful to redbeamParseNumberOrFraction, including its quirk: when there is
 * exactly one whitespace-separated part and no '/', the whole trimmed input is
 * re-parsed as a single double rather than using the accumulated total.
 */
export function parseNumberOrFraction(text: string): number | null {
  let input = text.trim()
  if (input.length === 0) return null

  input = input.replace(/−/g, '-').replace(/,/g, '')

  const parts = input.split(/\s+/).filter((p) => p.length > 0)
  if (parts.length === 0) return null

  let total = 0
  let sawFraction = false

  for (const part of parts) {
    if (part.includes('/')) {
      const fraction = part.split('/')
      if (fraction.length !== 2) return null
      const numerator = toDouble(fraction[0]!)
      const denominator = toDouble(fraction[1]!)
      if (numerator === null || denominator === null || denominator === 0) return null
      total += numerator / denominator
      sawFraction = true
    } else {
      const parsed = toDouble(part)
      if (parsed === null) return null
      total += parsed
    }
  }

  if (!sawFraction && parts.length === 1) {
    const whole = toDouble(input)
    if (whole === null) return null
    total = whole
  }

  return Number.isFinite(total) ? total : null
}

/**
 * Strict numeric parse matching Qt's QString::toDouble ok-flag semantics:
 * the ENTIRE string must be a number. JS parseFloat("5abc") === 5, which
 * would silently accept malformed measure input, so we reject it.
 */
function toDouble(text: string): number | null {
  const t = text.trim()
  if (t.length === 0) return null
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

/**
 * Format a measurement for display: 6 decimal places with trailing zeros and a
 * trailing '.' stripped. Matches redbeamFormatMeasureValue.
 */
export function formatMeasureValue(value: number): string {
  let text = value.toFixed(6)
  while (text.includes('.') && text.endsWith('0')) text = text.slice(0, -1)
  if (text.endsWith('.')) text = text.slice(0, -1)
  return text
}
