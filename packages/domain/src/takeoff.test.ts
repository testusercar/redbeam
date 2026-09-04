import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculatePieces, layoutGroupsFor, scopeDefaultDirectionFrom } from './takeoff.js'
import type { Calibration, Markup, Scope } from './scope.js'
import type { NormalizedDirection } from './pattern.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(here, '..', '..', '..', 'fixtures')

interface Fixture {
  name: string
  source: { scopeId: string }
  scope: { label: string; productType: string; specifications: Record<string, unknown> }
  calibration: Calibration & { pageWidth: number; pageHeight: number }
  markups: Array<{ id: string; kind: Markup['kind']; page?: number; rings: Markup['rings'] }>
  expected: { pieces: Record<string, number | string> }
}

const load = (name: string): Fixture =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8')) as Fixture

/**
 * The scope default orientation, captured from the same Qt project alongside
 * the fixtures. It is not inside the fixture JSON because the dump covers the
 * scope's markups; pinning it here keeps it read from the oracle, not guessed.
 */
const DIRECTION: Record<string, NormalizedDirection> = {
  'TALJFK-C-MT-01-panels': [{ x: 0.23, y: 0.51 }, { x: 0.23, y: 0.68 }],
  'TALJFK-C-MT-02-panels': [{ x: 0.542, y: 0.61 }, { x: 0.5633, y: 0.61 }],
}

function scopeOf(f: Fixture): Scope {
  return {
    id: f.source.scopeId,
    label: f.scope.label,
    scopeType: 'area',
    color: '#000',
    specifications: { ...f.scope.specifications, productType: f.scope.productType },
  }
}

const markupsOf = (f: Fixture): Markup[] => f.markups.map((m) => ({
  id: m.id, scopeId: f.source.scopeId, documentId: 'fixture',
  pageId: `p${m.page ?? 0}`, kind: m.kind, rings: m.rings,
}))

const optsOf = (f: Fixture, name: string) => ({
  scopeDirection: DIRECTION[name]!,
  pageSize: { width: f.calibration.pageWidth, height: f.calibration.pageHeight },
})

describe('calculatePieces — end to end from raw markups', () => {
  // This is the whole pipeline: markups in, orderable pieces out, grouped and
  // laid out the way the app will do it. panels.test.ts proves the cell maths;
  // this proves the wiring around it, which is where a piece count really goes
  // wrong.
  it.each([
    ['TALJFK-C-MT-01-panels', 662],
    ['TALJFK-C-MT-02-panels', 54],
  ])('%s reproduces the Qt panel count', (name, want) => {
    const f = load(name)
    const r = calculatePieces(scopeOf(f), markupsOf(f), f.calibration, optsOf(f, name))
    expect(r.blockers).toEqual([])
    expect(r.productType).toBe('panels')
    const panels = r.quantities.find((q) => q.itemKey === 'panel_count')
    expect(panels?.quantity).toBe(want)
    expect(panels?.quantity).toBe(f.expected.pieces['panelCount'])
    expect(panels?.unit).toBe('EA')
  })

  it('splits half and full so the two sum back to the ordered count', () => {
    const f = load('TALJFK-C-MT-01-panels')
    const r = calculatePieces(scopeOf(f), markupsOf(f), f.calibration, optsOf(f, 'TALJFK-C-MT-01-panels'))
    const q = (k: string) => r.quantities.find((x) => x.itemKey === k)?.quantity ?? 0
    // 565 full + 194 halves, and two halves make one ordered panel.
    expect(q('panel_full') + q('panel_half') / 2).toBe(q('panel_count'))
  })

  it('ignores markups belonging to another scope', () => {
    const f = load('TALJFK-C-MT-02-panels')
    const mine = markupsOf(f)
    const foreign = mine.map((m) => ({ ...m, id: `${m.id}-x`, scopeId: 'someone-else' }))
    const r = calculatePieces(scopeOf(f), [...mine, ...foreign], f.calibration, optsOf(f, 'TALJFK-C-MT-02-panels'))
    expect(r.quantities.find((q) => q.itemKey === 'panel_count')?.quantity).toBe(54)
  })

  it('keeps the same markup on two sheets on separate grids', () => {
    // Normalized coordinates repeat on every sheet. Sharing a grid across
    // pages would merge two ceilings into one and move every seam.
    const f = load('TALJFK-C-MT-02-panels')
    const page39 = markupsOf(f)
    const page40 = page39.map((m) => ({ ...m, id: `${m.id}-p40`, pageId: 'p40' }))
    const r = calculatePieces(scopeOf(f), [...page39, ...page40], f.calibration, optsOf(f, 'TALJFK-C-MT-02-panels'))
    expect(r.quantities.find((q) => q.itemKey === 'panel_count')?.quantity).toBe(108)
  })
})

