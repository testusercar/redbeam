import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Viewer, clampViewport, zoomAbout, type OverlaySet, type Viewport } from '@redbeam/viewer'
import PdfWorker from '@redbeam/viewer/worker?worker'
import {
  calibrationFromReference, calculateScopeQuantities, parseNumberOrFraction,
  scopeToolWarning, calculatePieces, scopeDefaultDirectionFrom,
  SCALE_PRESETS, PRODUCT_TYPES, PRODUCT_TYPE_LABEL, readProductType, writeProductType, missingRequiredMeasures,
  areaSquareFeet, linearFeet, feetPerPointForPreset, presetSource, scaleLabel,
  bucketByScale, conflictingRegions, type ScaleRegion,
  buildBom, bomToTsv,
  type MarkupKind, type PieceResult, type ScalePreset,
  type Calibration, type Markup, type Scope, type ScopeType, type QuantityResult,
  PAGE_DIRECTIONS_KEY, AREA_DIRECTIONS_KEY, pageDirectionsFrom, areaDirectionsFrom,
  pointInPolygon,
  editableMeasures, measureHelp, readString, unitDisplayText, readBool,
} from '@redbeam/domain'
import {
  ensureDocumentAndPage, getCalibration, listCalibrations, listMarkups, listScopes, listActivity,
  listEstimates, createEstimate as createEstimateRow, listEstimateScopeIds,
  estimateDocuments, addScopeToEstimate,
  upsertScope, setScopeArchived, type SqlDriver,
  pageIdFor, searchProjectText, indexPageText, textIndexCoverage,
  type DocumentRow, type SearchHit,
  UndoStack, createMarkup as cmdCreate, removeMarkup as cmdRemove,
  editGeometry as cmdEditGeometry, setCalibration as cmdCalibrate, batch as cmdBatch,
  reassignScope as cmdReassign,
  type UndoState,
  recordCalculation, freezeLayout, latestFrozenCalculation,
  listCalculationQuantities,
  type CalculationRun, type QuantityResultInput,
  listAllCalibrations, listPageBoxes, applyScaleToPages, listDocuments,
  listAllScaleRegions, saveScaleRegion, deleteScaleRegion,
  copyEstimate,
  renameEstimate, deleteEstimate, removeScopeFromEstimate,
} from '@redbeam/store'
import { openDatabase, debounceSave, type DbBackend } from './db.js'
import { broadcastChange, onChange } from '@redbeam/store'
import { getWindowRole, openContextWindow, isTauri } from './tauri/window.js'
import { windowTitle } from './windowTitle.js'
import {
  emptyDraft, drawDraft, screenToNormalized, rectPointsBetween, isCommittable, draftLengthPdfPoints,
  type DraftState, type Tool,
} from './draw.js'
import { toOverlay } from './overlay.js'
import {
  commitDimension, dimensionDraftBack, dimensionDraftMove, dimensionDraftPlace,
  drawDimension, drawDimensionDraft, emptyDimensionDraft,
  type DimensionDraft, type DimensionMarkup,
} from './tools/dimension.js'
import { SEED_SCOPES } from './seed.js'
import { PageStrip } from './pages/PageStrip.js'
import './shell/shell.css'
import {
  DocumentTabStrip, FileList, Sidebar, TitleBar,
  type PanelFile, type ProjectMenuEntry, type RailPanel, type ShellTab,
} from './shell/Shell.js'
import { Dock, DocumentPill, ReadPill, ToolPill } from './shell/Dock.js'
import { newScope } from './shell/scopeFactory.js'
import { SheetIndex } from './shell/SheetIndex.js'
import type { SheetScope } from './shell/sheets.js'
import { StatusToast } from './shell/StatusToast.js'
import { PerfReadout } from './shell/PerfReadout.js'
import { buildSheetIndex, sheetFromText } from './shell/sheets.js'
import type { SheetIndexShape, SheetOutlineNode } from './shell/sheets.js'
import {
  EstimatesPanel, type EstimateFile, type EstimateListItem, type ScopeMarkup,
  type ScopePage,
} from './shell/RightWorkspace.js'
import { renderTakeoffReport } from './export/report.js'
import { projectBridge, projectNameFromPath } from './project/bridge.js'
import { createCoreBlobUrlResolver } from './project/ingest.js'
import { openProjectDocuments } from './project/openProject.js'
import { SearchPanel } from './search/SearchPanel.js'
import { CommandPalette } from './palette/CommandPalette.js'
import type { Command, Step } from './palette/commands.js'
import { snapPoint, drawSnapIndicator, DEFAULT_SNAP, type SnapResult } from './snap.js'
import { hitTest, drawSelection, drawMarquee, markupsInRect, insertVertexAt, removeVertexAt, type Hit } from './hit.js'
import { normalizedToScreen } from './draw.js'
import { useStageSize, sizeCanvas } from './useStageSize.js'
import { PerfRegistry, type Stats, type Budget } from './perf.js'
import { isTextEntry, survivesTextEntry } from './keys.js'
import { readSession, writeSession } from './session.js'
import { calculationFor, deltaBetween, type QuantityDelta } from './commit.js'
import { projectCommands } from './palette/projects.js'
import { copyBillTsv, saveReportFile } from './bom/exports.js'
import { ScalePicker } from './scale/ScalePicker.js'
import { exportMarkedPdf } from './export/markedPdf.js'
import { ExportSheet } from './export/ExportSheet.js'
import {
  buildEstimateExport, estimateToCsv, estimateToTsv, exportFileName, type EstimateExport,
} from './export/estimateExport.js'
import { renderEstimatePdf } from './export/estimatePdf.js'
import { saveFile, saveOutcomeText } from './export/saveFile.js'
import { pageIndexOf as pageIndexOfId, renderTakeoffSnapshots } from './export/snapshots.js'
import { indexProject, type IndexProgress } from './search/indexer.js'
import { openHeadlessDocument } from './project/headlessDocument.js'
import { hitTestDimension } from './tools/dimension.js'
import { drawPanelLayout, drawRunLayout, layoutSummary } from './layout/drawLayout.js'
import { drawScaleRegions } from './scale/drawRegions.js'
import { useBridgeRequests } from './bridge/useBridgeRequests.js'
import { SettingsPanel } from './settings/SettingsPanel.js'
import { Glyph, Check, Compass, Minus, Plus, Trash2 } from './shell/icons.js'
import { SettingsStore, browserStorage } from './settings/store.js'
import { SETTINGS, CATEGORY_LABEL } from './settings/registry.js'

const VW = 1180
const VH = 780
/**
 * Browser mode has no project folder to ingest, so it gets one synthetic
 * document standing in for the bundled sample. On the desktop this is never
 * used — the id comes from the ingested row, which is derived from the file's
 * relative path so the same file always resolves to the same takeoff.
 */
/** What a scope counts, as the Setup page words it. */
const SCOPE_TYPE_LABEL: Record<ScopeType, string> = { area: 'areas', linear: 'lengths', count: 'counts' }

const FALLBACK_DOC = { id: 'doc-sample', relativePath: 'sample.pdf', displayName: 'Sample drawing' }
/**
 * Page and document identity come from @redbeam/store, never from here.
 *
 * An earlier revision of this file defined its own `pageIdFor` with a
 * different separator. Two id schemes for the same row is how a markup gets
 * silently orphaned: written under one scheme, looked up under the other, and
 * simply not found. The store owns identity.
 */

