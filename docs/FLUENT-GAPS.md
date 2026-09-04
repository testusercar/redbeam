# Fluent shell — gap register

The approved design is the canvas *REDBEAM Windows Shell* (revision 5,
2026-09-04). This register is the multi-pass comparison of that canvas against
the code on `fluent-shell`, and the record of what each pass closed. A gap is
closed only when the harness (`?harness=shell`) has been looked at and matches
the board.

Severity: **S1** the design is contradicted · **S2** the design is partly met ·
**S3** cosmetic. Status: open · fixed (pass N) · deferred (with why).

## Pass 1 — inventory (2026-09-04)

### Foundations board

| # | Gap | Where | Sev | Status |
|---|-----|-------|-----|--------|
| F1 | Caution / Critical / Success are the app's amber, red, green (`#F4B740`, `#FF4D4D`, `#4ADE80`); the board uses WinUI system fills `#FCE100`, `#FF99A4`, `#6CCB5F` with their backgrounds `#433519`, `#442726`, `#393D1B` and Attention `#60CDFF`. | `theme/redbeam.css` `--rb-warn/bad/good` | S1 | fixed (pass 2) |
| F2 | InfoBar grammar: warnings are a tinted box with warn-coloured text; the board draws a 3px severity bar, the glyph, and primary-ink words on the severity background. | `.wswarn`, `.panenote`, `.statustoast.problem`, `.dockblock` | S2 | fixed (pass 2) |
| F3 | Focus visual is the accent; WinUI draws a 2px white outer + 1px black inner ring. | `.shellapp :focus-visible`, `.swtoggle:focus-visible`, palette | S2 | fixed (pass 2) |
| F4 | Flyouts are a solid blue-leaning raised fill (`--rb-raised #2B2D30`) with `--rb-line-2`; the board uses in-app acrylic `#2C2C2C` 92% + SurfaceStroke `#757575` 40%, 8px radius, 4px padding. | `.dockmenu`, `.titlemenu`, `.tabmenu`, `.sheetmenu`, `.markupmenu`, `.palette-panel`, `.statustoast` | S2 | fixed (pass 2) |
| F5 | Selected row is a full-height 2px inset bar (`inset 2px 0 0`) on file rows, menu items and palette rows; the board (and `.sheetrow.active` already) use the 3×16 centred indicator. | `.filerow.active`, `.menuitem[aria-checked]`, `.palette-row[aria-selected]` | S3 | fixed (pass 2) |
| F6 | Density: `--rb-row` is 28; WinUI Compact ListViewItem is 24. Nav items (`--rb-rail-btn`) are 36; compact is 32. Two-line estimate rows pad to ~44; board is 36. | `theme/redbeam.css`, `.sidetab`, `.estrow` | S2 | fixed (pass 2) |
| F7 | ToggleSwitch is 30×17; WinUI is 40×20 with a 12px knob. | `.swtoggle` | S2 | fixed (pass 2) |
| F8 | Kickers (`.menuhead`, `.panetitle`, `.sheetgrouphead`, `.prefs-kicker`, `.palette-kicker`, `.dockscopestate`) are 10px mono upper-case with 0.12em tracking; Fluent has no such voice — the board uses Caption 12 sentence case, secondary ink. | shell.css, settings.css, palette.css | S2 | fixed (pass 2) |
| F9 | Body text: nav labels and menu items are 12–13px; Fluent keeps Body 14 on navigation and menus even at compact heights. Controls and rows stay 12. | `.sidetablabel`, `.menuitem`, `.palette-row`, `.tab` | S3 | fixed (pass 2) |
| F10 | Icons are Lucide (stroked, 1.5); the board uses Fluent UI System Icons (filled regular). `@fluentui/react-icons` 2.0.339 is MIT and now installed. | `shell/icons.tsx` and every `<Glyph>` | S2 | fixed (pass 3) |
| F11 | Primary buttons already take the accent (`.primarybtn`); `.docktakeoff` and `.takeoffbtn` still paint white (`--rb-action`). | shell.css | S2 | fixed (pass 2) |
| F12 | Accent from the system, Mica backdrop, opaque drawing, 4/8 radii, caption buttons 46×40, title bar 40, compact pane 48, controls 24: **already match**. | — | — | matches |

