# REDBEAM — Product design review (visual + interaction)

Reviewer persona: senior product designer. Scope: hierarchy, rhythm, alignment, type scale, colour discipline, iconography, 8px grid, states, density, cross-surface consistency.
Source: d1–d11.png, 3840×2088 at 150% (1 CSS px = 1.5 image px). Measurements below are in CSS px, rounded; "≈" means read off the screenshot, not the DOM.

Severity scale: **blocker** = ship-stopping for a designed product; **major** = visibly undermines the design intent or a core flow; **paper cut** = small, cheap, and there are many.

Recurring tokens I reference (proposed, not existing): `--text-1` primary, `--text-2` secondary, `--text-3` tertiary/placeholder; `--row-sm` 24px, `--row-md` 32px, `--row-lg` 40px; `--space-1..6` = 4/8/12/16/24/32.

---

## d1 — Start screen

1. **Brand mark is not the app's mark.**
   WHERE: red rounded "RB" square (≈20px) left of "REDBEAM", top-left of the card.
   WHAT: This is the only place the red RB mark appears. The title bar on every other screen (d3–d11) shows a peach/orange round icon instead; the start-screen window shows no icon at all.
   WHY: The mark is the one thing that must be identical everywhere. Two marks reads as two products, and the peach icon reads as a placeholder (which it is).
   PROPOSED: One SVG mark, exported to .ico at 16/24/32/48/256, used for the window icon, the title-bar tab strip, the start card, and About. Card mark 32px, not 20px. Until the real mark lands, use the red RB square in the title bar too.
   SEVERITY: blocker (brand).

2. **Primary CTA width is arbitrary and the two buttons are not a pair.**
   WHERE: "Open a drawing set…" (accent-filled, ≈278×31) next to "Open a project folder…" (outlined, ≈117×31).
   WHAT: The primary is 2.4× the width of the secondary, filled edge-to-edge of the leftover space; the label floats in the centre of an oversized field.
   WHY: Width should come from content or from a shared grid, not from `flex: 1`. The imbalance makes the secondary look like an afterthought, and the 31px height is off-grid.
   PROPOSED: Both buttons 32px tall, hug content with 16px horizontal padding, laid out left-aligned with an 8px gap; or two equal-width halves. Keep accent fill on the primary.
   SEVERITY: paper cut.

3. **Three interactive colours on one card.**
   WHERE: red mark, accent-blue primary, white underlined text links (rename / forget / remove data / Open a folder by path instead).
   WHAT: Underlined white links are not a Fluent idiom; Fluent links are accent-coloured, not underlined, and buttons are buttons.
   WHY: Underline + white + lowercase looks like an unstyled `<a>`. The card mixes three link/button styles (see also d9 "Commit" in accent, and d3/d6 "Collapse all" bold white). That's three link styles in the app.
   PROPOSED: One link token: accent colour, no underline at rest, underline on hover. Row actions become 24px icon buttons (pencil / eye-off / trash) revealed on hover, with tooltips.
   SEVERITY: major.

4. **Row actions are always-on, lowercase, and the destructive one is indistinguishable.**
   WHERE: "rename  forget  remove data" on both Recent rows.
   WHAT: Three text links permanently visible per row; "remove data" (deletes redbeam.db?) styled identically to "rename". Lowercase while every other label is sentence case.
   WHY: Permanent actions triple the visual weight of a two-row list and lowercase breaks the casing system.
   PROPOSED: Hover-reveal icon buttons; "Remove data" gets the danger colour and a confirm. If text stays: "Rename · Forget · Remove data…" sentence case, with ellipsis on the destructive one because it must confirm.
   SEVERITY: major.

5. **Path truncates in the middle *and* wraps.**
   WHERE: `C:\Users\aaron\Maxxit Grou…Ramp\Bentall` / `Towers 1 & 2` (row 1), same pattern row 2.
   WHAT: Middle-ellipsis applied, then the remainder still wraps to a second line under the actions column.
   WHY: Truncation exists to stop wrapping; doing both gives a two-line row of uneven height and a dangling fragment ("Towers 1 & 2", "Toronto") that looks like a separate item.
   PROPOSED: Single line, `text-overflow: ellipsis` at the end (or a proper middle-ellipsis computed to the available width); full path in a tooltip. Fixed row height 48px (title + path).
   SEVERITY: major.

6. **Monospace for the path but proportional for the same path on d2.**
   WHERE: Recent list paths (mono) vs the "Open a folder by path" input on d2 (proportional).
   WHAT: The same data type in two typefaces two hundred pixels apart.
   WHY: Monospace is fine for paths, but it must be a rule, not a whim.
   PROPOSED: Decide: paths and literal identifiers (`redbeam.db`, hex colours) are mono at 12px `--text-2`; everything else is the UI face.
   SEVERITY: paper cut.

7. **Helper sentence is doing three jobs, in one grey, with an inline code span.**
   WHERE: "REDBEAM writes one `redbeam.db` beside the drawings and never modifies them."
   WHAT: Reassurance copy sits between the CTAs and the Recent list, in the same `--text-2` as the tagline and the row paths, and the same sentence is repeated with different wording on d2 (finding d2.5).
   WHY: It interrupts the CTA → recents rhythm and pushes Recent below the fold of the card's visual centre.
   PROPOSED: Move to a single caption under the buttons at 12px `--text-3`: "Your PDFs are never modified. REDBEAM keeps its data in one redbeam.db beside them." Say it once (delete the d2 duplicate).
   SEVERITY: paper cut.

8. **"Recent" header band is a different component from every other section header.**
   WHERE: "Recent" in a full-width raised band with 12px inset.
   WHAT: Elsewhere section headers are bare bold text with a count on the right (d3 "Scopes 3", "Pinned 2"; d10 "Startup"). Here it is a filled band, no count, and the band's left edge is 4px inside the card content edge while the divider under the list runs full width.
   WHY: Same role, three renderings.
   PROPOSED: Adopt the sidebar pattern: "Recent" 13px semibold `--text-1`, count "2" right-aligned `--text-3`, 1px divider below. Remove the band.
   SEVERITY: paper cut.

