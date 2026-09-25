/**
 * The command palette is the only overlay this app is allowed to have.
 *
 * Aaron, on pressing "Add scope" and getting a window over the drawing: "why
 * does hitting add scope pop up a weird modal? everything should be done in
 * the sidebar. ANYTHING that triggers a non-command-palette modal popup needs
 * to be reassessed and integrated into the proper UI." That is a rule about
 * the whole product, and each former dialog now has a surface it belongs to:
 *
 *   scope editor      → the estimates sidebar (named in the round, edited on
 *                       the scope's page, managed from its ⋯ menu)
 *   bill of materials → the estimates sidebar, a level under the round
 *   document browser  → the Files pane, which gained the filter
 *   scale picker      → the Contents pane, in place of the index it was asked
 *                       from; or the dock's scale control, for a region
 *   calibration entry → the dock's scale control, held open
 *   region list       → the dock's scale control
 *
 * These assert the shape, on the files this side owns. layering.test.ts
 * asserts the workspace mounts them there.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

const SURFACES = {
  'RightWorkspace.tsx': read('./RightWorkspace.tsx'),
  'Dock.tsx': read('./Dock.tsx'),
  'CalibrationEntry.tsx': read('./CalibrationEntry.tsx'),
  'Shell.tsx': read('./Shell.tsx'),
  'ShellHarness.tsx': read('./ShellHarness.tsx'),
  '../scale/ScalePicker.tsx': read('../scale/ScalePicker.tsx'),
  '../scale/RegionList.tsx': read('../scale/RegionList.tsx'),
}

describe('no surface is a dialog', () => {
  for (const [name, src] of Object.entries(SURFACES)) {
    it(`${name} does not claim to be modal`, () => {
      expect(src).not.toContain('aria-modal')
      expect(src).not.toContain('className="modal')
    })
  }

  /**
   * The harness mounts every surface the app has, and the app has no modal
   * layer: a `.modal` here would be a surface the harness shows that the app
   * does not, or the reverse.
   */
  it('the harness has no modal layer and imports no dialog', () => {
    const src = SURFACES['ShellHarness.tsx']
    expect(src).not.toContain("'modal'")
    for (const dialog of ['ScopeEditor', 'BomPanel', 'CalibrationForm', 'DocumentBrowser']) {
      expect(src, `${dialog} is still mounted by the harness`).not.toContain(`<${dialog}`)
    }
  })
})

describe('the scope editor, in the sidebar', () => {
  const src = SURFACES['RightWorkspace.tsx']

  it('names a new scope in the round, and asks the workspace to make it', () => {
    expect(src).toContain('onCreateScope?: (label: string) => void')
    expect(src).not.toContain('onAddScope')
    // The naming row is the same control the round itself is named with.
    expect(src).toContain('label="New scope name"')
  })

  it('takes a request to add a scope from outside the panel', () => {
    expect(src).toContain('addScopeRequest?: number')
  })

  /**
   * Board of 2026-09-18: secondary and destructive commands live in the
   * page's ⋯ menu and nowhere else — no footer bar, no row-face buttons.
   */
  it('manages the scope from its own ⋯ menu, not a footer', () => {
    for (const action of ['onDuplicateScope', 'onRemoveScope', 'onRestoreScope']) {
      expect(src, `${action} is not offered`).toContain(`${action}(`)
    }
    expect(src).not.toContain('scopefoot')
    expect(src).toContain('label="Remove from round…"')
    // Rename in place (F2 or the menu) and what-it-counts were the two fields only the dialog had.
    expect(src).toContain('label="Scope name"')
    expect(src).toContain('id="scope-counts"')
  })
})

