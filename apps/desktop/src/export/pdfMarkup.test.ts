/**
 * The write-back is the first thing in this codebase whose output is read by
 * software we do not control, so the tests are about the FILE rather than the
 * function: every assertion loads the produced PDF back and looks at what a
 * reader would see.
 *
 * The coordinate cases are the point. A markup written to the wrong place
 * still produces a perfectly valid PDF with a perfectly plausible annotation
 * on it, and nothing but a person looking at the sheet would ever notice.
 */
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString, degrees } from 'pdf-lib'
import { toUserSpace, toPdfColor, writeMarkupsToPdf, type WritableMarkup } from './pdfMarkup.js'

const square = (id = 'm1'): WritableMarkup => ({
  id,
  pageIndex: 0,
  kind: 'area',
  // A quarter-size square in the TOP-LEFT of the display.
  rings: [[{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.3 }, { x: 0.1, y: 0.3 }]],
  scopeLabel: 'C-MT-01',
  color: '#CA4139',
  note: '4,128.8 SF',
})

/** A one-page PDF, optionally with a shifted box or a rotation. */
async function blank(opts: {
  size?: [number, number]
  cropBox?: [number, number, number, number]
  rotation?: number
} = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage(opts.size ?? [612, 792])
  if (opts.cropBox) page.setCropBox(...opts.cropBox)
  if (opts.rotation !== undefined) page.setRotation(degrees(opts.rotation))
  return doc.save()
}

/** Every annotation on page 0 of a produced file. */
async function annotsOf(bytes: Uint8Array): Promise<PDFDict[]> {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPages()[0]!
  const arr = page.node.get(PDFName.of('Annots'))
  if (!(arr instanceof PDFArray)) return []
  const out: PDFDict[] = []
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.lookup(i)
    if (v instanceof PDFDict) out.push(v)
  }
  return out
}

const verticesOf = (a: PDFDict): number[] => {
  const v = a.lookup(PDFName.of('Vertices'))
  if (!(v instanceof PDFArray)) return []
  const out: number[] = []
  for (let i = 0; i < v.size(); i++) {
    const n = v.lookup(i)
    if (n instanceof PDFNumber) out.push(n.asNumber())
  }
  return out
}

const strOf = (a: PDFDict, key: string): string => {
  const v = a.lookup(PDFName.of(key))
  return v instanceof PDFString ? v.asString() : ''
}

describe('toUserSpace', () => {
  const box = { x: 0, y: 0, width: 600, height: 800 }

  it('flips the y axis', () => {
    // The single most consequential line in the file. Normalized (0,0) is the
    // TOP-left of what was displayed; PDF (0,0) is the BOTTOM-left. Getting
    // this backwards mirrors every markup about the middle of the sheet and
    // produces a file that looks entirely reasonable.
    expect(toUserSpace({ x: 0, y: 0 }, box, 0)).toEqual({ x: 0, y: 800 })
    expect(toUserSpace({ x: 0, y: 1 }, box, 0)).toEqual({ x: 0, y: 0 })
  })

  it('adds the box origin back', () => {
    // Normalization threw the origin away. This set has origin-centred
    // CropBoxes, and assuming (0,0) is the bug that broke geometry extraction
    // once already — it puts every markup half a sheet away.
    const centred = { x: -306, y: -396, width: 612, height: 792 }
    expect(toUserSpace({ x: 0, y: 1 }, centred, 0)).toEqual({ x: -306, y: -396 })
    expect(toUserSpace({ x: 1, y: 0 }, centred, 0)).toEqual({ x: 306, y: 396 })
  })

  it.each([0, 90, 180, 270])('maps the unit square onto the box at %i degrees', (rot) => {
    // Each rotation must be a bijection of the corners onto the corners: no
    // corner unused, none doubled, nothing off the page. That catches a
    // transposed axis without re-deriving the algebra in the assertion.
    const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
    const got = corners.map((c) => toUserSpace(c, box, rot))
    const key = (p: { x: number, y: number }) => `${p.x},${p.y}`
    expect(new Set(got.map(key))).toEqual(
      new Set(['0,0', '600,0', '600,800', '0,800']),
    )
  })

  it('runs the display x axis along the page y axis at 90 degrees', () => {
    // The case worth stating on its own: on a rotated page the two spaces
    // disagree about which axis is which, so `y` scales WIDTH here.
    expect(toUserSpace({ x: 0, y: 1 }, box, 90)).toEqual({ x: 600, y: 0 })
    expect(toUserSpace({ x: 1, y: 0 }, box, 90)).toEqual({ x: 0, y: 800 })
  })

  it('normalises junk rotations rather than falling through', () => {
    // Page /Rotate is an integer multiple of 90 by spec and not by habit.
    expect(toUserSpace({ x: 0, y: 0 }, box, 360)).toEqual(toUserSpace({ x: 0, y: 0 }, box, 0))
    expect(toUserSpace({ x: 0, y: 0 }, box, -90)).toEqual(toUserSpace({ x: 0, y: 0 }, box, 270))
  })
})

describe('toPdfColor', () => {
  it('converts to the 0..1 triple PDF wants', () => {
    expect(toPdfColor('#ffffff')).toEqual([1, 1, 1])
    expect(toPdfColor('#000000')).toEqual([0, 0, 0])
  })

  it('reads an unparseable colour as black rather than throwing', () => {
    // A bad colour must not cost the whole export.
    expect(toPdfColor('rebeccapurple')).toEqual([0, 0, 0])
  })
})

