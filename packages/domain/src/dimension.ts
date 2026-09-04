/**
 * Two-point measured dimensions.
 *
 * Ported from okular-redbeam:
 *   RedbeamAutomationBridge::createPolylineMeasurement (redbeamautomationbridge.cpp)
 *   lengthContents / formatFeetInches                  (redbeamautomationbridge.cpp)
 *   redbeamParseMeasureInput / redbeamCanonicalUnitToken (redbeamscopepanel.cpp)
 *   redbeamParseLabeledFeet                            (redbeamscopepanel.cpp)
 *
 * The measured value goes through `polylineLength()` — the same function a
 * linear markup uses — so a dimension and a polyline drawn over the same two
 * points report the identical length at the same calibration. That is the
 * whole point of this module existing in `domain` rather than in the tool
 * layer: quantities must not move. See docs/PORTING.md.
 *
 * Geometry is NORMALIZED page coordinates [0,1], like every other markup.
 * The one exception is `offsetPoints`, which is PDF points: a perpendicular
 * offset expressed in normalized units is not isotropic on a non-square page,
 * so it would visibly skew as the sheet aspect changes. The offset is
 * presentation only — it never touches the measurement.
 */

import { polylineLength, type Point } from './geometry.js'
import type { Calibration } from './scope.js'
import { formatMeasureValue, parseNumberOrFraction, unitToFeet } from './units.js'

/** Colour the Qt build gives a dimension (linear takeoff is #0057ff). */
export const DIMENSION_COLOR = '#ff5500'

/**
 * Ortho constraint. 'auto' picks the dominant axis measured in PDF points, so
 * the choice matches what the estimator sees on the sheet rather than what the
 * normalized numbers say.
 */
export type OrthoMode = 'none' | 'horizontal' | 'vertical' | 'auto'

/** The constraint actually recorded on a committed dimension. */
export type OrthoAxis = 'none' | 'horizontal' | 'vertical'

/**
 * A dimension's `content_json` payload.
 *
 * Nothing here is geometry: the two measured points live in
 * `markups.geometry_json` as `rings[0]`, exactly like a two-point polyline.
 */
export interface DimensionContent {
  /**
   * Perpendicular offset of the dimension line from the measured span, in PDF
   * points. Signed: positive is the left-hand normal of a->b. Zero draws the
   * dimension line straight through the measured points and suppresses the
   * witness lines.
   */
  offsetPoints: number
  /** Constraint applied when the dimension was drawn, recorded for re-edit. */
  ortho: OrthoAxis
  /** Text override. null means "derive from the measurement". */
  label: string | null
}

export const DEFAULT_DIMENSION_CONTENT: DimensionContent = {
  offsetPoints: 0,
  ortho: 'none',
  label: null,
}

/** Tolerant read of a `content_json` value. Never throws; unknown shapes fall back. */
export function parseDimensionContent(raw: unknown): DimensionContent {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return { ...DEFAULT_DIMENSION_CONTENT }
    }
  }
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_DIMENSION_CONTENT }
  const o = value as Record<string, unknown>
  const offset = typeof o['offsetPoints'] === 'number' && Number.isFinite(o['offsetPoints'])
    ? o['offsetPoints']
    : 0
  const ortho = o['ortho']
  const label = o['label']
  return {
    offsetPoints: offset,
    ortho: ortho === 'horizontal' || ortho === 'vertical' ? ortho : 'none',
    label: typeof label === 'string' && label.length > 0 ? label : null,
  }
}

export function serializeDimensionContent(content: DimensionContent): string {
  return JSON.stringify(content)
}

// ------------------------------------------------------------ measurement ---

/**
 * Measured length in PDF points.
 *
 * Deliberately delegates to polylineLength() rather than calling Math.hypot
 * directly. A second implementation of the same formula is a second place for
 * the number to drift.
 */
export function dimensionLengthPdfPoints(
  a: Point,
  b: Point,
  pageWidth: number,
  pageHeight: number,
): number {
  return polylineLength([a, b], pageWidth, pageHeight)
}

/** Measured length in feet at a page calibration. */
export function dimensionFeet(a: Point, b: Point, cal: Calibration): number {
  return dimensionLengthPdfPoints(a, b, cal.pageWidth, cal.pageHeight) * cal.feetPerPoint
}

// --------------------------------------------------------------- geometry ---

/** Which axis 'auto' would lock, measured in PDF points. */
export function resolveOrthoAxis(
  anchor: Point,
  p: Point,
  pageWidth: number,
  pageHeight: number,
): 'horizontal' | 'vertical' {
  const dx = Math.abs((p.x - anchor.x) * pageWidth)
  const dy = Math.abs((p.y - anchor.y) * pageHeight)
  return dx >= dy ? 'horizontal' : 'vertical'
}

