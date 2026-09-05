/**
 * A static harness for the shell, mounted at `?harness=shell`.
 *
 * The shell only assembles once a project is open, a document is ingested and
 * a page has rendered — which means the fastest way to see whether a spacing
 * token is wrong is a five-minute round trip through a real 110-sheet set. This
 * mounts the same components against fixture props so the chrome can be looked
 * at, resized, and theme-flipped on its own.
 *
 * It is a harness, not a mock: every component here is the one the app renders,
 * with the same props. If it looks right here and wrong in the app, the
 * difference is data, not CSS — which is exactly the split worth being able to
 * make.
 *
 * EVERY SURFACE IS REACHABLE FROM HERE, or the harness is not doing its job.
 * There is no modal layer any more — the palette is the only overlay the app
 * has — so what used to be dialogs are reached where they now live, and each
 * is still selectable by URL so a screenshot is reproducible from its address:
 *
 *   ?harness=shell&show=settings | palette | bom | scopes | calibration
 *                        | regions | search | scalepicker | crash
 *   ?harness=shell&rail=files | contents | thumbnails | search | none
 *   ?harness=shell&state=scanning | opening | note | empty | noscopes | indexing
 *   ?harness=shell&status=<what the workspace would say>
 *
 * `bom` opens the open scope on its Parts page — the bill is no level of its
 * own; `scopes` opens the
 * round with the add-scope row showing; `calibration` holds the dock's scale
 * control open on the length entry; `regions` puts the region tool in hand;
 * `scalepicker` holds the scale control open on a region's scale. The
 * page-range picker is reached the way it is in the app — right-click a
 * selection in the Contents pane and choose "Set scale…".
 *
 * `rail` picks the left pane. `show=search` still works and means the same
 * as `rail=search`: search is a rail pane now, not an overlay.
 *
 * `state` puts the panels in the moments that are hard to catch live: the
 * folder still being read, the drawing still opening, the scan's own note, a
 * project with nothing in it. `status` shows the status line as the workspace
 * would say it — a refusal is held, a result fades.
 */
import { useEffect, useRef, useState } from 'react'
import type { PieceResult, ScaleRegion, Scope, ScopePieces } from '@redbeam/domain'
import { LIKE_CONSEQUENCES, type SearchHit, type SearchReport } from '@redbeam/store'
import {
  DocumentTabStrip, FileList, Sidebar, TitleBar, WindowControls,
  type PanelFolder, type RailPanel,
} from './Shell.js'
import type { ScopePage } from './RightWorkspace.js'
import { SheetIndex } from './SheetIndex.js'
import { ScalePicker } from '../scale/ScalePicker.js'
import { Dock, DocumentPill, ReadPill, ToolPill } from './Dock.js'
import { EstimatesPanel } from './RightWorkspace.js'
import { StatusToast } from './StatusToast.js'
import { PageStrip } from '../pages/PageStrip.js'
import { SettingsPanel } from '../settings/SettingsPanel.js'
import { SettingsStore, memoryStorage } from '../settings/store.js'
import { CommandPalette } from '../palette/CommandPalette.js'
import type { Command } from '../palette/commands.js'
import { SearchPanel } from '../search/SearchPanel.js'
import { ErrorBoundary } from '../ErrorBoundary.js'
import type { SheetOutlineNode, SheetScope } from './sheets.js'
import type { Tool } from '../draw.js'
import './shell.css'

/** A slice of a real reflected-ceiling set, bookmarked one entry per sheet. */
const OUTLINE: SheetOutlineNode[] = [
  'COVER SHEET', 'G0-00-01 GENERAL NOTES', 'G0-00-02 CODE ANALYSIS',
  'A-101 LEVEL 1 FLOOR PLAN', 'A-102 LEVEL 2 FLOOR PLAN',
  'AE6-01-01 ARCHITECTURAL CEILING PLAN — LEVEL 1',
  'AE6-01-02 ARCHITECTURAL CEILING PLAN — LEVEL 2',
  'AE6-01-03 ARCHITECTURAL CEILING PLAN — LEVEL 3',
  'AE6-02-01 CEILING DETAILS', 'AE6-02-02 CEILING DETAILS',
  'A-501 WALL SECTIONS', 'M2.01 MECHANICAL CEILING',
].map((title, page) => ({ title, page, children: [] }))

