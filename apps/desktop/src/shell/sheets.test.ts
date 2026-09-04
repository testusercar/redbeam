import { describe, expect, it } from 'vitest'
import {
  buildSheetIndex, filterSheets, splitSheetTitle, sheetFromText, sheetDots, SHEET_DOT_CAP,
  type SheetIndexInput, type SheetOutlineNode,
} from './sheets.js'

const leaf = (title: string, page: number | null): SheetOutlineNode => ({ title, page, children: [] })
const branch = (title: string, page: number | null, children: SheetOutlineNode[]): SheetOutlineNode =>
  ({ title, page, children })

const base = (over: Partial<SheetIndexInput>): SheetIndexInput => ({
  pageCount: 0, shape: 'none', outline: [], labels: [], takeoffPages: new Set(), ...over,
})

const allPages = (groups: ReturnType<typeof buildSheetIndex>) => groups.flatMap((g) => g.rows.map((r) => r.page))

describe('splitSheetTitle', () => {
  it('splits a real drawing-set bookmark', () => {
    expect(splitSheetTitle('AE6-01-02 ARCHITECTURAL CEILING PLAN')).toEqual({
      number: 'AE6-01-02', title: 'ARCHITECTURAL CEILING PLAN',
    })
  })

  it('handles the short forms', () => {
    expect(splitSheetTitle('A-101 FLOOR PLAN')).toEqual({ number: 'A-101', title: 'FLOOR PLAN' })
    expect(splitSheetTitle('M2.01 MECHANICAL')).toEqual({ number: 'M2.01', title: 'MECHANICAL' })
  })

  it('drops a separator dash between code and name', () => {
    expect(splitSheetTitle('A-101 - FLOOR PLAN')).toEqual({ number: 'A-101', title: 'FLOOR PLAN' })
    expect(splitSheetTitle('A-101 — FLOOR PLAN')).toEqual({ number: 'A-101', title: 'FLOOR PLAN' })
  })

  it('treats a code with no name as all code', () => {
    expect(splitSheetTitle('G0-00-01')).toEqual({ number: 'G0-00-01', title: '' })
  })

  it('does not mistake a leading word for a sheet number', () => {
    // "COVER" has no digit or hyphen, so it is a title, not a code.
    expect(splitSheetTitle('COVER SHEET')).toEqual({ number: 'COVER SHEET', title: '' })
    expect(splitSheetTitle('A Very Long Title')).toEqual({ number: 'A Very Long Title', title: '' })
  })

  it('normalises whitespace rather than carrying it into the UI', () => {
    expect(splitSheetTitle('  A-101  \n FLOOR  PLAN ')).toEqual({
      number: 'A-101', title: 'FLOOR PLAN',
    })
  })

  it('survives an empty title', () => {
    expect(splitSheetTitle('')).toEqual({ number: '', title: '' })
    expect(splitSheetTitle('   ')).toEqual({ number: '', title: '' })
  })
})

describe('buildSheetIndex — the invariant', () => {
  const outline = [
    branch('GENERAL', 0, [leaf('G0-00-01 COVER', 0), leaf('G0-00-02 NOTES', 1)]),
    branch('ARCHITECTURAL', 2, [leaf('A-101 FLOOR PLAN', 2), leaf('A-102 CEILING', 3)]),
  ]

  it('renders every page exactly once, in order, for every shape', () => {
    for (const shape of ['none', 'sparse', 'per-sheet', 'table-of-contents'] as const) {
      const groups = buildSheetIndex(base({ pageCount: 6, shape, outline }))
      expect(allPages(groups), shape).toEqual([0, 1, 2, 3, 4, 5])
    }
  })

  it('holds the invariant for outlines that do not start at page 0', () => {
    // The version of this test that only used an outline starting at page 0
    // passed against a build that dropped every page before the first
    // bookmark. Front matter is exactly where an index loses sheets.
    const late = [
      branch('ARCHITECTURAL', 3, [leaf('A-101 PLAN', 3)]),
      branch('STRUCTURAL', 5, [leaf('S-101 FRAMING', 5)]),
    ]
    for (const shape of ['per-sheet', 'table-of-contents'] as const) {
      const groups = buildSheetIndex(base({ pageCount: 7, shape, outline: late }))
      expect(allPages(groups), shape).toEqual([0, 1, 2, 3, 4, 5, 6])
    }
  })

  it('returns nothing for an empty document rather than a phantom row', () => {
    expect(buildSheetIndex(base({ pageCount: 0, shape: 'per-sheet' }))).toEqual([])
  })
})

