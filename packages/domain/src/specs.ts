/**
 * Typed scope specifications for the five product types.
 *
 * Ported from okular-redbeam `part/redbeamscopepanel.cpp`:
 *   RedbeamScopeStore::projectScopeType, redbeamCanonicalProductType,
 *   redbeamMeasureParameterToFeet, redbeamMissingRequiredLayoutFields,
 *   redbeamUnitDisplayText
 *
 * The vocabulary here is READ OFF the Qt build and its shipped project files,
 * not designed fresh. Real projects in the archive (Barclays Midrise, CL01 /
 * CL03A) store exactly these keys, so a scope written by the Qt build must
 * round-trip through this module unchanged.
 */

import { parseNumberOrFraction, unitToFeet } from './units.js'

/**
 * The product types the layout engine actually branches on.
 *
 * There are FIVE, not seven. redbeamscopepanel.cpp branches on exactly
 * "Panels", "Planks", "Baffle Cassette", "Baffle" and "Custom Assembly";
 * projectScopeType normalizes every input to one of the corresponding
 * snake_case ids, falling back to `baffle`.
 */
export type ProductType = 'panels' | 'planks' | 'baffle_cassette' | 'baffle' | 'custom_assembly'

export const PRODUCT_TYPES: readonly ProductType[] = [
  'panels', 'planks', 'baffle_cassette', 'baffle', 'custom_assembly',
] as const

/** Display names, matching the QStringLiteral labels the engine compares against. */
export const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  panels: 'Panels',
  planks: 'Planks',
  baffle_cassette: 'Baffle Cassette',
  baffle: 'Baffle',
  custom_assembly: 'Custom Assembly',
}

/**
 * Normalize any spelling of a product type to its canonical id.
 *
 * Faithful to RedbeamScopeStore::projectScopeType, INCLUDING its fallback: an
 * unrecognised type becomes `baffle`, not an error. That is load-bearing —
 * legacy project files carry free-text types and the Qt build silently treats
 * them as baffles. Rejecting them here would make those projects unopenable.
 */
export function canonicalProductType(type: string): ProductType {
  const n = type.trim().toLowerCase().replace(/[-\s]+/g, '_')
  if (n === 'baffle_cassette' || n === 'cassette' || n === 'cassettes') return 'baffle_cassette'
  if (n === 'panel' || n === 'panels') return 'panels'
  if (n === 'plank' || n === 'planks') return 'planks'
  if (n === 'custom' || n === 'custom_assembly' || n === 'customassembly') return 'custom_assembly'
  return 'baffle'
}

/**
 * Specifications as the Qt build stores them.
 *
 * MOSTLY string-to-string — numbers ("4") and booleans ("true") are text — but
 * NOT entirely. Real projects carry nested objects: `scopeDefaultDirection` is
 * `{sourcePage, x1, y1, x2, y2}`, seen on both live scopes in the Turkish
 * Airlines Lounge project. Typing this as `Record<string, string>` was a lie
 * about the data, and every reader below would have handed an object straight
 * to a number parser.
 *
 * The map is the persisted format, so it is kept verbatim rather than parsed
 * on load — a lossy round-trip would rewrite other people's projects. Typed
 * access goes through the readers, each of which tolerates a non-string.
 */
export type Specifications = Record<string, unknown>

/**
 * Read a spec as text, or null when it is absent or not a string.
 *
 * Returning null rather than String(value) is deliberate: stringifying
 * `{x1: 0.23}` yields "[object Object]", which parses as no number but reads
 * in a UI as though a value were set.
 */
export function readString(specs: Specifications, key: string): string | null {
  const v = specs[key]
  return typeof v === 'string' ? v : null
}

/** A value+unit pair. The Qt build stores these as two separate keys. */
export interface MeasureField {
  /** Key holding the numeric text, e.g. "panelWidth". */
  valueKey: string
  /** Key holding the unit, e.g. "panelWidthUnit". */
  unitKey: string
  /** Short label as it appears in the Qt spec editor. */
  label: string
}

const measure = (valueKey: string, label: string): MeasureField =>
  ({ valueKey, unitKey: `${valueKey}Unit`, label })

/**
 * Read a measure pair as feet.
 *
 * Faithful to redbeamMeasureParameterToFeet: a non-positive value, an
 * unparseable number, or an unrecognised unit all yield null (the C++ returns
 * false). Note the value must be > 0 — zero is a failure, not a measurement.
 */
export function measureToFeet(specs: Specifications, field: MeasureField): number | null {
  const raw = readString(specs, field.valueKey)
  if (raw === null) return null
  const value = parseNumberOrFraction(raw)
  if (value === null || value <= 0) return null
  const feet = unitToFeet(value, readString(specs, field.unitKey) ?? '')
  if (feet === null || feet <= 0) return null
  return feet
}

