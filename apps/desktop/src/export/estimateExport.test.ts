import { describe, expect, it } from 'vitest'
import type { Scope, ScopePieces } from '@redbeam/domain'
import {
  buildEstimateExport, estimateToCsv, estimateToTsv, exportFileName, exportRows,
} from './estimateExport.js'

const scope = (id: string, label: string, over: Partial<Scope> = {}): Scope => ({
  id, label, scopeType: 'area', color: '#ff4d4d', specifications: { productType: 'panels' }, ...over,
})

const panels = scope('s1', 'C-MT-01')
const runs = scope('s2', 'WP-12 "quoted"', { scopeType: 'linear', specifications: { productType: 'planks' } })
const empty = scope('s3', 'Nothing yet')

const pieces: ScopePieces[] = [
  {
    scope: panels,
    result: {
      productType: 'panels',
      quantities: [{ itemKey: 'panel', label: 'Panels', quantity: 662, unit: 'EA' }],
      cells: [],
      blockers: [],
    } as unknown as ScopePieces['result'],
  },
]

const input = {
  projectName: 'Barclays: Toronto',
  estimateName: '260529 - Initial Bid',
  scopes: [panels, runs, empty],
  quantities: [
    { scope: panels, rows: [{ itemKey: 'area', label: 'Area', quantity: 4128.830820581, unit: 'SF' }] },
    { scope: runs, rows: [{ itemKey: 'length', label: 'Length', quantity: 212.5, unit: 'LF' }] },
  ],
  pieces,
  markups: [
    { scopeId: 's1', documentId: 'd1', pageId: 'd1-p0', kind: 'area' },
    { scopeId: 's1', documentId: 'd1', pageId: 'd1-p0', kind: 'cutout' },
    { scopeId: 's1', documentId: 'd1', pageId: 'd1-p3', kind: 'area' },
    { scopeId: null, documentId: 'd1', pageId: 'd1-p3', kind: 'dimension' },
    { scopeId: 's2', documentId: 'd2', pageId: 'd2-p1', kind: 'polyline' },
  ],
  sheetLabelFor: (pageId: string) => ({ 'd1-p0': 'A-101', 'd1-p3': 'A-104', 'd2-p1': 'A-201' })[pageId] ?? pageId,
  documents: ['AE6 CEILING SET.pdf', 'A-SERIES.pdf'],
  generatedAt: new Date('2026-09-04T12:00:00Z'),
}

describe('buildEstimateExport', () => {
  it('lists every scope in the round, with its quantities and components', () => {
    const e = buildEstimateExport(input)
    expect(e.scopes.map((s) => s.label)).toEqual(['C-MT-01', 'WP-12 "quoted"', 'Nothing yet'])
    const first = e.scopes[0]!
    expect(first.product).toBe('Panels')
    expect(first.quantities).toEqual([{ label: 'Area', quantity: 4128.830820581, unit: 'SF' }])
    expect(first.components.map((c) => [c.label, c.quantity, c.unit, c.confidence]))
      .toEqual([['Panels', 662, 'EA', 'verified']])
  })

  it('counts only takeoff markups and names the sheets they sit on', () => {
    const e = buildEstimateExport(input)
    expect(e.scopes[0]!.markupCount).toBe(3)
    expect(e.scopes[0]!.sheets).toEqual(['A-101', 'A-104'])
    expect(e.scopes[1]!.sheets).toEqual(['A-201'])
    expect(e.scopes[2]!.markupCount).toBe(0)
  })

  it('starts with empty editable fields', () => {
    const e = buildEstimateExport(input)
    expect(e.subtitle).toBe('')
    expect(e.scopes.every((s) => s.note === '')).toBe(true)
  })
})

describe('exportRows', () => {
  it('emits a row per quantity and per component, and one for a scope with nothing', () => {
    const rows = exportRows(buildEstimateExport(input))
    expect(rows.map((r) => `${r.scope}|${r.kind}|${r.item}`)).toEqual([
      'C-MT-01|Quantity|Area',
      'C-MT-01|Component|Panels',
      'WP-12 "quoted"|Quantity|Length',
      'Nothing yet|Quantity|No takeoff yet',
    ])
  })
})

describe('estimateToCsv', () => {
  it('names the project and round, then a header, then rows Excel can read', () => {
    const csv = estimateToCsv(buildEstimateExport(input))
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Project,Barclays: Toronto')
    expect(lines[1]).toBe('Estimate,260529 - Initial Bid')
    expect(lines[2]).toBe('Generated,2026-09-04')
    expect(lines[3]).toBe('')
    expect(lines[4]).toBe('Scope,Product,Kind,Item,Quantity,Unit,Standing,Note,Sheets')
    expect(lines[5]).toBe('C-MT-01,Panels,Quantity,Area,4128.83,SF,measured,,A-101; A-104')
  })

  it('quotes a cell that carries a quote or a comma', () => {
    const csv = estimateToCsv(buildEstimateExport(input))
    expect(csv).toContain('"WP-12 ""quoted""",Planks,Quantity,Length,212.5,LF')
  })

  it('leaves a blocked quantity empty rather than writing zero', () => {
    const e = buildEstimateExport(input)
    e.scopes[0]!.components[0]!.quantity = null
    expect(estimateToCsv(e)).toContain('C-MT-01,Panels,Component,Panels,,EA,verified')
  })
})

describe('estimateToTsv', () => {
  it('is the table alone, tab separated, with no project preamble', () => {
    const tsv = estimateToTsv(buildEstimateExport(input))
    const lines = tsv.split('\r\n')
    expect(lines[0]).toBe('Scope\tProduct\tKind\tItem\tQuantity\tUnit\tStanding\tNote\tSheets')
    expect(lines[1]).toBe('C-MT-01\tPanels\tQuantity\tArea\t4128.83\tSF\tmeasured\t\tA-101; A-104')
  })

  it('carries the edited note and never a tab inside a cell', () => {
    const e = buildEstimateExport(input)
    e.scopes[0]!.note = 'Alt 2:\tno access panels'
    expect(estimateToTsv(e)).toContain('\tmeasured\tAlt 2: no access panels\t')
  })
})

describe('exportFileName', () => {
  it('drops the characters Windows refuses', () => {
    expect(exportFileName(buildEstimateExport(input), 'csv'))
      .toBe('Barclays- Toronto — 260529 - Initial Bid estimate.csv')
  })
})
