import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  panelGranularityIndex, panelGranularityForIndex,
  roundUpQuantity, fractionApproximately, pieceFractionLabel, orderStockPieceCount,
  panelCellPath, automaticPanelGridOrigin, scopeDefaultGridLine, clampedStockStart,
  buildPanelCells, layoutPanels, summarizePanelCells, signedRegionArea,
  type PanelLayoutGroup,
} from './panels.js'
import { regionArea, type Point, type Region } from './geometry.js'
import { directionGroupKey, resolvePatternDirection, type NormalizedDirection, type PageSize } from './pattern.js'
import { ringToPoints, type Calibration } from './scope.js'

// ---------------------------------------------------------------------------
// 06.1
// ---------------------------------------------------------------------------

describe('panel granularity', () => {
  it('is binary, unlike yield granularity', () => {
    expect(panelGranularityIndex('half')).toBe(1)
    expect(panelGranularityIndex('halfLength')).toBe(1)
    expect(panelGranularityIndex('halfWidth')).toBe(1)
    expect(panelGranularityIndex('full')).toBe(0)
    // "quarter" is a legal YIELD granularity but there is no quarter panel.
    expect(panelGranularityIndex('quarter')).toBe(0)
  })

  it('round-trips through the index the way the Qt build normalises it', () => {
    expect(panelGranularityForIndex(panelGranularityIndex('halfWidth'))).toBe('half')
    expect(panelGranularityForIndex(panelGranularityIndex('quarter'))).toBe('full')
  })
})

describe('roundUpQuantity', () => {
  it('rounds up', () => {
    expect(roundUpQuantity(4.001)).toBe(5)
    expect(roundUpQuantity(0.0002)).toBe(1)
  })

  it('absorbs float drift instead of ordering an extra piece for it', () => {
    expect(roundUpQuantity(4 + 1e-9)).toBe(4)
    expect(roundUpQuantity(4)).toBe(4)
  })

  it('never goes negative', () => {
    expect(roundUpQuantity(-3)).toBe(0)
  })
})

describe('fractionApproximately', () => {
  it('uses a band wide enough for measured geometry', () => {
    expect(fractionApproximately(0.52, 0.5)).toBe(true)
    expect(fractionApproximately(0.6, 0.5)).toBe(false)
  })

  it('keeps 2/3 and 3/4 apart — the closest pair in the ladder', () => {
    expect(fractionApproximately(2 / 3, 0.75)).toBe(false)
    expect(fractionApproximately(0.75, 2 / 3)).toBe(false)
  })
})

describe('pieceFractionLabel', () => {
  it('names the ladder', () => {
    expect(pieceFractionLabel(1)).toBe('Full')
    expect(pieceFractionLabel(0.75)).toBe('3/4')
    expect(pieceFractionLabel(2 / 3)).toBe('2/3')
    expect(pieceFractionLabel(0.5)).toBe('Half')
    expect(pieceFractionLabel(1 / 3)).toBe('1/3')
    expect(pieceFractionLabel(0.25)).toBe('1/4')
  })

  it('falls back to a number rather than mislabelling', () => {
    expect(pieceFractionLabel(0.6)).toBe('0.60')
  })
})