/**
 * Unit shown when the stored unit is missing or unrecognised.
 * Ported from redbeamUnitDisplayText, whose fallback is INCHES, not feet.
 */
export function unitDisplayText(unit: string): string {
  const n = unit.trim().toLowerCase()
  return n === 'ft' || n === 'in' || n === 'mm' || n === 'cm' || n === 'm' ? n : 'in'
}

/**
 * The measure fields the layout engine requires before it will calculate.
 *
 * Ported from redbeamMissingRequiredLayoutFields. Custom assemblies require
 * nothing: they are quantified by hand and no dimension would produce a
 * machine calculation.
 */
export function requiredMeasures(product: ProductType): MeasureField[] {
  switch (product) {
    case 'custom_assembly':
      return []
    case 'panels':
      return [measure('panelWidth', 'Panel W'), measure('panelLength', 'Panel L')]
    case 'planks':
      return [measure('plankWidth', 'Plank W'), measure('stockLength', 'Stock')]
    case 'baffle_cassette':
      return [
        measure('spacing', 'Spacing OC'),
        measure('stockLength', 'Stock'),
        // The same key, relabelled: a cassette backing spacing and a baffle
        // connector spacing are one parameter with two names.
        { valueKey: 'maxConnectorSpacing', unitKey: 'maxConnectorSpacingUnit', label: 'Backing Max' },
      ]
    case 'baffle':
      return [
        measure('spacing', 'Spacing OC'),
        measure('stockLength', 'Stock'),
        { valueKey: 'maxConnectorSpacing', unitKey: 'maxConnectorSpacingUnit', label: 'Conn. Max' },
      ]
  }
}

/** Labels of required measures that are missing or unusable. Empty == ready. */
export function missingRequiredMeasures(product: ProductType, specs: Specifications): string[] {
  return requiredMeasures(product)
    .filter((f) => measureToFeet(specs, f) === null)
    .map((f) => f.label)
}

/** True when the layout engine has everything it needs to calculate. */
export function canCalculateLayout(product: ProductType, specs: Specifications): boolean {
  return missingRequiredMeasures(product, specs).length === 0
}

/**
 * Resolve a scope colour.
 *
 * The Qt build stores colour TWICE — a `color` column and a `scopeColor` spec
 * key — and prefers the column, then the spec, then #4C8DFF. We port the
 * resolution because existing projects depend on it, but new writes should set
 * the column only; see `cleanSpecifications`.
 */
export const DEFAULT_SCOPE_COLOR = '#4C8DFF'

export function resolveScopeColor(columnColor: string | null | undefined, specs: Specifications): string {
  const col = (columnColor ?? '').trim()
  if (col.length > 0) return col
  const spec = (readString(specs, 'scopeColor') ?? '').trim()
  if (spec.length > 0) return spec
  return DEFAULT_SCOPE_COLOR
}

/**
 * Keys the Qt build persists into scope specifications that are really VIEW
 * state, not scope data.
 *
 * `layoutPreviewActive`, `showConnectors`, `showEndCaps`, `showJoiners`,
 * `showOverflowPreview` and `dimPageContent` are panel toggles. Storing them
 * on the scope means one estimator open/closed panels travel with the
 * estimate and mark it dirty; CL01 in the Barclays project carries
 * `dimPageContent` while CL03A does not, purely because of which panel
 * happened to be open when each was saved.
 *
 * We read them (so nothing is lost on import) but never write them back.
 * See docs/PORTING.md — defects not to port.
 */
export const VIEW_STATE_SPEC_KEYS: readonly string[] = [
  'layoutPreviewActive', 'showConnectors', 'showEndCaps', 'showJoiners',
  'showOverflowPreview', 'dimPageContent',
] as const

/** Specs with the view-state and denormalized-colour keys removed. */
export function cleanSpecifications(specs: Specifications): Specifications {
  const out: Specifications = {}
  for (const [k, v] of Object.entries(specs)) {
    if (VIEW_STATE_SPEC_KEYS.includes(k)) continue
    if (k === 'scopeColor') continue
    out[k] = v
  }
  return out
}

/**
 * Every measure field the spec editor offers for a product type, required or
 * not. Drives the 04.3 editor; the required subset is flagged separately.
 */
/**
 * What a measure CONTROLS, in four words.
 *
 * The labels are trade abbreviations — "Stock", "Conn. Max", "Reveal" — and
 * which of them moves the piece count is not guessable from the abbreviation.
 * These are captions, not new semantics: each one names the thing the layout
 * engine already does with that key.
 *
 * Keyed by `valueKey` so a field carries its caption wherever it is rendered,
 * and returning '' rather than throwing so a new measure shows a bare label
 * instead of breaking the panel.
 */
