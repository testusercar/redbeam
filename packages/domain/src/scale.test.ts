import { describe, expect, it } from 'vitest'
import {
  PRESET_MATCH_TOLERANCE, SCALE_PRESETS, drawingInchFromFeetPerPoint,
  feetPerPointForPreset, feetPerPointFromDrawingInch, formatScaleFeet,
  matchPreset, presetGroups, presetIdFromSource, presetSource, scaleLabel, scalePreset,
} from './scale.js'

describe('the preset table', () => {
  it('carries all 26 scales from the Qt build', () => {
    expect(SCALE_PRESETS).toHaveLength(26)
  })

  it('has unique ids and unique labels', () => {
    expect(new Set(SCALE_PRESETS.map((p) => p.id)).size).toBe(26)
    expect(new Set(SCALE_PRESETS.map((p) => p.label)).size).toBe(26)
  })

  it('has no two presets that would match each other', () => {
    // If two presets are within the match tolerance, matchPreset can never
    // return the second one and the menu has a dead entry.
    for (const a of SCALE_PRESETS) {
      const hit = matchPreset(feetPerPointForPreset(a))
      expect(hit?.id).toBe(a.id)
    }
  })

  it('keeps the thirds rational', () => {
    // 32/3 and not 10.667: the whole reason these are written as division.
    const p = scalePreset('arch-3-32')
    expect(p?.feetPerDrawingInch).toBe(32 / 3)
    expect(p?.feetPerDrawingInch).not.toBe(10.667)
  })
})

describe('conversion', () => {
  it('reads the canonical architectural scale correctly', () => {
    // 1/8" = 1'-0" means one drawing inch is 8 feet, so one point is 8/72 ft.
    const p = scalePreset('arch-1-8')!
    expect(feetPerPointForPreset(p)).toBeCloseTo(8 / 72, 12)
    expect(feetPerPointForPreset(p)).toBeCloseTo(0.111111111111, 10)
  })

  it('round-trips through drawing inches', () => {
    for (const p of SCALE_PRESETS) {
      const fpp = feetPerPointForPreset(p)
      expect(drawingInchFromFeetPerPoint(fpp)).toBeCloseTo(p.feetPerDrawingInch, 10)
    }
  })

  it('refuses non-positive and non-finite input rather than propagating it', () => {
    // A zero or NaN scale that survives into a measurement produces a
    // plausible-looking quantity that is silently wrong, which is worse than
    // an obvious zero.
    for (const bad of [0, -4, NaN, Infinity, -Infinity]) {
      expect(feetPerPointFromDrawingInch(bad)).toBe(0)
      expect(drawingInchFromFeetPerPoint(bad)).toBe(0)
    }
  })
})

describe('matchPreset', () => {
  it('matches a calibration measured off a drawing back to its named scale', () => {
    // Someone drew a line and typed a dimension; they landed 0.04% off.
    const exact = feetPerPointForPreset(scalePreset('arch-1-4')!)
    expect(matchPreset(exact * 1.0004)?.id).toBe('arch-1-4')
    expect(matchPreset(exact * 0.9996)?.id).toBe('arch-1-4')
  })

  it('rejects a calibration outside the tolerance', () => {
    const exact = feetPerPointForPreset(scalePreset('arch-1-4')!)
    expect(matchPreset(exact * 1.02)).toBeNull()
  })

  it('separates adjacent metric scales that an absolute epsilon would merge', () => {
    // 1:100 and 1:125 are 0.69 ft/in apart. A tolerance loose enough to be
    // useful on 1/32" scales in absolute terms would swallow this gap.
    const m100 = feetPerPointForPreset(scalePreset('metric-100')!)
    const m125 = feetPerPointForPreset(scalePreset('metric-125')!)
    expect(matchPreset(m100)?.id).toBe('metric-100')
    expect(matchPreset(m125)?.id).toBe('metric-125')
  })

  it('separates the finest architectural scales, which are far apart in ratio', () => {
    const fine = feetPerPointForPreset(scalePreset('arch-1-32')!)
    const next = feetPerPointForPreset(scalePreset('arch-1-16')!)
    expect(matchPreset(fine)?.id).toBe('arch-1-32')
    expect(matchPreset(next)?.id).toBe('arch-1-16')
  })

  it('holds exactly at the tolerance boundary', () => {
    const exact = feetPerPointForPreset(scalePreset('arch-1-8')!)
    expect(matchPreset(exact * (1 + PRESET_MATCH_TOLERANCE))?.id).toBe('arch-1-8')
    expect(matchPreset(exact * (1 + PRESET_MATCH_TOLERANCE * 1.5))).toBeNull()
  })

  it('returns null for an uncalibrated page', () => {
    expect(matchPreset(0)).toBeNull()
    expect(matchPreset(NaN)).toBeNull()
  })
})

