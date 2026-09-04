/**
 * The right sidebar: Estimates, and only Estimates.
 *
 * Three levels, breadcrumbed, with a Back at each step:
 *
 *   Estimates  ›  260518 - Midrise Bid  ›  C-MT-01 Plank
 *
 * An estimate is a bidding round that owns its scopes (REDBEAM_ESTIMATES_MODEL,
 * adopted 2026-08-02), so the round is the thing you navigate through to reach
 * a scope — not a peer tab beside it.
 *
 * THERE IS NO BILL OF MATERIALS AT THE ROUND. Aaron, 2026-09-04: material never
 * shows on the estimate level. A scope's parts are read on the scope, the
 * round lists one total per scope and nothing else, and what a round can still
 * do with its bill — save the report, copy it as text, save the marked-up
 * drawing — is a menu on the round's header, where an export belongs.
 *
 * THE SCOPE PANE IS THREE PAGES, NOT A COLUMN. A scope answers three questions
 * that used to share one long scroll: what do I order, how is it configured,
 * and what did I draw. Each is a page of a SelectorBar under a header that
 * never scrolls away — the scope, its Take off, and the quantity it produces
 * with one status line beneath it. Parts opens by default: ordering is what
 * the pane exists to produce.
 *
 * Scope colour appears in exactly three places here, per the comps' own rule:
 * the 8px identifier dot, the tint on the ONE active scope's header band, and
 * nowhere else. Never as text, never as a fill on a section.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  PieceResult, ProductType, QuantityResult, Scope, ScopePieces, ScopeType, Specifications,
} from '@redbeam/domain'
import type { QuantityDelta } from '../commit.js'
import {
  PRODUCT_TYPES, PRODUCT_TYPE_LABEL, buildBom, editableMeasures, measureHelp,
  missingRequiredMeasures, readProductType, readString, unitDisplayText, writeProductType,
  deriveRunTriple, granularityKey, readGranularity, readBool, GRANULARITIES,
} from '@redbeam/domain'
import {
  Calculator, Check, ChevronRight, Compass, Crosshair, Ellipsis, FileText, Glyph, Info,
  Plus, Ruler, Pentagon, Tally, TriangleAlert, Copy, Trash2, RotateCcw, Archive, Pencil,
  DocumentPdf,
} from './icons.js'
import { entriesForRound } from '../bom/bomRows.js'
import { copyBillTsv, saveOutcomeText, saveReportFile } from '../bom/exports.js'

const UNITS = ['in', 'ft', 'mm', 'cm', 'm'] as const
/**
 * What a scope counts, in the order an estimator meets them: most ceiling
 * scopes are areas, trims and runs are linear, fixtures are counted.
 */
const SCOPE_TYPES: ReadonlyArray<{ id: ScopeType; label: string }> = [
  { id: 'area', label: 'areas' },
  { id: 'linear', label: 'lengths' },
  { id: 'count', label: 'counts' },
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
  panel_count: 'Panels',
  full_panels: 'Full panels',
  half_panels: 'Half panels',
  primary_stock: 'Stock',
  net_linear: 'Installed length',
  perimeter_trim: 'Perimeter trim',
  trim_pieces: 'Trim pieces',
  trim_linear_feet: 'Trim',
  stock_pieces: 'Stock pieces',
  connectors: 'Connectors',
  connector_points: 'Connectors',
  end_caps: 'End caps',
  joiners: 'Joiners',
  suspension_rails: 'Suspension rails',
}
const pieceLabel = (q: { itemKey: string; label?: string }) =>
  (q.label !== undefined && q.label.trim() !== '')
    ? q.label
    : PIECE_LABEL[q.itemKey]
      ?? q.itemKey.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** The three pages of a scope. */
export type ScopePage = 'parts' | 'setup' | 'markups'

export interface EstimateListItem {
  id: string
  name: string
  scopeCount: number
  markupCount: number
}

export interface EstimateFile {
  documentId: string
  relativePath: string
  markupCount: number
}

export interface ScopeMarkup {
  id: string
  kind: string
  page: number
  /** Pre-formatted measurement, e.g. `412.6 SF`. */
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
   * Which page of the open scope is showing. Controlled when the caller has
   * a reason to choose — the dock's Specifications button opens Setup, its
   * Quantities button opens Parts — and internal otherwise.
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
  /** The one number a scope produces, pre-formatted, for the round's list. Null when nothing is measured. */
  totalFor?: (scopeId: string) => string | null
  files: EstimateFile[]
  onOpenDocument: (documentId: string) => void

  /** For the open scope. */
  rows: QuantityResult[]
  pieces?: PieceResult
  markups: ScopeMarkup[]
  sheetLabel: (page: number) => string
  onGoToPage: (page: number) => void

