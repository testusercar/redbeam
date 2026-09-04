/**
 * Guards on two defects that made the app look non-functional.
 *
 * Neither produced an error. A dialog opened behind the toolbar and a markup
 * lost its right-hand half both look exactly like "the button does nothing" and
 * "the app is broken", which is why they survived a release and a design review.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

const workspace = read('../Workspace.tsx')

/**
 * THE PALETTE IS THE ONLY OVERLAY.
 *
 * Aaron, on "Add scope" opening a window over the drawing: "ANYTHING that
 * triggers a non-command-palette modal popup needs to be reassessed and
 * integrated into the proper UI." The dialogs had already been through one
 * round of this — they rendered inside `.viewport`, clipped and under the
 * dock, and were moved to a modal layer so they would at least appear. The
 * layer was the wrong answer to the right defect. Each is now mounted in the
 * surface its moment is already in, and this holds the workspace to it.
 */
describe('surfaces', () => {
  it('has no modal layer', () => {
    expect(workspace).not.toContain('className="modal"')
    expect(workspace).not.toContain('useFocusTrap<HTMLDivElement>(modal')
  })

  it('mounts none of the retired dialogs', () => {
    for (const dialog of ['BomPanel', 'DocumentBrowser', 'ScopeEditor', 'CalibrationForm']) {
      expect(workspace, `${dialog} is still mounted`).not.toContain(`<${dialog}`)
    }
  })

  /**
   * The page-range picker takes the panel the selection was made in — inside
   * the sidebar, not the viewport and not a layer, and only while a selection
   * is waiting for its scale.
   *
   * This read `<Pane>` until 2026-09-04, when the rail and the pane became one
   * `<Sidebar>`. Same claim, one fewer element to hold it.
   */
  it('puts the scale picker in the Contents panel', () => {
    const side = workspace.slice(workspace.indexOf('<Sidebar'), workspace.indexOf('</Sidebar>'))
    expect(side).toContain('<ScalePicker')
    expect(side).toContain("railPanel === 'contents' && scaleTarget !== null")
    expect(workspace.indexOf('<ScalePicker')).toBeLessThan(workspace.indexOf('<div className="viewport">'))
  })

  /**
   * Everything about a sheet's scale reaches the drawing through the pill
   * that reads it. The regions, a region waiting for its scale and a line
   * waiting for its length are props of that control, not surfaces of their
   * own — and the stage refuses to draw while either question is open, since
   * nothing scrims it any more.
   */
  it('gives the dock the regions and both pending gestures', () => {
    const pill = workspace.slice(workspace.indexOf('<DocumentPill'), workspace.indexOf('</Dock>', workspace.indexOf('<DocumentPill')))
    expect(pill).toContain('regions={{')
    expect(pill).toContain('calibration: {')
    expect(pill).toContain('pendingRegion: {')
    expect(workspace).not.toContain('<RegionList')
    const down = workspace.slice(workspace.indexOf('const onPointerDown = '), workspace.indexOf("if (tool === 'pan')"))
    // The REFS: the state form let a third click land before React had
    // re-rendered with the pending question, and a two-point line grew a
    // third point behind the form asking about it.
    expect(down).toContain('if (pendingCalRef.current !== null || pendingRegionRef.current !== null) return')
    expect(down).not.toContain('if (pendingCal !== null || pendingRegion !== null) return')
  })

  /**
   * The other half of pinning, and the half that bites.
   *
   * The entries handle Escape themselves, but only while focus is inside them,
   * and focus does not stay: measure a reference line, click the sheet to see
   * it better, and the stage has focus. Escape then reached only `cancelDraft`
   * — the line went, the question stayed, and the next number typed would have
   * calibrated the page against geometry that no longer existed. So the window
   * handler answers the pending question FIRST, and returns.
   */
  it('lets Escape cancel a pending question before it cancels the draft', () => {
    const at = workspace.indexOf("if (e.key === 'Escape') {")
    expect(at).toBeGreaterThan(-1)
    const branch = workspace.slice(at, workspace.indexOf('}', workspace.indexOf('cancelDraft()', at)))
    expect(branch).toContain('if (pendingCalRef.current !== null) { cancelCalibration(); return }')
    expect(branch).toContain('if (pendingRegionRef.current !== null) { cancelRegion(); return }')
    // Order is the whole point: a cancelDraft above these would clear the line
    // before either check ran, which is the bug this replaced.
    expect(branch.indexOf('cancelDraft()')).toBeGreaterThan(branch.indexOf('pendingRegionRef'))
  })

  it('gives the sidebar the bill and the scope management', () => {
    const panel = workspace.slice(workspace.indexOf('<EstimatesPanel'), workspace.indexOf('/>', workspace.indexOf('<EstimatesPanel')))
    for (const prop of ['bill={{', 'scopePage={scopePage}', 'onCreateScope=', 'addScopeRequest=', 'onDuplicateScope=', 'onRestoreScope=', 'archived=']) {
      expect(panel, `${prop} is not passed`).toContain(prop)
    }
  })

  it('gives the files pane the browser\'s focus and open marks', () => {
    const pane = workspace.slice(workspace.indexOf('<FileList'), workspace.indexOf('/>', workspace.indexOf('<FileList')))
    expect(pane).toContain('focusNonce={filesFocus}')
    expect(pane).toContain('openIds={openDocIds}')
  })

  /**
   * Settings is the one full-screen place, and deliberately so: six
   * categories and forty controls is somewhere you go and leave, not a
   * question to answer and dismiss. It fills the window under the title bar
   * instead of floating over the work, and it is not a dialog.
   */
  it('keeps settings as a full view', () => {
    const start = workspace.indexOf('className="settingsview"')
    expect(start).toBeGreaterThan(-1)
    expect(workspace.slice(start, start + 400)).toContain('<SettingsPanel')
  })
})

