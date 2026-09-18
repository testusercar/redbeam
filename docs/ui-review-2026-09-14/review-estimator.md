# REDBEAM 0.2.1 — Estimator's screenshot review

Reviewer persona: senior construction estimator, 15 years of takeoff, Bluebeam Revu + On-Screen Takeoff every day. Ceilings, baffles, planks, panels. I bid under deadline. I care about three things: can I trust the number, can I find the sheet, and can I get it into a bid.

Screens reviewed: d1–d11 (3840x2088, one 4K monitor). Severity scale: **blocker** (I would not bid off this), **major** (costs me time or trust every session), **paper cut** (wrong but survivable).

Cross-cutting issues are listed once at the end and referenced where they appear.

---

## 1. d1 — Start screen

1. **WHERE:** Two buttons, "Open a drawing set..." (blue, primary) and "Open a project folder..." (outlined).
   **WHAT:** Two verbs for what the helper text says is one thing ("a project is a folder"). I cannot tell whether a "drawing set" is a folder of PDFs, a single multi-page PDF, or a Bluebeam Set (.bex). Nothing says which one creates a `redbeam.db`.
   **WHY:** First click in the app and I already have to guess. If "drawing set" writes a database next to the client's PDFs on a SharePoint sync folder, that has consequences.
   **PROPOSED:** One primary button, "Open folder of drawings...", with a one-line sub-caption "Creates redbeam.db in that folder if none exists". If a single-PDF path is genuinely different, label it "Open one PDF..." and say what happens to the db.
   **SEVERITY:** major

2. **WHERE:** Primary button colour (blue) vs brand mark (red RB).
   **WHAT:** The brand is red; every call-to-action in the app is Windows-Fluent blue. Reads like an Electron template, not REDBEAM.
   **WHY:** Consistency signals polish; polish signals the numbers were also cared about.
   **PROPOSED:** Primary = brand red (or a red-tinted accent); keep blue only for links/focus if at all. Apply app-wide (see cross-cutting C1).
   **SEVERITY:** paper cut

3. **WHERE:** Recent list, path lines: `C:\Users\aaron\Maxxit Grou...Ramp\Bentall` then wraps to `Towers 1 & 2` on a second line.
   **WHAT:** Middle-ellipsised path that still wraps. Wrapped fragment looks like a third recent item.
   **WHY:** I keep three or four versions of the same job (Bid, Addendum 1, Addendum 2). The folder tail is the only thing that distinguishes them and it is the part being chopped.
   **PROPOSED:** Single line, ellipsise the middle harder, show the full path in a tooltip; or show the parent folder name only and the full path on hover.
   **SEVERITY:** paper cut

4. **WHERE:** Recent list, timestamps "23h ago" vs "5 Sep".
   **WHAT:** Mixed relative/absolute in one column; no year on the absolute one.
   **WHY:** Bid dates matter. "5 Sep" of which year when I reopen in January?
   **PROPOSED:** Always absolute, one format: "13 Sep 2026, 14:02". Relative only in a tooltip.
   **SEVERITY:** paper cut

5. **WHERE:** Row actions "rename  forget  remove data" (lowercase underlined links).
   **WHAT:** Three link-styled verbs, all lowercase, while the buttons above are sentence-case buttons. "forget" vs "remove data" — I have to read the tooltip (if there is one) to know which one deletes my takeoff. "remove data" is a destructive action sitting inline with no icon, no colour, no confirm cue.
   **WHY:** Under pressure I will click the wrong one. Losing a redbeam.db is losing a day.
   **PROPOSED:** Kebab menu per row: "Rename…", "Remove from list", and a red "Delete takeoff data…" that confirms with the path. Never expose delete as a bare inline link.
   **SEVERITY:** major

6. **WHERE:** Helper line "REDBEAM writes one redbeam.db beside the drawings and never modifies them."
   **WHAT:** d2 says the same thing with different wording ("inside it"). "Beside" and "inside" are different folders to me.
   **WHY:** I need to know where the db lands so I can back it up with the bid.
   **PROPOSED:** One sentence, used once: "REDBEAM keeps its takeoff in redbeam.db at the top of the project folder. Your PDFs are never edited."
   **SEVERITY:** paper cut

7. **WHERE:** Card size vs screen.
   **WHAT:** ~440x300 px card at 4K, 11-px body text. Everything else is empty black.
   **WHY:** I run 4K at 150%; this looks like a 1080p layout at 100%. Hard to read from a normal seat.
   **PROPOSED:** Respect Windows scaling; minimum 13–14 px body at 100%; let the card grow with the recent list.
   **SEVERITY:** paper cut

8. **WHERE:** Whole screen.
   **WHAT:** No version, no "What's new", no link to settings, no import from Bluebeam/OST, no "New project" as such, no window title.
   **WHY:** Every bid I have starts from an existing Bluebeam markup set. If the migration path is not on the front door I assume it does not exist.
   **PROPOSED:** Add a secondary action "Import Bluebeam markups…" (even if it just opens a folder and runs the converter) and a footer with version + Settings.
   **SEVERITY:** major

9. **WHERE:** "Recent" section header.
   **WHAT:** No count, no sort control, no search. Other lists in the app show counts.
   **WHY:** Settings says up to 40 are kept. 40 rows with wrapped paths is unusable without filter.
   **PROPOSED:** "Recent · 2" header, a filter box once > 8.
   **SEVERITY:** paper cut

---

## 2. d2 — Start screen, "Open a folder by path" expanded

1. **WHERE:** Path text field `C:\Users\aaron\Maxxit Group\MAXXiT Systems Team Site - Ramp\Bent...`
   **WHAT:** Truncated at the end — the one part I need to verify. No way to see the full path without clicking in.
   **WHY:** Pasting the wrong sibling folder (Bid vs Addendum) means a takeoff on the wrong revision.
   **PROPOSED:** Multi-line or scrolling field; ellipsise the middle, never the end; tooltip with the full path.
   **SEVERITY:** major

