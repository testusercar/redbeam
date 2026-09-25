/**
 * What a baked REDBEAM area carries in its PDF note, and what its name is.
 *
 * A baked area is an ordinary Polygon annotation, so Bluebeam and Acrobat see
 * a shape and nothing more. Two things let REDBEAM find its own work again:
 *
 *  - `/NM`, the annotation's name, is `redbeam:<markup id>`. Bluebeam keeps a
 *    markup's name when it is moved or stretched; a copy gets a new one.
 *  - `/Contents`, the note, holds a readable line for whoever opens the sheet
 *    and, after it, the scope payload as one token. The same payload is kept in
 *    the project, so a note someone clears in Bluebeam costs nothing on a
 *    machine that has the project.
 *
 * Older REDBEAM builds read the note as text and ignore the token.
 */

export interface PayloadPoint { x: number, y: number }

/** A direction as scope specs store one: normalized, with the page it came from. */
export interface PayloadDirection {
  x1: number
  y1: number
  x2: number
  y2: number
  sourcePage?: number
}

export interface ScopePayload {
  v: 1
  /** The markup the area was baked from. */
  markup: string
  kind: 'area'
  /** Null for an area drawn before a scope was chosen for it. */
  scope: { id: string, label: string, color: string, type: string } | null
  /** This area's own pattern direction, when it has one. */
  direction?: PayloadDirection
  /** This area's own pattern start, when it has one. Normalized page space. */
  origin?: PayloadPoint
  /**
   * The outline the direction and origin were stated against, normalized. On
   * reopen, a shape Bluebeam only MOVED carries its layout with it.
   */
  ring: PayloadPoint[]
}

export const NAME_PREFIX = 'redbeam:'
const TOKEN = 'REDBEAM:v1:'
const TOKEN_RE = /REDBEAM:v1:([A-Za-z0-9_-]+)/

export function annotationName(markupId: string): string {
  return `${NAME_PREFIX}${markupId}`
}

/** The markup id a REDBEAM annotation name carries, or null for anyone else's. */
export function markupIdFromName(name: string): string | null {
  if (!name.startsWith(NAME_PREFIX)) return null
  const id = name.slice(NAME_PREFIX.length)
  return id === '' ? null : id
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(token: string): string {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** The note: a line a person can read, then the payload token. */
export function encodeNote(summary: string, payload: ScopePayload): string {
  const compact: ScopePayload = {
    ...payload,
    ring: payload.ring.map((p) => ({ x: round(p.x), y: round(p.y) })),
  }
  const token = `${TOKEN}${base64UrlEncode(JSON.stringify(compact))}`
  return summary === '' ? token : `${summary}\n${token}`
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function asPoint(v: unknown): PayloadPoint | null {
  if (v === null || typeof v !== 'object') return null
  const p = v as Record<string, unknown>
  return num(p.x) && num(p.y) ? { x: p.x, y: p.y } : null
}

/**
 * The payload in a note, or null when there is none.
 *
 * Read wherever the token sits, because Bluebeam may add text around it or
 * turn the note into rich text. Anything malformed is treated as absent: a
 * payload that half-parses must not restore half a layout.
 */
export function decodeNote(contents: string): ScopePayload | null {
  const m = TOKEN_RE.exec(contents)
  if (m === null) return null
  let raw: unknown
  try { raw = JSON.parse(base64UrlDecode(m[1]!)) } catch { return null }
  if (raw === null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.v !== 1 || typeof r.markup !== 'string' || r.markup === '' || r.kind !== 'area') return null
  if (!Array.isArray(r.ring)) return null
  const ring: PayloadPoint[] = []
  for (const p of r.ring) {
    const q = asPoint(p)
    if (q === null) return null
    ring.push(q)
  }
  let scope: ScopePayload['scope'] = null
  if (r.scope !== null && r.scope !== undefined) {
    const s = r.scope as Record<string, unknown>
    if (typeof s.id !== 'string' || typeof s.label !== 'string') return null
    scope = {
      id: s.id, label: s.label,
      color: typeof s.color === 'string' ? s.color : '#888888',
      type: typeof s.type === 'string' ? s.type : '',
    }
  }
  const out: ScopePayload = { v: 1, markup: r.markup, kind: 'area', scope, ring }
  const d = r.direction as Record<string, unknown> | undefined
  if (d !== undefined && d !== null && num(d.x1) && num(d.y1) && num(d.x2) && num(d.y2)) {
    out.direction = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, ...(num(d.sourcePage) ? { sourcePage: d.sourcePage } : {}) }
  }
  const o = asPoint(r.origin)
  if (o !== null) out.origin = o
  return out
}

/** The note without its token, for showing to a person. */
export function noteText(contents: string): string {
  return contents.replace(TOKEN_RE, '').trim()
}
