/**
 * Analytic validation of the PLANK and BAFFLE engines.
 *
 * The panel engine is proven against the Qt build exactly — 662 panels on
 * C-MT-01 and 54 on C-MT-02, captured live (plan 05.2). The run engine had no
 * such proof, and the tracker said so: "06.3/06.4 baffle and plank piece
 * builders are ported but UNVALIDATED. Every scope in every reachable project
 * is 'panels'." There is no Qt project carrying a plank scope to capture from.
 *
 * So these are the other kind of ground truth: shapes whose answers can be
 * worked out on paper. A 20ft x 10ft rectangle of 6in planks needs twenty runs
 * of twenty feet, and twenty feet of twelve-foot stock is two pieces. No
 * oracle required — and no way for a wrong engine to agree by accident across
 * lengths, piece counts, end caps and joiners at once, in eleven shapes.
 *
 * CONVENTION was the open question when this was written, and the offcut half
 * of it is now settled: the stock divides into granularity-sized units and
 * only a whole unit is reusable, which is what the Qt build has always done.
 * Planks, baffles and panels all share that rule — there is no
 * product-by-product split. See the note in summarizeRuns for the reading I
 * got wrong first, and why.
 *
 * Every number below was derived by hand first and then run.
 */
import { describe, expect, it } from 'vitest'
import { calculatePieces } from './takeoff.js'
import { resolveRunInputs, summarizeRuns } from './runs.js'

/** 0.1 ft per point, so ten points is a foot and the arithmetic stays legible. */
const cal = { feetPerPoint: 0.1, pageWidth: 612, pageHeight: 792 } as never
const box = { width: 612, height: 792 }

/** A rectangle `wFt` x `hFt`, placed away from the page origin. */
const rect = (wFt: number, hFt: number, id = 'm') => {
  const x0 = 100 / 612, x1 = (100 + wFt * 10) / 612
  const y0 = 200 / 792, y1 = (200 + hFt * 10) / 792
  return {
    id, scopeId: 's', documentId: 'd', pageId: 'd-p0', kind: 'area',
    rings: [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]],
  } as never
}

/** A hole in the same scheme: `wFt` x `hFt`, 5ft in and 2ft up. */
const cutout = (wFt: number, hFt: number) => {
  const x0 = 150 / 612, x1 = (150 + wFt * 10) / 612
  const y0 = 220 / 792, y1 = (220 + hFt * 10) / 792
  return {
    id: 'c', scopeId: 's', documentId: 'd', pageId: 'd-p0', kind: 'cutout',
    rings: [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]],
  } as never
}

const ALONG_20 = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]
const ALONG_10 = [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }]

function amounts(specs: Record<string, string>, markups: unknown[], dir = ALONG_20) {
  const r = calculatePieces(
    { id: 's', label: 'S', scopeType: 'area', color: '#000', specifications: specs } as never,
    markups as never, cal,
    {
      scopeDirection: dir, pageSize: box,
      calibrations: new Map([['d-p0', cal]]),
      pageSizes: new Map([['d-p0', box]]),
    } as never,
  )
  expect(r.blockers, 'blocked, so nothing below would mean anything').toEqual([])
  const ordered = Object.fromEntries(r.quantities.map((q) => [q.itemKey, q.quantity])) as
    Record<string, number | undefined>
  /*
   * A plank ORDER is planks, carrier rails and trim (Aaron, 2026-09-18), so
   * runQuantities no longer lists a plank scope's caps, joiners or connectors.
   * The engine still counts them — they are how the piece arithmetic is
   * checked here — so for planks they are read off the run summary, absent
   * when zero exactly as the ordered list would have had them.
   */
  if (specs['productType'] === 'planks') {
    const inputs = resolveRunInputs('planks', specs)
    expect(inputs).not.toBeNull()
    const s = summarizeRuns(r.runs, inputs as NonNullable<typeof inputs>)
    for (const [key, n] of [['end_caps', s.endCapCount], ['joiners', s.joinerCount], ['connectors', s.uniqueConnectorCount]] as const) {
      expect(ordered[key], `${key} is not something a plank order lists`).toBeUndefined()
      if (n > 0) ordered[key] = n
    }
  }
  return ordered
}

/** 6in planks at 6in on centre, 12ft stock, no offcut reuse. */
const PLANK = {
  productType: 'planks', plankWidth: '6', plankWidthUnit: 'in',
  stockLength: '12', stockLengthUnit: 'ft', yieldGranularity: 'full',
}