9. **Relative vs absolute timestamps in the same column.**
   WHERE: "23h ago" (row 1), "5 Sep" (row 2).
   WHAT: Mixed formats; also not right-aligned to a common edge (they right-align to the "rename" link, which itself moves).
   PROPOSED: Right-aligned fixed column, `--text-3`, one rule: relative under 7 days, then "5 Sep", then "5 Sep 2025". Tabular figures.
   SEVERITY: paper cut.

10. **Rows have no hover, selection, or keyboard state.**
    WHERE: Recent rows.
    WHAT: No visible affordance that the row is clickable; no divider between rows; only a divider after the last row.
    PROPOSED: Row hover = `--fill-subtle`, 4px radius, whole row clickable; focus ring 2px accent for keyboard.
    SEVERITY: major.

11. **"Open a folder by path instead" is a link that behaves like a disclosure.**
    WHERE: bottom-left of card.
    WHAT: Underlined link expands an inline form (d2). "instead" is odd — instead of what, if you haven't started anything?
    PROPOSED: Disclosure button: chevron-right + "Open by path" (chevron rotates to down when expanded, d2). No underline.
    SEVERITY: paper cut.

12. **Empty window around a 560px card, no drag-drop affordance, no shortcut hints.**
    WHERE: the 2560×1392 CSS px window with a centred card.
    WHAT: Nothing invites drop; nothing says Ctrl+O / Ctrl+K.
    PROPOSED: Faint dashed drop zone behind the card ("Drop a folder or PDFs anywhere"), and shortcut hints on the two buttons (Ctrl+O / Ctrl+Shift+O). Card vertical centre currently sits ≈6px below true centre; centre it.
    SEVERITY: paper cut.

13. **Tagline punctuation.**
    WHERE: "Quantity takeoff from construction drawings."
    WHAT: Terminal full stop on a tagline; the tagline is `--text-2` 13px and sits 2px too close to the 20px title (baseline-to-baseline ≈ 18px, i.e. no gap).
    PROPOSED: Drop the full stop, 4px gap between title and tagline.
    SEVERITY: paper cut.

---

## d2 — Start screen, "Open a folder by path" expanded

1. **Layout shift on expand.**
    WHERE: whole card; the header moved from y≈575 to y≈503 (CSS) when the section opened.
    WHAT: The card re-centres vertically as it grows, so the buttons the user was just looking at jump 72px up.
    PROPOSED: Anchor the card's top (e.g. top at 33% of viewport) and let it grow downward.
    SEVERITY: major.

2. **A second primary-button style.**
    WHERE: "Open" — white-filled with black text — beside "Create & open" (outlined).
    WHAT: The primary on d1 is accent-filled; here the primary is white-filled. Two primary styles on one screen.
    PROPOSED: Accent fill for "Open"; outline for "Create & open".
    SEVERITY: major.

3. **Form is indented 8px relative to its own label.**
    WHERE: "Open a folder by path" label starts at the card content edge; the input, buttons, and help text start 8px to the right.
    PROPOSED: One left edge.
    SEVERITY: paper cut.

4. **Input, "Browse…" and buttons on three different heights and two fills.**
    WHERE: input ≈30px filled; "Browse…" ≈30px outlined; "Open" / "Create & open" ≈32px.
    PROPOSED: All 32px. Input filled (`--fill-input`), buttons per finding 2.
    SEVERITY: paper cut.

5. **Help copy duplicated with different wording.**
    WHERE: "A project is a folder. REDBEAM writes one `redbeam.db` inside it and never modifies the drawings." directly under the d1 sentence that says the same thing.
    PROPOSED: Keep only the first line of this one ("A project is a folder.") if anything; delete the rest (see d1.7).
    SEVERITY: paper cut.

6. **"Browse…" duplicates "Open a project folder…".**
    WHERE: right of the path input.
    WHAT: Both open the OS folder picker. The user now has two routes to the same dialog on one card, one of which is inside a form for *not* using the dialog.
    PROPOSED: Drop "Browse…"; the path form is for typing/pasting. Or fold the whole path form into the picker's own address bar.
    SEVERITY: paper cut.

7. **End-ellipsis here, middle-ellipsis above.**
    WHERE: input value "…Ramp\Bent…" vs Recent list "Maxxit Grou…Ramp\Bentall".
    PROPOSED: One truncation rule for paths (see d1.5).
    SEVERITY: paper cut.

8. **No way to collapse the section.**
    WHERE: the "Open a folder by path instead" link disappeared; nothing closes the form.
    PROPOSED: Disclosure header with rotating chevron (d1.11).
    SEVERITY: paper cut.

9. **Ampersand casing.**
    WHERE: "Create & open".
    WHAT: Only ampersand in the app's labels. Elsewhere "and" is written out ("Parts and quantities…", d4).
    PROPOSED: "Create and open" or "Create folder…".
    SEVERITY: paper cut.

---

## d3 — Project open, no drawing

1. **Title-bar icon is a placeholder fruit, not the mark.**
    WHERE: top-left, 16px orange/peach circle.
    WHAT: See d1.1. Also the start-screen window has no icon at all.
    SEVERITY: blocker (brand).

2. **Canvas has no empty state.**
    WHERE: the entire centre column, ≈1470×1330 CSS px of pure black.
    WHAT: Nothing tells the user what to do, that Ctrl+K exists, or that they can drop a PDF. The "primary control surface" is invisible.
    PROPOSED: Centred empty state: mark at 24px opacity 40%, "Pick a sheet from Files, or press Ctrl+K", plus the two most useful commands as ghost buttons. Fade out when a document opens.
    SEVERITY: major.

3. **Folder and file glyphs are nearly identical.**
    WHERE: Files tree; folders use a "page with a folded tab" outline, files use a "page with a folded corner".
    WHAT: At 16px they are the same silhouette. The title bar meanwhile uses a proper folder glyph for the project.
    PROPOSED: Fluent `Folder` (open when expanded) for folders, `Document` for PDFs. 16px, 1.5px stroke, single icon set.
    SEVERITY: major.

