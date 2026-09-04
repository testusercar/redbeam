/**
 * The right sidebar: Estimates, and only Estimates.
 *
 * Built to `redbeam-sidebar-system-v3.pen` — the Estimate List and Estimate
 * Detail frames. Three levels, breadcrumbed, with a Back at each step:
 *
 *   Estimates  ›  260729 - Negotiations  ›  Metal Mesh Ceiling
 *
 * Chat, Artifacts and Activity were the July specification and are gone. An
 * estimate is a bidding round that owns its scopes (REDBEAM_ESTIMATES_MODEL,
 * adopted 2026-08-02), so the round is the thing you navigate through to reach
 * a scope — not a peer tab beside it.
 *
 * Scope colour appears in exactly three places here, per the comps' own rule:
 * the 8px identifier dot, the tint on the ONE active scope's header card, and
 * the Take off button that starts work in it. Never as text, never as a fill
 * on a section.
 */
import { useEffect, useMemo, useState } from 'react'
import type {
  PieceResult, ProductType, QuantityResult, Scope, ScopeType, Specifications,
} from '@redbeam/domain'
import type { QuantityDelta } from '../commit.js'
import {
  PRODUCT_TYPES, PRODUCT_TYPE_LABEL, editableMeasures, measureHelp, missingRequiredMeasures,
  readProductType, readString, unitDisplayText, writeProductType,
  deriveRunTriple,
  granularityKey, readGranularity, readBool, GRANULARITIES,
} from '@redbeam/domain'
import {
  Calculator, ChevronRight, Crosshair, FileText, Glyph, ListChecks,
  Plus, Ruler, SlidersHorizontal, Pentagon, Tally, TriangleAlert,
  LayoutGrid, Copy, Trash2, RotateCcw, Archive, Info,
} from './icons.js'
import { BomView, type BomViewProps } from '../bom/BomView.js'
import { bomSummary, entriesForRound } from '../bom/bomRows.js'

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
 * stock" on a baffle. This panel used to ignore `label` and re-derive a name
 * from the key, which turned both of those into "Primary stock" — a schema
 * word, and the same word for two different materials.
 *
 * So the line's own label wins. The map is only a fallback for a line that
 * arrives without one.
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

  /** Scopes belonging to the open estimate. */
  scopes: Scope[]
  /**
   * Whether the open estimate's scope ids have been read yet. "No scopes" and
   * "not asked yet" are both an empty list, and they mean opposite things:
   * one is the onboarding screen, the other is a flash of it in front of a
   * full round. Absent means loaded — the harness has no database.
   */
  scopesLoaded?: boolean
  markupCountFor: (scopeId: string) => number
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
   * everything past the name is set on the scope's own page, which saves as
   * you type. On the desktop this is the first action a new project asks
   * for: a project opens with no scopes at all, and the panel that lists them
   * is where someone looks for the way to make one.
   */
  onCreateScope?: (label: string) => void
  /**
   * A request from OUTSIDE the panel to add a scope — the dock's scope menu,
   * the palette. A nonce rather than a flag: the naming row is this panel's
   * own state, and two identical requests in a row are still two requests.
   */
  addScopeRequest?: number
  /** Copy a scope's specification, not its takeoff, into the same round. */
  onDuplicateScope?: (scopeId: string) => void
  /**
   * Scopes taken out of a round, project-wide, and the way back in.
   *
   * Removing a scope archives it, and an archived scope with three hundred
   * markups on it is not something to lose behind a dialog nobody opens. They
   * are listed under the round's scopes, folded, restorable into it.
   */
  archived?: Scope[]
  onRestoreScope?: (scopeId: string) => void
  /**
   * The bill of materials, one level under the round.
   *
   * `bom.entries` is every scope's pieces; the panel narrows it to the open
   * round, because the bill is what THIS bid orders. Absent in a harness with
   * nothing to bill.
   */
  bom?: Omit<BomViewProps, 'estimateName' | 'projectName'>
  bomOpen?: boolean
  onOpenBom?: (open: boolean) => void
  /**
   * Duplicate an estimate's scopes and specifications, not its takeoff.
   *
   * A bidding round IS a copy: the same scopes priced differently, an
   * alternate with one product swapped. The store could always do it and
   * nothing called it, so the only way to bid an alternate was to rebuild
   * every scope by hand.
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
  /** The layout preview, so the panel that reports a count can also show it. */
  layoutOn: boolean
  onToggleLayout: (on: boolean) => void
  /**
   * The committed answer for the open scope, and what has moved since.
   *
   * Absent when this scope has never been committed. `delta` empty means it
   * was committed and nothing has changed — which is worth saying in a line,
   * and is not the same as never having been committed at all.
   */
  commit?: { at: string | null, delta: QuantityDelta[] }
  onCommit: (scopeId: string) => void
  warnings: string[]
  /**
   * Why the active scope cannot produce a layout yet, and the one action that
   * fixes it.
   *
   * This used to live in the dock. It belongs here: the condition is a property
   * of the SCOPE, not of the moment you happen to be drawing in, and this is
   * the panel where a number gets read — so it is also where the reason that
   * number is missing has to be.
   */
  blocker?: { message: string; actionLabel: string; onResolve: () => void }
}

