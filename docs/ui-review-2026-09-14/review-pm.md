# REDBEAM 0.2.1 — review from the PM / sales-engineer seat

Reviewer persona: I do not do the takeoff. I read the estimate, defend the numbers to the client and the architect, and I need to say, for every quantity, *which sheet, which revision, who measured it, when, and whether it is frozen or still moving*. I open REDBEAM maybe twice a week to check a number or find a markup.

Screenshots reviewed one at a time (d1–d11, 3840x2088). Project shown: "MSK Podium 1233 York Ave NYC", round "CEILING SCOPE", scopes CL04 / BLUE / TROUGHS, sheets A-351A and A-351B.

Severity scale: **blocker** = I cannot defend a number or find its source; **major** = I can, but only by leaving the app or asking the estimator; **paper cut** = friction.

---

## d1 — Start screen

1. **WHERE:** Recent list rows: "Bentall Towers 1 & 2 · 23h ago", "00045 - Barclays Toronto · 5 Sep".
   **WHAT:** The timestamp is "last opened", not "last changed" and not "last committed". Nothing tells me whether anyone actually touched the estimate.
   **WHY:** When a client asks "is the number you sent Tuesday still the number?", the first thing I want on the launch screen is *when the estimate last moved*, not when someone last looked at it.
   **PROPOSED CHANGE:** Show two stamps per project: "opened 23h ago · last commit 5 Sep (CEILING SCOPE, 3 scopes)". If nothing was ever committed, say "no commits yet" in the warning colour.
   **SEVERITY:** major

2. **WHERE:** Row actions "rename · forget · remove data".
   **WHAT:** "remove data" sits one click away from "forget" with no hint about what data it removes (the redbeam.db with every markup and commit in it?) and no indication whether it is reversible.
   **WHY:** I am the person most likely to click the wrong link on a project that is not mine. If it deletes the estimate database the whole traceability chain for a bid is gone.
   **PROPOSED CHANGE:** Rename to "delete redbeam.db…", put it behind a confirm that names the file path and the number of scopes/markups inside, and separate it visually from "forget" (which should say "remove from list").
   **SEVERITY:** major

3. **WHERE:** Header copy "Quantity takeoff from construction drawings." and note "REDBEAM writes one redbeam.db beside the drawings and never modifies them."
   **WHAT:** No version string on the start screen (it is only in Settings > About, 0.2.1). No project number / client / round visible per recent project.
   **WHY:** When I report a discrepancy to the estimator I need "which build were you on"; when I scan the list I want the job number (00045) to be a first-class field rather than something that happens to be in one folder name and not the other ("Bentall Towers 1 & 2" has none).
   **PROPOSED CHANGE:** Small "v0.2.1" in the card footer. Add an optional "Job #" attribute per project shown as a mono prefix on the row.
   **SEVERITY:** paper cut

4. **WHERE:** Path text truncated with an ellipsis in the middle: "C:\Users\aaron\Maxxit Grou…Ramp\Bentall Towers 1 & 2".
   **WHAT:** Cannot tell which SharePoint/OneDrive library the project lives in.
   **WHY:** Our drawing sets live in several synced libraries; two projects with the same folder name in different libraries are a real hazard for "which revision did you measure".
   **PROPOSED CHANGE:** Tooltip / hover with the full path, and truncate from the start rather than the middle so the distinctive tail survives.
   **SEVERITY:** paper cut

---

## d2 — Start screen, "Open a folder by path" expanded

1. **WHERE:** Buttons "Open" and "Create & open".
   **WHAT:** No explanation of the difference before I click. "Create & open" on a folder that already has drawings but no redbeam.db is presumably fine; on a folder that already has a redbeam.db it is ambiguous (does it overwrite?).
   **WHY:** As a non-estimator I must never be the person who silently starts a second, empty estimate next to the real one.
   **PROPOSED CHANGE:** Disable whichever button does not apply once the path resolves: if redbeam.db exists show only "Open"; if it does not, show only "Create & open" with the sentence "No estimate here yet — REDBEAM will create redbeam.db in this folder."
   **SEVERITY:** major