describe('canvas sizing', () => {
  /**
   * `sizeCanvas(a) || sizeCanvas(b)` short-circuits: once the raster resized,
   * the overlay never did, so it kept a stale backing store. The symptom was a
   * markup whose fill stopped dead at a vertical line partway across the
   * viewport — the edge of the overlay canvas.
   */
  it('sizes both canvases rather than short-circuiting on the first', () => {
    expect(workspace).not.toMatch(/sizeCanvas\([^)]*\)\s*\|\|\s*sizeCanvas\(/)
    expect(workspace).toMatch(/sizeCanvas\(rasterRef\.current, stage\)/)
    expect(workspace).toMatch(/sizeCanvas\(overlayRef\.current, stage\)/)
  })
})

describe('the pointer', () => {
  /** Right-click backs out of a tool; it must not also place a vertex. */
  it('draws only with the primary button', () => {
    expect(workspace).toMatch(/e\.pointerType === 'mouse' && e\.button !== 0/)
  })

  /**
   * A right-click means "back out" while something is being drawn, and "what
   * can I do with this?" when nothing is — the same instinct at two different
   * moments, and never ambiguous, because a draft is either in progress or it
   * is not. What it must never do is open the webview's own menu.
   */
  it('never leaves the right-click to the webview', () => {
    const at = workspace.indexOf('onContextMenu={(e) => {')
    expect(at, 'the stage no longer handles a right-click').toBeGreaterThan(-1)
    expect(workspace.slice(at, at + 120)).toContain('e.preventDefault()')
  })

  it('still cancels a draft in progress', () => {
    const at = workspace.indexOf('onContextMenu={(e) => {')
    const handler = workspace.slice(at, workspace.indexOf('}}', workspace.indexOf('setMarkupMenu({', at)))
    expect(handler).toContain('cancelDraft()')
    // The cancel branch has to come FIRST, or a right-click meant to abandon a
    // half-drawn shape would hit-test the sheet underneath it instead.
    expect(handler.indexOf('cancelDraft()')).toBeLessThan(handler.indexOf('hitTest('))
  })

  it('opens the markup menu when there is no draft', () => {
    const at = workspace.indexOf('onContextMenu={(e) => {')
    const handler = workspace.slice(at, workspace.indexOf('setMarkupMenu({', at) + 200)
    expect(handler).toContain('hitTest(')
    expect(handler).toContain('setMarkupMenu({')
  })
})

