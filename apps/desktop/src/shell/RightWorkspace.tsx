/**
 * The right sidebar: Estimates, and only Estimates.
 *
 * Three levels, breadcrumbed:
 *
 *   Estimates  ›  50%CD  ›  CLG02
 *
 * An estimate is a bidding round that owns its scopes (REDBEAM_ESTIMATES_MODEL,
 * adopted 2026-08-02), so the round is the thing you navigate through to reach
 * a scope — not a peer tab beside it.
 *
 * BUILT TO THE BOARD Aaron approved on 2026-09-18
 * (docs/design/estimates-sidebar-2026-09-18/board.png). Every surface obeys
 * one grammar, and the grammar is the spec:
 *
 *   Header block   [colour] [name / subline] [accent action] [⋯]. The accent
 *                  slot is the surface's OUTPUT: New round, Export, Take off,
 *                  Save PDF. Secondary and destructive commands live in ⋯ and
 *                  nowhere else — no footer bars, no row-face buttons.
 *   Numbers        Three fixed slots, Area · Perimeter · Count, on the round
 *                  and the scope; a slot the product does not produce stays
 *                  unlit. Mono tabular figures; unit in 11px after the value;
 *                  a dash for none.
 *   State          One InfoBar per surface (info / warning / success), at most
 *                  one action. Row state is an 11px word under the row's
 *                  number, coloured only when it needs attention.
 *   Rows           Navigable items are 44px two-line rows with a chevron; data
 *                  rows are 23–24px; section heads 28px with the count in
 *                  ink-3 and one command or aside on the right.
 *   Fields         Compact 24px TextBox and ComboBox, label left, the unit
 *                  inside the field.
 *   Words          Sheet numbers, never filenames. Commit, never Lock. No word
 *                  twice on one screen.
 *
 * THERE IS NO BILL OF MATERIALS AT THE ROUND. Aaron, 2026-09-04: material never
 * shows on the estimate level. A scope's parts are read on the scope; the round
 * shows one number per scope and the round's own totals.
 *
 * THE SCOPE IS ONE PAGE. Parts, Setup and Markups are on screen together,
 * Parts first (Aaron, 2026-09-11: the number must not be two clicks from the
 * field that changes it). The pane is a loop, not a page: read the number,
 * check the parts, nudge an input, watch it move, audit the markups. All four
 * fit one screen at the panel's width, which is why the rows are as dense as
 * they are.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  PieceResult, ProductType, QuantityResult, Scope, ScopePieces, ScopeType, Specifications,
} from '@redbeam/domain'
import type { QuantityDelta } from '../commit.js'
import { formatMeasureValue, isLengthUnit, isVerifiedProduct, measureToFeet, parseLengthInput, formatLength, parseNumberOrFraction, scopeTypeForProduct } from '@redbeam/domain'
import {
  PRODUCT_TYPES, PRODUCT_TYPE_LABEL, buildBom, editableMeasures,
  missingRequiredMeasures, readProductType, readString, unitDisplayText, writeProductType,
  deriveRunTriple, granularityKey, readGranularity, readBool, GRANULARITIES,
} from '@redbeam/domain'
import {
  Area, ChevronRight, Count, Crosshair, Cutout, Ellipsis, FileText, Glyph, Highlighter,
  Plus, Polyline, Round, Ruler, Pentagon, TriangleAlert, Copy, Trash2, RotateCcw, Archive, Pencil,
  DocumentPdf, X,
} from './icons.js'
import { entriesForRound } from '../bom/bomRows.js'
import { saveOutcomeText, saveReportFile } from '../bom/exports.js'

/**
 * What a scope counts, in the order an estimator meets them: most ceiling
 * scopes are areas, trims and runs are linear, fixtures are counted.
 */
const SCOPE_TYPES: ReadonlyArray<{ id: ScopeType; label: string; help: string }> = [
  { id: 'area', label: 'areas', help: 'Square feet from the areas you draw, less cutouts. Panels, planks and baffles are laid out inside them.' },
  { id: 'linear', label: 'lengths', help: 'Linear feet from the polylines you draw — trims, troughs, runs of a product bought by length.' },
  { id: 'count', label: 'counts', help: 'Each from the points you place — fixtures, penetrations, anything tallied rather than measured.' },
]
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })

/**
 * A storage key is not a label, and neither is a generic one.
 *
 * The domain already names each line, and for run products that name is
 * PRODUCT-SPECIFIC: `primary_stock` is "Planks" on a plank scope and "Baffle
 * stock" on a baffle. The line's own label wins; the map is only a fallback
 * for a line that arrives without one.
 */
const PIECE_LABEL: Record<string, string> = {
  cassette_count: 'Cassettes',
  panel_count: 'Panels',
  panel_full: 'Full panels',
  panel_half: 'Half panels',
  primary_stock: 'Stock',
  net_linear: 'Installed length',
  perimeter_trim: 'Perimeter trim',
  connectors: 'Connectors',
  end_caps: 'End caps',
  joiners: 'Joiners',
  suspension_rails: 'Suspension rails',
  linear_parts: 'Parts',
  linear_measured: 'Measured length',
  linear_ordered: 'Ordered length',
  linear_offcut: 'Offcut',
}
const pieceLabel = (q: { itemKey: string; label?: string }) =>
  (q.label !== undefined && q.label.trim() !== '')
    ? q.label
    : PIECE_LABEL[q.itemKey]
      ?? q.itemKey.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** The three sections of a scope, as the dock and the palette name them. */
export type ScopePage = 'parts' | 'setup' | 'markups'

export interface EstimateListItem {
  id: string
  name: string
  scopeCount: number
  markupCount: number
  /** The round's scopes, so the list can total it. Absent where nobody asked. */
  scopeIds?: string[]
}

/**
 * A document carrying an estimate's markups. The panel no longer lists these
 * (a drawing is a document, and the Files rail says which carry takeoff);
 * the workspace still reads them to say so there.
 */
export interface EstimateFile {
  documentId: string
  relativePath: string
  markupCount: number
}

export interface ScopeMarkup {
  id: string
  kind: string
  /** "Area 1", "Cutout 2" — numbered per kind within the scope, stable across sheets. */
  name: string
  /** For a cutout: the area it sits in, by name. */
  parentName?: string
  page: number
  documentId: string
  /** The document's display name, for a row that is not on the open one. */
  documentName: string
  /** On the document that is open: its page can be reached with a page number alone. */
  inOpenDocument: boolean
  /** Pre-formatted measurement, e.g. `412.6 SF`. Signed for a cutout. */
  measure: string
  /**
   * Why this shape contributes nothing to the layout, if it does not.
   *
   * The scope-level blocker says what the SCOPE is missing. It cannot say that
   * four of your six areas sit on a sheet with no scale while the other two
   * carry the whole number — and that is the question actually being asked
   * when a count looks too low.
   */
  layoutNote?: string
}

/**
 * How a scope stands, for the levels above it: what it measures, and whether
 * that is committed. The round strip, the round's InfoBar, the row states and
 * the list's totals are all read off this, so every level says the same thing.
 */
export interface ScopeStanding {
  rows: readonly QuantityResult[]
  /** When the scope was last committed; null when never. */
  committedAt: string | null
  /** Quantities that moved since that commit. Zero when unchanged, or never committed. */
  changed: number
}

/** A warning is a sentence, or a sentence and the one action that fixes it. */
export type PanelWarning = string | { text: string; action?: { label: string; run: () => void } }

/**
 * What the round can export. The entries are every scope's pieces; the panel
 * narrows them to the open round, because the bill is what THIS bid orders.
 */
export interface RoundBill {
  entries: ScopePieces[]
  calibrated: boolean
  /** The drawings it was measured from, for the report's header. */
  documents: readonly string[]
  /** Markups on the open drawing. Zero means there is nothing to write. */
  markupCount?: number
  /** Write the OPEN drawing back out with its markups on it. Resolves to an error to show, or null. */
  onExportMarkedPdf?: () => Promise<string | null>
}

