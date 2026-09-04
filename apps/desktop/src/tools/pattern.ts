/**
 * Pattern origin, pattern direction and direction zone authoring.
 *
 * Ports the tool half of okular-redbeam `part/redbeamscopepanel.cpp`
 * (`activatePatternOriginTool`, `activatePatternDirectionTool`) and the MCP
 * `redbeam_create_direction_zone` shape — an area polygon plus a direction
 * bound to it, created as one act.
 *
 * Everything here is a pure function over explicit arguments: a draft state
 * machine, canvas painters in the shape hit.ts uses, a hit-tester with the same
 * precedence, and a projection into the viewer overlay primitives in the shape
 * packages/viewer/src/overlay.ts consumes. No React, no store, no viewport
 * ownership — Workspace wires it.
 *
 * COORDINATES: everything stored and returned is NORMALIZED page space [0,1],
 * exactly like draw.ts. Screen space appears only inside the painters and the
 * hit-tester, so grab tolerances stay constant in pixels regardless of zoom.
 *
 * ANGLE CONVENTION: see packages/domain/src/pattern.ts. y grows DOWN, angles
 * are folded to [0,180) because a pattern direction is an axis, and every angle
 * is computed on PDF-point deltas rather than normalized ones so the page
 * aspect ratio cannot skew it.
 */
import {
  distanceToSegment,
  nearestEdge,
  normalizedDirectionAngle,
  pointInRegion,
  toNormalized,
  toPagePoints,
  type DirectionZone,
  type NormalizedDirection,
  type PageSize,
  type Point,
  type Region,
} from '@redbeam/domain'
import type { DotOverlay, LineOverlay, OverlaySet, PolygonOverlay, Viewport } from '@redbeam/viewer'
import { normalizedToScreen } from '../draw.js'
import { EDGE_GRAB_PX, VERTEX_GRAB_PX, type HitPart } from '../hit.js'

export type PatternTool = 'pattern-origin' | 'pattern-direction' | 'direction-zone'

/**
 * A zone is authored in two phases: the boundary ring first, then the direction
 * that runs inside it. The origin and direction tools skip straight to 'vector'.
 */
export type PatternDraftPhase = 'region' | 'vector'

export interface PatternDraft {
  tool: PatternTool
  phase: PatternDraftPhase
  /** Zone boundary vertices, normalized. Always empty for the other tools. */
  boundary: Point[]
  /** The origin point (1) or the direction endpoints (2), normalized. */
  vector: Point[]
  /** Live cursor, normalized — drawn as a rubber band. */
  cursor: Point | null
}

/** How many points the 'vector' phase collects before it is full. */
export function vectorCapacity(tool: PatternTool): number {
  return tool === 'pattern-origin' ? 1 : 2
}

export function emptyPatternDraft(tool: PatternTool): PatternDraft {
  return {
    tool,
    phase: tool === 'direction-zone' ? 'region' : 'vector',
    boundary: [],
    vector: [],
    cursor: null,
  }
}

export function patternDraftSetCursor(d: PatternDraft, cursor: Point | null): PatternDraft {
  return { ...d, cursor }
}

/**
 * Place a vertex.
 *
 * A full 'vector' phase ignores further clicks rather than sliding the window:
 * a direction that silently redefines itself on a stray click is how a ceiling
 * ends up running the wrong way with nothing on screen to show for it. The
 * caller commits, or undoes.
 */
export function patternDraftAddPoint(d: PatternDraft, p: Point): PatternDraft {
  if (d.phase === 'region') return { ...d, boundary: [...d.boundary, p] }
  if (d.vector.length >= vectorCapacity(d.tool)) return d
  return { ...d, vector: [...d.vector, p] }
}

/** A zone boundary needs three vertices before it can be closed. */
export function canClosePatternRegion(d: PatternDraft): boolean {
  return d.tool === 'direction-zone' && d.phase === 'region' && d.boundary.length >= 3
}

/** Close the zone boundary and move on to drawing the direction inside it. */
export function closePatternRegion(d: PatternDraft): PatternDraft {
  if (!canClosePatternRegion(d)) return d
  return { ...d, phase: 'vector', cursor: null }
}

