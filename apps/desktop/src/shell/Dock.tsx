/**
 * The dock — three pills in one floating row over the drawing.
 *
 * The left pill is how you READ the sheet: pan, and a one-off dimension. The
 * middle pill is what you are DOING: the round and scope markups land in, and
 * the tools that make them. The right pill is where you ARE: sheet, scale,
 * zoom.
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
  Check, ChevronDown, ChevronRight, Compass, Crop, Crosshair, Ellipsis,
  Glyph, Hand, Highlighter, Maximize, Minus, MoveHorizontal, Pentagon, Plus, Ruler, Scissors,
  SlidersHorizontal, StretchHorizontal, Tally, X, LayoutGrid, Calculator,
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
  { id: 'area', label: 'Area', icon: Pentagon },
  { id: 'polyline', label: 'Linear', icon: Ruler },
  { id: 'count', label: 'Count', icon: Tally },
  { id: 'cutout', label: 'Cutout', icon: Scissors },
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
export type ReadTool = 'pan' | 'dimension'
const READ_TOOLS: Array<{ id: ReadTool; label: string; title: string; icon: Icon }> = [
  { id: 'pan', label: 'Pan', title: 'Move the sheet (V)', icon: Hand },
  { id: 'dimension', label: 'Dimension', title: 'Measure one length off the sheet', icon: MoveHorizontal },
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

// ------------------------------------------------------------ read pill --

export interface ReadPillProps {
  /** The tool in hand — any tool; this pill only lights its own two. */
  tool: Tool | ReadTool
  onTool: (t: ReadTool) => void
}

/**
 * Pan and Dimension, in their own pill, always on screen.
 *
 * Aaron: "the PAN button should be its own floating button, separate from
 * the takeoff tools." Pan produces no markup and no quantity; grouping it
 * with Area and Count said it was one of them.
 */