describe('formatScaleFeet', () => {
  it('formats whole feet', () => {
    expect(formatScaleFeet(8)).toBe(`8'-0"`)
  })

  it('formats feet and whole inches', () => {
    expect(formatScaleFeet(10 + 6 / 12)).toBe(`10'-6"`)
  })

  it('reduces the fraction rather than always printing eighths', () => {
    expect(formatScaleFeet(12 + 6.5 / 12)).toBe(`12'-6 1/2"`)
    expect(formatScaleFeet(1 + 0.25 / 12)).toBe(`1'-0 1/4"`)
    expect(formatScaleFeet(3 / 8 / 12)).toBe(`0'-0 3/8"`)
  })

  it('rounds to the nearest eighth', () => {
    // 6.51" is not on the eighth grid; it rounds to 6 1/2".
    expect(formatScaleFeet(12 + 6.51 / 12)).toBe(`12'-6 1/2"`)
  })

  it('never returns an empty measurement for a tiny positive value', () => {
    // Math.max(1, …) in the port: a scale that rounds to zero eighths would
    // print 0'-0" and read as "no scale" rather than "very fine scale".
    expect(formatScaleFeet(1e-9)).toBe(`0'-0 1/8"`)
  })

  it('rejects nonsense', () => {
    expect(formatScaleFeet(0)).toBe('--')
    expect(formatScaleFeet(-3)).toBe('--')
    expect(formatScaleFeet(NaN)).toBe('--')
  })
})

describe('scaleLabel', () => {
  it('says what the title block says when a preset matches', () => {
    expect(scaleLabel(feetPerPointForPreset(scalePreset('arch-1-8')!))).toBe('1/8" = 1\'-0"')
    expect(scaleLabel(feetPerPointForPreset(scalePreset('metric-50')!))).toBe('1:50')
  })

  it('derives a readable scale when nothing matches', () => {
    // 17 ft per drawing inch is not a preset; it should still read as a scale.
    expect(scaleLabel(17 / 72)).toBe(`1" = 17'-0"`)
  })

  it('says so when the page is not calibrated', () => {
    expect(scaleLabel(null)).toBe('Uncalibrated')
    expect(scaleLabel(0)).toBe('Uncalibrated')
  })
})

describe('presetGroups', () => {
  it('groups all 26 without loss or duplication', () => {
    const groups = presetGroups()
    expect(groups.map((g) => g.system)).toEqual([
      'imperial-architectural', 'imperial-engineering', 'metric',
    ])
    expect(groups.flatMap((g) => g.presets)).toHaveLength(26)
    expect(new Set(groups.flatMap((g) => g.presets.map((p) => p.id))).size).toBe(26)
  })

  it('preserves table order inside a group rather than sorting', () => {
    const arch = presetGroups()[0]!.presets.map((p) => p.id)
    expect(arch[0]).toBe('arch-1-32')
    expect(arch[arch.length - 1]).toBe('arch-1-1')
  })
})

describe('preset provenance in calibrations.source', () => {
  it('writes one spelling for every preset', () => {
    for (const p of SCALE_PRESETS) {
      expect(presetSource(p)).toBe(`preset:${p.id}`)
    }
  })

  it('round-trips to the id it was written from', () => {
    for (const p of SCALE_PRESETS) {
      expect(presetIdFromSource(presetSource(p))).toBe(p.id)
    }
  })

  it('reads a preset this build no longer ships as stated, not measured', () => {
    // The point of returning the id rather than the preset: a source naming a
    // retired preset still answers "somebody read this off a title block".
    expect(presetIdFromSource('preset:arch-retired-1-7')).toBe('arch-retired-1-7')
  })

  it('reports every non-preset source as not a preset', () => {
    for (const s of ['reference-line', 'agent', 'test', '', 'preset:']) {
      expect(presetIdFromSource(s)).toBeNull()
    }
  })

  it('does not accept the migrated-away spelling', () => {
    // 009_scalesource.sql moves these rows. Tolerating both here is exactly
    // how two spellings survived side by side in the first place: nothing
    // ever failed, so nobody found out.
    expect(presetIdFromSource('scale-preset:arch-1-8')).toBeNull()
  })
})
