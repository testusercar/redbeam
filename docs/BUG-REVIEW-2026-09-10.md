# Bug review with Kenneth — 2026-09-10

Source: Notion meeting note "Redbeam Takeoff Tool Bug Review Session", 2026-09-10
(https://app.notion.com/p/3d70f1be889080f68d54fa43b86f4a8a). Twenty-four items.
Each one below is mapped to where it lives in the code and what the fix is.
"Cause" is from reading the source at 0.2.1 (`3d0bdc1`), not from a repro,
except where marked **verified in code** (the mechanism is unambiguous) or
**needs repro** (two or more candidate causes).

## Status, 2026-09-11

All five phases are implemented on branch `bug-review-2026-09-10`, one commit
per phase. `npm run verify` (purity, typecheck, 101 vitest files, the MCP
suite, the fixture oracle in strict mode) and `cargo test` (113) are green.
The golden fixtures are unchanged.

What was verified in the browser build with synthetic events, and what
still wants a run in the packaged desktop app on a real project:

| # | Done | Verified | Still to check in the real app |
|---|------|----------|--------------------------------|
| 1 | start screen by default; `general.restoreProjectWindows` setting | browser: launch lands on the start screen | — |
| 2, 3 | cutouts clipped to their areas (`domain/clip.ts`, polygon-clipping) | 24 unit tests, fixtures unchanged | a real sheet with a straddling cutout |
| 4 | edge auto-pan during any live gesture | browser: left and bottom edges, with rAF polyfilled (the hidden pane never fires rAF) | feel of the speed curve |
| 5 | calibrate returns to Pan after Apply | code | Kenneth's third-point report against the packaged build |
| 6 | Select tool (V), Pan is H, Shift+drag in Pan kept | browser: marquee selects | — |
| 7 | Setup's "Set on the sheet" makes its scope active first | code | the repro: Setup open on B, dock on A |
| 8 | Refresh files: Files footer, palette, F5 | browser: button present | a drawing dropped into a real folder mid-session |
| 9 | square title cell | CSS | — |
| 10 | PDF annotations listed per page (`viewer/annots.ts`), right-click converts one, all on the sheet, or traces the region | browser: menu opens, tracer runs and reports; the sample carries no annotations | a Bluebeam-marked PDF: polygon → area, polyline → length, others → highlight |
| 11 | Fit sheet fits immediately | browser: 1.06 → 0.20 | — |
| 12 | labelled Add scope in header and under the list | code | — |
| 13 | rectangle grips: edge drag, Shift on a corner | browser: both | — |
| 14 | `parseLengthInput` in measure fields and calibration | 18 unit tests | — |
| 15 | line weight 50–300% and follow-zoom settings; overflow heavier and dashed | registry tests | look of the weights on a real RCP |
| 16 | rename a recent project; set its data aside (`.redbeam/removed-<stamp>/`) | Rust tests | the desktop start screen (browser mode cannot set data aside) |
| 17 | Linear parts product: per-run ceil(length / part), measured, ordered, offcut | 4 unit tests | Kenneth's trough |
| 18 | Profile W on baffles and cassettes; pieces drawn as bands at width | code | look on a real RCP |
| 19 | scope follows a clicked markup | code only: the browser build's estimate holds no scopes to switch between | click a scope-A markup while on scope B |
| 20 | search hit across documents waits for the viewer | code | — |
| 21 | hits painted on the sheet; Highlight one / Highlight all | browser: one match, marked as a shape | — |
| 22 | search reach: sheet, document, folder, project; open document first | browser: four reaches, placeholder follows | folder reach on a nested set |
| 23 | "Measured as" with a sentence per option | browser: settings text | — |
| 24 | snap prefers line ends over ink; ink at 6px; Alt suppresses; setting | unit tests | feel against a hatched sheet |

Open questions from the plan, as they were resolved: #1 is a setting, off
by default; #16 was read as the start-screen list; #17 is part length only;
#10 handles real annotations, and offers the tracer for flattened ones.

---

The plan as it was written on 2026-09-10 follows.

## Severity, in one table

| # | Item | Kind | Size | Phase |
|---|------|------|------|-------|
| 2 | Cutout beyond an area ADDS material | correctness | L | 1 |
| 3 | Cutout row reads −0.0 SF | correctness | S | 1 |
| 20 | Search hit → "page N out of range" toast | bug | S | 0 |
| 11 | Fit sheet only works after Fit width | bug | S | 0 |
| 1 | Launch jumps to last project | behaviour | S | 0 |
| 5 | Calibrate seems to ask for a third point | bug | S | 2 |
| 7 | Direction set on sheet, Setup says "not set" | bug | S | 3 |
| 19 | Click a foreign markup → switch scope everywhere | interaction | S | 2 |
| 6 | Marquee select | interaction | S | 2 |
| 4 | Auto-pan while drawing past the viewport | interaction | M | 2 |
| 13 | Shift + grip keeps a rectangle a rectangle | interaction | M | 2 |
| 24 | Snap grabs every line | interaction | M | 2 |
| 14 | Type 5'6" / 66" / 8ft anywhere | input | S | 2 |
| 17 | Linear parts product type | feature | L | 3 |
| 18 | Baffle / profile / plank width drawn at true width | feature | M | 3 |
| 15 | Heavier baffle + overflow lines; zoom-scaled weights | feature | M | 3 |
| 23 | "Counts" dropdown is unclear | UI | S | 0 |
| 12 | Add-scope button too small | UI | S | 0 |
| 9 | App mark container not square | UI | S | 0 |
| 8 | Refresh the file tree in-session | feature | M | 4 |
| 16 | Project create / rename / remove | feature | M | 4 |
| 21 | Highlight search hits on the sheet | feature | M | 4 |
| 22 | Search scope: sheet / document / folder / project | feature | S | 4 |
| 10 | Convert foreign PDF markups into Redbeam markups | feature | XL | 5 |

Phase 0 is one sitting. Phase 1 is the one that changes numbers and goes
first after it. Phases 2–4 are independent of each other and can be split
between sessions. Phase 5 is a project of its own.

## Phase 0 — one sitting, no design questions

**#11 Fit sheet.** `Workspace.tsx:395` initialises `fitMode` to `'page'` and a
manual zoom never clears it. Ctrl+0 calls `setFitMode('page')`; the state does
not change, so the effect at `:4517` does not re-run. Fit width works because
it changes the value. Fix: the two commands call `fitPage()` / `fitWidth()`
directly and then set the mode; any wheel, pinch, or `setZoom` clears
`fitMode` to `null`. **Verified in code.**

**#20 Search toast.** `goToHit` (`Workspace.tsx:1337`) calls
`setActiveDocId(hit.documentId)` and `goToPage(hit.pageNumber)` in the same
tick. The viewer still holds the old document, so a one-page sheet reports
"page 3 out of range (0..0)" from `viewer.ts:237`. Fix: when the document
differs, stash the page in a `pendingPageRef` and consume it in the new
viewer's `onReady` (the remembered-sheet restore at `:899` already does this
dance; reuse it). **Verified in code.**

