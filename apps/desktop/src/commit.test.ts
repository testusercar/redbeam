/**
 * Everything a takeoff shows is recomputed from the markups whenever anything
 * changes — right for working, useless for bidding. Change a spec and the
 * number you sent last week is simply gone, with nothing to compare against.
 *
 * These cover what gets frozen and what a re-run reports as having moved.
 */
import { describe, expect, it } from 'vitest'
import { calculationFor, componentsOf, deltaBetween, ENGINE_VERSION } from './commit.js'
import type { PieceResult, Scope } from '@redbeam/domain'
import type { QuantityResultInput } from '@redbeam/store'

const seg = (n: number) => ({ a: { x: n, y: 0 }, b: { x: n + 10, y: 0 } })

const piece = (n: number, startCap = true) => ({
  insideSegment: seg(n),
  fullSegment: seg(n),
  family: 'full',
  stockFraction: 1,
  startCap,
})

const result = (over: Partial<PieceResult> = {}): PieceResult => ({
  productType: 'planks',
  quantities: [{ itemKey: 'primary_stock', label: 'Planks', quantity: 2, unit: 'EA' }],
  cells: [],
  runs: [{
    pageId: 'd-p0',
    region: [],
    feetPerPoint: 0.1,
    layout: {
      origin: { x: 0, y: 0 },
      segments: [],
      pieces: [piece(0), piece(20, false)],
      railSegments: [],
      railPieces: [piece(40)],
    },
  }],
  blockers: [],
  ...over,
} as unknown as PieceResult)

const scope = {
  id: 's1', label: 'C-MT-01', scopeType: 'area', color: '#000',
  specifications: { productType: 'planks', plankWidth: '6' },
} as unknown as Scope

const source = {
  documentId: 'doc-1',
  markups: [{ id: 'm1', pageId: 'd-p0', kind: 'area', rings: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] }],
  calibrations: new Map([['d-p0', 0.1]]),
}

describe('componentsOf', () => {
  it('records every piece the layout placed, not just the total', () => {
    // "299 planks" is not checkable. 299 line segments are.
    const c = componentsOf(result(), 'doc-1')
    expect(c.filter((x) => x.componentKind === 'run_piece')).toHaveLength(2)
    expect(c.filter((x) => x.componentKind === 'suspension_rail')).toHaveLength(1)
  })

  it('keeps the installed geometry and the stock it came from', () => {
    // They differ wherever a piece overhangs, which is the whole of a waste
    // conversation, so a frozen bid has to carry both.
    const first = componentsOf(result(), 'doc-1')[0]!
    expect(first.geometry).toEqual({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } })
    expect(first.properties).toMatchObject({ stockStart: { x: 0, y: 0 }, family: 'full' })
  })

  it('records a panel product as cells instead', () => {
    const cells = [{
      pageId: 'd-p2', gridRow: 1, gridColumn: 2, clippedRegion: [], stockPath: [],
      coverageFraction: 1, stockFraction: 1, fullPath: [], clippedArea: 4,
    }]
    const c = componentsOf(result({ cells } as never), 'doc-1')
    expect(c.filter((x) => x.componentKind === 'panel_cell')).toHaveLength(1)
    expect(c.find((x) => x.componentKind === 'panel_cell')?.pageId).toBe('d-p2')
  })
})

describe('calculationFor', () => {
  const rollup: QuantityResultInput[] = [
    { itemKey: 'area_sf', label: 'Area', quantity: 200, unit: 'SF' },
  ]

  it('freezes what the panel was showing, roll-up and pieces together', () => {
    // Freezing a subset of what was on screen would be a trap: somebody
    // believes they committed the numbers they were looking at.
    const input = calculationFor(scope, result(), rollup, source)
    expect(input.quantities.map((q) => q.itemKey)).toEqual(['area_sf', 'primary_stock'])
  })

  it('stamps the engine, because two runs that disagree mean different things', () => {
    // Same engine: a bug. Different engine: a changelog entry.
    expect(calculationFor(scope, result(), rollup, source).engineVersion).toBe(ENGINE_VERSION)
  })

  it('keeps the geometry itself, not a reference to it', () => {
    // A markup that is later moved or deleted must not silently change what a
    // frozen bid was based on.
    const input = calculationFor(scope, result(), rollup, source)
    const snap = input.geometrySnapshot as { markups: Array<{ id: string, rings: unknown }> }
    expect(snap.markups[0]?.id).toBe('m1')
    expect(snap.markups[0]?.rings).toEqual([[{ x: 0, y: 0 }, { x: 1, y: 1 }]])
  })

  it('records the specification and calibration it was computed from', () => {
    const input = calculationFor(scope, result(), rollup, source)
    expect(input.specificationsSnapshot).toEqual({ productType: 'planks', plankWidth: '6' })
    expect(input.calibrationSnapshot).toEqual({ 'd-p0': 0.1 })
  })
})

describe('deltaBetween', () => {
  const q = (key: string, n: number): QuantityResultInput =>
    ({ itemKey: key, label: key, quantity: n, unit: 'EA' })

  it('says nothing when nothing moved', () => {
    expect(deltaBetween([q('a', 1), q('b', 2)], [q('a', 1), q('b', 2)])).toEqual([])
  })

  it('reports only what changed', () => {
    // A list of forty identical rows hides the one that is not.
    const d = deltaBetween([q('a', 1), q('b', 2)], [q('a', 1), q('b', 5)])
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ itemKey: 'b', committed: 2, live: 5 })
  })

  it('reports an item that stopped being produced', () => {
    // Quietly dropping it from the comparison would hide exactly the kind of
    // movement worth seeing.
    const d = deltaBetween([q('joiners', 20)], [])
    expect(d[0]).toMatchObject({ itemKey: 'joiners', committed: 20, live: null })
  })

  it('reports an item that only exists now', () => {
    const d = deltaBetween([], [q('suspension_rails', 26)])
    expect(d[0]).toMatchObject({ committed: null, live: 26 })
  })
})
