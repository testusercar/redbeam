import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { renderEstimatePdf } from './estimatePdf.js'
import type { EstimateExport } from './estimateExport.js'
import type { TakeoffSnapshot } from './snapshots.js'

/** A 1x1 red PNG, so the picture page has something to embed. */
const PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
), (c) => c.charCodeAt(0))

const estimate: EstimateExport = {
  projectName: 'Barclays: Toronto',
  estimateName: '260529 - Initial Bid',
  subtitle: 'Issued for pricing',
  documents: ['AE6 CEILING SET.pdf'],
  generatedAt: new Date('2026-09-04T12:00:00Z'),
  scopes: [
    {
      id: 's1', label: 'C-MT-01', product: 'Panels', color: '#ff4d4d', note: 'Alt 2 excludes the lobby.',
      quantities: [{ label: 'Area', quantity: 4128.83, unit: 'SF' }],
      components: [
        { label: 'Panels', quantity: 662, unit: 'EA', confidence: 'verified', note: null },
        { label: 'Rails', quantity: 54, unit: 'EA', confidence: 'unverified', note: 'no golden fixture' },
      ],
      markupCount: 3, sheets: ['A-101', 'A-104'],
    },
    {
      id: 's2', label: 'WP-12', product: 'Planks', color: '#39a2ff', note: '',
      quantities: [], components: [], markupCount: 0, sheets: [],
    },
  ],
}

const snapshot: TakeoffSnapshot = {
  documentId: 'd1', documentName: 'AE6 CEILING SET.pdf', pageIndex: 0, sheetLabel: 'A-101',
  scopes: [{ id: 's1', label: 'C-MT-01', color: '#ff4d4d' }], png: PNG, width: 1, height: 1,
}

describe('renderEstimatePdf', () => {
  it('produces a PDF with a cover, a quantities page, a picture per snapshot and a notes page', async () => {
    const bytes = await renderEstimatePdf({ estimate, snapshots: [snapshot], notes: ['One sheet could not be read.'] })
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(4)
    expect(doc.getTitle()).toBe('Barclays: Toronto — 260529 - Initial Bid')
    expect(doc.getAuthor()).toBe('Maxxit')
    // Letter landscape, every page.
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBe(792)
      expect(page.getHeight()).toBe(612)
    }
  })

  it('needs no pictures and no notes to make a document', async () => {
    const bytes = await renderEstimatePdf({ estimate, snapshots: [] })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
  })

  it('paginates a long round instead of drawing off the page', async () => {
    const long: EstimateExport = {
      ...estimate,
      scopes: Array.from({ length: 40 }, (_, i) => ({
        ...estimate.scopes[0]!, id: `s${i}`, label: `SCOPE-${i}`, note: '',
      })),
    }
    const doc = await PDFDocument.load(await renderEstimatePdf({ estimate: long, snapshots: [] }))
    expect(doc.getPageCount()).toBeGreaterThan(3)
  })
})