**#1 Launch.** `App.tsx:99-114` reopens the most recent live project on
purpose (comment: "not a toll gate on every start"). Kenneth wants the start
screen. Do: default to the start screen; keep the behaviour behind a setting
`startup.reopenLastProject`, default off, so the "back to the job I was on"
case is one click on the first recent row. Assumption: Aaron agrees with
Kenneth here; if not, flip the default.

**#23 Counts dropdown.** `RightWorkspace.tsx:1127` labels the `scopeType`
select "Counts" with options "areas / lengths / counts" — the word is doing
two jobs. Rename the label to "Measured as", give each option a one-line
help string (areas → SF from drawn areas; lengths → LF from polylines;
counts → each from placed points), and default it from the product type when
the product changes (a run product is areas; #17's linear product is
lengths).

**#12 Add scope.** `RightWorkspace.tsx:656` is an icon-only `paneact` Plus in
the pane header. Make it a labelled "Add scope" button, repeat it at the foot
of the scope list, and bind it in the palette.

**#9 App mark.** `shell.css:2005` gives `.titlecell` the rail's width at the
title bar's 40px height, so the square mark sits in a 48×40 cell. Make the
cell square (width = height = title-bar height) in both the grid and the
pane-closed layouts (`:2038`, `:2045`).

## Phase 1 — cutout correctness (changes quantities; fixture-gated)