2. **WHERE:** Buttons "Open" and "Create & open".
   **WHAT:** Two buttons for one intent. What does "Open" do on a folder with no redbeam.db — fail? prompt? Does "Create & open" create the folder, or the db? Both plausible.
   **WHY:** I should never have to know whether a db exists. That is the app's job.
   **PROPOSED:** One button "Open". If no db exists, open anyway and show a one-time toast "Started a new takeoff in this folder". If the folder does not exist, disable the button with an inline reason.
   **SEVERITY:** major

3. **WHERE:** Button styling on one card.
   **WHAT:** Three primary styles on a single card: blue filled ("Open a drawing set..."), outlined ("Open a project folder..." / "Browse..." / "Create & open"), white filled ("Open").
   **WHY:** Looks like three different apps.
   **PROPOSED:** One primary style, one secondary style. Period.
   **SEVERITY:** paper cut

4. **WHERE:** Helper text "A project is a folder. REDBEAM writes one redbeam.db inside it and never modifies the drawings."
   **WHAT:** Repeats the sentence from the top of the card with different wording ("beside" vs "inside").
   **PROPOSED:** Delete the second copy.
   **SEVERITY:** paper cut

5. **WHERE:** "Browse..." next to the path field.
   **WHAT:** Same function as "Open a project folder..." at the top of the card, 200 px away.
   **PROPOSED:** Keep one. The path-entry section is really an "advanced" affordance; collapse it to a link "Paste a path" that reveals the field only.
   **SEVERITY:** paper cut

6. **WHERE:** Card position.
   **WHAT:** The card grows downward and re-centres, so the Recent list I was reading jumps ~55 px up when I expand the section.
   **PROPOSED:** Anchor the card top; grow downward only.
   **SEVERITY:** paper cut

7. **WHERE:** Link text "Open a folder by path instead" (d1) becomes section "Open a folder by path" (d2).
   **WHAT:** No way to collapse it back; the link vanished.
   **PROPOSED:** Toggle disclosure with a chevron.
   **SEVERITY:** paper cut

---

## 3. d3 — Project open, no drawing yet

1. **WHERE:** Files tree, rows `A-460 - ENLARGED-BASE-ELE...` through `A-469 - ENLARGED-BASE-ELE...`.
   **WHAT:** Ten sheets truncated to an identical string. The sheet number survives, the title does not. Same for `A-775…A-781 - SECTION-DETAILS---E...`.
   **WHY:** I navigate by sheet title as much as number ("the one with the soffit at grid C"). Bluebeam Sets show number + title in two columns; OST shows a page list with thumbnails.
   **PROPOSED:** Parse sheet number and title from the filename (the pattern is obviously `A-460 - TITLE`) and render as two lines or two columns; tooltip with the full name; allow the panel to be widened and remember the width.
   **SEVERITY:** major

2. **WHERE:** Files tree, duplicates: `A-460`, `A-465`, `A-467`, `A-468` appear under "04 Key Arch Details" AND under "EWS-107 & 107A" / "EWS-108 & 108A".
   **WHAT:** Same sheet number in three folders, no revision, no "this one has markups" indicator, no dedupe.
   **WHY:** This is the single biggest way a takeoff goes wrong: measuring the superseded copy. A-351A here is "BULL.10 6-26-26" (Bulletin 10) — I only learn that from a wrapped file name in d8.
   **PROPOSED:** Sheet index view (flat, one row per sheet number) with revision/bulletin and "has takeoff" badge; warn when the same number exists in more than one file; let me mark a file "superseded" (greyed out, excluded from totals).
   **SEVERITY:** blocker

3. **WHERE:** Tree is auto-expanded five levels deep (`1 Data > Client > 260904 Client Drawings Take Off & ... > 01 Scope Overview > 04 Key Arch Details`).
   **WHAT:** 90 documents dumped as one scroll; the folders that matter (`CLG-04,05, Soffit`) are below the fold.
   **PROPOSED:** Collapse to the first level with counts; remember expansion; "Pinned" sheets should also appear at the top of this panel, not only in the estimates sidebar.
   **SEVERITY:** paper cut

4. **WHERE:** Status row bottom-left: "Reading the folder…" while the full tree is already painted and the filter says "Filter 90 documents".
   **WHAT:** Stale/contradictory status.
   **WHY:** I do not know whether it is safe to start.
   **PROPOSED:** Show a progress count ("Indexed 61/90") and clear it when done; d4 shows the finished state "90 documents", so the transition just needs to be honest.
   **SEVERITY:** paper cut

5. **WHERE:** Top-left project row: an orange fruit icon, then a folder icon, then "MSK Podium 1233 York Ave NYC" with a chevron.
   **WHAT:** What is the fruit? App logo is a red RB elsewhere.
   **PROPOSED:** Use the RB mark or nothing.
   **SEVERITY:** paper cut

6. **WHERE:** Left rail tabs: "Files" (labelled) + bookmark, grid, search icons (unlabelled).
   **WHAT:** Only the active tab has a label.
   **PROPOSED:** Label all four, or none with tooltips + shortcuts.
   **SEVERITY:** paper cut

7. **WHERE:** Right sidebar header stack: "Estimates" (title bar) → breadcrumb "Estimates > CEILING SCOPE" → heading "CEILING SCOPE".
   **WHAT:** The name is printed three times in 60 px.
   **PROPOSED:** Drop the panel title; breadcrumb alone; heading only when it adds something (an editable name field, say).
   **SEVERITY:** paper cut

8. **WHERE:** Terminology: "Estimates > CEILING SCOPE > Scopes: CL04, BLUE, TROUGHS".
   **WHAT:** The thing called "CEILING SCOPE" is an *estimate* that contains *scopes*. The user named it "SCOPE" because that is what it is to them. Two meanings of the word on one screen.
   **WHY:** When I hand this to a PM, "scope" has one meaning in the bid.
   **PROPOSED:** Rename the container level to "Estimate" and the items to "Items" or "Tags" (the CL04 / TE-2 type tags are what architects call them). Or "Systems". Anything but scope-inside-scope.
   **SEVERITY:** major