describe('orderStockPieceCount', () => {
  it('counts full pieces one for one', () => {
    expect(orderStockPieceCount([1, 1, 1])).toBe(3)
  })

  it('nests two halves into one produced panel', () => {
    expect(orderStockPieceCount([0.5, 0.5])).toBe(1)
    expect(orderStockPieceCount([0.5, 0.5, 0.5, 0.5])).toBe(2)
  })

  it('rounds an odd half up to a whole panel', () => {
    expect(orderStockPieceCount([0.5, 0.5, 0.5])).toBe(2)
  })

  it('lets an odd half absorb up to TWO quarters from its own offcut', () => {
    // Not one: the offcut of a half panel is a half, which yields two quarters.
    expect(orderStockPieceCount([0.5, 0.25, 0.25])).toBe(1)
    expect(orderStockPieceCount([0.5, 0.25, 0.25, 0.25])).toBe(2)
  })

  it('pairs 3/4 with 1/4 and 2/3 with 1/3, ordering the larger piece', () => {
    expect(orderStockPieceCount([0.75, 0.25])).toBe(1)
    expect(orderStockPieceCount([2 / 3, 1 / 3])).toBe(1)
  })

  it('falls back to sum-and-round-up when a fraction is off the ladder', () => {
    // Arbitrary offcuts cannot be nested by the pairing rule, and pretending
    // they can would UNDER-order.
    expect(orderStockPieceCount([0.6, 0.6])).toBe(2)
    expect(orderStockPieceCount([1, 0.9])).toBe(2)
  })

  it('is zero for nothing placed', () => {
    expect(orderStockPieceCount([])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 06.2 — grid mechanics
// ---------------------------------------------------------------------------

const X_AXIS = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }

describe('panelCellPath', () => {
  it('walks the corners in the Qt order', () => {
    const path = panelCellPath({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, 0, 10, 0, 5)
    expect(path).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 },
    ])
  })

  it('follows a rotated frame', () => {
    // 90 degrees: direction runs down the page, normal runs left.
    const path = panelCellPath({ x: 100, y: 100 }, { x: 0, y: 1 }, { x: -1, y: 0 }, 0, 10, 0, 5)
    expect(path[0]).toEqual({ x: 100, y: 100 })
    expect(path[1]).toEqual({ x: 100, y: 110 })
    expect(path[2]).toEqual({ x: 95, y: 110 })
  })
})

const square = (x0: number, y0: number, x1: number, y1: number): Region =>
  [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]]

describe('automaticPanelGridOrigin', () => {
  it('snaps to a whole number of panels from the DIRECTION LINE, not the region', () => {
    const region = square(37, 23, 57, 33)
    const origin = automaticPanelGridOrigin(region, X_AXIS, 5, 10)
    // floor(37/10)*10 = 30 along, floor(23/5)*5 = 20 across.
    expect(origin).toEqual({ x: 30, y: 20 })
  })

  it('seeds off the direction line, so moving the line moves the whole grid', () => {
    const region = square(37, 23, 57, 33)
    const shifted = { a: { x: 3, y: 1 }, b: { x: 4, y: 1 } }
    expect(automaticPanelGridOrigin(region, shifted, 5, 10)).toEqual({ x: 33, y: 21 })
  })

  it('leaves the grid LINES alone — only the (0,0) cell label moves', () => {
    // This is why an origin one panel out cannot change a count.
    const region = square(37, 23, 57, 33)
    const a = buildPanelCells(region, automaticPanelGridOrigin(region, X_AXIS, 5, 10), X_AXIS, 5, 10, 'full')
    const b = buildPanelCells(region, { x: 0, y: 0 }, X_AXIS, 5, 10, 'full')
    expect(a.length).toBe(b.length)
    const key = (c: { fullPath: Point[] }) => `${c.fullPath[0]!.x},${c.fullPath[0]!.y}`
    expect(a.map(key).sort()).toEqual(b.map(key).sort())
  })

  it('returns the line start for a degenerate input rather than throwing', () => {
    expect(automaticPanelGridOrigin([], X_AXIS, 5, 10)).toEqual({ x: 0, y: 0 })
    const degenerate = { a: { x: 7, y: 7 }, b: { x: 7, y: 7 } }
    expect(automaticPanelGridOrigin(square(0, 0, 1, 1), degenerate, 5, 10)).toEqual({ x: 7, y: 7 })
  })
})

describe('scopeDefaultGridLine', () => {
  it('carries the vector and DISCARDS the position, seeding the grid at (0,0)', () => {
    const page: PageSize = { width: 1000, height: 500 }
    const direction: NormalizedDirection = [{ x: 0.4, y: 0.2 }, { x: 0.5, y: 0.2 }]
    expect(scopeDefaultGridLine(direction, page)).toEqual({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } })
  })

  it('is null for a zero vector', () => {
    const page: PageSize = { width: 1000, height: 500 }
    expect(scopeDefaultGridLine([{ x: 0.4, y: 0.2 }, { x: 0.4, y: 0.2 }], page)).toBeNull()
  })
})

