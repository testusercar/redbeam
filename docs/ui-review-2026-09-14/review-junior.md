# REDBEAM first-look review — junior estimator persona

**Who I am:** three months into estimating. I've done maybe a dozen Bluebeam takeoffs (polygon, area, count tools, a Custom Column or two). I have never seen REDBEAM. Nobody walked me through it; I was handed the app and a folder and told "do the CL04 ceiling for the MSK podium."

**How I read these:** for every screen I ask myself four things — what do I click first, what words don't I know, what am I scared of breaking, and what would I have to Teams a senior about. I'm rating severity as **blocker** (I stop and go ask someone), **major** (I'll probably do the wrong thing and not know it), **paper cut** (annoying, I'll get past it).

---

## 1. d1.png — Start screen

**1.1 — "Open a drawing set..." vs "Open a project folder..."**
- WHERE: the two buttons under the REDBEAM title. Blue one says "Open a drawing set...", grey one says "Open a project folder...".
- WHAT: I don't know which one I want. Is a "drawing set" a PDF? Several PDFs? A folder of PDFs? Is a "project folder" the same folder but with something already in it? The blue one is emphasised so I'll click it, but I have a *folder* from the PM, not a "set".
- WHY: Bluebeam only has "Open file". Two verbs for what might be the same thing makes me think I'll pick the wrong one and create some second copy of the project.
- PROPOSED CHANGE: one primary button, "Open a folder of drawings...", with a one-line explainer under it: "Pick the folder that holds the PDFs. If REDBEAM has been here before it picks up where you left off; if not it starts a new estimate." If the two really are different, put the difference in the button subtext ("...new estimate" vs "...existing estimate").
- SEVERITY: major

**1.2 — "REDBEAM writes one redbeam.db beside the drawings and never modifies them."**
- WHERE: grey sentence below the buttons.
- WHAT: "redbeam.db" is developer language. I don't know what a .db is. I *do* care that it "never modifies them" — that's the one reassuring bit — but it's buried after the jargon.
- WHY: I share this folder on the Team Site. If I make a file in there, someone will ask me what it is, and I don't have an answer.
- PROPOSED CHANGE: "Your PDFs are never changed. REDBEAM keeps its own takeoff in a small file next to them (redbeam.db) — leave it there so the project reopens later." Lead with the reassurance.
- SEVERITY: paper cut