4. **Five levels of single-child nesting before the first file.**
    WHERE: 1 Data › Client › 260904 Client Drawings Take Off &… › 01 Scope Overview › 04 Key Arch Details.
    WHAT: Every level has exactly one child; the useful names are indented 80px and truncated harder as a result.
    PROPOSED: Compact single-child chains (VS Code "compact folders"): show "1 Data / Client / 260904 …" on one row. Also allow the tree root to be the deepest common ancestor.
    SEVERITY: major.

5. **Truncation removes the only distinguishing text.**
    WHERE: A-460 … A-469 all render as "A-46x - ENLARGED-BASE-ELE…"; A-775 … A-779 as "SECTION-DETAILS---E…".
    WHAT: The rail is 340px but the label column gets ≈150px after indentation + count column.
    PROPOSED: (a) compact chains (4); (b) show the sheet number as the primary label and the title on a second line at 11px `--text-2` (two-line rows at 40px), or (c) truncate the middle, keeping the trailing token. Tooltip with full name on hover in all cases.
    SEVERITY: major.

6. **Three row heights for "a row in a list."**
    WHERE: tree rows ≈20px; sidebar scope rows ≈40px; Pinned rows ≈23px; Settings nav rows ≈40px (d10); Parts rows ≈24px (d9).
    WHAT: 20px is below any Fluent list density (compact is 24–28px). 23 and 24 are not the same thing. None of these is on the 8px grid except 40.
    PROPOSED: Three tokens only: `--row-sm` 24 (dense data: tree, parts, markups), `--row-md` 32 (nav, pinned), `--row-lg` 48 (two-line cards: scope rows). Tree at 24px keeps density and gains a hit target.
    SEVERITY: major.

7. **Classic Win32 scrollbar inside a Fluent shell.**
    WHERE: right edge of the Files tree — arrow buttons top/bottom, 12px opaque track.
    PROPOSED: Overlay scrollbar (Fluent "thin on rest, expand on hover"), no arrow buttons: `scrollbar-width: thin; scrollbar-gutter: stable` with the WebView2 overlay style, or a custom thumb.
    SEVERITY: major.

8. **Two search icons stacked.**
    WHERE: rail tab strip's magnifier (far right, y≈60) directly above the filter field's magnifier (y≈100).
    WHAT: One is "Search" (a rail page), the other is "Filter 90 documents". Same icon, 40px apart, different verbs.
    PROPOSED: If Search is a rail page, use the Fluent `Search` icon for it and the `Filter` icon in the filter box; or make the filter box *become* the search when focused and drop the tab.
    SEVERITY: paper cut.

9. **Rail tab strip: selected tab is a labelled pill, unselected are bare icons.**
    WHERE: "Files" (icon + label, raised pill, 3px accent bar at the left edge) vs bookmark and grid icons with no label.
    WHAT: The selected state changes the *shape* of the control, so the strip re-flows when you switch. And the accent bar is on the pill's left edge while the doc tab (d4) puts it on the bottom and the toolbar puts it under the icon — three placements of the same indicator.
    PROPOSED: All three tabs icon + label at 32px, or all icon-only with tooltips; indicator = 2px accent underline, matching the document tabs and the toolbar.
    SEVERITY: major.

10. **"Reading the folder… Collapse all Refresh" status row.**
    WHERE: bottom of the Files rail.
    WHAT: A transient status and two actions share one 13px line. The actions are bold white text with no button affordance; status persists after loading (d6 shows "90 documents" in the same slot, so this is a state, fine — but the actions still look like labels).
    PROPOSED: Status left in `--text-3`; actions as two 24px icon buttons (collapse-all, refresh) right-aligned with tooltips.
    SEVERITY: paper cut.

11. **"Estimates" appears twice in 24px.**
    WHERE: sidebar header "🧮 Estimates" (y≈44) and breadcrumb root "Estimates › CEILING SCOPE" (y≈69).
    WHAT: The header is the breadcrumb root. The calculator icon is decorative.
    PROPOSED: Breadcrumb *is* the header: "Estimates › CEILING SCOPE" at 13px in the 40px header band; drop the separate header row; recover 32px.
    SEVERITY: major.

12. **Two "+ Add scope" buttons 110px apart.**
    WHERE: right of "Scopes 3" header, and again below the list.
    PROPOSED: One, in the header. If you want a bottom affordance, make it a ghost row "+ Add scope" inside the list at `--row-sm`, not a second button.
    SEVERITY: major.

13. **Scope colour dots use the brand red, twice.**
    WHERE: BLUE (red dot), TROUGHS (red dot), CL04 (purple).
    WHAT: Two scopes share a colour, and it's the brand/danger red; the toolbar's scope chip then shows a red dot next to an accent-blue button. (BLUE being red is data, but the defaults let it happen.)
    PROPOSED: Scope palette = 10–12 hues excluding the brand red and the accent hue; auto-assign the next unused hue; warn on duplicates.
    SEVERITY: major (colour discipline).

14. **Scope row title not aligned to the section title.**
    WHERE: "Scopes" text starts at x=58 (crop); the dot starts at 58 and the scope name at 93.
    WHAT: Header text and row text should share a left edge; the dot should sit in the gutter.
    PROPOSED: 12px gutter for the dot, title at the same x as "Scopes".
    SEVERITY: paper cut.

15. **Count badges in three positions and two sizes.**
    WHERE: "Scopes 3" (tiny, mono, hugging the button), "Pinned 2" (right-aligned at edge), pinned rows "4", "2" (body size, right-aligned), tree counts "58" (body size).
    PROPOSED: One count style: 11px tabular `--text-3`, right-aligned to the content edge, 8px from the trailing control.
    SEVERITY: paper cut.

16. **The second "Add scope" is 4px out of alignment with the first.**
    WHERE: bottom button right edge x≈1001 vs header button x≈1005 (crop px).
    SEVERITY: paper cut.

