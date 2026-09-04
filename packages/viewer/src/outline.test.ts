import { describe, expect, it } from 'vitest'
import {
  MAX_OUTLINE_DEPTH,
  NEAR_FLAT_INTERIOR_RATIO,
  PDFACTION_GOTO,
  PER_SHEET_COVERAGE,
  PER_SHEET_MAX_ENTRIES_PER_PAGE,
  classifyOutline,
  createPdfiumOutlineBackend,
  extractDocumentIndex,
  extractOutline,
  extractPageLabels,
  readUtf16Out,
  summarizeOutline,
  type OutlineNode,
  type PdfiumOutlineLike,
} from './outline.js'

/** The set this whole feature exists for: the 110-sheet Barclays PKG A package. */
const SHEETS = 110

const NUL = String.fromCharCode(0)

// ------------------------------------------------------------- fake pdfium --

const DOC = 0x100
const ACTION_BASE = 0x2000
const DEST_BASE = 0x4000

/** PDFACTION_URI. Its destination, if it resolved at all, is not our document. */
const PDFACTION_URI = 3

/**
 * A PDFium stand-in with a real byte heap.
 *
 * The heap is real (a Uint8Array and a bump allocator) rather than a mock that
 * hands back JS strings, because the thing most likely to be wrong in this code
 * is the terminator arithmetic on PDFium's call-twice string protocol — and a
 * mock that returns strings cannot express an off-by-one in a byte count.
 *
 * `calls` trips after half a million PDFium calls. A cycle-guard regression
 * would otherwise hang the suite rather than fail it, and a hung test run looks
 * exactly like the bug in production: nothing happens, forever.
 */
class FakeDoc implements PdfiumOutlineLike {
  readonly titles = new Map<number, string>()
  readonly child = new Map<number, number>()
  readonly sibling = new Map<number, number>()
  readonly labels = new Map<number, string>()

  /** bookmark -> its /Dest handle. */
  private readonly destOf = new Map<number, number>()
  /** bookmark -> its /A action type. */
  private readonly actionType = new Map<number, number>()
  /** bookmark -> the dest handle its action resolves to. */
  private readonly actionDestOf = new Map<number, number>()
  /** dest handle -> page index. Negative means "names no page". */
  private readonly dests = new Map<number, number>()

  private nextDest = DEST_BASE
  private brk = 16
  calls = 0

  readonly pdfium = {
    HEAPU8: new Uint8Array(64 * 1024),
    wasmExports: {
      malloc: (n: number): number => {
        const p = this.brk
        this.brk += n + ((8 - (n % 8)) % 8)
        return p
      },
      free: (): void => {},
    },
  }

  // ------------------------------------------------------------- authoring --

  bookmark(handle: number, title: string): this {
    this.titles.set(handle, title)
    return this
  }

  /** Wire `handle`'s first child and next sibling. 0 (or omitted) means none. */
  link(handle: number, opts: { child?: number; sibling?: number }): this {
    if (opts.child !== undefined) this.child.set(handle, opts.child)
    if (opts.sibling !== undefined) this.sibling.set(handle, opts.sibling)
    return this
  }

  /** Give the bookmark a direct /Dest. A negative page is PDFium's "no page". */
  dest(handle: number, page: number): this {
    const d = this.nextDest++
    this.destOf.set(handle, d)
    this.dests.set(d, page)
    return this
  }

  /** Give the bookmark an /A action instead. This is Acrobat's default shape. */
  action(handle: number, type: number, page: number): this {
    const d = this.nextDest++
    this.actionType.set(handle, type)
    this.actionDestOf.set(handle, d)
    this.dests.set(d, page)
    return this
  }

  label(page: number, text: string): this {
    this.labels.set(page, text)
    return this
  }

  // --------------------------------------------------------- pdfium surface --

  private tick() {
    if (++this.calls > 500_000) throw new Error('runaway outline walk: the cycle guard did not hold')
  }

  /**
   * PDFium's call-twice string convention, byte for byte.
   *
   * Returns the length in BYTES INCLUDING the two-byte terminator, and writes
   * only when the caller's buffer is big enough. `pad` makes it advertise a
   * longer buffer than the string needs and fill the slack with NULs, which is
   * what the page-label call does on some documents.
   */
  private stringOut(text: string | undefined, buffer: number, buflen: number, pad = 0): number {
    this.tick()
    if (text === undefined) return 0
    const units = text.length + 1 + pad
    const bytes = units * 2
    if (buffer && buflen >= bytes) {
      const heap = this.pdfium.HEAPU8
      for (let i = 0; i < units; i++) {
        const code = i < text.length ? text.charCodeAt(i) : 0
        heap[buffer + 2 * i] = code & 0xff
        heap[buffer + 2 * i + 1] = code >> 8
      }
    }
    return bytes
  }

