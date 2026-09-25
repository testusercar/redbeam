/**
 * The dock — TWO floating surfaces in one row over the drawing (boards 1–3b,
 * approved by Aaron 2026-09-18, reassessed against Fluent's CommandBar):
 *
 * 1. the WORK surface: how you read the sheet (pan, select, a one-off
 *    dimension), the scope markups land in, and in takeoff the tools that
 *    make them, with Direction behind a divider and Done at the end;
 * 2. the SHEET surface: where you are — sheet, zoom, and the sheet's scale.
 *
 * Nothing that is not a tool. Layout preview, Specifications and Quantities
 * left on 2026-09-13 (Aaron's QA note): they are commands and sidebar pages,
 * and the prompt and the scope page have them. Each surface's "…" holds only
 * what a narrower drawing shed — never a panel opener.
 *
 * Separate pills because they answer different questions and get reached for
 * at different moments — you move the sheet between every action, pick a tool
 * once and then draw twenty markups, and change sheets between every one of
 * them. Pan stood at the head of the tool row for a while, which said it was
 * a sixth way to make geometry; it is not, it is the resting state, and it is
 * needed whether or not takeoff has been entered. One ROW rather than two
 * because a second floating strip is a second footer, and stacking navigation
 * is what this replaces.
 *
 * Collapse is CSS, not JavaScript: `shell.css` keys tiers off a container
 * query on the viewport, so closing a side panel un-collapses the dock without
 * any resize listener. The only thing this component does about width is put
 * the collapsible items behind `data-collapse` and always render the overflow
 * menu, which the same query reveals.
 */
import { useEffect, useRef, useState } from 'react'
import type { ScaleRegion, Scope } from '@redbeam/domain'
import {
  SCALE_PRESETS, feetPerPointForPreset, matchPreset, presetGroups, scaleLabel,
  type ScalePreset,
} from '@redbeam/domain'
import type { Tool } from '../draw.js'
import { PRODUCT_TYPE_LABEL, readProductType } from '@redbeam/domain'
import {
  Area, Check, ChevronDown, ChevronRight, Compass, Count, Crop, Crosshair, Cursor, Cutout,
  Ellipsis, Glyph, Hand, Highlighter, Maximize, Minus, Plus, Polyline, Round, Ruler,
  StretchHorizontal,
} from './icons.js'
import type { Icon } from './icons.js'
import { useClampedPopover } from './popover.js'
import { CalibrationEntry, type CalibrationEntryProps } from './CalibrationEntry.js'
import { RegionList } from '../scale/RegionList.js'
import { ScalePicker } from '../scale/ScalePicker.js'

/**
 * The MARKUP tools — the ones that put geometry on the page for a scope.
 *
 * Calibrate and Direction are not here. They are setup: one sets the sheet's
 * scale, the other a scope's orientation, and neither leaves a markup behind.
 * Mixing them in implied that calibrating draws something.
 */
const TOOLS: Array<{ id: Tool; label: string; icon: Icon }> = [
  { id: 'area', label: 'Area', icon: Area },
  // Beside Area: a cutout is the other half of an area takeoff, and it sat
  // three buttons away from it.
  { id: 'cutout', label: 'Cutout', icon: Cutout },
  { id: 'polyline', label: 'Linear', icon: Polyline },
  { id: 'count', label: 'Count', icon: Count },
  { id: 'shape', label: 'Highlight', icon: Highlighter },
]

/**
 * The tools that READ the sheet rather than take it off.
 *
 * Pan moves it. Dimension measures one length and leaves a dimension line on
 * the sheet — a fact read off the drawing, not takeoff that reaches a
 * quantity, which is why it is not in the scope's tool row: a dimension
 * belongs to no scope and needs no round to exist. Both are wanted whether or
 * not takeoff has been entered, so their pill is always on screen.
 *
 * `'dimension'` is typed loosely here on purpose: the workspace is gaining the
 * tool in its own `Tool` union, and this row must not have to wait for it.
 */
export type ReadTool = 'pan' | 'select' | 'dimension'
const READ_TOOLS: Array<{ id: ReadTool; label: string; title: string; icon: Icon }> = [
  { id: 'pan', label: 'Pan', title: 'Move the sheet (H)', icon: Hand },
  // Marquee selection existed as Shift+drag in Pan and nobody found it.
  // Kenneth, 2026-09-10: "I need a select tool for marquee selections".
  { id: 'select', label: 'Select', title: 'Select markups: click one, or drag a box around several (V)', icon: Cursor },
  { id: 'dimension', label: 'Dimension', title: 'Measure one length off the sheet', icon: Ruler },
]

/**
 * The four scales the page-scale popover offers up front.
 *
 * From the workbench comp. A commercial interiors set is drawn at one of these
 * far more often than not; the full twenty-six stay behind a disclosure so the
 * common case is a glance rather than a scroll.
 */
const COMMON_SCALES = ['arch-1-8', 'arch-1-4', 'metric-50', 'metric-100'] as const