export function measureHelp(valueKey: string): string {
  switch (valueKey) {
    case 'panelWidth': return 'panel face width'
    case 'panelLength': return 'panel face length'
    case 'plankWidth': return 'plank face width'
    case 'cassetteWidth': return 'cassette face, and its trim'
    case 'stockLength': return 'length you buy'
    case 'spacing': return 'centre to centre'
    case 'revealSpacing': return 'gap between faces'
    case 'railLength': return 'rail stock length'
    case 'maxRailSpacing': return 'furthest apart rails may sit'
    case 'maxConnectorSpacing': return 'furthest apart connectors may sit'
    case 'perimeterTrimLength': return 'trim stock length'
    default: return ''
  }
}

export function editableMeasures(product: ProductType): MeasureField[] {
  // Planks are the only product that reads a generic trim length.
  const common = [measure('perimeterTrimLength', 'Trim Len')]
  switch (product) {
    case 'custom_assembly':
      return []
    case 'panels':
      /*
       * No "Conn. Max" here either, for the same reason it is absent from
       * planks: nothing reads it. `maxConnectorSpacing` appears nowhere in
       * panels.ts — a panel grid has no connectors to space — so a value typed
       * into it could not change the number beside it. The Qt editor offers
       * the field; an input that cannot affect its own result is worse than a
       * missing one. The stored key is untouched, so a project written by the
       * Qt build still round-trips.
       */
      /*
       * No Trim Len either. `perimeterTrimLength` is read by the RUN products
       * only — `layoutPanels` never looks at it and no panel output reports
       * trim — so on a panel scope it is one more field that cannot change the
       * number beside it.
       */
      return [
        measure('panelWidth', 'Panel W'),
        measure('panelLength', 'Panel L'),
      ]
    case 'planks':
      /*
       * No "Conn. Max" here, and that is not an omission.
       *
       * The layout engine overwrites a plank's connector spacing with its stock
       * length unconditionally (see resolveRunInputs, and the Qt original it is
       * ported from). The Qt editor offers the field anyway, so a value typed
       * into it changes nothing — an input that cannot affect the number beside
       * it is worse than a missing one. The stored key is untouched either way,
       * so a project written by the Qt build still round-trips.
       *
       * Rails ARE here: they are what a plank ceiling hangs from, the engine has
       * always laid them out, and nothing offered a way to specify them.
       */
      return [
        measure('plankWidth', 'Plank W'),
        measure('stockLength', 'Stock'),
        measure('spacing', 'Spacing OC'),
        measure('revealSpacing', 'Reveal'),
        measure('railLength', 'Rail Len'),
        { valueKey: 'maxRailSpacing', unitKey: 'maxRailSpacingUnit', label: 'Rail Max' },
        ...common,
      ]
    case 'baffle_cassette':
      // A cassette's perimeter trim length is read from `cassetteWidth`, not
      // from `perimeterTrimLength` — so that is the field to offer, and the
      // generic Trim Len would be inert.
      return [...requiredMeasures(product), measure('cassetteWidth', 'Cassette W')]
    case 'baffle':
      /*
       * And not here. resolveRunInputs reads a trim length for planks and, as
       * `cassetteWidth`, for a cassette — a plain baffle reads none, and so
       * never reports trim. The field was offered anyway.
       */
      return [...requiredMeasures(product)]
  }
}

/**
 * Product type, stored inside specifications rather than in a column.
 *
 * The Qt schema puts the PRODUCT type in `scopes.scope_type`; ours puts the
 * MEASUREMENT type (area/linear/count) there, because that is what drives the
 * quantity roll-up and it is needed on every page paint. Both are real and
 * neither replaces the other, so the product type rides along in the specs map
 * under an explicit key and the mapping lives here rather than being inferred
 * at three call sites.
 */
export const PRODUCT_TYPE_KEY = 'productType'

export function readProductType(specs: Specifications): ProductType {
  return canonicalProductType(readString(specs, PRODUCT_TYPE_KEY) ?? '')
}

export function writeProductType(specs: Specifications, product: ProductType): Specifications {
  return { ...specs, [PRODUCT_TYPE_KEY]: product }
}

/**
 * Which key holds this product's granularity.
 *
 * Two keys exist because two engines read them: `layoutPanels` reads
 * `panelGranularity`, and the run products read `yieldGranularity`. The editor
 * wrote `panelGranularity` for everything, so on a plank scope the Granularity
 * control changed a key nothing reads while the key that governs plank yield
 * could not be reached at all. One function, so the question is answered in
 * one place.
 */
