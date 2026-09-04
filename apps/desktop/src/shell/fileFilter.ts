/**
 * Narrowing the files pane.
 *
 * The pane lists every PDF the folder scan found, grouped by folder — and a
 * real bid package is not a handful: the Barclays job catalogs 693 across nine
 * levels. Finding one by scrolling was what the document browser dialog
 * existed to fix, and the dialog's filter is the one thing it had that the
 * pane did not. Same matching as `project/documentFilter.ts`: every term, in
 * any order, against the relative PATH — because a set repeats names across
 * packages and "pkg b a-101" is how you tell three A-101s apart.
 *
 * A folder with no surviving files disappears with them; a group heading
 * over nothing would read as a folder the filter missed.
 */
export interface FilterableFile { name: string; relativePath: string }
export interface FilterableFolder<F extends FilterableFile> { files: F[] }

export function filterFolders<F extends FilterableFile, G extends FilterableFolder<F>>(
  folders: readonly G[],
  query: string,
): G[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...folders]
  const terms = q.split(/\s+/)
  const out: G[] = []
  for (const g of folders) {
    const files = g.files.filter((f) => {
      const hay = `${f.relativePath} ${f.name}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
    if (files.length > 0) out.push({ ...g, files })
  }
  return out
}

/** How many files a folder list holds. */
export function countFiles(folders: ReadonlyArray<{ files: readonly unknown[] }>): number {
  return folders.reduce((n, g) => n + g.files.length, 0)
}
