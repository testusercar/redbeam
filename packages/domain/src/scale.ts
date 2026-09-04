/**
 * Named drawing scales.
 *
 * A calibration is one number — feet per PDF point — and that number is what
 * every measurement in the app multiplies by. But nobody reads a drawing in
 * feet per point. They read the title block, which says `1/8" = 1'-0"`, and
 * they want to pick that, not measure a line and key in its length.
 *
 * Ported from `redbeamScalePresetFeetPerDrawingInch()` in the Qt build
 * (part/part.cpp). The values are carried across exactly — including the
 * rational thirds, stored as division rather than a rounded decimal so
 * `3/32" = 1'-0"` is 32/3 and not 10.667. Over a 300-foot building that
 * rounding is more than a foot of error.
 *
 * The conversion constant is PDF's, not ours: a PDF point is 1/72 inch by
 * definition, so "one drawing inch represents N feet" is N/72 feet per point.
 */

/** PDF points per inch, by the PDF specification. Not a measurement. */
export const POINTS_PER_INCH = 72

export type ScaleSystem = 'imperial-architectural' | 'imperial-engineering' | 'metric'

export interface ScalePreset {
  /** Stable key for persistence. Never shown to a user. */
  id: string
  /** What the title block says, e.g. `1/8" = 1'-0"`. */
  label: string
  /** Feet of real world per inch of drawing. */
  feetPerDrawingInch: number
  system: ScaleSystem
}

/**
 * The 26 presets, in the Qt build's order: architectural fine-to-coarse, then
 * engineering, then metric. The order is not alphabetical and must not be
 * sorted — an estimator scans this list by scale, and `1/16"` belongs beside
 * `1/8"`, not beside `1:100`.
 */
export const SCALE_PRESETS: readonly ScalePreset[] = [
  { id: 'arch-1-32', label: '1/32" = 1\'-0"', feetPerDrawingInch: 32, system: 'imperial-architectural' },
  { id: 'arch-1-16', label: '1/16" = 1\'-0"', feetPerDrawingInch: 16, system: 'imperial-architectural' },
  { id: 'arch-3-32', label: '3/32" = 1\'-0"', feetPerDrawingInch: 32 / 3, system: 'imperial-architectural' },
  { id: 'arch-1-8', label: '1/8" = 1\'-0"', feetPerDrawingInch: 8, system: 'imperial-architectural' },
  { id: 'arch-3-16', label: '3/16" = 1\'-0"', feetPerDrawingInch: 16 / 3, system: 'imperial-architectural' },
  { id: 'arch-1-4', label: '1/4" = 1\'-0"', feetPerDrawingInch: 4, system: 'imperial-architectural' },
  { id: 'arch-3-8', label: '3/8" = 1\'-0"', feetPerDrawingInch: 8 / 3, system: 'imperial-architectural' },
  { id: 'arch-1-2', label: '1/2" = 1\'-0"', feetPerDrawingInch: 2, system: 'imperial-architectural' },
  { id: 'arch-3-4', label: '3/4" = 1\'-0"', feetPerDrawingInch: 4 / 3, system: 'imperial-architectural' },
  { id: 'arch-1-1', label: '1" = 1\'-0"', feetPerDrawingInch: 1, system: 'imperial-architectural' },
  { id: 'eng-10', label: '1" = 10\'', feetPerDrawingInch: 10, system: 'imperial-engineering' },
  { id: 'eng-20', label: '1" = 20\'', feetPerDrawingInch: 20, system: 'imperial-engineering' },
  { id: 'eng-30', label: '1" = 30\'', feetPerDrawingInch: 30, system: 'imperial-engineering' },
  { id: 'eng-40', label: '1" = 40\'', feetPerDrawingInch: 40, system: 'imperial-engineering' },
  { id: 'eng-50', label: '1" = 50\'', feetPerDrawingInch: 50, system: 'imperial-engineering' },
  { id: 'eng-60', label: '1" = 60\'', feetPerDrawingInch: 60, system: 'imperial-engineering' },
  { id: 'metric-10', label: '1:10', feetPerDrawingInch: 10 / 12, system: 'metric' },
  { id: 'metric-20', label: '1:20', feetPerDrawingInch: 20 / 12, system: 'metric' },
  { id: 'metric-25', label: '1:25', feetPerDrawingInch: 25 / 12, system: 'metric' },
  { id: 'metric-50', label: '1:50', feetPerDrawingInch: 50 / 12, system: 'metric' },
  { id: 'metric-75', label: '1:75', feetPerDrawingInch: 75 / 12, system: 'metric' },
  { id: 'metric-100', label: '1:100', feetPerDrawingInch: 100 / 12, system: 'metric' },
  { id: 'metric-125', label: '1:125', feetPerDrawingInch: 125 / 12, system: 'metric' },
  { id: 'metric-200', label: '1:200', feetPerDrawingInch: 200 / 12, system: 'metric' },
  { id: 'metric-250', label: '1:250', feetPerDrawingInch: 250 / 12, system: 'metric' },
  { id: 'metric-500', label: '1:500', feetPerDrawingInch: 500 / 12, system: 'metric' },
]

export const SYSTEM_LABELS: Record<ScaleSystem, string> = {
  'imperial-architectural': 'Architectural',
  'imperial-engineering': 'Engineering',
  metric: 'Metric',
}

export function scalePreset(id: string): ScalePreset | null {
  return SCALE_PRESETS.find((p) => p.id === id) ?? null
}

const positiveFinite = (n: number) => Number.isFinite(n) && n > 0

/** Feet per PDF point for a scale expressed as feet per drawing inch. */
export function feetPerPointFromDrawingInch(feetPerDrawingInch: number): number {
  return positiveFinite(feetPerDrawingInch) ? feetPerDrawingInch / POINTS_PER_INCH : 0
}

