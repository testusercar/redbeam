# REDBEAM 0.2.1 through a Bluebeam Revu power user's eyes

Reviewer persona: ten years in Revu (eXtreme, then Complete). Daily driver for takeoff: Tool Chest with per-trade tool sets, Markups List with custom columns (Material, Unit Cost, Wall Height, Status), Legends per sheet, calibrated scale per viewport, Studio Sessions for estimator peer review, VisualSearch for counting fixtures, Batch Link and Sets for the drawing set. The screenshots I was given are the MSK Podium set (A-351A / A-351B reflected ceiling plans) with my own Bluebeam area, polylength and count markups baked into the PDF.

Severity key: **blocker** = I go back to Revu today; **major** = I work around it but complain weekly; **paper cut** = a burr I would file an issue for.

---

## 1. d1.png - start screen

1. **WHERE:** Two buttons, "Open a drawing set..." (blue, primary) and "Open a project folder...".
   **WHAT:** I cannot tell the difference. In Revu a "Set" is a virtual grouping of PDFs (Sets panel) and a "project" is a Studio Project. Here both appear to open a folder.
   **WHY:** The one word I would have used, "folder", is in the secondary button, and the primary button uses a term Revu already owns with a different meaning.
   **PROPOSED CHANGE:** One primary button, "Open a folder of drawings...", plus a sub-line "REDBEAM writes one redbeam.db beside the PDFs". If the two buttons really do different things (e.g. multi-select PDFs vs. pick a folder), say so in each button's helper text.
   **SEVERITY:** major (first 10 seconds of the product).

2. **WHERE:** Copy line "REDBEAM writes one redbeam.db beside the drawings and never modifies them."
   **WHAT:** Good news, but it raises the question I actually have and does not answer it: where do MY markups go? In Revu the markups live in the PDF, travel with it, and any office copy can open them.
   **WHY:** An estimator who emails the PDF to a sub expects the takeoff to travel with it. A sidecar DB does not.
   **PROPOSED CHANGE:** Add a second sentence: "Your takeoff lives in redbeam.db; export to PDF markups / Bluebeam-compatible XML from Estimates > Export." (and make that export exist, see d9).
   **SEVERITY:** major.

3. **WHERE:** Recent list rows: "rename / forget / remove data".
   **WHAT:** "remove data" is a destructive action one click from "forget" with no visual distinction. Revu never deletes anything from a recents list.
   **WHY:** Muscle memory on a recents list is "clear entry", not "delete my takeoff database".
   **PROPOSED CHANGE:** Move "remove data" behind a "..." menu with a confirm dialog that names the file path of the redbeam.db about to be deleted. Colour it as destructive.
   **SEVERITY:** major.

4. **WHERE:** Whole card centred in a 3840 px empty black window.
   **WHAT:** No "New from template", no thumbnail of the last sheet, no drop target ("drag a folder or PDFs here").
   **WHY:** Revu's start tab accepts drag and drop of any PDF; I live in Explorer.
   **PROPOSED CHANGE:** Make the whole window a drop target; show "Drop a folder or PDFs here" as watermark text.
   **SEVERITY:** paper cut.

5. **WHERE:** Recent row truncation "C:\Users\aaron\Maxxit Grou...Ramp\Bentall Towers 1 & 2".
   **WHAT:** Middle-ellipsis hides the part that distinguishes two projects under the same client folder.
   **PROPOSED CHANGE:** Tooltip with the full path on hover; tail-truncate rather than middle-truncate.
   **SEVERITY:** paper cut.

## 2. d2.png - "Open a folder by path" expanded