9. **WHERE:** Scope list rows in d3 (no drawing open) vs d4 (drawing open).
   **WHAT:** d3 shows no quantities; d4 shows "1,386.4 SF / 0 SF / 266.1 SF" for the same scopes. The totals appear only when a sheet is open.
   **WHY:** I look at the sidebar to answer "where am I on this bid" *before* opening a sheet. Numbers that come and go are numbers I do not trust.
   **PROPOSED:** Totals always visible; if they are being recomputed show a spinner in place, never blank.
   **SEVERITY:** major

10. **WHERE:** Scope colour dots: BLUE = red dot, TROUGHS = red dot (same hue), CL04 = purple.
    **WHAT:** Two scopes share a colour, and one of them is *named* BLUE. On the sheet I cannot tell BLUE from TROUGHS.
    **PROPOSED:** Auto-assign distinct colours from a palette; warn (inline, not modal) when two scopes collide; offer "swatch + hex + name" in the colour picker.
    **SEVERITY:** major

11. **WHERE:** "Add scope" button appears twice (list header and list footer).
    **PROPOSED:** One, at the top.
    **SEVERITY:** paper cut

12. **WHERE:** "Pinned" list: `A-351A-FLOOR-01--SECTOR-A-EXTERIOR-REFLECT...  4` and `...REFLEC...  2`.
    **WHAT:** Numbers with no unit — markups? scopes? pages? Names truncated to the useless part.
    **PROPOSED:** "4 markups" or a markup icon; show sheet number + short title (see 3.1).
    **SEVERITY:** paper cut

13. **WHERE:** Empty canvas.
    **WHAT:** Pure black, no hint. No "Open a sheet from Files or drag a PDF here".
    **PROPOSED:** Empty-state text plus the two most recent sheets as buttons.
    **SEVERITY:** paper cut

14. **WHERE:** Bottom toolbar is shown with no sheet open: page "< >" with no number, "35%" zoom of nothing, scale "Unset".
    **WHAT:** Controls that act on nothing; "Unset" reads as a warning about a sheet that does not exist.
    **PROPOSED:** Hide the page/zoom/scale islands until a sheet is open; keep only the scope chip + Take off (disabled with tooltip "Open a sheet first").
    **SEVERITY:** paper cut

15. **WHERE:** Bottom toolbar, four floating rounded islands.
    **WHAT:** Visually detached from everything, overlaps the sheet bottom once one is open (d6: covers the title-block strip and grid line 6).
    **PROPOSED:** Dock it as a real bar below the canvas, or make it auto-hide on pan. See cross-cutting C6.
    **SEVERITY:** paper cut

16. **WHERE:** Nothing on this screen tells me the estimate total, the number of sheets scaled/unscaled, or lets me export.
    **WHY:** This is the "home" of the project and it has no summary.
    **PROPOSED:** Estimate header card: total by unit (SF/LF/EA), sheets with takeoff / sheets unscaled, last commit, "Export…" button.
    **SEVERITY:** major

---

## 4. d4 — Command prompt (Ctrl+K), scope hub for CL04

1. **WHERE:** Whole list: titles in proportional font, descriptions in monospace (`area tool, drawing into CL04`, `product, each measure, yield, seams`).
   **WHAT:** Terminal aesthetic. Monospace is used here for prose, in the sidebar for numbers, in the tree for nothing. It reads as a developer tool.
   **PROPOSED:** One UI face; monospace only for tabular numbers if at all.
   **SEVERITY:** paper cut (but it is the single loudest "two apps" signal)

2. **WHERE:** Right-hand tags "needs a choice", "needs a name".
   **WHAT:** Jargon telling me the item has a sub-step. The chevron already says that.
   **PROPOSED:** Remove; keep the chevron. If you must, "›" plus a count ("3 sheets").
   **SEVERITY:** paper cut

3. **WHERE:** "Take off" (no ellipsis, opens a tool) vs "Configure…" vs "Set direction on the sheet" (no ellipsis, requires drawing) vs "Rename…".
   **WHAT:** Ellipsis convention inconsistent.
   **PROPOSED:** Windows convention: "…" only when a further dialog/input is required before anything happens.
   **SEVERITY:** paper cut

4. **WHERE:** "Colour… #8000ff".
   **WHAT:** British spelling; hex value as the human-readable description.
   **WHY:** I am bidding a Manhattan hospital in SF and LF. Hex means nothing to me.
   **PROPOSED:** "Color" (pick one locale app-wide, see C2); show a swatch and a name ("Purple").
   **SEVERITY:** paper cut

5. **WHERE:** "Commit — freeze the count as it stands".
   **WHAT:** No definition of what commit means for the bid. Does it lock the markups? Snapshot the quantity? Can I un-commit? Is a committed number what exports?
   **WHY:** In a bid workflow "committed" means "in the spreadsheet". If it means something else here, I double-count.
   **PROPOSED:** Rename to "Snapshot quantity" or "Lock", and put a one-line definition in the Setup section and in the tooltip on "Not committed." (d9). Show the committed value next to the live value when they differ.
   **SEVERITY:** major

6. **WHERE:** "Archive — its 3 markups stay and come back if you restore it" vs sidebar footer "Remove from estimate" (d8/d9).
   **WHAT:** Two verbs, are they the same action? Neither says "delete".
   **PROPOSED:** One verb. "Archive" everywhere; "Delete permanently…" as a separate, confirmed action.
   **SEVERITY:** major

7. **WHERE:** "Duplicate — the specification, not the takeoff".
   **WHAT:** Good idea, chatty label.
   **PROPOSED:** "Duplicate setup (no markups)".
   **SEVERITY:** paper cut

8. **WHERE:** Footer hint "⏎ Baffle · 3 markups".
   **WHAT:** The Enter key hint is the scope's subtitle, not an action. Meaningless.
   **PROPOSED:** "⏎ open" / "⏎ run".
   **SEVERITY:** paper cut

