/**
 * Synthetic drawings for the interchange tests. No client drawing is used:
 * every file here is built from nothing, with annotations shaped the way
 * Bluebeam writes them.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, type PDFRef } from 'pdf-lib'

export interface ForeignSheet {
  bytes: Uint8Array
  names: {
    measured: string
    reply: string
    groupHead: string
    groupMember: string
    locked: string
    cloud: string
  }
}

const N = (s: string) => PDFName.of(s)

/**
 * One 1224x792 sheet with an origin-centred CropBox and six Bluebeam-style
 * markups: a measured area carrying a custom column and a status reply, a
 * two-member group, a locked polygon and a cloud.
 */
export async function foreignSheet(): Promise<ForeignSheet> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([1224, 792])
  page.setMediaBox(-612, -396, 1224, 792)
  page.setCropBox(-612, -396, 1224, 792)
  const ctx = doc.context
  const refs: PDFRef[] = []
  const add = (o: Record<string, unknown>): PDFRef => {
    const ref = ctx.register(ctx.obj(o as never))
    refs.push(ref)
    return ref
  }
  const polygon = (nm: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
    Type: 'Annot', Subtype: 'Polygon', NM: PDFString.of(nm),
    Rect: [x - 2, y - 2, x + 102, y + 102],
    Vertices: [x, y, x + 100, y, x + 100, y + 100, x, y + 100],
    C: [1, 0, 0], F: 4, T: PDFString.of('Kenneth'), Subj: PDFString.of('Area Measurement'),
    ...extra,
  })

  const measured = add(polygon('BB0000000000MEAS', -500, -300, {
    IT: N('PolygonDimension'),
    Contents: PDFString.of('1,234.5 sf'),
    Measure: ctx.obj({ Type: 'Measure', Subtype: 'RL', R: PDFString.of('1 in = 8 ft') }),
    BSIColumnData: ctx.obj([PDFString.of('Level 2'), PDFString.of('Phase A')]),
  }))
  add({
    Type: 'Annot', Subtype: 'Text', NM: PDFString.of('BB00000000REPLY1'),
    Rect: [-500, -300, -480, -280], IRT: measured, T: PDFString.of('Aaron'),
    State: PDFString.of('Accepted'), StateModel: PDFString.of('Review'), Contents: PDFString.of('Accepted'),
  })
  const head = add(polygon('BB00000000GROUP0', -300, -300))
  add({ ...polygon('BB00000000GROUP1', -150, -300), IRT: head, RT: N('Group') })
  add(polygon('BB0000000LOCKED0', 0, -300, { F: 4 | 128 }))
  add(polygon('BB00000000CLOUD0', 150, -300, { IT: N('PolygonCloud'), BE: ctx.obj({ S: N('C'), I: 1 }) }))

  page.node.set(N('Annots'), ctx.obj(refs))
  return {
    bytes: await doc.save({ useObjectStreams: false }),
    names: {
      measured: 'BB0000000000MEAS', reply: 'BB00000000REPLY1', groupHead: 'BB00000000GROUP0',
      groupMember: 'BB00000000GROUP1', locked: 'BB0000000LOCKED0', cloud: 'BB00000000CLOUD0',
    },
  }
}

/** A blank sheet with an origin-centred CropBox. */
export async function blankSheet(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([1224, 792])
  page.setMediaBox(-612, -396, 1224, 792)
  page.setCropBox(-612, -396, 1224, 792)
  return doc.save({ useObjectStreams: false })
}

/** The same sheet, carrying a signature field with a value. */
export async function signedSheet(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await blankSheet())
  const ctx = doc.context
  const sig = ctx.register(ctx.obj({ Type: 'Sig', Filter: N('Adobe.PPKLite'), Contents: PDFString.of('00') }))
  const field = ctx.register(ctx.obj({
    FT: N('Sig'), T: PDFString.of('Engineer'), V: sig, Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 0, 0],
  }))
  doc.catalog.set(N('AcroForm'), ctx.obj({ Fields: ctx.obj([field]), SigFlags: 3 }))
  doc.getPages()[0]!.node.set(N('Annots'), ctx.obj([field]))
  return doc.save({ useObjectStreams: false })
}

/** The same sheet with an /Encrypt entry in its trailer: a locked file. */
export async function lockedSheet(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await blankSheet())
  const ctx = doc.context
  const enc = ctx.register(ctx.obj({ Filter: N('Standard'), V: 2, R: 3, Length: 128, P: -3904 }))
  ctx.trailerInfo.Encrypt = enc
  return doc.save({ useObjectStreams: false })
}

/**
 * What Bluebeam does when a shape is dragged: the same dictionary, same /NM,
 * new vertices. `dx`/`dy` in points.
 */
export async function moveInBluebeam(bytes: Uint8Array, name: string, dx: number, dy: number): Promise<Uint8Array> {
  return editAnnot(bytes, name, (d) => {
    const v = d.lookup(N('Vertices')) as PDFArray
    const moved: number[] = []
    for (let i = 0; i < v.size(); i++) moved.push((v.lookup(i) as unknown as { asNumber(): number }).asNumber() + (i % 2 === 0 ? dx : dy))
    d.set(N('Vertices'), d.context.obj(moved))
  })
}

/** Stretch: move one vertex. */
export async function stretchInBluebeam(bytes: Uint8Array, name: string, vertex: number, dx: number, dy: number): Promise<Uint8Array> {
  return editAnnot(bytes, name, (d) => {
    const v = d.lookup(N('Vertices')) as PDFArray
    const pts: number[] = []
    for (let i = 0; i < v.size(); i++) pts.push((v.lookup(i) as unknown as { asNumber(): number }).asNumber())
    pts[vertex * 2] = pts[vertex * 2]! + dx
    pts[vertex * 2 + 1] = pts[vertex * 2 + 1]! + dy
    d.set(N('Vertices'), d.context.obj(pts))
  })
}

/** Replace the note, as someone clearing the comment in Bluebeam would. */
export async function setNote(bytes: Uint8Array, name: string, text: string): Promise<Uint8Array> {
  return editAnnot(bytes, name, (d) => { d.set(N('Contents'), PDFString.of(text)) })
}

async function editAnnot(bytes: Uint8Array, name: string, edit: (d: PDFDict) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  for (const page of doc.getPages()) {
    const arr = page.node.lookup(N('Annots'))
    if (!(arr instanceof PDFArray)) continue
    for (let i = 0; i < arr.size(); i++) {
      const d = arr.lookup(i)
      if (d instanceof PDFDict && (d.lookup(N('NM')) as PDFString | undefined)?.decodeText() === name) edit(d)
    }
  }
  return doc.save({ useObjectStreams: false })
}

/** Every annotation dictionary on page 0, by /NM, for comparing before and after. */
export async function dictsByName(bytes: Uint8Array): Promise<Map<string, PDFDict>> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const out = new Map<string, PDFDict>()
  const arr = doc.getPages()[0]!.node.lookup(N('Annots'))
  if (!(arr instanceof PDFArray)) return out
  for (let i = 0; i < arr.size(); i++) {
    const d = arr.lookup(i)
    if (d instanceof PDFDict) out.set((d.lookup(N('NM')) as PDFString).decodeText(), d)
  }
  return out
}
