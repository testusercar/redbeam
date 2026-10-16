# Bug review — 2026-09-23

Kenneth Siu, filed in Personal Notion Meetings. Five takeoff bugs. The CAT
wall-panel budget note from the same thread is not a REDBEAM bug and is not
in this list.

The September 10 review (`docs/BUG-REVIEW-2026-09-10.md`) is already on `main`.
This pass does not redo it. A previous handoff described these five as fixed
on a local branch that was never pushed. The work below is the implementation
on this branch.

## 1. Cannot place an origin to start a pattern

**Cause.** Pattern origin already existed as a tool draft (`apps/desktop/src/tools/pattern.ts`) and as `resolvePatternOrigin` in the domain, and the panel grid already honours `group.origin`. Nothing in the workspace stored an origin or passed one into the layout. Every area therefore used the automatic grid origin (the bounding-rect centre), and a right-click had no way to say otherwise.

**Fix.** A right-click on an area offers **Start the pattern here**. The point is kept on the scope, under `areaOrigins` in specifications — the same place area directions already live — and only if `patternStartPoint` can put it inside the area. A click a hair outside an edge is pulled in; a click elsewhere is refused. **Use the automatic pattern start** clears it. `layoutGroupsFor` / `calculatePieces` attach that point, in PDF points, as the group's origin. The automatic origin is unchanged when no point is stored, so the golden fixtures stay on the sheet-wide grid.

**Verification.** `patternStartPoint` and `layoutGroupsFor` tests in `packages/domain`. The menu and the command `start-pattern` are in `Workspace.tsx`. The mark is drawn with the existing pattern painter whether or not the layout preview is on.

## 2. Cannot open a subfolder when the parent already has a REDBEAM module

**Cause.** `resolve_project` always rewrote the asked folder to `outermost_project_root` whenever an ancestor held `redbeam.db`. That was the earlier "prioritize the parent" behaviour. The frontend dropped `redirected_from`, so the estimator was never told, and there was no way to open the subfolder.

**Fix.** Opening a folder asks each time: open the parent project, or open this folder on its own. `project_nesting` only reports the parent. `project_open` takes `own: true` when the subfolder was chosen, and otherwise still redirects — that remains the safety net if the question is skipped or the check fails. A context window opens the folder it was handed and does not ask again.

**Verification.** Rust tests in `project.rs`: a nested folder still opens the outermost project, and `resolve_project_choosing(..., own: true)` keeps the subfolder. `nestingChoiceCopy` covers the wording. The dialog is `NestingChoice` on both the start screen and the workspace.

## 3. Cannot delete other markups from Bluebeam

**Cause.** PDFium draws annotations into the page bitmap (`FPDF_ANNOT`). There was no way to take one off the sheet, and deleting it would mean writing the PDF, which REDBEAM does not do.

**Fix.** Right-click the drawing: **Hide this PDF markup**, **Hide all PDF markups on this sheet**, **Show hidden PDF markups**. The worker sets `FPDF_ANNOT_FLAG_HIDDEN` (2) on those annotations and leaves every other flag alone. The PDF is not saved. The set is remembered in `sessionStorage` per sheet, for this session. Annotation indexes start over on each page, so one list for the whole document would hide the wrong marks. Tile keys include the hidden set, so a stale bitmap cannot be served as the new view. If this PDFium build cannot set flags, hiding any annotation drops annotations from the bitmap entirely rather than pretending the hide worked. Hidden annotations are skipped when hit-testing; **Convert all** still sees them, because they are still in the file. Thumbnails are left as they were.

**Verification.** `apps/desktop/src/tools/foreignMarkups.test.ts` for the set, the token, and hit-testing. `tileKey` keeps the old key when nothing is hidden and adds a suffix when something is. The command id is `hide-pdf-markups`.

## 4. Cannot delete projects from the app UI

**Cause.** Setting a project's data aside was already implemented (`project_remove_data` moves `redbeam.db` into `.redbeam/removed-<stamp>/` and leaves the drawings). The start screen buried it in a right-click, the open project was excluded from the project-switcher hub that offered it, and the app menu had no row.

**Fix.** The start screen shows a trash button on each recent row, and Delete or Backspace (when the filter is empty) asks to set that row aside. The confirm is the one the row already had. The app menu and the command palette (`set-project-aside`) do the same for the open project: the window closes its database, then the file is moved, then the window returns to the start screen. The takeoff can be put back by moving the database out of `.redbeam/removed-<stamp>/`.

**Verification.** The command id is registered for the palette parity check. The move itself is the September 10 implementation and is not re-specified here.

## 5. Quarter panels aren't working

**Cause.** The yield control offers quarter, and `orderStockPieceCount` already nests four quarter pieces into one ordered panel. `panelGranularityIndex` only understood full and half, so quarter was stored and then cut as full panels.

**Fix.** Quarter is index 2. At that granularity a cell may be a quarter-length (0.25 × full width), a quarter-width (full length × 0.25), or a quadrant (half × half). Each is a quarter of the panel. The candidate with the best span fit wins; if none fit, the existing half logic is unchanged. Half granularity does not cut quarters. The order line is `panel_quarter`, and the layout summary counts quarters. Four quarter pieces order one panel.

**Verification.** `packages/domain/src/panels.test.ts` (quarter length, width, corner, four pieces → one panel, half granularity unchanged, a piece too big for a quarter falls through to half). `layoutSummary` names quarters only when there are any, so the older summary strings stay. Golden fixtures were not edited.

## What was not verified here

This pass ran the domain tests, the desktop unit tests, `npm run verify`, and the Rust project tests. It did not drive the Tauri window: the cloud VM is Linux, and the product is a Windows desktop app. The right-click menus, the nesting dialog, the start-screen trash button, and the Settings update row were not clicked in a running window.
