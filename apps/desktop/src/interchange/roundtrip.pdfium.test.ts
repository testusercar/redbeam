/**
 * The baked file as a PDF reader sees it: real PDFium, the same wasm the app
 * renders with, over a synthetic sheet.
 *
 * Bluebeam cannot be driven from here, so this proves the part that can be
 * proved: another PDF engine reads each baked area as an ordinary polygon with
 * its name and note, foreign markups keep their names and flags, and hiding
 * markups for the view leaves the file as it was.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  createPdfiumAnnotBackend, extractPageAnnotations, readPdfiumPageBox, type PageAnnotation, type PdfiumLike,
} from '@redbeam/viewer'
import { applyInterchange, inspectPdf } from './pdfInterchange.js'
import { annotationName, decodeNote } from './payload.js'
import { reconcile } from './reconcile.js'
import { foreignSheet, moveInBluebeam } from './testing.js'

const here = dirname(fileURLToPath(import.meta.url))
const WASM = resolve(here, '../../public/pdfium.wasm')
const available = existsSync(WASM)
const suite = available ? describe : describe.skip
if (!available) {
  // eslint-disable-next-line no-console
  console.warn(`[roundtrip.pdfium] skipped: ${WASM} not present (npm install copies it).`)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let P: any

function readWithPdfium(bytes: Uint8Array): { annots: PageAnnotation[], close: () => void, page: number } {
  const ptr = P.pdfium.wasmExports.malloc(bytes.length)
  P.pdfium.HEAPU8.set(bytes, ptr)
  const doc = P.FPDF_LoadMemDocument(ptr, bytes.length, '')
  expect(doc).toBeGreaterThan(0)
  const page = P.FPDF_LoadPage(doc, 0)
  expect(page).toBeGreaterThan(0)
  const scratch = P.pdfium.wasmExports.malloc(48)
  const backend = createPdfiumAnnotBackend(P, (h) => readPdfiumPageBox(P as PdfiumLike, h, scratch))
  const annots = extractPageAnnotations(backend, page, 0)
  return {
    annots,
    page,
    close: () => {
      P.FPDF_ClosePage(page)
      P.FPDF_CloseDocument(doc)
      P.pdfium.wasmExports.free(scratch)
      P.pdfium.wasmExports.free(ptr)
    },
  }
}

const SQUARE = [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.4 }, { x: 0.1, y: 0.4 }]

suite('a baked drawing, read by PDFium', () => {
  beforeAll(async () => {
    const mod = (await import('@embedpdf/pdfium')) as unknown as { init(o: { wasmBinary: Uint8Array }): Promise<any> }
    P = await mod.init({ wasmBinary: new Uint8Array(readFileSync(WASM)) })
    P.PDFiumExt_Init()
  }, 60_000)

  it('sees the baked area as a named polygon beside every foreign markup, flags intact', async () => {
    const sheet = await foreignSheet()
    const before = readWithPdfium(sheet.bytes)
    const foreign = new Map(before.annots.map((a) => [a.name, a]))
    before.close()

    const out = await applyInterchange(sheet.bytes, [{
      op: 'bake', pageIndex: 0, name: annotationName('mk-1'), ring: SQUARE,
      note: 'C-MT-01 · 100 SF\nREDBEAM:v1:eyJ2IjoxfQ', author: 'C-MT-01', color: '#2f7fd1', feetPerPoint: 0.111,
    }])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const after = readWithPdfium(out.bytes)
    try {
      const baked = after.annots.find((a) => a.name === annotationName('mk-1'))!
      expect(baked.subtypeName).toBe('Polygon')
      expect(baked.author).toBe('C-MT-01')
      expect(baked.contents).toContain('REDBEAM:v1:')
      expect(baked.flags & 4).toBe(4)
      baked.vertices.forEach((v, i) => {
        expect(v.x).toBeCloseTo(SQUARE[i]!.x, 4)
        expect(v.y).toBeCloseTo(SQUARE[i]!.y, 4)
      })
      for (const [name, a] of foreign) {
        const b = after.annots.find((x) => x.name === name)
        expect(b, name).toBeDefined()
        expect(b!.flags, name).toBe(a.flags)
        expect(b!.vertices, name).toEqual(a.vertices)
      }
    } finally {
      after.close()
    }
  })

  it('keeps the name through a Bluebeam move, and the moved outline is what reopening takes', async () => {
    const baked = await applyInterchange((await foreignSheet()).bytes, [{
      op: 'bake', pageIndex: 0, name: annotationName('mk-1'), ring: SQUARE, note: 'x', author: 'A', color: '#000000', feetPerPoint: null,
    }])
    if (!baked.ok) throw new Error('bake refused')
    const moved = await moveInBluebeam(baked.bytes, annotationName('mk-1'), 122.4, 79.2) // +0.1 right, 0.1 up
    const seen = readWithPdfium(moved)
    try {
      const a = seen.annots.find((x) => x.name === annotationName('mk-1'))!
      expect(a.vertices[0]!.x).toBeCloseTo(0.2, 4)
      expect(a.vertices[0]!.y).toBeCloseTo(0.0, 4)
    } finally {
      seen.close()
    }
    const plan = reconcile({
      annots: (await inspectPdf(moved)).annots,
      markups: [{
        id: 'mk-1', pageIndex: 0, kind: 'area', scopeId: null, rings: [SQUARE],
        interchange: { name: annotationName('mk-1'), pageIndex: 0, origin: 'redbeam', ring: SQUARE },
      }],
      deleted: new Set(),
      layoutOf: () => ({}),
    })
    expect(plan.reshape[0]!.rings[0]![0]!.x).toBeCloseTo(0.2, 4)
    expect(plan.reshape[0]!.rings[0]![0]!.y).toBeCloseTo(0.0, 4)
  })

  it('hides markups in memory for the view without changing a byte of the file', async () => {
    const sheet = await foreignSheet()
    const copy = new Uint8Array(sheet.bytes)
    const seen = readWithPdfium(sheet.bytes)
    try {
      const n = P.FPDFPage_GetAnnotCount(seen.page)
      for (let i = 0; i < n; i++) {
        const a = P.FPDFPage_GetAnnot(seen.page, i)
        P.FPDFAnnot_SetFlags(a, (P.FPDFAnnot_GetFlags(a) >>> 0) | 2)
        P.FPDFPage_CloseAnnot(a)
      }
      expect(P.FPDFPage_GetAnnotCount(seen.page)).toBe(n)
    } finally {
      seen.close()
    }
    expect(sheet.bytes).toEqual(copy)
    const reread = await inspectPdf(sheet.bytes)
    expect(reread.annots.every((a) => (a.flags & 2) === 0)).toBe(true)
    expect(decodeNote('')).toBeNull()
  })
})
