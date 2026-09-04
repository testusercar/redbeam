/**
 * Does the written file obey the PDF specification? (plan 10.6, reframed)
 *
 * 10.6 was "Bluebeam round-trip verification" — open the export in the tool an
 * estimator actually uses and confirm the markups and their measurements
 * survive. That test cannot be run: Bluebeam's automation surface needs a
 * subscription tier Maxxit does not hold, and no amount of engineering here
 * changes that. Leaving it open as a permanent blocker would be a lie about
 * what is achievable.
 *
 * This is what CAN be checked, and it is not a consolation prize. Every reader
 * — Bluebeam, Acrobat, Chromium, whatever a GC opens it in — implements the
 * same specification. If the file satisfies ISO 32000-1 then a reader that
 * mishandles it is the reader's problem and is findable; if it does not, we
 * were always going to be at the mercy of how forgiving each one happened to
 * be. So this asserts the parts of the spec a measurement annotation actually
 * turns on, on a file produced by the real writer.
 *
 * What it does NOT prove: that Bluebeam is happy. Bluebeam reads standard
 * annotations but also carries private keys of its own, and a conforming file
 * it renders badly is a gap this suite cannot see. That gap is now NAMED
 * rather than pending — see the tracker note for 10.6.
 *
 * Clause references are to ISO 32000-1:2008.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import {
  PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFStream,
} from 'pdf-lib'
import { writeMarkupsToPdf, type WritableMarkup, type WritableScaleRegion } from './pdfMarkup.js'

/** One of each geometry kind, on a calibrated sheet with a detail region. */
const MARKUPS: WritableMarkup[] = [
  {
    id: 'mk-area', pageIndex: 0, kind: 'area',
    rings: [[{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.5 }]],
    scopeLabel: 'C-MT-01', color: '#2f7fd1', note: '1,204.3 SF',
  },
  {
    id: 'mk-cut', pageIndex: 0, kind: 'cutout',
    rings: [[{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.3 }, { x: 0.2, y: 0.3 }]],
    scopeLabel: 'C-MT-01', color: '#2f7fd1', note: 'Deduction',
  },
  {
    id: 'mk-run', pageIndex: 0, kind: 'polyline',
    rings: [[{ x: 0.6, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.4 }]],
    scopeLabel: 'LV-04', color: '#e08b2a', note: '112.0 LF',
  },
  {
    id: 'mk-count', pageIndex: 0, kind: 'count',
    rings: [[{ x: 0.7, y: 0.7 }]],
    scopeLabel: 'FIX-01', color: '#8256c4', note: '1 EA',
  },
]

const REGION: WritableScaleRegion = {
  rect: { x0: 0.55, y0: 0.05, x1: 0.95, y1: 0.45 },
  feetPerPoint: 0.03125,
  label: 'Detail 3 / head',
}

let doc: PDFDocument
let page: import('pdf-lib').PDFPage
let annots: PDFDict[]

beforeAll(async () => {
  const blank = await PDFDocument.create()
  // An origin-centred CropBox, because that is what this drawing set has and a
  // conformance check on an easy page proves less.
  blank.addPage([612, 792]).setCropBox(-306, -396, 612, 792)
  const out = await writeMarkupsToPdf(await blank.save(), MARKUPS, {
    pageScales: new Map([[0, 0.1111111111111111]]),
    pageRegions: new Map([[0, [REGION]]]),
    producer: 'REDBEAM',
  })
  doc = await PDFDocument.load(out)
  page = doc.getPages()[0]!
  const arr = page.node.get(PDFName.of('Annots')) as PDFArray
  annots = []
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.lookup(i)
    if (v instanceof PDFDict) annots.push(v)
  }
})

const nums = (d: PDFDict, key: string): number[] => {
  const a = d.lookup(PDFName.of(key))
  if (!(a instanceof PDFArray)) return []
  const out: number[] = []
  for (let i = 0; i < a.size(); i++) {
    const n = a.lookup(i)
    if (n instanceof PDFNumber) out.push(n.asNumber())
  }
  return out
}