/** Drop the last vertex, stepping back into the boundary phase if needed. */
export function patternDraftUndo(d: PatternDraft): PatternDraft {
  if (d.phase === 'vector' && d.vector.length > 0) {
    return { ...d, vector: d.vector.slice(0, -1) }
  }
  if (d.phase === 'vector' && d.tool === 'direction-zone') {
    return { ...d, phase: 'region' }
  }
  if (d.phase === 'region' && d.boundary.length > 0) {
    return { ...d, boundary: d.boundary.slice(0, -1) }
  }
  return d
}

/**
 * A direction of zero length is not a direction — it is the Qt
 * `line.length() > 0.0` guard, applied before the geometry is ever stored.
 */
function isDegenerateDirection(a: Point | undefined, b: Point | undefined): boolean {
  if (!a || !b) return true
  return a.x === b.x && a.y === b.y
}

export function isPatternDraftCommittable(d: PatternDraft): boolean {
  switch (d.tool) {
    case 'pattern-origin':
      return d.vector.length === 1
    case 'pattern-direction':
      return d.vector.length === 2 && !isDegenerateDirection(d.vector[0], d.vector[1])
    case 'direction-zone':
      return (
        d.phase === 'vector' &&
        d.boundary.length >= 3 &&
        d.vector.length === 2 &&
        !isDegenerateDirection(d.vector[0], d.vector[1])
      )
  }
}

export type PatternCommit =
  | {
      kind: 'origin'
      /** The placed point, normalized. */
      point: Point
      /**
       * The same point as markup rings, so an origin persists through the same
       * `markups.geometry_json` path as every other markup. patternOriginPoint
       * takes the bounding-rect centre, and the centre of a one-point ring is
       * that point — a dot, a circle or a small box all mean the same thing.
       */
      rings: Region
    }
  | { kind: 'direction'; direction: NormalizedDirection }
  | { kind: 'zone'; rings: Region; direction: NormalizedDirection }

/** Freeze a draft into storable normalized geometry, or null if incomplete. */
export function commitPatternDraft(d: PatternDraft): PatternCommit | null {
  if (!isPatternDraftCommittable(d)) return null
  const a = d.vector[0]!
  switch (d.tool) {
    case 'pattern-origin':
      return { kind: 'origin', point: a, rings: [[a]] }
    case 'pattern-direction':
      return { kind: 'direction', direction: [a, d.vector[1]!] }
    case 'direction-zone':
      return { kind: 'zone', rings: [d.boundary.slice()], direction: [a, d.vector[1]!] }
  }
}

/** Prop-shaped descriptor for whatever toolbar or inspector renders the tool. */
export interface PatternToolStatus {
  tool: PatternTool
  phase: PatternDraftPhase
  pointsPlaced: number
  canCommit: boolean
  canUndo: boolean
  canCloseRegion: boolean
  hint: string
}

export function patternToolStatus(d: PatternDraft): PatternToolStatus {
  const placed = d.phase === 'region' ? d.boundary.length : d.vector.length
  let hint: string
  if (d.tool === 'pattern-origin') {
    hint = d.vector.length === 0 ? 'Click where the pattern starts' : 'Origin placed'
  } else if (d.phase === 'region') {
    hint =
      d.boundary.length < 3
        ? 'Trace the zone boundary'
        : 'Double-click or press Enter to close the zone'
  } else {
    hint =
      d.vector.length === 0
        ? 'Click the first point of the direction'
        : d.vector.length === 1
          ? 'Click the second point to set the direction'
          : 'Direction set'
  }
  return {
    tool: d.tool,
    phase: d.phase,
    pointsPlaced: placed,
    canCommit: isPatternDraftCommittable(d),
    canUndo: d.boundary.length > 0 || d.vector.length > 0,
    canCloseRegion: canClosePatternRegion(d),
    hint,
  }
}

// ---------------------------------------------------------------------------
// Items — what the page already holds
// ---------------------------------------------------------------------------