const SCOPES: Scope[] = [
  {
    id: 'c-mt-01',
    label: 'C-MT-01 Metal Panel Ceiling',
    scopeType: 'area',
    color: '#c9873f',
    specifications: {
      productType: 'panels',
      panelWidth: '4', panelWidthUnit: 'ft',
      panelLength: '8', panelLengthUnit: 'ft',
      perimeterTrimLength: '10', perimeterTrimLengthUnit: 'ft',
    },
  },
  {
    id: 'c-bf-02',
    label: 'C-BF-02 Linear Baffle',
    scopeType: 'linear',
    color: '#4f8f6d',
    specifications: { productType: 'baffle' },
  },
  {
    id: 'c-ac-03',
    label: 'C-AC-03 Acoustic Cloud',
    scopeType: 'count',
    color: '#7a6fb0',
    specifications: { productType: 'custom_assembly' },
  },
] as Scope[]

/*
 * What is drawn where, for the sheet index's dots.
 *
 * Every shape the dots can take is on some sheet here: one scope, all three,
 * a sheet past the dot budget (the details sheet, page 9, which a real set
 * does reach — every scope has a detail on it), and takeoff that belongs to
 * no scope at all on the wall sections, which draws the hollow dot.
 */
const MORE_SCOPES: SheetScope[] = ['#d95f5f', '#5b8fd9', '#c9b83f', '#8f5bd9'].map((color, i) => ({
  id: `x${i}`, label: `WP-1${i} Wall Panel`, color,
}))
const PAGE_SCOPES = new Map<number, SheetScope[]>([
  [5, [SCOPES[0]!]],
  [6, [SCOPES[0]!, SCOPES[1]!, SCOPES[2]!]],
  [7, [SCOPES[1]!]],
  [9, [...SCOPES, ...MORE_SCOPES]],
])

/*
 * Typed, deliberately, rather than cast.
 *
 * This fixture was `as never` and had gone stale: `runs` and `cells` joined
 * PieceResult and nothing made the harness say so, so the whole harness
 * crashed on `pieces.runs.length` and the one tool for iterating on chrome
 * was dead with no error anyone would see until they opened it.
 */
const PANEL_PIECES: PieceResult = {
  productType: 'panels',
  quantities: [
    { itemKey: 'panel_count', label: 'Panels', unit: 'EA', quantity: 1248 },
    { itemKey: 'trim_pieces', label: 'Trim pieces', unit: 'EA', quantity: 184 },
  ],
  cells: [],
  runs: [],
  blockers: [],
}

/** One of each confidence the bill of materials can carry. */
const BOM_ENTRIES: ScopePieces[] = [
  { scope: SCOPES[0]!, result: PANEL_PIECES },
  {
    scope: SCOPES[1]!,
    result: {
      productType: 'baffle',
      quantities: [
        { itemKey: 'primary_stock', label: 'Baffle stock', unit: 'EA', quantity: 96 },
        { itemKey: 'suspension_rails', label: 'Suspension rails', unit: 'EA', quantity: 24 },
      ],
      cells: [], runs: [], blockers: [],
    },
  },
  {
    scope: SCOPES[2]!,
    result: { productType: 'custom_assembly', quantities: [], cells: [], runs: [], blockers: ['Panel W'] },
  },
]

const FOLDERS: PanelFolder[] = [
  {
    name: 'drawings', detail: '2 files',
    files: [
      { id: 'a', name: 'AE6 CEILING SET.pdf', relativePath: 'drawings/AE6 CEILING SET.pdf', detail: '12 pages' },
      { id: 'c', name: 'A-SERIES FLOOR PLANS.pdf', relativePath: 'drawings/A-SERIES FLOOR PLANS.pdf', detail: '38 pages' },
    ],
  },
  {
    name: 'specs', detail: '1 file',
    files: [
      { id: 'b', name: 'SPECIFICATIONS.pdf', relativePath: 'specs/SPECIFICATIONS.pdf', detail: '212 pages' },
    ],
  },
  {
    name: 'archive', detail: '1 file',
    files: [
      { id: 'd', name: 'OLD SET.pdf', relativePath: 'archive/OLD SET.pdf', detail: 'not found', missing: true },
    ],
  },
]

