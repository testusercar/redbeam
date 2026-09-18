# REDBEAM 0.2.1 — Owner / GM review of 11 screenshots

Reviewer persona: owner and general manager of Maxxit (specialty ceilings). I fund this tool. My four questions on every screen: Can I trust and audit the number? Can a new estimator be productive on day one? Would I put this in front of a client or an investor? Will the team actually stop using Bluebeam?

Severity scale: **blocker** (I would not let a bid go out or a new hire loose on it), **major** (costs trust, time or credibility), **paper cut** (reads unfinished, inconsistent or unprofessional).

Numbers were cross-checked where the screenshots allow: CL04 hub markups 1260.5 − 6.9 + 132.8 = 1386.4 SF matches the sidebar; 1,386.4 SF at 4" OC ≈ 4,159 LF vs the 4,165.8 LF shown; 514 end caps ≈ 2 × 257 runs, 258 joiners ≈ 1 per run, 515 stock ≈ 2 per run. The arithmetic hangs together. The presentation of it does not.

---

## 1. d1.png — Start screen

1. **WHERE:** Whole window. Card is roughly 850 px wide, centred in a 3840 px black field; no wordmark, no version, no title in the title bar.
   **WHAT:** Looks like a dialog that lost its parent window. First impression is "unfinished prototype".
   **WHY:** This is the first thing a new hire, a client looking over a shoulder, or an investor sees.
   **PROPOSED:** Give the start screen a real layout: wordmark top-left, version and "Signed in as" bottom-left, recents as a wide list with sheet-count and last-edited, a right-hand column for "Open" actions. Set the OS window title to "REDBEAM".
   **SEVERITY:** major

2. **WHERE:** Primary button "Open a drawing set..." (bright blue) vs. red "RB" logo.
   **WHAT:** Brand is red; the only primary action on the screen is sky blue. Blue is also the "Take off" button and the tab underline later.
   **WHY:** Two accent colours make the app look like two products bolted together.
   **PROPOSED:** Adopt one accent. Per the design-system decision, red is brand/nav/focus; primary CTA should either be red or a neutral high-contrast white with red focus ring. Purge the blue.
   **SEVERITY:** major

3. **WHERE:** "Open a drawing set..." vs "Open a project folder..." vs "Open a folder by path instead".
   **WHAT:** Three ways to open something, and no one on my team knows the difference between a drawing set and a project folder. In d2 a fourth appears ("Browse...").
   **WHY:** Day-one confusion. Also invites opening the wrong folder and creating a stray redbeam.db.
   **PROPOSED:** One button: "Open project folder". Secondary: "New project from drawings..." which asks for a name and a folder. Kill the by-path link or hide it under a "..." menu.
   **SEVERITY:** major

4. **WHERE:** "REDBEAM writes one `redbeam.db` beside the drawings and never modifies them."
   **WHAT:** Database-file talk in monospace on the welcome screen.
   **WHY:** Estimators don't care about .db files; investors read it as "engineer wrote this UI".
   **PROPOSED:** "Your drawings are never changed. REDBEAM keeps its takeoff in a small file next to them." or move to a tooltip / About.
   **SEVERITY:** paper cut

5. **WHERE:** Recent row "Bentall Towers 1 & 2" — path `C:\Users\aaron\Maxxit Grou…Ramp\Bentall` wrapping to a second line "Towers 1 & 2".
   **WHAT:** Middle-ellipsis truncation *and* wrapping; the path is unreadable and misaligned with the action links.
   **WHY:** Sloppy.
   **PROPOSED:** One line, ellipsis at start, full path in tooltip. Show the project name big and the parent folder small.
   **SEVERITY:** paper cut

6. **WHERE:** "23h ago" vs "5 Sep".
   **WHAT:** Two date formats in a two-row list.
   **PROPOSED:** One format: relative under 7 days, then "5 Sep 2026". Add "Last opened" header.
   **SEVERITY:** paper cut

7. **WHERE:** "rename  forget  remove data" underlined text links on every row.
   **WHAT:** "forget" is jargon; "remove data" is destructive and sits one click from "forget" with identical styling. No icon, no confirmation visible.
   **WHY:** A new hire will delete a takeoff trying to tidy the list.
   **PROPOSED:** Put these behind a row "..." menu; label "Remove from list" and "Delete takeoff data..." (red, confirmation dialog stating what is deleted and that drawings are untouched).
   **SEVERITY:** major

8. **WHERE:** Recent list contents.
   **WHAT:** The project open in every later screenshot ("MSK Podium 1233 York Ave NYC") is not in Recents.
   **WHY:** Either recents is unreliable or the by-path route bypasses it. Both erode trust.
   **PROPOSED:** Every open, by any route, lands in Recents at the top.
   **SEVERITY:** major (verify)

9. **WHERE:** Project names "Bentall Towers 1 & 2" vs "00045 - Barclays Toronto".
   **WHAT:** Inconsistent naming — one has a job number, one doesn't.
   **WHY:** Our job numbering is how bids get found and audited.
   **PROPOSED:** Project metadata: Job #, name, client, bid due date. Show as columns. Prompt on project creation.
   **SEVERITY:** paper cut (but a data-model gap)

