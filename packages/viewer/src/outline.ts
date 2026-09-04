/**
 * Document outline (PDF bookmarks) and page labels.
 *
 * This is how a 110-sheet bid set becomes a navigable sheet index. PDFium
 * exposes the outline as a linked structure of opaque bookmark handles — first
 * child, next sibling, title, destination — and nothing above that, so the tree
 * is assembled here, PDFium-free and testable in plain Node, exactly like
 * `text.ts` and `geometry.ts`. The worker supplies a thin adapter over the wasm
 * exports; nothing else imports PDFium.
 *
 * Three things this file exists to get right:
 *
 * 1. **The walk must not livelock.** A bookmark's child can point back at an
 *    ancestor. PDFium does not check, it just hands the handle back, and the
 *    walk goes around forever. These exist in the wild, and the worker is
 *    single-threaded: a spinning outline walk hangs every tile queued behind
 *    it, not just the sheet list. So handles are tracked in a Set and the walk
 *    is capped on both node count and depth. It stops and returns what it has.
 *
 * 2. **The terminator is not part of the string.** `FPDFBookmark_GetTitle` and
 *    `FPDF_GetPageLabel` use PDFium's call-twice convention and the byte length
 *    they report INCLUDES the two-byte UTF-16 NUL. Copying `bytes / 2` code
 *    units yields "A-101<NUL>", which prints identically to "A-101" in a
 *    console and renders as a replacement box in a sheet list. See
 *    `readUtf16Out`.
 *
 * 3. **An outline is not automatically a sheet list.** Some sets bookmark every
 *    sheet; some carry a real hierarchical table of contents; some carry six
 *    entries and expect you to page. Those want three different UIs, so the
 *    shape is classified here rather than guessed at by the consumer — see
 *    `classifyOutline`.
 *
 * Cost: the bookmark walk is one pass over a structure with roughly as many
 * nodes as the set has sheets, with no page loads at all — `FPDF_GetPageLabel`
 * takes a page INDEX, not a handle, and reads the page-label number tree out of
 * the catalog. Indexing a document therefore opens no pages and evicts nothing
 * from the page pool. See PRIORITY_INDEX in types.ts for where that puts it.
 */

export interface OutlineNode {
  title: string
  /** 0-based page index, or null when the bookmark has no page destination. */
  page: number | null
  children: OutlineNode[]
}

export type OutlineShape = 'per-sheet' | 'table-of-contents' | 'sparse' | 'none'

export interface DocumentIndex {
  outline: OutlineNode[]
  /** Per page, the PDF page label (e.g. "A-101"), or null when unlabelled. */
  labels: Array<string | null>
  /** How the outline relates to the pages — see `classifyOutline`. */
  shape: OutlineShape
}

/**
 * The minimum PDFium surface indexing needs. Injected so tests need no wasm.
 *
 * Deliberately granular rather than a single `pageOf(bookmark)`: the
 * destination lookup has a fallback path (direct dest, then a GoTo action's
 * dest) that is exactly the kind of thing that rots silently, and it is only
 * testable if the two sources can be driven independently. Handles are opaque
 * numbers and 0 means "none" everywhere, which is also PDFium's convention for
 * the document root when asking for the first top-level bookmark.
 */
export interface OutlineBackend {
  /** FPDFBookmark_GetFirstChild. Pass 0 for the document root. 0 when none. */
  firstChild(bookmark: number): number
  /** FPDFBookmark_GetNextSibling. 0 when none. */
  nextSibling(bookmark: number): number
  /** FPDFBookmark_GetTitle, already decoded and un-terminated. */
  title(bookmark: number): string
  /** FPDFBookmark_GetDest. 0 when the bookmark carries no direct destination. */
  bookmarkDest(bookmark: number): number
  /** FPDFBookmark_GetAction. 0 when none. */
  bookmarkAction(bookmark: number): number
  /** FPDFAction_GetType. */
  actionType(action: number): number
  /** FPDFAction_GetDest. 0 when the action names no destination. */
  actionDest(action: number): number
  /** FPDFDest_GetDestPageIndex. Negative when the destination names no page. */
  destPageIndex(dest: number): number
  /** FPDF_GetPageLabel for a 0-based page index. null when unlabelled. */
  pageLabel(pageIndex: number): string | null
}

// --------------------------------------------------------------- traversal --

/**
 * PDFACTION_GOTO. The only action type whose destination is a page in THIS
 * document — PDFACTION_REMOTEGOTO (2) points into another file and
 * PDFACTION_URI (3) off the machine entirely, and both would otherwise resolve
 * through `FPDFAction_GetDest` to an index that means nothing here.
 */
