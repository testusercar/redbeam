/**
 * The app's icon vocabulary: Fluent UI System Icons, regular weight.
 *
 * Windows 11 draws with this family (`@fluentui/react-icons`, MIT, from
 * microsoft/fluentui-system-icons), so a shell that is otherwise the system's
 * own material should not carry a second icon language. The Lucide set it
 * replaces was stroked at one weight on a 24 grid; Fluent ships each glyph
 * drawn for its size — 12, 16, 20, 24 — as a filled regular outline, and
 * looks like itself only when the asset matches the size it is drawn at.
 *
 * Two things live here rather than at the call sites:
 *
 *  - `SIZE` — the six legal icon sizes, on the spacing grid. Every icon in the
 *    app is one of these; `Glyph` picks the Fluent asset for the size.
 *  - The name table. Anything the shell draws is named here under the job it
 *    does, so swapping a glyph is a one-line change in one file. The names
 *    are the ones the components already import; what each resolves to is a
 *    Fluent family.
 */
import { createElement, type CSSProperties } from 'react'
import * as F from '@fluentui/react-icons'

/** Props every Fluent icon component accepts. */
interface FluentIconProps {
  fontSize?: number
  className?: string
  style?: CSSProperties
  primaryFill?: string
  'aria-hidden'?: boolean | 'true' | 'false'
  title?: string
}
type FluentIcon = React.ComponentType<FluentIconProps>

/**
 * One icon, drawn for each size Fluent ships it in. `Glyph` picks the asset
 * nearest at or above the requested size; a 12px chevron uses the 12 asset,
 * a 14px row icon the 16, an 18px rail icon the 20.
 */
export interface Icon {
  readonly name: string
  readonly at: Readonly<Partial<Record<12 | 16 | 20 | 24, FluentIcon>>>
}

const family = (name: string, ...sizes: Array<12 | 16 | 20 | 24>): Icon => {
  const at: Partial<Record<12 | 16 | 20 | 24, FluentIcon>> = {}
  for (const s of sizes) {
    const comp = (F as unknown as Record<string, FluentIcon | undefined>)[`${name}${s}Regular`]
    if (comp !== undefined) at[s] = comp
  }
  return { name, at }
}

/** The asset for a size: the smallest one at or above it, else the largest. */
export function assetFor(icon: Icon, size: number): FluentIcon {
  const keys = ([12, 16, 20, 24] as const).filter((k) => icon.at[k] !== undefined)
  const pick = keys.find((k) => k >= size) ?? keys[keys.length - 1]
  const comp = pick === undefined ? undefined : icon.at[pick]
  if (comp === undefined) throw new Error(`icons: ${icon.name} has no Fluent asset`)
  return comp
}

/* ------------------------------------------------------------- the table -- */

