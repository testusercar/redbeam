/**
 * Golden fixture regression runner (plan 05.3).
 *
 * Fixtures live in /fixtures and are produced by tools/dump-fixtures.mjs from
 * real Qt project databases. Each has real INPUTS and an `expected` block that
 * must be captured from the RUNNING Qt build (plan 05.2).
 *
 * The rule this file enforces: an UNFILLED fixture must never look green.
 * A suite that silently passes on `expected: null` is worse than no suite —
 * it reports coverage that does not exist, which is exactly how a rewrite
 * ships a quantity that is wrong.
 *
 * Set RB_FIXTURES_STRICT=1 (CI, and `npm run verify`) to turn pending
 * fixtures into failures.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  calculateScopeQuantities, areaSquareFeet, perimeterFeet,
  type Calibration, type Markup, type Scope, type ScopeType,
} from './scope.js'
import { calculatePieces } from './takeoff.js'
import { canonicalProductType, type ProductType } from './specs.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(here, '..', '..', '..', 'fixtures')

interface Fixture {
  name: string
  source: { db?: string; scopeId: string; pageId?: string; bridge?: string; project?: string }
  scope: { label: string; productType: string; specifications: Record<string, string> }
  calibration: { feetPerPoint: number; pageWidth: number; pageHeight: number }
  markups: Array<{
    id: string
    kind: Markup['kind']
    rings: Array<Array<{ x: number; y: number }>>
    /** Sheet this markup lives on. Fixtures dumped per (scope,page) omit it. */
    page?: number
  }>
  /** null until captured from the Qt build. NOT the same as "expected nothing". */
  expected: null | {
    quantities: Array<{ itemKey: string; quantity: number; unit: string }>
    /**
     * The PIECE counts captured from the Qt build.
     *
     * These have been in every fixture file since 05.2 and nothing read them:
     * the type did not mention them and the runner only iterated
     * `quantities`. So "the panel engine reproduces the Qt build — 662 and 54"
     * was true of the AREA and merely recorded for the counts, which is the
     * more interesting half. Asserted below now.
     */
    pieces?: {
      panelCount?: number
      primaryStockCount?: number
      plankCount?: number
      baffleStockCount?: number
      connectors?: number
      endCaps?: number
      joiners?: number
      trimPieces?: number
      productType?: string
    }
  }
}

function loadFixtures(): Fixture[] {
  if (!existsSync(FIXTURE_DIR)) return []
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) as Fixture)
}

/**
 * Which measurement type a product type rolls up as.
 *
 * Every one of the five products is laid out over an AREA — even baffles,
 * which fill a region with runs at a spacing. Custom assemblies are quantified
 * by hand but still report the area they cover.
 */
const MEASURES_AS: Record<ProductType, ScopeType> = {
  panels: 'area', planks: 'area', baffle_cassette: 'area',
  baffle: 'area', custom_assembly: 'area',
}

const toScope = (f: Fixture, override: Record<string, string> = {}): Scope => ({
  id: f.source.scopeId,
  label: f.scope.label,
  scopeType: MEASURES_AS[canonicalProductType(f.scope.productType)],
  color: '#000',
  /*
   * The product type is injected INTO the specifications.
   *
   * A fixture keeps it alongside them, because that is how the Qt dump was
   * shaped; a Scope keeps it inside, because that is where `readProductType`
   * looks. Without this bridge the area assertions still passed — they read
   * `scopeType`, not the product — while the piece calculation saw a scope
   * with no product at all and blocked asking for baffle measures.
   */
  specifications: {
    productType: canonicalProductType(f.scope.productType),
    ...f.scope.specifications,
    // `override` last, so a test can ask what a DIFFERENT specification would
    // have produced from the same captured geometry.
    ...override,
  },
})

/**
 * pageId matters: areaSquareFeet groups by it, and a cutout carried onto the
 * wrong sheet silently removes material. A fixture that omits per-markup pages
 * is single-page by construction.
 */
const toMarkups = (f: Fixture): Markup[] => f.markups.map((m) => ({
  id: m.id,
  scopeId: f.source.scopeId,
  documentId: 'fixture',
  pageId: m.page !== undefined ? `p${m.page}` : (f.source.pageId ?? 'p0'),
  kind: m.kind,
  rings: m.rings,
}))