describe('blockers rather than zeros', () => {
  const base = (over: Record<string, unknown> = {}): Scope => ({
    id: 's', label: 'S', scopeType: 'area', color: '#000',
    specifications: { productType: 'panels', panelWidth: '2', panelWidthUnit: 'ft',
      panelLength: '4', panelLengthUnit: 'ft', ...over },
  })
  const cal: Calibration = { feetPerPoint: 0.1, pageWidth: 1000, pageHeight: 1000 }
  const page = { width: 1000, height: 1000 }
  const dir: NormalizedDirection = [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }]

  /** A square of ceiling, big enough that any product lays something into it. */
  const areaMarkup = (): Markup => ({
    id: 'a1', scopeId: 's', documentId: 'd', pageId: 'p0', kind: 'area',
    rings: [[
      { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 },
    ]],
  })

  it('names the missing measure instead of reporting zero panels', () => {
    // A 0 in a BOM reads as "nothing to order", which is a different and much
    // more expensive claim than "this scope is not configured yet".
    const r = calculatePieces(base({ panelWidth: '' }), [], cal, { scopeDirection: dir, pageSize: page })
    expect(r.quantities).toEqual([])
    expect(r.blockers).toContain('Panel W')
  })

  it('blocks on a missing direction the way the Qt build does', () => {
    const r = calculatePieces(base(), [], cal, { scopeDirection: null, pageSize: page })
    expect(r.quantities).toEqual([])
    expect(r.blockers.join(' ')).toContain('Orientation')
  })

  it('treats a custom assembly as hand-quantified, not blocked', () => {
    const r = calculatePieces(
      base({ productType: 'custom_assembly' }), [], cal,
      { scopeDirection: dir, pageSize: page },
    )
    expect(r.blockers).toEqual([])
    expect(r.quantities).toEqual([])
  })

  /**
   * This used to assert the opposite: that baffles and planks returned a
   * blocker reading "not verified against the Qt build" and no numbers.
   *
   * That was the wrong shape of honesty. A blocker means "this cannot be
   * computed", and it can — pieces.ts has been a complete port for months. What
   * is actually true is that nobody has checked it against the oracle, which is
   * a CONFIDENCE, and bom.ts already carries confidence per line. So the counts
   * are produced and every line they produce is still marked unverified
   * downstream; see the BOM test below, which is what keeps that promise.
   */
  it('computes run counts rather than blocking on them', () => {
    for (const t of ['baffle', 'planks', 'baffle_cassette']) {
      const r = calculatePieces(
        base({ productType: t, spacing: '2', spacingUnit: 'ft', stockLength: '10',
               stockLengthUnit: 'ft', plankWidth: '1', plankWidthUnit: 'ft',
               maxConnectorSpacing: '3', maxConnectorSpacingUnit: 'ft' }),
        [areaMarkup()], cal, { scopeDirection: dir, pageSize: page },
      )
      expect(r.blockers, t).toEqual([])
      expect(r.quantities.map((q) => q.itemKey), t).toContain('primary_stock')
    }
  })

  /**
   * A scope spans sheets and sheets are not drawn at one scale.
   *
   * Before 06.11 every markup in the scope was converted with whichever page
   * happened to be open, so the same ceiling on a 1/4" details sheet and a 1/8"
   * plan came out identical. Here the second page is at half the feet-per-point
   * of the first, so its identical markup covers a quarter of the area — and
   * the panel count has to reflect that rather than doubling the first page.
   */
  it('measures each page at its own scale, not the open page’s', () => {
    const onP0 = { ...areaMarkup(), id: 'a-p0', pageId: 'p0' }
    const onP1 = { ...areaMarkup(), id: 'a-p1', pageId: 'p1' }
    const calibrations = new Map([
      ['p0', cal],
      ['p1', { ...cal, feetPerPoint: cal.feetPerPoint / 2 }],
    ])

    const same = calculatePieces(base(), [onP0, onP1], cal, {
      scopeDirection: dir, pageSize: page,
      calibrations: new Map([['p0', cal], ['p1', cal]]),
    })
    const mixed = calculatePieces(base(), [onP0, onP1], cal, {
      scopeDirection: dir, pageSize: page, calibrations,
    })

    const count = (r: ReturnType<typeof calculatePieces>) =>
      r.quantities.find((q) => q.itemKey === 'panel_count')?.quantity ?? 0

    expect(count(same)).toBeGreaterThan(0)
    // Half the scale is a quarter of the area, so the second page contributes
    // far fewer panels than the first rather than the same number again.
    expect(count(mixed)).toBeLessThan(count(same))
    expect(count(mixed)).toBeGreaterThan(count(same) / 2)
  })

  /**
   * A page with no scale has no measurement. Falling back to another page's
   * calibration would report a number that looks fine and is wrong, which is
   * the one outcome worse than reporting nothing.
   */
  it('skips a page that has no calibration rather than borrowing one', () => {
    const onP0 = { ...areaMarkup(), id: 'a-p0', pageId: 'p0' }
    const onP1 = { ...areaMarkup(), id: 'a-p1', pageId: 'p1' }
    const only0 = calculatePieces(base(), [onP0, onP1], cal, {
      scopeDirection: dir, pageSize: page, calibrations: new Map([['p0', cal]]),
    })
    const just0 = calculatePieces(base(), [onP0], cal, {
      scopeDirection: dir, pageSize: page, calibrations: new Map([['p0', cal]]),
    })
    const n = (r: ReturnType<typeof calculatePieces>) =>
      r.quantities.find((q) => q.itemKey === 'panel_count')?.quantity ?? 0
    expect(n(only0)).toBe(n(just0))
  })

  it('still blocks a run product that is missing a required measure', () => {
    const r = calculatePieces(
      base({ productType: 'baffle', spacing: '2', spacingUnit: 'ft' }),
      [areaMarkup()], cal, { scopeDirection: dir, pageSize: page },
    )
    expect(r.quantities).toEqual([])
    expect(r.blockers.length).toBeGreaterThan(0)
  })
})