  FPDFBookmark_GetFirstChild(doc: number, bookmark: number): number {
    this.tick()
    expect(doc).toBe(DOC)
    return this.child.get(bookmark) ?? 0
  }

  FPDFBookmark_GetNextSibling(doc: number, bookmark: number): number {
    this.tick()
    expect(doc).toBe(DOC)
    return this.sibling.get(bookmark) ?? 0
  }

  FPDFBookmark_GetTitle(bookmark: number, buffer: number, buflen: number): number {
    return this.stringOut(this.titles.get(bookmark), buffer, buflen)
  }

  FPDFBookmark_GetDest(doc: number, bookmark: number): number {
    this.tick()
    return this.destOf.get(bookmark) ?? 0
  }

  FPDFBookmark_GetAction(bookmark: number): number {
    this.tick()
    return this.actionType.has(bookmark) ? ACTION_BASE + bookmark : 0
  }

  FPDFAction_GetType(action: number): number {
    this.tick()
    return this.actionType.get(action - ACTION_BASE) ?? 0
  }

  FPDFAction_GetDest(doc: number, action: number): number {
    this.tick()
    return this.actionDestOf.get(action - ACTION_BASE) ?? 0
  }

  FPDFDest_GetDestPageIndex(doc: number, dest: number): number {
    this.tick()
    return this.dests.get(dest) ?? -1
  }

  FPDF_GetPageLabel(doc: number, pageIndex: number, buffer: number, buflen: number): number {
    // Real page labels come back padded on some documents; exercise that here
    // rather than only the exact-fit case.
    return this.stringOut(this.labels.get(pageIndex), buffer, buflen, 3)
  }
}

const backendOf = (doc: FakeDoc) => createPdfiumOutlineBackend(doc, DOC)

/** A flat sibling chain of `n` bookmarks starting at handle 1, sheet i on page i. */
function flatSet(n: number, opts: { titles?: (i: number) => string } = {}): FakeDoc {
  const d = new FakeDoc()
  const title = opts.titles ?? ((i: number) => `A-${101 + i}`)
  d.link(0, { child: 1 })
  for (let i = 0; i < n; i++) {
    const h = i + 1
    d.bookmark(h, title(i)).dest(h, i)
    if (i + 1 < n) d.link(h, { sibling: h + 1 })
  }
  return d
}

// --------------------------------------------------------- outline builders --

const leaf = (title: string, page: number | null): OutlineNode => ({ title, page, children: [] })
const branch = (title: string, page: number | null, children: OutlineNode[]): OutlineNode => ({
  title,
  page,
  children,
})

/** `n` flat entries, entry i pointing at page i: a set where every sheet was bookmarked. */
const perSheetOutline = (n: number, from = 0): OutlineNode[] =>
  Array.from({ length: n }, (_, i) => leaf(`A-${101 + i}`, from + i))

/** `divisions` groups of `each` sheets, numbered consecutively from page `from`. */
function groupedOutline(divisions: number, each: number, from = 0): OutlineNode[] {
  const out: OutlineNode[] = []
  let page = from
  for (let d = 0; d < divisions; d++) {
    const kids = Array.from({ length: each }, (_, i) => leaf(`sheet ${d}.${i}`, page + i))
    page += each
    out.push(branch(`DIVISION ${d}`, kids[0]?.page ?? null, kids))
  }
  return out
}

const depthOf = (nodes: readonly OutlineNode[]): number =>
  nodes.length === 0 ? 0 : 1 + Math.max(...nodes.map((n) => depthOf(n.children)))

const countNodes = (nodes: readonly OutlineNode[]): number =>
  nodes.reduce((n, x) => n + 1 + countNodes(x.children), 0)

// ================================================================== shapes ==

describe('classifyOutline — none', () => {
  it('is none when there are no entries, whatever the page count', () => {
    expect(classifyOutline([], SHEETS)).toBe('none')
    expect(classifyOutline([], 0)).toBe('none')
  })
})

