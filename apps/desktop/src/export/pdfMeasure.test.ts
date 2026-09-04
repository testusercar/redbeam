/**
 * Plan 10.4: the other geometry kinds, and measurement.
 *
 * 10.3 wrote areas. A linear scope exported NOTHING — the writer wanted three
 * points — and a count scope the same, so LV-04 and FIX-01 were simply absent
 * from a sheet that looked complete. That is the worst kind of export bug:
 * silent, and only visible to somebody who knows what should have been there.
 *
 * The measurement half is what makes an exported sheet a drawing rather than a
 * picture of one. With a scale on the page, the recipient measures it in their
 * own reader and arrives at OUR numbers; without one, anything they pull off
 * it is in points.
 */
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString } from 'pdf-lib'
import {
  shapeForKind, writeMarkupsToPdf, type WritableMarkup, type WritableScaleRegion,
} from './pdfMarkup.js'

const blank = async (): Promise<Uint8Array> => {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  doc.addPage([612, 792])
  return doc.save()
}

const area = (id = 'a1'): WritableMarkup => ({
  id, pageIndex: 0, kind: 'area',
  rings: [[{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.5 }]],
  scopeLabel: 'C-MT-01', color: '#2f7fd1',
})

const line = (id = 'l1'): WritableMarkup => ({
  id, pageIndex: 0, kind: 'polyline',
  rings: [[{ x: 0.1, y: 0.1 }, { x: 0.6, y: 0.1 }, { x: 0.6, y: 0.4 }]],
  scopeLabel: 'LV-04', color: '#e08b2a', note: '80.0 LF',
})

const mark = (id = 'c1'): WritableMarkup => ({
  id, pageIndex: 0, kind: 'count',
  rings: [[{ x: 0.5, y: 0.5 }]],
  scopeLabel: 'FIX-01', color: '#8256c4', note: '1 EA',
})