export interface PatternOriginItem {
  kind: 'origin'
  id: string
  point: Point
  color?: string
  label?: string
}

export interface PatternDirectionItem {
  kind: 'direction'
  id: string
  direction: NormalizedDirection
  /**
   * 'page' is one page-wide override; 'scope' is the scope default drawn on
   * this page. Zones carry their own direction and are not listed here.
   */
  level: 'page' | 'scope'
  color?: string
  label?: string
}

export interface PatternZoneItem {
  kind: 'zone'
  id: string
  rings: Region
  direction: NormalizedDirection
  priority?: number
  color?: string
  label?: string
}

export type PatternItem = PatternOriginItem | PatternDirectionItem | PatternZoneItem

/** Zone items as the domain resolver wants them, preserving array order. */
export function zonesOf(items: readonly PatternItem[]): DirectionZone[] {
  const out: DirectionZone[] = []
  for (const item of items) {
    if (item.kind !== 'zone') continue
    const zone: DirectionZone = { id: item.id, rings: item.rings, direction: item.direction }
    if (item.priority !== undefined) zone.priority = item.priority
    out.push(zone)
  }
  return out
}

/** Origin items as the domain resolver wants them. */
export function originMarkupsOf(items: readonly PatternItem[]): Array<{ id: string; rings: Region }> {
  return items
    .filter((i): i is PatternOriginItem => i.kind === 'origin')
    .map((i) => ({ id: i.id, rings: [[i.point]] }))
}

/** Angle of an item, degrees in [0,180), or null when degenerate. */
export function patternItemAngle(item: PatternItem, page: PageSize): number | null {
  if (item.kind === 'origin') return null
  return normalizedDirectionAngle(item.direction, page)
}