describe('classifyOutline — per-sheet', () => {
  it('calls a fully bookmarked drawing set per-sheet', () => {
    expect(classifyOutline(perSheetOutline(SHEETS), SHEETS)).toBe('per-sheet')
  })

  it('tolerates the cover and index sheets going unbookmarked', () => {
    // 90 of 110 is 0.818 — above PER_SHEET_COVERAGE, and the common real shape.
    const outline = perSheetOutline(90, 2)
    expect(90 / SHEETS).toBeGreaterThan(PER_SHEET_COVERAGE)
    expect(classifyOutline(outline, SHEETS)).toBe('per-sheet')
  })

  it('refuses an outline that covers well under the threshold', () => {
    // 80 of 110 is 0.727. Not a sheet list; the 30 unbookmarked sheets have to
    // be reachable some other way, which is exactly what 'sparse' tells the UI.
    expect(80 / SHEETS).toBeLessThan(PER_SHEET_COVERAGE)
    expect(classifyOutline(perSheetOutline(80), SHEETS)).toBe('sparse')
  })

  it('holds the threshold exactly where PER_SHEET_COVERAGE puts it', () => {
    const needed = Math.ceil(PER_SHEET_COVERAGE * SHEETS)
    expect(classifyOutline(perSheetOutline(needed), SHEETS)).toBe('per-sheet')
    expect(classifyOutline(perSheetOutline(needed - 1), SHEETS)).toBe('sparse')
  })

  it('survives entries that carry no destination at all', () => {
    // 100 real sheet bookmarks plus 10 section headers with no page. The
    // headers must not count toward coverage, and must not disqualify it.
    const outline = [...perSheetOutline(100), ...Array.from({ length: 10 }, (_, i) => leaf(`NOTE ${i}`, null))]
    const s = summarizeOutline(outline)
    expect(s.nodes).toBe(110)
    expect(s.withPage).toBe(100)
    expect(classifyOutline(outline, SHEETS)).toBe('per-sheet')
  })

  it('is not per-sheet when every entry is destination-less', () => {
    const outline = Array.from({ length: SHEETS }, (_, i) => leaf(`entry ${i}`, null))
    expect(summarizeOutline(outline).withPage).toBe(0)
    expect(classifyOutline(outline, SHEETS)).toBe('sparse')
  })

  it('treats one wrapping folder over every sheet as a sheet list', () => {
    // "Drawings" > 110 sheets. Interior ratio 1/111; flattening loses nothing.
    const outline = [branch('Drawings', null, perSheetOutline(SHEETS))]
    expect(summarizeOutline(outline).interior).toBe(1)
    expect(classifyOutline(outline, SHEETS)).toBe('per-sheet')
  })

  it('treats discipline groups that still cover every sheet as a sheet list', () => {
    // 10 divisions x 11 sheets over a 110-page set. Hierarchical, but it
    // reaches every page, so a flat render with the bookmark titles as sheet
    // titles is complete. Coverage decides before shape does — see
    // classifyOutline's note.
    const outline = groupedOutline(10, 11)
    const s = summarizeOutline(outline)
    expect(s.distinctPages).toBe(SHEETS)
    expect(s.interior / s.nodes).toBeLessThan(NEAR_FLAT_INTERIOR_RATIO)
    expect(classifyOutline(outline, SHEETS)).toBe('per-sheet')
  })
})

describe('classifyOutline — the 200-bookmarks-on-one-page trap', () => {
  it('does not call 200 bookmarks that all point at page 1 a sheet list', () => {
    const outline = Array.from({ length: 200 }, (_, i) => leaf(`DETAIL ${i}`, 1))
    const s = summarizeOutline(outline)
    // The entry count alone would sail past the threshold; the distinct-page
    // count is what stops it, and this is why the ratio is applied twice.
    expect(s.withPage).toBeGreaterThan(PER_SHEET_COVERAGE * SHEETS)
    expect(s.distinctPages).toBe(1)
    expect(classifyOutline(outline, SHEETS)).toBe('sparse')
  })

  it('makes the same call for a one-page document', () => {
    // The distinct-page test cannot save this one: that single page IS 100% of
    // the document. PER_SHEET_MAX_ENTRIES_PER_PAGE is what refuses it.
    expect(classifyOutline(Array.from({ length: 200 }, () => leaf('D', 0)), 1)).toBe('sparse')
  })

  it('still allows a sheet list that carries detail sub-bookmarks', () => {
    // 110 sheets plus 30 details is 1.27 entries per page — a real shape, and
    // the reason the entries-per-page bound is 2 rather than something tight.
    const outline = [...perSheetOutline(SHEETS), ...Array.from({ length: 30 }, (_, i) => leaf(`d${i}`, i))]
    expect(outline.length / SHEETS).toBeLessThan(PER_SHEET_MAX_ENTRIES_PER_PAGE)
    expect(classifyOutline(outline, SHEETS)).toBe('per-sheet')
  })
})

