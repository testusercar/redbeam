/**
 * Turning a PDF's index — whatever form it took — into sheet rows.
 *
 * A drawing set says what its sheets are in one of three ways, and which one
 * you get depends on who published the set, not on anything the estimator
 * chose:
 *
 *   - a bookmark per sheet, titled `AE6-01-02 ARCHITECTURAL CEILING PLAN`
 *   - a real hierarchical table of contents: divisions, sheets underneath
 *   - nothing at all, or a handful of section bookmarks over 110 pages
 *
 * The Qt build exposed the first two as separate sidebar tabs called Contents
 * and Bookmarks, because Okular did. They are the same question — "what sheet
 * am I looking at and where are the others" — and an estimator should not have
 * to know which tab their publisher's export happened to populate. So there is
 * one panel, and the discrimination happens here.
 *
 * `shape` is decided in the viewer package (`classifyOutline`), which can see
 * the whole outline against the page count. This module only renders the
 * consequences.
 */

export interface SheetOutlineNode {
  title: string
  /** 0-based page index, or null when the entry has no page destination. */
  page: number | null
  children: SheetOutlineNode[]
}

export type SheetIndexShape = 'per-sheet' | 'table-of-contents' | 'sparse' | 'none'

/** A scope with at least one markup on a given sheet — enough to draw its dot. */
export interface SheetScope {
  id: string
  label: string
  /** The estimator's own colour for the scope: data, not palette. */
  color: string
}

export interface SheetRow {
  /** 0-based page index. */
  page: number
  /** The sheet code — `AE6-01-02`, `A-101`, or `Page 40` when there is none. */
  number: string
  /** The sheet name, empty when the source carries only a code. */
  title: string
  /** True when this page carries at least one markup. */
  hasTakeoff: boolean
  /**
   * The scopes drawn on this sheet, in the caller's order.
   *
   * Empty is not the same as `hasTakeoff: false`: a markup that belongs to no
   * scope still counts as takeoff, and the row has to be able to say "there is
   * something here" without being able to say what colour it is.
   */
  scopes: SheetScope[]
}

export interface SheetGroup {
  /** Null for the flat, ungrouped case. */
  label: string | null
  rows: SheetRow[]
}

export interface SheetIndexInput {
  pageCount: number
  shape: SheetIndexShape
  outline: SheetOutlineNode[]
  /** PDF page labels, indexed by page. */
  labels: Array<string | null>
  /** Page indices carrying markups. */
  takeoffPages: ReadonlySet<number>
  /**
   * The scopes with markups on each page, keyed by page index.
   *
   * Optional because the index is useful with only `takeoffPages` — the
   * harness and the tests build it that way — but when it is given, every
   * page in it is also treated as carrying takeoff, so the two can never
   * disagree about whether a sheet has anything on it.
   */
  pageScopes?: ReadonlyMap<number, ReadonlyArray<SheetScope>>
}

/**
 * Split `AE6-01-02 ARCHITECTURAL CEILING PLAN` into its code and its name.
 *
 * A sheet code is the leading run of upper-case letters, digits, dots and
 * hyphens with no spaces in it — that is what every drawing standard produces
 * and it is why the split can be mechanical rather than configured. Anything
 * that does not look like a code is treated as all title, which is the right
 * answer for `Cover Sheet` and for the section headings in a table of
 * contents.
 *
 * The code must be at least two characters and contain a digit or a hyphen: a
 * bare leading `A` in `A Very Long Title` is a word, not a sheet number.
 */
const SHEET_CODE = /^([A-Z0-9][A-Z0-9.\-/]*)(?:\s+[-–—]?\s*(.*))?$/

export function splitSheetTitle(raw: string): { number: string; title: string } {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text === '') return { number: '', title: '' }
  const m = SHEET_CODE.exec(text)
  const code = m?.[1]
  if (code === undefined || code.length < 2 || !/[\d\-]/.test(code)) {
    return { number: text, title: '' }
  }
  return { number: code, title: (m?.[2] ?? '').trim() }
}

/** Depth-first walk, parents before children. */
function walk(nodes: SheetOutlineNode[], visit: (n: SheetOutlineNode, depth: number) => void, depth = 0): void {
  for (const n of nodes) {
    visit(n, depth)
    if (n.children.length > 0) walk(n.children, visit, depth + 1)
  }
}

