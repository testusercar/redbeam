import { describe, expect, it } from 'vitest'
import type { MarkupRow } from '@redbeam/store'
import type { Scope } from '@redbeam/domain'
import { bakeSummary, buildPdfSync, layoutReader, resolveScope, withLayouts } from './sync.js'
import type { ReconcilePlan } from './reconcile.js'
import type { ScopePayload } from './payload.js'

const RING = [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.4 }]
const SCOPES: Scope[] = [
  { id: 'scope-act', label: 'C-MT-01', scopeType: 'area', color: '#2f7fd1', specifications: {} },
]
const payload = (scope: ScopePayload['scope']): ScopePayload => ({
  v: 1, markup: 'mk-1', kind: 'area', scope, ring: RING, origin: { x: 0.2, y: 0.2 },
})
const empty = (): ReconcilePlan => ({ reshape: [], layout: [], adopt: [], unlinked: [], records: new Map() })
const row = (over: Partial<MarkupRow> = {}): MarkupRow => ({
  id: 'mk-1', scopeId: null, documentId: 'doc', pageId: 'doc-p0', kind: 'area', rings: [RING],
  origin: 'user', reviewState: 'accepted', content: { interchange: { name: 'redbeam:mk-1' } }, ...over,
})
const ctx = (rows: MarkupRow[] = []) => ({ docId: 'doc', rows, scopes: SCOPES, now: 'now', newId: () => 'mk-new' })

describe('what reopening changes in the project', () => {
  it('says plainly when an area came back without its scope', () => {
    const plan = empty()
    plan.adopt.push({ markupId: 'mk-1', name: 'redbeam:mk-1', pageIndex: 2, ring: RING, payload: null })
    const out = buildPdfSync(plan, ctx())
    expect(out.command?.record.op).toBe('create_markup')
    expect(out.command?.record.origin).toBe('pdf')
    expect((out.command?.record.after as { scopeId: string | null }).scopeId).toBeNull()
    expect(out.pages).toEqual([2])
    expect(out.summary).toBe('1 area added from the PDF. 1 area came in without a scope: the note that named it was removed.')
  })

  it('restores the scope and pattern start of an emailed area by scope name', () => {
    const plan = empty()
    plan.adopt.push({ markupId: null, name: 'BBCOPY', pageIndex: 0, ring: RING, payload: payload({ id: 'elsewhere', label: 'c-mt-01', color: '#000', type: 'area' }) })
    const out = buildPdfSync(plan, ctx())
    expect((out.command?.record.after as { id: string, scopeId: string }).id).toBe('mk-new')
    expect((out.command?.record.after as { scopeId: string }).scopeId).toBe('scope-act')
    expect(out.scopes[0]!.specifications.areaOrigins).toEqual({ 'mk-new': { x: 0.2, y: 0.2 } })
  })

  it('does not invent a scope the project lacks', () => {
    const plan = empty()
    plan.adopt.push({ markupId: 'mk-1', name: 'redbeam:mk-1', pageIndex: 0, ring: RING, payload: payload({ id: 'x', label: 'GYP-99', color: '#000', type: 'area' }) })
    const out = buildPdfSync(plan, ctx())
    expect((out.command?.record.after as { scopeId: string | null }).scopeId).toBeNull()
    expect(out.scopes).toEqual([])
    expect(out.summary).toMatch(/named a scope this project does not have/)
  })

  it('moves an outline off the Ctrl+Z stack and drops a dead link without losing the markup', () => {
    const plan = empty()
    plan.reshape.push({ markupId: 'mk-1', rings: [RING.map((p) => ({ x: p.x + 0.1, y: p.y }))] })
    plan.unlinked.push('mk-1')
    const out = buildPdfSync(plan, ctx([row({ content: { source: 'x', interchange: { name: 'redbeam:mk-1' } } })]))
    expect(out.command?.record.op).toBe('edit_geometry')
    expect(out.command?.record.origin).toBe('pdf')
    expect(out.contents.get('mk-1')).toEqual({ source: 'x' })
  })

  it('reads an area layout out of scope specs and writes one back', () => {
    const scopes = withLayouts(SCOPES, [{ markupId: 'mk-1', scopeId: 'scope-act', direction: { x1: 0, y1: 0, x2: 1, y2: 0 }, origin: { x: 0.5, y: 0.5 } }])
    const read = layoutReader(() => 'scope-act', scopes)('mk-1')
    expect(read).toEqual({ direction: { x1: 0, y1: 0, x2: 1, y2: 0 }, origin: { x: 0.5, y: 0.5 } })
    expect(resolveScope(null, SCOPES)).toBeNull()
  })
})

describe('the status line after a write', () => {
  it('reports what was written, the backup, and what was left alone', () => {
    expect(bakeSummary('A-101.pdf', [
      { op: 'bake', pageIndex: 0, name: 'a', result: 'created' },
      { op: 'bake', pageIndex: 0, name: 'b', result: 'refused', reason: 'it is grouped in Bluebeam' },
    ], '.redbeam/backups/x.pdf', true)).toBe(
      'Wrote 1 area in A-101.pdf. The previous file is in .redbeam/backups. 1 markup left as it was: it is grouped in Bluebeam.',
    )
    expect(bakeSummary('A-101.pdf', [{ op: 'bake', pageIndex: 0, name: 'a', result: 'unchanged' }], null, false))
      .toBe('A-101.pdf already has this takeoff.')
  })
})
