import { describe, expect, it } from 'vitest'
import { buildBom, type Scope, type ScopePieces } from '@redbeam/domain'
import { entriesForRound, reportFileName } from './bomRows.js'

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

describe('reportFileName', () => {
  it('replaces every character Windows refuses in a file name', () => {
    const name = reportFileName('Job: 44/Wall?', '<alt> "2" | *')
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
    expect(name.endsWith(' takeoff.html')).toBe(true)
  })
})