### Window board

| # | Gap | Where | Sev | Status |
|---|-----|-------|-----|--------|
| W1 | Frame-time readout matches (`.perfchip`). | — | — | matches |
| W2 | The dock scope pill has an outline; the board draws ControlFill with ControlStroke. Checked tool is a full-width 2px underline; the board draws a 16×3 centred pill. | `.dockscope`, `.dockbtn[aria-pressed]` | S3 | fixed (pass 2) |
| W3 | Estimates pane head is 40 (`--rb-topbar-h`); board is 32 (`--rb-pane-head`). | `.wshead-bar` | S3 | fixed (pass 2) |

### Left sidebar board

| # | Gap | Where | Sev | Status |
|---|-----|-------|-----|--------|
| L1 | Files groups by the FIRST path segment, so all 693 Barclays documents fall in one group. Board: group by the deepest folder that varies. | `Workspace.tsx` folders memo | S1 | superseded: Aaron asked for a nested folder tree, built by the bug-fix session in `shell/fileTree.ts`; `fileFilter.ts` and its test are deleted |
| L2 | Thumbnails are two across at 96px; board is three across at 80px. | `.pane .pagestrip .thumbs`, `PageStrip thumbWidth` | S3 | fixed (pass 2) |
| L3 | Sheet rows 28 → 24; file rows already 24; tab strip 36 → 32. | see F6 | S2 | fixed (pass 2) |
| L4 | Search pane, limited-search note, hits by document, coverage footer: **match**. | — | — | matches |

### Right sidebar board (the rebuilt scope pane)

| # | Gap | Where | Sev | Status |
|---|-----|-------|-----|--------|
| R1 | The scope page is one long column (spec, totals, parts, markups). Board: header band + hero quantity + status line, then a SelectorBar with Parts / Setup / Markups pages; Parts opens by default; Duplicate/Remove in the foot. | `RightWorkspace.tsx ScopeDetail` | S1 | fixed (pass 5) |
| R2 | The bill of materials is a level of the panel with a link row at the round. Board: no bill at the round; parts live in the scope's Parts page with per-line confidence; exports (Save report, Copy bill as TSV, Save marked-up PDF) move to a menu on the round's header with Rename, Duplicate, Delete. | `RightWorkspace.tsx EstimateOverview`, `BomView.tsx`, `Workspace.tsx openBom`, dock Quantities, palette `quantities` | S1 | fixed (pass 5) |
| R3 | Round rows show scope and markup counts; board shows one total per scope in the round's scope list. | `EstimateOverview` | S2 | fixed (pass 5) |
| R4 | Blocker with its action, warning stack, breadcrumb, archived fold, pinned: **match**. | — | — | matches |

### Command bar board

| # | Gap | Where | Sev | Status |
|---|-----|-------|-----|--------|
| C1 | Menus: 28px items at Body 14, Caption group heads — see F8/F9. | `.menuitem`, `.menuhead` | S3 | fixed (pass 2) |
| C2 | Scale chips, calibration entry, region list, zoom menu, More menu, tab overflow, project switcher, app menu: **match structurally**; materials per F4. | — | — | matches |
| C3 | Status toast: problem tone should be a Caution InfoBar (see F2). | `.statustoast.problem` | S3 | fixed (pass 2) |
| C4 | Board's Page scale flyout is one surface: Calibrate and Draw a region entries, a Common scales grid, an "All 26 scales" disclosure, the sheet's region list, and Apply to every sheet. The app keeps two flyouts — the full picker (`&show=scalepicker`) and the region list (`&show=regions`). The verbs themselves are reachable: the palette now carries "Apply this sheet's scale to every sheet" and "Set scale for a range of sheets…" (pass 7). Found in pass 8. | `ScalePicker`, `RegionList` | S3 | open |

### States board

