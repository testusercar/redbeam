/**
 * Devices, and the pieces they make factory-cut (issue #12).
 *
 * A device is anything mounted THROUGH the ceiling: a light, a diffuser, a
 * sprinkler head, a speaker. The estimator already places them with the Count
 * tool, in a count scope of their own. What the count could not say is which
 * panel or plank each one lands in, and that is the question the order asks:
 * a piece with a device in it is cut at the factory, so it is a different line
 * from the same piece left whole. Aaron, 2026-11-12, approving the reading
 * "lights, diffusers and sprinklers get placed with the Count tool, and the
 * user wants to see which panels or planks they land in".
 *
 * A count scope is a device scope when its `device` specification is true.
 * That is a flag on the scope rather than a new product type, because a count
 * scope of exit signs and one of downlights are the same kind of takeoff; the
 * only difference is whether they pass through the product.
 *
 * Containment is tested in PDF POINTS on one page, the space the layout engine
 * returns its cells and pieces in. A device on a seam is inside BOTH pieces it
 * touches, because both have to be cut to fit it.
 */

import { distanceToSegment, type Point } from './geometry.js'
import { pointInOrOnRegion, toPagePoints, type PageSize } from './pattern.js'
import type { PanelCell } from './panels.js'
import type { Piece } from './pieces.js'
import type { Markup, Scope } from './scope.js'
import { readBool } from './specs.js'
import type { PieceResult } from './takeoff.js'

/** The specification that makes a count scope a device scope. */
export const DEVICE_SPEC_KEY = 'device'

/**
 * How far past a piece's edge a device still counts as in it, in PDF points.
 *
 * A count is placed by eye on the symbol, and a symbol drawn on a seam lands a
 * hair either side of it. A quarter point is about 1/300 inch on paper: far
 * below anything a person can place deliberately, and far above float noise.
 */
export const DEVICE_EDGE_TOLERANCE_POINTS = 0.25

/** A count scope whose counts are devices mounted through the ceiling. */
export function isDeviceScope(scope: Pick<Scope, 'scopeType' | 'specifications'>): boolean {
  return scope.scopeType === 'count' && readBool(scope.specifications, DEVICE_SPEC_KEY)
}

/** One placed device, in PDF points on its page. */
export interface DeviceLocation {
  markupId: string
  scopeId: string
  pageId: string
  point: Point
}

/**
 * Every device placed, in PDF points.
 *
 * `pageSize` gives a page's box; a page it does not know is skipped rather
 * than guessed at, because a device placed at the wrong scale lands in the
 * wrong piece and says so with complete confidence. Archived scopes are left
 * out: they count nothing anywhere else either.
 */
export function deviceLocations(
  markups: readonly Markup[],
  scopes: readonly Scope[],
  pageSize: (pageId: string) => PageSize | null | undefined,
): DeviceLocation[] {
  const deviceScopes = new Set(
    scopes.filter((s) => (s.archivedAt ?? null) === null && isDeviceScope(s)).map((s) => s.id),
  )
  if (deviceScopes.size === 0) return []
  const out: DeviceLocation[] = []
  for (const m of markups) {
    if (m.kind !== 'count' || m.scopeId === null || !deviceScopes.has(m.scopeId)) continue
    const at = m.rings[0]?.[0]
    if (at === undefined) continue
    const page = pageSize(m.pageId)
    if (page === null || page === undefined || !(page.width > 0) || !(page.height > 0)) continue
    out.push({ markupId: m.id, scopeId: m.scopeId, pageId: m.pageId, point: toPagePoints(at, page) })
  }
  return out
}

/** The pieces of one layout that have a device in them. */
export interface FactoryCut {
  /** Panel cells, by identity with `PieceResult.cells`. */
  cells: Set<PanelCell>
  /** Run pieces (planks, baffles, cassettes), by identity with `PieceResult.runs[].layout.pieces`. */
  pieces: Set<Piece>
  /**
   * Devices that fell inside this layout's area but in no piece, which on a
   * run product means between two pieces, in the reveal. Reported so a total
   * that looks low can be explained.
   */
  missed: DeviceLocation[]
  /**
   * Why pieces could not be tested at all, in the estimator's words. A run
   * product with no face width has no band for a device to land in.
   */
  blockers: string[]
}

/** Is `p` inside, or within the tolerance of, a cell's installed piece? */
function inCell(p: Point, cell: PanelCell): boolean {
  return pointInOrOnRegion(p, cell.clippedRegion, DEVICE_EDGE_TOLERANCE_POINTS)
}

/**
 * Which pieces of `result` each device lands in.
 *
 * Panels: the device is in the part of the cell that is installed (the cell
 * clipped to the ceiling), so a device just outside the ceiling marks nothing.
 *
 * Runs: the device is within half the face width of the piece's installed
 * segment. A run product without a face width cannot be tested and says so in
 * `blockers` rather than marking nothing silently.
 */
export function factoryCutPieces(result: PieceResult, devices: readonly DeviceLocation[]): FactoryCut {
  const out: FactoryCut = { cells: new Set(), pieces: new Set(), missed: [], blockers: [] }
  if (devices.length === 0) return out

  if (result.cells.length > 0) {
    // Cells tile the ceiling, so a device in no cell is outside this ceiling:
    // not a miss, just not ours.
    for (const d of devices) {
      for (const cell of result.cells) {
        if (cell.pageId !== undefined && cell.pageId !== d.pageId) continue
        if (inCell(d.point, cell)) out.cells.add(cell)
      }
    }
    return out
  }

  if (result.runs.length === 0) return out
  const widthFeet = result.componentWidthFeet
  if (widthFeet === undefined || !(widthFeet > 0)) {
    const anyOnPage = devices.some((d) => result.runs.some((r) => r.pageId === d.pageId))
    if (anyOnPage) out.blockers.push('Add the face width to find which pieces the devices land in')
    return out
  }

  for (const d of devices) {
    let inArea = false
    let hit = false
    for (const entry of result.runs) {
      if (entry.pageId !== d.pageId || !(entry.feetPerPoint > 0)) continue
      if (!pointInOrOnRegion(d.point, entry.region, DEVICE_EDGE_TOLERANCE_POINTS)) continue
      inArea = true
      const halfWidth = widthFeet / entry.feetPerPoint / 2 + DEVICE_EDGE_TOLERANCE_POINTS
      for (const piece of entry.layout.pieces) {
        if (distanceToSegment(d.point, piece.insideSegment.a, piece.insideSegment.b) <= halfWidth) {
          out.pieces.add(piece)
          hit = true
        }
      }
    }
    if (inArea && !hit) out.missed.push(d)
  }
  return out
}

/** How many pieces are factory-cut. */
export function factoryCutCount(cut: FactoryCut): number {
  return cut.cells.size + cut.pieces.size
}