describe('classifyOutline — table-of-contents', () => {
  it('calls divisions-then-sheets over a fraction of the set a TOC', () => {
    // 6 divisions x 5 sheets = 30 destinations in a 110-sheet package. The
    // other 80 sheets exist and are not in the outline: a tree, plus a page
    // list, is the only render that reaches them.
    const outline = groupedOutline(6, 5)
    expect(summarizeOutline(outline).distinctPages).toBeLessThan(PER_SHEET_COVERAGE * SHEETS)
    expect(classifyOutline(outline, SHEETS)).toBe('table-of-contents')
  })

  it('calls a three-level outline over a fraction of the set a TOC', () => {
    const outline = [
      branch('VOLUME 1', null, [branch('ARCHITECTURAL', 4, perSheetOutline(6, 4))]),
      branch('VOLUME 2', null, [branch('STRUCTURAL', 20, perSheetOutline(6, 20))]),
    ]
    expect(depthOf(outline)).toBe(3)
    expect(classifyOutline(outline, SHEETS)).toBe('table-of-contents')
  })

  it('is a TOC even when the division headers themselves carry no page', () => {
    const outline = groupedOutline(6, 5).map((d) => ({ ...d, page: null }))
    expect(summarizeOutline(outline).withPage).toBe(30)
    expect(classifyOutline(outline, SHEETS)).toBe('table-of-contents')
  })

  it('needs hierarchy: the same 30 destinations laid out flat are sparse', () => {
    expect(classifyOutline(perSheetOutline(30), SHEETS)).toBe('sparse')
  })
})

describe('classifyOutline — sparse', () => {
  it('calls a handful of entries against a long document sparse', () => {
    const outline = [
      leaf('COVER', 0),
      leaf('INDEX', 1),
      leaf('ARCHITECTURAL', 4),
      leaf('STRUCTURAL', 60),
      leaf('MECHANICAL', 92),
    ]
    expect(classifyOutline(outline, SHEETS)).toBe('sparse')
  })

  it('falls back to sparse when there are no pages to compare against', () => {
    // Booted with a page count of 0 is a degenerate state, not a shape claim.
    expect(classifyOutline(perSheetOutline(5), 0)).toBe('sparse')
  })
})

// ================================================== extraction over pdfium ==

describe('extractOutline over a fake PDFium', () => {
  it('reads titles, destinations and nesting', () => {
    const d = new FakeDoc()
    d.link(0, { child: 1 })
    d.bookmark(1, 'ARCHITECTURAL').dest(1, 4).link(1, { child: 2, sibling: 4 })
    d.bookmark(2, 'A-101').dest(2, 4).link(2, { sibling: 3 })
    d.bookmark(3, 'A-102').dest(3, 5)
    d.bookmark(4, 'STRUCTURAL').dest(4, 60)

    expect(extractOutline(backendOf(d))).toEqual([
      {
        title: 'ARCHITECTURAL',
        page: 4,
        children: [leaf('A-101', 4), leaf('A-102', 5)],
      },
      leaf('STRUCTURAL', 60),
    ])
  })

  it('does not leave the UTF-16 terminator on the end of a title', () => {
    const d = flatSet(1, { titles: () => 'A-101' })
    const title = extractOutline(backendOf(d))[0]!.title
    expect(title).toBe('A-101')
    expect(title.length).toBe(5)
    expect(title.endsWith(NUL)).toBe(false)
    expect([...title].map((c) => c.charCodeAt(0))).toEqual([65, 45, 49, 48, 49])
  })

  it('decodes non-ASCII titles, which are why the buffer is UTF-16 at all', () => {
    const d = flatSet(1, { titles: () => 'PLAN — Ø 12mm' })
    expect(extractOutline(backendOf(d))[0]!.title).toBe('PLAN — Ø 12mm')
  })

  it('falls back to a GoTo action when the bookmark has no direct /Dest', () => {
    const d = new FakeDoc()
    d.link(0, { child: 1 })
    d.bookmark(1, 'A-101').action(1, PDFACTION_GOTO, 7)
    expect(extractOutline(backendOf(d))).toEqual([leaf('A-101', 7)])
  })

  it('ignores an action that does not point into this document', () => {
    const d = new FakeDoc()
    d.link(0, { child: 1 })
    d.bookmark(1, 'SPEC ONLINE').action(1, PDFACTION_URI, 7)
    expect(extractOutline(backendOf(d))).toEqual([leaf('SPEC ONLINE', null)])
  })

  it('reports a negative destination index as null, never as page -1', () => {
    const d = new FakeDoc()
    d.link(0, { child: 1 })
    d.bookmark(1, 'DANGLING').dest(1, -1)
    const page = extractOutline(backendOf(d))[0]!.page
    expect(page).toBeNull()
    expect(page).not.toBe(-1)
  })

  it('gives a bookmark with neither dest nor action a null page', () => {
    const d = new FakeDoc()
    d.link(0, { child: 1 })
    d.bookmark(1, 'GENERAL NOTES')
    expect(extractOutline(backendOf(d))).toEqual([leaf('GENERAL NOTES', null)])
  })
})