/** The inverse — what a stored calibration means in title-block terms. */
export function drawingInchFromFeetPerPoint(feetPerPoint: number): number {
  return positiveFinite(feetPerPoint) ? feetPerPoint * POINTS_PER_INCH : 0
}

export function feetPerPointForPreset(p: ScalePreset): number {
  return feetPerPointFromDrawingInch(p.feetPerDrawingInch)
}

/**
 * Relative tolerance for calling a calibration "the same as" a preset.
 *
 * 0.1%, from `redbeamScaleCalibrationMatches` in the Qt build. It has to be
 * relative rather than absolute because the presets span three orders of
 * magnitude: an absolute epsilon tight enough to separate 1:100 from 1:125
 * would treat `1/32"` and `1/16"` as the same scale.
 */
export const PRESET_MATCH_TOLERANCE = 0.001

/**
 * The preset a calibration corresponds to, if any.
 *
 * This is what lets the scale read `1/8" = 1'-0"` after someone calibrated by
 * drawing a line, instead of `1 pt = 0.1111 ft`. A calibration measured off a
 * dimension string lands within a fraction of a percent of the preset when the
 * drawing really is at that scale, which is the case that matters.
 */
export function matchPreset(feetPerPoint: number): ScalePreset | null {
  if (!positiveFinite(feetPerPoint)) return null
  for (const p of SCALE_PRESETS) {
    const expected = feetPerPointForPreset(p)
    if (Math.abs(expected - feetPerPoint) / expected <= PRESET_MATCH_TOLERANCE) return p
  }
  return null
}

/**
 * Feet as `12'-6 1/2"`, to the nearest eighth.
 *
 * Ported from `redbeamFormatScaleFeet` — which is NOT the same function as
 * `formatFeetInches` in dimension.ts, however similar they look. That one is
 * the annotation formatter (`12' - 6 1/2"`, spaced, zero allowed); this one is
 * the scale formatter (`12'-6 1/2"`, unspaced, and it floors at one eighth so
 * a very fine scale never prints as `0'-0"`). Both are faithful ports and both
 * are load-bearing: merging them would change either an annotation's text or a
 * scale's, and both are compared against the Qt build's output.
 *
 * The eighth is the resolution a tape
 * measure has and therefore the resolution an estimator will accept; `12.5417'`
 * in a title-block context reads as a machine that was never taught what a
 * drawing is.
 */
export function formatScaleFeet(feet: number): string {
  if (!positiveFinite(feet)) return '--'
  let totalEighths = Math.max(1, Math.round(feet * 12 * 8))
  const feetPart = Math.floor(totalEighths / (12 * 8))
  totalEighths -= feetPart * 12 * 8
  const inchPart = Math.floor(totalEighths / 8)
  let eighthPart = totalEighths % 8
  if (eighthPart === 0) return `${feetPart}'-${inchPart}"`
  let denominator = 8
  while (eighthPart % 2 === 0 && denominator > 1) {
    eighthPart /= 2
    denominator /= 2
  }
  return `${feetPart}'-${inchPart} ${eighthPart}/${denominator}"`
}

/**
 * What to show wherever the scale appears.
 *
 * A named preset wins over the derived form because it is what the drawing
 * itself claims. Only when nothing matches — a custom calibration, or a sheet
 * plotted off-scale — does the caller see the `1" = …` derivation, which is
 * still more useful than the raw ratio.
 */
export function scaleLabel(feetPerPoint: number | null): string {
  if (feetPerPoint === null || !positiveFinite(feetPerPoint)) return 'Uncalibrated'
  const preset = matchPreset(feetPerPoint)
  if (preset !== null) return preset.label
  return `1" = ${formatScaleFeet(drawingInchFromFeetPerPoint(feetPerPoint))}`
}

/** The presets grouped for a menu, in the canonical order. */
export function presetGroups(): Array<{ system: ScaleSystem; label: string; presets: ScalePreset[] }> {
  const order: ScaleSystem[] = ['imperial-architectural', 'imperial-engineering', 'metric']
  return order.map((system) => ({
    system,
    label: SYSTEM_LABELS[system],
    presets: SCALE_PRESETS.filter((p) => p.system === system),
  }))
}

/**
 * The `source` prefix marking a calibration set from a named preset.
 *
 * `calibrations.source` records HOW a scale was set — measured off the sheet
 * (`reference-line`) versus stated in the title block (`preset:<id>`) — and
 * that distinction is what an estimator checks when a quantity looks wrong.
 *
 * It is a constant, and the two functions below are the only way to write or
 * read it, because it used to be neither. The palette and Dock chips wrote
 * `scale-preset:<id>` while the multi-sheet picker and the bridge wrote
 * `preset:<id>`, for the same fact; an audit written against one prefix
 * silently reported half the sheets as never having had a scale stated.
 * Migration 009 rewrites the old rows. Nothing accepts the old spelling on
 * read: tolerating both is how the two spellings survived in the first place.
 */
export const PRESET_SOURCE_PREFIX = 'preset:'

/** What to store in `source` for a scale taken from the title block. */
export function presetSource(p: ScalePreset): string {
  return `${PRESET_SOURCE_PREFIX}${p.id}`
}

/**
 * The preset id a stored `source` names, or null if the scale came from
 * somewhere else — a measured line, an agent, an import.
 *
 * Returns the id rather than the preset so a `source` naming a preset this
 * build no longer ships still reads as "stated", not as "measured".
 */
export function presetIdFromSource(source: string): string | null {
  return source.startsWith(PRESET_SOURCE_PREFIX)
    ? source.slice(PRESET_SOURCE_PREFIX.length) || null
    : null
}