describe('planks, against arithmetic', () => {
  it('20ft x 10ft: twenty runs of twenty feet, two pieces each', () => {
    //   runs    = 10ft / 0.5ft          = 20
    //   length  = 20 runs x 20ft        = 400 LF
    //   pieces  = 20 runs x ceil(20/12) = 40      (12ft + 8ft per run)
    //   caps    = 20 runs x 2 ends      = 40
    //   joiners = 40 pieces - 20 runs   = 20
    expect(amounts(PLANK, [rect(20, 10)])).toMatchObject({
      net_linear: 400, primary_stock: 40, end_caps: 40, joiners: 20,
    })
  })

  it('12ft x 10ft: a run that is exactly one stock has no joiner', () => {
    // The boundary case. One piece per run, so nothing joins to anything.
    const q = amounts(PLANK, [rect(12, 10)])
    expect(q).toMatchObject({ net_linear: 240, primary_stock: 20, end_caps: 40 })
    expect(q.joiners).toBeUndefined()
  })

  it('13ft x 10ft: one foot over a stock costs a whole stock', () => {
    // CONVENTION, and the one most worth putting to the Qt build: at `full`
    // granularity an offcut is not reused, so a 1ft remnant consumes a second
    // 12ft plank. 20 runs x 2 = 40 pieces for 260 installed feet.
    expect(amounts(PLANK, [rect(13, 10)])).toMatchObject({
      net_linear: 260, primary_stock: 40, joiners: 20,
    })
  })

  it('charges a small remnant as a whole granularity step', () => {
    /*
     * The offcut rule, resolved with the estimator: the stock divides into
     * granularity-sized units and only a whole unit is reusable.
     *
     * Twenty 13ft runs are twenty 12ft pieces and twenty 1ft remainders. The
     * 12ft pieces take twenty whole planks. Each 1ft remainder is charged one
     * granularity step, and two steps share a plank:
     *
     *   half     1ft is charged half a plank; two of them share one.
     *            20 + 20/2                                        = 30
     *   quarter  1ft is charged a quarter; four share one.
     *            20 + 20/4                                        = 25
     *   full     nothing is shared at all.                        = 40
     *
     * I briefly had this as reuse of the ACTUAL remainder — cut a foot, eleven
     * feet is left, eleven is over half, so keep cutting from it — which gives
     * 23 and 22. That reading fits the words and not the shop: a plank is cut
     * into halves, and the second half is the last usable piece.
     */
    expect(amounts({ ...PLANK, yieldGranularity: 'half' }, [rect(13, 10)]).primary_stock).toBe(30)
    expect(amounts({ ...PLANK, yieldGranularity: 'quarter' }, [rect(13, 10)]).primary_stock).toBe(25)
    expect(amounts({ ...PLANK, yieldGranularity: 'full' }, [rect(13, 10)]).primary_stock).toBe(40)
  })

  it('turns the pattern ninety degrees and re-counts from scratch', () => {
    // Now the runs cross the 20ft side: 40 runs of 10ft. Every run fits one
    // stock, so the piece count is unchanged at 40 while the joiners vanish
    // and the caps double — which is why four numbers are checked, not one.
    const q = amounts(PLANK, [rect(20, 10)], ALONG_10)
    expect(q).toMatchObject({ net_linear: 400, primary_stock: 40, end_caps: 80 })
    expect(q.joiners).toBeUndefined()
  })

  it('subtracts a cutout from the runs that cross it', () => {
    //   10 runs miss the hole:  20ft each, 2 pieces, 1 joiner, 2 caps
    //   10 runs cross it:       5ft + 5ft, 1 piece each, 0 joiners, 4 caps
    //   length  = 10x20 + 10x(5+5) = 300 LF   (= 150 SF / 0.5ft)
    //   pieces  = 20 + 20          = 40
    //   caps    = 20 + 40          = 60
    //   joiners = 10
    expect(amounts(PLANK, [rect(20, 10, 'a'), cutout(10, 5)])).toMatchObject({
      net_linear: 300, primary_stock: 40, end_caps: 60, joiners: 10,
    })
  })

  it('conserves installed length on a diagonal', () => {
    // At 45 degrees the runs are shorter and more numerous and every count
    // changes — but the material still covers the area, so installed length
    // must still be area / spacing: 200 SF / 0.5ft = 400 LF. The one invariant
    // that holds at any angle.
    const q = amounts(PLANK, [rect(20, 10)], [{ x: 0, y: 0 }, { x: 1, y: 1 }])
    expect(q.net_linear).toBeCloseTo(400, 0)
    // And more pieces than the axis-aligned case, because runs are cut short.
    expect(q.primary_stock ?? 0).toBeGreaterThan(40)
  })

  it('lays rails across the planks', () => {
    // Perpendicular to the run, every 5ft along the 20ft side = 4.
    expect(amounts({
      ...PLANK, maxRailSpacing: '5', maxRailSpacingUnit: 'ft',
      railLength: '10', railLengthUnit: 'ft',
    }, [rect(20, 10)]).suspension_rails).toBe(4)
  })

  it('trims the perimeter', () => {
    // Per edge: 20/10 + 10/10 + 20/10 + 10/10 = 6.
    expect(amounts({
      ...PLANK, perimeterTrimLength: '10', perimeterTrimLengthUnit: 'ft',
    }, [rect(20, 10)]).perimeter_trim).toBe(6)
  })

  it('cuts trim per edge, like the panels', () => {
    // 25 x 10: 3 + 1 + 3 + 1 = 8, where the whole perimeter (70 LF) would say 7.
    expect(amounts({
      ...PLANK, perimeterTrimLength: '10', perimeterTrimLengthUnit: 'ft',
    }, [rect(25, 10)]).perimeter_trim).toBe(8)
  })
})