| # | Gap | Where | Sev | Status |
|---|-----|-------|-----|--------|
| T1 | Start screen, pane empties, scan note, naming rows, crash screen: **match**. | — | — | matches |
| T2 | Start card uses `--rb-raised`; board uses LayerFill on Mica. Cosmetic, folded into F4 materials. | `.startcard` | S3 | fixed (pass 2) |

### Settings board

| # | Gap | Where | Sev | Status |
|---|-----|-------|-----|--------|
| G1 | Settings is one centred column with mono kickers. Board: NavigationView pane (back, title, Find a setting, 36px items with indicator, About as footer item) on Mica, a content layer with the 8px top-left corner, BreadcrumbBar title, Body Strong section headers. | `SettingsPanel.tsx`, `settings.css` | S1 | fixed (pass 6) |
| G2 | Rows are 48px cards with a 30×17 switch; board is SettingsCard 68px, 20px icon, On/Off word beside a 40×20 switch, families as SettingsExpander with a chevron and indented children on ControlFillTertiary. | same | S1 | fixed (pass 6) |
| G3 | Find a setting: an AutoSuggestBox over the same typed commands the palette has. | new | S2 | fixed (pass 6) |
| G4 | About page: version card with update action, no-channel caution, problem reports as an expander with copy, third-party notices. `UpdateRow`/`DiagnosticsRow` exist; they need the card grammar and the page. | `update/*.tsx` | S2 | fixed (pass 6) |
| G5 | Reset all in the page header only while something is changed; Default per row: **match**. Rejected values as a dismissable InfoBar: partial (`.warnblock`). | same | S3 | fixed (pass 6) |

### Palette board

| # | Gap | Where | Sev | Status |
|---|-----|-------|-----|--------|
| P1 | No recents; untyped palette lists groups only. | `commands.ts`, `CommandPalette.tsx` | S2 | fixed (pass 7) |
| P2 | No prefixes (`>` `#` `:` `@` `/` `=` `~` `?`). | `commands.ts` | S2 | fixed (pass 7) |
| P3 | No argument steps; commands that need more open a popover from `run`. Board: chips in the field, Backspace back, Tab to advance, a text step. | `CommandPalette.tsx` | S1 | fixed (pass 7) |
| P4 | Toggles close the palette; board flips and stays (Ctrl+Enter closes). | `CommandPalette.tsx` | S2 | fixed (pass 7) |
| P5 | Unavailable rows exist (`unavailable`) for projects only; board dims Take off without a scope, page out of range, calibrate on an unscaled sheet, with reasons. | `Workspace.tsx` commands | S2 | fixed (pass 7) |
| P6 | Refusals from the store (delete round) are a status line; board keeps the palette open with the reason and an alternative. | `CommandPalette.tsx`, `Workspace.tsx` | S2 | fixed (pass 7) |
| P7 | "Nothing matches" offers nothing; board offers full-text search. | `CommandPalette.tsx` | S3 | fixed (pass 7) |
| P8 | Verbs missing as commands (bridge actions exist): next/previous sheet, close tab, zoom presets, show/hide panes, set scale for a range, remove region, estimate create/rename/duplicate/delete, scope add/rename/product/counts/colour/measure/duplicate/remove/restore, take off in scope, leave takeoff, pick a tool, set direction, commit scope(s), reassign/delete selected markup, exports, reset all settings, close project, undo/redo. | `Workspace.tsx` commands | S1 | fixed (pass 7) |
| P9 | Shift+Enter (context window), Tab, Backspace-back, Ctrl+Enter, Ctrl+Z inside the palette. | `CommandPalette.tsx` | S2 | fixed (pass 7) |

### Iconography board

Covered by F10.

## Plan of passes

- **Pass 2 — foundations.** F1–F9, F11, W2, W3, C1, C3, T2, L2, L3. Tokens and stylesheets only; every guard test kept green.
- **Pass 3 — icons.** F10: Fluent UI System Icons behind the existing `Glyph` roles.
- **Pass 4 — files.** L1.
- **Pass 5 — the scope pane and the round.** R1–R3, with the dock's Quantities and the palette's command re-pointed.
- **Pass 6 — settings.** G1–G5.
- **Pass 7 — palette.** P1–P9.
- **Pass 8 — visual reconciliation.** Every harness address against its board; anything still off goes back in this table.

