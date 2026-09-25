/**
 * Markup interchange, end to end on synthetic drawings: bake, reopen,
 * Bluebeam edits, refusals, and other software's markups left intact.
 */
import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { applyInterchange, inspectPdf, type PdfAnnot } from './pdfInterchange.js'
import { planBake, type BakeScope } from './bakePlan.js'
import { reconcile, type InterchangeRecord, type Layout, type LiveMarkup } from './reconcile.js'
import { annotationName, decodeNote, noteText } from './payload.js'
import {
  blankSheet, dictsByName, foreignSheet, lockedSheet, moveInBluebeam, setNote, signedSheet, stretchInBluebeam,
} from './testing.js'

const SCOPE: BakeScope = { id: 'scope-act', label: 'C-MT-01', color: '#2f7fd1', scopeType: 'panel' }
const OTHER: BakeScope = { id: 'scope-gyp', label: 'GYP-02', color: '#e08b2a', scopeType: 'board' }
const SQUARE = [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.4 }, { x: 0.1, y: 0.4 }]
const LAYOUT: Layout = { direction: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.1, sourcePage: 0 }, origin: { x: 0.2, y: 0.2 } }
const FEET_PER_POINT = 0.1111111111111111
const BOX = { width: 1224, height: 792 }

function area(id: string, over: Partial<LiveMarkup> = {}): LiveMarkup {
  return { id, pageIndex: 0, kind: 'area', scopeId: SCOPE.id, rings: [SQUARE], interchange: null, ...over }
}

async function bakeAll(
  bytes: Uint8Array,
  markups: LiveMarkup[],
  opts: { layouts?: Record<string, Layout>, calibrated?: boolean, deleted?: Array<{ id: string, interchange: InterchangeRecord | null }> } = {},
) {
  const inspection = await inspectPdf(bytes)
  const plan = planBake({
    markups,
    deleted: opts.deleted ?? [],
    annots: inspection.annots,
    scopes: new Map([[SCOPE.id, SCOPE], [OTHER.id, OTHER]]),
    layoutOf: (id) => opts.layouts?.[id] ?? {},
    feetPerPoint: () => (opts.calibrated === false ? null : FEET_PER_POINT),
    pageBox: () => BOX,
    pageCount: inspection.pageCount,
    now: '2026-09-25T00:00:00.000Z',
  })
  const result = await applyInterchange(bytes, plan.ops)
  if (!result.ok) throw new Error(result.refused.message)
  // The project side of the write: what each markup now remembers.
  const linked = markups.map((m) => {
    const hit = [...plan.records.values()].find((r) => r.markupId === m.id)
    const ok = result.outcomes.some((o) => o.name === hit?.record.name && o.result !== 'refused' && o.result !== 'missing')
    return ok && hit !== undefined ? { ...m, interchange: hit.record } : m
  })
  return { bytes: result.bytes, result, plan, linked }
}

const ours = (annots: readonly PdfAnnot[]) => annots.filter((a) => a.markupId !== null)