describe('annotation dictionaries (12.5.2, Table 168)', () => {
  it('writes one annotation per markup and nothing else', () => {
    expect(annots).toHaveLength(MARKUPS.length)
  })

  it('gives every annotation the required Subtype and Rect', () => {
    // Both are REQUIRED. A reader is entitled to ignore an annotation missing
    // either, which is the silent-disappearance failure mode.
    for (const a of annots) {
      expect(a.lookup(PDFName.of('Subtype'))).toBeInstanceOf(PDFName)
      expect(nums(a, 'Rect')).toHaveLength(4)
    }
  })

  it('writes Rect lower-left first, as the spec orders it', () => {
    // 7.9.5: a rectangle is [llx lly urx ury]. Writing it inverted is the kind
    // of thing a forgiving reader normalises and a strict one drops.
    for (const a of annots) {
      const [x0, y0, x1, y1] = nums(a, 'Rect')
      expect(x1!).toBeGreaterThan(x0!)
      expect(y1!).toBeGreaterThan(y0!)
    }
  })

  it('encloses every vertex within the annotation Rect', () => {
    // 12.5.2: Rect is the rectangle that encloses the annotation. A vertex
    // outside it is the annotation asking to be clipped.
    for (const a of annots) {
      const v = nums(a, 'Vertices')
      if (v.length === 0) continue
      const [x0, y0, x1, y1] = nums(a, 'Rect')
      for (let i = 0; i < v.length; i += 2) {
        expect(v[i]!).toBeGreaterThanOrEqual(x0!)
        expect(v[i]!).toBeLessThanOrEqual(x1!)
        expect(v[i + 1]!).toBeGreaterThanOrEqual(y0!)
        expect(v[i + 1]!).toBeLessThanOrEqual(y1!)
      }
    }
  })

  it('pairs every vertex coordinate', () => {
    // 12.5.6.9: Vertices is x1 y1 x2 y2 … — an odd length is malformed.
    for (const a of annots) {
      const v = nums(a, 'Vertices')
      if (v.length > 0) expect(v.length % 2).toBe(0)
    }
  })

  it('keeps annotation names unique on the page', () => {
    // 12.5.2: NM shall be unique among annotations on the same page. Ours are
    // markup ids, which is what makes an exported polygon traceable back to
    // the row it came from — and duplicates would break that traceability
    // exactly where two sheets are merged.
    const names = annots.map((a) => (a.lookup(PDFName.of('NM')) as PDFString).asString())
    expect(new Set(names).size).toBe(names.length)
  })

  it('uses only intent values the spec defines', () => {
    // 12.5.6.9: IT for Polygon is PolygonCloud or PolygonDimension; for
    // PolyLine it is PolyLineDimension. An invented value is worse than none —
    // a reader may reject the annotation rather than fall back.
    const allowed = new Set(['/PolygonDimension', '/PolyLineDimension', '/PolygonCloud'])
    for (const a of annots) {
      const it = a.lookup(PDFName.of('IT'))
      if (it === undefined) continue
      expect(allowed.has(it.toString()), `IT ${it.toString()}`).toBe(true)
    }
  })

  it('sets the Print flag and nothing that would hide the markup', () => {
    // Table 167: bit 2 Hidden, bit 3 Print, bit 6 NoView. A markup that does
    // not print is not on the drawing as far as anyone in a trailer is
    // concerned, and one flagged Hidden or NoView is worse than absent because
    // the file looks like it has them.
    for (const a of annots) {
      const f = (a.lookup(PDFName.of('F')) as PDFNumber).asNumber()
      expect(f & 4, 'Print').toBe(4)
      expect(f & 2, 'Hidden').toBe(0)
      expect(f & 32, 'NoView').toBe(0)
    }
  })
})

describe('appearance streams (12.5.5)', () => {
  it('gives every annotation a normal appearance', () => {
    // Without /AP a reader MAY synthesise one and readers disagree about
    // whether they will. This is the difference between a sheet that looks
    // right everywhere and one that looks empty in whichever viewer the GC
    // opens.
    for (const a of annots) {
      const ap = a.lookup(PDFName.of('AP')) as PDFDict
      expect(ap).toBeInstanceOf(PDFDict)
      expect(ap.lookup(PDFName.of('N'))).toBeInstanceOf(PDFStream)
    }
  })

  it('makes the appearance a form XObject with a BBox', () => {
    // 8.10.2: a form XObject shall have Subtype /Form and a BBox. A missing
    // BBox is undefined behaviour, and in practice means nothing is drawn.
    for (const a of annots) {
      const n = (a.lookup(PDFName.of('AP')) as PDFDict).lookup(PDFName.of('N')) as PDFStream
      const d = n.dict
      expect(d.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('Form'))
      expect(nums(d as unknown as PDFDict, 'BBox')).toHaveLength(4)
    }
  })

  it('matches the appearance BBox to the annotation Rect', () => {
    // 12.5.5: the appearance is mapped onto Rect via its BBox and Matrix. With
    // an identity Matrix the two must agree, or the drawing is scaled and
    // offset inside its own box — which reads as a markup in the wrong place.
    for (const a of annots) {
      const n = (a.lookup(PDFName.of('AP')) as PDFDict).lookup(PDFName.of('N')) as PDFStream
      const bbox = nums(n.dict as unknown as PDFDict, 'BBox')
      const rect = nums(a, 'Rect')
      for (let i = 0; i < 4; i++) expect(bbox[i]!).toBeCloseTo(rect[i]!, 6)
    }
  })

  it('declares the resources its content stream names', () => {
    // The alpha comes from an ExtGState referenced as /GS. A content stream
    // naming a resource its dictionary does not declare is an error, and the
    // usual result is that the operator is ignored — here, a fill at full
    // opacity over the drawing.
    for (const a of annots) {
      const n = (a.lookup(PDFName.of('AP')) as PDFDict).lookup(PDFName.of('N')) as PDFStream
      const res = n.dict.lookup(PDFName.of('Resources')) as PDFDict
      const gs = res.lookup(PDFName.of('ExtGState')) as PDFDict
      expect(gs.lookup(PDFName.of('GS'))).toBeInstanceOf(PDFDict)
    }
  })
})