9. **WHERE:** Highlighted row is "Rename…" (tenth item), not the first.
   **WHAT:** Default selection appears random (probably mouse hover, but the screenshot suggests the keyboard cursor).
   **PROPOSED:** Keyboard focus on item 1; hover highlight visually distinct from keyboard focus.
   **SEVERITY:** paper cut

10. **WHERE:** Hub has no "Export", "Go to markups on this sheet", "Zoom to scope", "Delete".
    **WHY:** The two things I do most from a scope are "show me where it is" and "get me the number out".
    **PROPOSED:** Add "Zoom to markups" and "Copy quantity" / "Export…".
    **SEVERITY:** major

11. **WHERE:** Header row "CL04 … Baffle · 3 markups" plus chip "CL04" plus input placeholder "Choose · CL04".
    **WHAT:** The scope name three times in the top 60 px, again.
    **SEVERITY:** paper cut

12. **WHERE:** "Direction from an edge… — run the pattern along an edge of one of its areas on this sheet".
    **WHAT:** 14-word description; "its areas" — whose?
    **PROPOSED:** "Align baffle run to an edge you click".
    **SEVERITY:** paper cut

13. **WHERE:** Sidebar totals now visible: "1,386.4 SF". (Also see 3.9.)
    **WHAT:** Thousands separator here, none in "1260.5 SF" (d5, d9 markup rows).
    **PROPOSED:** One number formatter, app-wide (C4).
    **SEVERITY:** paper cut

---

## 5. d5 — Prompt, Markups step

1. **WHERE:** Row 1 `area · 1260.5 SF / A-351B-FLOOR-01---SECTOR-B-EXTERIOR-REFLECTED-CEILING-PLAN-REV.3 M2-M5 BU…`, row 3 `area · 132.8 SF / TE-2`.
   **WHAT:** Secondary line is the file name for two rows and a label ("TE-2") for the third. Inconsistent; "TE-2" is a different tag — why is a TE-2 markup inside CL04?
   **WHY:** If TE-2 is a different product, its 132.8 SF is in the wrong bucket. I cannot tell from here.
   **PROPOSED:** Always show sheet number + markup label: "A-351B · Area Measurement" / "A-351A · TE-2". Flag when the Bluebeam subject/label disagrees with the scope name.
   **SEVERITY:** major

2. **WHERE:** Sheet name in monospace uppercase, truncated at "BU…".
   **WHAT:** The revision token ("REV.3") happens to survive; the bulletin ("BULL.10") does not.
   **PROPOSED:** As 3.1 — parse and show number/title/rev.
   **SEVERITY:** paper cut

3. **WHERE:** "needs a choice" on all three rows.
   **PROPOSED:** Remove.
   **SEVERITY:** paper cut

4. **WHERE:** Quantities `1260.5`, `−6.9`, `132.8`.
   **WHAT:** No thousands separator (vs 1,386.4 in the sidebar). Minus sign is a typographic minus — good — but there is no subtotal line and no per-sheet subtotal.
   **WHY:** A bid needs "by floor / by sheet". I can only see the grand total.
   **PROPOSED:** Group by sheet with subtotals; footer "Net 1,386.4 SF (3 markups, 2 sheets)".
   **SEVERITY:** major

5. **WHERE:** Footer hint "⏎ of CL04".
   **PROPOSED:** "⏎ go to markup".
   **SEVERITY:** paper cut

6. **WHERE:** Nothing shows the *Bluebeam* value for a converted markup.
   **WHY:** The first thing I do after any import is compare the imported SF to Revu's Markups List. If REDBEAM's 1260.5 differs from Revu's number, I need to know it was scale, not geometry.
   **PROPOSED:** Show "Revu: 1,258 SF" beside converted markups, with a delta and colour when > 0.5%.
   **SEVERITY:** major

---

## 6. d6 — A-351B open after "Go to it", markup selected

1. **WHERE:** Scale chip bottom-right: `1" = 3'-9"`. Title block says 1/4" = 1'-0". A-351A (d4) shows `1/4" = 1'-0"`.
   **WHAT:** Same scope, two sheets, two different scales, one of which is a nonsense ratio (1:45). Either A-351B was calibrated off a mis-drawn dimension, or the PDF was plotted at a non-standard size. The app shows no "calibrated vs declared" state and no warning.
   **WHY:** 1:45 vs 1:48 is a 13.8% area error. The 1,386.4 SF CL04 total blends both. That is a bid-losing or margin-losing number and nothing on screen says so.
   **PROPOSED:** (a) Display calibrated scales as "Calibrated · ≈1:45 (1/4" declared)"; (b) show a warning icon when calibrated deviates from the nearest standard scale by > 2%; (c) list each sheet's scale and source in the Sheet index; (d) totals that mix sheets with different scale sources get a caution glyph.
   **SEVERITY:** blocker

2. **WHERE:** Bottom toolbar, active scope chip: "TROUGHS".
   **WHAT:** I navigated here from the CL04 hub via "Go to it", the selected markup is a CL04 markup, and the toolbar still says TROUGHS. If I hit Take off now I draw into TROUGHS.
   **WHY:** This is precisely the mistake I make at 11 pm. Bluebeam has the same problem and it costs me every week.
   **PROPOSED:** Active scope follows context: opening a scope hub, selecting a markup, or opening the scope page sets it. Show the active scope colour as a canvas border or cursor tag while drawing.
   **SEVERITY:** blocker

3. **WHERE:** Selected markup (the top blue area).
   **WHAT:** Selection = thin light-blue outline on a blue fill + 5-px white corner handles that look exactly like the drawing's column symbols. I only found it by zooming the screenshot.
   **PROPOSED:** Selection = high-contrast dashed outline (white/black marching ants), larger handles with the scope colour, dim the rest of the sheet slightly.
   **SEVERITY:** major