**#2 Cutout adds material / out-of-bounds cutout treated as area.**
`effectiveAreaRings` (`scope.ts:91`) admits a cutout if its FIRST vertex lies
in an area, then concatenates the rings and lets `regionArea`'s even/odd rule
sort holes from material. Two failures follow directly:

- A cutout that starts inside and extends past the area edge: the part
  outside sits at nesting depth 1 under the cutout ring alone, and even/odd
  counts it as **positive** area. That is "adding product".
- A cutout that starts outside and overlaps the area: dropped entirely
  ("subtracts nothing"), and the layout engine (`takeoff.ts:388 ownerAreaId`,
  same first-vertex probe) never gives it an owner, so the panel/run clipper
  never sees the opening either.

The Qt build could not hit this because `QPainterPath::subtracted` clipped
for free. Fix: clip each cutout to the union of the area rings it overlaps
before it becomes a hole. That needs a general polygon boolean (areas are
often concave, so Sutherland–Hodgman is not enough). Two options:

1. Port a Martinez–Rueda clipper into `packages/domain/src/clip.ts`
   (dependency-free, keeps `check:domain-purity` trivially clean).
2. Add `polygon-clipping` (MIT, Martinez) as a domain dependency.

Recommendation: option 2 to land the fix quickly, behind one adapter
function (`clipCutoutToAreas`) so it can be swapped later. Ownership becomes
"overlaps" (any vertex inside, or any edge crossing), not "first vertex
inside". Regression fixtures: cutout wholly inside; straddling one edge;
straddling a corner; starting outside; covering the whole area; two areas
sharing a cutout. `tools/verify-fixtures.mjs` must stay green on the
ground-truth set — this is the gate.

**#3 −0.0 SF in the markups list.** `Workspace.tsx:4264` measures a lone
cutout with `areaSquareFeet([m], c)`, which returns 0 because there is no area
ring in the list. Show the cutout's own clipped-to-owner area, negative
(`−12.5 SF`), using the #2 clipper; until #2 lands, its raw ring area is an
honest interim.

## Phase 2 — drawing and selection

**#5 Calibrate third point — needs repro.** The guard at `Workspace.tsx:2671`
refuses a third click and `commitDraft` hands off at two, and the comment at
`:2526` records that race as fixed. Most likely residue: after the
calibration form submits, `draftRef` is reset to `emptyDraft('calibrate')`
and the tool stays armed, so the next click begins a *new* line and reads as
"it wants a third point". Fix: return to Pan after a successful calibration
(the scale pill already shows the result); confirm in the packaged build,
not the harness, before closing.

**#19 Scope follows the clicked markup.** The Pan-tool hit branch
(`Workspace.tsx:2556-2600`) sets the selection and nothing else. When
`m.scopeId !== activeScopeRef.current`: `setActiveScope`, and if the sidebar
has a scope open (`openScopeId !== null`) set that too, so Setup, the dock
pill and the drawing scope all move together. Status line says "switched to
C-MT-01".

**#6 Marquee select.** Already exists as Shift+drag on empty space in Pan
(`:2612`, `markupsInRect` in `hit.ts:188`) — Kenneth could not find it. Add a
Select tool (V) to the dock where a plain drag marquees and a click selects;
keep Shift+drag in Pan; mention it in the tool tooltip.