1. **WHERE:** Path text box + "Browse..." + "Open" + "Create & open".
   **WHAT:** Three ways to open a folder on one card ("Open a project folder...", "Open a drawing set...", and now this path box). "Create & open" is the only hint that a project needs creating at all.
   **WHY:** In Revu there is one File > Open. The path-box path is a developer affordance (it is pre-filled with a Teams sync path), not an estimator one.
   **PROPOSED CHANGE:** Fold the path box into the Browse dialog (Windows' own dialog already accepts a pasted path). Keep "Create & open" as the single new-project entry, renamed "New project from folder...".
   **SEVERITY:** paper cut (but adds to the d1 confusion).

2. **WHERE:** Helper text "A project is a folder. REDBEAM writes one redbeam.db inside it and never modifies the drawings."
   **WHAT:** Repeats the line from the card above almost verbatim.
   **PROPOSED CHANGE:** Keep one copy.
   **SEVERITY:** paper cut.

3. **WHERE:** No mention of what happens when the folder is on OneDrive / SharePoint (the pre-filled path is a Teams sync folder).
   **WHAT:** SQLite on a sync folder is exactly the thing that corrupts. Revu solved shared work with Studio; REDBEAM says nothing.
   **PROPOSED CHANGE:** Detect a OneDrive/SharePoint path and show an inline warning: "This folder syncs to the cloud. Only one person should have it open." Or a clear statement of what multi-user means here.
   **SEVERITY:** major (data-loss exposure for a Revu Studio user who is used to concurrent sessions).

## 3. d3.png - project opened, no drawing

1. **WHERE:** Left rail: Files / bookmark icon / grid icon / search icon; Files tree of 90 documents.
   **WHAT:** No Markups List panel anywhere. Revu's bottom-docked Markups List (Alt+L) is the centre of a takeoff workflow: sort by Subject, filter by Layer, sum a column, export CSV. REDBEAM's "markups" only exist inside a scope page on the right (see d9).
   **WHY:** I need one table of every measurement across the whole set, sortable and filterable, with column totals. That is the deliverable; the drawing is just the input.
   **PROPOSED CHANGE:** A project-wide Markups tab in the left rail (or bottom dock) with columns: Sheet, Scope, Kind, Label, Area, Length, Count, Status, Comments; column sort, filter chips, footer totals, CSV/XLSX export. Clicking a row navigates to the markup.
   **SEVERITY:** blocker.

2. **WHERE:** Right sidebar "Estimates > CEILING SCOPE" with three scopes CL04 / BLUE / TROUGHS.
   **WHAT:** Nothing in the tree tells me which sheets carry which scope. Revu's Markups List groups by Page Label out of the box.
   **PROPOSED CHANGE:** Show a per-scope sheet count and hover list ("3 markups on A-351A, A-351B").
   **SEVERITY:** major.

3. **WHERE:** Bottom toolbar: "TROUGHS ^" chip and "Take off" button, scale chip "Unset".
   **WHAT:** A scope is pre-selected before any drawing is open, and the scale chip says "Unset" of nothing. The toolbar is showing tool state for a document that does not exist.
   **PROPOSED CHANGE:** Hide or disable the tool cluster until a drawing is open; show "Open a drawing to start" in the empty canvas.
   **SEVERITY:** paper cut.

4. **WHERE:** Files tree with 90 items, nested "1 Data > Client > 260904 Client Drawings Take Off & ... > 01 Scope Overview > 04 Key Arch Details".
   **WHAT:** It is a folder mirror, not a Set. No sheet-number extraction, no page-label view, no "flatten into one sorted list of sheets" (Revu Sets does that and sorts A-101, A-102...). Multi-page PDFs are not exploded into sheets.
   **WHY:** Estimators navigate by sheet number (A-351B), not by folder.
   **PROPOSED CHANGE:** Add a "Sheets" view toggle next to "Files" that lists every page across every PDF, keyed by detected sheet number from the title block, sortable, with the folder view still available.
   **SEVERITY:** major.

5. **WHERE:** Footer "Reading the folder... Collapse all Refresh".
   **WHAT:** Indexer status is stuck in the footer in 11 px text; no progress, no count of pages indexed.
   **PROPOSED CHANGE:** Progress bar with "42 / 90 PDFs indexed".
   **SEVERITY:** paper cut.

6. **WHERE:** Pinned section (two sheets).
   **WHAT:** Fine, but "Pinned" and Revu's "Bookmarks" are different things and the bookmark icon in the left rail suggests the PDF bookmarks. Two pinning concepts, no tooltip.
   **PROPOSED CHANGE:** Tooltips; rename "Pinned" to "Pinned sheets".
   **SEVERITY:** paper cut.

7. **WHERE:** Missing: any Tool Chest / tool-set panel, any Layers panel, any Properties panel.
   **WHAT:** Revu's four docked panels for takeoff (Tool Chest, Markups List, Layers, Properties) are all absent. Scopes are the tool chest, apparently, but there is no place to see my saved tools (colour, fill, line, custom columns) as a library.
   **PROPOSED CHANGE:** A "Scope library" that persists across projects (product presets: Baffle, Planks, Troughs with default setup) so I do not rebuild CL04 on every job. Revu's tool sets are the thing I refuse to give up.
   **SEVERITY:** blocker.

## 4. d4.png - Ctrl+K hub for CL04

1. **WHERE:** Palette title "Choose - CL04", step 1, list: Take off / Configure... / Set product... / Colour... / Direction from an edge... / Set direction on the sheet / Markups... / Parts and quantities... / Commit / Rename... / Duplicate / Archive / Open in the sidebar.
   **WHAT:** This is nice, but it is an unfamiliar interaction model for a Revu user. Revu has no command palette; it has right-click, the Properties toolbar, and shortcuts. Not one item shows a keyboard shortcut.
   **WHY:** After ten years I never touch a mouse for tool selection (A = area, L = length, C = count, P = polylength, Shift+A = ...). A palette with no accelerators is slower than the toolbar.
   **PROPOSED CHANGE:** Right-align a shortcut on every row that has one; add shortcuts for Take off (T), Commit (Ctrl+Enter), Rename (F2), Duplicate (Ctrl+D). Publish a keyboard map in Settings.
   **SEVERITY:** major.

2. **WHERE:** "Commit - freeze the count as it stands".
   **WHAT:** No Revu equivalent and no explanation of what un-commit means, whether it locks markups (Revu: Lock), or whether it is a snapshot like Revu's "Status" custom column values (Accepted / Rejected). I cannot tell whether committing a scope stops me editing it.
   **PROPOSED CHANGE:** Rename to "Lock quantities" or "Snapshot" depending on which it is; helper text must say "markups stay editable, the totals shown in Estimates stop changing until you commit again" (or the opposite).
   **SEVERITY:** major.

3. **WHERE:** "Archive - its 3 markups stay and come back if you restore it".
   **WHAT:** Good, but there is no plain "Delete scope". Also no "Hide scope on sheet" (Revu: Layers panel eye icon, or Markups List "Hide").
   **PROPOSED CHANGE:** Add "Hide on drawing" toggle here and in the sidebar scope row. Add a real delete under a confirm.
   **SEVERITY:** major (visibility toggling is what I do 50 times a day in Revu).

4. **WHERE:** "Colour... #8000ff".
   **WHAT:** Colour only. Revu's area tool has fill colour, fill opacity, line colour, line width, line style, hatch pattern. On a plan with baked-in magenta Bluebeam markups, my new CL04 area at #8000ff solid is invisible against them.
   **PROPOSED CHANGE:** "Appearance..." with fill opacity, hatch (diagonal / cross), and outline width. Default fill opacity 30 %.
   **SEVERITY:** major.

5. **WHERE:** "Direction from an edge..." / "Set direction on the sheet - drawn as an arrow".
   **WHAT:** These are product-specific (baffle run direction). They are fine, but sitting between Colour and Markups they read as generic markup operations.
   **PROPOSED CHANGE:** Group under a "Layout" heading with a separator.
   **SEVERITY:** paper cut.

6. **WHERE:** Footer hints "choose / Baffle - 3 markups / on empty: back a step / esc cancel".
   **WHAT:** The hint row is in 10 px monospace; "on empty: back a step" means Backspace on an empty query, which took me a minute to parse.
   **PROPOSED CHANGE:** "Backspace: back", "Enter: choose".
   **SEVERITY:** paper cut.

7. **WHERE:** Whole palette.
   **WHAT:** No search across markups by label or by sheet ("find every CL04 on level 2"). Revu's Markups List search does this.
   **PROPOSED CHANGE:** Typing free text in the hub should match markups and sheets, not only commands.
   **SEVERITY:** major.

## 5. d5.png - hub, Markups step

1. **WHERE:** Rows "area - 1260.5 SF / A-351B-FLOOR-01---SECTOR-B-EXTERIOR...", "cutout - -6.9 SF", "area - 132.8 SF / TE-2".
   **WHAT:** Three markups, no label, no author, no date, no status, no comments, no layer. Revu shows Subject, Label, Author, Date, Status, Color, Layer, Space, plus my custom columns. And the negative sign on cutout ("-6.9 SF") is the only indication that it is a subtraction.
   **WHY:** Without labels I cannot tell which of three "area" rows is the corridor and which is the lobby. In Revu I label as I draw (Enter after placing, type label).
   **PROPOSED CHANGE:** Each row: kind icon, editable label (defaults to "CL04-01", "CL04-02" like Revu's auto-sequence), sheet, quantity, and a status chip. Allow a comment. "cutout" should read "cutout (subtracts)".
   **SEVERITY:** blocker for the missing labels; the rest major.

2. **WHERE:** Sheet name under each row is the full filename "A-351B-FLOOR-01---SECTOR-B-EXTERIOR-REFLECTED-CEILING-PLAN-REV.3 M2-M5 BU..." truncated.
   **WHAT:** The part that matters (sheet number A-351B) survives, but only because it is first. For files named "MSK Podium Set.pdf" page 14, I get nothing.
   **PROPOSED CHANGE:** Show "A-351B - p.1" derived from title block / page label; filename on hover.
   **SEVERITY:** major.

3. **WHERE:** Each row says "needs a choice >".
   **WHAT:** Every row is a sub-menu; I do not know what the choices are without diving in. Revu right-click on a Markups List row shows the verbs directly.
   **PROPOSED CHANGE:** Replace "needs a choice" with the verbs in a hover row: "Go to / Rename / Move to scope / Delete".
   **SEVERITY:** paper cut.

4. **WHERE:** "of CL04" in header.
   **WHAT:** No way from here to see markups of ALL scopes on THIS sheet, which is the question I ask most.
   **PROPOSED CHANGE:** A pivot chip: "of CL04" / "on A-351B" / "all".
   **SEVERITY:** major.

## 6. d6.png - A-351B open, a markup selected

1. **WHERE:** The selected blue region (upper block, small white square handles at corners).
   **WHAT:** Selection is barely visible: thin lighter-blue outline and four 6 px handles on a sheet saturated with magenta/blue fills. No mid-edge handles, no vertex handles, no rotate grip. Revu selects with an orange dashed bounding box and every vertex is draggable.
   **WHY:** Editing a polygon by dragging a vertex is the primary correction tool in Revu.
   **PROPOSED CHANGE:** High-contrast selection (white/black dashed outline that inverts against any fill), vertex handles on hover, mid-edge "+" to insert a vertex, Delete on a handle to remove it.
   **SEVERITY:** major.

2. **WHERE:** Whole canvas.
   **WHAT:** The PDF's baked-in Bluebeam markups (magenta polylines, blue areas, green hatch, cyan counts) render at full opacity with no way to dim or hide them. In Revu I would go Layers > uncheck, or Markups List > Hide, in one click.
   **WHY:** I cannot see my own new takeoff on top of my old Bluebeam takeoff; they are the same colours because I chose them.
   **PROPOSED CHANGE:** A "PDF markups" visibility toggle on the toolbar (eye icon) with three states: shown / dimmed 30 % / hidden. Read the /OC layers and the annotation Layer key and expose them as a list.
   **SEVERITY:** blocker.

3. **WHERE:** Scale chip bottom right reads `1" = 3'-9"`.
   **WHAT:** That is not an architectural scale. The title block says 1/4" = 1'-0". Something calibrated this sheet by two-point measurement and stored the raw ratio, or the page was scaled when printed and the app is reporting the effective ratio. On A-351A (d4) the same chip reads 1/4" = 1'-0". I have no idea which sheet is right.
   **WHY:** In Revu, Set Scale shows the preset picked, the custom ratio, and a "Calibrate" result side by side, and there is a Precision field. An estimator who sees 1" = 3'-9" stops and re-measures everything.
   **PROPOSED CHANGE:** The chip should show both: the named preset if within tolerance ("1/4\" = 1'-0\" (calibrated 1:45)") and a warning glyph when the calibrated ratio does not snap to any standard scale. Clicking it opens Set Scale with preset list, calibrate-by-two-points, viewport regions, and "apply to pages 2-14".
   **SEVERITY:** blocker (trust in every number on the right sidebar).

4. **WHERE:** Nothing on the sheet shows the quantity of the selected markup (Revu shows a live label "1,260.5 SF" next to the area and lets me toggle "Show caption").
   **PROPOSED CHANGE:** Caption on the markup with the quantity and label; toggle in Settings > Drawing.
   **SEVERITY:** major.

5. **WHERE:** Right sidebar rows "CL04 1,386.4 SF", "BLUE 0 SF", "TROUGHS 266.1 SF".
   **WHAT:** BLUE has 0 markups but the sheet is full of blue areas that are obviously the BLUE scope from Bluebeam. The app knows about "101 PDF markups on this sheet" (d7) but does not hint that some of them match a scope by colour or Subject.
   **PROPOSED CHANGE:** On import, propose a mapping: Bluebeam Subject/Layer/colour -> scope, with a review list ("29 markups look like BLUE - convert?").
   **SEVERITY:** major.

6. **WHERE:** Tab strip: "MSK Podium 1233 York Ave NYC", "A-351A-FLOOR-01---SE...", "A-351B-FLOOR-01---SE...".
   **WHAT:** Tabs are fine (Revu has them). No split view, though. Revu's Split Vertical with synced pan/zoom is how I compare RCP vs. floor plan.
   **PROPOSED CHANGE:** Drag a tab to the right edge to split; Ctrl+Shift+V.
   **SEVERITY:** major.

7. **WHERE:** Left rail still shows the Files tree while a drawing is open; no thumbnails view of pages in the current PDF.
   **WHAT:** The grid icon probably is thumbnails, but for a 1-page PDF it is moot. For the 30-page "01 Scope Overview" set I would want them.
   **SEVERITY:** paper cut (unverified).

## 7. d7.png - right-click on empty sheet

1. **WHERE:** Menu "The drawing / Convert all 101 PDF markups on this sheet / Trace the region here as an area".
   **WHAT:** Two items. Revu's canvas right-click has about twenty: paste, select all, zoom, rotate, page setup, flatten, and above all the measurement tools. There is no "Set scale", no "Calibrate", no "Paste", no "Zoom to fit".
   **PROPOSED CHANGE:** Add: Take off > (Area / Length / Count / Cutout), Set scale here..., Calibrate..., Paste, Select all markups of [scope], Zoom to fit, Rotate view.
   **SEVERITY:** major.

2. **WHERE:** "Convert all 101 PDF markups on this sheet".
   **WHAT:** A destructive-sounding bulk verb with no preview, no filter, and no target scope. 101 markups includes my text callouts, clouds, and the dimension lines; converting those "to areas" is nonsense. Also "Convert" implies the PDF changes; the start screen promised it never will.
   **PROPOSED CHANGE:** Rename to "Import PDF markups..." and open a dialog: table of the 101 with Subject, Label, Layer, Color, Author, type; checkboxes; a scope column with a default guess; "Import 29 selected".
   **SEVERITY:** major.

3. **WHERE:** "Trace the region here as an area".
   **WHAT:** Magic-wand style flood-fill trace. Useful, but there is no hint of tolerance, no preview, and no way to know which scope it lands in (the toolbar chip says TROUGHS, is that it?).
   **PROPOSED CHANGE:** Append "-> TROUGHS" to the item, and show a dashed preview polygon on hover before committing.
   **SEVERITY:** paper cut.

4. **WHERE:** Menu heading "The drawing".
   **WHAT:** A heading that names the target is a nice touch, but "The drawing" is odd English; Revu would say the sheet name.
   **PROPOSED CHANGE:** "A-351B (this sheet)".
   **SEVERITY:** paper cut.

## 8. d8.png - right-click on one of my Bluebeam markups

1. **WHERE:** Menu "Convert 1 selected PDF markup into: CL04 / BLUE / TROUGHS; 1 PDF markup here: Convert polygon 'Area Measurement' to an area / Convert all 101... / Trace...".
   **WHAT:** This is the best moment in the app: it read my Bluebeam markup's Subject ("Area Measurement") and offers to bring it into a scope. But: it drops the label, layer, author, date, custom columns, and my comments. It also says "convert", which again implies the PDF is edited.
   **WHY:** My custom columns ARE my estimate in Revu (Material, Unit Cost, Labor Hrs). If REDBEAM discards them, I lose more than I gain.
   **PROPOSED CHANGE:** "Import into CL04" (copy semantics, clearly stated); carry Label -> markup label, Comments -> note, Layer -> tag, custom columns -> a key/value "Imported" block shown in the markup detail. Show "Original stays in the PDF".
   **SEVERITY:** blocker for the lost metadata; naming is paper cut.

2. **WHERE:** Missing items in this menu.
   **WHAT:** No Properties, no Copy, no Delete/Hide (fair, it is a PDF markup), no "Go to in Markups List", no "Select all of this Subject/Color" (Revu: right-click > Select > Same Subject), no "Zoom to".
   **PROPOSED CHANGE:** Add "Properties (read-only)", "Select all 'Area Measurement' on sheet", "Hide PDF markup".
   **SEVERITY:** major.

3. **WHERE:** Right sidebar Parts table: "Installed length unverified 4,165.8 LF / Baffle stock unverified 515 EA / Connectors unverified 1,372 EA / End caps 514 EA / Joiners 258 EA".
   **WHAT:** "unverified" in yellow on every line with no explanation. Is that "not committed"? "Not reviewed"? A rounding flag? Revu has one concept, Status, with editable values.
   **PROPOSED CHANGE:** Tooltip and a legend at the top of the table; one status vocabulary shared with "Not committed" (e.g. Draft / Reviewed / Committed). Make the word a chip, not a text colour.
   **SEVERITY:** major.

4. **WHERE:** "1,386.4 SF Area / 240.2 LF Perimeter / Not committed. Commit".
   **WHAT:** No count of the markups feeding the total on this line (it is three lines down), no min/max/avg, no per-sheet split. Revu's Markups List footer sums per column and per group.
   **PROPOSED CHANGE:** "1,386.4 SF from 3 markups on 2 sheets" with expand.
   **SEVERITY:** paper cut.

5. **WHERE:** Toolbar shows "CL04 ^" chip and the drawing tools (pentagon, scissors, ruler, count, trough, then a "no" circle and X) even though I am in the select tool.
   **WHAT:** Tool state and scope state are separate chips but the visual weight is identical. Revu shows the active tool pressed in the toolbar and the current tool set in the Tool Chest.
   **SEVERITY:** paper cut (see d11).

## 9. d9.png - scope page (Parts / Setup / Markups one column)

1. **WHERE:** Three headings collapsed into one scrolling column: Parts (5 lines), Setup (Product Baffle, Spacing OC 4", Stock 10'0", Conn. Max 3'6", Profile W, Yield full, Seams aligned, Direction, Name, Colour), Markups (3 on 2 sheets, group by sheet / kind).
   **WHAT:** The Markups list is at the bottom, below the setup form, and it is the thing I look at most. Revu keeps the Markups List docked and always visible.
   **PROPOSED CHANGE:** Make the three tabs actual tabs (they are drawn as tabs at the top, then the page ignores them and stacks), or let Markups be pinned open at the top.
   **SEVERITY:** major.

2. **WHERE:** Markups rows: "area 1260.5 SF", "cutout -6.9 SF", "area 132.8 SF" under "Page 1 - Page 1" and a filename group.
   **WHAT:** "Page 1 - Page 1" is a group header that says nothing. No label, no status, no hover verbs, no checkbox for multi-select, no column headers, no sort, no totals per group.
   **PROPOSED CHANGE:** Group header = sheet number + title; rows get label / qty / status; footer per group; multi-select with Shift-click; right-click verbs.
   **SEVERITY:** blocker (this is the only markups list in the app and it is a list, not a table).

3. **WHERE:** Setup fields "Spacing OC - centre to centre", "Stock - length you buy", "Conn. Max - hanger limit", "Profile W - face width".
   **WHAT:** This is the custom-columns idea done as a fixed product form. Good for baffles; useless for the acoustic panel job next week. No way to add a field. Revu's custom columns are user-defined per profile.
   **PROPOSED CHANGE:** Product forms as templates plus "Add field..." (number / text / choice / formula). Formula fields (Revu has them) drive the Parts table.
   **SEVERITY:** major.

4. **WHERE:** "Show the layout on the sheet" toggle.
   **WHAT:** No idea what "layout" is until I flip it (presumably the baffle run lines). Also this is the only per-scope visibility toggle and it is for the generated layout, not for the markups themselves.
   **PROPOSED CHANGE:** Two toggles: "Show markups" and "Show generated layout"; both also in the scope row of the Scopes list.
   **SEVERITY:** major.

5. **WHERE:** Footer "Duplicate / Remove from estimate".
   **WHAT:** "Remove from estimate" vs. Archive (d4) vs. delete: three near-synonyms.
   **PROPOSED CHANGE:** One vocabulary: Archive (recoverable) and Delete (confirm).
   **SEVERITY:** paper cut.

6. **WHERE:** No Export anywhere on the scope page or Estimates root.
   **WHAT:** Revu: Markups List > Export > CSV/XML/PDF summary in two clicks. I need the Parts table and the markups table in Excel.
   **PROPOSED CHANGE:** Export button on Estimates root and every scope page: XLSX (parts + markups), CSV, and a PDF summary with the sheet snapshot.
   **SEVERITY:** blocker.

7. **WHERE:** Colour swatch next to Name.
   **WHAT:** Colour edits here but appearance (opacity, hatch, line) still absent; see d4.
   **SEVERITY:** major (duplicate of d4.4).

## 10. d10.png - Settings > General

1. **WHERE:** Sections: General (3), Drawing (1), Takeoff (11), Performance (1).
   **WHAT:** 16 settings total. Revu has hundreds, and the ones I rely on are: default units, precision (decimal places on SF/LF), default scale behaviour, snap to content, grid, default tool appearance, keyboard shortcuts editor, autosave interval, backup location.
   **PROPOSED CHANGE:** Add "Units & precision" (SF/SM, LF/M, decimals, fraction display for imperial), "Shortcuts" with a rebinding table, "Snapping" (to PDF vector content, to markup vertices, orthogonal lock).
   **SEVERITY:** major.

2. **WHERE:** "Reopen the last project on launch - Off".
   **WHAT:** Default should be On for a desktop takeoff tool; Revu reopens the last session by default.
   **PROPOSED CHANGE:** Default On.
   **SEVERITY:** paper cut.

3. **WHERE:** "Recent projects kept 40 / drop off never".
   **WHAT:** Two settings for a recents list is more than Revu has for the whole start tab. Fine, but the copy "stays a keystroke away in the prompt (~)" leaks the Ctrl+K vocabulary into Settings without ever telling me that "~" is a prompt prefix.
   **PROPOSED CHANGE:** Tooltip or a "Prompt shortcuts" settings page listing the prefixes.
   **SEVERITY:** paper cut.

4. **WHERE:** "Reset all - 1 changed".
   **WHAT:** No indication which one changed. Revu highlights changed settings? No, but VS Code does, and this UI is clearly VS Code-shaped.
   **PROPOSED CHANGE:** Blue bar on the changed row (already used elsewhere in the app for selection).
   **SEVERITY:** paper cut.

5. **WHERE:** No "Profiles" (Revu: Profiles save workspace + tool sets + columns) and no "Import from Bluebeam" (tool sets .btx, custom columns .bcx).
   **WHAT:** Migration path is zero.
   **PROPOSED CHANGE:** Settings > Import > "Bluebeam tool set (.btx) -> scope presets", "Custom columns (.bcx) -> setup fields".
   **SEVERITY:** major.

## 11. d11.png - takeoff mode toolbar

Toolbar as read (left to right): hand (pan) / arrow (select) / marquee-zoom; scope chip "CL04 ^"; pentagon (area, active) / scissors (cutout) / ruler (length) / a boxed "01" (count) / trough (channel?) / circle-slash / X; page 1/1; zoom 50 %; fit; scale chip `1" = 3'-9"`.

1. **WHERE:** Tool icons with no labels and no tooltips visible.
   **WHAT:** Scissors = cutout is a guess; ruler = length is a guess; the trough glyph and the circle-slash are unknowable. Revu labels every measurement tool in the Measurements panel and shows shortcut in the tooltip.
   **PROPOSED CHANGE:** Tooltip "Cutout (X)" on hover with the shortcut, and a text label under each icon when the window is wider than 1600 px (it is 3840).
   **SEVERITY:** major.

2. **WHERE:** Missing tools.
   **WHAT:** No rectangle area (Revu: Area then hold Shift, or the Rectangle tool), no polylength with arc segments, no count with multiple symbols, no perimeter-only, no volume (area x height), no VisualSearch equivalent for counts. Ortho lock (Shift) is not indicated.
   **PROPOSED CHANGE:** Add rectangle-area, a count tool that lets me click a symbol and "find similar" (the app already traces raster regions), and Shift-ortho hint in the status.
   **SEVERITY:** major (count/VisualSearch is the one I would miss most on RCPs full of fixtures).

3. **WHERE:** Only one scope chip ("CL04 ^").
   **WHAT:** Switching scope is a dropdown; in Revu it is clicking a tool in the Tool Chest, i.e. always one click, and I see all tools at once.
   **PROPOSED CHANGE:** Show up to ~8 scope chips inline as coloured swatches with number keys 1-8; overflow in the dropdown.
   **SEVERITY:** major.

4. **WHERE:** Circle-slash and X at the end of the tool cluster.
   **WHAT:** Two ways to leave a tool or cancel a shape, not distinguishable. Revu: Esc cancels, tool stays; a second Esc returns to select.
   **PROPOSED CHANGE:** One "Done (Esc)" button; the circle-slash, if it is "cancel current polygon", should only appear while a polygon is in progress.
   **SEVERITY:** paper cut.

5. **WHERE:** No "sticky tool" indication.
   **WHAT:** In Revu I can pin the area tool so it stays active for the next 30 areas. Unknown here.
   **PROPOSED CHANGE:** Double-click the tool to lock it (standard), with a small padlock badge.
   **SEVERITY:** paper cut.

6. **WHERE:** Scale chip `1" = 3'-9"` beside the zoom cluster.
   **WHAT:** Same as d6.3. It is the wrong place for the most safety-critical number in the app; it belongs in a persistent status bar with page label and units.
   **PROPOSED CHANGE:** Status bar: "A-351B - 1/4\" = 1'-0\" (calibrated) - SF/LF - 50 %".
   **SEVERITY:** blocker (repeat).

7. **WHERE:** The bottom toolbar overlaps the sheet's title strip (drawing row "1 2 ... 6 7").
   **WHAT:** A floating toolbar over the drawing hides content; Revu's toolbars are chrome, not overlay.
   **PROPOSED CHANGE:** Dock it below the canvas, or auto-hide when the cursor is on the drawing.
   **SEVERITY:** paper cut.

---

## Top 10 for my persona

1. **A real Markups List.** Project-wide table with columns, sort, filter, group by sheet/scope, footer totals, click-to-navigate. (d3.1, d9.2) - blocker.
2. **Scale I can trust.** `1" = 3'-9"` must never appear without a preset match and a warning; Set Scale dialog with presets, calibrate, per-viewport regions, page ranges. (d6.3, d11.6) - blocker.
3. **Hide / dim the PDF's own markups and expose PDF layers.** Eye toggle with three states; layer list from /OC and annotation Layer. (d6.2) - blocker.
4. **Import my Bluebeam markups with their metadata.** Label, Layer, Comments, custom columns must survive; "Import", not "Convert"; a review table before bulk import. (d8.1, d7.2) - blocker.
5. **Export.** XLSX/CSV of parts and markups and a PDF summary from every Estimates page. (d9.6) - blocker.
6. **Reusable scope presets across projects (my Tool Chest).** Plus .btx / .bcx import. (d3.7, d10.5) - blocker/major.
7. **Labels on markups** with auto-sequencing and status chips; drop "Page 1 - Page 1". (d5.1, d9.2) - blocker.
8. **Keyboard shortcuts everywhere**, shown in tooltips and the hub, with a rebinding page. (d4.1, d11.1) - major.
9. **Appearance beyond a colour**: fill opacity, hatch, outline, and captions on the sheet showing quantity. (d4.4, d6.4) - major.
10. **Per-scope visibility toggle and a richer right-click** (Set scale, Take off submenu, Select same Subject, Properties). (d4.3, d7.1, d8.2) - major.

What I would refuse to give up coming from Revu: the Markups List with custom columns and export, Tool Chest presets, per-viewport calibrated scale with a named preset, layer visibility, keyboard-driven tool switching, and the certainty that my markups travel with the PDF. Items 1-6 above are those, in that order. Until 1-5 land I keep Revu open beside REDBEAM and use REDBEAM only for the baffle-layout parts math, which is the one thing Revu cannot do.