export interface EstimatesPanelProps {
  projectName: string
  estimates: EstimateListItem[]
  /**
   * Whether the list has been read at all. Before the database answers the
   * list is empty, and "No estimates yet" is a claim about the project that
   * nobody has checked. Absent means loaded — the harness has no database.
   */
  loaded?: boolean
  /** Null shows the list; set shows that estimate. */
  openEstimateId: string | null
  onOpenEstimate: (id: string | null) => void
  /** Null shows the estimate overview; set shows that scope. */
  openScopeId: string | null
  onOpenScope: (id: string | null) => void
  /**
   * Which section of the open scope to bring on screen. Controlled when the
   * caller has a reason to choose — the dock's Specifications button asks for
   * Setup, its Quantities button for Parts.
   */
  scopePage?: ScopePage
  onScopePage?: (page: ScopePage) => void

  /** Scopes belonging to the open estimate. */
  scopes: Scope[]
  /**
   * Whether the open estimate's scope ids have been read yet. "No scopes" and
   * "not asked yet" are both an empty list, and they mean opposite things.
   */
  scopesLoaded?: boolean
  markupCountFor: (scopeId: string) => number
  /** How any scope in the project stands. Null for a scope the caller does not know. */
  standingFor?: (scopeId: string) => ScopeStanding | null

  /** For the open scope. */
  rows: QuantityResult[]
  pieces?: PieceResult
  markups: ScopeMarkup[]
  sheetLabel: (page: number) => string
  /** The sheet's name beside its number — "Level 1 floor plan". Empty when the index has none. */
  sheetTitle?: (page: number) => string
  onGoToPage: (page: number) => void
  /** Go to a markup's sheet, opening its document first if it is another one. */
  onGoToMarkup?: (markup: ScopeMarkup) => void
  /** Denominator of the inch fraction lengths are written to. 16 by default. */
  lengthDenominator?: number

  onCreateEstimate: (name: string) => void
  /**
   * Make a scope with this name in the open estimate, and open it.
   *
   * There is no scope editor. A scope is named where its round lists it —
   * the same row-with-a-field the round itself was named in — and everything
   * past the name is set on the scope's own Setup section.
   */
  onCreateScope?: (label: string) => void
  /**
   * A request from OUTSIDE the panel to add a scope — the dock's scope menu,
   * the palette. A nonce rather than a flag: two identical requests in a row
   * are still two requests.
   */
  addScopeRequest?: number
  /** Copy a scope's specification, not its takeoff, into the same round. */
  onDuplicateScope?: (scopeId: string) => void
  /**
   * Scopes taken out of a round, project-wide, and the way back in. Listed
   * under the round's scopes, folded, restorable into it.
   */
  archived?: Scope[]
  onRestoreScope?: (scopeId: string) => void
  /** The round's bill, for its exports. Absent in a harness with nothing to bill. */
  bill?: RoundBill
  /**
   * Duplicate an estimate's scopes and specifications, not its takeoff. A
   * bidding round IS a copy: the same scopes priced differently.
   */
  onDuplicateEstimate: (sourceId: string, name: string) => void
  onRenameEstimate: (id: string, name: string) => void
  /**
   * Delete a round. A scope belongs to exactly one, so this takes every scope
   * in it — and the store refuses while any of them still carries takeoff.
   */
  onDeleteEstimate: (id: string) => void
  /** Take a scope out of its round. It is archived, not destroyed. */
  onRemoveScope: (estimateId: string, scopeId: string) => void
  onSaveScope: (scope: Scope) => void
  onTakeOff: (scopeId: string) => void
  /** Pick up the direction tool for the open scope. Absent where there is no sheet to set it on. */
  onSetDirection?: () => void
  /** How the open scope's direction stands, in words — "set on A-413A". Null means not set. */
  direction?: string | null
  /** The layout preview, so the section that reports a count can also show it. */
  layoutOn: boolean
  onToggleLayout: (on: boolean) => void
  /**
   * The committed answer for the open scope, and what has moved since.
   * Absent when this scope has never been committed.
   */
  commit?: { at: string | null, delta: QuantityDelta[] }
  onCommit: (scopeId: string) => void
  /**
   * Check and name a round before it leaves as a PDF, a CSV or a TSV. The
   * round's accent action. The sheet it opens is `exportSheet`.
   */
  onExportEstimate?: (estimateId: string) => void
  /** The export sheet, when one is open. Takes the panel's body over. */
  exportSheet?: ReactNode
  /** What the estimator should know about the sheet on screen, each with the one action that fixes it when there is one. */
  warnings: PanelWarning[]
  /**
   * Why the active scope cannot produce a layout yet, and the one action that
   * fixes it. A property of the SCOPE, not of the moment.
   */
  blocker?: { message: string; actionLabel: string; onResolve: () => void }
}

/**
 * A name for the copy that does not collide and does not need a dialog.
 * "100% CD" becomes "100% CD copy", then "100% CD copy 2".
 */
function nextRoundName(base: string, existing: ReadonlyArray<{ name: string }>): string {
  const taken = new Set(existing.map((e) => e.name))
  const first = `${base} copy`
  if (!taken.has(first)) return first
  for (let n = 2; n < 100; n++) {
    if (!taken.has(`${first} ${n}`)) return `${first} ${n}`
  }
  return `${first} ${Date.now()}`
}

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

/** "13 Sep", or null when the row never got a timestamp. */
function dayOf(at: string | null): string | null {
  if (at === null) return null
  const d = new Date(at)
  // "13 Sep": day first, as the board writes it, whatever the locale's order.
  return Number.isNaN(d.getTime()) ? null : `${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`
}

/**
 * The quantity tiles.
 *
 * A tile is a MEASUREMENT — what the markups add up to, in SF, LF or EA —
 * and a scope shows only the tiles its type measures (board 4, approved
 * 2026-09-18). They used to be three fixed slots, Area · Perimeter · Count,
 * with "—" in whatever this scope did not measure; a count scope wore two
 * dashes and a panel scope wore one, and the dash said nothing an estimator
 * could act on. Order stays SF · LF · EA so the eye lands in the same place.
 * `itemKey` names the row a tile came from, so a second LF tile (a run
 * product's installed length beside an area's perimeter) matches its own
 * commit delta rather than the first LF it finds.
 */
interface Slot { itemKey?: string; unit: 'SF' | 'LF' | 'EA'; label: string; total: number | null; scopes: number }
const SLOT_LABEL: Record<Slot['unit'], string> = { SF: 'Area', LF: 'Length', EA: 'Count' }
function slotsOf(rowSets: ReadonlyArray<readonly QuantityResult[]>): Slot[] {
  return (['SF', 'LF', 'EA'] as const).map((unit): Slot => {
    let total: number | null = null
    let scopes = 0
    let label = SLOT_LABEL[unit]
    let itemKey: string | undefined
    for (const rows of rowSets) {
      const r = rows.find((x) => x.unit === unit)
      if (r === undefined) continue
      total = (total ?? 0) + r.quantity
      scopes += 1
      label = r.label
      itemKey = r.itemKey
    }
    return { ...(itemKey !== undefined && rowSets.length === 1 ? { itemKey } : {}), unit, label, total, scopes }
  }).filter((slot) => slot.total !== null)
}

