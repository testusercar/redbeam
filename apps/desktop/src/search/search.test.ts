/**
 * The search pane's pure parts, and the one structural fact about it that
 * matters: it is a rail pane, not a second sidebar.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SearchHit } from '@redbeam/store'
import { describe, expect, it } from 'vitest'
import { groupHits, currentFirst } from './SearchPanel.js'

const hit = (relativePath: string, pageNumber: number): SearchHit => ({
  pageId: `${relativePath}#${pageNumber}`, documentId: relativePath, pageNumber, relativePath,
  snippet: '', snippetSpans: [], spans: [], boxes: null,
})

describe('grouping hits by document', () => {
  it('keeps the order documents first appeared in, and page order inside each', () => {
    const groups = groupHits([
      hit('specs/SPEC.pdf', 40), hit('drawings/AE6.pdf', 5), hit('drawings/AE6.pdf', 7),
      hit('specs/SPEC.pdf', 41),
    ])
    expect(groups.map((g) => g.title)).toEqual(['SPEC.pdf', 'AE6.pdf'])
    expect(groups[1]!.hits.map((h) => h.pageNumber)).toEqual([5, 7])
    expect(groups[0]!.hits.map((h) => h.pageNumber)).toEqual([40, 41])
  })

  it('names a group by the file alone — the folder is the group head one level up', () => {
    expect(groupHits([hit('a/b/c/SET.pdf', 0)])[0]!.title).toBe('SET.pdf')
    expect(groupHits([hit('SET.pdf', 0)])[0]!.title).toBe('SET.pdf')
  })

  /**
   * Board 3 (round two): on the open document a group is a SHEET, named by
   * its number with its title beside it, one group per page. Another
   * document, whose index is not read, still groups under its file name.
   */
  it('groups the open document by sheet number and title, one group per page', () => {
    const sheet = (pageId: string) => (pageId.startsWith('drawings/AE6.pdf') ? { number: `A-10${pageId.slice(-1)}`, title: 'Level plan' } : null)
    const groups = groupHits([hit('drawings/AE6.pdf', 5), hit('drawings/AE6.pdf', 5), hit('drawings/AE6.pdf', 7), hit('specs/SPEC.pdf', 40)], sheet)
    expect(groups.map((g) => g.title)).toEqual(['A-105', 'A-107', 'SPEC.pdf'])
    expect(groups[0]!.detail).toBe('Level plan · p6')
    expect(groups[0]!.hits).toHaveLength(2)
    expect(groups[2]!.open).toBe(false)
  })

  it('is empty for no hits', () => {
    expect(groupHits([])).toEqual([])
  })
})

/**
 * The gate. A highlight is a markup, and a markup belongs to a scope, so the
 * pane asks which before it makes one and never reaches for the dock's
 * active scope. Aaron, 2026-09-18.
 */
describe('the highlight gate', () => {
  const src = readFileSync(fileURLToPath(new URL('./SearchPanel.tsx', import.meta.url)), 'utf8')

  it('highlights into a scope the pane chose, and asks when none is chosen', () => {
    expect(src).toContain('onMarkHits?: (hits: SearchHit[], scopeId: string) => Promise<string[]>')
    expect(src).toContain("if (target === null) { setChoosing(true); return }")
    expect(src).not.toContain('activeScope')
  })

  it('can take a highlight back', () => {
    expect(src).toContain('onUnmarkHits?: (ids: string[]) => Promise<void>')
  })
})

/**
 * Search used to render `<aside className="searchpanel pane">`, fixed to the
 * right edge over the estimates — a second right-hand sidebar. The rail owns
 * finding things, so the panel renders pane PARTS and lets the rail's pane
 * frame place them. Nothing here may position itself.
 */
describe('the search pane', () => {
  const src = readFileSync(fileURLToPath(new URL('./SearchPanel.tsx', import.meta.url)), 'utf8')

  it('is pane parts, not a surface of its own', () => {
    expect(src).not.toMatch(/className="[^"]*searchpanel/)
    expect(src).not.toMatch(/<aside/)
    expect(src).toContain('className="panesearch sr-field"')
    expect(src).toContain('className="panebody"')
    expect(src).toContain('className="panefoot sr-foot"')
  })

  it('does not draw its own close control — the rail button is the toggle', () => {
    expect(src).not.toMatch(/Close search/)
  })
})

describe('currentFirst', () => {
  const hit = (documentId: string, relativePath: string) => ({
    pageId: `${documentId}-p0`, documentId, pageNumber: 0, relativePath,
    snippet: '', snippetSpans: [], spans: [], boxes: null,
  })
  it('moves the open document\'s group to the front and keeps the rest in order', () => {
    const groups = groupHits([hit('a', 'A.pdf'), hit('b', 'B.pdf'), hit('c', 'C.pdf')])
    expect(currentFirst(groups, 'c').map((g) => g.title)).toEqual(['C.pdf', 'A.pdf', 'B.pdf'])
    expect(currentFirst(groups, 'a').map((g) => g.title)).toEqual(['A.pdf', 'B.pdf', 'C.pdf'])
    expect(currentFirst(groups, null).map((g) => g.title)).toEqual(['A.pdf', 'B.pdf', 'C.pdf'])
    expect(currentFirst(groups, 'zzz').map((g) => g.title)).toEqual(['A.pdf', 'B.pdf', 'C.pdf'])
  })
})