describe('extractOutline — the traversal guards', () => {
  it('terminates when a child points back at its own ancestor', () => {
    const d = new FakeDoc()
    d.link(0, { child: 1 })
    d.bookmark(1, 'A').link(1, { child: 2 })
    d.bookmark(2, 'B').link(2, { child: 1 }) // back up to the ancestor

    const out = extractOutline(backendOf(d))
    expect(countNodes(out)).toBe(2)
    expect(out).toEqual([branch('A', null, [leaf('B', null)])])
  })

  it('terminates when a sibling chain closes on itself', () => {
    const d = new FakeDoc()
    d.link(0, { child: 1 })
    d.bookmark(1, 'A').link(1, { sibling: 2 })
    d.bookmark(2, 'B').link(2, { sibling: 1 }) // round we go

    expect(extractOutline(backendOf(d)).map((n) => n.title)).toEqual(['A', 'B'])
  })

  it('terminates on a bookmark that is its own child', () => {
    const d = new FakeDoc()
    d.link(0, { child: 1 })
    d.bookmark(1, 'SELF').link(1, { child: 1 })
    expect(extractOutline(backendOf(d))).toEqual([leaf('SELF', null)])
  })

  it('keeps the cycle from costing more than the tree it truncates', () => {
    const d = new FakeDoc()
    d.link(0, { child: 1 })
    d.bookmark(1, 'A').link(1, { child: 2 })
    d.bookmark(2, 'B').link(2, { child: 1 })
    extractOutline(backendOf(d))
    // A runaway walk trips FakeDoc's 500,000-call guard; this is the positive
    // statement that it does not even get close.
    expect(d.calls).toBeLessThan(100)
  })

  it('stops descending at the depth cap and returns everything above it', () => {
    // A 100-deep chain: each bookmark is the sole child of the one before.
    const d = new FakeDoc()
    d.link(0, { child: 1 })
    for (let h = 1; h <= 100; h++) d.bookmark(h, `L${h}`).link(h, { child: h + 1 })
    d.bookmark(101, 'L101')

    const out = extractOutline(backendOf(d), { maxDepth: 5 })
    expect(depthOf(out)).toBe(5)
    expect(countNodes(out)).toBe(5)
    expect(out[0]!.title).toBe('L1')
  })

  it('defaults the depth cap to MAX_OUTLINE_DEPTH', () => {
    const d = new FakeDoc()
    d.link(0, { child: 1 })
    for (let h = 1; h <= 100; h++) d.bookmark(h, `L${h}`).link(h, { child: h + 1 })
    d.bookmark(101, 'L101')
    expect(depthOf(extractOutline(backendOf(d)))).toBe(MAX_OUTLINE_DEPTH)
  })

  it('stops at the node cap and returns what it collected', () => {
    const out = extractOutline(backendOf(flatSet(50)), { maxNodes: 10 })
    expect(countNodes(out)).toBe(10)
    expect(out[0]!.title).toBe('A-101')
    expect(out[9]!.title).toBe('A-110')
  })

  it('counts nodes across the whole tree, not per level', () => {
    // 3 top-level bookmarks, each with 3 children: the cap has to bite inside a
    // subtree, not only along the top row.
    const d = new FakeDoc()
    d.link(0, { child: 1 })
    d.bookmark(1, 'A').link(1, { child: 2, sibling: 5 })
    d.bookmark(2, 'A1').link(2, { sibling: 3 })
    d.bookmark(3, 'A2').link(3, { sibling: 4 })
    d.bookmark(4, 'A3')
    d.bookmark(5, 'B').link(5, { child: 6 })
    d.bookmark(6, 'B1')
    expect(countNodes(extractOutline(backendOf(d), { maxNodes: 3 }))).toBe(3)
    expect(countNodes(extractOutline(backendOf(d)))).toBe(6)
  })
})

