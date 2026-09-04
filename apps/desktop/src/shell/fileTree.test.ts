import { describe, expect, it } from 'vitest'
import {
  buildFileTree, filterFileTree, treeFiles, treeFolderPaths, treeRows, type TreeFile,
} from './fileTree.js'

const file = (relativePath: string, id = relativePath): TreeFile => ({
  id, name: relativePath.split('/').pop() ?? relativePath, relativePath, detail: '',
})

/** A slice of a real bid package: one top-level folder, everything under it. */
const PACKAGE: TreeFile[] = [
  file('1 Data/260505 - Files from Client/Bid Form.pdf'),
  file('1 Data/260505 - Files from Client/Maxxit/A-101 RCP.pdf'),
  file('1 Data/260505 - Files from Client/Maxxit/A-2 RCP.pdf'),
  file('1 Data/260505 - Files from Client/Maxxit/A-10 RCP.pdf'),
  file('1 Data/260505 - Files from Client/Not Used Yet/M-001.pdf'),
  file('1 Data/Superseded/A-101 RCP.pdf', 'old'),
  file('README.pdf'),
]

describe('buildFileTree', () => {
  it('keeps every folder on the path, not one level of grouping', () => {
    const root = buildFileTree(PACKAGE)
    expect(root.folders.map((f) => f.name)).toEqual(['1 Data'])
    const data = root.folders[0]!
    expect(data.folders.map((f) => f.name)).toEqual(['260505 - Files from Client', 'Superseded'])
    const client = data.folders[0]!
    expect(client.folders.map((f) => f.name)).toEqual(['Maxxit', 'Not Used Yet'])
    expect(client.files.map((f) => f.name)).toEqual(['Bid Form.pdf'])
  })

  it('counts files at every depth below a folder', () => {
    const root = buildFileTree(PACKAGE)
    expect(root.fileCount).toBe(7)
    expect(root.folders[0]!.fileCount).toBe(6)
    expect(root.folders[0]!.folders[0]!.fileCount).toBe(5)
  })

  it('puts root files on the root and gives folders their depth', () => {
    const root = buildFileTree(PACKAGE)
    expect(root.files.map((f) => f.name)).toEqual(['README.pdf'])
    expect(root.depth).toBe(-1)
    expect(root.folders[0]!.depth).toBe(0)
    expect(root.folders[0]!.folders[0]!.folders[0]!.depth).toBe(2)
  })

  it('sorts like Explorer: numerically, case-blind', () => {
    const maxxit = buildFileTree(PACKAGE).folders[0]!.folders[0]!.folders[0]!
    expect(maxxit.files.map((f) => f.name)).toEqual(['A-2 RCP.pdf', 'A-10 RCP.pdf', 'A-101 RCP.pdf'])
  })

  it('is empty, not broken, with no documents', () => {
    const root = buildFileTree([])
    expect(root.folders).toEqual([])
    expect(root.files).toEqual([])
    expect(root.fileCount).toBe(0)
    expect(treeRows(root, new Set())).toEqual([])
  })
})

describe('treeRows', () => {
  it('lists folders before files at each level, in tree order', () => {
    const rows = treeRows(buildFileTree(PACKAGE), new Set())
    const names = rows.map((r) => (r.kind === 'folder' ? `[${r.folder.name}]` : r.file.name))
    expect(names).toEqual([
      '[1 Data]', '[260505 - Files from Client]', '[Maxxit]',
      'A-2 RCP.pdf', 'A-10 RCP.pdf', 'A-101 RCP.pdf',
      '[Not Used Yet]', 'M-001.pdf', 'Bid Form.pdf',
      '[Superseded]', 'A-101 RCP.pdf', 'README.pdf',
    ])
  })

  it('hides everything under a folded folder and says the folder is closed', () => {
    const rows = treeRows(buildFileTree(PACKAGE), new Set(['1 Data/260505 - Files from Client']))
    const names = rows.map((r) => (r.kind === 'folder' ? `[${r.folder.name}]` : r.file.name))
    expect(names).toEqual(['[1 Data]', '[260505 - Files from Client]', '[Superseded]', 'A-101 RCP.pdf', 'README.pdf'])
    const client = rows[1]
    expect(client?.kind === 'folder' && client.open).toBe(false)
  })

  it('gives a file row the depth of its folder plus one', () => {
    const rows = treeRows(buildFileTree(PACKAGE), new Set())
    const readme = rows.find((r) => r.kind === 'file' && r.file.name === 'README.pdf')
    expect(readme?.kind === 'file' && readme.depth).toBe(0)
    const a2 = rows.find((r) => r.kind === 'file' && r.file.name === 'A-2 RCP.pdf')
    expect(a2?.kind === 'file' && a2.depth).toBe(3)
  })
})

describe('filterFileTree', () => {
  it('matches every token against the whole path, folders included', () => {
    const narrowed = filterFileTree(buildFileTree(PACKAGE), 'maxxit a-101')
    expect(treeFiles(narrowed).map((f) => f.relativePath)).toEqual([
      '1 Data/260505 - Files from Client/Maxxit/A-101 RCP.pdf',
    ])
  })

  it('keeps the ancestry of a match and drops empty folders', () => {
    const narrowed = filterFileTree(buildFileTree(PACKAGE), 'm-001')
    expect(treeFolderPaths(narrowed)).toEqual([
      '1 Data', '1 Data/260505 - Files from Client', '1 Data/260505 - Files from Client/Not Used Yet',
    ])
    expect(narrowed.fileCount).toBe(1)
  })

  it('returns the tree untouched for a blank query', () => {
    const root = buildFileTree(PACKAGE)
    expect(filterFileTree(root, '   ')).toBe(root)
  })

  it('yields an empty root when nothing matches', () => {
    const narrowed = filterFileTree(buildFileTree(PACKAGE), 'zzz')
    expect(narrowed.fileCount).toBe(0)
    expect(treeRows(narrowed, new Set())).toEqual([])
  })
})
