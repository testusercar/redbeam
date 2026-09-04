/**
 * The project's documents as the tree they are on disk.
 *
 * The Files pane grouped documents under ONE level of folder — first by the
 * top path segment, then by the deepest folder every document shared — and
 * either way a real bid package came out flat: 693 documents under `1 Data`
 * in a single list, with the folders that actually tell a Maxxit set from
 * "Not Used Yet" from "Superseded" thrown away. Aaron: "The folder pane also
 * shows a flat file structure instead of a nested file tree, as expected.
 * This is a catastrophic bug."
 *
 * So: the tree. Every folder on the path is a node, folders sort before
 * files, and the pane decides which nodes are folded. Kept free of React so
 * the shape can be checked without a DOM.
 */

export interface TreeFile {
  id: string
  /** The file name, without its folders. */
  name: string
  relativePath: string
  /** A qualifier for the row — "Page 3 of 12", "not found" — or ''. */
  detail: string
  missing?: boolean
}

export interface TreeFolder {
  /** Forward-slashed path from the project root; '' for the root itself. */
  path: string
  name: string
  /** 0 for the root's children. */
  depth: number
  folders: TreeFolder[]
  files: TreeFile[]
  /** Files at any depth below this folder. */
  fileCount: number
}

/** One row the pane draws, in order, once folding has been applied. */
export type TreeRow =
  | { kind: 'folder'; folder: TreeFolder; open: boolean }
  | { kind: 'file'; file: TreeFile; depth: number }

/** Windows-explorer ordering: case-blind, and "A-2" before "A-10". */
const byName = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

function folderNode(path: string, name: string, depth: number): TreeFolder {
  return { path, name, depth, folders: [], files: [], fileCount: 0 }
}

/** Build the tree. The root has path '' and depth -1; its children are depth 0. */
export function buildFileTree(files: readonly TreeFile[]): TreeFolder {
  const root = folderNode('', '', -1)
  const byPath = new Map<string, TreeFolder>([['', root]])

  for (const f of files) {
    const segments = f.relativePath.split('/').filter((s) => s !== '')
    segments.pop() // the file itself
    let parent = root
    let path = ''
    for (const segment of segments) {
      path = path === '' ? segment : `${path}/${segment}`
      let node = byPath.get(path)
      if (node === undefined) {
        node = folderNode(path, segment, parent.depth + 1)
        byPath.set(path, node)
        parent.folders.push(node)
      }
      parent = node
    }
    parent.files.push(f)
  }

  const finish = (node: TreeFolder): number => {
    node.folders.sort((a, b) => byName(a.name, b.name))
    node.files.sort((a, b) => byName(a.name, b.name))
    node.fileCount = node.files.length + node.folders.reduce((n, c) => n + finish(c), 0)
    return node.fileCount
  }
  finish(root)
  return root
}

/**
 * The tree narrowed to the files matching a query.
 *
 * Every whitespace-separated token has to appear somewhere in the file's
 * path — its folders count, so "maxxit rcp" finds the reflected ceiling plan
 * under the Maxxit folder. Folders with no surviving file are dropped; a
 * matching file keeps its whole ancestry so it is still shown where it lives.
 */
export function filterFileTree(root: TreeFolder, query: string): TreeFolder {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter((t) => t !== '')
  if (tokens.length === 0) return root
  const keep = (f: TreeFile): boolean => {
    const hay = f.relativePath.toLowerCase()
    return tokens.every((t) => hay.includes(t))
  }
  const prune = (node: TreeFolder): TreeFolder | null => {
    const folders = node.folders.map(prune).filter((c): c is TreeFolder => c !== null)
    const files = node.files.filter(keep)
    if (folders.length === 0 && files.length === 0 && node.depth >= 0) return null
    const fileCount = files.length + folders.reduce((n, c) => n + c.fileCount, 0)
    return { ...node, folders, files, fileCount }
  }
  return prune(root) ?? folderNode('', '', -1)
}

/** Every file in the tree, in display order. */
export function treeFiles(root: TreeFolder): TreeFile[] {
  const out: TreeFile[] = []
  const walk = (node: TreeFolder) => {
    for (const c of node.folders) walk(c)
    out.push(...node.files)
  }
  walk(root)
  return out
}

/**
 * The rows to draw, honouring which folders are folded.
 *
 * Folders come before files at every level, the way Explorer lists them. A
 * folded folder contributes its own row and nothing beneath it.
 */
export function treeRows(root: TreeFolder, folded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (node: TreeFolder) => {
    for (const c of node.folders) {
      const open = !folded.has(c.path)
      rows.push({ kind: 'folder', folder: c, open })
      if (open) walk(c)
    }
    for (const f of node.files) rows.push({ kind: 'file', file: f, depth: node.depth + 1 })
  }
  walk(root)
  return rows
}

/** Every folder path in the tree, for "collapse all". */
export function treeFolderPaths(root: TreeFolder): string[] {
  const out: string[] = []
  const walk = (node: TreeFolder) => {
    for (const c of node.folders) { out.push(c.path); walk(c) }
  }
  walk(root)
  return out
}