const toCal = (f: Fixture): Calibration => ({
  feetPerPoint: f.calibration.feetPerPoint,
  pageWidth: f.calibration.pageWidth,
  pageHeight: f.calibration.pageHeight,
})

/**
 * The pattern direction each capture was taken under.
 *
 * Pinned, because the 05.2 capture recorded 13 area markups and panel
 * dimensions and no direction — and a panel grid cannot exist without one, so
 * the count is unreproducible from the file alone. `panels.test.ts` pins the
 * same two values for the same reason. Deliberately duplicated rather than
 * shared: if the two tables ever disagree, the count assertion here fails,
 * which is exactly the alarm wanted.
 *
 * The real fix is a re-capture that records the orientation. Until then this
 * is the honest way to make the number mean something.
 */
const CAPTURED_DIRECTION: Record<string, Array<{ x: number, y: number }>> = {
  'TALJFK-C-MT-01-panels': [{ x: 0.23, y: 0.51 }, { x: 0.23, y: 0.68 }],
  'TALJFK-C-MT-02-panels': [{ x: 0.542, y: 0.61 }, { x: 0.5633, y: 0.61 }],
}

const fixtures = loadFixtures()
const filled = fixtures.filter((f) => f.expected !== null)
const pending = fixtures.filter((f) => f.expected === null)
const strict = process.env['RB_FIXTURES_STRICT'] === '1'

