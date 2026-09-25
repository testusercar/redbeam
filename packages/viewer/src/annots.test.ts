import { describe, expect, it } from 'vitest'
import { extractPageAnnotations, type AnnotBackend, type AnnotPoint } from './annots.js'
import type { PageBox } from './text.js'

/** The real PKG A sheet's box: origin-centred, the case that breaks (0,0) assumptions. */
const CENTRED: PageBox = { left: -1728, bottom: -1296, right: 1728, top: 1296 }

interface FakeAnnot {
  subtype: number
  rect?: PageBox
  vertices?: AnnotPoint[]
  line?: [AnnotPoint, AnnotPoint]
  ink?: AnnotPoint[][]
  strings?: Record<string, string>
  color?: { r: number; g: number; b: number; a: number }
  refuse?: boolean
}

function fake(annots: FakeAnnot[], box: PageBox = CENTRED): AnnotBackend & { openHandles: number[] } {
  const opened: number[] = []
  return {
    openHandles: opened,
    count: () => annots.length,
    // Handles are 1-based so 0 can mean "refused".
    open: (_page, i) => (annots[i]!.refuse ? 0 : (opened.push(i + 1), i + 1)),
    close: (a) => { opened.splice(opened.indexOf(a), 1) },
    subtype: (a) => annots[a - 1]!.subtype,
    rect: (a) => annots[a - 1]!.rect ?? null,
    vertices: (a) => annots[a - 1]!.vertices ?? [],
    line: (a) => annots[a - 1]!.line ?? null,
    inkPaths: (a) => annots[a - 1]!.ink ?? [],
    stringValue: (a, key) => annots[a - 1]!.strings?.[key] ?? '',
    color: (a) => annots[a - 1]!.color ?? null,
    pageBox: () => box,
  }
}

describe('extractPageAnnotations', () => {
  it('normalizes a polygon to the page box, origin-centred included', () => {
    const b = fake([{
      subtype: 7,
      rect: { left: 0, bottom: 0, right: 1728, top: 1296 },
      vertices: [{ x: 0, y: 0 }, { x: 1728, y: 0 }, { x: 1728, y: 1296 }, { x: 0, y: 1296 }],
      strings: { Subj: 'Ceiling', Contents: 'ACT-1', T: 'KM' },
      color: { r: 255, g: 0, b: 128, a: 255 },
    }])
    const [a] = extractPageAnnotations(b, 1, 0)
    expect(a).toBeDefined()
    expect(a!.subtypeName).toBe('Polygon')
    expect(a!.shape).toBe('polygon')
    // (0,0) on a centred box is the middle of the sheet; y flips.
    expect(a!.vertices[0]).toEqual({ x: 0.5, y: 0.5 })
    expect(a!.vertices[2]).toEqual({ x: 1, y: 0 })
    expect(a!.rect).toEqual({ x0: 0.5, y0: 0, x1: 1, y1: 0.5 })
    expect(a!.subject).toBe('Ceiling')
    expect(a!.contents).toBe('ACT-1')
    expect(a!.author).toBe('KM')
    expect(a!.color).toBe('#ff0080')
  })

  it('reads a line from its ends and an ink annotation from its strokes', () => {
    const b = fake([
      { subtype: 4, rect: CENTRED, line: [{ x: -1728, y: 0 }, { x: 1728, y: 0 }] },
      { subtype: 15, rect: CENTRED, ink: [[{ x: -1728, y: 1296 }, { x: 0, y: 0 }], [{ x: 0, y: 0 }]] },
    ])
    const [line, ink] = extractPageAnnotations(b, 1, 0)
    expect(line!.shape).toBe('polyline')
    expect(line!.vertices).toEqual([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }])
    expect(ink!.shape).toBe('ink')
    expect(ink!.ink).toEqual([[{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }], [{ x: 0.5, y: 0.5 }]])
  })

  it('leaves out notes, links, popups and form fields, and skips one PDFium refuses', () => {
    const b = fake([
      { subtype: 1, rect: CENTRED },          // sticky note
      { subtype: 2, rect: CENTRED },          // link
      { subtype: 16, rect: CENTRED },         // popup
      { subtype: 20, rect: CENTRED },         // widget
      { subtype: 5, rect: CENTRED, refuse: true },
      { subtype: 5, rect: { left: -100, bottom: -100, right: 100, top: 100 } },
    ])
    const got = extractPageAnnotations(b, 1, 0)
    expect(got).toHaveLength(1)
    expect(got[0]!.index).toBe(5)
    expect(got[0]!.shape).toBe('rect')
    expect(got[0]!.color).toBeNull()
  })

  it('closes every annotation it opened, even one without a rect', () => {
    const b = fake([{ subtype: 9 }, { subtype: 13, rect: CENTRED }])
    const got = extractPageAnnotations(b, 1, 0)
    expect(got).toHaveLength(2)
    expect(got[0]!.rect).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 })
    expect(b.openHandles).toEqual([])
  })

  it('reads the /NM name that follows a markup across saves, and its flags', () => {
    const b = fake([{ subtype: 7, rect: CENTRED, strings: { NM: 'redbeam:mk-1' } }, { subtype: 5, rect: CENTRED }])
    b.flags = (a) => (a === 1 ? 4 | 128 : 4)
    const [named, plain] = extractPageAnnotations(b, 1, 0)
    expect(named!.name).toBe('redbeam:mk-1')
    expect(named!.flags).toBe(132)
    expect(plain!.name).toBe('')
    expect(plain!.flags).toBe(4)
  })

  it('names every subtype PDFium defines', () => {
    const b = fake([{ subtype: 28, rect: CENTRED }, { subtype: 99, rect: CENTRED }])
    const [redact, unknown] = extractPageAnnotations(b, 1, 0)
    expect(redact!.subtypeName).toBe('Redact')
    expect(unknown!.subtypeName).toBe('Unknown')
    expect(unknown!.shape).toBe('other')
  })
})
