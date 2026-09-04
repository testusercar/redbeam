/**
 * Integration test against a REAL drawing.
 *
 * Synthetic fixtures cannot catch the page-box bug, because a fixture author
 * writes the box they already believe in. This file drives actual PDFium wasm
 * over `apps/desktop/public/sample.pdf` — the 75-page Barclays PKG A set — and
 * asserts on what comes back.
 *
 * `sample.pdf` is gitignored (101 MB), so every test here SKIPS when it is
 * absent rather than failing. A skip is reported, not silent: the suite prints
 * why. Drop any drawing set at that path to re-enable it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  createPdfiumGeometryBackend,
  extractPageGeometry,
  GEOMETRY_DEFAULTS,
  normalizePathPoint,
  readPdfiumPageBox,
  type GeometryBackend,
  type PageGeometry,
  type PdfiumLike,
} from './geometry.js'
import type { PageBox } from './text.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const PDF = resolve(root, 'apps/desktop/public/sample.pdf')
const WASM = resolve(root, 'apps/desktop/public/pdfium.wasm')

/** Page 48 of the set, 0-based. 368,743 page objects; the heaviest sheet. */
const HEAVY_PAGE = 47

const available = existsSync(PDF) && existsSync(WASM)
const suite = available ? describe : describe.skip
if (!available) {
  // eslint-disable-next-line no-console
  console.warn(`[geometryReal] skipped: ${PDF} not present (it is gitignored). Drop a drawing set there to run.`)
}

let pdfium: PdfiumLike
let pageHandle = 0
let scratch = 0
let box: PageBox
let backend: GeometryBackend

