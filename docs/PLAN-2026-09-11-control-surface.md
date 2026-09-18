# The command prompt as the control surface, and the 2026-09-11 test notes

Source: Notion "QA Testing Session: UI Bugs, UX Feedback & Feature Requests",
2026-09-11 (https://app.notion.com/p/3d80f1be889080a2af69d8de162a0225), plus
Aaron's brief: the MCP is the control surface for agents; the command prompt
is the control surface for humans. Every workflow must be completable from
the prompt, except the act of drawing a markup on the sheet.

Read with `docs/BUG-REVIEW-2026-09-10.md`, whose branch this continues.

## 1. The principle, stated as rules the code has to meet

1. **Every action has a command.** If a button, menu item, row action, tab or
   dialog can do it, `>` can do it. The registry of commands is the list of
   what the app can do; the toolbar, menus and sidebar are views onto it.
2. **Every argument is collected in the prompt.** Nothing a command needs
   opens a dialog. It is a step (choose from rows, or type into the field),
   chained with Next, exactly as `commands.ts` already models. A command that
   would "open the panel so you can finish there" is a defect.
3. **Every state is reachable, never assumed.** A command never depends on
   what the sidebar happens to show. "Configure scope" lists the scopes,
   with the open one first and marked, and never skips the choice.
4. **Nothing is silent.** Refusals stay in the prompt with the reason and the
   nearest thing that works; a toggle flips and stays; a destructive step
   says so before Enter. (All three exist; they become the contract.)
5. **The prompt is where the keyboard lives.** Ctrl+K opens it from anywhere,
   including from inside a sidebar field and while a scope editor is open.
   Only a pending sheet gesture (a calibration line waiting for its length)
   may refuse, and it says why.
6. **Parity is tested.** A test walks every UI affordance's handler and every
   MCP verb and asserts a palette command reaches the same function. The
   register in `reachability.test.ts` gets a sibling: `parity.test.ts`.

## 2. The workflows, each traced through the prompt

`>` commands, `@` scopes, `/` documents, `#` pages, `~` projects; `?` lists
them. ✔ exists today, ◐ exists but breaks a rule, ✘ missing.

### Projects (`~`)
| Step | Prompt | State |
|---|---|---|
| Open a recent project | `~name` Enter (second window) | ✔ |
| Open a folder / a drawing | `> Open project…` → picker | ✔ |
| Create a project | `> New project…` → text: path → create | ✘ |
| Rename | `~name` → step Rename → text | ✘ (exists on the start screen only) |
| Hide from the list | `~name` → Hide | ✘ |
| Set data aside | `~name` → Remove Redbeam data (warn) | ✘ |
| Reveal the folder | `~name` → Show in Explorer | ✘ |
| Recent list length / expiry | `> Settings: Recent projects kept` (int) and `…expire after` (enum) | ✘ |
| More projects | `> Manage projects…` opens the full list as a palette group with the actions above | ✘ |

The title-bar project menu shows the same rows with the same actions
(rename, hide, remove data, reveal), and a "More…" that opens the palette
at `~`.

### Documents and sheets (`/`, `#`)
Open a document, a page, next/previous sheet, close a tab, pop into a
context window, refresh files: ✔. Missing: `> Close other tabs`, `> Reopen
closed tab`, `/name` → step "Open in context window" (Shift+Enter exists;
make it a visible step too).

### Rounds (estimates)
New, rename, duplicate, delete, open: ✔. Missing: `> Open round…` listing
rounds when none is open (today the estimate group only lists them by name).

### Scopes (`@`)
| Step | Prompt | State |
|---|---|---|
| Add, then product, then measures | `> Add scope` → name → product → measures | ✔ chained |
| Configure (every measure, yield, seams, colour, name) | `> Configure scope` → **always** choose scope → choose field → text | ◐ skips the scope choice when one is open; colour is missing |
| Set product | ✔ | ◐ same skip |
| Rename, duplicate, remove, restore | ✔ | ◐ same skip |
| Take off | `@name` → Take off | ✔ |
| Set direction | `> Set direction on the sheet` | ✔ but a gesture (allowed) |
| Set direction from an edge | `@name` → Direction from edge → choose markup → choose edge | ✘ (context menu only) |
| Commit / freeze | ✔ | |
| Move selected markups to a scope | `> Move markups to…` | ✔ |
| Delete selected markups | ✔ | |
| List a scope's markups and jump to one | `@name` → Markups → rows → Enter goes to the sheet and selects it | ✘ |
| Reassign / delete one markup by row | from the row above → step | ✘ |

The fix for "cannot edit a scope from the prompt when a scope is open" is
rule 3: `shown === undefined ? pickScope(...) : configureCommand(shown.id)`
becomes `pickScope(...)` always, with the open scope first and labelled
"open in the sidebar". Whether Ctrl+K itself is being swallowed while a
sidebar field has focus is checked first (`isTextEntry` at
`Workspace.tsx:2344`; Ctrl+K must survive text entry).

### Scale
Presets per sheet, range, all; draw a region; remove a region: ✔.
Calibrate by line is a gesture, allowed. Missing: `> Set scale` → step
"which sheets" is fine, but `> Scale of this sheet` should show the current
value as a row that flips to the chooser.

### Takeoff tools
Choosing the tool: ✔. Drawing is the exception by definition. Missing:
`> Convert PDF markups…` → choose scope → choose which (all on sheet /
selected); `> Trace region here` is a gesture and stays on the context menu.

### Layout and view
Layout preview, overflow, rails, trim, seams, per-area origin, fit sheet,
fit width, zoom in/out/100%: ✔ as toggles. These leave the toolbar (§4)
and live here and in Settings.

### Search
`> Search the project` opens the pane: ◐ (a pane, but the query is typed
there, which is acceptable; the palette already hands an unmatched query
to it). Missing: `> Search this sheet / document / folder` as four entry
commands setting the reach.

### Export
Estimate export, save report, copy bill, save marked PDF: ✔.

### Settings
Every bool and enum flips in place: ✔. Missing: ints (line weight, recents
kept) as a text step with validation; `> Settings` → choose setting →
opens the panel **scrolled to and flashing that card** (the panel gets an
`initialSettingId` prop; cards already carry `id={d.id}`).

### Windows, undo, help
Context window, undo, redo, `?`: ✔. Missing: `> Toggle left pane`, `> Toggle
estimates pane`, `> Sidebar widths` (equal / reset).

## 3. Bugs from the test notes, with causes

| Note | Cause | Fix |
|---|---|---|
| Snap target persists after right-click / Escape | `snapRef` is cleared only on pointer-up of an edit (`Workspace.tsx:3185`); `cancelDraft` and the tool-change effect leave it, and every paint draws it | clear `snapRef` (and `hoverRef`) in `cancelDraft` and on tool change |
| Direction "not set" though set for the whole page | the Setup row reads only `scopeDefaultDirectionFrom`; a direction set on the sheet lives under `PAGE_DIRECTIONS_KEY` / `AREA_DIRECTIONS_KEY` | the row reads all three: "set for this sheet", "set on 3 sheets", "set for 2 areas", else the scope default, else not set |
| Calibration: leader follows the cursor after the second point | the generic move branch keeps updating `draft.cursor` while `pendingCal` is set, and `drawDraft` rubber-bands to it | no cursor update and no rubber band while a gesture is pending |
| Right-click during the calibration prompt cannot redraw | `onContextMenu` calls `cancelDraft` but not `cancelCalibration`, so the form stays and `openPalette`/pointer-down refuse | right-click and Escape with a pending calibration cancel it |
| Measures show 7.239583 | Phase 2 stores `formatMeasureValue(parsed.value)` in decimal feet when a unit is typed | store what was typed; display every length through `formatLength(value, unit, precision)` → `7' 2⅞"` for ft/in, `2.44 m` for metric; the unit dropdown goes; a Settings enum sets imperial precision (1/8, 1/16) |
| "Measured as" is not useful | it is derivable from the product | remove it; the product list becomes Panels, Planks, Baffle cassette, Baffle, Linear parts, **Counted items** (each), Custom assembly (area); `scopeType` is set from the product |
| Setup tab wastes half the sidebar | Parts, Setup and Markups are exclusive pages | one scrolling scope page: hero → Parts → Setup → Markups, each a collapsible section with its count; the selector bar becomes jump links |
| Static blue accent | `accent.rs` reads `Explorer\Accent\AccentPalette`; `from_system` is false when the read fails and Windows' default blue stays. Either the read fails on this machine or the chosen accent IS the default | log the outcome; show "Accent: from Windows / default" in Settings › About; if the palette key is absent read `DWM\AccentColor` and derive Light1/Light2 |
| Half-panel "tape" labels | `drawLayout` `DEFAULTS.labels = true` prints the stock kind on every part panel | off; the kind is legible from the hatch and the Parts page |
| Baffle dashed centre line | the overflow pass strokes `fullSegment` dashed; the band pass draws `insideSegment` only | one band per piece at face width along `fullSegment`: full opacity inside the region, 50% past it, no dashes; a plank the same; the panel outline goes to 0.5 alpha 0.6px; cutout edge solid, 2px |
| Cutout button far from Area | dock order | Area, Cutout, Linear, Count, Highlight |
| Resize by hovering a rectangle's side | edge hit exists only on press | hover sets `ew-resize` / `ns-resize` on a rectangle's edge, `nwse-resize` on a corner; press-drag resizes (Phase 2 already does the drag) |
| Ctrl+click multi-select; multi-select highlights | `next = e.shiftKey ? …` only | Ctrl and Shift both extend; `shape` is hit-testable already, so highlights select once the modifier works |
| PDF markups: cannot pick the scope; cannot multi-select them | the drawing menu converts into the active scope; annotations are not selectable | annotations become selectable objects in Select (hit-test on their rects/vertices, drawn with a dashed selection), Ctrl+click adds, right-click → "Convert N to…" → choose scope; the palette gets the same step |
| Kenneth's file: scope says 2 markups, list shows none | **Confirmed in the MSK Podium database** (`…\MSK Podium 1233 York Ave NYC
edbeam.db`): scope CL04's live markups sit on two documents (an area and a cutout on `doc-8cd2c53e…`, an area on `doc-e2662fed…`); the count is project-wide (`markupCounts`) while the scope's Markups page is built from `docMarkups`, the OPEN document only. With a third document open the list is empty | Markups page lists every markup of the scope, grouped by document then sheet; a row from another document opens it |
| Project CRUD absent in prompt and dropdown | Phase 4 put rename/remove on the start screen only | §2 Projects |
| Settings from the prompt land on General | `openSettings` takes no target | `initialSettingId`: page, scroll, flash |
| Zoom at the page edge zooms about the viewport edge | `clampAxis` refuses any blank margin, so the anchor is overridden at the edge | allow overscroll: the page may sit anywhere as long as ≥ 25% of the viewport shows page; fit/clamp only on fit commands |
| Sidebars fixed and unequal | `--pane-w` 300 / `--work-w` 380, no handle | drag handles on both, persisted; equal 340 default; double-click resets |
| Names in settings | Kenneth in a description; Aaron in comments only | strip from every user-visible string; a test greps the registry labels/descriptions for names |
| Toolbar | one dock with pills for read tools, scope tools, layout, specs, quantities, More | four floating groups (§4); layout/specs/quantities go to the prompt and sidebar |
| Animations | none | Fluent motion: 150ms fast-invoke for menus/flyouts/palette, 250ms for panes, `cubic-bezier(0,0,0,1)` decelerate; hover 100ms; respect `prefers-reduced-motion` |
| Recent projects: expiry / max / More | fixed at 200 in Rust | two settings, read on the start screen and the menu; "More…" opens the palette at `~` |

## 4. UI redesigns (mockups in the artifact)

**Toolbar.** Four floating groups over the sheet, bottom-centre, 8px apart:
1. Pan · Select · Dimension  2. Area · Cutout · Linear · Count · Highlight ·
Direction  3. ◀ sheet ▶ · zoom −/%/+ · fit  4. Scale pill. Nothing else. The
scope being drawn into shows as a chip on group 2's left edge. Layout
preview, Specs, Quantities, BOM, More: gone (prompt, sidebar).

**Scope page.** Header (dot, name, product, Take off) → hero quantity → status
→ **Parts** (lines) → **Setup** (product; measures in feet-and-inches, two
per row, no unit dropdown; yield/seams; direction; colour; name) →
**Markups** (by document › sheet). One column, sections fold, counts on the
headings, sticky jump bar. Padding on the 8-grid throughout the estimates
pane; every row the same height; one label voice.

**Prompt.** No visual change; the chip/step model stays. Two additions: a
"hub" row for a scope/project/document (Enter lists everything you can do
to it) and a right-hand hint showing Shift+Enter/Ctrl+Enter meanings.

**Icon.** A photoreal orange on dark glass, neumorphic, squircle, transparent
corners; both the app icon (`tauri icon` from a 1024 PNG) and the title-bar
mark. Candidates in the artifact.

## 5. Order of work

0. **Fixes with a cause** (one sitting): snap persistence, calibration
   leader and cancel, direction row, half labels, cutout button position,
   Ctrl+click, names in strings, Markups page across documents.
1. **Lengths**: `formatLength`, precision setting, dropdown removed, product
   list absorbs "Measured as" (Counted items product), Kenneth's decimal
   fields show feet-and-inches.
2. **Prompt parity**: rule 3 across scope commands; projects hub and CRUD;
   settings target and int steps; markups listing; convert-with-scope;
   panes/widths; `parity.test.ts`; Ctrl+K survives text entry.
3. **Toolbar and sidebar**: the four groups; the one-column scope page;
   resizable equal sidebars; spacing pass over the estimates pane; accent
   diagnostics; motion tokens.
4. **Layout drawing**: bands at face width with 50% overflow, no dashes,
   fainter panels, bolder cutouts; hover-resize cursors; overscroll zoom.
5. **PDF markups as objects**: selectable, multi-select, convert to a chosen
   scope, from the menu and the prompt.
6. **Icon**: pick a candidate, produce the icon set, replace the mark.
7. **Recent projects**: settings and More.

Each phase ends with `npm run verify` and, for 2 and 5, a run in the
packaged app on the MSK Podium project once its folder is known.

## 6. Status, 2026-09-13

All seven phases are on branch `bug-review-2026-09-10`, one commit each
(phases 4 and 5 share one), verified in the browser build with synthetic
input before each commit and with `npm run verify` and `cargo test --lib`
at the end.

| Phase | State | Notes |
| --- | --- | --- |
| 0 fixes | done | markup list across documents, lengths, product/measured-as |
| 1 lengths | done | feet-and-inches everywhere, no unit dropdown |
| 2 prompt parity | done | hubs for scope/round/project/document; every scope command asks which scope; `parity.test.ts` guards it |
| 3 toolbar, sidebar | done | four groups; one-column scope page; equal resizable sidebars (340px, remembered); 8-grid pass; accent diagnostic + DWM fallback; motion tokens |
| 4 layout drawing | done | bands along the full segment, 50% past the edge, no dashes; fainter panels; solid 2px cutouts; resize cursors; overscroll zoom |
| 5 PDF markups | done | selectable in Select; Ctrl+click and box; convert N selected to a chosen scope from the menu or the prompt. Verified with synthetic annotations; a Bluebeam file in the packaged app is the remaining check |
| 6 icon | done, provisional | no image model was reachable; the icon is drawn (PIL script in the session scratchpad) as an orange on dark glass, run through `tauri icon`, and used as the title-bar mark. Replace the 1024 PNG and re-run `tauri icon` when a photoreal render is available |
| 7 recents | done | Settings › General › Recent projects: kept (5–200) and drop-off (never/30/90/365 days), read by the start screen and the project menu; the menu's "More…" opens the prompt at `~` |

Left for the packaged app: the MSK Podium file (Kenneth's Bluebeam markups)
through phase 5, and the Windows accent row in About on a machine with a
palette.