export const PDFACTION_GOTO = 1

/**
 * Hard ceiling on nodes returned by one walk.
 *
 * Not a performance budget — the cycle guard already terminates a loop the
 * moment it revisits a handle. This is the second line of defence for what the
 * Set cannot see: a generator emitting a genuinely acyclic but absurd outline
 * (every text run on every sheet, say). 10,000 is ~90 bookmarks per sheet on
 * the 110-sheet set, which no legitimate index approaches.
 */
export const MAX_OUTLINE_NODES = 10_000

/**
 * Ceiling on nesting depth.
 *
 * The deepest real construction outline observed is 4 (package > discipline >
 * subsection > sheet). 32 is far past anything meaningful while still bounding
 * the recursion, so a pathological chain cannot exhaust the worker's stack — a
 * stack overflow inside the worker is indistinguishable, from the main thread,
 * from a hang.
 */
export const MAX_OUTLINE_DEPTH = 32

export interface OutlineLimits {
  maxNodes?: number
  maxDepth?: number
}

/**
 * The page a bookmark points at, or null.
 *
 * `FPDFBookmark_GetDest` covers bookmarks whose /Dest is a direct destination.
 * The rest express the same thing as an /A action, which is the shape Acrobat
 * writes by default, so a set that looks unbookmarked under the first call is
 * often fully bookmarked under the second.
 *
 * A negative index is PDFium saying "this destination names no page in this
 * document", not page -1. Returning it verbatim would make it a
 * plausible-looking array index at the call site.
 */
export function resolveBookmarkPage(backend: OutlineBackend, bookmark: number): number | null {
  let dest = backend.bookmarkDest(bookmark)
  if (!dest) {
    const action = backend.bookmarkAction(bookmark)
    if (action && backend.actionType(action) === PDFACTION_GOTO) dest = backend.actionDest(action)
  }
  if (!dest) return null
  const index = backend.destPageIndex(dest)
  return index >= 0 ? index : null
}

/**
 * Walk the bookmark tree into plain data.
 *
 * Every handle the walk has already produced a node for is remembered. A repeat
 * means the outline loops — a child pointing at an ancestor, or a sibling chain
 * closing on itself — and the branch is abandoned there rather than followed.
 * The walk still returns everything collected before the loop: a partial sheet
 * index is worth far more than a hung worker.
 */
export function extractOutline(backend: OutlineBackend, opts: OutlineLimits = {}): OutlineNode[] {
  const maxNodes = opts.maxNodes ?? MAX_OUTLINE_NODES
  const maxDepth = opts.maxDepth ?? MAX_OUTLINE_DEPTH
  const seen = new Set<number>()
  let nodes = 0

  const walk = (parent: number, depth: number): OutlineNode[] => {
    const out: OutlineNode[] = []
    if (depth > maxDepth) return out
    let bm = backend.firstChild(parent)
    while (bm) {
      if (nodes >= maxNodes || seen.has(bm)) break
      seen.add(bm)
      nodes++
      out.push({
        title: backend.title(bm),
        page: resolveBookmarkPage(backend, bm),
        children: walk(bm, depth + 1),
      })
      bm = backend.nextSibling(bm)
    }
    return out
  }

  // Top-level bookmarks are depth 1, so `maxDepth` reads as "levels deep".
  return walk(0, 1)
}

/**
 * Every page's label, indexed by page.
 *
 * Labels are what an estimator actually calls a sheet ("A-101"), and they are
 * NOT the ordinal position — a set with a two-sheet cover commonly labels page
 * index 2 as "A-101". A document with no /PageLabels yields all nulls, which
 * the consumer must be able to tell apart from a document whose labels are
 * empty strings; hence null rather than ''.
 */
export function extractPageLabels(backend: OutlineBackend, pageCount: number): Array<string | null> {
  const out: Array<string | null> = []
  for (let i = 0; i < pageCount; i++) {
    const label = backend.pageLabel(i)
    out.push(label ? label : null)
  }
  return out
}

// ---------------------------------------------------------- classification --

/**
 * How much of the document a per-sheet outline has to reach.
 *
 * A per-sheet outline is one bookmark per drawing, but real sets are never that
 * tidy: cover sheets, index sheets and inserted photo or detail pages routinely
 * go unbookmarked. A 110-sheet package that bookmarks 100 of them is still,
 * unambiguously, a per-sheet outline. 0.8 leaves room for ~22 of those in 110
 * while still refusing a six-entry discipline list.
 *
 * It is applied TWICE — once to the count of entries carrying a destination and
 * once to the count of DISTINCT destination pages. The first test alone is
 * satisfied by 200 bookmarks that all point at page 1, a shape that really
 * occurs (a broken export, or an outline of details that all live on one
 * sheet), and which would otherwise render as a 200-row sheet list.
 */
