/**
 * What to do with a drawing's REDBEAM areas when it is opened again.
 *
 * The rule the estimator was promised: the PDF OUTLINE wins, and the scope
 * layout comes back from the note, or from the project when the note was
 * cleared. "Wins" is decided three ways, against what was last written:
 *
 *  - base:   the outline and payload REDBEAM wrote (kept in the project);
 *  - theirs: what the PDF carries now;
 *  - ours:   the live markup and its scope's layout.
 *
 * If the PDF still says what REDBEAM wrote, nobody changed it outside, and an
 * edit made here since stands until the next write. If the PDF says something
 * else, somebody moved the shape (or rewrote the note) in Bluebeam, and the
 * PDF wins. Without a base to compare against, the PDF wins outright.
 *
 * A REDBEAM area this project has never seen — the drawing was emailed from
 * another machine — comes in with its scope when the note still has the
 * payload. When the note is gone there is nothing to say which scope it was,
 * and it comes in as an unassigned outline. Nothing here guesses.
 */
import type { PdfAnnot, Point } from './pdfInterchange.js'
import type { PayloadDirection, ScopePayload } from './payload.js'

/** What the project remembers about a markup's annotation. `content.interchange`. */
export interface InterchangeRecord {
  /** The annotation's /NM. */
  name: string
  pageIndex: number
  /** 'redbeam' when REDBEAM wrote the annotation; 'foreign' for someone else's being edited here. */
  origin: 'redbeam' | 'foreign'
  /** The outline as last written or read, normalized. The base for the three-way rule. */
  ring: Point[]
  /** The payload as last written. REDBEAM areas only. */
  payload?: ScopePayload
  at?: string
}

export interface LiveMarkup {
  id: string
  pageIndex: number
  kind: string
  scopeId: string | null
  rings: Point[][]
  interchange: InterchangeRecord | null
}

/** A markup's own layout, as its scope's specs state it. */
export interface Layout {
  direction?: PayloadDirection
  origin?: Point
}

export interface ReconcileInput {
  annots: readonly PdfAnnot[]
  /** Live markups on this document. */
  markups: readonly LiveMarkup[]
  /** Ids of this document's markups that were deleted here. */
  deleted: ReadonlySet<string>
  layoutOf: (markupId: string) => Layout
}

export interface LayoutRestore {
  markupId: string
  source: 'note' | 'project'
  payload: ScopePayload
  /** The payload's direction and origin, carried along if the shape only moved. */
  direction: PayloadDirection | null
  origin: Point | null
}

export interface Adoption {
  /** The id the new markup takes: the one in the name when it is free, else null for a fresh one. */
  markupId: string | null
  name: string
  pageIndex: number
  ring: Point[]
  payload: ScopePayload | null
}

export interface ReconcilePlan {
  reshape: Array<{ markupId: string, rings: Point[][] }>
  layout: LayoutRestore[]
  adopt: Adoption[]
  /** Linked markups whose annotation is gone. They are kept; the link is dropped. */
  unlinked: string[]
  /** New records to store, by markup id (base moves to what the PDF says now). */
  records: Map<string, InterchangeRecord>
}

const EPS = 1e-5

export function sameRing(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]!.x - b[i]!.x) > EPS || Math.abs(a[i]!.y - b[i]!.y) > EPS) return false
  }
  return true
}

/** The offset that carries `from` onto `to`, when the shape only moved. */
export function translationBetween(from: readonly Point[], to: readonly Point[]): Point | null {
  if (from.length === 0 || from.length !== to.length) return null
  const dx = to[0]!.x - from[0]!.x
  const dy = to[0]!.y - from[0]!.y
  for (let i = 1; i < from.length; i++) {
    if (Math.abs(to[i]!.x - from[i]!.x - dx) > EPS || Math.abs(to[i]!.y - from[i]!.y - dy) > EPS) return null
  }
  return { x: dx, y: dy }
}

function sameDirection(a: PayloadDirection | undefined, b: PayloadDirection | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return Math.abs(a.x1 - b.x1) < EPS && Math.abs(a.y1 - b.y1) < EPS
    && Math.abs(a.x2 - b.x2) < EPS && Math.abs(a.y2 - b.y2) < EPS
}

function samePoint(a: Point | undefined, b: Point | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
}

export function samePayload(a: ScopePayload | undefined | null, b: ScopePayload | undefined | null): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return (a ?? null) === (b ?? null)
  return a.markup === b.markup
    && (a.scope?.id ?? null) === (b.scope?.id ?? null)
    && sameDirection(a.direction, b.direction)
    && samePoint(a.origin, b.origin)
    && sameRing(a.ring, b.ring)
}