suite('page geometry against the real Barclays sheet', () => {
  beforeAll(async () => {
    const mod = (await import('@embedpdf/pdfium')) as unknown as {
      init(o: { wasmBinary: Uint8Array }): Promise<PdfiumLike & Record<string, (...a: number[]) => number>>
    }
    const p = await mod.init({ wasmBinary: new Uint8Array(readFileSync(WASM)) })
    ;(p as unknown as { PDFiumExt_Init(): void }).PDFiumExt_Init()
    pdfium = p
    const bytes = new Uint8Array(readFileSync(PDF))
    const ptr = pdfium.pdfium.wasmExports.malloc(bytes.length)
    ;(pdfium.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8.set(bytes, ptr)
    const doc = (p as unknown as { FPDF_LoadMemDocument(a: number, b: number, c: string): number }).FPDF_LoadMemDocument(
      ptr,
      bytes.length,
      '',
    )
    expect(doc).toBeGreaterThan(0)
    pageHandle = (p as unknown as { FPDF_LoadPage(d: number, i: number): number }).FPDF_LoadPage(doc, HEAVY_PAGE)
    expect(pageHandle).toBeGreaterThan(0)
    scratch = pdfium.pdfium.wasmExports.malloc(48)
    box = readPdfiumPageBox(pdfium, pageHandle, scratch)
    backend = createPdfiumGeometryBackend(pdfium, scratch)
  }, 120_000)

  it('reads an origin-centred page box that the page dimensions do not reveal', () => {
    // The measurement this whole file exists to pin. If a future PDFium build
    // or a different sample.pdf changes these numbers, everything below is
    // measuring a different sheet and should be re-derived, not "fixed".
    expect(box.left).toBeCloseTo(-1728, 2)
    expect(box.right).toBeCloseTo(1728, 2)
    expect(box.bottom).toBeCloseTo(-1296.12, 1)
    expect(box.top).toBeCloseTo(1296.12, 1)

    const w = pdfium.FPDF_GetPageWidthF(pageHandle)
    const h = pdfium.FPDF_GetPageHeightF(pageHandle)
    expect(w).toBeCloseTo(box.right - box.left, 1)
    expect(h).toBeCloseTo(box.top - box.bottom, 1)
    // The dimensions are right and the origin is invisible in them. That is the
    // whole trap: `x / FPDF_GetPageWidthF(page)` type-checks and looks correct.
    expect(box.left).not.toBe(0)
    expect(box.bottom).not.toBe(0)
  })

  it('extracts hundreds of thousands of segments, all inside [0,1]', () => {
    const g = extractPageGeometry(backend, pageHandle, HEAVY_PAGE, { minLengthPoints: 0 })
    // eslint-disable-next-line no-console
    console.log(
      `[geometryReal] full page: ${g.pageObjects} objects, ${g.pathObjects} paths, ` +
        `${g.segmentCount} segments, ${g.ms.toFixed(0)} ms`,
    )
    expect(g.pageObjects).toBeGreaterThan(300_000)
    expect(g.segmentCount).toBeGreaterThan(100_000)
    expect(g.truncated).toBe(false)

    // The contract is [-overflow, 1+overflow], not [0,1]: a wall drawn a point
    // outside the crop box is real geometry and dropping it would lose a wall.
    // Everything further out than the margin is rejected at extraction.
    let outsideMargin = 0
    let outsideUnit = 0
    for (let i = 0; i < g.segments.length; i++) {
      const v = g.segments[i]!
      if (v < -GEOMETRY_DEFAULTS.overflow || v > 1 + GEOMETRY_DEFAULTS.overflow) outsideMargin++
      if (v < 0 || v > 1) outsideUnit++
    }
    expect(outsideMargin).toBe(0)
    // And in practice the sheet's content IS on the sheet: a handful of
    // coordinates out of 1.6 million sit just past the box edge.
    // eslint-disable-next-line no-console
    console.log(
      `[geometryReal] ${outsideUnit} of ${g.segments.length} coordinates fall outside [0,1] ` +
        `(${((outsideUnit / g.segments.length) * 100).toFixed(4)}%), all within the ` +
        `${GEOMETRY_DEFAULTS.overflow} margin`,
    )
    expect(outsideUnit / g.segments.length).toBeLessThan(0.0001)
  }, 120_000)

  it('does not clamp against an edge — the page-box bug signature', () => {
    // With the origin wrong, the naive fix is to clamp, and the tell is a huge
    // pile of coordinates sitting at exactly 0 or exactly 1. Here nothing is
    // clamped at all, and the distribution has to look like a drawing: spread
    // across the sheet with its mass near the middle.
    const g = extractPageGeometry(backend, pageHandle, HEAVY_PAGE, { minLengthPoints: 0 })
    let atEdge = 0
    let sumX = 0
    let sumY = 0
    const n = g.segmentCount
    for (let i = 0; i < n; i++) {
      const x = g.segments[i * 4]!
      const y = g.segments[i * 4 + 1]!
      if (x === 0 || x === 1 || y === 0 || y === 1) atEdge++
      sumX += x
      sumY += y
    }
    expect(atEdge / n).toBeLessThan(0.01)
    // Centre of mass near the middle of the sheet, not stacked on one side.
    expect(sumX / n).toBeGreaterThan(0.2)
    expect(sumX / n).toBeLessThan(0.8)
    expect(sumY / n).toBeGreaterThan(0.2)
    expect(sumY / n).toBeLessThan(0.8)
  }, 120_000)

  it('would put most of the sheet off-page if the box origin were assumed away', () => {
    // The falsification. Take the SAME raw points and normalize them the way
    // the Qt build did — against a box assumed to start at (0,0) — and watch
    // most of the drawing leave the page.
    const zeroBox: PageBox = { left: 0, bottom: 0, right: box.right - box.left, top: box.top - box.bottom }
    const count = pdfium.FPDFPage_CountObjects(pageHandle)
    let good = 0
    let bad = 0
    let seen = 0
    for (let i = 0; i < count && seen < 40_000; i++) {
      const obj = pdfium.FPDFPage_GetObject(pageHandle, i)
      if (pdfium.FPDFPageObj_GetType(obj) !== 2) continue
      const segCount = pdfium.FPDFPath_CountSegments(obj)
      for (let j = 0; j < segCount; j++) {
        const seg = pdfium.FPDFPath_GetPathSegment(obj, j)
        if (!pdfium.FPDFPathSegment_GetPoint(seg, scratch, scratch + 4)) continue
        const f = pdfium.pdfium.HEAPF32
        const x = f[scratch >> 2]!
        const y = f[(scratch >> 2) + 1]!
        seen++
        const right = normalizePathPoint(box, x, y)
        const wrong = normalizePathPoint(zeroBox, x, y)
        if (right.x >= 0 && right.x <= 1 && right.y >= 0 && right.y <= 1) good++
        if (wrong.x < 0 || wrong.x > 1 || wrong.y < 0 || wrong.y > 1) bad++
      }
    }
    expect(seen).toBeGreaterThan(10_000)
    // Essentially everything is on the page when the box is read...
    expect(good / seen).toBeGreaterThan(0.99)
    // ...and most of it is off the page when the origin is assumed to be (0,0).
    expect(bad / seen).toBeGreaterThan(0.5)
    // eslint-disable-next-line no-console
    console.log(
      `[geometryReal] of ${seen} raw path points: ${((good / seen) * 100).toFixed(1)}% land on the page with the ` +
        `box read, ${((bad / seen) * 100).toFixed(1)}% land OFF the page with the origin assumed away`,
    )
  }, 120_000)

  it('lands in the right PLACE, not merely inside the unit square', () => {
    // Inside [0,1] is necessary and nowhere near sufficient — a wrong-but-small
    // offset passes that. So compare against PDFium's OWN raster of a window of
    // the sheet: rasterize the extracted segments over the same window and
    // measure what fraction of them fall on rendered ink. A shifted extraction
    // collapses immediately.
    const g = extractPageGeometry(backend, pageHandle, HEAVY_PAGE, { minLengthPoints: 0 })
    // A deliberately sparse corner of the sheet: dense ink would score well by
    // accident, which is exactly the trap a weak check falls into.
    const win = { x0: 0.1, y0: 0.62, ext: 0.12 }
    const G = 500
    const ink = renderInk(win.x0, win.y0, win.ext, G)
    const aligned = precision(g, win, G, ink, 0, 0)
    const nudged = precision(g, win, G, ink, 0.002, 0)
    const shifted = precision(g, win, G, ink, 0.05, 0)
    // eslint-disable-next-line no-console
    console.log(
      `[geometryReal] segment-on-ink precision: aligned ${(aligned * 100).toFixed(1)}%, ` +
        `+0.002 shift ${(nudged * 100).toFixed(1)}%, +0.05 shift ${(shifted * 100).toFixed(1)}%`,
    )
    expect(aligned).toBeGreaterThan(0.65)
    // The controls: a shift of 0.002 of the page (7 pt) already halves it. That
    // is what makes the aligned number mean something.
    expect(aligned).toBeGreaterThan(nudged * 1.8)
    expect(aligned).toBeGreaterThan(shifted * 3)
  }, 180_000)

  it('is much cheaper with a clip, which is what an interactive trace uses', () => {
    const full = extractPageGeometry(backend, pageHandle, HEAVY_PAGE, { minLengthPoints: 0 })
    const clipped = extractPageGeometry(backend, pageHandle, HEAVY_PAGE, {
      clip: { x0: 0.3, y0: 0.3, x1: 0.45, y1: 0.45 },
    })
    // eslint-disable-next-line no-console
    console.log(
      `[geometryReal] full ${full.ms.toFixed(0)} ms / ${full.segmentCount} segs; ` +
        `clipped ${clipped.ms.toFixed(0)} ms / ${clipped.segmentCount} segs ` +
        `(${clipped.clippedObjects} objects rejected on bounds, ${clipped.droppedShort} short segments dropped)`,
    )
    expect(clipped.segmentCount).toBeLessThan(full.segmentCount)
    expect(clipped.clippedObjects).toBeGreaterThan(100_000)
    expect(clipped.ms).toBeLessThan(full.ms)
  }, 180_000)

  it('drops sub-point ticks without losing the long lines', () => {
    const all = extractPageGeometry(backend, pageHandle, HEAVY_PAGE, { minLengthPoints: 0 })
    const filtered = extractPageGeometry(backend, pageHandle, HEAVY_PAGE, { minLengthPoints: 1 })
    // eslint-disable-next-line no-console
    console.log(
      `[geometryReal] minLengthPoints 0 -> ${all.segmentCount} segments; ` +
        `1 pt -> ${filtered.segmentCount} (${filtered.droppedShort} dropped)`,
    )
    expect(filtered.segmentCount).toBeLessThanOrEqual(all.segmentCount)
    expect(filtered.segmentCount + filtered.droppedShort).toBe(all.segmentCount)
  }, 180_000)
})

// ------------------------------------------------------------------ helpers --

/** PDFium's own raster of a normalized window, thresholded to an ink mask. */
function renderInk(
  fx0: number,
  fy0: number,
  ext: number,
  G: number,
): { mask: Uint8Array; h: number; extY: number } {
  const p = pdfium as unknown as {
    FPDFBitmap_Create(w: number, h: number, f: number): number
    FPDFBitmap_FillRect(b: number, x: number, y: number, w: number, h: number, c: number): void
    FPDF_RenderPageBitmap(b: number, pg: number, x: number, y: number, w: number, h: number, r: number, f: number): void
    FPDFBitmap_GetBuffer(b: number): number
    FPDFBitmap_GetStride(b: number): number
    FPDFBitmap_Destroy(b: number): void
    pdfium: { HEAPU8: Uint8Array }
  }
  const W = box.right - box.left
  const H = box.top - box.bottom
  const scale = G / (ext * W)
  const fullW = Math.round(W * scale)
  const fullH = Math.round(H * scale)
  const gh = Math.round(ext * fullH)
  const bmp = p.FPDFBitmap_Create(G, gh, 4)
  p.FPDFBitmap_FillRect(bmp, 0, 0, G, gh, 0xffffffff)
  p.FPDF_RenderPageBitmap(bmp, pageHandle, -Math.round(fx0 * fullW), -Math.round(fy0 * fullH), fullW, fullH, 0, 16)
  const buf = p.FPDFBitmap_GetBuffer(bmp)
  const stride = p.FPDFBitmap_GetStride(bmp)
  const heap = p.pdfium.HEAPU8
  const raw = new Uint8Array(G * gh)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < G; x++) raw[y * G + x] = heap[buf + y * stride + x * 4]! < 200 ? 1 : 0
  }
  p.FPDFBitmap_Destroy(bmp)
  // Dilate by one to absorb stroke width and antialiasing, so a correct segment
  // sitting half a pixel off the rendered centre line still counts as a hit.
  const mask = new Uint8Array(G * gh)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < G; x++) {
      if (!raw[y * G + x]) continue
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          const X = x + a
          const Y = y + b
          if (X >= 0 && X < G && Y >= 0 && Y < gh) mask[Y * G + X] = 1
        }
      }
    }
  }
  // The window covers `ext` of the page in x and `gh / fullH` in y. Those are
  // not the same number unless the page is square, and getting it wrong tilts
  // the comparison enough to look like a coordinate bug that is not there.
  return { mask, h: gh, extY: gh / fullH }
}