## Pass 2–5 — what closed, and how it was checked (2026-09-04)

- **Pass 2, foundations.** `theme/redbeam.css` now carries WinUI's system fills
  with their backgrounds, the flyout material, the surface stroke, the layer
  fill, the focus pair, and Compact metrics (`--rb-row` 24, `--rb-row-2` 36,
  `--rb-rail-btn` 32, `--rb-menu-item` 28, Body 14 for nav and menus). Every
  warning, note and toast is an InfoBar; every flyout is acrylic with the
  surface stroke; every selected row carries the 3×16 pill; the focus visual
  is the black-and-white pair; the switch is 40×20; the primaries take the
  accent. Checked in the harness at 1440×900: `?harness=shell`, `&rail=files`.
- **Pass 3, icons.** `shell/icons.tsx` is a table of Fluent UI System Icon
  families; `Glyph` picks the asset for the role's size. `lucide-react` is
  removed. `icons.test.ts` now guards the family rather than a stroke weight.
- **Pass 4, files.** `fileFilter.ts` gained `commonFolder` and `folderGroup`;
  the Files pane groups by the deepest folder every document shares. Four new
  tests, including the Barclays paths.
- **Pass 5, the scope pane and the round.** `RightWorkspace.tsx` rebuilt: the
  scope band, the quantity headline with one status line, a SelectorBar of
  Parts / Setup / Markups (Parts first), Duplicate and Remove in the foot.
  `BomView.tsx` is gone; the bill's exports live in `bom/exports.ts` and are
  reached from the round's header menu with Rename, Duplicate and Delete. The
  round's scope list shows one total per scope. The dock's Quantities and the
  palette's command open the Parts page; Specifications opens Setup; the
  bridge's `open_panel: bom` does the same and reports `scopePage`. Guards in
  `surfaces.test.ts` and `layering.test.ts` updated to the new design.
  Checked in the harness: `?harness=shell`, `&show=bom`, `&show=scopes`.

## Pass 6–8 — what closed, and how it was checked (2026-09-04)

- **Pass 6, settings.** `SettingsPanel.tsx` rebuilt as a full-screen
  NavigationView: a pane with back, title, Find a setting (filters every
  setting by label and description), one item per category with a count,
  About as the footer item; a content layer with the breadcrumb title, Reset
  all only while something is changed, rejected values as a dismissable
  Caution InfoBar; families as SettingsExpander, rows as 68px SettingsCards
  with the 20px icon, the On/Off word and the 40×20 switch; an About page
  with the version card, the update row, diagnostics and third-party notices.
  Guards added to `settings.test.ts` (pane width, 36px nav items, 68px cards,
  stable scrollbar gutter). Checked at `?harness=shell&show=settings`.
- **Pass 7, the palette.** `commands.ts` gained the step model (`choose` with
  options and an optional warning, `text` with placeholder, initial value,
  stated rule and check), `stay` for toggles, `alt` for Shift+Enter, `page`
  for `:47`, a `run` that may return a refusal (a reason, and the nearest
  thing that works), the prefixes `> # : @ / = ~ ?` with `parseQuery` and
  `narrow`, recents ahead of the groups, and a prefix hint in every group's
  note. `recent.ts` keeps the last three ids in the webview's storage.
  `CommandPalette.tsx` rewritten: chips for the steps taken, Backspace on an
  empty field goes back, Tab advances without running, Enter on a toggle
  flips and stays (Ctrl+Enter closes), a refusal keeps the palette open with
  its reason and the alternative as a row, a miss says so in quotes and offers
  full-text search (`onSearchText`, seeded into the Search pane), the keys are
  stated in the foot for the state the palette is in. `Workspace.tsx` carries
  the vocabulary: zoom presets, next/previous sheet, close tab, every pane,
  close project, undo/redo with their labels, calibrate, set scale (this
  sheet, every sheet, a series of sheets in two steps), remove a region, new
  / rename / duplicate / delete round, save report, copy bill, marked-up PDF,
  add / rename / product / counts / duplicate / archive / restore scope, take
  off in a scope (listed with the scopes, dimmed when the sheet has no scale),
  leave takeoff, every tool, direction, commit one or all, move or delete the
  selection, parts and setup, every setting as a switch, reset all. Nothing
  destructive confirms with a dialog: delete round is refused by the store
  while it holds markups, archive scope says its markups stay. Checked at
  `?harness=shell&show=palette` in every state the board shows.