describe('buildSheetIndex — per-sheet outlines', () => {
  it('uses bookmark titles as sheet number and name', () => {
    const groups = buildSheetIndex(base({
      pageCount: 3,
      shape: 'per-sheet',
      outline: [
        leaf('G0-00-01 COVER SHEET', 0),
        leaf('AE6-01-02 ARCHITECTURAL CEILING PLAN', 1),
        leaf('A-201 ELEVATIONS', 2),
      ],
    }))
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBeNull()
    expect(groups[0]!.rows[1]).toEqual({
      page: 1, number: 'AE6-01-02', title: 'ARCHITECTURAL CEILING PLAN', hasTakeoff: false, scopes: [],
    })
  })

  it('falls back to the page label for a page no bookmark points at', () => {
    const groups = buildSheetIndex(base({
      pageCount: 3,
      shape: 'per-sheet',
      outline: [leaf('A-101 PLAN', 0), leaf('A-103 PLAN', 2)],
      labels: [null, 'A-102', null],
    }))
    const rows = groups[0]!.rows
    expect(rows[1]).toEqual({ page: 1, number: 'A-102', title: '', hasTakeoff: false, scopes: [] })
  })

  it('falls back to an ordinal when there is no label either', () => {
    const groups = buildSheetIndex(base({ pageCount: 2, shape: 'per-sheet', outline: [] }))
    expect(groups[0]!.rows.map((r) => r.number)).toEqual(['Page 1', 'Page 2'])
  })

  it('never invents a sheet number that looks like one', () => {
    // The failure mode this guards: a fallback of `A-001` reads as a sheet
    // code the document supports, and it does not.
    const groups = buildSheetIndex(base({ pageCount: 1, shape: 'per-sheet' }))
    expect(groups[0]!.rows[0]!.number).toBe('Page 1')
  })

  it('lets the first bookmark win when two point at one page', () => {
    const groups = buildSheetIndex(base({
      pageCount: 1,
      shape: 'per-sheet',
      outline: [leaf('A-101 FIRST', 0), leaf('A-999 SECOND', 0)],
    }))
    expect(groups[0]!.rows[0]!.number).toBe('A-101')
  })

  it('ignores destinations outside the document', () => {
    const groups = buildSheetIndex(base({
      pageCount: 2,
      shape: 'per-sheet',
      outline: [leaf('A-101 PLAN', 0), leaf('A-500 GHOST', 99), leaf('A-000 NEGATIVE', -1)],
    }))
    expect(allPages(groups)).toEqual([0, 1])
    expect(groups[0]!.rows[1]!.number).toBe('Page 2')
  })

  it('marks the pages carrying takeoff', () => {
    const groups = buildSheetIndex(base({
      pageCount: 3, shape: 'per-sheet', takeoffPages: new Set([1]),
    }))
    expect(groups[0]!.rows.map((r) => r.hasTakeoff)).toEqual([false, true, false])
  })
})

describe('the scopes on a sheet', () => {
  const amber = { id: 'mt', label: 'C-MT-01 Metal Panel', color: '#c9873f' }
  const green = { id: 'bf', label: 'C-BF-02 Baffle', color: '#4f8f6d' }

  it('ride on the row, in the order they were given', () => {
    const groups = buildSheetIndex(base({
      pageCount: 2, shape: 'per-sheet',
      pageScopes: new Map([[1, [green, amber]]]),
    }))
    expect(groups[0]!.rows[0]!.scopes).toEqual([])
    expect(groups[0]!.rows[1]!.scopes.map((s) => s.id)).toEqual(['bf', 'mt'])
  })

  /**
   * The two inputs come from the same markups and can still disagree — the
   * scope map is built per scope, the page set per markup — and a row that
   * drew a scope's dot while saying it had no takeoff would be lying in one
   * of two places. A scope on the page IS takeoff on the page.
   */
  it('imply takeoff even when the page set was not told', () => {
    const groups = buildSheetIndex(base({
      pageCount: 1, shape: 'none', pageScopes: new Map([[0, [amber]]]),
    }))
    expect(groups[0]!.rows[0]!.hasTakeoff).toBe(true)
  })

  it('still count takeoff that belongs to no scope', () => {
    const groups = buildSheetIndex(base({
      pageCount: 1, shape: 'none', takeoffPages: new Set([0]), pageScopes: new Map(),
    }))
    expect(groups[0]!.rows[0]).toMatchObject({ hasTakeoff: true, scopes: [] })
  })

  it('survive the fallback rows too', () => {
    const groups = buildSheetIndex(base({
      pageCount: 2, shape: 'per-sheet', outline: [leaf('A-101 PLAN', 0)],
      pageScopes: new Map([[1, [amber]]]),
    }))
    expect(groups[0]!.rows[1]!.number).toBe('Page 2')
    expect(groups[0]!.rows[1]!.scopes).toEqual([amber])
  })
})