describe('the bill of materials, folded into the scope', () => {
  const src = SURFACES['RightWorkspace.tsx']

  /** Aaron, 2026-09-04: material never shows at the estimate level. */
  it('is no level of the estimates panel', () => {
    expect(src).not.toContain('<BomView')
    expect(src).not.toContain('bomOpen')
    expect(src).not.toContain('billlink')
  })

  /**
   * Parts is a table with what each line was at the commit, when that
   * differs. No caveats on the ROWS: confidence is said once, as a chip on
   * the Parts header (board 4, approved 2026-09-18), never per line.
   */
  it('reads its parts on the scope, with what moved since the commit', () => {
    expect(src).toContain('function PartsTable(')
    expect(src).toContain('wasOf')
    expect(src).not.toContain('bomconf')
    const table = src.slice(src.indexOf('function PartsTable('), src.indexOf('function SetupGrid('))
    expect(table).not.toContain('unverified')
    expect(src).toContain('isVerifiedProduct(product)')
  })

  /**
   * A part is a thing you buy (board 4). The breakdown of a count and the
   * lengths behind a part are a detail line, a run product's installed
   * length is a tile, and a hand-quantified product has no Parts section.
   */
  it('folds breakdowns and lengths into the part they belong to', () => {
    expect(src).toContain("const FOLDED_ITEMS = new Set(['panel_full', 'panel_half', 'linear_measured', 'linear_ordered', 'linear_offcut'])")
    expect(src).toContain("if (item.itemKey === 'net_linear') { view.installedFeet = item.quantity; continue }")
    expect(src).toContain("{product !== 'custom_assembly' && (")
  })

  it('exports from the round\'s accent action and menu, narrowed to the open round', () => {
    expect(src).toContain('entriesForRound(')
    expect(src).toContain('>Export…</button>')
    for (const item of ['Save report…', 'Delete round…', 'Duplicate round', 'Rename']) {
      expect(src, `${item} is not in the round menu`).toContain(`label="${item}"`)
    }
    expect(src).toContain("'Save marked-up PDF…'")
    expect(src).toContain('saveReportFile(')
  })
})

describe('the scope pane, one screen', () => {
  const src = SURFACES['RightWorkspace.tsx']

  /**
   * The quantity tiles — only what the scope measures, no slot ever "—"
   * (board 4, 2026-09-18) — then one InfoBar with at most one action.
   */
  it('puts the quantity tiles above one InfoBar', () => {
    expect(src).toContain('...slotsOf([rows]),')
    expect(src).toContain(".filter((slot) => slot.total !== null)")
    expect(src).toContain('<InfoBar tone={status.tone} action={status.action}>')
  })

  /**
   * One column (Aaron, 2026-09-11): Parts, Setup and Markups are on screen
   * together, Parts first. The board of 2026-09-18 removed the jump bar
   * that repeated their names above them and the folds; nothing switches,
   * nothing folds, and the caller's section request scrolls.
   */
  it('is one column, Parts then Setup then Markups, with no jump bar and no folds', () => {
    expect(src).not.toContain('jumpbar')
    expect(src).not.toContain('role="tablist"')
    expect(src).not.toContain('aria-expanded={!folded')
    const parts = src.indexOf('data-section="parts"')
    const setup = src.indexOf('data-section="setup"')
    const markups = src.indexOf('data-section="markups"')
    expect(parts).toBeGreaterThan(0)
    expect(setup).toBeGreaterThan(parts)
    expect(markups).toBeGreaterThan(setup)
    expect(src).toContain('if (p.scopePage !== undefined && mounted.current) show(p.scopePage)')
  })

  /** The product names the scope's kind, so it sits in the header, not the grid. */
  it('keeps the product in the header and the grid uniform', () => {
    const header = src.indexOf('id="scope-type"')
    const grid = src.indexOf('function SetupGrid(')
    expect(header).toBeGreaterThan(0)
    expect(header).toBeLessThan(grid)
  })
})