**#4 Auto-pan while drawing.** No edge-scroll exists. In `onPointerMove`,
while a draft, rectangle, marquee, or vertex drag is live and the pointer is
within ~24px of the stage edge, run a rAF loop that nudges `viewRef` toward
the edge (speed by distance), re-projects the live point, and repaints. Stop
on pointer-up, Escape, or leaving the edge band. Space-drag panning mid-draft
already works and stays.

**#13 Rectangle stays a rectangle.** Vertex drag (`editRef.mode === 'vertex'`)
moves one point. Add: (a) `content.drawnAs = 'rect'` on markups committed from
the drag-rectangle path, and treat any axis-aligned 4-vertex ring the same;
(b) with Shift held on a vertex grip of such a ring, move the two neighbours
so the ring stays a rectangle; (c) an edge grip on such a ring moves the
whole edge. Cursor shows the constraint. Unit-test the ring math in
`hit.ts`.

**#24 Snapping.** `snap.ts` order is vertex → ortho → any ink pixel within
12px (`nearestInk`). Raw ink is why it "snaps to all the lines". Change the
priority to: own/neighbour vertices → line **ends and intersections** from
the page's extracted geometry (`viewer.requestGeometry` already yields
segments) → ortho → ink, with ink at a smaller radius (6px) and shown with
its own indicator colour. Alt held suppresses snap for the click. Expose
"Snap to drawing lines" as a setting beside `takeoff.snapEnabled`.

**#14 Units inline.** `parseNumberOrFraction` (`units.ts:50`) rejects `'`,
`"`, `ft`, `in`. Add `parseLengthInput(text): {value, unit} | null` in
`domain/units.ts` handling `5'6"`, `5' 6 1/2"`, `66"`, `5.5ft`, `8 in`,
`2.4m`, `300mm`, mixed feet-inches to decimal feet. `MeasureRow`,
`CalibrationEntry`, the scale pill and the dimension label override adopt
it; when the text carries a unit the dropdown follows it. Table-driven test.

## Phase 3 — setup and quantities

**#7 Direction shows "not set" — needs repro.** `Workspace.tsx:5865` builds
the Setup row from `estimateScopes.find(id === openScopeId ?? activeScope)`;
the direction commit writes through `scopesRef` to `activeScope`. Candidates:
`openScopeId` differs from `activeScope` (Setup is open on B, Direction was
set for A); or `estimateScopes` is derived from the estimate's scope list and
does not re-derive after `saveScope`. Repro with Setup open, then fix the
source of truth so both the "Direction" row and the pieces blocker read the
same scope the layout used.

**#17 Linear parts product type.** `ScopeType 'linear'` exists and yields
"Length LF" only (`scope.ts:190`); every `ProductType` is a region product.
Add `linear_parts` to `specs.ts` (`PRODUCT_TYPES`, label "Linear parts",
`requiredMeasures` = part length; optional waste %), `scopeType` defaults to
`linear`, and quantities per polyline: `parts = ceil(runLength / partLength)`
(parts do not span runs), summed, plus total LF and overage LF. Wire through
`bom.ts`, `store/calculations`, the Setup measures, the Parts page, and
estimate export. Fixture: 400 LF of trough at 10' parts → 40 across four
100' runs, 44 across eleven 37' runs. This replaces the "panel sized to the
trough width" workaround Kenneth described, which double-counts at an eighth
over.

**#18 True component width.** `runs.ts RunInputs.componentWidthFeet` is
already resolved ("presentation only") but `editableMeasures` exposes no
profile width for baffle / cassette, and `drawLayout.ts:114` strokes pieces
as 0.8–1.4px lines. Add `profileWidth` to the baffle and cassette measure
lists (plank width already exists), and draw run pieces as filled rects of
`componentWidth × zoom` when that exceeds ~2px, falling back to the line.
Quantities unchanged.