/** A details sheet with two boxes, one of which overlaps the other at a different scale. */
const REGIONS: ScaleRegion[] = [
  { id: 'r1', pageId: 'p8', rect: { x0: 0.05, y0: 0.08, x1: 0.48, y1: 0.5 }, feetPerPoint: 0.0277777777, label: 'Detail 1 / head' },
  { id: 'r2', pageId: 'p8', rect: { x0: 0.4, y0: 0.3, x1: 0.9, y1: 0.85 }, feetPerPoint: 0.0138888888, label: 'Detail 3 / sill' },
  { id: 'r3', pageId: 'p8', rect: { x0: 0.55, y0: 0.05, x1: 0.95, y1: 0.28 }, feetPerPoint: 0.0555555555, label: '' },
]

const ESTIMATES = [
  { id: 'e1', name: '260529 - Initial Bid Package', scopeCount: 3, markupCount: 12 },
  { id: 'e2', name: '260603 - Updated Bid Pkg', scopeCount: 3, markupCount: 9 },
  { id: 'e3', name: '260729 - Negotiations', scopeCount: 3, markupCount: 4 },
]

/*
 * Every shape a palette row can take, so the harness shows them all: a plain
 * verb, a toggle that stays, a verb with a choose step, one with a text step,
 * a row that cannot run and says why, and the nouns with their prefixes.
 */
const COMMANDS: Command[] = [
  { id: 'fit-width', kind: 'command', title: 'Fit width', shortcut: 'Ctrl+1', keywords: ['zoom'], run: () => {} },
  { id: 'fit-sheet', kind: 'command', title: 'Fit sheet', shortcut: 'Ctrl+0', keywords: ['zoom'], run: () => {} },
  { id: 'next-sheet', kind: 'command', title: 'Next sheet', detail: 'A-413B', shortcut: 'PgDn', stay: true, run: () => {} },
  {
    id: 'set-scale', kind: 'command', title: 'Set scale for this sheet…', detail: "now 1/8″ = 1′", keywords: ['scale'],
    step: {
      kind: 'choose', label: 'Set scale', note: 'applies to A-413A',
      options: () => ['1/16″ = 1′', '1/8″ = 1′', '3/16″ = 1′', '1/4″ = 1′', '1/2″ = 1′', '1″ = 1′']
        .map((label, i): Command => ({ id: `scale-${i}`, kind: 'command', title: label, ...(i === 1 ? { detail: 'current' } : {}), run: () => {} })),
    },
  },
  {
    id: 'new-round', kind: 'command', title: 'New round…', detail: 'A bidding round: the estimate a takeoff lands in', keywords: ['estimate'],
    step: {
      kind: 'text', label: 'New round', placeholder: 'Name the round', rule: 'must be unique',
      validate: (t) => (t.trim() === '' ? 'a round needs a name' : null),
      describe: (t) => (t.trim() === '' ? 'Create a round' : `Create round “${t.trim()}”`), run: () => {},
    },
  },
  {
    id: 'delete-round', kind: 'command', title: 'Delete 260729 - Negotiations', keywords: ['estimate'],
    detail: 'its 3 scopes go to the archive · refused while it holds markups',
    run: () => ({
      reason: 'cannot delete: this round has 41 markups that exist nowhere else',
      alternative: {
        id: 'duplicate-round', kind: 'command', title: 'Duplicate round…', detail: 'Scopes and markups copied; commits are not',
        step: { kind: 'text', label: 'Duplicate round', placeholder: 'Name the copy', initial: '260729 - Negotiations copy', rule: 'must be unique', describe: (t) => `Duplicate as “${t.trim()}”`, run: () => {} },
      },
    }),
  },
  { id: 'take-off', kind: 'command', title: 'Take off in CL03 Baffle Ceiling', detail: 'Area tool, drawing into the scope', keywords: ['scope-action'], run: () => {} },
  { id: 'leave-takeoff', kind: 'command', title: 'Leave takeoff', unavailable: 'not in a takeoff', run: () => {} },
  { id: 'move-markup', kind: 'command', title: 'Move selected markup to…', detail: '0 selected', unavailable: 'nothing selected', keywords: ['scope-action'], run: () => {} },
  { id: 'quantities', kind: 'command', title: 'Parts and quantities', detail: 'The open scope, on its Parts page', keywords: ['bom', 'order'], run: () => {} },
  { id: 'settings', kind: 'command', title: 'Settings', shortcut: 'Ctrl+,', run: () => {} },
  { id: 'set:snap', kind: 'command', title: 'Turn off snap to lines', detail: 'Settings · Drawing · currently on', keywords: ['setting', 'snap'], stay: true, run: () => {} },
  { id: 'set:seams', kind: 'command', title: 'Turn on seams in the layout preview', detail: 'Settings · Takeoff · currently off', keywords: ['setting', 'seams'], stay: true, run: () => {} },
  { id: 'undo', kind: 'command', title: 'Undo area in CL03 Baffle Ceiling', shortcut: 'Ctrl+Z', stay: true, run: () => {} },
  { id: 'redo', kind: 'command', title: 'Redo', shortcut: 'Ctrl+Y', unavailable: 'nothing to redo', stay: true, run: () => {} },
  { id: 'doc-a', kind: 'document', title: 'AE6 CEILING SET.pdf', detail: 'drawings/AE6 CEILING SET.pdf', alt: { label: 'Open in a context window', run: () => {} }, run: () => {} },
  { id: 'doc-b', kind: 'document', title: 'SPECIFICATIONS.pdf', detail: 'specs/SPECIFICATIONS.pdf', alt: { label: 'Open in a context window', run: () => {} }, run: () => {} },
  ...OUTLINE.map((n): Command => ({
    id: `page-${n.page}`, kind: 'page', title: n.title, detail: `Page ${(n.page ?? 0) + 1}`, page: n.page ?? 0, keywords: [n.title], run: () => {},
  })),
  ...SCOPES.map((s): Command => ({
    id: `scope-${s.id}`, kind: 'scope', title: s.label, detail: String(s.specifications['productType']), run: () => {},
  })),
  { id: 'est-e3', kind: 'estimate', title: '260729 - Negotiations', detail: '3 scopes · open', run: () => {} },
  { id: 'project:browse', kind: 'project', title: 'Open a project folder…', run: () => {} },
]