describe('window controls', () => {
  const capabilities = read('../../src-tauri/capabilities/default.json') as string
  const granted: string[] = JSON.parse(capabilities).permissions

  /**
   * These are CORE commands, so they go through Tauri's ACL. Without the
   * grants they reject, and the frame's own buttons do nothing at all —
   * silently, because the call sites discard the rejection.
   */
  it('are granted the permissions the app-drawn frame needs', () => {
    for (const p of [
      'core:window:allow-minimize',
      'core:window:allow-toggle-maximize',
      'core:window:allow-is-maximized',
      'core:window:allow-close',
      'core:window:allow-start-dragging',
    ]) {
      expect(granted, `${p} is not granted`).toContain(p)
    }
  })
})

/**
 * Every window is at least as wide as the grid it has to draw.
 *
 * The shell's columns are `44 + minmax(232) + minmax(360) + minmax(320)` —
 * 956px that nothing in the cascade can compress. The first window's minimum
 * (tauri.conf.json) was 960 and honoured it; the builder for every SUBSEQUENT
 * window — a second project, a popped-out context view — was written
 * separately at 800, and a window opened there had the workspace pane hanging
 * 56px past its own right edge with the estimates in it.
 *
 * Two numbers in two languages, describing one layout. This is the assertion
 * that ties them together, so moving a column's floor fails here rather than
 * in a window nobody thought to resize.
 */