17. **"Pinned" rows: file icon, full-caps truncated name, unexplained trailing number.**
    WHERE: "A-351A-FLOOR-01--SECTOR-A-EXTERIOR-REFLECT… 4".
    WHAT: What is 4? Markups? Scopes? Also the rail truncates the same name at 22 chars, the sidebar at 38 — the same document has two names.
    PROPOSED: Show sheet number "A-351A" as primary with title secondary; count gets a tooltip or a unit ("4 markups").
    SEVERITY: paper cut.

18. **Toolbar active-tool indicator = raised tile + accent underline.**
    WHERE: hand tool, group 1.
    WHAT: Double signal; the rail uses a left bar; doc tabs use an underline.
    PROPOSED: Underline only (2px accent, 16px wide, 2px radius), no fill; hover = fill.
    SEVERITY: paper cut.

19. **Chevron weights: four.**
    WHERE: tree "⌄" 1px; sidebar row "›" 1px; toolbar "^" 2px bold; breadcrumb "›" 1px; d9 selects "⌄" 2px.
    PROPOSED: One 16px Fluent `ChevronDown/Right/Up` at 1.5px stroke everywhere.
    SEVERITY: paper cut.

20. **Group 3 has an internal divider, group 1 doesn't; group 4 reads as a different control.**
    WHERE: toolbar. Page nav | zoom share a pill with a divider; hand/select/marquee share a pill without one; "Unset ^" is a dropdown in muted `--text-3` while "TROUGHS ^" is a dropdown in white semibold.
    PROPOSED: Dividers only between *unrelated* clusters inside a pill (keep the one in group 3); dropdown labels always `--text-1` regular; the unset scale gets a warning dot, not muted text.
    SEVERITY: paper cut.

21. **"Unset" is jargon for the most important number on the sheet.**
    WHERE: group 4.
    PROPOSED: "No scale" with a warning-coloured ruler icon; once set, the ratio in `--text-1`.
    SEVERITY: major.

22. **"Take off" (button) vs "Takeoff" (Settings nav, d10) vs "takeoff" (prompt copy, d4).**
    WHERE: across surfaces.
    WHAT: The product's core verb/noun is spelled three ways.
    PROPOSED: Noun "takeoff", verb "take off" — then use the verb on the button and the noun in nav. Write it in a glossary.
    SEVERITY: major.

23. **Title-bar tab has a chevron; document tabs have ×; "+" has no obvious meaning.**
    WHERE: "MSK Podium 1233 York Ave NYC ⌄" | "+".
    WHAT: Chevron opens a project switcher; "+" — new project? new document? Nothing is labelled.
    PROPOSED: Tooltip "Open another sheet (Ctrl+T)"; project tab gets the mark, not a folder glyph.
    SEVERITY: paper cut.

24. **Sidebar toggle exists for the right panel only.**
    WHERE: split-rect icon at the window-control cluster.
    PROPOSED: Symmetric toggles (left rail / right sidebar), or move both into Ctrl+K and drop the icon.
    SEVERITY: paper cut.

25. **Sidebar and rail header rows don't align.**
    WHERE: rail tab strip centre y≈60 CSS, filter field y≈100; sidebar header y≈56, breadcrumb y≈88, H1 y≈128.
    WHAT: Panels side by side with different vertical rhythms.
    PROPOSED: Both panels: 40px header band, then content on an 8px grid.
    SEVERITY: paper cut.

---

## d4 — Command prompt, scope hub (CL04)

1. **Prompt is vertically centred and covers the sheet.**
    WHERE: 596×700 CSS px dialog centred at y≈700.
    WHAT: Command palettes sit near the top so the content stays referenceable; here the drawing is scrimmed *and* covered. The prompt also changes height between steps (d5) and re-centres, so the input jumps ≈120px.
    PROPOSED: Anchor at top: 96px from the tab strip, fixed width 640px, max-height 60vh; no scrim (or 20% at most) so the sheet stays readable.
    SEVERITY: major.

2. **Chevrons on both ends of every row.**
    WHERE: "›" at x=70 (crop) on every item and "needs a choice ›" on the right of most.
    WHAT: The left chevron says "this drills in"; the right one says it again; the trailing ellipsis in "Configure…" says it a third time.
    PROPOSED: Drop the left chevron. Keep either the ellipsis or a trailing chevron, not both. "needs a choice" becomes a hint only where the *next* step differs (e.g. "3 sheets").
    SEVERITY: major.

3. **Descriptions in monospace.**
    WHERE: "area tool, drawing into CL04", "freeze the count as it stands", "its 3 markups stay and come back if you restore it".
    WHAT: Prose in a code face. Only "#8000ff" earns mono.
    PROPOSED: UI face 12px `--text-2`; mono only for literals.
    SEVERITY: major.

4. **Colour shown as a hex string.**
    WHERE: "Colour…  #8000ff".
    PROPOSED: 12px swatch + name/hex.
    SEVERITY: paper cut.

5. **Enter hint shows data instead of a verb.**
    WHERE: footer "↵ Baffle · 3 markups".
    WHAT: The Enter key's label is the scope subtitle. On d5 it is "↵ of CL04". This is the item's context leaking into the key legend.
    PROPOSED: "↵ open" / "↵ run"; the context lives in the header row.
    SEVERITY: paper cut (reads as a bug).

6. **Header row duplicates the chip.**
    WHERE: chip "CL04" in the input, then "CL04 … Baffle · 3 markups" as a header line.
    PROPOSED: Keep the header (it carries the subtitle), drop the chip's outline so it reads as a breadcrumb crumb, or merge: chip becomes "CL04 · Baffle · 3 markups".
    SEVERITY: paper cut.

7. **"step 1" label unexplained and off to the right.**
    WHERE: right of the input.
    PROPOSED: Drop it; the chips *are* the step indicator.
    SEVERITY: paper cut.

