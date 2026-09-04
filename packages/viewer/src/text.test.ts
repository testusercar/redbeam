import { describe, expect, it } from 'vitest'
import {
  buildRuns,
  extractPageText,
  findRanges,
  normalizeBox,
  runsForRanges,
  type PageBox,
  type TextBackend,
} from './text.js'

/**
 * The real PKG A sheet's box, read off PDFium with FPDF_GetPageBoundingBox.
 * Origin-centred: this is the case that breaks any code assuming (0,0).
 */
const CENTRED: PageBox = { left: -1728, bottom: -1296.12, right: 1728, top: 1296.12 }
const ORIGIN: PageBox = { left: 0, bottom: 0, right: 612, top: 792 }

/** Lay out a horizontal string of characters at a baseline. */
function layOut(
  text: string,
  opts: { x: number; y: number; w?: number; h?: number; gap?: number },
): Array<PageBox | null> {
  const w = opts.w ?? 6
  const h = opts.h ?? 10
  const gap = opts.gap ?? 0.5
  const out: Array<PageBox | null> = []
  let x = opts.x
  for (const ch of text) {
    if (/\s/.test(ch)) {
      // PDFium hands back a zero-size box parked on the previous glyph for
      // \r and \n; a real space gets a box but is skipped as whitespace.
      out.push({ left: x, right: x, bottom: opts.y, top: opts.y })
      x += w + gap
      continue
    }
    out.push({ left: x, right: x + w, bottom: opts.y, top: opts.y + h })
    x += w + gap
  }
  return out
}

describe('normalizeBox — page box origin', () => {
  it('normalizes against an origin-centred crop box, not the page size', () => {
    // Dead centre of the PKG A sheet.
    const n = normalizeBox(CENTRED, { left: -10, right: 10, bottom: -10, top: 10 })
    expect(n.x0).toBeCloseTo(0.5 - 10 / 3456, 6)
    expect(n.x1).toBeCloseTo(0.5 + 10 / 3456, 6)
    expect(n.y0).toBeCloseTo(0.5 - 10 / 2592.24, 6)
    expect(n.y1).toBeCloseTo(0.5 + 10 / 2592.24, 6)
  })

  it('would have been wrong under the (0,0) assumption', () => {
    // The bug this guards: treating char space as 0..width. A glyph at x=-10
    // would then normalize negative and clamp to the left edge instead of
    // landing in the middle of the sheet.
    const wrong = normalizeBox({ left: 0, bottom: 0, right: 3456, top: 2592.24 }, {
      left: -10, right: 10, bottom: -10, top: 10,
    })
    expect(wrong.x0).toBe(0)
    const right = normalizeBox(CENTRED, { left: -10, right: 10, bottom: -10, top: 10 })
    expect(right.x0).toBeGreaterThan(0.49)
  })

  it('flips y so 0 is the top of the page, matching markup geometry', () => {
    const topLeft = normalizeBox(ORIGIN, { left: 0, right: 10, bottom: 782, top: 792 })
    expect(topLeft.y0).toBeCloseTo(0, 6)
    const bottomLeft = normalizeBox(ORIGIN, { left: 0, right: 10, bottom: 0, top: 10 })
    expect(bottomLeft.y1).toBeCloseTo(1, 6)
  })

  it('clamps glyphs that hang off the sheet rather than dropping them', () => {
    const n = normalizeBox(ORIGIN, { left: -50, right: 5, bottom: 800, top: 820 })
    expect(n.x0).toBe(0)
    expect(n.y0).toBe(0)
  })

  it('is degenerate, not NaN, for a zero-area page box', () => {
    expect(normalizeBox({ left: 0, bottom: 0, right: 0, top: 0 }, ORIGIN)).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 })
  })
})