**#15 Line weight.** `draw.ts:133`, `overlay.ts`, and `drawLayout.ts` use
fixed screen-pixel widths. Add settings `takeoff.lineWeight` (×0.5–×3) and
`takeoff.scaleLineWeightWithZoom` (Bluebeam's behaviour: width in page units
× zoom). Overflow pieces get a heavier dashed stroke in the scope colour's
warning tint so the excess is readable at fit-sheet zoom.

## Phase 4 — project and search

**#8 Refresh files.** `scanProject` + `ingestDocuments` run once at open
(`useProject.ts:17`). Add a "Refresh files" command (palette, Files pane
footer, F5) that rescans and ingests with `reconcile: true`, then kicks the
indexer for new documents. A Rust `notify` watcher can come later; the
button is what was asked for.

**#16 Project CRUD — assumption stated.** Read as the start-screen list.
Create exists (`ProjectPicker` "Create folder"); forget exists
(`RecentProjectList.tsx:121`). Missing: **rename** (store a display name on
the project row in `redbeam.db` and in recents, shown instead of the folder
name), **remove Redbeam data** (delete `.redbeam/` with a typed-confirm; the
drawings are never touched), and **rename the open project** from the app
menu. If Kenneth meant estimates rather than projects, "New estimate" exists
and rename/delete on it is a smaller change to `RightWorkspace`.

**#22 Search scope.** `searchProjectText` already takes `opts.documentId`.
Add a scope selector to `SearchPanel` — This sheet / This document / This
folder / Whole project — passing `documentId`, a `pageId`, or a
`relativePath` prefix (new `opts.pathPrefix`, one LIKE clause). Group the
current document first regardless of scope.

**#21 Highlight hits on the sheet.** The store returns spans per page and
`viewer/text.ts` returns `TextRun` boxes in normalized space. On go-to-hit,
draw the matching runs as a temporary highlight layer in `overlay.ts`;
"Highlight selected" in the panel commits chosen hits as `shape` markups so
they persist and print.

## Phase 5 — foreign markups

**#10 Convert other software's markups.** Two different problems under one
request:

- **Real annotations** (Bluebeam, Acrobat): the bundled `@embedpdf/pdfium`
  exports `FPDFPage_GetAnnot*` and `FPDFAnnot_Get{Subtype,Rect,Vertices,
  InkList,Color,StringValue}`. Add `annots.ts` to the viewer (worker side),
  list annotations per page with subtype, vertices and `/Subj`/`/Contents`,
  and a right-click "Convert to Redbeam markup" that maps Polygon → area,
  PolyLine/Line → polyline, Square → area, with the scope chosen in a small
  picker. Bluebeam's `/BSIColumnData` custom columns can ride along as
  markup content.
- **Flattened markups** (burned into the content stream): nothing to
  convert. Offer "Trace region here" on the context menu, which is the
  existing geometry extraction (`viewer.requestGeometry`) plus the ring
  tracer, seeded at the click.

Spike the annotation listing on Kenneth's file first; the rest follows what
it returns.

## Open questions for Aaron (none block Phase 0–3)

1. #1: start screen always, or start screen by default with a setting?
   (Plan assumes the setting, default off.)
2. #16: projects on the start screen, or estimates in the sidebar?
3. #17: name and fields for the linear product — "Linear parts" with part
   length + waste %, or does it also need spacing (parts along a run)?
4. #10: does Kenneth's sample carry real annotations or flattened ones?
   Decides which half is worth building first.

## Verification plan

Every phase ends with `npm run verify` (purity, typecheck, vitest, MCP
suite, fixture oracle). Phase 1 additionally needs the ground-truth fixtures
unchanged to the cent. Interaction items (#4, #6, #13, #24, #5) are driven
in the browser harness with synthetic pointer events against
`window.__redbeam` as in the 2026-09-04 audit, then once in the packaged
desktop build. #7 and #5 are reproduced before they are fixed.