/**
 * A name for the copy that does not collide and does not need a dialog.
 *
 * "100% CD" becomes "100% CD copy", then "100% CD copy 2". Asking for a name
 * up front is a modal in the way of a one-click action, and an estimator
 * renaming it afterwards is one edit either way — but two rounds called the
 * same thing is a bid nobody can tell apart.
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

export function EstimatesPanel(p: EstimatesPanelProps) {
  const estimate = p.estimates.find((e) => e.id === p.openEstimateId) ?? null
  const scope = p.scopes.find((s) => s.id === p.openScopeId) ?? null
  /*
   * The bill is a level of its own, and it outranks the scope. Asking for
   * the bill from the dock while a scope is open should show the bill, not
   * the scope with a flag set that nothing draws — which is the exact shape
   * of the "this button does nothing" defect the dialogs had.
   */
  const bill = p.bomOpen === true && p.bom !== undefined
  const roundScopes = useMemo(() => new Set(p.scopes.map((s) => s.id)), [p.scopes])
  const billEntries = useMemo(
    () => (p.bom === undefined ? [] : entriesForRound(p.bom.entries, estimate === null ? null : roundScopes)),
    [p.bom, estimate, roundScopes],
  )
  const closeBill = () => p.onOpenBom?.(false)

  return (
    <aside className="workspace">
      <div className="wshead-bar">
        <span className="wstitle"><Glyph icon={Calculator} role="inline" /> Estimates</span>
      </div>


      {(estimate !== null || bill) && (
        <nav className="crumbs" aria-label="Breadcrumb">
          <button
            className="crumb"
            onClick={() => { closeBill(); p.onOpenScope(null); p.onOpenEstimate(null) }}
          >
            Estimates
          </button>
          <Glyph icon={ChevronRight} role="small" />
          {estimate !== null && (bill || scope !== null) && (
            <>
              <button className="crumb" onClick={() => { closeBill(); p.onOpenScope(null) }}>
                {estimate.name}
              </button>
              <Glyph icon={ChevronRight} role="small" />
            </>
          )}
          {estimate !== null && !bill && scope === null && (
            <span className="crumb current">{estimate.name}</span>
          )}
          {bill && <span className="crumb current">Bill of materials</span>}
          {!bill && scope !== null && <span className="crumb current">{scope.label}</span>}
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
        {/*
          Warnings stack, so they get a stack's discipline.
          Three of them ate ninety pixels off the top of a 700px panel and
          shouted in amber while the thing they were about sat below the fold.
          The first is shown; the rest are counted, and expand on ask.
        */}
        {p.warnings.length > 0 && <WarningStack warnings={p.warnings} />}

        {bill && p.bom !== undefined && (
          <BomView
            {...p.bom}
            entries={billEntries}
            projectName={p.projectName}
            estimateName={estimate?.name ?? p.projectName}
          />
        )}
        {!bill && estimate === null && <EstimateList {...p} />}
        {!bill && estimate !== null && scope === null && (
          <EstimateOverview {...p} estimate={estimate} billEntries={billEntries} />
        )}
        {!bill && estimate !== null && scope !== null && (
          <ScopeDetail {...p} estimate={estimate} scope={scope} />
        )}
      </div>
    </aside>
  )
}

/**
 * The first warning, plus a count of the rest.
 *
 * Every one of these is worth saying and none of them is worth ninety pixels
 * of a panel whose job is to show a number. They are ordered by the caller,
 * so the first is the one that matters most.
 */
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
  onDeleteEstimate,
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
        THE FIRST THING A NEW PROJECT SHOWS.

        A project opens with no estimates and no scopes — nothing is seeded —
        so this is not a placeholder for a state nobody reaches; it is the
        first screen of every real bid. It says what the thing is, what it is
        for, and carries the one action that moves on from here, because at
        this moment the person has a drawing set open and nowhere to draw.
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
        /*
          A row, and one thing you can do to it without opening it.

          `div` rather than a nested button: a control inside a button is not
          valid markup and behaves differently in every browser, and this is
          the second action on the same row rather than a second row.
        */
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
          {/*
            Named for what it produces, not for the mechanism: an estimator
            duplicating a round is bidding an alternate, and the copy carries
            the scopes and their specifications but none of the takeoff.
          */}
          <button
            className="paneact"
            title={`Duplicate ${e.name} — its scopes and specifications, not its markups`}
            aria-label={`Duplicate ${e.name}`}
            onClick={() => onDuplicateEstimate(e.id, nextRoundName(e.name, estimates))}
          ><Glyph icon={Copy} role="row" /></button>
          {/*
            No confirmation dialog. The store refuses outright while the round
            holds the only copy of any takeoff, and says why — which is a
            better guard than a prompt people learn to click through, and the
            only case where a delete could cost anything.
          */}
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
  estimate, scopes, scopesLoaded = true, markupCountFor, files, onOpenScope, onOpenDocument,
  onCreateScope, addScopeRequest = 0, archived = [], onRestoreScope,
  bom, onOpenBom, billEntries,
}: EstimatesPanelProps & { estimate: EstimateListItem; billEntries: BomViewProps['entries'] }) {
  const [naming, setNaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const canAdd = onCreateScope !== undefined

  /*
   * A request from the dock or the palette opens the naming row here. The
   * first request is nonce 1, so mounting with a stale nonce must not open
   * the row on its own — only a CHANGE is a request.
   */
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

  const summary = bom === undefined ? null : bomSummary(billEntries)

  return (
    <>
      <div className="wshead"><h2>{estimate.name}</h2></div>

      {/*
        Scopes first, pinned drawings second. The scopes are what this level
        drills INTO and the one thing you can add here; the pinned list is
        derived from markups and cannot be acted on. It sat above the scopes,
        so on a new estimate the first section anyone read was an empty one
        explaining that it would fill in later.
      */}
      <section className="wssection">
        <h3>
          <span className="grow">Scopes</span>
          {scopes.length > 0 && canAdd && !naming && (
            <button
              className="paneact"
              title="Add a scope to this estimate"
              aria-label="Add a scope"
              onClick={() => setNaming(true)}
            ><Glyph icon={Plus} role="row" /></button>
          )}
          <span>{scopes.length}</span>
        </h3>

        {/*
          NAMED HERE, NOT IN A DIALOG.

          Pressing "Add scope" opened a window over the drawing with a shelf,
          a form and its own idea of which scope was selected — a second
          editor for the same fields the scope's page already edits. The one
          thing that has to be decided before a scope exists is its name, and
          the round was named in exactly this row one level up. Enter makes
          the scope and opens it; the rest is set on the page it opens to.
        */}
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

        {/*
          A new project has NO scopes — nothing is seeded — so this is what an
          estimator sees with a drawing set open and nothing to draw into. It
          has to say what a scope is and how one gets made, because the word
          means a contract clause to most of the trade and something narrower
          here.
        */}
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
          return (
            <button key={s.id} className="estrow" onClick={() => onOpenScope(s.id)}>
              <span className="scopedot" style={{ background: s.color }} aria-hidden="true" />
              <span className="esttext">
                <span className="estname">{s.label}</span>
                <span className="wsmuted">
                  {PRODUCT_TYPE_LABEL[readProductType(s.specifications)]}
                  {` · ${n} markup${n === 1 ? '' : 's'}`}
                </span>
              </span>
              <Glyph icon={ChevronRight} role="inline" />
            </button>
          )
        })}

        {/*
          Folded, because a round with three live scopes and eleven archived
          ones is a list of live scopes. Restoring puts the scope back in THIS
          round, with every markup it ever carried.
        */}
        {archived.length > 0 && onRestoreScope !== undefined && (
          <div className="archivedfold">
            <button
              className="hlink"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((v) => !v)}
            >
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

      {/*
        The bill is a level under the round, the way a scope is — not a
        window over the drawing it has to be checked against. This row says
        how much of it can be trusted before it is opened.
      */}
      {/*
        The bill is an ACTION here, not a card in the scope list.
        Aaron: "The build material should not show on the estimate tab. It
        should show in the scope detail tab." A scope's parts do — the parts
        table under its Total quantity. What survives at this level is the way
        OUT to the round's order document, which is a thing you go to rather
        than a third thing to read beside the scopes, so it sits under a rule
        at the foot of the panel instead of wearing a card.
      */}
      {summary !== null && onOpenBom !== undefined && (
        <button className="billlink" onClick={() => onOpenBom(true)}>
          <Glyph icon={Calculator} role="row" />
          <span className="grow">Bill of materials</span>
          <span className="wsmuted">
            {summary.lines === 0
              ? 'nothing to order yet'
              : `${summary.lines} line${summary.lines === 1 ? '' : 's'}`
                + (summary.attention > 0 ? ` · ${summary.attention} need attention` : '')}
          </span>
          <Glyph icon={ChevronRight} role="small" />
        </button>
      )}

      <section className="wssection">
        <h3><span className="grow">Pinned</span><span>{files.length}</span></h3>
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

/**
 * A scope, read top to bottom: what it IS, the number that produces, the
 * evidence the number came from.
 *
 * The order used to be quantities, markups, definition — the derived value
 * first and the inputs that decide it last, below the fold on a short panel.
 * That is backwards for the job. An estimator changes a spacing or a waste
 * factor and wants to watch the count move; with the spec at the bottom the two
 * were never on screen together, and the edit was a round trip through a modal.
 *
 * So: specification first and always editable — no Edit button, no dialog, no
 * mode. Then the total it produces, directly underneath, so a change and its
 * consequence are one glance apart. Then the markups, which are the audit trail
 * and are read when something looks wrong, not while it is being set up.
 */
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
  const [group, setGroup] = useState<'page' | 'type'>('page')
  const product = readProductType(scope.specifications)
  const missing = missingRequiredMeasures(product, scope.specifications)
  /*
   * Every specification edit goes through `deriveRunTriple`.
   *
   * Plank width, reveal and on-centre spacing are three views of one geometry
   * (spacing = width + reveal), so entering two of them has already stated the
   * third. It fills only an empty field — a value already typed is a
   * statement, and quietly rewriting it would be a worse failure than leaving
   * an inconsistency visible.
   */
  const patch = (specs: Specifications) =>
    onSaveScope({ ...scope, specifications: deriveRunTriple(specs) })

  return (
    <>
      {/*
        The one place a scope colour is allowed to tint a surface. It marks the
        scope you are about to draw into, which is the only scope whose colour
        is load-bearing at this moment.

        The colour is a leading bar and a dot — the same grammar as every other
        selected thing in the shell — not an outline, not the meta text, and not
        the button. It was all three, and a scope-coloured fill on the primary
        action made a third rule for "the thing to press": red is navigation,
        white is action, and scope colour is data. A button in the data colour
        belongs to none of them, and on a pale scope it failed contrast outright.
      */}
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

      <section className="wssection">
        <h3>
          <Glyph icon={SlidersHorizontal} role="row" />
          <span className="grow">Specification</span>
          <span className="hcount">saves as you type</span>
        </h3>

        {/*
          The name is edited where everything else about the scope is. It was
          the one field left to the scope dialog, so renaming C-MT-01 to
          C-MT-01A meant leaving the page that shows C-MT-01.
        */}
        <div className="specfield wide">
          <label htmlFor="scope-name">Name</label>
          <span className="specpair">
            <NameField
              id="scope-name"
              value={scope.label}
              onCommit={(label) => onSaveScope({ ...scope, label })}
            />
          </span>
        </div>

        {/*
          Type and colour share a line, and the colour is a swatch rather than a
          row of its own. A whole 28px row spent on one 16px square, captioned
          "shown on this scope's markups", said something the dot in the header
          two lines above already says.
        */}
        <div className="specfield wide">
          <label htmlFor="scope-type">Type</label>
          <span className="specpair">
            <select
              id="scope-type"
              className="kvcontrol grow"
              value={product}
              onChange={(e) => patch(writeProductType(scope.specifications, e.target.value as ProductType))}
            >
              {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{PRODUCT_TYPE_LABEL[t]}</option>)}
            </select>
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

        {/*
          What the scope COUNTS — areas, lengths or tallies. The domain warns
          when a markup of the wrong kind lands in a scope ("a linear scope
          counts only polylines"), and this is the only place the kind it
          wants can be changed; it lived in the scope dialog alone.
        */}
        <div className="specfield wide">
          <label htmlFor="scope-counts">Counts</label>
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
        </div>

        {/*
          Measures run TWO PER LINE.
          A plank scope has seven of them; one per row is a column of mostly
          empty space and a spec you have to scroll to finish reading. They are
          short, uniform controls — two fit at 380px with room, and the pairing
          is positional so it does not need a heading.
        */}
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

        {/*
          Granularity and seam alignment are MEASURES of a kind: both change
          the number. Granularity decides whether a part piece is counted as a
          half or a quarter, and seam alignment changes which origin the layout
          search settles on. They lived only in the scope-management dialog,
          which is not where a specification is read or edited — so the two
          inputs that most change a count were the two hardest to reach.
        */}
        {product !== 'custom_assembly' && (
          <div className="specgrid">
            <label className="speccell">
              <span>Yield</span>
              <span className="specpair">
                <select
                  className="kvcontrol"
                  value={readGranularity(scope.specifications, granularityKey(product))}
                  onChange={(e) => patch({
                    ...scope.specifications, [granularityKey(product)]: e.target.value,
                  })}
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
                  onChange={(e) => patch({
                    ...scope.specifications,
                    alignSeams: String(e.target.value === 'aligned'),
                  })}
                >
                  <option value="aligned">aligned</option>
                  <option value="free">free</option>
                </select>
              </span>
            </label>
          </div>
        )}

        {/*
          The triple, said out loud.
          `deriveRunTriple` fills the third of plank width / reveal / spacing
          from the other two — real behaviour, and alarming the first time a
          field you did not type into acquires a value.
        */}
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

        {missing.length > 0 && (
          <div className="wswarn">
            <Glyph icon={TriangleAlert} role="row" />
            <span>Set {missing.join(' and ')} before this scope can be counted.</span>
          </div>
        )}
      </section>

      <section className="wssection">
        <h3>
          <Glyph icon={Calculator} role="row" />
          <span className="grow">Total quantity</span>
          {/*
            The layout preview, where the number it explains is read.
            It was only in the dock, and the dock's tools exist only in takeoff
            mode — so anyone looking at a count and wondering whether to believe
            it had no way to turn on the picture that answers that. This is the
            moment the preview is FOR.
          */}
          {p.pieces !== undefined && (p.pieces.runs.length > 0 || p.pieces.cells.length > 0) && (
            <button
              className="hlink"
              aria-pressed={p.layoutOn}
              title={p.layoutOn ? 'Hide the layout on the drawing' : 'Show the layout on the drawing'}
              onClick={() => p.onToggleLayout(!p.layoutOn)}
            >
              <Glyph icon={LayoutGrid} role="small" />
              {p.layoutOn ? 'Hide layout' : 'Show layout'}
            </button>
          )}
        </h3>
        {rows.length === 0 && markups.length === 0 && (
          <div className="wsmuted">
            Nothing measured yet. Press Take off, then draw on the sheet —
            areas for a ceiling, a line for a run, a tap per fixture — and the
            quantity appears here.
          </div>
        )}
        {rows.map((r) => (
          <div className="kvrow" key={r.unit}>
            <span className="kvlabel">{r.label}</span>
            <span className="kvvalue num">{fmt(r.quantity)} {r.unit}</span>
          </div>
        ))}
        {/*
          The PARTS, as a table rather than more key-value rows.
          The roll-up above answers "how much of this is there"; these answer
          "what do I order", which is a different question with a quantity and
          a UNIT per line — so the unit gets a column of its own and the figures
          align on it. Run together as kv rows, an order list read as more of
          the same measurement.
        */}
        {pieces !== undefined && pieces.quantities.length > 0 && (
          <div className="partstable">
            <div className="partshead">
              <span>Part</span>
              <span className="num">Qty</span>
              <span>Unit</span>
            </div>
            {pieces.quantities.map((q) => (
              <div className="partsrow" key={q.itemKey}>
                <span>{pieceLabel(q)}</span>
                <span className="num">{fmt(q.quantity)}</span>
                <span className="partsunit">{q.unit}</span>
              </div>
            ))}
          </div>
        )}
        {/*
          A blocked scope says so where the number would be. A takeoff that
          cannot calculate must never look like one that calculated to zero.
        */}
        {/*
          A scope with nothing drawn is not missing a direction; it is missing
          a takeoff, and the line above already says so.

          WP-12 had no markups anywhere in the project and this told the
          estimator to "add a Scope Default Orientation" — true, and useless as
          the answer to why there is no number, because setting one would
          change nothing. The blocker is still computed, and it is still what
          the Qt build reports; it is simply not advice worth leading with for
          a scope nobody has started.
        */}
        {pieces !== undefined && pieces.blockers.length > 0 && markups.length > 0 && (
          <div className="wswarn">
            <Glyph icon={TriangleAlert} role="row" />
            <span>{pieces.blockers.join('; ')}</span>
          </div>
        )}

        {/*
          COMMITTING.

          Everything above is recomputed from the markups whenever anything
          changes, which is right for working and useless for bidding: change a
          specification and the number sent last week is simply gone. A commit
          is the answer at a moment with the evidence behind it — the spec, the
          calibration, the markups it read and every piece it placed — so that
          a later change reads as a delta instead of quietly replacing it.
        */}
        {pieces !== undefined && pieces.blockers.length === 0 && (
          <div className="commitrow">
            {p.commit === undefined
              ? <span className="wsmuted">Not committed.</span>
              : p.commit.delta.length === 0
                ? <span className="wsmuted">Committed{when(p.commit.at)} · unchanged</span>
                : <span className="wswarnink">
                    Committed{when(p.commit.at)} · {p.commit.delta.length} changed
                  </span>}
            <button className="hlink" onClick={() => onCommit(scope.id)}>
              {p.commit === undefined ? 'Commit' : 'Commit again'}
            </button>
          </div>
        )}

        {/*
          Only what MOVED. A list where nothing changed is one line, and forty
          identical rows would hide the one that is not.
        */}
        {p.commit !== undefined && p.commit.delta.map((d) => (
          <div className="kvrow delta" key={d.itemKey}>
            <span className="kvlabel">{d.label}</span>
            <span className="kvvalue num">
              {d.committed === null ? '—' : fmt(d.committed)}
              {' → '}
              {d.live === null ? '—' : fmt(d.live)} {d.unit}
            </span>
          </div>
        ))}
      </section>

      <section className="wssection">
        <h3>
          <Glyph icon={ListChecks} role="row" />
          <span className="grow">Markups</span>
          <span className="seg" role="group" aria-label="Group markups by">
            <button
              className={`segbtn${group === 'page' ? ' active' : ''}`}
              aria-pressed={group === 'page'}
              title="Group by page"
            onClick={() => setGroup('page')}
            ><Glyph icon={FileText} role="small" /></button>
            <button
              className={`segbtn${group === 'type' ? ' active' : ''}`}
              aria-pressed={group === 'type'}
              title="Group by type"
              onClick={() => setGroup('type')}
            ><Glyph icon={Pentagon} role="small" /></button>
          </span>
          <span className="hcount">{markups.length}</span>
        </h3>

        {markups.length === 0 && (
          <div className="wsmuted">None yet — each shape you draw is listed here, by sheet.</div>
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
                  {m.layoutNote !== undefined && (
                    <span className="mnote">{m.layoutNote}</span>
                  )}
                </span>
                <span className="mvalue">{m.measure}</span>
              </button>
            ))}
          </div>
        ))}
      </section>

      {/*
        What can be done TO the scope, last, after everything that is read
        from it. Duplicate copies the specification and not the takeoff;
        remove archives rather than destroys, and says so in its title, which
        is why neither needs a confirmation — the store keeps the markups and
        the round's archived list gives them back.
      */}
      {(onDuplicateScope !== undefined || onRemoveScope !== undefined) && (
        <div className="scopeactions">
          {onDuplicateScope !== undefined && (
            <button
              className="hlink"
              title="A copy with the same specification and none of the takeoff"
              onClick={() => onDuplicateScope(scope.id)}
            >
              <Glyph icon={Copy} role="small" /> Duplicate
            </button>
          )}
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

/**
 * The scope's name, committed on blur or Enter — a keystroke-per-write name
 * would rename the scope in the dock, the index dots and the undo log seven
 * times for one edit.
 */
function NameField({
  id, value, onCommit,
}: {
  id: string
  value: string
  onCommit: (value: string) => void
}) {
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
 *
 * Per-keystroke would write `4`, `4.`, `4.5` to the database and put three
 * entries in the undo log for one edit — and `4.` is not a number, so the scope
 * would flicker through a blocked state while somebody typed.
 *
 * There is no read-only rendering any more. A spec row is a control whether or
 * not you are about to change it: an estimator revises spacing and waste far
 * more often than they read them back, and the previous arrangement charged two
 * clicks and a mode for the common case to save a border on the rare one.
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
        {/*
          The caption, and the required mark, on the LABEL.
          "Set Stock before this scope can be counted" used to live in a warning
          below the fold, so the thing to fix and the sentence about it were
          different objects on different screens. Now the field says it.
        */}
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
  // Page order for pages; count-descending for kinds, since "which kind is
  // most of this scope" is the question that grouping by type is asking.
  const entries = [...out.entries()]
  return by === 'page'
    ? entries.sort((a, b) => (a[1][0]?.page ?? 0) - (b[1][0]?.page ?? 0))
    : entries.sort((a, b) => b[1].length - a[1].length)
}