describe('baking a REDBEAM area', () => {
  it('writes an ordinary polygon named after the markup, with the payload in its note', async () => {
    const { bytes } = await bakeAll(await blankSheet(), [area('mk-1')], { layouts: { 'mk-1': LAYOUT } })
    const [a] = (await inspectPdf(bytes)).annots
    expect(a!.subtype).toBe('Polygon')
    expect(a!.name).toBe(annotationName('mk-1'))
    expect(a!.markupId).toBe('mk-1')
    expect(noteText(a!.contents)).toMatch(/^C-MT-01 · [\d,.]+ SF$/)
    expect(a!.payload?.scope?.label).toBe('C-MT-01')
    expect(a!.payload?.direction).toEqual(LAYOUT.direction)
    expect(a!.payload?.origin).toEqual(LAYOUT.origin)
    for (let i = 0; i < SQUARE.length; i++) {
      expect(a!.ring[i]!.x).toBeCloseTo(SQUARE[i]!.x, 5)
      expect(a!.ring[i]!.y).toBeCloseTo(SQUARE[i]!.y, 5)
    }
  })

  it('measures on a calibrated sheet and only outlines on an uncalibrated one', async () => {
    const measured = await bakeAll(await blankSheet(), [area('mk-1')])
    const plain = await bakeAll(await blankSheet(), [area('mk-1')], { calibrated: false })
    const annot = async (b: Uint8Array) => (await dictsByName(b)).get(annotationName('mk-1'))!
    const m = await annot(measured.bytes)
    expect(m.lookup(PDFName.of('IT'))).toBe(PDFName.of('PolygonDimension'))
    expect(m.has(PDFName.of('Measure'))).toBe(true)
    const p = await annot(plain.bytes)
    expect(p.has(PDFName.of('IT'))).toBe(false)
    expect(p.has(PDFName.of('Measure'))).toBe(false)
    expect(noteText((await inspectPdf(plain.bytes)).annots[0]!.contents)).toBe('C-MT-01 · not calibrated')
  })

  it('does not rewrite the file when nothing changed', async () => {
    const first = await bakeAll(await blankSheet(), [area('mk-1')])
    const again = await bakeAll(first.bytes, first.linked)
    expect(again.result.ok && again.result.changed).toBe(false)
    expect(again.bytes).toBe(first.bytes)
  })

  it('updates the same annotation in place rather than adding another', async () => {
    const first = await bakeAll(await blankSheet(), [area('mk-1')])
    const edited = first.linked.map((m) => ({ ...m, rings: [[...SQUARE.slice(0, 3), { x: 0.05, y: 0.45 }]] }))
    const second = await bakeAll(first.bytes, edited)
    const annots = (await inspectPdf(second.bytes)).annots
    expect(annots).toHaveLength(1)
    expect(annots[0]!.name).toBe(annotationName('mk-1'))
    expect(annots[0]!.ring[3]!.x).toBeCloseTo(0.05, 5)
  })

  it('writes areas only: lengths, counts and cutouts stay out, and so do areas with holes', async () => {
    const { bytes, plan } = await bakeAll(await blankSheet(), [
      area('mk-area'),
      area('mk-run', { kind: 'polyline', rings: [SQUARE.slice(0, 2)] }),
      area('mk-count', { kind: 'count', rings: [[{ x: 0.5, y: 0.5 }]] }),
      area('mk-cut', { kind: 'cutout' }),
      area('mk-holed', { rings: [SQUARE, SQUARE.map((p) => ({ x: p.x + 0.01, y: p.y + 0.01 }))] }),
    ])
    expect((await inspectPdf(bytes)).annots.map((a) => a.markupId)).toEqual(['mk-area'])
    expect(plan.skipped.holes).toBe(1)
  })
})

