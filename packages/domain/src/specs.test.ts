import { describe, it, expect } from 'vitest'
import {
  canonicalProductType, measureToFeet, missingRequiredMeasures, canCalculateLayout,
  requiredMeasures, editableMeasures, resolveScopeColor, cleanSpecifications,
  readGranularity, readBool, unitDisplayText, readString, PRODUCT_TYPES, DEFAULT_SCOPE_COLOR,
  deriveRunTriple,
  type Specifications,
  granularityKey,
} from './specs.js'

/**
 * Verbatim specifications_json from the archived Qt project
 * "Testing Case Studies/Barclays - Midrise Floors Phase 1", scope CL01.
 * If this stops round-tripping, real estimates stop opening correctly.
 */
const CL01: Specifications = {
  alignSeams: 'true',
  dimPageContent: 'false',
  layoutPreviewActive: 'false',
  maxConnectorSpacing: '3',
  maxConnectorSpacingUnit: 'ft',
  panelGranularity: 'full',
  panelLength: '4',
  panelLengthUnit: 'ft',
  panelWidth: '3',
  panelWidthUnit: 'ft',
  perimeterTrimLength: '8',
  perimeterTrimLengthUnit: 'ft',
  profileHeightInches: '',
  profileWidthInches: '',
  scopeColor: '#2d9cdb',
  showConnectors: 'false',
  showEndCaps: 'false',
  showJoiners: 'false',
  showOverflowPreview: 'true',
  spacing: '',
  spacingUnit: 'in',
  stockLength: '',
  stockLengthUnit: 'ft',
  yieldGranularity: 'full',
}

/**
 * Same project, scope CL03A — half panel granularity, 2ft wide.
 * Note it has NO `dimPageContent` key at all, exactly as stored: that key
 * exists on CL01 only because of which panel was open when it was saved.
 */
const CL03A: Specifications = (() => {
  const { dimPageContent: _omitted, ...rest } = CL01
  return { ...rest, panelGranularity: 'half', panelWidth: '2', perimeterTrimLength: '10', scopeColor: '#f4b740' }
})()

describe('canonicalProductType', () => {
  it('normalizes every spelling the Qt build accepts', () => {
    expect(canonicalProductType('Baffle Cassette')).toBe('baffle_cassette')
    expect(canonicalProductType('baffle_cassette')).toBe('baffle_cassette')
    expect(canonicalProductType('baffle-cassette')).toBe('baffle_cassette')
    expect(canonicalProductType('cassette')).toBe('baffle_cassette')
    expect(canonicalProductType('Panel')).toBe('panels')
    expect(canonicalProductType('  PANELS ')).toBe('panels')
    expect(canonicalProductType('plank')).toBe('planks')
    expect(canonicalProductType('Custom Assembly')).toBe('custom_assembly')
    expect(canonicalProductType('customassembly')).toBe('custom_assembly')
  })

  it('falls back to baffle rather than throwing', () => {
    // Load-bearing: legacy files carry free-text types. Rejecting them would
    // make those projects unopenable, which the Qt build never does.
    expect(canonicalProductType('')).toBe('baffle')
    expect(canonicalProductType('something nobody wrote')).toBe('baffle')
  })

  it('every canonical id round-trips through itself', () => {
    for (const t of PRODUCT_TYPES) expect(canonicalProductType(t)).toBe(t)
  })
})