export const PER_SHEET_COVERAGE = 0.8

/**
 * The other side of "effectively one entry per page": how many destination-
 * carrying entries a per-sheet outline may have PER PAGE before it stops being
 * a sheet list.
 *
 * Coverage alone is a one-sided claim, and it collapses on a short document —
 * 200 detail bookmarks all landing on the single page of a one-page drawing
 * satisfy both coverage tests (that one page IS 100% of the document) and would
 * render as a 200-row sheet list for a one-sheet set. That is the same harm the
 * distinct-page test exists to prevent, arriving from the other direction.
 *
 * 2 rather than something tight because a real per-sheet outline is allowed to
 * carry passengers: section headers with no page, a handful of detail
 * sub-bookmarks under a sheet. 110 sheets plus 30 details is 1.27 and stays a
 * sheet list; 200 entries on one page is 200 and does not.
 */
export const PER_SHEET_MAX_ENTRIES_PER_PAGE = 2

/**
 * "Flat or near-flat", as the fraction of nodes that have children.
 *
 * A pure flat sheet list is 0. A set whose sheets all sit under one "Drawings"
 * folder is 1/111 = 0.009. Ten discipline divisions over 110 sheets is
 * 10/120 = 0.083 — still a sheet list, just grouped, and rendering it flat with
 * the bookmark titles as sheet titles is the right answer. A genuine
 * multi-level table of contents runs 0.25 and up, because interior nodes
 * accumulate at every level rather than only at the top. 0.2 sits in the empty
 * band between those two populations.
 */
export const NEAR_FLAT_INTERIOR_RATIO = 0.2

export interface OutlineSummary {
  /** Total nodes, at every level. */
  nodes: number
  /** Nodes with at least one child. */
  interior: number
  /** Nodes carrying a page destination. */
  withPage: number
  /** How many different pages those destinations name. */
  distinctPages: number
}

export function summarizeOutline(outline: readonly OutlineNode[]): OutlineSummary {
  let nodes = 0
  let interior = 0
  let withPage = 0
  const pages = new Set<number>()
  const visit = (list: readonly OutlineNode[]) => {
    for (const n of list) {
      nodes++
      if (n.page !== null) {
        withPage++
        pages.add(n.page)
      }
      if (n.children.length > 0) {
        interior++
        visit(n.children)
      }
    }
  }
  visit(outline)
  return { nodes, interior, withPage, distinctPages: pages.size }
}

/**
 * Decide what the outline IS, so the consumer knows what to draw.
 *
 * The product question behind this: some sets express their table of contents
 * as an inline TOC sheet and bookmark every drawing, others express it as the
 * bookmark tree itself. Those need different UIs, and picking wrong is worse
 * than showing nothing — a 200-row flat list for a set whose outline covers six
 * pages reads as a corrupt document.
 *
 * Coverage decides before shape does. That is deliberate: a two-level outline
 * that still reaches ~every page (divisions with every sheet under them) is a
 * sheet list with grouping, and flattening it loses nothing the consumer needs.
 * A hierarchy that reaches only a fraction of the pages is the real TOC case,
 * because the pages it does NOT name still have to be reachable some other way.
 *
 * Anything else — an outline neither broad enough to be a sheet list nor shaped
 * like a TOC — falls to 'sparse', whose UI (pages flat, outline as a jump list)
 * is the one that is never actively wrong.
 */
export function classifyOutline(outline: readonly OutlineNode[], pageCount: number): OutlineShape {
  const s = summarizeOutline(outline)
  if (s.nodes === 0) return 'none'
  // An outline against no pages says nothing about coverage, and a jump list is
  // the honest render of "we cannot tell".
  if (pageCount <= 0) return 'sparse'

  const needed = PER_SHEET_COVERAGE * pageCount
  const nearFlat = s.interior <= NEAR_FLAT_INTERIOR_RATIO * s.nodes
  const notRedundant = s.withPage <= PER_SHEET_MAX_ENTRIES_PER_PAGE * pageCount
  if (nearFlat && notRedundant && s.withPage >= needed && s.distinctPages >= needed) return 'per-sheet'
  if (s.interior > 0 && s.distinctPages < needed) return 'table-of-contents'
  return 'sparse'
}