/** The payload's layout, moved with the outline when the outline only moved. */
function carried(payload: ScopePayload, outline: readonly Point[]): { direction: PayloadDirection | null, origin: Point | null } {
  const t = translationBetween(payload.ring, outline) ?? { x: 0, y: 0 }
  const d = payload.direction
  return {
    direction: d === undefined ? null : { ...d, x1: d.x1 + t.x, y1: d.y1 + t.y, x2: d.x2 + t.x, y2: d.y2 + t.y },
    origin: payload.origin === undefined ? null : { x: payload.origin.x + t.x, y: payload.origin.y + t.y },
  }
}

function differsFromLive(
  restore: { direction: PayloadDirection | null, origin: Point | null },
  payload: ScopePayload,
  live: LiveMarkup,
  layout: Layout,
): boolean {
  return (payload.scope?.id ?? null) !== live.scopeId
    || !sameDirection(restore.direction ?? undefined, layout.direction)
    || !samePoint(restore.origin ?? undefined, layout.origin)
}

export function reconcile(input: ReconcileInput): ReconcilePlan {
  const plan: ReconcilePlan = { reshape: [], layout: [], adopt: [], unlinked: [], records: new Map() }
  const byPageName = new Map<string, PdfAnnot>()
  for (const a of input.annots) if (a.name !== '') byPageName.set(`${a.pageIndex}|${a.name}`, a)

  const claimed = new Set<string>()
  const liveIds = new Set(input.markups.map((m) => m.id))

  for (const m of input.markups) {
    const rec = m.interchange
    if (rec === null) continue
    const annot = byPageName.get(`${rec.pageIndex}|${rec.name}`)
    if (annot === undefined) {
      plan.unlinked.push(m.id)
      continue
    }
    claimed.add(`${annot.pageIndex}|${annot.name}`)
    const ours = m.rings[0] ?? []
    const theirs = annot.ring
    const pdfMoved = theirs.length > 0 && !sameRing(theirs, rec.ring)
    if (pdfMoved && !sameRing(theirs, ours)) {
      plan.reshape.push({ markupId: m.id, rings: [theirs, ...m.rings.slice(1)] })
    }
    const outline = pdfMoved ? theirs : ours
    let nextPayload = rec.payload

    if (rec.origin === 'redbeam') {
      const note = annot.payload
      // The note is newer than what was written only if it differs from it.
      const fromNote = note !== null && !samePayload(note, rec.payload)
      const payload = fromNote ? note : rec.payload
      if (payload !== undefined && payload !== null && (fromNote || pdfMoved)) {
        const restore = carried(payload, outline)
        if (differsFromLive(restore, payload, m, input.layoutOf(m.id))) {
          plan.layout.push({ markupId: m.id, source: fromNote ? 'note' : 'project', payload, ...restore })
        }
      }
      if (fromNote) nextPayload = note
    }
    if (pdfMoved || nextPayload !== rec.payload) {
      plan.records.set(m.id, {
        ...rec,
        ring: pdfMoved ? theirs : rec.ring,
        ...(nextPayload === undefined ? {} : { payload: nextPayload }),
      })
    }
  }

  for (const a of input.annots) {
    if (claimed.has(`${a.pageIndex}|${a.name}`)) continue
    if (a.subtype !== 'Polygon' || a.ring.length < 3) continue
    const fromName = a.markupId
    if (fromName === null && a.payload === null) continue // somebody else's shape
    if (fromName !== null && input.deleted.has(fromName)) continue // deleted here; the next write removes it
    // The id in the name, unless a live markup already has it: then this is a
    // copy Bluebeam made of one, and it becomes a markup of its own.
    const id = fromName !== null && !liveIds.has(fromName) ? fromName : null
    plan.adopt.push({ markupId: id, name: a.name, pageIndex: a.pageIndex, ring: a.ring, payload: a.payload })
  }

  return plan
}

/** What a stored `content.interchange` value is, or null when it is not one. */
export function readRecord(raw: unknown): InterchangeRecord | null {
  if (raw === null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.name !== 'string' || r.name === '' || typeof r.pageIndex !== 'number') return null
  if (r.origin !== 'redbeam' && r.origin !== 'foreign') return null
  const ring = Array.isArray(r.ring)
    ? r.ring.filter((p): p is Point => p !== null && typeof p === 'object'
      && typeof (p as Point).x === 'number' && typeof (p as Point).y === 'number')
    : []
  return {
    name: r.name,
    pageIndex: r.pageIndex,
    origin: r.origin,
    ring,
    ...(r.payload !== undefined && r.payload !== null ? { payload: r.payload as ScopePayload } : {}),
    ...(typeof r.at === 'string' ? { at: r.at } : {}),
  }
}