/**
 * Constrain `p` relative to `anchor`.
 *
 * 'horizontal' means the dimension RUNS horizontally, so y is locked.
 * Note this is a pure H/V lock, not the 45-degree constraint `snap.ts`
 * applies to free drawing — a dimension at 45 degrees measures a diagonal,
 * which is a different intent from a constrained one.
 */
export function applyOrtho(
  anchor: Point,
  p: Point,
  pageWidth: number,
  pageHeight: number,
  mode: OrthoMode,
): Point {
  if (mode === 'none') return p
  const axis = mode === 'auto' ? resolveOrthoAxis(anchor, p, pageWidth, pageHeight) : mode
  return axis === 'horizontal' ? { x: p.x, y: anchor.y } : { x: anchor.x, y: p.y }
}

export interface DimensionLine {
  /** The measured points, unchanged. */
  a: Point
  b: Point
  /** Ends of the offset dimension line. Equal to a/b when offsetPoints is 0. */
  lineA: Point
  lineB: Point
  /** Midpoint of the dimension line — where the value label sits. */
  mid: Point
  /**
   * Direction of a->b in radians, computed in PDF-point space. Screen space is
   * PDF points times a single uniform `zoom`, so this angle is also the screen
   * angle and can be used directly to rotate the label.
   */
  angle: number
  lengthPdfPoints: number
}

/**
 * Resolve the drawable geometry of a dimension.
 *
 * `lengthPdfPoints` is measured between a and b — the offset shifts the drawn
 * line and the label, never the number.
 */
export function dimensionLine(
  a: Point,
  b: Point,
  offsetPoints: number,
  pageWidth: number,
  pageHeight: number,
): DimensionLine {
  const ax = a.x * pageWidth
  const ay = a.y * pageHeight
  const bx = b.x * pageWidth
  const by = b.y * pageHeight
  const dx = bx - ax
  const dy = by - ay
  const length = Math.hypot(dx, dy)

  // Left-hand normal of a->b. Degenerate (zero-length) dimensions get no
  // offset rather than a NaN one; a user can produce those by double-clicking.
  const nx = length > 0 ? -dy / length : 0
  const ny = length > 0 ? dx / length : 0

  const lineA: Point = {
    x: (ax + nx * offsetPoints) / pageWidth,
    y: (ay + ny * offsetPoints) / pageHeight,
  }
  const lineB: Point = {
    x: (bx + nx * offsetPoints) / pageWidth,
    y: (by + ny * offsetPoints) / pageHeight,
  }

  return {
    a,
    b,
    lineA,
    lineB,
    mid: { x: (lineA.x + lineB.x) / 2, y: (lineA.y + lineB.y) / 2 },
    angle: Math.atan2(dy, dx),
    lengthPdfPoints: dimensionLengthPdfPoints(a, b, pageWidth, pageHeight),
  }
}

/**
 * Perpendicular offset, in PDF points, that would put the dimension line
 * through `through`. The inverse of the offset in dimensionLine(); use it to
 * turn a drag of the label into a stored offset.
 */
export function offsetPointsFor(
  a: Point,
  b: Point,
  through: Point,
  pageWidth: number,
  pageHeight: number,
): number {
  const ax = a.x * pageWidth
  const ay = a.y * pageHeight
  const dx = b.x * pageWidth - ax
  const dy = b.y * pageHeight - ay
  const length = Math.hypot(dx, dy)
  if (length === 0) return 0
  const nx = -dy / length
  const ny = dx / length
  return (through.x * pageWidth - ax) * nx + (through.y * pageHeight - ay) * ny
}

// ---------------------------------------------------------------- labeling ---

/**
 * Feet as architectural feet-and-inches, rounded to the nearest 1/8".
 * Verbatim port of formatFeetInches() in redbeamautomationbridge.cpp.
 */
export function formatFeetInches(feet: number): string {
  if (feet < 0 || !Number.isFinite(feet)) return '--'
  let totalEighths = Math.round(feet * 12 * 8)
  const feetPart = Math.trunc(totalEighths / (12 * 8))
  totalEighths -= feetPart * 12 * 8
  const inchPart = Math.trunc(totalEighths / 8)
  let eighthPart = totalEighths % 8
  if (eighthPart === 0) return `${feetPart}' - ${inchPart}"`
  let denominator = 8
  while (eighthPart % 2 === 0 && denominator > 1) {
    eighthPart /= 2
    denominator /= 2
  }
  return `${feetPart}' - ${inchPart} ${eighthPart}/${denominator}"`
}

/** The bare value a dimension displays, with no "Redbeam Dimension:" prefix. */
export function dimensionValueText(lengthPdfPoints: number, feetPerPoint: number): string {
  if (!(feetPerPoint > 0) || !Number.isFinite(feetPerPoint)) return 'set scale first'
  return formatFeetInches(lengthPdfPoints * feetPerPoint)
}