/** Outline, labels and shape in one pass. What the worker's `index` job runs. */
export function extractDocumentIndex(
  backend: OutlineBackend,
  pageCount: number,
  opts: OutlineLimits = {},
): DocumentIndex {
  const outline = extractOutline(backend, opts)
  return {
    outline,
    labels: extractPageLabels(backend, pageCount),
    shape: classifyOutline(outline, pageCount),
  }
}

// ------------------------------------------------------------ pdfium glue --

/** The wasm memory surface `readUtf16Out` needs, and nothing else. */
export interface WasmStrings {
  pdfium: {
    HEAPU8: Uint8Array
    wasmExports: { malloc(size: number): number; free?(ptr: number): void }
  }
}

export interface PdfiumOutlineLike extends WasmStrings {
  FPDFBookmark_GetFirstChild(doc: number, bookmark: number): number
  FPDFBookmark_GetNextSibling(doc: number, bookmark: number): number
  FPDFBookmark_GetTitle(bookmark: number, buffer: number, buflen: number): number
  FPDFBookmark_GetDest(doc: number, bookmark: number): number
  FPDFBookmark_GetAction(bookmark: number): number
  FPDFAction_GetType(action: number): number
  FPDFAction_GetDest(doc: number, action: number): number
  FPDFDest_GetDestPageIndex(doc: number, dest: number): number
  FPDF_GetPageLabel(doc: number, pageIndex: number, buffer: number, buflen: number): number
}

/**
 * Read one of PDFium's UTF-16LE string out-parameters.
 *
 * The call-twice contract: with a null buffer the call returns the number of
 * BYTES it would write, and that count INCLUDES the two-byte NUL terminator. So
 * `bytes >> 1` is one code unit too many, and copying it appends a U+0000 to
 * every title — invisible in a console, fatal to an `===` against the label it
 * should equal, and a replacement box in the sheet list. The terminator is
 * subtracted here, once; any further trailing NULs (PDFium pads when the buffer
 * is longer than the string) go with it.
 *
 * `bytes <= 2` is either no such string (0) or the empty string (terminator
 * only). Both are '' and neither is worth an allocation.
 *
 * The heap view is fetched AFTER the write and never cached: malloc can grow
 * the wasm heap and a view taken earlier would be detached. Reading byte-wise
 * rather than through HEAPU16 also stays correct however the allocator aligns
 * the buffer.
 */
export function readUtf16Out(
  module: WasmStrings,
  write: (buffer: number, buflen: number) => number,
): string {
  const bytes = write(0, 0)
  if (bytes <= 2) return ''
  const ptr = module.pdfium.wasmExports.malloc(bytes)
  if (!ptr) return ''
  try {
    const written = Math.min(write(ptr, bytes), bytes)
    const units = Math.max(0, (written >> 1) - 1)
    const heap = module.pdfium.HEAPU8
    let out = ''
    for (let i = 0; i < units; i++) {
      out += String.fromCharCode((heap[ptr + 2 * i] ?? 0) | ((heap[ptr + 2 * i + 1] ?? 0) << 8))
    }
    return out.replace(/\u0000+$/, '')
  } finally {
    module.pdfium.wasmExports.free?.(ptr)
  }
}

/**
 * Bind an `OutlineBackend` to a live PDFium module and open document.
 *
 * Unlike the geometry and text backends there is no reused scratch allocation:
 * the two string calls need a buffer sized to the string, and a document's
 * worth of them is a few hundred short-lived mallocs rather than the hundreds
 * of thousands a segment walk would make.
 */
export function createPdfiumOutlineBackend(m: PdfiumOutlineLike, doc: number): OutlineBackend {
  return {
    firstChild: (bm) => m.FPDFBookmark_GetFirstChild(doc, bm) || 0,
    nextSibling: (bm) => m.FPDFBookmark_GetNextSibling(doc, bm) || 0,
    title: (bm) => readUtf16Out(m, (buf, len) => m.FPDFBookmark_GetTitle(bm, buf, len)),
    bookmarkDest: (bm) => m.FPDFBookmark_GetDest(doc, bm) || 0,
    bookmarkAction: (bm) => m.FPDFBookmark_GetAction(bm) || 0,
    actionType: (a) => m.FPDFAction_GetType(a),
    actionDest: (a) => m.FPDFAction_GetDest(doc, a) || 0,
    destPageIndex: (d) => m.FPDFDest_GetDestPageIndex(doc, d),
    pageLabel: (i) => readUtf16Out(m, (buf, len) => m.FPDF_GetPageLabel(doc, i, buf, len)) || null,
  }
}