describe('scopeDefaultDirectionFrom', () => {
  it('reads the nested object real projects store', () => {
    const d = scopeDefaultDirectionFrom({
      scopeDefaultDirection: { sourcePage: 39, x1: 0.23, y1: 0.51, x2: 0.23, y2: 0.68 },
    })
    expect(d).toEqual([{ x: 0.23, y: 0.51 }, { x: 0.23, y: 0.68 }])
  })

  it('returns null rather than guessing an axis', () => {
    // A substituted direction silently moves every seam.
    expect(scopeDefaultDirectionFrom({})).toBeNull()
    expect(scopeDefaultDirectionFrom({ scopeDefaultDirection: 'north' })).toBeNull()
    expect(scopeDefaultDirectionFrom({ scopeDefaultDirection: { x1: 1 } })).toBeNull()
    // zero length is no direction at all
    expect(scopeDefaultDirectionFrom({
      scopeDefaultDirection: { x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 },
    })).toBeNull()
  })
})

describe('layoutGroupsFor', () => {
  const cal: Calibration = { feetPerPoint: 0.1, pageWidth: 1000, pageHeight: 1000 }
  const page = { width: 1000, height: 1000 }
  const dir: NormalizedDirection = [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }]
  const rect = (x: number, y: number, w: number, h: number) =>
    [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
  const mk = (id: string, kind: Markup['kind'], ring: Array<{ x: number; y: number }>, pageId = 'p1'): Markup =>
    ({ id, scopeId: 's', documentId: 'd', pageId, kind, rings: [ring] })

  it('gives each area its own group under a scope default', () => {
    const groups = layoutGroupsFor(
      [mk('a', 'area', rect(0.1, 0.1, 0.2, 0.2)), mk('b', 'area', rect(0.5, 0.5, 0.2, 0.2))],
      cal, { scopeDirection: dir, pageSize: page },
    )
    expect(groups).toHaveLength(2)
  })

  it('puts a cutout in the SAME group as the area containing it', () => {
    // Keyed by its own id, an opening would get its own grid and never punch
    // a hole in anything.
    const groups = layoutGroupsFor(
      [mk('a', 'area', rect(0.1, 0.1, 0.4, 0.4)), mk('c', 'cutout', rect(0.2, 0.2, 0.1, 0.1))],
      cal, { scopeDirection: dir, pageSize: page },
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.region).toHaveLength(2)
  })

  it('never shares a group across pages', () => {
    const groups = layoutGroupsFor(
      [mk('a', 'area', rect(0.1, 0.1, 0.2, 0.2), 'p1'),
       mk('a2', 'area', rect(0.1, 0.1, 0.2, 0.2), 'p2')],
      cal, { scopeDirection: dir, pageSize: page },
    )
    expect(groups).toHaveLength(2)
  })

  it('returns nothing without a direction, rather than an ungridded group', () => {
    expect(layoutGroupsFor([mk('a', 'area', rect(0.1, 0.1, 0.2, 0.2))], cal,
      { scopeDirection: null, pageSize: page })).toEqual([])
  })

  it('ignores kinds that are not takeoff geometry', () => {
    expect(layoutGroupsFor(
      [mk('s', 'shape', rect(0.1, 0.1, 0.2, 0.2)), mk('d', 'dimension', rect(0.3, 0.3, 0.1, 0.1))],
      cal, { scopeDirection: dir, pageSize: page },
    )).toEqual([])
  })
})

