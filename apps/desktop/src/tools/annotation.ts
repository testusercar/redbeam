/**
 * Non-measuring annotation tools: text callout and text highlight.
 *
 * Ported from okular-redbeam:
 *   RedbeamScopePanel::activateTextCalloutTool / activateTextHighlightTool
 *   the tool XML in `redbeamScopeToolDefinitions()` (pageviewannotator.cpp) —
 *     highlight opacity 0.35, callout opacity 0.18, border 1.2, 10pt text
 *   the scope-colour override in `selectRedbeamScopeTool()` — including the
 *     rule that picks white text on a dark scope colour
 *   the callout box auto-grow in the PickPoint engine's end() (padding 2)
 *   HighlightAnnotation painting in `gui/pagepainter.cpp`
 *
 * Neither tool produces a quantity. They are markups that carry CONTENT:
 * the text, colour and opacity live in `markups.content_json`, which already
 * exists in the schema — no new column, and nothing encoded into a name.
 *
 * Geometry is NORMALIZED page coordinates [0,1]. Hit-testing is SCREEN pixels,
 * matching `hit.ts`.
 */
import { distanceToSegment, nearestEdge, pointInPolygon, type Markup, type Point } from '@redbeam/domain'
import type { Viewport } from '@redbeam/viewer'
import { normalizedToScreen } from '../draw.js'
import { EDGE_GRAB_PX, VERTEX_GRAB_PX } from '../hit.js'

type Ctx = CanvasRenderingContext2D
type Screen = { x: number; y: number }

/** Defaults lifted from the Qt tool XML. */
export const HIGHLIGHT_OPACITY = 0.35
export const CALLOUT_OPACITY = 0.18
export const CALLOUT_BORDER_WIDTH = 1.2
export const CALLOUT_FONT_PX = 10
/** The colour the Qt tool XML ships before the scope colour overrides it. */
export const ANNOTATION_FALLBACK_COLOR = '#2d9cdb'

// ------------------------------------------------------------- content -----

export interface HighlightContent {
  /** null means "use the scope colour", which is what the Qt build did. */
  color: string | null
  opacity: number
}

export interface CalloutContent {
  text: string
  color: string | null
  /** null means "derive from the box colour" — see calloutTextColorFor. */
  textColor: string | null
  opacity: number
  fontPx: number
  borderWidth: number
}

export const DEFAULT_HIGHLIGHT_CONTENT: HighlightContent = {
  color: null,
  opacity: HIGHLIGHT_OPACITY,
}

export const DEFAULT_CALLOUT_CONTENT: CalloutContent = {
  text: '',
  color: null,
  textColor: null,
  opacity: CALLOUT_OPACITY,
  fontPx: CALLOUT_FONT_PX,
  borderWidth: CALLOUT_BORDER_WIDTH,
}

/**
 * A text highlight.
 *
 * `rings` is one ring per quad, each a 4-point rectangle in TL, TR, BR, BL
 * order. Multiple quads is how the Qt build stored a highlight spanning
 * several lines of text (HighlightAnnotation::highlightQuads); the tool here
 * creates one, but the renderer draws all of them so an imported multi-line
 * highlight survives the round trip.
 */
export interface HighlightMarkup extends Omit<Markup, 'kind'> {
  kind: 'highlight'
  content: HighlightContent
}

/**
 * A text callout.
 *
 * `rings[0]` is the text box: 4 points, TL, TR, BR, BL.
 * `rings[1]` is the leader: `[anchor]`, or `[anchor, knee]` for a doglegged
 * leader. The point where the leader meets the box is DERIVED, not stored, so
 * moving the box keeps the leader attached instead of leaving it dangling.
 * That mirrors the three points of a PDF `/CL` array without storing the one
 * that is a function of the other two.
 *
 * A callout with no `rings[1]` is a plain boxed note and draws no leader.
 */