const uid = () => `mk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export interface WorkspaceProps {
  /** Absolute path of the open project folder. */
  projectPath: string
  /** Called when the user closes the project and returns to the start screen. */
  onCloseProject: () => void
  /** Other projects, for the title-bar switcher. */
  recentProjects?: ProjectMenuEntry[]
  /**
   * Open another project. A window IS a project, so this opens a SECOND window
   * and leaves this one alone.
   */
  onOpenProject?: (path: string) => void
  /** Pick a folder, then open it — same second-window rule. */
  onBrowseProject?: () => void
  /**
   * The drawing this window was opened to show, by relative path.
   *
   * Set on a context window popped out from a tab. Without it the new window
   * would open whatever the project opens first, which for a "pop this sheet
   * out" gesture is the one thing it must not do.
   */
  initialDocumentPath?: string | null
}

/**
 * The page index encoded in a page id.
 *
 * Page ids are `<documentId>-p<index>` (see `pageIdFor`), so this is a parse,
 * not a lookup. Module scope rather than a hook because it depends on nothing
 * and every hook that needed it had to list it as a dependency.
 */
function pageIndexOf(pageId: string): number | null {
  const m = /-p(\d+)$/.exec(pageId)
  return m === null ? null : Number(m[1])
}

/**
 * Cutouts that subtract from nothing: no area of the same scope on the same
 * page contains their first vertex — the rule `effectiveAreaRings` applies.
 */
function strayCutouts(markups: readonly Markup[]): number {
  let n = 0
  for (const c of markups) {
    if (c.kind !== 'cutout') continue
    const probe = c.rings[0]?.[0]
    if (probe === undefined) continue
    const inside = markups.some((a) =>
      a.kind === 'area' && a.pageId === c.pageId && a.scopeId === c.scopeId
      && a.rings.some((ring) => pointInPolygon(probe, ring)))
    if (!inside) n++
  }
  return n
}

export default function Workspace({
  projectPath, onCloseProject, recentProjects, onOpenProject, onBrowseProject,
  initialDocumentPath,
}: WorkspaceProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const rasterRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const viewRef = useRef<Viewport>({ ox: 0, oy: 0, zoom: 0.35, vw: VW, vh: VH })
  /** Live stage size in CSS pixels plus the display's device-pixel ratio. */
  const stage = useStageSize(stageRef)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const dbRef = useRef<SqlDriver | null>(null)
  const saveRef = useRef<() => void>(() => {})
  const undoRef = useRef<UndoStack | null>(null)
  // geometry as it was when a drag began, so the edit can be undone as one step
  const dragOriginRef = useRef<Array<{ x: number; y: number }> | null>(null)
  const draftRef = useRef<DraftState>(emptyDraft('pan'))

  const identity = useMemo(() => getWindowRole(), [])
  /*
   * The project's display name -- its folder name, not its whole path.
   *
   * Derived once and shared rather than recomputed per call site. Four
   * places need it: the title bar, the estimates panel, the BOM panel and
   * the automation bridge's export action. The last two put it in the
   * <title> and <h1> of the branded report, so a report the agent generates
   * and one the button generates have to carry the same name. Four
   * hand-rolled copies of one split is how three of them ended up with a
   * forward-slash-only character class, which splits nothing on Windows and
   * printed the entire path where the project name belongs.
   */
  const projectName = useMemo(
    () => projectNameFromPath(projectPath) || 'Project',
    [projectPath],
  )
  const [backend, setBackend] = useState<DbBackend | null>(null)
  /*
   * Status carries WHEN it was said, not just what.
   *
   * Thirty-odd `setStatus` calls report outcomes — "committed C-MT-01",
   * "cannot delete: …", "Create an estimate first" — and for a long while the
   * string went only to the automation bridge: no element in the shell
   * rendered it, so every refusal and every confirmation was silent to the
   * person who caused it. A toast shows it now, and it keys on the timestamp
   * because "undid area" said twice in a row is two events, not one.
   */
  const [statusEntry, setStatusEntry] = useState<{ text: string; at: number }>({ text: 'booting', at: 0 })
  const status = statusEntry.text
  const setStatus = useCallback((text: string) => setStatusEntry({ text, at: Date.now() }), [])
  const [page, setPage] = useState({ width: 0, height: 0 })
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  /*
   * Whether the folder scan has finished. Until it has, an empty `documents`
   * is not a fact about the project — a SharePoint-synced folder took 152
   * seconds to list 736 PDFs, and for all of it the files pane said the
   * project held none.
   */
  const [scan, setScan] = useState<'reading' | 'done'>('reading')
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  /**
   * Documents with a TAB, which is not the same as documents in the project.
   * A real bid package runs to hundreds of sheets — the Barclays job catalogs
   * 693 — so opening a project must not open 693 tabs. The full list lives in
   * the browser; tabs are for what you are working on.
   */
  const [openDocIds, setOpenDocIds] = useState<string[]>([])
  /*
   * The document browser is the Files pane. "Open another document" from the
   * tab strip, the app menu or the bridge opens that pane and puts the cursor
   * in its filter; like search, what survives is a nonce, because the pane
   * may already be open and a mounted field does not focus itself.
   */
  const [filesFocus, setFilesFocus] = useState(0)
  /*
   * "Add scope", likewise: the round names its own scopes in the sidebar, and
   * a request from the dock or the palette bumps this so the naming row opens.
   */
  const [addScopeRequest, setAddScopeRequest] = useState(0)
  const [docUrl, setDocUrl] = useState<string | null>(null)
  const [ingestNote, setIngestNote] = useState<string | null>(null)
  /** The project-wide text indexer's progress; null when it is not running. */
  const [indexing, setIndexing] = useState<IndexProgress | null>(null)
  /*
   * Search is a RAIL PANE, so it has no open/closed state of its own — the
   * rail owns that. What survives is a nonce: pressing Ctrl+F while the pane
   * is already open should put the cursor back in the field, and re-rendering
   * an already-mounted pane would not.
   */
  const [searchFocus, setSearchFocus] = useState(0)
  const [searchSeed, setSearchSeed] = useState('')
  /** Key of the (document, page) whose `pages` row is known to exist. */
  const [pageReadyKey, setPageReadyKey] = useState<string | null>(null)
  const [textNote, setTextNote] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  // Callbacks that are deliberately stable (sync handlers, the undo path) still
  // need the live page; state alone would give them the page as of their last
  // creation.
  const pageIndexRef = useRef(0)
  const docIdRef = useRef<string>(FALLBACK_DOC.id)
  const regionsRef = useRef<Map<string, ScaleRegion[]>>(new Map())
  const toolRef = useRef<Tool>('pan')
  /**
   * The page's calibration, for the paint loop.
   *
   * A committed dimension's label is derived from its length and the page's
   * scale, and the painter read neither: it drew every dimension with
   * `feetPerPoint: 0`, so a calibrated sheet's dimensions all said "set
   * scale first". A ref rather than a dependency, because the paint callback
   * must not be rebuilt on every calibration change.
   */
  const calRef = useRef<Calibration | null>(null)
  /**
   * Space is held: the next press-and-drag pans, WHATEVER tool is in hand.
   *
   * Every drawing application does this and an estimator's hands expect it —
   * halfway through a polygon you hold space, drag the sheet over, let go
   * and place the next vertex. It also covers the middle button. The ref
   * pair is read by the pointer handlers; nothing re-renders for it.
   */
  const spaceRef = useRef(false)
  const panOverrideRef = useRef(false)
  /**
   * Is a dialog on screen?
   *
   * Read by the key handler, which guarded only TEXT ENTRY — so with Settings
   * or the BOM open, pressing `a` armed the Area tool on the drawing behind
   * them. The next click then drew a markup the person never meant to start,
   * on a sheet they were not looking at.
   */
  const dialogOpenRef = useRef(false)
  /**
   * The in-progress dimension.
   *
   * Its own ref rather than a branch of `draftRef`, because a dimension is a
   * different state machine: two placed points and a perpendicular offset,
   * against the shape draft's list of vertices. Folding them together was how
   * the Qt build's version grew the bugs this port left behind.
   */
  const dimensionDraftRef = useRef<DimensionDraft>(emptyDimensionDraft())
  const [tool, setTool] = useState<Tool>('pan')
  const [scopes, setScopes] = useState<Scope[]>([])
  const [archivedScopes, setArchivedScopes] = useState<Scope[]>([])
  const [activeScope, setActiveScope] = useState<string | null>(null)
  const [markups, setMarkups] = useState<Markup[]>([])
  const markupsRef = useRef<Markup[]>([])
  const [cal, setCal] = useState<Calibration | null>(null)
  const [quantities, setQuantities] = useState<Array<{ scope: Scope; rows: QuantityResult[] }>>([])
  /** Latest value, for the commit path. See the note on `pageIndexRef`. */
  const quantitiesRef = useRef<Array<{ scope: Scope; rows: QuantityResult[] }>>([])
  /** Orderable piece counts per scope. Separate from measurements — see takeoff.ts. */
  const [pieces, setPieces] = useState<Array<{ scope: Scope; result: PieceResult }>>([])
  // paint() is a stable callback; state alone would give it last render's data.
  const piecesRef = useRef<Array<{ scope: Scope; result: PieceResult }>>([])
  const activeScopeRef = useRef<string | null>(null)
  /*
   * The scopes, for write paths that must not be wrong about what they are
   * merging into. See the note on `pageIndexRef` below — this is the same trap
   * and it cost a user their specification.
   */
  const scopesRef = useRef<Scope[]>([])
  /**
   * Perf recording is free (a ring-buffer write); the UI samples it on a slow
   * timer. Pushing the frame time into React state every paint made the
   * measurement part of what it measured.
   */
  const perfRef = useRef(new PerfRegistry())
  const [perf, setPerf] = useState<Array<{ budget: Budget; stats: Stats }>>([])
  const [, forceRender] = useState(0)
  const [pendingCal, setPendingCal] = useState<number | null>(null)
  // Read by the palette and the find drawer, which are opened from stable
  // callbacks that must not be rebuilt every time a measurement lands.
  const pendingCalRef = useRef<number | null>(null)
  pendingCalRef.current = pendingCal
  /**
   * Settings are per-USER and global, so the store is opened once for the
   * window rather than per project — reopening a project must not reset a
   * preference.
   */
  const settingsRef = useRef<SettingsStore | null>(null)
  if (settingsRef.current === null) settingsRef.current = SettingsStore.open(browserStorage())
  const settings = settingsRef.current
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** The bill of materials is showing, as a level of the estimates panel. */
  /* Which page of the open scope shows: the dock's Quantities opens Parts, its Specifications opens Setup. */
  const [scopePage, setScopePage] = useState<ScopePage>('parts')
  /** Which left-rail panel is showing, or null when the panel is collapsed. */
  /*
   * Files first. A project opens with no drawing on the stage (see the open
   * effect), so the pane that lists the drawings is the one to be looking at.
   */
  const [railPanel, setRailPanel] = useState<RailPanel | null>('files')
  /**
   * Whether the drawing tools are on screen.
   *
   * The dock rests as a scope pill and a Take off button; the tool rails only
   * appear once takeoff is entered. Twelve controls permanently floating over
   * a drawing is what made the old shell feel cluttered.
   */
  const [takeoff, setTakeoff] = useState(false)
  /**
   * A persistent fit, the way every PDF viewer does it.
   *
   * Fit used to be computed once per document, which is wrong the moment a
   * document has pages of different sizes — and a real bid set always does.
   * Paging from a 3456pt drawing to a 612pt spec sheet kept the drawing's zoom
   * and showed the spec sheet at 24% in the middle of an empty viewport.
   *
   * So fit is a MODE, not a one-off calculation: it survives page changes and
   * window resizes, and any manual zoom clears it to custom.
   */
  const [fitMode, setFitMode] = useState<'page' | 'width' | null>('page')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [estimates, setEstimates] = useState<EstimateListItem[]>([])
  /** False until the first read: an unread list is not an empty one. */
  const [estimatesLoaded, setEstimatesLoaded] = useState(false)
  const [openEstimateId, setOpenEstimateId] = useState<string | null>(null)
  const [openScopeId, setOpenScopeId] = useState<string | null>(null)
  const [estimateScopeIds, setEstimateScopeIds] = useState<string[]>([])
  /**
   * Have this estimate's scope ids been read yet?
   *
   * Needed because "no scopes" and "not asked yet" are both an empty array,
   * and they mean opposite things to the panel: one is an onboarding screen,
   * the other is a flash of it before the real list arrives.
   */
  const [estimateScopesLoaded, setEstimateScopesLoaded] = useState(false)
  const openEstimateIdRef = useRef<string | null>(null)
  const [estimateFiles, setEstimateFiles] = useState<EstimateFile[]>([])
  const [workOpen, setWorkOpen] = useState(true)
  /**
   * Every markup in the open document, not just the visible page.
   *
   * The page-scoped `markups` above is what the canvas paints. The sheet index
   * needs to know which OTHER sheets carry takeoff, and the scope panel lists a
   * scope's markups grouped by sheet — neither can be answered from one page.
   */
  const [docMarkups, setDocMarkups] = useState<Markup[]>([])
  /** Latest value, for write paths. See the note on `pageIndexRef`. */
  const docMarkupsRef = useRef<Markup[]>([])
  /**
   * The whole PROJECT's takeoff, for totalling.
   *
   * A scope spans documents as well as sheets — a ceiling continues from the
   * architectural set onto the interiors set — so a total that stops at the
   * open file is not a total, it is a fragment that changes when you switch
   * tabs and says nothing about having done so.
   */
  const [projectMarkups, setProjectMarkups] = useState<Markup[]>([])
  const [projectCalibrations, setProjectCalibrations] = useState<Map<string, number>>(new Map())

  /*
   * Every scale region in the project, by page id.
   *
   * Declared HERE, beside the calibrations, rather than beside the rest of the
   * scale code — `syncMarkups` reads it and this file has a history of
   * temporal-dead-zone bugs from declaring a callback below its use.
   */
  const [projectRegions, setProjectRegions] = useState<Map<string, ScaleRegion[]>>(new Map())

  const reloadRegions = useCallback(async (db: SqlDriver) => {
    const rows = await listAllScaleRegions(db)
    const byPage = new Map<string, ScaleRegion[]>()
    for (const r of rows) {
      const region: ScaleRegion = {
        id: r.id,
        pageId: r.pageId,
        label: r.label,
        feetPerPoint: r.feetPerPdfPoint,
        rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 },
      }
      const list = byPage.get(r.pageId)
      if (list) list.push(region)
      else byPage.set(r.pageId, [region])
    }
    setProjectRegions(byPage)
  }, [])
  const [projectPageBoxes, setProjectPageBoxes] = useState<
    Map<string, { width: number; height: number }>
  >(new Map())
  /**
   * The document's own index: its outline, its page labels, and which of the
   * three shapes those turned out to be. Defaults to `none`, which makes the
   * sheet index fall back to page labels and then to ordinals — a correct, if
   * plainer, panel while the extraction is in flight or absent.
   */
  /**
   * Page boxes for every sheet, from the viewer's boot report.
   *
   * Needed because normalized geometry is relative to ITS OWN page's box and
   * the boxes differ across a real set — a details sheet is not the size of a
   * plan. Measuring an off-screen markup against the open sheet's box is how a
   * quantity comes out confidently wrong.
   */
  const [pageSizes, setPageSizes] = useState<Array<{ width: number; height: number }>>([])
  /** Calibration per page id, for the whole open document. */
  const [docCalibrations, setDocCalibrations] = useState<Map<string, number>>(new Map())
  const [docIndex, setDocIndex] = useState<{
    outline: SheetOutlineNode[]
    labels: Array<string | null>
    shape: SheetIndexShape
  }>({ outline: [], labels: [], shape: 'none' })
  const [workspaceTab, setWorkspaceTab] = useState<'chat' | 'estimates'>('estimates')
  const [prefs, setPrefs] = useState(() => settings.all())
  /*
   * Read by the paint callback, which is memoized on the page box alone —
   * putting `prefs` in its dependency list would rebuild the painter every
   * time any unrelated setting changed.
   */
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  /*
   * The layout preview is a GLOBAL preference, not a piece of window state.
   *
   * It was a `useState` here, which made it per-window and per-session: it
   * reset on every relaunch, and the control living in a scope's panel made it
   * look like a property of that scope. It is neither. Whether you are reading
   * layouts right now is a way of working, and it is the same answer for every
   * scope on every sheet — so it lives with the other preferences, persists,
   * and can be reached from the settings screen and the command palette like
   * anything else.
   */
  const layoutOn = prefs['takeoff.layoutPreview'] === true
  const setLayoutOn = useCallback((on: boolean) => {
    settings.set('takeoff.layoutPreview', on)
  }, [settings])

  /**
   * Open settings, closing whatever dialog was up. They are not layered.
   *
   * Declared HERE, above the command list, and not beside the other modal
   * helpers further down: the palette's command objects read this value while
   * the memo is being built, which is during render — so a `const` declared
   * after that memo is in its temporal dead zone and the whole workspace
   * throws before it paints. Tests did not catch it because none of them render
   * this component; the browser did, immediately.
   */
  /*
   * The two finders exclude each other.
   *
   * Ctrl+K over an open find-in-page left both on screen at once — a palette in
   * the middle of the window and a search field over the title bar, each with
   * its own idea of what Escape and Enter meant. They answer the same question
   * from different angles; only one of them can be the one being asked.
   */
  /*
   * ...and neither opens over the calibration form, which is a question with a
   * measurement behind it: it cannot be dismissed by opening something else,
   * and every command reachable from the palette would have been swallowed by
   * its precedence anyway. Refusing to open is the honest version of that.
   */
  const openPalette = useCallback(() => {
    if (pendingCalRef.current !== null) return
    // Search no longer closes: it is a rail pane beside the drawing rather
    // than an overlay, so it can sit under the palette without competing
    // for the same space.
    setPaletteOpen(true)
  }, [])
  const openSearch = useCallback(() => {
    if (pendingCalRef.current !== null) return
    setPaletteOpen(false); setRailPanel('search'); setSearchFocus((n) => n + 1)
  }, [])

  const openSettings = useCallback(() => {
    setSettingsOpen(true)
  }, [])

  /*
   * THERE ARE NO DIALOGS. The palette is the only overlay this app has.
   *
   * The bill of materials, the document browser and the scope editor were
   * three windows over the drawing, and each went to the surface its moment
   * was already in: the bill is a level of the estimates panel, the browser
   * is the Files pane with a filter, and a scope is named in its round's
   * list and edited on its own page. `only` is still the one place that says
   * where each request goes — the bridge's `open_panel` and the palette both
   * route through it — but "going" now means opening a pane or a level, and
   * leaving settings, which is the one full-screen place a pane can be
   * hidden behind.
   */
  const only = useCallback((open: 'bom' | 'browser' | 'scope') => {
    setSettingsOpen(false)
    if (open === 'bom') {
      // The bill is a scope's Parts page now — there is no level of its own.
      setWorkOpen(true); setScopePage('parts')
      const id = activeScopeRef.current
      if (id !== null) setOpenScopeId(id)
    }
    if (open === 'browser') { setRailPanel('files'); setFilesFocus((n) => n + 1) }
    if (open === 'scope') {
      setWorkOpen(true)
      setOpenScopeId(null)
      setAddScopeRequest((n) => n + 1)
    }
  }, [])
  const openParts = useCallback(() => { only('bom') }, [only])
  const openBrowser = useCallback(() => { only('browser') }, [only])
  const openScopeEditor = useCallback(() => { only('scope') }, [only])
  /**
   * Show the active scope's specification — in the sidebar, where it lives.
   * With no active scope there is nothing to show, so the request becomes
   * "add one", which is the row the sidebar opens for that.
   *
   * Declared HERE, beside the other openers and above the command list: the
   * palette's command objects read it while the memo is built, during render,
   * and a `const` declared after that memo is in its temporal dead zone.
   */
  const openScopeDetail = useCallback(() => {
    const id = activeScopeRef.current
    if (id === null) { only('scope'); return }
    setSettingsOpen(false)
    setWorkOpen(true)
    setScopePage('setup')
    setOpenScopeId(id)
  }, [only])
  useEffect(() => settings.subscribe(setPrefs), [settings])

  /**
   * Derived, not duplicated. Holding a separate `snapOn` state seeded from the
   * setting made the toolbar checkbox and the Settings row disagree the moment
   * either was changed — two controls for one value, silently out of step.
   */
  const snapOn = prefs['takeoff.snapEnabled'] !== false
  const [undoState, setUndoState] = useState<UndoState>({
    canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, depth: 0,
  })
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedRef = useRef<string[]>([])
  const marqueeRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const clipboardRef = useRef<Markup[]>([])
  const hoverRef = useRef<Hit | null>(null)
  const editRef = useRef<
    | { mode: 'vertex'; id: string; index: number }
    | { mode: 'move'; ids: string[]; lastN: { x: number; y: number }
        origins: Map<string, Array<{ x: number; y: number }>> }
    | null
  >(null)
  const snapRef = useRef<SnapResult | null>(null)
  /**
   * A rectangle being dragged out for an area or a cutout.
   *
   * `moved` is what separates a drag from a click: until the pointer has
   * travelled a few pixels the gesture is still a click placing a polygon
   * vertex, and only on release is it decided which one it was.
   */
  /**
   * A drag-rectangle in progress. The anchor is a point on the PAGE
   * (normalized), the live corner is on the screen: panning or zooming with
   * the wheel while the button is down moves the screen, not the sheet, and
   * the shape's anchored corner has to stay where it was pressed. It used to
   * hold both corners in screen pixels and slid across the sheet with every
   * pan — see `rectPointsBetween` in draw.ts.
   */
  const rectRef = useRef<
    { anchor: { x: number; y: number }; x1: number; y1: number; moved: boolean } | null
  >(null)
  const shiftRef = useRef(false)
  const [calError, setCalError] = useState<string | null>(null)

  /**
   * The markup under a right-click, and where to put its menu.
   *
   * Everything this menu offers already existed and none of it was findable:
   * a vertex was added or removed by ALT-clicking an edge or a corner, and a
   * markup changed scope only by selecting it and going elsewhere. An
   * undiscoverable shortcut is a feature the product does not have.
   *
   * Screen coordinates, because the menu is chrome over the drawing rather
   * than something on the sheet — it must not pan or scale with the page.
   */
  const [markupMenu, setMarkupMenu] = useState<
    { x: number; y: number; markupId: string; part: Hit['part']; index: number } | null
  >(null)


  /**
   * Keep the canvases and the viewport matched to the stage.
   *
   * The backing store is sized in DEVICE pixels — that is the blur fix — while
   * the viewport stays in CSS pixels so hit-testing, snapping and geometry all
   * remain in one coordinate space.
   */
  useEffect(() => {
    // Both, unconditionally. `a() || b()` short-circuited and left the overlay
    // at a stale size, so a markup's fill stopped dead at a vertical line
    // partway across the viewport — the edge of the overlay's backing store.
    const rasterResized = sizeCanvas(rasterRef.current, stage)
    const overlayResized = sizeCanvas(overlayRef.current, stage)
    const resized = rasterResized || overlayResized
    viewRef.current = clampViewport(
      { ...viewRef.current, vw: stage.width, vh: stage.height },
      viewerRef.current?.pageInfo ?? { width: page.width, height: page.height },
    )
    viewerRef.current?.requestVisible(viewRef.current)
    // Resizing a canvas clears it, so a repaint is required — but only then.
    if (resized) requestPaint()
  }, [stage, page.width, page.height])

  // ---------------------------------------------------------------- paint --
  /**
   * Read the canvas surround from the stylesheet rather than letting the
   * viewer's default stand.
   *
   * `Viewer.paint` defaults to `#3a3d42` — a Qt-era grey — and nothing ever
   * passed a value, so the sheet floated on a colour from the previous build
   * inside chrome from this one. It was the only unthemed surface on screen
   * and the first thing that read as "not the design".
   */
  const surround = useCallback(() => {
    const el = stageRef.current
    if (el === null) return undefined
    const v = getComputedStyle(el).getPropertyValue('--rb-canvas').trim()
    return v === '' ? undefined : v
  }, [])

  /**
   * Ask for a repaint on the next frame.
   *
   * Everything that changes what is on screen calls this; nothing calls
   * `paint()` directly except the frame callback. Two problems it replaces:
   *
   *  - a `setInterval(paint, 120)` was the ONLY thing that painted an arriving
   *    tile, so a tile could sit up to 120ms before appearing. That, far more
   *    than the tile grid, is why raster visibly landed a piece at a time.
   *  - pointer and wheel handlers painted synchronously, several times per
   *    frame during a drag, doing work the compositor then threw away.
   *
   * Coalescing to one paint per frame fixes both ends at once.
   */
  const frameRef = useRef(0)
  const requestPaint = useCallback(() => {
    if (frameRef.current !== 0) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      paintRef.current()
    })
  }, [])

  const paint = useCallback(() => {
    const v = viewerRef.current
    if (!v) return
    const t0 = performance.now()
    const bg = surround()
    if (bg === undefined) v.paint(viewRef.current)
    else v.paint(viewRef.current, bg)
    const oc = overlayRef.current?.getContext('2d')
    if (oc && page.width > 0) {
      /*
       * Scale regions first, under everything.
       *
       * A region governs every measurement inside it, so it has to be visible
       * whether or not anyone is thinking about scale — crossing into a detail
       * at 1/4" while drawing an area is something to notice before the
       * quantity says so, not after.
       */
      /*
       * Dimensions, on the 2D layer rather than the viewer overlay.
       *
       * The overlay carries takeoff — polygons and lines a scope's colour is
       * derived from. A dimension has no scope and its own drawing (ticks, an
       * offset witness line, a label), so it belongs with the scale regions on
       * the annotation layer.
       */
      for (const m of markupsRef.current) {
        if (m.kind !== 'dimension') continue
        // A dimension written before content was carried has none; skip it
        // rather than let one row take the whole overlay down.
        if ((m as unknown as { content?: unknown }).content === undefined) continue
        drawDimension(oc, m as unknown as DimensionMarkup, viewRef.current, page.width, page.height, {
          feetPerPoint: calRef.current?.feetPerPoint ?? 0,
        })
      }
      if (toolRef.current === 'dimension') {
        drawDimensionDraft(oc, dimensionDraftRef.current, viewRef.current, page.width, page.height)
      }

      const regionsHere = regionsRef.current.get(
        pageIdFor(docIdRef.current, pageIndexRef.current),
      )
      if (regionsHere !== undefined && regionsHere.length > 0) {
        drawScaleRegions(oc, regionsHere, viewRef.current, {
          pageWidth: page.width,
          pageHeight: page.height,
          active: toolRef.current === 'scale-region',
        })
      }
      // Layout goes UNDER the markups and the selection: it is context for the
      // takeoff, not the takeoff.
      if (layoutOn) {
        /*
         * EVERY scope's layout, not just the one being drawn into.
         *
         * The painter looked up the active scope and drew that alone, so a
         * global switch still showed one scope at a time and turning it on
         * looked like it applied per scope. Which scope you are DRAWING into
         * has nothing to do with which layouts you want to see: an estimator
         * checks a ceiling against the ceiling next to it, and two scopes that
         * overlap where they should not is a thing you can only notice with
         * both on screen. Each draws in its own colour, which is what the
         * colour is for.
         *
         * Only this sheet's geometry: a scope spans sheets, and the
         * calculation returns all of them because that is what the totals are
         * made of.
         */
        const here = pageIdFor(docIdRef.current, pageIndexRef.current)
        for (const entry of piecesRef.current) {
          const opts = {
            color: entry.scope.color,
            pageWidth: page.width,
            pageHeight: page.height,
            // What to draw is a global reading preference, not a property of a
            // scope: waste and coverage are two different questions asked of
            // every scope, not two kinds of scope.
            showOverflow: prefsRef.current['takeoff.layoutOverflow'] === true,
            // The same preference, spelled the way the panel path names it.
            showFullCells: prefsRef.current['takeoff.layoutOverflow'] === true,
            showRails: prefsRef.current['takeoff.layoutRails'] !== false,
            showTrim: prefsRef.current['takeoff.layoutTrim'] !== false,
            showSeams: prefsRef.current['takeoff.layoutSeams'] !== false,
          }
          const cells = entry.result.cells.filter((c) => c.pageId === undefined || c.pageId === here)
          const runs = entry.result.runs.filter((r) => r.pageId === here)
          if (cells.length > 0) drawPanelLayout(oc, cells, viewRef.current, opts)
          else if (runs.length > 0) drawRunLayout(oc, runs, viewRef.current, opts)
        }
      }
      const ids = new Set(selectedRef.current)
      const sel = markupsRef.current.filter((m) => ids.has(m.id))
      drawSelection(oc, sel, viewRef.current, page.width, page.height,
        hoverRef.current?.part === 'vertex' ? hoverRef.current.index : null)
      drawMarquee(oc, marqueeRef.current)
      drawDraft(oc, draftRef.current, viewRef.current, page.width, page.height)
      drawSnapIndicator(oc, snapRef.current)
    }
    perfRef.current.record('frame', performance.now() - t0)
  }, [page.width, page.height, layoutOn])

  /*
   * Repaint when the layout preview is toggled, or a display preference moves.
   *
   * Neither of these touches the drawing itself, so nothing else asks the
   * canvas to redraw — and a canvas only shows what it was last told to draw.
   * Turning the preview on therefore did nothing at all until the next pan or
   * zoom happened to repaint, which is indistinguishable from the toggle being
   * broken; it was why the layout looked missing even with everything computed
   * and switched on. The painter reads the preferences through a ref so it is
   * not rebuilt whenever an unrelated setting changes, which is exactly what
   * leaves it unable to notice on its own.
   */
  useEffect(() => { requestPaint() }, [layoutOn, prefs, requestPaint])

  /*
   * The frame callback needs the CURRENT paint, but `requestPaint` must be
   * stable — it is called from event handlers and from the viewer's onTile,
   * and re-creating it would leak a scheduled frame on every render.
   */
  const paintRef = useRef(paint)
  paintRef.current = paint

  // ------------------------------------------------------------- database --
  useEffect(() => {
    let cancelled = false
    // Read ONCE, at open. Re-reading later would fight the user's navigation
    // with a stale idea of where they were.
    const saved = readSession(projectPath)
    ;(async () => {
      const opened = await openDatabase(projectPath)
      if (cancelled) return
      dbRef.current = opened.driver
      saveRef.current = debounceSave(opened.save)
      setBackend(opened.backend)
      setStatus(`${opened.backend === 'tauri' ? 'desktop store' : 'browser store'} · ${opened.location}`)
      undoRef.current = new UndoStack(opened.driver)

      let existing = await listScopes(opened.driver)
      /*
       * Seed the BROWSER demo only. Never a real project.
       *
       * This ran for every empty database, so opening a new client folder
       * wrote five demo scopes into it — with FIXED ids, so the next project
       * showed the same five and read as the previous project's scopes
       * following you around. Aaron reported exactly that.
       *
       * The seeded specifications are the worse half. Their own comment calls
       * them "plausible starting points, NOT standards": a 6in baffle spacing
       * that came from nowhere, sitting in a scope named like a real one, on a
       * real bid. An estimator who draws into it gets a quantity computed from
       * a number nobody chose. Everything else in this codebase refuses to
       * invent a measurement; this was inventing five.
       *
       * The browser build has no project folder and exists to be looked at, so
       * it still gets them.
       */
      if (existing.length === 0 && opened.backend !== 'tauri') {
        for (const s of SEED_SCOPES) {
          await upsertScope(opened.driver, { ...s, archivedAt: null })
        }
        existing = await listScopes(opened.driver)
        saveRef.current()
      }
      const asScopes: Scope[] = existing.map((s) => ({
        id: s.id, label: s.label, scopeType: s.scopeType as Scope['scopeType'],
        color: s.color, specifications: s.specifications,
      }))
      setScopes(asScopes)
      setActiveScope((cur) => (
        cur
        ?? (saved.activeScopeId !== undefined && asScopes.some((x) => x.id === saved.activeScopeId)
          ? saved.activeScopeId
          : null)
        ?? asScopes[0]?.id
        ?? null
      ))

      /*
       * Show the catalog we already have BEFORE walking the folder.
       *
       * The scan is what takes the time — on a SharePoint folder with Files
       * On-Demand it took 152 seconds, because every directory is a reparse
       * point the walk has to wake. Waiting for it before showing anything
       * meant reopening a project you had used yesterday sat empty for minutes
       * with a catalog of 736 documents already in the database.
       *
       * Nothing here reads a drawing. The scan takes metadata only and skips
       * fingerprinting anything not local, so no file is downloaded to build
       * this list — the wait was enumeration, not transfer.
       */
      const known = await listDocuments(opened.driver)
      if (cancelled) return
      if (known.length > 0) setDocuments(known)

      // Sequence lives in openProjectDocuments so it can be tested: scanning,
      // reconciling only on a complete scan, and still opening when the folder
      // cannot be read.
      const opened2 = await openProjectDocuments(
        opened.driver, projectBridge, projectPath, () => cancelled,
      )
      if (cancelled) return
      // Browser mode ingests nothing, but the workspace still runs on the
      // bundled sample. Listing it keeps the UI honest: without this the tab
      // strip says "No documents open" while a document is plainly loaded,
      // and the document browser shows an empty project.
      const listed = opened2.documents.length === 0 && !isTauri()
        ? [{
            id: FALLBACK_DOC.id,
            relativePath: FALLBACK_DOC.relativePath,
            displayName: FALLBACK_DOC.displayName,
          } as DocumentRow]
        : opened2.documents
      setDocuments(listed)
      setScan('done')
      setIngestNote(opened2.note)
      // Browser mode cannot scan a folder, so nothing is ingested. Fall back to
      // the bundled sample's id rather than leaving the workspace with no active
      // document — every page, markup and text row hangs off a document, so a
      // null here silently disables indexing and search.
      /*
       * A context window opens on the sheet it was popped out to show. If that
       * document is not in this project — a stale URL, a moved file — fall
       * through to the first one rather than opening on nothing.
       */
      const requested =
        initialDocumentPath === null || initialDocumentPath === undefined
          ? null
          : listed.find((d) => d.relativePath === initialDocumentPath)?.id ?? null
      /*
       * Otherwise, the sheet you were last on in THIS project.
       *
       * A relaunch used to land on the first document of the set whatever you
       * had been doing, which on a 29-sheet job means finding your way back by
       * hand every time. An explicit request still wins: a popped-out context
       * window was opened to show one document and must not be second-guessed.
       * A remembered document that is no longer in the project, like a stale
       * URL, opens NOTHING. The first file in the folder is not a choice
       * anyone made: on a real bid package it is a bid form or an old set,
       * and opening it looked like the app deciding what to work on. Aaron:
       * "It shouldn't open any file by default, and it should open directly
       * to the folder pane." So a project with no remembered sheet opens on
       * the Files pane and an empty stage that says so.
       */
      const remembered = saved.documentPath === undefined
        ? null
        : listed.find((d) => d.relativePath === saved.documentPath)?.id ?? null
      const first = requested ?? remembered ?? null
      setActiveDocId((cur) => cur ?? first)
      // One tab on open, not one per document.
      setOpenDocIds((cur) => (cur.length > 0 ? cur : first !== null ? [first] : []))
      if (first === null) setRailPanel('files')
    })()
    return () => { cancelled = true }
  }, [projectPath, initialDocumentPath])

  /**
   * Reload markups from the store so the UI always matches what is persisted.
   *
   * Declared HERE, above the page-open effect, because that effect calls it.
   * It used to sit two hundred lines below and the effect loaded the page's
   * markups itself — which is how the two got out of step: `docMarkups` and
   * `docCalibrations` were only ever populated by an EDIT, so on a freshly
   * opened project the piece calculation was handed no markups and no
   * calibrations at all. It produced nothing, and reported no blocker either,
   * because zero markups is a legitimate reason to have no pieces. Draw one
   * shape and everything appeared; relaunch and it was gone again.
   */
  const syncMarkups = useCallback(async () => {
    const db = dbRef.current
    if (!db) return
    const toMarkup = (r: {
      id: string; scopeId: string | null; documentId: string; pageId: string; kind: string
      rings: Array<Array<{ x: number; y: number }>>
    }): Markup => ({
      id: r.id, scopeId: r.scopeId, documentId: r.documentId, pageId: r.pageId,
      kind: r.kind as Markup['kind'], rings: r.rings,
      /*
       * The per-kind payload, carried through.
       *
       * This dropped it, so every committed dimension reached the painter
       * with no `content` — and `drawDimension` reads `content.offsetPoints`
       * before anything else. The first dimension on a sheet threw inside
       * the paint loop on every frame after it was saved: the overlay froze,
       * the dimension itself never appeared, and nothing said why. Aaron:
       * "linear dimension … doesn't work as expected".
       */
      ...((r as { content?: Record<string, unknown> }).content !== undefined
        ? { content: (r as { content?: Record<string, unknown> }).content }
        : {}),
    })
    const docId = docIdRef.current
    // Two queries rather than one filtered in the client: the page query is on
    // the hot path — it runs after every single markup edit — and making it
    // scan the document would put the cost of the sheet index on every stroke.
    const [pageRows, docRows, cals] = await Promise.all([
      listMarkups(db, { pageId: pageIdFor(docId, pageIndexRef.current) }),
      listMarkups(db, { documentId: docId }),
      listCalibrations(db, docId),
    ])
    setMarkups(pageRows.map(toMarkup))
    setDocMarkups(docRows.map(toMarkup))
    setDocCalibrations(new Map([...cals].map(([id, c]) => [id, c.feetPerPdfPoint])))
    // And the project's, which is what the totals are made of. Page boxes come
    // from the STORE rather than the viewer: the viewer only knows the open
    // document's, and normalized geometry means nothing without its own box.
    const [allRows, allCals, allBoxes] = await Promise.all([
      listMarkups(db, {}),
      listAllCalibrations(db),
      listPageBoxes(db),
    ])
    setProjectMarkups(allRows.map(toMarkup))
    setProjectCalibrations(allCals)
    setProjectPageBoxes(allBoxes)
    // Regions resolve BEFORE the page scale, so a sync that loaded the
    // calibrations without them would measure a details sheet at its page
    // number for one render and then correct itself — a total that moves on
    // its own is worse than one that is late.
    await reloadRegions(db)
  }, [reloadRegions])

  // Load page-dependent state once BOTH the db and the page box are ready.
  useEffect(() => {
    const db = dbRef.current
    if (!db || page.width === 0) return
    let cancelled = false
    ;(async () => {
      const activeDoc = documents.find((d) => d.id === activeDocId)
      const docId = activeDoc?.id ?? FALLBACK_DOC.id
      const pageId = pageIdFor(docId, pageIndexRef.current)
      await ensureDocumentAndPage(db, activeDoc ?? FALLBACK_DOC, {
        // pages.page_number is ZERO-based, matching the viewer's page index and
        // the Qt MCP surface ("zero-based page number").
        id: pageId, documentId: docId, pageNumber: pageIndex,
        width: page.width, height: page.height,
      })
      // Calibration is PER PAGE. Page boxes differ across a set and so do
      // scales — a details sheet is not drawn at the plan's scale — so a
      // document-level scale would silently mis-measure every other sheet.
      const stored = await getCalibration(db, pageId)
      if (cancelled) return
      setCal(
        stored
          ? { feetPerPoint: stored.feetPerPdfPoint, pageWidth: page.width, pageHeight: page.height }
          : null,
      )
      // The page's markups AND the document's, through the one function that
      // knows about both. Loading only the page here is what left the piece
      // calculation with nothing to work from until the first edit.
      await syncMarkups()
      if (cancelled) return
      setPageReadyKey(pageId)
      saveRef.current()
    })()
    return () => { cancelled = true }
  }, [page.width, page.height, pageIndex, activeDocId, documents, scopes.length, syncMarkups])


  /*
   * Return to the remembered SHEET, once — and only once.
   *
   * The page cannot be restored with the document: the viewer has to boot and
   * report a page count first, and asking for sheet 9 of a set whose length is
   * still unknown is how you end up on sheet 1 with an error nobody sees. A
   * ref rather than state because this must not re-fire when the user then
   * navigates away, which would pin them to the remembered page forever.
   */
  const restoredPage = useRef(false)
  useEffect(() => {
    if (restoredPage.current || pageCount === 0) return
    // A context window was opened to show something specific; leave it there.
    if (initialDocumentPath !== null && initialDocumentPath !== undefined) {
      restoredPage.current = true
      return
    }
    const want = readSession(projectPath).pageIndex
    restoredPage.current = true
    if (want === undefined || want === pageIndex) return
    if (want < 0 || want >= pageCount) return
    viewerRef.current?.loadPage(want)
  }, [pageCount, pageIndex, projectPath, initialDocumentPath])

  /** Remember where we are, so the next launch starts here. */
  useEffect(() => {
    if (activeDocId === null) return
    const doc = documents.find((d) => d.id === activeDocId)
    writeSession(projectPath, {
      ...(doc !== undefined ? { documentPath: doc.relativePath } : {}),
      pageIndex,
      ...(activeScope !== null ? { activeScopeId: activeScope } : {}),
    })
  }, [projectPath, activeDocId, documents, pageIndex, activeScope])

  /**
   * Read every sheet's title block, when the set does not name its own sheets.
   *
   * A published set usually says what its sheets are in its outline or its
   * page labels. Plenty say it in neither — the information is printed in the
   * title block and nowhere else — and for those the index could only count
   * pages. "Page 14" is not a sheet name, and navigating a 110-sheet set by
   * ordinal is doing the publisher's filing by hand.
   *
   * So when there is nothing to fall back on, walk the document once and read
   * the text. Deliberately:
   *
   *  - only for `none` and `sparse`. A set with a real outline already knows.
   *  - one page at a time, awaited, so a 110-sheet sweep never competes with
   *    the sheet the estimator is actually looking at.
   *  - results appear as they arrive, so the panel fills in rather than
   *    waiting on the last page.
   *  - the text is INDEXED as it goes, which is the same work full-text search
   *    needs — the coverage figure the search panel reports climbs with it
   *    instead of staying at whatever fraction happened to be visited.
   */
  const [derivedLabels, setDerivedLabels] = useState<Array<string | null>>([])
  useEffect(() => {
    setDerivedLabels([])
    const v = viewerRef.current
    const db = dbRef.current
    if (!v || !db || pageCount === 0) return
    if (docIndex.shape !== 'none' && docIndex.shape !== 'sparse') return
    // Something already names them; nothing to work out.
    if (docIndex.labels.some((l) => l !== null && l.trim() !== '')) return

    let cancelled = false
    const docId = docIdRef.current
    void (async () => {
      // `sweepPage`, not `i`: this enumerates EVERY page, so unlike every other
      // page id in this file there is no "current page" it could be wrong
      // about. The name is what tells the page-identity guard that.
      for (let sweepPage = 0; sweepPage < pageCount; sweepPage++) {
        if (cancelled) return
        try {
          const pt = await v.requestText(sweepPage)
          if (cancelled) return
          await indexPageText(db, {
            pageId: pageIdFor(docId, sweepPage),
            documentId: docId,
            content: pt.text,
            source: pt.scanned ? 'ocr-needed' : 'native',
          })
          const found = sheetFromText(pt.text)
          if (found === null) continue
          const label = found.title === '' ? found.number : `${found.number} ${found.title}`
          setDerivedLabels((cur) => {
            const next = [...cur]
            next[sweepPage] = label
            return next
          })
        } catch {
          // One unreadable sheet is not a reason to stop reading the rest.
        }
      }
    })()
    return () => { cancelled = true }
  }, [pageCount, docIndex.shape, docIndex.labels, activeDocId])

  const goToPage = useCallback((index: number) => {
    const v = viewerRef.current
    if (!v || index === pageIndex) return
    // Only ask for the page. Do NOT set the viewport here: the size known at
    // boot comes from the page dictionary (FPDF_GetPageSizeByIndexF) and can
    // differ slightly from the opened page's own box — 3456 x 2592.24 vs
    // 3456.48 x 2591.04 on this set. Setting zoom from the boot size requests
    // tiles at one zoom while onPage then paints at another, so every lookup
    // misses and the canvas stays empty. onPage is the authoritative source.
    v.loadPage(index)
    setSelectedIds([]); selectedRef.current = []
  }, [pageIndex])

  // Resolve the active document to something the worker can fetch.
  //
  // Project PDFs live outside the web root, so the core hands back raw bytes
  // and we wrap them in a blob URL. Browser mode has no filesystem, so it falls
  // back to the bundled sample — the app stays usable for iteration rather than
  // showing an empty stage.
  useEffect(() => {
    const doc = documents.find((d) => d.id === activeDocId)
    if (!doc) { setDocUrl(isTauri() ? null : '/sample.pdf'); return }
    if (!isTauri()) { setDocUrl('/sample.pdf'); return }

    let cancelled = false
    const resolver = createCoreBlobUrlResolver(projectPath)
    void resolver.resolveUrl({ relativePath: doc.relativePath }).then((url) => {
      if (cancelled || !url) { if (url) resolver.releaseUrl(url); return }
      setDocUrl(url)
    })
    return () => { cancelled = true; resolver.release() }
  }, [documents, activeDocId, projectPath])

  /*
   * Index the whole project's text, starting the moment the folder is known.
   *
   * See `search/indexer.ts` for what and why. Runs in its own worker, one
   * document at a time, and is cancelled if the project closes or the
   * catalog changes under it. Documents it has finished are remembered per
   * machine, keyed by content fingerprint, so a reopen costs one lookup per
   * document and a replaced drawing is read again.
   *
   * Desktop only: the browser build cannot read a project folder.
   */
  useEffect(() => {
    const db = dbRef.current
    if (!db || scan !== 'done' || documents.length === 0 || !isTauri()) return
    let cancelled = false
    const key = `redbeam.indexed.v1:${projectPath}`
    const fingerprintOf = new Map(documents.map((d) => [d.id, d.contentFingerprint ?? '']))
    let done: Record<string, string> = {}
    try { done = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string> } catch { done = {} }
    const completed = {
      has: (id: string) => done[id] !== undefined && done[id] === fingerprintOf.get(id),
      add: (id: string) => {
        done[id] = fingerprintOf.get(id) ?? ''
        try { localStorage.setItem(key, JSON.stringify(done)) } catch { /* a lost marker costs one re-read */ }
      },
    }
    const resolver = createCoreBlobUrlResolver(projectPath)
    void indexProject({
      db,
      documents,
      resolveUrl: (d) => resolver.resolveUrl(d),
      releaseUrl: (u) => resolver.releaseUrl(u),
      openDocument: (url) => openHeadlessDocument(url),
      completed,
      isCancelled: () => cancelled,
      onProgress: (p) => { if (!cancelled) setIndexing(p.done >= p.total ? null : p) },
    }).then((out) => {
      if (cancelled) return
      setIndexing(null)
      if (out.failures.length > 0) {
        setTextNote(`Text indexing skipped ${out.failures.length} item${out.failures.length === 1 ? '' : 's'}: ${out.failures[0]!.relativePath} — ${out.failures[0]!.reason}`)
      }
    }).catch((err) => {
      if (!cancelled) setTextNote(`Text indexing stopped: ${err instanceof Error ? err.message : String(err)}`)
    })
    return () => { cancelled = true; setIndexing(null); resolver.release() }
  }, [documents, scan, projectPath])

  // Extract and index this page's text once it is shown.
  //
  // Extraction runs behind visible tiles in the worker's own queue, so this
  // never delays the sheet being drawn. Indexing on view rather than on ingest
  // is deliberate: extracting 75 sheets up front would cost minutes of worker
  // time for pages the estimator may never open, and search reports its own
  // coverage so a partial index is visible rather than silently wrong.
  useEffect(() => {
    const db = dbRef.current
    const v = viewerRef.current
    const docId = activeDocId
    if (!db || !v || !docId || page.width === 0) return
    const pageId = pageIdFor(docId, pageIndexRef.current)
    // page_text has a foreign key to pages. Indexing before the row exists
    // fails the constraint, and because the failure used to be a console
    // warning, search simply stayed empty with no way to tell that it had
    // broken rather than found nothing. Wait for the row.
    if (pageReadyKey !== pageId) return

    let cancelled = false
    const index = pageIndex

    void v.requestText(index).then(async (pt) => {
      perfRef.current.record('text', pt.ms)
      if (cancelled || !pt) return
      // A page with no text layer is a scanned raster, not an empty page.
      // Record it either way so coverage counts it as looked at.
      await indexPageText(db, {
        pageId,
        documentId: docId,
        content: pt.text,
        source: pt.scanned ? 'ocr-needed' : 'native',
      })
      if (!cancelled) setTextNote(null)
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[text] could not index page', index, err)
      // Say it out loud: a silent indexing failure makes search answer
      // "no matches" for text that is right there on the sheet.
      if (!cancelled) setTextNote(`Text indexing failed for page ${index + 1}: ${msg}`)
    })

    return () => { cancelled = true }
  }, [activeDocId, pageIndex, page.width, pageReadyKey])

  const runSearch = useCallback(async (q: string) => {
    const db = dbRef.current
    if (!db) throw new Error('no project is open')
    return searchProjectText(db, q)
  }, [])

  const goToHit = useCallback((hit: SearchHit) => {
    // pageNumber is ZERO-based, straight from pages.page_number — the same
    // space as the viewer's index. Adding one here would land a sheet past
    // every hit.
    if (hit.documentId !== docIdRef.current) setActiveDocId(hit.documentId)
    goToPage(hit.pageNumber)
  }, [])

  // ---------------------------------------------------------------- viewer --
  useEffect(() => {
    if (!rasterRef.current || !overlayRef.current || !docUrl) return
    // Changing document tears the viewer down and rebuilds it. PDFium init
    // costs ~1s, which is acceptable per switch and far simpler than teaching
    // the worker to hold several documents — page handles are already pooled
    // per document, and two documents' pools would contend for the same bound.
    const worker = new PdfWorker()
    const viewer = new Viewer(rasterRef.current, overlayRef.current, worker, {
      tileSize: 512,
      // The viewer already reports each tile's cost; feed it to the budget
      // rather than measuring it a second time from outside.
      onTile: (ms) => {
        perfRef.current.record('tile', ms)
        // The arrival IS the reason to repaint. Previously nothing here asked
        // for one and the 120ms interval eventually noticed.
        requestPaint()
      },
      onReady: ({ pageCount: n, sizes }) => { setPageCount(n); setPageSizes([...sizes]) },
      onPage: (info) => {
        setPage({ width: info.width, height: info.height })
        /*
         * Keep the page-size TABLE current, not just the active page.
         *
         * `onReady` fires once, with whatever sizes the worker knew at boot;
         * the viewer then fills the rest in as pages load, in an array this
         * component never re-reads. So `pageSizes` was a snapshot of the boot
         * state forever.
         *
         * That table is what turns a stored calibration into a usable one: the
         * piece calculation skips any page whose size it does not know, and a
         * skipped page contributes no layout groups. The result was a scope
         * with a calibrated sheet, a direction and drawn areas producing no
         * planks, no rails and no order lines at all — while the plain area
         * roll-up, which reads the ACTIVE page rather than the table, went on
         * reporting square feet as if nothing were wrong.
         */
        setPageSizes((prev) => {
          const known = prev[info.index]
          if (known && known.width === info.width && known.height === info.height) return prev
          const next = [...prev]
          next[info.index] = { width: info.width, height: info.height }
          return next
        })
        setPageIndex((prev) => {
          // A different sheet is framed fresh rather than inheriting the last
          // one's scroll; a re-report of the same page keeps the user's view.
          if (prev !== info.index) { viewRef.current.ox = 0; viewRef.current.oy = 0 }
          return info.index
        })
        /*
         * Do NOT invent a zoom here.
         *
         * This used to fit the page against the hardcoded VW x VH constants
         * rather than the real viewport, so every page load jumped to a zoom
         * computed for a 1180x780 window that may not exist. Worse, switching
         * between two same-size sheets leaves `page.width/height` unchanged, so
         * the fit effect never re-ran to correct it and the wrong zoom stuck —
         * which is what anchored a sheet in the top-left instead of filling
         * the viewport.
         *
         * Zoom belongs to the fit mode, which knows the actual stage size.
         * Here we only adopt the new page box and re-clamp, which re-centres
         * the offsets that were just reset above.
         */
        viewRef.current = clampViewport(viewRef.current, info)
        viewer.requestVisible(viewRef.current)
        // The page box used to be announced here. It is a readout, not an
        // event, and now that status is shown as one it would toast on every
        // sheet change; `page` already carries the box for anyone who asks.
      },
      onError: (m) => setStatus(`error: ${m}`),
    })
    viewerRef.current = viewer
    viewer.boot('/pdfium.wasm', docUrl)
    const t = setTimeout(() => viewer.loadPage(0), 50)
    return () => {
      clearTimeout(t)
      if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      viewer.destroy()
      viewerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docUrl])

  // Push committed markups into the viewer overlay.
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    const set: OverlaySet = toOverlay(markups, scopes)
    v.setOverlay(set)
    requestPaint()
  }, [markups, scopes, requestPaint])

  // Recompute quantities whenever markups or calibration change.
  useEffect(() => {
    if (!cal) { setQuantities([]); return }
    /*
     * The DOCUMENT's markups, measured page by page.
     *
     * This read the current PAGE's markups while the piece calculation beside
     * it reads the whole document — so the same panel showed "Area 0 SF" next
     * to "231 panels" whenever the open sheet happened to carry none of that
     * scope's takeoff. Two numbers under one heading, aggregated over
     * different things, with nothing saying so.
     *
     * It was page-scoped for a reason: `calculateScopeQuantities` takes ONE
     * calibration, and measuring an off-screen markup against the open sheet's
     * box is how a quantity comes out confidently wrong. So the fix is not to
     * hand it everything — it is to run it per page, each with that page's own
     * calibration and box, and add the rows up. A page with no calibration
     * contributes nothing rather than being measured at another page's scale.
     */
    /*
     * Bucketed by page AND by scale region (plan 14.2).
     *
     * This grouped by page alone, which is right until a sheet carries more
     * than one scale — a details page with four details on it measured all
     * four at whichever number the page held, so three of them were wrong and
     * looked entirely plausible.
     *
     * Grouping rather than measuring each markup on its own is what keeps
     * CUTOUTS working: a hole drawn inside detail 3 has to subtract from
     * detail 3's area, and it can only do that if the two are aggregated
     * together. A page with no regions yields exactly one bucket, so this is
     * the old behaviour where nothing has been drawn.
     */
    const buckets = bucketByScale(
      projectMarkups,
      projectRegions,
      (pageId) => projectCalibrations.get(pageId) ?? null,
    )
    setQuantities(scopes.map((s) => {
      const totals = new Map<string, QuantityResult>()
      for (const bucket of buckets) {
        // Boxes come from the store, keyed by page id, so a page in another
        // document is measured on its own terms rather than left out.
        const size = projectPageBoxes.get(bucket.pageId)
        if (size === undefined || bucket.feetPerPoint === null) continue
        const bucketCal = {
          feetPerPoint: bucket.feetPerPoint,
          pageWidth: size.width,
          pageHeight: size.height,
        }
        for (const row of calculateScopeQuantities(s, bucket.markups, bucketCal)) {
          const hit = totals.get(row.itemKey)
          if (hit) hit.quantity += row.quantity
          else totals.set(row.itemKey, { ...row })
        }
      }
      return { scope: s, rows: [...totals.values()] }
    }))

    /*
     * Pieces are rolled up across the WHOLE DOCUMENT, each page at its own
     * scale (plan 06.11).
     *
     * This used to hand the roll-up the open page's markups and the open page's
     * calibration. Both were wrong for any scope that spans sheets, which is
     * most of them: a ceiling continuing onto the next floor plan was simply
     * absent from the count, and had it been included it would have been
     * measured at whatever scale the sheet you happened to be looking at was
     * drawn to. A details sheet at 1/4" read against a plan at 1/8" comes out
     * four times its true area — and it looks perfectly plausible, which is
     * what makes it expensive.
     *
     * A page with no calibration is left out rather than borrowed against;
     * a missing number is recoverable and a confident wrong one is not.
     */
    const pageSize = { width: cal.pageWidth, height: cal.pageHeight }
    const calibrations = new Map<string, Calibration>()
    const pageBoxes = new Map<string, { width: number; height: number }>()
    /*
     * Keyed by page id across the PROJECT, from the store.
     *
     * This walked the open document's calibrations and looked each page's box
     * up in the viewer's array — which only knows the open document, so a
     * scope continuing into another file contributed nothing and the total
     * silently changed when you switched tabs.
     */
    for (const [pageId, feetPerPoint] of projectCalibrations) {
      const size = projectPageBoxes.get(pageId)
      if (size === undefined) continue
      calibrations.set(pageId, { feetPerPoint, pageWidth: size.width, pageHeight: size.height })
      pageBoxes.set(pageId, size)
    }

    setPieces(scopes.map((s) => ({
      scope: s,
      result: calculatePieces(s, projectMarkups, cal, {
        scopeDirection: scopeDefaultDirectionFrom(s.specifications),
        // AREA beats PAGE beats SCOPE. See `directionFrom` in the domain.
        pageDirections: pageDirectionsFrom(s.specifications),
        areaDirections: areaDirectionsFrom(s.specifications),
        perAreaOrigin: prefs['takeoff.perAreaOrigin'] === true,
        pageSize,
        calibrations,
        pageSizes: pageBoxes,
        // Layout resolves scale the same way the roll-up does, so a details
        // sheet's piece count agrees with its area instead of the two
        // disagreeing confidently.
        scaleRegions: projectRegions,
      }),
    })))
  }, [projectMarkups, projectCalibrations, projectPageBoxes, projectRegions, scopes, cal, prefs])

  useEffect(() => { piecesRef.current = pieces }, [pieces])

  /*
   * Name the window after the project (Aaron's request).
   *
   * Set from here rather than in Rust because Rust names a window from the id
   * in its URL — a hash — and the readable name only exists once the project
   * has been opened. An estimator picks between two or three bids from the
   * taskbar, and every window reading "REDBEAM — 3f9c1a" made that a guess.
   */
  useEffect(() => {
    const title = windowTitle(projectName, identity.role === 'context' ? 'context' : 'main')
    document.title = title
    if (!isTauri()) return
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        await getCurrentWindow().setTitle(title)
      } catch {
        // A window that keeps its old title is a cosmetic loss; failing the
        // render over it would not be.
      }
    })()
  }, [projectName, identity.role])

  // ------------------------------------------------------------- scale ----

  /** Sheets the scale picker is about to write to. Null when it is closed. */
  const [scaleTarget, setScaleTarget] = useState<number[] | null>(null)

  /** A region drawn but not yet given a scale. */
  const [pendingRegion, setPendingRegion] = useState<
    { rect: { x0: number, y0: number, x1: number, y1: number }, pageId: string } | null
  >(null)

  /** Read by the window's Escape handler, for the same reason `pendingCalRef` is. */
  const pendingRegionRef = useRef<typeof pendingRegion>(null)
  pendingRegionRef.current = pendingRegion

  /** Remove a region. Its markups fall back to the page scale, or to nothing. */
  const removeRegion = useCallback(async (id: string) => {
    const db = dbRef.current
    if (db === null) return
    await deleteScaleRegion(db, id)
    await reloadRegions(db)
    setStatus('scale region removed')
    requestPaint()
  }, [reloadRegions, requestPaint])

  /** Save the region the picker was just answered for. */
  const commitRegion = useCallback(async (
    feetPerPoint: number, source: string, label: string,
  ) => {
    const db = dbRef.current
    if (db === null || pendingRegion === null) return
    await saveScaleRegion(db, {
      id: `sr-${Math.random().toString(36).slice(2, 10)}`,
      documentId: docIdRef.current,
      pageId: pendingRegion.pageId,
      label,
      x0: pendingRegion.rect.x0,
      y0: pendingRegion.rect.y0,
      x1: pendingRegion.rect.x1,
      y1: pendingRegion.rect.y1,
      feetPerPdfPoint: feetPerPoint,
      source,
    })
    await reloadRegions(db)
    setPendingRegion(null)
    draftRef.current = emptyDraft('scale-region')
    setStatus(`scale region: ${scaleLabel(feetPerPoint)}`)
    requestPaint()
  }, [pendingRegion, reloadRegions, requestPaint])

  const scaleOfPage = useCallback(
    // `targetPage` rather than `page`: the sheet is an ARGUMENT, so there is no
    // current page for it to be a stale read of. See pageIdentity.test.ts.
    (targetPage: number) =>
      projectCalibrations.get(pageIdFor(docIdRef.current, targetPage)) ?? null,
    [projectCalibrations],
  )

  /**
   * Set one scale across a selection of sheets (plan 14.4).
   *
   * A stated scale needs no measuring — a plotted sheet is at true size, so
   * `1/8" = 1'-0"` IS a feet-per-point — which is why this can cover a whole
   * 400-series while the reference-line tool cannot.
   *
   * The write is one transaction in the store. Half a selection carrying a new
   * scale and half carrying the old one is a set where some sheets measure and
   * some do not, with nothing on screen saying which.
   */
  const applyScaleToSelection = useCallback(async (
    pages: number[], feetPerPoint: number, source: string,
  ) => {
    const db = dbRef.current
    if (db === null || pages.length === 0) return
    const documentId = docIdRef.current
    await applyScaleToPages(
      db,
      pages.map((targetPage) => ({ documentId, pageId: pageIdFor(documentId, targetPage) })),
      feetPerPoint,
      source,
    )
    // Re-read rather than patching the map by hand: the roll-up measures every
    // page from this, and a stale entry is a wrong quantity.
    setProjectCalibrations(await listAllCalibrations(db))
    // The open sheet's own calibration drives the status line and the tools.
    if (pages.includes(pageIndexRef.current)) {
      setCal({ feetPerPoint, pageWidth: page.width, pageHeight: page.height })
    }
    setStatus(pages.length === 1
      ? `scale set: ${scaleLabel(feetPerPoint)}`
      : `scale set on ${pages.length} sheets: ${scaleLabel(feetPerPoint)}`)
    setScaleTarget(null)
    saveRef.current()
    requestPaint()
  }, [page.width, page.height, requestPaint])

  /**
   * Markups on the drawing that is open, which is what the write-back writes.
   *
   * Counted from `projectMarkups` rather than `docMarkups`, because the latter
   * holds only the open PAGE and the export covers every sheet in the file.
   */
  const markupsOnOpenDrawing = useMemo(
    () => projectMarkups.filter((m) => m.documentId === activeDocId).length,
    [projectMarkups, activeDocId],
  )

  /**
   * Save the open drawing with its markups on it (plan 10.3).
   *
   * The quantities and the report already leave the app; this is the half a
   * spreadsheet cannot carry — the sheet somebody argues about later.
   */
  const exportMarkedDrawing = useCallback(async (): Promise<string | null> => {
    const doc = documents.find((d) => d.id === activeDocId)
    if (doc === undefined) return 'No drawing is open.'
    return exportMarkedPdf({
      documentId: doc.id,
      documentName: doc.displayName || doc.relativePath,
      markups: projectMarkups,
      scopes,
      calibrations: projectCalibrations,
      pageBoxes: projectPageBoxes,
      readBytes: () => projectBridge.readDocument(projectPath, doc.relativePath),
      // A native Save As on the desktop; the downloader only in the browser.
      save: (fileName, bytes) => {
        void saveFile(bytes, {
          name: fileName, type: 'application/pdf', filter: { name: 'PDF drawing', extensions: ['pdf'] },
        }).then((o) => setStatus(saveOutcomeText(o, 'marked-up PDF')))
      },
    })
  }, [
    documents, activeDocId, projectMarkups, scopes,
    projectCalibrations, projectPageBoxes, projectPath,
  ])

  useEffect(() => { activeScopeRef.current = activeScope }, [activeScope])
  useEffect(() => { calRef.current = cal }, [cal])


  useEffect(() => { openEstimateIdRef.current = openEstimateId }, [openEstimateId])


  /**
   * Pull the document's outline and page labels once it has booted.
   *
   * `requestIndex` de-duplicates: calling it twice returns the same in-flight
   * promise, so React's development double-invoke does not queue two walks of
   * the bookmark tree. The failure path sets `none` rather than surfacing an
   * error, because an unbookmarked PDF is ordinary and the sheet index falls
   * back to page labels without it.
   */
  useEffect(() => {
    const v = viewerRef.current
    if (!v || pageCount === 0) return
    let cancelled = false
    void v.requestIndex().then((ix) => {
      if (cancelled) return
      setDocIndex({ outline: ix.outline, labels: [...ix.labels], shape: ix.shape })
    }).catch(() => {
      if (!cancelled) setDocIndex({ outline: [], labels: [], shape: 'none' })
    })
    return () => { cancelled = true }
  }, [activeDocId, pageCount])

  /**
   * Load the project's bidding rounds and, for whichever is open, the scopes
   * and drawings it owns.
   *
   * The contributing-file set is DERIVED from accepted markups on every read
   * rather than stored — a document leaves the estimate the moment its last
   * markup does, and a cached list would keep claiming a drawing nobody
   * measures any more.
   */
  const refreshEstimates = useCallback(async (openId?: string | null) => {
    const db = dbRef.current
    if (!db) return
    const rounds = await listEstimates(db)
    setEstimates(rounds.map((e) => ({
      id: e.id, name: e.name, scopeCount: e.scopeCount, markupCount: e.markupCount,
    })))
    setEstimatesLoaded(true)
    const id = openId === undefined ? openEstimateIdRef.current : openId
    if (id === null) {
      setEstimateScopeIds([]); setEstimateFiles([]); setEstimateScopesLoaded(true); return
    }
    const [ids, files] = await Promise.all([
      listEstimateScopeIds(db, id),
      estimateDocuments(db, id),
    ])
    setEstimateScopeIds(ids)
    setEstimateScopesLoaded(true)
    setEstimateFiles(files)
  }, [])

  const createEstimate = useCallback(async (name: string) => {
    const db = dbRef.current
    if (!db) return
    const id = `estimate-${crypto.randomUUID()}`
    await createEstimateRow(db, id, name)
    saveRef.current?.()
    await refreshEstimates(id)
    setOpenEstimateId(id)
    void broadcastChange('estimates', identity.projectId ?? 'default')
  }, [refreshEstimates, identity.projectId])

  /**
   * Open the first bidding round automatically.
   *
   * Migration 006 adopts any pre-estimate scopes into an initial round, so a
   * real project always has one; landing on a one-row list to click through
   * would be a step with nothing in it. A project with several rounds still
   * opens the most recent, which is the one being worked.
   */
  useEffect(() => {
    if (backend === null) return
    void refreshEstimates(openEstimateIdRef.current)
  }, [backend, refreshEstimates, scopes.length, markups.length])

  /*
   * Once. This re-ran whenever `openEstimateId` went back to null, so the
   * "Estimates" breadcrumb reopened the first round on the next render and
   * the list of rounds could not be reached at all. Aaron: "Why can't I go
   * back to the root estimates page?" The automatic open is for landing, not
   * for every time the list is asked for.
   */
  const autoOpenedRound = useRef(false)
  useEffect(() => {
    if (autoOpenedRound.current) return
    if (openEstimateId === null && estimates.length > 0) {
      autoOpenedRound.current = true
      setOpenEstimateId(estimates[0]!.id)
      void refreshEstimates(estimates[0]!.id)
    }
  }, [estimates, openEstimateId, refreshEstimates])


  /** Run an undoable command, then resync and persist. */
  const runCommand = useCallback(async (cmd: Parameters<UndoStack['run']>[0]) => {
    const u = undoRef.current
    if (!u) return
    await u.run(cmd)
    setUndoState(u.state)
    await syncMarkups()
    saveRef.current()
    // Tell the other windows on this project. No-op outside Tauri.
    void broadcastChange('markups', identity.projectId ?? 'default')
  }, [syncMarkups, identity.projectId])

  const doUndo = useCallback(async () => {
    const db = dbRef.current, u = undoRef.current
    if (!db || !u) return
    const cmd = await u.undo()
    if (!cmd) return
    setUndoState(u.state)
    setSelectedIds([]); selectedRef.current = []
    await syncMarkups()
    const c = await getCalibration(db, pageIdFor(docIdRef.current, pageIndexRef.current))
    setCal(c ? { feetPerPoint: c.feetPerPdfPoint, pageWidth: page.width, pageHeight: page.height } : null)
    setStatus(`undid ${cmd.label}`)
    saveRef.current()
  }, [syncMarkups, page.width, page.height])

  const doRedo = useCallback(async () => {
    const db = dbRef.current, u = undoRef.current
    if (!db || !u) return
    const cmd = await u.redo()
    if (!cmd) return
    setUndoState(u.state)
    await syncMarkups()
    const c = await getCalibration(db, pageIdFor(docIdRef.current, pageIndexRef.current))
    setCal(c ? { feetPerPoint: c.feetPerPdfPoint, pageWidth: page.width, pageHeight: page.height } : null)
    setStatus(`redid ${cmd.label}`)
    saveRef.current()
  }, [syncMarkups, page.width, page.height])


  // Another window on this project changed something: reload from the store.
  // The core is the single source of truth, so re-reading is both correct and
  // cheap enough at these row counts.
  useEffect(() => {
    if (page.width === 0) return
    let stop: (() => void) | undefined
    let cancelled = false
    void onChange(
      () => {
        void (async () => {
          const db = dbRef.current
          if (!db) return
          await syncMarkups()
          const c = await getCalibration(db, pageIdFor(docIdRef.current, pageIndexRef.current))
          setCal(c ? { feetPerPoint: c.feetPerPdfPoint, pageWidth: page.width, pageHeight: page.height } : null)
          setStatus('updated from another window')
        })()
      },
      { projectId: identity.projectId ?? 'default' },
    ).then((un) => {
      if (cancelled) un()
      else stop = un
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [identity.projectId, syncMarkups, page.width, page.height])

  /**
   * Abandon whatever is being drawn and drop any selection.
   *
   * Bound to Escape AND to right-click. Right-click is what an estimator's
   * hands already do to back out of a tool — every drawing application they
   * use works that way — and in this one it used to open the WebView's own
   * "Save image as / Inspect" menu over the sheet, which is the browser
   * showing through the app.
   */
  const cancelDraft = useCallback(() => {
    draftRef.current = emptyDraft(draftRef.current.tool)
    // The dimension keeps its own draft, and Escape left its first point
    // standing: the next click closed a dimension nobody was drawing.
    dimensionDraftRef.current = emptyDimensionDraft(dimensionDraftRef.current.ortho)
    setSelectedIds([])
    selectedRef.current = []
    requestPaint()
  }, [requestPaint])

  // ------------------------------------------------------------ committing --
  const commitDraft = useCallback(async () => {
    const db = dbRef.current
    const d = draftRef.current
    if (!db || !isCommittable(d) || page.width === 0) return

    if (d.tool === 'direction') {
      // Not a markup: the orientation belongs to the SCOPE, not the page. Two
      // scopes on one sheet routinely run different ways, and storing it per
      // page would make that unrepresentable.
      const [a, b] = d.points
      /*
       * `scopesRef`, not `scopes`.
       *
       * This read the STATE while `scopes` was missing from the dependency
       * array below, so the callback closed over the scope list from an
       * earlier render — and then wrote `{...sc.specifications}` back. Setting
       * an orientation therefore RESTORED whatever the specification looked
       * like when the closure was made, silently discarding every measure
       * typed since: spacing, reveal, rail length, rail spacing. The user saw
       * fields they had filled in emptying themselves for no reason, and the
       * piece count that depended on them never arrived.
       *
       * A merge is only as good as the thing it merges into. Every write path
       * in this file reads its base through a ref for exactly this reason.
       */
      const sc = scopesRef.current.find((x) => x.id === activeScope)
      if (!a || !b || !sc) return
      if (a.x === b.x && a.y === b.y) {
        setStatus('direction needs two different points')
        draftRef.current = emptyDraft('direction')
        requestPaint()
        return
      }
      await saveScope({
        ...sc,
        specifications: {
          ...sc.specifications,
          // Same stale-closure trap as the markup write below: the ref is the
          // only thing that knows which page this actually happened on.
          scopeDefaultDirection: { sourcePage: pageIndexRef.current, x1: a.x, y1: a.y, x2: b.x, y2: b.y },
        },
      })
      setStatus(`orientation set for ${sc.label}`)
      draftRef.current = emptyDraft('direction')
      requestPaint()
      return
    }

    if (d.tool === 'calibrate') {
      // hand off to the inline form; the draft stays on screen behind it
      const length = draftLengthPdfPoints(d, page.width, page.height)
      // Eagerly, so the very next click is already refused (see onPointerDown).
      pendingCalRef.current = length
      setPendingCal(length)
      setCalError(null)
      return
    }

    /*
     * A scale region: the box is drawn, then the scale is chosen for it.
     *
     * Deliberately the same two-step as calibrate — geometry first, meaning
     * second — because the box on its own is not a measurement of anything and
     * committing it without a scale would leave a rectangle on the sheet that
     * silently governs nothing.
     */
    if (d.tool === 'scale-region') {
      const a = d.points[0]!
      const b = d.points[1]!
      const pending = {
        rect: { x0: a.x, y0: a.y, x1: b.x, y1: b.y },
        // The ref, not the state: by the time the picker is answered the
        // person may well have paged away, and the region belongs to the sheet
        // it was drawn on.
        pageId: pageIdFor(docIdRef.current, pageIndexRef.current),
      }
      pendingRegionRef.current = pending
      setPendingRegion(pending)
      return
    }

    const kind: Markup['kind'] =
      d.tool === 'area' ? 'area'
      : d.tool === 'cutout' ? 'cutout'
      : d.tool === 'shape' ? 'shape'
      : d.tool === 'polyline' ? 'polyline'
      : 'count'
    const rings = kind === 'count' ? d.points.map((p) => [p]) : [d.points]
    /*
     * `pageIndexRef`, not `pageIndex`.
     *
     * This read the STATE while `pageIndex` was missing from the dependency
     * array below, so the callback closed over the page index from first
     * render and never saw another. Every markup drawn on any page was written
     * to page 1, silently and forever — the geometry was correct, the sheet it
     * was filed under was not, and nothing anywhere reported an error.
     *
     * The refs exist precisely so a write cannot be wrong about where it is
     * going; every other write path in this file already uses them.
     */
    const cmds = rings.map((ring) => cmdCreate({
      id: uid(),
      documentId: docIdRef.current,
      pageId: pageIdFor(docIdRef.current, pageIndexRef.current),
      scopeId: activeScope,
      kind, rings: [ring], origin: 'user', reviewState: 'accepted',
    }))
    await runCommand(cmds.length === 1 ? cmds[0]! : cmdBatch(`create ${cmds.length} ${kind}`, cmds))
    draftRef.current = emptyDraft(d.tool)
    requestPaint()
  }, [activeScope, page.width, page.height, requestPaint])

  /**
   * Persist a calibration AND update the view of it.
   *
   * One function because there are now two entry points — the calibrate tool
   * and the automation bridge — and the second one shipped without the
   * `setCal` the first one does. The row landed in the database and the app
   * went on reporting itself uncalibrated with empty quantities, which is a
   * silent wrong answer rather than a visible failure.
   */
  const commitCalibration = useCallback(async (
    built: Calibration,
    source: string,
    // Undo depth counts only `user` entries so Ctrl+Z steps past agent work.
    // An agent calibration logged as `user` would make the estimator's next
    // undo revert something they never did.
    origin: string = 'user',
  ) => {
    await runCommand(cmdCalibrate(
      docIdRef.current,
      pageIdFor(docIdRef.current, pageIndexRef.current),
      cal?.feetPerPoint ?? null,
      built.feetPerPoint,
      source,
      origin,
    ))
    setCal(built)
    setStatus(`calibrated: 1 pt = ${built.feetPerPoint.toFixed(6)} ft`)
    saveRef.current()
    requestPaint()
  }, [cal, runCommand, requestPaint])

  const applyCalibration = useCallback(async (raw: string, unit: string) => {
    const db = dbRef.current
    if (!db || pendingCal === null) return
    const value = parseNumberOrFraction(raw)
    if (value === null) { setCalError(`can't read "${raw}"`); return }
    const built = calibrationFromReference(pendingCal, value, unit, page.width, page.height)
    if (!built) { setCalError(`unknown unit "${unit}"`); return }
    await commitCalibration(built, 'reference-line')
    setPendingCal(null)
    setCalError(null)
    draftRef.current = emptyDraft('calibrate')
  }, [pendingCal, page.width, page.height, commitCalibration])

  const cancelCalibration = useCallback(() => {
    setPendingCal(null)
    setCalError(null)
    draftRef.current = emptyDraft('calibrate')
    requestPaint()
  }, [requestPaint])

  /*
   * Beside `cancelCalibration` rather than beside the region drawing it
   * belongs to, because the window's Escape handler needs both and is declared
   * between the two. Referencing it from there while it lived below would put
   * it in the effect's dependency array before its own initializer ran.
   */
  const cancelRegion = useCallback(() => {
    setPendingRegion(null)
    draftRef.current = emptyDraft('scale-region')
    requestPaint()
  }, [requestPaint])

  const removeMarkups = useCallback(async (ids: string[]) => {
    const present = ids
      .map((id) => markupsRef.current.find((m) => m.id === id))
      .filter((m): m is Markup => !!m)
    if (present.length === 0) return
    const cmds = present.map((m) => cmdRemove({ id: m.id, kind: m.kind, origin: 'user' }))
    // One undo step for one gesture: deleting six markups and pressing Ctrl+Z
    // six times to get them back is not undo, it is punishment.
    await runCommand(cmds.length === 1 ? cmds[0]! : cmdBatch(`delete ${cmds.length} markups`, cmds))
  }, [runCommand])

  /** Copy the selection. Geometry only — ids are minted fresh on paste. */
  const copySelection = useCallback(() => {
    const ids = new Set(selectedRef.current)
    clipboardRef.current = markupsRef.current.filter((m) => ids.has(m.id)).map((m) => ({
      ...m, rings: m.rings.map((r) => r.map((p) => ({ ...p }))),
    }))
    if (clipboardRef.current.length > 0) {
      setStatus(`copied ${clipboardRef.current.length} markup${clipboardRef.current.length === 1 ? '' : 's'}`)
    }
  }, [])

  /**
   * Paste onto the CURRENT page, nudged so the copy is visibly distinct.
   *
   * Pasting onto the current page rather than the source page is the point:
   * the same detail repeats across sheets, and re-tracing it on each one is the
   * work this is meant to remove.
   */
  const pasteClipboard = useCallback(async () => {
    const src = clipboardRef.current
    if (src.length === 0) return
    const NUDGE = 0.01
    const docId = docIdRef.current
    const pageId = pageIdFor(docId, pageIndexRef.current)
    const created: Markup[] = []
    const cmds = src.map((m) => {
      const rings = m.rings.map((r) => r.map((p) => ({ x: p.x + NUDGE, y: p.y + NUDGE })))
      const id = uid()
      created.push({ id, scopeId: m.scopeId, documentId: docId, pageId, kind: m.kind, rings })
      return cmdCreate({
        id, documentId: docId, pageId, scopeId: m.scopeId,
        kind: m.kind, rings, origin: 'user', reviewState: 'accepted',
      })
    })
    await runCommand(cmds.length === 1 ? cmds[0]! : cmdBatch(`paste ${cmds.length} markups`, cmds))
    const ids = created.map((m) => m.id)
    setSelectedIds(ids); selectedRef.current = ids
  }, [runCommand])

  /** Move every selected markup to another scope, as one undo step. */
  const reassignSelection = useCallback(async (scopeId: string | null) => {
    const ids = new Set(selectedRef.current)
    const present = markupsRef.current.filter((m) => ids.has(m.id) && m.scopeId !== scopeId)
    if (present.length === 0) return
    const cmds = present.map((m) => cmdReassign(m.id, m.scopeId, scopeId))
    await runCommand(cmds.length === 1 ? cmds[0]! : cmdBatch(`rescope ${cmds.length} markups`, cmds))
  }, [runCommand])


  const removeMarkup = useCallback(async (id: string) => {
    const m = markupsRef.current.find((x) => x.id === id)
    if (!m) return
    await runCommand(cmdRemove({ id, kind: m.kind, origin: 'user' }))
  }, [runCommand])

  // ------------------------------------------------------------- interaction --
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      shiftRef.current = e.shiftKey
      const d = draftRef.current
      const mod = e.ctrlKey || e.metaKey

      /*
       * A key pressed into a text field belongs to the text field.
       *
       * This listener is on `window` and had no such check, so every shortcut
       * below fired while you were typing — and most of them called
       * preventDefault, which took the keystroke away from the field as well.
       * Typing "area" into the sheet filter switched the tool three times and
       * landed on Cutout. Ctrl+A selected every markup in the document instead
       * of the text you meant to replace; Ctrl+C copied markups over what you
       * had highlighted; Backspace with a trace in progress deleted a point
       * from the trace rather than a character from the field; Enter committed
       * the trace.
       *
       * What survives is what is still about the application rather than the
       * text: Escape, and the two shortcuts that OPEN something (settings and
       * find), which is what a person typing into a stale field is reaching
       * for when they press them.
       */
      if (isTextEntry(e.target) && !survivesTextEntry(e)) return
      if (e.key === ' ' && !mod) {
        // Held, not pressed: the pointer handlers read it. preventDefault so
        // the page does not scroll and a focused button is not "clicked".
        if (!spaceRef.current) {
          spaceRef.current = true
          const el = stageRef.current
          if (el !== null) el.style.cursor = 'grab'
        }
        e.preventDefault()
        return
      }
      // Ctrl+, is the settings shortcut on every platform the Qt build shipped
      // to, and the Qt shell forwards it from a Context Window to its owner.
      if (mod && e.key === ',') { e.preventDefault(); settingsOpen ? setSettingsOpen(false) : openSettings(); return }
      if (mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); copySelection(); return }
      if (mod && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); void pasteClipboard(); return }
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        const all = markupsRef.current.map((m) => m.id)
        setSelectedIds(all); selectedRef.current = all
        requestPaint()
        return
      }
      if (mod && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        openSearch()
        return
      }
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) void doRedo(); else void doUndo()
        return
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        void doRedo()
        return
      }
      if (e.key === 'Escape') {
        /*
         * A question waiting on a drawn line outranks the line.
         *
         * The pinned entries answer Escape themselves, but only while focus is
         * inside them — and it does not stay there: measuring a reference line
         * and then clicking the sheet to see it better puts focus on the stage.
         * Escape then cleared the line and left "how long is this?" on screen
         * asking about geometry that no longer existed. The next number typed
         * would have calibrated the page against nothing.
         */
        if (pendingCalRef.current !== null) { cancelCalibration(); return }
        if (pendingRegionRef.current !== null) { cancelRegion(); return }
        // The markup menu closed only on a click on its scrim; Escape, the
        // key every menu closes on, left it standing over the sheet.
        setMarkupMenu(null)
        /*
         * Two presses, two meanings. With something half-drawn, Escape
         * abandons it and keeps the tool — the next shape is usually the
         * same kind. With nothing in progress there is nothing to abandon,
         * so Escape puts the tool down and goes back to Pan; a crosshair
         * with no way out is how a stray click draws something. Right-click
         * does the same (see onContextMenu). Aaron asked for both.
         */
        const drawing = draftRef.current.points.length > 0 || dimensionDraftRef.current.a !== null
        cancelDraft()
        if (!drawing && toolRef.current !== 'pan') setTool('pan')
      }
      else if (e.key === 'Delete' && selectedRef.current.length > 0) {
        const ids = selectedRef.current
        setSelectedIds([]); selectedRef.current = []
        void removeMarkups(ids)
      }
      else if (e.key === 'Enter') { void commitDraft() }
      else if (e.key === 'Backspace' && d.points.length > 0) {
        draftRef.current = { ...d, points: d.points.slice(0, -1) }; requestPaint()
      }
      /*
       * Tool shortcuts belong to the DRAWING, and a dialog is not it.
       *
       * Only text entry was excluded, so every unmodified letter still reached
       * the toolbar through Settings, the BOM and the scope editor — arming a
       * tool nobody chose, on a sheet nobody was looking at, to be discovered
       * by the next click drawing something. Escape and the modified
       * shortcuts above are unaffected: those are still about the application.
       */
      else if (tool === 'dimension' && e.key === 'Backspace') {
        dimensionDraftRef.current = dimensionDraftBack(dimensionDraftRef.current)
        requestPaint()
      }
      else if (dialogOpenRef.current) { /* a dialog owns the keyboard */ }
      else if (e.key === 'v') { setTool('pan') }
      else if (e.key === 'a') { setTool('area') }
      else if (e.key === 'l') { setTool('polyline') }
      else if (e.key === 'c') { setTool('count') }
      else if (e.key === 'x') { setTool('cutout') }
      else if (e.key === 's' && !mod) { setTool('shape') }
      else if (e.key === 'k') { setTool('calibrate') }
      // Shift-K: the other way to set a scale — a box on the sheet rather than
      // a measured line, for the page that carries more than one.
      else if (e.key === 'K') { setTool('scale-region') }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      shiftRef.current = e.shiftKey
      if (e.key === ' ') {
        spaceRef.current = false
        const el = stageRef.current
        if (el !== null) el.style.cursor = toolRef.current === 'pan' ? 'grab' : 'crosshair'
      }
    }
    // Alt-tabbing away with space held would leave it held forever.
    const onBlur = () => {
      spaceRef.current = false
      const el = stageRef.current
      if (el !== null) el.style.cursor = toolRef.current === 'pan' ? 'grab' : 'crosshair'
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [commitDraft, requestPaint, removeMarkups, doUndo, doRedo, copySelection, pasteClipboard,
    cancelCalibration, cancelRegion])

  /*
   * Synced during RENDER, not in an effect.
   *
   * These are "latest value" refs: every write path reads them to decide which
   * page and document a row belongs to. Updating them in an effect means they
   * lag by one effect pass — an effect declared ABOVE this line would still see
   * the previous page on the render where the page changed, which is a subtler
   * version of the stale-closure bug that filed every markup under page 1.
   *
   * Assigning during render is the sanctioned pattern for this: the value is
   * derived from props/state and read only by callbacks and effects, never
   * during rendering itself.
   */
  pageIndexRef.current = pageIndex
  scopesRef.current = scopes
  // The painter runs outside render and needs both: which regions govern this
  // sheet, and whether the scale tool is in hand (regions dim when it is not).
  regionsRef.current = projectRegions
  toolRef.current = tool
  // A rail pane is deliberately NOT in this list, and neither is anything in
  // the estimates panel: they sit beside the drawing rather than over it, so
  // the drawing's shortcuts still belong to the user. What IS in it is every
  // question still waiting for an answer — a length, a region's scale, a
  // selection's scale — because a letter typed at one of those is an answer,
  // not a tool.
  dialogOpenRef.current = settingsOpen || paletteOpen
    || pendingCal !== null || pendingRegion !== null || scaleTarget !== null

  /*
   * Scale regions on the sheet being looked at.
   *
   * Below the ref sync deliberately. `pageIndexRef.current` is only the
   * current page AFTER that line has run — a memo declared above it reads the
   * previous page on the render where the page changed, which is the same
   * one-render lag the sibling guard in pageIdentity.test.ts exists to
   * prevent. `pageIndex` stays in the deps so it recomputes.
   */
  const regionsOnThisSheet = useMemo(
    () => projectRegions.get(pageIdFor(docIdRef.current, pageIndexRef.current)) ?? [],
    [projectRegions, pageIndex, activeDocId],
  )
  docMarkupsRef.current = docMarkups
  quantitiesRef.current = quantities
  docIdRef.current = activeDocId ?? FALLBACK_DOC.id
  useEffect(() => { markupsRef.current = markups }, [markups])

  // Dev-only inspection hook. Lets a test read the real geometry and calibration
  // instead of inferring them from rendered text. Stripped from production builds.
  useEffect(() => {
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__redbeam = {
        markups, cal, scopes, selectedIds,
        page, pageIndex, pageCount, activeDocId, documents, ingestNote,
        goToPage,
        viewer: () => viewerRef.current,
        undoState,
        view: () => ({ ...viewRef.current }),
        activity: () => (dbRef.current ? listActivity(dbRef.current, 20) : Promise.resolve([])),
        coverage: () => (dbRef.current ? textIndexCoverage(dbRef.current) : Promise.resolve(null)),
        rawPageText: () => (dbRef.current
          ? dbRef.current.all('SELECT page_id, document_id, length(content) AS n FROM page_text')
          : Promise.resolve([])),
        rawPages: () => (dbRef.current
          ? dbRef.current.all('SELECT id, document_id, page_number FROM pages')
          : Promise.resolve([])),
        indexNow: async () => {
          const db = dbRef.current, v = viewerRef.current
          if (!db || !v) return 'no db/viewer'
          const t = await v.requestText(pageIndexRef.current)
          const pid = pageIdFor(docIdRef.current, pageIndexRef.current)
          await indexPageText(db, { pageId: pid, documentId: docIdRef.current, content: t.text })
          return { pid, docId: docIdRef.current, chars: t.text.length }
        },
        refCount: () => markupsRef.current.length,
        hitAt: (x: number, y: number) =>
          hitTest(x, y, markupsRef.current, viewRef.current, page.width, page.height),
      }
    }
  }, [markups, cal, scopes, selectedIds, page, undoState, pageIndex, pageCount, goToPage, activeDocId, documents, ingestNote])
  useEffect(() => { selectedRef.current = selectedIds }, [selectedIds])

  useEffect(() => {
    draftRef.current = emptyDraft(tool)
    // leaving the pan tool drops the selection; editing only happens with Pan
    if (tool !== 'pan') { setSelectedIds([]); selectedRef.current = []; hoverRef.current = null }
    requestPaint()
  }, [tool, requestPaint])


  /** Screen-space vertices worth snapping to: the live draft plus committed markups. */
  const snapVertices = useCallback((): Array<{ x: number; y: number }> => {
    if (page.width === 0) return []
    const v = viewRef.current
    const out: Array<{ x: number; y: number }> = []
    for (const p of draftRef.current.points) {
      out.push(normalizedToScreen(p.x, p.y, v, page.width, page.height))
    }
    for (const m of markups) {
      for (const ring of m.rings) {
        for (const p of ring) {
          const s = normalizedToScreen(p.x, p.y, v, page.width, page.height)
          // Only what is actually on screen — and "on screen" is the CURRENT
          // viewport, not the 1180x780 the constants assume. On a wider window
          // this was culling snap targets that were plainly visible.
          if (s.x >= -20 && s.y >= -20 && s.x <= v.vw + 20 && s.y <= v.vh + 20) out.push(s)
        }
      }
    }
    return out
  }, [markups, page.width, page.height])

  /** Apply snapping to a raw stage-relative screen point. */
  const applySnap = useCallback((sx: number, sy: number) => {
    const raster = rasterRef.current
    if (!raster) return { x: sx, y: sy, snap: null as SnapResult | null }
    const pts = draftRef.current.points
    const last = pts[pts.length - 1]
    const anchor = last ? normalizedToScreen(last.x, last.y, viewRef.current, page.width, page.height) : null
    const res = snapPoint(sx, sy, {
      ...DEFAULT_SNAP,
      enabled: snapOn,
      raster,
      vertices: snapVertices(),
      anchor,
      ortho: shiftRef.current,
    })
    return { x: res.x, y: res.y, snap: res }
  }, [snapOn, snapVertices, page.width, page.height])



  /** Persist an edited ring and refresh state. */
  const commitGeometry = useCallback(async (
    id: string,
    ring: Array<{ x: number; y: number }>,
    before: Array<{ x: number; y: number }> | null,
    what = 'edit markup',
  ) => {
    if (!undoRef.current || !before) return
    if (JSON.stringify(before) === JSON.stringify(ring)) return   // no-op drag
    await runCommand(cmdEditGeometry(id, [before], [ring], what))
  }, [runCommand])

  /** Commit a multi-markup move as a single undoable step. */
  const commitMove = useCallback(async (
    ids: string[],
    origins: Map<string, Array<{ x: number; y: number }>>,
  ) => {
    const cmds = ids.flatMap((id) => {
      const before = origins.get(id)
      const after = markupsRef.current.find((m) => m.id === id)?.rings[0]
      if (!before || !after) return []
      if (JSON.stringify(before) === JSON.stringify(after)) return []
      return [cmdEditGeometry(id, [before], [after], 'move markup')]
    })
    if (cmds.length === 0) return
    await runCommand(cmds.length === 1 ? cmds[0]! : cmdBatch(`move ${cmds.length} markups`, cmds))
  }, [runCommand])

  /** Apply a live (unsaved) ring so dragging feels immediate. */
  const previewGeometry = useCallback((id: string, ring: Array<{ x: number; y: number }>) => {
    setMarkups((cur) => cur.map((m) => (m.id === id ? { ...m, rings: [ring] } : m)))
  }, [])

  /**
   * Pointers currently down, for pinch.
   *
   * A trackpad pinch arrives as a wheel event with ctrlKey, which onWheel
   * already handles. This is for a genuine two-finger touch on a touchscreen
   * or a pen display, which arrives as two pointers and never as a wheel.
   */
  const pinchRef = useRef<{
    points: Map<number, { x: number; y: number }>
    startDist: number
    startZoom: number
  } | null>(null)

  /**
   * The dimension under the pointer, if any, in the shape `hitTest` answers.
   *
   * `hitTest` knows the takeoff kinds and nothing else, so a committed
   * dimension could not be selected, moved or deleted — the tool that drew
   * it was the only thing that ever touched it. A dimension's own tester
   * answers for it here, after `hitTest` has had first refusal, so the pan
   * tool treats the two alike: its measured points are vertices and its line
   * moves it.
   */
  const hitDimensionAt = (hx: number, hy: number): Hit | null => {
    const dims = markupsRef.current.filter(
      (m) => m.kind === 'dimension' && (m as unknown as { content?: unknown }).content !== undefined,
    ) as unknown as DimensionMarkup[]
    if (dims.length === 0) return null
    const d = hitTestDimension(hx, hy, dims, viewRef.current, page.width, page.height)
    if (d === null) return null
    return { markupId: d.markupId, part: d.part === 'vertex' ? 'vertex' : 'inside', index: d.index }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    /*
     * Space held, or the middle button: pan, whatever the tool.
     *
     * Ahead of the primary-button check because the middle button IS the
     * gesture here, and ahead of the pending-gesture check because moving
     * the sheet to see a calibration line better is not answering it.
     */
    if (spaceRef.current || (e.pointerType === 'mouse' && e.button === 1)) {
      panOverrideRef.current = true
      dragRef.current = { x: e.clientX, y: e.clientY }
      // Capture keeps the drag alive past the stage's edge. A pointer the
      // browser does not consider active (a synthetic one, in a test) refuses
      // it; the pan still works, it just ends at the edge.
      try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* see above */ }
      e.preventDefault()
      return
    }
    /*
     * Only the primary button draws.
     *
     * Right-click means "back out" — it is handled in onContextMenu — and
     * middle-click means nothing here. Letting either through put a vertex on
     * the sheet as a side effect of cancelling, so a right-click both abandoned
     * the shape and added a point to the next one.
     */
    if (e.pointerType === 'mouse' && e.button !== 0) return
    /*
     * A gesture waiting for its answer owns the sheet. The calibration line
     * and the region box stay drawn while the dock asks what they mean, and
     * with no scrim over the drawing any more a click here would start a
     * second line on top of the first — and answer the question for neither.
     */
    /*
     * The refs, not the state. The second calibration click sets the pending
     * question, but a third click landing before React re-rendered still saw
     * `pendingCal === null` and appended a third point to a two-point line.
     * Aaron: "It shouldn't allow you to start drawing a third point."
     */
    if (pendingCalRef.current !== null || pendingRegionRef.current !== null) return
    if (e.pointerType === 'touch') {
      const r = e.currentTarget.getBoundingClientRect()
      const p = pinchRef.current ?? {
        points: new Map<number, { x: number; y: number }>(), startDist: 0, startZoom: 1,
      }
      p.points.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top })
      pinchRef.current = p
      if (p.points.size === 2) {
        // Second finger down: freeze the baseline. Measuring from the first
        // MOVE instead would drop the distance travelled before that frame and
        // make the gesture jump.
        const [a, b] = [...p.points.values()]
        p.startDist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        p.startZoom = viewRef.current.zoom
        // A pinch is not a drag. Cancel any pan the first finger started, or
        // the sheet slides while it scales.
        dragRef.current = null
        return
      }
    }
    if (tool === 'pan') {
      const r0 = e.currentTarget.getBoundingClientRect()
      const hx = e.clientX - r0.left, hy = e.clientY - r0.top
      const hit = hitTest(hx, hy, markupsRef.current, viewRef.current, page.width, page.height)
        ?? hitDimensionAt(hx, hy)
      // Capture keeps a drag alive past the stage's edge. A pointer the
      // browser does not consider active — a synthetic one, in a test —
      // refuses it, and the refusal must not abort the selection or the pan.
      try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* see above */ }

      if (hit) {
        // Shift extends the selection; a plain click replaces it. Clicking an
        // already-selected markup keeps the whole selection so a drag moves all
        // of them, which is what every editor does.
        const already = selectedRef.current.includes(hit.markupId)
        const next = e.shiftKey
          ? (already
              ? selectedRef.current.filter((x) => x !== hit.markupId)
              : [...selectedRef.current, hit.markupId])
          : (already ? selectedRef.current : [hit.markupId])
        setSelectedIds(next)
        selectedRef.current = next
        const m = markupsRef.current.find((x) => x.id === hit.markupId)
        const ring = m?.rings[0] ?? []

        dragOriginRef.current = ring.map((p) => ({ ...p }))

        if (hit.part === 'vertex') {
          if (e.altKey && m) {
            const next = removeVertexAt(ring, hit.index, m.kind)
            if (next) void commitGeometry(m.id, next, dragOriginRef.current, 'remove vertex')
            else setStatus('cannot remove — a shape needs its minimum vertices')
            dragOriginRef.current = null
            requestPaint()
            return
          }
          editRef.current = { mode: 'vertex', id: hit.markupId, index: hit.index }
        } else if (hit.part === 'edge' && e.altKey && m) {
          const next = insertVertexAt(ring, hit.index)
          void commitGeometry(m.id, next, dragOriginRef.current, 'insert vertex')
          dragOriginRef.current = null
          editRef.current = null
          requestPaint()
          return
        } else {
          const n = screenToNormalized(hx, hy, viewRef.current, page.width, page.height)
          // Move the whole selection, not just the markup under the cursor.
          const movingIds = selectedRef.current.includes(hit.markupId)
            ? selectedRef.current
            : [hit.markupId]
          const origins = new Map<string, Array<{ x: number; y: number }>>()
          for (const id of movingIds) {
            const mm = markupsRef.current.find((x) => x.id === id)
            if (mm?.rings[0]) origins.set(id, mm.rings[0].map((pt) => ({ ...pt })))
          }
          editRef.current = { mode: 'move', ids: movingIds, lastN: n, origins }
        }
        requestPaint()
        return
      }

      // Empty space: Shift starts a marquee, otherwise pan and clear.
      setSelectedIds([])
      selectedRef.current = []
      editRef.current = null
      if (e.shiftKey) {
        marqueeRef.current = { x0: hx, y0: hy, x1: hx, y1: hy }
        dragRef.current = null
      } else {
        marqueeRef.current = null
        dragRef.current = { x: e.clientX, y: e.clientY }
      }
      requestPaint()
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const s0 = applySnap(e.clientX - rect.left, e.clientY - rect.top)
    snapRef.current = s0.snap
    const p = screenToNormalized(s0.x, s0.y, viewRef.current, page.width, page.height)
    const d = draftRef.current

    /*
     * An area or a cutout starts as a possible RECTANGLE.
     *
     * Most ceilings, and very nearly every cutout, are rectangles, and clicking
     * four corners to say so is three clicks of ceremony. Pressing and dragging
     * gives the rectangle directly; pressing and releasing without moving falls
     * through to placing a vertex, so the polygon path is untouched and both
     * live on one tool. Which one you meant is decided on release, by whether
     * the pointer travelled — see onPointerUp.
     */
    /*
     * A dimension places two points and commits itself on the second.
     *
     * No Enter, unlike a polygon: a dimension is finished when its second end
     * is down, and asking for a keystroke to confirm something already
     * unambiguous is the ceremony this tool exists to avoid.
     */
    if (tool === 'dimension') {
      const next = dimensionDraftPlace(dimensionDraftRef.current, p, page.width, page.height)
      dimensionDraftRef.current = next
      if (next.b !== null) void commitDimensionDraft()
      requestPaint()
      return
    }

    /*
     * The highlight too. A highlighter is a drag across the thing being
     * marked; asking for three corners and Enter made the Highlight button
     * look broken, because nothing appeared until a gesture nobody makes
     * with a highlighter had been completed.
     */
    if ((tool === 'area' || tool === 'cutout' || tool === 'shape') && d.points.length === 0) {
      rectRef.current = { anchor: p, x1: s0.x, y1: s0.y, moved: false }
      try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* as in the pan branch */ }
    }

    // A two-point gesture is complete at two. Its commit hands off to a
    // question (calibrate, region) or writes (direction); either way there is
    // no third point to place.
    if ((tool === 'calibrate' || tool === 'direction' || tool === 'scale-region') && d.points.length >= 2) return

    draftRef.current = { ...d, points: [...d.points, p] }
    forceRender((n) => n + 1)
    if (tool === 'count'
        || ((tool === 'calibrate' || tool === 'direction' || tool === 'scale-region')
          && draftRef.current.points.length === 2)) {
      void commitDraft()
    }
    requestPaint()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const pinch = pinchRef.current
    if (pinch && pinch.points.has(e.pointerId)) {
      const r = e.currentTarget.getBoundingClientRect()
      pinch.points.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top })
      if (pinch.points.size === 2 && pinch.startDist > 0) {
        const [a, b] = [...pinch.points.values()]
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        const v = viewerRef.current
        if (v && dist > 0) {
          const next = Math.min(8, Math.max(0.05, pinch.startZoom * (dist / pinch.startDist)))
          // Anchor on the midpoint between the fingers, which is where the
          // gesture visually pivots.
          viewRef.current = clampViewport(
            zoomAbout(viewRef.current, next, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2),
            v.pageInfo,
          )
          v.requestVisible(viewRef.current)
          requestPaint()
        }
        return
      }
    }
    const v = viewerRef.current
    if (!v) return
    const rect = e.currentTarget.getBoundingClientRect()

    if (panOverrideRef.current) {
      const d = dragRef.current
      if (!d) return
      viewRef.current = clampViewport(
        { ...viewRef.current, ox: viewRef.current.ox - (e.clientX - d.x), oy: viewRef.current.oy - (e.clientY - d.y) },
        v.pageInfo,
      )
      dragRef.current = { x: e.clientX, y: e.clientY }
      v.requestVisible(viewRef.current)
      requestPaint()
      return
    }

    const rc = rectRef.current
    if (rc) {
      const s = applySnap(e.clientX - rect.left, e.clientY - rect.top)
      snapRef.current = s.snap
      rc.x1 = s.x
      rc.y1 = s.y
      // A few pixels of slop so a click with a shaky hand is still a click.
      // Measured against where the anchor IS on screen now, so a wheel pan
      // mid-press does not count as travel on its own.
      const a = normalizedToScreen(rc.anchor.x, rc.anchor.y, viewRef.current, page.width, page.height)
      if (Math.abs(rc.x1 - a.x) > 3 || Math.abs(rc.y1 - a.y) > 3) rc.moved = true
      if (rc.moved) {
        draftRef.current = {
          ...draftRef.current,
          points: rectPointsBetween(
            rc.anchor, screenToNormalized(rc.x1, rc.y1, viewRef.current, page.width, page.height),
          ),
          cursor: null,
        }
      }
      requestPaint()
      return
    }

    /*
     * The rubber band. Ortho is applied inside the draft, against the anchor,
     * so a constrained dimension snaps to the axis while it is being drawn
     * rather than jumping to it on release.
     */
    if (tool === 'dimension') {
      const s0 = applySnap(e.clientX - rect.left, e.clientY - rect.top)
      snapRef.current = s0.snap
      const p = screenToNormalized(s0.x, s0.y, viewRef.current, page.width, page.height)
      dimensionDraftRef.current = dimensionDraftMove(
        dimensionDraftRef.current, p, page.width, page.height,
      )
      requestPaint()
      return
    }

    if (tool === 'pan') {
      if (marqueeRef.current) {
        marqueeRef.current.x1 = e.clientX - rect.left
        marqueeRef.current.y1 = e.clientY - rect.top
        requestPaint()
        return
      }
      const ed = editRef.current
      if (ed) {
        const s0 = applySnap(e.clientX - rect.left, e.clientY - rect.top)
        snapRef.current = ed.mode === 'vertex' ? s0.snap : null
        const n = screenToNormalized(s0.x, s0.y, viewRef.current, page.width, page.height)
        const focusId = ed.mode === 'vertex' ? ed.id : ed.ids[0]
        const m = markupsRef.current.find((x) => x.id === focusId)
        if (!m) return
        const ring = m.rings[0] ?? []
        if (ed.mode === 'vertex') {
          const next = ring.map((p, i) => (i === ed.index ? n : p))
          previewGeometry(ed.id, next)
        } else {
          const dx = n.x - ed.lastN.x
          const dy = n.y - ed.lastN.y
          for (const id of ed.ids) {
            const cur = markupsRef.current.find((x) => x.id === id)?.rings[0]
            if (!cur) continue
            previewGeometry(id, cur.map((p) => ({ x: p.x + dx, y: p.y + dy })))
          }
          ed.lastN = n
        }
        requestPaint()
        return
      }
      // hover feedback for handles
      const hv = hitTest(e.clientX - rect.left, e.clientY - rect.top,
        markupsRef.current, viewRef.current, page.width, page.height)
        ?? hitDimensionAt(e.clientX - rect.left, e.clientY - rect.top)
      hoverRef.current = hv
      const d = dragRef.current
      if (!d) { requestPaint(); return }
      viewRef.current = clampViewport(
        { ...viewRef.current, ox: viewRef.current.ox - (e.clientX - d.x), oy: viewRef.current.oy - (e.clientY - d.y) },
        v.pageInfo,
      )
      dragRef.current = { x: e.clientX, y: e.clientY }
      v.requestVisible(viewRef.current)
      requestPaint()
      return
    }
    const s0 = applySnap(e.clientX - rect.left, e.clientY - rect.top)
    snapRef.current = s0.snap
    if (draftRef.current.points.length > 0) {
      draftRef.current = {
        ...draftRef.current,
        cursor: screenToNormalized(s0.x, s0.y, viewRef.current, page.width, page.height),
      }
    }
    requestPaint()
  }

  const onPointerUp = (e?: React.PointerEvent) => {
    const pinch = pinchRef.current
    if (pinch && e) {
      pinch.points.delete(e.pointerId)
      // Keep the map alive while one finger remains: lifting one finger of a
      // pinch should not restart a pan under the other.
      if (pinch.points.size === 0) pinchRef.current = null
      else if (pinch.points.size < 2) pinch.startDist = 0
      if (e.pointerType === 'touch') return
    }
    if (panOverrideRef.current) {
      // The drag was a pan and nothing else: no vertex went down, so there is
      // no rectangle, marquee or edit to finish.
      panOverrideRef.current = false
      dragRef.current = null
      return
    }
    dragRef.current = null

    const rc = rectRef.current
    if (rc) {
      rectRef.current = null
      if (rc.moved) {
        draftRef.current = {
          ...draftRef.current,
          points: rectPointsBetween(
            rc.anchor, screenToNormalized(rc.x1, rc.y1, viewRef.current, page.width, page.height),
          ),
          cursor: null,
        }
        void commitDraft()
        return
      }
      // Did not travel: it was a click, and the vertex it placed on the way
      // down stands. The polygon continues from there.
    }

    if (marqueeRef.current) {
      const r = marqueeRef.current
      marqueeRef.current = null
      // A click with Shift is a zero-area marquee; treat it as clearing, not
      // as selecting everything.
      if (Math.abs(r.x1 - r.x0) > 3 || Math.abs(r.y1 - r.y0) > 3) {
        const ids = markupsInRect(r, markupsRef.current, viewRef.current, page.width, page.height)
        setSelectedIds(ids); selectedRef.current = ids
        setStatus(ids.length ? `${ids.length} selected` : 'nothing in selection')
      }
      requestPaint()
    }
    const ed = editRef.current
    if (ed) {
      if (ed.mode === 'vertex') {
        const m = markupsRef.current.find((x) => x.id === ed.id)
        const ring = m?.rings[0]
        if (m && ring) void commitGeometry(m.id, ring, dragOriginRef.current, 'move vertex')
      } else {
        // One gesture, one undo step — even when it moved twelve markups.
        void commitMove(ed.ids, ed.origins)
      }
      dragOriginRef.current = null
      editRef.current = null
      snapRef.current = null
      requestPaint()
    }
  }
  /**
   * The kind each drawing tool produces. `pan` and `calibrate` produce no
   * takeoff markup, so they are absent rather than mapped to something.
   */
  const TOOL_KIND: Partial<Record<Tool, MarkupKind>> = {
    area: 'area', cutout: 'cutout', polyline: 'polyline', count: 'count', shape: 'shape',
  }

  /**
   * 04.5: warn before a markup is drawn into a scope that will ignore it.
   * Shown next to the tool rather than after the fact, because after the fact
   * the estimator has already moved on believing it counted.
   */
  const toolWarning = useMemo(() => {
    const kind = TOOL_KIND[tool]
    const scope = scopes.find((s) => s.id === activeScope)
    if (!kind || !scope) return null
    return scopeToolWarning(scope, kind)
  }, [tool, scopes, activeScope])

  /**
   * Sample the meters for display.
   *
   * 500ms rather than per frame: the numbers are rolling percentiles over a
   * 240-sample window, so they do not change meaningfully faster than this,
   * and a re-render per frame is exactly the cost this module exists to stop
   * paying.
   */
  useEffect(() => {
    const id = setInterval(() => setPerf(perfRef.current.all()), 500)
    return () => clearInterval(id)
  }, [])

  // ------------------------------------------------------------- scopes ----

  /**
   * Freeze the dimension draft into a markup.
   *
   * `scopeId` is null and stays null. A dimension is a reading off the sheet,
   * not takeoff: `markupCountsInScope` returns false for it in every scope
   * type, so filing it under one would put a row in the scope's markup count
   * that reaches no quantity — a scope that says "12 markups" and measures
   * eight of them.
   */
  const commitDimensionDraft = useCallback(async () => {
    const frozen = commitDimension(dimensionDraftRef.current, page.width, page.height)
    // Null means a zero-length drag: a misclick, not a markup.
    if (frozen === null) { dimensionDraftRef.current = emptyDimensionDraft(); return }
    const id = `mk-${Math.random().toString(36).slice(2, 10)}`
    await runCommand(cmdCreate({
      id,
      scopeId: null,
      documentId: docIdRef.current,
      pageId: pageIdFor(docIdRef.current, pageIndexRef.current),
      kind: 'dimension',
      rings: frozen.rings,
      origin: 'user',
      reviewState: 'accepted',
      // The store's content column is an open payload; the dimension's
      // shape is checked where it is parsed back, not here.
      content: frozen.content as unknown as Record<string, unknown>,
    }))
    // Keep the tool in hand: dimensions come in runs — a head, a jamb, a sill
    // — and dropping back to pan after each one would cost a click every time.
    dimensionDraftRef.current = emptyDimensionDraft(dimensionDraftRef.current.ortho)
    setStatus(`dimension: ${frozen.content.label}`)
    requestPaint()
  }, [page.width, page.height, runCommand, requestPaint])

  /** Re-read both live and archived scopes after any scope mutation. */
  const refreshScopes = useCallback(async () => {
    const db = dbRef.current
    if (!db) return
    const rows = await listScopes(db, { includeArchived: true })
    const map = (r: Awaited<ReturnType<typeof listScopes>>[number]): Scope => ({
      id: r.id, label: r.label, scopeType: r.scopeType as Scope['scopeType'],
      color: r.color, specifications: r.specifications,
    })
    setScopes(rows.filter((r) => r.archivedAt === null).map(map))
    setArchivedScopes(rows.filter((r) => r.archivedAt !== null).map(map))
  }, [])

  const saveScope = useCallback(async (scope: Scope) => {
    const db = dbRef.current
    if (!db) return
    await upsertScope(db, {
      id: scope.id, label: scope.label, scopeType: scope.scopeType,
      color: scope.color, specifications: scope.specifications, archivedAt: null,
    })
    saveRef.current?.()
    await refreshScopes()
    void broadcastChange('scopes', identity.projectId ?? 'default')
  }, [refreshScopes])

  /**
   * Use a drawn edge as the pattern direction.
   *
   * The alternative is the Direction tool: pick it, then draw a line by eye
   * along an edge that is already on the sheet — a hand-traced copy of a
   * vector the markup holds exactly, and off by however steady your hand was.
   * A ceiling's planks run parallel to the wall you traced, so the wall you
   * traced is the direction.
   *
   * WHERE it lands is the interesting part. The first direction set on a sheet
   * governs every area of that scope on it; each one after that corrects the
   * single area it came from. One orientation usually governs a whole floor,
   * and the exceptions — a corridor the other way, a feature ceiling turned 45
   * degrees — are exceptions. So the common case costs one gesture and the
   * exception costs one more, and there is no mode to remember.
   *
   * `forPage` forces the general reading. Without it the sheet's direction
   * would be unreachable once set: every later gesture would attach to an
   * area, and a page direction taken from the wrong edge could only be undone
   * by overriding every area one at a time.
   */
  const directionFromEdge = useCallback(async (
    markup: Markup,
    edgeIndex: number,
    forPage?: boolean,
  ) => {
    const ring = markup.rings[0]
    if (!ring || markup.scopeId === null) return
    const a = ring[edgeIndex]
    const b = ring[(edgeIndex + 1) % ring.length]
    if (!a || !b) return
    if (a.x === b.x && a.y === b.y) {
      setStatus('that edge has no length, so it is not a direction')
      return
    }
    // `scopesRef`, not `scopes` — see commitDraft. A merge is only as good as
    // the thing it merges into.
    const sc = scopesRef.current.find((x) => x.id === markup.scopeId)
    if (!sc) return

    const specs = sc.specifications
    const pages = { ...(specs[PAGE_DIRECTIONS_KEY] as Record<string, unknown> ?? {}) }
    const areas = { ...(specs[AREA_DIRECTIONS_KEY] as Record<string, unknown> ?? {}) }
    const vector = { sourcePage: pageIndexRef.current, x1: a.x, y1: a.y, x2: b.x, y2: b.y }
    const general = forPage === true || pages[markup.pageId] === undefined

    if (general) {
      pages[markup.pageId] = vector
      /*
       * An area override on THIS sheet is a correction to a direction that no
       * longer exists. Restating the sheet's direction is a fresh start for
       * it, so the corrections to the old one go with it — otherwise areas
       * would silently keep an orientation the estimator has just replaced.
       */
      for (const m of docMarkupsRef.current) {
        if (m.pageId === markup.pageId && m.scopeId === sc.id) delete areas[m.id]
      }
    } else {
      areas[markup.id] = vector
    }

    await saveScope({
      ...sc,
      specifications: { ...specs, [PAGE_DIRECTIONS_KEY]: pages, [AREA_DIRECTIONS_KEY]: areas },
    })
    setStatus(general
      ? `pattern runs along that edge for ${sc.label} on this sheet`
      : `pattern runs along that edge for this area only`)
  }, [saveScope])

  /**
   * Duplicate an estimate: its scopes and their specifications, not its takeoff.
   *
   * This is what a bidding round IS — the same scopes priced a different way,
   * an alternate with one product swapped, a value-engineered version. The
   * store has been able to do it since the beginning and nothing ever called
   * it, so the only way to bid an alternate was to build every scope again by
   * hand and hope the specifications matched.
   *
   * Markups deliberately do not come along. Copying them would double every
   * quantity in the project against drawings that were traced once, which is
   * never what "another round" means — the same reason duplicating a scope
   * copies its specification alone.
   */
  const duplicateEstimate = useCallback(async (sourceId: string, name: string) => {
    const db = dbRef.current
    if (!db) return
    const id = `estimate-${crypto.randomUUID()}`
    await copyEstimate(db, sourceId, id, name, () => `scope-${crypto.randomUUID()}`)
    saveRef.current?.()
    await refreshScopes()
    await refreshEstimates(id)
    setOpenEstimateId(id)
    setOpenScopeId(null)
    setStatus(`copied to ${name}`)
    void broadcastChange('estimates', identity.projectId ?? 'default')
  }, [refreshEstimates, refreshScopes, identity.projectId])

  /** Rename a bidding round. */
  const renameEstimateBy = useCallback(async (id: string, name: string) => {
    const db = dbRef.current
    if (!db) return
    try {
      await renameEstimate(db, id, name)
      saveRef.current?.()
      await refreshEstimates(openEstimateIdRef.current)
      void broadcastChange('estimates', identity.projectId ?? 'default')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    }
  }, [refreshEstimates, identity.projectId])

  /**
   * Delete a bidding round, or say why not.
   *
   * A scope belongs to exactly one round, so this takes every scope in it —
   * which is why the store refuses while any of them still carries takeoff.
   * The refusal is the feature: an estimator does not lose an afternoon's
   * tracing to a click on the round it happens to live in.
   */
  const deleteEstimateBy = useCallback(async (id: string): Promise<string | undefined> => {
    const db = dbRef.current
    if (!db) return undefined
    try {
      await deleteEstimate(db, id)
      saveRef.current?.()
      setOpenEstimateId(null)
      setOpenScopeId(null)
      await refreshScopes()
      await refreshEstimates(null)
      setStatus('round deleted')
      void broadcastChange('estimates', identity.projectId ?? 'default')
      return undefined
    } catch (err) {
      const why = `cannot delete: ${err instanceof Error ? err.message : String(err)}`
      setStatus(why)
      return why
    }
  }, [refreshEstimates, refreshScopes, identity.projectId])

  /** Take a scope out of its round. It is archived, not destroyed. */
  const removeScopeBy = useCallback(async (estimateId: string, scopeId: string) => {
    const db = dbRef.current
    if (!db) return
    await removeScopeFromEstimate(db, estimateId, scopeId)
    saveRef.current?.()
    setOpenScopeId((cur) => (cur === scopeId ? null : cur))
    await refreshScopes()
    await refreshEstimates(estimateId)
    setStatus('scope archived')
    void broadcastChange('estimates', identity.projectId ?? 'default')
  }, [refreshEstimates, refreshScopes, identity.projectId])


  const createScope = useCallback(async (scope: Scope) => {
    await saveScope(scope)
    setActiveScope(scope.id)
    // A scope belongs to a bidding round, never to the project directly.
    const db = dbRef.current
    const round = openEstimateIdRef.current
    if (db && round !== null) {
      await addScopeToEstimate(db, round, scope.id)
      await refreshEstimates(round)
    }
  }, [saveScope, refreshEstimates])

  /**
   * A scope from a name — the sidebar's "Add scope" row. It opens on the new
   * scope's page, where everything past the name is set.
   */
  const createNamedScope = useCallback(async (label: string) => {
    const scope = newScope(label, scopesRef.current)
    await createScope(scope)
    setOpenScopeId(scope.id)
  }, [createScope])

  /**
   * Bring an archived scope back INTO THE OPEN ROUND.
   *
   * Removing a scope from a round archives it and drops the link, so
   * un-archiving alone would leave it live and belonging to nothing — listed
   * nowhere the panel looks. The restore is offered from a round's own list,
   * so that round is where it comes back.
   */
  const restoreScope = useCallback(async (id: string) => {
    const db = dbRef.current
    const round = openEstimateIdRef.current
    if (!db || round === null) return
    await setScopeArchived(db, id, false)
    await addScopeToEstimate(db, round, id)
    saveRef.current?.()
    await refreshScopes()
    await refreshEstimates(round)
    setStatus('scope restored')
    void broadcastChange('scopes', identity.projectId ?? 'default')
  }, [refreshScopes, refreshEstimates, identity.projectId])

  /**
   * Duplicate a scope's SPECIFICATIONS, not its markups.
   * Copying the takeoff too would double every quantity on the page, which is
   * never what "duplicate this scope" means — the point is to reuse a spec
   * with one parameter changed.
   */
  const duplicateScope = useCallback(async (id: string) => {
    const src = scopes.find((s) => s.id === id)
    if (!src) return
    // Two scopes with the same label are indistinguishable in the shelf, in
    // the quantity rows and in the rescope list — and rescoping into the wrong
    // one is silent. Disambiguate rather than letting duplicates collide.
    const taken = new Set(scopes.map((s) => s.label))
    let label = `${src.label} copy`
    for (let n = 2; taken.has(label); n++) label = `${src.label} copy ${n}`

    const copy: Scope = {
      ...src,
      id: `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      specifications: { ...src.specifications },
    }
    await createScope(copy)
  }, [scopes, createScope])

  const archiveScope = useCallback(async (id: string, archived: boolean) => {
    const db = dbRef.current
    if (!db) return
    await setScopeArchived(db, id, archived)
    saveRef.current?.()
    await refreshScopes()
    void broadcastChange('scopes', identity.projectId ?? 'default')
    // Never leave the active scope pointing at something the shelf cannot show.
    if (archived) setActiveScope((cur) => (cur === id ? null : cur))
  }, [refreshScopes])

  /** Give a document a tab and focus it. Opening an already-open one just focuses. */
  const openDocument = useCallback((id: string) => {
    setOpenDocIds((cur) => (cur.includes(id) ? cur : [...cur, id]))
    setActiveDocId(id)
  }, [])

  /**
   * Close a tab. Closing the active one falls back to its NEIGHBOUR rather than
   * to the first tab: after closing the third of five, you almost always want
   * the fourth, not the first.
   */
  const closeDocument = useCallback((id: string) => {
    setOpenDocIds((cur) => {
      const i = cur.indexOf(id)
      if (i < 0) return cur
      const next = cur.filter((x) => x !== id)
      setActiveDocId((active) => {
        if (active !== id) return active
        return next[Math.min(i, next.length - 1)] ?? null
      })
      return next
    })
  }, [])

  /** Live markup counts per scope, for the shelf and the archive warning. */
  const markupCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const m of markups) if (m.scopeId) out[m.scopeId] = (out[m.scopeId] ?? 0) + 1
    return out
  }, [markups])

  const onDoubleClick = () => {
    if (tool === 'area' || tool === 'cutout' || tool === 'shape' || tool === 'polyline') void commitDraft()
  }

  /**
   * Answer the automation bridge.
   *
   * Everything here reads the same state the UI renders from, so what an agent
   * is told is what a person would see — a separate reporting path is how a
   * bridge starts describing an app that no longer exists.
   */
  useBridgeRequests({
    uiState: () => ({
      projectPath,
      role: identity.role,
      backend,
      status,
      activeDocumentId: activeDocId,
      openDocumentIds: openDocIds,
      documentCount: documents.length,
      pageIndex,
      pageCount,
      pageWidth: page.width,
      pageHeight: page.height,
      zoom: viewRef.current.zoom,
      /*
       * The viewport, verbatim. Added because two rendering complaints in a
       * row had to be diagnosed by measuring pixels in a screenshot, which is
       * how the white-square bug was nearly misdiagnosed — the numbers were
       * right there and simply not reachable.
       */
      viewport: {
        ox: viewRef.current.ox,
        oy: viewRef.current.oy,
        vw: viewRef.current.vw,
        vh: viewRef.current.vh,
      },
      stage: { width: stage.width, height: stage.height, dpr: stage.dpr },
      fitMode,
      tool,
      activeScope,
      scopes: scopes.map((sc) => ({ id: sc.id, label: sc.label, scopeType: sc.scopeType })),
      markupCount: markups.length,
      selectedIds,
      calibrated: cal !== null,
      feetPerPoint: cal?.feetPerPoint ?? null,
      undo: undoState,
      // The names predate the dialogs' rehoming and are kept for the agents
      // that read them: "scope editor open" is a scope's page in the sidebar,
      // "browser open" is the Files pane.
      panels: {
        scopeEditorOpen: openScopeId !== null, settingsOpen, searchOpen: railPanel === 'search',
        browserOpen: railPanel === 'files', bomOpen: openScopeId !== null && scopePage === 'parts', scopePage, layoutOn,
      },
      /*
       * The two gestures that are half-finished rather than open or closed.
       *
       * Both put a question on screen that outranks everything else, so an
       * agent that does not know one is up reads every later refusal as the
       * app being broken instead of as a form waiting for an answer.
       */
      pending: { calibration: pendingCal !== null, scaleRegion: pendingRegion !== null },
      // Ids, because deleting a region needs one and nothing else reports them.
      scaleRegions: regionsOnThisSheet.map((r) => ({
        id: r.id, label: r.label, feetPerPoint: r.feetPerPoint,
        scale: scaleLabel(r.feetPerPoint), rect: r.rect,
      })),
      quantities: quantities.map((q) => ({ scope: q.scope.label, rows: q.rows })),
      pieces: pieces.map((p) => ({
        scope: p.scope.label,
        quantities: p.result.quantities,
        blockers: p.result.blockers,
      })),
      ingestNote,
    }),

    screenshot: (params) => {
      // The raster and the overlay are separate canvases; a screenshot that
      // showed only one would be a picture of half the app.
      const raster = rasterRef.current
      const overlay = overlayRef.current
      if (!raster) return null
      const out = document.createElement('canvas')
      out.width = raster.width
      out.height = raster.height
      const ctx = out.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(raster, 0, 0)
      if (overlay && params['overlay'] !== false) ctx.drawImage(overlay, 0, 0)
      return out.toDataURL('image/png')
    },

    invoke: async (action, params) => {
      /*
       * A nested object, however the caller managed to send it.
       *
       * The schema asks for an object and MCP clients routinely stringify one
       * anyway — the transport is JSON either way, so a client that flattens
       * arguments loses nothing but the type. Refusing that was a dead end an
       * agent could not read its way out of: the message said "must be an
       * object", the caller believed it had sent one, and the retry was
       * identical. Parsing costs nothing and a genuinely malformed value still
       * fails, one line further down.
       */
      const objectParam = (v: unknown): Record<string, unknown> | null | undefined => {
        if (v === undefined) return undefined
        const o = typeof v === 'string' ? ((): unknown => { try { return JSON.parse(v) } catch { return null } })() : v
        return typeof o === 'object' && o !== null && !Array.isArray(o)
          ? o as Record<string, unknown>
          : null
      }
      switch (action) {
        case 'set_tool': {
          const next = String(params['tool'] ?? '')
          /*
           * Every tool a person has, because an agent that cannot reach one
           * cannot check it either. This list had drifted: `direction` and
           * `scale-region` both existed in the toolbar and neither could be
           * selected through the bridge, so the two gestures that decide how a
           * takeoff is MEASURED were the two an agent could not exercise.
           * `dimension` drifted the same way the day it was added — the guard
           * in apps/mcp/coverage.test.mjs is what caught it, which is the
           * argument for the guard rather than for care.
           */
          const known: Tool[] = [
            'pan', 'area', 'cutout', 'polyline', 'count', 'shape',
            'calibrate', 'direction', 'scale-region', 'dimension',
          ]
          if (!known.includes(next as Tool)) return { error: `unknown tool: ${next}` }
          setTool(next as Tool)
          return { tool: next }
        }
        case 'set_active_scope': {
          const id = String(params['scopeId'] ?? '')
          if (!scopes.some((sc) => sc.id === id)) return { error: `no such scope: ${id}` }
          setActiveScope(id)
          return { activeScope: id }
        }
        case 'go_to_page': {
          const n = Number(params['page'])
          if (!Number.isInteger(n) || n < 0 || n >= pageCount) {
            return { error: `page ${params['page']} out of range (0..${pageCount - 1})` }
          }
          void goToPage(n)
          return { page: n }
        }
        case 'set_layout_preview': {
          const on = params['on'] !== false
          setLayoutOn(on)
          return { layoutPreview: on }
        }
        /*
         * Open a panel, the way the icon rail and the palette do.
         *
         * A panel is not decoration here. The bill of materials and its three
         * exports exist only while that dialog is up, so an agent that could
         * not open it could measure an entire set and never reach the thing
         * the measuring was for — and the export buttons could not be checked
         * from an agent's seat at all.
         *
         * `only` rather than the individual setters, because the panels
         * exclude each other: setting two flags leaves the precedence chain to
         * pick one and the other silently never draws.
         */
        case 'open_panel': {
          const which = String(params['panel'] ?? '')
          switch (which) {
            case 'bom': openParts(); return { panel: 'bom' }
            case 'browser': openBrowser(); return { panel: 'browser' }
            case 'scope': openScopeEditor(); return { panel: 'scope' }
            case 'settings': openSettings(); return { panel: 'settings' }
            case 'none': closeModals(); return { panel: 'none' }
            default: return { error: `unknown panel: ${which}` }
          }
        }
        /*
         * The named scales, with their ids.
         *
         * A scale is chosen from this list, never typed, and the ids are not
         * guessable — an agent reaching for `1/8"` or `arch-1/8` writes a
         * scale that does not exist, and the failure it gets back says nothing
         * about what would have worked.
         */
        case 'get_scale_presets': {
          return {
            presets: SCALE_PRESETS.map((p) => ({
              id: p.id,
              label: p.label,
              system: p.system,
              feetPerPoint: feetPerPointForPreset(p),
            })),
          }
        }
        /*
         * The bill of materials — the deliverable, as the panel computes it.
         *
         * Built from the same `buildBom` over the same `pieces` the panel
         * renders. A second roll-up computed for the bridge is how an agent
         * ends up confidently reporting a number nobody else in the app can
         * see, which is worse than not reporting one.
         *
         * `confidence` per line is the part that must not be dropped on the
         * way out: a blocked line carries no quantity at all, and an
         * unverified one is a count this build has never checked against the
         * Qt original. A total that flattens the three is a bid.
         */
        case 'get_bom': {
          const bom = buildBom(piecesRef.current)
          return {
            lines: bom.lines,
            totals: bom.totals,
            counts: bom.counts,
            needsAttention: bom.needsAttention,
            calibrated: cal !== null,
          }
        }
        /*
         * The three exports the BOM panel offers.
         *
         * TSV and the report come back as TEXT rather than as a saved file.
         * The buttons hand a blob to the browser's downloader, which puts it
         * somewhere an agent cannot read and cannot choose — so for those two
         * the useful thing to return is the content itself, and an agent that
         * wants a file can write one.
         *
         * The marked-up PDF is the exception: it goes through
         * `exportMarkedDrawing`, the same callback the button calls, because
         * the write-back walks the source PDF and there is nowhere to put a
         * multi-megabyte binary in a JSON reply. It lands in the user's
         * downloads, and this reports only whether it was written.
         */
        case 'export': {
          const what = String(params['what'] ?? '')
          if (what === 'marked-pdf') {
            // Awaited: the write-back can fail on a source file it cannot
            // read, and reporting `saved` before it returns records that
            // failure as a success.
            const problem = await exportMarkedDrawing()
            return problem === null
              ? { format: 'marked-pdf', saved: true, markups: markupsOnOpenDrawing }
              : { error: problem }
          }
          if (what === 'csv' || what === 'estimate-tsv' || what === 'pdf') {
            const id = String(params['estimateId'] ?? openEstimateIdRef.current ?? '')
            const draft = await buildExportFor(id)
            if (draft === null) return { error: `no such estimate: ${id || '(none open)'}` }
            if (what === 'csv') return { format: 'csv', text: estimateToCsv(draft) }
            if (what === 'estimate-tsv') return { format: 'estimate-tsv', text: estimateToTsv(draft) }
            const result = await saveEstimatePdf(draft, () => {})
            return result.problem === null
              ? { format: 'pdf', saved: true, said: result.said, scopes: draft.scopes.length }
              : { error: result.problem }
          }
          const bom = buildBom(piecesRef.current)
          if (what === 'tsv') return { format: 'tsv', text: bomToTsv(bom) }
          if (what === 'report') {
            // The same inputs the panel passes. `projectName` is the shared
            // value both read, so the agent's report and the button's report
            // cannot disagree about it; the rest is still mirrored by hand,
            // so a new header field has to be added in both places.
            const html = renderTakeoffReport({
              projectName,
              estimateName: openEstimate?.name ?? 'Takeoff',
              bom,
              documents: documents.map((d) => d.displayName || d.relativePath),
              generatedAt: new Date(),
            })
            return { format: 'report', bytes: html.length, html }
          }
          return { error: `unknown export: ${what} (tsv, report, marked-pdf, csv, estimate-tsv or pdf)` }
        }
        /*
         * Freeze a scope's current answer. A write, but not an undoable one:
         * a committed run is a RECORD of what the takeoff said, so undoing it
         * would erase evidence rather than reverse an edit. It is removed by
         * committing again, which supersedes it.
         */
        case 'commit_scope': {
          const id = String(params['scopeId'] ?? activeScopeRef.current ?? '')
          const sc = scopesRef.current.find((x) => x.id === id)
          if (!sc) return { error: `no such scope: ${id}` }
          const p = piecesRef.current.find((x) => x.scope.id === id)
          if (!p) return { error: `no calculation for ${sc.label} yet` }
          if (p.result.blockers.length > 0) {
            return { error: `cannot commit ${sc.label}: ${p.result.blockers.join('; ')}` }
          }
          // Awaited: reporting a commit that has not happened yet is how a
          // failure gets recorded as a success.
          await commitScope(id)
          return { committed: sc.label, quantities: p.result.quantities.length }
        }

        // ---- writes ----
        //
        // These go through runCommand, the SAME path a drawn markup takes, so
        // they are recorded on the undo stack, broadcast to other windows, and
        // marked with an origin. A bridge that wrote rows directly would
        // produce takeoff changes with no undo entry and no activity trail —
        // the reason the bridge's execute_query refuses writes outright.
        case 'create_markup': {
          const kind = String(params['kind'] ?? '')
          const allowed: MarkupKind[] = ['area', 'cutout', 'polyline', 'count', 'shape']
          if (!allowed.includes(kind as MarkupKind)) return { error: `cannot create kind: ${kind}` }

          const rings = params['rings']
          const ring = Array.isArray(rings) ? rings[0] : null
          if (!Array.isArray(ring) || ring.length === 0) {
            return { error: 'create_markup needs rings: [[{x,y}, …]] in NORMALIZED [0,1] coords' }
          }
          // Page points would be in the hundreds and would still "work",
          // producing a markup somewhere off the sheet. Reject rather than
          // silently place it.
          for (const p of ring as Array<{ x?: unknown; y?: unknown }>) {
            const x = Number(p?.x), y = Number(p?.y)
            if (!Number.isFinite(x) || !Number.isFinite(y) || x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) {
              return { error: `vertex out of normalized range: ${JSON.stringify(p)}` }
            }
          }
          const min = kind === 'area' || kind === 'cutout' ? 3 : kind === 'count' ? 1 : 2
          if (ring.length < min) return { error: `${kind} needs at least ${min} vertices` }

          const scopeId = typeof params['scopeId'] === 'string' ? params['scopeId'] : activeScope
          if (scopeId !== null && !scopes.some((sc) => sc.id === scopeId)) {
            return { error: `no such scope: ${scopeId}` }
          }
          const id = uid()
          const docId = docIdRef.current
          const pageId = pageIdFor(docId, pageIndexRef.current)
          void runCommand(cmdCreate({
            id, documentId: docId, pageId, scopeId,
            kind, rings: [ring as Array<{ x: number; y: number }>],
            // `agent`, not `user`: the activity trail must be able to say who
            // drew a markup, and a review gate cannot filter what it cannot see.
            origin: 'agent', reviewState: 'accepted',
          }))
          return { id, kind, scopeId, pageId }
        }

        case 'delete_markup': {
          const id = String(params['id'] ?? '')
          if (!markupsRef.current.some((m) => m.id === id)) return { error: `no such markup: ${id}` }
          void removeMarkup(id)
          return { deleted: id }
        }

        case 'set_calibration': {
          const value = String(params['value'] ?? '')
          const unit = String(params['unit'] ?? 'ft')
          const lengthPoints = Number(params['lengthPdfPoints'])
          if (!Number.isFinite(lengthPoints) || lengthPoints <= 0) {
            return { error: 'set_calibration needs a positive lengthPdfPoints' }
          }
          const c = calibrationFromReference(lengthPoints, Number(parseNumberOrFraction(value) ?? NaN), unit, page.width, page.height)
          if (!c) return { error: `could not read "${value}" ${unit} over ${lengthPoints}pt` }
          void commitCalibration(c, 'agent', 'agent')
          return { feetPerPoint: c.feetPerPoint }
        }

        case 'set_scope_direction': {
          // The same write the direction tool makes. Exposed because the
          // layout engine refuses to guess an axis, so without this an agent
          // can draw takeoff it can never turn into a piece count.
          const id = String(params['scopeId'] ?? activeScope ?? '')
          const sc = scopesRef.current.find((x) => x.id === id)
          if (!sc) return { error: `no such scope: ${id}` }
          const n = (k: string) => Number(params[k])
          const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map(n)
          if ([x1, y1, x2, y2].some((v) => !Number.isFinite(v))) {
            return { error: 'set_scope_direction needs x1,y1,x2,y2 in NORMALIZED [0,1] coords' }
          }
          if (x1 === x2 && y1 === y2) return { error: 'a zero-length vector is not a direction' }
          void saveScope({
            ...sc,
            specifications: {
              ...sc.specifications,
              scopeDefaultDirection: { sourcePage: pageIndexRef.current, x1, y1, x2, y2 },
            },
          })
          return { scopeId: id, direction: { x1, y1, x2, y2 } }
        }

        /*
         * Scope lifecycle — create, edit, duplicate, archive.
         *
         * Without these an agent could draw takeoff but not decide what it was
         * takeoff OF, which left it able to measure a project it could not set
         * up: every markup had to land in a scope somebody else had already
         * built by hand.
         */
        case 'create_scope': {
          const label = String(params['label'] ?? '').trim()
          if (label === '') return { error: 'create_scope needs a label' }
          const types: Array<Scope['scopeType']> = ['area', 'linear', 'count']
          const scopeType = String(params['scopeType'] ?? '') as Scope['scopeType']
          if (!types.includes(scopeType)) {
            return { error: `scopeType must be one of ${types.join(', ')}` }
          }
          /*
           * Two scopes with one label are indistinguishable in the shelf, in
           * the quantity rows and in the rescope list, and rescoping into the
           * wrong one is silent. The scope editor disambiguates duplicates it
           * makes; there is nothing to disambiguate a name typed twice.
           */
          if (scopesRef.current.some((s) => s.label === label)) {
            return { error: `a scope called "${label}" already exists` }
          }
          const specs = objectParam(params['specifications'])
          if (specs === null) return { error: 'specifications must be an object' }
          const scope: Scope = {
            id: `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            label,
            scopeType,
            color: typeof params['color'] === 'string' ? params['color'] : '#39a2ff',
            specifications: specs ?? {},
          }
          await createScope(scope)
          /*
           * A scope belongs to a bidding round, never to the project. Created
           * with no round open it exists, accepts markups, shows a quantity on
           * the sheet — and is in no total anywhere. Reported rather than
           * refused, because the same is true of the button.
           */
          return {
            scopeId: scope.id,
            label,
            scopeType,
            estimateId: openEstimateIdRef.current,
            inEstimate: openEstimateIdRef.current !== null,
          }
        }

        case 'update_scope': {
          const id = String(params['scopeId'] ?? activeScopeRef.current ?? '')
          const sc = scopesRef.current.find((x) => x.id === id)
          if (!sc) return { error: `no such scope: ${id}` }
          const specs = objectParam(params['specifications'])
          if (specs === null) return { error: 'specifications must be an object' }
          /*
           * MERGED, not replaced.
           *
           * `specifications` is not only the product spec: the direction tool
           * writes the scope's pattern axis into it, and so do the per-sheet
           * and per-area overrides. A replacing write from an agent editing a
           * panel size would drop every one of them, and the piece counts
           * would change without the count ever being touched.
           *
           * An explicit null removes a key — the one thing a merge cannot
           * otherwise express, and without it a spec field set by mistake
           * could never be taken off again.
           */
          let merged = sc.specifications
          if (specs !== undefined) {
            merged = { ...sc.specifications }
            for (const [k, v] of Object.entries(specs)) {
              if (v === null) delete merged[k]
              else merged[k] = v
            }
          }
          const types: Array<Scope['scopeType']> = ['area', 'linear', 'count']
          const nextType = params['scopeType']
          if (nextType !== undefined && !types.includes(nextType as Scope['scopeType'])) {
            return { error: `scopeType must be one of ${types.join(', ')}` }
          }
          const label = typeof params['label'] === 'string' ? params['label'].trim() : sc.label
          if (label === '') return { error: 'a scope needs a label' }
          if (label !== sc.label && scopesRef.current.some((s) => s.label === label)) {
            return { error: `a scope called "${label}" already exists` }
          }
          const next: Scope = {
            ...sc,
            label,
            scopeType: (nextType as Scope['scopeType'] | undefined) ?? sc.scopeType,
            color: typeof params['color'] === 'string' ? params['color'] : sc.color,
            specifications: merged,
          }
          await saveScope(next)
          /*
           * A changed type is reported back loudly: an area scope counts only
           * areas, so retyping one to `count` does not convert its takeoff, it
           * stops every existing markup contributing to a quantity.
           */
          return {
            scopeId: id,
            label: next.label,
            scopeType: next.scopeType,
            typeChanged: next.scopeType !== sc.scopeType,
            specifications: next.specifications,
          }
        }

        case 'duplicate_scope': {
          const id = String(params['scopeId'] ?? activeScopeRef.current ?? '')
          const sc = scopesRef.current.find((x) => x.id === id)
          if (!sc) return { error: `no such scope: ${id}` }
          await duplicateScope(id)
          /*
           * No id: the copy's label is disambiguated against the shelf inside
           * the handler and the refreshed scope list has not reached this
           * closure yet. Reporting a guessed id would be worse than saying
           * where to look for the real one.
           */
          return { duplicated: sc.label, note: 'call redbeam_list_scopes for the copy\'s id' }
        }

        case 'archive_scope': {
          const id = String(params['scopeId'] ?? '')
          const known = scopesRef.current.some((x) => x.id === id)
            || archivedScopes.some((x) => x.id === id)
          if (!known) return { error: `no such scope: ${id}` }
          const archived = params['archived'] !== false
          await archiveScope(id, archived)
          // Archived, never destroyed: the markups stay, and un-archiving
          // brings the scope and its quantities back exactly as they were.
          return { scopeId: id, archived }
        }

        /*
         * Set a stated scale across a RANGE of sheets.
         *
         * The reference-line tool measures something on ONE page. A drawing
         * set is a hundred sheets at two or three scales printed in the title
         * block, and calibrating each one by hand is the difference between a
         * takeoff an agent can set up and one it cannot. A stated scale needs
         * no measuring: a plotted sheet is at true size, so `1/8" = 1'-0"` IS
         * a feet-per-point.
         *
         * One transaction, in the store. Half a selection carrying a new scale
         * and half carrying the old one is a set where some sheets measure and
         * some do not, with nothing on screen saying which.
         */
        case 'set_page_scale': {
          const presetId = typeof params['presetId'] === 'string' ? params['presetId'] : null
          const raw = params['feetPerPoint']
          let feetPerPoint: number
          let source: string
          if (presetId !== null) {
            const preset = SCALE_PRESETS.find((p) => p.id === presetId)
            if (!preset) {
              return { error: `no such scale preset: ${presetId} — call get_scale_presets` }
            }
            feetPerPoint = feetPerPointForPreset(preset)
            // The source records HOW the scale was set, and it is the
            // difference between a scale a title block states and one
            // somebody measured. `presetSource` is the only speller of it —
            // this used to be an inline template, and a second inline
            // template elsewhere spelt the same fact differently.
            source = presetSource(preset)
          } else if (raw !== undefined) {
            feetPerPoint = Number(raw)
            if (!Number.isFinite(feetPerPoint) || feetPerPoint <= 0) {
              return { error: 'feetPerPoint must be a positive number' }
            }
            source = 'agent'
          } else {
            return { error: 'set_page_scale needs presetId or feetPerPoint' }
          }

          // Defaults to the open sheet, which is what "set the scale" means
          // when nobody said which sheets.
          let pages: number[]
          if (Array.isArray(params['pages'])) {
            pages = (params['pages'] as unknown[]).map(Number)
          } else if (params['fromPage'] !== undefined || params['toPage'] !== undefined) {
            const from = Number(params['fromPage'] ?? 0)
            const to = Number(params['toPage'] ?? from)
            if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
              return { error: 'fromPage/toPage must be integers with toPage >= fromPage' }
            }
            pages = Array.from({ length: to - from + 1 }, (_, i) => from + i)
          } else {
            pages = [pageIndexRef.current]
          }
          // Checked before the write, not during: a partly-applied range is
          // the exact state the transaction exists to prevent.
          const bad = pages.filter((n) => !Number.isInteger(n) || n < 0 || n >= pageCount)
          if (bad.length > 0) {
            return { error: `page(s) out of range (0..${pageCount - 1}): ${bad.join(', ')}` }
          }
          if (pages.length === 0) return { error: 'set_page_scale needs at least one page' }
          await applyScaleToSelection(pages, feetPerPoint, source)
          return {
            pages,
            documentId: docIdRef.current,
            feetPerPoint,
            scale: scaleLabel(feetPerPoint),
            source,
          }
        }

        /*
         * A scale region: a box on the sheet that carries its own scale, for
         * the details sheet where four details sit at four scales and one page
         * number is right for exactly one of them.
         *
         * Two calls, because it is two gestures: drag the box, then answer the
         * picker. Collapsing them here would mean writing the region from the
         * bridge instead of through `commitRegion`, and the picker on screen
         * is also how the person watching finds out an agent is redefining
         * what a part of their sheet measures.
         */
        case 'begin_scale_region': {
          if (pendingRegion !== null) {
            return { error: 'a region is already waiting for a scale — set_region_scale or cancel_scale_region' }
          }
          /*
           * A `rect` object rather than four loose numbers. `x1,y1` already
           * mean the SECOND POINT of a direction vector on this surface, and
           * two actions disagreeing about what `y1` is would be a coordinate
           * bug nothing could catch — the call would succeed and the region
           * would simply be somewhere else.
           */
          const r = objectParam(params['rect'])
          if (r === null) return { error: 'rect must be an object: {x0,y0,x1,y1}' }
          const n = (k: string) => Number(r?.[k])
          const x0 = n('x0'), y0 = n('y0'), x1 = n('x1'), y1 = n('y1')
          if ([x0, y0, x1, y1].some((v) => !Number.isFinite(v))) {
            return { error: 'begin_scale_region needs rect: {x0,y0,x1,y1} in NORMALIZED [0,1] coords' }
          }
          // Page points are in the hundreds and would still "work", putting a
          // region off the sheet where it governs nothing.
          if ([x0, y0, x1, y1].some((v) => v < -0.05 || v > 1.05)) {
            return { error: 'scale region corners are outside the page: expected NORMALIZED [0,1]' }
          }
          if (x0 === x1 || y0 === y1) return { error: 'a region with no area governs nothing' }
          setPendingRegion({
            rect: { x0, y0, x1, y1 },
            // The sheet it was drawn on, not the sheet that is open when the
            // scale is chosen — those are two calls apart.
            pageId: pageIdFor(docIdRef.current, pageIndexRef.current),
          })
          return { pending: true, next: 'set_region_scale' }
        }

        case 'set_region_scale': {
          if (pendingRegion === null) {
            return { error: 'no region is waiting for a scale — call begin_scale_region first' }
          }
          const presetId = typeof params['presetId'] === 'string' ? params['presetId'] : null
          const raw = params['feetPerPoint']
          let feetPerPoint: number
          let source: string
          if (presetId !== null) {
            const preset = SCALE_PRESETS.find((p) => p.id === presetId)
            if (!preset) {
              return { error: `no such scale preset: ${presetId} — call get_scale_presets` }
            }
            feetPerPoint = feetPerPointForPreset(preset)
            source = presetSource(preset)
          } else if (raw !== undefined) {
            feetPerPoint = Number(raw)
            if (!Number.isFinite(feetPerPoint) || feetPerPoint <= 0) {
              return { error: 'feetPerPoint must be a positive number' }
            }
            source = 'agent'
          } else {
            return { error: 'set_region_scale needs presetId or feetPerPoint' }
          }
          const label = typeof params['label'] === 'string' ? params['label'] : ''
          await commitRegion(feetPerPoint, source, label)
          return { feetPerPoint, scale: scaleLabel(feetPerPoint), label, source }
        }

        case 'cancel_scale_region': {
          if (pendingRegion === null) return { error: 'no region is waiting for a scale' }
          setPendingRegion(null)
          draftRef.current = emptyDraft('scale-region')
          requestPaint()
          return { cancelled: true }
        }

        case 'delete_scale_region': {
          const id = String(params['id'] ?? '')
          if (!regionsOnThisSheet.some((r) => r.id === id)) {
            return { error: `no scale region ${id} on this sheet — see scaleRegions in get_ui_state` }
          }
          // The markups inside it fall back to the PAGE scale, or to nothing.
          // Removing a region is a change to what they measure, not a tidy-up.
          await removeRegion(id)
          return { deleted: id }
        }

        case 'reassign_markup': {
          const id = String(params['id'] ?? '')
          const target = params['scopeId'] === null ? null : String(params['scopeId'] ?? '')
          const m = markupsRef.current.find((x) => x.id === id)
          if (!m) return { error: `no such markup: ${id}` }
          if (target !== null && !scopes.some((sc) => sc.id === target)) {
            return { error: `no such scope: ${target}` }
          }
          void runCommand(cmdReassign(id, m.scopeId, target, undefined, 'agent'))
          return { id, scopeId: target }
        }
        default:
          return { error: `unknown action: ${action}` }
      }
    },
  })

  /**
   * Wheel and trackpad pinch, on a NON-PASSIVE native listener.
   *
   * React's onWheel is registered passively, so `preventDefault` inside it does
   * nothing. That left ctrl+wheel — which is exactly how a trackpad pinch is
   * reported — reaching the webview, where it means "zoom the whole page". So
   * pinching scaled the entire user interface, or appeared to do nothing to the
   * drawing, and it looked like pinch-to-zoom was tied to the scroll-to-zoom
   * setting when it never was.
   *
   * A pinch ALWAYS zooms the sheet. `viewer.scrollToZoom` governs the plain
   * wheel only, and it is OFF by default: the wheel scrolls the sheet up and
   * down, Shift+wheel scrolls it sideways, and a sideways wheel — a tilt
   * wheel, a trackpad swipe — scrolls sideways whatever the setting says.
   * Zoom is Ctrl+wheel or the pinch, which is what every PDF viewer does.
   *
   * Two things this used to get wrong. With the setting on (its old
   * default) a plain wheel zoomed and there was no way to scroll the sheet at
   * all; and `deltaX` was only read on the pan branch, so a horizontal wheel
   * did nothing while the setting was on. Aaron: "scrolling should be
   * vertical and if shift is held it should be horizontal", "fix my
   * horizontal scroll wheel".
   */
  useEffect(() => {
    const el = stageRef.current
    if (el === null) return

    const onWheelNative = (e: WheelEvent) => {
      const v = viewerRef.current
      if (!v) return
      // Unconditional: every wheel over the sheet is ours, whether it pans or
      // zooms. Letting one through scrolls or zooms the webview behind us.
      e.preventDefault()

      const rect = el.getBoundingClientRect()
      const pinchGesture = e.ctrlKey || e.metaKey
      // Lines and pages arrive on some mice and every keyboard-driven wheel;
      // pixels are what the viewport moves in.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewRef.current.vh : 1
      let dx = e.deltaX * unit
      let dy = e.deltaY * unit
      // Shift turns a vertical wheel sideways. Some platforms already have by
      // the time the event arrives (Chromium on Windows reports it as deltaX),
      // so only a delta that is still vertical is turned.
      if (e.shiftKey && dx === 0) { dx = dy; dy = 0 }
      const sideways = dx !== 0 && dy === 0
      const zooms = pinchGesture
        || (prefs['viewer.scrollToZoom'] === true && !e.shiftKey && !sideways)

      if (!zooms) {
        viewRef.current = clampViewport(
          { ...viewRef.current, ox: viewRef.current.ox + dx, oy: viewRef.current.oy + dy },
          v.pageInfo,
        )
        v.requestVisible(viewRef.current)
        requestPaint()
        return
      }

      // A pinch reports fine-grained deltas; the fixed 1.15 step made it lurch.
      const step = pinchGesture
        ? Math.exp(-dy / 180)
        : (dy < 0 ? 1.15 : 1 / 1.15)
      const next = Math.min(8, Math.max(0.05, viewRef.current.zoom * step))
      viewRef.current = clampViewport(
        zoomAbout(viewRef.current, next, e.clientX - rect.left, e.clientY - rect.top),
        v.pageInfo,
      )
      v.requestVisible(viewRef.current)
      requestPaint()
    }

    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  }, [prefs, requestPaint])

  // ------------------------------------------------------------- render --

  const nameOf = (d: DocumentRow) =>
    d.displayName || d.relativePath.split('/').pop() || d.relativePath
  const activeDoc = documents.find((d) => d.id === activeDocId) ?? null

  /**
   * The documents as the Files pane lists them. The pane builds the folder
   * TREE itself (`shell/fileTree.ts`); this is only the rows, each with the
   * one qualifier the open document carries.
   */
  const panelFiles = useMemo((): PanelFile[] => documents.map((d) => ({
    id: d.id,
    name: nameOf(d),
    relativePath: d.relativePath,
    /*
     * Only the OPEN document carries a qualifier.
     *
     * Every row used to repeat its own relative path, under a folder heading
     * that already named the folder — so each row said the same thing twice
     * and the file name lost the space to it. The name is what the row is
     * for; the rest was noise.
     */
    detail: d.id === activeDocId && pageCount > 0 ? `Page ${pageIndex + 1} of ${pageCount}` : '',
    ...(d.missing ? { missing: true } : {}),
  })), [documents, activeDocId, pageIndex, pageCount])

  // ------------------------------------------------------- the sheet index --

  /** Page index out of a page id, which is `${documentId}-p${n}`. */

  /**
   * Which sheets carry takeoff.
   *
   * Built from the document-wide markups, not the visible page's — the point
   * of the dot is to tell you about the sheets you are NOT looking at.
   */
  const takeoffPages = useMemo(() => {
    const out = new Set<number>()
    for (const m of docMarkups) {
      const i = pageIndexOf(m.pageId)
      if (i !== null) out.add(i)
    }
    return out
  }, [docMarkups])

  /**
   * Which scopes have markups on each sheet, for the index's colour dots.
   *
   * Built in SCOPE order rather than markup order, so the dots on one sheet
   * read left to right the same way the scope shelf does — a row whose colours
   * reshuffled because a different markup happened to be drawn first would be
   * unreadable at a glance, which is the only way these are read.
   */
  const pageScopes = useMemo(() => {
    const out = new Map<number, SheetScope[]>()
    for (const s of scopes) {
      for (const m of docMarkups) {
        if (m.scopeId !== s.id) continue
        const i = pageIndexOf(m.pageId)
        if (i === null) continue
        const list = out.get(i) ?? []
        if (!list.some((x) => x.id === s.id)) list.push({ id: s.id, label: s.label, color: s.color })
        out.set(i, list)
      }
    }
    return out
  }, [docMarkups, scopes])

  const sheetGroups = useMemo(() => buildSheetIndex({
    pageCount,
    shape: docIndex.shape,
    outline: docIndex.outline,
    // The document's own labels first; what we read off the sheets fills the
    // gaps. A publisher's label is authoritative and a title block is a guess.
    labels: docIndex.labels.length > 0 && docIndex.labels.some((l) => l !== null)
      ? docIndex.labels
      : derivedLabels,
    takeoffPages,
  }), [pageCount, docIndex, derivedLabels, takeoffPages])

  /** `AE6-01-02` for a page index — what a markup's sheet is called. */
  const sheetLabelFor = useCallback((p: number): string => {
    for (const g of sheetGroups) {
      for (const r of g.rows) if (r.page === p) return r.number
    }
    return `Page ${p + 1}`
  }, [sheetGroups])

  /** The estimate being checked before it leaves, or null. Shown in the estimates panel. */
  const [exportDraft, setExportDraft] = useState<EstimateExport | null>(null)

  /** Sheet label for any page id in the project — the open document's index, or a page number. */
  const sheetLabelForPageId = useCallback((pageId: string): string => {
    const index = pageIndexOfId(pageId)
    const docId = pageId.replace(/-p\d+$/, '')
    if (index === null) return pageId
    if (docId === docIdRef.current) return sheetLabelFor(index)
    const doc = documents.find((d) => d.id === docId)
    const name = doc === undefined ? docId : (doc.displayName || doc.relativePath.split('/').pop() || doc.relativePath)
    return `${name} p${index + 1}`
  }, [documents, sheetLabelFor])

  /**
   * Build the export model for a round, from what the workspace already knows.
   *
   * Any round, not only the open one: the list level offers the export too,
   * so the round's scope ids are read from the store rather than from the
   * open round's state.
   */
  const buildExportFor = useCallback(async (estimateId: string): Promise<EstimateExport | null> => {
    const db = dbRef.current
    const est = estimates.find((e) => e.id === estimateId)
    if (!db || est === undefined) return null
    const ids = await listEstimateScopeIds(db, estimateId)
    const order = new Map(ids.map((id, i) => [id, i]))
    const roundScopes = scopesRef.current
      .filter((sc) => order.has(sc.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    return buildEstimateExport({
      projectName,
      estimateName: est.name,
      scopes: roundScopes,
      quantities: quantitiesRef.current,
      pieces: piecesRef.current,
      markups: projectMarkups,
      sheetLabelFor: sheetLabelForPageId,
      documents: documents.map((d) => d.displayName || d.relativePath),
    })
  }, [estimates, projectName, projectMarkups, documents, sheetLabelForPageId])

  const openEstimateExport = useCallback((estimateId: string) => {
    void buildExportFor(estimateId).then((draft) => {
      if (draft === null) { setStatus('that estimate could not be read'); return }
      setExportDraft(draft)
    })
  }, [buildExportFor])

  /**
   * Render the branded PDF for an edited draft and hand it to the downloader.
   * Resolves to a problem to show, or null when the file was written.
   */
  const saveEstimatePdf = useCallback(async (
    draft: EstimateExport,
    onProgress: (text: string) => void,
  ): Promise<{ problem: string | null; said: string }> => {
    const resolver = createCoreBlobUrlResolver(projectPath)
    try {
      onProgress('Rendering the sheets…')
      const scopeList = draft.scopes.map((sc) => ({ id: sc.id, label: sc.label, color: sc.color }))
      const { snapshots, failures } = isTauri()
        ? await renderTakeoffSnapshots({
            documents: documents.map((d) => ({ id: d.id, relativePath: d.relativePath, displayName: d.displayName })),
            markups: projectMarkups,
            scopes: scopeList,
            // The page arrives as an argument of the sweep, not as state; the id
            // is spelled out so the page-identity guard has nothing to police.
            sheetLabelFor: (docId, sheetPage) => sheetLabelForPageId(`${docId}-p${sheetPage}`),
            resolveUrl: (d) => resolver.resolveUrl(d),
            releaseUrl: (u) => resolver.releaseUrl(u),
            onProgress: (done, total) => onProgress(`Rendering sheet ${done} of ${total}…`),
          })
        : { snapshots: [], failures: [{ document: 'browser build', reason: 'sheets cannot be read outside the desktop app' }] }
      onProgress('Writing the PDF…')
      const bytes = await renderEstimatePdf({
        estimate: draft,
        snapshots,
        notes: failures.map((f) => `${f.document}: ${f.reason}`),
      })
      onProgress('Choosing where to save…')
      const outcome = await saveFile(bytes, {
        name: exportFileName(draft, 'pdf'),
        type: 'application/pdf',
        filter: { name: 'PDF document', extensions: ['pdf'] },
      })
      const said = saveOutcomeText(outcome, 'PDF')
      setStatus(said)
      return { problem: null, said }
    } catch (err) {
      return { problem: err instanceof Error ? err.message : String(err), said: '' }
    } finally {
      resolver.release()
    }
  }, [projectPath, documents, projectMarkups, sheetLabelForPageId])

  // ------------------------------------------------------- the scope panel --

  /** Scopes belonging to the open bidding round, in its order. */
  /**
   * The scopes IN this estimate, in the order it holds them.
   *
   * This used to fall back to every scope in the project when the estimate
   * held none — a shim from before estimates existed, when "no ids" meant "not
   * organised into rounds yet". Its effect now is that a BRAND NEW estimate
   * displays every scope in the project, each reading "0 markups", so a fresh
   * bidding round looks pre-filled with work nobody put in it. Aaron reported
   * exactly that.
   *
   * An estimate with no scopes has no scopes. Until the ids have been read the
   * answer is unknown rather than empty, and the panel is told which — a
   * momentary onboarding screen in front of a full estimate is its own lie.
   */
  const estimateScopes = useMemo(() => {
    const order = new Map(estimateScopeIds.map((id, i) => [id, i]))
    return scopes
      .filter((s) => order.has(s.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  }, [scopes, estimateScopeIds])

  /**
   * The active scope's markups across the whole document, each with its own
   * measurement.
   *
   * Each markup is measured against ITS OWN page: its own box from the boot
   * report, its own calibration from the store. Reusing the open sheet's
   * numbers would put a confident, wrong area beside every markup on every
   * other sheet.
   */
  const scopeMarkups = useMemo((): ScopeMarkup[] => {
    const shown = openScopeId ?? activeScope
    if (shown === null) return []
    // A custom assembly is quantified by hand and lays nothing out, so none of
    // its shapes are missing anything.
    const sc = scopes.find((x) => x.id === shown)
    const laysOut =
      sc !== undefined && readProductType(sc.specifications) !== 'custom_assembly'
    const out: ScopeMarkup[] = []
    for (const m of docMarkups) {
      if (m.scopeId !== shown) continue
      const p = pageIndexOf(m.pageId)
      if (p === null) continue
      const size = pageSizes[p]
      const fpp = docCalibrations.get(m.pageId)
      let measure = '—'
      if (size !== undefined && fpp !== undefined) {
        const c: Calibration = { feetPerPoint: fpp, pageWidth: size.width, pageHeight: size.height }
        if (m.kind === 'area') measure = `${areaSquareFeet([m], c).toFixed(1)} SF`
        // A cutout is subtracted material; showing it unsigned reads as though
        // it added that much.
        else if (m.kind === 'cutout') measure = `−${areaSquareFeet([m], c).toFixed(1)} SF`
        else if (m.kind === 'polyline') measure = `${linearFeet([m], c).toFixed(1)} LF`
        else if (m.kind === 'count') measure = '1 EA'
      }
      /*
       * Why this particular shape is not in the layout.
       *
       * The scope-level blocker says what the SCOPE is missing; it cannot say
       * that four of your six areas are on a sheet with no scale and the other
       * two are carrying the whole number. Grouping drops a markup for exactly
       * two reasons, so those are the two things worth saying, per shape,
       * where the shape is listed.
       */
      let layoutNote: string | null = null
      if (laysOut) {
        if (size === undefined || fpp === undefined) layoutNote = 'this sheet has no scale'
        else if (m.kind !== 'area' && m.kind !== 'cutout') layoutNote = 'only areas and cutouts lay out'
      }
      out.push({ id: m.id, kind: m.kind, page: p, measure, ...(layoutNote !== null ? { layoutNote } : {}) })
    }
    return out
  }, [openScopeId, activeScope, scopes, docMarkups, pageSizes, docCalibrations])

  const openEstimate = estimates.find((e) => e.id === openEstimateId) ?? null

  /**
   * The one thing standing between the active scope and a quantity.
   *
   * Ordered by what blocks first: without a scale nothing is in real units, so
   * that outranks a missing specification, which outranks a missing direction.
   * Only the first is shown — a list of three problems is a list nobody reads,
   * and fixing the first often reveals the others were consequences.
   */
  const layoutBlocker = useMemo(() => {
    const sc = scopes.find((x) => x.id === activeScope) ?? null
    if (sc === null) return undefined
    /*
     * A scope nobody has put in an estimate has nothing to block.
     *
     * The panel showing "No estimates yet" was also showing "Layout paused" for
     * a seeded scope the estimator had never chosen — a problem reported about
     * work that has not started. A blocker is only news once the scope is
     * somewhere a number will be read from.
     */
    if (openEstimateId === null) return undefined
    /*
     * Calibration is reported ONCE.
     *
     * `warnings` already says this sheet is not calibrated, and this used to say
     * it again in amber immediately above — two blocks, same fact, different
     * words. The general warning keeps it, because it is true whether or not a
     * scope is active; this returns nothing so the panel does not say it twice.
     */
    if (cal === null) return undefined
    const missing = missingRequiredMeasures(readProductType(sc.specifications), sc.specifications)
    if (missing.length > 0) {
      return {
        message: `Layout paused — ${missing.join(' and ')} required`,
        actionLabel: 'Open scope',
        onResolve: () => { setOpenScopeId(sc.id); setWorkOpen(true) },
      }
    }
    const blockers = pieces.find((x) => x.scope.id === sc.id)?.result.blockers ?? []
    if (blockers.length > 0) {
      return {
        message: `Layout paused — ${blockers[0]}`,
        actionLabel: 'Set direction',
        onResolve: () => { setTakeoff(true); setTool('direction') },
      }
    }
    return undefined
  }, [scopes, activeScope, cal, pieces, openEstimateId])
  const shownScopeId = openScopeId ?? activeScope
  const activeQuantities = quantities.find((q) => q.scope.id === shownScopeId)?.rows ?? []

  /**
   * The committed run for each scope, and what has moved since.
   *
   * Everything else in this panel is recomputed from the markups whenever
   * anything changes — right for working, useless for bidding. A committed run
   * is the answer at a moment with the evidence behind it, so that changing a
   * specification tomorrow shows a DELTA rather than quietly replacing the
   * number somebody sent.
   */
  const [committed, setCommitted] = useState<Map<string, {
    run: CalculationRun
    quantities: QuantityResultInput[]
  }>>(new Map())

  const refreshCommitted = useCallback(async () => {
    const db = dbRef.current
    if (!db) return
    const next = new Map<string, { run: CalculationRun, quantities: QuantityResultInput[] }>()
    for (const sc of scopesRef.current) {
      const run = await latestFrozenCalculation(db, sc.id)
      if (run === null) continue
      next.set(sc.id, { run, quantities: await listCalculationQuantities(db, run.id) })
    }
    setCommitted(next)
  }, [])

  useEffect(() => { void refreshCommitted() }, [scopes, refreshCommitted])

  /**
   * Freeze what this scope currently reports.
   *
   * Recorded AND frozen in one gesture: a run that is written but never
   * accepted is a draft nobody asked for, and the button says commit.
   */
  const commitScope = useCallback(async (scopeId: string) => {
    const db = dbRef.current
    if (!db) return
    const sc = scopesRef.current.find((x) => x.id === scopeId)
    const pieces = piecesRef.current.find((p) => p.scope.id === scopeId)
    if (!sc || !pieces) return
    if (pieces.result.blockers.length > 0) {
      setStatus(`cannot commit ${sc.label}: ${pieces.result.blockers[0]}`)
      return
    }
    const rollup = (quantitiesRef.current.find((q) => q.scope.id === scopeId)?.rows ?? [])
      .map((r) => ({ itemKey: r.itemKey, label: r.label, quantity: r.quantity, unit: r.unit }))
    try {
      const id = await recordCalculation(db, calculationFor(sc, pieces.result, rollup, {
        documentId: docIdRef.current,
        // The PROJECT's markups for this scope, matching what the totals above
        // are made of. Committing the open document's would freeze a fragment.
        markups: projectMarkups.filter((m) => m.scopeId === scopeId),
        calibrations: projectCalibrations,
      }))
      await freezeLayout(db, id)
      saveRef.current()
      await refreshCommitted()
      setStatus(`committed ${sc.label}`)
    } catch (err) {
      /*
       * Say so. Five scopes committed in succession used to lose one silently
       * — the write failed on a nested transaction and the caller was told it
       * had succeeded, which on a bid is the worst possible combination.
       */
      const why = err instanceof Error ? err.message : String(err)
      setStatus(`could not commit ${sc.label}: ${why}`)
      throw err
    }
  }, [projectMarkups, projectCalibrations, refreshCommitted])

  const activePieces = pieces.find((p) => p.scope.id === shownScopeId)?.result

  const commitState = shownScopeId === null ? undefined : (() => {
    const hit = committed.get(shownScopeId)
    if (hit === undefined) return undefined
    const live = [
      ...activeQuantities.map((r) => ({
        itemKey: r.itemKey, label: r.label, quantity: r.quantity, unit: r.unit,
      })),
      ...(activePieces?.quantities ?? []),
    ]
    return { at: hit.run.acceptedAt, delta: deltaBetween(hit.quantities, live) }
  })()

  const warnings = useMemo(() => {
    const out: string[] = []
    if (cal === null) out.push('This sheet has no scale, so no quantity is in real units.')
    /*
     * The tool/scope mismatch used to float above the dock. It reads here
     * instead, with everything else that says a number cannot be trusted —
     * the dock carries controls only.
     */
    if (toolWarning !== null) out.push(toolWarning)
    /*
     * A cutout subtracts only from an area of ITS OWN scope on the same sheet
     * that contains its first vertex. One drawn beside an area, across its
     * edge, or into the wrong scope subtracts nothing and looks exactly like
     * one that does — "the cutout tool doesn't work". Say which.
     */
    const stray = strayCutouts(projectMarkups)
    if (stray > 0) {
      out.push(`${stray} cutout${stray === 1 ? ' is' : 's are'} outside every area of ${stray === 1 ? 'its' : 'their'} scope on that sheet, so ${stray === 1 ? 'it subtracts' : 'they subtract'} nothing. A cutout has to start inside an area drawn in the same scope.`)
    }
    if (ingestNote !== null) out.push(ingestNote)
    if (textNote !== null) out.push(textNote)
    return out
  }, [cal, toolWarning, ingestNote, textNote, projectMarkups])

  // ------------------------------------------------------------ view math --

  const setZoom = useCallback((z: number) => {
    // Typing or nudging a zoom is leaving fit, exactly as it is everywhere else.
    setFitMode(null)
    const v = viewerRef.current
    if (!v) return
    // Anchored on the viewport CENTRE: a zoom button is not a pointer
    // position, and anchoring on the last cursor location would make the
    // drawing jump to wherever the mouse happened to be.
    viewRef.current = clampViewport(
      zoomAbout(viewRef.current, Math.min(8, Math.max(0.05, z)), stage.width / 2, stage.height / 2),
      v.pageInfo,
    )
    v.requestVisible(viewRef.current)
    forceRender((n) => n + 1)
    requestPaint()
  }, [stage.width, stage.height, requestPaint])

  const fitPage = useCallback(() => {
    const v = viewerRef.current
    if (!v || page.width === 0) return
    const z = Math.min(stage.width / page.width, stage.height / page.height) * 0.96
    // Fit CENTRES; the clamp no longer does. Keeping "legal" and "framed"
    // apart is what lets zoom stay anchored to the cursor at every distance.
    viewRef.current = clampViewport({
      ...viewRef.current,
      zoom: z,
      ox: -(stage.width - page.width * z) / 2,
      oy: -(stage.height - page.height * z) / 2,
    }, v.pageInfo)
    v.requestVisible(viewRef.current)
    forceRender((n) => n + 1)
    requestPaint()
  }, [page.width, page.height, stage.width, stage.height, requestPaint])

  /**
   * Fit the sheet's WIDTH — the one view command an estimator reaches for
   * constantly and the old shell did not have.
   *
   * A construction sheet is wide and short; fitting the whole page to a
   * landscape window leaves the drawing small with bands of dead surround
   * above and below. Fitting the width fills the horizontal axis and lets the
   * vertical scroll, which is how the sheet is read.
   */
  const fitWidth = useCallback(() => {
    const v = viewerRef.current
    if (!v || page.width === 0) return
    const z = (stage.width / page.width) * 0.98
    viewRef.current = clampViewport({
      ...viewRef.current,
      zoom: z,
      ox: -(stage.width - page.width * z) / 2,
      oy: 0,
    }, v.pageInfo)
    v.requestVisible(viewRef.current)
    forceRender((n) => n + 1)
    requestPaint()
  }, [page.width, stage.width, requestPaint])

  /**
   * Re-apply the fit whenever the thing being fitted changes.
   *
   * Page box, window size, or the mode itself — any of them invalidates a
   * computed zoom. Doing this on every page change is the whole point: it is
   * what makes a mixed-size document readable without touching the zoom once.
   */
  useEffect(() => {
    if (fitMode === null || page.width === 0 || stage.width === 0) return
    if (fitMode === 'width') fitWidth()
    else fitPage()
    // `pageIndex` is in here deliberately. A drawing set is mostly same-size
    // sheets, so paging through it leaves page.width/height untouched — and
    // without this the fit would never re-centre after the offsets were reset.
  }, [fitMode, pageIndex, page.width, page.height, stage.width, stage.height, fitPage, fitWidth])

  /**
   * The sheet owns zoom. All of it.
   *
   * The webview has its own zoom, on the same gestures and the same keys, and
   * it scales the entire interface — chrome, dock and all — which is never
   * what someone zooming a drawing means. The way that was suppressed was at
   * the platform level: `--disable-pinch` in the browser arguments and
   * `zoomHotkeysEnabled: false` on the window.
   *
   * That is the wrong tool, and it is why the trackpad pinch did nothing. Both
   * settings work by taking the gesture away BEFORE the page sees it, so the
   * ctrl+wheel that a pinch is delivered as never arrived and there was
   * nothing left for the sheet to zoom with. Turning "scroll wheel zooms" off
   * then made it look completely dead, because the plain wheel that did arrive
   * panned instead.
   *
   * So: suppress nothing upstream, and claim every zoom input here instead.
   * preventDefault on a ctrl+wheel is what actually stops the webview scaling,
   * and it is claimed for the whole document — the stage's own handler still
   * runs and still zooms the sheet, because this neither stops propagation nor
   * needs to. The keys are claimed the same way, and Ctrl+= / Ctrl+- become
   * what a person pressing them in a drawing application means: zoom the
   * drawing.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return
      // '+' needs Shift on most layouts, so shift is allowed through for the
      // zoom keys and only the shift-free ones check for it.
      switch (e.key) {
        case '=': case '+': e.preventDefault(); setZoom(viewRef.current.zoom * 1.25); return
        case '-': case '_': e.preventDefault(); setZoom(viewRef.current.zoom / 1.25); return
      }
      if (e.shiftKey) return
      if (e.key === '0') { e.preventDefault(); setFitMode('page') }
      if (e.key === '1') { e.preventDefault(); setFitMode('width') }
      // The design package removes the permanent menu bar on the explicit
      // condition that this exists, so it is not a convenience.
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); openPalette() }
    }
    /*
     * Every ctrl+wheel in the window, not only the ones over the sheet.
     *
     * Capture phase so it runs first, and no stopPropagation, so the stage's
     * own wheel handler still receives the event and still zooms the drawing.
     * Over a pane or the dock there is nothing to zoom, and the point is only
     * that the webview does not zoom either.
     */
    const onWheel = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault() }
    window.addEventListener('keydown', onKey)
    document.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
    }
  }, [fitPage, fitWidth, setZoom, openPalette])

  /**
   * Apply a named scale from the title block.
   *
   * The whole point of the preset list: the drawing already says what it is,
   * so measuring a line and typing its length to rediscover that is work the
   * document can do for you.
   */
  const applyPreset = useCallback((p: ScalePreset) => {
    if (page.width === 0) return
    void commitCalibration(
      {
        feetPerPoint: feetPerPointForPreset(p),
        pageWidth: page.width,
        pageHeight: page.height,
      },
      presetSource(p),
    )
  }, [page.width, page.height, commitCalibration])

  /**
   * Everything the palette can reach.
   *
   * Built from the state the UI already renders rather than a parallel
   * registry: a command list that drifts from what the app can actually do is
   * worse than no palette, because it fails silently.
   */

  /**
   * At most one modal at a time, and one place that says which.
   *
   * Calibration outranks the rest: it is the tail of a gesture the estimator is
   * mid-way through, and losing it to a panel opened by a stray shortcut would
   * throw away a measurement they just took.
   */
  /**
   * Leave every place that can be left: settings, and the bill. The panes
   * and the scope page are not closed — they are where the work is, not
   * something over it — and neither is a calibration or a region waiting for
   * its answer: those hold a measurement, and "close everything" is not a
   * decision to discard one. Each has its own Cancel.
   */
  const closeModals = useCallback(() => {
    setSettingsOpen(false)
  }, [])

  /** Abandon a region that was drawn but never given a scale. */
  /**
   * Entering takeoff requires somewhere for the quantity to land.
   *
   * A scope belongs to an estimate, and a project with no estimate has nowhere
   * for one to go — but Take off started anyway, so it was possible to draw a
   * ceiling, watch the area appear on the sheet, and find nothing anywhere in
   * the panel afterwards. The markup was real and attached to a scope; the
   * scope was in no bidding round, so no total included it.
   *
   * Rather than invent a round on the estimator's behalf — which is a decision
   * about the bid, not about the UI — this sends them to the panel that makes
   * one and says why.
   */
  const beginTakeoff = useCallback((on: boolean) => {
    if (!on) { setTakeoff(false); return }
    if (estimates.length === 0) {
      setWorkOpen(true)
      setOpenEstimateId(null)
      setStatus('Create an estimate first — a takeoff has to land in a bidding round')
      return
    }
    if (openEstimateIdRef.current === null) {
      setWorkOpen(true)
      setStatus('Open the estimate this takeoff belongs to')
      return
    }
    setTakeoff(true)
  }, [estimates.length])

  const openTabs = openDocIds
    .map((id) => documents.find((d) => d.id === id))
    .filter((d): d is DocumentRow => d !== undefined)
    .map((d): ShellTab => ({
      id: d.id, name: nameOf(d), relativePath: d.relativePath,
      ...(d.missing ? { missing: true } : {}),
    }))

  /** Sheet codes for the thumbnail grid, so a thumb reads as its sheet. */
  const thumbLabels = useMemo(() => {
    const out: Record<number, string> = {}
    for (const g of sheetGroups) for (const r of g.rows) out[r.page] = r.number
    return out
  }, [sheetGroups])

  const PANE_TITLE: Record<RailPanel, string> = {
    files: 'Files',
    thumbnails: 'Thumbnails',
    contents: 'Contents',
    search: 'Search',
  }

  /*
   * What the sheet panels say while there is nothing to list YET.
   *
   * Two waits look identical from the page count and are not: the folder is
   * still being read (no document has been chosen), or a document was chosen
   * and the viewer has not reported its pages. Null once the answer is known,
   * at which point "no document open" is a true statement.
   */
  const pendingText: string | null =
    activeDocId !== null && pageCount === 0
      ? 'Opening the drawing…'
      : scan === 'reading' && activeDocId === null
        ? 'Reading the project folder…'
        : null

  /*
   * THE PALETTE'S VOCABULARY: every verb the app has, so the whole app can be
   * driven from one field.
   *
   * Three rules hold the list together. A verb that cannot run right now is
   * still listed, with the reason at its right edge — an empty palette teaches
   * nothing, "open a scope first" does. A verb that needs more takes it in the
   * palette's own field as a step, never in a dialog. And a verb the store
   * refuses returns the refusal as a string, which the palette shows and stays
   * open on, rather than closing on nothing.
   *
   * Rows are grouped by the palette (Commands, Scopes, Estimates, Documents,
   * Pages, Projects) and narrowed by its prefixes; `scope-action` in a row's
   * keywords lets `@` list what can be done TO a scope beside the scopes.
   */
  const commands = useMemo((): Command[] => {
    const activeDoc = documents.find((d) => d.id === activeDocId)
    const openRound = estimates.find((e) => e.id === openEstimateId)
    const shown = scopes.find((s) => s.id === shownScopeId)
    const noSheet = activeDoc === undefined ? 'no drawing open' : undefined
    const noRound = openRound === undefined ? 'open a round first' : undefined
    const noScope = shown === undefined ? 'open a scope first' : undefined
    const noScale = cal === null ? 'sheet has no scale' : undefined
    const allPages = Array.from({ length: pageCount }, (_, i) => i)
    const scaledPages = allPages.filter((i) => scaleOfPage(i) !== null).length
    const stuck = (why: string | undefined) => (why === undefined ? {} : { unavailable: why })
    const nameTaken = (name: string, among: readonly string[]) =>
      among.some((n) => n.trim().toLowerCase() === name.trim().toLowerCase())
    const roundNameRule = (text: string): string | null =>
      text.trim() === '' ? 'a round needs a name'
        : nameTaken(text, estimates.map((e) => e.name)) ? 'a round with that name already exists' : null
    /* ---- scope workflow builders (see the scopes block below) ---- */
    const liveScope = (id: string): Scope | undefined => scopesRef.current.find((x) => x.id === id)
    const scopeByLabel = async (label: string): Promise<Scope | null> => {
      // The state may not have flushed on the tick the scope was written.
      for (let i = 0; i < 20; i++) {
        const hit = scopesRef.current.find((x) => x.label === label)
        if (hit !== undefined) return hit
        await new Promise((r) => setTimeout(r, 25))
      }
      return null
    }
    /** A choose step listing the round's scopes, each leading into `then`. */
    const pickScope = (label: string, then: (sc: Scope) => Command): Step => ({
      kind: 'choose', label, note: 'which scope',
      options: () => [...estimateScopes].sort((a, b) => (a.id === shownScopeId ? -1 : b.id === shownScopeId ? 1 : 0))
        .map((sc): Command => ({
          ...then(sc),
          id: `pick-${sc.id}`, kind: 'scope', title: sc.label,
          detail: `${PRODUCT_TYPE_LABEL[readProductType(sc.specifications)]} · ${markupCounts[sc.id] ?? 0} markup${(markupCounts[sc.id] ?? 0) === 1 ? '' : 's'}`,
        })),
    })
    const renameCommand = (id: string): Command => ({
      id: `rename-${id}`, kind: 'command', title: 'Rename',
      step: {
        kind: 'text', label: 'Rename scope', placeholder: 'New name', initial: liveScope(id)?.label ?? '', rule: 'must be unique in the round',
        validate: (t) => (t.trim() === liveScope(id)?.label ? 'that is its name now' : scopeNameRule(t)),
        describe: (t) => `Rename to “${t.trim()}”`,
        run: (t) => { const sc = liveScope(id); if (sc !== undefined) void saveScope({ ...sc, label: t.trim() }) },
      },
    })
    const productCommand = (id: string, after: { then?: 'counts' | 'configure' }): Command => ({
      id: `set-product-${id}`, kind: 'command', title: 'Set product',
      step: {
        kind: 'choose', label: 'Product', note: `for ${liveScope(id)?.label ?? 'the scope'}`,
        options: () => PRODUCT_TYPES.map((t): Command => ({
          id: `product-${t}`, kind: 'command', title: PRODUCT_TYPE_LABEL[t],
          ...(readProductType(liveScope(id)?.specifications ?? {}) === t ? { detail: 'current' } : {}),
          run: async () => {
            const sc = liveScope(id)
            if (sc === undefined) return
            await saveScope({ ...sc, specifications: writeProductType(sc.specifications, t) })
            if (after.then === 'counts') return { next: countsCommand(id, { then: 'configure' }), chip: PRODUCT_TYPE_LABEL[t] }
            if (after.then === 'configure') return { next: configureCommand(id), chip: PRODUCT_TYPE_LABEL[t] }
          },
        })),
      },
    })
    const countsCommand = (id: string, after: { then?: 'configure' }): Command => ({
      id: `set-counts-${id}`, kind: 'command', title: 'Set what it counts',
      step: {
        kind: 'choose', label: 'Counts', note: `what ${liveScope(id)?.label ?? 'the scope'} measures`,
        options: () => (['area', 'linear', 'count'] as const).map((t): Command => ({
          id: `counts-${t}`, kind: 'command', title: SCOPE_TYPE_LABEL[t],
          ...(liveScope(id)?.scopeType === t ? { detail: 'current' } : {}),
          run: async () => {
            const sc = liveScope(id)
            if (sc === undefined) return
            await saveScope({ ...sc, scopeType: t })
            if (after.then === 'configure') return { next: configureCommand(id), chip: SCOPE_TYPE_LABEL[t] }
          },
        })),
      },
    })
    /** Parse "8 ft", "96in", "7'6", "2.5m" into a value and a unit. Bare numbers keep the unit given. */
    const parseMeasure = (text: string, fallbackUnit: string): { value: string; unit: string } | null => {
      const m = /^\s*([0-9]+(?:[.\/][0-9]+)?(?:\s+[0-9]+\/[0-9]+)?)\s*(ft|feet|'|in|inch|inches|"|mm|cm|m)?\s*$/i.exec(text)
      if (m === null) return null
      const raw = (m[2] ?? '').toLowerCase()
      const unit = raw === '' ? fallbackUnit
        : raw === "'" || raw === 'feet' ? 'ft'
        : raw === '"' || raw.startsWith('inch') ? 'in'
        : raw
      return { value: m[1]!.trim(), unit }
    }
    /** The "what do you want to set" step: product, counts, then every measure the product has. Comes back after each. */
    const configureCommand = (id: string): Command => ({
      id: `configure-${id}`, kind: 'command', title: 'Configure',
      step: {
        kind: 'choose', label: 'Configure', note: `${liveScope(id)?.label ?? 'the scope'} — pick a setting; Esc when done`,
        options: () => {
          const sc = liveScope(id)
          if (sc === undefined) return []
          const product = readProductType(sc.specifications)
          const measures = editableMeasures(product).map((f): Command => {
            const current = readString(sc.specifications, f.valueKey) ?? ''
            const unit = unitDisplayText(readString(sc.specifications, f.unitKey) ?? '')
            const required = missingRequiredMeasures(product, sc.specifications).includes(f.label)
            return {
              id: `measure-${f.valueKey}`, kind: 'command', title: f.label,
              detail: current === '' ? (required ? 'required · not set' : `${measureHelp(f.valueKey)} · not set`) : `${current} ${unit} · ${measureHelp(f.valueKey)}`,
              keywords: [measureHelp(f.valueKey), 'measure', 'dimension'],
              step: {
                kind: 'text', label: f.label, placeholder: `${measureHelp(f.valueKey)} — 4 ft, 48 in, 1.2 m`,
                initial: current === '' ? '' : `${current} ${unit}`,
                rule: 'a number with an optional unit (ft, in, mm, cm, m)',
                validate: (t) => (parseMeasure(t, unit) === null ? 'a number, then a unit if it is not inches' : null),
                describe: (t) => { const p = parseMeasure(t, unit); return p === null ? `Set ${f.label}` : `Set ${f.label} to ${p.value} ${p.unit}` },
                run: async (t) => {
                  const p = parseMeasure(t, unit)
                  const live = liveScope(id)
                  if (p === null || live === undefined) return
                  await saveScope({ ...live, specifications: { ...live.specifications, [f.valueKey]: p.value, [f.unitKey]: p.unit } })
                  return { next: configureCommand(id), chip: `${f.label} ${p.value} ${p.unit}` }
                },
              },
            }
          })
          return [
            { ...productCommand(id, { then: 'configure' }), id: 'cfg-product', title: 'Product', detail: PRODUCT_TYPE_LABEL[product], keywords: ['type', 'system'] },
            { ...countsCommand(id, { then: 'configure' }), id: 'cfg-counts', title: 'Counts', detail: SCOPE_TYPE_LABEL[sc.scopeType], keywords: ['measure kind'] },
            ...measures,
            {
              id: 'cfg-seams', kind: 'command', title: 'Seams', detail: readBool(sc.specifications, 'alignSeams') ? 'aligned' : 'free', keywords: ['align', 'joints'],
              run: async () => {
                const live = liveScope(id)
                if (live === undefined) return
                const on = !readBool(live.specifications, 'alignSeams')
                await saveScope({ ...live, specifications: { ...live.specifications, alignSeams: String(on) } })
                return { next: configureCommand(id), chip: on ? 'Seams aligned' : 'Seams free' }
              },
            },
            { ...renameCommand(id), id: 'cfg-rename', title: 'Name', detail: sc.label },
            { id: 'cfg-open', kind: 'command', title: 'Open the scope page', detail: 'everything else, with the drawing', run: () => { setOpenScopeId(id); setWorkOpen(true) } },
          ]
        },
      },
    })
    /**
     * Archive, not delete, and no confirmation: the register's rule is that a
     * destructive verb either is refused by the store with a reason, or is
     * reversible and its row says so. This one is reversible — `restore-scope`
     * brings the scope and every markup on it back into the round.
     */
    const removeCommand = (id: string): Command => ({
      id: `remove-${id}`, kind: 'command', title: `Archive ${liveScope(id)?.label ?? 'scope'}`,
      detail: `its ${markupCounts[id] ?? 0} markup${(markupCounts[id] ?? 0) === 1 ? '' : 's'} stay and come back if you restore it`,
      run: () => { if (openRound !== undefined) void removeScopeBy(openRound.id, id) },
    })

    const scopeNameRule = (text: string): string | null =>
      text.trim() === '' ? 'a scope needs a name'
        : nameTaken(text, scopes.filter((s) => s.id !== shown?.id).map((s) => s.label)) ? 'a scope with that name already exists' : null
    const docNames = documents.map((d) => d.displayName || d.relativePath)
    const inContext = (relativePath?: string) => () => { void openContextWindow(identity.projectId ?? projectPath, relativePath) }

    const duplicateRound: Command = {
      id: 'duplicate-round', kind: 'command', title: 'Duplicate round…', detail: 'Scopes and markups copied; commits are not',
      keywords: ['estimate', 'copy'], ...stuck(noRound),
      step: {
        kind: 'text', label: 'Duplicate round', placeholder: 'Name the copy',
        initial: openRound === undefined ? '' : `${openRound.name} copy`, rule: 'must be unique', validate: roundNameRule,
        describe: (t) => `Duplicate as “${t.trim()}”`,
        run: (t) => { if (openRound !== undefined) void duplicateEstimate(openRound.id, t.trim()) },
      },
    }
    const out: Command[] = [
      /* ---- the view ---- */
      { id: 'fit-page', kind: 'command', title: 'Fit sheet', shortcut: 'Ctrl+0', keywords: ['zoom'], ...stuck(noSheet), run: () => setFitMode('page') },
      { id: 'fit-width', kind: 'command', title: 'Fit width', shortcut: 'Ctrl+1', keywords: ['zoom'], ...stuck(noSheet), run: () => setFitMode('width') },
      ...[50, 100, 200, 400].map((pct): Command => ({
        id: `zoom-${pct}`, kind: 'command', title: `Zoom to ${pct}%`, keywords: ['zoom', 'actual size'],
        whenTyped: true, ...stuck(noSheet), run: () => setZoom(pct / 100),
      })),
      {
        id: 'next-sheet', kind: 'command', title: 'Next sheet', shortcut: 'PgDn',
        ...(pageIndex + 1 < pageCount ? { detail: sheetLabelFor(pageIndex + 1) } : {}),
        keywords: ['page', 'forward'],
        ...stuck(noSheet ?? (pageIndex + 1 >= pageCount ? 'this is the last sheet' : undefined)),
        stay: true, run: () => goToPage(pageIndex + 1),
      },
      {
        id: 'prev-sheet', kind: 'command', title: 'Previous sheet', shortcut: 'PgUp',
        ...(pageIndex > 0 ? { detail: sheetLabelFor(pageIndex - 1) } : {}),
        keywords: ['page', 'back'],
        ...stuck(noSheet ?? (pageIndex === 0 ? 'this is the first sheet' : undefined)),
        stay: true, run: () => goToPage(pageIndex - 1),
      },
      {
        id: 'close-tab', kind: 'command', title: activeDoc === undefined ? 'Close tab' : `Close ${nameOf(activeDoc)}`,
        shortcut: 'Ctrl+W', keywords: ['tab', 'document'], ...stuck(noSheet),
        run: () => { if (activeDocId !== null) closeDocument(activeDocId) },
      },
      ...(['files', 'contents', 'thumbnails', 'search'] as const).map((panel): Command => ({
        id: `pane-${panel}`, kind: 'command',
        title: railPanel === panel ? `Hide the ${panel} pane` : `Show the ${panel} pane`,
        keywords: ['sidebar', 'pane', 'rail', panel],
        run: () => setRailPanel(railPanel === panel ? null : panel),
      })),
      {
        id: 'pane-estimates', kind: 'command', title: workOpen ? 'Hide the estimates pane' : 'Show the estimates pane',
        keywords: ['sidebar', 'pane', 'estimates', 'scopes'], run: () => setWorkOpen(!workOpen),
      },
      { id: 'search', kind: 'command', title: 'Search the project', shortcut: 'Ctrl+F', keywords: ['find', 'text'], run: openSearch },
      { id: 'settings', kind: 'command', title: 'Settings', detail: 'Application preferences', keywords: ['preferences', 'options'], run: openSettings },
      {
        id: 'context-window', kind: 'command', title: 'New context window', detail: 'A second view on this project',
        keywords: ['window', 'second'], run: inContext(activeDoc?.relativePath),
      },
      { id: 'close-project', kind: 'command', title: 'Close project', detail: 'Back to the start page', keywords: ['exit', 'start'], run: onCloseProject },
      {
        id: 'undo', kind: 'command', title: undoState.undoLabel === null ? 'Undo' : `Undo ${undoState.undoLabel}`,
        shortcut: 'Ctrl+Z', ...stuck(undoState.canUndo ? undefined : 'nothing to undo'), stay: true, run: () => void doUndo(),
      },
      {
        id: 'redo', kind: 'command', title: undoState.redoLabel === null ? 'Redo' : `Redo ${undoState.redoLabel}`,
        shortcut: 'Ctrl+Y', ...stuck(undoState.canRedo ? undefined : 'nothing to redo'), stay: true, run: () => void doRedo(),
      },

      /* ---- scale ---- */
      {
        id: 'calibrate', kind: 'command', title: 'Calibrate from the drawing',
        detail: 'Set this sheet’s scale from a known dimension',
        keywords: ['scale', 'measure'], ...stuck(noSheet), run: () => { setTakeoff(true); setTool('calibrate') },
      },
      {
        id: 'set-scale', kind: 'command', title: 'Set scale for this sheet…',
        detail: cal === null ? 'no scale yet' : `now ${scaleLabel(cal.feetPerPoint)}`,
        keywords: ['scale', 'preset', 'calibrate'], ...stuck(noSheet),
        step: {
          kind: 'choose', label: 'Set scale', note: `applies to ${sheetLabelFor(pageIndex)}`,
          options: () => SCALE_PRESETS.map((p): Command => ({
            id: `scale-${p.id}`, kind: 'command', title: p.label,
            ...(cal !== null && Math.abs(cal.feetPerPoint - feetPerPointForPreset(p)) < 1e-9 ? { detail: 'current' } : {}),
            run: () => applyPreset(p),
          })),
        },
      },
      {
        id: 'scale-all', kind: 'command', title: 'Apply this sheet’s scale to every sheet',
        detail: `${pageCount} sheets · ${scaledPages} already carry one`,
        keywords: ['scale', 'all', 'every', 'set'],
        ...stuck(noSheet ?? (cal === null ? 'no scale on this sheet' : undefined)),
        run: () => { if (cal !== null) void applyScaleToSelection(allPages, cal.feetPerPoint, 'palette: this sheet’s scale') },
      },
      {
        id: 'scale-range', kind: 'command', title: 'Set scale for a range of sheets…', detail: 'pick the series, then the preset',
        keywords: ['scale', 'series', 'range', 'sheets'],
        ...stuck(noSheet ?? (sheetGroups.every((g) => g.label === null) ? 'the set has no sheet series' : undefined)),
        step: {
          kind: 'choose', label: 'Set scale for a range', note: 'a series of sheets',
          options: () => sheetGroups.filter((g) => g.label !== null).map((g): Command => ({
            id: `range-${g.label}`, kind: 'command', title: g.label ?? '',
            detail: `${g.rows[0]?.number ?? ''} … ${g.rows[g.rows.length - 1]?.number ?? ''} · ${g.rows.length} sheets`,
            step: {
              kind: 'choose', label: `${g.label} · ${g.rows.length} sheets`, note: `applies to all ${g.rows.length}`,
              ...(g.rows.some((r) => scaleOfPage(r.page) !== null)
                ? { warn: 'Some of these sheets already carry a scale. Applying one replaces every one of them, and cannot be undone.' }
                : {}),
              options: () => SCALE_PRESETS.map((p): Command => {
                const carrying = g.rows.filter((r) => {
                  const s = scaleOfPage(r.page)
                  return s !== null && Math.abs(s - feetPerPointForPreset(p)) < 1e-9
                }).length
                return {
                  id: `range-${g.label}-${p.id}`, kind: 'command', title: p.label,
                  ...(carrying > 0 ? { detail: `${carrying} of the ${g.rows.length} carry this now` } : {}),
                  run: () => void applyScaleToSelection(g.rows.map((r) => r.page), feetPerPointForPreset(p), presetSource(p)),
                }
              }),
            },
          })),
        },
      },
      {
        id: 'scale-region', kind: 'command', title: 'Draw a scale region',
        detail: 'For a sheet that carries more than one scale — four details at four scales',
        keywords: ['scale', 'detail', 'region', 'multiple'], ...stuck(noSheet),
        run: () => { setTakeoff(true); setTool('scale-region') },
      },
      {
        id: 'remove-region', kind: 'command', title: 'Remove a scale region…',
        detail: `${regionsOnThisSheet.length} on this sheet`,
        keywords: ['scale', 'region', 'delete'],
        ...stuck(noSheet ?? (regionsOnThisSheet.length === 0 ? 'no regions on this sheet' : undefined)),
        step: {
          kind: 'choose', label: 'Remove region', note: 'undoable',
          options: () => regionsOnThisSheet.map((r): Command => ({
            id: `region-${r.id}`, kind: 'command', title: r.label, detail: scaleLabel(r.feetPerPoint),
            run: () => void removeRegion(r.id),
          })),
        },
      },

      /* ---- rounds ---- */
      {
        id: 'new-round', kind: 'command', title: 'New round…', detail: 'A bidding round: the estimate a takeoff lands in',
        keywords: ['estimate', 'create', 'add'],
        step: {
          kind: 'text', label: 'New round', placeholder: 'Name the round', rule: 'must be unique', validate: roundNameRule,
          describe: (t) => (t.trim() === '' ? 'Create a round' : `Create round “${t.trim()}”`),
          run: (t) => void createEstimate(t.trim()),
        },
      },
      {
        id: 'rename-round', kind: 'command', title: openRound === undefined ? 'Rename round…' : `Rename ${openRound.name}…`,
        keywords: ['estimate', 'name'], ...stuck(noRound),
        step: {
          kind: 'text', label: 'Rename round', placeholder: 'New name', initial: openRound?.name ?? '', rule: 'must be unique',
          validate: (t) => (t.trim() === openRound?.name ? 'that is its name now' : roundNameRule(t)),
          describe: (t) => `Rename to “${t.trim()}”`,
          run: (t) => { if (openRound !== undefined) void renameEstimateBy(openRound.id, t.trim()) },
        },
      },
      duplicateRound,
      {
        id: 'delete-round', kind: 'command', title: openRound === undefined ? 'Delete round' : `Delete ${openRound.name}`,
        // Not a confirmation: the row says what actually happens. A round that
        // holds the only copy of any markup is refused by the store, with the
        // reason and the nearest thing that works.
        detail: `its ${openRound?.scopeCount ?? 0} scope${openRound?.scopeCount === 1 ? '' : 's'} go to the archive · refused while it holds markups`,
        keywords: ['estimate', 'remove'], ...stuck(noRound),
        run: async () => {
          if (openRound === undefined) return undefined
          const why = await deleteEstimateBy(openRound.id)
          if (why === undefined) return undefined
          return { reason: why, alternative: duplicateRound }
        },
      },
      {
        id: 'export-estimate', kind: 'command', title: 'Export estimate…',
        detail: 'Check the names and scopes, then a branded PDF, a CSV or a TSV',
        keywords: ['export', 'estimate', 'pdf', 'csv', 'tsv', 'client'],
        ...stuck(noRound),
        run: () => { if (openRound !== undefined) openEstimateExport(openRound.id) },
      },
      {
        id: 'save-report', kind: 'command', title: 'Save report…', detail: 'The round’s parts and quantities as a file',
        keywords: ['export', 'estimate', 'bill', 'html'],
        ...stuck(noRound ?? (pieces.length === 0 ? 'nothing measured yet' : undefined)),
        run: () => {
          if (openRound === undefined) return
          void saveReportFile({ projectName, estimateName: openRound.name, bom: buildBom(pieces), documents: docNames })
            .then((o) => setStatus(saveOutcomeText(o, 'report')))
        },
      },
      {
        id: 'copy-bill', kind: 'command', title: 'Copy bill as TSV', detail: 'Pastes into a spreadsheet',
        keywords: ['export', 'clipboard', 'bill', 'excel'],
        ...stuck(noRound ?? (pieces.length === 0 ? 'nothing measured yet' : undefined)),
        run: async () => {
          if (await copyBillTsv(buildBom(pieces))) { setStatus('bill copied as TSV'); return undefined }
          return 'The clipboard refused the bill.'
        },
      },
      {
        id: 'save-marked', kind: 'command', title: 'Save marked-up PDF…', detail: 'This drawing with its markups burned in',
        keywords: ['export', 'pdf', 'markup'],
        ...stuck(noSheet ?? (markupsOnOpenDrawing === 0 ? 'no markups on this drawing' : undefined)),
        run: async () => {
          const err = await exportMarkedDrawing()
          if (err !== null) return err
          setStatus('marked-up PDF saved')
          return undefined
        },
      },

      /* ---- scopes ---- */
      /*
       * WHOLE WORKFLOWS, inside the palette. Aaron: "you should be able to do
       * complete CRUD workflows within the command palette without leaving
       * the command palette." So a scope is created, then asked its product,
       * then what it counts; configuring one picks the scope, then the
       * setting, then takes the value and comes back for the next setting;
       * deleting picks and confirms. Each command works on the OPEN scope
       * when there is one and otherwise starts by asking which — a command
       * that is stuck on "open a scope first" is a dialog by another name.
       */
      {
        id: 'add-scope', kind: 'command', title: 'Add scope…', ...(openRound === undefined ? {} : { detail: `to ${openRound.name}` }),
        keywords: ['scope-action', 'new', 'create'], ...stuck(noRound),
        step: {
          kind: 'text', label: 'Add scope', placeholder: 'Name the scope — CL03 Baffle Ceiling', rule: 'must be unique in the round', validate: scopeNameRule,
          describe: (t) => (t.trim() === '' ? 'Add a scope' : `Add scope “${t.trim()}” — then choose its product`),
          run: async (t) => {
            const label = t.trim()
            await createNamedScope(label)
            // The scope exists now; read it back rather than trusting a closure.
            const made = await scopeByLabel(label)
            if (made === null) return
            return { next: productCommand(made.id, { then: 'counts' }), chip: `Add ${label}` }
          },
        },
      },
      {
        id: 'configure-scope', kind: 'command',
        title: shown === undefined ? 'Configure scope…' : `Configure ${shown.label}…`,
        detail: 'product, what it counts, each measure',
        keywords: ['scope-action', 'setup', 'measures', 'width', 'length', 'spacing'], ...stuck(noRound),
        step: shown === undefined ? pickScope('Configure scope', (sc) => configureCommand(sc.id)) : configureCommand(shown.id).step!,
      },
      {
        id: 'rename-scope', kind: 'command', title: shown === undefined ? 'Rename scope…' : `Rename ${shown.label}…`,
        keywords: ['scope-action', 'name'], ...stuck(noRound),
        step: shown === undefined ? pickScope('Rename scope', (sc) => renameCommand(sc.id)) : renameCommand(shown.id).step!,
      },
      {
        id: 'set-product', kind: 'command', title: 'Set product…',
        ...(shown === undefined ? {} : { detail: `${shown.label} · ${PRODUCT_TYPE_LABEL[readProductType(shown.specifications)]}` }),
        keywords: ['scope-action', 'type', 'ceiling', 'plank', 'panel'], ...stuck(noRound),
        step: shown === undefined ? pickScope('Set product', (sc) => productCommand(sc.id, {})) : productCommand(shown.id, {}).step!,
      },
      {
        id: 'set-counts', kind: 'command', title: 'Set what the scope counts…',
        ...(shown === undefined ? {} : { detail: `${shown.label} · ${SCOPE_TYPE_LABEL[shown.scopeType]}` }),
        keywords: ['scope-action', 'areas', 'lengths', 'counts', 'measure'], ...stuck(noRound),
        step: shown === undefined ? pickScope('Set counts', (sc) => countsCommand(sc.id, {})) : countsCommand(shown.id, {}).step!,
      },
      {
        id: 'duplicate-scope', kind: 'command', title: shown === undefined ? 'Duplicate scope…' : `Duplicate ${shown.label}`,
        keywords: ['scope-action', 'copy'], ...stuck(noRound),
        ...(shown === undefined
          ? { step: pickScope('Duplicate scope', (sc) => ({ id: `dup-${sc.id}`, kind: 'command', title: sc.label, run: () => void duplicateScope(sc.id) })) }
          : { run: () => void duplicateScope(shown.id) }),
      },
      {
        id: 'remove-scope', kind: 'command', title: shown === undefined ? 'Remove scope from round…' : `Archive ${shown.label}`,
        // Reversible, so no confirmation: the row says what happens instead.
        detail: shown === undefined ? 'archived, not destroyed'
          : `its ${markupCounts[shown.id] ?? 0} markup${(markupCounts[shown.id] ?? 0) === 1 ? '' : 's'} stay and come back if you restore it`,
        keywords: ['scope-action', 'remove', 'delete', 'archive'], ...stuck(noRound),
        ...(shown === undefined
          ? { step: pickScope('Remove scope', (sc) => removeCommand(sc.id)) }
          : { run: () => { if (openRound !== undefined) void removeScopeBy(openRound.id, shown.id) } }),
      },
      {
        id: 'restore-scope', kind: 'command', title: 'Restore scope…',
        detail: `${archivedScopes.length} archived`,
        keywords: ['scope-action', 'archive', 'undelete'],
        ...stuck(noRound ?? (archivedScopes.length === 0 ? 'nothing archived' : undefined)),
        step: {
          kind: 'choose', label: 'Restore scope', note: `into ${openRound?.name ?? 'the round'}`,
          options: () => archivedScopes.map((sc): Command => ({
            id: `restore-${sc.id}`, kind: 'command', title: sc.label,
            detail: PRODUCT_TYPE_LABEL[readProductType(sc.specifications)],
            run: () => void restoreScope(sc.id),
          })),
        },
      },
      {
        id: 'take-off', kind: 'command', title: shown === undefined ? 'Take off' : `Take off in ${shown.label}`,
        detail: 'Area tool, drawing into the scope', keywords: ['scope-action', 'takeoff', 'draw', 'measure'],
        ...stuck(noSheet ?? (shown === undefined ? 'choose a scope first' : noScale)),
        run: () => { if (shown !== undefined) { setActiveScope(shown.id); beginTakeoff(true); setTool('area') } },
      },
      {
        id: 'leave-takeoff', kind: 'command', title: 'Leave takeoff', detail: 'Back to reading the sheet',
        keywords: ['stop', 'done', 'pan'], ...stuck(takeoff ? undefined : 'not in a takeoff'),
        run: () => beginTakeoff(false),
      },
      ...([
        ['area', 'Area tool', 'Trace a region'], ['polyline', 'Length tool', 'Trace a run'], ['count', 'Count tool', 'One click, one piece'],
        ['cutout', 'Cutout tool', 'Subtract from an area'], ['shape', 'Highlight tool', 'Mark a region; counts nothing'],
        ['dimension', 'Dimension tool', 'Measure and write it on the sheet'], ['pan', 'Pan tool', 'Read the sheet'],
      ] as const).map(([t, label, detail]): Command => ({
        id: `tool-${t}`, kind: 'command', title: label, detail: tool === t ? `${detail} · current` : detail,
        keywords: ['tool', 'draw'], ...stuck(noSheet ?? (t !== 'pan' && t !== 'dimension' ? noScope : undefined)),
        run: () => { if (t !== 'pan' && t !== 'dimension' && !takeoff) beginTakeoff(true); setTool(t) },
      })),
      {
        id: 'set-direction', kind: 'command', title: 'Set direction on the sheet', detail: 'The way planks run, drawn as an arrow',
        keywords: ['scope-action', 'plank', 'orientation'], ...stuck(noSheet ?? noScope),
        run: () => { setTakeoff(true); setTool('direction') },
      },
      {
        id: 'commit-scope', kind: 'command', title: shown === undefined ? 'Commit scope' : `Commit ${shown.label}`,
        detail: 'Freeze its quantities into the round', keywords: ['scope-action', 'freeze', 'lock'],
        ...stuck(noRound ?? noScope), run: () => { if (shown !== undefined) void commitScope(shown.id) },
      },
      {
        id: 'commit-all', kind: 'command', title: 'Commit every scope in the round',
        detail: `${estimateScopes.length} scope${estimateScopes.length === 1 ? '' : 's'}`, keywords: ['freeze', 'lock', 'all'],
        ...stuck(noRound ?? (estimateScopes.length === 0 ? 'the round has no scopes' : undefined)),
        run: async () => { for (const sc of estimateScopes) await commitScope(sc.id) },
      },

      /* ---- markups ---- */
      {
        id: 'move-markup', kind: 'command', title: 'Move selected markup to…',
        detail: `${selectedIds.length} selected`, keywords: ['scope-action', 'reassign', 'rescope', 'selection'],
        ...stuck(selectedIds.length === 0 ? 'nothing selected' : undefined),
        step: {
          kind: 'choose', label: 'Move to', note: `${selectedIds.length} markup${selectedIds.length === 1 ? '' : 's'}`,
          options: () => [
            ...estimateScopes.map((sc): Command => ({
              id: `move-${sc.id}`, kind: 'scope', title: sc.label, detail: PRODUCT_TYPE_LABEL[readProductType(sc.specifications)],
              run: () => void reassignSelection(sc.id),
            })),
            { id: 'move-none', kind: 'command', title: 'No scope', detail: 'Kept on the sheet, counted nowhere', run: () => void reassignSelection(null) },
          ],
        },
      },
      {
        id: 'delete-markup', kind: 'command', title: 'Delete selected markup', shortcut: 'Del',
        detail: `${selectedIds.length} selected`, keywords: ['remove', 'selection'],
        ...stuck(selectedIds.length === 0 ? 'nothing selected' : undefined),
        run: () => void removeMarkups(selectedRef.current),
      },

      { id: 'quantities', kind: 'command', title: 'Parts and quantities', detail: 'The open scope, on its Parts page', keywords: ['bom', 'bill', 'order'], ...stuck(noScope), run: openParts },
      { id: 'specs', kind: 'command', title: 'Scope setup', detail: 'Product, measures, yield', keywords: ['edit', 'specifications'], ...stuck(noScope), run: openScopeEditor },
    ]
    /*
     * Every setting, operable WITHOUT opening settings.
     *
     * The palette is the only permanent menu this app has, and typing
     * "scrollbars" to turn scrollbars on should not route through a full-screen
     * view and a search field inside it. A switch becomes one command that
     * flips it — and stays open, so five switches are five Enters; a choice
     * becomes one command per option, so "single page" is a thing you can type
     * rather than a thing you go and find. A number cannot be typed at a
     * palette, so it opens settings — the only case that does.
     */
    for (const d of SETTINGS) {
      const current = prefs[d.id]
      if (d.type === 'bool') {
        const on = current === true
        out.push({
          id: `set:${d.id}`,
          kind: 'command',
          title: `${on ? 'Turn off' : 'Turn on'} ${d.label.toLowerCase()}`,
          detail: `Settings · ${CATEGORY_LABEL[d.category]} · currently ${on ? 'on' : 'off'}`,
          keywords: ['setting', d.label, d.description],
          stay: true,
          run: () => { settings.set(d.id, !on); setStatus(`${d.label}: ${on ? 'off' : 'on'}`) },
        })
      } else if (d.type === 'enum') {
        for (const c of d.choices) {
          if (String(current) === c.value) continue
          out.push({
            id: `set:${d.id}:${c.value}`,
            kind: 'command',
            title: `${d.label}: ${c.label}`,
            detail: `Settings · ${CATEGORY_LABEL[d.category]}`,
            keywords: ['setting', d.label, c.label, d.description],
            stay: true,
            run: () => { settings.set(d.id, c.value); setStatus(`${d.label}: ${c.label}`) },
          })
        }
      } else {
        out.push({
          id: `set:${d.id}`,
          kind: 'command',
          title: d.label,
          detail: `Settings · ${CATEGORY_LABEL[d.category]} · currently ${String(current)}`,
          keywords: ['setting', d.description],
          run: openSettings,
        })
      }
    }
    const modified = SETTINGS.filter((d) => settings.isModified(d.id)).length
    out.push({
      id: 'reset-settings', kind: 'command', title: 'Reset all settings', detail: `${modified} changed from default`,
      keywords: ['setting', 'defaults'], ...stuck(modified === 0 ? 'everything is at its default' : undefined),
      run: () => { settings.resetAll(); setStatus('settings reset') },
    })

    // The presets, typeable straight: "1/8" finds it without the step.
    for (const p of SCALE_PRESETS) {
      out.push({
        id: `scale-${p.id}`, kind: 'command', title: `Set scale ${p.label}`,
        keywords: ['scale', 'calibrate'], whenTyped: true, ...stuck(noSheet), run: () => applyPreset(p),
      })
    }
    for (const e of estimates) {
      out.push({
        id: `est-${e.id}`, kind: 'estimate', title: e.name,
        detail: `${e.scopeCount} scope${e.scopeCount === 1 ? '' : 's'}${e.id === openEstimateId ? ' · open' : ''}`,
        run: () => { setOpenScopeId(null); setOpenEstimateId(e.id); void refreshEstimates(e.id) },
      })
    }
    for (const sc of estimateScopes) {
      out.push({
        id: `scope-${sc.id}`, kind: 'scope', title: sc.label,
        detail: PRODUCT_TYPE_LABEL[readProductType(sc.specifications)],
        run: () => { setActiveScope(sc.id); setOpenScopeId(sc.id) },
      })
      // "@cl03 take off": the verb beside the noun, findable when typed.
      out.push({
        id: `takeoff-${sc.id}`, kind: 'scope', title: `Take off in ${sc.label}`,
        detail: `${PRODUCT_TYPE_LABEL[readProductType(sc.specifications)]} · ${markupCounts[sc.id] ?? 0} markups`,
        keywords: ['scope-action', 'takeoff', sc.label], whenTyped: true, ...stuck(noSheet ?? noScale),
        run: () => { setActiveScope(sc.id); setOpenScopeId(sc.id); beginTakeoff(true); setTool('area') },
      })
    }
    for (const d of documents) {
      out.push({
        id: `doc-${d.id}`, kind: 'document', title: nameOf(d), detail: d.relativePath,
        ...(d.missing ? { unavailable: 'file missing' } : {}),
        alt: { label: 'Open in a context window', run: inContext(d.relativePath) },
        run: () => openDocument(d.id),
      })
    }
    for (const g of sheetGroups) {
      for (const r of g.rows) {
        out.push({
          id: `page-${r.page}`, kind: 'page', title: r.number, page: r.page,
          ...(r.title === '' ? {} : { detail: r.title, keywords: [r.title] }),
          run: () => goToPage(r.page),
        })
      }
    }
    /*
     * Projects last, and after the sheets.
     *
     * The palette is mostly things you do INSIDE the open project; switching
     * to another one is a different order of action, so it sits at the bottom
     * rather than interleaved with commands that act on what is on screen.
     */
    out.push(...projectCommands({
      currentPath: projectPath,
      recents: recentProjects ?? [],
      ...(onOpenProject !== undefined ? { onOpen: onOpenProject } : {}),
      ...(onBrowseProject !== undefined ? { onBrowse: onBrowseProject } : {}),
    }))
    return out
  }, [
    documents, activeDocId, estimates, openEstimateId, scopes, shownScopeId, estimateScopes,
    pageIndex, pageCount, sheetLabelFor, goToPage, closeDocument, railPanel, workOpen,
    openSearch, openSettings, onCloseProject, undoState, doUndo, doRedo, cal, applyPreset,
    regionsOnThisSheet, removeRegion, createEstimate, renameEstimateBy, duplicateEstimate,
    deleteEstimateBy, projectName, pieces, markupsOnOpenDrawing, exportMarkedDrawing,
    createNamedScope, saveScope, duplicateScope, removeScopeBy, archivedScopes, restoreScope,
    scaleOfPage, applyScaleToSelection, markupCounts,
    beginTakeoff, takeoff, tool, commitScope, selectedIds, reassignSelection, removeMarkups,
    openParts, openScopeEditor, prefs, settings, setZoom, openDocument, refreshEstimates,
    identity.projectId, projectPath, recentProjects, onOpenProject, onBrowseProject,
    openEstimateExport,
  ])

  return (
    <div
      className="shellapp"
      data-pane={railPanel === null ? 'closed' : 'open'}
      data-work={workOpen ? 'open' : 'closed'}
    >
      <TitleBar
        projectName={projectName}
        appMenu={{
          ...(onBrowseProject !== undefined ? { onOpenProject: onBrowseProject } : {}),
          onOpenDrawing: openBrowser,
          onContextWindow: () => void openContextWindow(identity.projectId ?? projectPath),
          onPalette: openPalette,
          onSettings: openSettings,
          onCloseProject,
        }}
        {...(recentProjects !== undefined && onOpenProject !== undefined
          ? {
              projectMenu: {
                currentPath: projectPath,
                recents: recentProjects,
                onOpen: onOpenProject,
                ...(onBrowseProject !== undefined ? { onBrowse: onBrowseProject } : {}),
              },
            }
          : {})}
        workOpen={workOpen}
        onToggleWork={() => setWorkOpen((v) => !v)}
      >
        <DocumentTabStrip
          tabs={openTabs}
          activeId={activeDocId}
          onSelect={setActiveDocId}
          {...(openDocIds.length > 1 ? { onClose: closeDocument } : {})}
          onBrowse={openBrowser}
          onPopOut={(id) => {
            const tab = openTabs.find((t) => t.id === id)
            void openContextWindow(identity.projectId ?? projectPath, tab?.relativePath)
          }}
        />
      </TitleBar>

      <Sidebar
        active={railPanel}
        /*
          The scan's own verdict — reconciliation refused, folder unreadable,
          no PDFs — was held in `ingestNote` and handed only to the bridge.
          The files panel shows it now, and this marks the tab so it is found
          while another panel is open.
        */
        notes={ingestNote !== null ? { files: ingestNote } : {}}
        indexing={indexing}
        onSelect={(p) => setRailPanel((cur) => (cur === p ? null : p))}
        onSettings={() => (settingsOpen ? setSettingsOpen(false) : openSettings())}
        title={railPanel === null
          ? undefined
          : railPanel === 'contents' && scaleTarget !== null ? 'Set scale' : PANE_TITLE[railPanel]}
      >
        {railPanel !== null && (<>
          {railPanel === 'search' && (
            <SearchPanel
              onSearch={runSearch}
              onGoToHit={goToHit}
              onClose={() => setRailPanel(null)}
              focusNonce={searchFocus}
              seed={searchSeed}
            />
          )}
          {/*
            Setting a scale from the title block, over any number of sheets.
            The reference-line tool measures something on ONE page; this is the
            other half, and it is the one a real set needs most. It takes the
            pane the selection was made in, rather than a window over the
            drawing: the question was asked here, and the sheets it is about
            are the rows it replaces.
          */}
          {railPanel === 'contents' && scaleTarget !== null && (() => {
            const scales = scaleTarget.map(scaleOfPage)
            const first = scales[0] ?? null
            const agree = scales.every((s) => s === first)
            return (
              <ScalePicker
                target={scaleTarget.length === 1
                  ? `sheet ${scaleTarget[0]! + 1}`
                  : `${scaleTarget.length} sheets`}
                current={agree ? first : null}
                mixed={!agree}
                backLabel="Contents"
                onCancel={() => setScaleTarget(null)}
                onApply={(feetPerPoint, source) => {
                  void applyScaleToSelection(scaleTarget, feetPerPoint, source)
                }}
              />
            )
          })()}
          {railPanel === 'contents' && scaleTarget === null && (
            <SheetIndex
              pageCount={pageCount}
              shape={docIndex.shape}
              outline={docIndex.outline}
              labels={docIndex.labels.some((l) => l !== null) ? docIndex.labels : derivedLabels}
              takeoffPages={takeoffPages}
              pageScopes={pageScopes}
              current={pageIndex}
              onGoToPage={goToPage}
              onSetScale={(pages) => setScaleTarget(pages)}
              scaleOf={scaleOfPage}
              pending={pendingText}
            />
          )}
          {railPanel === 'thumbnails' && (
            <PageStrip
              pageCount={pageCount}
              current={pageIndex}
              requestThumbnail={(i, w) => viewerRef.current?.requestThumbnail(i, w)}
              onGoTo={goToPage}
              labels={thumbLabels}
              empty={pendingText ?? 'No document open.'}
            />
          )}
          {railPanel === 'files' && (
            <FileList
              files={panelFiles}
              activeId={activeDocId}
              openIds={openDocIds}
              onOpen={openDocument}
              onOpenContext={() => void openContextWindow(identity.projectId ?? 'default')}
              scanning={scan === 'reading'}
              note={ingestNote}
              focusNonce={filesFocus}
            />
          )}
        </>)}
      </Sidebar>

      {/*
        SETTINGS IS A PLACE, NOT A POP-UP.

        It was a dialog, which is the wrong shape for something with six
        categories and forty controls: a dialog says "answer this and get back
        to what you were doing", and settings is somewhere you go, look around,
        and leave. It fills the window under the title bar — the bar stays so
        the window is still movable and closable — and it is dismissed rather
        than answered.
      */}
      {settingsOpen && (
        <div className="settingsview">
          <SettingsPanel store={settings} onClose={() => setSettingsOpen(false)} />
        </div>
      )}

      {/*
        NOTHING IS OVER THE DRAWING BUT THE PALETTE.

        The bill, the browser, the scope editor, the scale picker and the
        calibration form were a modal layer here. Each now lives where its
        moment already is — the estimates panel, the Files pane, the Contents
        pane, the dock's scale control — and the layer is gone.
      */}

      <div className="viewport">
        <StatusToast text={statusEntry.text} at={statusEntry.at} />
        {/* The setting promised a readout; this is the readout. */}
        {prefs['performance.showBudgets'] === true && <PerfReadout perf={perf} />}
        {activeDocId === null && scan === 'done' && (
          <div className="stageempty" role="status">
            <div>
              <strong>No drawing open</strong>
              Choose a sheet from the Files pane. The project&rsquo;s text is indexed in the
              background, so search will find it either way.
            </div>
          </div>
        )}

        <div
          ref={stageRef}
          className="stage"
          style={{ cursor: tool === 'pan' ? 'grab' : 'crosshair' }}
          onMouseDown={(e) => { if (e.button === 1) e.preventDefault() }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => {
            e.preventDefault()
            /*
             * A right-click means "back out" while something is being drawn,
             * and "what can I do with this?" when nothing is. Both are the
             * same button because they are the same instinct at different
             * moments, and neither one is ever ambiguous: a draft is either in
             * progress or it is not.
             */
            if (isCommittable(draftRef.current) || draftRef.current.points.length > 0
                || dimensionDraftRef.current.a !== null) {
              setMarkupMenu(null)
              cancelDraft()
              return
            }
            // Nothing being drawn and a drawing tool in hand: right-click
            // puts it down, the way Escape does. The menu on a markup is a
            // Pan-tool question, asked with the tool already down.
            if (tool !== 'pan') {
              setMarkupMenu(null)
              setTool('pan')
              return
            }
            const r = e.currentTarget.getBoundingClientRect()
            const hx = e.clientX - r.left, hy = e.clientY - r.top
            const hit = hitTest(hx, hy, markupsRef.current, viewRef.current, page.width, page.height)
              ?? hitDimensionAt(hx, hy)
            if (!hit) { setMarkupMenu(null); return }
            // The menu acts on the selection, so what it will act on has to be
            // selected — and visibly so — before it opens.
            if (!selectedRef.current.includes(hit.markupId)) {
              setSelectedIds([hit.markupId])
              selectedRef.current = [hit.markupId]
              requestPaint()
            }
            setMarkupMenu({ x: hx, y: hy, markupId: hit.markupId, part: hit.part, index: hit.index })
          }}
        >
          {/* Size comes from useStageSize, never from width/height props: the
              backing store must be device pixels while the CSS box is layout
              pixels, and a React-managed `width` would fight that. */}
          <canvas ref={rasterRef} />
          <canvas ref={overlayRef} />
        </div>

        {markupMenu !== null && (() => {
          const m = markups.find((x) => x.id === markupMenu.markupId)
          if (m === undefined) return null
          const ring = m.rings[0] ?? []
          const applyRing = (next: Array<{ x: number; y: number }>, what: string) => {
            void commitGeometry(m.id, next, ring.map((p) => ({ ...p })), what)
            setMarkupMenu(null)
            requestPaint()
          }
          const count = selectedIds.length > 1 ? selectedIds.length : 1
          const plural = count === 1 ? '' : 's'
          return (
            <>
              {/*
                A scrim so the next click anywhere dismisses the menu, and so a
                click meant for "close this" cannot also land on the drawing and
                start a shape.
              */}
              <div
                className="menuscrim"
                onPointerDown={(e) => { e.stopPropagation(); setMarkupMenu(null) }}
                onContextMenu={(e) => { e.preventDefault(); setMarkupMenu(null) }}
              />
              <div
                className="dockmenu markupmenu"
                role="menu"
                style={{ left: markupMenu.x, top: markupMenu.y }}
              >
                <div className="menuhead">{count} markup{plural}</div>

                {/* Vertex editing, which was ALT-click and therefore invisible. */}
                {markupMenu.part === 'edge' && (
                  <button
                    className="menuitem" role="menuitem"
                    onClick={() => applyRing(insertVertexAt(ring, markupMenu.index), 'insert vertex')}
                  >
                    <Glyph icon={Plus} role="row" />
                    <span className="grow">Add a control point here</span>
                  </button>
                )}
                {/*
                  Take the direction from an edge you can see.
                  Setting an orientation otherwise means picking the Direction
                  tool and drawing a line by eye along something already drawn
                  — which is a hand-traced copy of a vector the markup already
                  holds exactly. The edge under the pointer IS the answer.
                */}
                {markupMenu.part === 'edge' && m.scopeId !== null && (() => {
                  const sc = scopes.find((x) => x.id === m.scopeId)
                  const pages = sc === undefined
                    ? new Map()
                    : pageDirectionsFrom(sc.specifications)
                  const sheetHasOne = pages.has(m.pageId)
                  return (
                    <>
                      <button
                        className="menuitem" role="menuitem"
                        onClick={() => { void directionFromEdge(m, markupMenu.index); setMarkupMenu(null) }}
                      >
                        <Glyph icon={Compass} role="row" />
                        <span className="grow">
                          {sheetHasOne
                            ? 'Run the pattern along this edge, here'
                            : 'Run the pattern along this edge'}
                        </span>
                      </button>
                      {/*
                        Once a sheet has a direction, every later gesture
                        corrects one area — so without this the sheet's own
                        direction would be unreachable, and one taken from the
                        wrong edge could only be undone area by area.
                      */}
                      {sheetHasOne && (
                        <button
                          className="menuitem" role="menuitem"
                          onClick={() => {
                            void directionFromEdge(m, markupMenu.index, true)
                            setMarkupMenu(null)
                          }}
                        >
                          <Glyph icon={Compass} role="row" />
                          <span className="grow">…and for every area on this sheet</span>
                        </button>
                      )}
                    </>
                  )
                })()}
                {markupMenu.part === 'vertex' && (
                  <button
                    className="menuitem" role="menuitem"
                    onClick={() => {
                      const next = removeVertexAt(ring, markupMenu.index, m.kind)
                      if (next === null) {
                        // Said out loud rather than disabled: "why is this
                        // greyed out" is a worse question than a plain answer.
                        setStatus('cannot remove — a shape needs its minimum vertices')
                        setMarkupMenu(null)
                        return
                      }
                      applyRing(next, 'remove vertex')
                    }}
                  >
                    <Glyph icon={Minus} role="row" />
                    <span className="grow">Remove this control point</span>
                  </button>
                )}

                <div className="menusep" />
                <div className="menuhead">Scope</div>
                {scopes.map((sc) => (
                  <button
                    key={sc.id}
                    className="menuitem"
                    role="menuitemradio"
                    aria-checked={m.scopeId === sc.id}
                    onClick={() => { void reassignSelection(sc.id); setMarkupMenu(null) }}
                  >
                    <span className="menudot" style={{ background: sc.color }} aria-hidden="true" />
                    <span className="grow">{sc.label}</span>
                    {m.scopeId === sc.id && <Glyph icon={Check} role="small" />}
                  </button>
                ))}
                <button
                  className="menuitem"
                  role="menuitemradio"
                  aria-checked={m.scopeId === null}
                  onClick={() => { void reassignSelection(null); setMarkupMenu(null) }}
                >
                  <Glyph icon={Minus} role="row" />
                  <span className="grow">No scope</span>
                  {m.scopeId === null && <Glyph icon={Check} role="small" />}
                </button>

                <div className="menusep" />
                <button
                  className="menuitem danger"
                  role="menuitem"
                  onClick={() => {
                    const ids = selectedRef.current.length > 0 ? selectedRef.current : [m.id]
                    setSelectedIds([]); selectedRef.current = []
                    void removeMarkups(ids)
                    setMarkupMenu(null)
                  }}
                >
                  <Glyph icon={Trash2} role="row" />
                  <span className="grow">Delete markup{plural}</span>
                </button>
              </div>
            </>
          )
        })()}

        <Dock
          read={<ReadPill tool={tool} onTool={setTool} />}
          left={
            <ToolPill
              tool={tool}
              onTool={setTool}
              scopes={estimateScopes}
              activeScope={activeScope}
              onScope={setActiveScope}
              onSpecifications={openScopeDetail}
              onQuantities={openParts}
              layoutOn={layoutOn}
              onToggleLayout={setLayoutOn}
              takeoff={takeoff}
              onTakeoff={beginTakeoff}
              estimates={estimates.map((e) => ({ id: e.id, name: e.name }))}
              openEstimateId={openEstimateId}
              onEstimate={(id) => {
                setOpenEstimateId(id)
                setOpenScopeId(null)
                void refreshEstimates(id)
              }}
              onAddScope={openScopeEditor}
              markupCountFor={(id) => markupCounts[id] ?? 0}
              onOpenEstimates={() => setWorkOpen(true)}
            />
          }
          right={
            <DocumentPill
              page={pageIndex}
              pageCount={pageCount}
              onPage={goToPage}
              feetPerPoint={cal?.feetPerPoint ?? null}
              onPreset={applyPreset}
              onCalibrate={() => setTool('calibrate')}
              onDrawRegion={() => { setTakeoff(true); setTool('scale-region') }}
              /*
                Everything about this sheet's scale, under the control that
                reads it: the regions as the page scale's small print, and the
                two half-finished gestures — a line waiting for its length, a
                box waiting for its scale — which hold the control open until
                they are answered. Geometry first, meaning second, for both:
                a box with no scale on it governs nothing and would sit on
                the sheet pretending otherwise.
              */
              regions={{
                list: regionsOnThisSheet,
                conflicting: new Set(conflictingRegions(regionsOnThisSheet).flat()),
                onDelete: (id) => { void removeRegion(id) },
                toolActive: tool === 'scale-region',
                onDone: () => setTool('pan'),
              }}
              {...(pendingCal !== null
                ? {
                    calibration: {
                      lengthPdfPoints: pendingCal,
                      error: calError,
                      onSubmit: (raw: string, unit: string) => { void applyCalibration(raw, unit) },
                      onCancel: cancelCalibration,
                    },
                  }
                : {})}
              {...(pendingRegion !== null
                ? {
                    pendingRegion: {
                      onApply: (feetPerPoint: number, source: string, label: string) => {
                        void commitRegion(feetPerPoint, source, label)
                      },
                      onCancel: cancelRegion,
                    },
                  }
                : {})}
              zoom={viewRef.current.zoom}
              onZoom={setZoom}
              onFitPage={() => setFitMode('page')}
              onFitWidth={() => setFitMode('width')}
            />
          }
        />
      </div>

      <EstimatesPanel
        projectName={projectName}
        estimates={estimates}
        loaded={estimatesLoaded}
        openEstimateId={openEstimateId}
        onOpenEstimate={(id) => { setOpenEstimateId(id); void refreshEstimates(id) }}
        openScopeId={openScopeId}
        onOpenScope={(id) => {
          setOpenScopeId(id)
          // Opening a scope makes it the destination for new markup: reading a
          // scope and drawing into a different one is the mistake this avoids.
          if (id !== null) setActiveScope(id)
        }}
        scopes={estimateScopes}
        scopesLoaded={estimateScopesLoaded}
        markupCountFor={(id) => markupCounts[id] ?? 0}
        files={estimateFiles}
        onOpenDocument={openDocument}
        rows={activeQuantities}
        {...(activePieces !== undefined ? { pieces: activePieces } : {})}
        markups={scopeMarkups}
        sheetLabel={sheetLabelFor}
        onGoToPage={goToPage}
        onCreateEstimate={(name) => void createEstimate(name)}
        onCreateScope={(label) => void createNamedScope(label)}
        addScopeRequest={addScopeRequest}
        onDuplicateScope={(id) => void duplicateScope(id)}
        archived={archivedScopes}
        onRestoreScope={(id) => void restoreScope(id)}
        onDuplicateEstimate={(id, name) => void duplicateEstimate(id, name)}
        onRenameEstimate={(id, name) => void renameEstimateBy(id, name)}
        onDeleteEstimate={(id) => void deleteEstimateBy(id)}
        onRemoveScope={(eid, sid) => void removeScopeBy(eid, sid)}
        onSaveScope={(sc) => void saveScope(sc)}
        bill={{
          entries: pieces,
          calibrated: cal !== null,
          documents: documents.map((d) => d.displayName || d.relativePath),
          markupCount: markupsOnOpenDrawing,
          onExportMarkedPdf: exportMarkedDrawing,
        }}
        scopePage={scopePage}
        onScopePage={setScopePage}
        totalFor={(id) => {
          const r = quantities.find((q) => q.scope.id === id)?.rows[0]
          return r === undefined ? null : `${r.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${r.unit}`
        }}
        onSetDirection={() => { setTakeoff(true); setTool('direction') }}
        direction={(() => {
          const sc = estimateScopes.find((s) => s.id === (openScopeId ?? activeScope))
          const d = sc === undefined ? null : scopeDefaultDirectionFrom(sc.specifications)
          if (d === null || sc === undefined) return null
          // The sheet it was picked on rides in the raw spec beside the vector.
          const raw = sc.specifications['scopeDefaultDirection']
          const page = raw !== null && typeof raw === 'object' && 'sourcePage' in raw ? Number((raw as { sourcePage?: unknown }).sourcePage) : NaN
          return Number.isFinite(page) ? `set on ${sheetLabelFor(page)}` : 'set'
        })()}
        layoutOn={layoutOn}
        onToggleLayout={setLayoutOn}
        {...(commitState !== undefined ? { commit: commitState } : {})}
        onCommit={(id) => void commitScope(id)}
        onTakeOff={(id) => { setActiveScope(id); beginTakeoff(true); setTool('area') }}
        onExportEstimate={openEstimateExport}
        {...(exportDraft !== null
          ? {
              exportSheet: (
                <ExportSheet
                  key={exportDraft.estimateName}
                  initial={exportDraft}
                  onSavePdf={saveEstimatePdf}
                  onClose={() => setExportDraft(null)}
                />
              ),
            }
          : {})}
        warnings={warnings}
        {...(layoutBlocker !== undefined ? { blocker: layoutBlocker } : {})}
      />

      {paletteOpen && (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} onSearchText={(q) => { openSearch(); setSearchSeed(q) }} />
      )}
    </div>
  )
}