describe('reopening: the name survives and the outline wins', () => {
  const layoutOf = (layouts: Record<string, Layout>) => (id: string) => layouts[id] ?? {}

  it('follows a shape Bluebeam moved, by name, and carries its layout with it', async () => {
    const baked = await bakeAll(await blankSheet(), [area('mk-1')], { layouts: { 'mk-1': LAYOUT } })
    const moved = await moveInBluebeam(baked.bytes, annotationName('mk-1'), 122.4, -79.2) // +0.1, +0.1
    const annots = (await inspectPdf(moved)).annots
    expect(annots[0]!.name).toBe(annotationName('mk-1'))

    const plan = reconcile({ annots, markups: baked.linked, deleted: new Set(), layoutOf: layoutOf({ 'mk-1': LAYOUT }) })
    expect(plan.adopt).toEqual([])
    expect(plan.reshape).toHaveLength(1)
    expect(plan.reshape[0]!.markupId).toBe('mk-1')
    expect(plan.reshape[0]!.rings[0]![0]!.x).toBeCloseTo(0.2, 4)
    expect(plan.reshape[0]!.rings[0]![0]!.y).toBeCloseTo(0.2, 4)
    expect(plan.layout[0]!.origin!.x).toBeCloseTo(0.3, 4)
    expect(plan.layout[0]!.direction!.x1).toBeCloseTo(0.2, 4)
  })

  it('takes a stretched outline from the PDF and keeps the stated layout where it was', async () => {
    const baked = await bakeAll(await blankSheet(), [area('mk-1')], { layouts: { 'mk-1': LAYOUT } })
    const stretched = await stretchInBluebeam(baked.bytes, annotationName('mk-1'), 2, 61.2, 0) // x +0.05
    const plan = reconcile({
      annots: (await inspectPdf(stretched)).annots, markups: baked.linked, deleted: new Set(),
      layoutOf: layoutOf({ 'mk-1': LAYOUT }),
    })
    expect(plan.reshape[0]!.rings[0]![2]!.x).toBeCloseTo(0.35, 4)
    expect(plan.layout).toEqual([])
  })

  it('keeps an edit made in REDBEAM since the last write when the PDF was not touched', async () => {
    const baked = await bakeAll(await blankSheet(), [area('mk-1')])
    const editedHere = baked.linked.map((m) => ({ ...m, rings: [SQUARE.map((p) => ({ x: p.x + 0.2, y: p.y }))] }))
    const plan = reconcile({ annots: (await inspectPdf(baked.bytes)).annots, markups: editedHere, deleted: new Set(), layoutOf: () => ({}) })
    expect(plan.reshape).toEqual([])
    expect(plan.records.size).toBe(0)
  })

  it('falls back to the project when the note was cleared', async () => {
    const baked = await bakeAll(await blankSheet(), [area('mk-1')], { layouts: { 'mk-1': LAYOUT } })
    const stripped = await moveInBluebeam(await setNote(baked.bytes, annotationName('mk-1'), ''), annotationName('mk-1'), 122.4, 0)
    const annots = (await inspectPdf(stripped)).annots
    expect(annots[0]!.payload).toBeNull()
    // The layout on this machine has since been lost, which is what the project copy is for.
    const plan = reconcile({ annots, markups: baked.linked, deleted: new Set(), layoutOf: () => ({}) })
    expect(plan.layout).toHaveLength(1)
    expect(plan.layout[0]!.source).toBe('project')
    expect(plan.layout[0]!.payload.scope?.id).toBe(SCOPE.id)
    expect(plan.layout[0]!.origin!.x).toBeCloseTo(0.3, 4)
  })

  it('takes the note when it carries a newer write than the project knows', async () => {
    const baked = await bakeAll(await blankSheet(), [area('mk-1')])
    // The same drawing baked elsewhere with the area in another scope.
    const elsewhere = await bakeAll(baked.bytes, baked.linked.map((m) => ({ ...m, scopeId: OTHER.id })))
    const plan = reconcile({ annots: (await inspectPdf(elsewhere.bytes)).annots, markups: baked.linked, deleted: new Set(), layoutOf: () => ({}) })
    expect(plan.layout).toHaveLength(1)
    expect(plan.layout[0]!.source).toBe('note')
    expect(plan.layout[0]!.payload.scope?.id).toBe(OTHER.id)
  })

  it('brings an emailed area in with its scope when the note survived', async () => {
    const baked = await bakeAll(await blankSheet(), [area('mk-1')], { layouts: { 'mk-1': LAYOUT } })
    const plan = reconcile({ annots: (await inspectPdf(baked.bytes)).annots, markups: [], deleted: new Set(), layoutOf: () => ({}) })
    expect(plan.adopt).toHaveLength(1)
    expect(plan.adopt[0]!.markupId).toBe('mk-1')
    expect(plan.adopt[0]!.payload?.scope?.label).toBe('C-MT-01')
    expect(plan.adopt[0]!.payload?.origin).toEqual(LAYOUT.origin)
  })

  it('brings only the outline in when the note was deleted and the project never had it', async () => {
    const baked = await bakeAll(await blankSheet(), [area('mk-1')], { layouts: { 'mk-1': LAYOUT } })
    const stripped = await setNote(baked.bytes, annotationName('mk-1'), '')
    const plan = reconcile({ annots: (await inspectPdf(stripped)).annots, markups: [], deleted: new Set(), layoutOf: () => ({}) })
    expect(plan.adopt).toHaveLength(1)
    expect(plan.adopt[0]!.payload).toBeNull()
    expect(plan.adopt[0]!.ring).toHaveLength(4)
    expect(plan.layout).toEqual([])
  })

  it('treats a Bluebeam copy of a baked area as a new area', async () => {
    const baked = await bakeAll(await blankSheet(), [area('mk-1')])
    const doc = await PDFDocument.load(baked.bytes)
    const page = doc.getPages()[0]!
    const arr = page.node.lookup(PDFName.of('Annots')) as PDFArray
    const copy = (arr.lookup(0) as PDFDict).clone(doc.context)
    copy.set(PDFName.of('NM'), PDFString.of('BBCOPY00000000001'))
    arr.push(doc.context.register(copy))
    const annots = (await inspectPdf(await doc.save())).annots
    const plan = reconcile({ annots, markups: baked.linked, deleted: new Set(), layoutOf: () => ({}) })
    expect(plan.adopt).toHaveLength(1)
    expect(plan.adopt[0]!.markupId).toBeNull()
    expect(plan.adopt[0]!.name).toBe('BBCOPY00000000001')
  })

  it('does not bring back an area deleted here, and the next write removes it', async () => {
    const baked = await bakeAll(await blankSheet(), [area('mk-1'), area('mk-2', { rings: [SQUARE.map((p) => ({ x: p.x + 0.4, y: p.y }))] })])
    const [one, two] = baked.linked
    const plan = reconcile({ annots: (await inspectPdf(baked.bytes)).annots, markups: [two!], deleted: new Set(['mk-1']), layoutOf: () => ({}) })
    expect(plan.adopt).toEqual([])
    const after = await bakeAll(baked.bytes, [two!], { deleted: [{ id: one!.id, interchange: one!.interchange }] })
    expect(ours((await inspectPdf(after.bytes)).annots).map((a) => a.markupId)).toEqual(['mk-2'])
  })

  it('keeps a linked markup whose annotation was deleted in Bluebeam, and drops the link', async () => {
    const baked = await bakeAll(await blankSheet(), [area('mk-1')])
    const doc = await PDFDocument.load(baked.bytes)
    doc.getPages()[0]!.node.delete(PDFName.of('Annots'))
    const plan = reconcile({ annots: (await inspectPdf(await doc.save())).annots, markups: baked.linked, deleted: new Set(), layoutOf: () => ({}) })
    expect(plan.unlinked).toEqual(['mk-1'])
    expect(plan.reshape).toEqual([])
  })
})

