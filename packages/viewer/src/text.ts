/**
 * Page text layer extraction.
 *
 * PDFium gives per-CHARACTER data — a unicode value and a box — and nothing
 * above that. Everything useful (a searchable string, word boxes to highlight)
 * has to be assembled from it, so the assembly lives here, PDFium-free and
 * testable in plain Node, exactly like `PagePool` and `JobQueue`. The worker
 * supplies a thin adapter over the wasm exports; nothing else imports PDFium.
 *
 * Two things this file exists to get right:
 *
 * 1. **The page box origin is not (0,0).** Measured on the real PKG A sheet:
 *    `FPDF_GetPageBoundingBox` returns left=-1728, bottom=-1296.12,
 *    right=1728, top=1296.12 — an origin-centred CropBox — and char boxes are
 *    in that space. Normalizing with `x / pageWidth` puts every run on the
 *    wrong half of the sheet. This is the same bug the Qt build shipped in its
 *    geometry extractor (see the page-box/CTM defect in docs history), so the
 *    box origin is read per page and subtracted, never assumed away.
 *
 * 2. **Normalized [0,1], y down from the top.** That is the convention every
 *    markup uses (`overlay.ts` maps `ny * pageH * zoom - oy` onto a canvas
 *    whose y grows downward). PDF user space has y growing UP from the bottom,
 *    so the flip happens here, once, rather than at each call site.
 *
 * Cost, measured on the 325,868-path sheet: FPDF_LoadPage 377ms (already paid
 * by the page pool), FPDFText_LoadPage 47ms, the 3,091-character walk 7.8ms.
 * So extraction on an open page is ~55ms — cheap enough to be worth doing and
 * expensive enough that it must not run while the user is panning. It is
 * queued through the same scheduler as tiles, at the lowest priority.
 */

/**
 * A rectangle in PDFium page space (PDF points, y up). The origin is whatever
 * the page's box says it is; see the note above.
 */
export interface PageBox {
  left: number
  bottom: number
  right: number
  top: number
}

/** Axis-aligned box in normalized page coordinates: [0,1], y down from the top. */
export interface NormBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * A contiguous character range that reads as one visual unit — in practice a
 * word — together with its box.
 *
 * `start`/`length` index into `PageText.text` by UTF-16 code unit, which is
 * also the JS string index, so `text.slice(start, start + length)` is exactly
 * the glyphs the box covers.
 */
export interface TextRun extends NormBox {
  start: number
  length: number
}

export interface PageText {
  /** Page index, 0-based. Matches the tile/thumbnail key space. */
  page: number
  /** The page's text. Run offsets index into this string. */
  text: string
  runs: TextRun[]
  /** The box the runs were normalized against. Kept for diagnostics. */
  box: PageBox
  charCount: number
  /**
   * PDFium found no characters at all. That means a scanned raster sheet, not
   * an empty page — the difference matters, because search must be able to say
   * "this sheet has no text layer" rather than "your term is not on it".
   */
  scanned: boolean
  ms: number
}

/** The minimum PDFium surface extraction needs. Injected so tests need no wasm. */
export interface TextBackend {
  /** FPDFText_LoadPage. Returns a text-page handle, or 0. */
  loadTextPage(page: number): number
  closeTextPage(textPage: number): void
  countChars(textPage: number): number
  /** FPDFText_GetUnicode. A code point, or 0 when unmapped. */
  charCode(textPage: number, index: number): number
  /** FPDFText_GetCharBox, already unpacked. `null` when PDFium reports failure. */
  charBox(textPage: number, index: number): PageBox | null
  /** The page's own box. Origin-centred crop boxes are real; do not assume 0,0. */
  pageBox(page: number): PageBox
}

export interface ExtractOptions {
  /**
   * How far apart two character boxes may be and still belong to one run,
   * as a multiple of the taller box's height.
   *
   * Drawing text often carries no space characters at all — words are
   * separated by positioning — so a purely whitespace-driven split under-breaks
   * badly. Measuring the gap catches both. 0.6 keeps "CEILING" together and
   * splits "C5 C6 C7" into three.
   */
  gapRatio?: number
  now?: () => number
}

const DEFAULT_GAP_RATIO = 0.6

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * PDF user space -> normalized [0,1], y down.
 *
 * Clamped, because characters legitimately hang outside the crop box (a title
 * block bleeding off the sheet). Clamping keeps a highlight on screen; dropping
 * the run would lose a real hit.
 */
export function normalizeBox(box: PageBox, r: PageBox): NormBox {
  const w = box.right - box.left
  const h = box.top - box.bottom
  if (!(w > 0) || !(h > 0)) return { x0: 0, y0: 0, x1: 0, y1: 0 }
  return {
    x0: clamp01((Math.min(r.left, r.right) - box.left) / w),
    y0: clamp01((box.top - Math.max(r.top, r.bottom)) / h),
    x1: clamp01((Math.max(r.left, r.right) - box.left) / w),
    y1: clamp01((box.top - Math.min(r.top, r.bottom)) / h),
  }
}

/** Characters that end a run without belonging to one. */
function isBreak(ch: string): boolean {
  // '' guards the out-of-range index. The whitespace test covers the CR
  // and LF PDFium emits with a zero-size box parked on the previous glyph.
  return ch === '' || /\s/.test(ch)
}

interface Acc {
  start: number
  end: number // inclusive
  left: number
  bottom: number
  right: number
  top: number
}