describe('window minimums', () => {
  const shellCss = read('./shell.css')

  /** The irreducible width of the grid: the rail plus every column floor. */
  const gridFloor = (() => {
    const start = shellCss.indexOf('grid-template-columns:', shellCss.indexOf('.shellapp {'))
    const columns = shellCss.slice(start, shellCss.indexOf(';', start))
    const rail = /--rb-rail-w:\s*(\d+)px/.exec(read('../theme/redbeam.css'))
    expect(rail, 'rail width is not a plain pixel token any more').not.toBeNull()
    const floors = [...columns.matchAll(/minmax\((\d+)px/g)].map((m) => Number(m[1]))
    expect(floors).toHaveLength(3)
    return Number(rail?.[1]) + floors.reduce((a, b) => a + b, 0)
  })()

  it('is the same in the config and the builder', () => {
    const conf = JSON.parse(read('../../src-tauri/tauri.conf.json')) as {
      app: { windows: Array<{ minWidth?: number }> }
    }
    const configured = conf.app.windows[0]?.minWidth
    const built = /min_inner_size\((\d+)(?:\.\d+)?,/.exec(read('../../src-tauri/src/window.rs'))
    expect(built, 'window.rs no longer sets a minimum inner size').not.toBeNull()
    expect(Number(built?.[1])).toBe(configured)
  })

  it('leave room for every column the grid cannot compress', () => {
    const conf = JSON.parse(read('../../src-tauri/tauri.conf.json')) as {
      app: { windows: Array<{ minWidth?: number }> }
    }
    expect(gridFloor).toBeGreaterThan(0)
    expect(conf.app.windows[0]?.minWidth ?? 0).toBeGreaterThanOrEqual(gridFloor)
  })
})

/**
 * Every request to "open" something goes through ONE helper.
 *
 * When these were dialogs, two of them open at once meant a precedence chain
 * chose one and the other silently never drew — asking for the bill with
 * settings up, or with the scope editor up, did nothing and said nothing,
 * which is the exact shape of "this app is a non-functional mockup". They are
 * panes and levels now and cannot stack, but the requests still arrive from
 * three places — the palette, the dock, the bridge's `open_panel` — and one
 * router is what keeps them saying the same thing. It also has to LEAVE
 * settings, the one full-screen place a pane can be hidden behind.
 */
describe('opening a surface', () => {
  const openers = { openParts: 'bom', openBrowser: 'browser', openScopeEditor: 'scope' } as const

  it('leaves settings and goes to the surface', () => {
    const declaration = workspace.indexOf('const only = useCallback(')
    expect(declaration, 'the `only` helper is gone').toBeGreaterThan(-1)
    const body = workspace.slice(declaration, workspace.indexOf('}, [])', declaration))
    expect(body).toContain('setSettingsOpen(false)')
    // The bill: the estimates panel, shown. The browser: the Files pane, with
    // the cursor in its filter. A scope: the round's own naming row.
    expect(body).toContain("setWorkOpen(true); setScopePage('parts')")
    expect(body).toContain("setRailPanel('files'); setFilesFocus(")
    expect(body).toContain('setAddScopeRequest(')
  })

  for (const [opener, kind] of Object.entries(openers)) {
    it(`${opener} goes through it`, () => {
      expect(workspace).toContain(`const ${opener} = useCallback(() => { only('${kind}') }`)
    })
  }

  it('opens the parts page nowhere else', () => {
    // One `setScopePage('parts')` — inside `only`; the dock and the palette route through it.
    expect(workspace.split("setScopePage('parts')").length - 1).toBe(1)
  })

  /**
   * The calibration form holds a measurement and outranks everything, so a
   * command opened over it would be swallowed the same way. Refusing to open
   * the palette at all is the honest version of that.
   */
  it('is not reachable from a palette that will not open over a calibration', () => {
    for (const opener of ['openPalette', 'openSearch']) {
      const at = workspace.indexOf(`const ${opener} = useCallback(`)
      expect(at, `${opener} is gone`).toBeGreaterThan(-1)
      expect(workspace.slice(at, at + 200)).toContain('pendingCalRef.current !== null')
    }
  })
})

/**
 * Nothing suppresses a zoom gesture before the page sees it.
 *
 * The webview has its own zoom, on the same gestures and keys, and it scales
 * the whole interface rather than the drawing. That was suppressed at the
 * platform level — `--disable-pinch` in the browser arguments, and
 * `zoomHotkeysEnabled: false` on the window — and that is why the trackpad
 * pinch did nothing at all: both work by taking the gesture away BEFORE the
 * page sees it, so the ctrl+wheel a pinch is delivered as never arrived. With
 * "scroll wheel zooms" turned off it looked completely dead, because the plain
 * wheel that did arrive panned instead.
 *
 * The page claims these inputs itself. These assertions exist because both
 * settings read like sensible hardening, and putting either back would break
 * pinch again with no error and no failing behaviour anywhere else.
 */
describe('zoom input', () => {
  const conf = read('../../src-tauri/tauri.conf.json')
  // Comments stripped: window.rs explains at length why neither of these is
  // set, and an assertion about the code must not be satisfied by prose.
  const rust = read('../../src-tauri/src/window.rs')
    .split(String.fromCharCode(10))
    .filter((line) => !line.trim().startsWith('//'))
    .join(String.fromCharCode(10))

  it('is not disabled in the browser arguments', () => {
    expect(conf).not.toContain('--disable-pinch')
    expect(rust).not.toContain('--disable-pinch')
  })

  /**
   * `zoomHotkeysEnabled` is not about hotkeys.
   *
   * On Windows, wry passes it straight to
   * `ICoreWebView2Settings5::SetIsPinchZoomEnabled`, and wry's default is
   * FALSE — so a Tauri window that says nothing about zoom is a window where
   * WebView2 does not recognise the pinch gesture AT ALL. It does not scale
   * the page; it never generates the gesture, so the ctrl+wheel Chromium
   * synthesizes for a precision-touchpad pinch is never produced and the page
   * gets plain scroll wheels it cannot tell from a two-finger swipe.
   *
   * Measured rather than reasoned: the same page in a browser tab, same
   * machine and same trackpad, produced 633 wheel events with ctrl=1; in the
   * webview, 146 events and not one of them. Leaving this out is the same as
   * setting it false, which is why deleting an explicit `false` fixed nothing.
   */
  it('turns the webview pinch gesture ON, which is what this setting is', () => {
    expect(conf).toContain('"zoomHotkeysEnabled": true')
    expect(rust).toContain('.zoom_hotkeys_enabled(true)')
  })

  it('is claimed by the page instead', () => {
    // preventDefault on a ctrl+wheel is what actually stops the webview
    // scaling, and it has to be claimed for the whole document — over a pane
    // there is no stage handler to do it.
    expect(workspace).toContain('const onWheel = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault() }')
    expect(workspace).toContain("document.addEventListener('wheel', onWheel, { passive: false, capture: true })")
  })

  it('maps the zoom keys onto the drawing', () => {
    for (const key of ["case '=':", "case '+':", "case '-':", "case '_':"]) {
      expect(workspace, `${key} is not handled`).toContain(key)
    }
  })
})

/**
 * Opening a project loads the whole DOCUMENT, not just the visible page.
 *
 * `syncMarkups` is the only thing that fills `docMarkups` and
 * `docCalibrations`, and it was reachable only from an EDIT — runCommand,
 * undo, redo, and the cross-window listener. The page-open effect loaded the
 * page's markups itself and nothing else, so on a freshly opened project the
 * piece calculation was handed zero markups and zero calibrations. It produced
 * no quantities and, correctly, no blocker either: zero markups is a
 * legitimate reason to have no pieces.
 *
 * The symptom was that a scope's counts appeared the moment you drew anything
 * and vanished again on relaunch — which reads as the calculation being
 * broken, and sent me looking at the layout engine twice.
 */
describe('opening a project', () => {
  it('loads the document through the same function every edit uses', () => {
    const at = workspace.indexOf('// Load page-dependent state once BOTH the db and the page box are ready.')
    expect(at, 'the page-open effect has moved').toBeGreaterThan(-1)
    const effect = workspace.slice(at, workspace.indexOf('setPageReadyKey(pageId)', at))
    expect(effect, 'the page-open effect does not load the document').toContain('await syncMarkups()')
  })

  it('does not load the page markups separately from the document ones', () => {
    // Two loaders is how these fell out of step in the first place.
    expect(workspace.split('setMarkups(rows.map(').length - 1).toBe(0)
  })

  it('declares syncMarkups before the effect that calls it', () => {
    // A dependency array is evaluated during render, so a `const` declared
    // below its own consumer is a temporal dead zone and a white window.
    expect(workspace.indexOf('const syncMarkups = useCallback('))
      .toBeLessThan(workspace.indexOf('// Load page-dependent state once BOTH'))
  })
})

/**
 * The layout preview is global, in both halves of the word.
 *
 * It was a `useState`, so it reset every relaunch and was per window. Then,
 * once it became a preference, the PAINTER still looked up the active scope
 * and drew that one alone — so a global switch still showed one scope at a
 * time, and turning it on read as a per-scope action.
 *
 * Which scope you are drawing INTO has nothing to do with which layouts you
 * want to see: an estimator checks a ceiling against the one next to it, and
 * two scopes overlapping where they should not is something you can only
 * notice with both on screen.
 */
describe('the layout preview', () => {
  it('is a stored preference, not window state', () => {
    expect(workspace).not.toMatch(/useState\(false\)[^\n]*\/\/ layoutOn/)
    expect(workspace).toContain("const layoutOn = prefs['takeoff.layoutPreview'] === true")
    expect(workspace).toContain("settings.set('takeoff.layoutPreview', on)")
  })

  it('draws every scope, not only the active one', () => {
    const at = workspace.indexOf('if (layoutOn) {')
    expect(at, 'the layout block has moved').toBeGreaterThan(-1)
    const block = workspace.slice(at, workspace.indexOf('drawRunLayout(', at) + 200)
    expect(block).toContain('for (const entry of piecesRef.current)')
    // The old bug in one line: no picking a single scope out of the list.
    expect(block).not.toContain('activeScopeRef.current')
  })

  it('draws each scope in its own colour', () => {
    const at = workspace.indexOf('for (const entry of piecesRef.current)')
    expect(workspace.slice(at, at + 400)).toContain('color: entry.scope.color')
  })
})

/**
 * "Total quantity" totals the PROJECT, and both of its numbers total the same
 * thing.
 *
 * Two bugs, one shape, found a level apart. First the roll-up read the current
 * PAGE while the piece calculation beside it read the whole DOCUMENT, so a
 * sheet carrying none of a scope's takeoff showed "Area 0 SF" next to "231
 * panels". Then both read the open DOCUMENT while scopes plainly span files —
 * C-MT-01 has four markups in one drawing set and three in another — so the
 * total was a fragment that changed when you switched tabs and said nothing
 * about having done so.
 *
 * Page-scoping was not arbitrary: `calculateScopeQuantities` takes ONE
 * calibration, and measuring an off-screen markup against the open sheet's box
 * is how a quantity comes out confidently wrong. So the answer at every level
 * is the same — measure each page at its OWN scale and add the rows up, and
 * skip a page whose scale or box is unknown rather than borrowing one.
 */
describe('the scope roll-up', () => {
  const effect = (() => {
    const at = workspace.indexOf('// Recompute quantities whenever markups or calibration change.')
    expect(at, 'the quantities effect has moved').toBeGreaterThan(-1)
    return workspace.slice(at, workspace.indexOf('setPieces(', at))
  })()

  it('totals the project, not the open document', () => {
    // The roll-up buckets by page AND scale region now, so the check is that
    // the PROJECT's markups are what get bucketed. Neither narrower scope may
    // be what it totals: a scope follows a ceiling across sheets and files.
    expect(effect).toMatch(/bucketByScale\(\s*projectMarkups,/)
    expect(effect).not.toMatch(/calculateScopeQuantities\(s, markups,/)
    expect(effect).not.toContain('for (const m of docMarkups)')
  })

  it('measures each markup at its REGION scale, not just its page scale', () => {
    // A details sheet carries four details at four scales. Bucketing by page
    // alone measures all four at whichever number the page holds, so three
    // are wrong and every one of them looks plausible.
    expect(effect).toMatch(/bucketByScale\(\s*projectMarkups,\s*projectRegions,/)
  })

  it('measures each page at that page own scale', () => {
    expect(effect).toContain('projectCalibrations.get(pageId)')
    expect(effect).toContain('projectPageBoxes.get(pageId)')
  })

  it('skips anything it has no calibration or box for', () => {
    // Unmeasured beats measured at another sheet's — or another detail's —
    // scale. A bucket that resolved to no scale contributes nothing rather
    // than borrowing the nearest number.
    expect(effect).toContain('if (size === undefined || bucket.feetPerPoint === null) continue')
  })

  it('gives the piece calculation the project too', () => {
    const pieces = workspace.slice(workspace.indexOf('setPieces('), workspace.indexOf('setPieces(') + 900)
    expect(pieces).toContain('calculatePieces(s, projectMarkups, cal,')
  })
})

/**
 * An agent applies its work directly. There is no approval step.
 *
 * The schema has carried `review_state` since the first migration and the
 * store has a review module, but the product's decision is that an agent
 * working on your behalf works freely — being asked to approve every action is
 * not assistance, it is dictation with extra steps. So the bridge writes
 * `accepted`, the same state a drawn markup gets, and an agent's markup is in
 * the totals the moment it exists.
 *
 * This is a guard against reintroducing a gate by accident. If a review step
 * is ever wanted it should be a deliberate change with this test rewritten,
 * not a default that quietly appears.
 */
describe('agent writes', () => {
  it('apply directly, with no approval step', () => {
    const at = workspace.indexOf("origin: 'agent'")
    expect(at, 'the bridge no longer creates markups').toBeGreaterThan(-1)
    expect(workspace.slice(at, at + 80)).toContain("reviewState: 'accepted'")
  })

  it('leaves no proposal UI in the workspace', () => {
    // Nothing may render a card, load a proposal, or draw one on the sheet.
    expect(workspace).not.toContain('listProposals')
    expect(workspace).not.toContain('drawProposed')
    expect(workspace).not.toContain('onDecide')
  })
})