describe('golden fixtures', () => {
  it('finds a fixture corpus at all', () => {
    // If this ever reports zero, the suite below is vacuously green.
    expect(fixtures.length, `no fixtures in ${FIXTURE_DIR}`).toBeGreaterThan(0)
  })

  it('reports how much of the corpus is actually asserting anything', () => {
    const summary = `${filled.length} filled / ${pending.length} pending of ${fixtures.length}`
    if (pending.length > 0) {
      const names = pending.map((f) => f.name).join(', ')
      const msg =
        `${summary}\n` +
        `PENDING fixtures have inputs but no Qt-captured expectations, so they ` +
        `assert NOTHING: ${names}\n` +
        `Capture them from the running Qt build (plan 05.2) before trusting ` +
        `phase 06. Nothing in phase 06 should be written until these are filled.`
      // In strict mode a pending fixture is a failure. Locally it is a loud
      // notice, so the corpus can be grown before the oracle is available.
      if (strict) expect.fail(msg)
      else console.warn(`\n[golden fixtures] ${msg}\n`)
    }
    expect(fixtures.length).toBe(filled.length + pending.length)
  })

  // Inputs are checkable even before the oracle has spoken. These catch a
  // corrupt or mis-extracted fixture, which would otherwise look like an
  // engine regression later.
  describe.each(fixtures.map((f) => [f.name, f] as const))('%s — inputs', (_name, f) => {
    it('has a usable calibration', () => {
      expect(f.calibration.feetPerPoint).toBeGreaterThan(0)
      expect(f.calibration.pageWidth).toBeGreaterThan(0)
      expect(f.calibration.pageHeight).toBeGreaterThan(0)
    })

    it('has geometry in normalized page space', () => {
      expect(f.markups.length).toBeGreaterThan(0)
      for (const m of f.markups) {
        // Only a CLOSED ring needs three vertices to enclose anything. An
        // annotation line or a polyline is legitimately two points — the same
        // minimum removeVertexAt() enforces. Real fixtures contain both.
        const min = m.kind === 'area' || m.kind === 'cutout' ? 3 : 2
        for (const ring of m.rings) {
          expect(ring.length, `${m.kind} ${m.id}`).toBeGreaterThanOrEqual(min)
          for (const p of ring) {
            // Page points would be in the hundreds or thousands and would
            // still parse — this is the check that catches that swap.
            expect(p.x).toBeGreaterThanOrEqual(-0.05)
            expect(p.x).toBeLessThanOrEqual(1.05)
            expect(p.y).toBeGreaterThanOrEqual(-0.05)
            expect(p.y).toBeLessThanOrEqual(1.05)
          }
        }
      }
    })

    it('produces a finite, non-negative area', () => {
      const a = areaSquareFeet(toMarkups(f), toCal(f))
      expect(Number.isFinite(a)).toBe(true)
      expect(a).toBeGreaterThanOrEqual(0)
      // A real takeoff region on a real sheet. A square foot would mean the
      // calibration or the coordinate space is wrong.
      expect(a).toBeGreaterThan(1)
      expect(perimeterFeet(toMarkups(f), toCal(f))).toBeGreaterThan(0)
    })
  })

  // Only fixtures with captured expectations assert against the engine.
  if (filled.length > 0) {
    describe.each(filled.map((f) => [f.name, f] as const))('%s — matches the Qt build', (_name, f) => {
      it('reproduces every captured quantity', () => {
        const rows = calculateScopeQuantities(toScope(f), toMarkups(f), toCal(f))
        for (const want of f.expected!.quantities) {
          const got = rows.find((r) => r.itemKey === want.itemKey)
          expect(got, `${f.name}: no row for ${want.itemKey}`).toBeDefined()
          expect(got!.unit).toBe(want.unit)
          // Tight: this is a port, not an approximation. A drift big enough to
          // fail here is a drift big enough to change a bid.
          expect(got!.quantity).toBeCloseTo(want.quantity, 4)
        }
      })

      /**
       * And the PIECE counts, through the path the APP uses.
       *
       * `panels.test.ts` already asserts 662 and 54 against these fixtures —
       * and does it by calling `layoutPanels` directly with groups a test
       * helper builds. That proves the panel layout core. It does not prove
       * `calculatePieces`, which is what the application actually calls and
       * which adds the grouping, the per-page calibration and the roll-up on
       * top. So the numbers were verified and the route to them was not.
       *
       * The direction is pinned here rather than read from the fixture because
       * the 05.2 capture did not record one, and a panel grid cannot exist
       * without it. Same values as `panels.test.ts`, and a mismatch between
       * the two tables would show up as a count mismatch here — which is the
       * behaviour wanted, not a reason to share the constant.
       */
      const want = f.expected!.pieces
      const dir = CAPTURED_DIRECTION[f.name]
      if (want?.panelCount !== undefined && dir !== undefined) {
        it('reproduces the captured piece counts through calculatePieces', () => {
          const result = calculatePieces(toScope(f), toMarkups(f), toCal(f), {
            scopeDirection: dir,
            pageSize: { width: f.calibration.pageWidth, height: f.calibration.pageHeight },
          } as never)
          expect(result.blockers, `${f.name}: blocked, so no counts to compare`).toEqual([])
          const got = Object.fromEntries(result.quantities.map((q) => [q.itemKey, q.quantity]))
          expect(got['panel_count'], `${f.name}: panel count`).toBe(want.panelCount)
        })

        /*
         * What the Granularity setting is WORTH, on real geometry.
         *
         * Whether a panel may be cut in half and the cut piece used is a
         * per-scope decision, and these two fixtures happen to sit on opposite
         * settings -- C-MT-01 is 'half', C-MT-02 is 'full' -- so both paths are
         * covered. This pins the size of the decision.
         *
         * The assertion is an identity rather than a captured number: at 'full'
         * granularity nothing is shared, so every cell the layout places must
         * consume one whole panel and the order must equal the cell count. That
         * is derivable, so it cannot drift into agreeing with a wrong engine.
         *
         * On C-MT-01 it is 759 against 662 -- a 15% swing on one dropdown.
         */
        it('orders one whole panel per cell when halves are not allowed', () => {
          const result = calculatePieces(
            toScope(f, { panelGranularity: 'full' }), toMarkups(f), toCal(f),
            {
              scopeDirection: dir,
              pageSize: { width: f.calibration.pageWidth, height: f.calibration.pageHeight },
            } as never,
          )
          const got = Object.fromEntries(result.quantities.map((q) => [q.itemKey, q.quantity]))
          expect(got['panel_count'], `${f.name}: full granularity`).toBe(result.cells.length)
          // And allowing halves can only ever order fewer.
          expect(want.panelCount).toBeLessThanOrEqual(result.cells.length)
        })
      } else if (want?.panelCount !== undefined) {
        it('has no pinned direction, so its counts cannot be checked here', () => {
          const msg = `${f.name} records panelCount ${String(want.panelCount)} and the `
            + 'capture has no pattern direction. Pin one in CAPTURED_DIRECTION, or '
            + 're-capture the fixture with the orientation, or the count asserts nothing.'
          if (strict) expect.fail(msg)
          else console.warn(`[fixtures] ${msg}`)
        })
      }
    })
  }
})
