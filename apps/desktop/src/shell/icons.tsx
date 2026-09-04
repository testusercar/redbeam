/**
 * The app's Lucide vocabulary.
 *
 * aaron-design-system standards/07: Lucide exclusively, via `lucide-react`,
 * and "never hand-draw an SVG path". This file used to transcribe twenty
 * Lucide paths by hand to avoid the dependency — which was a fork of the icon
 * pack in everything but name, and drifts the moment Lucide restyles a glyph.
 *
 * Two things live here rather than at the call sites:
 *
 *  - `SIZE` — the five legal icon sizes from 07, on the spacing grid, each
 *    with its mandated strokeWidth. Every icon in the app is one of these.
 *    07 says to set both explicitly and never rely on defaults, so `Glyph`
 *    does it from a role name instead of leaving numbers scattered around.
 *  - The re-export list. Anything the shell draws is named here, so swapping
 *    a glyph (07's instruction when Lucide lacks one: use the closest and say
 *    so) is a one-line change in one file.
 */
export {
  Archive, ArrowLeftRight, Bookmark, BookOpen, Calculator, Check, ChevronDown,
  ChevronRight, Compass, Copy, Crop, Crosshair, Ellipsis, ExternalLink, Eye, EyeOff,
  FileText,
  Files, Folder, Grid2x2, Hand, Highlighter, Info, Layers, LayoutGrid, List, ListChecks, ListTree,
  Maximize, Maximize2, MessageSquare, Minus, MoveHorizontal, Palette, PanelBottom, PanelLeft,
  PanelRight, Pencil, Pentagon, Plus, RotateCcw, Ruler, Scan, Scissors, Search,
  Settings2, SlidersHorizontal, Sparkles, Spline, StickyNote, StretchHorizontal,
  Tally1 as Tally, Trash2, TriangleAlert, Type, X, ZoomIn, ZoomOut,
} from 'lucide-react'

import type { LucideIcon } from 'lucide-react'
import { createElement } from 'react'

/**
 * The icon roles.
 *
 * ONE stroke weight across the whole product.
 *
 * These used to carry four different weights — 2.5 at 8px, 2 at 12 and 16,
 * 1.75 at 20 and 24 — on the theory that a smaller glyph needs a heavier line
 * to hold up. On a dark ground it does not: what actually happens is that a
 * 2.0 chevron beside a 1.75 section icon beside a 2.0 row icon reads as three
 * different icon sets, and that mismatch was the single largest source of the
 * "inconsistent" verdict on the design review. Lucide is drawn on a 24 grid at
 * 1.5 and looks like itself at 1.5.
 *
 * Four sizes, all on the layout's own module: 12 for chevrons, 14 for list
 * rows, 16 for headers, buttons and the dock, 18 for the rail. 24 is the empty
 * state only. An in-between size is a defect, not a nudge.
 */
const STROKE = 1.5

export const SIZE = {
  /** Pill dots, 8px. */
  micro: { size: 8, strokeWidth: STROKE },
  /** Chevrons, carets, close crosses, 12px. */
  small: { size: 12, strokeWidth: STROKE },
  /** Dense list rows, 14px. */
  row: { size: 14, strokeWidth: STROKE },
  /** Headers, buttons, inputs, the dock, 16px. */
  inline: { size: 16, strokeWidth: STROKE },
  /** The rail, 18px — the one glyph big enough to hit without reading. */
  card: { size: 18, strokeWidth: STROKE },
  /** Empty states, 24px. */
  empty: { size: 24, strokeWidth: STROKE },
} as const

export type IconRole = keyof typeof SIZE

/**
 * Render a Lucide icon at one of the five legal roles.
 *
 * `<Glyph icon={Ruler} role="inline" />` rather than
 * `<Ruler size={16} strokeWidth={2} />` — same output, but the size and
 * stroke travel together and can only be a pair the standard allows.
 */
export function Glyph({
  icon, role = 'inline', ...rest
}: { icon: LucideIcon; role?: IconRole } & Record<string, unknown>) {
  return createElement(icon, { ...SIZE[role], 'aria-hidden': true, ...rest })
}