export interface CalloutMarkup extends Omit<Markup, 'kind'> {
  kind: 'callout'
  content: CalloutContent
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readColor(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null
}

function readOpacity(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback
}

function readPositive(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback
}

export function parseHighlightContent(raw: unknown): HighlightContent {
  const o = asRecord(raw)
  if (!o) return { ...DEFAULT_HIGHLIGHT_CONTENT }
  return {
    color: readColor(o['color']),
    opacity: readOpacity(o['opacity'], HIGHLIGHT_OPACITY),
  }
}

export function parseCalloutContent(raw: unknown): CalloutContent {
  const o = asRecord(raw)
  if (!o) return { ...DEFAULT_CALLOUT_CONTENT }
  return {
    text: typeof o['text'] === 'string' ? o['text'] : '',
    color: readColor(o['color']),
    textColor: readColor(o['textColor']),
    opacity: readOpacity(o['opacity'], CALLOUT_OPACITY),
    fontPx: readPositive(o['fontPx'], CALLOUT_FONT_PX),
    borderWidth: readPositive(o['borderWidth'], CALLOUT_BORDER_WIDTH),
  }
}

export function serializeContent(content: HighlightContent | CalloutContent): string {
  return JSON.stringify(content)
}

// --------------------------------------------------------------- colour ----

/** Parse #rgb / #rrggbb into 0..1 channels. Returns null on anything else. */
export function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const t = hex.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(t)
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(t)
  if (short) {
    return {
      r: parseInt(short[1]! + short[1]!, 16) / 255,
      g: parseInt(short[2]! + short[2]!, 16) / 255,
      b: parseInt(short[3]! + short[3]!, 16) / 255,
    }
  }
  if (long) {
    return {
      r: parseInt(long[1]!, 16) / 255,
      g: parseInt(long[2]!, 16) / 255,
      b: parseInt(long[3]!, 16) / 255,
    }
  }
  return null
}

/** QColor::lightnessF — HSL lightness, (max + min) / 2. */
export function lightnessF(hex: string): number {
  const c = parseHexColor(hex)
  if (!c) return 1
  return (Math.max(c.r, c.g, c.b) + Math.min(c.r, c.g, c.b)) / 2
}

/**
 * Text colour for a callout on a given box colour.
 * Verbatim rule from selectRedbeamScopeTool(): lightness below 0.35 gets white
 * text, everything else black.
 */
export function calloutTextColorFor(color: string): string {
  return lightnessF(color) < 0.35 ? '#ffffff' : '#000000'
}

// ------------------------------------------------------------- geometry ----

/** Rectangle from two dragged corners, as a TL, TR, BR, BL ring. */
export function rectRing(a: Point, b: Point): Point[] {
  const left = Math.min(a.x, b.x)
  const right = Math.max(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const bottom = Math.max(a.y, b.y)
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
}

export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

export function ringBounds(ring: Point[]): Bounds | null {
  if (ring.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const p of ring) {
    if (p.x < left) left = p.x
    if (p.x > right) right = p.x
    if (p.y < top) top = p.y
    if (p.y > bottom) bottom = p.y
  }
  return { left, top, right, bottom }
}

/**
 * Where a leader coming from `from` meets the box.
 *
 * Clamped to the box border rather than aimed at its centre: a leader that
 * stops on the near edge reads as attached, one that runs to the centre reads
 * as struck through the text.
 */
export function leaderAttachPoint(box: Bounds, from: Screen | Point): Point {
  const cx = (box.left + box.right) / 2
  const cy = (box.top + box.bottom) / 2
  const dx = from.x - cx
  const dy = from.y - cy
  const halfW = (box.right - box.left) / 2
  const halfH = (box.bottom - box.top) / 2
  if (halfW <= 0 || halfH <= 0) return { x: cx, y: cy }
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  // scale the direction until it lands on the nearer of the two box edges
  const scale = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy),
  )
  return { x: cx + dx * scale, y: cy + dy * scale }
}

/** Screen-space leader polyline: anchor, optional knee, derived attach point. */
export function calloutLeaderScreenPath(
  m: CalloutMarkup,
  view: Viewport,
  pageW: number,
  pageH: number,
): Screen[] {
  const leader = m.rings[1]
  const box = m.rings[0]
  if (!leader || leader.length === 0 || !box || box.length < 3) return []
  const boxScreen = box.map((p) => normalizedToScreen(p.x, p.y, view, pageW, pageH))
  const bounds = ringBounds(boxScreen)
  if (!bounds) return []
  const points = leader.map((p) => normalizedToScreen(p.x, p.y, view, pageW, pageH))
  const last = points[points.length - 1]!
  return [...points, leaderAttachPoint(bounds, last)]
}

// ---------------------------------------------------------------- drafts ---