describe('refusing what should not be rewritten', () => {
  it('refuses a signed drawing', async () => {
    const out = await applyInterchange(await signedSheet(), [{ op: 'bake', pageIndex: 0, name: 'redbeam:x', ring: SQUARE, note: '', author: 'A', color: '#000000', feetPerPoint: null }])
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.refused.kind).toBe('signed')
    expect((await inspectPdf(await signedSheet())).refused?.kind).toBe('signed')
  })

  it('refuses a locked (encrypted) drawing', async () => {
    const out = await applyInterchange(await lockedSheet(), [{ op: 'remove', pageIndex: 0, name: 'x' }])
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.refused.kind).toBe('locked')
  })

  it('refuses grouped and locked markups one by one and still writes the rest', async () => {
    const sheet = await foreignSheet()
    const out = await applyInterchange(sheet.bytes, [
      { op: 'reshape', pageIndex: 0, name: sheet.names.groupMember, ring: SQUARE },
      { op: 'remove', pageIndex: 0, name: sheet.names.groupHead },
      { op: 'remove', pageIndex: 0, name: sheet.names.locked },
      { op: 'reshape', pageIndex: 0, name: sheet.names.cloud, ring: SQUARE },
      { op: 'bake', pageIndex: 0, name: 'redbeam:mk-9', ring: SQUARE, note: 'n', author: 'A', color: '#000000', feetPerPoint: null },
    ])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.outcomes.map((o) => o.result)).toEqual(['refused', 'refused', 'refused', 'refused', 'created'])
    expect(out.outcomes[0]!.reason).toMatch(/grouped/)
    expect(out.outcomes[2]!.reason).toMatch(/locked/)
    const names = new Set((await dictsByName(out.bytes)).keys())
    for (const n of Object.values(sheet.names)) expect(names.has(n)).toBe(true)
  })

  it('refuses to update a baked area someone grouped in Bluebeam', async () => {
    const baked = await bakeAll(await blankSheet(), [area('mk-1'), area('mk-2')])
    const doc = await PDFDocument.load(baked.bytes)
    const arr = doc.getPages()[0]!.node.lookup(PDFName.of('Annots')) as PDFArray
    const member = arr.lookup(1) as PDFDict
    member.set(PDFName.of('IRT'), arr.get(0))
    member.set(PDFName.of('RT'), PDFName.of('Group'))
    const grouped = await doc.save()
    const again = await bakeAll(grouped, baked.linked.map((m) => ({ ...m, rings: [SQUARE.map((p) => ({ x: p.x, y: p.y + 0.3 }))] })))
    expect(again.result.ok && again.result.outcomes.every((o) => o.result === 'refused')).toBe(true)
    expect(again.result.ok && again.result.changed).toBe(false)
  })
})

