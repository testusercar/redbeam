/**
 * The search pane's pure parts, and the one structural fact about it that
 * matters: it is a rail pane, not a second sidebar.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SearchHit } from '@redbeam/store'
import { describe, expect, it } from 'vitest'
import { groupHits } from './SearchPanel.js'

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
    expect(groups.map((g) => g.name)).toEqual(['SPEC.pdf', 'AE6.pdf'])
    expect(groups[1]!.hits.map((h) => h.pageNumber)).toEqual([5, 7])
    expect(groups[0]!.hits.map((h) => h.pageNumber)).toEqual([40, 41])
  })

  it('names a group by the file alone — the folder is the group head one level up', () => {
    expect(groupHits([hit('a/b/c/SET.pdf', 0)])[0]!.name).toBe('SET.pdf')
    expect(groupHits([hit('SET.pdf', 0)])[0]!.name).toBe('SET.pdf')
  })

  it('is empty for no hits', () => {
    expect(groupHits([])).toEqual([])
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
    expect(src).toContain('className="panesearch"')
    expect(src).toContain('className="panebody"')
    expect(src).toContain('className="panefoot"')
  })

  it('does not draw its own close control — the rail button is the toggle', () => {
    expect(src).not.toMatch(/Close search/)
  })
})