/**
 * A scope that cannot produce a layout says why.
 *
 * Reported by a user as "the numbers aren't calculating": C-MT-01, a plank
 * scope with a calibrated sheet, a scope-default direction and two drawn
 * areas, produced no quantities AND no blockers — the same empty result an
 * untouched scope gives. No number, and no reason for its absence.
 *
 * The cause was upstream (the app skipped pages whose size it had not
 * recorded, so grouping saw no usable calibration and dropped every markup),
 * but the calculation's own answer was the thing that made it undiagnosable.
 */
describe('an empty piece result', () => {
  const direction = [{ x: 0.5, y: 0.6 }, { x: 0.5, y: 0.3 }] as const
  const specs = {
    productType: 'planks',
    plankWidth: '6', plankWidthUnit: 'in',
    stockLength: '12', stockLengthUnit: 'ft',
  }
  const scope = {
    id: 's1', label: 'C-MT-01', scopeType: 'area', color: '#000', specifications: specs,
  } as unknown as Scope
  const cal = { feetPerPoint: 0.111, pageWidth: 612, pageHeight: 792 }
  const markup = {
    id: 'm1', scopeId: 's1', documentId: 'd', pageId: 'd-p0', kind: 'area',
    rings: [[{ x: 0.2, y: 0.4 }, { x: 0.7, y: 0.4 }, { x: 0.7, y: 0.6 }, { x: 0.2, y: 0.6 }]],
  } as unknown as Markup

  const opts = (pageKnown: boolean) => ({
    scopeDirection: direction as unknown as NormalizedDirection,
    pageSize: { width: 612, height: 792 },
    calibrations: new Map(pageKnown ? [['d-p0', cal]] : []),
    pageSizes: new Map(pageKnown ? [['d-p0', { width: 612, height: 792 }]] : []),
  })

  it('produces quantities when the page is known', () => {
    const r = calculatePieces(scope, [markup], cal, opts(true))
    expect(r.blockers).toEqual([])
    expect(r.quantities.length).toBeGreaterThan(0)
  })

  it('names the missing scale rather than returning silence', () => {
    const r = calculatePieces(scope, [markup], cal, opts(false))
    expect(r.quantities).toEqual([])
    expect(r.blockers).toEqual(['a scale on the sheet these markups are drawn on'])
  })

  it('stays silent when nothing has actually been drawn', () => {
    // Nothing drawn is not a problem to report; it is just nothing yet.
    const r = calculatePieces(scope, [], cal, opts(false))
    expect(r.quantities).toEqual([])
    expect(r.blockers).toEqual([])
  })
})