8. **Item casing/punctuation drift.**
    WHERE: "Take off" (enters a mode, no ellipsis), "Set direction on the sheet" (starts a draw, no ellipsis), "Rename…" (ellipsis + "needs a name"), "Open in the sidebar".
    PROPOSED: Ellipsis iff more input is required before anything happens. "Take off" and "Set direction on the sheet" then get ellipses or a "draws on the sheet" hint, consistently.
    SEVERITY: paper cut.

9. **Row height 46px vs list rows elsewhere.**
    WHERE: items at 46px pitch with a 16px title + 12px mono subtitle.
    PROPOSED: 40px rows (`--row-lg`) with 14px title / 12px subtitle. Selected row: fill + 2px accent left bar is fine here since it matches the rail — but see the cross-cutting note on indicator placement.
    SEVERITY: paper cut.

10. **Placeholder "Choose · CL04" uses the middle dot as punctuation and repeats the chip.**
    PROPOSED: "Type a command or filter…".
    SEVERITY: paper cut.

11. **Sidebar totals appear here but were missing on d3.**
    WHERE: "1,386.4 SF / 0 SF / 266.1 SF" on the scope rows.
    WHAT: Same rows, same project, no totals on d3 (no document open). Whether that's loading order or a computation gate, the user sees numbers come and go.
    PROPOSED: Totals always present; skeleton while computing.
    SEVERITY: major.

12. **Rail search icon gained a blue ring.**
    WHERE: top-right of the rail tab strip.
    WHAT: Looks like a progress ring around the search icon; nothing explains it.
    PROPOSED: If it's "indexing", show a small spinner in the status row ("Indexing 12/90"), not around a tab icon.
    SEVERITY: paper cut.

13. **Document tab: accent underline + accent icon + raised tab.**
    WHERE: "A-351A-FLOOR-01--SECTOR…" tab.
    WHAT: Three cues for one state; the icon turning accent-blue is unusual.
    PROPOSED: Raised tab + underline; icon stays `--text-2`.
    SEVERITY: paper cut.

---

## d5 — Prompt, Markups step

1. **Numbers formatted differently 500px apart.**
    WHERE: "area · 1260.5 SF" (prompt) vs "1,386.4 SF" (sidebar).
    PROPOSED: One formatter: thousands separators, one decimal, tabular figures, unit in `--text-2`.
    SEVERITY: major.

2. **Every row carries "needs a choice ›".**
    WHERE: all three markup rows.
    WHAT: When every row says it, it says nothing.
    PROPOSED: Remove; the chips already tell you you're inside a step.
    SEVERITY: paper cut.

3. **Subtitle means two different things.**
    WHERE: rows 1–2 show the sheet filename (mono, caps, truncated); row 3 shows "TE-2" (a label).
    PROPOSED: Fixed columns: kind · quantity · sheet (short id "A-351B p1") · label.
    SEVERITY: paper cut.

4. **Lowercase kinds.**
    WHERE: "area", "cutout".
    PROPOSED: "Area", "Cutout" (sentence case like every other label), or render kind as an icon (d9 already has the pentagon).
    SEVERITY: paper cut.

5. **Chip states: current step outlined, previous plain — but the outline colour is the accent used for focus.**
    WHERE: "Markups" chip vs input focus ring, both accent blue, 8px apart.
    PROPOSED: Chips use `--fill-subtle`; the current one gets `--text-1` weight semibold; leave accent for the focus ring.
    SEVERITY: paper cut.

6. **Prompt height collapses and re-centres between steps** — see d4.1.
    SEVERITY: major (counted once).

---

## d6 — Drawing open, markup selected

1. **Selection has no feedback beyond handles.**
    WHERE: selected area (blue-hatched region top-centre): a 1px light-blue outline with 6px white squares at corners.
    WHAT: Nothing in the sidebar highlights CL04, nothing shows the area's quantity, and the toolbar's scope chip still says TROUGHS while a CL04 markup is selected. The outline is nearly invisible against the blue fill.
    PROPOSED: Selection outline 2px accent with a 1px dark halo; a selection pill near the toolbar ("Area · 1,260.5 SF · CL04"); sidebar row for CL04 gets a subtle highlight.
    SEVERITY: major.

2. **Two tree rows look selected.**
    WHERE: "A-764 - PLAN-DETAILS…" (raised fill, white text) and "A-351B-FLOOR-01…" (raised fill + accent bar + accent icon + external-link icon).
    WHAT: One is presumably keyboard focus / last click; the other is the open document. A reader sees two selections.
    PROPOSED: Focus = 1px inset ring only; open document = accent bar + `--text-1`; hover = fill. Never fill for focus.
    SEVERITY: major.

3. **Floating toolbar occludes the sheet's bottom edge.**
    WHERE: toolbar at y≈1352–1380 CSS over the grid bubbles "2 3 … 6 7" and the title-block bottom.
    WHAT: Fit-to-page fits to the viewport, then the toolbar covers 60px of it.
    PROPOSED: Fit-to-page subtracts a 72px bottom inset; or dock the toolbar with 8px reserved.
    SEVERITY: major.

4. **Toolbar shifts as labels change.**
    WHERE: group 4 grew from "Unset" (d3) to `1" = 3'-9"` (d6) and the whole bar re-centred ≈30px.
    PROPOSED: Fixed min-width for the scale group (≈120px) and the scope chip (≈140px); toolbar centred on the canvas, not on the union of variable groups.
    SEVERITY: paper cut.

5. **Scale ratio in monospace muted; scope in bold white; page in muted.**
    WHERE: `1" = 3'-9"` `--text-3` mono; "TROUGHS" `--text-1` semibold; "1/1" `--text-3`.
    PROPOSED: All toolbar text `--text-1` regular 13px, tabular figures; mono nowhere in the toolbar.
    SEVERITY: paper cut.

6. **"open externally" icon appears on the active tree row only.**
    WHERE: right end of the A-351B row.
    WHAT: Discoverable only after opening; other rows never show it.
    PROPOSED: Hover-reveal on every row, or move to the context menu.
    SEVERITY: paper cut.

