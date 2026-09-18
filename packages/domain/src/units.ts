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

/** A length as typed, with the unit the text itself named. */
export interface LengthInput {
  /** The magnitude, in `unit`. */
  value: number
  unit: LengthUnit
  /** True when the text named its unit; false when `fallback` was used. */
  explicit: boolean
}

const UNIT_WORDS: ReadonlyArray<[RegExp, LengthUnit]> = [
  [/^(ft|feet|foot|')$/i, 'ft'],
  [/^(in|inch|inches|"|″|'')$/i, 'in'],
  [/^(mm|millimet(er|re)s?)$/i, 'mm'],
  [/^(cm|centimet(er|re)s?)$/i, 'cm'],
  [/^(m|met(er|re)s?)$/i, 'm'],
]

function unitWord(text: string): LengthUnit | null {
  for (const [re, unit] of UNIT_WORDS) if (re.test(text)) return unit
  return null
}

/**
 * Read a length the way an estimator writes one.
 *
 *   5'6"   5' 6"   5'-6"   5' 6 1/2"   5'   6"   5 1/2"   5'6
 *   5.5ft  5.5 ft  66in  66 in  2.4m  300mm  30 cm  7 1/2
 *
 * A trailing unit word or mark decides the unit; feet-and-inches come back
 * as decimal feet. Text with no unit is a plain `parseNumberOrFraction` in
 * `fallback`, so a field that already has a unit selected keeps working the
 * way it did. Null when the text is not a length at all.
 *
 * Kenneth, 2026-09-10: "use a single quote, double quote, or FT or IN
 * annotations to be automatically interpreted without having to separately
 * select the unit in the drop-down."
 */
export function parseLengthInput(text: string, fallback: LengthUnit = 'ft'): LengthInput | null {
  const t = text.trim().replace(/−/g, '-').replace(/[’‘′]/g, "'").replace(/[“”″]/g, '"')
  if (t.length === 0) return null

  // Feet and inches: a feet part ending in ' and, optionally, an inches part.
  const fi = /^(-?[\d.,]+(?:\s+\d+\/\d+)?)\s*'\s*(?:-\s*)?(?:([\d.,]+(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(?:"|″|'')?)?$/.exec(t)
  if (fi !== null) {
    const feet = parseNumberOrFraction(fi[1]!)
    const inches = fi[2] === undefined ? 0 : parseNumberOrFraction(fi[2])
    if (feet === null || inches === null) return null
    const sign = feet < 0 ? -1 : 1
    return { value: feet + sign * inches / 12, unit: 'ft', explicit: true }
  }

  // A number, then a unit word or mark.
  const nu = /^(-?[\d.,]+(?:\s+\d+\/\d+)?|-?\d+\/\d+)\s*([A-Za-z]+|"|″|'')$/.exec(t)
  if (nu !== null) {
    const unit = unitWord(nu[2]!)
    if (unit === null) return null
    const value = parseNumberOrFraction(nu[1]!)
    return value === null ? null : { value, unit, explicit: true }
  }

  const plain = parseNumberOrFraction(t)
  return plain === null ? null : { value: plain, unit: fallback, explicit: false }
}

/**
 * A length the way an estimator reads one.
 *
 *   7.239583 ft  ->  7′ 2⅞″ style, written 7′ 2 7/8″
 *   120 in       ->  10′ 0″
 *   4 in         ->  4″
 *   0.3048 m     ->  0.305 m      300 mm -> 300 mm
 *
 * Imperial values are shown in feet and inches to the nearest 1/`denominator`
 * inch (16 by default), the fraction reduced; anything under a foot that was
 * entered in inches stays in inches. Metric values keep their unit, trimmed
 * to three decimals. The stored value is untouched: this is display only, so
 * 7.239583 stays 7.239583 in the database and reads 7′ 2 7/8″ on the page.
 * Aaron, 2026-09-11: "7.239583 instead of 7 foot 2 and 7 eighths inches".
 */
export function formatLength(value: number, unit: string, denominator = 16): string {
  if (!Number.isFinite(value)) return ''
  const u = unit.trim().toLowerCase()
  if (u === 'mm' || u === 'cm' || u === 'm') {
    const text = Math.abs(value) >= 100 ? Math.round(value).toString() : value.toFixed(3).replace(/\.?0+$/, '')
    return `${text} ${u}`
  }
  // An unknown unit reads as inches, the Qt build's own fallback.
  const imperial = u === 'ft' ? 'ft' : 'in'
  const feet = unitToFeet(value, imperial)
  if (feet === null) return `${formatMeasureValue(value)} ${unit}`
  const sign = feet < 0 ? '-' : ''
  const den = Math.max(1, Math.round(denominator))
  // Whole sixteenths (or eighths…), then split into feet, inches and the rest.
  let ticks = Math.round(Math.abs(feet) * 12 * den)
  const perFoot = 12 * den
  const wholeFeet = Math.floor(ticks / perFoot)
  ticks -= wholeFeet * perFoot
  const wholeInches = Math.floor(ticks / den)
  let num = ticks - wholeInches * den
  let d = den
  while (num > 0 && num % 2 === 0 && d % 2 === 0) { num /= 2; d /= 2 }
  const inches = num > 0 ? `${wholeInches} ${num}/${d}″` : `${wholeInches}″`
  if (imperial === 'in' && wholeFeet === 0) return `${sign}${inches}`
  return `${sign}${wholeFeet}′ ${inches}`
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