describe('clampedStockStart', () => {
  it('centres the half piece over the installed geometry', () => {
    expect(clampedStockStart(2, 4, 0, 10, 5)).toBeCloseTo(0.5, 10)
  })

  it('keeps the piece inside the cell', () => {
    expect(clampedStockStart(8, 10, 0, 10, 5)).toBeCloseTo(5, 10)
  })

  it('gives up containment before it gives up the cell bound', () => {
    // Installed span 8 cannot fit a 5 piece; the piece still stays in the cell.
    const start = clampedStockStart(1, 9, 0, 10, 5)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(start).toBeLessThanOrEqual(5)
  })
})

describe('buildPanelCells', () => {
  it('tiles a region that is a whole number of aligned panels', () => {
    const cells = buildPanelCells(square(0, 0, 20, 10), { x: 0, y: 0 }, X_AXIS, 5, 10, 'full')
    expect(cells.length).toBe(4)
    for (const cell of cells) {
      expect(cell.coverageFraction).toBeCloseTo(1, 10)
      expect(cell.stockFraction).toBe(1)
      expect(cell.stockKind).toBe('full')
    }
    expect(summarizePanelCells(cells).panelCount).toBe(4)
  })

  it('adds a cell for every grid line the region crosses, however little it takes', () => {
    // Half a point past a grid line is still a panel someone has to cut.
    const cells = buildPanelCells(square(0, 0, 20.5, 10), { x: 0, y: 0 }, X_AXIS, 5, 10, 'full')
    expect(cells.length).toBe(6)
  })

  it('drops a sliver below a quarter of one percent of a panel', () => {
    const panelArea = 5 * 10
    const minUseful = Math.max(1, panelArea * 0.0025) // = 1.0 here
    // A 20 x 0.004 strip past the row line is 0.08 sq pt — under the floor.
    const cells = buildPanelCells(square(0, 0, 20, 10.004), { x: 0, y: 0 }, X_AXIS, 5, 10, 'full')
    expect(minUseful).toBe(1)
    expect(cells.length).toBe(4)
  })

  it('never emits a cell from the +/-1 padding alone', () => {
    const cells = buildPanelCells(square(0, 0, 20, 10), { x: 0, y: 0 }, X_AXIS, 5, 10, 'full')
    expect(cells.every((c) => c.gridRow >= 0 && c.gridRow < 2)).toBe(true)
    expect(cells.every((c) => c.gridColumn >= 0 && c.gridColumn < 2)).toBe(true)
  })

  it('reports a full-granularity cell as full even when it is mostly empty', () => {
    const cells = buildPanelCells(square(0, 0, 5, 5), { x: 0, y: 0 }, X_AXIS, 5, 10, 'full')
    expect(cells.length).toBe(1)
    expect(cells[0]!.stockFraction).toBe(1)
    expect(cells[0]!.selectionReason).toBe('full-panel-granularity-full')
    // The required spans are still reported — the Review UI reads them.
    expect(cells[0]!.requiredLengthFraction).toBeCloseTo(0.5, 10)
    expect(cells[0]!.requiredWidthFraction).toBeCloseTo(1, 10)
  })

  it('picks half-length when the installed span fits half a panel end to end', () => {
    const cells = buildPanelCells(square(0, 0, 5, 5), { x: 0, y: 0 }, X_AXIS, 5, 10, 'half')
    expect(cells.length).toBe(1)
    expect(cells[0]!.stockKind).toBe('half-length')
    expect(cells[0]!.stockFraction).toBe(0.5)
    expect(summarizePanelCells(cells).panelCount).toBe(1)
  })

  it('picks half-width when the installed span is short across the run', () => {
    const cells = buildPanelCells(square(0, 0, 10, 2.5), { x: 0, y: 0 }, X_AXIS, 5, 10, 'half')
    expect(cells.length).toBe(1)
    expect(cells[0]!.stockKind).toBe('half-width')
  })

  it('orders a FULL panel for an L that spans the cell, however little material', () => {
    // Two thin arms hugging opposite edges: 1.5% of the cell by area, but the
    // bounding span is the whole panel, so no half rectangle can produce it.
    const arms: Region = [
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0.15 }, { x: 0, y: 0.15 }],
      [{ x: 0, y: 4.85 }, { x: 10, y: 4.85 }, { x: 10, y: 5 }, { x: 0, y: 5 }],
    ]
    const cells = buildPanelCells(arms, { x: 0, y: 0 }, X_AXIS, 5, 10, 'half')
    expect(cells.length).toBe(1)
    expect(cells[0]!.stockFraction).toBe(1)
    expect(cells[0]!.selectionReason).toMatch(/^full-required-span-exceeds-half/)
    expect(cells[0]!.coverageFraction).toBeLessThan(0.07)
  })

  it('clips exactly: cell areas sum back to the region area', () => {
    // The Sutherland-Hodgman claim in the header, tested. An L-shaped
    // (concave) region on a grid that lines up with nothing.
    const el: Region = [[
      { x: 3, y: 2 }, { x: 27, y: 2 }, { x: 27, y: 9 },
      { x: 14, y: 9 }, { x: 14, y: 19 }, { x: 3, y: 19 },
    ]]
    const cells = buildPanelCells(el, { x: 0, y: 0 }, X_AXIS, 5, 10, 'full')
    const summed = cells.reduce((total, c) => total + c.clippedArea, 0)
    expect(summed).toBeCloseTo(regionArea(el), 9)
  })

  it('removes a hole from the cells it falls in, not from the ones it does not', () => {
    const withHole: Region = [
      ...square(0, 0, 20, 10),
      [{ x: 12, y: 2 }, { x: 18, y: 2 }, { x: 18, y: 8 }, { x: 12, y: 8 }],
    ]
    expect(signedRegionArea(withHole)).toBeCloseTo(200 - 36, 9)
    const cells = buildPanelCells(withHole, { x: 0, y: 0 }, X_AXIS, 5, 10, 'full')
    expect(cells.reduce((t, c) => t + c.clippedArea, 0)).toBeCloseTo(200 - 36, 9)
    const untouched = cells.filter((c) => c.gridColumn === 0)
    expect(untouched.every((c) => c.coverageFraction === 1)).toBe(true)
  })

  it('refuses a degenerate grid instead of looping', () => {
    expect(buildPanelCells(square(0, 0, 20, 10), { x: 0, y: 0 }, X_AXIS, 0, 10, 'full')).toEqual([])
    const degenerate = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }
    expect(buildPanelCells(square(0, 0, 20, 10), { x: 0, y: 0 }, degenerate, 5, 10, 'full')).toEqual([])
    expect(buildPanelCells([], { x: 0, y: 0 }, X_AXIS, 5, 10, 'full')).toEqual([])
  })
})