describe('the dot budget', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: `S${i}`, color: '#000' }))

  it('draws every scope up to the cap', () => {
    expect(sheetDots(many(SHEET_DOT_CAP))).toEqual({ shown: many(SHEET_DOT_CAP), more: 0 })
    expect(sheetDots([])).toEqual({ shown: [], more: 0 })
  })

  /** A row over the cap must never be wider than a row at it. */
  it('never draws more cells than the cap', () => {
    for (let n = 0; n <= SHEET_DOT_CAP * 3; n++) {
      const { shown, more } = sheetDots(many(n))
      const cells = shown.length + (more > 0 ? 1 : 0)
      expect(cells, `${n} scopes`).toBeLessThanOrEqual(SHEET_DOT_CAP)
      expect(shown.length + more, `${n} scopes accounted for`).toBe(n)
    }
  })

  /** "+1" spends a count on what a dot would have said. */
  it('never says +1', () => {
    for (let n = 0; n <= SHEET_DOT_CAP * 3; n++) {
      expect(sheetDots(many(n)).more, `${n} scopes`).not.toBe(1)
    }
  })

  it('keeps the first scopes, which are the caller order', () => {
    const { shown } = sheetDots(many(9))
    expect(shown.map((s) => s.id)).toEqual(many(SHEET_DOT_CAP - 1).map((s) => s.id))
  })
})

