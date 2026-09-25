/**
 * Between the interchange plans and the project.
 *
 * `reconcile` and `planBake` decide; this turns their answers into what the
 * app runs — store commands, content and scope-spec writes — and into the one
 * sentence the status line shows. Everything arrives as an argument, so the
 * whole path is testable without a window or a worker.
 *
 * Commands made here carry origin `pdf`: the core logs them but keeps them off
 * the person's Ctrl+Z, because undoing "the PDF moved this" would only put the
 * project back out of step with the file.
 */
import {
  batch, createMarkup, editGeometry, listMarkups, pageIdFor, pageNumberFrom, reassignScope,
  type Command, type MarkupRow, type SqlDriver,
} from '@redbeam/store'
import { AREA_DIRECTIONS_KEY, AREA_ORIGINS_KEY, areaOriginPoint, directionFrom, type Scope } from '@redbeam/domain'
import type { OpOutcome } from './pdfInterchange.js'
import type { PayloadDirection, ScopePayload } from './payload.js'
import { readRecord, type InterchangeRecord, type Layout, type LiveMarkup, type ReconcilePlan } from './reconcile.js'
import type { BakePlan } from './bakePlan.js'

export const PDF_ORIGIN = 'pdf'

export interface DocMarkups {
  rows: MarkupRow[]
  live: LiveMarkup[]
  deleted: Array<{ id: string, interchange: InterchangeRecord | null }>
}

export function toLive(rows: readonly MarkupRow[], docId: string): LiveMarkup[] {
  const out: LiveMarkup[] = []
  for (const r of rows) {
    const pageIndex = pageNumberFrom(r.pageId, docId)
    if (pageIndex === null) continue
    out.push({
      id: r.id, pageIndex, kind: r.kind, scopeId: r.scopeId, rings: r.rings,
      interchange: readRecord(r.content?.interchange),
    })
  }
  return out
}

export async function loadDocMarkups(db: SqlDriver, docId: string): Promise<DocMarkups> {
  const [rows, all] = await Promise.all([
    listMarkups(db, { documentId: docId }),
    listMarkups(db, { documentId: docId, includeDeleted: true }),
  ])
  const live = new Set(rows.map((r) => r.id))
  return {
    rows,
    live: toLive(rows, docId),
    deleted: all.filter((r) => !live.has(r.id)).map((r) => ({ id: r.id, interchange: readRecord(r.content?.interchange) })),
  }
}

/** A markup's own direction and pattern start, from its scope's specs. */
export function layoutReader(
  scopeOf: (markupId: string) => string | null,
  scopes: readonly Scope[],
): (markupId: string) => Layout {
  const byId = new Map(scopes.map((s) => [s.id, s]))
  return (markupId) => {
    const scopeId = scopeOf(markupId)
    const specs = scopeId === null ? undefined : byId.get(scopeId)?.specifications
    if (specs === undefined) return {}
    const dirs = specs[AREA_DIRECTIONS_KEY] as Record<string, unknown> | undefined
    const origins = specs[AREA_ORIGINS_KEY] as Record<string, unknown> | undefined
    const d = dirs?.[markupId]
    const dir = directionFrom(d)
    const o = areaOriginPoint(origins?.[markupId])
    const out: Layout = {}
    if (dir !== null) {
      const src = (d as { sourcePage?: unknown }).sourcePage
      out.direction = {
        x1: dir[0].x, y1: dir[0].y, x2: dir[1].x, y2: dir[1].y,
        ...(typeof src === 'number' ? { sourcePage: src } : {}),
      }
    }
    if (o !== null) out.origin = o
    return out
  }
}

/** This project's scope for a payload's: the same id, else the same name. */
export function resolveScope(scope: ScopePayload['scope'], scopes: readonly Scope[]): string | null {
  if (scope === null) return null
  const byId = scopes.find((s) => s.id === scope.id)
  if (byId !== undefined) return byId.id
  const want = scope.label.trim().toLowerCase()
  return scopes.find((s) => s.label.trim().toLowerCase() === want)?.id ?? null
}

