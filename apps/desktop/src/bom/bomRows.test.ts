import { describe, expect, it } from 'vitest'
import { buildBom, type Scope, type ScopePieces } from '@redbeam/domain'
import { bomSummary, entriesForRound, groupBom, reportFileName } from './bomRows.js'

const scope = (id: string, color = '#123456'): Scope => ({
  id, label: id.toUpperCase(), scopeType: 'area', color, specifications: { productType: 'panels' },
})
const pieces = (s: Scope, quantities: Array<{ itemKey: string; quantity: number }>, blockers: string[] = []): ScopePieces => ({
  scope: s,
  result: {
    productType: 'panels',
    quantities: quantities.map((q) => ({ ...q, label: q.itemKey, unit: 'EA' })),
    cells: [], runs: [], blockers,
  },
})

describe('entriesForRound', () => {
  const a = pieces(scope('a'), [{ itemKey: 'panel_count', quantity: 10 }])
  const b = pieces(scope('b'), [{ itemKey: 'panel_count', quantity: 20 }])

  it('keeps only the scopes in the round', () => {
    expect(entriesForRound([a, b], new Set(['b'])).map((e) => e.scope.id)).toEqual(['b'])
  })

  /**
   * The bill of the whole project, when no round is open — an estimator
   * asking for quantities from the palette before drilling into a round
   * gets everything rather than nothing.
   */
  it('is the whole project when no round is open', () => {
    expect(entriesForRound([a, b], null)).toHaveLength(2)
  })
})

describe('groupBom', () => {
  it('puts every line under its own scope, in entry order, with its colour', () => {
    const entries = [
      pieces(scope('b', '#00ff00'), [{ itemKey: 'panel_count', quantity: 20 }]),
      pieces(scope('a', '#ff0000'), [{ itemKey: 'panel_count', quantity: 10 }, { itemKey: 'trim_pieces', quantity: 4 }]),
    ]
    const groups = groupBom(buildBom(entries), entries)
    expect(groups.map((g) => g.scopeId)).toEqual(['b', 'a'])
    expect(groups[1]?.lines.map((l) => l.itemKey)).toEqual(['panel_count', 'trim_pieces'])
    expect(groups[0]?.color).toBe('#00ff00')
  })

  /** A scope with nothing to order has no group — not an empty heading. */
  it('drops a scope with no lines', () => {
    const entries = [pieces(scope('a'), [])]
    expect(groupBom(buildBom(entries), entries)).toEqual([])
  })

  it('carries a blocked scope as its one blocked line', () => {
    const entries = [pieces(scope('a'), [], ['Panel W'])]
    const groups = groupBom(buildBom(entries), entries)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.lines[0]?.confidence).toBe('blocked')
    expect(groups[0]?.lines[0]?.quantity).toBeNull()
  })
})

describe('bomSummary', () => {
  it('counts the lines and the ones that need attention', () => {
    const entries = [
      pieces(scope('a'), [{ itemKey: 'panel_count', quantity: 10 }]),
      pieces(scope('b'), [], ['Panel W']),
    ]
    expect(bomSummary(entries)).toEqual({ lines: 2, attention: 1 })
  })
})

describe('reportFileName', () => {
  it('replaces every character Windows refuses in a file name', () => {
    const name = reportFileName('Job: 44/Wall?', '<alt> "2" | *')
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
    expect(name.endsWith(' takeoff.html')).toBe(true)
  })
})
