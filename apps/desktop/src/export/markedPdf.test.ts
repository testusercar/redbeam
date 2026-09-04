/**
 * The path between the app and the PDF writer. Everything here is about which
 * markups belong on this sheet and what they say, so the assertions are about
 * the request that reaches the writer rather than the bytes it produces —
 * those are `pdfMarkup.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString } from 'pdf-lib'
import { exportMarkedPdf, markedFileName, noteFor, type MarkedPdfRequest } from './markedPdf.js'

const ring = [
  { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.5 },
]

async function blank(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([612, 792])
  return doc.save()
}

function request(over: Partial<MarkedPdfRequest> = {}): {
  req: MarkedPdfRequest
  saved: Array<{ name: string, bytes: Uint8Array }>
} {
  const saved: Array<{ name: string, bytes: Uint8Array }> = []
  const req: MarkedPdfRequest = {
    documentId: 'doc-1',
    documentName: 'A-101.pdf',
    markups: [{ id: 'm1', pageId: 'doc-1-p0', scopeId: 's1', kind: 'area', rings: [ring] }],
    scopes: [{ id: 's1', label: 'C-MT-01', color: '#2f7fd1' }],
    // 0.1 ft per point on a 612x792 page: the ring is 0.4 x 0.4 of the sheet,
    // so 244.8 x 316.8 points, so 24.48 x 31.68 ft = 775.5 SF.
    calibrations: new Map([['doc-1-p0', 0.1]]),
    pageBoxes: new Map([['doc-1-p0', { width: 612, height: 792 }]]),
    readBytes: async () => blank(),
    save: (name, bytes) => { saved.push({ name, bytes }) },
    ...over,
  }
  return { req, saved }
}

const annotsOn = async (bytes: Uint8Array, page: number): Promise<PDFDict[]> => {
  const doc = await PDFDocument.load(bytes)
  const arr = doc.getPages()[page]!.node.get(PDFName.of('Annots'))
  if (!(arr instanceof PDFArray)) return []
  const out: PDFDict[] = []
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.lookup(i)
    if (v instanceof PDFDict) out.push(v)
  }
  return out
}

const strOf = (a: PDFDict, key: string): string => {
  const v = a.lookup(PDFName.of(key))
  return v instanceof PDFString ? v.asString() : ''
}

describe('noteFor', () => {
  const box = { width: 612, height: 792 }

  it('states the measurement, since the scope is already the author', () => {
    expect(noteFor({ id: 'm', pageId: 'p', scopeId: 's', kind: 'area', rings: [ring] }, 0.1, box))
      .toBe('775.5 SF')
  })

  it('says a page is uncalibrated rather than showing points as feet', () => {
    // A number in the wrong units is worse than no number: it gets quoted.
    const m = { id: 'm', pageId: 'p', scopeId: 's', kind: 'area', rings: [ring] }
    expect(noteFor(m, undefined, box)).toBe('Not calibrated')
    expect(noteFor(m, 0.1, undefined)).toBe('Not calibrated')
  })

  it('states a run in feet, not square feet', () => {
    // A 0.4-wide leg then a 0.4-tall leg on a 612x792 sheet at 0.1 ft/pt:
    // 244.8 pt + 316.8 pt = 561.6 pt = 56.16 ft.
    const run = {
      id: 'l', pageId: 'p', scopeId: 's', kind: 'polyline',
      rings: [[{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5 }]],
    }
    expect(noteFor(run, 0.1, box)).toBe('56.2 LF')
  })

  it('says a count is one of something, with no measurement', () => {
    // A length or an area on a count is a number nobody asked for.
    const one = { id: 'c', pageId: 'p', scopeId: 's', kind: 'count', rings: [[{ x: 0.5, y: 0.5 }]] }
    expect(noteFor(one, 0.1, box)).toBe('1 EA')
    // And it does not depend on a calibration, so it survives an unscaled page.
    expect(noteFor(one, undefined, undefined)).toBe('1 EA')
  })

  it('calls a cutout a deduction rather than giving it an area', () => {
    // Its area is real but it is SUBTRACTED, and a bare number on a hole
    // reads as material to order.
    const m = { id: 'm', pageId: 'p', scopeId: 's', kind: 'cutout', rings: [ring] }
    expect(noteFor(m, 0.1, box)).toBe('Deduction')
  })
})

describe('markedFileName', () => {
  it('never reuses the original name', () => {
    // A file that looks like the consultant's issued drawing is one somebody
    // eventually sends back to them as if it were.
    expect(markedFileName('A-101.pdf')).toBe('A-101 (REDBEAM markups).pdf')
    expect(markedFileName('A-101.pdf')).not.toBe('A-101.pdf')
  })

  it('strips what a filesystem will not take', () => {
    expect(markedFileName('PKG A/A-101.pdf')).toBe('PKG A-A-101 (REDBEAM markups).pdf')
  })
})

describe('exportMarkedPdf', () => {
  it('saves the drawing with its markups on it', async () => {
    const { req, saved } = request()
    expect(await exportMarkedPdf(req)).toBeNull()
    expect(saved).toHaveLength(1)
    expect(saved[0]!.name).toBe('A-101 (REDBEAM markups).pdf')
    expect(await annotsOn(saved[0]!.bytes, 0)).toHaveLength(1)
  })

  it('carries the scope label and the measurement onto the sheet', async () => {
    const { req, saved } = request()
    await exportMarkedPdf(req)
    const a = (await annotsOn(saved[0]!.bytes, 0))[0]!
    expect(strOf(a, 'T')).toBe('C-MT-01')
    expect(strOf(a, 'Contents')).toBe('775.5 SF')
  })

  it('leaves another document\'s markups off this sheet', async () => {
    // The failure this prevents is the quiet one: a scope spans documents, so
    // the list handed in holds rows from other files, and reading a page
    // position out of one would land it on whatever sheet shares the number.
    const { req, saved } = request({
      markups: [
        { id: 'mine', pageId: 'doc-1-p1', scopeId: 's1', kind: 'area', rings: [ring] },
        { id: 'theirs', pageId: 'doc-2-p1', scopeId: 's1', kind: 'area', rings: [ring] },
      ],
    })
    await exportMarkedPdf(req)
    const ids = (await annotsOn(saved[0]!.bytes, 1)).map((a) => strOf(a, 'NM'))
    expect(ids).toEqual(['mine'])
  })

  it('puts each markup on its own page', async () => {
    const { req, saved } = request({
      markups: [
        { id: 'a', pageId: 'doc-1-p0', scopeId: 's1', kind: 'area', rings: [ring] },
        { id: 'b', pageId: 'doc-1-p2', scopeId: 's1', kind: 'area', rings: [ring] },
      ],
    })
    await exportMarkedPdf(req)
    expect((await annotsOn(saved[0]!.bytes, 0)).map((a) => strOf(a, 'NM'))).toEqual(['a'])
    expect(await annotsOn(saved[0]!.bytes, 1)).toHaveLength(0)
    expect((await annotsOn(saved[0]!.bytes, 2)).map((a) => strOf(a, 'NM'))).toEqual(['b'])
  })

  it('still writes a markup whose scope has gone', async () => {
    // It is evidence of work. Dropping it would make the exported sheet
    // disagree with what the app is showing.
    const { req, saved } = request({ scopes: [] })
    expect(await exportMarkedPdf(req)).toBeNull()
    expect(strOf((await annotsOn(saved[0]!.bytes, 0))[0]!, 'T')).toBe('Unassigned')
  })

  it('still writes a markup that was never assigned a scope', async () => {
    // scope_id is nullable: a markup can be drawn before a scope is chosen.
    const { req, saved } = request({
      markups: [{ id: 'm1', pageId: 'doc-1-p0', scopeId: null, kind: 'area', rings: [ring] }],
    })
    expect(await exportMarkedPdf(req)).toBeNull()
    expect(strOf((await annotsOn(saved[0]!.bytes, 0))[0]!, 'T')).toBe('Unassigned')
  })

  it('says so when there is nothing to write, and saves nothing', async () => {
    const { req, saved } = request({ markups: [] })
    expect(await exportMarkedPdf(req)).toMatch(/no markups/i)
    expect(saved).toHaveLength(0)
  })

  it('reports a drawing it cannot read instead of throwing', async () => {
    // A sheet that has moved or gone offline since ingest is routine.
    const { req, saved } = request({
      readBytes: () => Promise.reject(new Error('ENOENT')),
    })
    expect(await exportMarkedPdf(req)).toMatch(/A-101\.pdf could not be read/)
    expect(saved).toHaveLength(0)
  })

  it('carries the page scale through to the file', async () => {
    // Without this the recipient opens a sheet whose lengths are in points.
    const { req, saved } = request()
    await exportMarkedPdf(req)
    const doc = await PDFDocument.load(saved[0]!.bytes)
    const vp = doc.getPages()[0]!.node.get(PDFName.of('VP')) as PDFArray
    expect(vp).toBeInstanceOf(PDFArray)
  })

  it('does not read the file at all when there is nothing to write', async () => {
    // Pulling 20MB across the bridge to then do nothing with it.
    const readBytes = vi.fn(async () => blank())
    const { req } = request({ markups: [], readBytes })
    await exportMarkedPdf(req)
    expect(readBytes).not.toHaveBeenCalled()
  })
})