7. **Inactive tab has no close; active tab close × is 12px with no hover target visible.**
    PROPOSED: Close on hover for inactive tabs; 24px hit area.
    SEVERITY: paper cut.

8. **Document tabs truncate to ≈18 characters.**
    WHERE: "A-351A-FLOOR-01--SE…" / "A-351B-FLOOR-01---SE…".
    PROPOSED: Tab label = sheet number ("A-351A") with title in tooltip; tabs at 160px max.
    SEVERITY: paper cut.

---

## d7 — Right-click on empty sheet

1. **Menu header "The drawing".**
    WHERE: first line, `--text-3`.
    WHAT: Fluent menus don't title themselves; "The drawing" is a definite article looking for a sentence.
    PROPOSED: No header; or "This sheet" if the menu grows sections.
    SEVERITY: paper cut.

2. **"Convert all 101 PDF markups on this sheet" — into what?**
    WHERE: item 1.
    WHAT: On d8 the convert action asks for a target scope; here it doesn't say. Also, converting 101 things is a heavy, undoable-hopefully action with no ellipsis.
    PROPOSED: "Convert all 101 PDF markups into CL04…" (current scope, with ellipsis → confirm dialog).
    SEVERITY: major.

3. **"Trace the region here as an area" — "here" and "region".**
    PROPOSED: "Trace an area starting here" / "Draw area here".
    SEVERITY: paper cut.

4. **Menu radius 12px, padding 12/16, item height 27px.**
    WHAT: Fluent menu is 8px radius, items 32px, 4px inset. 27px is off-grid and denser than any other row.
    PROPOSED: Items 32px, icons 16px in a 24px column, 8px radius.
    SEVERITY: paper cut.

5. **No accelerators or shortcut hints.**
    PROPOSED: Right-aligned key hints (e.g. "A" for area tool).
    SEVERITY: paper cut.

6. **Menu positioned 8px above and left of the click point** (top-left corner not at cursor).
    SEVERITY: paper cut.

---

## d8 — Right-click on a Bluebeam markup

1. **Menu material differs from d7.**
    WHERE: this menu is translucent (magenta shows through); d7's is opaque grey.
    WHAT: Two materials for the same component, and the translucent one puts `--text-1` over saturated magenta.
    PROPOSED: One material. Acrylic only over the app chrome, never over the sheet; if acrylic is kept, 90%+ opacity.
    SEVERITY: major (legibility).

2. **Two sections say "convert this markup" with different grammar.**
    WHERE: "Convert 1 selected PDF markup into › CL04 / BLUE / TROUGHS" and, after a divider, "1 PDF markup here › Convert polygon “Area Measurement” to an area".
    WHAT: The same object is described twice ("1 selected", "1 here") and the second convert has no visible target. The user can't tell if the second row converts into the *current* scope or into nothing.
    PROPOSED: One section: "Convert “Area Measurement” into" › scope rows with the current scope checked; "Convert all 101 markups on this sheet…"; "Trace an area here".
    SEVERITY: major.

3. **Current scope not indicated in the scope submenu.**
    WHERE: CL04 / BLUE / TROUGHS rows — no check, no "current".
    PROPOSED: Check mark or "(current)".
    SEVERITY: paper cut.

4. **Icon column misaligned.**
    WHERE: scope dots centred at x≈95 (crop), pentagon/copy/target icons at x≈110.
    PROPOSED: 24px icon column; dots centred in it.
    SEVERITY: paper cut.

5. **Quotation marks around the PDF subject.**
    WHERE: “Area Measurement”.
    WHAT: Curly quotes are correct, but the Bluebeam subject is often generic ("Area Measurement" ×101); it doesn't identify anything.
    PROPOSED: "Convert this polygon into…"; show subject only if non-default.
    SEVERITY: paper cut.

6. **Scope list rows in the menu are 36px; action rows 27px.**
    PROPOSED: 32px both.
    SEVERITY: paper cut.

---

## d9 — Scope page in the right sidebar

1. **Tabs and accordions for the same content.**
    WHERE: tab strip "Parts 5 · Setup · Markups 3" (accent underline on Parts), then all three as collapsible sections stacked beneath.
    WHAT: Two navigations for one column. The tabs look like they should switch content but everything is already shown.
    PROPOSED: Keep the accordions with sticky headers; turn the tab strip into a sticky "jump bar" that scrolls (and highlights on scroll-spy), or cut it.
    SEVERITY: major.

