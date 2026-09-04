import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBom, bomToTsv, type ScopePieces } from './bom.js'
import { calculatePieces } from './takeoff.js'
import type { Calibration, Markup, Scope } from './scope.js'
import type { NormalizedDirection } from './pattern.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(here, '..', '..', '..', 'fixtures')

const scope = (over: Partial<Scope> = {}): Scope => ({
  id: 's1', label: 'CL03', scopeType: 'area', color: '#000',
  specifications: { productType: 'panels' }, ...over,
})

const pieces = (over: Partial<ScopePieces['result']> = {}): ScopePieces['result'] => ({
  productType: 'panels', quantities: [], cells: [], runs: [], blockers: [], ...over,
})

describe('confidence per line', () => {
  it('marks a panel line verified — it reproduces the Qt build on a fixture', () => {
    const bom = buildBom([{
      scope: scope(),
      result: pieces({ quantities: [{ itemKey: 'panel_count', label: 'Panels', quantity: 662, unit: 'EA' }] }),
    }])
    expect(bom.lines[0]!.confidence).toBe('verified')
    expect(bom.counts.verified).toBe(1)
    expect(bom.needsAttention).toBe(false)
  })

  it('marks a baffle line unverified and says why', () => {
    // Ported but never checked against the oracle: no baffle fixture exists.
    // Presenting it identically to a checked count would claim a confidence
    // we do not have, and the number that gets ordered is the one someone pays for.
    const bom = buildBom([{
      scope: scope({ specifications: { productType: 'baffle' } }),
      result: pieces({
        productType: 'baffle',
        quantities: [{ itemKey: 'stock_count', label: 'Stock', quantity: 40, unit: 'EA' }],
      }),
    }])
    expect(bom.lines[0]!.confidence).toBe('unverified')
    expect(bom.lines[0]!.note).toMatch(/not verified against the Qt build/)
    expect(bom.needsAttention).toBe(true)
  })

  it('gives a blocked scope NO quantity rather than zero', () => {
    // 0 in a BOM reads as "nothing to order". "Not configured yet" is a
    // different and far cheaper thing to discover.
    const bom = buildBom([{
      scope: scope(),
      result: pieces({ blockers: ['Panel W', 'Panel L'] }),
    }])
    expect(bom.lines[0]!.quantity).toBeNull()
    expect(bom.lines[0]!.confidence).toBe('blocked')
    expect(bom.lines[0]!.label).toContain('Panel W')
  })
})

describe('totals', () => {
  it('does NOT count the full/half breakdown on top of the ordered panels', () => {
    // panel_full and panel_half describe panel_count; adding all three would
    // turn a 662-panel ceiling into 1,421.
    const bom = buildBom([{
      scope: scope(),
      result: pieces({
        quantities: [
          { itemKey: 'panel_count', label: 'Panels', quantity: 662, unit: 'EA' },
          { itemKey: 'panel_full', label: 'Full panels', quantity: 565, unit: 'EA' },
          { itemKey: 'panel_half', label: 'Half panels', quantity: 194, unit: 'EA' },
        ],
      }),
    }])
    expect(bom.totals).toEqual([{ unit: 'EA', quantity: 662 }])
  })

  it('excludes unverified quantities from the total instead of mixing them in', () => {
    // A total that silently blends a checked number with an unchecked one is
    // less trustworthy than either, and hides which is which.
    const bom = buildBom([
      {
        scope: scope({ id: 'a' }),
        result: pieces({ quantities: [{ itemKey: 'panel_count', label: 'Panels', quantity: 100, unit: 'EA' }] }),
      },
      {
        scope: scope({ id: 'b', specifications: { productType: 'planks' } }),
        result: pieces({
          productType: 'planks',
          quantities: [{ itemKey: 'panel_count', label: 'Planks', quantity: 50, unit: 'EA' }],
        }),
      },
    ])
    expect(bom.totals).toEqual([{ unit: 'EA', quantity: 100 }])
    expect(bom.counts).toEqual({ verified: 1, unverified: 1, blocked: 0 })
  })

  it('sums verified lines across scopes, per unit', () => {
    const bom = buildBom([
      { scope: scope({ id: 'a' }), result: pieces({ quantities: [{ itemKey: 'panel_count', label: 'P', quantity: 662, unit: 'EA' }] }) },
      { scope: scope({ id: 'b' }), result: pieces({ quantities: [{ itemKey: 'panel_count', label: 'P', quantity: 54, unit: 'EA' }] }) },
    ])
    expect(bom.totals).toEqual([{ unit: 'EA', quantity: 716 }])
  })

  it('is empty, not zero, when there is nothing verified to total', () => {
    expect(buildBom([]).totals).toEqual([])
    expect(buildBom([]).needsAttention).toBe(false)
  })
})