/**
 * The full annotation contents string, verbatim from lengthContents(..., "Dimension", scale).
 *
 * Kept because it is the round-trip format: redbeamParseLabeledFeet() reads it
 * back to recover a scale constraint, and any PDF export has to emit it.
 */
export function dimensionContentsText(lengthPdfPoints: number, feetPerPoint: number): string {
  if (!(feetPerPoint > 0) || !Number.isFinite(feetPerPoint)) {
    return 'Redbeam Dimension: set scale first'
  }
  return `Redbeam Dimension: ${formatFeetInches(lengthPdfPoints * feetPerPoint)}`
}

/** Verbatim port of redbeamCanonicalUnitToken. Empty string means unrecognised. */
export function canonicalUnitToken(unit: string): string {
  const u = unit.trim().toLowerCase()
  if (u === "'" || u === 'ft' || u === 'foot' || u === 'feet') return 'ft'
  if (u === '"' || u === 'in' || u === 'inch' || u === 'inches') return 'in'
  if (u === 'mm' || u === 'cm' || u === 'm') return u
  return ''
}

/**
 * Verbatim port of redbeamParseMeasureInput.
 *
 * Accepts "7 1/2 in", "12' - 6\"", "3 m", "5". Returns the value as a
 * formatted string plus a canonical unit token, exactly as the C++ out-params
 * did — callers push it back through parseNumberOrFraction + unitToFeet, which
 * is the chain redbeamParseLabeledFeet uses. `parseMeasureFeet` does that for
 * you.
 *
 * The inch-suffix stripping in the feet-and-inches branch is deliberately
 * crude in the same way the C++ is: it removes "inches", then "inch", then
 * "in", then quotes and dashes, from an already-split remainder.
 */
export function parseMeasureInput(
  inputText: string,
  fallbackUnit: string,
): { valueText: string; unit: string } | null {
  let input = inputText.trim()
  if (input.length === 0) {
    const canonical = canonicalUnitToken(fallbackUnit)
    return { valueText: '', unit: canonical === '' ? 'in' : canonical }
  }

  input = input
    .replace(/’/g, "'")
    .replace(/′/g, "'")
    .replace(/”/g, '"')
    .replace(/″/g, '"')

  if (input.includes("'")) {
    const feetMark = input.indexOf("'")
    const feet = parseNumberOrFraction(input.slice(0, feetMark))
    if (feet === null) return null
    let inchesText = input.slice(feetMark + 1).trim()
    inchesText = inchesText.replace(/inches/gi, '')
    inchesText = inchesText.replace(/inch/gi, '')
    inchesText = inchesText.replace(/in/gi, '')
    inchesText = inchesText.replace(/"/g, '')
    inchesText = inchesText.replace(/-/g, '')
    let inches = 0
    if (inchesText.trim().length > 0) {
      const parsed = parseNumberOrFraction(inchesText)
      if (parsed === null) return null
      inches = parsed
    }
    return { valueText: formatMeasureValue(feet + inches / 12), unit: 'ft' }
  }

  const suffix = /^\s*(.+?)\s*(mm|cm|m|ft|feet|foot|in|inch|inches|['"])\s*$/i.exec(input)
  let numberText = input
  let unit = canonicalUnitToken(fallbackUnit)
  if (unit === '') unit = 'in'
  if (suffix) {
    numberText = suffix[1]!
    const canonical = canonicalUnitToken(suffix[2]!)
    if (canonical === '') return null
    unit = canonical
  }

  const value = parseNumberOrFraction(numberText)
  if (value === null) return null
  return { valueText: formatMeasureValue(value), unit }
}

/**
 * Measure input -> feet, following redbeamParseLabeledFeet's chain exactly:
 * parseMeasureInput, then parseNumberOrFraction, then unitToFeet.
 */
export function parseMeasureFeet(inputText: string, fallbackUnit = 'ft'): number | null {
  const parsed = parseMeasureInput(inputText, fallbackUnit)
  if (parsed === null) return null
  const value = parseNumberOrFraction(parsed.valueText)
  if (value === null) return null
  const feet = unitToFeet(value, parsed.unit)
  return feet === null || !Number.isFinite(feet) ? null : feet
}

/**
 * Read a dimension or length annotation's contents back to feet.
 * Port of redbeamParseLabeledFeet: the "N LF" form first, then the
 * feet-and-inches form. Returns null when nothing parses, and rejects
 * non-positive values exactly as the C++ does.
 */
export function parseLabeledFeet(contents: string): number | null {
  const lf = /Redbeam\s+(?:Length|Dimension):\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*LF/i.exec(contents)
  if (lf) {
    const value = Number(lf[1]!.replace(/,/g, ''))
    if (Number.isFinite(value) && value > 0) return value
  }
  const dimension = /Redbeam\s+Dimension:\s*(.+)$/i.exec(contents)
  if (!dimension) return null
  const feet = parseMeasureFeet(dimension[1]!, 'ft')
  return feet !== null && feet > 0 ? feet : null
}