interface LayoutWrite { markupId: string, scopeId: string, direction: PayloadDirection | null, origin: { x: number, y: number } | null }

/** Scopes with the given areas' directions and origins written into their specs. */
export function withLayouts(scopes: readonly Scope[], writes: readonly LayoutWrite[]): Scope[] {
  const changed = new Map<string, Scope>()
  for (const w of writes) {
    const base = changed.get(w.scopeId) ?? scopes.find((s) => s.id === w.scopeId)
    if (base === undefined) continue
    const specs = base.specifications
    const dirs = { ...(specs[AREA_DIRECTIONS_KEY] as Record<string, unknown> ?? {}) }
    const origins = { ...(specs[AREA_ORIGINS_KEY] as Record<string, unknown> ?? {}) }
    if (w.direction === null) delete dirs[w.markupId]
    else dirs[w.markupId] = { ...w.direction }
    if (w.origin === null) delete origins[w.markupId]
    else origins[w.markupId] = { x: w.origin.x, y: w.origin.y }
    changed.set(w.scopeId, { ...base, specifications: { ...specs, [AREA_DIRECTIONS_KEY]: dirs, [AREA_ORIGINS_KEY]: origins } })
  }
  return [...changed.values()]
}

export interface PdfSync {
  command: Command | null
  /** Markup id to its whole new content. */
  contents: Map<string, Record<string, unknown>>
  scopes: Scope[]
  /** Page indexes new markups land on, whose page rows must exist first. */
  pages: number[]
  summary: string | null
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What reopening a drawing changes in the project. */
export function buildPdfSync(plan: ReconcilePlan, ctx: {
  docId: string
  rows: readonly MarkupRow[]
  scopes: readonly Scope[]
  now: string
  newId: () => string
}): PdfSync {
  const rows = new Map(ctx.rows.map((r) => [r.id, r]))
  const cmds: Command[] = []
  const contents = new Map<string, Record<string, unknown>>()
  const layouts: LayoutWrite[] = []
  const pages = new Set<number>()
  let lost = 0
  let unknownScope = 0

  for (const r of plan.reshape) {
    const row = rows.get(r.markupId)
    if (row === undefined) continue
    cmds.push(editGeometry(r.markupId, row.rings, r.rings, 'follow the PDF outline',
      { documentId: ctx.docId, pageId: row.pageId }, PDF_ORIGIN))
  }

  for (const l of plan.layout) {
    const row = rows.get(l.markupId)
    if (row === undefined) continue
    const scopeId = resolveScope(l.payload.scope, ctx.scopes)
    if (l.payload.scope !== null && scopeId === null) unknownScope++
    if (scopeId !== null && scopeId !== row.scopeId) {
      cmds.push(reassignScope(l.markupId, row.scopeId, scopeId, { documentId: ctx.docId, pageId: row.pageId }, PDF_ORIGIN))
    }
    const target = scopeId ?? row.scopeId
    if (target !== null) layouts.push({ markupId: l.markupId, scopeId: target, direction: l.direction, origin: l.origin })
  }

  for (const a of plan.adopt) {
    const id = a.markupId ?? ctx.newId()
    const scopeId = a.payload === null ? null : resolveScope(a.payload.scope, ctx.scopes)
    if (a.payload === null) lost++
    else if (a.payload.scope !== null && scopeId === null) unknownScope++
    const record: InterchangeRecord = {
      name: a.name, pageIndex: a.pageIndex, origin: 'redbeam', ring: a.ring,
      ...(a.payload === null ? {} : { payload: a.payload }), at: ctx.now,
    }
    cmds.push(createMarkup({
      id, documentId: ctx.docId, pageId: pageIdFor(ctx.docId, a.pageIndex), scopeId, kind: 'area',
      rings: [a.ring], origin: PDF_ORIGIN, reviewState: 'accepted',
      content: { source: 'pdf-annotation', interchange: record },
    }))
    pages.add(a.pageIndex)
    if (a.payload !== null && scopeId !== null) {
      layouts.push({ markupId: id, scopeId, direction: a.payload.direction ?? null, origin: a.payload.origin ?? null })
    }
  }

  for (const [id, record] of plan.records) {
    const row = rows.get(id)
    if (row !== undefined) contents.set(id, { ...(row.content ?? {}), interchange: record })
  }
  for (const id of plan.unlinked) {
    const row = rows.get(id)
    if (row === undefined) continue
    const { interchange: _gone, ...rest } = row.content ?? {}
    contents.set(id, rest)
  }

  const parts: string[] = []
  if (plan.reshape.length > 0) parts.push(`${plural(plan.reshape.length, 'outline')} moved in the PDF`)
  if (plan.adopt.length > 0) parts.push(`${plural(plan.adopt.length, 'area')} added from the PDF`)
  if (plan.unlinked.length > 0) parts.push(`${plural(plan.unlinked.length, 'area')} no longer in the PDF, kept here`)
  let summary = parts.length === 0 ? null : `${parts.join(', ')}.`
  if (lost > 0) summary = `${summary ?? ''} ${plural(lost, 'area')} came in without a scope: the note that named it was removed.`.trim()
  if (unknownScope > 0) summary = `${summary ?? ''} ${plural(unknownScope, 'area')} named a scope this project does not have.`.trim()
  if (summary !== null) summary = summary.charAt(0).toUpperCase() + summary.slice(1)

  return {
    command: cmds.length === 0 ? null : cmds.length === 1 ? cmds[0]! : batch('follow the PDF', cmds),
    contents,
    scopes: withLayouts(ctx.scopes, layouts),
    pages: [...pages],
    summary,
  }
}

/** Content writes after a bake, for the ops that went through. */
export function contentsAfterBake(
  plan: BakePlan,
  outcomes: readonly OpOutcome[],
  rows: readonly MarkupRow[],
): Map<string, Record<string, unknown>> {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out = new Map<string, Record<string, unknown>>()
  for (const o of outcomes) {
    if (o.result !== 'created' && o.result !== 'updated' && o.result !== 'unchanged') continue
    const hit = plan.records.get(`${o.pageIndex}|${o.name}`)
    const row = hit === undefined ? undefined : byId.get(hit.markupId)
    if (hit === undefined || row === undefined) continue
    out.set(hit.markupId, { ...(row.content ?? {}), interchange: hit.record })
  }
  return out
}

/** The status line after a write. */
export function bakeSummary(fileName: string, outcomes: readonly OpOutcome[], backup: string | null, changed: boolean): string {
  const count = (r: OpOutcome['result'], op?: OpOutcome['op']) =>
    outcomes.filter((o) => o.result === r && (op === undefined || o.op === op)).length
  const written = count('created') + count('updated')
  const removed = count('removed')
  const refused = outcomes.filter((o) => o.result === 'refused')
  const parts: string[] = []
  if (!changed) parts.push(`${fileName} already has this takeoff.`)
  else {
    const did: string[] = []
    if (written > 0) did.push(`wrote ${plural(written, 'area')}`)
    if (removed > 0) did.push(`removed ${plural(removed, 'markup')}`)
    const sentence = did.join(' and ')
    parts.push(`${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} in ${fileName}.`)
    if (backup !== null) parts.push('The previous file is in .redbeam/backups.')
  }
  if (refused.length > 0) {
    const reasons = [...new Set(refused.map((o) => o.reason ?? 'refused'))]
    parts.push(`${plural(refused.length, 'markup')} left as ${refused.length === 1 ? 'it was' : 'they were'}: ${reasons.join('; ')}.`)
  }
  return parts.join(' ')
}