4. **WHERE:** Files tree: `A-764 - PLAN-DETAILS---EWS…` row is highlighted AND `A-351B…` has the blue current bar.
   **WHAT:** Two rows look selected.
   **PROPOSED:** One selection state; hover state must be lighter than selection.
   **SEVERITY:** paper cut

5. **WHERE:** Document tabs: `A-351A-FLOOR-01--SE…` and `A-351B-FLOOR-01---SE…`.
   **WHAT:** Truncated to the identical prefix; only the A/B and a hyphen count differ.
   **PROPOSED:** Tab title = sheet number ("A-351A"), full name in tooltip.
   **SEVERITY:** major

6. **WHERE:** Canvas rendering of takeoff areas ("Show the layout on the sheet" on).
   **WHAT:** Solid blue/teal fills plus dense hatch lines cover the RCP notes and dimensions underneath.
   **WHY:** I need to read the ceiling tag and the "(10) BATTENS @ 4" SPACING" note *while* checking the takeoff.
   **PROPOSED:** Fill opacity slider (default ~30%), hatch only when zoomed in past a threshold, "Hide takeoff" toggle with a hotkey.
   **SEVERITY:** major

7. **WHERE:** Page control "‹ 1/1 ›".
   **WHAT:** Arrows look enabled on a single-page PDF.
   **PROPOSED:** Disable and dim.
   **SEVERITY:** paper cut

8. **WHERE:** Icon next to `A-351B…` in the tree (open-in-new).
   **WHAT:** No label; not on other rows.
   **PROPOSED:** Tooltip, or move to context menu.
   **SEVERITY:** paper cut

9. **WHERE:** Nothing on screen tells me which markup is selected, its quantity, or its scope.
   **WHAT:** No selection readout (Bluebeam shows it in the Properties tab and the status bar).
   **PROPOSED:** Small floating pill near the selection or a status line: "CL04 · area · 1,260.5 SF · A-351B".
   **SEVERITY:** major

---

## 7. d7 — Right-click on empty sheet

1. **WHERE:** Menu header "The drawing".
   **WHAT:** Odd group label; reads like a placeholder.
   **PROPOSED:** "Sheet A-351B".
   **SEVERITY:** paper cut

2. **WHERE:** "Convert all 101 PDF markups on this sheet".
   **WHAT:** First item on an empty-space right-click is a bulk, irreversible-feeling operation across 101 markups of unknown type — clouds, text, callouts, other trades' areas — into an unstated scope (the active one, presumably TROUGHS). No confirm, no preview, no filter.
   **WHY:** 101 markups on an RCP will include the electrical consultant's comments. Converting them into TROUGHS doubles my number.
   **PROPOSED:** Rename "Import PDF markups…" and open a picker: filter by Subject / Label / Layer / Colour / Author, preview count and total SF, choose target scope per group. This is the feature that would make me switch from Revu.
   **SEVERITY:** blocker

3. **WHERE:** "Trace the region here as an area".
   **WHAT:** "Region" undefined — the enclosed white space? the nearest closed polyline? Into which scope? No preview of what would be traced.
   **PROPOSED:** "Auto-area this room (into CL04)"; on hover, show the region outline before I commit.
   **SEVERITY:** major

4. **WHERE:** Menu content.
   **WHAT:** No "Calibrate scale", "Set scale", "Zoom to fit", "Rotate", "Paste", "Select all markups", "Hide PDF markups", "Properties".
   **WHY:** Right-click on empty sheet is where 15 years of muscle memory expects scale and view actions.
   **PROPOSED:** Add at least Calibrate / Zoom / Hide PDF markups.
   **SEVERITY:** major

5. **WHERE:** Menu styling.
   **WHAT:** Different corner radius, padding and shadow from the Ctrl+K prompt and from the dropdowns in the sidebar.
   **SEVERITY:** paper cut

---

## 8. d8 — Right-click on one of the PDF's own (Bluebeam) markups

1. **WHERE:** Group 1 "Convert 1 selected PDF markup into › CL04 / BLUE / TROUGHS"; Group 2 "1 PDF markup here › Convert polygon "Area Measurement" to an area".
   **WHAT:** Two ways to convert the same markup, one with an explicit target scope, one with an implicit target. Which scope does "Convert polygon … to an area" use? If it is the active scope, it is TROUGHS in d6 and CL04 in d8 — depends on what I did last.
   **PROPOSED:** One group: "Convert "Area Measurement" into › CL04 / BLUE / TROUGHS / New scope…". Drop the implicit variant.
   **SEVERITY:** major

2. **WHERE:** Group headers "Convert 1 selected PDF markup into" / "1 PDF markup here" / (d7) "The drawing".
   **WHAT:** Three header styles: sentence, fragment, noun. Capitalisation and tone differ.
   **SEVERITY:** paper cut

3. **WHERE:** Converted markup does not show the Bluebeam quantity, subject, label, layer, author, or date.
   **WHY:** Revu's markup carries `Subject=Area Measurement, Label=CL04, Layer=Ceilings, Area=1258 SF`. That metadata is my audit trail. Throwing it away means I cannot reconcile with the Revu Markups List I already sent the PM.
   **PROPOSED:** "Properties…" item; on convert, keep subject/label/layer/author as read-only fields on the markup; auto-suggest the target scope from Label.
   **SEVERITY:** blocker

4. **WHERE:** Missing "Convert all markups with the same Subject / Label / Layer / Colour".
   **WHY:** This is how I would bring 101 markups across in 30 seconds instead of 101 right-clicks.
   **PROPOSED:** Add "Convert all 'Area Measurement' on this sheet (14) into ›" and "…on all sheets (37) into ›".
   **SEVERITY:** blocker

5. **WHERE:** Sidebar Parts table (also d9): "Installed length **unverified**", "Baffle stock **unverified**", … in yellow after each name.
   **WHAT:** A status word set inline in the part name, same weight, five times. It reads as if the parts are *called* "Installed length unverified". There is no way to verify, and no tooltip saying what verification is.
   **PROPOSED:** Status as a badge column or a single banner "Parts are computed, not verified — Verify…"; define "verified".
   **SEVERITY:** major