describe('the document browser, in the files pane', () => {
  const src = SURFACES['Shell.tsx']

  it('gives the files pane the filter the browser had', () => {
    const at = src.indexOf('export function FileList(')
    const list = src.slice(at)
    expect(list).toContain('className="panesearch"')
    expect(list).toContain('filterFileTree(')
  })

  it('says which documents already have a tab', () => {
    expect(src).toContain('openIds?: readonly string[]')
  })

  it('can be asked to take the cursor', () => {
    expect(src).toContain('focusNonce?: number')
  })
})

describe('the sheet scale, in the dock', () => {
  const src = SURFACES['Dock.tsx']
  const pill = src.slice(src.indexOf('export interface DocumentPillProps'), src.indexOf('export function DocumentPill('))

  it('holds the calibration entry, the pending region, and the regions', () => {
    expect(pill).toContain('calibration?: CalibrationEntryProps')
    expect(pill).toContain('pendingRegion?: PendingRegionEntry')
    expect(pill).toContain('regions?: SheetScaleRegions')
  })

  /**
   * A half-finished gesture must not be dismissed by a click elsewhere: the
   * line or the box just drawn would go with it. The control is pinned open
   * and only Cancel, Escape inside it, or Apply lets go.
   */
  it('cannot be dismissed while a gesture is half-finished', () => {
    const body = src.slice(src.indexOf('export function DocumentPill('))
    expect(body).toContain('const pinned = calibration !== undefined || pendingRegion !== undefined')
    expect(body).toContain('useDismiss(scaleOpen && !pinned')
  })

  it('offers the region tool where the scale is', () => {
    expect(pill).toContain('onDrawRegion?: () => void')
  })
})