/**
 * A scope spans sheets, and the calculation returns every sheet's geometry —
 * that is what the totals are made of. But a preview draws ONE sheet, so each
 * piece of geometry has to say which sheet it belongs to.
 *
 * Reported as: a region traced on sheet 9 appearing as a ghost on sheet 1.
 * Right shape, wrong sheet, and nothing there to select or move, because the
 * markups themselves are correctly page-scoped and only the layout leaked.
 */
describe('layout geometry across sheets', () => {
  const direction = [{ x: 0.5, y: 0.6 }, { x: 0.5, y: 0.3 }] as unknown as NormalizedDirection
  const ring = [{ x: 0.2, y: 0.4 }, { x: 0.7, y: 0.4 }, { x: 0.7, y: 0.6 }, { x: 0.2, y: 0.6 }]
  const cal = { feetPerPoint: 0.111, pageWidth: 612, pageHeight: 792 }
  const box = { width: 612, height: 792 }
  const on = (pageId: string, id: string) => ({
    id, scopeId: 's1', documentId: 'd', pageId, kind: 'area', rings: [ring],
  }) as unknown as Markup

  const opts = {
    scopeDirection: direction,
    pageSize: box,
    calibrations: new Map([['d-p0', cal], ['d-p8', cal]]),
    pageSizes: new Map([['d-p0', box], ['d-p8', box]]),
  }

  const scopeWith = (specs: Record<string, string>) => ({
    id: 's1', label: 'S', scopeType: 'area', color: '#000', specifications: specs,
  }) as unknown as Scope

  it('tells you which sheet each RUN was laid out on', () => {
    const scope = scopeWith({
      productType: 'planks', plankWidth: '6', plankWidthUnit: 'in',
      stockLength: '12', stockLengthUnit: 'ft',
    })
    const r = calculatePieces(scope, [on('d-p0', 'a'), on('d-p8', 'b')], cal, opts)
    expect(r.runs.length).toBe(2)
    expect(new Set(r.runs.map((x) => x.pageId))).toEqual(new Set(['d-p0', 'd-p8']))
    // Which is the whole point: one sheet's worth is separable from the total.
    expect(r.runs.filter((x) => x.pageId === 'd-p0')).toHaveLength(1)
  })

  it('tells you which sheet each panel CELL was laid out on', () => {
    const scope = scopeWith({
      productType: 'panels', panelWidth: '2', panelWidthUnit: 'ft',
      panelLength: '4', panelLengthUnit: 'ft',
    })
    const r = calculatePieces(scope, [on('d-p0', 'a'), on('d-p8', 'b')], cal, opts)
    expect(r.cells.length).toBeGreaterThan(0)
    const pages = new Set(r.cells.map((c) => c.pageId))
    expect(pages).toEqual(new Set(['d-p0', 'd-p8']))
  })
})

/**
 * Where a pattern direction is stated, and which one wins.
 *
 * One orientation usually governs a whole floor, and the exceptions — a
 * corridor running the other way, a feature ceiling turned 45 degrees — are
 * exceptions. So the first direction set on a sheet applies to every area of
 * that scope on it, and each one after that corrects the area it came from.
 *
 * That FIXES the precedence rather than merely suggesting it: area beats page
 * beats scope. If page beat area, the second gesture would silently do
 * nothing, which is the one outcome that would make the rule unusable.
 */