const HITS: SearchHit[] = [
  {
    pageId: 'p6', documentId: 'a', pageNumber: 5, relativePath: 'drawings/AE6 CEILING SET.pdf',
    snippet: '…ceiling type C-MT-01 metal panel, 4 x 8 module, see detail 3/AE6-02-01…',
    snippetSpans: [{ start: 14, length: 7 }], spans: [], boxes: null,
  },
  {
    pageId: 'p8', documentId: 'a', pageNumber: 7, relativePath: 'drawings/AE6 CEILING SET.pdf',
    snippet: '…perimeter trim at C-MT-01 to be continuous, mitred at corners…',
    snippetSpans: [{ start: 19, length: 7 }], spans: [], boxes: null,
  },
  {
    pageId: 'p212', documentId: 'b', pageNumber: 41, relativePath: 'specs/SPECIFICATIONS.pdf',
    snippet: '09 51 33 — C-MT-01: linear metal ceiling panels, 0.032" aluminium, powder coat…',
    snippetSpans: [{ start: 11, length: 7 }], spans: [], boxes: null,
  },
]

/** The indexer a quarter of the way through the Barclays set: what the Search tab and pane show while it runs. */
const INDEXING = { done: 173, total: 693, document: '2026-04-24 - MIDRISE - PKG A - 50_CD - ARCH.pdf' }

/** Answers like a project half-way through indexing, which is the honest case. */
const fakeSearch = (query: string): Promise<SearchReport> => new Promise((resolve) => {
  setTimeout(() => resolve({
    query, mode: 'like', hits: HITS, truncated: false,
    indexedPageCount: 173, totalPageCount: 262, ftsPageCount: 0,
    droppedTokens: [], matchExpression: '',
    degraded: { reason: 'The full-text index is not built for this project.', consequences: LIKE_CONSEQUENCES },
  }), 300)
})

type Show = 'settings' | 'palette' | 'bom' | 'scopes' | 'calibration' | 'regions' | 'search' | 'scalepicker' | 'crash'
/*
 * `noscopes` is a round with nothing in it — what every new project shows
 * first, now that nothing is seeded. It is the state the scope onboarding
 * exists for, and it cannot be reached from `empty`, which has no round.
 */