describe('the dock', () => {
  const src = SURFACES['Dock.tsx']

  /** The takeoff tool table alone — up to its closing bracket, not the prose after it. */
  const tools = (() => {
    const at = src.indexOf('const TOOLS:')
    return src.slice(at, src.indexOf('\n]', at))
  })()

  /**
   * Pan is not a takeoff tool; it produces no markup and no quantity. It
   * leads the work surface as a read tool (board 1, 2026-09-18), and the
   * read tools are marked for the Minimum tier, which folds the ones not in
   * hand into the overflow.
   */
  it('keeps Pan out of the takeoff tools, among the read tools', () => {
    expect(tools).not.toContain("'pan'")
    expect(src).toContain("READ_TOOLS.map((t) => toolButton(t, 'read'))")
  })

  /** A dimension is read off the sheet, not taken off into a quantity. */
  it('puts Dimension beside Pan, not among the scope tools', () => {
    const read = src.slice(src.indexOf('const READ_TOOLS'), src.indexOf('const COMMON_SCALES'))
    expect(read).toContain("id: 'dimension'")
    expect(tools).not.toContain("'dimension'")
  })

  it('switches the estimate from the takeoff pill', () => {
    const pill = src.slice(src.indexOf('export interface ToolPillProps'), src.indexOf('export function ToolPill('))
    expect(pill).toContain('estimates?: DockEstimate[]')
    expect(pill).toContain('onEstimate?: (id: string) => void')
  })

  /**
   * The approved toolbar (2026-09-11 mockup): sheet nav, then minus, the
   * percentage, plus and fit, as buttons. The stepper was folded into the
   * zoom menu once for density; it is back because the group is its own
   * surface now and the buttons are what the mockup shows. They still give
   * way first when the drawing narrows.
   */
  it('shows the zoom stepper and fit on the sheet group, collapsing first', () => {
    const body = src.slice(src.indexOf('export function DocumentPill('))
    expect(body).toContain('data-collapse="zoomstep"')
    expect(body).toContain('data-collapse="fit"')
    expect(body).toContain('aria-label="Zoom in"')
    expect(body).toContain('aria-label="Fit sheet"')
  })

  /**
   * Nothing that is not a tool. Layout preview, Specifications and Quantities
   * are commands and sidebar pages (Aaron, 2026-09-11). The overflow is back
   * (board 2, approved 2026-09-18) — but it holds only what a narrower
   * drawing shed, never a panel opener: every item names the tier it appears
   * from, and nothing in it exists at the widest width.
   */
  it('carries no panel openers, and an overflow that holds only shed commands', () => {
    const pill = src.slice(src.indexOf('export function ToolPill('), src.indexOf('export function DocumentPill('))
    for (const gone of ['onSpecifications', 'onQuantities', 'onToggleLayout', 'More tools']) {
      expect(pill, gone).not.toContain(gone)
    }
    const menu = pill.slice(pill.indexOf('className="dockmenu right" role="menu"'))
    const items = menu.match(/<button[\s\S]*?>/g) ?? []
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) expect(item, item).toMatch(/data-from="(compact|minimum)"/)
  })

  /**
   * No drawing: the scope pill stays, because choosing where markups land
   * does not need a sheet. The read tools, Take off and the overflow are a
   * different component and are not mounted — no disabled row, no listeners.
   */
  it('leaves the tools unmounted when no drawing is open', () => {
    const gate = src.slice(src.indexOf('export function ToolPill('), src.indexOf('function WorkSurface('))
    expect(gate).toContain('props.documentOpen === false')
    expect(gate).toContain('<IdleWorkSurface')
    const idle = src.slice(src.indexOf('function IdleWorkSurface('), src.indexOf('export function ToolPill('))
    expect(idle).toContain('aria-label="Scope"')
    expect(idle).not.toContain('READ_TOOLS')
    expect(idle).not.toContain('docktakeoff')
    expect(idle).not.toContain('dockmore')
    expect(idle).not.toContain('useDismiss')
    expect(idle).not.toContain('useClampedPopover')
  })

  /**
   * No sheet: page, zoom, scale and their overflow are not mounted, unless a
   * calibration or a region is already waiting — that control is the question.
   */
  it('leaves the sheet controls unmounted when there is no sheet', () => {
    const gate = src.slice(src.indexOf('export function DocumentPill('), src.indexOf('function SheetSurface('))
    expect(gate).toContain('props.pageCount === 0')
    expect(gate).toContain('props.calibration === undefined')
    expect(gate).toContain('props.pendingRegion === undefined')
    expect(gate).toContain('props.regions?.toolActive !== true')
    expect(gate).toContain('return null')
    expect(gate).not.toContain('useDismiss')
    expect(gate).not.toContain('useState')
  })

  /**
   * The closed pill, the menu and Take off use one set of words. "Add a scope…"
   * is the phrase in both places; a missing round is "No round open" on the
   * pill and in the menu, and Take off says to start one.
   */
  it('uses the same words for a missing round and a missing scope', () => {
    const scope = src.slice(src.indexOf('function ScopeControl('), src.indexOf('function IdleWorkSurface('))
    expect(scope).toContain("'No round open'")
    expect(scope).toContain("'Add a scope…'")
    expect(scope).toContain("'Choose a scope…'")
    expect(scope).toContain('>Add a scope…</span>')
    expect(scope).toContain("round?.name ?? 'No round open'")
    expect(scope).not.toContain('No estimate open')
    expect(scope).not.toContain('Add scope…')
    const work = src.slice(src.indexOf('function WorkSurface('), src.indexOf('export function DocumentPill('))
    expect(work).toContain('Start a round first')
    expect(work).toContain('Add a scope first')
    expect(work).toContain('Choose a scope first')
    expect(work).not.toContain('Open a drawing first')
    expect(work).not.toContain('disabled={!documentOpen}')
  })

  /** One slot, two states: the accent Take off at rest, an outlined Done in takeoff. */
  it('puts Done where Take off was, not an × after the tools', () => {
    const pill = src.slice(src.indexOf('export function ToolPill('), src.indexOf('export function DocumentPill('))
    expect(pill).toContain('className="docktakeoff done"')
    expect(pill).not.toContain('Leave takeoff"\n          aria-label="Leave takeoff"')
    expect(pill).not.toContain('<Glyph icon={X}')
  })
})