describe('layoutPanels', () => {
  it('keeps groups independent — a shared cell is two panels, not one', () => {
    // Two areas that meet inside one cell. They are separate direction zones
    // under a scope default (see directionGroupKey), so each gets its own panel.
    const left: PanelLayoutGroup = { region: square(0, 0, 4, 5), directionLine: X_AXIS }
    const right: PanelLayoutGroup = { region: square(6, 0, 10, 5), directionLine: X_AXIS }
    const opts = { panelWidthFeet: 5, panelLengthFeet: 10, feetPerPoint: 1, panelGranularity: 'full' }
    expect(layoutPanels([left, right], opts).panelCount).toBe(2)
    // Merged into one region it would be a single cell, and one panel short.
    const merged: PanelLayoutGroup = { region: [...left.region, ...right.region], directionLine: X_AXIS }
    expect(layoutPanels([merged], opts).panelCount).toBe(1)
  })

  it('returns nothing for an unusable specification', () => {
    const group: PanelLayoutGroup = { region: square(0, 0, 20, 10), directionLine: X_AXIS }
    const result = layoutPanels([group], {
      panelWidthFeet: 0, panelLengthFeet: 10, feetPerPoint: 1, panelGranularity: 'full',
    })
    expect(result.cells).toEqual([])
    expect(result.panelCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Golden fixtures — the acceptance test
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(here, '..', '..', '..', 'fixtures')

interface PanelFixture {
  name: string
  scope: { specifications: Record<string, string> }
  calibration: Calibration
  markups: Array<{ id: string; kind: string; page?: number; rings: Array<Array<Point>> }>
  expected: { pieces: { panelCount: number; primaryStockCount: number } }
}

/**
 * The scope default orientation, captured alongside the fixtures from the same
 * Qt project. It is not inside the fixture JSON because the dump covers the
 * markup table only; without it there is no layout at all, so it is pinned here
 * rather than guessed. Both are NORMALIZED on the fixture's own page box.
 */
const SCOPE_DEFAULT_DIRECTION: Record<string, NormalizedDirection> = {
  'TALJFK-C-MT-01-panels': [{ x: 0.23, y: 0.51 }, { x: 0.23, y: 0.68 }],
  'TALJFK-C-MT-02-panels': [{ x: 0.542, y: 0.61 }, { x: 0.5633, y: 0.61 }],
}

const loadFixture = (name: string): PanelFixture =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8')) as PanelFixture

/**
 * Build the layout groups the way the pipeline will: resolve the direction for
 * each area, key it with directionGroupKey, and lay each key out on its own.
 * Under a scope default that key carries the AREA id, so every markup is its
 * own group — which is the whole difference between 54 panels and 49.
 */
function groupsFor(fixture: PanelFixture): PanelLayoutGroup[] {
  const cal = fixture.calibration
  const page: PageSize = { width: cal.pageWidth, height: cal.pageHeight }
  const scopeDirection = SCOPE_DEFAULT_DIRECTION[fixture.name]
  if (!scopeDirection) throw new Error(`no scope default direction pinned for ${fixture.name}`)

  const byKey = new Map<string, { rings: Region; directionLine: PanelLayoutGroup['directionLine'] }>()
  for (const markup of fixture.markups) {
    if (markup.kind !== 'area' && markup.kind !== 'cutout') continue
    const probe = markup.rings[0]?.[0]
    if (!probe) continue
    const resolution = resolvePatternDirection(probe, { page, scopeDirection, scopeDirectionPage: page })
    if (!resolution) throw new Error(`no direction resolved for ${markup.id}`)
    const directionLine = scopeDefaultGridLine(scopeDirection, page)
    if (!directionLine) throw new Error('degenerate scope default direction')
    // Page is folded into the key: normalized coordinates repeat on every
    // sheet, so two markups on different sheets must never share a grid.
    const key = `p${markup.page ?? 0}|${directionGroupKey(resolution, markup.id)}`
    const existing = byKey.get(key)
    const rings = markup.rings.map((ring) => ringToPoints(ring, cal))
    if (existing) existing.rings.push(...rings)
    else byKey.set(key, { rings, directionLine })
  }
  return [...byKey.values()].map((g) => ({ region: g.rings, directionLine: g.directionLine }))
}

describe('golden fixtures — panel counts from the Qt build', () => {
  it('TALJFK-C-MT-01: 13 areas on 2 sheets, 1.8125 x 4 ft, half granularity', () => {
    const fixture = loadFixture('TALJFK-C-MT-01-panels')
    const result = layoutPanels(groupsFor(fixture), {
      panelWidthFeet: 1.8125,
      panelLengthFeet: 4,
      feetPerPoint: fixture.calibration.feetPerPoint,
      panelGranularity: fixture.scope.specifications['panelGranularity'] ?? 'full',
    })
    expect(result.panelCount).toBe(fixture.expected.pieces.panelCount)
    expect(result.panelCount).toBe(fixture.expected.pieces.primaryStockCount)
    // Pinned so a change in the half/full split is visible even when the
    // ordered total happens to survive it.
    expect(result.placedCellCount).toBe(759)
    expect(result.halfPieceCount).toBe(194)
    expect(result.fullPieceCount).toBe(565)
  })

  it('TALJFK-C-MT-02: 3 areas on 1 sheet, 2 x 4 ft, full granularity', () => {
    const fixture = loadFixture('TALJFK-C-MT-02-panels')
    const result = layoutPanels(groupsFor(fixture), {
      panelWidthFeet: 2,
      panelLengthFeet: 4,
      feetPerPoint: fixture.calibration.feetPerPoint,
      panelGranularity: fixture.scope.specifications['panelGranularity'] ?? 'full',
    })
    expect(result.panelCount).toBe(fixture.expected.pieces.panelCount)
    expect(result.panelCount).toBe(fixture.expected.pieces.primaryStockCount)
    // Full granularity: every cell is one ordered panel, so this is the count.
    expect(result.placedCellCount).toBe(54)
    expect(result.halfPieceCount).toBe(0)
  })

  it('does not reach the count by dividing area by panel area', () => {
    // The trap this suite exists to catch: C-MT-02 is 217.9 SF of 8 SF panels,
    // which divides to 27. The real answer is 54, because the grid — not the
    // area — decides how many panels get cut.
    const fixture = loadFixture('TALJFK-C-MT-02-panels')
    const groups = groupsFor(fixture)
    const areaPoints = groups.reduce((total, g) => total + signedRegionArea(g.region), 0)
    const cal = fixture.calibration
    const squareFeet = areaPoints * cal.feetPerPoint * cal.feetPerPoint
    expect(squareFeet).toBeCloseTo(217.91387097275256, 6)
    expect(Math.ceil(squareFeet / 8)).toBe(28)
    expect(fixture.expected.pieces.panelCount).toBe(54)
  })
})

/**
 * Whose grid is it: the sheet's, or the area's?
 *
 * The seed fixes the grid's PHASE. `directionLine.a` is the sheet origin for a
 * scope-default direction, so every area on a page lands on one grid — panels
 * line up across a corridor between two ceilings, and an area that happens to
 * start mid-cell wastes a row it did not need. Seeding from the area's own
 * corner makes the phase a property of the area.
 *
 * A choice, not a correction: the sheet-wide grid is what the Qt build does
 * and what the golden fixtures capture, so it stays the default.
 */
describe('automaticPanelGridOrigin per area', () => {
  // An area deliberately offset so that a sheet-anchored grid starts mid-cell.
  const region = [[
    { x: 137, y: 211 }, { x: 437, y: 211 }, { x: 437, y: 411 }, { x: 137, y: 411 },
  ]]
  const line = { a: { x: 0, y: 0 }, b: { x: 0, y: -40 } }

  it('defaults to the sheet, which is where the Qt grid is seeded', () => {
    const shared = automaticPanelGridOrigin(region, line, 24, 48)
    const explicit = automaticPanelGridOrigin(region, line, 24, 48, false)
    expect(explicit).toEqual(shared)
  })

  it('starts a whole panel at the area edge when asked', () => {
    const shared = automaticPanelGridOrigin(region, line, 24, 48)
    const perArea = automaticPanelGridOrigin(region, line, 24, 48, true)
    // The offset area is not on the sheet grid, so the two must differ —
    // otherwise the option is doing nothing.
    expect(perArea).not.toEqual(shared)
  })

  it('is unchanged for an area that already sits on the sheet grid', () => {
    // Origin-aligned and a whole number of panels across: nothing to shift.
    const aligned = [[
      { x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 96 }, { x: 0, y: 96 },
    ]]
    expect(automaticPanelGridOrigin(aligned, line, 24, 48, true))
      .toEqual(automaticPanelGridOrigin(aligned, line, 24, 48))
  })
})