describe("other software's markups", () => {
  it('leaves every foreign annotation exactly as it was when REDBEAM bakes its own', async () => {
    const sheet = await foreignSheet()
    const before = await dictsByName(sheet.bytes)
    const { bytes } = await bakeAll(sheet.bytes, [area('mk-1')])
    const after = await dictsByName(bytes)
    for (const [name, dict] of before) expect(after.get(name)!.toString(), name).toBe(dict.toString())
    expect(after.size).toBe(before.size + 1)
  })

  it('reshapes a Bluebeam measurement in place, keeping its name, measurement, columns and replies', async () => {
    const sheet = await foreignSheet()
    const before = await dictsByName(sheet.bytes)
    const ring = [{ x: 0.1, y: 0.6 }, { x: 0.25, y: 0.6 }, { x: 0.25, y: 0.8 }, { x: 0.1, y: 0.8 }]
    const out = await applyInterchange(sheet.bytes, [{ op: 'reshape', pageIndex: 0, name: sheet.names.measured, ring }])
    expect(out.ok && out.outcomes[0]!.result).toBe('updated')
    if (!out.ok) return
    const after = await dictsByName(out.bytes)
    const m = after.get(sheet.names.measured)!
    for (const key of ['IT', 'Measure', 'BSIColumnData', 'T', 'Subj', 'Contents']) {
      expect(m.lookup(PDFName.of(key))?.toString(), key).toBe(before.get(sheet.names.measured)!.lookup(PDFName.of(key))?.toString())
    }
    const read = (await inspectPdf(out.bytes)).annots.find((a) => a.name === sheet.names.measured)!
    expect(read.ring[0]!.x).toBeCloseTo(0.1, 5)
    expect(read.ring[2]!.y).toBeCloseTo(0.8, 5)
    const reply = (await inspectPdf(out.bytes)).annots.find((a) => a.name === sheet.names.reply)!
    expect(reply.replyTo).toBe(sheet.names.measured)
    for (const n of [sheet.names.groupHead, sheet.names.groupMember, sheet.names.locked, sheet.names.cloud]) {
      expect(after.get(n)!.toString(), n).toBe(before.get(n)!.toString())
    }
  })

  it('deletes a markup with its replies and status, and nothing else', async () => {
    const sheet = await foreignSheet()
    const out = await applyInterchange(sheet.bytes, [{ op: 'remove', pageIndex: 0, name: sheet.names.measured }])
    expect(out.ok && out.outcomes[0]!.result).toBe('removed')
    if (!out.ok) return
    const names = [...(await dictsByName(out.bytes)).keys()].sort()
    expect(names).toEqual([sheet.names.cloud, sheet.names.groupHead, sheet.names.groupMember, sheet.names.locked].sort())
  })

  it('reads groups, locks, clouds and replies off the file', async () => {
    const sheet = await foreignSheet()
    const byName = new Map((await inspectPdf(sheet.bytes)).annots.map((a) => [a.name, a]))
    expect(byName.get(sheet.names.groupHead)!.grouped).toBe(true)
    expect(byName.get(sheet.names.groupMember)!.grouped).toBe(true)
    expect(byName.get(sheet.names.measured)!.grouped).toBe(false)
    expect(byName.get(sheet.names.locked)!.locked).toBe(true)
    expect(byName.get(sheet.names.cloud)!.cloud).toBe(true)
    expect(byName.get(sheet.names.measured)!.hasMeasure).toBe(true)
    expect(byName.get(sheet.names.reply)!.replyTo).toBe(sheet.names.measured)
  })
})

describe('the note', () => {
  it('survives text added around it', async () => {
    const baked = await bakeAll(await blankSheet(), [area('mk-1')])
    const note = (await inspectPdf(baked.bytes)).annots[0]!.contents
    expect(decodeNote(`Checked by GC.\n${note}\nSee RFI 12`)?.markup).toBe('mk-1')
  })

  it('reads as absent when it is damaged', () => {
    expect(decodeNote('REDBEAM:v1:not-base64-json')).toBeNull()
    expect(decodeNote('1,234 SF')).toBeNull()
  })
})