function QuantityStrip({ slots, delta, sub }: {
  slots: Slot[]
  /** For the open scope: what moved since the commit, by row. */
  delta?: ReadonlyArray<{ itemKey: string; unit: string; committed: number | null }>
  /** For the round: "2 scopes" under each slot. */
  sub?: boolean
}) {
  return (
    <div className="es-qs">
      {slots.map((s) => {
        const was = delta?.find((d) => (s.itemKey !== undefined ? d.itemKey === s.itemKey : d.unit === s.unit))
        return (
          <div key={s.itemKey ?? s.unit} className={s.total === null ? 'es-q' : 'es-q on'}>
            <div className={s.total === null ? 'es-qv unset' : 'es-qv'}>
              {s.total === null ? '—' : <>{fmt(s.total)}<small>{s.unit}</small></>}
            </div>
            <div className="es-ql">
              {s.label}
              {sub === true && s.total !== null && ` · ${s.scopes} scope${s.scopes === 1 ? '' : 's'}`}
              {was !== undefined && (
                <span className="es-was"> was <b>{was.committed === null ? '—' : fmt(was.committed)}</b></span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Fluent InfoBar: a severity glyph, one sentence, at most one action. */
function InfoBar({ tone, children, action, onDismiss }: {
  tone: 'info' | 'warn' | 'good'
  children: ReactNode
  action?: { label: string; run: () => void; disabled?: boolean } | null
  onDismiss?: () => void
}) {
  return (
    <div className={`es-ib ${tone}`} role="status">
      <span className="es-ibic" aria-hidden="true">{tone === 'warn' ? '!' : tone === 'good' ? '✓' : 'i'}</span>
      <span className="es-ibtext">{children}</span>
      {action !== undefined && action !== null && (
        <button className="es-btn tiny" disabled={action.disabled === true} onClick={action.run}>{action.label}</button>
      )}
      {onDismiss !== undefined && (
        <button className="es-btn subtle icon tiny" aria-label="Dismiss" onClick={onDismiss}><Glyph icon={X} role="small" /></button>
      )}
    </div>
  )
}

/**
 * The header block every surface opens with:
 * [colour] [name / subline] [accent action] [⋯]. `menu` is the flyout's
 * items; the button and its dismissal are handled here so no surface grows
 * its own.
 */
function HeaderBlock({ dot, name, sub, primary, menu, menuLabel }: {
  dot?: ReactNode
  name: ReactNode
  sub: ReactNode
  primary?: ReactNode
  menu?: ReactNode
  menuLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismiss(open, close)
  return (
    <div className={dot === undefined ? 'es-hd nodot' : 'es-hd'} ref={ref}>
      {dot}
      <div className="es-hdtext">
        <div className="es-hdname">{name}</div>
        <div className="es-hdsub">{sub}</div>
      </div>
      {primary}
      {menu !== undefined && (
        <>
          <button
            className={open ? 'es-btn subtle icon on' : 'es-btn subtle icon'}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={menuLabel ?? 'More'}
            title={menuLabel ?? 'More'}
            onClick={() => setOpen((v) => !v)}
          ><Glyph icon={Ellipsis} role="row" /></button>
          {open && (
            <div className="dockmenu es-menu" role="menu" aria-label={menuLabel ?? 'More'} onClick={close}>
              {menu}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** One item of a MenuFlyout. */
function MenuItem({ icon, label, hint, danger, disabled, title, onClick }: {
  icon: typeof Pencil
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      className={danger === true ? 'menuitem danger' : 'menuitem'}
      role="menuitem"
      disabled={disabled === true}
      {...(title !== undefined ? { title } : {})}
      onClick={onClick}
    >
      <Glyph icon={icon} role="row" /><span className="grow">{label}</span>
      {hint !== undefined && <span className="hint">{hint}</span>}
    </button>
  )
}

/** A section head: 28px, Body Strong, the count in ink-3, one thing on the right. */
function SectionHead({ id, title, count, right }: { id?: string; title: string; count?: ReactNode; right?: ReactNode }) {
  return (
    <h3 className="es-sect" {...(id !== undefined ? { id } : {})}>
      {title}
      {count !== undefined && <span className="es-n">{count}</span>}
      <span className="es-sp" />
      {right}
    </h3>
  )
}

/** The inline naming row: the one field a new round or scope needs. */
function NameRow({ placeholder, label, action, onCommit, onCancel }: {
  placeholder: string
  label: string
  action: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    const name = draft.trim()
    if (name !== '') onCommit(name)
    else onCancel()
  }
  return (
    <div className="es-namerow">
      <input
        autoFocus
        className="es-field"
        value={draft}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') onCancel()
        }}
      />
      <button className="es-btn primary" onClick={commit} disabled={draft.trim() === ''}>{action}</button>
      <button className="es-btn subtle" onClick={onCancel}>Cancel</button>
    </div>
  )
}

/** Rename in place: the name becomes a field, Enter commits, Escape restores. */
function RenameField({ value, label, onCommit, onCancel }: {
  value: string
  label: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)
  const commit = () => {
    const next = draft.trim()
    if (next !== '' && next !== value) onCommit(next)
    else onCancel()
  }
  return (
    <input
      autoFocus
      className="es-field es-rename"
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onCancel()
      }}
    />
  )
}

export function EstimatesPanel(p: EstimatesPanelProps) {
  const estimate = p.estimates.find((e) => e.id === p.openEstimateId) ?? null
  const scope = p.scopes.find((s) => s.id === p.openScopeId) ?? null
  const roundScopes = useMemo(() => new Set(p.scopes.map((s) => s.id)), [p.scopes])
  const billEntries = useMemo(
    () => (p.bill === undefined ? [] : entriesForRound(p.bill.entries, estimate === null ? null : roundScopes)),
    [p.bill, estimate, roundScopes],
  )

  return (
    <aside className="workspace es-panel">
      <div className="wshead-bar">
        <span className="wstitle"><Glyph icon={Round} role="inline" /> Estimates</span>
      </div>

      {estimate !== null && p.exportSheet === undefined && (
        <nav className="crumbs" aria-label="Breadcrumb">
          <button className="crumb" onClick={() => { p.onOpenScope(null); p.onOpenEstimate(null) }}>
            Estimates
          </button>
          <Glyph icon={ChevronRight} role="small" />
          {scope !== null && (
            <>
              <button className="crumb" onClick={() => p.onOpenScope(null)}>{estimate.name}</button>
              <Glyph icon={ChevronRight} role="small" />
              <span className="crumb current">{scope.label}</span>
            </>
          )}
          {scope === null && <span className="crumb current">{estimate.name}</span>}
        </nav>
      )}

      <div className="wsbody">
        {p.exportSheet === undefined && p.blocker !== undefined && (
          <InfoBar tone="warn" action={{ label: p.blocker.actionLabel, run: p.blocker.onResolve }}>{p.blocker.message}</InfoBar>
        )}
        {/* The first warning is shown; the rest are counted, and expand on ask. */}
        {p.exportSheet === undefined && p.warnings.length > 0 && <WarningStack warnings={p.warnings} />}

        {p.exportSheet !== undefined && p.exportSheet}
        {p.exportSheet === undefined && estimate === null && <EstimateList {...p} />}
        {p.exportSheet === undefined && estimate !== null && scope === null && (
          <EstimateOverview {...p} estimate={estimate} billEntries={billEntries} />
        )}
        {p.exportSheet === undefined && estimate !== null && scope !== null && (
          <ScopeDetail {...p} estimate={estimate} scope={scope} />
        )}
      </div>
    </aside>
  )
}

/** The first warning, plus a count of the rest. A warning with a fix carries it; the count rides on the last one shown. */
function WarningStack({ warnings }: { warnings: PanelWarning[] }) {
  const [open, setOpen] = useState(false)
  const rest = warnings.length - 1
  const shown = open ? warnings : warnings.slice(0, 1)
  return (
    <div className="es-ibstack">
      {shown.map((w, i) => {
        const text = typeof w === 'string' ? w : w.text
        const fix = typeof w === 'string' ? undefined : w.action
        const more = i === shown.length - 1 && rest > 0 ? { label: open ? 'Fewer' : `+${rest}`, run: () => setOpen((v) => !v) } : undefined
        return (
          <InfoBar key={i} tone="warn" action={fix ?? more ?? null}>
            {text}
            {fix !== undefined && more !== undefined && (
              <> · <button className="es-link" onClick={more.run}>{more.label}</button></>
            )}
          </InfoBar>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------- level 1: the list --

/** How much of a round is committed, said once. */
function roundStanding(scopeIds: readonly string[], standingFor: EstimatesPanelProps['standingFor']) {
  const standings = scopeIds.map((id) => standingFor?.(id) ?? null)
  const known = standings.filter((s): s is ScopeStanding => s !== null)
  const committed = known.filter((s) => s.committedAt !== null)
  const changed = committed.filter((s) => s.changed > 0).length
  const days = new Set(committed.map((s) => dayOf(s.committedAt)))
  const day = days.size === 1 ? [...days][0] ?? null : null
  const counted = known.filter((s) => s.rows.length > 0).length
  return {
    slots: slotsOf(known.map((s) => s.rows)),
    counted,
    committed: committed.length,
    notCommitted: known.length - committed.length,
    changed,
    day,
  }
}

/** "1 committed 13 Sep · 2 not committed · 1 changed" */
function standingText(r: ReturnType<typeof roundStanding>): string {
  const parts: string[] = []
  if (r.committed > 0) parts.push(`${r.committed} committed${r.day === null ? '' : ` ${r.day}`}`)
  if (r.notCommitted > 0) parts.push(`${r.notCommitted} not committed`)
  if (r.changed > 0) parts.push(`${r.changed} changed`)
  return parts.join(' · ')
}

/** The same, in the room a list row has: "1 of 3 committed · 1 changed". */
function standingShort(r: ReturnType<typeof roundStanding>): string {
  const n = r.committed + r.notCommitted
  if (n === 0) return ''
  const parts: string[] = []
  if (r.committed === 0) parts.push('none committed')
  else if (r.notCommitted === 0) parts.push(`all committed${r.day === null ? '' : ` ${r.day}`}`)
  else parts.push(`${r.committed} of ${n} committed`)
  if (r.changed > 0) parts.push(`${r.changed} changed`)
  return parts.join(' · ')
}

function EstimateList({
  projectName, estimates, loaded = true, onOpenEstimate, onCreateEstimate, onDuplicateEstimate,
  onDeleteEstimate, onExportEstimate, onRenameEstimate, standingFor,
}: EstimatesPanelProps) {
  const [naming, setNaming] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  /* The row's commands, on right-click: nothing destructive sits on the row face. */
  const [context, setContext] = useState<{ id: string; x: number; y: number } | null>(null)
  const closeContext = useCallback(() => setContext(null), [])
  const menuRef = useDismiss(context !== null, closeContext)
  const contextRound = context === null ? null : estimates.find((e) => e.id === context.id) ?? null

  return (
    <>
      <HeaderBlock
        name={projectName}
        sub={estimates.length === 0 ? (loaded ? 'No rounds yet' : 'Opening…') : `${estimates.length} round${estimates.length === 1 ? '' : 's'}`}
        primary={(
          <button className="es-btn primary" onClick={() => setNaming(true)}>
            <Glyph icon={Plus} role="inline" /> New round
          </button>
        )}
      />

      {naming && (
        <NameRow
          placeholder="Bid package name"
          label="New estimate name"
          action="Create"
          onCommit={(name) => { onCreateEstimate(name); setNaming(false) }}
          onCancel={() => setNaming(false)}
        />
      )}

      {estimates.length === 0 && !loaded && (
        <div className="es-muted pad" role="status">Opening the project…</div>
      )}

      {/*
        THE FIRST THING A NEW PROJECT SHOWS. A project opens with no estimates
        and no scopes — nothing is seeded — so this is the first screen of
        every real bid.
      */}
      {estimates.length === 0 && loaded && !naming && (
        <div className="emptystate" role="status">
          <Glyph icon={Round} role="card" />
          <div className="emptytitle">Start an estimate</div>
          <div className="emptybody">
            An estimate is one bidding round for this project. It holds the
            scopes you are pricing — a ceiling system, a run of wall panel —
            and every markup you draw belongs to one of them. A second round
            re-bids the same drawings without disturbing the first.
          </div>
          <ol className="emptysteps">
            <li>Name the round — a date and the issue it prices is enough.</li>
            <li>Add a scope for each product on the drawings.</li>
            <li>Press Take off in a scope and draw on the sheet.</li>
          </ol>
          <div className="emptyactions">
            <button className="es-btn primary" onClick={() => setNaming(true)}>
              <Glyph icon={Plus} role="inline" /> New round
            </button>
          </div>
        </div>
      )}

      {estimates.length > 0 && <SectionHead title="Rounds" count={estimates.length} />}

      {estimates.map((e) => {
        const r = roundStanding(e.scopeIds ?? [], standingFor)
        const lit = r.slots.filter((s) => s.total !== null)
        const meta = e.scopeCount === 0
          ? 'No scopes yet'
          : `${e.scopeCount} scope${e.scopeCount === 1 ? '' : 's'}${standingShort(r) === '' ? '' : ` · ${standingShort(r)}`}`
        return renaming === e.id
          ? (
            <div key={e.id} className="es-row nodot">
              <RenameField
                value={e.name}
                label="Estimate name"
                onCommit={(name) => { onRenameEstimate(e.id, name); setRenaming(null) }}
                onCancel={() => setRenaming(null)}
              />
            </div>
            )
          : (
            <button
              key={e.id}
              className={e.scopeCount === 0 ? 'es-row nodot off' : 'es-row nodot'}
              onClick={() => onOpenEstimate(e.id)}
              onContextMenu={(ev) => { ev.preventDefault(); setContext({ id: e.id, x: ev.clientX, y: ev.clientY }) }}
            >
              <span className="es-rowtext">
                <span className="es-rowname">{e.name}</span>
                <span className="es-rowmeta">{meta}</span>
              </span>
              <span className="es-rowqty">
                {lit.length === 0
                  ? <span className="es-v unset">—</span>
                  : lit.slice(0, 2).map((s) => (
                    <span key={s.unit}><span className="es-v">{fmt(s.total ?? 0)}</span><span className="es-u">{s.unit}</span></span>
                  ))}
              </span>
              <Glyph icon={ChevronRight} role="inline" />
            </button>
            )
      })}

      {context !== null && contextRound !== null && (
        <div
          className="dockmenu es-menu es-context"
          role="menu"
          aria-label={contextRound.name}
          ref={menuRef}
          style={{ left: context.x, top: context.y }}
          onClick={closeContext}
        >
          <MenuItem icon={Pencil} label="Rename" hint="F2" onClick={() => setRenaming(contextRound.id)} />
          <MenuItem icon={Copy} label="Duplicate round" title="Its scopes and specifications, not its markups" onClick={() => onDuplicateEstimate(contextRound.id, nextRoundName(contextRound.name, estimates))} />
          {onExportEstimate !== undefined && (
            <>
              <div className="menusep" />
              <MenuItem icon={DocumentPdf} label="Export…" hint="pdf · csv · tsv" onClick={() => onExportEstimate(contextRound.id)} />
            </>
          )}
          <div className="menusep" />
          {/* No confirmation dialog: the store refuses outright while the round
              holds the only copy of any takeoff, and says why. */}
          <MenuItem icon={Trash2} label="Delete round…" danger onClick={() => onDeleteEstimate(contextRound.id)} />
        </div>
      )}
    </>
  )
}

// --------------------------------------------------- level 2: the estimate --

function EstimateOverview({
  estimate, estimates, scopes, scopesLoaded = true, markupCountFor, standingFor, onOpenScope,
  onCreateScope, addScopeRequest = 0, archived = [], onRestoreScope,
  bill, billEntries, projectName, onRenameEstimate, onDuplicateEstimate, onDeleteEstimate,
  onExportEstimate,
}: EstimatesPanelProps & { estimate: EstimateListItem; billEntries: ScopePieces[] }) {
  const [naming, setNaming] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canAdd = onCreateScope !== undefined

  /* A request from the dock or the palette opens the naming row here. Only a
     CHANGE is a request — mounting with a stale nonce must not open it. */
  useEffect(() => {
    if (addScopeRequest > 0 && canAdd) setNaming(true)
  }, [addScopeRequest, canAdd])

  /* F2 renames, as the menu says it does. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2' || renaming) return
      const t = e.target
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      e.preventDefault()
      setRenaming(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [renaming])

  /*
   * The round's exports, from its menu. Each says what happened: a drawing
   * that could not be written — an export that quietly does nothing is
   * indistinguishable from one that worked.
   */
  const bom = useMemo(() => buildBom(billEntries), [billEntries])
  const saveReport = () => {
    void saveReportFile({ projectName, estimateName: estimate.name, bom, documents: bill?.documents ?? [] })
      .then((o) => setExportNote(saveOutcomeText(o, 'Report')))
      .catch((err: unknown) => setExportNote(err instanceof Error ? err.message : 'The report could not be written.'))
  }
  const exportPdf = async () => {
    if (bill?.onExportMarkedPdf === undefined || busy) return
    setBusy(true)
    try {
      const err = await bill.onExportMarkedPdf()
      setExportNote(err ?? 'Marked-up drawing saved.')
    } catch (err) {
      setExportNote(err instanceof Error ? err.message : 'The drawing could not be written.')
    } finally {
      setBusy(false)
    }
  }
  const noMarkups = (bill?.markupCount ?? 0) === 0

  const standing = roundStanding(scopes.map((s) => s.id), standingFor)
  const stateText = standingText(standing)
  const uncounted = scopes.length - standing.counted

  return (
    <>
      <HeaderBlock
        name={renaming
          ? (
            <RenameField
              value={estimate.name}
              label="Estimate name"
              onCommit={(name) => { onRenameEstimate(estimate.id, name); setRenaming(false) }}
              onCancel={() => setRenaming(false)}
            />
            )
          : estimate.name}
        sub={scopes.length === 0
          ? 'No scopes yet'
          : `${scopes.length} scope${scopes.length === 1 ? '' : 's'} · ${standing.counted} counted`}
        primary={onExportEstimate !== undefined
          ? <button className="es-btn primary" onClick={() => onExportEstimate(estimate.id)}>Export…</button>
          : undefined}
        menuLabel={`${estimate.name} menu`}
        menu={(
          <>
            <MenuItem icon={Pencil} label="Rename" hint="F2" onClick={() => setRenaming(true)} />
            <MenuItem icon={Copy} label="Duplicate round" title="Its scopes and specifications, not its markups" onClick={() => onDuplicateEstimate(estimate.id, nextRoundName(estimate.name, estimates))} />
            {bill !== undefined && (
              <>
                <div className="menusep" />
                <MenuItem icon={FileText} label="Save report…" hint="html" title="One self-contained HTML file, for sending" onClick={saveReport} />
                {bill.onExportMarkedPdf !== undefined && (
                  <MenuItem
                    icon={DocumentPdf}
                    label={busy ? 'Writing…' : 'Save marked-up PDF…'}
                    disabled={busy || noMarkups}
                    title={noMarkups ? 'The open drawing has no markups to write.' : 'Save the open drawing with its markups on it.'}
                    onClick={() => void exportPdf()}
                  />
                )}
              </>
            )}
            <div className="menusep" />
            <MenuItem icon={Trash2} label="Delete round…" danger onClick={() => onDeleteEstimate(estimate.id)} />
          </>
        )}
      />

      {scopes.length > 0 && <QuantityStrip slots={standing.slots} sub />}

      {exportNote !== null && (
        <InfoBar tone="info" onDismiss={() => setExportNote(null)}>{exportNote}</InfoBar>
      )}
      {bill !== undefined && !bill.calibrated && billEntries.length > 0 && (
        <InfoBar tone="warn">No sheet in this project has a scale yet, so nothing here is in real units.</InfoBar>
      )}
      {scopes.length > 0 && exportNote === null && (
        <InfoBar tone={standing.changed > 0 ? 'warn' : 'info'}>
          {stateText === '' ? 'Nothing committed yet' : stateText}
        </InfoBar>
      )}

      <SectionHead
        title="Scopes"
        count={scopes.length}
        right={scopes.length > 0 && canAdd && !naming
          ? <button className="es-cmd" title="Add a scope to this estimate" onClick={() => setNaming(true)}><Glyph icon={Plus} role="small" /> Add scope</button>
          : undefined}
      />

      {/* NAMED HERE, NOT IN A DIALOG. The one thing decided before a scope
          exists is its name; the rest is set on its Setup section. */}
      {naming && (
        <NameRow
          placeholder="Tag on the drawings — C-MT-01"
          label="New scope name"
          action="Add"
          onCommit={(name) => { onCreateScope?.(name); setNaming(false) }}
          onCancel={() => setNaming(false)}
        />
      )}

      {scopes.length === 0 && !scopesLoaded && (
        <div className="es-muted pad" role="status">Opening the estimate…</div>
      )}
      {scopes.length === 0 && scopesLoaded && !naming && (
        <div className="emptystate" role="status">
          <Glyph icon={Pentagon} role="card" />
          <div className="emptytitle">Add the first scope</div>
          <div className="emptybody">
            A scope is one product you are pricing — C-MT-01 metal panel
            ceiling, WP-12 wall panel. It carries that product&rsquo;s
            specification and its own colour, and whatever you draw on a
            sheet lands in the scope that is active.
          </div>
          <ol className="emptysteps">
            <li>Add a scope and name it after its tag on the drawings.</li>
            <li>Set the type and dimensions — the count comes from them.</li>
            <li>Press Take off and draw the areas, runs or counts.</li>
          </ol>
          {canAdd && (
            <div className="emptyactions">
              <button className="es-btn primary" onClick={() => setNaming(true)}>
                <Glyph icon={Plus} role="inline" /> Add scope
              </button>
            </div>
          )}
        </div>
      )}
      {scopes.map((s) => {
        const n = markupCountFor(s.id)
        const product = readProductType(s.specifications)
        const missing = missingRequiredMeasures(product, s.specifications)
        const st = standingFor?.(s.id) ?? null
        const first = st?.rows[0]
        const state = st === null || n === 0
          ? { text: 'No takeoff', tone: '' }
          : st.committedAt === null
            ? { text: 'Not committed', tone: '' }
            : st.changed > 0
              ? { text: `Changed since ${dayOf(st.committedAt) ?? 'commit'}`, tone: ' warn' }
              : { text: `Committed ${dayOf(st.committedAt) ?? ''}`.trim(), tone: ' good' }
        return (
          <button key={s.id} className={n === 0 ? 'es-row off' : 'es-row'} onClick={() => onOpenScope(s.id)}>
            <span className="es-dot" style={{ background: s.color }} aria-hidden="true" />
            <span className="es-rowtext">
              <span className="es-rowname">{s.label}</span>
              <span className="es-rowmeta">
                {PRODUCT_TYPE_LABEL[product]}
                {n === 0 ? ' · no markups' : ` · ${n} markup${n === 1 ? '' : 's'}`}
                {missing.length > 0 && <span className="es-warnink">{` · needs ${missing.join(', ')}`}</span>}
              </span>
            </span>
            <span className="es-rowqty">
              {/* One number per scope, and nothing else — what a scope is made of belongs to the scope. */}
              {first === undefined
                ? <span className="es-v unset">—</span>
                : <span><span className="es-v">{fmt(first.quantity)}</span><span className="es-u">{first.unit}</span></span>}
              <span className={`es-rowstate${state.tone}`}>{state.text}</span>
            </span>
            <Glyph icon={ChevronRight} role="inline" />
          </button>
        )
      })}

      {archived.length > 0 && onRestoreScope !== undefined && (
        <div className="es-archived">
          <button className="es-link" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
            <Glyph icon={Archive} role="small" />
            {archived.length} archived
          </button>
          {showArchived && archived.map((s) => (
            <div key={s.id} className="es-row static">
              <span className="es-dot" style={{ background: s.color }} aria-hidden="true" />
              <span className="es-rowtext">
                <span className="es-rowname">{s.label}</span>
                <span className="es-rowmeta">{PRODUCT_TYPE_LABEL[readProductType(s.specifications)]}</span>
              </span>
              <button
                className="es-btn subtle icon"
                title={`Restore ${s.label} to this estimate`}
                aria-label={`Restore ${s.label}`}
                onClick={() => onRestoreScope(s.id)}
              ><Glyph icon={RotateCcw} role="row" /></button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ------------------------------------------------------ level 3: the scope --

/** The dictionary's nouns (board 3): each markup kind has its own glyph. */
const MARKUP_ICON: Record<string, typeof Pentagon> = {
  area: Area,
  cutout: Cutout,
  polyline: Polyline,
  count: Count,
  dimension: Ruler,
  shape: Highlighter,
}

function ScopeDetail(p: EstimatesPanelProps & { estimate: EstimateListItem; scope: Scope }) {
  const {
    estimate, scope, rows, pieces, markups, sheetLabel, onGoToPage, onGoToMarkup, onSaveScope, onTakeOff, onCommit,
    onDuplicateScope, onRemoveScope,
  } = p
  const pageRef = useRef<HTMLDivElement | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [group, setGroup] = useState<'page' | 'type'>('page')
  const onScopePage = p.onScopePage

  /* The caller's request brings a section on screen. On first render it only
     names the section, so opening a scope starts at its top. */
  const show = useCallback((to: ScopePage) => {
    onScopePage?.(to)
    requestAnimationFrame(() => {
      const scroller = pageRef.current?.closest('.wsbody')
      if (to === 'parts') { if (scroller instanceof HTMLElement) scroller.scrollTo({ top: 0 }); return }
      pageRef.current?.querySelector<HTMLElement>(`[data-section="${to}"]`)?.scrollIntoView({ block: 'start' })
    })
  }, [onScopePage])
  const mounted = useRef(false)
  useEffect(() => {
    if (p.scopePage !== undefined && mounted.current) show(p.scopePage)
    mounted.current = true
  }, [p.scopePage])  // eslint-disable-line react-hooks/exhaustive-deps

  /* F2 renames, as the menu says it does. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2' || renaming) return
      const t = e.target
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      e.preventDefault()
      setRenaming(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [renaming])

  const product = readProductType(scope.specifications)
  const missing = missingRequiredMeasures(product, scope.specifications)
  /*
   * Every specification edit goes through `deriveRunTriple`: plank width,
   * reveal and on-centre spacing are three views of one geometry, so entering
   * two of them has already stated the third. It fills only an empty field.
   */
  const patch = (specs: Specifications) =>
    onSaveScope({ ...scope, specifications: deriveRunTriple(specs) })

  const blocked = pieces !== undefined && pieces.blockers.length > 0 && markups.length > 0
  const nothingDrawn = rows.length === 0 && markups.length === 0
  const sheets = new Set(markups.map((m) => `${m.documentId}#${m.page}`)).size
  const day = dayOf(p.commit?.at ?? null)

  /*
   * One InfoBar under the numbers: what is committed and what moved, or what
   * is missing and where to fix it.
   */
  const status: { tone: 'info' | 'warn' | 'good'; text: string; action: null | { label: string; run: () => void } } = (() => {
    if (nothingDrawn) {
      return { tone: 'info', text: 'Nothing measured yet. Press Take off, then draw on the sheet.', action: null }
    }
    if (missing.length > 0) {
      return { tone: 'warn', text: `Parts need ${missing.join(' and ')}.`, action: { label: 'Set it', run: () => show('setup') } }
    }
    if (blocked) {
      return { tone: 'warn', text: pieces.blockers.join('; '), action: p.onSetDirection === undefined ? null : { label: 'Set direction', run: p.onSetDirection } }
    }
    if (p.commit === undefined) {
      return { tone: 'info', text: 'Not committed', action: { label: 'Commit', run: () => onCommit(scope.id) } }
    }
    if (p.commit.delta.length === 0) {
      return { tone: 'good', text: `Committed${day === null ? '' : ` ${day}`} · unchanged`, action: { label: 'Commit again', run: () => onCommit(scope.id) } }
    }
    return { tone: 'warn', text: `Changed since the${day === null ? '' : ` ${day}`} commit`, action: { label: 'Commit', run: () => onCommit(scope.id) } }
  })()

  const delta = p.commit?.delta ?? []
  const wasOf = (itemKey: string) => delta.find((d) => d.itemKey === itemKey)
  const view = partsView(pieces, product, scope.specifications)
  const hasParts = view.primary.length + view.accessories.length > 0
  const partsChanged = hasParts && pieces !== undefined && pieces.quantities.some((q) => wasOf(q.itemKey) !== undefined)
  const drawable = pieces !== undefined && (pieces.runs.length > 0 || pieces.cells.length > 0)
  const net = rows[0]

  return (
    <div className="es-scope" ref={pageRef}>
      <HeaderBlock
        dot={(
          <label className="es-dotbtn" title="Scope colour — shown on this scope’s markups">
            <span className="es-dot lg" style={{ background: scope.color }} aria-hidden="true" />
            <input
              type="color"
              value={scope.color}
              aria-label="Scope colour"
              onChange={(e) => onSaveScope({ ...scope, color: e.target.value })}
            />
          </label>
        )}
        name={renaming
          ? (
            <RenameField
              value={scope.label}
              label="Scope name"
              onCommit={(label) => { onSaveScope({ ...scope, label }); setRenaming(false) }}
              onCancel={() => setRenaming(false)}
            />
            )
          : scope.label}
        sub={(
          <>
            {/* The product, as a subtle DropDownButton: it names the scope's
                kind, so it sits with the name and not in the grid below. */}
            <span className="es-ddb">
              <select
                id="scope-type"
                className="es-ddbsel"
                aria-label="Product"
                value={product}
                onChange={(e) => {
                  const next = e.target.value as ProductType
                  // The product decides what it is measured as; only a custom
                  // assembly keeps what was chosen.
                  const scopeType: ScopeType = scopeTypeForProduct(next) ?? scope.scopeType
                  onSaveScope({ ...scope, scopeType, specifications: writeProductType(scope.specifications, next) })
                }}
              >
                {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{PRODUCT_TYPE_LABEL[t]}</option>)}
              </select>
              <span className="es-ddbface" aria-hidden="true">{PRODUCT_TYPE_LABEL[product]}<span className="es-chev">⌄</span></span>
            </span>
            <span> · {markups.length} markup{markups.length === 1 ? '' : 's'} · {sheets} sheet{sheets === 1 ? '' : 's'}</span>
          </>
        )}
        primary={(
          <button className="es-btn primary" onClick={() => onTakeOff(scope.id)}>
            <Glyph icon={Crosshair} role="row" /> Take off
          </button>
        )}
        menuLabel={`${scope.label} menu`}
        menu={(
          <>
            <MenuItem icon={Pencil} label="Rename" hint="F2" onClick={() => setRenaming(true)} />
            {onDuplicateScope !== undefined && (
              <MenuItem icon={Copy} label="Duplicate scope" title="A copy with the same specification and none of the takeoff" onClick={() => onDuplicateScope(scope.id)} />
            )}
            {onRemoveScope !== undefined && (
              <>
                <div className="menusep" />
                <MenuItem
                  icon={Trash2}
                  label="Remove from round…"
                  danger
                  title={markups.length > 0
                    ? `Archives it. Its ${markups.length} markup${markups.length === 1 ? '' : 's'} stay and come back if you restore it.`
                    : 'Archives it. Restore it from the round’s archived list.'}
                  onClick={() => onRemoveScope(estimate.id, scope.id)}
                />
              </>
            )}
          </>
        )}
      />

      <QuantityStrip
        slots={[
          ...slotsOf([rows]),
          // A run product's installed length is a measurement, not a part (board 4).
          ...(view.installedFeet === null ? [] : [{ itemKey: 'net_linear', unit: 'LF' as const, label: 'Installed', total: view.installedFeet, scopes: 1 }]),
        ]}
        delta={delta.filter((d) => rows.some((r) => r.itemKey === d.itemKey) || d.itemKey === 'net_linear')}
      />
      <InfoBar tone={status.tone} action={status.action}>{status.text}</InfoBar>

      {/*
        No parts, no section: a custom assembly is quantified by hand, and
        "No parts for this product" was a sentence about the software.
      */}
      {product !== 'custom_assembly' && (
        <section data-section="parts" aria-labelledby="es-parts">
          <SectionHead
            id="es-parts"
            title="Parts"
            count={hasParts ? view.primary.length : undefined}
            right={(
              <>
                {/* Confidence, said once: the run products match arithmetic but are not verified against the Qt build. */}
                {hasParts && !isVerifiedProduct(product) && (
                  <span className="es-chip" title="Piece counts match arithmetic but are not verified against the Qt build">unverified</span>
                )}
                {partsChanged && <span className="es-aside">was = at the{day === null ? '' : ` ${day}`} commit</span>}
              </>
            )}
          />
          <PartsTable view={view} pieces={pieces} nothingDrawn={nothingDrawn} missing={missing} wasOf={partsChanged ? wasOf : null} />
        </section>
      )}

      <section data-section="setup" aria-labelledby="es-setup">
        <SectionHead
          id="es-setup"
          title="Setup"
          right={pieces !== undefined
            ? (
              <label className={drawable ? 'es-swrow' : 'es-swrow off'}>
                <span className="es-aside">Show layout on sheet</span>
                <button
                  type="button"
                  role="switch"
                  className={p.layoutOn ? 'es-sw on' : 'es-sw'}
                  aria-checked={p.layoutOn}
                  aria-label="Show layout on sheet"
                  disabled={!drawable}
                  onClick={() => p.onToggleLayout(!p.layoutOn)}
                ><span /></button>
              </label>
              )
            : undefined}
        />
        <SetupGrid
          scope={scope}
          product={product}
          missing={missing}
          patch={patch}
          onSaveScope={onSaveScope}
          lengthDenominator={p.lengthDenominator ?? 16}
          {...(p.direction !== undefined ? { direction: p.direction } : {})}
          {...(p.onSetDirection !== undefined ? { onSetDirection: p.onSetDirection } : {})}
        />
      </section>

      <section data-section="markups" aria-labelledby="es-markups">
        <SectionHead
          id="es-markups"
          title="Markups"
          count={`${markups.length} on ${sheets} sheet${sheets === 1 ? '' : 's'}`}
          right={(
            <span className="es-sb" role="group" aria-label="Group markups by">
              <button className="es-sbi" aria-pressed={group === 'page'} onClick={() => setGroup('page')}>By sheet</button>
              <button className="es-sbi" aria-pressed={group === 'type'} onClick={() => setGroup('type')}>By kind</button>
            </span>
          )}
        />
        {markups.length === 0 && (
          <div className="es-muted pad">None yet — each shape you draw is listed here, by sheet.</div>
        )}
        {groupMarkups(markups, group, sheetLabel, p.sheetTitle).map(([heading, list]) => (
          <div key={heading.key}>
            <div className="es-grp">
              <b>{heading.title}</b>
              {heading.detail !== '' && <span className="es-grpdetail">{heading.detail}</span>}
              <span className="es-sp" />
              <span>{list.length}</span>
            </div>
            {list.map((m) => (
              <button
                key={m.id}
                className={m.layoutNote === undefined ? 'es-mk' : 'es-mk off'}
                onClick={() => (onGoToMarkup !== undefined ? onGoToMarkup(m) : onGoToPage(m.page))}
                title={m.layoutNote === undefined
                  ? (m.inOpenDocument ? `Go to ${sheetLabel(m.page)}` : `Open ${m.documentName}, page ${m.page + 1}`)
                  : `Not in the layout: ${m.layoutNote}`}
              >
                <Glyph icon={MARKUP_ICON[m.kind] ?? Pentagon} role="small" />
                <span className="es-mkname">
                  {m.name}
                  {m.parentName !== undefined && <span className="es-mkin"> in {m.parentName}</span>}
                  {group === 'type' && <span className="es-mkin"> · {m.inOpenDocument ? sheetLabel(m.page) : `${m.documentName} p${m.page + 1}`}</span>}
                  {m.layoutNote !== undefined && <span className="es-mkwhy">⚠ {m.layoutNote}</span>}
                </span>
                <span className="es-mkv">{m.measure}</span>
              </button>
            ))}
          </div>
        ))}
        {markups.length > 0 && net !== undefined && (
          <div className="es-net"><span>Net</span><span className="es-netv">{fmt(net.quantity)} {net.unit}</span></div>
        )}
      </section>
    </div>
  )
}

/**
 * The parts list, to board 4 (approved 2026-09-18): A PART IS A THING YOU BUY.
 *
 * The domain emits every quantity it computes, and the table used to print
 * them all as parts — so a panel scope at yield "full" read "Panels 662 /
 * Full panels 662", a plank scope led with "Installed length" in LF, and a
 * linear-parts scope was one part and three lengths. This is the presentation
 * rule the numbers now go through; nothing takeoff.ts or runs.ts emits
 * changes, the BOM keeps every line and its confidence, and the exports keep
 * every row.
 *
 *   primary      panels · planks · baffle stock · cassettes · linear parts —
 *                one line each, its size as a chip, its arithmetic (the
 *                full/cut breakdown, ordered length and offcut) as a quiet
 *                line beneath, never as a part of its own.
 *   accessories  rails, connectors, end caps, joiners, perimeter trim: real,
 *                but not the product. A second, quieter group.
 *   installed    a run product's net installed length is a MEASUREMENT and
 *                goes to the tiles, not the order list.
 *   dropped      measured length beside the Length tile — the same number in
 *                a second place.
 */
interface PartRow { itemKey: string; label: string; chip?: string; quantity: number; unit: string; detail?: string }
interface PartsView { primary: PartRow[]; accessories: PartRow[]; installedFeet: number | null }
const ACCESSORY_ITEMS = new Set(['perimeter_trim', 'connectors', 'end_caps', 'joiners', 'suspension_rails'])
/** Folded into a primary line's detail, or into a tile; never a row. */
const FOLDED_ITEMS = new Set(['panel_full', 'panel_half', 'linear_measured', 'linear_ordered', 'linear_offcut'])

function partsView(pieces: PieceResult | undefined, product: ProductType, specs: Specifications): PartsView {
  const view: PartsView = { primary: [], accessories: [], installedFeet: null }
  if (pieces === undefined || product === 'custom_assembly') return view
  const q = pieces.quantities
  const by = (key: string) => q.find((x) => x.itemKey === key)
  const feet = (valueKey: string) => measureToFeet(specs, { valueKey, unitKey: `${valueKey}Unit`, label: valueKey })
  const len = (f: number | null) => (f === null ? null : formatLength(f, 'ft'))
  for (const item of q) {
    if (item.itemKey === 'net_linear') { view.installedFeet = item.quantity; continue }
    if (FOLDED_ITEMS.has(item.itemKey)) continue
    const row: PartRow = { itemKey: item.itemKey, label: pieceLabel(item), quantity: item.quantity, unit: item.unit }
    if (item.itemKey === 'panel_count') {
      const w = len(feet('panelWidth'))
      const l = len(feet('panelLength'))
      if (w !== null && l !== null) row.chip = `${w} × ${l}`
      // The breakdown says something only when panels were cut.
      const half = by('panel_half')
      if (half !== undefined && half.quantity > 0) row.detail = `${fmt(by('panel_full')?.quantity ?? 0)} full · ${fmt(half.quantity)} cut`
    } else if (item.itemKey === 'cassette_count') {
      // A module: its width by the baffle length (Aaron, 2026-09-18).
      const w = len(feet('cassetteWidth'))
      const l = len(feet('stockLength'))
      if (w !== null && l !== null) row.chip = `${w} × ${l}`
    } else if (item.itemKey === 'primary_stock') {
      const stock = len(feet('stockLength'))
      if (stock !== null) row.chip = `${stock} stock`
      if (product === 'baffle_cassette') {
        const w = feet('cassetteWidth')
        const s = feet('spacing')
        if (w !== null && s !== null) row.detail = `${Math.max(1, Math.floor(w / s + 1e-9))} per cassette`
      }
    } else if (item.itemKey === 'linear_parts') {
      const each = len(feet('partLength'))
      if (each !== null) row.chip = `${each} each`
      const bits: string[] = []
      const ordered = by('linear_ordered')
      const offcut = by('linear_offcut')
      if (ordered !== undefined) bits.push(`${fmt(ordered.quantity)} LF ordered`)
      if (offcut !== undefined) bits.push(`${fmt(offcut.quantity)} LF offcut`)
      if (bits.length > 0) row.detail = bits.join(' · ')
    }
    ;(ACCESSORY_ITEMS.has(item.itemKey) ? view.accessories : view.primary).push(row)
  }
  return view
}

/** Parts: what to order, with what it was at the commit when that differs. */
function PartsTable({ view, pieces, nothingDrawn, missing, wasOf }: {
  view: PartsView
  pieces: PieceResult | undefined
  nothingDrawn: boolean
  missing: string[]
  wasOf: ((itemKey: string) => QuantityDelta | undefined) | null
}) {
  const hasParts = view.primary.length + view.accessories.length > 0
  if (nothingDrawn) {
    return (
      <div className="es-muted pad">
        Nothing to order yet. Press Take off, then draw on the sheet — areas
        for a ceiling, a line for a run, a tap per fixture — and the parts
        arrive here.
      </div>
    )
  }
  if (!hasParts || pieces === undefined) {
    return (
      <div className="es-muted pad">
        {missing.length > 0
          ? `Set ${missing.join(' and ')} before this scope can be counted. Nothing is estimated in its place.`
          : pieces !== undefined && pieces.blockers.length > 0
            ? pieces.blockers.join('; ')
            : 'No parts for this product.'}
      </div>
    )
  }
  const blocked = pieces.blockers.length > 0
  const row = (r: PartRow, accessory: boolean) => {
    const was = wasOf?.(r.itemKey)
    return (
      <div className="es-trg" key={r.itemKey}>
        <div className={`es-tr${blocked ? ' pending' : ''}${accessory ? ' es-tracc' : ''}`}>
          <span className="es-trl">
            {r.label}
            {r.chip !== undefined && <span className="es-trchip">{r.chip}</span>}
          </span>
          <span className="es-trn">{blocked ? '—' : fmt(r.quantity)}</span>
          <span className="es-tru">{r.unit}</span>
          {wasOf !== null && (
            <span className={was === undefined ? 'es-trw' : 'es-trw chg'}>
              {was === undefined ? '' : was.committed === null ? '—' : fmt(was.committed)}
            </span>
          )}
        </div>
        {r.detail !== undefined && !blocked && (
          <div className="es-tr es-trsub"><span className="es-trl">{r.detail}</span></div>
        )}
      </div>
    )
  }
  return (
    <div className={wasOf === null ? 'es-tbl nowas' : 'es-tbl'}>
      <div className="es-tr h">
        <span>Part</span>
        <span className="es-trn">Qty</span>
        <span />
        {wasOf !== null && <span className="es-trw">was</span>}
      </div>
      {view.primary.map((r) => row(r, false))}
      {view.accessories.length > 0 && (
        <>
          <div className="es-tr es-trhead">
            <span className="es-trl">Accessories <span className="es-n">{view.accessories.length}</span></span>
          </div>
          {view.accessories.map((r) => row(r, true))}
        </>
      )}
    </div>
  )
}

/**
 * Setup: the specification, two label/value pairs per row. The product is
 * in the header; the measures, then Yield and Seams, then Direction across
 * the row. A custom assembly asks what it is measured as, since the product
 * does not say.
 */
function SetupGrid({
  scope, product, missing, patch, onSaveScope, direction = null, onSetDirection, lengthDenominator = 16,
}: {
  scope: Scope
  product: ProductType
  missing: string[]
  patch: (specs: Specifications) => void
  onSaveScope: (scope: Scope) => void
  direction?: string | null
  onSetDirection?: () => void
  lengthDenominator?: number
}) {
  const measures = editableMeasures(product)
  const laysOut = product !== 'custom_assembly' && product !== 'linear_parts'
  return (
    <div className="es-sg">
      {product === 'custom_assembly' && (
        <>
          <label className="es-k" htmlFor="scope-counts">Measured as</label>
          <span className="es-fieldwrap wide">
            <select
              id="scope-counts"
              className="es-field"
              value={scope.scopeType}
              onChange={(e) => onSaveScope({ ...scope, scopeType: e.target.value as ScopeType })}
            >
              {SCOPE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </span>
          <span className="es-muted wide">{SCOPE_TYPES.find((t) => t.id === scope.scopeType)?.help}</span>
        </>
      )}
      {measures.map((f) => (
        <MeasureField
          key={f.valueKey}
          label={f.label}
          required={missing.includes(f.label)}
          value={readString(scope.specifications, f.valueKey) ?? ''}
          unit={unitDisplayText(readString(scope.specifications, f.unitKey) ?? '')}
          denominator={lengthDenominator}
          onCommit={(value, unit) =>
            patch({ ...scope.specifications, [f.valueKey]: value, [f.unitKey]: unit })}
        />
      ))}
      {/* Granularity and seam alignment are MEASURES of a kind: both change the number. */}
      {laysOut && (
        <>
          <label className="es-k" htmlFor="scope-yield">Yield</label>
          <span className="es-fieldwrap">
            <select
              id="scope-yield"
              className="es-field"
              value={readGranularity(scope.specifications, granularityKey(product))}
              onChange={(e) => patch({ ...scope.specifications, [granularityKey(product)]: e.target.value })}
            >
              {GRANULARITIES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </span>
          <label className="es-k" htmlFor="scope-seams">Seams</label>
          <span className="es-fieldwrap">
            <select
              id="scope-seams"
              className="es-field"
              value={readBool(scope.specifications, 'alignSeams') ? 'aligned' : 'free'}
              onChange={(e) => patch({ ...scope.specifications, alignSeams: String(e.target.value === 'aligned') })}
            >
              <option value="aligned">aligned</option>
              <option value="free">free</option>
            </select>
          </span>
          <span className="es-k">Direction</span>
          <span className="es-ro wide">
            <span className={direction === null ? 'es-rotext unset' : 'es-rotext'}>{direction ?? 'not set'}</span>
            <span className="es-sp" />
            {onSetDirection !== undefined && (
              <button className="es-link" onClick={onSetDirection}>Set on sheet</button>
            )}
          </span>
        </>
      )}
      {product === 'planks' && (
        <span className="es-muted wide">
          Width, reveal and spacing are one geometry: spacing = width + reveal. Enter any two and the third fills itself while it is still empty.
        </span>
      )}
      {measures.length === 0 && product !== 'custom_assembly' && (
        <span className="es-muted wide">There are no dimensions to set for this product.</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- fields --

/**
 * A length, committed on blur or Enter rather than per keystroke. Per-keystroke
 * would write `4`, `4.`, `4.5` to the database and put three entries in the
 * undo log for one edit.
 *
 * The field shows the length the way it is read, 10′ 0″ or 300 mm, and
 * accepts any way of writing one: 10', 120", 10 ft, 5' 6 1/2", 3m. The text
 * carries the unit, and a bare number keeps the unit the value already had
 * (inches, when it had none). The stored value is what was typed, converted,
 * at full precision; only the display is rounded.
 */
function MeasureField({
  label, required, value, unit, denominator, onCommit,
}: {
  label: string
  required: boolean
  value: string
  unit: string
  denominator: number
  onCommit: (value: string, unit: string) => void
}) {
  const shown = (): string => {
    const n = parseNumberOrFraction(value)
    return n === null || value === '' ? value : formatLength(n, unit, denominator)
  }
  const [draft, setDraft] = useState(shown)
  useEffect(() => { setDraft(shown()) }, [value, unit, denominator])  // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    if (draft === shown()) return
    const parsed = parseLengthInput(draft, isLengthUnit(unit) ? unit : 'in')
    if (parsed === null) { setDraft(shown()); return }
    onCommit(formatMeasureValue(parsed.value), parsed.unit)
  }
  const id = `measure-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <>
      <label className={required ? 'es-k needed' : 'es-k'} htmlFor={id}>{label}</label>
      <span className="es-fieldwrap">
        <input
          id={id}
          className={required ? 'es-field mono needed' : 'es-field mono'}
          value={draft}
          inputMode="text"
          placeholder={required ? 'required' : '—'}
          aria-label={label}
          title={`${label}: 10', 120\", 5' 6 1/2\", 3 m`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() }
            if (e.key === 'Escape') setDraft(shown())
          }}
        />
      </span>
    </>
  )
}

interface GroupHead { key: string; title: string; detail: string }

function groupMarkups(
  markups: ScopeMarkup[],
  by: 'page' | 'type',
  sheetLabel: (page: number) => string,
  sheetTitle?: (page: number) => string,
): Array<[GroupHead, ScopeMarkup[]]> {
  const out = new Map<string, { head: GroupHead; list: ScopeMarkup[] }>()
  for (const m of markups) {
    // A sheet of the open document is named by its sheet number and name; a
    // sheet of another document carries that document's name, since its
    // index is not read until it is opened.
    const named = (page: number) => {
      const t = sheetTitle?.(page) ?? ''
      return t === '' ? `p${page + 1}` : `${t} · p${page + 1}`
    }
    const head: GroupHead = by === 'page'
      ? (m.inOpenDocument
          ? { key: `${m.documentId}#${m.page}`, title: sheetLabel(m.page), detail: named(m.page) }
          : { key: `${m.documentId}#${m.page}`, title: m.documentName, detail: `p${m.page + 1}` })
      : { key: m.kind, title: m.kind.replace(/^./, (c) => c.toUpperCase()) + 's', detail: '' }
    const hit = out.get(head.key) ?? { head, list: [] }
    hit.list.push(m)
    out.set(head.key, hit)
  }
  // The open document first, then the others by name, each in page order;
  // count-descending for kinds.
  const entries = [...out.values()]
  const rank = (l: ScopeMarkup[]) => [l[0]?.inOpenDocument ? 0 : 1, l[0]?.documentName ?? '', l[0]?.page ?? 0] as const
  const sorted = by === 'page'
    ? entries.sort((a, b) => {
      const [ra, na, pa] = rank(a.list), [rb, nb, pb] = rank(b.list)
      return ra - rb || na.localeCompare(nb) || pa - pb
    })
    : entries.sort((a, b) => b.list.length - a.list.length)
  return sorted.map((e) => [e.head, e.list])
}