/** Two-corner drag, shared by the highlight tool and the callout's box. */
export interface RectDraft {
  start: Point | null
  cursor: Point | null
}

export const emptyRectDraft = (): RectDraft => ({ start: null, cursor: null })

export function rectDraftMove(d: RectDraft, p: Point): RectDraft {
  return { ...d, cursor: p }
}

export function rectDraftPlace(d: RectDraft, p: Point): RectDraft {
  return d.start === null ? { start: p, cursor: p } : { ...d, cursor: p }
}

/** A degenerate rect is a misclick; require a real drag in both axes. */
export function isRectCommittable(d: RectDraft, minSpan = 1e-6): boolean {
  if (d.start === null || d.cursor === null) return false
  return (
    Math.abs(d.cursor.x - d.start.x) > minSpan && Math.abs(d.cursor.y - d.start.y) > minSpan
  )
}

export function commitHighlight(
  d: RectDraft,
  content: Partial<HighlightContent> = {},
): { rings: Point[][]; content: HighlightContent } | null {
  if (!isRectCommittable(d)) return null
  return {
    rings: [rectRing(d.start!, d.cursor!)],
    content: { ...DEFAULT_HIGHLIGHT_CONTENT, ...content },
  }
}

/**
 * Callout draft: click the anchor, then drag the box.
 *
 * The Qt build had no anchor — its "callout" was a dragged box with no leader,
 * because Okular's PickPoint engine never populated /CL. The anchor and leader
 * here are an addition, and the reason the geometry convention is documented
 * on CalloutMarkup rather than inherited.
 */
export interface CalloutDraft {
  anchor: Point | null
  box: RectDraft
  cursor: Point | null
}

export const emptyCalloutDraft = (): CalloutDraft => ({
  anchor: null,
  box: emptyRectDraft(),
  cursor: null,
})

export function calloutDraftMove(d: CalloutDraft, p: Point): CalloutDraft {
  if (d.anchor === null) return { ...d, cursor: p }
  return { ...d, cursor: p, box: rectDraftMove(d.box, p) }
}

export function calloutDraftPlace(d: CalloutDraft, p: Point): CalloutDraft {
  if (d.anchor === null) return { ...d, anchor: p, cursor: p }
  return { ...d, cursor: p, box: rectDraftPlace(d.box, p) }
}

export function calloutDraftBack(d: CalloutDraft): CalloutDraft {
  if (d.box.start !== null) return { ...d, box: emptyRectDraft() }
  if (d.anchor !== null) return { ...d, anchor: null, cursor: null }
  return d
}

export function isCalloutCommittable(d: CalloutDraft): boolean {
  return d.anchor !== null && isRectCommittable(d.box)
}

/**
 * Freeze a callout draft. `text` is supplied by the caller — the Qt build
 * asked for it in a modal at creation time; leaving it to the integrator keeps
 * this function pure and lets the text be edited in place instead.
 */
export function commitCallout(
  d: CalloutDraft,
  content: Partial<CalloutContent> = {},
): { rings: Point[][]; content: CalloutContent } | null {
  if (!isCalloutCommittable(d)) return null
  return {
    rings: [rectRing(d.box.start!, d.box.cursor!), [d.anchor!]],
    content: { ...DEFAULT_CALLOUT_CONTENT, ...content },
  }
}

// ------------------------------------------------------------- rendering ---

export interface AnnotationDrawOptions {
  /** Scope colour, used when the content carries no explicit colour. */
  color: string
  /**
   * How the highlight fill composites.
   *
   * The Qt build painted highlights into the page image with a MULTIPLY blend,
   * so ink stayed visible through the wash. Here markups are drawn on a
   * SEPARATE overlay 2D context from the raster, and `multiply` against a
   * transparent backdrop is identical to `source-over` — the blend has nothing
   * to blend with. 'source-over' with the same alpha is therefore the honest
   * default. Pass 'multiply' only when compositing onto the raster layer
   * itself (or set mix-blend-mode on the overlay element).
   */
  blend: 'source-over' | 'multiply'
  dashed: boolean
}

export const DEFAULT_ANNOTATION_DRAW: AnnotationDrawOptions = {
  color: ANNOTATION_FALLBACK_COLOR,
  blend: 'source-over',
  dashed: false,
}