async function annotsOf(bytes: Uint8Array, page = 0): Promise<PDFDict[]> {
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

/** The page's measurement dictionary, via its viewport. */
async function pageMeasure(bytes: Uint8Array, page = 0): Promise<PDFDict | null> {
  const doc = await PDFDocument.load(bytes)
  const vp = doc.getPages()[page]!.node.get(PDFName.of('VP'))
  if (!(vp instanceof PDFArray) || vp.size() === 0) return null
  const m = (vp.lookup(0) as PDFDict).lookup(PDFName.of('Measure'))
  return m instanceof PDFDict ? m : null
}

describe('shapeForKind', () => {
  it('maps takeoff geometry to the annotation that means it', () => {
    expect(shapeForKind('area')).toBe('polygon')
    expect(shapeForKind('cutout')).toBe('polygon')
    expect(shapeForKind('polyline')).toBe('polyline')
    expect(shapeForKind('count')).toBe('circle')
  })

  it('declines the kinds that are not takeoff', () => {
    // These carry their payload in `content`, so writing the outline alone
    // would put unlabelled boxes on a consultant's drawing.
    for (const k of ['shape', 'calibration', 'dimension', 'callout', 'highlight']) {
      expect(shapeForKind(k), k).toBeNull()
    }
  })
})

describe('linear and count markups', () => {
  it('writes a linear markup as a PolyLine', async () => {
    const a = (await annotsOf(await writeMarkupsToPdf(await blank(), [line()])))[0]!
    expect(a.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('PolyLine'))
    expect(strOf(a, 'Subj')).toBe('Length')
  })

  it('gives a run no interior colour', async () => {
    // A filled polyline draws a region the estimator never measured.
    const a = (await annotsOf(await writeMarkupsToPdf(await blank(), [line()])))[0]!
    expect(a.lookup(PDFName.of('IC'))).toBeUndefined()
  })

  it('keeps every vertex of a run', async () => {
    // A three-point run written as two points is a different length.
    const a = (await annotsOf(await writeMarkupsToPdf(await blank(), [line()])))[0]!
    expect((a.lookup(PDFName.of('Vertices')) as PDFArray).size()).toBe(6)
  })

  it('writes a count as a marker with an extent', async () => {
    // One vertex has no bounding box, and a Rect of zero size is invisible.
    const a = (await annotsOf(await writeMarkupsToPdf(await blank(), [mark()])))[0]!
    expect(a.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('Circle'))
    expect(strOf(a, 'Subj')).toBe('Count')
    const r = a.lookup(PDFName.of('Rect')) as PDFArray
    const width = (r.lookup(2) as PDFNumber).asNumber() - (r.lookup(0) as PDFNumber).asNumber()
    expect(width).toBeGreaterThan(6)
  })

  it('writes nothing for a kind that is not takeoff', async () => {
    const note = { ...line('x'), kind: 'callout' }
    expect(await annotsOf(await writeMarkupsToPdf(await blank(), [note]))).toHaveLength(0)
  })

  it('still refuses a run of one point', async () => {
    const stub = { ...line(), rings: [[{ x: 0.1, y: 0.1 }]] }
    expect(await annotsOf(await writeMarkupsToPdf(await blank(), [stub]))).toHaveLength(0)
  })
})

describe('measurement', () => {
  // 0.25 ft per point, so an inch of paper is 18 ft of building.
  const scales = new Map([[0, 0.25]])

  it('gives the page a scale a reader can measure with', async () => {
    const m = await pageMeasure(await writeMarkupsToPdf(
      await blank(), [area()], { pageScales: scales },
    ))
    expect(m).not.toBeNull()
    expect(m!.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('RL'))
  })

  it('states the scale the way a drawing does', async () => {
    // 0.25 x 72 = 18. Bluebeam shows this string verbatim as the page scale.
    const m = await pageMeasure(await writeMarkupsToPdf(
      await blank(), [area()], { pageScales: scales },
    ))
    expect((m!.lookup(PDFName.of('R')) as PDFString).asString()).toBe('1 in = 18 ft')
  })

  it('converts one point to feet on both axes', async () => {
    // The conversion IS the calibration. If this drifts, every length the
    // recipient measures disagrees with the BOM they were sent.
    const m = await pageMeasure(await writeMarkupsToPdf(
      await blank(), [area()], { pageScales: scales },
    ))
    for (const axis of ['X', 'Y']) {
      const nf = (m!.lookup(PDFName.of(axis)) as PDFArray).lookup(0) as PDFDict
      expect((nf.lookup(PDFName.of('C')) as PDFNumber).asNumber(), axis).toBe(0.25)
      expect((nf.lookup(PDFName.of('U')) as PDFString).asString(), axis).toBe('ft')
    }
  })

  it('formats area in square feet, not square points', async () => {
    const m = await pageMeasure(await writeMarkupsToPdf(
      await blank(), [area()], { pageScales: scales },
    ))
    const nf = (m!.lookup(PDFName.of('A')) as PDFArray).lookup(0) as PDFDict
    expect((nf.lookup(PDFName.of('U')) as PDFString).asString()).toBe('sq ft')
  })

  it('writes one viewport per sheet however many markups it carries', async () => {
    // Three areas on a page is still one page at one scale.
    const out = await writeMarkupsToPdf(
      await blank(), [area('a'), area('b'), area('c')], { pageScales: scales },
    )
    const doc = await PDFDocument.load(out)
    expect((doc.getPages()[0]!.node.get(PDFName.of('VP')) as PDFArray).size()).toBe(1)
  })

  it('replaces a viewport the drawing already had rather than joining it', async () => {
    // Two viewports over the same area is ambiguous, and our quantities came
    // from OUR calibration: a sheet that measures to something else while
    // carrying our numbers is worse than one that does not measure at all.
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    page.node.set(PDFName.of('VP'), doc.context.obj([doc.context.obj({ Type: 'Viewport' })]))
    const out = await writeMarkupsToPdf(await doc.save(), [area()], { pageScales: scales })
    const back = await PDFDocument.load(out)
    expect((back.getPages()[0]!.node.get(PDFName.of('VP')) as PDFArray).size()).toBe(1)
    expect(await pageMeasure(out)).not.toBeNull()
  })

  it('marks a measurement as one, so it lists with a quantity', async () => {
    const a = (await annotsOf(await writeMarkupsToPdf(await blank(), [area()])))[0]!
    expect(a.lookup(PDFName.of('IT'))).toBe(PDFName.of('PolygonDimension'))
    const l = (await annotsOf(await writeMarkupsToPdf(await blank(), [line()])))[0]!
    expect(l.lookup(PDFName.of('IT'))).toBe(PDFName.of('PolyLineDimension'))
  })

  it('gives each annotation its own copy of the scale', async () => {
    // So it still measures correctly if it is copied onto another sheet.
    const out = await writeMarkupsToPdf(await blank(), [area()], { pageScales: scales })
    expect((await annotsOf(out))[0]!.lookup(PDFName.of('Measure'))).toBeInstanceOf(PDFDict)
  })

  it('leaves an uncalibrated page unscaled rather than guessing', async () => {
    // The failure that matters is a sheet measuring confidently to the wrong
    // number, so a page nobody calibrated gets no scale at all — not the
    // scale of the sheet next to it.
    const out = await writeMarkupsToPdf(
      await blank(), [area()], { pageScales: new Map([[1, 0.25]]) },
    )
    expect(await pageMeasure(out)).toBeNull()
    expect((await annotsOf(out))[0]!.lookup(PDFName.of('Measure'))).toBeUndefined()
  })

  it('scales each sheet on its own terms', async () => {
    // A details sheet is not at the scale of the plan beside it, and one
    // document holds both.
    const out = await writeMarkupsToPdf(
      await blank(),
      [area('a'), { ...area('b'), pageIndex: 1 }],
      { pageScales: new Map([[0, 0.25], [1, 0.0625]]) },
    )
    const first = await pageMeasure(out, 0)
    const second = await pageMeasure(out, 1)
    expect((first!.lookup(PDFName.of('R')) as PDFString).asString()).toBe('1 in = 18 ft')
    expect((second!.lookup(PDFName.of('R')) as PDFString).asString()).toBe('1 in = 4.5 ft')
  })
})

describe('scale regions in the file', () => {
  // A details sheet: the plan scale on the page, a tighter scale on one detail.
  const detail: WritableScaleRegion = {
    rect: { x0: 0.5, y0: 0, x1: 1, y1: 0.5 },
    feetPerPoint: 0.03125,
    label: 'Detail 3 / head',
  }
  const regions = new Map([[0, [detail]]])
  const scales = new Map([[0, 0.25]])

  /** Every viewport on a page, in file order. */
  async function viewports(bytes: Uint8Array): Promise<PDFDict[]> {
    const doc = await PDFDocument.load(bytes)
    const vp = doc.getPages()[0]!.node.get(PDFName.of('VP'))
    if (!(vp instanceof PDFArray)) return []
    const out: PDFDict[] = []
    for (let i = 0; i < vp.size(); i++) out.push(vp.lookup(i) as PDFDict)
    return out
  }

  const ratioOf = (v: PDFDict): string =>
    ((v.lookup(PDFName.of('Measure')) as PDFDict).lookup(PDFName.of('R')) as PDFString).asString()

  it('writes the page scale and each region', async () => {
    const out = await writeMarkupsToPdf(
      await blank(), [area()], { pageScales: scales, pageRegions: regions },
    )
    expect(await viewports(out)).toHaveLength(2)
  })

  it('puts the sheet scale FIRST and the region after it', async () => {
    // Order is the semantics: where viewports overlap a reader takes the LAST
    // one containing the point. Reversed, every detail would measure at the
    // plan scale in Bluebeam while measuring correctly in REDBEAM.
    const out = await writeMarkupsToPdf(
      await blank(), [area()], { pageScales: scales, pageRegions: regions },
    )
    const vps = await viewports(out)
    expect(ratioOf(vps[0]!)).toBe('1 in = 18 ft')
    expect(ratioOf(vps[1]!)).toBe('1 in = 2.25 ft')
  })

  it('orders regions largest first, so a nested one wins', async () => {
    // Matches the app's smallest-wins rule. A detail inside a detail has to
    // resolve the same way in the file as it does on screen.
    const outer: WritableScaleRegion = {
      rect: { x0: 0, y0: 0, x1: 1, y1: 1 }, feetPerPoint: 0.25, label: 'outer',
    }
    const inner: WritableScaleRegion = {
      rect: { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 }, feetPerPoint: 0.01, label: 'inner',
    }
    const out = await writeMarkupsToPdf(await blank(), [area()], {
      pageRegions: new Map([[0, [inner, outer]]]),
    })
    const vps = await viewports(out)
    expect(vps.map((v) => (v.lookup(PDFName.of('Name')) as PDFString).asString()))
      .toEqual(['outer', 'inner'])
  })

  it('measures a markup at the scale of the region it sits in', async () => {
    // The annotation's own /Measure has to agree with the quantity REDBEAM
    // reported for it, or the sheet contradicts the BOM it was sent with.
    const inDetail = { ...area('d'), rings: [[
      { x: 0.6, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.4 }, { x: 0.6, y: 0.4 },
    ]] }
    const out = await writeMarkupsToPdf(
      await blank(), [inDetail], { pageScales: scales, pageRegions: regions },
    )
    const doc = await PDFDocument.load(out)
    const annots = doc.getPages()[0]!.node.get(PDFName.of('Annots')) as PDFArray
    const m = (annots.lookup(0) as PDFDict).lookup(PDFName.of('Measure')) as PDFDict
    expect((m.lookup(PDFName.of('R')) as PDFString).asString()).toBe('1 in = 2.25 ft')
  })

  it('writes regions even on a page with no sheet-wide scale', async () => {
    // A details page is often ONLY regions. Requiring a page scale first
    // would leave those sheets unmeasurable.
    const out = await writeMarkupsToPdf(await blank(), [area()], { pageRegions: regions })
    const vps = await viewports(out)
    expect(vps).toHaveLength(1)
    expect(ratioOf(vps[0]!)).toBe('1 in = 2.25 ft')
  })

  it('converts a region box into page space, origin and all', async () => {
    // The same origin bug as the markups: a region on an origin-centred
    // CropBox lands half a sheet away if the box origin is assumed to be zero.
    const doc = await PDFDocument.create()
    doc.addPage([612, 792]).setCropBox(-306, -396, 612, 792)
    const out = await writeMarkupsToPdf(await doc.save(), [area()], { pageRegions: regions })
    const bbox = (await viewports(out))[0]!.lookup(PDFName.of('BBox')) as PDFArray
    // x from 0.5 of the width: -306 + 306 = 0.
    expect((bbox.lookup(0) as PDFNumber).asNumber()).toBeCloseTo(0, 6)
    expect((bbox.lookup(2) as PDFNumber).asNumber()).toBeCloseTo(306, 6)
  })
})