/** What a page carries: the takeoff flag and the scopes behind it, reconciled. */
function markingsOf(page: number, input: SheetIndexInput): Pick<SheetRow, 'hasTakeoff' | 'scopes'> {
  const scopes = [...(input.pageScopes?.get(page) ?? [])]
  return { hasTakeoff: input.takeoffPages.has(page) || scopes.length > 0, scopes }
}

function fallbackRow(page: number, input: SheetIndexInput): SheetRow {
  const label = input.labels[page] ?? null
  return {
    page,
    // A page label is the publisher's own name for the page and beats our
    // ordinal. When there is none, `Page 40` is honest — inventing `A-040`
    // would look like a sheet number that nothing in the document supports.
    number: label !== null && label.trim() !== '' ? label.trim() : `Page ${page + 1}`,
    title: '',
    ...markingsOf(page, input),
  }
}

/**
 * The rows and groups the panel renders.
 *
 * Every page in the document appears exactly once, in page order, whatever the
 * outline looks like. That is the invariant worth holding: an index that can
 * silently omit a sheet is worse than no index, because the sheet it drops is
 * one nobody will think to look for.
 */
export function buildSheetIndex(input: SheetIndexInput): SheetGroup[] {
  const { pageCount, shape, outline } = input
  if (pageCount <= 0) return []

  if (shape === 'none' || shape === 'sparse') {
    // A sparse outline is section markers, not a sheet list. Showing the pages
    // flat and ignoring the sections is deliberate: five bookmarks over 110
    // sheets grouped into five buckets of twenty is not navigation, it is a
    // second scroll.
    const rows: SheetRow[] = []
    for (let i = 0; i < pageCount; i++) rows.push(fallbackRow(i, input))
    return [{ label: null, rows }]
  }

  // Best title per page, first entry wins — an outline that points two
  // bookmarks at one page names it by the first, which matches reading order.
  const titleFor = new Map<number, string>()
  walk(outline, (n) => {
    if (n.page === null || n.page < 0 || n.page >= pageCount) return
    if (!titleFor.has(n.page)) titleFor.set(n.page, n.title)
  })

  const rowFor = (page: number): SheetRow => {
    const t = titleFor.get(page)
    if (t === undefined) return fallbackRow(page, input)
    const split = splitSheetTitle(t)
    if (split.number === '') return fallbackRow(page, input)
    return { page, number: split.number, title: split.title, ...markingsOf(page, input) }
  }

  if (shape === 'per-sheet') {
    const rows: SheetRow[] = []
    for (let i = 0; i < pageCount; i++) rows.push(rowFor(i))
    return [{ label: null, rows }]
  }

  // table-of-contents: top-level entries become groups, and a page belongs to
  // the last group that starts at or before it. Ranges are derived from start
  // pages rather than trusted from the outline, because an outline is free to
  // list a division whose children are out of order and a mis-assigned sheet
  // is worse than a coarse group.
  const tops = outline
    .map((n) => ({ node: n, start: firstPage(n) }))
    .filter((t): t is { node: SheetOutlineNode; start: number } => t.start !== null)
    .sort((a, b) => a.start - b.start)

  if (tops.length === 0) {
    const rows: SheetRow[] = []
    for (let i = 0; i < pageCount; i++) rows.push(rowFor(i))
    return [{ label: null, rows }]
  }

  const groups: SheetGroup[] = []
  // Pages before the first group's start still have to go somewhere.
  if (tops[0]!.start > 0) {
    const rows: SheetRow[] = []
    for (let i = 0; i < tops[0]!.start; i++) rows.push(rowFor(i))
    groups.push({ label: 'Front matter', rows })
  }
  for (let g = 0; g < tops.length; g++) {
    const start = tops[g]!.start
    const end = g + 1 < tops.length ? tops[g + 1]!.start : pageCount
    const rows: SheetRow[] = []
    for (let i = start; i < end; i++) rows.push(rowFor(i))
    if (rows.length > 0) groups.push({ label: splitSheetTitle(tops[g]!.node.title).number || tops[g]!.node.title, rows })
  }
  return groups
}

/** The earliest page any entry in this subtree points at. */
function firstPage(node: SheetOutlineNode): number | null {
  let best: number | null = node.page !== null && node.page >= 0 ? node.page : null
  walk(node.children, (n) => {
    if (n.page === null || n.page < 0) return
    if (best === null || n.page < best) best = n.page
  })
  return best
}

