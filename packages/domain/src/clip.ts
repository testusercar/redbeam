/**
 * Polygon booleans, for the one place the takeoff needs them: fitting a
 * cutout to the area it opens.
 *
 * The Qt build subtracted cutouts into a QPainterPath and got clipping for
 * free — a cutout drawn across an area's edge removed only the part inside,
 * and one drawn beside an area removed nothing. This port keeps explicit
 * rings and classifies them by nesting depth (see `regionArea`), which is
 * right for rings that never cross and wrong for a cutout that does: the
 * part of it OUTSIDE the area sits at depth 1 under its own ring alone and
 * even/odd counts it as material. Kenneth, 2026-09-10: "the cutout tool
 * appears to be adding product instead of removing it". This module is the
 * clipping the path used to do.
 *
 * Martinez–Rueda via `polygon-clipping` (MIT). It is the domain's only
 * dependency and it is wrapped here so nothing else in the package knows
 * its coordinate shape, and so it can be swapped for a port later without
 * touching a caller.
 */

import type { Point, Polygon, Region } from './geometry.js'
import * as clipperModule from 'polygon-clipping'

type Pair = [number, number]
type ClipRing = Pair[]
type ClipPolygon = ClipRing[]
type ClipMulti = ClipPolygon[]
type Geom = ClipPolygon | ClipMulti
interface Clipper {
  union(geom: Geom, ...geoms: Geom[]): ClipMulti
  intersection(geom: Geom, ...geoms: Geom[]): ClipMulti
  difference(subject: Geom, ...clips: Geom[]): ClipMulti
}

/*
 * The package's typings declare named exports; its ESM build has a default
 * export carrying them, and its CJS build assigns the same object to
 * module.exports. Take whichever the loader handed over.
 */
const clipper: Clipper =
  (clipperModule as unknown as { default?: Clipper }).default
  ?? (clipperModule as unknown as Clipper)

const toClipRing = (ring: Polygon): ClipRing => ring.map((p): Pair => [p.x, p.y])

/** Each ring becomes its own polygon; the clipper unions them itself. */
const toMulti = (rings: readonly Polygon[]): ClipMulti =>
  rings.filter((r) => r.length >= 3).map((r) => [toClipRing(r)])

/**
 * Back to rings. The clipper closes every ring by repeating its first
 * point; ours do not, so the repeat is dropped. Holes come back as further
 * rings of the same polygon and are kept: `regionArea` sorts material from
 * opening by nesting, which is exactly what they are.
 */
function fromMulti(multi: ClipMulti): Region {
  const out: Region = []
  for (const polygon of multi) {
    for (const ring of polygon) {
      const points: Point[] = ring.map(([x, y]) => ({ x, y }))
      const first = points[0]
      const last = points[points.length - 1]
      if (points.length > 1 && first !== undefined && last !== undefined
          && first.x === last.x && first.y === last.y) points.pop()
      if (points.length >= 3) out.push(points)
    }
  }
  return out
}

/**
 * The part of `subject` that lies inside the union of `within`.
 *
 * Empty when they do not overlap. Several rings when the areas split the
 * subject — a cutout across a gap between two areas comes back as two
 * openings, one per area, which is what it is.
 */
export function clipRingToRings(subject: Polygon, within: readonly Polygon[]): Region {
  if (subject.length < 3) return []
  const clip = toMulti(within)
  if (clip.length === 0) return []
  return fromMulti(clipper.intersection([toClipRing(subject)], clip))
}

/** True when the two rings share any interior. Touching edges do not count. */
export function ringsOverlap(a: Polygon, b: Polygon): boolean {
  if (a.length < 3 || b.length < 3) return false
  return clipper.intersection([toClipRing(a)], [toClipRing(b)]).length > 0
}

/** Union of rings, as rings (outer boundaries first, then their holes). */
export function unionRings(rings: readonly Polygon[]): Region {
  const multi = toMulti(rings)
  if (multi.length === 0) return []
  return fromMulti(clipper.union(multi))
}

/**
 * `material` with `openings` removed, as rings.
 *
 * The union of the material first, then every opening taken out of it in one
 * operation. One operation, because the result is a valid polygon set: an
 * opening across an edge becomes a NOTCH in the outer ring and only an
 * opening wholly inside becomes a hole, and feeding that result back in for
 * a second opening would union its holes shut. Callers collect their
 * openings and subtract once.
 *
 * With no openings the material is returned untouched, vertex order and all:
 * nothing that was right before may move.
 */
export function subtractRings(material: readonly Polygon[], openings: readonly Polygon[]): Region {
  const subject = toMulti(material)
  const clips = toMulti(openings)
  if (subject.length === 0) return []
  if (clips.length === 0) return material.filter((r) => r.length >= 3).map((r) => [...r])
  return fromMulti(clipper.difference(clipper.union(subject), clips))
}