6. **WHERE:** Parts quantities: Installed length 4,165.8 LF; Baffle stock 515 EA; Connectors 1,372 EA; End caps 514 EA; Joiners 258 EA.
   **WHAT:** No way to audit. 1,386.4 SF at 4" OC ≈ 4,159 LF, so length is plausible. But 515 sticks of 10'-0" for 4,166 LF is 5,150 LF supplied — 24% waste — and nothing shows the run count, average run, waste %, or rounding rule. End caps 514 vs stock 515 makes no obvious sense (should be 2 per run, so ~2 x runs).
   **WHY:** I have to defend every EA on a bid review. "The software said so" is not an answer.
   **PROPOSED:** Expandable rows: Runs (n), avg run, longest run, waste %, rounding ("per run, round up"), and the formula in plain words. Let me override the waste %.
   **SEVERITY:** blocker

7. **WHERE:** Setup labels "Spacing OC · centre to centre", "Stock · length you buy", "Conn. Max · hanger limit", "Profile W · face width".
   **WHAT:** Two names per field crammed in one caption; abbreviations ("Conn. Max", "Profile W"); British "centre".
   **PROPOSED:** One label ("Spacing, o.c."), help text on hover/info icon.
   **SEVERITY:** paper cut

8. **WHERE:** Values `4"`, `10' 0"`, `3' 6"`; toolbar `1'-0"`, `3'-9"`.
   **WHAT:** Three feet-inch formats.
   **PROPOSED:** One: `10'-0"` everywhere (C4).
   **SEVERITY:** paper cut

9. **WHERE:** "Profile W · face width" = "—" (empty) while Parts are fully computed.
   **WHAT:** A blank input with no "required" or "not used for this product" state.
   **PROPOSED:** Either hide fields the product does not use, or show "Not used for baffles".
   **SEVERITY:** paper cut

10. **WHERE:** Dropdown values "full", "aligned", "never" (d10) vs "Baffle".
    **WHAT:** Lowercase option values next to a capitalised one.
    **PROPOSED:** Sentence case for all option values.
    **SEVERITY:** paper cut

11. **WHERE:** "Direction   set for this sheet · defaul…   [Set on the / sheet]".
    **WHAT:** Truncated value; button label wraps to two lines inside a 70-px button.
    **PROPOSED:** Give the row its own line; "Default (0°) · this sheet: 90°"; button "Set…".
    **SEVERITY:** paper cut

12. **WHERE:** "Name  CL04  [swatch]" at the bottom of Setup.
    **WHAT:** Name and colour are identity, not setup; they sit after yield/seams.
    **PROPOSED:** Move to the header row (click the name to rename, click the dot to recolour).
    **SEVERITY:** paper cut

13. **WHERE:** Markups group "Page 1 · Page 1  (2)" for the *current* sheet A-351B, vs full file name (wrapped over two lines, including ".pdf" and "BULL.10 6-26-26") for A-351A.
    **WHAT:** The sheet I am looking at is labelled "Page 1 · Page 1". That is a bug in the display name and it destroys confidence.
    **PROPOSED:** Sheet number everywhere; fall back to file stem, never "Page 1 · Page 1".
    **SEVERITY:** major

14. **WHERE:** Tabs "Parts 5 | Setup | Markups 3" AND accordion sections "Parts / Setup / Markups" below.
    **WHAT:** Two navigation systems for the same three sections. The tabs scroll the accordion (I assume). Setup has no count while the others do.
    **PROPOSED:** Pick one. Accordions with sticky headers are fine; drop the tabs.
    **SEVERITY:** paper cut

15. **WHERE:** KPI "1,386.4 SF Area · 240.2 LF Perimeter", "Not committed." + "Commit".
    **WHAT:** Trailing period on a status; "Commit" as a text link at the same weight as the status. See 4.5.
    **SEVERITY:** paper cut

16. **WHERE:** Footer "Duplicate | Remove from estimate".
    **WHAT:** Destructive action at the same weight as Duplicate, no confirm cue, and it is not the same word as "Archive" in the prompt (4.6).
    **SEVERITY:** major

17. **WHERE:** Bottom toolbar (takeoff tools revealed): polygon, scissors, ruler, dimension-ish, "V"/funnel, ⊘, ✕.
    **WHAT:** No labels, no visible tooltips, no shortcuts. I can guess polygon and scissors (cutout). I cannot guess the other five.
    **PROPOSED:** Labels under icons ("Area", "Cutout", "Length", "Calibrate", "Edge", "Exclude", "Done") + shortcut letters; match Revu's A/L/C mnemonics where sensible.
    **SEVERITY:** major

18. **WHERE:** Context menu still open while the sidebar has changed to the CL04 page.
    **WHAT:** Right-click menu survived a sidebar navigation (also survives tool activation in d11).
    **PROPOSED:** Dismiss on any navigation, tool change, or Esc.
    **SEVERITY:** paper cut

---

## 9. d9 — Scope page in the right sidebar (Parts / Setup / Markups)

Most of this screen is covered under d8. Additional:

1. **WHERE:** Header row "CL04 · Baffle · 3 markups" with a big "Take off" button.
   **WHAT:** Fine — but there is no "Zoom to markups", no "Export", no "Copy quantity", and no cost fields at all (unit rate, waste, labour).
   **WHY:** A bid is quantity x rate. If the app stops at quantity I must retype every line into Excel, and retyping is where errors live.
   **PROPOSED:** At minimum "Copy as table" and "Export CSV/XLSX" on the scope page and the estimate page; ideally optional rate columns.
   **SEVERITY:** blocker (for "what a bid needs")

2. **WHERE:** Breadcrumb "Estimates > CEILING SCOPE > CL04".
   **WHAT:** All-caps user text ("CEILING SCOPE") next to mixed-case system text; the estimate name is not editable from here.
   **PROPOSED:** Render user names as typed but do not shout; make the breadcrumb segments clickable and renamable.
   **SEVERITY:** paper cut