/**
 * Setup tools — things that configure a scope rather than measure it.
 *
 * CALIBRATE IS NOT HERE. Setting a sheet's scale had two entry points that did
 * the same thing: a tool in this row and "Calibrate from the drawing" in the
 * page-scale popover. Two controls for one job, one of them next to the drawing
 * tools where it reads as a way to draw. The scale popover owns it now — it is
 * where the scale is, where the scale is read, and where every other way of
 * setting one already lives.
 */
const SETUP: Array<{ id: Tool; label: string; title: string; icon: Icon }> = [
  {
    id: 'direction',
    label: 'Direction',
    title: 'Set the orientation the material runs, for the active scope',
    icon: Compass,
  },
]

// --------------------------------------------------------------- menus --

/** Close on Escape or a click outside. Both, because either alone is a trap. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onDown = (e: PointerEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [open, close])
  return ref
}

// ------------------------------------------------------------ tool pill --

/** A bidding round, as the takeoff pill needs to name and switch it. */
export interface DockEstimate { id: string; name: string }

export interface ToolPillProps {
  tool: Tool
  onTool: (t: Tool) => void
  scopes: Scope[]
  activeScope: string | null
  onScope: (id: string) => void
  /**
   * Whether the drawing tools are showing.
   *
   * The surface rests as the read tools, a scope pill and a Take off button;
   * the tool row only exists once takeoff has been entered. This is the Qt
   * build's behaviour (`RedbeamScopeDock::updateTakeoffPresentation`) and it
   * is the difference between five controls over the drawing and twelve.
   */
  takeoff: boolean
  onTakeoff: (on: boolean) => void
  /**
   * The rounds, the open one, and the way to switch.
   *
   * The round is the highest-stakes context in the app — drawing into the
   * wrong one is silent and expensive — so it is named and switchable where
   * the drawing happens, not only in the sidebar. Absent when there are no
   * rounds to switch between.
   */
  estimates?: DockEstimate[]
  openEstimateId?: string | null
  onEstimate?: (id: string) => void
  /** Ask the sidebar to add a scope to the open round. */
  onAddScope?: () => void
  /** Markups per scope, for the row's count. Absent in a harness with none. */
  markupCountFor?: (scopeId: string) => number
  /** Open the estimates panel, for a project with no round yet. */
  onOpenEstimates?: () => void
  /**
   * Whether a drawing is open.
   *
   * With none, the read tools, Take off and the overflow are not mounted.
   * They have nothing to act on, and a row of disabled controls reads as a
   * broken bar. The scope pill stays: choosing where markups will land does
   * not need a sheet. The sheet surface makes the same call from its page
   * count.
   */
  documentOpen?: boolean
}

/**
 * Where markups land: the round, then a scope of it.
 *
 * The closed pill and Take off use the same words. With nothing chosen it
 * says "No round open", "Add a scope…", or "Choose a scope…", and Take off
 * asks for that same step. The pill stays mounted with no drawing, because
 * this choice does not need a sheet.
 */