describe('measureToFeet', () => {
  const f = (k: string) => ({ valueKey: k, unitKey: `${k}Unit`, label: k })

  it('reads a real panel dimension', () => {
    expect(measureToFeet(CL01, f('panelWidth'))).toBeCloseTo(3, 12)
    expect(measureToFeet(CL01, f('panelLength'))).toBeCloseTo(4, 12)
  })

  it('converts through the unit', () => {
    expect(measureToFeet({ a: '18', aUnit: 'in' }, f('a'))).toBeCloseTo(1.5, 12)
  })

  it('accepts a mixed fraction, because estimators type them', () => {
    expect(measureToFeet({ a: '7 1/2', aUnit: 'in' }, f('a'))).toBeCloseTo(7.5 / 12, 12)
  })

  it('treats empty, zero and negative as ABSENT, not as zero', () => {
    // redbeamMeasureParameterToFeet returns false for value <= 0. A scope with
    // spacing "" must read as unconfigured, not as spacing of zero, or the
    // layout engine divides by it.
    expect(measureToFeet(CL01, f('spacing'))).toBeNull()
    expect(measureToFeet({ a: '0', aUnit: 'ft' }, f('a'))).toBeNull()
    expect(measureToFeet({ a: '-3', aUnit: 'ft' }, f('a'))).toBeNull()
  })

  it('rejects an unrecognised unit and a missing key', () => {
    expect(measureToFeet({ a: '3', aUnit: 'furlong' }, f('a'))).toBeNull()
    expect(measureToFeet({}, f('a'))).toBeNull()
  })

  it('rejects trailing garbage rather than silently taking the prefix', () => {
    expect(measureToFeet({ a: '3ft', aUnit: 'ft' }, f('a'))).toBeNull()
  })
})

describe('required measures per product type', () => {
  it('custom assembly requires nothing', () => {
    expect(requiredMeasures('custom_assembly')).toEqual([])
    expect(canCalculateLayout('custom_assembly', {})).toBe(true)
    expect(editableMeasures('custom_assembly')).toEqual([])
  })

  it('CL01 is a calculable panels scope', () => {
    expect(missingRequiredMeasures('panels', CL01)).toEqual([])
    expect(canCalculateLayout('panels', CL01)).toBe(true)
  })

  it('the SAME specs are not calculable as planks or baffles', () => {
    // CL01 has no plankWidth, no stockLength and no spacing. This is the guard
    // behind 04.5: switching a configured scope to another product type must
    // report what is missing, not silently calculate nothing.
    expect(missingRequiredMeasures('planks', CL01)).toEqual(['Plank W', 'Stock'])
    expect(missingRequiredMeasures('baffle', CL01)).toEqual(['Spacing OC', 'Stock'])
    expect(canCalculateLayout('planks', CL01)).toBe(false)
  })

  it('labels the shared spacing key differently for cassettes and baffles', () => {
    expect(requiredMeasures('baffle_cassette').map((m) => m.label)).toEqual(['Spacing OC', 'Stock', 'Backing Max'])
    expect(requiredMeasures('baffle').map((m) => m.label)).toEqual(['Spacing OC', 'Stock', 'Conn. Max'])
    // ...but it is one parameter, not two.
    expect(requiredMeasures('baffle_cassette')[2]!.valueKey).toBe(requiredMeasures('baffle')[2]!.valueKey)
  })

  it('every required measure is also editable', () => {
    for (const t of PRODUCT_TYPES) {
      const editable = new Set(editableMeasures(t).map((m) => m.valueKey))
      for (const r of requiredMeasures(t)) expect(editable.has(r.valueKey)).toBe(true)
    }
  })
})

describe('scope colour resolution', () => {
  it('prefers the column over the duplicated spec key', () => {
    expect(resolveScopeColor('#111111', CL01)).toBe('#111111')
  })
  it('falls back to the spec key, then to the Qt default', () => {
    expect(resolveScopeColor('', CL01)).toBe('#2d9cdb')
    expect(resolveScopeColor(null, {})).toBe(DEFAULT_SCOPE_COLOR)
  })
})

describe('cleanSpecifications', () => {
  it('drops panel toggles and the duplicated colour, keeps real specs', () => {
    const out = cleanSpecifications(CL01)
    expect(out['layoutPreviewActive']).toBeUndefined()
    expect(out['showConnectors']).toBeUndefined()
    expect(out['dimPageContent']).toBeUndefined()
    expect(out['scopeColor']).toBeUndefined()
    expect(out['panelWidth']).toBe('3')
    expect(out['panelGranularity']).toBe('full')
  })

  it('makes CL01 and CL03A differ only by real parameters', () => {
    // In the archive these two scopes differ by `dimPageContent` purely because
    // of which panel was open when each was saved. After cleaning, the only
    // differences left should be ones an estimator actually chose.
    const a = cleanSpecifications(CL01)
    const b = cleanSpecifications(CL03A)
    const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((k) => a[k] !== b[k])
      .sort()
    expect(changed).toEqual(['panelGranularity', 'panelWidth', 'perimeterTrimLength'])
  })

  it('is idempotent', () => {
    expect(cleanSpecifications(cleanSpecifications(CL01))).toEqual(cleanSpecifications(CL01))
  })
})