/**
 * Group per-character boxes into word-level runs.
 *
 * A character joins the current run when its box is within `gapRatio` line
 * heights of the run's box on BOTH axes. Testing both axes rather than just x
 * is deliberate: real sheets carry rotated text (grid tags up the left edge of
 * the PKG A sheet advance in y with x constant), and an x-only rule would emit
 * one run per character there. The same rule handles it without a special case.
 */
export function buildRuns(
  text: string,
  boxes: ReadonlyArray<PageBox | null>,
  pageBox: PageBox,
  opts: ExtractOptions = {},
): TextRun[] {
  const gapRatio = opts.gapRatio ?? DEFAULT_GAP_RATIO
  const runs: TextRun[] = []
  let acc: Acc | null = null

  const flush = () => {
    if (!acc) return
    const n = normalizeBox(pageBox, { left: acc.left, bottom: acc.bottom, right: acc.right, top: acc.top })
    runs.push({ start: acc.start, length: acc.end - acc.start + 1, ...n })
    acc = null
  }

  const n = Math.min(text.length, boxes.length)
  for (let i = 0; i < n; i++) {
    const ch = text[i] ?? ''
    const raw = boxes[i]
    if (!raw || isBreak(ch)) {
      flush()
      continue
    }
    const left = Math.min(raw.left, raw.right)
    const right = Math.max(raw.left, raw.right)
    const bottom = Math.min(raw.bottom, raw.top)
    const top = Math.max(raw.bottom, raw.top)
    // \r and \n arrive with a zero-size box parked on the previous glyph. They
    // are already caught by isBreak; this also catches unmapped glyphs.
    if (right - left <= 0 && top - bottom <= 0) {
      flush()
      continue
    }

    if (acc) {
      const h = Math.max(top - bottom, acc.top - acc.bottom, 1e-6)
      const gapX = Math.max(left - acc.right, acc.left - right, 0)
      const gapY = Math.max(bottom - acc.top, acc.bottom - top, 0)
      if (gapX <= gapRatio * h && gapY <= gapRatio * h) {
        acc.end = i
        acc.left = Math.min(acc.left, left)
        acc.right = Math.max(acc.right, right)
        acc.bottom = Math.min(acc.bottom, bottom)
        acc.top = Math.max(acc.top, top)
        continue
      }
      flush()
    }
    acc = { start: i, end: i, left, bottom, right, top }
  }
  flush()
  return runs
}

/**
 * Extract one page's text layer.
 *
 * The string is built one code point at a time from FPDFText_GetUnicode rather
 * than in one FPDFText_GetText call, because run offsets have to line up with
 * PDFium's character indices exactly. FPDFText_GetText hands back UTF-16 and a
 * character above the BMP would occupy two JS code units while still being one
 * PDFium index, silently shifting every later box. Astral characters are
 * folded to U+FFFD to keep that 1:1 relationship — no construction drawing has
 * one, and a wrong highlight box is worse than a replacement glyph.
 */
export function extractPageText(
  backend: TextBackend,
  pageHandle: number,
  pageIndex: number,
  opts: ExtractOptions = {},
): PageText {
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const t0 = now()
  const box = backend.pageBox(pageHandle)
  const tp = backend.loadTextPage(pageHandle)
  if (!tp) {
    return { page: pageIndex, text: '', runs: [], box, charCount: 0, scanned: true, ms: now() - t0 }
  }
  try {
    const count = backend.countChars(tp)
    if (count <= 0) {
      return { page: pageIndex, text: '', runs: [], box, charCount: 0, scanned: true, ms: now() - t0 }
    }
    const chars: Array<PageBox | null> = new Array(count)
    let text = ''
    for (let i = 0; i < count; i++) {
      const cp = backend.charCode(tp, i)
      text += cp > 0 && cp <= 0xffff ? String.fromCharCode(cp) : '�'
      chars[i] = backend.charBox(tp, i)
    }
    const runs = buildRuns(text, chars, box, opts)
    return {
      page: pageIndex,
      text,
      runs,
      box,
      charCount: count,
      scanned: runs.length === 0,
      ms: now() - t0,
    }
  } finally {
    backend.closeTextPage(tp)
  }
}

// ------------------------------------------------------------- local find --

export interface FoundRange {
  start: number
  length: number
}

/**
 * Case-insensitive substring scan over a page's text.
 *
 * This is the viewer's own find — for highlighting inside the page currently
 * open, with no database in the loop. Project-wide search is the store's job
 * (`@redbeam/store` search.ts) and has different matching semantics; see the
 * notes there before assuming the two agree.
 */
export function findRanges(text: string, needle: string, limit = 1000): FoundRange[] {
  const out: FoundRange[] = []
  if (!needle) return out
  const hay = text.toLowerCase()
  const pin = needle.toLowerCase()
  let from = 0
  while (out.length < limit) {
    const at = hay.indexOf(pin, from)
    if (at < 0) break
    out.push({ start: at, length: pin.length })
    from = at + Math.max(1, pin.length)
  }
  return out
}

/** Runs overlapping any of `ranges`, in document order. Highlight granularity is the run. */
export function runsForRanges(runs: readonly TextRun[], ranges: readonly FoundRange[]): TextRun[] {
  if (ranges.length === 0) return []
  return runs.filter((r) =>
    ranges.some((q) => q.start < r.start + r.length && r.start < q.start + Math.max(1, q.length)),
  )
}
