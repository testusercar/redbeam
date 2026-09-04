import { describe, expect, it } from 'vitest'
import type { Region } from './geometry.js'
import { buildRunLayout } from './pieces.js'
import {
  layoutRuns, regionPerimeterPoints, resolveRunInputs, runQuantities, summarizeRuns,
  type RunGroup, type RunInputs, type RunLayoutEntry,
} from './runs.js'

/** A 10ft x 10ft room at 1ft per point, so points and feet are the same number. */
const ROOM: Region = [[
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
]]

const ACROSS: RunGroup = { pageId: 'p1', region: ROOM, direction: { x: 1, y: 0 }, feetPerPoint: 1 }

const BAFFLE_INPUTS: RunInputs = {
  spacingFeet: 2,
  stockLengthFeet: 5,
  maxConnectorSpacingFeet: 2.5,
  componentWidthFeet: 0,
  perimeterTrimLengthFeet: 0,
  railLengthFeet: 0,
  railSpacingFeet: 0,
  yieldGranularity: 'full',
  alignSeams: false,
}

describe('resolveRunInputs', () => {
  it('defaults a plank pitch to the plank width plus its reveal', () => {
    const inputs = resolveRunInputs('planks', {
      plankWidth: '6', plankWidthUnit: 'in',
      stockLength: '10', stockLengthUnit: 'ft',
      revealSpacing: '2', revealSpacingUnit: 'in',
    })
    expect(inputs?.spacingFeet).toBeCloseTo(8 / 12, 10)
  })

  it('prefers an explicit spacing over the plank width', () => {
    const inputs = resolveRunInputs('planks', {
      plankWidth: '6', plankWidthUnit: 'in',
      stockLength: '10', stockLengthUnit: 'ft',
      spacing: '9', spacingUnit: 'in',
    })
    expect(inputs?.spacingFeet).toBeCloseTo(0.75, 10)
  })

  /**
   * A quirk of the Qt engine, ported deliberately: the plank spec editor offers
   * "Conn. Max" and the layout ignores it. If this ever starts passing with the
   * typed value, our counts have silently diverged from the oracle.
   */
  it('ignores a plank’s own connector spacing and uses the stock length', () => {
    const inputs = resolveRunInputs('planks', {
      plankWidth: '6', plankWidthUnit: 'in',
      stockLength: '10', stockLengthUnit: 'ft',
      maxConnectorSpacing: '18', maxConnectorSpacingUnit: 'in',
    })
    expect(inputs?.maxConnectorSpacingFeet).toBe(10)
  })

  /** Another one: a cassette's trim length is its cassetteWidth. */
  it('takes a cassette’s trim length from cassetteWidth', () => {
    const inputs = resolveRunInputs('baffle_cassette', {
      spacing: '2', spacingUnit: 'ft',
      stockLength: '8', stockLengthUnit: 'ft',
      maxConnectorSpacing: '4', maxConnectorSpacingUnit: 'ft',
      cassetteWidth: '4', cassetteWidthUnit: 'ft',
    })
    expect(inputs?.perimeterTrimLengthFeet).toBe(4)
  })

  /** And a plain baffle reads no trim at all, so it never reports any. */
  it('reads no trim length for a plain baffle', () => {
    const inputs = resolveRunInputs('baffle', {
      spacing: '2', spacingUnit: 'ft',
      stockLength: '8', stockLengthUnit: 'ft',
      maxConnectorSpacing: '4', maxConnectorSpacingUnit: 'ft',
      perimeterTrimLength: '10', perimeterTrimLengthUnit: 'ft',
    })
    expect(inputs?.perimeterTrimLengthFeet).toBe(0)
  })

  it('falls back to the stock length when no connector spacing is usable', () => {
    const inputs = resolveRunInputs('planks', {
      plankWidth: '6', plankWidthUnit: 'in',
      stockLength: '12', stockLengthUnit: 'ft',
    })
    expect(inputs?.maxConnectorSpacingFeet).toBe(12)
  })

  it('returns null when a required measure is missing', () => {
    expect(resolveRunInputs('baffle', { spacing: '2', spacingUnit: 'ft' })).toBeNull()
    expect(resolveRunInputs('planks', { plankWidth: '6', plankWidthUnit: 'in' })).toBeNull()
  })

  it('refuses a product that is not laid out in runs', () => {
    expect(resolveRunInputs('panels', {})).toBeNull()
    expect(resolveRunInputs('custom_assembly', {})).toBeNull()
  })
})

describe('regionPerimeterPoints', () => {
  it('measures a closed ring whether or not it repeats its first point', () => {
    expect(regionPerimeterPoints(ROOM)).toBeCloseTo(40, 10)
    expect(regionPerimeterPoints([[...ROOM[0]!, { x: 0, y: 0 }]])).toBeCloseTo(40, 10)
  })

  /**
   * A hole counts. Trim runs around an opening exactly as it runs around a
   * wall, and leaving holes out under-orders it.
   */
  it('adds the boundary of a hole', () => {
    const withHole: Region = [
      ROOM[0]!,
      [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 2, y: 4 }],
    ]
    expect(regionPerimeterPoints(withHole)).toBeCloseTo(40 + 8, 10)
  })
})