3. **WHERE:** Parts tab underline / toggle colour / Take off button — all blue.
   **WHAT:** Brand red appears nowhere on this panel.
   **SEVERITY:** paper cut (C1)

4. **WHERE:** Markup rows show only "area / cutout" + quantity.
   **WHAT:** No label, no author, no date, no "converted from Bluebeam" vs "drawn here" indicator.
   **PROPOSED:** Kind icon + label + source glyph + quantity; click to zoom.
   **SEVERITY:** major

5. **WHERE:** "3 on 2 sheets" (Markups header) vs "5 lines" (Parts header) vs "Parts 5" / "Markups 3" (tabs).
   **WHAT:** Same count expressed three ways within 400 px.
   **SEVERITY:** paper cut

6. **WHERE:** "Show the layout on the sheet" toggle inside the Parts section.
   **WHAT:** It controls canvas rendering, not parts. Also the only toggle in the app with an "on" colour (blue) — no "Off"/"On" text like Settings has.
   **PROPOSED:** Move next to the Take off button as a view toggle; make toggle styling match Settings.
   **SEVERITY:** paper cut

7. **WHERE:** Per-sheet direction, spacing and stock live on the scope, not per sheet/per area.
   **WHAT:** Baffle direction typically changes room by room; a single scope-wide direction with "set for this sheet" override is coarse.
   **PROPOSED:** Direction per area (edge-pick sets it on that area), inherited from scope default.
   **SEVERITY:** major

---

## 10. d10 — Settings > General

1. **WHERE:** Left nav "General 3 · Drawing 1 · Takeoff 11 · Performance 1".
   **WHAT:** Numbers look like notification badges; they are setting counts. "Takeoff" (one word) vs "Take off" (button, prompt) vs "takeoff" (prompt description).
   **PROPOSED:** Drop the counts; standardise on "Takeoff" as noun, "Take off" as verb, and use them accordingly (C3).
   **SEVERITY:** paper cut

2. **WHERE:** "Reset all · 1 changed" button.
   **WHAT:** Says one setting differs from default but nothing on the page marks which one.
   **PROPOSED:** Dot/"modified" tag on the changed row; "Reset" per row.
   **SEVERITY:** paper cut

3. **WHERE:** "Reopen the last project on launch — On, the app opens straight into the project you had open. Off, it opens on the start screen with that project at the top of the list."  Toggle shows "Off" text left of the switch.
   **WHAT:** Description is a two-state essay. Toggle label style ("Off" text + switch) differs from the sidebar toggle which has no text.
   **PROPOSED:** "Open the last project automatically at launch." One toggle style app-wide.
   **SEVERITY:** paper cut

4. **WHERE:** "Recent projects kept — 40 — … Every project ever opened stays a keystroke away in the prompt (~)."
   **WHAT:** "the prompt (~)" is undefined; tilde as a hotkey is not shown anywhere else. Number field with no min/max.
   **PROPOSED:** "…in the command prompt (Ctrl+K)". Stepper with bounds.
   **SEVERITY:** paper cut

5. **WHERE:** "Recent projects drop off — never".
   **WHAT:** Lowercase dropdown value; "drop off" ambiguous ("forget after…").
   **PROPOSED:** "Remove from Recent after: Never / 30 days / 90 days".
   **SEVERITY:** paper cut

6. **WHERE:** Folder icon repeated on all three rows.
   **WHAT:** Decorative; carries no information.
   **PROPOSED:** Remove or vary.
   **SEVERITY:** paper cut

7. **WHERE:** Drawing tabs remain visible at the top while Settings fills the window.
   **WHAT:** Settings is neither a dialog nor a tab; the back arrow "<" top-left is the only exit. Clicking a drawing tab presumably also exits.
   **PROPOSED:** Make Settings a tab (like VS Code) or a modal. Not a hybrid.
   **SEVERITY:** paper cut

8. **WHERE:** Absent settings.
   **WHAT:** No units (imperial/metric), no number formatting/rounding, no default waste %, no default scope palette, no Bluebeam import mapping (Label → scope), no default scale behaviour, no autosave/backup location.
   **WHY:** These are the settings I change on day one in any takeoff tool.
   **PROPOSED:** Add a "Quantities" group: units, decimals, rounding rule, waste default; and an "Import" group: Bluebeam subject/label mapping.
   **SEVERITY:** major

9. **WHERE:** "About REDBEAM 0.2.1" bottom-left, tiny.
   **WHAT:** Fine — but the version is nowhere on the start screen (1.8).
   **SEVERITY:** paper cut

---

## 11. d11 — Takeoff mode, drawing-tool toolbar

1. **WHERE:** Tool strip: [hand] [arrow] [marquee] | [● CL04 ▾] | [polygon ▲active] [scissors] [ruler] [dimension] [V/funnel] | [⊘] [✕] | [‹ 1/1 ›] | [− 50% ▾ + ⛶] | [scale 1"=3'-9" ▾].
   **WHAT:** Seven unlabelled tool icons, no tooltips visible, no shortcut hints, no tool-option row (snap, ortho, fill opacity, hatch on/off).
   **WHY:** Revu's toolbar shows the name on hover and every tool has a letter. OST has the tool name in the status bar. Here I would learn by trial.
   **PROPOSED:** Labels beneath icons at this width (there is room), shortcut letters, a second-row "options" strip when a tool is active (snap to lines, ortho, fill %).
   **SEVERITY:** major

2. **WHERE:** Missing tools.
   **WHAT:** No Rectangle area (the one I use 70% of the time on ceilings), no Count, no Polylength / Perimeter tool, no Snap toggle, no Undo/Redo buttons.
   **PROPOSED:** Add Rectangle and Count; expose Undo/Redo; snap toggle.
   **SEVERITY:** blocker (Rectangle) / major (rest)

3. **WHERE:** Icons ⊘ and ✕ grouped at the right of the tools.
   **WHAT:** Is ⊘ "exclude/void" or "cancel"? Is ✕ "delete selected" or "exit takeoff"? Two negative icons side by side with no text.
   **PROPOSED:** "Done" button (text) to exit; "Exclude" with label if it is a tool.
   **SEVERITY:** major