type Moment = 'scanning' | 'opening' | 'note' | 'empty' | 'noscopes' | 'indexing' | null

const PANE_TITLE: Record<RailPanel, string> = {
  files: 'Files', contents: 'Contents', thumbnails: 'Thumbnails', search: 'Search',
}

/** Throws on render, so the crash screen can be looked at without earning it. */
function Boom(): never {
  throw new Error('Harness: a render that throws, on purpose')
}

export function ShellHarness() {
  const params = new URLSearchParams(location.search)
  const show = params.get('show') as Show | null
  const moment: Moment = params.get('state') as Moment
  const statusText = params.get('status')

  const [rail, setRail] = useState<RailPanel | null>(() => {
    const want = params.get('rail') ?? (params.get('show') === 'search' ? 'search' : null)
    if (want === 'none') return null
    return want === 'files' || want === 'thumbnails' || want === 'search' ? want : 'contents'
  })
  const [workOpen, setWorkOpen] = useState(true)
  const [tool, setTool] = useState<Tool>(() => (show === 'regions' ? 'scale-region' : 'area'))
  const [scope, setScope] = useState<string | null>('c-mt-01')
  const [page, setPage] = useState(6)
  // Fixture scales: two sheets carry one, the rest are deliberately unset so
  // the "no scale" badge and the mixed-selection warning are both reachable.
  const [harnessScales, setHarnessScales] = useState<Map<number, number>>(
    () => new Map([[5, 0.1111111111111111]]),
  )
  const [scaleTarget, setScaleTarget] = useState<number[] | null>(null)
  const [regions, setRegions] = useState<ScaleRegion[]>(REGIONS)
  const [takeoff, setTakeoff] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(show === 'settings')
  const [paletteOpen, setPaletteOpen] = useState(show === 'palette')
  const [scopePage, setScopePage] = useState<ScopePage>(show === 'bom' ? 'parts' : show === 'scopes' ? 'parts' : 'setup')
  /*
   * The two half-finished gestures, as the workspace would hold them: a line
   * measured and waiting for its length, a box drawn and waiting for its
   * scale. Both hold the dock's scale control open.
   */
  const [calibrating, setCalibrating] = useState(show === 'calibration')
  const [pendingRegion, setPendingRegion] = useState(show === 'scalepicker')
  const [addScopeRequest, setAddScopeRequest] = useState(show === 'scopes' ? 1 : 0)
  /*
   * Real navigation state, not no-op callbacks. The estimate list — level one
   * of the panel — was unreachable here because `onOpenEstimate` did nothing,
   * so the harness could only ever show a project with a round already open.
   */
  const [openEstimate, setOpenEstimate] = useState<string | null>(
    moment === 'empty' || moment === 'scanning' ? null : 'e3',
  )
  const [openScope, setOpenScope] = useState<string | null>(
    moment === 'empty' || moment === 'scanning' || moment === 'noscopes'
      || show === 'scopes'
      ? null
      : 'c-mt-01',
  )
  const [zoom, setZoom] = useState(0.43)
  const [activeDoc, setActiveDoc] = useState('a')
  const [settings] = useState(() => SettingsStore.open(memoryStorage()))
  // Fixed at mount: the toast keys on when a line was said.
  const [statusAt] = useState(() => (statusText === null ? 0 : Date.now()))

  const active = SCOPES.find((s) => s.id === scope) ?? null
  const empty = moment === 'empty'
  const pageCount = moment === 'scanning' || moment === 'opening' ? 0 : 12
  const pendingText = moment === 'scanning'
    ? 'Reading the project folder…'
    : moment === 'opening' ? 'Opening the drawing…' : null
  const scopes = empty || moment === 'noscopes' ? [] : SCOPES
  const estimates = empty ? [] : moment === 'noscopes'
    ? [{ id: 'e3', name: '260903 - Tender', scopeCount: 0, markupCount: 0 }]
    : ESTIMATES

  /*
   * Thumbnails drawn here rather than rasterised: the strip asks for a bitmap
   * and polls until it gets one, so a sheet of paper with a title block is
   * enough to see how the grid lays out and how a late thumbnail lands.
   */
  const thumbs = useRef(new Map<number, ImageBitmap>())
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (let i = 0; i < 12; i++) {
        const c = document.createElement('canvas')
        c.width = 96
        c.height = 68
        const g = c.getContext('2d')
        if (g === null) return
        g.fillStyle = '#F2F0EB'
        g.fillRect(0, 0, 96, 68)
        g.strokeStyle = '#9a9a9a'
        g.strokeRect(5.5, 5.5, 85, 57)
        g.fillStyle = '#5a5a5a'
        g.fillRect(58, 54, 30, 6)
        // Stagger so the late-arrival path is exercised, not only the cached one.
        await new Promise((r) => setTimeout(r, 120 * i))
        if (cancelled) return
        thumbs.current.set(i, await createImageBitmap(c))
      }
    })()
    return () => { cancelled = true }
  }, [])

  /*
   * The harness draws the window controls and the frameless reservation the
   * desktop build gets, so the one part of the chrome that only exists under
   * Tauri can still be looked at in a browser.
   */
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    document.documentElement.toggleAttribute('data-frameless', true)
    return () => document.documentElement.removeAttribute('data-frameless')
  }, [])

  if (show === 'crash') {
    return <ErrorBoundary onCloseProject={() => {}}><Boom /></ErrorBoundary>
  }

  /* The scale gestures, against fixtures. Selecting a range in the index and
     setting one scale is the kind of interaction that is tedious to reach in
     a real 110-sheet set and easy to get subtly wrong, so it belongs in the
     harness like the rest of the chrome. */
  const scalePicker = scaleTarget === null ? null : (() => {
    const scales = scaleTarget.map((t) => harnessScales.get(t) ?? null)
    const first = scales[0] ?? null
    const agree = scales.every((x) => x === first)
    return (
      <ScalePicker
        target={scaleTarget.length === 1 ? `sheet ${scaleTarget[0]! + 1}` : `${scaleTarget.length} sheets`}
        current={agree ? first : null}
        mixed={!agree}
        backLabel="Contents"
        onCancel={() => setScaleTarget(null)}
        onApply={(feetPerPoint) => {
          setHarnessScales((prev) => {
            const next = new Map(prev)
            for (const t of scaleTarget) next.set(t, feetPerPoint)
            return next
          })
          setScaleTarget(null)
        }}
      />
    )
  })()

  return (
    <div
      className="shellapp"
      data-pane={rail === null ? 'closed' : 'open'}
      data-work={workOpen ? 'open' : 'closed'}
    >
      <WindowControls
        maximized={maximized}
        onMinimize={() => {}}
        onToggleMaximize={() => setMaximized((v) => !v)}
        onClose={() => {}}
      />
      <TitleBar
        projectName="Turkish Airlines Lounge"
        appMenu={{
          onOpenProject: () => {},
          onOpenDrawing: () => setRail('files'),
          onContextWindow: () => {},
          onPalette: () => setPaletteOpen(true),
          onSettings: () => setSettingsOpen(true),
          onCloseProject: () => {},
        }}
        projectMenu={{
          currentPath: 'C:/Jobs/00051 — Turkish Airlines Lounge',
          recents: [
            { path: 'C:/Jobs/00051 — Turkish Airlines Lounge', name: 'Turkish Airlines Lounge' },
            { path: 'C:/Jobs/00045 — Barclays Toronto', name: 'Barclays Toronto' },
            { path: 'C:/Jobs/00041 — 44 Wall Street', name: '44 Wall Street' },
            { path: 'D:/Archive/00033 — Midrise Floors', name: 'Midrise Floors', missing: true },
          ],
          onOpen: () => {},
          onBrowse: () => {},
        }}
        workOpen={workOpen}
        onToggleWork={() => setWorkOpen((v) => !v)}
      >
        <DocumentTabStrip
          tabs={empty || moment === 'scanning' ? [] : [
            { id: 'a', name: 'AE6 CEILING SET.pdf', relativePath: 'drawings/AE6 CEILING SET.pdf' },
            { id: 'b', name: 'SPECIFICATIONS.pdf', relativePath: 'specs/SPECIFICATIONS.pdf' },
          ]}
          activeId={activeDoc}
          onSelect={setActiveDoc}
          onClose={() => {}}
          onBrowse={() => setRail('files')}
          onPopOut={() => {}}
        />
      </TitleBar>

      <Sidebar
        active={rail}
        notes={moment === 'note'
          ? { files: 'The folder scan accounted for 412 fewer documents than the catalog, so documents were not reconciled. Existing takeoffs are untouched.' }
          : {}}
        onSelect={(p) => setRail((cur) => (cur === p ? null : p))}
        onSettings={() => setSettingsOpen(true)}
        indexing={moment === 'indexing' ? INDEXING : null}
        title={rail === null
          ? undefined
          : scalePicker !== null && rail === 'contents' ? 'Set scale' : PANE_TITLE[rail]}
      >
        {rail !== null && (<>
          {/* The picker takes the pane the selection was made in. */}
          {rail === 'contents' && scalePicker}
          {rail === 'contents' && scalePicker === null && (
            <SheetIndex
              pageCount={pageCount}
              shape="per-sheet"
              outline={OUTLINE}
              labels={[]}
              takeoffPages={new Set(empty ? [] : [5, 6, 7, 9, 10])}
              {...(empty ? {} : { pageScopes: PAGE_SCOPES })}
              current={page}
              onGoToPage={setPage}
              scaleOf={(targetPage) => harnessScales.get(targetPage) ?? null}
              onSetScale={setScaleTarget}
              pending={pendingText}
            />
          )}
          {rail === 'thumbnails' && (
            <PageStrip
              pageCount={pageCount}
              current={page}
              requestThumbnail={(i) => thumbs.current.get(i)}
              onGoTo={setPage}
              labels={Object.fromEntries(OUTLINE.flatMap((n) =>
                (n.page === null ? [] : [[n.page, n.title.split(' ')[0] ?? '']])))}
              empty={pendingText ?? 'No document open.'}
            />
          )}
          {rail === 'files' && (
            <FileList
              files={moment === 'scanning' || empty ? [] : FOLDERS.flatMap((f) => f.files)}
              activeId={activeDoc}
              openIds={['a', 'b']}
              onOpen={setActiveDoc}
              onOpenContext={() => {}}
              scanning={moment === 'scanning'}
              note={moment === 'note'
                ? 'The folder scan accounted for 412 fewer documents than the catalog, so documents were not reconciled. Existing takeoffs are untouched.'
                : empty ? 'No PDFs found in this project folder.' : null}
            />
          )}
          {rail === 'search' && (
            <SearchPanel
              onSearch={empty ? null : fakeSearch}
              onGoToHit={(h) => { setActiveDoc(h.documentId); setPage(h.pageNumber) }}
              onClose={() => setRail(null)}
              indexing={moment === 'indexing' ? INDEXING : null}
            />
          )}
        </>)}
      </Sidebar>

      {settingsOpen && (
        <div className="settingsview">
          <SettingsPanel store={settings} onClose={() => setSettingsOpen(false)} />
        </div>
      )}

      <div className="viewport">
        {statusText !== null && <StatusToast text={statusText} at={statusAt} />}
        <div className="stage" />
        <Dock
          read={<ReadPill tool={tool} onTool={(t) => setTool(t as Tool)} />}
          left={
            <ToolPill
              tool={tool}
              onTool={setTool}
              scopes={scopes}
              activeScope={scope}
              onScope={setScope}
              onSpecifications={() => { setScopePage('setup'); setOpenScope(scope) }}
              onQuantities={() => { setScopePage('parts'); setOpenScope(scope) }}
              takeoff={takeoff}
              onTakeoff={setTakeoff}
              estimates={estimates}
              openEstimateId={openEstimate}
              onEstimate={(id) => { setOpenEstimate(id); setOpenScope(null) }}
              onAddScope={() => { setOpenScope(null); setAddScopeRequest((n) => n + 1) }}
              layoutOn={false}
              onToggleLayout={() => {}}
            />
          }
          right={
            <DocumentPill
              page={page}
              pageCount={pageCount}
              onPage={setPage}
              feetPerPoint={harnessScales.get(page) ?? null}
              onPreset={() => {}}
              onCalibrate={() => setCalibrating(true)}
              onDrawRegion={() => setTool('scale-region')}
              regions={{
                list: page === 8 || show === 'regions' || show === 'scalepicker' ? regions : [],
                conflicting: new Set(['r1', 'r2']),
                onDelete: (id) => setRegions((rs) => rs.filter((r) => r.id !== id)),
                toolActive: tool === 'scale-region',
                onDone: () => setTool('pan'),
              }}
              {...(calibrating
                ? {
                    calibration: {
                      lengthPdfPoints: 412.35,
                      error: params.get('error') === null ? null : 'That is not a length. Try 20 or 7 1/2.',
                      onSubmit: () => setCalibrating(false),
                      onCancel: () => setCalibrating(false),
                    },
                  }
                : {})}
              {...(pendingRegion
                ? {
                    pendingRegion: {
                      onApply: () => { setPendingRegion(false); setTool('pan') },
                      onCancel: () => { setPendingRegion(false); setTool('pan') },
                    },
                  }
                : {})}
              zoom={zoom}
              onZoom={setZoom}
              onFitPage={() => setZoom(0.43)}
              onFitWidth={() => setZoom(0.61)}
            />
          }
        />
      </div>

      <EstimatesPanel
        projectName="Turkish Airlines Lounge"
        estimates={estimates}
        loaded={moment !== 'scanning'}
        openEstimateId={openEstimate}
        onOpenEstimate={setOpenEstimate}
        openScopeId={openScope}
        onOpenScope={setOpenScope}
        scopes={scopes}
        markupCountFor={(id) => (id === 'c-mt-01' ? 4 : 0)}
        files={moment === 'noscopes' ? [] : [
          { documentId: 'a', relativePath: 'drawings/AE6 CEILING SET.pdf', markupCount: 4 },
        ]}
        onOpenDocument={setActiveDoc}
        rows={[
          { itemKey: 'area', label: 'Gross area', unit: 'SF', quantity: 19968 },
          { itemKey: 'perimeter', label: 'Trim', unit: 'LF', quantity: 412.5 },
        ]}
        pieces={PANEL_PIECES}
        markups={[
          { id: '1', kind: 'area', page: 5, measure: '1,204.3 SF' },
          { id: '2', kind: 'area', page: 6, measure: '2,411.8 SF' },
          { id: '3', kind: 'cutout', page: 6, measure: '−87.2 SF' },
          { id: '4', kind: 'polyline', page: 7, measure: '112.0 LF', layoutNote: 'sheet has no scale' },
        ]}
        sheetLabel={(p: number) => OUTLINE[p]?.title.split(' ')[0] ?? `Page ${p + 1}`}
        onGoToPage={setPage}
        onCreateEstimate={() => {}}
        onCreateScope={() => {}}
        addScopeRequest={addScopeRequest}
        onDuplicateScope={() => {}}
        archived={[{ ...SCOPES[2]!, id: 'old', label: 'WP-12 Wall Panel (2025 bid)' }]}
        onRestoreScope={() => {}}
        onSaveScope={() => {}}
        onTakeOff={() => setTakeoff(true)}
        warnings={params.get('warnings') === null ? [] : [
          'Sheet AE6-01-02 has no scale, so 2 markups on it contribute nothing.',
          'C-BF-02 has no pattern direction.',
          'The layout preview is paused while a specification is incomplete.',
        ]}
        layoutOn={false}
        onToggleLayout={() => {}}
        commit={{ at: '2026-08-29T10:12:00Z', delta: [] }}
        onCommit={() => {}}
        onDuplicateEstimate={() => {}}
        onRenameEstimate={() => {}}
        onDeleteEstimate={() => {}}
        onRemoveScope={() => {}}
        bill={{
          entries: BOM_ENTRIES,
          calibrated: params.get('calibrated') !== 'no',
          documents: ['AE6 CEILING SET.pdf', 'SPECIFICATIONS.pdf'],
          markupCount: 4,
          onExportMarkedPdf: () => Promise.resolve(params.get('fail') === null ? null : 'The drawing could not be written: the file is open in another program.'),
        }}
        scopePage={scopePage}
        onScopePage={setScopePage}
        totalFor={(id) => (id === 'c-mt-01' ? '19,968 SF' : id === 'c-bf-02' ? '412.5 LF' : null)}
        onSetDirection={() => setTool('direction')}
        direction={scope === 'c-mt-01' ? 'set on AE6-01-01' : null}
      />

      {paletteOpen && (
        <CommandPalette commands={COMMANDS} onClose={() => setPaletteOpen(false)} onSearchText={() => setPaletteOpen(false)} />
      )}
    </div>
  )
}
