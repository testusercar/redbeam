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
 *                       the scope's page, managed at the foot of it)
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
    expect(src).toContain('aria-label="New scope name"')
  })

  it('takes a request to add a scope from outside the panel', () => {
    expect(src).toContain('addScopeRequest?: number')
  })

  it('manages the scope at the foot of its own page', () => {
    for (const action of ['onDuplicateScope', 'onRemoveScope', 'onRestoreScope']) {
      expect(src, `${action} is not offered`).toContain(`${action}(`)
    }
    // Rename and what-it-counts were the two fields only the dialog had.
    expect(src).toContain('aria-label="Scope name"')
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

  it('reads its parts on the scope, with each line\'s confidence', () => {
    expect(src).toContain('function PartsPage(')
    expect(src).toContain('buildBom([{ scope, result: pieces }])')
  })

  it('exports from the round\'s menu, narrowed to the open round', () => {
    expect(src).toContain('entriesForRound(')
    for (const item of ['Save report…', 'Copy bill as TSV', 'Save marked-up PDF…', 'Delete round', 'Duplicate round', 'Rename']) {
      expect(src, `${item} is not in the round menu`).toContain(item)
    }
    expect(src).toContain('saveReportFile(')
    expect(src).toContain('copyBillTsv(')
  })
})

describe('the scope pane, on three pages', () => {
  const src = SURFACES['RightWorkspace.tsx']

  it('puts the quantity above the pages, with one status line', () => {
    expect(src).toContain('className="scopehero"')
    expect(src).toContain('herostatus')
  })

  it('is a SelectorBar of Parts, Setup and Markups, and Parts opens first', () => {
    expect(src).toContain("useState<ScopePage>('parts')")
    for (const page of ["'parts'", "'setup'", "'markups'"]) expect(src).toContain(`page === ${page}`)
    expect(src).toContain('role="tablist"')
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

  /** Pan is not a takeoff tool; it produces no markup and no quantity. */
  it('keeps Pan out of the takeoff tools, in its own pill', () => {
    expect(tools).not.toContain("'pan'")
    expect(src).toContain('export function ReadPill(')
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
   * Density. The document pill carried minus, plus and fit as permanent
   * buttons beside a percentage that already opened a menu; the wheel and the
   * pinch step the zoom and Ctrl+0 fits, so the buttons were the third way.
   */
  it('keeps the zoom stepper in the zoom menu, not on the pill', () => {
    const body = src.slice(src.indexOf('export function DocumentPill('))
    expect(body).not.toContain('data-collapse="zoomstep"')
    expect(body).not.toContain('data-collapse="fit"')
    expect(body).toContain('Zoom in')
    expect(body).toContain('Fit sheet')
  })
})