**1.3 — "forget" vs "remove data"**
- WHERE: the three links on each Recent row: rename / forget / remove data.
- WHAT: "forget" and "remove data" sound the same to me. Which one deletes my takeoff? Does "forget" just hide it from the list? Does "remove data" delete the PDFs?! Both are one click, next to each other, no confirmation visible.
- WHY: this is the single scariest thing on the screen. In Bluebeam, "Remove from recents" is harmless; here I can't tell which of these is the harmless one.
- PROPOSED CHANGE: rename to "Hide from list" and "Delete takeoff..." (with the ellipsis meaning a confirm dialog that spells out "This deletes REDBEAM's takeoff for this project. Your PDFs are not touched."). Move the destructive one behind a "..." overflow menu instead of inline.
- SEVERITY: blocker (I'd be afraid to touch the row at all)

**1.4 — Recent row paths are truncated in the middle**
- WHERE: "C:\Users\aaron\Maxxit Grou...Ramp\Bentall Towers 1 & 2".
- WHAT: I have two "Bentall" folders (one on the Team Site, one in Downloads). The ellipsis hides exactly the part I'd use to tell them apart.
- PROPOSED CHANGE: show the full path in a tooltip on hover, and truncate from the *start* (keep the tail), or show the parent folder name only.
- SEVERITY: paper cut

**1.5 — "Open a folder by path instead"**
- WHERE: underlined link at the bottom of the card.
- WHAT: "instead" of what? I haven't done anything yet. And why would I type a path when there's a Browse button coming?
- PROPOSED CHANGE: "Paste a folder path..." — or fold it into the Browse dialog entirely.
- SEVERITY: paper cut

**1.6 — No "what do I do first" for a brand-new user**
- WHERE: the whole card.
- WHAT: nothing tells me the sequence (open folder → open a sheet → set scale → make a scope → draw). Bluebeam at least has a Welcome tab.
- PROPOSED CHANGE: a small "First time? Here's the 4-step flow" link or a collapsed panel; or a "Try the sample project" entry in Recent.
- SEVERITY: major

---

## 2. d2.png — Start screen, "Open a folder by path" expanded

**2.1 — "Open" vs "Create & open"**
- WHERE: the two buttons under the path field.
- WHAT: create *what*? The folder? The takeoff? If I type a path that exists and click "Create & open", does it wipe something? If I click "Open" on a folder REDBEAM hasn't seen, does it fail?
- WHY: two buttons for one path field means I'm picking a *mode* without knowing what the modes do.
- PROPOSED CHANGE: one "Open" button; if the folder doesn't exist, ask "This folder doesn't exist. Create it?" inline. If it does exist and has no takeoff, just open it and say "New estimate started for <folder>" in the status bar.
- SEVERITY: major

**2.2 — The explainer repeats the .db sentence**
- WHERE: "A project is a folder. REDBEAM writes one redbeam.db inside it and never modifies the drawings."
- WHAT: it's the same line as 1.2, said a second time, still with the jargon. The useful sentence — "A project is a folder" — is good and should be *the* sentence on the whole start screen.
- PROPOSED CHANGE: promote "A project is just a folder of PDFs" to the top of the card; drop the duplicate.
- SEVERITY: paper cut

**2.3 — The path field is pre-filled with a truncated Team-Site path**
- WHERE: "C:\Users\aaron\Maxxit Group\MAXXiT Systems Team Site - Ramp\Bent..."
- WHAT: where did this come from? Is it the last one I opened? Clicking "Create & open" right now — what would it do to the Bentall folder?
- PROPOSED CHANGE: leave the field empty with placeholder "e.g. C:\Projects\00045 - Barclays", or label the pre-fill "last opened".
- SEVERITY: paper cut

---

## 3. d3.png — Project open, no drawing yet

**3.1 — Empty middle, no instruction**
- WHERE: the entire dark canvas between the Files tree and the Estimates sidebar.
- WHAT: nothing. No "double-click a drawing on the left to open it." I'm staring at 90 documents on the left and a scope list on the right, and the middle is just black.
- WHY: this is the moment I'm most likely to open Teams and ask "how do I get a drawing up."
- PROPOSED CHANGE: an empty state in the centre: "No drawing open. Double-click a PDF in Files (left), or press Ctrl+K and type a sheet number." Plus a second line: "Scopes on the right hold your takeoff; a drawing has to be open before you can draw."
- SEVERITY: blocker

**3.2 — "Estimates > CEILING SCOPE > Scopes > CL04 / BLUE / TROUGHS"**
- WHERE: the right sidebar.
- WHAT: three levels of the same-ish word. Is an "estimate" a project? Is "CEILING SCOPE" a scope, or a group of scopes? Are CL04, BLUE and TROUGHS scopes? The heading says "Scopes 3" so I guess yes — but then what is CEILING SCOPE?
- WHY: at my job, "scope" means the work we're bidding (the spec section). Here it seems to mean a *tag* I draw with, like a Bluebeam tool-chest item. "BLUE" and "TROUGHS" are colours/shapes, not spec tags, which makes it worse.
- PROPOSED CHANGE: rename levels to "Estimate > Section > Item" or "Estimate > Group > Scope", and put a tooltip on "Scopes": "One scope = one material you're measuring (e.g. CL04). Everything you draw goes into the scope selected in the bottom toolbar."
- SEVERITY: major

**3.3 — "Baffle · 3 markups" / "Planks · 0 markups"**
- WHERE: the subtitle under each scope.
- WHAT: I understand "baffle" and "planks" from the spec. "Markups" I know from Bluebeam — but are these *Bluebeam's* markups from the PDF, or things I drew here? BLUE says 0 markups but no area, and d4 later shows "0 SF". Is BLUE empty or broken?
- PROPOSED CHANGE: "3 areas drawn" / "nothing drawn yet — select a drawing and press Take off". Distinguish REDBEAM areas from the PDF's own Bluebeam markups everywhere (see 7.x/8.x).
- SEVERITY: major

**3.4 — Two "Add scope" buttons**
- WHERE: one at the top-right of the Scopes header, one at the bottom of the list.
- WHAT: two identical buttons for one action. Are they different? Does the bottom one add to a different group?
- PROPOSED CHANGE: keep one (the bottom one, where the new row will appear).
- SEVERITY: paper cut

**3.5 — "Pinned" with sheet names and the numbers 4 / 2**
- WHERE: below Scopes.
- WHAT: I didn't pin anything. What are the 4 and 2 — pages? markups? Why is A-351A "4" when CL04 says 3 markups?
- PROPOSED CHANGE: label it "Sheets with takeoff on them (4 areas / 2 areas)" or drop the counts; add a tooltip on the pin.
- SEVERITY: paper cut

**3.6 — Bottom toolbar shows "TROUGHS" + "Take off" + "Unset" with no drawing open**
- WHERE: bottom floating toolbar.
- WHAT: "Take off" is a big blue button and it looks clickable, but there's no drawing to take off. "TROUGHS" is red and looks like a warning or a status, not a scope selector. "Unset" with a ruler icon — unset what? (Scale, I'll guess later — but here it's a mystery word.)
- WHY: I'd click Take off first because it's blue. I don't know what happens.
- PROPOSED CHANGE: disable Take off with tooltip "Open a drawing first". Label the scope pill "Scope: TROUGHS" with a caret. Label the ruler "Scale: not set" and colour it amber, since drawing without a scale is the classic junior mistake.
- SEVERITY: major

**3.7 — Files tree: "1 Data > Client > 260904 Client Drawings Take Off &... > 01 Scope Overview > 04 Key Arch Details"**
- WHERE: the left tree.
- WHAT: it's just my SharePoint folder mirrored. Fine. But the drawing I actually need (A-351A/B under "CLG-04,05, Soffit") is buried below 27 detail sheets. I'd search — the search box says "Filter 90 documents" so I would type "351" there. Good. But the "Reading the folder..." text in the status bar at the bottom left is stuck there — is it still reading?
- PROPOSED CHANGE: status should resolve to "90 documents" (it does in d4, so this is a moment-in-time thing — but if it lingers, add a spinner). Also consider a "Recently opened sheets" strip at the top of the tree.
- SEVERITY: paper cut

**3.8 — Four icons at the top of the left rail (Files / bookmark / grid / magnifier)**
- WHERE: top of the left rail.
- WHAT: no labels except "Files". Bookmark = bookmarks in the PDF? Grid = thumbnails? Magnifier = search in the PDF text, or search files? I already have a "Filter 90 documents" box right under it, so two searches.
- PROPOSED CHANGE: tooltips at minimum; better, labels ("Files / Bookmarks / Pages / Find in drawing").
- SEVERITY: paper cut

**3.9 — Left tree items show tiny document counts (58 / 52 / 30 / 27) — I read them as page counts**
- WHERE: right edge of folder rows.
- WHAT: "1 Data 58" — 58 pages? 58 files? It's files. Bluebeam shows page counts, so I assumed pages.
- PROPOSED CHANGE: tooltip "58 PDFs" or suffix "58 files".
- SEVERITY: paper cut

---

## 4. d4.png — Ctrl+K prompt, the CL04 "hub"

**4.1 — I would never find this**
- WHERE: the whole popup.
- WHAT: nothing on any screen says "press Ctrl+K". No "⌘K"-style hint in the search box, no menu item. I found it because someone told me. Bluebeam has a menu bar; this has none.
- PROPOSED CHANGE: a visible hint in the top bar or status bar: "Ctrl+K — jump to a sheet, a scope, or a command". Also put the same actions in the scope's "..." menu in the sidebar so mouse-only users get them.
- SEVERITY: major

**4.2 — "Choose · CL04 … step 1"**
- WHERE: the input placeholder and the "step 1" label.
- WHAT: step 1 of how many? Choose what? It reads like a wizard but I don't know the destination. The chip "CL04" to the left of the input — can I click it to change scope? Backspace on empty "back a step" is in the footer, but I only read footers after I'm stuck.
- PROPOSED CHANGE: placeholder "What do you want to do with CL04?" and drop "step 1" until there's a step 2.
- SEVERITY: paper cut

**4.3 — "Take off — area tool, drawing into CL04"**
- WHERE: first row.
- WHAT: this is the one I want. Good. But "drawing into" — into the scope? into the sheet? I'd say "Draw an area for CL04 on this sheet".
- PROPOSED CHANGE: as above.
- SEVERITY: paper cut

**4.4 — "Configure... — product, each measure, yield, seams"**
- WHERE: second row.
- WHAT: "each measure" — I don't know what that is. "Yield" I know from material takeoff (waste factor?) but I'm not sure it's the same thing here. "Seams" — baffle seams? plank end joints? This row is a list of jargon.
- PROPOSED CHANGE: "Set up the product (spacing, stock length, waste, joints)". Use words from the spec/PO, not the model.
- SEVERITY: major

**4.5 — "Colour... #8000ff"**
- WHERE: fourth row.
- WHAT: a hex code. Show the swatch, not the number.
- SEVERITY: paper cut

**4.6 — "Direction from an edge..." and "Set direction on the sheet — drawn as an arrow"**
- WHERE: rows 5 and 6.
- WHAT: two rows about "direction" and I don't know what direction means for a ceiling. Baffle run direction? Which way the planks lay? "run the pattern along an edge of one of its areas on this sheet" is a full sentence I had to read three times. And which one do I use? Both? One?
- WHY: this feels important (it changes the count) and I can't tell the consequence of skipping it. Nothing says "if you don't set this, we assume X".
- PROPOSED CHANGE: merge into one row "Baffle run direction — currently: default (0°). Pick an edge or draw an arrow." Show the current value so I know if I've done it.
- SEVERITY: major

**4.7 — "Commit — freeze the count as it stands"**
- WHERE: row 9.
- WHAT: I have no idea what committing does or whether it's reversible. "Freeze" sounds permanent. Do I have to commit before I export? Before I can leave? If I commit and then draw more, is that a new count? Nothing in the app so far explained the commit concept.
- WHY: this is a word from Git, not from estimating. In Bluebeam nothing is ever "committed".
- PROPOSED CHANGE: rename to "Lock the quantities (you can unlock)" with a one-liner: "Locking stops the numbers changing while you price. Drawing more after locking makes a new draft." And put the same explanation on the "Not committed." line in the sidebar.
- SEVERITY: blocker (I won't touch it, and if I'm told I must, I'll be scared to)

**4.8 — "Archive — its 3 markups stay and come back if you restore it"**
- WHERE: row 12.
- WHAT: OK, this is actually the clearest line on the screen — it tells me it's reversible. But it sits right below "Duplicate" and "Rename..." with no separator before the scary ones.
- PROPOSED CHANGE: group: [do takeoff] / [set up] / [view] / [manage]. Put Archive under a divider.
- SEVERITY: paper cut

**4.9 — "Duplicate — the specification, not the takeoff"**
- WHERE: row 11.
- WHAT: "specification" here means the Setup values, I think. In my world "specification" is the architect's spec book. Say "the settings".
- SEVERITY: paper cut

**4.10 — "needs a choice" / "needs a name"**
- WHERE: right-hand grey text on several rows.
- WHAT: fine once you know it means "opens a sub-list". First time I thought it meant *missing* (like "needs attention").
- PROPOSED CHANGE: just the chevron, or "..." in the label (which they already have) — the extra text adds worry.
- SEVERITY: paper cut

---

## 5. d5.png — Prompt, Markups step

**5.1 — "area · 1260.5 SF" / "cutout · −6.9 SF" / "area · 132.8 SF"**
- WHERE: the three rows.
- WHAT: "cutout" is new to me — a negative area. I'd call that a "deduction" or "void". Good that it's negative. But what am I supposed to *do* here — "needs a choice" again. Does choosing one go to it? Delete it? I'm scared it's delete.
- PROPOSED CHANGE: "Go to / Edit / Remove" as the sub-choices with a hint in the placeholder: "Pick a markup to go to it".
- SEVERITY: major

**5.2 — Sheet name on each row is the full filename and it's identical on two rows**
- WHERE: "A-351B-FLOOR-01---SECTOR-B-EXTERIOR-REFLECTED-CEILING-PLAN-REV.3 M2-M5 BU..." (twice).
- WHAT: the first two rows are on the same sheet; the third says "TE-2" with no sheet at all. I can't tell which drawing TE-2 is on. Wait — TE-2 might be the *Bluebeam label* of the markup, not the sheet.
- PROPOSED CHANGE: show "A-351B · Sector B RCP" (sheet number + short title) consistently; put the markup's own label in a second column.
- SEVERITY: paper cut

**5.3 — The list has no "total" line**
- WHERE: bottom of the list.
- WHAT: 1260.5 − 6.9 + 132.8 = 1386.4, which is the sidebar number. Show it here too so I can trust the math.
- SEVERITY: paper cut

---

## 6. d6.png — A-351B open after "Go to it", markup selected

**6.1 — I can't see which markup is "selected"**
- WHERE: the drawing. The caption says one is selected; I see a purple outline on the top-right area with small square handles at its corners, but it's the same magenta as the Bluebeam markups underneath.
- WHAT: the PDF already has 101 Bluebeam markups in hot pink/magenta/blue/cyan. REDBEAM's CL04 colour is #8000ff purple. On top of a magenta Bluebeam markup I genuinely can't tell REDBEAM's area from the architect's.
- WHY: this is the core thing — I need to know what I've counted vs what's just on the drawing.
- PROPOSED CHANGE: default REDBEAM areas to a *hatched* fill with a heavy outline, distinct from any flat-filled PDF markup; a "dim PDF markups" toggle in the toolbar; when something is selected, show a floating chip "CL04 · area · 1,260.5 SF" next to it.
- SEVERITY: blocker

**6.2 — Nothing changed in the sidebar when I selected the markup**
- WHERE: right sidebar still shows CEILING SCOPE / Scopes list.
- WHAT: in Bluebeam, selecting a markup highlights its row in the Markups List. Here the sidebar didn't react. I don't know if selection "worked".
- PROPOSED CHANGE: selecting an area should open/scroll the scope page to that markup row and highlight it.
- SEVERITY: major

**6.3 — The bottom toolbar still says "TROUGHS" while the selected area belongs to CL04**
- WHERE: the red "TROUGHS" pill, bottom centre.
- WHAT: I went to a CL04 markup via the CL04 hub, and the "active scope" is still TROUGHS. If I click Take off now, do I draw into TROUGHS? That's how I'd put a baffle area into the planks scope by accident.
- PROPOSED CHANGE: selecting a markup (or "Go to it" from a scope hub) should switch the active scope to that markup's scope — or at minimum flash the pill and show "Drawing into: TROUGHS" as a full label.
- SEVERITY: blocker

**6.4 — Scale pill reads `1" = 3'-9"`**
- WHERE: bottom right of toolbar.
- WHAT: on A-351A it said 1/4" = 1'-0" (normal). Here it says 1" = 3'-9"; that is not a real architectural scale. Was it calibrated by someone? Auto-detected wrong? I have no way to tell, and the sheet's own title block says 1/4"=1'-0" (I think — the crop at bottom-left says something like that under the view title).
- WHY: a wrong scale silently makes every number wrong. Bluebeam shows a "Calibrated" badge; this shows nothing.
- PROPOSED CHANGE: show *how* the scale was set ("calibrated by Aaron, 5 Sep" / "from title block" / "typed") and a warning triangle when it's a non-standard ratio.
- SEVERITY: major

**6.5 — "1/1" page counter**
- WHERE: toolbar centre.
- WHAT: fine. But the left tree still highlights A-764 (the row is lit) as well as A-351B — two highlighted rows, and the second tab "A-351A-FLOOR-01--SE..." is greyed. I'm confused about which is "current".
- PROPOSED CHANGE: one highlight = current tab; hover highlight should not persist.
- SEVERITY: paper cut

**6.6 — Where's undo?**
- WHERE: nowhere visible.
- WHAT: no Undo button, no Edit menu. I assume Ctrl+Z works but nothing says so. Bluebeam has a visible undo.
- PROPOSED CHANGE: an undo/redo pair in the toolbar or a "Ctrl+Z undo" hint in the status bar after any change ("Area added to CL04 — Ctrl+Z to undo").
- SEVERITY: major

---

## 7. d7.png — Right-click on empty sheet

**7.1 — "The drawing" header + two options**
- WHERE: context menu: "Convert all 101 PDF markups on this sheet" / "Trace the region here as an area".
- WHAT: Two very different-weight actions side by side. "Convert all 101" sounds huge and irreversible; "Trace the region here" I don't understand at all — trace what region? the room I clicked in? the whole magenta blob? Does it use the PDF's lines?
- WHY: I'd click "Trace the region here" to see what it does, and I'd also be tempted by "Convert all 101" because it sounds like it does my job for me — but 101 markups into *which* scope? TROUGHS (the active one)? That's a disaster.
- PROPOSED CHANGE: (a) "Convert all 101..." must open a dialog: "Convert 101 PDF markups into which scope? [CL04 / BLUE / TROUGHS / new] — only polygons/areas will be converted (N of 101)". (b) "Trace the region here" → "Auto-outline the enclosed area under the cursor (into TROUGHS)"; show a preview outline on hover before committing.
- SEVERITY: blocker

**7.2 — No "Take off here" / "Draw area" in the context menu**
- WHERE: the menu.
- WHAT: the thing I'd most expect on right-click (start drawing) isn't there. Bluebeam's right-click has the tools.
- PROPOSED CHANGE: add "Draw an area for TROUGHS" as the first item, and "Set scale from two points" (calibrate) since I'm here.
- SEVERITY: major

**7.3 — "PDF markups" vs "markups"**
- WHERE: the word "PDF markups" in the menu, vs "markups" in the sidebar counts.
- WHAT: this is the first time the app distinguishes the two. Good — but the sidebar's "3 markups" should then say "3 areas" or "3 REDBEAM markups" so the word doesn't mean two things.
- PROPOSED CHANGE: pick "PDF markup" for the architect's stuff and "area"/"takeoff" for ours, everywhere.
- SEVERITY: major

---

## 8. d8.png — Right-click on one of the PDF's own (Bluebeam) markups

**8.1 — "Convert 1 selected PDF markup into: CL04 / BLUE / TROUGHS"**
- WHERE: top group of the menu.
- WHAT: this is actually the clearest, most useful menu in the whole set. I know what it does. But: what happens to the original PDF markup — is it hidden, deleted, left in place? And "convert" sounds like it *changes the PDF*, which the start screen promised it never does.
- PROPOSED CHANGE: "Count this PDF markup as CL04 (the PDF is not changed)". After converting, show the resulting area in REDBEAM style so I can see it worked.
- SEVERITY: major

**8.2 — Second group: 'Convert polygon "Area Measurement" to an area' / "Convert all 101..." / "Trace the region here..."**
- WHERE: lower group, header "1 PDF markup here".
- WHAT: 'Convert polygon "Area Measurement" to an area' — into which scope? It has no scope list under it, unlike the top group. So is it different from the top group? Is it the same thing but into the active scope? Two "convert" verbs for one markup is one too many.
- PROPOSED CHANGE: drop the second "Convert polygon..." row, or make it explicitly "Count as TROUGHS (active scope)". And "Convert all 101" should not sit one pixel below a single-markup action — misclick = 101 conversions.
- SEVERITY: blocker

**8.3 — The right sidebar changed to the CL04 scope page — with "Not committed." in a warning style**
- WHERE: right sidebar, "(i) Not committed. — Commit".
- WHAT: it looks like an error. Every scope is presumably "not committed" until I do something I don't understand (see 4.7). The blue "Commit" link is one click and sounds final.
- PROPOSED CHANGE: neutral wording: "Draft — quantities update as you draw. [Lock]". Confirm dialog on Lock.
- SEVERITY: major

**8.4 — Parts table: every row says "unverified" in yellow**
- WHERE: "Installed length unverified 4,165.8 LF", "Baffle stock unverified 515 EA", etc.
- WHAT: unverified by whom? Me? A senior? The app? Is there a button to verify? Is it a warning I'm supposed to clear before sending numbers out? Yellow on every line makes the whole table look wrong.
- WHY: I'd absolutely ask a senior "what does unverified mean and how do I make it go away."
- PROPOSED CHANGE: if it means "calculated, not checked by a person", say "calc" in grey and offer a checkbox per line "I've checked this" that flips it to a green tick. If it means the formula isn't trusted yet (dev meaning), hide it from users.
- SEVERITY: major

**8.5 — Parts vocabulary: "Baffle stock", "Connectors", "End caps", "Joiners"**
- WHERE: Parts rows.
- WHAT: these are real Maxxit parts, fine. But "Installed length 4,165.8 LF" vs "Baffle stock 515 EA" — is stock in 10' lengths (the Setup says Stock 10' 0")? 515 × 10' = 5,150 LF vs 4,165.8 installed — so ~19% waste? That's a lot; is that what "Yield: full" means? I can't tell if I've set something wrong.
- PROPOSED CHANGE: a small derived line under the table: "515 sticks × 10'-0" = 5,150 LF bought for 4,165.8 LF installed (19% offcut)". That's the sentence I'd have to compute by hand for the senior anyway.
- SEVERITY: major

**8.6 — Setup fields: "Spacing OC · centre to centre", "Stock · length you buy", "Conn. Max · hanger limit", "Profile W · face width"**
- WHERE: Setup section.
- WHAT: the two-part labels are actually helpful ("Stock · length you buy" — thank you). But "Conn. Max · hanger limit" — I don't know what a connector max is, and "hanger limit" doesn't explain it either. "Profile W · face width" is blank ("—") — is blank OK? Does it break the count?
- PROPOSED CHANGE: tooltips with a sentence each and a "why this matters" ("Hanger limit: the longest run between hangers; sets how many connectors are counted"). If a field is optional, say "optional" in the placeholder; if required, show a red dot.
- SEVERITY: major

**8.7 — "Yield: full" / "Seams: aligned"**
- WHERE: two dropdowns in Setup.
- WHAT: "Yield full" — full what? I'd guess "use full sticks only, no splicing offcuts". "Seams aligned" vs presumably "staggered". No help text.
- PROPOSED CHANGE: option labels with consequences: "Yield: full sticks only (offcuts wasted)" / "reuse offcuts". "Seams: aligned (in a row)" / "staggered (brick pattern)".
- SEVERITY: paper cut

**8.8 — "Direction — set for this sheet · defaul... [Set on the sheet]"**
- WHERE: Setup, Direction row.
- WHAT: truncated text. "defaul..." — default *what*? 0°? And the button "Set on the sheet" wraps onto two lines.
- PROPOSED CHANGE: "Direction: 0° (default) — [Draw arrow on sheet]".
- SEVERITY: paper cut

**8.9 — "Name: CL04 [purple swatch]" sits *below* all the Setup fields**
- WHERE: bottom of Setup.
- WHAT: name and colour are the identity of the scope; they belong at the top. I scrolled past all the numbers to find where to rename.
- PROPOSED CHANGE: move Name + colour to the header row (next to "CL04 · Baffle · 3 markups").
- SEVERITY: paper cut

**8.10 — "Show the layout on the sheet" toggle**
- WHERE: under the Parts table.
- WHAT: it's on, but I see no layout (no baffle lines) on the sheet. Maybe the view is too zoomed out, maybe it only draws inside REDBEAM areas, maybe it doesn't draw until committed. No feedback.
- PROPOSED CHANGE: when on and nothing is visible, a hint: "Layout shows at 100% zoom or closer" (or whatever the rule is).
- SEVERITY: paper cut

**8.11 — Footer: "Duplicate" / "Remove from estimate"**
- WHERE: very bottom of the sidebar.
- WHAT: "Remove from estimate" — does that delete the scope and its 3 areas? Or unlink it? Compare "Archive" in the hub, which promised markups come back. Are these the same action with two names, or is Remove the destructive one?
- PROPOSED CHANGE: use the same word as the hub ("Archive scope — areas are kept"), or if this really deletes, say "Delete scope and its 3 areas..." with a confirm.
- SEVERITY: major

**8.12 — Toolbar changed: scope pill is now "CL04" and a second cluster of tools appeared**
- WHERE: bottom toolbar (pentagon, scissors, ruler, tape, funnel/cone, compass, X).
- WHAT: opening the CL04 page swapped the scope pill to CL04 (good — but it didn't happen in d6, so it's inconsistent) and there are seven unlabelled icons now. See section 11.
- SEVERITY: major (inconsistency)

---

## 9. d9.png — Scope page in the sidebar, Parts / Setup / Markups in one column

**9.1 — Tabs "Parts 5 / Setup / Markups 3" *and* collapsible sections "Parts / Setup / Markups" below them**
- WHERE: the tab strip and the section headers.
- WHAT: the tabs look like tabs (they'd switch views) but everything is also stacked below in one scroll. So do tabs scroll-to? Filter? I clicked "Setup" expecting Parts to go away.
- PROPOSED CHANGE: either real tabs (one section at a time) or a jump-bar styled as links, not tabs. Not both.
- SEVERITY: paper cut

**9.2 — The area/perimeter headline: "1,386.4 SF / 240.2 LF"**
- WHERE: top of the scope page.
- WHAT: Great, this is what I want to see. But 240.2 LF perimeter of a 1,386 SF area — is that the perimeter of *all three* areas combined, and does it include the cutout's perimeter? For trim/edge-angle takeoff that matters.
- PROPOSED CHANGE: tooltip "Sum of the outlines of 3 areas (cutout edges included/excluded)".
- SEVERITY: paper cut

**9.3 — Markups list grouped by "sheet": "Page 1 · Page 1" as the group name**
- WHERE: Markups section, first group.
- WHAT: "Page 1 · Page 1" tells me nothing — which document? The second group has the full 80-char filename. So one sheet is unnamed and the other is over-named.
- PROPOSED CHANGE: "A-351B · Sector B RCP" for both, derived from the sheet number; the file name in a tooltip.
- SEVERITY: major

**9.4 — Markup rows: "area 1260.5 SF", "cutout −6.9 SF", "area 132.8 SF" — no names, no click affordance**
- WHERE: the three rows.
- WHAT: can I click one to go to it? Rename it ("Lobby soffit")? Delete it? Rows don't look clickable and there's no hover state visible in the still. In Bluebeam I'd double-click the list row to zoom to it.
- PROPOSED CHANGE: hover shows "Go to · Rename · Delete"; double-click zooms; allow a label per area.
- SEVERITY: major

**9.5 — "Group by: sheet | kind"**
- WHERE: Markups section header.
- WHAT: "kind" = area vs cutout? Fine, but call it "type".
- SEVERITY: paper cut

**9.6 — Breadcrumb "Estimates > CEILING SCOPE > CL04" — no back button**
- WHERE: sidebar top.
- WHAT: I can click "CEILING SCOPE" in the crumb, probably. No obvious "< back". Coming from the hub I'm not sure where I am in the hierarchy.
- PROPOSED CHANGE: a back chevron before the crumb.
- SEVERITY: paper cut

**9.7 — Where do I export?**
- WHERE: nowhere on the scope page, the estimate page, or the toolbar.
- WHAT: the whole point is to get numbers into the pricing sheet. I see no Export/Copy/Excel anywhere in 11 screenshots. Maybe it's in Ctrl+K; I wouldn't know.
- PROPOSED CHANGE: an "Export..." button on the Estimates header, and "Copy table" on the Parts table.
- SEVERITY: blocker

---

## 10. d10.png — Settings > General

**10.1 — Settings takes over the whole window and hides my drawing**
- WHERE: full-screen Settings with a "<" back arrow.
- WHAT: I clicked the gear in the bottom-left expecting a popup; instead my drawing disappeared. For a second I thought I'd closed the project. The tabs are still up top, which is the only reassurance.
- PROPOSED CHANGE: open Settings as a dialog, or keep a "Back to drawing" button prominent (the "<" is tiny).
- SEVERITY: paper cut

**10.2 — "Reset all · 1 changed"**
- WHERE: top right.
- WHAT: 1 changed *what*? Which one? Nothing on this page is marked as changed. And "Reset all" is one click — does it reset Takeoff settings too (11 of them), including things I don't know about that might affect my counts?
- PROPOSED CHANGE: highlight the changed setting; make Reset all confirm and list what it'll reset.
- SEVERITY: major

**10.3 — "Every project ever opened stays a keystroke away in the prompt (~)."**
- WHERE: helper text under "Recent projects kept".
- WHAT: "the prompt (~)" — the tilde? I don't know that pressing ~ does anything. This is the second reference to a hidden keyboard-driven feature that no screen ever advertises.
- PROPOSED CHANGE: "...in the Ctrl+K prompt (type ~ to list projects)". And surface Ctrl+K in the UI (see 4.1).
- SEVERITY: paper cut

**10.4 — Sections "Drawing 1 / Takeoff 11 / Performance 1"**
- WHERE: left nav.
- WHAT: "Takeoff 11" — eleven settings that presumably change how quantities are calculated. I'm not opening that without a senior. Is there a "recommended/company default" marker? Are these per-project or global? If global, changing one changes every project's numbers.
- PROPOSED CHANGE: label each section "(this project)" or "(all projects)"; and in Takeoff, mark the safe ones vs the ones that change quantities.
- SEVERITY: major

**10.5 — Startup toggle "Reopen the last project on launch — Off"**
- WHERE: first setting.
- WHAT: clear, well explained. No issue. (Noting the one good one.)
- SEVERITY: none

---

## 11. d11.png — Takeoff mode toolbar

**11.1 — Seven unlabelled icons**
- WHERE: bottom toolbar cluster after the "CL04" pill: pentagon (highlighted), scissors, ruler/tape, a boxed "0.0"-ish icon, a cone/funnel, a compass, an X.
- WHAT: my guesses — pentagon = polygon area (like Bluebeam), scissors = cutout?, tape = length?, boxed digits = count? or dimension?, cone/funnel = ?, compass = direction arrow?, X = exit takeoff mode. I'm guessing on at least four of them. Bluebeam shows the tool name on hover *and* has the names in the Tools menu.
- WHY: the scissors worry me — is that "cut a hole" (cutout) or "split an area" or "delete"?
- PROPOSED CHANGE: tooltips with name + shortcut key on every icon; a text label under each while in takeoff mode (there's room); order them by how often I'd use them: Area, Cutout, Length, Count, Direction, then Done.
- SEVERITY: blocker

**11.2 — No indication of how to draw**
- WHERE: the canvas after entering takeoff mode.
- WHAT: I'm in "area" mode (pentagon lit). Click-click-click then...? Double-click to close? Enter? Right-click? Escape to cancel? Bluebeam: click points, double-click/Enter to finish. Nothing on screen says.
- PROPOSED CHANGE: a one-line status hint at the bottom of the canvas while a tool is active: "Area for CL04 — click corners · Enter or double-click to finish · Esc to cancel · Shift for straight lines". Change it as I progress ("2 points · 0 SF so far").
- SEVERITY: blocker

**11.3 — The context menu is still open over the drawing while in takeoff mode**
- WHERE: the "1 PDF markup here" menu.
- WHAT: I'm in a drawing tool but there's a menu floating. If I click a corner to start my polygon, does that dismiss the menu, or pick "Trace the region"? (This may just be the screenshot timing, but the state is confusing.)
- PROPOSED CHANGE: entering a tool closes any context menu.
- SEVERITY: paper cut

**11.4 — The "X" button next to the compass**
- WHERE: last icon in the tool cluster.
- WHAT: X = close the toolbar? cancel my current polygon? delete the selected area? Three very different outcomes.
- PROPOSED CHANGE: "Done" text button, and a separate "Delete" that only appears with a selection.
- SEVERITY: major

**11.5 — The hand / arrow / fit icons at the far left**
- WHERE: first cluster: hand (pan), cursor arrow (select), and a box with arrows (fit to page?).
- WHAT: I know hand and arrow. The third I read as "fit" — but in d3 the same slot looked like a "fullscreen" icon lives elsewhere (the [ ] in the zoom cluster). Two fit-ish icons.
- PROPOSED CHANGE: tooltips; dedupe.
- SEVERITY: paper cut

**11.6 — Live numbers while drawing are not shown anywhere I can see**
- WHERE: nothing on the canvas or toolbar shows the running area.
- WHAT: Bluebeam draws the SF label on the polygon as you go. I expect the same; the sidebar totals are far away (top right) and I'd have to look away from my cursor.
- PROPOSED CHANGE: running "1,2xx SF" label at the cursor, and the sidebar CL04 total pulses when it updates.
- SEVERITY: major

**11.7 — The scale pill `1" = 3'-9"` is still there, unwarned, while I'm about to draw**
- WHERE: bottom right.
- WHAT: repeating 6.4 because *now* it matters: I'm one click away from drawing into a scale I don't trust. There's no "check scale" nudge when entering takeoff mode.
- PROPOSED CHANGE: first time entering takeoff on a sheet, a small banner "Scale on this sheet: 1" = 3'-9" (set by ...) — [Looks right] [Re-calibrate]".
- SEVERITY: major

---

## Top 10 for my persona

1. **Active scope drifts silently (6.3 / 8.12).** I opened a CL04 markup and the toolbar still said TROUGHS; opening the scope page flipped it to CL04. I will draw baffle areas into the planks scope and never notice. Make the active scope follow the selection, and spell it out: "Drawing into: CL04".
2. **No drawing hints in takeoff mode (11.2) and unlabelled tool icons (11.1).** I don't know how to finish a polygon, cancel one, or what scissors/cone/compass/X do. Tooltips + a live status line would fix 80% of my first-hour questions.
3. **"Convert all 101 PDF markups" is one click away from a single-markup action (7.1 / 8.2)**, with no scope picker, no confirm, no undo hint. I would fire this by accident, into the wrong scope.
4. **"Commit / Not committed / freeze the count" (4.7 / 8.3).** A word from version control, presented like an error. I won't press it and I don't know if I have to. Rename to Lock/Draft and explain reversibility.
5. **Empty canvas with no instruction after opening a project (3.1).** The very first thing a new user sees is a black rectangle. "Double-click a PDF on the left to open it" is all it needs.
6. **REDBEAM areas are indistinguishable from the PDF's own Bluebeam markups (6.1).** Same purple/magenta family, flat fills. Hatch ours, dim theirs, or both.
7. **"unverified" in yellow on every Parts line (8.4).** Reads as "the numbers are wrong". Either give me a way to verify, or don't show it.
8. **"forget" vs "remove data" on the start screen (1.3), and "Remove from estimate" vs "Archive" on the scope page (8.11).** Two pairs of near-synonyms where one of each pair is destructive. Name the destructive one plainly and put it behind a confirm.
9. **No visible export (9.7) and no visible undo (6.6).** The two things I reach for constantly in Bluebeam are both missing from every screen.
10. **The Ctrl+K prompt is the real power surface and nothing advertises it (4.1 / 10.3).** The hub is where Configure, Direction, Commit, Archive all live — but I only got there because I was told the shortcut. Put a "Ctrl+K" hint in the top bar and mirror the hub's actions into the scope's "..." menu.

Honourable mentions I'd ask a senior about on day one: what "each measure", "yield: full", "seams: aligned", "Conn. Max · hanger limit" and "Profile W" mean (4.4 / 8.6 / 8.7); whether the `1" = 3'-9"` scale on A-351B is right (6.4 / 11.7); and what "CEILING SCOPE" is if CL04 is also a "scope" (3.2).