/** "45.0°" — the label that tells an estimator which way the ceiling runs. */
export function formatAxisAngle(degrees: number | null): string {
  return degrees === null ? '—' : `${degrees.toFixed(1)}°`
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export const PATTERN_COLORS = {
  origin: '#00a651',
  direction: '#2580b4',
  zone: '#b46a25',
} as const

export interface PatternDrawOptions {
  /** Draw angle labels. Suppressed when zoomed out, where they would be soup. */
  labels?: boolean
  /** Minimum zoom at which labels appear — matches the viewer overlay default. */
  labelMinZoom?: number
  selectedId?: string | null
}

const ARROW_PX = 9

function arrowHead(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (!(len > 0)) return
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(to.x - ux * ARROW_PX + nx * ARROW_PX * 0.45, to.y - uy * ARROW_PX + ny * ARROW_PX * 0.45)
  ctx.lineTo(to.x - ux * ARROW_PX - nx * ARROW_PX * 0.45, to.y - uy * ARROW_PX - ny * ARROW_PX * 0.45)
  ctx.closePath()
  ctx.fill()
}

function strokeRing(
  ctx: CanvasRenderingContext2D,
  ring: Array<{ x: number; y: number }>,
  close: boolean,
): void {
  if (ring.length === 0) return
  ctx.beginPath()
  ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  if (close) ctx.closePath()
}

/**
 * Paint the committed pattern items.
 *
 * Screen space throughout, on the overlay layer, after the markups and before
 * the draft — the same stacking draw.ts assumes.
 */
export function drawPatternItems(
  ctx: CanvasRenderingContext2D,
  items: readonly PatternItem[],
  view: Viewport,
  pageW: number,
  pageH: number,
  opts: PatternDrawOptions = {},
): void {
  const page: PageSize = { width: pageW, height: pageH }
  const showLabels = (opts.labels ?? true) && view.zoom > (opts.labelMinZoom ?? 0.5)
  const pt = (p: Point) => normalizedToScreen(p.x, p.y, view, pageW, pageH)

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  for (const item of items) {
    const selected = opts.selectedId != null && opts.selectedId === item.id

    if (item.kind === 'zone') {
      const color = item.color ?? PATTERN_COLORS.zone
      for (const ring of item.rings) {
        if (ring.length < 2) continue
        strokeRing(ctx, ring.map(pt), true)
        ctx.globalAlpha = 0.1
        ctx.fillStyle = color
        ctx.fill()
        ctx.globalAlpha = selected ? 1 : 0.85
        ctx.strokeStyle = color
        ctx.lineWidth = selected ? 2.5 : 1.6
        ctx.setLineDash([7, 4])
        ctx.stroke()
      }
    }

    if (item.kind === 'zone' || item.kind === 'direction') {
      const color =
        item.color ?? (item.kind === 'zone' ? PATTERN_COLORS.zone : PATTERN_COLORS.direction)
      const a = pt(item.direction[0])
      const b = pt(item.direction[1])
      ctx.globalAlpha = 1
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = selected ? 3 : 2
      // A scope default is dashed: it is inherited, not drawn for this page.
      ctx.setLineDash(item.kind === 'direction' && item.level === 'scope' ? [8, 5] : [])
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.setLineDash([])
      // Arrowheads at both ends: the direction is an AXIS, and a single arrow
      // reads as a one-way run that the layout engine does not mean.
      arrowHead(ctx, a, b)
      arrowHead(ctx, b, a)
      if (showLabels) {
        const text = item.label ?? formatAxisAngle(patternItemAngle(item, page))
        ctx.fillStyle = '#111'
        ctx.font = '11px system-ui, sans-serif'
        ctx.fillText(text, (a.x + b.x) / 2 + 6, (a.y + b.y) / 2 - 5)
      }
    }

    if (item.kind === 'origin') {
      const color = item.color ?? PATTERN_COLORS.origin
      const s = pt(item.point)
      const r = selected ? 8 : 6
      ctx.globalAlpha = 1
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 2
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
      ctx.stroke()
      // crosshair, so the exact point is readable at any zoom
      ctx.beginPath()
      ctx.moveTo(s.x - r - 4, s.y)
      ctx.lineTo(s.x + r + 4, s.y)
      ctx.moveTo(s.x, s.y - r - 4)
      ctx.lineTo(s.x, s.y + r + 4)
      ctx.stroke()
      if (showLabels && item.label) {
        ctx.fillStyle = '#111'
        ctx.font = '11px system-ui, sans-serif'
        ctx.fillText(item.label, s.x + r + 6, s.y - 4)
      }
    }
  }

  ctx.restore()
}

/** Paint the in-progress draft on top of everything else. */
export function drawPatternDraft(
  ctx: CanvasRenderingContext2D,
  d: PatternDraft,
  view: Viewport,
  pageW: number,
  pageH: number,
): void {
  if (d.boundary.length === 0 && d.vector.length === 0 && d.cursor === null) return
  const pt = (p: Point) => normalizedToScreen(p.x, p.y, view, pageW, pageH)
  const color = d.tool === 'pattern-origin' ? PATTERN_COLORS.origin
    : d.tool === 'direction-zone' ? PATTERN_COLORS.zone
      : PATTERN_COLORS.direction

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2

  if (d.boundary.length > 0) {
    const ring = (d.phase === 'region' && d.cursor ? [...d.boundary, d.cursor] : d.boundary).map(pt)
    strokeRing(ctx, ring, d.boundary.length >= 2)
    ctx.globalAlpha = 0.1
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.setLineDash(d.phase === 'region' ? [5, 4] : [7, 4])
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (d.phase === 'vector' && d.vector.length > 0) {
    const a = pt(d.vector[0]!)
    if (d.tool === 'pattern-origin') {
      ctx.beginPath()
      ctx.arc(a.x, a.y, 6, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      const endNorm = d.vector[1] ?? d.cursor
      if (endNorm) {
        const b = pt(endNorm)
        ctx.setLineDash(d.vector.length < 2 ? [5, 4] : [])
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
        ctx.setLineDash([])
        arrowHead(ctx, a, b)
        arrowHead(ctx, b, a)
      }
    }
  }

  // vertex handles
  ctx.setLineDash([])
  ctx.lineWidth = 1.5
  ctx.strokeStyle = color
  for (const p of [...d.boundary, ...d.vector]) {
    const s = pt(p)
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.rect(s.x - 3, s.y - 3, 6, 6)
    ctx.fill()
    ctx.stroke()
  }

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Viewer overlay primitives
// ---------------------------------------------------------------------------

/** Length of an arrow barb, in PDF points, for the overlay projection. */
const OVERLAY_BARB_POINTS = 14

function barbLines(
  direction: NormalizedDirection,
  page: PageSize,
  color: string,
  dashed: boolean,
): LineOverlay[] {
  const a = toPagePoints(direction[0], page)
  const b = toPagePoints(direction[1], page)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (!(len > 0)) return []
  const ux = dx / len
  const uy = dy / len
  const out: LineOverlay[] = []
  // Barbs are built in PDF points and only then normalized: doing it in
  // normalized space would shear the arrowhead by the page aspect ratio.
  for (const [tip, sx, sy] of [
    [b, -ux, -uy],
    [a, ux, uy],
  ] as const) {
    for (const sign of [1, -1]) {
      const bx = tip.x + sx * OVERLAY_BARB_POINTS + -sy * sign * OVERLAY_BARB_POINTS * 0.45
      const by = tip.y + sy * OVERLAY_BARB_POINTS + sx * sign * OVERLAY_BARB_POINTS * 0.45
      const t = toNormalized(tip, page)
      const e = toNormalized({ x: bx, y: by }, page)
      out.push({ x1: t.x, y1: t.y, x2: e.x, y2: e.y, color, opacity: 1, width: 1.6, dashed })
    }
  }
  return out
}

/**
 * Project pattern items into the viewer overlay primitives.
 *
 * Follows packages/viewer/src/overlay.ts exactly — normalized coordinates,
 * a cached centroid on every polygon for the cheap culling pass — without
 * importing the renderer.
 */
export function patternOverlaySet(items: readonly PatternItem[], page: PageSize): OverlaySet {
  const polygons: PolygonOverlay[] = []
  const lines: LineOverlay[] = []
  const dots: DotOverlay[] = []

  for (const item of items) {
    if (item.kind === 'zone') {
      const color = item.color ?? PATTERN_COLORS.zone
      for (const ring of item.rings) {
        if (ring.length < 3) continue
        let cx = 0
        let cy = 0
        for (const p of ring) {
          cx += p.x
          cy += p.y
        }
        const poly: PolygonOverlay = {
          poly: ring.map((p) => [p.x, p.y] as [number, number]),
          fill: color,
          stroke: color,
          fillOpacity: 0.1,
          strokeOpacity: 0.85,
          strokeWidth: 1.6,
          dashed: true,
          cx: cx / ring.length,
          cy: cy / ring.length,
        }
        const label = item.label ?? formatAxisAngle(normalizedDirectionAngle(item.direction, page))
        if (label) poly.label = label
        polygons.push(poly)
      }
    }

    if (item.kind === 'zone' || item.kind === 'direction') {
      const color =
        item.color ?? (item.kind === 'zone' ? PATTERN_COLORS.zone : PATTERN_COLORS.direction)
      const dashed = item.kind === 'direction' && item.level === 'scope'
      const shaft: LineOverlay = {
        x1: item.direction[0].x,
        y1: item.direction[0].y,
        x2: item.direction[1].x,
        y2: item.direction[1].y,
        color,
        opacity: 1,
        width: 2,
        dashed,
      }
      if (item.kind === 'direction') {
        shaft.label = item.label ?? formatAxisAngle(normalizedDirectionAngle(item.direction, page))
      }
      lines.push(shaft)
      lines.push(...barbLines(item.direction, page, color, false))
    }

    if (item.kind === 'origin') {
      dots.push({
        x: item.point.x,
        y: item.point.y,
        color: item.color ?? PATTERN_COLORS.origin,
        opacity: 1,
        r: 5,
        shape: 'diamond',
      })
    }
  }

  return { polygons, lines, dots }
}

// ---------------------------------------------------------------------------
// Hit-testing
// ---------------------------------------------------------------------------

export interface PatternHit {
  id: string
  kind: PatternItem['kind']
  /** 'vertex' | 'edge' | 'inside', as in hit.ts. */
  part: HitPart
  /** Which geometry of the item was hit. An origin is always 'point'. */
  target: 'boundary' | 'direction' | 'point'
  /** Vertex index, or the index of an edge's first vertex. -1 for 'inside'. */
  index: number
}

const ORIGIN_GRAB_PX = VERTEX_GRAB_PX + 3

function screenRing(
  ring: readonly Point[],
  v: Viewport,
  w: number,
  h: number,
): Array<{ x: number; y: number }> {
  return ring.map((p) => normalizedToScreen(p.x, p.y, v, w, h))
}

/**
 * Topmost pattern item at a screen point.
 *
 * Same precedence as hit.ts — vertex > edge > inside, later items win ties
 * because they are painted on top. Without vertex-first you could never grab a
 * direction endpoint that sits inside the zone it orients, which is where it
 * always sits.
 */
export function hitTestPattern(
  sx: number,
  sy: number,
  items: readonly PatternItem[],
  view: Viewport,
  pageW: number,
  pageH: number,
): PatternHit | null {
  const p = { x: sx, y: sy }

  // pass 1: origins and direction endpoints and zone boundary vertices
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item.kind === 'origin') {
      const s = normalizedToScreen(item.point.x, item.point.y, view, pageW, pageH)
      if (Math.hypot(s.x - sx, s.y - sy) <= ORIGIN_GRAB_PX) {
        return { id: item.id, kind: 'origin', part: 'vertex', target: 'point', index: 0 }
      }
      continue
    }
    const ends = screenRing(item.direction, view, pageW, pageH)
    for (let vi = 0; vi < ends.length; vi++) {
      const v = ends[vi]!
      if (Math.hypot(v.x - sx, v.y - sy) <= VERTEX_GRAB_PX) {
        return { id: item.id, kind: item.kind, part: 'vertex', target: 'direction', index: vi }
      }
    }
    if (item.kind === 'zone') {
      const ring = screenRing(item.rings[0] ?? [], view, pageW, pageH)
      for (let vi = 0; vi < ring.length; vi++) {
        const v = ring[vi]!
        if (Math.hypot(v.x - sx, v.y - sy) <= VERTEX_GRAB_PX) {
          return { id: item.id, kind: 'zone', part: 'vertex', target: 'boundary', index: vi }
        }
      }
    }
  }

  // pass 2: direction shafts, then zone boundary edges
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item.kind === 'origin') continue
    const ends = screenRing(item.direction, view, pageW, pageH)
    const a = ends[0]
    const b = ends[1]
    if (a && b && distanceToSegment(p, a, b) <= EDGE_GRAB_PX) {
      return { id: item.id, kind: item.kind, part: 'edge', target: 'direction', index: 0 }
    }
    if (item.kind === 'zone') {
      const ring = screenRing(item.rings[0] ?? [], view, pageW, pageH)
      if (ring.length >= 2) {
        const e = nearestEdge(p, ring, true)
        if (e && e.distance <= EDGE_GRAB_PX) {
          return { id: item.id, kind: 'zone', part: 'edge', target: 'boundary', index: e.index }
        }
      }
    }
  }

  // pass 3: zone interiors, even/odd so a hole is not part of the zone
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item.kind !== 'zone') continue
    const rings = item.rings.map((ring) => screenRing(ring, view, pageW, pageH))
    if (pointInRegion(p, rings)) {
      return { id: item.id, kind: 'zone', part: 'inside', target: 'boundary', index: -1 }
    }
  }

  return null
}

/**
 * NOTE on the two lookups, because confusing them is silent and expensive.
 *
 * hitTestPattern answers "what did the user grab" — topmost wins, so it depends
 * on paint order. resolvePatternDirection / resolveDirectionZone in
 * packages/domain/src/pattern.ts answer "what runs here" — most specific wins,
 * and nothing about it depends on paint order. Never use the hit-tester to
 * decide a direction: quantities would then move when a zone is redrawn.
 */