function screenRing(ring: Point[], view: Viewport, pageW: number, pageH: number): Screen[] {
  return ring.map((p) => normalizedToScreen(p.x, p.y, view, pageW, pageH))
}

function tracePath(ctx: Ctx, ring: Screen[]): void {
  ctx.beginPath()
  ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.closePath()
}

/** Draw one highlight — every quad it carries. */
export function drawHighlight(
  ctx: Ctx,
  m: HighlightMarkup,
  view: Viewport,
  pageW: number,
  pageH: number,
  options: Partial<AnnotationDrawOptions> = {},
): void {
  const o = { ...DEFAULT_ANNOTATION_DRAW, ...options }
  const color = m.content.color ?? o.color
  ctx.save()
  ctx.globalCompositeOperation = o.blend
  ctx.globalAlpha = m.content.opacity
  ctx.fillStyle = color
  for (const ring of m.rings) {
    if (ring.length < 3) continue
    tracePath(ctx, screenRing(ring, view, pageW, pageH))
    ctx.fill()
  }
  ctx.restore()
}

/** Draw one callout: leader, box, border, wrapped text. */
export function drawCallout(
  ctx: Ctx,
  m: CalloutMarkup,
  view: Viewport,
  pageW: number,
  pageH: number,
  options: Partial<AnnotationDrawOptions> = {},
): void {
  const box = m.rings[0]
  if (!box || box.length < 3) return
  const o = { ...DEFAULT_ANNOTATION_DRAW, ...options }
  const color = m.content.color ?? o.color
  const boxScreen = screenRing(box, view, pageW, pageH)
  const bounds = ringBounds(boxScreen)
  if (!bounds) return

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // leader first, so the box paints over the join
  const leader = calloutLeaderScreenPath(m, view, pageW, pageH)
  if (leader.length >= 2) {
    ctx.strokeStyle = color
    ctx.lineWidth = m.content.borderWidth
    ctx.setLineDash(o.dashed ? [4, 3] : [])
    ctx.beginPath()
    leader.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
    // a dot at the anchor so it is obvious what the callout points at
    ctx.setLineDash([])
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(leader[0]!.x, leader[0]!.y, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }

  tracePath(ctx, boxScreen)
  ctx.globalAlpha = m.content.opacity
  ctx.fillStyle = color
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = color
  ctx.lineWidth = m.content.borderWidth
  ctx.setLineDash(o.dashed ? [4, 3] : [])
  ctx.stroke()
  ctx.setLineDash([])

  if (m.content.text.length > 0) {
    const fontPx = m.content.fontPx * view.zoom
    ctx.font = `${fontPx}px system-ui, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = m.content.textColor ?? calloutTextColorFor(color)
    const pad = CALLOUT_PADDING_PX
    const lines = wrapText(ctx, m.content.text, bounds.right - bounds.left - pad * 2)
    let y = bounds.top + pad
    for (const line of lines) {
      if (y > bounds.bottom - pad) break
      ctx.fillText(line, bounds.left + pad, y)
      y += fontPx * LINE_HEIGHT
    }
  }

  ctx.restore()
}

/** Padding inside a callout box. The Qt auto-grow used 2px; kept. */
export const CALLOUT_PADDING_PX = 2
export const LINE_HEIGHT = 1.25

/** Draw the highlight tool's in-progress rectangle. */
export function drawRectDraft(
  ctx: Ctx,
  d: RectDraft,
  view: Viewport,
  pageW: number,
  pageH: number,
  options: Partial<AnnotationDrawOptions> & { opacity?: number } = {},
): void {
  if (d.start === null || d.cursor === null) return
  const o = { ...DEFAULT_ANNOTATION_DRAW, ...options }
  const ring = screenRing(rectRing(d.start, d.cursor), view, pageW, pageH)
  ctx.save()
  ctx.globalAlpha = options.opacity ?? HIGHLIGHT_OPACITY
  ctx.fillStyle = o.color
  tracePath(ctx, ring)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = o.color
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

/** Draw the callout tool's in-progress anchor and box. */
export function drawCalloutDraft(
  ctx: Ctx,
  d: CalloutDraft,
  view: Viewport,
  pageW: number,
  pageH: number,
  options: Partial<AnnotationDrawOptions> = {},
): void {
  if (d.anchor === null) return
  const o = { ...DEFAULT_ANNOTATION_DRAW, ...options }
  const anchor = normalizedToScreen(d.anchor.x, d.anchor.y, view, pageW, pageH)

  ctx.save()
  ctx.fillStyle = o.color
  ctx.beginPath()
  ctx.arc(anchor.x, anchor.y, 3, 0, Math.PI * 2)
  ctx.fill()

  if (d.box.start !== null && d.box.cursor !== null) {
    const ring = screenRing(rectRing(d.box.start, d.box.cursor), view, pageW, pageH)
    const bounds = ringBounds(ring)
    if (bounds) {
      ctx.strokeStyle = o.color
      ctx.lineWidth = CALLOUT_BORDER_WIDTH
      ctx.setLineDash([4, 3])
      const attach = leaderAttachPoint(bounds, anchor)
      ctx.beginPath()
      ctx.moveTo(anchor.x, anchor.y)
      ctx.lineTo(attach.x, attach.y)
      ctx.stroke()
      tracePath(ctx, ring)
      ctx.globalAlpha = CALLOUT_OPACITY
      ctx.fillStyle = o.color
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.stroke()
    }
  } else if (d.cursor !== null) {
    const c = normalizedToScreen(d.cursor.x, d.cursor.y, view, pageW, pageH)
    ctx.strokeStyle = o.color
    ctx.lineWidth = CALLOUT_BORDER_WIDTH
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(anchor.x, anchor.y)
    ctx.lineTo(c.x, c.y)
    ctx.stroke()
  }
  ctx.restore()
}

/** Greedy word wrap. Falls back to a character estimate without measureText. */
export function wrapText(ctx: Ctx, text: string, maxWidthPx: number): string[] {
  const measure = (s: string): number => {
    const m = typeof ctx.measureText === 'function' ? ctx.measureText(s) : undefined
    const w = m?.width
    return typeof w === 'number' && Number.isFinite(w) ? w : s.length * 6
  }
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of paragraph.split(/\s+/).filter((w) => w.length > 0)) {
      const candidate = line.length === 0 ? word : `${line} ${word}`
      if (line.length > 0 && maxWidthPx > 0 && measure(candidate) > maxWidthPx) {
        out.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    out.push(line)
  }
  return out
}

/**
 * Grow a callout box so its text fits, never shrinking it.
 *
 * Port of the auto-grow in the Qt PickPoint engine's end(): the dragged rect is
 * the minimum, and the right/bottom edges are pushed out to the wrapped text
 * plus 2px padding on each side. The Qt version used QFontMetrics against the
 * page pixmap; this measures with the supplied context, so the two will not
 * agree to the pixel. Nothing here feeds a quantity.
 *
 * Returns a new box ring in normalized coordinates.
 */
export function fitCalloutBox(
  ctx: Ctx,
  m: CalloutMarkup,
  view: Viewport,
  pageW: number,
  pageH: number,
): Point[] | null {
  const box = m.rings[0]
  if (!box || box.length < 3) return null
  const bounds = ringBounds(box)
  if (!bounds) return null

  const fontPx = m.content.fontPx * view.zoom
  ctx.save()
  ctx.font = `${fontPx}px system-ui, sans-serif`
  const pad = CALLOUT_PADDING_PX
  const widthPx = (bounds.right - bounds.left) * pageW * view.zoom
  const lines = wrapText(ctx, m.content.text, Math.max(0, widthPx - pad * 2))
  let textWidth = 0
  for (const line of lines) {
    const w = typeof ctx.measureText === 'function' ? ctx.measureText(line).width : line.length * 6
    if (Number.isFinite(w) && w > textWidth) textWidth = w
  }
  ctx.restore()

  const textHeight = lines.length * fontPx * LINE_HEIGHT
  const neededW = (textWidth + pad * 2) / (pageW * view.zoom)
  const neededH = (textHeight + pad * 2) / (pageH * view.zoom)

  return rectRing(
    { x: bounds.left, y: bounds.top },
    {
      x: Math.max(bounds.right, bounds.left + neededW),
      y: Math.max(bounds.bottom, bounds.top + neededH),
    },
  )
}

// ---------------------------------------------------------- hit-testing ----

export type AnnotationHitPart = 'vertex' | 'edge' | 'inside' | 'anchor' | 'knee'

export interface AnnotationHit {
  markupId: string
  part: AnnotationHitPart
  /** Vertex/knee index, edge's first-vertex index, or -1. */
  index: number
  /** Which ring the hit is on: 0 = box/quad, 1 = leader. */
  ring: number
}

/**
 * Topmost highlight hit.
 *
 * Same precedence as hit.ts — vertex, then edge, then interior — extended
 * across every quad the highlight carries.
 */
export function hitTestHighlight(
  sx: number,
  sy: number,
  markups: HighlightMarkup[],
  view: Viewport,
  pageW: number,
  pageH: number,
): AnnotationHit | null {
  const rings = markups.map((m) => m.rings.map((r) => screenRing(r, view, pageW, pageH)))

  for (let i = markups.length - 1; i >= 0; i--) {
    for (const [ri, ring] of (rings[i] ?? []).entries()) {
      for (let vi = 0; vi < ring.length; vi++) {
        const v = ring[vi]!
        if (Math.hypot(v.x - sx, v.y - sy) <= VERTEX_GRAB_PX) {
          return { markupId: markups[i]!.id, part: 'vertex', index: vi, ring: ri }
        }
      }
    }
  }
  for (let i = markups.length - 1; i >= 0; i--) {
    for (const [ri, ring] of (rings[i] ?? []).entries()) {
      const e = nearestEdge({ x: sx, y: sy }, ring, true)
      if (e && e.distance <= EDGE_GRAB_PX) {
        return { markupId: markups[i]!.id, part: 'edge', index: e.index, ring: ri }
      }
    }
  }
  for (let i = markups.length - 1; i >= 0; i--) {
    for (const [ri, ring] of (rings[i] ?? []).entries()) {
      if (pointInPolygon({ x: sx, y: sy }, ring)) {
        return { markupId: markups[i]!.id, part: 'inside', index: -1, ring: ri }
      }
    }
  }
  return null
}

/**
 * Topmost callout hit.
 *
 * The anchor and knee come first: they are small, they sit outside the box,
 * and losing them to the box interior would make a leader impossible to
 * re-aim. Then the box's own vertices, its edges, its interior, and finally
 * the leader segments.
 */
export function hitTestCallout(
  sx: number,
  sy: number,
  markups: CalloutMarkup[],
  view: Viewport,
  pageW: number,
  pageH: number,
): AnnotationHit | null {
  const p = { x: sx, y: sy }
  const boxes = markups.map((m) => screenRing(m.rings[0] ?? [], view, pageW, pageH))
  const leaders = markups.map((m) => screenRing(m.rings[1] ?? [], view, pageW, pageH))

  for (let i = markups.length - 1; i >= 0; i--) {
    const leader = leaders[i] ?? []
    for (let li = 0; li < leader.length; li++) {
      const v = leader[li]!
      if (Math.hypot(v.x - sx, v.y - sy) <= VERTEX_GRAB_PX) {
        return {
          markupId: markups[i]!.id,
          part: li === 0 ? 'anchor' : 'knee',
          index: li,
          ring: 1,
        }
      }
    }
  }
  for (let i = markups.length - 1; i >= 0; i--) {
    const box = boxes[i] ?? []
    for (let vi = 0; vi < box.length; vi++) {
      const v = box[vi]!
      if (Math.hypot(v.x - sx, v.y - sy) <= VERTEX_GRAB_PX) {
        return { markupId: markups[i]!.id, part: 'vertex', index: vi, ring: 0 }
      }
    }
  }
  for (let i = markups.length - 1; i >= 0; i--) {
    const e = nearestEdge(p, boxes[i] ?? [], true)
    if (e && e.distance <= EDGE_GRAB_PX) {
      return { markupId: markups[i]!.id, part: 'edge', index: e.index, ring: 0 }
    }
  }
  for (let i = markups.length - 1; i >= 0; i--) {
    if (pointInPolygon(p, boxes[i] ?? [])) {
      return { markupId: markups[i]!.id, part: 'inside', index: -1, ring: 0 }
    }
  }
  for (let i = markups.length - 1; i >= 0; i--) {
    const path = calloutLeaderScreenPath(markups[i]!, view, pageW, pageH)
    for (let si = 1; si < path.length; si++) {
      if (distanceToSegment(p, path[si - 1]!, path[si]!) <= EDGE_GRAB_PX) {
        return { markupId: markups[i]!.id, part: 'edge', index: si - 1, ring: 1 }
      }
    }
  }
  return null
}