describe('non-string spec values', () => {
  // Verbatim from the live Turkish Airlines Lounge project, scope C-MT-01.
  // Both of its scopes carry this as a nested OBJECT, so the old
  // Record<string, string> type was a lie about real data.
  const withObject: Specifications = {
    ...CL01,
    scopeDefaultDirection: { sourcePage: 39, x1: 0.23, x2: 0.23, y1: 0.51, y2: 0.68 },
  }

  it('reads a nested object as absent rather than as text', () => {
    // String(value) would give "[object Object]": parses as no number, but
    // reads in a UI as though a value were set.
    expect(readString(withObject, 'scopeDefaultDirection')).toBeNull()
    expect(readString(withObject, 'panelWidth')).toBe('3')
    expect(readString(withObject, 'nothing')).toBeNull()
  })

  it('does not hand an object to the number parser', () => {
    const f = { valueKey: 'scopeDefaultDirection', unitKey: 'x', label: 'x' }
    expect(measureToFeet(withObject, f)).toBeNull()
  })

  it('keeps every other reader working alongside it', () => {
    expect(missingRequiredMeasures('panels', withObject)).toEqual([])
    expect(readGranularity(withObject, 'panelGranularity')).toBe('full')
    expect(readBool(withObject, 'alignSeams')).toBe(true)
    expect(resolveScopeColor('', withObject)).toBe('#2d9cdb')
  })

  it('preserves the object through a clean, rather than dropping or flattening it', () => {
    // It is real scope data — the drawn default pattern direction — so it must
    // survive a round-trip even though no typed reader consumes it yet.
    const out = cleanSpecifications(withObject)
    expect(out['scopeDefaultDirection']).toEqual(withObject['scopeDefaultDirection'])
  })
})

describe('typed readers', () => {
  it('reads granularity, defaulting to full', () => {
    expect(readGranularity(CL01, 'panelGranularity')).toBe('full')
    expect(readGranularity(CL03A, 'panelGranularity')).toBe('half')
    expect(readGranularity({}, 'panelGranularity')).toBe('full')
    expect(readGranularity({ g: 'nonsense' }, 'g')).toBe('full')
  })

  it('reads Qt string booleans', () => {
    expect(readBool(CL01, 'alignSeams')).toBe(true)
    expect(readBool(CL01, 'showConnectors')).toBe(false)
    expect(readBool({}, 'missing', true)).toBe(true)
    expect(readBool({ b: 'nonsense' }, 'b', true)).toBe(true)
  })

  it('falls back to inches for an unknown unit, matching the Qt display', () => {
    expect(unitDisplayText('ft')).toBe('ft')
    expect(unitDisplayText('MM')).toBe('mm')
    expect(unitDisplayText('')).toBe('in')
    expect(unitDisplayText('furlong')).toBe('in')
  })
})

/**
 * `spacing = plankWidth + reveal` — three views of one geometry. An estimator
 * who has entered two has already said what the third is, and making them do
 * the arithmetic invites a slip that only shows up two hundred planks later.
 */