describe('writeMarkupsToPdf', () => {
  it('writes a Polygon annotation a reader can find', async () => {
    const out = await writeMarkupsToPdf(await blank(), [square()])
    const annots = await annotsOf(out)
    expect(annots).toHaveLength(1)
    expect(annots[0]!.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('Polygon'))
  })

  it('puts the markup where it was drawn', async () => {
    // Drawn in the top-left of a 612x792 sheet: x from 0.1 to 0.4 of the
    // width, y from 0.1 to 0.3 DOWN from the top. So user space y must be
    // high, not low.
    const out = await writeMarkupsToPdf(await blank(), [square()])
    const v = verticesOf((await annotsOf(out))[0]!)
    expect(v[0]).toBeCloseTo(61.2, 6)   // 0.1 * 612
    expect(v[1]).toBeCloseTo(712.8, 6)  // 792 - 0.1 * 792
    expect(v[4]).toBeCloseTo(244.8, 6)  // 0.4 * 612
    expect(v[5]).toBeCloseTo(554.4, 6)  // 792 - 0.3 * 792
  })

  it('honours an origin-centred CropBox', async () => {
    // The regression that matters most: a box starting anywhere but (0,0).
    const src = await blank({ size: [612, 792], cropBox: [-306, -396, 612, 792] })
    const out = await writeMarkupsToPdf(src, [square()])
    const v = verticesOf((await annotsOf(out))[0]!)
    expect(v[0]).toBeCloseTo(-244.8, 6) // -306 + 61.2
    expect(v[1]).toBeCloseTo(316.8, 6)  // -396 + 712.8
  })

  it('carries the scope, the measurement and the markup id', async () => {
    // Bluebeam sorts its markup list by author and subject; the id is what
    // makes a written annotation traceable back to the row it came from.
    const a = (await annotsOf(await writeMarkupsToPdf(await blank(), [square()])))[0]!
    expect(strOf(a, 'T')).toBe('C-MT-01')
    expect(strOf(a, 'Contents')).toBe('4,128.8 SF')
    expect(strOf(a, 'NM')).toBe('m1')
    expect(strOf(a, 'Subj')).toBe('Area')
  })

  it('labels a cutout as one, since PDF has no subtype for a hole', async () => {
    const cut = { ...square('c1'), kind: 'cutout' }
    const a = (await annotsOf(await writeMarkupsToPdf(await blank(), [cut])))[0]!
    expect(strOf(a, 'Subj')).toBe('Cutout')
  })

  it('carries an appearance stream, so it renders in any reader', async () => {
    // Without /AP the annotation is at the reader's discretion, and readers
    // disagree. An empty-looking sheet is the failure this prevents.
    const a = (await annotsOf(await writeMarkupsToPdf(await blank(), [square()])))[0]!
    const ap = a.lookup(PDFName.of('AP'))
    expect(ap).toBeInstanceOf(PDFDict)
    expect((ap as PDFDict).get(PDFName.of('N'))).toBeDefined()
  })

  it('prints', async () => {
    // /F bit 3. A markup that vanishes when the sheet is printed is not on
    // the drawing as far as anyone in a trailer is concerned.
    const a = (await annotsOf(await writeMarkupsToPdf(await blank(), [square()])))[0]!
    const flags = a.lookup(PDFName.of('F'))
    expect((flags as PDFNumber).asNumber() & 4).toBe(4)
  })

  it('keeps the border clear of the Rect edge', async () => {
    // A Rect drawn tight to the vertices clips the outer half of its own
    // stroke, which reads as a hairline gap along the top and right.
    const a = (await annotsOf(await writeMarkupsToPdf(await blank(), [square()])))[0]!
    const r = a.lookup(PDFName.of('Rect')) as PDFArray
    const lo = (r.lookup(0) as PDFNumber).asNumber()
    expect(lo).toBeLessThan(61.2)
  })

  it('writes several markups onto one page', async () => {
    const out = await writeMarkupsToPdf(await blank(), [square('a'), square('b'), square('c')])
    expect(await annotsOf(out)).toHaveLength(3)
  })

  it('skips a markup naming a page the document does not have', async () => {
    // A scope spans documents. Handing this file another document's markups
    // is a caller bug, and inventing a page for them would hide it.
    const out = await writeMarkupsToPdf(await blank(), [{ ...square(), pageIndex: 7 }])
    expect(await annotsOf(out)).toHaveLength(0)
  })

  it('skips a ring with no interior', async () => {
    const thin = { ...square(), rings: [[{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }]] }
    expect(await annotsOf(await writeMarkupsToPdf(await blank(), [thin]))).toHaveLength(0)
  })

  it('leaves the source bytes alone', async () => {
    // The original is an issued consultant set; editing it in place would be
    // an unpleasant surprise.
    const src = await blank()
    const before = src.slice()
    await writeMarkupsToPdf(src, [square()])
    expect(src).toEqual(before)
  })

  it('does not disturb annotations the drawing already had', async () => {
    // Consultant sets arrive with revision clouds and stamps on them.
    const first = await writeMarkupsToPdf(await blank(), [square('a')])
    const second = await writeMarkupsToPdf(first, [square('b')])
    const ids = (await annotsOf(second)).map((a) => strOf(a, 'NM'))
    expect(ids).toEqual(['a', 'b'])
  })
})