export function granularityKey(product: ProductType): string {
  return product === 'panels' ? 'panelGranularity' : 'yieldGranularity'
}

/** Yield / piece granularity. Stored as `panelGranularity` and `yieldGranularity`. */
export type Granularity = 'full' | 'half' | 'quarter'

export const GRANULARITIES: readonly Granularity[] = ['full', 'half', 'quarter'] as const

export function readGranularity(specs: Specifications, key: string): Granularity {
  const v = (readString(specs, key) ?? '').trim().toLowerCase()
  return v === 'half' || v === 'quarter' ? v : 'full'
}

/** Read a Qt-style boolean spec ("true"/"false" as text). */
export function readBool(specs: Specifications, key: string, fallback = false): boolean {
  const v = readString(specs, key)
  if (v === null) return typeof specs[key] === 'boolean' ? specs[key] as boolean : fallback
  const n = v.trim().toLowerCase()
  if (n === 'true' || n === '1') return true
  if (n === 'false' || n === '0') return false
  return fallback
}

/**
 * Plank width, reveal and on-centre spacing are three views of one geometry.
 *
 *     spacing = plankWidth + reveal
 *
 * A plank sits `plankWidth` wide and the next one starts `reveal` further on,
 * so the pitch between their centres is the sum. Any two of the three fix the
 * third exactly, and an estimator who has entered two has already said what
 * the third is — asking them to compute it by hand invites the arithmetic
 * slip that shows up two hundred planks later.
 *
 * Only ever fills a field that is EMPTY. A value already typed is a statement,
 * and quietly rewriting it because two of its neighbours disagree would be a
 * worse failure than leaving an inconsistency the estimator can see. If all
 * three are set and they contradict, `resolveRunInputs` prefers the explicit
 * spacing, and this leaves the contradiction visible rather than papering
 * over it.
 *
 * Returns the specifications unchanged when there is nothing to derive.
 */
export function deriveRunTriple(specs: Specifications): Specifications {
  const FIELDS = {
    width: measure('plankWidth', 'Plank W'),
    spacing: measure('spacing', 'Spacing OC'),
    reveal: measure('revealSpacing', 'Reveal'),
  } as const

  /** Present means "the estimator typed something", not "it is positive". */
  const typed = (f: MeasureField): boolean =>
    (readString(specs, f.valueKey) ?? '').trim() !== ''

  /**
   * In feet. A reveal of zero is a real answer — planks that butt together —
   * so it is read directly rather than through measureToFeet, which treats a
   * non-positive value as absent.
   */
  const feet = (f: MeasureField): number | null => {
    const raw = readString(specs, f.valueKey)
    if (raw === null) return null
    const value = parseNumberOrFraction(raw)
    if (value === null || value < 0) return null
    return unitToFeet(value, readString(specs, f.unitKey) ?? '')
  }

  const missing = (Object.keys(FIELDS) as Array<keyof typeof FIELDS>)
    .filter((k) => !typed(FIELDS[k]))
  if (missing.length !== 1) return specs
  const target = missing[0]!

  const width = feet(FIELDS.width)
  const spacing = feet(FIELDS.spacing)
  const reveal = feet(FIELDS.reveal)

  let derivedFeet: number | null = null
  if (target === 'spacing' && width !== null && reveal !== null) derivedFeet = width + reveal
  if (target === 'reveal' && spacing !== null && width !== null) derivedFeet = spacing - width
  if (target === 'width' && spacing !== null && reveal !== null) derivedFeet = spacing - reveal
  if (derivedFeet === null || !Number.isFinite(derivedFeet)) return specs
  // A negative reveal or a non-positive width is not a geometry. Say nothing
  // rather than writing a number that cannot be built.
  if (derivedFeet < 0) return specs
  if (target === 'width' && derivedFeet === 0) return specs

  const field = FIELDS[target]
  // Written in the unit the estimator is already working in: this field's own
  // unit if it has one, otherwise the plank width's, otherwise inches — the
  // same fallback `unitDisplayText` uses.
  const unit =
    (readString(specs, field.unitKey) ?? '').trim() ||
    (readString(specs, FIELDS.width.unitKey) ?? '').trim() ||
    'in'
  const perUnit = unitToFeet(1, unit)
  if (perUnit === null || !(perUnit > 0)) return specs

  const value = derivedFeet / perUnit
  // Trailing zeros are noise in a field somebody is about to read back.
  const text = String(Number(value.toFixed(4)))
  return { ...specs, [field.valueKey]: text, [field.unitKey]: unit }
}
