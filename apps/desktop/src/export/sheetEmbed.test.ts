import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib'
import {
  embedSheet, isRedbeamNm, readSheetEmbed, redbeamNm, quantityText,
  type EmbedInput, type EmbedMarkup,
} from './sheetEmbed.js'
import { isXrefTable, lastStartXref, trailerSize } from './pdfIncremental.js'

const FPP = 8 / 72 // 1/8" = 1'-0"

async function blank(objectStreams: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([2592, 1728])
  doc.addPage([2592, 1728])
  return doc.save({ useObjectStreams: objectStreams })
}

const area = (id: string, page = 0): EmbedMarkup => ({
  id, pageIndex: page, kind: 'area',
  rings: [[{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.3 }, { x: 0.1, y: 0.3 }]],
  scopeLabel: 'ACT-1 Ceiling', color: '#2f7fd1', quantity: 2064.781,
})

const SECRET = 'baffle spacing 12in o.c. layout-component-9'

const input = (markups: EmbedMarkup[] = [area('m1')]): EmbedInput => ({
  documentId: 'doc-1',
  relativePath: 'A-101.pdf',
  displayName: 'A-101',
  appVersion: '0.3.6',
  tables: {
    markups: markups.map((m) => ({ id: m.id, kind: m.kind })),
    scopes: [{ id: 's1', label: 'ACT-1 Ceiling', specifications_json: JSON.stringify({ note: SECRET }) }],
    layout_components: [{ id: 'lc1', properties_json: SECRET }],
  },
  markups,
  pageScales: new Map([[0, FPP]]),
  now: () => new Date('2026-11-12T20:00:00Z'),
})

const str = (d: PDFDict, k: string): string => {
  const v = d.lookup(PDFName.of(k))
  return v instanceof PDFString ? v.decodeText() : ''
}

async function pageAnnots(bytes: Uint8Array, page = 0): Promise<PDFDict[]> {
  const doc = await PDFDocument.load(bytes)
  const arr = doc.getPages()[page]!.node.lookup(PDFName.of('Annots'))
  if (!(arr instanceof PDFArray)) return []
  return Array.from({ length: arr.size() }, (_, i) => arr.lookup(i, PDFDict))
}