describe('deriveRunTriple', () => {
  const base = { productType: 'planks' }

  it('fills the spacing from a width and a reveal', () => {
    const out = deriveRunTriple({ ...base, plankWidth: '6', plankWidthUnit: 'in', revealSpacing: '2', revealSpacingUnit: 'in' })
    expect(out['spacing']).toBe('8')
    expect(out['spacingUnit']).toBe('in')
  })

  it('fills the reveal from a spacing and a width', () => {
    const out = deriveRunTriple({ ...base, plankWidth: '6', plankWidthUnit: 'in', spacing: '8', spacingUnit: 'in' })
    expect(out['revealSpacing']).toBe('2')
  })

  it('fills the width from a spacing and a reveal', () => {
    const out = deriveRunTriple({ ...base, spacing: '8', spacingUnit: 'in', revealSpacing: '2', revealSpacingUnit: 'in' })
    expect(out['plankWidth']).toBe('6')
  })

  it('converts across units', () => {
    // 1 ft of spacing less 6 in of plank leaves 6 in of reveal.
    const out = deriveRunTriple({ ...base, plankWidth: '6', plankWidthUnit: 'in', spacing: '1', spacingUnit: 'ft' })
    expect(out['revealSpacing']).toBe('6')
    expect(out['revealSpacingUnit']).toBe('in')
  })

  it('treats a zero reveal as an answer, not as absent', () => {
    // Planks that butt together. 0 is a real reveal and fixes the spacing.
    const out = deriveRunTriple({ ...base, plankWidth: '6', plankWidthUnit: 'in', revealSpacing: '0', revealSpacingUnit: 'in' })
    expect(out['spacing']).toBe('6')
  })

  it('never overwrites something already entered', () => {
    const specs = {
      ...base, plankWidth: '6', plankWidthUnit: 'in',
      revealSpacing: '2', revealSpacingUnit: 'in', spacing: '99', spacingUnit: 'in',
    }
    // Contradictory, and left alone: a typed value is a statement, and a
    // contradiction the estimator can see beats one quietly papered over.
    expect(deriveRunTriple(specs)['spacing']).toBe('99')
  })

  it('waits until two of the three are there', () => {
    const specs = { ...base, plankWidth: '6', plankWidthUnit: 'in' }
    expect(deriveRunTriple(specs)).toEqual(specs)
  })

  it('refuses a geometry that cannot be built', () => {
    // A plank wider than its own pitch would need a negative reveal.
    const specs = { ...base, plankWidth: '10', plankWidthUnit: 'in', spacing: '6', spacingUnit: 'in' }
    expect(deriveRunTriple(specs)['revealSpacing']).toBeUndefined()
  })
})

/**
 * An audit of every product type: what it offers, what it requires, and what
 * the engine actually reads. A field that cannot change the number beside it
 * is worse than a missing one — it invites an estimator to set a value and
 * believe it did something.
 */
describe('each product type offers only what it reads', () => {
  /** Keys `resolveRunInputs` and `layoutPanels` actually consume, per product. */
  const CONSUMED: Record<string, string[]> = {
    panels: ['panelWidth', 'panelLength'],
    planks: [
      'plankWidth', 'stockLength', 'spacing', 'revealSpacing',
      'railLength', 'maxRailSpacing', 'minRailSpacing', 'perimeterTrimLength',
    ],
    baffle: ['spacing', 'stockLength', 'maxConnectorSpacing', 'profileWidthInches'],
    baffle_cassette: [
      'spacing', 'stockLength', 'maxConnectorSpacing', 'profileWidthInches', 'cassetteWidth',
    ],
    custom_assembly: [],
  }

  for (const product of PRODUCT_TYPES) {
    it(`${product} offers no field its engine ignores`, () => {
      for (const field of editableMeasures(product)) {
        expect(CONSUMED[product], `${product} offers ${field.valueKey}, which nothing reads`)
          .toContain(field.valueKey)
      }
    })

    it(`${product} requires nothing it does not read`, () => {
      for (const field of requiredMeasures(product)) {
        expect(CONSUMED[product], `${product} blocks on ${field.valueKey}, which nothing reads`)
          .toContain(field.valueKey)
      }
    })

    it(`${product} offers everything it requires`, () => {
      const offered = new Set(editableMeasures(product).map((f) => f.valueKey))
      for (const field of requiredMeasures(product)) {
        expect(offered, `${product} requires ${field.valueKey} but offers no way to set it`)
          .toContain(field.valueKey)
      }
    })
  }

  /**
   * Two keys exist because two engines read them: `layoutPanels` reads
   * `panelGranularity`, run products read `yieldGranularity`. The editor wrote
   * `panelGranularity` for everything, so on a plank scope the Granularity
   * control changed a key nothing reads.
   */
  it('names the granularity key the reading engine uses', () => {
    expect(granularityKey('panels')).toBe('panelGranularity')
    for (const product of ['planks', 'baffle', 'baffle_cassette'] as const) {
      expect(granularityKey(product), product).toBe('yieldGranularity')
    }
  })
})