describe('buildRuns', () => {
  it('groups a word into one run and reports its exact character range', () => {
    const text = 'CEILING'
    const runs = buildRuns(text, layOut(text, { x: 100, y: 200 }), ORIGIN)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.start).toBe(0)
    expect(runs[0]!.length).toBe(7)
    expect(text.slice(runs[0]!.start, runs[0]!.start + runs[0]!.length)).toBe('CEILING')
  })

  it('splits on whitespace', () => {
    const text = 'ELEC. CLOS A'
    const runs = buildRuns(text, layOut(text, { x: 0, y: 0 }), ORIGIN)
    expect(runs.map((r) => text.slice(r.start, r.start + r.length))).toEqual(['ELEC.', 'CLOS', 'A'])
  })

  it('splits on a positioning gap even with no space character', () => {
    // Drawing text routinely carries no spaces — words are separated by
    // positioning. "C5" then "C6" a long way to the right, no space between.
    const text = 'C5C6'
    const boxes = [
      ...layOut('C5', { x: 0, y: 0 }),
      ...layOut('C6', { x: 400, y: 0 }),
    ]
    const runs = buildRuns(text, boxes, ORIGIN)
    expect(runs.map((r) => text.slice(r.start, r.start + r.length))).toEqual(['C5', 'C6'])
  })

  it('keeps rotated text together instead of emitting one run per glyph', () => {
    // Grid tags up the left edge of the sheet advance in y, not x.
    const text = 'FEC'
    const boxes: Array<PageBox | null> = [
      { left: 412.3, right: 419.9, bottom: 514.1, top: 518.2 },
      { left: 412.3, right: 419.9, bottom: 519.3, top: 523.9 },
      { left: 412.2, right: 420.1, bottom: 524.8, top: 530.2 },
    ]
    const runs = buildRuns(text, boxes, ORIGIN)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.length).toBe(3)
  })

  it('breaks between two lines of the same column', () => {
    const text = 'AB'
    const boxes: Array<PageBox | null> = [
      { left: 0, right: 6, bottom: 100, top: 110 },
      { left: 0, right: 6, bottom: 60, top: 70 }, // three line-heights down
    ]
    expect(buildRuns(text, boxes, ORIGIN)).toHaveLength(2)
  })

  it('ignores characters PDFium could not box', () => {
    const text = 'AB'
    const runs = buildRuns(text, [null, { left: 0, right: 6, bottom: 0, top: 10 }], ORIGIN)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.start).toBe(1)
  })

  it('produces boxes inside [0,1] on the origin-centred sheet', () => {
    const text = 'STAIR'
    const runs = buildRuns(text, layOut(text, { x: -900, y: 500 }), CENTRED)
    const r = runs[0]!
    for (const v of [r.x0, r.y0, r.x1, r.y1]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(r.x0).toBeLessThan(0.5)
    expect(r.y0).toBeLessThan(0.5) // above the middle -> nearer the top
  })
})

// A fake PDFium. Enough surface to prove the walk, the index alignment and the
// handle lifecycle without any wasm.
function fakeBackend(
  text: string,
  boxes: Array<PageBox | null>,
  opts: { box?: PageBox; failLoad?: boolean; codes?: number[] } = {},
): TextBackend {
  return {
    loadTextPage: () => (opts.failLoad ? 0 : 77),
    closeTextPage: () => undefined,
    countChars: () => text.length,
    charCode: (_tp, i) => opts.codes?.[i] ?? text.charCodeAt(i),
    charBox: (_tp, i) => boxes[i] ?? null,
    pageBox: () => opts.box ?? ORIGIN,
  }
}

describe('extractPageText', () => {
  it('builds a string whose indices line up with the char boxes', () => {
    const text = 'STAIR A'
    const pt = extractPageText(fakeBackend(text, layOut(text, { x: 10, y: 10 })), 1, 4)
    expect(pt.page).toBe(4)
    expect(pt.text).toBe('STAIR A')
    expect(pt.charCount).toBe(7)
    expect(pt.runs.map((r) => pt.text.slice(r.start, r.start + r.length))).toEqual(['STAIR', 'A'])
    expect(pt.scanned).toBe(false)
  })

  it('folds astral code points to one unit so later boxes do not shift', () => {
    // A single JS char per PDFium index is the invariant; an astral code point
    // would otherwise consume two UTF-16 units and slide every later run.
    const text = 'AXB'
    const boxes = layOut(text, { x: 0, y: 0 })
    const pt = extractPageText(fakeBackend(text, boxes, { codes: [65, 0x1f600, 66] }), 1, 0)
    expect(pt.text).toHaveLength(3)
    expect(pt.text[1]).toBe('�')
    expect(pt.runs[0]!.length).toBe(3)
  })

  it('reports a scanned sheet rather than an empty one', () => {
    const pt = extractPageText(fakeBackend('', []), 1, 2)
    expect(pt.scanned).toBe(true)
    expect(pt.charCount).toBe(0)
    expect(pt.runs).toEqual([])
  })

  it('survives FPDFText_LoadPage returning 0', () => {
    const pt = extractPageText(fakeBackend('ABC', layOut('ABC', { x: 0, y: 0 }), { failLoad: true }), 1, 0)
    expect(pt.scanned).toBe(true)
  })

  it('closes the text page handle even when the walk throws', () => {
    let closed = 0
    const backend: TextBackend = {
      loadTextPage: () => 9,
      closeTextPage: () => closed++,
      countChars: () => 3,
      charCode: () => {
        throw new Error('boom')
      },
      charBox: () => null,
      pageBox: () => ORIGIN,
    }
    expect(() => extractPageText(backend, 1, 0)).toThrow('boom')
    expect(closed).toBe(1)
  })
})

describe('findRanges / runsForRanges', () => {
  const text = 'CEILING PLAN — ceiling grid'

  it('is case-insensitive and finds every occurrence', () => {
    expect(findRanges(text, 'ceiling')).toEqual([
      { start: 0, length: 7 },
      { start: 15, length: 7 },
    ])
  })

  it('returns nothing for an empty needle rather than every position', () => {
    expect(findRanges(text, '')).toEqual([])
  })

  it('selects only the runs a range touches', () => {
    const runs = buildRuns(text, layOut(text, { x: 0, y: 0 }), ORIGIN)
    const picked = runsForRanges(runs, findRanges(text, 'PLAN'))
    expect(picked).toHaveLength(1)
    expect(text.slice(picked[0]!.start, picked[0]!.start + picked[0]!.length)).toBe('PLAN')
  })
})