// =================================================== labels and the wrapper ==

describe('extractPageLabels', () => {
  it('reads labels per page and reports unlabelled pages as null', () => {
    const d = new FakeDoc()
    d.label(0, 'COVER').label(2, 'A-101')
    expect(extractPageLabels(backendOf(d), 4)).toEqual(['COVER', null, 'A-101', null])
  })

  it('strips the padding PDFium leaves after a short label', () => {
    // FakeDoc advertises three code units more than the label needs; the slack
    // comes back as NULs, and a label with a NUL glued to it is not the label.
    const d = new FakeDoc()
    d.label(0, 'A-101')
    const label = extractPageLabels(backendOf(d), 1)[0]
    expect(label).toBe('A-101')
    expect(label).toHaveLength(5)
  })

  it('returns an empty array for a document with no pages', () => {
    expect(extractPageLabels(backendOf(new FakeDoc()), 0)).toEqual([])
  })
})

describe('readUtf16Out', () => {
  const mem = () => ({
    pdfium: { HEAPU8: new Uint8Array(256), wasmExports: { malloc: () => 8, free: () => undefined } },
  })

  it('is empty when PDFium reports no such string', () => {
    expect(readUtf16Out(mem(), () => 0)).toBe('')
  })

  it('is empty when PDFium reports the terminator and nothing else', () => {
    // 2 bytes is the empty string. Allocating for it would be pure waste.
    let writes = 0
    expect(readUtf16Out(mem(), () => (writes++, 2))).toBe('')
    expect(writes).toBe(1)
  })

  it('asks for the length before it asks for the bytes', () => {
    const seen: Array<[number, number]> = []
    const m = mem()
    readUtf16Out(m, (buf, len) => {
      seen.push([buf, len])
      if (!buf) return 6
      m.pdfium.HEAPU8.set([0x41, 0, 0x42, 0, 0, 0], buf)
      return 6
    })
    expect(seen[0]).toEqual([0, 0])
    expect(seen[1]).toEqual([8, 6])
  })

  it('decodes little-endian code units, terminator excluded', () => {
    const m = mem()
    const out = readUtf16Out(m, (buf) => {
      // "AØ" plus the terminator: 0x41, 0x00D8, 0x0000.
      if (buf) m.pdfium.HEAPU8.set([0x41, 0x00, 0xd8, 0x00, 0x00, 0x00], buf)
      return 6
    })
    expect(out).toBe('AØ')
    expect(out).toHaveLength(2)
  })
})

describe('extractDocumentIndex', () => {
  it('returns outline, labels and shape for a bookmarked drawing set', () => {
    const d = flatSet(SHEETS)
    for (let i = 0; i < SHEETS; i++) d.label(i, `A-${101 + i}`)

    const idx = extractDocumentIndex(backendOf(d), SHEETS)
    expect(idx.shape).toBe('per-sheet')
    expect(idx.outline).toHaveLength(SHEETS)
    expect(idx.outline[0]).toEqual(leaf('A-101', 0))
    expect(idx.outline[SHEETS - 1]).toEqual(leaf(`A-${100 + SHEETS}`, SHEETS - 1))
    expect(idx.labels).toHaveLength(SHEETS)
    expect(idx.labels[0]).toBe('A-101')
    expect(idx.labels.every((l) => l !== null && !l.includes(NUL))).toBe(true)
  })

  it('reports shape none, and every label, for a set with no bookmarks at all', () => {
    const d = new FakeDoc()
    d.label(0, 'COVER')
    const idx = extractDocumentIndex(backendOf(d), 3)
    expect(idx.shape).toBe('none')
    expect(idx.outline).toEqual([])
    expect(idx.labels).toEqual(['COVER', null, null])
  })

  it('still produces labels when the outline is a cycle', () => {
    // The point of the guards: a malformed outline costs you the outline, not
    // the document.
    const d = new FakeDoc()
    d.link(0, { child: 1 })
    d.bookmark(1, 'A').link(1, { child: 2 })
    d.bookmark(2, 'B').link(2, { child: 1 })
    d.label(0, 'COVER').label(1, 'A-101')

    const idx = extractDocumentIndex(backendOf(d), 2)
    expect(idx.labels).toEqual(['COVER', 'A-101'])
    expect(countNodes(idx.outline)).toBe(2)
  })
})