2. **"unverified" inline in the part name, in yellow, on every row.**
    WHERE: "Installed length unverified", ×5.
    WHAT: The status is typographically part of the name; yellow (#FFD700-ish) is a new colour with no token; five identical badges carry zero information.
    PROPOSED: Status column with a 12px icon (warning triangle `--warning`) and a tooltip; or a single banner "5 parts unverified · Verify" above the table.
    SEVERITY: major.

3. **Second "Take off" CTA.**
    WHERE: accent button in the scope header, while the toolbar (d6) also shows "Take off".
    PROPOSED: One CTA. Keep the toolbar's; the sidebar header gets a ghost "Take off" only when the toolbar is hidden.
    SEVERITY: major.

4. **Scope header tinted in the scope colour.**
    WHERE: purple left bar + purple-tinted fill behind "CL04 · Baffle · 3 markups".
    WHAT: With a red scope this header will look like an error banner; with brand red it will look like brand. The left bar also collides with the accent left bar used for selection in the rail (two meanings of "left bar").
    PROPOSED: 8px colour dot + name; no tint. Left bars mean "selected" only.
    SEVERITY: major.

5. **Three numeral treatments.**
    WHERE: KPI "1,386.4" 24px mono bold; table "4,165.8" 13px mono; prompt "1260.5" proportional; d3/d4 rows "1,386.4 SF" mono 12px.
    PROPOSED: UI face with `font-variant-numeric: tabular-nums`; KPI 24px semibold, table 13px regular. Mono retired for numbers.
    SEVERITY: major.

6. **"Set on the sheet" button wraps to two lines.**
    WHERE: Direction row, right-hand button.
    PROPOSED: Icon-only 32px button with tooltip, or "Set…" ; never allow wrap (`white-space: nowrap`).
    SEVERITY: major (looks broken).

7. **"set for this sheet · defaul…" truncates the value.**
    WHERE: Direction row.
    PROPOSED: Two lines: "For this sheet" / "Default 0°"; or a value chip.
    SEVERITY: paper cut.

8. **Two label styles in one form.**
    WHERE: "Spacing OC · centre to centre" (muted key + normal explanation) vs "Yield", "Seams", "Product" (plain bold-ish).
    PROPOSED: One: label `--text-2` 12px; explanation as placeholder or tooltip.
    SEVERITY: paper cut.

9. **Spreadsheet grid lines around form cells.**
    WHERE: 1px vertical and horizontal rules between Spacing/Stock, Conn./Profile, Yield/Seams.
    PROPOSED: Remove rules; 16px gutter; 12px row gap.
    SEVERITY: paper cut.

10. **Disabled field looks enabled.**
    WHERE: "Profile W · face width" shows "—" in the same outlined box as live fields.
    PROPOSED: `--fill-disabled`, `--text-3`, no border; or hide it for products without a profile.
    SEVERITY: paper cut.

11. **Lowercase select values.**
    WHERE: "full", "aligned".
    PROPOSED: "Full", "Aligned".
    SEVERITY: paper cut.

12. **"Name" and colour swatch buried at the bottom of Setup.**
    WHERE: after Direction.
    PROPOSED: Rename via the header ("…" menu or click-to-edit), colour via the dot. Remove from Setup.
    SEVERITY: paper cut.

13. **"5 lines", "3 on 2 sheets" in monospace section counts.**
    PROPOSED: "5", "3 · 2 sheets" in the standard count style.
    SEVERITY: paper cut.

14. **Markups group labels: "Page 1 · Page 1" vs a wrapped 70-char filename.**
    WHERE: two group headers.
    WHAT: First is a placeholder pattern (doc name missing → page repeated); second is the full filename with ".pdf · p1".
    PROPOSED: "A-351B · p1" / "A-351A · p1"; full name in tooltip.
    SEVERITY: major (reads as a bug).

15. **Group-by segmented control uses raised fill for selected; toolbar uses underline.**
    PROPOSED: Segmented control is fine with fill — but then the toolbar tool group should use the same idiom, or vice versa.
    SEVERITY: paper cut.

16. **"Not committed." with a period and "Commit" as an accent link.**
    WHERE: info row under the KPIs.
    WHAT: A third link style (see d1.3). The period on a status label is inconsistent with "Reading the folder…" (no period) and "90 documents" (no period).
    PROPOSED: Status labels never end in a period; "Commit" becomes a 32px secondary button.
    SEVERITY: paper cut.

17. **Footer actions "Duplicate" / "Remove from estimate" vs prompt's "Duplicate" / "Archive".**
    WHAT: The same operations have different names on two surfaces (or they're different operations, which is worse).
    PROPOSED: Same verbs everywhere; "Archive" if it is reversible, "Remove…" only if it deletes.
    SEVERITY: major.

18. **Destructive footer action not differentiated.**
    WHERE: "Remove from estimate" is `--text-1` with a trash icon, identical weight to "Duplicate".
    PROPOSED: `--danger` on hover, ellipsis (confirm).
    SEVERITY: paper cut.

19. **Toggle row "Show the layout on the sheet" sits inside the Parts card but visually belongs to Setup.**
    PROPOSED: Move to Setup, or make it a toolbar overlay toggle.
    SEVERITY: paper cut.

20. **Breadcrumb "CEILING SCOPE" in caps at 12px is the estimate name; H1 removed on this page.**
    WHAT: The estimate page (d3) had an H1; the scope page has none — the header card takes its place. Two page templates.
    PROPOSED: One template: breadcrumb band, then a header row (name + actions), then sections.
    SEVERITY: paper cut.

---

## d10 — Settings › General

1. **Settings hijacks the document tabs.**
    WHERE: tab strip still shows "A-351B-FLOOR-01---SE…" as the active tab while the content is Settings.
    WHAT: Active tab ≠ visible content.
    PROPOSED: Settings as its own tab (Fluent/Edge pattern) or as a modal sheet; never under another tab's underline.
    SEVERITY: major.

2. **28px display heading is the largest type in the app by 8px.**
    WHERE: "Settings › General".
    WHAT: Type scale: 28 here, 20 on the start card, 16 in the sidebar H1, 13 body. 28 is not on the scale.
    PROPOSED: 20px semibold, breadcrumb root in `--text-2`.
    SEVERITY: paper cut.

3. **Breadcrumb-as-heading differs from the sidebar's breadcrumb-then-H1.**
    PROPOSED: One breadcrumb component (12px band) + one page title component (20px).
    SEVERITY: paper cut.

4. **Every setting has the same folder icon.**
    WHERE: three folder glyphs, one per card.
    PROPOSED: Drop icons on settings cards.
    SEVERITY: paper cut.

5. **Nav counts show number of settings.**
    WHERE: General 3, Drawing 1, Takeoff 11, Performance 1.
    WHAT: Nobody needs the count; a "changed" badge would help.
    PROPOSED: Show a dot/count only for changed settings; "Reset all · 1 changed" already exists — link the two.
    SEVERITY: paper cut.

6. **Input styles: filled here, outlined in the scope page.**
    WHERE: "40" box (filled, no border) vs d9 "4″" (outlined).
    PROPOSED: One input token.
    SEVERITY: paper cut.

7. **Value casing: "Off" vs "never".**
    PROPOSED: "Never".
    SEVERITY: paper cut.

8. **Descriptions are long and end with an orphaned "(~)."**
    WHERE: "Recent projects kept" card.
    PROPOSED: One line each; the "~" hint moves to a tooltip on the prompt.
    SEVERITY: paper cut.

9. **Setting cards 8px apart, sections 24px — but the first card is 12px under its header, the second 16px.**
    PROPOSED: 8px header→card, 8px card→card, 32px section→section.
    SEVERITY: paper cut.

10. **Nav icons: folder (General), document (Drawing), target (Takeoff, same glyph as the Take off button), pen (Performance).**
    PROPOSED: Fluent `Settings`, `Document`, `Ruler`/`Target`, `Speedometer`/`TopSpeed`.
    SEVERITY: paper cut.

11. **Sidebar toggle icon persists while the sidebar is unavailable.**
    SEVERITY: paper cut.

12. **Content column left-aligned at 44px with 1,800px of empty space.**
    PROPOSED: Column max-width 720px, centred in the pane, or a two-column layout with the nav.
    SEVERITY: paper cut.

---

## d11 — Takeoff mode toolbar

1. **Toolbar reflows when entering takeoff.**
    WHERE: group 2 replaces "Take off" with seven icons + two dividers; group 1 slid left ≈60px.
    WHAT: The tools the user was aiming at move.
    PROPOSED: Keep the mode toggle where "Take off" was and *extend* the bar to the right; or give group 2 a fixed width in both states.
    SEVERITY: major.

2. **Seven unlabelled glyphs, at least two unfamiliar.**
    WHERE: pentagon, scissors, ruler(?), a "count" tag, a funnel/cone, compass, ×.
    WHAT: No tooltips visible; no letter hints. Ruler vs the ruler in group 4 (scale) look alike.
    PROPOSED: Tooltips with shortcut letters on hover; consider tiny labels under icons in this mode only (Bluebeam-style), since these are the working tools.
    SEVERITY: major.

3. **Mixed icon sets.**
    WHERE: scissors and pentagon are thin 1px; ruler and count are 1.5px filled; × is thin; compass is a circle with a bar.
    PROPOSED: One set (Fluent System Icons Regular, 16px, 1.5px).
    SEVERITY: major.

4. **The exit "×" lives with the tools.**
    WHERE: last item in group 2.
    WHAT: "Leave mode" next to "cutout tool"; accidental exits.
    PROPOSED: Exit via Esc and via the scope chip's menu, or as a separate small pill at the far right.
    SEVERITY: paper cut.

5. **Mode radio is split across two pills.**
    WHERE: hand/select/marquee (group 1) and area/cutout/… (group 2) are one mutually exclusive set; only the pentagon shows the underline.
    PROPOSED: Either merge into one pill in takeoff mode, or make the split explicit: group 1 = "navigate", group 2 = "draw", with the active one visibly owning the underline and the other dimmed.
    SEVERITY: paper cut.

6. **Scope chip uses the scope colour dot next to an accent-selected tool.**
    WHERE: purple dot, accent underline 40px apart.
    PROPOSED: Fine for purple; with a red scope you'd have red + accent + brand in 100px. Reinforces d3.13.
    SEVERITY: paper cut.

7. **Toolbar still occludes the sheet** (see d6.3).

---

## Cross-cutting

- **Indicator placements:** left bar (rail tab, prompt row, settings nav), bottom bar (toolbar tool, doc tab), scope-coloured left bar (scope header), fill-only (tree focus). Pick: selection = left bar in lists, active = underline in tab/tool strips, never both, never in a non-accent colour.
- **Greys:** at least four secondary text greys (tree labels, sidebar subtitles, prompt mono subtitles, settings descriptions) and two panel fills. Tokenise `--text-1/2/3` and `--fill-1/2/3`.
- **Monospace:** used for paths, hex, prompt prose, quantities, KPIs, counts, scale ratio. Restrict to literals; numbers get tabular figures in the UI face.
- **Row heights:** 20 / 23 / 24 / 27 / 31 / 36 / 40 / 46. Three tokens: 24 / 32 / 40 (48 for two-line cards).
- **Chevrons:** four weights. One glyph.
- **Casing/vocabulary:** Take off / Takeoff / takeoff; Archive vs Remove from estimate; forget vs remove data; Unset; "The drawing". Write a 20-term glossary.
- **Number format:** "1,386.4" vs "1260.5". One formatter.
- **Colour:** brand red is also a scope colour; scope colour tints a header; yellow appears once for "unverified". Reserve red for brand, accent for interactive, define `--warning`, and give scopes their own palette.
- **Empty/loading states:** canvas has none; Pinned/Markups have none; totals flicker between d3 and d4.
- **Truncation:** end-ellipsis, middle-ellipsis, and wrap all used for the same filenames; the same sheet has three visible names (rail, tab, sidebar).

---

## Top 10 for my persona

1. **One mark, everywhere** — replace the peach title-bar icon with the RB mark; put it on the start window too (d1.1, d3.1).
2. **Retire monospace for prose and numbers; adopt tabular figures and one number formatter** (d4.3, d5.1, d9.5).
3. **Three row-height tokens (24/32/40) and one section-header component** across tree, sidebar, prompt, settings, menus (d3.6, d1.8).
4. **One selection idiom** — left bar for lists, underline for tab/tool strips, no double signals, no scope-coloured bars (d3.9, d3.18, d9.4).
5. **Scope colour palette that excludes brand red and the accent**, no header tinting (d3.13, d9.4).
6. **Prompt anchored to the top, fixed width, no per-step re-centring, one chevron per row, prose subtitles** (d4.1, d4.2).
7. **Tree: compact single-child chains, real folder glyphs, 24px rows, overlay scrollbar, sheet-number-first labels** (d3.3–3.7).
8. **Scope page: pick accordions *or* tabs; status as a column not inline yellow; fix the wrapping "Set on the sheet" button; unify Archive/Remove** (d9.1, 9.2, 9.6, 9.17).
9. **Toolbar: fixed group widths so nothing reflows on mode change; one icon set with tooltips; reserve bottom inset in fit-to-page** (d11.1–3, d6.3).
10. **Vocabulary and links: "take off / takeoff" glossary, one link style, one button hierarchy (accent primary only), sentence case everywhere** (d1.3, d2.2, d3.22, d10.7).
