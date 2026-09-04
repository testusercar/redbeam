/**
 * Integration test against a REAL drawing set.
 *
 * A fake PDFium proves the traversal and the classifier. It cannot prove the
 * two things that only a real build can get wrong: whether these particular
 * PDFium exports are actually present and callable through the wasm wrapper,
 * and whether the UTF-16 out-parameter contract is what this code believes it
 * is. A fixture author writes the byte layout they already believe in.
 *
 * `sample.pdf` is gitignored (101 MB), so every test here SKIPS when it is
 * absent rather than failing — same convention as geometryReal.test.ts. All but
 * the last test hold for any drawing set dropped at that path; the last one
 * pins the numbers measured on the Barclays PKG A set and has to be re-derived,
 * not "fixed", if the file changes.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  classifyOutline,
  createPdfiumOutlineBackend,
  extractDocumentIndex,
  type DocumentIndex,
  type OutlineBackend,
  type OutlineNode,
  type PdfiumOutlineLike,
} from './outline.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const PDF = resolve(root, 'apps/desktop/public/sample.pdf')
const WASM = resolve(root, 'apps/desktop/public/pdfium.wasm')

const NUL = String.fromCharCode(0)

const available = existsSync(PDF) && existsSync(WASM)
const suite = available ? describe : describe.skip
if (!available) {
  // eslint-disable-next-line no-console
  console.warn(`[outlineReal] skipped: ${PDF} not present (it is gitignored). Drop a drawing set there to run.`)
}

let backend: OutlineBackend
let pageCount = 0
let index: DocumentIndex
let extractMs = 0

const flatten = (nodes: readonly OutlineNode[], out: OutlineNode[] = []): OutlineNode[] => {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

const depthOf = (nodes: readonly OutlineNode[]): number =>
  nodes.length === 0 ? 0 : 1 + Math.max(...nodes.map((n) => depthOf(n.children)))

suite('document index against the real Barclays set', () => {
  beforeAll(async () => {
    const mod = (await import('@embedpdf/pdfium')) as unknown as {
      init(o: { wasmBinary: Uint8Array }): Promise<
        PdfiumOutlineLike & {
          PDFiumExt_Init(): void
          FPDF_LoadMemDocument(ptr: number, len: number, pw: string): number
          FPDF_GetPageCount(doc: number): number
        }
      >
    }
    const p = await mod.init({ wasmBinary: new Uint8Array(readFileSync(WASM)) })
    p.PDFiumExt_Init()
    const bytes = new Uint8Array(readFileSync(PDF))
    const ptr = p.pdfium.wasmExports.malloc(bytes.length)
    p.pdfium.HEAPU8.set(bytes, ptr)
    const doc = p.FPDF_LoadMemDocument(ptr, bytes.length, '')
    expect(doc).toBeGreaterThan(0)
    pageCount = p.FPDF_GetPageCount(doc)
    backend = createPdfiumOutlineBackend(p, doc)

    const t0 = performance.now()
    index = extractDocumentIndex(backend, pageCount)
    extractMs = performance.now() - t0

    const all = flatten(index.outline)
    // eslint-disable-next-line no-console
    console.log(
      `[outlineReal] ${pageCount} pages, ${all.length} outline nodes (${index.outline.length} top-level, ` +
        `depth ${depthOf(index.outline)}), ${all.filter((n) => n.page !== null).length} with a page, ` +
        `${new Set(all.filter((n) => n.page !== null).map((n) => n.page)).size} distinct pages, ` +
        `${index.labels.filter((l) => l !== null).length} labelled pages, ` +
        `shape '${index.shape}', ${extractMs.toFixed(1)} ms`,
    )
    // eslint-disable-next-line no-console
    console.log(`[outlineReal] first titles: ${JSON.stringify(all.slice(0, 6).map((n) => n.title))}`)
    // eslint-disable-next-line no-console
    console.log(`[outlineReal] first labels: ${JSON.stringify(index.labels.slice(0, 6))}`)
  }, 120_000)

  it('extracts the whole index without opening a single page', () => {
    /*
     * The claim behind PRIORITY_INDEX: this is cheap because it touches the
     * catalog, not the content streams.
     *
     * The budget is deliberately loose. What it has to catch is somebody
     * making this open pages — a page load on this set is ~380ms and there are
     * 75 of them, so the wrong implementation takes TENS OF SECONDS. The right
     * one measures ~17ms. Three orders of magnitude separate them, and a
     * tighter bound buys nothing while making the assertion a wall-clock race
     * against whatever else the suite is running: at 200ms this failed once in
     * a full parallel run and passed alone, which is a test reporting on the
     * machine rather than on the code.
     */
    expect(extractMs).toBeLessThan(5_000)
    expect(index.labels).toHaveLength(pageCount)
  })

  it('never leaves a UTF-16 terminator or padding on a title or a label', () => {
    // The failure this guards is invisible in a console: 'A-101\\u0000' prints
    // as 'A-101' and compares unequal to it.
    for (const n of flatten(index.outline)) {
      expect(n.title.includes(NUL)).toBe(false)
      expect(n.title).toBe(n.title.trim())
    }
    for (const l of index.labels) {
      if (l !== null) expect(l.includes(NUL)).toBe(false)
    }
  })

  it('resolves destinations to pages that exist in this document', () => {
    for (const n of flatten(index.outline)) {
      if (n.page === null) continue
      expect(n.page).toBeGreaterThanOrEqual(0)
      expect(n.page).toBeLessThan(pageCount)
    }
  })

  it('agrees with the classifier when re-run on the extracted tree', () => {
    // `shape` is not a separate measurement — it must be derivable from the
    // outline the consumer was handed, or the two can drift apart.
    expect(classifyOutline(index.outline, pageCount)).toBe(index.shape)
  })

  it('produces an index the shape claim actually describes', () => {
    const all = flatten(index.outline)
    const withPage = all.filter((n) => n.page !== null)
    const distinct = new Set(withPage.map((n) => n.page)).size
    if (index.shape === 'none') {
      expect(all).toHaveLength(0)
    } else {
      expect(all.length).toBeGreaterThan(0)
    }
    if (index.shape === 'per-sheet') {
      expect(distinct).toBeGreaterThanOrEqual(0.8 * pageCount)
    }
    if (index.shape === 'table-of-contents') {
      expect(all.some((n) => n.children.length > 0)).toBe(true)
    }
  })

  it('reads the Barclays set as a flat bookmarked sheet list', () => {
    // Measured 2026-08-28 on apps/desktop/public/sample.pdf. These are the
    // numbers, not a range: a different sample.pdf means every test above is
    // measuring a different document and this one should be re-derived.
    expect(pageCount).toBe(75)
    const all = flatten(index.outline)
    expect(all).toHaveLength(73)
    expect(depthOf(index.outline)).toBe(1)
    expect(index.shape).toBe('per-sheet')

    // 66 of 73 entries carry a destination, each to a different page: 0.88 of
    // the set, comfortably over PER_SHEET_COVERAGE. The seven that carry NONE
    // are why `page` is nullable — a real, current, professionally produced bid
    // set has destination-less bookmarks in it.
    expect(all.filter((n) => n.page !== null)).toHaveLength(66)
    expect(all.filter((n) => n.page === null)).toHaveLength(7)
    expect(new Set(all.map((n) => n.page)).size).toBe(67)

    // Actual strings off actual wasm. A stub returning '' passes nothing here.
    expect(all[0]!.title).toBe('G-000 - COVER SHEET')
    expect(all[4]!.title).toBe('A-010 - PARTITION TYPES')
    expect(index.labels).toHaveLength(75)
    expect(index.labels.filter((l) => l !== null)).toHaveLength(75)
    expect(index.labels[0]).toBe('G-000 - COVER SHEET')
    expect(index.labels[4]).toBe('G-004 - FEMA FLOOD MAPS')
  })
})
