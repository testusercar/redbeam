import { describe, expect, it } from 'vitest'
import { countFiles, filterFolders } from './fileFilter.js'

const FOLDERS = [
  {
    name: 'pkg a',
    files: [
      { id: '1', name: 'A-101.pdf', relativePath: 'pkg a/A-101.pdf' },
      { id: '2', name: 'A-102.pdf', relativePath: 'pkg a/A-102.pdf' },
    ],
  },
  {
    name: 'pkg b',
    files: [{ id: '3', name: 'A-101.pdf', relativePath: 'pkg b/A-101.pdf' }],
  },
]

describe('filterFolders', () => {
  it('is everything for an empty query', () => {
    expect(countFiles(filterFolders(FOLDERS, '  '))).toBe(3)
  })

  /**
   * A drawing set repeats names across packages — three folders each holding
   * an A-101 is normal — so the folder is part of what a term can match.
   */
  it('matches on the path, so a folder term tells repeated names apart', () => {
    const out = filterFolders(FOLDERS, 'pkg b a-101')
    expect(out.map((g) => g.name)).toEqual(['pkg b'])
    expect(out[0]?.files.map((f) => f.id)).toEqual(['3'])
  })

  it('takes terms in any order, case-insensitively', () => {
    expect(countFiles(filterFolders(FOLDERS, 'A-101 PKG'))).toBe(2)
  })

  /** A heading over nothing would read as a folder the filter missed. */
  it('drops a folder whose files all fell out', () => {
    expect(filterFolders(FOLDERS, '102').map((g) => g.name)).toEqual(['pkg a'])
  })

  it('does not treat the query as a regex', () => {
    expect(() => filterFolders(FOLDERS, '(a-1')).not.toThrow()
    expect(countFiles(filterFolders(FOLDERS, '.pdf'))).toBe(3)
  })

  /*
   * The three below came from `project/DocumentBrowser.test.ts`, which covered
   * the dialog's filter. The dialog is gone and the pane's filter replaced it
   * with the same matching rule, so the cases move rather than disappear —
   * losing them silently is how a behaviour someone deliberately pinned gets
   * "fixed" by the next person. Its row-cap case did NOT move: the pane renders
   * every match, so there is no cap that could report a smaller number than
   * matched, which is the only thing that test was protecting.
   */

  it('lets a one-letter term match broadly, as AND-of-substrings implies', () => {
    // 'a' appears in 'pkg a' and in every A-101/A-102 name, so "pkg a" keeps
    // all three. Narrowing is what typing more is for, and treating short
    // terms specially would make the filter unpredictable. Pinned so nobody
    // turns it into prefix matching.
    expect(countFiles(filterFolders(FOLDERS, 'pkg a'))).toBe(3)
    expect(countFiles(filterFolders(FOLDERS, 'pkg a 102'))).toBe(1)
  })

  it('handles the deep, space-heavy paths real client folders actually use', () => {
    const deep = [{
      name: 'Digital Drawing Set',
      files: [{
        id: 'd1',
        name: 'A-101 Reflected Ceiling Plan.pdf',
        relativePath: '2025 Client Bid/Digital Drawing Set/A-101 Reflected Ceiling Plan.pdf',
      }],
    }]
    expect(countFiles(filterFolders(deep, 'digital drawing'))).toBe(1)
    expect(countFiles(filterFolders(deep, 'client bid ceiling'))).toBe(1)
  })

  it('stays responsive on a real-sized corpus', () => {
    // The Barclays job catalogs 693 PDFs across nine levels, and this runs on
    // every keystroke in the pane's filter box.
    const big = Array.from({ length: 9 }, (_, g) => ({
      name: `PKG ${g}`,
      files: Array.from({ length: 77 }, (_, i) => ({
        id: `${g}-${i}`,
        name: `A-${100 + i}.pdf`,
        relativePath: `PKG ${g}/Arch/A-${100 + i}.pdf`,
      })),
    }))
    const started = performance.now()
    const hits = filterFolders(big, 'a-1')
    expect(countFiles(hits)).toBeGreaterThan(0)
    expect(performance.now() - started).toBeLessThan(50)
  })
})
