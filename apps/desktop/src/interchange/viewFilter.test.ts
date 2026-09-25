import { describe, expect, it } from 'vitest'
import { applyInterchange, inspectPdf } from './pdfInterchange.js'
import { hiddenForView, pickableAnnotations, takeoffOverlay } from './viewFilter.js'
import { foreignSheet } from './testing.js'

describe('what the sheet draws of the PDF', () => {
  const annots = [
    { index: 0, name: 'BB-1' },
    { index: 1, name: 'redbeam:mk-1' },
    { index: 2, name: '' },
  ]

  it('hides the baked copy of a live markup, so the overlay is the only one drawn', () => {
    expect(hiddenForView({ annots, userHidden: [], linkedNames: new Set(['redbeam:mk-1']), takeoffOnly: false })).toEqual([1])
    expect(pickableAnnotations(annots, new Set(['redbeam:mk-1'])).map((a) => a.index)).toEqual([0, 2])
  })

  it('keeps what the person hid alongside it', () => {
    expect(hiddenForView({ annots, userHidden: [2], linkedNames: new Set(['redbeam:mk-1']), takeoffOnly: false })).toEqual([1, 2])
  })

  it('hides every PDF markup under "Show only REDBEAM takeoff"', () => {
    expect(hiddenForView({ annots, userHidden: [], linkedNames: new Set(), takeoffOnly: true })).toEqual([0, 1, 2])
  })

  it('narrows the overlay to takeoff under the same filter', () => {
    const kinds = ['area', 'cutout', 'polyline', 'count', 'highlight', 'callout', 'dimension', 'shape'].map((kind) => ({ kind }))
    expect(takeoffOverlay(kinds, true).map((m) => m.kind)).toEqual(['area', 'cutout', 'polyline', 'count'])
    expect(takeoffOverlay(kinds, false)).toHaveLength(kinds.length)
  })

  it('is a view: it produces no edit, and the file still has every markup', async () => {
    const sheet = await foreignSheet()
    const before = await inspectPdf(sheet.bytes)
    const hidden = hiddenForView({ annots: before.annots, userHidden: [], linkedNames: new Set(), takeoffOnly: true })
    expect(hidden).toHaveLength(before.annots.length)
    // The only path to the file is an edit list, and the filter makes none.
    const out = await applyInterchange(sheet.bytes, [])
    expect(out.ok && out.changed).toBe(false)
    expect(out.ok && out.bytes).toBe(sheet.bytes)
    expect((await inspectPdf(sheet.bytes)).annots).toHaveLength(before.annots.length)
  })
})