describe('tsv export', () => {
  it('carries confidence as a COLUMN, not a footnote', () => {
    // Pasted into a spreadsheet a footnote is lost, and an unverified count
    // becomes indistinguishable from a checked one.
    const bom = buildBom([{
      scope: scope({ specifications: { productType: 'baffle' } }),
      result: pieces({
        productType: 'baffle',
        quantities: [{ itemKey: 'stock_count', label: 'Stock', quantity: 40, unit: 'EA' }],
      }),
    }])
    const tsv = bomToTsv(bom)
    const [header, row] = tsv.split('\n')
    expect(header!.split('\t')).toContain('confidence')
    expect(row!.split('\t')).toContain('unverified')
  })

  it('leaves a blocked quantity blank rather than writing 0', () => {
    const bom = buildBom([{ scope: scope(), result: pieces({ blockers: ['Panel W'] }) }])
    const cols = bomToTsv(bom).split('\n')[1]!.split('\t')
    expect(cols[3]).toBe('')
  })
})

// --------------------------------------------------------------- fixtures --

interface Fixture {
  source: { scopeId: string }
  scope: { label: string; productType: string; specifications: Record<string, unknown> }
  calibration: Calibration & { pageWidth: number; pageHeight: number }
  markups: Array<{ id: string; kind: Markup['kind']; page?: number; rings: Markup['rings'] }>
  expected: { pieces: Record<string, number | string> }
}

const DIRECTION: Record<string, NormalizedDirection> = {
  'TALJFK-C-MT-01-panels': [{ x: 0.23, y: 0.51 }, { x: 0.23, y: 0.68 }],
  'TALJFK-C-MT-02-panels': [{ x: 0.542, y: 0.61 }, { x: 0.5633, y: 0.61 }],
}

describe('against the Qt build', () => {
  it.each(Object.keys(DIRECTION))('%s BOM matches the oracle', (name) => {
    const f = JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8')) as Fixture
    const sc: Scope = {
      id: f.source.scopeId, label: f.scope.label, scopeType: 'area', color: '#000',
      specifications: { ...f.scope.specifications, productType: f.scope.productType },
    }
    const markups: Markup[] = f.markups.map((m) => ({
      id: m.id, scopeId: f.source.scopeId, documentId: 'fixture',
      pageId: `p${m.page ?? 0}`, kind: m.kind, rings: m.rings,
    }))
    const result = calculatePieces(sc, markups, f.calibration, {
      scopeDirection: DIRECTION[name]!,
      pageSize: { width: f.calibration.pageWidth, height: f.calibration.pageHeight },
    })
    const bom = buildBom([{ scope: sc, result }])

    // The ordered panel total is the number that reaches a purchase order.
    expect(bom.totals).toEqual([{ unit: 'EA', quantity: f.expected.pieces['panelCount'] }])
    expect(bom.counts.blocked).toBe(0)
    expect(bom.counts.unverified).toBe(0)
    expect(bom.needsAttention).toBe(false)

    // The oracle reports NO connectors, end caps, joiners or trim for these
    // specs. Those zeros are real captured data, not an absence of data, so
    // the BOM must not invent lines for them.
    for (const absent of ['connectors', 'endCaps', 'joiners', 'trimPieces']) {
      expect(f.expected.pieces[absent], `fixture ${absent}`).toBe(0)
      expect(bom.lines.some((l) => l.itemKey.includes(absent.toLowerCase()))).toBe(false)
    }
  })
})