  onCreateEstimate: (name: string) => void
  /**
   * Make a scope with this name in the open estimate, and open it.
   *
   * There is no scope editor any more. A scope is named where its round
   * lists it — the same row-with-a-field the round itself was named in — and
   * everything past the name is set on the scope's own Setup page.
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
  /** The layout preview, so the page that reports a count can also show it. */
  layoutOn: boolean
  onToggleLayout: (on: boolean) => void
  /**
   * The committed answer for the open scope, and what has moved since.
   * Absent when this scope has never been committed.
   */
  commit?: { at: string | null, delta: QuantityDelta[] }
  onCommit: (scopeId: string) => void
  /**
   * Check and name a round before it leaves as a PDF, a CSV or a TSV. Offered
   * at the list level and in the round's menu, so nobody has to drill into a
   * scope to find the way out. The sheet it opens is `exportSheet`.
   */
  onExportEstimate?: (estimateId: string) => void
  /** The export sheet, when one is open. Takes the panel's body over. */
  exportSheet?: ReactNode
  warnings: string[]
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

export function EstimatesPanel(p: EstimatesPanelProps) {
  const estimate = p.estimates.find((e) => e.id === p.openEstimateId) ?? null
  const scope = p.scopes.find((s) => s.id === p.openScopeId) ?? null
  const roundScopes = useMemo(() => new Set(p.scopes.map((s) => s.id)), [p.scopes])
  const billEntries = useMemo(
    () => (p.bill === undefined ? [] : entriesForRound(p.bill.entries, estimate === null ? null : roundScopes)),
    [p.bill, estimate, roundScopes],
  )

  return (
    <aside className="workspace">
      <div className="wshead-bar">
        <span className="wstitle"><Glyph icon={Calculator} role="inline" /> Estimates</span>
      </div>

      {estimate !== null && (
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
        {p.blocker !== undefined && (
          <div className="wswarn action" role="status">
            <Glyph icon={TriangleAlert} role="row" />
            <span className="grow">{p.blocker.message}</span>
            <button className="link" onClick={p.blocker.onResolve}>{p.blocker.actionLabel}</button>
          </div>
        )}
        {/* The first warning is shown; the rest are counted, and expand on ask. */}
        {p.warnings.length > 0 && <WarningStack warnings={p.warnings} />}

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

/** The first warning, plus a count of the rest. */
function WarningStack({ warnings }: { warnings: string[] }) {
  const [open, setOpen] = useState(false)
  const rest = warnings.length - 1
  const shown = open ? warnings : warnings.slice(0, 1)
  return (
    <div className="wswarnstack">
      {shown.map((w, i) => (
        <div className="wswarn" key={i}>
          <Glyph icon={TriangleAlert} role="row" /><span className="grow">{w}</span>
          {i === 0 && rest > 0 && (
            <button className="link" onClick={() => setOpen((v) => !v)}>
              {open ? 'Fewer' : `+${rest}`}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------- level 1: the list --

function EstimateList({
  projectName, estimates, loaded = true, onOpenEstimate, onCreateEstimate, onDuplicateEstimate,
  onDeleteEstimate, onExportEstimate,
}: EstimatesPanelProps) {
  const [naming, setNaming] = useState(false)
  const [draft, setDraft] = useState('')

  const commit = () => {
    const name = draft.trim()
    if (name !== '') onCreateEstimate(name)
    setDraft('')
    setNaming(false)
  }

  return (
    <>
      <div className="wshead">
        <div className="grow">
          <h2>Estimates</h2>
          <div className="wsmuted">{projectName}</div>
        </div>
        <button className="primarybtn" onClick={() => setNaming(true)}>
          <Glyph icon={Plus} role="inline" /> New
        </button>
      </div>

      {naming && (
        <div className="nameeditor">
          <input
            autoFocus
            value={draft}
            placeholder="Bid package name"
            aria-label="New estimate name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { setDraft(''); setNaming(false) }
            }}
          />
          <button className="primarybtn" onClick={commit} disabled={draft.trim() === ''}>Create</button>
          <button className="ghostbtn" onClick={() => { setDraft(''); setNaming(false) }}>Cancel</button>
        </div>
      )}

      {estimates.length === 0 && !loaded && (
        <div className="wsmuted pending" role="status">Opening the project…</div>
      )}

      {/*
        THE FIRST THING A NEW PROJECT SHOWS. A project opens with no estimates
        and no scopes — nothing is seeded — so this is the first screen of
        every real bid.
      */}
      {estimates.length === 0 && loaded && !naming && (
        <div className="emptystate" role="status">
          <Glyph icon={Calculator} role="card" />
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
            <button className="primarybtn" onClick={() => setNaming(true)}>
              <Glyph icon={Plus} role="inline" /> New estimate
            </button>
          </div>
        </div>
      )}

      {estimates.map((e) => (
        <div key={e.id} className="estrow">
          <button className="estopen" onClick={() => onOpenEstimate(e.id)}>
            <Glyph icon={Calculator} role="card" />
            <span className="esttext">
              <span className="estname">{e.name}</span>
              <span className="wsmuted">
                {e.scopeCount === 0
                  ? 'No scopes yet'
                  : `${e.scopeCount} scope${e.scopeCount === 1 ? '' : 's'} · ${e.markupCount} markup${e.markupCount === 1 ? '' : 's'}`}
              </span>
            </span>
            <Glyph icon={ChevronRight} role="inline" />
          </button>
          {onExportEstimate !== undefined && (
            <button
              className="paneact"
              title={`Export ${e.name} — a PDF, a CSV or a TSV, after a check`}
              aria-label={`Export ${e.name}`}
              onClick={() => onExportEstimate(e.id)}
            ><Glyph icon={DocumentPdf} role="row" /></button>
          )}
          <button
            className="paneact"
            title={`Duplicate ${e.name} — its scopes and specifications, not its markups`}
            aria-label={`Duplicate ${e.name}`}
            onClick={() => onDuplicateEstimate(e.id, nextRoundName(e.name, estimates))}
          ><Glyph icon={Copy} role="row" /></button>
          {/* No confirmation dialog: the store refuses outright while the round
              holds the only copy of any takeoff, and says why. */}
          <button
            className="paneact danger"
            title={`Delete ${e.name}`}
            aria-label={`Delete ${e.name}`}
            onClick={() => onDeleteEstimate(e.id)}
          ><Glyph icon={Trash2} role="row" /></button>
        </div>
      ))}
    </>
  )
}

// --------------------------------------------------- level 2: the estimate --

function EstimateOverview({
  estimate, estimates, scopes, scopesLoaded = true, markupCountFor, totalFor, files, onOpenScope, onOpenDocument,
  onCreateScope, addScopeRequest = 0, archived = [], onRestoreScope,
  bill, billEntries, projectName, onRenameEstimate, onDuplicateEstimate, onDeleteEstimate,
  onExportEstimate,
}: EstimatesPanelProps & { estimate: EstimateListItem; billEntries: ScopePieces[] }) {
  const [naming, setNaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(estimate.name)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const menuRef = useDismiss(menuOpen, () => setMenuOpen(false))
  const canAdd = onCreateScope !== undefined

  /* A request from the dock or the palette opens the naming row here. Only a
     CHANGE is a request — mounting with a stale nonce must not open it. */
  useEffect(() => {
    if (addScopeRequest > 0 && canAdd) setNaming(true)
  }, [addScopeRequest, canAdd])

  const commit = () => {
    const name = draft.trim()
    if (name !== '' && onCreateScope !== undefined) onCreateScope(name)
    setDraft('')
    setNaming(false)
  }
  const cancel = () => { setDraft(''); setNaming(false) }

  const commitRename = () => {
    const name = nameDraft.trim()
    if (name !== '' && name !== estimate.name) onRenameEstimate(estimate.id, name)
    setRenaming(false)
  }

  /*
   * The round's exports, from its menu. Each says what happened: a clipboard
   * that refused, a drawing that could not be written — an export that
   * quietly does nothing is indistinguishable from one that worked.
   */
  const bom = useMemo(() => buildBom(billEntries), [billEntries])
  const saveReport = () => {
    void saveReportFile({ projectName, estimateName: estimate.name, bom, documents: bill?.documents ?? [] })
      .then((o) => setExportNote(saveOutcomeText(o, 'Report')))
      .catch((err: unknown) => setExportNote(err instanceof Error ? err.message : 'The report could not be written.'))
  }
  const copyTsv = async () => {
    setExportNote((await copyBillTsv(bom)) ? 'Bill copied as TSV.' : 'The clipboard refused the bill.')
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

  return (
    <>
      <div className="wshead" ref={menuRef}>
        {renaming
          ? (
            <div className="nameeditor grow">
              <input
                autoFocus
                value={nameDraft}
                aria-label="Estimate name"
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') { setNameDraft(estimate.name); setRenaming(false) }
                }}
              />
              <button className="primarybtn" onClick={commitRename} disabled={nameDraft.trim() === ''}>Rename</button>
              <button className="ghostbtn" onClick={() => { setNameDraft(estimate.name); setRenaming(false) }}>Cancel</button>
            </div>
            )
          : <h2>{estimate.name}</h2>}
        {!renaming && (
          <button
            className="paneact"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Round menu"
            aria-label={`${estimate.name} menu`}
            onClick={() => setMenuOpen((v) => !v)}
          ><Glyph icon={Ellipsis} role="row" /></button>
        )}
        {/*
          Rename, duplicate, the three exports, delete. A menu because none
          of these is reached for more than once a round, and six buttons in a
          380px head is a row that wraps.
        */}
        {menuOpen && (
          <div className="dockmenu roundmenu" role="menu" aria-label={estimate.name}>
            <button className="menuitem" role="menuitem" onClick={() => { setMenuOpen(false); setNameDraft(estimate.name); setRenaming(true) }}>
              <Glyph icon={Pencil} role="row" /><span className="grow">Rename</span>
            </button>
            <button
              className="menuitem"
              role="menuitem"
              title="Its scopes and specifications, not its markups"
              onClick={() => { setMenuOpen(false); onDuplicateEstimate(estimate.id, nextRoundName(estimate.name, estimates)) }}
            >
              <Glyph icon={Copy} role="row" /><span className="grow">Duplicate round</span>
            </button>
            {onExportEstimate !== undefined && (
              <>
                <div className="menusep" />
                <button
                  className="menuitem"
                  role="menuitem"
                  title="Check the names and scopes, then save a branded PDF, a CSV, or copy a TSV"
                  onClick={() => { setMenuOpen(false); onExportEstimate(estimate.id) }}
                >
                  <Glyph icon={DocumentPdf} role="row" /><span className="grow">Export estimate…</span><span className="hint">pdf · csv · tsv</span>
                </button>
              </>
            )}
            {bill !== undefined && (
              <>
                <div className="menusep" />
                <button className="menuitem" role="menuitem" title="One self-contained HTML file, for sending" onClick={() => { setMenuOpen(false); saveReport() }}>
                  <Glyph icon={FileText} role="row" /><span className="grow">Save report…</span><span className="hint">html</span>
                </button>
                <button className="menuitem" role="menuitem" onClick={() => { setMenuOpen(false); void copyTsv() }}>
                  <Glyph icon={Copy} role="row" /><span className="grow">Copy bill as TSV</span>
                </button>
                {bill.onExportMarkedPdf !== undefined && (
                  <button
                    className="menuitem"
                    role="menuitem"
                    disabled={busy || noMarkups}
                    title={noMarkups ? 'The open drawing has no markups to write.' : 'Save the open drawing with its markups on it.'}
                    onClick={() => { setMenuOpen(false); void exportPdf() }}
                  >
                    <Glyph icon={DocumentPdf} role="row" /><span className="grow">{busy ? 'Writing…' : 'Save marked-up PDF…'}</span>
                  </button>
                )}
              </>
            )}
            <div className="menusep" />
            <button className="menuitem danger" role="menuitem" onClick={() => { setMenuOpen(false); onDeleteEstimate(estimate.id) }}>
              <Glyph icon={Trash2} role="row" /><span className="grow">Delete round</span>
            </button>
          </div>
        )}
      </div>

      {exportNote !== null && (
        <div className="wswarn" role="status">
          <Glyph icon={Info} role="row" />
          <span className="grow">{exportNote}</span>
          <button className="link" onClick={() => setExportNote(null)}>Dismiss</button>
        </div>
      )}
      {bill !== undefined && !bill.calibrated && billEntries.length > 0 && (
        <div className="wswarn">
          <Glyph icon={TriangleAlert} role="row" />
          <span>This drawing is not calibrated, so nothing here is in real units yet.</span>
        </div>
      )}

      <section className="wssection">
        <h3>
          <span className="grow">Scopes</span>
          {scopes.length > 0 && canAdd && !naming && (
            <button className="paneact" title="Add a scope to this estimate" aria-label="Add a scope" onClick={() => setNaming(true)}>
              <Glyph icon={Plus} role="row" />
            </button>
          )}
          <span className="hcount">{scopes.length}</span>
        </h3>

        {/* NAMED HERE, NOT IN A DIALOG. The one thing decided before a scope
            exists is its name; the rest is set on its Setup page. */}
        {naming && (
          <div className="nameeditor">
            <input
              autoFocus
              value={draft}
              placeholder="Tag on the drawings — C-MT-01"
              aria-label="New scope name"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') cancel()
              }}
            />
            <button className="primarybtn" onClick={commit} disabled={draft.trim() === ''}>Add</button>
            <button className="ghostbtn" onClick={cancel}>Cancel</button>
          </div>
        )}

        {scopes.length === 0 && !scopesLoaded && (
          <div className="wsmuted pending" role="status">Opening the estimate…</div>
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
                <button className="primarybtn" onClick={() => setNaming(true)}>
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
          const total = totalFor?.(s.id) ?? null
          return (
            <button key={s.id} className="estrow" onClick={() => onOpenScope(s.id)}>
              <span className="scopedot" style={{ background: s.color }} aria-hidden="true" />
              <span className="esttext">
                <span className="estname">{s.label}</span>
                <span className="wsmuted">
                  {PRODUCT_TYPE_LABEL[product]}
                  {` · ${n} markup${n === 1 ? '' : 's'}`}
                  {missing.length > 0 && <span className="wswarnink">{` · needs ${missing.join(', ')}`}</span>}
                </span>
              </span>
              {/* One total per scope, and nothing else — what a scope is made of belongs to the scope. */}
              {total !== null && <span className="esttotal">{total}</span>}
              <Glyph icon={ChevronRight} role="inline" />
            </button>
          )
        })}

        {archived.length > 0 && onRestoreScope !== undefined && (
          <div className="archivedfold">
            <button className="hlink" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>
              <Glyph icon={Archive} role="small" />
              {archived.length} archived
            </button>
            {showArchived && archived.map((s) => (
              <div key={s.id} className="estrow archivedrow">
                <span className="scopedot" style={{ background: s.color }} aria-hidden="true" />
                <span className="esttext">
                  <span className="estname">{s.label}</span>
                  <span className="wsmuted">{PRODUCT_TYPE_LABEL[readProductType(s.specifications)]}</span>
                </span>
                <button
                  className="paneact"
                  title={`Restore ${s.label} to this estimate`}
                  aria-label={`Restore ${s.label}`}
                  onClick={() => onRestoreScope(s.id)}
                ><Glyph icon={RotateCcw} role="row" /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="wssection">
        <h3><span className="grow">Pinned</span><span className="hcount">{files.length}</span></h3>
        {files.length === 0 && (
          <div className="wsmuted">
            No drawings yet. A document appears here once it carries a markup for
            one of this estimate&rsquo;s scopes.
          </div>
        )}
        {files.map((f) => (
          <button key={f.documentId} className="markuprow" onClick={() => onOpenDocument(f.documentId)}>
            <Glyph icon={FileText} role="small" />
            <span className="mkind">{f.relativePath.split('/').pop() ?? f.relativePath}</span>
            <span className="mvalue">{f.markupCount}</span>
          </button>
        ))}
      </section>
    </>
  )
}

// ------------------------------------------------------ level 3: the scope --

const MARKUP_ICON: Record<string, typeof Pentagon> = {
  area: Pentagon,
  cutout: Pentagon,
  polyline: Ruler,
  count: Tally,
}

/** " on 3 Sep", or nothing at all when the row never got a timestamp. */
function when(at: string | null): string {
  if (at === null) return ''
  const d = new Date(at)
  return Number.isNaN(d.getTime())
    ? ''
    : ` on ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
}

function ScopeDetail(p: EstimatesPanelProps & { estimate: EstimateListItem; scope: Scope }) {
  const {
    estimate, scope, rows, pieces, markups, sheetLabel, onGoToPage, onSaveScope, onTakeOff, onCommit,
    onDuplicateScope, onRemoveScope,
  } = p
  const [ownPage, setOwnPage] = useState<ScopePage>('parts')
  const page = p.scopePage ?? ownPage
  const setPage = (next: ScopePage) => { setOwnPage(next); p.onScopePage?.(next) }
  const [group, setGroup] = useState<'page' | 'type'>('page')
  const product = readProductType(scope.specifications)
  const missing = missingRequiredMeasures(product, scope.specifications)
  /*
   * Every specification edit goes through `deriveRunTriple`: plank width,
   * reveal and on-centre spacing are three views of one geometry, so entering
   * two of them has already stated the third. It fills only an empty field.
   */
  const patch = (specs: Specifications) =>
    onSaveScope({ ...scope, specifications: deriveRunTriple(specs) })

  /* The parts' confidence, per line, from the same roll-up the bill uses. */
  const lines = useMemo(
    () => (pieces === undefined ? [] : buildBom([{ scope, result: pieces }]).lines),
    [scope, pieces],
  )
  const confidenceOf = (itemKey: string) => lines.find((l) => l.itemKey === itemKey)?.confidence ?? 'verified'
  const blocked = pieces !== undefined && pieces.blockers.length > 0 && markups.length > 0
  const nothingDrawn = rows.length === 0 && markups.length === 0
  const excluded = markups.filter((m) => m.layoutNote !== undefined).length

  /*
   * One status line under the number: what is committed and what moved, or
   * what is missing and where to fix it. The pane used to carry these as
   * three separate warnings below the fold.
   */
  const status = (() => {
    if (nothingDrawn) {
      return { tone: 'note', text: 'Nothing measured yet. Press Take off, then draw on the sheet.', action: null as null | { label: string, run: () => void } }
    }
    if (missing.length > 0) {
      return { tone: 'caution', text: `Parts need ${missing.join(' and ')}.`, action: { label: 'Set it in Setup', run: () => setPage('setup') } }
    }
    if (blocked) {
      return { tone: 'caution', text: pieces.blockers.join('; '), action: p.onSetDirection === undefined ? null : { label: 'Set direction', run: p.onSetDirection } }
    }
    if (p.commit === undefined) {
      return { tone: 'note', text: 'Not committed.', action: { label: 'Commit', run: () => onCommit(scope.id) } }
    }
    if (p.commit.delta.length === 0) {
      return { tone: 'good', text: `Committed${when(p.commit.at)} · unchanged`, action: { label: 'Commit again', run: () => onCommit(scope.id) } }
    }
    return { tone: 'caution', text: `Committed${when(p.commit.at)} · ${p.commit.delta.length} changed`, action: { label: 'Commit again', run: () => onCommit(scope.id) } }
  })()
  const StatusIcon = status.tone === 'good' ? Check : status.tone === 'caution' ? TriangleAlert : Info

  const first = rows[0]
  const second = rows[1]

  return (
    <>
      {/* The one place a scope colour tints a surface: a leading bar and a
          7% wash, the same grammar as every other selected thing. */}
      <div
        className="scopecard"
        style={{
          boxShadow: `inset 2px 0 0 ${scope.color}`,
          background: `color-mix(in srgb, ${scope.color} 7%, transparent)`,
        }}
      >
        <span className="scopedot" style={{ background: scope.color }} aria-hidden="true" />
        <span className="grow">
          <span className="estname">{scope.label}</span>
          <span className="scopemeta">
            {PRODUCT_TYPE_LABEL[product]} · {markups.length} markup{markups.length === 1 ? '' : 's'}
          </span>
        </span>
        <button className="takeoffbtn" onClick={() => onTakeOff(scope.id)}>
          <Glyph icon={Crosshair} role="row" /> Take off
        </button>
      </div>

      {/* The number is the header. It does not scroll away when a page does. */}
      <div className="scopehero">
        <div>
          <div className={first === undefined ? 'herov unset' : 'herov'}>
            {first === undefined ? '—' : <>{fmt(first.quantity)}<small>{first.unit}</small></>}
          </div>
          <div className="herol">{first === undefined ? 'No measurement' : first.label}</div>
        </div>
        <div>
          {second !== undefined && (
            <>
              <div className="herov">{fmt(second.quantity)}<small>{second.unit}</small></div>
              <div className="herol">{second.label}</div>
            </>
          )}
        </div>
        <div className={`herostatus ${status.tone}`} role="status">
          <Glyph icon={StatusIcon} role="row" />
          <span className="grow">{status.text}</span>
          {status.action !== null && (
            <button className="hlink" onClick={status.action.run}>{status.action.label}</button>
          )}
        </div>
      </div>

      <nav className="selbar" role="tablist" aria-label="Scope pages">
        <button className="selitem" role="tab" aria-selected={page === 'parts'} onClick={() => setPage('parts')}>
          Parts{pieces !== undefined && pieces.quantities.length > 0 && <span className="selcount">{pieces.quantities.length}</span>}
        </button>
        <button className="selitem" role="tab" aria-selected={page === 'setup'} onClick={() => setPage('setup')}>
          Setup{missing.length > 0 && <span className="selcount wswarnink">{missing.length}</span>}
        </button>
        <button className="selitem" role="tab" aria-selected={page === 'markups'} onClick={() => setPage('markups')}>
          Markups<span className="selcount">{markups.length}</span>
        </button>
      </nav>

      {page === 'parts' && (
        <PartsPage
          pieces={pieces}
          missing={missing}
          nothingDrawn={nothingDrawn}
          confidenceOf={confidenceOf}
          commit={p.commit}
          layoutOn={p.layoutOn}
          onToggleLayout={p.onToggleLayout}
          onSetup={() => setPage('setup')}
        />
      )}

      {page === 'setup' && (
        <SetupPage
          scope={scope}
          product={product}
          missing={missing}
          patch={patch}
          onSaveScope={onSaveScope}
          {...(p.direction !== undefined ? { direction: p.direction } : {})}
          {...(p.onSetDirection !== undefined ? { onSetDirection: p.onSetDirection } : {})}
        />
      )}

      {page === 'markups' && (
        <section className="wssection">
          <div className="dirrow">
            <span className="kvlabel">Group by</span>
            <span className="grow"></span>
            <span className="seg" role="group" aria-label="Group markups by">
              <button className={`segbtn${group === 'page' ? ' active' : ''}`} aria-pressed={group === 'page'} title="Group by sheet" onClick={() => setGroup('page')}>
                <Glyph icon={FileText} role="small" /> sheet
              </button>
              <button className={`segbtn${group === 'type' ? ' active' : ''}`} aria-pressed={group === 'type'} title="Group by kind" onClick={() => setGroup('type')}>
                <Glyph icon={Pentagon} role="small" /> kind
              </button>
            </span>
          </div>
          {markups.length === 0 && (
            <div className="wsmuted">None yet — each shape you draw is listed here, by sheet.</div>
          )}
          {excluded > 0 && (
            <div className="wsmuted">{excluded} of {markups.length} contribute nothing to the layout; each says why.</div>
          )}
          {groupMarkups(markups, group, sheetLabel).map(([heading, list]) => (
            <div key={heading}>
              <div className="mgrouphead">
                <span className="scopedot" style={{ background: scope.color }} aria-hidden="true" />
                <span className="grow">{heading}</span>
                <span>{list.length}</span>
              </div>
              {list.map((m) => (
                <button
                  key={m.id}
                  className={m.layoutNote === undefined ? 'markuprow' : 'markuprow excluded'}
                  onClick={() => onGoToPage(m.page)}
                  {...(m.layoutNote !== undefined ? { title: `Not in the layout: ${m.layoutNote}` } : {})}
                >
                  <Glyph icon={MARKUP_ICON[m.kind] ?? Pentagon} role="small" />
                  <span className="mkind">
                    {m.kind}
                    <span className="wsmuted"> {group === 'page' ? '' : sheetLabel(m.page)}</span>
                    {m.layoutNote !== undefined && <span className="mnote">{m.layoutNote}</span>}
                  </span>
                  <span className="mvalue">{m.measure}</span>
                </button>
              ))}
            </div>
          ))}
        </section>
      )}

      {/* What can be done TO the scope, last. Duplicate copies the specification
          and not the takeoff; remove archives rather than destroys. */}
      {(onDuplicateScope !== undefined || onRemoveScope !== undefined) && (
        <div className="scopefoot">
          {onDuplicateScope !== undefined && (
            <button className="hlink" title="A copy with the same specification and none of the takeoff" onClick={() => onDuplicateScope(scope.id)}>
              <Glyph icon={Copy} role="small" /> Duplicate
            </button>
          )}
          <span className="grow" />
          {onRemoveScope !== undefined && (
            <button
              className="hlink danger"
              title={markups.length > 0
                ? `Archives it. Its ${markups.length} markup${markups.length === 1 ? '' : 's'} stay and come back if you restore it.`
                : 'Archives it. Restore it from the round’s archived list.'}
              onClick={() => onRemoveScope(estimate.id, scope.id)}
            >
              <Glyph icon={Trash2} role="small" /> Remove from estimate
            </button>
          )}
        </div>
      )}
    </>
  )
}

/** Parts: what to order, with each line's confidence, what moved since the commit, and the layout switch. */
function PartsPage({
  pieces, missing, nothingDrawn, confidenceOf, commit, layoutOn, onToggleLayout, onSetup,
}: {
  pieces: PieceResult | undefined
  missing: string[]
  nothingDrawn: boolean
  confidenceOf: (itemKey: string) => 'verified' | 'unverified' | 'blocked'
  commit: EstimatesPanelProps['commit']
  layoutOn: boolean
  onToggleLayout: (on: boolean) => void
  onSetup: () => void
}) {
  const hasParts = pieces !== undefined && pieces.quantities.length > 0
  const drawable = pieces !== undefined && (pieces.runs.length > 0 || pieces.cells.length > 0)
  return (
    <section className="wssection">
      {nothingDrawn && (
        <div className="wsmuted">
          Nothing to order yet. Press Take off, then draw on the sheet — areas
          for a ceiling, a line for a run, a tap per fixture — and the parts
          arrive here.
        </div>
      )}
      {!nothingDrawn && missing.length > 0 && (
        <div className="wswarn partsblocked" role="status">
          <Glyph icon={TriangleAlert} role="row" />
          <span className="grow">Set {missing.join(' and ')} before this scope can be counted. Nothing is estimated in its place.</span>
          <button className="link" onClick={onSetup}>Set it</button>
        </div>
      )}
      {!nothingDrawn && missing.length === 0 && pieces !== undefined && pieces.blockers.length > 0 && (
        <div className="wswarn partsblocked" role="status">
          <Glyph icon={TriangleAlert} role="row" />
          <span className="grow">{pieces.blockers.join('; ')}</span>
        </div>
      )}
      {hasParts && (
        <div className="partstable">
          <div className="partshead">
            <span>Part</span>
            <span className="num">Qty</span>
            <span>Unit</span>
          </div>
          {pieces.quantities.map((q) => {
            const conf = confidenceOf(q.itemKey)
            return (
              <div className={`partsrow${conf === 'blocked' ? ' pending' : ''}`} key={q.itemKey}>
                <span>
                  {pieceLabel(q)}
                  {/* Confidence beside the label, in words: a colour alone is a column nobody can read the legend for. */}
                  {conf !== 'verified' && <span className={`bomconf ${conf}`}> {conf}</span>}
                </span>
                <span className="num">{conf === 'blocked' ? '—' : fmt(q.quantity)}</span>
                <span className="partsunit">{q.unit}</span>
              </div>
            )
          })}
        </div>
      )}
      {commit !== undefined && commit.delta.length > 0 && (
        <div className="partsdelta">
          <span>Since the commit</span>
          <span className="grow">
            {commit.delta.map((d) => `${d.label} ${d.committed === null ? '—' : fmt(d.committed)} → ${d.live === null ? '—' : fmt(d.live)}`).join(' · ')}
          </span>
        </div>
      )}
      {pieces !== undefined && (
        <label className={`swrow${drawable ? '' : ' off'}`}>
          <span className="grow">Show the layout on the sheet</span>
          <button
            type="button"
            role="switch"
            className={`swtoggle${layoutOn ? ' on' : ''}`}
            aria-checked={layoutOn}
            aria-label="Show the layout on the sheet"
            disabled={!drawable}
            onClick={() => onToggleLayout(!layoutOn)}
          ><span /></button>
        </label>
      )}
    </section>
  )
}

/** Setup: the specification, once. Product and Counts, the measures two per line, Yield and Seams, Direction, then Name and Colour. */
function SetupPage({
  scope, product, missing, patch, onSaveScope, direction = null, onSetDirection,
}: {
  scope: Scope
  product: ProductType
  missing: string[]
  patch: (specs: Specifications) => void
  onSaveScope: (scope: Scope) => void
  direction?: string | null
  onSetDirection?: () => void
}) {
  return (
    <section className="wssection">
      <div className="setupgrid">
        <label className="speccell">
          <span>Product</span>
          <span className="specpair">
            <select
              id="scope-type"
              className="kvcontrol grow"
              value={product}
              onChange={(e) => patch(writeProductType(scope.specifications, e.target.value as ProductType))}
            >
              {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{PRODUCT_TYPE_LABEL[t]}</option>)}
            </select>
          </span>
        </label>
        {/* What the scope COUNTS — areas, lengths or tallies. */}
        <label className="speccell">
          <span>Counts</span>
          <span className="specpair">
            <select
              id="scope-counts"
              className="kvcontrol grow"
              value={scope.scopeType}
              onChange={(e) => onSaveScope({ ...scope, scopeType: e.target.value as ScopeType })}
            >
              {SCOPE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </span>
        </label>
      </div>

      {/* Measures run TWO PER LINE; a plank scope has seven of them. */}
      <div className="specgrid">
        {editableMeasures(product).map((f) => (
          <MeasureRow
            key={f.valueKey}
            label={f.label}
            valueKey={f.valueKey}
            required={missing.includes(f.label)}
            value={readString(scope.specifications, f.valueKey) ?? ''}
            unit={unitDisplayText(readString(scope.specifications, f.unitKey) ?? '')}
            onCommit={(value, unit) =>
              patch({ ...scope.specifications, [f.valueKey]: value, [f.unitKey]: unit })}
          />
        ))}
      </div>

      {/* Granularity and seam alignment are MEASURES of a kind: both change the number. */}
      {product !== 'custom_assembly' && (
        <div className="specgrid">
          <label className="speccell">
            <span>Yield</span>
            <span className="specpair">
              <select
                className="kvcontrol"
                value={readGranularity(scope.specifications, granularityKey(product))}
                onChange={(e) => patch({ ...scope.specifications, [granularityKey(product)]: e.target.value })}
              >
                {GRANULARITIES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </span>
          </label>
          <label className="speccell">
            <span>Seams</span>
            <span className="specpair">
              <select
                className="kvcontrol"
                value={readBool(scope.specifications, 'alignSeams') ? 'aligned' : 'free'}
                onChange={(e) => patch({ ...scope.specifications, alignSeams: String(e.target.value === 'aligned') })}
              >
                <option value="aligned">aligned</option>
                <option value="free">free</option>
              </select>
            </span>
          </label>
        </div>
      )}

      {product === 'planks' && (
        <div className="specnote">
          <Glyph icon={Info} role="small" />
          <span>
            Width, reveal and spacing are one geometry —
            {' '}<span className="mono">spacing = width + reveal</span>. Enter any two
            and the third fills itself, while it is still empty.
          </span>
        </div>
      )}
      {editableMeasures(product).length === 0 && (
        <div className="wsmuted">
          A custom assembly is quantified by hand — there are no dimensions to set.
        </div>
      )}

      {/* Direction: the value, and the one action that sets it. */}
      {product !== 'custom_assembly' && (
        <div className="dirrow">
          <span className="kvlabel">Direction</span>
          <span className={direction === null ? 'grow unset' : 'grow'}>{direction ?? 'not set'}</span>
          {onSetDirection !== undefined && (
            <button className="ghostbtn small" onClick={onSetDirection}>
              <Glyph icon={Compass} role="small" /> Set on the sheet
            </button>
          )}
        </div>
      )}

      {/* Name and colour last: the things changed least, lowest. */}
      <div className="specfield wide">
        <label htmlFor="scope-name">Name</label>
        <span className="specpair">
          <NameField id="scope-name" value={scope.label} onCommit={(label) => onSaveScope({ ...scope, label })} />
          <input
            className="defswatch"
            type="color"
            value={scope.color}
            aria-label="Scope colour"
            title="Scope colour — shown on this scope’s markups"
            onChange={(e) => onSaveScope({ ...scope, color: e.target.value })}
          />
        </span>
      </div>
    </section>
  )
}

/**
 * The scope's name, committed on blur or Enter — a keystroke-per-write name
 * would rename the scope in the dock, the index dots and the undo log seven
 * times for one edit.
 */
function NameField({ id, value, onCommit }: { id: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const commit = () => {
    const next = draft.trim()
    // An empty name is not a rename; the field springs back to what it was.
    if (next === '') { setDraft(value); return }
    if (next !== value) onCommit(next)
  }
  return (
    <input
      id={id}
      className="kvcontrol grow"
      value={draft}
      aria-label="Scope name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() }
        if (e.key === 'Escape') setDraft(value)
      }}
    />
  )
}

// ---------------------------------------------------------------- fields --

/**
 * A value+unit pair, committed on blur or Enter rather than per keystroke.
 * Per-keystroke would write `4`, `4.`, `4.5` to the database and put three
 * entries in the undo log for one edit.
 */
function MeasureRow({
  label, valueKey, required, value, unit, onCommit,
}: {
  label: string
  valueKey: string
  required: boolean
  value: string
  unit: string
  onCommit: (value: string, unit: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const commit = () => { if (draft !== value) onCommit(draft.trim(), unit) }
  const help = measureHelp(valueKey)

  return (
    <div className={required ? 'speccell needed' : 'speccell'}>
      <label>
        {label}
        {/* The caption, and the required mark, on the LABEL: the thing to fix
            and the sentence about it are one object. */}
        {required
          ? <span className="req"> · required</span>
          : help !== '' && <span className="spechelp"> · {help}</span>}
      </label>
      <span className="specpair">
        <input
          className="kvcontrol"
          value={draft}
          inputMode="decimal"
          placeholder="—"
          aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() }
            if (e.key === 'Escape') setDraft(value)
          }}
        />
        <select
          className="kvcontrol"
          aria-label={`${label} unit`}
          value={unit}
          onChange={(e) => onCommit(draft.trim(), e.target.value)}
        >
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </span>
    </div>
  )
}

function groupMarkups(
  markups: ScopeMarkup[],
  by: 'page' | 'type',
  sheetLabel: (page: number) => string,
): Array<[string, ScopeMarkup[]]> {
  const out = new Map<string, ScopeMarkup[]>()
  for (const m of markups) {
    const key = by === 'page' ? `Page ${m.page + 1} · ${sheetLabel(m.page)}` : m.kind
    const list = out.get(key) ?? []
    list.push(m)
    out.set(key, list)
  }
  // Page order for pages; count-descending for kinds.
  const entries = [...out.entries()]
  return by === 'page'
    ? entries.sort((a, b) => (a[1][0]?.page ?? 0) - (b[1][0]?.page ?? 0))
    : entries.sort((a, b) => b[1].length - a[1].length)
}