export const Archive = family('Archive', 16, 20, 24)
export const ArrowLeftRight = family('ArrowSwap', 16, 20, 24)
export const ArrowUndo = family('ArrowUndo', 16, 20, 24)
export const ArrowRedo = family('ArrowRedo', 16, 20, 24)
export const Bookmark = family('Bookmark', 12, 16, 20, 24)
export const BookOpen = family('BookOpen', 16, 20, 24)
export const Bug = family('Bug', 16, 20, 24)
export const Calculator = family('Calculator', 16, 20, 24)
export const Check = family('Checkmark', 12, 16, 20, 24)
export const ChevronDown = family('ChevronDown', 12, 16, 20, 24)
export const ChevronLeft = family('ChevronLeft', 12, 16, 20, 24)
export const ChevronRight = family('ChevronRight', 12, 16, 20, 24)
export const ChevronUp = family('ChevronUp', 12, 16, 20, 24)
export const Compass = family('CompassNorthwest', 16, 20, 24)
export const Copy = family('Copy', 16, 20, 24)
export const Crop = family('Crop', 16, 20, 24)
export const Crosshair = family('Target', 16, 20, 24)
export const DocumentPdf = family('DocumentPdf', 16, 20, 24)
export const Ellipsis = family('MoreHorizontal', 16, 20, 24)
export const ExternalLink = family('Open', 12, 16, 20, 24)
export const Eye = family('Eye', 12, 16, 20, 24)
export const EyeOff = family('EyeOff', 16, 20, 24)
export const FileText = family('Document', 16, 20, 24)
export const Files = family('DocumentMultiple', 16, 20, 24)
export const Folder = family('Folder', 16, 20, 24)
export const Grid2x2 = family('Grid', 16, 20, 24)
export const Hand = family('HandLeft', 16, 20, 24)
export const Highlighter = family('Highlight', 16, 20, 24)
export const Info = family('Info', 12, 16, 20, 24)
export const Layers = family('Layer', 20, 24)
export const LayoutGrid = family('GridDots', 16, 20, 24)
export const List = family('TextBulletListLtr', 16, 20, 24)
export const ListChecks = family('TaskListSquareLtr', 16, 20, 24)
export const ListTree = family('TextBulletListTree', 16, 20, 24)
export const Maximize = family('FullScreenMaximize', 16, 20, 24)
export const Maximize2 = family('ArrowMaximize', 16, 20, 24)
export const MessageSquare = family('Chat', 12, 16, 20, 24)
export const Minus = family('Subtract', 12, 16, 20, 24)
export const MoveHorizontal = family('ArrowAutofitWidth', 20, 24)
export const Palette = family('Color', 16, 20, 24)
export const PanelBottom = family('PanelBottom', 20)
export const PanelLeft = family('PanelLeft', 16, 20, 24)
export const PanelRight = family('PanelRight', 12, 16, 20, 24)
export const Pencil = family('Edit', 12, 16, 20, 24)
export const Pentagon = family('Pentagon', 20)
export const Plus = family('Add', 12, 16, 20, 24)
export const RotateCcw = family('ArrowReset', 20, 24)
export const Ruler = family('Ruler', 12, 16, 20, 24)
export const Scan = family('Scan', 16, 20, 24)
export const Scissors = family('Cut', 16, 20, 24)
export const Search = family('Search', 12, 16, 20, 24)
export const Settings2 = family('Settings', 16, 20, 24)
export const SlidersHorizontal = family('Options', 16, 20, 24)
export const Sparkles = family('Sparkle', 12, 16, 20, 24)
export const Spline = family('BezierCurveSquare', 12, 20)
export const Status = family('Status', 12, 16, 20, 24)
export const StickyNote = family('Note', 16, 20, 24)
export const StretchHorizontal = family('AutoFitWidth', 20, 24)
export const Tally = family('Counter', 20, 24)
export const Trash2 = family('Delete', 12, 16, 20, 24)
export const TriangleAlert = family('Warning', 12, 16, 20, 24)
export const Type = family('TextFont', 16, 20, 24)
export const WindowNew = family('WindowNew', 16, 20, 24)
export const X = family('Dismiss', 12, 16, 20, 24)
export const ZoomIn = family('ZoomIn', 16, 20, 24)
export const ZoomOut = family('ZoomOut', 16, 20, 24)

/* ---------------------------------------------------------------- roles -- */

/**
 * The icon roles: six sizes, all on the layout's own module. 12 for chevrons,
 * 14 for list rows, 16 for headers, buttons and the dock, 18 for the rail, 24
 * for empty states, 8 for a dot. An in-between size is a defect, not a nudge.
 */
export const SIZE = {
  /** Pill dots, 8px. */
  micro: { size: 8 },
  /** Chevrons, carets, close crosses, 12px. */
  small: { size: 12 },
  /** Dense list rows, 14px. */
  row: { size: 14 },
  /** Headers, buttons, inputs, the dock, 16px. */
  inline: { size: 16 },
  /** The rail, 18px — the one glyph big enough to hit without reading. */
  card: { size: 18 },
  /** Empty states, 24px. */
  empty: { size: 24 },
} as const

export type IconRole = keyof typeof SIZE

/**
 * Render an icon at one of the six legal roles.
 *
 * `<Glyph icon={Ruler} role="inline" />` picks Fluent's 16px Ruler and draws
 * it at 16. The size and the asset travel together and can only be a pair the
 * family ships.
 */
export function Glyph({
  icon, role = 'inline', ...rest
}: { icon: Icon; role?: IconRole } & Record<string, unknown>) {
  const { size } = SIZE[role]
  return createElement(assetFor(icon, size), { fontSize: size, 'aria-hidden': true, ...rest })
}