4. **WHERE:** Active-tool indicator: 2-px blue underline under polygon (same as under the hand tool in d3).
   **WHAT:** Faint; also blue, again (C1).
   **PROPOSED:** Filled chip in scope colour or brand red; cursor changes with the tool.
   **SEVERITY:** paper cut

5. **WHERE:** Scope chip "● CL04 ▾" in the middle of the tool strip.
   **WHAT:** Good that it is there. But the colour dot is 6 px; while drawing, the scope colour should be unmistakable.
   **PROPOSED:** Colour the whole chip; show the same colour on the in-progress polygon.
   **SEVERITY:** paper cut

6. **WHERE:** Right-click context menu from d8 still open on the canvas while the polygon tool is active.
   **WHAT:** State leakage; the menu and the tool cannot both be valid.
   **PROPOSED:** Close menu on tool change.
   **SEVERITY:** paper cut

7. **WHERE:** Toolbar covers grid bubbles 2–6 and the drawing title strip at the bottom of the sheet.
   **WHAT:** A floating bar over the drawing is a floating bar over something I need to read.
   **PROPOSED:** Dock below the canvas; or auto-hide while panning; or let me drag it to the top.
   **SEVERITY:** paper cut

8. **WHERE:** No live measurement readout while drawing.
   **WHAT:** Nothing on screen shows running area/length as I click points (Revu and OST both do).
   **PROPOSED:** Cursor tag "1,204.3 SF" updating per vertex; segment length while dragging.
   **SEVERITY:** major

9. **WHERE:** Zoom "50% ▾" menu vs scale "1"=3'-9" ▾" menu, same chevron glyph.
   **WHAT:** Two dropdown chips, same style, different semantics; and the scale chip is the *only* place the scale is visible.
   **PROPOSED:** Scale chip gets a warning glyph when calibrated/non-standard (6.1) and a tooltip "Calibrated by A. McElwee, 12 Sep".
   **SEVERITY:** major

---

## Cross-cutting (referenced above)

- **C1 — Blue everywhere, red nowhere.** Primary buttons, toggles, tab underlines, focus rings and active-tool marks are all Fluent blue; the brand red exists only in the logo. Pick red for primary/active, or at least make it the accent for takeoff state.
- **C2 — Locale.** "Colour", "centre" (UK/CA) vs SF/LF imperial, NYC project. Pick US spelling if the market is US, and apply everywhere.
- **C3 — "Take off" / "Takeoff" / "takeoff".** Verb = "Take off", noun = "takeoff". Audit every string.
- **C4 — Number and dimension formats.** `1,386.4` vs `1260.5` vs `4,165.8`; `10' 0"` vs `1'-0"` vs `3'-9"` vs `4"`. One formatter, one feet-inch style (`10'-0"`), one decimal rule (0.1 SF is false precision on a 1/4" scale; 1 SF is fine).
- **C5 — Sheet identity.** The app never extracts sheet number / title / revision; it displays raw filenames, truncates them at the useless end, and in one place falls back to "Page 1 · Page 1". Every list (tree, tabs, pinned, markups, prompt) would be fixed by one parser.
- **C6 — Truncation without tooltips.** Tree, tabs, pinned, breadcrumb, path field, Direction row. Add tooltips universally; widen panels; ellipsise the middle.
- **C7 — Counts without units.** Pinned "4 / 2", settings nav "3 / 1 / 11 / 1", tree "58 / 52". Say what is being counted.
- **C8 — Lifecycle vocabulary.** "Commit", "unverified", "Archive", "Remove from estimate", "Duplicate (the specification, not the takeoff)". Define three states (Draft → Locked → Archived) and use those words only.
- **C9 — Monospace prose.** Descriptions, file names and numbers all in monospace makes the app read as a dev tool. Reserve monospace for aligned numeric columns.
- **C10 — Destructive actions.** "remove data", "Remove from estimate", "Convert all 101…" — none has a confirm cue, a colour, or an undo toast in view.

---

## Top 10 for my persona

1. **Scale trust (6.1).** A-351B shows `1" = 3'-9"` while its sibling shows `1/4" = 1'-0"`, and the CL04 total silently blends both. Show calibrated-vs-declared, warn on non-standard ratios, list scale per sheet. Blocker.
2. **Active scope does not follow context (6.2).** Navigated to a CL04 markup, toolbar still says TROUGHS. I will draw into the wrong scope. Blocker.
3. **Bluebeam metadata is discarded (8.3, 8.4, 5.6).** No Subject/Label/Layer/Author, no Revu quantity to reconcile against, no "convert all with this Label". This is the migration path; without it I stay in Revu. Blocker.
4. **Parts cannot be audited (8.6).** 515 sticks, 514 end caps, 258 joiners with no runs, waste % or rounding shown, and "unverified" stapled to every name. I cannot defend these in a bid review. Blocker.
5. **No export, no rates (9.1, 3.16).** Quantities that cannot leave the app are quantities I retype. CSV/XLSX at estimate and scope level, minimum. Blocker.
6. **Sheet identity and duplicates (3.1, 3.2, C5).** Same sheet number in three folders, names truncated to identical prefixes, "Page 1 · Page 1" for the current sheet. I will measure the superseded copy. Blocker.
7. **Rectangle tool missing; tools unlabelled (11.1, 11.2).** The most-used ceiling tool is absent and the rest are mystery icons. Major.
8. **"Convert all 101 PDF markups" with no filter or preview (7.2).** One click doubles my number with other trades' markups. Major.
9. **Lifecycle words (C8, 4.5, 4.6).** Commit / unverified / Archive / Remove from estimate — I do not know which number is "the bid number". Major.
10. **Totals that disappear, colours that collide, numbers formatted three ways (3.9, 3.10, C4).** Individually paper cuts; together they are why I would not trust the sidebar yet. Major.