describe('panels, trim against arithmetic', () => {
  /** 2ft x 4ft panels, and 10ft trim lengths. */
  const PANEL = {
    productType: 'panels', panelWidth: '2', panelWidthUnit: 'ft', panelLength: '4', panelLengthUnit: 'ft',
  }

  it('trims the perimeter when a trim length is set', () => {
    // Perimeter 2 x (20 + 10) = 60 LF, in 10ft lengths = 6.
    expect(amounts({
      ...PANEL, perimeterTrimLength: '10', perimeterTrimLengthUnit: 'ft',
    }, [rect(20, 10)]).perimeter_trim).toBe(6)
  })

  it('reports no trim line at all without a trim length', () => {
    expect(amounts(PANEL, [rect(20, 10)]).perimeter_trim).toBeUndefined()
  })

  it('cuts trim per edge, not per perimeter', () => {
    // 25ft x 10ft: perimeter 70 LF would be 7 sticks of 10ft. Per edge it is
    // 3 + 1 + 3 + 1 = 8 — the two feet left from a 25ft wall do not turn the
    // corner (Aaron, 2026-09-18).
    expect(amounts({
      ...PANEL, perimeterTrimLength: '10', perimeterTrimLengthUnit: 'ft',
    }, [rect(25, 10)]).perimeter_trim).toBe(8)
  })
})

describe('baffle cassettes, against arithmetic', () => {
  /**
   * Aaron's example, 2026-09-18: 2in baffles at 6in on centre, assembled into
   * 24in-wide cassettes by 8ft baffle length — a 16 SF module, laid whole.
   */
  const CASSETTE = {
    productType: 'baffle_cassette', spacing: '6', spacingUnit: 'in',
    stockLength: '8', stockLengthUnit: 'ft', cassetteWidth: '24', cassetteWidthUnit: 'in',
  }

  it('counts whole modules, the baffles they hold, and two caps per baffle', () => {
    // 20ft x 10ft, modules run along the 20: ceil(20/8) = 3 per row, and
    // 10ft / 2ft = 5 rows = 15 cassettes. 24in / 6in = 4 baffles each = 60;
    // caps = 120. The 4ft of module hanging past the 20ft edge is the
    // "worse yield" of providing entire modules.
    expect(amounts(CASSETTE, [rect(20, 10)])).toMatchObject({
      cassette_count: 15, primary_stock: 60, end_caps: 120,
    })
  })

  it('orders nothing a module already contains', () => {
    const q = amounts(CASSETTE, [rect(20, 10)])
    for (const inside of ['connectors', 'joiners', 'suspension_rails']) expect(q[inside], inside).toBeUndefined()
  })
})

describe('baffles, against arithmetic', () => {
  it('lays a suspension rail across the baffles at every connector line', () => {
    // Perpendicular to the run, at the connector pitch: every 5ft along the
    // 20ft side = 4 rails, each a 10ft run cut from 10ft stock = 4.
    expect(amounts({
      productType: 'baffle', spacing: '12', spacingUnit: 'in',
      stockLength: '10', stockLengthUnit: 'ft',
      maxConnectorSpacing: '5', maxConnectorSpacingUnit: 'ft',
      railLength: '10', railLengthUnit: 'ft',
    }, [rect(20, 10)]).suspension_rails).toBe(4)
  })

  it('cuts each rail run from stock with its own offcut, never area over length', () => {
    // 25ft x 10ft, runs along the 25: 5 rail lines at 5ft, each a 10ft run.
    // From 8ft rail stock each run is 2 pieces = 10. Fifty feet of rail over
    // 8ft stock would have said 7 (Aaron, 2026-09-18: "never take the complete
    // linear footage and divide it by the rail length").
    expect(amounts({
      productType: 'baffle', spacing: '12', spacingUnit: 'in',
      stockLength: '10', stockLengthUnit: 'ft',
      maxConnectorSpacing: '5', maxConnectorSpacingUnit: 'ft',
      railLength: '8', railLengthUnit: 'ft',
    }, [rect(25, 10)]).suspension_rails).toBe(10)
  })

  /** 12in on centre, 10ft stock, a connector at least every 5ft. */
  const BAFFLE = {
    productType: 'baffle', spacing: '12', spacingUnit: 'in',
    stockLength: '10', stockLengthUnit: 'ft',
    maxConnectorSpacing: '5', maxConnectorSpacingUnit: 'ft',
  }

  it('20ft x 10ft at 12in on centre', () => {
    //   runs       = 10ft / 1ft       = 10
    //   length     = 10 x 20ft        = 200 LF
    //   pieces     = 10 x (20/10)     = 20
    //   joiners    = 20 - 10          = 10
    //   caps       = 10 x 2           = 20
    //   connectors = 10 runs x (20/5) = 40
    expect(amounts(BAFFLE, [rect(20, 10)])).toMatchObject({
      net_linear: 200, primary_stock: 20, joiners: 10, end_caps: 20, connectors: 40,
    })
  })
})