function ScopeControl({
  scopes, activeScope, onScope,
  estimates = [], openEstimateId = null, onEstimate, onAddScope, markupCountFor, onOpenEstimates,
}: ToolPillProps) {
  const [scopeOpen, setScopeOpen] = useState(false)
  /*
   * The round list is folded inside the popover. Switching a round used to
   * be a row among the scopes and CLOSED the menu, so reaching a scope in
   * another round took two openings and read as if the menu had misfired.
   * Now the round is a header that unfolds its alternatives in place; picking
   * one swaps the scope list beneath it and the menu stays open.
   */
  const [roundsOpen, setRoundsOpen] = useState(false)
  const scopeRef = useDismiss(scopeOpen, () => setScopeOpen(false))
  const scopeClamp = useClampedPopover<HTMLDivElement>(scopeOpen)
  const active = scopes.find((s) => s.id === activeScope) ?? null
  const round = estimates.find((e) => e.id === openEstimateId) ?? null
  const switchable = onEstimate !== undefined && estimates.length > 0
  const pillText = active?.label
    ?? (round === null ? 'No round open' : scopes.length === 0 ? 'Add a scope…' : 'Choose a scope…')
  const wantsAdd = active === null && round !== null && scopes.length === 0
  const pillTitle = active !== null
    ? `${round === null ? '' : `${round.name} › `}${active.label}`
    : round === null
      ? 'Open the estimates panel'
      : scopes.length === 0
        ? 'Add a scope'
        : `${round.name} — choose a scope`

  return (
    <div ref={scopeRef} className="dockscopewrap" style={{ position: 'relative' }}>
      <button
        className={active === null ? 'dockscope muted' : 'dockscope'}
        aria-haspopup="listbox"
        aria-expanded={scopeOpen}
        title={pillTitle}
        onClick={() => setScopeOpen((v) => !v)}
      >
        {wantsAdd
          ? <Glyph icon={Plus} role="small" />
          : (
            <span
              className="scopedot"
              style={active === null ? undefined : { background: active.color }}
              aria-hidden="true"
            />
          )}
        {/*
          One line. It carried a second line reading "Active" under the scope
          name — inside a 32px control, on the only scope the pill can show.
          The dot already says which scope; nothing needed to say that the
          selected one was selected.
        */}
        <span className="dockscopename">{pillText}</span>
        <Glyph icon={ChevronDown} role="small" style={{ transform: 'rotate(180deg)' }} />
      </button>
      {scopeOpen && (
        <div
          className="dockmenu left scopemenu"
          role="listbox"
          aria-label="Round and scope"
          ref={scopeClamp.ref}
          style={scopeClamp.style}
        >
          {/*
            THE ROUND, then ITS SCOPES. Markups land in a scope OF a round, so
            the popover answers both questions in that order: which bid am I
            in, and which product am I drawing. The round is a header that
            can be unfolded to switch; the scopes are the list; adding a
            scope is the foot. Nothing here closes the menu except choosing
            a scope, which is the one thing the menu is for.
          */}
          <div className="scopemenuest">
            <span className="menuhead">Round</span>
            <button
              className="scopemenuswitch"
              aria-expanded={switchable ? roundsOpen : undefined}
              disabled={!switchable}
              title={switchable ? 'Switch round' : undefined}
              onClick={() => { if (switchable) setRoundsOpen((v) => !v) }}
            >
              <Glyph icon={Round} role="row" />
              <span className="scopemenuname">{round?.name ?? 'No round open'}</span>
              {switchable && estimates.length > 1 && <Glyph icon={ChevronDown} role="small" />}
            </button>
          </div>
          {switchable && roundsOpen && estimates.map((e) => (
            <button
              key={e.id}
              className="menuitem scopemenuround"
              role="option"
              aria-selected={e.id === openEstimateId}
              onClick={() => { onEstimate?.(e.id); setRoundsOpen(false) }}
            >
              <span className="grow">{e.name}</span>
              {e.id === openEstimateId && <span className="dockcheck"><Glyph icon={Check} role="small" filled /></span>}
            </button>
          ))}
          <div className="menusep" />
          <div className="menuhead">Scopes</div>
          {scopes.length === 0 && (
            <div className="menunote">
              <span>
                {round === null
                  ? 'No round is open. Start one in Estimates; scopes live inside it.'
                  : 'No scopes in this round yet. Add one and it becomes the target for what you draw.'}
              </span>
            </div>
          )}
          {scopes.map((sc) => {
            const n = markupCountFor?.(sc.id)
            return (
              <button
                key={sc.id}
                className="menuitem scopemenurow"
                role="option"
                aria-selected={sc.id === activeScope}
                title={`${sc.label} — ${PRODUCT_TYPE_LABEL[readProductType(sc.specifications)]}${n === undefined ? '' : ` · ${n} markup${n === 1 ? '' : 's'}`}`}
                onClick={() => { onScope(sc.id); setScopeOpen(false) }}
              >
                <span className="scopedot" style={{ background: sc.color }} aria-hidden="true" />
                <span className="scopemenutext">
                  <span className="scopemenulabel">{sc.label}</span>
                  <span className="scopemenusub">
                    {PRODUCT_TYPE_LABEL[readProductType(sc.specifications)]}
                    {n !== undefined && ` · ${n} markup${n === 1 ? '' : 's'}`}
                  </span>
                </span>
                {sc.id === activeScope && <span className="dockcheck"><Glyph icon={Check} role="small" filled /></span>}
              </button>
            )
          })}
          {round === null && onOpenEstimates !== undefined && (
            <>
              <div className="menusep" />
              <button className="menuitem" onClick={() => { onOpenEstimates(); setScopeOpen(false) }}>
                <Glyph icon={Round} role="inline" /><span className="grow">Open the estimates panel</span>
              </button>
            </>
          )}
          {onAddScope !== undefined && round !== null && (
            <>
              <div className="menusep" />
              <button className="menuitem" onClick={() => { onAddScope(); setScopeOpen(false) }}>
                <Glyph icon={Plus} role="inline" /><span className="grow">Add a scope…</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * No drawing. The scope pill is the one control that still has a job.
 * Read tools, Take off, Done and the overflow are not mounted: no listeners,
 * no popovers, no disabled buttons pretending to be a toolbar.
 */
function IdleWorkSurface(props: ToolPillProps) {
  return (
    <div className="dockgroup dockwork" role="group" aria-label="Scope">
      <ScopeControl {...props} />
    </div>
  )
}

/**
 * The WORK surface: how you read the sheet, what you are doing, and the
 * tools that do it — one acrylic surface with separators, not three.
 *
 * Reassessed against Fluent's CommandBar (boards 1–3b, approved by Aaron
 * 2026-09-18). What changed and why:
 *
 *  - Pan · Select · Dimension are the first segment. They were a surface of
 *    their own; a CommandBar's groups are separators.
 *  - Labels. Fluent shows icon + label when there is room and drops the label
 *    before the command; the five takeoff tools carry a `.docklabel` that the
 *    stylesheet shows only at the Spacious tier.
 *  - The tool in hand is a FILL (ControlFillColorSecondary) with the Filled
 *    glyph in the accent — a checked AppBarToggleButton — not the 16×3
 *    NavigationView pill it wore, which marks a selected page, not a tool.
 *  - Take off and Done are one slot with two states. Leaving takeoff was an
 *    × at the far end of the tool row, beside Direction, which read as
 *    "undo the last one".
 *  - An overflow. Every tier that sheds a command puts it in this surface's
 *    "…" — Direction from the Compact tier, the two read tools not in hand
 *    from the Minimum tier. A command is never unreachable. (The menu the
 *    dock had before 2026-09-11 held panel openers, which are commands and
 *    sidebar pages; this one holds only what a narrower drawing pushed out.)
 *
 * Which tier applies is CSS — `shell.css` keys it off a container query on
 * the viewport — so this surface renders every control and every overflow
 * item, and `data-collapse` / `data-from` say which tier hides or reveals it.
 * ToolPill does not mount this surface when no drawing is open.
 */
export function ToolPill(props: ToolPillProps) {
  if (props.documentOpen === false) return <IdleWorkSurface {...props} />
  return <WorkSurface {...props} />
}

function WorkSurface(props: ToolPillProps) {
  const {
    tool, onTool, scopes, activeScope, takeoff, onTakeoff,
    estimates = [], openEstimateId = null,
  } = props
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useDismiss(moreOpen, () => setMoreOpen(false))
  const moreClamp = useClampedPopover<HTMLDivElement>(moreOpen)
  const active = scopes.find((s) => s.id === activeScope) ?? null
  const round = estimates.find((e) => e.id === openEstimateId) ?? null
  /*
   * A tool button: the glyph, Filled when in hand, and a label the Spacious
   * tier shows. `collapse` names the tier that hides it; the read tools and
   * the takeoff tools are never hidden — only the ones not in hand fold at
   * Minimum, which the stylesheet decides from `aria-pressed`.
   */
  const toolButton = (t: { id: Tool | ReadTool; label: string; icon: Icon; title?: string }, collapse?: string) => (
    <button
      key={t.id}
      className="dockbtn docktool"
      data-collapse={collapse}
      aria-pressed={tool === t.id}
      aria-label={t.label}
      title={t.title ?? t.label}
      onClick={() => onTool(t.id as Tool)}
    >
      <Glyph icon={t.icon} role="inline" filled={tool === t.id} />
      <span className="docklabel">{t.label}</span>
    </button>
  )

  /* Same verbs as the scope pill: the button is waiting on that step. */
  const takeoffTitle = round === null
    ? 'Start a round first'
    : active !== null
      ? `Start takeoff on ${active.label}`
      : scopes.length === 0
        ? 'Add a scope first'
        : 'Choose a scope first'

  return (
    /*
     * Order, left to right: how you move, WHAT this lands in, then what you
     * draw with, then setup, then out. The scope came after the tools once,
     * which put the answer to "where does this measurement go" at the far
     * end of the row from the tool about to make one.
     */
    <div className="dockgroup dockwork" role="toolbar" aria-label="Read the sheet and take off">
      {READ_TOOLS.map((t) => toolButton(t, 'read'))}
      <span className="dockrule" aria-hidden="true" />
      <ScopeControl {...props} />

      {/*
        ONE SLOT, TWO STATES. At rest it is the accent Take off — the one
        primary action on the sheet. In takeoff the same place holds an
        outlined Done, after the tools. Nothing else on the surface is filled.
      */}
      {!takeoff && (
        <button
          className="docktakeoff"
          disabled={active === null}
          title={takeoffTitle}
          onClick={() => onTakeoff(true)}
        >
          <Glyph icon={Crosshair} role="inline" />
          <span className="docktakeofflabel">Take off</span>
        </button>
      )}

      {takeoff && <span className="dockrule" aria-hidden="true" />}
      {/* Never shed: they are what the mode is for. */}
      {takeoff && TOOLS.map((t) => toolButton(t))}

      {takeoff && <span className="dockrule" data-collapse="setup" aria-hidden="true" />}
      {takeoff && SETUP.map((t) => toolButton(t, 'setup'))}

      {takeoff && (
        <button
          className="docktakeoff done"
          title="Leave takeoff"
          aria-label="Done — leave takeoff"
          onClick={() => { onTakeoff(false); onTool('pan') }}
        >
          <Glyph icon={Check} role="inline" />
          <span className="docktakeofflabel">Done</span>
        </button>
      )}

      {/*
        The overflow, shown only when a tier has put something in it: from
        Compact, the read tools not in hand and, in takeoff, Direction. Each
        item names the tier it appears from.
      */}
      <div
        ref={moreRef}
        className="dockmorewrap"
        data-from="compact"
        style={{ position: 'relative' }}
      >
        <button
          className="dockbtn dockicon dockmore"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="More"
          title="More"
          onClick={() => setMoreOpen((v) => !v)}
        ><Glyph icon={Ellipsis} role="inline" /></button>
        {moreOpen && (
          <div className="dockmenu right" role="menu" ref={moreClamp.ref} style={moreClamp.style}>
            {READ_TOOLS.map((t) => (
              <button
                key={t.id}
                className="menuitem"
                role="menuitemradio"
                aria-checked={tool === t.id}
                data-from="minimum"
                onClick={() => { onTool(t.id as Tool); setMoreOpen(false) }}
              >
                <Glyph icon={t.icon} role="inline" filled={tool === t.id} />
                <span className="grow">{t.label}</span>
              </button>
            ))}
            {takeoff && SETUP.map((t) => (
              <button
                key={t.id}
                className="menuitem"
                role="menuitemradio"
                aria-checked={tool === t.id}
                data-from="compact"
                title={t.title}
                onClick={() => { onTool(t.id); setMoreOpen(false) }}
              >
                <Glyph icon={t.icon} role="inline" filled={tool === t.id} />
                <span className="grow">{t.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// -------------------------------------------------------- document pill --

/**
 * The scales on this sheet, and the two half-finished gestures that end here.
 *
 * Everything about ONE sheet's scale reaches the drawing through the pill that
 * reads it, so the pill is where each of these lives:
 *   - the regions, listed under the page scale as its small print;
 *   - a region just drawn and not yet given a scale — the control stays open
 *     with the picker until it is;
 *   - a reference line just drawn and not yet given a length — likewise.
 * Each of the last two was a dialog over the drawing, scrimming the very box
 * or line it was asking about.
 */
export interface SheetScaleRegions {
  list: readonly ScaleRegion[]
  /** Regions that overlap another at a different scale, by id. */
  conflicting: ReadonlySet<string>
  onDelete: (id: string) => void
  /** The region tool is in hand: the list stays open beside the drawing. */
  toolActive: boolean
  /** Put the region tool down. */
  onDone: () => void
}

export interface PendingRegionEntry {
  onApply: (feetPerPoint: number, source: string, label: string) => void
  onCancel: () => void
}

export interface DocumentPillProps {
  page: number
  pageCount: number
  onPage: (index: number) => void
  /** Feet per PDF point, or null when this sheet is not calibrated. */
  feetPerPoint: number | null
  onPreset: (p: ScalePreset) => void
  onCalibrate: () => void
  /** Pick up the region tool, for the sheet that carries more than one scale. */
  onDrawRegion?: () => void
  /** Apply this sheet's scale to every sheet in the document. */
  onApplyToAll?: () => void
  /** Scale regions on this sheet. Absent means none and no way to make one. */
  regions?: SheetScaleRegions
  /**
   * How many regions the sheet carries, for a caller that has the count and
   * not the list. `regions` supersedes it; this is the readout alone.
   */
  regionCount?: number
  /**
   * A reference line drawn and waiting for its real length. While set, the
   * scale control is held open on the entry and nothing else can dismiss it.
   */
  calibration?: CalibrationEntryProps
  /** A region drawn and waiting for its scale. Same standing as `calibration`. */
  pendingRegion?: PendingRegionEntry
  zoom: number
  onZoom: (z: number) => void
  onFitPage: () => void
  onFitWidth: () => void
}

export function DocumentPill(props: DocumentPillProps) {
  /*
   * No sheet, and no half-finished gesture waiting on one. Page, zoom, scale
   * and their overflow have nothing to act on, so none of that state or those
   * listeners is mounted. A pinned calibration or region still needs the
   * control, even if the page count has not caught up.
   */
  const sheetMissing = props.pageCount === 0
    && props.calibration === undefined
    && props.pendingRegion === undefined
    && props.regions?.toolActive !== true
  if (sheetMissing) return null
  return <SheetSurface {...props} />
}

function SheetSurface({
  page, pageCount, onPage, feetPerPoint, onPreset, onCalibrate, onDrawRegion, onApplyToAll,
  regions, regionCount: countOnly = 0, calibration, pendingRegion, zoom, onZoom, onFitPage, onFitWidth,
}: DocumentPillProps) {
  const [scaleOpen, setScaleOpen] = useState(false)
  const [allScales, setAllScales] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  /*
   * PINNED: the control is open because a gesture is half-finished, and a
   * click elsewhere must not close it — closing would throw away the line or
   * the box just drawn. Cancel, Escape inside it, and Apply are the ways out.
   * With the region tool in hand it is pinned too, so the list of regions is
   * beside the box being drawn rather than under a menu nobody reopens.
   */
  const pinned = calibration !== undefined || pendingRegion !== undefined || regions?.toolActive === true
  const open = pinned || scaleOpen
  const scaleRef = useDismiss(scaleOpen && !pinned, () => setScaleOpen(false))
  const viewRef = useDismiss(viewOpen, () => setViewOpen(false))
  const moreRef = useDismiss(moreOpen, () => setMoreOpen(false))
  /*
   * The scale menu is anchored `right: 0` — right for a pill at the right of
   * the viewport, and two-thirds off screen once the dock wraps and this pill
   * lands at the left. Re-measured when the full list is disclosed, since the
   * menu grows and the shift that fitted the short one may not fit the long.
   */
  const scaleClamp = useClampedPopover<HTMLDivElement>(open, [allScales, pinned])
  const viewClamp = useClampedPopover<HTMLDivElement>(viewOpen)
  const moreClamp = useClampedPopover<HTMLDivElement>(moreOpen)

  const current = feetPerPoint === null ? null : matchPreset(feetPerPoint)
  const empty = pageCount === 0
  const regionCount = regions?.list.length ?? countOnly

  return (
    <div className="dockgroup docksheet" role="group" aria-label="Sheet, zoom and scale">
      {/*
        Which sheet, how big, at what scale — where you ARE, on one surface
        (board 1, 2026-09-18). The scale had a surface of its own for one
        control; it describes the sheet, so it sits with the sheet. Page nav
        is used between every markup; the zoom is a stepper around a value
        whose menu holds the presets and both fits; the fit-sheet button
        stands beside it because it is the one pressed most.
      */}
      <button
        className="dockbtn dockicon"
        data-collapse="pagestep"
        title="Previous sheet"
        aria-label="Previous sheet"
        disabled={empty || page <= 0}
        onClick={() => onPage(page - 1)}
      ><Glyph icon={ChevronDown} role="inline" style={{ transform: 'rotate(90deg)' }} /></button>
      <span className={empty ? 'dockvalue off' : 'dockvalue'}>{empty ? '— / —' : `${page + 1} / ${pageCount}`}</span>
      <button
        className="dockbtn dockicon"
        data-collapse="pagestep"
        title="Next sheet"
        aria-label="Next sheet"
        disabled={empty || page >= pageCount - 1}
        onClick={() => onPage(page + 1)}
      ><Glyph icon={ChevronRight} role="inline" /></button>

      <span className="dockrule" data-collapse="zoom" aria-hidden="true" />

      <button
        className="dockbtn dockicon"
        data-collapse="zoomstep"
        title="Zoom out (Ctrl+-)"
        aria-label="Zoom out"
        disabled={empty}
        onClick={() => onZoom(zoom / 1.25)}
      ><Glyph icon={Minus} role="inline" /></button>
      <div ref={viewRef} data-collapse="zoom" style={{ position: 'relative' }}>
        <button
          className="dockvalue dockzoom"
          aria-haspopup="menu"
          aria-expanded={viewOpen}
          title="Zoom and fit"
          disabled={empty}
          onClick={() => setViewOpen((v) => !v)}
        >
          {empty ? '—' : `${Math.round(zoom * 100)}%`}
          <Glyph icon={ChevronDown} role="small" style={{ transform: 'rotate(180deg)' }} />
        </button>
        {viewOpen && (
          <div className="dockmenu right" role="menu" ref={viewClamp.ref} style={viewClamp.style}>
            <button className="menuitem" role="menuitem" onClick={() => { onFitPage(); setViewOpen(false) }}>
              <Glyph icon={Maximize} role="inline" />
              <span className="grow">Fit sheet</span>
              <span className="hint">Ctrl+0</span>
            </button>
            <button className="menuitem" role="menuitem" onClick={() => { onFitWidth(); setViewOpen(false) }}>
              <Glyph icon={StretchHorizontal} role="inline" />
              <span className="grow">Fit width</span>
              <span className="hint">Ctrl+1</span>
            </button>
            {/* The steppers, once the Compact tier has taken them off the surface. */}
            <div className="menusep" data-from="compact" />
            <button className="menuitem" role="menuitem" data-from="compact" onClick={() => { onZoom(zoom * 1.25); setViewOpen(false) }}>
              <Glyph icon={Plus} role="inline" />
              <span className="grow">Zoom in</span>
              <span className="hint">Ctrl+=</span>
            </button>
            <button className="menuitem" role="menuitem" data-from="compact" onClick={() => { onZoom(zoom / 1.25); setViewOpen(false) }}>
              <Glyph icon={Minus} role="inline" />
              <span className="grow">Zoom out</span>
              <span className="hint">Ctrl+-</span>
            </button>
            <div className="menusep" />
            {[0.5, 1, 2, 4].map((z) => (
              <button
                key={z}
                className="menuitem"
                role="menuitemradio"
                aria-checked={Math.abs(zoom - z) < 0.005}
                onClick={() => { onZoom(z); setViewOpen(false) }}
              ><span className="grow">{z * 100}%</span></button>
            ))}
          </div>
        )}
      </div>
      <button
        className="dockbtn dockicon"
        data-collapse="zoomstep"
        title="Zoom in (Ctrl+=)"
        aria-label="Zoom in"
        disabled={empty}
        onClick={() => onZoom(zoom * 1.25)}
      ><Glyph icon={Plus} role="inline" /></button>
      <button
        className="dockbtn dockicon"
        data-collapse="fit"
        title="Fit sheet (Ctrl+0)"
        aria-label="Fit sheet"
        disabled={empty}
        onClick={onFitPage}
      ><Glyph icon={Maximize} role="inline" /></button>

      <span className="dockrule" data-collapse="scale" aria-hidden="true" />

      {/*
        Scale is a control, not a readout. The Qt build had 26 named presets
        and this had calibrate-from-drawing only, which meant measuring a line
        and typing a dimension on every sheet of a 110-sheet set to learn
        something the title block already says.

        The wrapper stays in the row at every tier — a pinned entry anchors
        to it — while the Minimum tier hides the button and the overflow's
        "Scale…" opens the same flyout.
      */}
      <div ref={scaleRef} className={pinned ? 'dockscalewrap pinned' : 'dockscalewrap'} style={{ position: 'relative' }}>
        <button
          className={`dockscale${feetPerPoint === null ? ' unset' : ''}`}
          data-collapse="scale"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={empty && !pinned}
          title={empty
            ? 'Open a drawing first'
            : regionCount > 0
              ? `Drawing scale — ${regionCount} region${regionCount === 1 ? '' : 's'} at other scales`
              : 'Drawing scale'}
          onClick={() => { if (!pinned) setScaleOpen((v) => !v) }}
        >
          <Glyph icon={Ruler} role="inline" />
          <span className="dockscalefull">
            {empty ? 'Scale' : feetPerPoint === null ? 'Unset' : scaleLabel(feetPerPoint)}
            {/* Counted, briefly: "+2" says the sheet holds scales this
                button is not showing; the tooltip says what. */}
            {regionCount > 0 && <span className="dockscaleregions">{' '}+{regionCount}</span>}
          </span>
          <span className="dockscaleshort">
            {empty ? 'Scale' : feetPerPoint === null ? 'Unset' : scaleLabel(feetPerPoint).split(' =')[0]}
          </span>
          <Glyph icon={ChevronDown} role="small" style={{ transform: 'rotate(180deg)' }} />
        </button>
        {open && (
          <div
            className={`dockmenu right scalemenu${pinned ? ' entry' : ''}`}
            role="dialog"
            aria-label="Page scale"
            ref={scaleClamp.ref}
            style={scaleClamp.style}
          >
            {calibration !== undefined && <CalibrationEntry {...calibration} />}

            {calibration === undefined && pendingRegion !== undefined && (
              <ScalePicker
                target="this region"
                current={null}
                withLabel
                onCancel={pendingRegion.onCancel}
                onApply={pendingRegion.onApply}
              />
            )}

            {calibration === undefined && pendingRegion === undefined && regions?.toolActive === true && (
              <RegionList
                pageScale={feetPerPoint}
                regions={regions.list}
                conflicting={regions.conflicting}
                onDelete={regions.onDelete}
                toolActive
                onClose={regions.onDone}
              />
            )}

            {!pinned && (
              <>
                <div className="scopemenuhead">
                  <span className="scopemenuname">Page scale</span>
                  <span className="menuhead">
                    {pageCount === 0 ? 'No document' : `Applies to page ${page + 1}`}
                  </span>
                </div>

                {/*
                  The ONLY way to calibrate. It used to be this and a tool in the
                  takeoff row — two controls doing one job, one of them sitting
                  among the drawing tools where it read as a way to draw.
                */}
                <button
                  className="menuitem raised"
                  onClick={() => { onCalibrate(); setScaleOpen(false) }}
                >
                  <Glyph icon={Ruler} role="row" />
                  <span className="grow">Calibrate from the drawing…</span>
                  <span className="hint">measure a known length</span>
                </button>
                {onDrawRegion !== undefined && (
                  <button
                    className="menuitem"
                    onClick={() => { onDrawRegion(); setScaleOpen(false) }}
                  >
                    <Glyph icon={Crop} role="row" />
                    <span className="grow">Draw a scale region…</span>
                    <span className="hint">a detail at another scale</span>
                  </button>
                )}

                {/*
                  Four scales, not twenty-six.
                  These are what a commercial interiors set is actually drawn at,
                  and a grid of four is a glance where a scrolling list of
                  twenty-six is a search. The rest stay one click further in.
                */}
                <div className="menuhead">Common scales</div>
                <div className="scalegrid">
                  {COMMON_SCALES.map((id) => {
                    const preset = SCALE_PRESETS.find((x) => x.id === id)
                    if (preset === undefined) return null
                    return (
                      <button
                        key={id}
                        className={`scalechip${preset.id === current?.id ? ' active' : ''}`}
                        onClick={() => { onPreset(preset); setScaleOpen(false) }}
                      >{preset.label}</button>
                    )
                  })}
                </div>

                <div className="menusep" />
                <button className="menuitem" onClick={() => setAllScales((v) => !v)}>
                  <span className="grow">{allScales ? 'Hide' : 'All'} {SCALE_PRESETS.length} scales</span>
                  <Glyph icon={ChevronDown} role="small" style={allScales ? { transform: 'rotate(180deg)' } : undefined} />
                </button>
                {allScales && presetGroups().map((g) => (
                  <div key={g.system}>
                    <div className="menuhead">{g.label}</div>
                    {g.presets.map((preset) => (
                      <button
                        key={preset.id}
                        className="menuitem"
                        aria-checked={preset.id === current?.id}
                        role="menuitemradio"
                        onClick={() => { onPreset(preset); setScaleOpen(false) }}
                      >
                        <span className="grow" style={{ fontFamily: 'var(--ads-mono)' }}>{preset.label}</span>
                        {preset.id === current?.id && <Glyph icon={Check} role="small" />}
                      </button>
                    ))}
                  </div>
                ))}

                {/* The regions, as the page scale's small print. */}
                {regions !== undefined && regions.list.length > 0 && (
                  <>
                    <div className="menusep" />
                    <RegionList
                      pageScale={feetPerPoint}
                      regions={regions.list}
                      conflicting={regions.conflicting}
                      onDelete={regions.onDelete}
                    />
                  </>
                )}

                {onApplyToAll !== undefined && feetPerPoint !== null && (
                  <>
                    <div className="menusep" />
                    <button className="menuitem" onClick={() => { onApplyToAll(); setScaleOpen(false) }}>
                      <Glyph icon={Check} role="inline" />
                      <span className="grow">Apply to every sheet</span>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* The overflow: page arrows and Fit from the Compact tier; zoom, fit width and the scale from Minimum. */}
      <div ref={moreRef} className="dockmorewrap" data-from="compact" style={{ position: 'relative' }}>
        <button
          className="dockbtn dockicon dockmore"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="More"
          title="More"
          onClick={() => setMoreOpen((v) => !v)}
        ><Glyph icon={Ellipsis} role="inline" /></button>
        {moreOpen && (
          <div className="dockmenu right" role="menu" ref={moreClamp.ref} style={moreClamp.style}>
            <button className="menuitem" role="menuitem" data-from="compact" disabled={empty || page <= 0} onClick={() => { onPage(page - 1); setMoreOpen(false) }}>
              <Glyph icon={ChevronDown} role="inline" style={{ transform: 'rotate(90deg)' }} />
              <span className="grow">Previous sheet</span>
              <span className="hint">PgUp</span>
            </button>
            <button className="menuitem" role="menuitem" data-from="compact" disabled={empty || page >= pageCount - 1} onClick={() => { onPage(page + 1); setMoreOpen(false) }}>
              <Glyph icon={ChevronRight} role="inline" />
              <span className="grow">Next sheet</span>
              <span className="hint">PgDn</span>
            </button>
            <button className="menuitem" role="menuitem" data-from="compact" disabled={empty} onClick={() => { onFitPage(); setMoreOpen(false) }}>
              <Glyph icon={Maximize} role="inline" /><span className="grow">Fit sheet</span><span className="hint">Ctrl+0</span>
            </button>
            <div className="menusep" data-from="minimum" />
            <button className="menuitem" role="menuitem" data-from="minimum" disabled={empty} onClick={() => { onZoom(zoom * 1.25); setMoreOpen(false) }}>
              <Glyph icon={Plus} role="inline" /><span className="grow">Zoom in</span><span className="hint">Ctrl+=</span>
            </button>
            <button className="menuitem" role="menuitem" data-from="minimum" disabled={empty} onClick={() => { onZoom(zoom / 1.25); setMoreOpen(false) }}>
              <Glyph icon={Minus} role="inline" /><span className="grow">Zoom out</span><span className="hint">Ctrl+-</span>
            </button>
            <button className="menuitem" role="menuitem" data-from="minimum" disabled={empty} onClick={() => { onFitWidth(); setMoreOpen(false) }}>
              <Glyph icon={StretchHorizontal} role="inline" /><span className="grow">Fit width</span><span className="hint">Ctrl+1</span>
            </button>
            <div className="menusep" data-from="minimum" />
            <button className="menuitem" role="menuitem" data-from="minimum" disabled={empty} onClick={() => { setMoreOpen(false); setScaleOpen(true) }}>
              <Glyph icon={Ruler} role="inline" />
              <span className="grow">Scale…</span>
              <span className="hint">{feetPerPoint === null ? 'Unset' : scaleLabel(feetPerPoint).split(' =')[0]}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- dock --

/**
 * The row: TWO floating surfaces (board 1, 2026-09-18) — the work surface
 * and the sheet surface — 8px apart. The row itself is transparent and lets
 * pointer events through to the drawing between them.
 *
 * `pinned` is a half-finished gesture on the sheet surface — a reference
 * line waiting for its length, a box waiting for its scale. While it holds,
 * the work surface dims and stops taking clicks: a tool picked mid-gesture
 * would draw into a sheet whose scale is about to change.
 */
export function Dock({ left, right, pinned = false }: {
  left: React.ReactNode
  right: React.ReactNode
  pinned?: boolean
}) {
  return (
    <div className="dock" data-pinned={pinned || undefined}>
      {left}
      {right}
    </div>
  )
}

/** Re-exported so callers do not need a second import for the preset type. */
export type { ScalePreset }
export { SCALE_PRESETS }
