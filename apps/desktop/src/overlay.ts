/** Project domain markups into viewer overlay primitives. */
import type { Markup, Scope } from '@redbeam/domain'
import type { OverlaySet } from '@redbeam/viewer'

const FALLBACK = '#8a929c'

export function toOverlay(markups: Markup[], scopes: Scope[]): OverlaySet {
  const colorOf = new Map(scopes.map((s) => [s.id, s.color]))
  const set: OverlaySet = { polygons: [], lines: [], dots: [] }

  for (const m of markups) {
    const color = (m.scopeId ? colorOf.get(m.scopeId) : undefined) ?? FALLBACK
    const ring = m.rings[0]
    if (!ring || ring.length === 0) continue

    if (m.kind === 'area' || m.kind === 'cutout' || m.kind === 'shape') {
      let cx = 0, cy = 0
      for (const p of ring) { cx += p.x; cy += p.y }
      cx /= ring.length; cy /= ring.length
      set.polygons.push({
        poly: ring.map((p) => [p.x, p.y] as [number, number]),
        fill: color,
        stroke: color,
        // cutouts read as openings: no fill, dashed edge
        // A shape is annotation, not measured material: outline-weighted so it
        // never reads as area someone is being billed for.
        fillOpacity: m.kind === 'cutout' ? 0 : m.kind === 'shape' ? 0.08 : 0.16,
        strokeOpacity: 0.9,
        strokeWidth: 1.4,
        dashed: m.kind === 'cutout',
        ...(m.kind === 'shape' ? { strokeWidth: 1.8 } : {}),
        cx,
        cy,
      })
    } else if (m.kind === 'polyline') {
      // one overlay line per segment so long polylines stay visible
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1]!, b = ring[i]!
        set.lines.push({
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          color, opacity: 1, width: 2, dashed: false,
        })
      }
    } else if (m.kind === 'count') {
      const a = ring[0]!
      set.dots.push({ x: a.x, y: a.y, color, opacity: 1, r: 5, shape: 'circle' })
    }
  }
  return set
}