10. **WHERE:** Card title "REDBEAM / Quantity takeoff from construction drawings."
    **WHAT:** No version, no "what's new", no help link, no company name.
    **PROPOSED:** Footer: "v0.2.1 · Maxxit internal · Help".
    **SEVERITY:** paper cut

11. **WHERE:** Title bar.
    **WHAT:** No app icon and no title text; in d3 onward the icon is an orange fruit-like blob, while the card here uses a red "RB" square. Two different app icons.
    **WHY:** Icon is what shows in the taskbar and Alt-Tab; an orange blob next to Bluebeam's polished icon is embarrassing.
    **PROPOSED:** Ship one real icon (RB square, red) everywhere: window, taskbar, start screen.
    **SEVERITY:** major

---

## 2. d2.png — Start screen, "Open a folder by path" expanded

1. **WHERE:** New section "Open a folder by path" with path field, "Browse...", "Open", "Create & open".
   **WHAT:** "Browse..." duplicates "Open a project folder..." directly above. "Open" duplicates the recent-row click. Four routes to the same action on one card.
   **PROPOSED:** Collapse to one flow (see d1 #3). If a path field must exist, it belongs in a power-user "..." menu.
   **SEVERITY:** major

2. **WHERE:** "Open" button (white/light fill).
   **WHAT:** A third button style on one screen: blue primary at top, outlined secondary, now a white primary.
   **PROPOSED:** One primary style, one secondary style.
   **SEVERITY:** paper cut

3. **WHERE:** "Create & open".
   **WHAT:** Creates what? A folder? A project? No name is asked for; project would be named after the folder.
   **WHY:** New hire creates "New folder (2)" as a bid.
   **PROPOSED:** "New project..." dialog: name, job number, location, then creates.
   **SEVERITY:** major

4. **WHERE:** Helper text "A project is a folder. REDBEAM writes one `redbeam.db` inside it and never modifies the drawings."
   **WHAT:** Restates the sentence already visible 250 px above with different wording ("beside" vs "inside", "them" vs "the drawings").
   **PROPOSED:** Say it once.
   **SEVERITY:** paper cut

5. **WHERE:** Path field prefilled with `C:\Users\aaron\Maxxit Group\MAXXiT Systems Team Site - Ramp\Bent...`
   **WHAT:** Silently prefilled with the last recent path, truncated with no way to see the end.
   **PROPOSED:** Empty placeholder "Paste a folder path"; show full path on focus; validate and show a green "Found redbeam.db" / "Will create a new project here" line before Open.
   **SEVERITY:** paper cut

6. **WHERE:** The link "Open a folder by path instead" disappeared; no collapse control.
   **WHAT:** One-way disclosure.
   **PROPOSED:** Toggle or "Hide".
   **SEVERITY:** paper cut

---

## 3. d3.png — Project open, no drawing yet

1. **WHERE:** Main canvas.
   **WHAT:** A completely black 2,800 × 2,000 px void. No empty state.
   **WHY:** Day-one user does not know to click a file on the left. Looks broken.
   **PROPOSED:** Empty state: "Pick a sheet from Files, or press Ctrl+K and type a sheet number." plus the three most recent sheets as thumbnails.
   **SEVERITY:** major

2. **WHERE:** Bottom toolbar: "‹ ›" page nav, "35%" zoom, fullscreen, "Unset ˄" scale.
   **WHAT:** Page/zoom/scale controls shown live with no document. "35%" of nothing. "Unset" is a value without a label.
   **PROPOSED:** Hide or disable the viewer segment when no sheet is open. Scale chip should read "Scale: not set" with a warning icon.
   **SEVERITY:** paper cut

3. **WHERE:** Scope chip "TROUGHS" and "Take off" button, active with no sheet.
   **WHAT:** "Take off" is enabled when there is nothing to draw on.
   **PROPOSED:** Disable until a sheet is open; tooltip says why.
   **SEVERITY:** paper cut

4. **WHERE:** Files tree — every "A-46x - ENLARGED-BASE-ELE..." row, ten in a row, identical after truncation.
   **WHAT:** Raw file names truncated so that the only distinguishing text (the title) is gone.
   **WHY:** Estimator can't find the sheet; picks the wrong one; bid is off a superseded revision.
   **PROPOSED:** Parse sheet number and title (from filename or title block), show as "A-460 · Enlarged Base Elevations" two-line rows, with revision/date badge. Tooltip full name. Make the rail resizable.
   **SEVERITY:** major

5. **WHERE:** Tree nesting "1 Data › Client › 260904 Client Drawings Take Off &... › 01 Scope Overview › 04 Key Arch Details".
   **WHAT:** Five levels of the client's folder junk before the first sheet; "EWS-108 & 108A" contains a folder also named "EWS-108 & 108A".
   **WHY:** Wastes the whole left rail; auditing which file the number came from means expanding folders.
   **PROPOSED:** Default to a flat "Sheets" view (sheet number sorted, folder shown as a muted subtitle), with "Folders" as an alternate view.
   **SEVERITY:** major

6. **WHERE:** Duplicate files: A-460, A-465 appear under "04 Key Arch Details" and under "EWS-108 & 108A"; A-467/468 under "04 Key Arch Details" and "EWS-107 & 107A".
   **WHAT:** Same sheet, multiple copies, no "duplicate" indicator and no indication of which copy carries takeoff markups.
   **WHY:** This is exactly how a bid picks up a stale sheet. Auditability failure.
   **PROPOSED:** Detect duplicate sheet numbers / identical page hashes; badge them; show markup count per file in the tree; warn when the same sheet number has markups on two files.
   **SEVERITY:** blocker

7. **WHERE:** Left rail status "Reading the folder... Collapse all Refresh".
   **WHAT:** A progress message glued to two action links in the same line, same size. In d4 it becomes "90 documents Collapse all Refresh".
   **PROPOSED:** Status on its own line with a spinner; actions as icon buttons in the rail header.
   **SEVERITY:** paper cut

8. **WHERE:** Left rail icon row: "Files" has icon + label, bookmark and grid icons have no label, search icon far right.
   **WHAT:** Inconsistent affordance; nobody knows what the bookmark and grid icons are.
   **PROPOSED:** Label all four (Files, Thumbnails, Contents, Search) or use a segmented control with tooltips.
   **SEVERITY:** paper cut

9. **WHERE:** Right sidebar: "Estimates" header, breadcrumb "Estimates › CEILING SCOPE", then heading "CEILING SCOPE" again.
   **WHAT:** The estimate name appears three times in 60 px of vertical space.
   **PROPOSED:** Header shows "Estimates"; breadcrumb only; drop the repeated H1 or make it the editable title and drop the breadcrumb tail.
   **SEVERITY:** paper cut

10. **WHERE:** "+ Add scope" appears twice (header and after the list).
    **PROPOSED:** One.
    **SEVERITY:** paper cut

11. **WHERE:** Scope rows: CL04 "Baffle · 3 markups", BLUE "Planks · 0 markups", TROUGHS "Planks · 3 markups".
    **WHAT:** No quantity, no unit, no dollars. Markup count is not a quantity. In d4 the same rows show SF, so the quantities exist but aren't shown until something else happens.
    **WHY:** As the owner, the number I care about is missing from the one panel meant for it. A panel that changes what it shows depending on whether a sheet is open is untrustworthy.
    **PROPOSED:** Always show quantity + unit per scope; estimate-level total row at the bottom; optional $ column once pricing exists. Quantities come from the DB, not from the open document.
    **SEVERITY:** blocker

12. **WHERE:** Scope colours: BLUE and TROUGHS both have an identical red dot; CL04 is purple; "BLUE" is a scope named after a colour it isn't.
    **WHAT:** Two scopes with the same colour cannot be told apart on the sheet.
    **PROPOSED:** Enforce distinct colours on scope creation (auto-assign from a palette); warn on duplicates.
    **SEVERITY:** major

13. **WHERE:** Scope list has a darker block background as if all three rows are hovered/selected.
    **WHAT:** Looks like a stuck hover state.
    **PROPOSED:** Rows on the panel background; hover on one row only.
    **SEVERITY:** paper cut

14. **WHERE:** "Pinned 2" with rows "A-351A-FLOOR-01--SECTOR-A-EXTERIOR-REFLECT... 4" and "...B... 2".
    **WHAT:** What is pinned, by whom, and what are 4 and 2? (They turn out to be markups per sheet.) No header, no tooltip.
    **PROPOSED:** Rename "Sheets with takeoff"; columns "Sheet · Markups · Area"; sheet number + title instead of filename.
    **SEVERITY:** paper cut

15. **WHERE:** Estimate "CEILING SCOPE".
    **WHAT:** Generic all-caps name; no indication there could be more than one estimate, no status (draft / issued / rev), no date.
    **PROPOSED:** Estimate header shows name, revision, status, last edited by/when.
    **SEVERITY:** major (auditability)

16. **WHERE:** Tab strip at top: only "+" and an empty grey bar.
    **WHAT:** Empty tab bar with a plus that opens... what?
    **PROPOSED:** Hide the strip until a sheet opens, or make "+" open the sheet picker.
    **SEVERITY:** paper cut

17. **WHERE:** Project chip "MSK Podium 1233 York Ave NYC ˅" in the title bar.
    **WHAT:** Fine idea, but the dropdown glyph is far right at x≈250 detached from the name; and no job number.
    **PROPOSED:** Chip with name + job number; caret adjacent.
    **SEVERITY:** paper cut

---

## 4. d4.png — Command prompt (Ctrl+K), scope hub for CL04

1. **WHERE:** Prompt header: chip "CL04", input placeholder "Choose · CL04", right label "step 1".
   **WHAT:** "step 1" of what? The user didn't start a wizard. Placeholder "Choose · CL04" is not a sentence.
   **PROPOSED:** Placeholder "Search actions for CL04…"; drop "step n" or replace with breadcrumb chips only.
   **SEVERITY:** paper cut

2. **WHERE:** Every row's subtitle is in monospace: "area tool, drawing into CL04", "#8000ff", "5 lines", "freeze the count as it stands".
   **WHAT:** Code font for prose. Hex colour shown to an estimator.
   **WHY:** Reads as a developer console, not a product.
   **PROPOSED:** Proportional font; colour row shows a swatch + name ("Purple").
   **SEVERITY:** paper cut

3. **WHERE:** "needs a choice ›" / "needs a name ›" trailing labels on 7 of 13 rows.
   **WHAT:** Internal state language leaking. The chevron already says "opens a submenu".
   **PROPOSED:** Remove the text; keep chevron. Show the current value instead ("Baffle", "Purple", "3 on 2 sheets").
   **SEVERITY:** paper cut

4. **WHERE:** "Commit — freeze the count as it stands".
   **WHAT:** I do not know what commit means for a bid. Locked? Approved? Sent? Can it be undone? Who did it?
   **WHY:** This is the single most important trust concept in the app and it is one word with a cryptic subtitle.
   **PROPOSED:** Rename to "Lock quantities" with a subtitle "Snapshot 1,386.4 SF · later edits show as a change"; record who/when; expose an "Unlock" with reason.
   **SEVERITY:** blocker

5. **WHERE:** "Direction from an edge..." and "Set direction on the sheet" as two adjacent commands.
   **WHAT:** Two ways to set direction; jargon; no indication of the current direction.
   **PROPOSED:** One "Baffle direction..." row showing current value with sub-options.
   **SEVERITY:** paper cut

6. **WHERE:** "Duplicate — the specification, not the takeoff", "Archive — its 3 markups stay and come back if you restore it".
   **WHAT:** Chatty lowercase copy that varies in voice from row to row. Compare "Take off" vs "Configure..." vs "Open in the sidebar".
   **PROPOSED:** One voice: verb-first title, short factual subtitle.
   **SEVERITY:** paper cut

7. **WHERE:** Footer: "↑↓ choose  ↵ Baffle · 3 markups  ⌫ on empty: back a step  esc cancel".
   **WHAT:** The Enter hint reads "Baffle · 3 markups" — it's the scope subtitle stuffed into a key hint.
   **PROPOSED:** "↵ open".
   **SEVERITY:** paper cut

8. **WHERE:** Bottom toolbar scope chip says "TROUGHS" while the hub is for "CL04".
   **WHAT:** Active drawing scope and hub scope differ with no cue.
   **WHY:** New hire presses "Take off" from the hub and draws into TROUGHS. That is a wrong bid.
   **PROPOSED:** Opening a scope hub sets it active, or the hub's "Take off" row says "into CL04 (switches from TROUGHS)".
   **SEVERITY:** major

9. **WHERE:** Left rail search icon (top right of rail) shows a blue ring.
   **WHAT:** Stray focus ring / stuck state.
   **SEVERITY:** paper cut

10. **WHERE:** Tab title "A-351A-FLOOR-01--SECTOR..." truncated.
    **WHAT:** Same raw-filename problem as the tree; tabs are unreadable once two are open (see d6).
    **PROPOSED:** Tab = sheet number, tooltip = title.
    **SEVERITY:** major

11. **WHERE:** Hub covers the drawing but doesn't highlight what it's about.
    **WHAT:** No on-sheet highlight of CL04's areas while the hub is open.
    **PROPOSED:** Dim non-CL04 markups while the hub is open.
    **SEVERITY:** paper cut

12. **WHERE:** Sidebar scopes now show "1,386.4 SF", "0 SF", "266.1 SF".
    **WHAT:** Appeared only after a sheet opened (see d3 #11). Also right-aligned monospace numbers clash with the proportional labels.
    **SEVERITY:** (counted under d3 #11)

---

## 5. d5.png — Prompt, Markups step of the hub

1. **WHERE:** Rows "area · 1260.5 SF", "cutout · −6.9 SF", "area · 132.8 SF".
   **WHAT:** Markups have no names, no ID, no author, no date. "area" three times.
   **WHY:** If a client disputes the number I need to say "markup #12, drawn by J.S. on 3 Sep on A-351B". I cannot.
   **PROPOSED:** Auto-name "CL04-01, CL04-02…", show author + date on hover, allow a label.
   **SEVERITY:** blocker (auditability)

2. **WHERE:** Subtitles: two rows show "A-351B-FLOOR-01---SECTOR-B-EXTERIOR-REFLECTED-CEILING-PLAN-REV.3 M2-M5 BU..." and the third shows "TE-2".
   **WHAT:** Same field, two different kinds of value; "TE-2" is a Bluebeam subject or label, not a sheet. In d8 the same three markups are grouped as "Page 1 · Page 1" and "A-351A-...BULL.10 6-26-26.pdf · p1". Three surfaces, three vocabularies for where a markup lives.
   **WHY:** I can't audit what I can't locate consistently.
   **PROPOSED:** One canonical sheet identity (number + title + rev) used everywhere; page label only when multi-page.
   **SEVERITY:** blocker

3. **WHERE:** "1260.5 SF" here vs "1,386.4 SF" in the sidebar.
   **WHAT:** Thousands separator inconsistent within one screen.
   **PROPOSED:** One number formatter.
   **SEVERITY:** paper cut

4. **WHERE:** "cutout · −6.9 SF".
   **WHAT:** A new hire won't know a cutout deducts, and 6.9 SF of deduction on a 1,260 SF area looks like a mistake (a column? a sprinkler head?) with nothing to explain it.
   **PROPOSED:** Show cutouts nested under their parent area with "− 6.9 SF (deducted)".
   **SEVERITY:** paper cut

5. **WHERE:** Row trailing "needs a choice ›".
   **WHAT:** Same leak as d4 #3. Should read "Go to it".
   **SEVERITY:** paper cut

6. **WHERE:** Header "Markups … of CL04", footer "↵ of CL04".
   **WHAT:** Fragment text again.
   **SEVERITY:** paper cut

7. **WHERE:** Placeholder "Choose · Markups", label "step 2".
   **SEVERITY:** paper cut (d4 #1)

---

## 6. d6.png — Drawing A-351B open after "Go to it", markup selected

1. **WHERE:** Selected markup on the sheet (blue hatch area, tiny white corner handles).
   **WHAT:** Selection is nearly invisible: 8 px white squares on a magenta/blue Bluebeam drawing. No selection outline, no label, no dimension callout.
   **WHY:** User doesn't know what's selected before they hit Delete or "Convert".
   **PROPOSED:** Thick dashed outline in the scope colour + white halo, a floating tag "CL04-01 · 1,260.5 SF", handles 14 px.
   **SEVERITY:** major

2. **WHERE:** Right sidebar.
   **WHAT:** Selecting a markup changed nothing in the sidebar. Still the estimate list. No properties, no scope, no area, no "which scope is this in".
   **PROPOSED:** Selection drives a properties card at the top of the sidebar (scope, area, perimeter, sheet, author, date, notes).
   **SEVERITY:** major

3. **WHERE:** Scale chip "1" = 3'-9"".
   **WHAT:** A non-standard scale (1:45) on a sheet whose title block says a standard architectural scale (A-351A read 1/4" = 1'-0"). Either the PDF was printed at odd size or a calibration was done to a slightly wrong dimension. Either way, a 1:45 vs 1:48 discrepancy is ~13% on area.
   **WHY:** Every SF on this sheet, and every $ downstream, hangs off this chip and nothing flags it.
   **PROPOSED:** Show scale source ("calibrated by A.M. 12 Sep from 20'-0" grid" vs "from title block"); warn in amber when the ratio isn't a standard architectural scale; show the ratio; link to re-calibrate.
   **SEVERITY:** blocker

4. **WHERE:** Tabs "A-351A-FLOOR-01--SE..." and "A-351B-FLOOR-01---SE...".
   **WHAT:** Two open sheets, indistinguishable except one character.
   **PROPOSED:** d4 #10.
   **SEVERITY:** major

5. **WHERE:** Files tree: row "A-764 - PLAN-DETAILS---EWS..." has a grey highlight while "A-351B" has the red open marker.
   **WHAT:** Two highlighted rows; one is a stale hover/keyboard-focus.
   **PROPOSED:** Distinct, documented states: open (red bar), selected, hover; clear hover when the pointer leaves the rail.
   **SEVERITY:** paper cut

6. **WHERE:** Open row "A-351B..." shows an "open externally" icon at the right.
   **WHAT:** Unlabelled; presumably opens in Explorer/Bluebeam. On the *only* row that is current, which makes it look like a status.
   **PROPOSED:** Move to the row context menu, tooltip "Show in Explorer".
   **SEVERITY:** paper cut

7. **WHERE:** Drawing area.
   **WHAT:** REDBEAM's own markups and the PDF's Bluebeam markups are indistinguishable (both fluorescent). No legend, no layer toggle.
   **WHY:** Client asks "which of these is your scope?" and I can't answer from the screen.
   **PROPOSED:** "PDF markups" visibility toggle (dim / hide) in the toolbar; REDBEAM markups always drawn on top with a consistent style.
   **SEVERITY:** major

8. **WHERE:** Bottom toolbar "TROUGHS" chip.
   **WHAT:** Still TROUGHS after navigating from the CL04 hub to a CL04 markup.
   **SEVERITY:** (d4 #8)

---

## 7. d7.png — Right-click menu on empty sheet

1. **WHERE:** Menu header "The drawing".
   **WHAT:** Placeholder-sounding header.
   **PROPOSED:** "A-351B" or drop the header.
   **SEVERITY:** paper cut

2. **WHERE:** "Convert all 101 PDF markups on this sheet".
   **WHAT:** A bulk action with no target scope named, no preview, no confirmation shown, and 101 markups includes callouts, clouds, and text — most of them are not areas.
   **WHY:** One accidental click stuffs 101 junk objects into TROUGHS and the estimate shows garbage until someone cleans it up. On a bid day.
   **PROPOSED:** "Import PDF measurements..." opens a dialog: filter by type (area/length/count), pick target scope, preview total, then Import.
   **SEVERITY:** blocker

3. **WHERE:** "Trace the region here as an area".
   **WHAT:** Into which scope? (TROUGHS is active, the user is thinking about CL04.)
   **PROPOSED:** "Trace region into TROUGHS" with a submenu to choose another scope.
   **SEVERITY:** major

4. **WHERE:** Menu as a whole — two items.
   **WHAT:** No Fit page, Zoom to selection, Set scale / Calibrate, Rotate, Copy view, Pin sheet, Open in Bluebeam. Bluebeam users expect a rich right-click.
   **PROPOSED:** Add the viewer basics and "Set scale..." at minimum.
   **SEVERITY:** major (adoption)

5. **WHERE:** Menu items have no shortcut hints.
   **SEVERITY:** paper cut

---

## 8. d8.png — Right-click menu on a PDF (Bluebeam) markup

1. **WHERE:** Section "Convert 1 selected PDF markup into: CL04 / BLUE / TROUGHS" and immediately below "1 PDF markup here: Convert polygon "Area Measurement" to an area".
   **WHAT:** Two "convert" commands for the same object in one menu; the second doesn't say which scope; "Area Measurement" is Bluebeam's default subject and tells the user nothing.
   **PROPOSED:** One block: "Convert to REDBEAM area ▸ CL04 / BLUE / TROUGHS / New scope…". Show the PDF markup's own label and measured value ("Area Measurement · 1,262 SF per Bluebeam") so the user can sanity-check the conversion.
   **SEVERITY:** major

2. **WHERE:** Scope colour dots: BLUE and TROUGHS both red.
   **SEVERITY:** (d3 #12)

3. **WHERE:** "Convert all 101 PDF markups on this sheet" again.
   **SEVERITY:** (d7 #2) blocker

4. **WHERE:** Missing items: no "Hide PDF markup", "Delete", "Properties", "Zoom to".
   **SEVERITY:** paper cut

5. **WHERE:** Right sidebar (scope page — reviewed in full under d9).

---

## 9. d9.png — Scope page in the right sidebar (Parts / Setup / Markups, one column)

(Note: the "1 PDF markup here" context menu is still open in this screenshot and in d11 — see d11 #1.)

1. **WHERE:** Parts table: every row reads "Installed length **unverified**", "Baffle stock **unverified**", "Connectors **unverified**", "End caps **unverified**", "Joiners **unverified**" in yellow.
   **WHAT:** Every quantity in my bid is flagged unverified, with no explanation of what verification is, who does it, or how.
   **WHY:** If it's a real state, my estimate has five open warnings and no path to green. If it's a placeholder, it's shipping in 0.2.1 in front of my team. Either way the word "unverified" next to a number is what an auditor writes down.
   **PROPOSED:** Define it: e.g. "Rule: baffle_v2 · not yet checked against a shop drawing". Show the rule/formula on hover ("4,165.8 LF = 1,386.4 SF ÷ 4" OC"). Provide a "Mark verified" with name/date, or remove the word until the workflow exists.
   **SEVERITY:** blocker

2. **WHERE:** Header "1,386.4 SF Area · 240.2 LF Perimeter · ⓘ Not committed. · Commit".
   **WHAT:** "Not committed." as a sentence with a period, next to a bare "Commit" link. No $ anywhere on the scope page.
   **PROPOSED:** Status pill "Draft" → "Locked 12 Sep · A.M."; button "Lock quantities". Add a cost line once the price book exists ("$ — no price set").
   **SEVERITY:** blocker (same concept as d4 #4)

3. **WHERE:** Tabs "Parts 5 / Setup / Markups 3" *and* collapsible section headers "Parts", "Setup", "Markups" beneath them.
   **WHAT:** Two navigation systems for the same three sections in one column. The tab underline says "Parts" while Setup and Markups are visibly open below.
   **PROPOSED:** Pick one: tabs (one section at a time) or accordions with a sticky mini-nav. Not both.
   **SEVERITY:** major

4. **WHERE:** "Take off" button in the scope header AND in the bottom toolbar.
   **WHAT:** Duplicate primary action.
   **PROPOSED:** Keep the toolbar one; the sidebar shows state ("Drawing into CL04 · Esc to stop").
   **SEVERITY:** paper cut

5. **WHERE:** Parts table columns "Part · Qty · Unit".
   **WHAT:** No per-part formula, no waste %, no unit cost, no extended cost, no product code. 515 pieces of 10' stock for 4,165.8 LF implies ~19% waste (or none — I can't tell if stock is already rounded up per run).
   **PROPOSED:** Columns: Part · Code · Qty · Unit · Waste · Unit $ · Ext $; row expand shows the calculation.
   **SEVERITY:** major

6. **WHERE:** Setup field "Profile W · face width" shows "—" (empty).
   **WHAT:** A required product dimension is blank yet parts are computed without warning.
   **PROPOSED:** Required fields marked; blank required → parts show "needs face width" instead of a number.
   **SEVERITY:** major

7. **WHERE:** Field labels "Spacing OC · centre to centre", "Stock · length you buy", "Conn. Max · hanger limit", "Profile W · face width".
   **WHAT:** Abbreviation + explanation glued with a middle dot; inconsistent capitalisation ("Conn. Max"); "length you buy" is chatty.
   **PROPOSED:** Plain labels: "Spacing (o.c.)", "Stock length", "Max hanger spacing", "Face width"; explanation in tooltip.
   **SEVERITY:** paper cut

8. **WHERE:** "Direction   set for this sheet · defaul...   [Set on the sheet]".
   **WHAT:** Value truncated ("defaul..."); the button label wraps to two lines inside a small button (text overflow).
   **PROPOSED:** Full-width row; value "Set on this sheet (default: along grid)"; button "Change".
   **SEVERITY:** paper cut

9. **WHERE:** "Yield · full", "Seams · aligned" dropdowns.
   **WHAT:** Options with no explanation; "full" yield of what?
   **PROPOSED:** "Yield: full length / cut to fit"; tooltip; or hide under Advanced.
   **SEVERITY:** paper cut

10. **WHERE:** "Name  CL04  [purple swatch]" placed under Setup, after all the engineering fields.
    **WHAT:** Identity fields at the bottom of the config section.
    **PROPOSED:** Name + colour belong in the header (click to edit).
    **SEVERITY:** paper cut

11. **WHERE:** Markups grouped by sheet: "Page 1 · Page 1" (2) and "A-351A-FLOOR-01--SECTOR-A-EXTERIOR-REFLECTED-CEILING-PLAN BULL.10 6-26-26.pdf · p1" (1).
    **WHAT:** The current sheet is labelled "Page 1 · Page 1" (no sheet name at all); the other sheet is a full filename with ".pdf". Same list, two formats, neither is a sheet number.
    **WHY:** Auditability. This is the list I'd print for a client.
    **PROPOSED:** "A-351B · Sector B RCP (this sheet)" / "A-351A · Sector A RCP".
    **SEVERITY:** blocker

12. **WHERE:** Markup rows "area 1260.5 SF / cutout −6.9 SF / area 132.8 SF".
    **WHAT:** Same as d5 #1; no names; also "1260.5" vs "1,386.4" formatting in the same panel.
    **SEVERITY:** (d5 #1, #3)

13. **WHERE:** "Group by  [sheet | kind]".
    **WHAT:** Lowercase segmented control; "kind" is vague.
    **PROPOSED:** "Sheet | Type".
    **SEVERITY:** paper cut

14. **WHERE:** Footer "Duplicate" / "Remove from estimate".
    **WHAT:** Destructive action permanently visible at the bottom, styled like Duplicate. The hub calls the same idea "Archive"; here it's "Remove from estimate". Which is it?
    **PROPOSED:** One term ("Archive scope"), behind "..." in the header, with confirmation naming the markup count.
    **SEVERITY:** major

15. **WHERE:** Numbers set in a monospace font ("1,386.4", "4,165.8") next to proportional labels.
    **WHAT:** Terminal look; also inconsistent with the proportional "515".
    **PROPOSED:** Tabular-figures of the UI font.
    **SEVERITY:** paper cut

16. **WHERE:** "Show the layout on the sheet" toggle inside the Parts section.
    **WHAT:** A viewer option living in a quantity table.
    **PROPOSED:** Move to the toolbar as a layer toggle.
    **SEVERITY:** paper cut

17. **WHERE:** Whole scope page.
    **WHAT:** No history: who created, who last edited, when, what changed since lock.
    **PROPOSED:** "History" section or a footer line "Edited 12 Sep by A.M."
    **SEVERITY:** major

---

## 10. d10.png — Settings › General

1. **WHERE:** Whole window.
   **WHAT:** Settings replaces the entire workspace while the tab strip still shows "A-351B-FLOOR-01---SE..." as the active tab. The active tab says drawing; the content says Settings.
   **PROPOSED:** Settings as its own tab, or a modal/pane over the workspace.
   **SEVERITY:** major

2. **WHERE:** "Reset all · 1 changed".
   **WHAT:** Which one changed? No per-setting marker.
   **PROPOSED:** Dot or "modified" tag on the changed row; per-row reset.
   **SEVERITY:** paper cut

3. **WHERE:** "How many projects the start screen and the project menu list. Every project ever opened stays a keystroke away in the prompt (~)."
   **WHAT:** First sentence has no verb. "(~)" is a shortcut nobody knows. "the prompt" is internal vocabulary.
   **PROPOSED:** "How many projects appear in Recent. Older projects can still be found with Ctrl+K."
   **SEVERITY:** paper cut

4. **WHERE:** "Recent projects drop off — never — A project not opened for this long leaves the lists. It is not forgotten: the prompt still finds it."
   **WHAT:** Same voice problem; "It is not forgotten" echoes the "forget" link on the start screen — the concepts collide.
   **SEVERITY:** paper cut

5. **WHERE:** Sidebar counts "General 3, Drawing 1, Takeoff 11, Performance 1".
   **WHAT:** Look like notification badges.
   **PROPOSED:** Drop the counts.
   **SEVERITY:** paper cut

6. **WHERE:** Every setting row has the same folder icon.
   **WHAT:** Decorative noise.
   **PROPOSED:** Remove icons or make them meaningful.
   **SEVERITY:** paper cut

7. **WHERE:** Categories available.
   **WHAT:** Nothing about units (imperial/metric), company/product library, default pricing, export formats, or who the user is. "Performance" is a developer category.
   **WHY:** As the owner I expect to set company-wide defaults once, not per estimator.
   **PROPOSED:** Add "Company" (name, logo for exports, default product library), "Units & formatting", "Export". Hide Performance under Advanced.
   **SEVERITY:** major

8. **WHERE:** "About REDBEAM  0.2.1" bottom-left.
   **WHAT:** Fine, but the version isn't anywhere else and the start screen has none.
   **SEVERITY:** paper cut

9. **WHERE:** Content column is ~700 px on a 3840 px window; the rest is empty.
   **WHAT:** Acceptable, but the huge void again reads unfinished at 4K.
   **PROPOSED:** Max-width with a centred layout, or a two-column layout.
   **SEVERITY:** paper cut

---

## 11. d11.png — Takeoff mode toolbar

1. **WHERE:** Context menu "1 PDF markup here…" still open over the drawing while in takeoff mode.
   **WHAT:** Entering takeoff mode (and, in d9, changing the sidebar) did not dismiss the context menu.
   **WHY:** A stale menu over a drawing tool is a mis-click waiting to happen.
   **PROPOSED:** Any mode change, tool change, or sidebar navigation dismisses open menus.
   **SEVERITY:** major (bug)

2. **WHERE:** Tool icons: polygon (active), scissors, ruler, a "count/tally" glyph, a cone/funnel glyph, a circle-slash, an X.
   **WHAT:** Seven unlabelled icons, several ambiguous (is the ruler "measure" or "set scale"? is the funnel "direction"? circle-slash was used as "Set on the sheet" in the sidebar and is also the universal "not allowed" symbol). X is "cancel"? "done"? "delete"?
   **WHY:** Day-one learnability; Bluebeam users expect labels or at least an on-hover legend.
   **PROPOSED:** Labels under icons in takeoff mode (Area, Cutout, Length, Count, Direction, Done) and keyboard letters. Replace circle-slash. Make the exit an explicit "Done" button.
   **SEVERITY:** major

3. **WHERE:** Toolbar layout shift between d9 and d11.
   **WHAT:** When tools appear, the page-nav and zoom pills slide right by ~60 px; the scope pill loses the "Take off" button.
   **PROPOSED:** Reserve the tool area so nothing else moves.
   **SEVERITY:** paper cut

4. **WHERE:** Mode indication.
   **WHAT:** Nothing says "Drawing area into CL04" except a tiny blue underline under the polygon icon. No cursor hint, no banner, no Esc hint.
   **PROPOSED:** Slim banner or chip: "Area → CL04 · click to add points, Enter to close, Esc to stop".
   **SEVERITY:** major

5. **WHERE:** Scale chip "1" = 3'-9"" still shown without warning while drawing.
   **SEVERITY:** (d6 #3) blocker

6. **WHERE:** No undo/redo, no snap toggle, no ortho toggle visible.
   **WHAT:** Bluebeam users will look for them.
   **PROPOSED:** Add undo/redo to the toolbar; snap/ortho as toggles.
   **SEVERITY:** major (adoption)

7. **WHERE:** Right sidebar during takeoff.
   **WHAT:** Unchanged from browse mode; no live "current area: … SF" readout.
   **PROPOSED:** Live readout of the shape being drawn in the scope header.
   **SEVERITY:** paper cut

---

## Cross-cutting

- **Vocabulary drift:** Commit / Lock; Archive / Remove from estimate / forget / remove data; drawing set / project folder / folder by path; the prompt / Ctrl+K; kind / type. Write a glossary and enforce it.
- **Sheet identity:** filename, filename+.pdf+p1, "Page 1 · Page 1", "TE-2", tab title, tree row — six representations. This is the root of most auditability findings.
- **Two accent colours** (blue actions vs red brand) and **two app icons**.
- **Monospace everywhere** for numbers, paths and subtitles gives the app a console feel.
- **No dollars anywhere.** For the owner, quantity without price is half a bid. Even a "no price set" column would signal where this is going.
- **No people.** No author, no timestamps, no history on anything. Nothing in these 11 screens tells me who did what.

---

## Top 10 for my persona

1. **"unverified" on every part line with no way to verify (d9 #1).** Blocker. Either define and implement verification or remove the word.
2. **Commit/lock is a one-word mystery (d4 #4, d9 #2).** Blocker. Rename to Lock quantities, record who/when, show diff since lock.
3. **Sheet identity is different on every surface (d5 #2, d9 #11, tree, tabs).** Blocker. One canonical "A-351B · Sector B RCP · Rev 3" everywhere.
4. **Non-standard scale 1" = 3'-9" shown without warning (d6 #3).** Blocker. Show scale source, flag non-standard ratios, one click to re-calibrate.
5. **"Convert all 101 PDF markups" with no target, filter or preview (d7 #2).** Blocker. Make it an import dialog.
6. **Duplicate sheets in the tree with no indicator of which copy holds the takeoff (d3 #6).** Blocker.
7. **Scope quantities missing until a sheet is open; no estimate total; no $ (d3 #11, d9 #5).** Blocker.
8. **Active scope ≠ hub scope, and takeoff mode has no clear "drawing into X" banner (d4 #8, d11 #4).** Major. Wrong-scope takeoffs are the most common estimator error.
9. **Markups have no names, authors or dates; no history anywhere (d5 #1, d9 #17).** Major. This is what "auditable" means.
10. **Look and feel: two accent colours, orange blob app icon, monospace prose, dev copy ("redbeam.db", "the prompt (~)", "needs a choice", "step 1") (d1 #2/#11, d4 #2/#3, d10 #3).** Major for the investor/client test; cheap to fix and it changes how the whole product reads.

Honourable mentions that decide Bluebeam adoption: unlabelled takeoff tools and no undo/snap in the toolbar (d11 #2, #6), a two-item right-click menu (d7 #4), and a Files tree that shows the client's folder junk instead of a sheet index (d3 #4, #5).