describe('buildSheetIndex — table of contents', () => {
  const outline = [
    branch('GENERAL', 0, [leaf('G0-00-01 COVER', 0), leaf('G0-00-02 NOTES', 1)]),
    branch('ARCHITECTURAL', 4, [leaf('A-101 PLAN', 4), leaf('A-102 CEILING', 5)]),
  ]

  it('groups by top-level entry and covers the gaps between them', () => {
    const groups = buildSheetIndex(base({ pageCount: 7, shape: 'table-of-contents', outline }))
    expect(groups.map((g) => g.label)).toEqual(['GENERAL', 'ARCHITECTURAL'])
    // Pages 2 and 3 belong to no bookmark; they stay under GENERAL rather than
    // vanishing, which is the invariant that matters.
    expect(groups[0]!.rows.map((r) => r.page)).toEqual([0, 1, 2, 3])
    expect(groups[1]!.rows.map((r) => r.page)).toEqual([4, 5, 6])
  })

  it('opens a front-matter group when the outline starts late', () => {
    const late = [branch('ARCHITECTURAL', 2, [leaf('A-101 PLAN', 2)])]
    const groups = buildSheetIndex(base({ pageCount: 4, shape: 'table-of-contents', outline: late }))
    expect(groups.map((g) => g.label)).toEqual(['Front matter', 'ARCHITECTURAL'])
    expect(groups[0]!.rows.map((r) => r.page)).toEqual([0, 1])
  })

  it('derives a division start from its children when the division has no page', () => {
    const noPage = [branch('ARCHITECTURAL', null, [leaf('A-101 PLAN', 3), leaf('A-102 PLAN', 4)])]
    const groups = buildSheetIndex(base({ pageCount: 5, shape: 'table-of-contents', outline: noPage }))
    expect(groups.map((g) => g.label)).toEqual(['Front matter', 'ARCHITECTURAL'])
    expect(groups[1]!.rows.map((r) => r.page)).toEqual([3, 4])
  })

  it('orders groups by page even when the outline lists them out of order', () => {
    const scrambled = [
      branch('ARCHITECTURAL', 4, [leaf('A-101 PLAN', 4)]),
      branch('GENERAL', 0, [leaf('G0-00-01 COVER', 0)]),
    ]
    const groups = buildSheetIndex(base({ pageCount: 6, shape: 'table-of-contents', outline: scrambled }))
    expect(groups.map((g) => g.label)).toEqual(['GENERAL', 'ARCHITECTURAL'])
    expect(allPages(groups)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('degrades to a flat list when no entry has a destination', () => {
    const pageless = [branch('ARCHITECTURAL', null, [leaf('A-101 PLAN', null)])]
    const groups = buildSheetIndex(base({ pageCount: 3, shape: 'table-of-contents', outline: pageless }))
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBeNull()
  })
})

describe('buildSheetIndex — sparse and absent outlines', () => {
  it('ignores section bookmarks rather than bucketing 110 sheets into five', () => {
    const groups = buildSheetIndex(base({
      pageCount: 8,
      shape: 'sparse',
      outline: [leaf('DIVISION 1', 0), leaf('DIVISION 2', 4)],
      labels: ['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7', 'A-8'],
    }))
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toBeNull()
    // The labels still win over ordinals — the outline is what is ignored.
    expect(groups[0]!.rows[0]!.number).toBe('A-1')
  })

  it('shows plain pages when there is nothing at all', () => {
    const groups = buildSheetIndex(base({ pageCount: 2, shape: 'none' }))
    expect(groups[0]!.rows.map((r) => r.number)).toEqual(['Page 1', 'Page 2'])
  })

  it('does not treat a blank page label as a label', () => {
    const groups = buildSheetIndex(base({ pageCount: 1, shape: 'none', labels: ['   '] }))
    expect(groups[0]!.rows[0]!.number).toBe('Page 1')
  })
})

describe('filterSheets', () => {
  const groups = buildSheetIndex(base({
    pageCount: 3,
    shape: 'per-sheet',
    outline: [
      leaf('G0-00-01 COVER SHEET', 0),
      leaf('AE6-01-02 ARCHITECTURAL CEILING PLAN', 1),
      leaf('A-201 ELEVATIONS', 2),
    ],
  }))

  it('matches the sheet code', () => {
    expect(filterSheets(groups, 'ae6')[0]!.rows.map((r) => r.page)).toEqual([1])
  })

  it('matches the sheet name', () => {
    expect(filterSheets(groups, 'ceiling')[0]!.rows.map((r) => r.page)).toEqual([1])
  })

  it('returns everything for an empty query', () => {
    expect(filterSheets(groups, '   ')).toEqual(groups)
  })

  it('drops groups that match nothing rather than leaving empty headings', () => {
    expect(filterSheets(groups, 'nothing-matches-this')).toEqual([])
  })
})

/**
 * Real title blocks, from the set this was written against. The first rule I
 * tried — "the last code-shaped token on the page" — labelled a sheet `R2`,
 * because the revision history prints after the title block.
 */
describe('sheetFromText', () => {
  it('reads a code and its name off a title block', () => {
    const page = [
      'LEGEND', 'INTERIOR FINISHES', '',
      'A00.02',
      'CODE COMPLIANCE PLAN - LEVEL 47',
      '067.1476.000',
      'Barclays Toronto',
    ].join(String.fromCharCode(10))
    expect(sheetFromText(page)).toEqual({
      number: 'A00.02', title: 'CODE COMPLIANCE PLAN - LEVEL 47',
    })
  })

  it('is not fooled by the revision history that follows it', () => {
    // The exact shape that broke the first attempt.
    const page = [
      'A00.02', 'CODE COMPLIANCE PLAN - LEVEL 47',
      'R0 2024 1206 ISSUE FOR PERMIT',
      'R1 2024 1206 ISSUE FOR 90% BID',
      'R2 2024 1220 ISSUE FOR 100% BID',
    ].join(String.fromCharCode(10))
    expect(sheetFromText(page)?.number).toBe('A00.02')
  })

  it('is not fooled by a postal code or an address', () => {
    const page = ['A-101', 'DEMOLITION PLAN', '181 Bay Street, Toronto, ON M5J 2T3'].join(String.fromCharCode(10))
    expect(sheetFromText(page)?.number).toBe('A-101')
  })

  /**
   * The case that broke the second attempt. A revision cloud stamps `R2` on
   * its own line, once per cloud, so a sheet with seven revisions ends with
   * seven lines that are nothing but `R2` — every one of which is shaped
   * exactly like a sheet number.
   */
  it('is not fooled by revision clouds stamped on their own lines', () => {
    const page = [
      'A11.01', 'ENLARGED PLAN - RECEPTION',
      'R2 2024 1220 ISSUE FOR 100% BID',
      'R2', 'R2', 'R2', 'R2', 'R2', 'R2', 'R2',
    ].join(String.fromCharCode(10))
    expect(sheetFromText(page)?.number).toBe('A11.01')
  })

  it('says nothing when a code introduces no name', () => {
    // A code with a project number under it is not a title block.
    expect(sheetFromText(['M2.01', '067.1476.000'].join(String.fromCharCode(10)))).toBeNull()
  })

  it('says nothing when the page has no title block', () => {
    expect(sheetFromText('')).toBeNull()
    expect(sheetFromText('a cover sheet with only prose and a date 2024.12.20')).toBeNull()
  })
})