/** What Revu does on save: a full rewrite, possibly with a markup added. */
async function resaveElsewhere(
  bytes: Uint8Array,
  edit: (doc: PDFDocument) => void = () => {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  edit(doc)
  return doc.save()
}

describe('the REDBEAM name on an annotation', () => {
  it('looks like a Revu markup id and is recognisable', () => {
    const nm = redbeamNm('markup-123')
    expect(nm).toMatch(/^RB[A-Z]{14}$/)
    expect(isRedbeamNm(nm)).toBe(true)
    expect(redbeamNm('markup-123')).toBe(nm)
    expect(isRedbeamNm('NYNYRSSMBRGGLGZL')).toBe(false)
    expect(isRedbeamNm(nm.slice(0, 15) + (nm[15] === 'A' ? 'B' : 'A'))).toBe(false)
  })

  it('words quantities the way Revu does', () => {
    expect(quantityText('area', 2064.781)).toBe('2,064.78 sf')
    expect(quantityText('polyline', 80)).toBe('80.00 ft')
    expect(quantityText('area', null)).toBe('')
  })
})

describe.each([
  ['a classic xref table', false],
  ['a cross-reference stream', true],
])('embedding into a PDF with %s', (_name, objectStreams) => {
  it('appends rather than rewrites, and reads back', async () => {
    const source = await blank(objectStreams)
    const { bytes } = await embedSheet(source, input())
    expect(bytes).not.toBeNull()
    // Every original byte is still where it was.
    expect(Buffer.from(bytes!.subarray(0, source.length)).equals(Buffer.from(source))).toBe(true)
    expect(isXrefTable(bytes!, lastStartXref(bytes!))).toBe(!objectStreams)
    // No object of the original may be redefined by a NEW object: with object
    // streams pdf-lib does not count the stream objects themselves, and reusing
    // one of their numbers deletes everything inside (Revu refused the file).
    const appended = new TextDecoder('latin1').decode(bytes!.subarray(source.length))
    const size = trailerSize(source)
    const redefined = [...appended.matchAll(/(\d+) 0 obj/g)].map((m) => Number(m[1]))
      .filter((n) => n < size)
    const doc = await PDFDocument.load(source)
    const pageRefs = new Set(doc.getPages().map((p) => p.ref.objectNumber))
    const rootRef = (doc.context.trailerInfo.Root as unknown as { objectNumber: number }).objectNumber
    for (const n of redefined) expect(pageRefs.has(n) || n === rootRef, `object ${n} redefined`).toBe(true)

    const reading = await readSheetEmbed(bytes!)
    expect(reading.source).toBe('catalog')
    expect(reading.slice?.documentId).toBe('doc-1')
    expect(reading.slice?.tables.layout_components).toHaveLength(1)
    expect(reading.redbeamAnnots).toHaveLength(1)
    expect(reading.redbeamAnnots[0]!.markupId).toBe('m1')
    expect(reading.privateDataLost).toBe(false)
  })

  it('writes the area the way Revu writes an area measurement', async () => {
    const { bytes } = await embedSheet(await blank(objectStreams), input())
    const [a] = await pageAnnots(bytes!)
    expect(a!.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('Polygon'))
    expect(a!.lookup(PDFName.of('IT'))).toBe(PDFName.of('PolygonDimension'))
    expect(str(a!, 'Subj')).toBe('ACT-1 Ceiling')
    expect(str(a!, 'Label')).toBe('ACT-1 Ceiling')
    expect(str(a!, 'Contents')).toBe('2,064.78 sf')
    expect((a!.lookup(PDFName.of('MeasurementTypes')) as PDFNumber).asNumber()).toBe(129)
    const m = a!.lookup(PDFName.of('Measure'), PDFDict)
    expect(str(m, 'R')).toBe('1 in = 8 ft')
    expect((m.lookup(PDFName.of('TargetUnitConversion')) as PDFNumber).asNumber()).toBeCloseTo(1 / 864)
    const x = (m.lookup(PDFName.of('X'), PDFArray)).lookup(0, PDFDict)
    expect((x.lookup(PDFName.of('C')) as PDFNumber).asNumber()).toBeCloseTo(FPP)
    const areaUnit = (m.lookup(PDFName.of('A'), PDFArray)).lookup(0, PDFDict)
    expect(str(areaUnit, 'U')).toBe('sf')

    const doc = await PDFDocument.load(bytes!)
    const vp = doc.getPages()[0]!.node.lookup(PDFName.of('VP'), PDFArray)
    expect(vp.size()).toBe(1)
    expect(str(vp.lookup(0, PDFDict), 'Name')).toBe('REDBEAM page scale')
  })

  it('shows Bluebeam the label and quantity only, never the scope detail', async () => {
    const { bytes } = await embedSheet(await blank(objectStreams), input())
    for (const a of await pageAnnots(bytes!)) {
      for (const [k, v] of a.entries()) {
        if (v instanceof PDFString) expect(v.decodeText(), k.decodeText()).not.toContain('baffle')
      }
    }
    // Not even as stray plain text anywhere in the file: the slice is compressed.
    expect(Buffer.from(bytes!).includes(Buffer.from(SECRET))).toBe(false)
  })
})

describe('a save after the drawing has been through Bluebeam', () => {
  it('writes nothing when nothing changed', async () => {
    const first = await embedSheet(await blank(true), input())
    const second = await embedSheet(first.bytes!, input())
    expect(second.bytes).toBeNull()
  })

  it('keeps markups another app added, and replaces only its own', async () => {
    const first = await embedSheet(await blank(true), input())
    const revu = await resaveElsewhere(first.bytes!, (doc) => {
      const page = doc.getPages()[0]!
      const cloud = doc.context.register(doc.context.obj({
        Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 100, 100],
        NM: PDFString.of('NYNYRSSMBRGGLGZL'), Subj: PDFString.of('Cloud'),
      }))
      page.node.lookup(PDFName.of('Annots'), PDFArray).push(cloud)
    })

    const changed = input([area('m1'), area('m2')])
    const second = await embedSheet(revu, changed)
    expect(second.bytes).not.toBeNull()
    expect(second.foreignKept).toBe(1)

    const annots = await pageAnnots(second.bytes!)
    expect(annots.map((a) => str(a, 'NM')).sort()).toEqual(
      ['NYNYRSSMBRGGLGZL', redbeamNm('m1'), redbeamNm('m2')].sort(),
    )
    const reading = await readSheetEmbed(second.bytes!)
    expect(reading.foreignAnnots).toBe(1)
    expect(reading.redbeamAnnots.map((r) => r.markupId).sort()).toEqual(['m1', 'm2'])
  })

  it('leaves a REDBEAM markup that was moved in Bluebeam as it was saved', async () => {
    const first = await embedSheet(await blank(true), input())
    const revu = await resaveElsewhere(first.bytes!, (doc) => {
      const a = doc.getPages()[0]!.node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict)
      a.set(PDFName.of('Vertices'), doc.context.obj([300, 300, 600, 300, 600, 600, 300, 600]))
    })
    const second = await embedSheet(revu, input([{ ...area('m1'), quantity: 1 }]))
    expect(second.editedElsewhere).toEqual(['m1'])
    const annots = await pageAnnots(second.bytes!)
    expect(annots).toHaveLength(1)
    expect((annots[0]!.lookup(PDFName.of('Vertices'), PDFArray).lookup(0) as PDFNumber).asNumber()).toBe(300)

    // And it is settled: a third save with nothing new does not re-report it.
    const third = await embedSheet(second.bytes!, input([{ ...area('m1'), quantity: 1 }]))
    expect(third.bytes).toBeNull()
  })

  it('finds the slice on the annotations when the catalog copy was dropped', async () => {
    const first = await embedSheet(await blank(false), input())
    const stripped = await resaveElsewhere(first.bytes!, (doc) => {
      doc.catalog.delete(PDFName.of('PieceInfo'))
    })
    const reading = await readSheetEmbed(stripped)
    expect(reading.source).toBe('annotation')
    expect(reading.slice?.documentId).toBe('doc-1')
  })

  it('says so when every copy of the private data was dropped', async () => {
    const first = await embedSheet(await blank(false), input())
    const stripped = await resaveElsewhere(first.bytes!, (doc) => {
      doc.catalog.delete(PDFName.of('PieceInfo'))
      const a = doc.getPages()[0]!.node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict)
      a.delete(PDFName.of('REDBEAM'))
    })
    const reading = await readSheetEmbed(stripped)
    expect(reading.slice).toBeNull()
    expect(reading.privateDataLost).toBe(true)
    expect(reading.redbeamAnnots).toHaveLength(1)

    // Writing again recovers cleanly: no duplicate of the markup.
    const again = await embedSheet(stripped, input())
    expect(await pageAnnots(again.bytes!)).toHaveLength(1)
  })

  it('keeps another app\'s PieceInfo and viewports', async () => {
    const source = await resaveElsewhere(await blank(false), (doc) => {
      doc.catalog.set(PDFName.of('PieceInfo'), doc.context.obj({ Other: doc.context.obj({ X: 1 }) }))
      doc.getPages()[0]!.node.set(PDFName.of('VP'), doc.context.obj([
        doc.context.obj({ Type: 'Viewport', BBox: [0, 0, 100, 100], Name: PDFString.of('Detail 3') }),
      ]))
    })
    const { bytes } = await embedSheet(source, input())
    const doc = await PDFDocument.load(bytes!)
    const pi = doc.catalog.lookup(PDFName.of('PieceInfo'), PDFDict)
    expect(pi.has(PDFName.of('Other'))).toBe(true)
    expect(pi.has(PDFName.of('REDBEAM'))).toBe(true)
    const vp = doc.getPages()[0]!.node.lookup(PDFName.of('VP'), PDFArray)
    expect(vp.size()).toBe(2)
    expect(str(vp.lookup(0, PDFDict), 'Name')).toBe('Detail 3')
  })
})