2. **WHERE:** Sentence "A project is a folder. REDBEAM writes one redbeam.db inside it and never modifies the drawings."
   **WHAT:** True but it does not say what happens when the drawings inside that folder change (new revision dropped in, old one replaced with the same filename).
   **WHY:** This is the most common way our numbers go stale. I need to know whether REDBEAM notices.
   **PROPOSED CHANGE:** Second sentence: "If a drawing is replaced or added later, REDBEAM flags markups on the old file as 'source changed'." (and then actually do that — see d8 #3).
   **SEVERITY:** major

3. **WHERE:** Path field pre-filled with a truncated SharePoint path "…Ramp\Bent…".
   **WHAT:** Same truncation issue as d1 #4, but here I am about to act on it.
   **PROPOSED CHANGE:** Let the field scroll / show full path on focus.
   **SEVERITY:** paper cut

---

## d3 — Project open, no drawing yet

1. **WHERE:** Right sidebar header "Estimates › CEILING SCOPE".
   **WHAT:** Nothing on this round tells me its status, date, revision basis or who owns it. No "committed 3 Sep by K.", no "based on Bulletin 10", no total.
   **WHY:** "CEILING SCOPE" is what I send to the client. I need to open the app and in five seconds see: is it frozen, when, against which drawing issue.
   **PROPOSED CHANGE:** Under the round title add a status line: "3 scopes · 2 committed, 1 moving · last commit 3 Sep 14:10 · drawings: Bull.10 (6-26-26)". Make "1 moving" a link that lists the uncommitted scopes.
   **SEVERITY:** blocker

2. **WHERE:** Scope rows "CL04 Baffle · 3 markups", "BLUE Planks · 0 markups", "TROUGHS Planks · 3 markups".
   **WHAT:** No quantities on the rows until a drawing is open (d4 onward shows 1,386.4 SF etc.). With no drawing open the round page shows counts of markups but no SF. Also no committed/uncommitted indicator per row.
   **WHY:** The number is the thing. Markup counts are an estimator's metric, not mine.
   **PROPOSED CHANGE:** Always show the quantity on the row, and a small state chip: "committed 3 Sep" (green) / "not committed" (amber) / "changed since commit +12.4 SF" (red).
   **SEVERITY:** major

3. **WHERE:** Scope names "BLUE" and "TROUGHS".
   **WHAT:** Not scope codes. CL04 matches the architect's tag family; "BLUE" is a colour and "TROUGHS" is a shape. Meanwhile the Files tree folder is named "CLG-04,05, Soffit" — so the architect's tag is CLG-04 and our scope is CL04.
   **WHY:** In a meeting with the architect I have to say "our CL04 is your CLG-04" every time. And "BLUE" means nothing to anyone but the person who drew it.
   **PROPOSED CHANGE:** Two fields per scope: **Code** (required, validated, e.g. CLG-04) and **Label** (free, e.g. "Baffle, blue zone"). Show the code first everywhere. Warn on creation if the code does not match the pattern of the others in the round.
   **SEVERITY:** major

4. **WHERE:** "Pinned" list: "A-351A-FLOOR-01--SECTOR-A-EXTERIOR-REFLECT… 4" and "A-351B-FLOOR-01---SECTOR-B-EXTERIOR-REFLEC… 2".
   **WHAT:** The trailing numbers (4, 2) are unlabelled. Markups? Scopes touching this sheet? Also the sheet's revision is in the filename tail that is truncated away ("…BULL.10 6-26-26.pdf" per d8).
   **WHY:** The revision is the single most important thing about a pinned sheet for me.
   **PROPOSED CHANGE:** Show sheet number bold ("A-351B") + issue tag pulled from filename or title block ("Bull.10 · 6-26-26") + tooltip "4 markups in 2 scopes".
   **SEVERITY:** major

5. **WHERE:** Files tree — "1 Data › Client › 260904 Client Drawings Take Off &… › 01 Scope Overview › 04 Key Arch Details …" with 90 documents.
   **WHAT:** Same sheet numbers appear in several folders (A-460, A-465, A-467, A-468 appear at least twice; "A-351A" appears under "CLG-04,05, Soffit" *and* is the pinned sheet). The tree does not indicate which copy is the one the takeoff used, nor whether the duplicates are identical files or different revisions.
   **WHY:** Duplicate sheet numbers across folders is exactly how a measurement ends up on a superseded print.
   **PROPOSED CHANGE:** Badge files that carry markups ("● 3") and warn on duplicate sheet numbers within the project ("A-460 appears 3× — different sizes/dates?"). Offer "show only sheets with markups".
   **SEVERITY:** major

6. **WHERE:** Bottom toolbar, scale pill reads "Unset".
   **WHAT:** With no drawing open the pill still shows a scale slot. Fine, but combined with d6/d11 (see there) there is no place that lists per-sheet scale status for the whole set.
   **PROPOSED CHANGE:** A "Sheets" tab in the right sidebar listing every sheet with markups, its scale, and who set it.
   **SEVERITY:** paper cut

7. **WHERE:** Footer "Reading the folder… Collapse all Refresh".
   **WHAT:** No count of what was found vs what changed since last open (new files, missing files).
   **PROPOSED CHANGE:** After indexing: "90 documents · 2 new since 5 Sep · 1 missing (A-787 …)". Missing files that carry markups should be loud.
   **SEVERITY:** major

---

## d4 — Ctrl+K hub for CL04

1. **WHERE:** Hub header "CL04 — Baffle · 3 markups", right sidebar now shows "CL04 1,386.4 SF", "BLUE 0 SF", "TROUGHS 266.1 SF".
   **WHAT:** The hub itself does not show the quantity, commit state, or sheets. I have to look sideways at the sidebar.
   **WHY:** The prompt is where I would go to *look up* a number quickly; it should answer before I pick an action.
   **PROPOSED CHANGE:** Header line: "CL04 · Baffle · 1,386.4 SF · 3 markups on A-351A, A-351B · not committed".
   **SEVERITY:** major

2. **WHERE:** Action "Commit — freeze the count as it stands".
   **WHAT:** No mention of what a commit records (value, date, user, drawing revisions) or whether previous commits are kept. There is no "History" / "Compare to last commit" action in the list.
   **WHY:** Defending a number is comparing it to the last one I sent. If the app freezes a count but I cannot see the frozen value next to the live one, the freeze does not help me.
   **PROPOSED CHANGE:** Add "History… — 2 commits, last 3 Sep 1,374.0 SF" as a hub action, and make Commit ask for a one-line note ("Bull.10 re-measure").
   **SEVERITY:** blocker

3. **WHERE:** Actions "Archive — its 3 markups stay and come back if you restore it" and "Duplicate — the specification, not the takeoff".
   **WHAT:** Good copy. But "Rename…" is not qualified: renaming a scope after a commit silently breaks the name I already sent to the client.
   **PROPOSED CHANGE:** Rename sub-copy: "the code changes on every commit and export; previous name is kept in history".
   **SEVERITY:** paper cut

4. **WHERE:** "Parts and quantities… — 5 lines" / "Markups… — 3 on 2 sheets".
   **WHAT:** "3 on 2 sheets" is the first place the sheet count is surfaced. Good — but which sheets is one step deeper.
   **PROPOSED CHANGE:** "3 on A-351A, A-351B".
   **SEVERITY:** paper cut

5. **WHERE:** "Set product… Baffle" / "Configure… product, each measure, yield, seams".
   **WHAT:** Configuration is per scope; there is no indication if a change here re-computes an already committed count (it must, because the parts derive from it) — see d8 #6.
   **SEVERITY:** major (covered in d8)

---

## d5 — Hub, Markups step

1. **WHERE:** Row 1 "area · 1260.5 SF — A-351B-FLOOR-01---SECTOR-B-EXTERIOR-REFLECTED-CEILING-PLAN-REV.3 M2-M5 BU…"; Row 3 "area · 132.8 SF — TE-2".
   **WHAT:** Row 3's source is shown as "TE-2", which is the *label of the PDF markup* (or a wall tag near it), not the sheet. I cannot tell from this list that the 132.8 SF is on A-351A (d8 reveals it).
   **WHY:** A markup without a sheet is an undefendable number.
   **PROPOSED CHANGE:** Fixed columns: kind · qty · **sheet number** · issue tag · label. Never let the label stand in for the sheet.
   **SEVERITY:** blocker

2. **WHERE:** Rows 1–2 source text "…REV.3 M2-M5 BU…" vs d8's sidebar for the other sheet "…BULL.10 6-26-26.pdf".
   **WHAT:** The revision is only whatever the filename happened to contain, truncated at the end where it matters. One sheet's markups are on a "REV.3" file, another's on "BULL.10". Are those the same issue? I cannot tell.
   **WHY:** The architect will ask "which bulletin did you price?". I need a single answer per scope, or an explicit list.
   **PROPOSED CHANGE:** Parse (or let the user set) an **Issue** field per document: "Bull.10 · 2026-06-26". Show it as a chip on every markup row. If a scope's markups span two different issues, flag it in the scope header ("markups on 2 issues").
   **SEVERITY:** blocker

3. **WHERE:** Row 2 "cutout · −6.9 SF".
   **WHAT:** No indication of which area the cutout belongs to (it subtracts from the 1260.5? from the scope total?).
   **PROPOSED CHANGE:** Indent cutouts under their parent area, or show "in area #1".
   **SEVERITY:** paper cut

4. **WHERE:** All rows "needs a choice ›".
   **WHAT:** As a reader I do not know what the choice is (go to it? delete?). The row itself should be enough to *see* the number; the chevron should say "go to".
   **PROPOSED CHANGE:** Replace "needs a choice" with the primary action name ("Go to it ›") and keep secondary actions on the next step.
   **SEVERITY:** paper cut

5. **WHERE:** Missing columns.
   **WHAT:** No "who / when" per markup. No "committed" state per markup.
   **WHY:** When a number moves between Tuesday and Friday I need to find the markup that moved and ask the person who moved it.
   **PROPOSED CHANGE:** Add "edited 3 Sep · A.M." and a lock glyph for markups included in the last commit.
   **SEVERITY:** major

---

## d6 — A-351B open after "Go to it", markup selected

1. **WHERE:** Drawing canvas: the blue area is selected (white corner handles) but nothing else changes — no callout, no label, no readout; right sidebar stays on the round page; toolbar scope pill still says "TROUGHS".
   **WHAT:** Selecting a markup does not tell me its scope, its area, its sheet, or its state. Worse, the active scope pill says TROUGHS while the selected markup is CL04 (purple).
   **WHY:** I came here from the hub to "see the 1260.5 SF". I landed on it and nothing on screen says "1260.5 SF · CL04".
   **PROPOSED CHANGE:** On select: floating label at the markup ("CL04 · area · 1,260.5 SF · A-351B") and the sidebar jumps to the scope page with that markup highlighted. The toolbar pill should either follow the selection or not pretend to be "current".
   **SEVERITY:** blocker

2. **WHERE:** Bottom toolbar scale pill "1" = 3'-9"" while the title block (bottom right) says Scale 1/4" = 1'-0".
   **WHAT:** The applied scale differs from the printed scale by about 6 % (1:45 vs 1:48). Maybe the PDF was plotted off-scale and someone calibrated from a dimension string — but nothing says so. There is no "calibrated by … from dimension … on …".
   **WHY:** A 6 % scale difference is a 12 % area difference. If the architect checks 1,260.5 SF against the title-block scale they will get ~1,120 SF and I will not be able to explain it.
   **PROPOSED CHANGE:** Scale pill shows origin: "1"=3'-9" · calibrated 2 Sep by A.M. from 27'-4" dim" and a warning glyph whenever it disagrees with the title-block scale by more than 1 %. Clicking it shows the calibration line on the sheet.
   **SEVERITY:** blocker

3. **WHERE:** Tab strip: "A-351A-FLOOR-01--SE…", "A-351B-FLOOR-01---SE…".
   **WHAT:** Tabs truncate away the sector and the revision; both tabs look identical apart from one letter.
   **PROPOSED CHANGE:** Tab title = sheet number + short title ("A-351B · RCP Sector B") with issue in tooltip.
   **SEVERITY:** paper cut

4. **WHERE:** Left tree: the *highlighted* row is "A-764 - PLAN-DETAILS---EWS…" (light grey) while the *open* file is "A-351B-FLOOR-01---SECTOR-…" (bracketed, with a small link icon).
   **WHAT:** Two different highlight states, neither labelled. I could not say which one means "this is what you are looking at".
   **PROPOSED CHANGE:** One clear "open" indicator (accent bar) and the hover/focus style should not persist.
   **SEVERITY:** paper cut

5. **WHERE:** Sidebar, whole page.
   **WHAT:** Sidebar still shows the round; "Go to it" did not carry context into the sidebar, so the scope quantity breakdown is a click away.
   **PROPOSED CHANGE:** Covered by #1.
   **SEVERITY:** major

---

## d7 — Right-click on empty sheet

1. **WHERE:** Menu "The drawing › Convert all 101 PDF markups on this sheet / Trace the region here as an area".
   **WHAT:** "Convert all 101 PDF markups" is one click, unqualified: into which scope? does it include text boxes, clouds, callouts? are the Bluebeam measurements' own scale honoured or re-measured under REDBEAM's 1"=3'-9"?
   **WHY:** This is the button that turns someone else's Bluebeam work into our estimate. The provenance question — "was this measured by us or imported from the architect's/GC's markups?" — is the first one a client asks when numbers disagree.
   **PROPOSED CHANGE:** Make it a dialog: count by kind (polygons 12, polylines 4, text 85 — text will be skipped), target scope, and a checkbox "keep original author/subject as the markup note". Every converted markup should carry "imported from PDF markup by <Bluebeam author> on <date>" permanently.
   **SEVERITY:** blocker

2. **WHERE:** "Trace the region here as an area".
   **WHAT:** No target scope shown; presumably goes into the toolbar's current scope (TROUGHS here). Silent mis-scoping.
   **PROPOSED CHANGE:** "Trace the region here as an area → TROUGHS" with the scope name in the item.
   **SEVERITY:** major

3. **WHERE:** Menu in general.
   **WHAT:** No read-only items useful to me: "Sheet info (number, title, issue, scale, calibration)", "Markups on this sheet (by scope)", "Copy sheet reference".
   **PROPOSED CHANGE:** Add a "This sheet" section with those three.
   **SEVERITY:** major

---

## d8 — Right-click on a Bluebeam markup; scope page opens

1. **WHERE:** Menu "Convert 1 selected PDF markup into › CL04 / BLUE / TROUGHS" and "Convert polygon "Area Measurement" to an area".
   **WHAT:** The PDF markup is identified only by its Bluebeam subject "Area Measurement". No author, no date, no Bluebeam-measured value to compare with what REDBEAM will compute.
   **WHY:** If Bluebeam says 1,190 SF and REDBEAM says 1,260 SF after conversion, that discrepancy *is* the scale problem in d6 #2 and I want to see it at the moment of conversion, not in a meeting.
   **PROPOSED CHANGE:** Item shows "polygon · Area Measurement · by J.Smith 6-28 · Bluebeam says 1,190 SF → REDBEAM 1,260 SF (+5.9 %)". Warn when they differ by more than 2 %.
   **SEVERITY:** blocker

2. **WHERE:** Sidebar "Markups" section, group header "Page 1 · Page 1" (2 markups, 1260.5 and −6.9) vs the other group "A-351A-FLOOR-01--SECTOR-A-EXTERIOR-REFLECTED-CEILING-PLAN BULL.10 6-26-26.pdf · p1".
   **WHAT:** The markups on the sheet I am looking at (A-351B) are grouped under "Page 1 · Page 1" — no document name at all. The other group shows the full filename. Inconsistent, and the first one is unusable.
   **WHY:** This is the list I would screenshot into an email to the client. "Page 1 · Page 1" is not a source.
   **PROPOSED CHANGE:** Group header = sheet number · title · issue, consistently, e.g. "A-351B · RCP Sector B · Bull.10". Filename in tooltip.
   **SEVERITY:** blocker

3. **WHERE:** Sidebar, the document group label carrying "BULL.10 6-26-26".
   **WHAT:** Revision is filename text only. Nothing in the app *knows* it is a revision, so nothing can warn me when A-351A Bull.11 arrives.
   **PROPOSED CHANGE:** Document-level "Issue" field (auto-parsed, editable). Markups store the document hash + issue at creation. When the file changes on disk: red chip "source file changed since measured".
   **SEVERITY:** blocker

4. **WHERE:** Header "1,386.4 SF Area · 240.2 LF Perimeter · ⓘ Not committed. [Commit]".
   **WHAT:** Good that the state is visible. Missing: the last committed value and delta. I cannot tell if "not committed" means "never" or "changed since".
   **PROPOSED CHANGE:** "Not committed · last commit 1,374.0 SF on 3 Sep (+12.4 SF)". If never: "never committed".
   **SEVERITY:** blocker

5. **WHERE:** Parts table — every line marked "unverified" in yellow: "Installed length unverified 4,165.8 LF", "Baffle stock unverified 515 EA", "Connectors unverified 1,372 EA", "End caps unverified 514 EA", "Joiners unverified 258 EA".
   **WHAT:** Honest, but what would make them verified? There is no control to verify, no name of who could, and no explanation of the formula (4" OC across 1,386.4 SF gives ~4,159 LF, so the app is doing something sensible, but I had to compute that myself).
   **WHY:** I send *parts* to procurement. "unverified" on the PO is a question I have to answer.
   **PROPOSED CHANGE:** Tooltip per line with the formula ("area 1,386.4 SF × 12 / 4" OC = 4,159 LF, + ends"), and a "Mark verified" action that records who/when. Verified should be lost automatically when Setup or markups change.
   **SEVERITY:** major

6. **WHERE:** Setup fields "Spacing OC 4"", "Stock 10'0"", "Conn. Max 3'6"", "Profile W —", "Yield full", "Seams aligned".
   **WHAT:** Any of these changes the parts and therefore the number I sent. No indication whether editing them after a commit invalidates the commit, and no history of previous values.
   **PROPOSED CHANGE:** Editing a Setup field on a committed scope flips it to "changed since commit" with the changed field named; keep old value in history.
   **SEVERITY:** major

7. **WHERE:** "Direction — set for this sheet · defaul… [Set on the sheet]".
   **WHAT:** Direction is per sheet but the parts total is per scope; nothing says which sheets have a direction set and which are on default.
   **PROPOSED CHANGE:** "Direction: A-351B set · A-351A default".
   **SEVERITY:** paper cut

8. **WHERE:** "Name [CL04] [purple swatch]".
   **WHAT:** One field for name. No code vs label, no spec section, no note. See d3 #3.
   **SEVERITY:** major (duplicate of d3 #3)

9. **WHERE:** Footer "Duplicate · Remove from estimate".
   **WHAT:** "Remove from estimate" next to nothing that says whether the scope was ever committed / sent out.
   **PROPOSED CHANGE:** Confirm dialog must state "This scope was committed on 3 Sep at 1,374.0 SF" if applicable, and prefer "Archive" (already exists in the hub) over removal.
   **SEVERITY:** major

10. **WHERE:** Toolbar pill switched to "CL04" and a second row of tools appeared (takeoff mode entered by right-clicking).
    **WHAT:** A right-click for information put me into an editing mode. As the person who should *not* be editing, that is dangerous.
    **PROPOSED CHANGE:** A read-only / "review" mode toggle in Settings or the toolbar that hides drawing tools and disables Convert/Trace; the hub still works for lookup.
    **SEVERITY:** major

---

## d9 — Scope page, Parts / Setup / Markups as one column

1. **WHERE:** Section headers "Parts 5 lines", "Setup", "Markups 3 on 2 sheets" all open at once, sidebar scrolls.
   **WHAT:** The one-column layout is fine for reading, but the summary I need for a client email (area, perimeter, parts, sheets + issues, commit state) is spread over three sections and 900 px.
   **PROPOSED CHANGE:** "Copy summary" / "Export scope PDF" action in the "…" menu that produces: scope code, product, area/perimeter, parts table, markups by sheet with issue, commit state and date. That is the thing I actually attach.
   **SEVERITY:** major

2. **WHERE:** Markups list rows "area 1260.5 SF / cutout −6.9 SF / area 132.8 SF".
   **WHAT:** No per-row "go to", no per-row "who/when", no per-row commit lock (see d5 #5).
   **PROPOSED CHANGE:** Row click = go to and select; hover shows edited-by/when.
   **SEVERITY:** major

3. **WHERE:** "Show the layout on the sheet" toggle.
   **WHAT:** Unclear whether "layout" is the baffle pattern overlay (I think so) and whether it affects anything counted.
   **PROPOSED CHANGE:** "Draw the baffle layout on the sheet (display only)".
   **SEVERITY:** paper cut

4. **WHERE:** Breadcrumb "Estimates › CEILING SCOPE › CL04".
   **WHAT:** No way to go from here to "all rounds" comparing CL04 across rounds (e.g. "CEILING SCOPE" vs a future "CEILING SCOPE – Bull.11").
   **PROPOSED CHANGE:** Round-level "Compare with…" that diff-lists scope totals between two rounds.
   **SEVERITY:** major

---

## d10 — Settings > General

1. **WHERE:** Only three settings: "Reopen the last project on launch", "Recent projects kept 40", "Recent projects drop off never".
   **WHAT:** No identity setting. Nothing asks who I am. Therefore nothing in the app can ever say "measured by K., committed by A.".
   **WHY:** Every audit question starts with "who".
   **PROPOSED CHANGE:** "Your name / initials" (default from Windows account) used as author on markups, commits, calibrations and verifications.
   **SEVERITY:** blocker

2. **WHERE:** No "Units / rounding" setting visible under General (may be under Takeoff, 11 settings, not shown).
   **WHAT:** The app shows 1,386.4 SF and 240.2 LF; I need to know whether the export rounds the same way the screen does, and whether metric is available for the Toronto job.
   **PROPOSED CHANGE:** Surface "Display units" and "Rounding on export" under General.
   **SEVERITY:** paper cut

3. **WHERE:** No "Review / read-only mode".
   **PROPOSED CHANGE:** See d8 #10.
   **SEVERITY:** major

4. **WHERE:** "About REDBEAM 0.2.1" bottom-left.
   **WHAT:** Fine. Include build date and the redbeam.db schema version so bug reports are precise.
   **SEVERITY:** paper cut

---

## d11 — Takeoff mode toolbar

1. **WHERE:** Tool group: pentagon (area, active), scissors (cutout?), ruler-like icon, a "01" boxed icon (count?), a funnel-like icon, a compass/direction icon, ×.
   **WHAT:** No labels; from the icons alone I cannot tell which tool produces what kind of number (area, cutout, length, count). I will not use them, but I need to *read* a markup's kind back from its icon in the sidebar and these do not match the sidebar's hexagon glyphs.
   **PROPOSED CHANGE:** Tooltips with kind + unit ("Area · SF", "Cutout · −SF", "Length · LF", "Count · EA", "Direction"), and use the same glyph in the markup list.
   **SEVERITY:** paper cut

2. **WHERE:** Scope pill "● CL04 ˄" sitting left of the tools.
   **WHAT:** The pill sets where new measurements go. It is the single most important control for not mis-scoping, and it looks like a status label rather than a control.
   **PROPOSED CHANGE:** Label it: "Drawing into: CL04".
   **SEVERITY:** major

3. **WHERE:** Scale pill "1" = 3'-9"" again, no warning glyph.
   **WHAT:** As d6 #2: the mode where numbers are created is exactly where the scale disagreement with the title block should be loudest.
   **SEVERITY:** blocker (same as d6 #2)

4. **WHERE:** No "exit review / lock" state; × closes takeoff mode.
   **WHAT:** No visible "you have uncommitted changes in CL04" when leaving the mode.
   **PROPOSED CHANGE:** Leaving takeoff mode on a committed scope with changes shows a toast "CL04 changed since commit (+12.4 SF)".
   **SEVERITY:** major

---

## Top 10 for my persona

1. **Sheet + issue on every markup, everywhere** (d5 #1, d8 #2). "Page 1 · Page 1" and "TE-2" are not sources. Group header = sheet number · title · issue.
2. **Revision is a field, not filename text** (d5 #2, d8 #3). Parse/allow "Issue" per document; flag "source file changed since measured".
3. **Commit history with values and deltas** (d4 #2, d8 #4). "Not committed" must say last committed value, date, author, delta; a History action lists prior commits.
4. **Scale provenance and title-block disagreement warning** (d6 #2, d11 #3). 1"=3'-9" vs printed 1/4"=1'-0" is a 12 % area question I cannot answer today.
5. **Author identity** (d10 #1). Without a name setting there is no "who" on anything.
6. **Selected markup readout + sidebar follow** (d6 #1). Selecting shows scope · kind · qty · sheet; toolbar pill must not say TROUGHS while CL04 is selected.
7. **Bluebeam import provenance** (d7 #1, d8 #1). Converted markups permanently carry Bluebeam author/subject/date and the Bluebeam value vs REDBEAM value.
8. **Round status line** (d3 #1, d3 #2). Under "CEILING SCOPE": scopes committed vs moving, last commit, drawing issue basis; state chip per scope row.
9. **Scope Code vs Label** (d3 #3, d8 #8). CL04 vs the architect's CLG-04, "BLUE", "TROUGHS" — enforce a code field.
10. **Review mode + "Copy summary" export** (d8 #10, d9 #1). Let me look without being able to break anything, and give me the one-page scope summary I actually send.