describe('measurement (12.9)', () => {
  const measures = (): PDFDict[] => {
    const vp = page.node.get(PDFName.of('VP')) as PDFArray
    const out: PDFDict[] = []
    for (let i = 0; i < vp.size(); i++) {
      out.push((vp.lookup(i) as PDFDict).lookup(PDFName.of('Measure')) as PDFDict)
    }
    return out
  }

  it('writes viewports with the required BBox', () => {
    // Table 260: BBox is REQUIRED on a viewport. Without it the measurement
    // applies to nothing.
    const vp = page.node.get(PDFName.of('VP')) as PDFArray
    expect(vp.size()).toBe(2) // the sheet, then the detail
    for (let i = 0; i < vp.size(); i++) {
      const v = vp.lookup(i) as PDFDict
      expect(v.lookup(PDFName.of('Type'))).toBe(PDFName.of('Viewport'))
      expect(nums(v, 'BBox')).toHaveLength(4)
    }
  })

  it('writes rectilinear measurements with every required entry', () => {
    // Table 261: for /RL, R X D A are required. Y defaults to X when absent;
    // we write it, which is legal and explicit.
    for (const m of measures()) {
      expect(m.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('RL'))
      expect(m.lookup(PDFName.of('R'))).toBeInstanceOf(PDFString)
      for (const key of ['X', 'Y', 'D', 'A']) {
        expect(m.lookup(PDFName.of(key)), key).toBeInstanceOf(PDFArray)
      }
    }
  })

  it('writes number formats with a unit and a conversion', () => {
    // Table 262: U and C are REQUIRED. C is the conversion this whole feature
    // turns on — it IS the calibration, and a reader with no C cannot measure.
    for (const m of measures()) {
      for (const key of ['X', 'Y', 'D', 'A']) {
        const nf = (m.lookup(PDFName.of(key)) as PDFArray).lookup(0) as PDFDict
        expect(nf.lookup(PDFName.of('U')), `${key}.U`).toBeInstanceOf(PDFString)
        expect(nf.lookup(PDFName.of('C')), `${key}.C`).toBeInstanceOf(PDFNumber)
        expect((nf.lookup(PDFName.of('C')) as PDFNumber).asNumber()).toBeGreaterThan(0)
      }
    }
  })

  it('states the sheet scale as a drawing states it', () => {
    // 0.1111… ft per point x 72 points per inch = 8 ft to the inch. Readers
    // show R verbatim, so it has to read the way a title block does.
    const r = (measures()[0]!.lookup(PDFName.of('R')) as PDFString).asString()
    expect(r).toBe('1 in = 8 ft')
  })

  it('keeps every viewport BBox on the page', () => {
    // A viewport whose box falls outside the page governs nothing. This page
    // has an origin-centred CropBox, which is where that goes wrong.
    const box = page.getCropBox()
    const vp = page.node.get(PDFName.of('VP')) as PDFArray
    for (let i = 0; i < vp.size(); i++) {
      const [x0, y0, x1, y1] = nums(vp.lookup(i) as PDFDict, 'BBox')
      expect(x0!).toBeGreaterThanOrEqual(box.x - 1)
      expect(y0!).toBeGreaterThanOrEqual(box.y - 1)
      expect(x1!).toBeLessThanOrEqual(box.x + box.width + 1)
      expect(y1!).toBeLessThanOrEqual(box.y + box.height + 1)
    }
  })
})

describe('the file itself', () => {
  it('reloads without loss', async () => {
    // A file that parses once and not twice is one that will fail on whichever
    // machine opens it second.
    const again = await PDFDocument.load(await doc.save())
    const arr = again.getPages()[0]!.node.get(PDFName.of('Annots')) as PDFArray
    expect(arr.size()).toBe(MARKUPS.length)
  })
})