describe('summarizeRuns', () => {
  const entriesFor = (inputs: RunInputs, group = ACROSS): RunLayoutEntry[] =>
    layoutRuns([group], inputs)

  it('lays a room out into pieces and counts the stock to order', () => {
    const entries = entriesFor(BAFFLE_INPUTS)
    const summary = summarizeRuns(entries, BAFFLE_INPUTS)

    // 10ft of run per row, 5ft stock: two whole pieces per row, no offcuts.
    expect(summary.placedPieceCount).toBeGreaterThan(0)
    expect(summary.primaryStockCount).toBe(summary.placedPieceCount)
    expect(summary.fullPieceCount).toBe(summary.placedPieceCount)
    expect(summary.netLinearFeet).toBeCloseTo(summary.placedPieceCount * 5, 6)
    expect(summary.totalSquareFeet).toBeCloseTo(100, 6)
    expect(summary.perimeterLinearFeet).toBeCloseTo(40, 6)
  })

  /**
   * Every run has two ends and every seam has a joiner. A run cut into n pieces
   * contributes 2 caps and n-1 joiners, so the two counts move together and
   * neither can drift without the other noticing.
   */
  it('counts one end cap per run end and one joiner per seam', () => {
    const entries = entriesFor(BAFFLE_INPUTS)
    const summary = summarizeRuns(entries, BAFFLE_INPUTS)
    const runs = entries.flatMap((e) => e.layout.segments).length
    expect(summary.endCapCount).toBe(runs * 2)
    expect(summary.joinerCount).toBe(summary.placedPieceCount - runs)
  })

  /** Connectors are BOUGHT per location, so a shared bracket is counted once. */
  it('counts a connector location once however many pieces reach it', () => {
    const entries = entriesFor(BAFFLE_INPUTS)
    const summary = summarizeRuns(entries, BAFFLE_INPUTS)
    expect(summary.uniqueConnectorCount).toBeGreaterThan(0)
    expect(summary.uniqueConnectorCount).toBeLessThanOrEqual(summary.connectorCount)
  })

  it('divides the perimeter by the trim length, rounding up', () => {
    const inputs = { ...BAFFLE_INPUTS, perimeterTrimLengthFeet: 12 }
    const summary = summarizeRuns(entriesFor(inputs), inputs)
    // 40ft of perimeter / 12ft sticks = 3.33 -> 4.
    expect(summary.perimeterTrimPieces).toBe(4)
  })

  it('reports no trim when no trim length is configured', () => {
    const summary = summarizeRuns(entriesFor(BAFFLE_INPUTS), BAFFLE_INPUTS)
    expect(summary.perimeterTrimPieces).toBe(0)
  })

  it('lays real rails when both rail specs are set', () => {
    const inputs = { ...BAFFLE_INPUTS, railSpacingFeet: 4, railLengthFeet: 10 }
    const entries = entriesFor(inputs)
    expect(entries[0]?.layout.railPieces.length).toBeGreaterThan(0)
    const summary = summarizeRuns(entries, inputs)
    expect(summary.suspensionRailCount).toBeGreaterThan(0)
    expect(summary.suspensionRailLinearFeet).toBeGreaterThan(0)
  })

  /**
   * The area fallback. With a rail pitch and length but no laid rails, the Qt
   * build estimates rail from the area — an approximation, kept because it is
   * what the shipped numbers are.
   */
  it('estimates rail from the area when no rail runs were laid', () => {
    const inputs = { ...BAFFLE_INPUTS, railSpacingFeet: 4, railLengthFeet: 10 }
    const entries = layoutRuns([ACROSS], BAFFLE_INPUTS) // laid WITHOUT rails
    const summary = summarizeRuns(entries, inputs)
    // 100 sf / 4ft pitch = 25 lf; 25 / 10ft sticks = 2.5 -> 3.
    expect(summary.suspensionRailLinearFeet).toBeCloseTo(25, 6)
    expect(summary.suspensionRailCount).toBe(3)
  })

  it('is empty rather than wrong on an uncalibrated page', () => {
    expect(layoutRuns([{ ...ACROSS, feetPerPoint: 0 }], BAFFLE_INPUTS)).toEqual([])
    expect(summarizeRuns([], BAFFLE_INPUTS).primaryStockCount).toBe(0)
  })
})

describe('runQuantities', () => {
  it('names the primary stock after the product', () => {
    const summary = summarizeRuns(layoutRuns([ACROSS], BAFFLE_INPUTS), BAFFLE_INPUTS)
    const plank = runQuantities('planks', summary).find((q) => q.itemKey === 'primary_stock')
    const baffle = runQuantities('baffle', summary).find((q) => q.itemKey === 'primary_stock')
    expect(plank?.label).toBe('Planks')
    expect(baffle?.label).toBe('Baffle stock')
  })

  /**
   * Area is reported by the scope roll-up and printed directly above these
   * lines. Emitting it again here shows the same square footage twice under two
   * labels, which reads as two different measurements.
   */
  it('does not repeat the area the scope roll-up already reports', () => {
    const summary = summarizeRuns(layoutRuns([ACROSS], BAFFLE_INPUTS), BAFFLE_INPUTS)
    expect(runQuantities('baffle', summary).map((q) => q.itemKey)).not.toContain('net_area')
  })

  it('omits a line rather than printing a zero', () => {
    const empty = summarizeRuns([], BAFFLE_INPUTS)
    expect(runQuantities('baffle', empty)).toEqual([])
  })
})

describe('buildRunLayout guards, reached through the roll-up', () => {
  /**
   * A spacing typed in the wrong unit is the realistic way this goes wrong —
   * feet into an inches field is a factor of twelve, a bad calibration is a
   * factor of a hundred. pieces.ts raises rather than grinding; the point here
   * is that the raise is reachable from the layer above it.
   */
  it('raises on a spacing that would need an unbounded number of rows', () => {
    expect(() =>
      buildRunLayout(ROOM, { x: 1, y: 0 }, {
        spacingPoints: 1e-6,
        stockLengthPoints: 5,
        yieldGranularity: 'full',
        alignSeams: false,
        maxConnectorSpacingPoints: 2,
      }),
    ).toThrow(RangeError)
  })
})