describe('pattern direction precedence', () => {
  const across = [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] as unknown as NormalizedDirection
  const down = [{ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.9 }] as unknown as NormalizedDirection
  const cal = { feetPerPoint: 0.111, pageWidth: 612, pageHeight: 792 }
  const box = { width: 612, height: 792 }
  const ring = [{ x: 0.2, y: 0.4 }, { x: 0.7, y: 0.4 }, { x: 0.7, y: 0.6 }, { x: 0.2, y: 0.6 }]
  const area = (id: string, pageId: string) => ({
    id, scopeId: 's1', documentId: 'd', pageId, kind: 'area', rings: [ring],
  }) as unknown as Markup

  const scope = {
    id: 's1', label: 'S', scopeType: 'area', color: '#000',
    specifications: {
      productType: 'planks', plankWidth: '6', plankWidthUnit: 'in',
      stockLength: '12', stockLengthUnit: 'ft',
    },
  } as unknown as Scope

  const opts = (over: Record<string, unknown>) => ({
    pageSize: box,
    calibrations: new Map([['d-p0', cal], ['d-p1', cal]]),
    pageSizes: new Map([['d-p0', box], ['d-p1', box]]),
    ...over,
  }) as never

  /**
   * The angle the pieces actually run at, per area, in whole degrees.
   *
   * Measured off a piece rather than the layout origin: the origin is where
   * the grid was seeded, which says nothing about which way it runs.
   */
  const anglesOf = (markups: Markup[], over: Record<string, unknown>) =>
    calculatePieces(scope, markups, cal, opts(over)).runs.map((r) => {
      const seg = r.layout.pieces[0]?.insideSegment
      if (seg === undefined) return NaN
      const deg = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x) * 180 / Math.PI
      // A run has no head or tail, so 179 and -1 are the same orientation.
      return Math.round(((deg % 180) + 180) % 180)
    })

  it('lays out from a SHEET direction when the scope has no default', () => {
    // Not blocked: a scope with a direction stated on this sheet is not
    // missing one, and saying so would be a plain falsehood about work done.
    const r = calculatePieces(scope, [area('a', 'd-p0')], cal, opts({
      scopeDirection: null,
      pageDirections: new Map([['d-p0', across]]),
    }))
    expect(r.blockers).toEqual([])
    expect(r.runs).toHaveLength(1)
  })

  it('blocks only when there is no direction anywhere', () => {
    const r = calculatePieces(scope, [area('a', 'd-p0')], cal, opts({
      scopeDirection: null, pageDirections: new Map(), areaDirections: new Map(),
    }))
    expect(r.blockers.join(' ')).toContain('Orientation')
  })

  it('lets an AREA direction beat its sheet', () => {
    const both = [area('a', 'd-p0'), area('b', 'd-p0')]
    const shared = anglesOf(both, {
      scopeDirection: null, pageDirections: new Map([['d-p0', across]]),
    })
    const corrected = anglesOf(both, {
      scopeDirection: null,
      pageDirections: new Map([['d-p0', across]]),
      areaDirections: new Map([['b', down]]),
    })
    // The corrected area moved; the other did not.
    expect(corrected[0]).toBe(shared[0])
    expect(corrected[1]).not.toBe(shared[1])
  })

  it('lets a SHEET direction beat the scope default', () => {
    const one = [area('a', 'd-p0')]
    const byScope = anglesOf(one, { scopeDirection: across })
    const byPage = anglesOf(one, {
      scopeDirection: across, pageDirections: new Map([['d-p0', down]]),
    })
    expect(byPage[0]).not.toBe(byScope[0])
  })

  it('leaves other sheets on the scope default', () => {
    // A statement about one sheet is not a statement about the set.
    const r = calculatePieces(scope, [area('a', 'd-p0'), area('b', 'd-p1')], cal, opts({
      scopeDirection: across, pageDirections: new Map([['d-p0', down]]),
    }))
    expect(r.runs).toHaveLength(2)
  })
})