/** Fraction of the extracted segments' pixels that land on rendered ink. */
function precision(
  g: PageGeometry,
  win: { x0: number; y0: number; ext: number },
  G: number,
  ink: { mask: Uint8Array; h: number; extY: number },
  dx: number,
  dy: number,
): number {
  const gh = ink.h
  const eY = ink.extY
  const mine = new Uint8Array(G * gh)
  const put = (x: number, y: number) => {
    if (x >= 0 && x < G && y >= 0 && y < gh) mine[y * G + x] = 1
  }
  for (let i = 0; i < g.segmentCount; i++) {
    let x0 = Math.round(((g.segments[i * 4]! + dx - win.x0) / win.ext) * G)
    let y0 = Math.round(((g.segments[i * 4 + 1]! + dy - win.y0) / eY) * gh)
    const x1 = Math.round(((g.segments[i * 4 + 2]! + dx - win.x0) / win.ext) * G)
    const y1 = Math.round(((g.segments[i * 4 + 3]! + dy - win.y0) / eY) * gh)
    if ((x0 < -20 && x1 < -20) || (x0 > G + 20 && x1 > G + 20)) continue
    if ((y0 < -20 && y1 < -20) || (y0 > gh + 20 && y1 > gh + 20)) continue
    const ax = Math.abs(x1 - x0)
    const sx = x0 < x1 ? 1 : -1
    const ay = -Math.abs(y1 - y0)
    const sy = y0 < y1 ? 1 : -1
    let err = ax + ay
    const cap = ax - ay + 2
    for (let s = 0; s <= cap; s++) {
      put(x0, y0)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= ay) {
        err += ay
        x0 += sx
      }
      if (e2 <= ax) {
        err += ax
        y0 += sy
      }
    }
  }
  let on = 0
  let hit = 0
  for (let i = 0; i < mine.length; i++) {
    if (!mine[i]) continue
    on++
    if (ink.mask[i]) hit++
  }
  return on === 0 ? 0 : hit / on
}