/** Scope dots a sheet row draws before it counts the rest. */
export const SHEET_DOT_CAP = 5

/**
 * Which scope dots a row draws, and how many it says instead.
 *
 * A row is one line and the page number on its right edge must not move, so
 * the dots have a budget. Up to the cap every scope gets its dot. Past it the
 * row shows one FEWER than the cap plus a count — so a row over the cap is
 * never wider than a row at it, and the count is never "+1", which would be a
 * count spending more room than the dot it replaces.
 */
export function sheetDots(scopes: ReadonlyArray<SheetScope>): { shown: SheetScope[]; more: number } {
  if (scopes.length <= SHEET_DOT_CAP) return { shown: [...scopes], more: 0 }
  const shown = scopes.slice(0, SHEET_DOT_CAP - 1)
  return { shown, more: scopes.length - shown.length }
}

/** Case-insensitive match against the sheet code and the sheet name. */
export function filterSheets(groups: SheetGroup[], query: string): SheetGroup[] {
  const q = query.trim().toLowerCase()
  if (q === '') return groups
  return groups
    .map((g) => ({
      label: g.label,
      rows: g.rows.filter((r) =>
        r.number.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)),
    }))
    .filter((g) => g.rows.length > 0)
}

/**
 * The sheet code and name, read off the sheet itself.
 *
 * A published set usually says what its sheets are in its outline or its page
 * labels. Plenty say it in neither — the information is printed in the title
 * block and nowhere else — and for those the index could only count pages.
 * "Page 14" is not a sheet name, and navigating a 110-sheet set by ordinal is
 * doing the publisher's filing by hand.
 *
 * THE RULE: a line that is nothing but a sheet code, followed by a line that
 * reads as a sheet name.
 *
 * The first thing I tried was "the last code-shaped token on the page", on the
 * theory that a title block sits at the end of the text order. Checked against
 * a real set it labelled a sheet `R2`, because the revision history prints
 * `R2 2024 1220 ISSUE FOR 100% BID` after the title block, and a postal code
 * (`M5J`) and a level marker (`L46`) match a code pattern just as well. What
 * actually distinguishes a sheet number is that it sits ALONE on its line with
 * its name underneath:
 *
 *     A00.02
 *     CODE COMPLIANCE PLAN - LEVEL 47
 *
 * A revision, an address and a scale are all embedded in a longer line, so
 * requiring the whole line rules them out without needing to enumerate them.
 *
 * Conservative on purpose. Returning null and letting the row say "Page 14" is
 * honest; a wrong sheet name is worse than none, because a takeoff filed
 * against the wrong sheet is not visibly wrong.
 */

/** A whole line that is only a sheet code: letters, then digits, ≤ 12 chars. */
const CODE_LINE = /^[A-Z]{1,3}[-.]?\d{1,3}(?:[-.][0-9A-Z]{1,4})?[A-Z]?$/

/** A line that reads as a sheet NAME: mostly capitals, and not another code. */
function looksLikeName(line: string): boolean {
  if (line.length < 4 || line.length > 70) return false
  if (CODE_LINE.test(line)) return false
  // A name is words. A row of digits is a project number or a date.
  if (!/[A-Z]{3}/.test(line)) return false
  return !/^\d/.test(line)
}

export function sheetFromText(text: string): { number: string, title: string } | null {
  if (text.trim() === '') return null
  const lines = text.split(/\r?\n/).map((l) => l.trim())

  /*
   * A code ALONE is not enough — it has to be introducing a name.
   *
   * Revision clouds stamp `R2` on its own line, once per cloud, and a sheet
   * with seven revisions ends with seven lines that are nothing but `R2`. They
   * pass every test a sheet number passes except the one that matters: the
   * line after them is not a sheet name. Requiring the pair is what separates
   * a title block from every other short code on a drawing.
   *
   * Last pair wins: the title block is late in the text order, and an early
   * code is more likely to be a detail callout.
   */
  let found: { number: string, title: string } | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.length > 12 || !CODE_LINE.test(line)) continue
    const next = lines.slice(i + 1).find((l) => l !== '') ?? ''
    if (!looksLikeName(next)) continue
    found = { number: line, title: next.slice(0, 60) }
  }
  return found
}