export function ReadPill({ tool, onTool }: ReadPillProps) {
  return (
    <div className="dockgroup dockread" role="toolbar" aria-label="Read the sheet">
      {READ_TOOLS.map((t) => (
        <button
          key={t.id}
          className="dockbtn dockicon"
          aria-pressed={tool === t.id}
          aria-label={t.label}
          title={t.title}
          onClick={() => onTool(t.id)}
        >
          <Glyph icon={t.icon} role="inline" />
        </button>
      ))}
    </div>
  )
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
  onSpecifications: () => void
  onQuantities: () => void
  /**
   * The layout preview: show the pieces the engine laid out, over the drawing.
   *
   * It had no control at all — the state existed and only the automation
   * bridge could set it — so the one feature that lets a piece count be
   * checked by eye was unreachable from the application.
   */
  layoutOn: boolean
  onToggleLayout: (on: boolean) => void
  /**
   * Whether the drawing tools are showing.
   *
   * The dock rests as a scope pill and a Take off button; the tool rails only
   * exist once takeoff has been entered. This is the Qt build's behaviour
   * (`RedbeamScopeDock::updateTakeoffPresentation`) and it is the difference
   * between three controls over the drawing and twelve.
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
}

/**
 * The dock reports no problems.
 *
 * A tool mismatch and a paused layout both used to surface here — a warning
 * strip floating above the pill, and a blocker bar inside it. Both are gone,
 * and neither is gone silently: they moved to the estimates sidebar, beside the
 * scope and the number they are actually about.
 *
 * Two reasons. A warning that appears and disappears as the tool changes
 * reflows the pill and moves the tools out from under the cursor, so the fix
 * for "you cannot draw that here" was to make drawing harder. And a condition
 * belongs to the SCOPE, not to the moment — it is still true when you switch
 * sheets, put the tool down, or come back tomorrow, and the sidebar is where a
 * number that cannot be trusted gets read.
 */
export function ToolPill({
  tool, onTool, scopes, activeScope, onScope,
  onSpecifications, onQuantities, layoutOn, onToggleLayout, takeoff, onTakeoff,
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
  const [moreOpen, setMoreOpen] = useState(false)
  const scopeRef = useDismiss(scopeOpen, () => setScopeOpen(false))
  const moreRef = useDismiss(moreOpen, () => setMoreOpen(false))
  /*
   * Anchored to the pill, kept inside the viewport. The overflow menu hangs
   * off the LAST button in the row and opens to the right of it, which at any
   * width where the dock is near the viewport's edge is straight into the
   * clipping — see popover.ts.
   */
  const scopeClamp = useClampedPopover<HTMLDivElement>(scopeOpen)
  const moreClamp = useClampedPopover<HTMLDivElement>(moreOpen)
  const active = scopes.find((s) => s.id === activeScope) ?? null
  const round = estimates.find((e) => e.id === openEstimateId) ?? null
  const switchable = onEstimate !== undefined && estimates.length > 0

  /*
   * Icon only, with the name in the tooltip and in the overflow menu.
   *
   * The row carried a visible label on every button, and measured 1442px doing
   * it — wider than the drawing area at ANY window size this app supports, so
   * the labels were never actually on screen; they only pushed the two halves
   * of the dock into each other until one was clipped. An icon and a tooltip is
   * what every drawing application does with a tool row, and it is what the
   * comps drew.
   */
  const toolButton = (t: { id: Tool; label: string; icon: Icon; title?: string }, collapse?: string) => (
    <button
      key={t.id}
      className="dockbtn dockicon"
      data-collapse={collapse}
      aria-pressed={tool === t.id}
      aria-label={t.label}
      title={t.title ?? t.label}
      onClick={() => onTool(t.id)}
    >
      <Glyph icon={t.icon} role="inline" />
    </button>
  )

  return (
    /*
     * Order, left to right: WHAT this lands in, then what you draw with, then
     * setup, then out. The scope came after the tools once, which put the
     * answer to "where does this measurement go" at the far end of the row
     * from the tool about to make one.
     */
    <div className="dockgroup" role="toolbar" aria-label="Takeoff tools">
      <div ref={scopeRef} className="dockscopewrap" style={{ position: 'relative' }}>
        <button
          className="dockscope"
          aria-haspopup="listbox"
          aria-expanded={scopeOpen}
          title={active === null
            ? (round === null ? 'Choose the estimate and scope markups land in' : `${round.name} — choose a scope`)
            : `${round === null ? '' : `${round.name} › `}${active.label}`}
          onClick={() => setScopeOpen((v) => !v)}
        >
          <span
            className="scopedot"
            style={{ background: active?.color ?? 'transparent' }}
            aria-hidden="true"
          />
          {/*
            One line. It carried a second line reading "Active" under the scope
            name — inside a 32px control, on the only scope the pill can show.
            The dot already says which scope; nothing needed to say that the
            selected one was selected.
          */}
          <span className="dockscopename">{active?.label ?? (round === null ? 'No estimate' : 'No scope')}</span>
          <Glyph icon={ChevronDown} role="small" style={{ transform: 'rotate(180deg)' }} />
        </button>
        {scopeOpen && (
          <div
            className="dockmenu left scopemenu"
            role="listbox"
            aria-label="Estimate and scope"
            ref={scopeClamp.ref}
            style={scopeClamp.style}
          >
            {/*
              The round first, and switchable. A scope belongs to a bidding
              round, and switching scope without knowing which round you are
              in is how takeoff lands in the wrong estimate. Every round is a
              row, the open one checked; picking another is the same gesture
              as picking a scope.
            */}
            {/*
              THE ROUND, then ITS SCOPES. Markups land in a scope OF a round, so
              the popover answers both questions in that order: which bid am I
              in, and which product am I drawing. The round is a header that
              can be unfolded to switch; the scopes are the list; adding a
              scope is the foot. Nothing here closes the menu except choosing
              a scope, which is the one thing the menu is for.
            */}
            <div className="scopemenuest">
              <span className="menuhead">Estimate</span>
              <button
                className="scopemenuswitch"
                aria-expanded={switchable ? roundsOpen : undefined}
                disabled={!switchable}
                title={switchable ? 'Switch round' : undefined}
                onClick={() => { if (switchable) setRoundsOpen((v) => !v) }}
              >
                <Glyph icon={Calculator} role="row" />
                <span className="scopemenuname">{round?.name ?? 'No estimate open'}</span>
                {switchable && estimates.length > 1 && <Glyph icon={ChevronDown} role="small" />}
              </button>
            </div>
            {switchable && roundsOpen && estimates.map((e) => (
              <button
                key={e.id}
                className="menuitem scopemenuround"
                role="option"
                aria-selected={e.id === openEstimateId}
                onClick={() => { onEstimate(e.id); setRoundsOpen(false) }}
              >
                <span className="grow">{e.name}</span>
                {e.id === openEstimateId && <Glyph icon={Check} role="small" />}
              </button>
            ))}
            <div className="menusep" />
            <div className="menuhead">Scopes</div>
            {scopes.length === 0 && (
              <div className="menunote">
                <span>
                  {round === null
                    ? 'No estimate is open. Start one in the Estimates panel; scopes live inside it.'
                    : 'No scopes in this estimate yet. Add one and it becomes the target for what you draw.'}
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
                  {sc.id === activeScope && <Glyph icon={Check} role="small" />}
                </button>
              )
            })}
            {round === null && onOpenEstimates !== undefined && (
              <>
                <div className="menusep" />
                <button className="menuitem" onClick={() => { onOpenEstimates(); setScopeOpen(false) }}>
                  <Glyph icon={Calculator} role="inline" /><span className="grow">Open the estimates panel</span>
                </button>
              </>
            )}
            {onAddScope !== undefined && round !== null && (
              <>
                <div className="menusep" />
                <button className="menuitem" onClick={() => { onAddScope(); setScopeOpen(false) }}>
                  <Glyph icon={Plus} role="inline" /><span className="grow">Add scope…</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/*
        Not in takeoff: one action. The button IS the affordance — there is
        nothing else to reach for, which is the whole point of resting here.
      */}
      {!takeoff && (
        <button
          className="docktakeoff"
          disabled={active === null}
          title={active === null ? 'Choose a scope first' : `Start takeoff on ${active.label}`}
          onClick={() => onTakeoff(true)}
        >
          <Glyph icon={Crosshair} role="inline" />
          <span>Take off</span>
        </button>
      )}

      {takeoff && <span className="dockrule" data-collapse="tools" aria-hidden="true" />}
      {takeoff && TOOLS.map((t) => toolButton(t, 'tools'))}

      {takeoff && <span className="dockrule" data-collapse="setup" aria-hidden="true" />}
      {takeoff && SETUP.map((t) => toolButton(t, 'setup'))}

      {takeoff && (
        <button
          className="dockbtn dockicon"
          data-collapse="setup"
          aria-pressed={layoutOn}
          title={layoutOn ? 'Hide the layout preview' : 'Show the layout preview'}
          aria-label={layoutOn ? 'Hide the layout preview' : 'Show the layout preview'}
          onClick={() => onToggleLayout(!layoutOn)}
        ><Glyph icon={LayoutGrid} role="inline" /></button>
      )}

      {takeoff && <span className="dockrule" data-collapse="setup" aria-hidden="true" />}
      {takeoff && (
        <button
          className="dockbtn dockicon"
          data-collapse="setup"
          title="Scope specifications"
          aria-label="Scope specifications"
          onClick={onSpecifications}
        ><Glyph icon={SlidersHorizontal} role="inline" /></button>
      )}
      {takeoff && (
        <button
          className="dockbtn dockicon"
          data-collapse="setup"
          title="Quantities and bill of materials"
          aria-label="Quantities and bill of materials"
          onClick={onQuantities}
        ><Glyph icon={Calculator} role="inline" /></button>
      )}

      {takeoff && (
        <button
          className="dockbtn dockicon"
          data-collapse="setup"
          title="Leave takeoff"
          aria-label="Leave takeoff"
          onClick={() => { onTakeoff(false); onTool('pan') }}
        ><Glyph icon={X} role="inline" /></button>
      )}

      {/* Revealed by the same container query that hides the items above. */}
      {takeoff && <div ref={moreRef} style={{ position: 'relative' }}>
        <button
          className="dockbtn dockicon dockmore"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          title="More"
          aria-label="More tools"
          onClick={() => setMoreOpen((v) => !v)}
        ><Glyph icon={Ellipsis} role="inline" /></button>
        {moreOpen && (
          <div className="dockmenu left" role="menu" ref={moreClamp.ref} style={moreClamp.style}>
            {/*
              Everything the width took away, in the order it sits in the row.
              The menu only appears once something has collapsed, so listing the
              tools here unconditionally costs nothing at a width where they are
              on screen.
            */}
            <div className="menuhead">Tools</div>
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className="menuitem"
                role="menuitemradio"
                aria-checked={tool === t.id}
                onClick={() => { onTool(t.id); setMoreOpen(false) }}
              >
                <Glyph icon={t.icon} role="row" />
                <span className="grow">{t.label}</span>
                {tool === t.id && <Glyph icon={Check} role="small" />}
              </button>
            ))}
            <div className="menusep" />
            <div className="menuhead">Setup</div>
            <button
              className="menuitem"
              role="menuitemcheckbox"
              aria-checked={layoutOn}
              onClick={() => { onToggleLayout(!layoutOn); setMoreOpen(false) }}
            >
              <Glyph icon={LayoutGrid} role="row" />
              <span className="grow">Layout preview</span>
              {layoutOn && <Glyph icon={Check} role="small" />}
            </button>
            {SETUP.map((t) => (
              <button
                key={t.id}
                className="menuitem"
                role="menuitemradio"
                aria-checked={tool === t.id}
                onClick={() => { onTool(t.id); setMoreOpen(false) }}
              >
                <Glyph icon={t.icon} role="row" />
                <span className="grow">{t.label}</span>
                {tool === t.id && <Glyph icon={Check} role="small" />}
              </button>
            ))}
            <div className="menusep" />
            <button className="menuitem" role="menuitem" onClick={() => { onSpecifications(); setMoreOpen(false) }}>
              <Glyph icon={SlidersHorizontal} role="row" /><span className="grow">Specifications</span>
            </button>
            <button className="menuitem" role="menuitem" onClick={() => { onQuantities(); setMoreOpen(false) }}>
              <Glyph icon={Calculator} role="row" /><span className="grow">Quantities</span>
            </button>
            <div className="menusep" />
            {/* Exit collapses with the rest, so the way out has to be in here too. */}
            <button
              className="menuitem"
              role="menuitem"
              onClick={() => { setMoreOpen(false); onTakeoff(false); onTool('pan') }}
            >
              <Glyph icon={X} role="row" /><span className="grow">Leave takeoff</span>
            </button>
          </div>
        )}
      </div>}
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

export function DocumentPill({
  page, pageCount, onPage, feetPerPoint, onPreset, onCalibrate, onDrawRegion, onApplyToAll,
  regions, regionCount: countOnly = 0, calibration, pendingRegion, zoom, onZoom, onFitPage, onFitWidth,
}: DocumentPillProps) {
  const [scaleOpen, setScaleOpen] = useState(false)
  const [allScales, setAllScales] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
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
  /*
   * The scale menu is anchored `right: 0` — right for a pill at the right of
   * the viewport, and two-thirds off screen once the dock wraps and this pill
   * lands at the left. Re-measured when the full list is disclosed, since the
   * menu grows and the shift that fitted the short one may not fit the long.
   */
  const scaleClamp = useClampedPopover<HTMLDivElement>(open, [allScales, pinned])
  const viewClamp = useClampedPopover<HTMLDivElement>(viewOpen)

  const current = feetPerPoint === null ? null : matchPreset(feetPerPoint)
  const empty = pageCount === 0
  const regionCount = regions?.list.length ?? countOnly

  return (
    <div className="dockgroup" role="group" aria-label="Document">
      {/*
        DENSE. The pill carried eleven controls — page nav, the scale, minus,
        percentage, plus, fit, and five rules between them — for three
        questions: which sheet, what scale, how big. Page nav is used between
        every markup and stays; the scale is one chip; the zoom is one chip
        whose menu holds in, out, fit and the presets, because ctrl+wheel and
        pinch do the stepping and Ctrl+0 does the fit.
      */}
      <button
        className="dockbtn dockicon"
        title="Previous sheet"
        aria-label="Previous sheet"
        disabled={empty || page <= 0}
        onClick={() => onPage(page - 1)}
      ><Glyph icon={ChevronDown} role="inline" style={{ transform: 'rotate(90deg)' }} /></button>
      <span className="dockvalue">{empty ? '—' : `${page + 1}/${pageCount}`}</span>
      <button
        className="dockbtn dockicon"
        title="Next sheet"
        aria-label="Next sheet"
        disabled={empty || page >= pageCount - 1}
        onClick={() => onPage(page + 1)}
      ><Glyph icon={ChevronRight} role="inline" /></button>

      <span className="dockrule" aria-hidden="true" />

      {/*
        Scale is a control, not a readout. The Qt build had 26 named presets
        and this had calibrate-from-drawing only, which meant measuring a line
        and typing a dimension on every sheet of a 110-sheet set to learn
        something the title block already says.
      */}
      <div ref={scaleRef} className="dockscalewrap" style={{ position: 'relative' }} data-collapse="scale">
        <button
          className={`dockscale${feetPerPoint === null ? ' unset' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={regionCount > 0
            ? `Drawing scale — ${regionCount} region${regionCount === 1 ? '' : 's'} at other scales`
            : 'Drawing scale'}
          onClick={() => { if (!pinned) setScaleOpen((v) => !v) }}
        >
          <Glyph icon={Ruler} role="inline" />
          <span>
            {feetPerPoint === null ? 'Unset' : scaleLabel(feetPerPoint)}
            {/* Counted, briefly: "+2" says the sheet holds scales this
                button is not showing; the tooltip says what. */}
            {regionCount > 0 && <span className="dockscaleregions">{' '}+{regionCount}</span>}
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

      <span className="dockrule" data-collapse="scale" aria-hidden="true" />

      <div ref={viewRef} style={{ position: 'relative' }}>
        <button
          className="dockvalue dockzoom"
          aria-haspopup="menu"
          aria-expanded={viewOpen}
          title="Zoom and fit"
          onClick={() => setViewOpen((v) => !v)}
        >
          {Math.round(zoom * 100)}%
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
            <div className="menusep" />
            {/* The stepper, as rows: the buttons it replaced are the third
                way to do what the wheel and the pinch already do. */}
            <button className="menuitem" role="menuitem" onClick={() => onZoom(zoom * 1.25)}>
              <Glyph icon={Plus} role="inline" />
              <span className="grow">Zoom in</span>
              <span className="hint">Ctrl+=</span>
            </button>
            <button className="menuitem" role="menuitem" onClick={() => onZoom(zoom / 1.25)}>
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
    </div>
  )
}

// ---------------------------------------------------------------- dock --

/**
 * ONE bar. `read`, `left` and `right` are GROUPS inside it, told apart by
 * separators rather than by being separate floating surfaces — see the note on
 * `.dock` in shell.css for why three islands had to become one object.
 */
export function Dock({ read, left, right }: {
  read?: React.ReactNode
  left: React.ReactNode
  right: React.ReactNode
}) {
  return (
    <div className="dock">
      <div className="dockside">
        {read}
        {read !== undefined && <span className="dockrule" aria-hidden="true" />}
        {left}
      </div>
      <span className="dockrule" aria-hidden="true" />
      {right}
    </div>
  )
}

/** Re-exported so callers do not need a second import for the preset type. */
export type { ScalePreset }
export { SCALE_PRESETS }