- **Pass 8, visual reconciliation.** Every harness address against its board
  at 1280×800: `?harness=shell`, `&rail=files|thumbnails|search`,
  `&show=scopes|bom|calibration|regions|scalepicker|palette|settings|crash`,
  `&state=scanning|empty|noscopes|note`. Window, sidebar, scope pane, round
  page, parts page, states and palette match their boards. One structural
  difference recorded as C4 above.
- **Not from this work.** While pass 7 ran, another session was adding
  `export/estimateExport.ts`, `export/estimatePdf.ts`, `export/ExportSheet.tsx`,
  `export/snapshots.ts`, `search/indexer.ts`, `shell/fileTree.ts`,
  `project/headlessDocument.ts` and Rust files under `src-tauri`. Those are
  untracked and in progress; they fail `reachability.test.ts`,
  `classnames.test.ts` and `tsc` on their own account and were left alone.

## Pass 9 — one more look at every surface (2026-09-04)

Every harness address again, judged as screenshots at 960×600 (the design's
window minimum) and at 800×516 (below it). Three defects, all fixed:

- **The sub-960 fallback grid had four tracks against three named areas.**
  `shell.css`'s `@media (max-width: 959px)` block still declared a rail
  column from before the sidebar became the pane's collapsed form, which put
  the pane in a 48px column and the drawing where the pane should be, at
  exactly the widths the block exists to rescue. Three tracks now.
- **The wrapped dock kept its centring transform.** At the 559px viewport
  tier the dock is pinned to both edges, but `translateX(-50%)` stayed on it
  and pushed half of it under the pane; Take off and the sheet arrows were
  out of reach. `transform: none` at that tier.
- **A sheet row could ride its trail over the number.** An unscaled sheet
  with a scope cluster and a page number was wider than a row at the pane's
  minimum. The row is a container now, and below 220px an unscaled row drops
  its dots; the badge and the number stay.

Checked and approved without change: title bar, project switcher, app menu,
tab overflow, Contents, Files (the tree), Thumbnails, Search, the scan note,
the round page and its menu, Setup, Parts, Markups grouped by sheet, the
empty and no-scopes states, the calibration entry, the region list, the scale
picker, the zoom menu, the palette, Settings and the crash screen. The dock's
flyouts clamp inside the viewport cell by measurement (`popover.ts`); in the
Browser pane they screenshot unclamped because the pane is hidden and the
ResizeObserver that re-measures does not fire there.

## Round 2 of the bug-fix session, against this register (2026-09-04)

The bug-fix session's second round (docs/AUDIT-2026-09-04.md, "Round 2")
touched entries here; recorded so the register stays true:

- **P3, P8 extended.** Scope work is complete inside the palette on the Step
  model: add → product → counts → configure; configure, rename, product,
  counts, duplicate and remove pick the scope when none is open. A `run` may
  now return `Next` and lead into another command's step, replacing the
  finished step's chip. Removal stays the reversible "Archive <scope>" row
  with its markups named — no confirm step, per pass 7.
- **Ranking.** `commands.ts` gained `ALIASES`; a whole-word alias or keyword
  prefix hit ranks above a fuzzy title hit and below a title-prefix hit.
- **Dock scope popover** (C2): a round is a header that unfolds in place and
  keeps the menu open; scope rows carry product and markup count.
- **Materials.** `.settingsview` left the tabbed-backdrop transparent group:
  Settings is a fixed layer over the drawing and the sheet showed through.
  The thumbnail grid's rules were renamed to the merged `.side` container.
- **Rows never wrap:** one appended block in `shell.css` truncates project
  paths, tree rows, menus, tabs and estimate rows with an ellipsis.
- **Exports** go through a native Save As; the round menu and the palette's
  Save report both report where the file went.
