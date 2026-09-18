# REDBEAM — WinUI 3 / Fluent 2 conformance review

Reviewer persona: Windows 11 / WinUI 3 design specialist.
Inputs: d1–d11.png, 3840x2088 at 150 % scaling (1 CSS px = 1.5 image px). Measurements below are in CSS px, rounded from the native crops.
Reference set: Fluent 2 design tokens, WinUI 3 Gallery controls, Segoe UI Variable type ramp (Caption 12 / Body 14 / Body Strong 14 / Subtitle 20 / Title 28), 32 px control height, 4 px ControlCornerRadius, 8 px OverlayCornerRadius, Mica base layer, ThemeShadow on flyouts.

Severity scale: **blocker** = would be rejected in a Windows app review / breaks a core WinUI expectation; **major** = clearly non-native, most users will notice; **paper cut** = small deviation, cumulative.

---

## 0. Cross-cutting findings (apply to every screenshot)

**G1. Accent colour is neither the system accent nor the brand.**
WHERE: every accent surface — "Open a drawing set…", "Take off", tab underline, NavigationView-style selection pills, tree selection indicator, prompt focus ring, InfoBadge numerals.
WHAT: a hard-coded light-blue (≈ #4CC2FF) is used everywhere while the app identity (RB tile in d1) is red. WinUI apps either (a) bind to the user's system accent (`UISettings.GetColorValue(UIColorType.Accent)` → `AccentFillColorDefault`) or (b) declare a single app accent and generate the full Fluent ramp (Default / Secondary / Tertiary / Disabled, plus `TextOnAccentFillColorPrimary`). The project's own .pen comps specify red for brand/nav/focus, so the current blue is a third, undocumented choice.
GUIDELINE: Fluent 2 "Color → Accent", `AccentFillColor*` tokens.
PROPOSED: pick one. If brand red: define `--accent-default`, `--accent-secondary` (90 % opacity), `--accent-tertiary` (80 %), `--accent-disabled`, and verify `TextOnAccent` contrast ≥ 4.5:1 (white on the brand red). If system accent: read it once at startup from Tauri (`window-vibrancy`/`windows` crate `UISettings`) and inject as CSS custom properties. Apply the same token to *all* selection indicators.
SEVERITY: major.

**G2. Base layer is flat paint, not Mica.**
WHERE: window background in d1/d2, title bar and tab strip in d3–d11, Settings page in d10.
WHAT: a flat #1c1c1c / #202020. Windows 11 apps use Mica on the window base (title bar + navigation pane) and `LayerFillColorDefault` for content layers on top.
GUIDELINE: Fluent 2 "Materials → Mica", WinUI `SystemBackdrop`.
PROPOSED: in Tauri set `window.set_effects(Effects::Mica)` with a transparent WebView2 background (`background_color: transparent`), then paint content panes with `LayerFillColorDefault` (rgba(58,58,58,0.3) in dark) and cards with `CardBackgroundFillColorDefault`. Fall back to `SolidBackgroundFillColorBase` (#202020) when Mica is unavailable.
SEVERITY: major.

**G3. Secondary text falls below the Fluent contrast tokens.**
WHERE: "Baffle · 3 markups", tree file names, path lines, setting descriptions, menu group headers ("The drawing"), toolbar page counter "1/1".
WHAT: secondary text is rendered around #8E8E8E–#9A9A9A on #202020–#2B2B2B (≈ 3.6–4.0:1). Fluent `TextFillColorSecondary` in dark is rgba(255,255,255,0.786) (≈ #C9C9C9, 10:1) and `TextFillColorTertiary` is 0.545 (≈ #8B8B8B) and is reserved for placeholders/disabled.
GUIDELINE: Fluent 2 text fill tokens; WCAG 1.4.3.
PROPOSED: map "secondary" to `TextFillColorSecondary`, use `TextFillColorTertiary` only for placeholder text and disabled controls. Same for `TextFillColorDisabled` (0.363).
SEVERITY: major (accessibility).

**G4. Monospace is used as a general-purpose "data" typeface.**
WHERE: paths (d1), hub descriptions and hints (d4/d5), all numeric columns (d3 sidebar, d8/d9 Parts, Markups, big stat numbers), zoom "50%", scale "1" = 3'-9"", counts "5 lines", "3 on 2 sheets".
WHAT: WinUI has no monospace role in the type ramp; alignment of numbers is achieved with Segoe UI Variable + tabular figures. Monospace lower-case descriptions ("freeze the count as it stands") read as terminal output, not Windows UI.
GUIDELINE: Segoe UI Variable type ramp; "Typography → numerals".
PROPOSED: `font-family: "Segoe UI Variable Text", "Segoe UI"` with `font-variant-numeric: tabular-nums` on numeric cells; keep monospace only for literal file paths and the `redbeam.db` code span. Big stats → Subtitle (20 semibold) or Title (28), unit in Caption (12) `TextFillColorSecondary`.
SEVERITY: paper cut (but it is the single most pervasive one).

**G5. Scrollbars are the WebView2 defaults.**
WHERE: Files tree (d3–d11 left), prompt list (d4).
WHAT: 12 px classic bars with arrow buttons, always visible. WinUI ScrollBar is a 2 px "indicator" rail that expands to 6 px on hover with the arrows appearing only then.
GUIDELINE: WinUI `ScrollViewer` / `ScrollBar` (Fluent 2 "Scrolling").
PROPOSED: `::-webkit-scrollbar` styling: 12 px reserved gutter, 2 px thumb `ControlStrongFillColorDefault` at rest, 6 px on hover, no buttons; or implement an overlay indicator that auto-hides after 1 s idle.
SEVERITY: major.

**G6. Keyboard focus visuals not evident.**
WHERE: everywhere a control could hold focus (d4 shows an accent ring around the text field, but that is a "focused" visual for the text box, not the WinUI focus rect).
WHAT: WinUI keyboard focus is a 2 px `FocusStrokeColorOuter` (white in dark) + 1 px inner (black) double ring, shown only for keyboard/programmatic focus (`:focus-visible`).
GUIDELINE: Fluent 2 "Focus".
PROPOSED: global `:focus-visible { outline: 2px solid var(--focus-outer); outline-offset: 1px; box-shadow: 0 0 0 1px var(--focus-inner) inset; }` and remove pointer-triggered focus rings.
SEVERITY: major (cannot fully verify from stills; confirm with Tab navigation).

**G7. Custom title bar lacks the app identity and Mica caption area.**
WHERE: top strip in d1–d11.
WHAT: d1 shows an empty title bar with only caption buttons; d3+ shows a provisional orange fruit icon that does not match the red "RB" tile. WinUI custom title bars keep a 16 px app icon + title (or the TabView occupies the drag region with the icon at left).
GUIDELINE: WinUI "Title bar" guidance (`AppWindowTitleBar`, drag regions, 48 px min drag region height).
PROPOSED: one icon asset (the red RB) at 16 px in the title bar, `data-tauri-drag-region` across the tab strip's empty space, caption-button colours from `WindowCaptionBackground/Foreground` tokens.
SEVERITY: paper cut (icon), major (drag region if not present — verify).

---

## 1. d1.png — Start screen

1. **Start screen is a floating dialog on a void.**
   WHERE: 560 × 300 px card centred in an otherwise empty 2560 × 1392 window.
   WHAT: nothing establishes app chrome; the card reads as a modal `ContentDialog` with no parent. Windows 11 start experiences (Terminal, Dev Home, Files, Photos) are full pages on Mica with a left NavigationView or a two-column landing.
   GUIDELINE: WinUI "Page layout", Mica base.
   PROPOSED: make the start screen a Page: Mica window, Title 28 "REDBEAM" top-left, primary actions as `Button` row, Recent as a `ListView` on a `LayerFillColorDefault` content layer; keep width ≤ 1000 px and left-aligned at 48 px page margins rather than centred.
   SEVERITY: major.

2. **"Open a drawing set…" is full-width accent, "Open a project folder…" is a narrow standard button.**
   WHERE: buttons at y ≈ 470.
   WHAT: WinUI buttons size to content (min-width 120) and sit in a row with 8 px gap; a stretched accent button is a web pattern. Both actions are equally weighted "Open" verbs so only one should be accent (fine) but neither should stretch.
   GUIDELINE: `Button`, `AccentButtonStyle`, Fluent "Buttons → Layout".
   PROPOSED: `Button` 32 px tall, padding 11/5, `min-width: 120px`, horizontal `StackPanel` spacing 8; accent on the first only.
   SEVERITY: paper cut.

3. **Inline underlined links "rename / forget / remove data".**
   WHERE: right side of each Recent row.
   WHAT: three always-visible underlined text links per row. WinUI `HyperlinkButton` has no underline; row secondary commands live in a `MenuFlyout` on a "…" button, or as `SwipeControl`/hover reveal. "remove data" is destructive with no confirmation cue.
   GUIDELINE: `ListView` item commands, `MenuFlyout`, `ContentDialog` for destructive confirmation.
   PROPOSED: a 32 px "More (…)" `Button` (subtle style) at row end, revealed on hover/focus, opening a `MenuFlyout`: Rename (F2), Remove from list, separator, Delete takeoff data… (with `ContentDialog` "This deletes redbeam.db in <folder>. Drawings are not touched." Primary "Delete", Close "Cancel").
   SEVERITY: major.

4. **Paths wrap to two lines and use monospace with mid-ellipsis.**
   WHERE: `C:\Users\aaron\Maxxit Grou…Ramp\Bentall Towers 1 & 2` lines.
   WHAT: two-line wrapped monospace inside a list row. WinUI list rows keep secondary text on one line with `TextTrimming=CharacterEllipsis` and the full value in a `ToolTip`.
   GUIDELINE: `ListView` two-line item template; Fluent typography (Caption 12 secondary).
   PROPOSED: Caption 12 `TextFillColorSecondary`, single line, end-ellipsis (or path-aware middle ellipsis), `ToolTip` with full path; row height 56 px (two-line item).
   SEVERITY: paper cut.

5. **Inconsistent relative dates "23h ago" vs "5 Sep".**
   WHERE: timestamp column.
   WHAT: mixed relative/absolute formats in one column.
   GUIDELINE: Windows "Date and time" writing guidance; Explorer uses absolute short dates.
   PROPOSED: absolute `DateTimeFormatter("shortdate shorttime")` or consistent relative ("Yesterday", "5 Sep") with the absolute in a ToolTip. Right-align in a fixed column.
   SEVERITY: paper cut.

6. **"Recent" header rendered as a filled bar.**
   WHERE: grey band with "Recent".
   WHAT: WinUI group headers are plain Body Strong text with 4 px bottom margin, no fill.
   GUIDELINE: `ListView` `GroupStyle` header / Windows Settings section headers.
   PROPOSED: Body Strong 14, `TextFillColorPrimary`, no background; 24 px top margin.
   SEVERITY: paper cut.

7. **Explanatory sentence floats as body copy.**
   WHERE: "REDBEAM writes one redbeam.db beside the drawings and never modifies them."
   WHAT: help copy with no container. WinUI uses an `InfoBar` (Informational) or a Caption under the control it explains.
   GUIDELINE: `InfoBar`; Fluent "Text → Caption".
   PROPOSED: Caption 12 secondary directly under the button row, or an `InfoBar` with `IsClosable=false` if it must stay prominent.
   SEVERITY: paper cut.

8. **"Open a folder by path instead" is an underlined link acting as an Expander.**
   WHERE: bottom of the card.
   WHAT: underlined text that toggles a disclosure. WinUI: `Expander` (chevron, 8 px radius) or a non-underlined `HyperlinkButton`.
   GUIDELINE: `Expander`, `HyperlinkButton`.
   PROPOSED: `Expander` header "Open a folder by path", content = the form from d2; or `HyperlinkButton` without underline.
   SEVERITY: paper cut.

9. **App identity block.**
   WHERE: "RB" tile 24 px + "REDBEAM" + tagline.
   WHAT: tile is 24 px; WinUI landing pages use the 32/48 px app icon; the tagline is Caption-grey at Body size. Also the tile (red) contradicts the title-bar icon (orange fruit) in later screenshots.
   GUIDELINE: Windows app icon guidance; type ramp.
   PROPOSED: 48 px icon, Title 28 "REDBEAM", Body 14 secondary tagline; one icon asset app-wide.
   SEVERITY: paper cut.

10. **No keyboard accelerators or access keys surfaced.**
    WHERE: primary buttons.
    WHAT: no `Ctrl+O` / access-key hints; Windows apps expose `KeyboardAccelerator` tooltips ("Open a drawing set (Ctrl+O)").
    GUIDELINE: `KeyboardAccelerator`, `ToolTip` with accelerator text.
    PROPOSED: Ctrl+O → Open drawing set, Ctrl+Shift+O → Open project folder; tooltips.
    SEVERITY: paper cut.

11. **Card corner radius / elevation.**
    WHERE: card edge.
    WHAT: radius ≈ 8 px (correct for a card) but no `ThemeShadow`/border — the card only reads by fill contrast.
    GUIDELINE: Fluent "Elevation", `CardStrokeColorDefault`.
    PROPOSED: add 1 px `CardStrokeColorDefault` (rgba(0,0,0,0.1) dark / rgba(0,0,0,0.0578) light) border; if it remains a dialog, add the 8-unit shadow.
    SEVERITY: paper cut.

---

## 2. d2.png — Start screen, "Open a folder by path" expanded

1. **"Open" button is white-filled.**
   WHERE: `Open` button under the path box.
   WHAT: white background with dark text on a dark card — not any Fluent button style (standard = `ControlFillColorDefault` rgba(255,255,255,0.0605); accent = accent fill; light-theme look leaked in).
   GUIDELINE: `Button` styles; only the default action in a form gets `AccentButtonStyle`.
   PROPOSED: `Open` → AccentButtonStyle; `Create & open` → standard; `Browse…` → standard; all 32 px, 8 px gap.
   SEVERITY: major.

2. **Path box and Browse are not a single "PathPicker" composition.**
   WHERE: TextBox + "Browse…".
   WHAT: box height ≈ 30 px, Browse 32 px — 2 px misalignment; box has no bottom accent focus line.
   GUIDELINE: `TextBox` (32 px, 4 px radius, 1 px bottom `ControlStrokeColorSecondary` that turns 2 px accent on focus).
   PROPOSED: TextBox 32 px, Browse `Button` 32 px on the same baseline; on focus, bottom border 2 px accent.
   SEVERITY: paper cut.

3. **Help text duplicated on the same screen.**
   WHERE: "A project is a folder. REDBEAM writes one redbeam.db inside it and never modifies the drawings." (also stated above the Recent list).
   WHAT: same sentence twice.
   GUIDELINE: Windows writing style — say it once.
   PROPOSED: keep the Caption under the path form; remove the upper one, or vice-versa.
   SEVERITY: paper cut.

4. **Section title "Open a folder by path" has no visual connection to the link that opened it.**
   WHERE: divider + label at y ≈ 630.
   WHAT: the link vanishes and a new heading appears below a divider — a disclosure should stay in place.
   GUIDELINE: `Expander` (header stays, chevron rotates).
   PROPOSED: `Expander` with `IsExpanded` toggle; the header text remains.
   SEVERITY: paper cut.

5. **Field pre-populated with a path and no label/placeholder.**
   WHERE: TextBox contents.
   WHAT: no `Header` ("Folder") and no placeholder; the pre-filled value reads as a placeholder because it is ellipsised.
   GUIDELINE: `TextBox.Header`, `PlaceholderText`.
   PROPOSED: Header "Folder" (Body 14) above, placeholder "C:\Projects\…", left-trim long values with the caret at the end.
   SEVERITY: paper cut.

6. **"Create & open" ampersand.**
   WHERE: button label.
   WHAT: Windows UI text spells "and" in commands ("Create and open").
   GUIDELINE: Windows writing style guide.
   PROPOSED: "Create and open".
   SEVERITY: paper cut.

---

## 3. d3.png — Project open, no drawing

1. **Empty document area has no empty state.**
   WHERE: 1470 × 1000 px black area between the panes.
   WHAT: nothing tells the user what to do. WinUI/Windows apps render an empty-state glyph + Body text + optional action ("Select a drawing in Files, or press Ctrl+K").
   GUIDELINE: Fluent "Empty states" (Windows 11 Photos, Mail).
   PROPOSED: centred 48 px `Segoe Fluent Icons` glyph (E8A5 Document), Subtitle "No drawing open", Body secondary "Choose a sheet from Files or press Ctrl+K", Hyperlink "Open a drawing…".
   SEVERITY: major.

2. **Bottom dock shows live controls with nothing to act on.**
   WHERE: bottom toolbar: "TROUGHS ˄", "Take off", "‹ – ›", "− 35% ˄ +", fit, "Unset ˄".
   WHAT: zoom 35 % and a page navigator for no document; "Take off" accent-enabled with no sheet.
   GUIDELINE: `CommandBar` — disable commands whose `CanExecute` is false (`ControlFillColorDisabled`, `TextFillColorDisabled`).
   PROPOSED: disable zoom/page/scale/Take off until a document is active; or hide the dock entirely (memory note: "dock rests until Take off").
   SEVERITY: major.

3. **Left rail selector mixes NavigationView and SelectorBar idioms.**
   WHERE: "Files | bookmark | grid | 🔍" strip.
   WHAT: the selected "Files" item is a pill with icon + label *and* a 3 px accent bar on the left edge (the NavigationView `SelectionIndicator`), while unselected items are icon-only. Horizontal selectors in WinUI (`SelectorBar`) show all items with icon+text and a 3 px *bottom* indicator; NavigationView left indicators are for vertical panes.
   GUIDELINE: `SelectorBar` (WinUI 1.5), `NavigationView` PaneDisplayMode Top.
   PROPOSED: `SelectorBar` with three items "Files / Bookmarks / Thumbnails" (icon 16 + text 14), bottom 3 px accent indicator 16 px wide, 40 px item height; search as an `AutoSuggestBox` under it or a `Button` at the right.
   SEVERITY: major.

4. **Folder nodes use a page icon.**
   WHERE: "1 Data", "Client", "260904 Client…", "01 Scope Overview", "04 Key Arch Details", "CLG-04,05, Soffit", "EWS-107 & 107A"…
   WHAT: folders draw a "page with folded corner" glyph nearly identical to the file glyph; folder vs file is only inferable from the chevron.
   GUIDELINE: Segoe Fluent Icons E8B7 (Folder) / E8D5 (FolderOpen); `TreeView` item template.
   PROPOSED: E8B7/E8D5 for folders, E8A5 for PDFs; 16 px, `TextFillColorSecondary` for folder glyph.
   SEVERITY: major.

5. **TreeView rows are 24 px.**
   WHERE: tree rows (pitch 24 px).
   WHAT: WinUI `TreeView` default row is 32 px (compact 24 px via `TreeViewItemMinHeight`). 24 px is acceptable for a dense tool but should be an explicit "compact" density with 8 px indent per level; here the indent is ≈ 12 px and the chevron hit-target is < 24 px.
   GUIDELINE: `TreeView`, Fluent density.
   PROPOSED: 28 px rows, 16 px indent per level, chevron hit target 24 × 24, 8 px gap icon→text.
   SEVERITY: paper cut.

6. **Filter box below the selector is 28 px tall with an icon-left search.**
   WHERE: "Filter 90 documents".
   WHAT: WinUI `AutoSuggestBox` is 32 px, 4 px radius, query icon on the *right*, placeholder `TextFillColorSecondary`.
   GUIDELINE: `AutoSuggestBox` with `QueryIcon`.
   PROPOSED: 32 px, QueryIcon right, bottom accent line on focus, Esc clears.
   SEVERITY: paper cut.

7. **Status line "Reading the folder… Collapse all Refresh" mixes progress with commands.**
   WHERE: bottom of the tree.
   WHAT: an indeterminate operation shown as text; commands as plain text with no button chrome.
   GUIDELINE: `ProgressBar IsIndeterminate` (2 px accent under the header), `CommandBar` for "Collapse all / Refresh".
   PROPOSED: indeterminate `ProgressBar` under the filter box while scanning; footer `CommandBar` (Subtle `AppBarButton` 32 px: E8B4 CollapseAll? use E70D "ChevronDown" + E72C Refresh) with labels on hover/ToolTip.
   SEVERITY: paper cut.

8. **Counts column in the tree.**
   WHERE: "58 / 52 / 30 / 27 / 3…" right-aligned numerals.
   WHAT: Caption numerals in body colour; WinUI uses `InfoBadge`-style or Caption `TextFillColorSecondary`.
   PROPOSED: Caption 12 secondary, tabular-nums, 8 px right margin, hidden when the node is a leaf.
   SEVERITY: paper cut.

9. **Right sidebar: header stack is three tiers deep.**
   WHERE: "Estimates" (icon+Body Strong) → breadcrumb "Estimates › CEILING SCOPE" → "CEILING SCOPE" title.
   WHAT: the same information three times; Windows Settings uses a `BreadcrumbBar` whose last crumb *is* the Title.
   GUIDELINE: `BreadcrumbBar`.
   PROPOSED: drop the "Estimates" title row; `BreadcrumbBar` with Title-style last item (`Estimates › CEILING SCOPE`), "…" button aligned right of the bar.
   SEVERITY: paper cut.

10. **Two "Add scope" buttons.**
    WHERE: one in the "Scopes 3" header, one after the list.
    WHAT: duplicate command.
    GUIDELINE: CommandBar — one placement.
    PROPOSED: keep the header button (`Button` 32 px, E710 Add + "Add scope"); remove the trailing one.
    SEVERITY: paper cut.

11. **Scope list rows lack WinUI ListView affordances.**
    WHERE: CL04 / BLUE / TROUGHS rows.
    WHAT: 31 px rows, colour dot, two-line text, chevron; no hover fill visible, chevron sits at 12 px from edge.
    GUIDELINE: `ListView` two-line template (56 px) or `SettingsCard`-style navigation card (chevron E76C "ChevronRight").
    PROPOSED: 48–56 px rows, hover `SubtleFillColorSecondary`, pressed `SubtleFillColorTertiary`, 3 px accent left pill on selection; chevron 12 px glyph, 16 px right padding.
    SEVERITY: paper cut.

12. **"Pinned" list truncates without tooltips and shows unexplained counts.**
    WHERE: "A-351A-FLOOR-01--SECTOR-A-EXTERIOR-REFLECT… 4".
    WHAT: no `ToolTip`, and the trailing numeral has no label.
    PROPOSED: `TextTrimming=CharacterEllipsis` + ToolTip full name; count as `InfoBadge` with ToolTip "4 markups on this sheet".
    SEVERITY: paper cut.

13. **Title-bar project switcher is a bare chevron.**
    WHERE: "▭ MSK Podium 1233 York Ave NYC ˅" at top-left.
    WHAT: DropDownButton in the title bar without button chrome; chevron ≈ 40 px away from text.
    GUIDELINE: `DropDownButton` (Subtle), title-bar interactive regions must be excluded from the drag region.
    PROPOSED: Subtle `DropDownButton`, chevron E70D 8 px after text, hover `SubtleFillColorSecondary`; mark as non-drag region.
    SEVERITY: paper cut.

14. **Settings entry at bottom-left.**
    WHERE: "⚙ Settings".
    WHAT: matches NavigationView `SettingsItem` — good — but the row is 28 px and has no hover fill.
    PROPOSED: 36 px NavigationViewItem sizing, hover fill.
    SEVERITY: paper cut.

---

## 4. d4.png — Command prompt (Ctrl+K), scope hub for CL04

1. **Text field focus visual is a 2 px accent border on all four sides.**
   WHERE: "Choose · CL04" field.
   WHAT: WinUI `TextBox` focus = 2 px accent *bottom* stroke + `ControlFillColorInputActive`; a full accent outline is a web default.
   GUIDELINE: `TextBox` visual states.
   PROPOSED: fill `ControlFillColorInputActive` (rgba(30,30,30,0.7)), 1 px `ControlStrokeColorDefault` sides/top, 2 px accent bottom; keyboard focus rect handled by G6.
   SEVERITY: paper cut.

2. **Input row height ≈ 24 px.**
   WHERE: same field.
   WHAT: below the 32 px control minimum.
   PROPOSED: 32 px (or 40 px "large" for a launcher, like Windows Search).
   SEVERITY: paper cut.

3. **Double chevrons per row.**
   WHERE: every item has "›" at the left and "needs a choice ›" at the right.
   WHAT: two navigation affordances for one action; the left chevron carries no meaning.
   GUIDELINE: `ListView`/`MenuFlyoutSubItem` — one trailing chevron (E76C) signals a sub-step.
   PROPOSED: remove the leading chevron; replace with a 16 px command glyph (E8A5 Take off, E713 Configure, E790 Colour…). Keep the trailing chevron only for items that open a step.
   SEVERITY: paper cut.

4. **Item rows are 46 px and the list has 13 items with no grouping.**
   WHERE: Take off … Open in the sidebar.
   WHAT: 13 undifferentiated commands; the destructive/structural ones (Commit, Archive, Duplicate, Rename) sit between "Markups…" and "Open in the sidebar".
   GUIDELINE: `MenuFlyoutSeparator`; command grouping (act / configure / manage).
   PROPOSED: group with Caption headers or separators: *Take off*, *Set up* (Configure, Set product, Colour, Direction ×2), *Review* (Markups, Parts and quantities, Commit), *Manage* (Rename, Duplicate, Archive, Open in the sidebar). Row height 40 px.
   SEVERITY: paper cut.

5. **Secondary descriptions are lower-case monospace sentences.**
   WHERE: "area tool, drawing into CL04", "freeze the count as it stands", "its 3 markups stay and come back if you restore it".
   WHAT: casual, terminal-styled copy; Windows UI is sentence case, Caption 12, Segoe.
   GUIDELINE: Windows writing style; Caption token.
   PROPOSED: Caption 12 `TextFillColorSecondary`, sentence case, ≤ 45 chars: "Area tool, drawing into CL04", "Freezes the count as it stands".
   SEVERITY: paper cut.

6. **Colour shown as raw hex.**
   WHERE: "Colour… #8000ff".
   WHAT: no swatch.
   GUIDELINE: `ColorPicker`, swatch glyph.
   PROPOSED: 16 px rounded swatch (4 px radius, 1 px `ControlStrokeColorDefault`) before the hex; the step opens a `ColorPicker` flyout.
   SEVERITY: paper cut.

7. **"needs a choice" / "needs a name" are hint labels dressed as trailing status text.**
   WHERE: right column.
   WHAT: reads as a warning state. In WinUI a trailing "›" alone conveys "opens a further step"; hint text is in the ToolTip or Caption.
   PROPOSED: remove the text; keep chevron; put the hint into the step's placeholder ("Type a new name").
   SEVERITY: paper cut.

8. **Keycap hint footer.**
   WHERE: "↑ ↓ choose · ⏎ Baffle · 3 markups · ⌫ on empty: back a step · esc cancel".
   WHAT: acceptable pattern (Windows Search/Copilot use it) but the keycaps are 18 px with 2 px radius and the copy "on empty: back a step" is not sentence case.
   PROPOSED: keycaps 20 px, 4 px radius, `ControlFillColorSecondary`; copy "Enter Open · Backspace Back · Esc Close".
   SEVERITY: paper cut.

9. **Palette surface.**
   WHERE: whole palette.
   WHAT: 8 px radius, translucent dark (good, Acrylic-like) but no `ThemeShadow` and no 1 px `SurfaceStrokeColorFlyout`.
   GUIDELINE: Fluent "Elevation → Flyout (shadow 16)", `AcrylicBackgroundFillColorDefault`.
   PROPOSED: 1 px flyout stroke + 16-unit shadow; keep Acrylic.
   SEVERITY: paper cut.

10. **Token chip "CL04".**
    WHERE: left of the field.
    WHAT: a bordered pill chip — WinUI has no chip; the nearest is `BreadcrumbBar` inside the box or a `TokenizingTextBox` (Toolkit).
    PROPOSED: Toolkit `TokenizingTextBox` styling (28 px token, `ControlFillColorSecondary`, 4 px radius) or a BreadcrumbBar-in-box.
    SEVERITY: paper cut.

11. **Selection state on "Rename…".**
    WHERE: highlighted row.
    WHAT: 3 px accent left pill + `SubtleFillColorSecondary` = correct `ListViewItem` selected look. Good. Only note: pill is 16 px tall on a 46 px row; WinUI pill = row height − 16.
    SEVERITY: paper cut.

12. **Header row "CL04 … Baffle · 3 markups".**
    WHERE: above the list.
    WHAT: Caption-grey labels for what is effectively the page title.
    PROPOSED: Body Strong "CL04" + Caption secondary "Baffle · 3 markups", 8 px bottom margin.
    SEVERITY: paper cut.

---

## 5. d5.png — Prompt, Markups step

1. **Two chips + field = ad-hoc breadcrumb.**
   WHERE: "CL04" "Markups" chips.
   WHAT: chips imitate a `BreadcrumbBar`; the second chip has a lighter border than the first (inconsistent chip states).
   GUIDELINE: `BreadcrumbBar` (chevron separators E76C, last item bold).
   PROPOSED: `BreadcrumbBar` "CL04 › Markups" left of the input; clicking a crumb pops back.
   SEVERITY: paper cut.

2. **Every markup row says "needs a choice ›".**
   WHERE: three rows.
   WHAT: the user asked for markups; the next step is unnamed. WinUI sub-steps should say what they open ("Go to it", "Actions").
   PROPOSED: replace with the primary verb "Go to it" and a trailing chevron; secondary actions via Shift+Enter or a "…" step.
   SEVERITY: paper cut.

3. **Row primary text is lower-case "area · 1260.5 SF", "cutout · −6.9 SF".**
   WHERE: item titles.
   WHAT: Windows lists use sentence case ("Area — 1,260.5 SF"); thousands separators missing here but present elsewhere ("1,386.4").
   PROPOSED: "Area · 1,260.5 SF", tabular-nums, consistent `NumberFormatter`.
   SEVERITY: paper cut.

4. **Secondary line is the raw sheet filename in upper-case monospace.**
   WHERE: "A-351B-FLOOR-01---SECTOR-B-EXTERIOR-REFLECTED-CEILING-PLAN-REV.3 M2-M5 BU…".
   WHAT: Caption should be the sheet number + title ("A-351B · Sector B reflected ceiling plan · p1"), not the filename.
   PROPOSED: derive display name from sheet metadata; Caption 12 secondary; ToolTip = filename.
   SEVERITY: paper cut.

5. **Third item "TE-2" is a bare tag.**
   WHERE: "area · 132.8 SF / TE-2".
   WHAT: inconsistent secondary content (filename vs tag).
   PROPOSED: same template for all three: "<sheet> · <page>" then tag as a trailing `InfoBadge`-style pill.
   SEVERITY: paper cut.

6. **Footer "⏎ of CL04".**
   WHERE: keycap hint.
   WHAT: unclear ("of CL04" describes scope, not the action).
   PROPOSED: "Enter Go to markup".
   SEVERITY: paper cut.

7. **Step-count label "step 2" right of the field.**
   WHERE: field trailing text.
   WHAT: developer-facing; the breadcrumb already shows depth.
   PROPOSED: remove, or show as Caption tertiary.
   SEVERITY: paper cut.

---

## 6. d6.png — Drawing A-351B open, markup selected

1. **Active tab indicated by an accent underline.**
   WHERE: tab "A-351B-FLOOR-01---SE…" with 3 px blue bottom line.
   WHAT: WinUI `TabView` selected tab has no underline; it takes `LayerFillColorDefault` background with rounded top corners and merges into the content region, while unselected tabs are transparent.
   GUIDELINE: `TabView` visual spec.
   PROPOSED: selected tab: background `LayerFillColorDefault`, 8 px top radii, 1 px `CardStrokeColorDefault` sides/top; unselected: transparent, hover `SubtleFillColorSecondary`; remove the underline (Edge-style tabs are not WinUI).
   SEVERITY: major.

2. **Tab close glyph only on the active tab and tab min-width.**
   WHERE: "×" on active tab; none on the inactive one.
   WHAT: acceptable (`TabView` shows close on hover for unselected) but the glyph is 10 px at 24 px from the label; WinUI close button is 16 × 16 hit 32 × 32 with 8 px gap.
   PROPOSED: 32 px hit target, appear on hover for inactive tabs, `Ctrl+W` accelerator in ToolTip.
   SEVERITY: paper cut.

3. **Tab labels are filenames truncated at ~18 chars.**
   WHERE: "A-351A-FLOOR-01--SE…".
   WHAT: the distinguishing part (sector A/B) is cut off.
   GUIDELINE: `TabView` `TabWidthMode=SizeToContent` or `Equal` with `MinTabWidth` 120 / `MaxTabWidth` 240; ToolTip with full title.
   PROPOSED: display "A-351A · Sector A RCP" (derived title), max width 240, ToolTip filename.
   SEVERITY: paper cut.

4. **Two rows appear highlighted in the Files tree.**
   WHERE: "A-764 - PLAN-DETAILS---EWS…" (grey fill) and "A-351B-FLOOR-01---SECTOR-…" (accent pill + fill).
   WHAT: a stale hover/focus state persists on A-764 while A-351B is selected — two rows read as selected.
   GUIDELINE: `TreeView` single-selection; hover state must clear on pointer-exit.
   PROPOSED: clear `:hover`/focus fill on pointer-leave and on programmatic selection; if A-764 is keyboard focus, render the focus rect (G6) not a fill.
   SEVERITY: major.

5. **"Open in new" icon on the selected tree row.**
   WHERE: trailing ⧉ glyph on A-351B.
   WHAT: unlabeled 12 px glyph, no ToolTip visible; WinUI reveals row commands as 32 px Subtle buttons on hover.
   PROPOSED: Subtle `Button` 32 px, glyph E8A7 (OpenInNewWindow) 16 px, ToolTip "Open in a new tab".
   SEVERITY: paper cut.

6. **Selected markup on the sheet has no WinUI-style selection visual.**
   WHERE: blue region top-right (selected).
   WHAT: selection is indicated only by the context in the sidebar; the on-canvas outline is < 1 px and the handles are barely visible on a 4K frame.
   GUIDELINE: Fluent "Selection" — 2 px `FocusStrokeColorOuter` outline with 8 px square handles (`ControlStrongFillColorDefault`) as in Windows Snipping/Photos crop.
   PROPOSED: 2 px white outline + 1 px black inner (dual-tone so it reads on any drawing colour), 8 × 8 handles, 12 px hit target.
   SEVERITY: major.

7. **Dock scope button "● TROUGHS ˄" while the sidebar page is "CEILING SCOPE".**
   WHERE: bottom toolbar vs. right sidebar.
   WHAT: the active scope selector (dock) and the sidebar focus are two independent "current" states; a user cannot tell which one `Take off` will draw into.
   GUIDELINE: single source of truth for "current item"; `DropDownButton` label must reflect it.
   PROPOSED: selecting a scope anywhere sets both; the dock button becomes the only scope selector (SplitButton: primary = Take off into X, secondary = choose scope).
   SEVERITY: major.

8. **DropDownButton chevrons point up.**
   WHERE: "TROUGHS ˄", "50% ˄", "1" = 3'-9" ˄".
   WHAT: WinUI `DropDownButton` always uses ChevronDown (E70D, 8 px) regardless of flyout placement.
   PROPOSED: ChevronDown 8 px glyph, 8 px gap.
   SEVERITY: paper cut.

9. **Dock groups float with 8 px radius pills but zero gap to the page edge at 1440p-equivalent.**
   WHERE: the four floating groups.
   WHAT: fine as a floating `CommandBar` (Photos uses one) but the groups have inconsistent inner paddings (tools 6 px, scope 10 px, nav 16 px) and the zoom group has a divider while the tool group does not.
   PROPOSED: unify: 40 px group height, 4 px inner padding, 32 px buttons, `AppBarSeparator` between logical sets, 8 px gaps between groups; `CardStrokeColorDefault` 1 px border + 8-unit shadow.
   SEVERITY: paper cut.

10. **Page counter "1/1" in monospace, disabled arrows without disabled tokens.**
    WHERE: "‹ 1/1 ›".
    WHAT: arrows look enabled though there is a single page.
    PROPOSED: `TextFillColorDisabled` + `IsEnabled=false`; counter Body 14 tabular.
    SEVERITY: paper cut.

11. **Scale readout "1" = 3'-9"" is a DropDownButton with a ruler glyph but no label.**
    WHERE: bottom-right group.
    WHAT: OK as a control, but no ToolTip "Sheet scale" and no distinction between calibrated vs. unverified scale.
    PROPOSED: ToolTip; when unset show a caution `InfoBadge` (E7BA) — see d3 "Unset".
    SEVERITY: paper cut.

12. **Zoom "+ / −" and "fit" glyphs at 12 px.**
    WHERE: zoom group.
    WHAT: WinUI icon buttons use 16 px glyphs in 32 px buttons.
    PROPOSED: E8A3/E8A4 (Zoom in/out) 16 px, E9A6 FitPage 16 px.
    SEVERITY: paper cut.

---

## 7. d7.png — Right-click on empty sheet

1. **Menu has a text header "The drawing".**
   WHERE: first line in the flyout.
   WHAT: `MenuFlyout` has no header element; grouping is by `MenuFlyoutSeparator` or `MenuFlyoutSubItem`.
   GUIDELINE: `MenuFlyout` anatomy.
   PROPOSED: remove the header; if grouping is needed later use separators.
   SEVERITY: paper cut.

2. **Menu items are ≈ 27 px tall.**
   WHERE: two items.
   WHAT: `MenuFlyoutItem` is 32 px (36 px when icons are present), 11 px horizontal padding, 8 px icon→text gap... here the icon gutter is 28 px and the rows are 27 px.
   PROPOSED: 36 px rows with icons, 4 px vertical menu padding, 8 px radius (OK).
   SEVERITY: paper cut.

3. **No shadow / stroke on the flyout.**
   WHERE: flyout edges.
   WHAT: Fluent flyouts carry `ThemeShadow` (16) and 1 px `SurfaceStrokeColorFlyout`; here the surface only separates by fill.
   PROPOSED: add both; background `AcrylicBackgroundFillColorDefault` (or `SolidBackgroundFillColorQuarternary` if acrylic is disabled).
   SEVERITY: paper cut.

4. **Missing standard sheet commands.**
   WHERE: only two items.
   WHAT: a Windows right-click on a document surface typically offers Zoom to fit, Rotate, Copy view, Properties/Sheet info, Set scale…; the hub in d4 already has these verbs but they are not reachable here.
   PROPOSED: add "Fit to window", "Set scale…", separator, then the two takeoff items; keep ≤ 8 items.
   SEVERITY: paper cut.

5. **Item text "Convert all 101 PDF markups on this sheet" — number in the label.**
   WHERE: first item.
   WHAT: fine, but ensure `NumberFormatter` grouping ("1,012") and sentence case is already correct. Provide `KeyboardAccelerator` text column (e.g. "Ctrl+Shift+M").
   SEVERITY: paper cut.

6. **Menu width fixed ≈ 240 px, causing "Trace the region here as an area" to sit tight to the right edge.**
   WHERE: second item.
   PROPOSED: `MinWidth` 200, padding-right 24 px reserved for accelerator/chevron column.
   SEVERITY: paper cut.

---

## 8. d8.png — Right-click on a PDF (Bluebeam) markup

1. **Two grey pseudo-headers in one menu.**
   WHERE: "Convert 1 selected PDF markup into" and "1 PDF markup here".
   WHAT: same as d7-1, doubled. The scope list should be a `MenuFlyoutSubItem` "Convert to scope ›" or the items should be self-describing ("Convert to CL04").
   GUIDELINE: `MenuFlyoutSubItem`.
   PROPOSED: items "Convert to CL04 / BLUE / TROUGHS" (with colour swatch icons), separator, "Convert polygon "Area Measurement" to an area", "Convert all 101 PDF markups on this sheet", "Trace the region here as an area".
   SEVERITY: paper cut.

2. **Text column misaligned between dot-items and icon-items.**
   WHERE: "CL04" text starts ≈ 9 px left of "Convert polygon…".
   WHAT: `MenuFlyoutItem` reserves a fixed 16 px icon column; the dot is drawn inline at a different offset.
   PROPOSED: render the colour dot as a 16 px `IconSource` (12 px circle centred in 16 px) in the icon column so all text aligns at 44 px.
   SEVERITY: paper cut.

3. **Colour dots without a colour-blind fallback.**
   WHERE: purple/red/red dots.
   WHAT: BLUE and TROUGHS both appear red; the swatch is the only differentiator besides the name. Fine since the names are present, but the swatch should have a 1 px `ControlStrokeColorDefault` ring for low-saturation colours.
   SEVERITY: paper cut.

4. **Menu sits over the very markup it acts on.**
   WHERE: flyout anchored at cursor covering the selected region.
   WHAT: WinUI `MenuFlyout` placement at pointer is standard; but the selected markup's selection outline should stay visible outside the flyout (cf. d6-6).
   SEVERITY: paper cut.

5. **No "Properties / Show in sidebar" for the PDF markup.**
   WHERE: menu.
   WHAT: the PDF markup carries author/subject/measurement; a Windows user expects "Properties" or a `TeachingTip`/flyout with that metadata.
   PROPOSED: add "Markup details…" opening a `Flyout` with a two-column `Grid` (Subject, Author, Area, Layer).
   SEVERITY: paper cut.

6. **Row heights ≈ 27 px, 10 px vertical padding differences between the two groups.**
   PROPOSED: as d7-2.
   SEVERITY: paper cut.

---

## 9. d9.png — Scope page in the right sidebar (Parts / Setup / Markups)

1. **SelectorBar/Pivot header used as jump-links to a single stacked column.**
   WHERE: "Parts 5 | Setup | Markups 3" with accent underline under "Parts", followed by Parts *and* Setup *and* Markups all expanded below.
   WHAT: a `SelectorBar`/`Pivot` promises content switching; here all three sections are shown regardless. Users will click "Setup" expecting Parts to disappear.
   GUIDELINE: `SelectorBar` (switch) vs `Expander` (disclose) — pick one.
   PROPOSED: either (a) true `SelectorBar` that swaps the content, or (b) drop the bar and keep the three `Expander`s (header Body Strong + `InfoBadge` count) with "Collapse all/Expand all" in the "…" menu. (b) fits the "one column" intent.
   SEVERITY: major.

2. **Scope header card tinted with the scope colour.**
   WHERE: purple-tinted band "CL04 / Baffle · 3 markups / Take off".
   WHAT: Fluent reserves coloured surfaces for accent/system states; a per-item colour wash competes with the accent button on it.
   GUIDELINE: Fluent "Color → Use of colour", `NavigationView` selection indicator pattern.
   PROPOSED: `LayerFillColorDefault` card with a 3 px left bar in the scope colour (or the 12 px dot only); keep "Take off" accent.
   SEVERITY: paper cut.

3. **"Not committed. — Commit" is a hand-rolled InfoBar.**
   WHERE: info glyph + text + accent text link.
   WHAT: `InfoBar` has a filled background (`SystemFillColorAttentionBackground` for Informational), 16 px icon, Body text, `ActionButton` (a `Button`/`HyperlinkButton`), 4 px radius, 48 px min-height.
   GUIDELINE: `InfoBar` (Severity=Informational, IsClosable=false).
   PROPOSED: real InfoBar with `ActionButton` "Commit"; escalate to Severity=Warning when parts are "unverified".
   SEVERITY: major.

4. **Big stats in monospace with unit baseline-misaligned.**
   WHERE: "1,386.4 SF / Area", "240.2 LF / Perimeter".
   WHAT: see G4. Unit glyph is smaller but sits on a different baseline; label below is Body-grey.
   PROPOSED: Subtitle 20 semibold tabular-nums number, unit Caption 12 secondary aligned to baseline (use `alignment-baseline`), label Caption 12 secondary; 24 px gap between the two stats.
   SEVERITY: paper cut.

5. **"unverified" appended inline in caution-yellow.**
   WHERE: every Parts row: "Installed length unverified".
   WHAT: status text merged into the name cell in `SystemFillColorCaution` yellow (#FCE100) without an icon; yellow text on dark is also the hardest to read of the system colours.
   GUIDELINE: `InfoBadge` (Caution) or a status column; Fluent "System colours" require icon + text for state.
   PROPOSED: keep names clean; add a 16 px caution `InfoBadge` (E7BA) at row end with ToolTip "Unverified — calculated from the drawing, not confirmed"; or a "Status" column with Caption text.
   SEVERITY: paper cut (major for a11y if yellow-on-dark remains).

6. **Parts table header row.**
   WHERE: "Part | Qty | Unit" in a filled bar.
   WHAT: Toolkit `DataGrid` column headers are Caption/Body Strong on transparent with a 1 px `DividerStrokeColorDefault` bottom line; no fill.
   PROPOSED: transparent header, Body Strong 14, 1 px divider; rows 32 px; Qty right-aligned tabular-nums; Unit `TextFillColorSecondary`.
   SEVERITY: paper cut.

7. **"Show the layout on the sheet" ToggleSwitch has no On/Off content and label left.**
   WHERE: Parts footer.
   WHAT: `ToggleSwitch` = 40 × 20 track, `Header` above or `OnContent/OffContent` to the right; a label-left arrangement is fine inside a `SettingsCard`, but Settings (d10) places "Off" to the *left* of the switch — two conventions.
   PROPOSED: standardise on `SettingsCard`-style: description left, switch right, `OnContent`/`OffContent` to the right of the track (or none) — same in d10.
   SEVERITY: paper cut.

8. **Field headers are two-tone inline "Spacing OC · centre to centre".**
   WHERE: Setup form headers.
   WHAT: `TextBox.Header` is a single Body 14 label; explanations go to `PlaceholderText`, `ToolTip`, or a Caption below.
   PROPOSED: Header "Spacing (OC)", placeholder "centre to centre", ToolTip for the long form. Same for Stock, Conn. Max, Profile W.
   SEVERITY: paper cut.

9. **Empty numeric field shows "—" as content.**
   WHERE: "Profile W · face width" = "—".
   WHAT: an em-dash in the value is neither placeholder nor value; `NumberBox` shows an empty box with placeholder.
   PROPOSED: `NumberBox` with `PlaceholderText="Not set"`, `SpinButtonPlacementMode=Compact`, unit suffix via `NumberFormatter`.
   SEVERITY: paper cut.

10. **Direction row: label + truncated text + a button whose label wraps to two lines.**
    WHERE: "Direction  set for this sheet · defaul…  [Set on the / sheet]".
    WHAT: a `Button` label must never wrap; the value text is ellipsised at 130 px while the button steals space.
    GUIDELINE: `Button` (single-line content, min-width 120), `SettingsCard` with `ActionIcon`.
    PROPOSED: two-row layout: Header "Direction"; value Body "Set for this sheet (default)" on line 2; a `HyperlinkButton` "Set on the sheet" or a 32 px `Button` with icon E7AD and short label "Set…".
    SEVERITY: major.

11. **Name field + naked colour swatch.**
    WHERE: "Name [CL04] [■]".
    WHAT: the 32 px purple square has no button chrome, no ToolTip, no chevron; WinUI uses a `DropDownButton`/`SplitButton` with a swatch icon opening a `ColorPicker` flyout.
    PROPOSED: `DropDownButton` 32 px: 16 px swatch (4 px radius, 1 px stroke) + ChevronDown, ToolTip "Scope colour"; flyout with 12 preset swatches + `ColorPicker`.
    SEVERITY: paper cut.

12. **"Group by  [sheet | kind]" segmented control styled as two loose buttons.**
    WHERE: Markups header.
    WHAT: the selected "sheet" has a filled pill; "kind" is a bare label. WinUI `SelectorBar` uses an underline indicator; a `RadioButtons` or a `DropDownButton` "Group by: Sheet" is more compact for a 300 px pane.
    PROPOSED: `DropDownButton` "Group by: Sheet ˅" with `RadioMenuFlyoutItem`s.
    SEVERITY: paper cut.

13. **Markup group header wraps to two lines with the full filename.**
    WHERE: "A-351A-FLOOR-01--SECTOR-A-EXTERIOR-REFLECTED-CEILING-PLAN BULL.10 6-26-26.pdf · p1".
    WHAT: group headers should be one line, Body Strong, trimmed; derived sheet title preferred (cf. d5-4).
    PROPOSED: "A-351A · p1" Body Strong + ToolTip; count as `InfoBadge`.
    SEVERITY: paper cut.

14. **"Page 1 · Page 1" duplicated label.**
    WHERE: first Markups group.
    WHAT: page name and page number are identical, rendered twice.
    PROPOSED: collapse to "Page 1" when label == number.
    SEVERITY: paper cut.

15. **Footer commands "Duplicate / Remove from estimate" as text+icon labels with no button chrome.**
    WHERE: bottom of sidebar.
    WHAT: this is a `CommandBar` footer; WinUI `AppBarButton`s are 40 px with hover fill; a destructive command should be right-most and confirmed via `ContentDialog`.
    PROPOSED: `CommandBar` (`DefaultLabelPosition=Right`), 1 px `DividerStrokeColorDefault` top; "Remove from estimate" → `ContentDialog` with Primary "Remove" and description of what happens to its 3 markups.
    SEVERITY: paper cut.

16. **"Parts 5 / Markups 3" counts are 10 px accent numerals.**
    WHERE: SelectorBar items.
    WHAT: WinUI count badges are `InfoBadge` (16 px pill, `AccentFillColorDefault`, Caption white text) or Caption secondary text.
    PROPOSED: `InfoBadge` or Caption secondary.
    SEVERITY: paper cut.

17. **Section expanders use a 12 px chevron + Body Strong with no hover/press fill.**
    WHERE: "˅ Parts", "˅ Setup", "˅ Markups".
    WHAT: `Expander` header is 48 px, full-width hover `SubtleFillColorSecondary`, chevron on the *right* (E70D) by default.
    PROPOSED: `Expander` styling (or keep left chevron but adopt 48 px, hover fill, 4 px radius).
    SEVERITY: paper cut.

18. **ComboBoxes "Baffle / full / aligned" are 32 px with a 12 px chevron flush-right.**
    WHERE: Product, Yield, Seams.
    WHAT: close to spec; WinUI `ComboBox` chevron is 8 px E70D at 12 px right padding, values sentence case ("Full", "Aligned").
    PROPOSED: sentence-case values; 8 px chevron.
    SEVERITY: paper cut.

---

## 10. d10.png — Settings › General

1. **Document tabs remain visible and "active" while Settings occupies the window.**
   WHERE: tab strip shows A-351B as the selected tab; content is Settings.
   WHAT: the selected `TabViewItem` must be the visible content. Windows Terminal/Edge open Settings *as a tab*; Windows Settings has no tabs.
   GUIDELINE: `TabView` — selection = content.
   PROPOSED: open Settings as a tab ("Settings" with E713 icon) or as a full-window `Page` that hides the tab strip and shows the NavigationView back button (already present).
   SEVERITY: major.

2. **NavigationView items show trailing counts (3 / 1 / 11 / 1).**
   WHERE: General 3, Drawing 1, Takeoff 11, Performance 1.
   WHAT: Windows Settings never shows counts of settings per category; the number is noise. If it means "changed settings", use an `InfoBadge` with a ToolTip.
   GUIDELINE: `NavigationViewItem.InfoBadge`.
   PROPOSED: remove; or `InfoBadge` only when a category has non-default values ("1 changed").
   SEVERITY: paper cut.

3. **NavigationView items ≈ 30 px tall; pane width 235 px.**
   WHERE: left pane.
   WHAT: `NavigationViewItem` is 36 px (40 in Settings), pane `OpenPaneLength` 320 (Settings) / 280 typical; selection indicator 3 × 16 px accent pill — present (good).
   PROPOSED: 36 px items, 4 px radius hover, pane 280 px, 16 px item icon.
   SEVERITY: paper cut.

4. **"Find a setting" AutoSuggestBox.**
   WHERE: search box.
   WHAT: matches Settings visually; height ≈ 30 px and query icon at right — good; add `Ctrl+F`/`Ctrl+E` accelerator and `PlaceholderText` colour `TextFillColorSecondary`.
   SEVERITY: paper cut.

5. **Header "Settings › General" — parent in `TextFillColorTertiary` with chevron.**
   WHERE: page header.
   WHAT: matches Windows Settings `BreadcrumbBar` (Title 28). Good. Only: the chevron is 8 px but vertically off-centre by ≈ 3 px.
   PROPOSED: `BreadcrumbBar` control; chevron E76C centred on cap height.
   SEVERITY: paper cut.

6. **"Reset all · 1 changed" button conflates a command with a status.**
   WHERE: top-right grey button.
   WHAT: a `Button` label should be a verb only; status belongs in an `InfoBadge` or Caption beside it. Also "Reset all" is destructive and lacks confirmation.
   PROPOSED: Caption secondary "1 setting changed" + `Button` "Reset all" (opens `ContentDialog` or uses a `Flyout` confirm).
   SEVERITY: paper cut.

7. **ToggleSwitch label "Off" sits to the left of the track.**
   WHERE: "Reopen the last project on launch  Off ( )".
   WHAT: `ToggleSwitch` renders `OffContent`/`OnContent` to the *right* of the track. Windows Settings does the same.
   PROPOSED: switch first, then "Off"/"On" (Body 14) 12 px to the right; keep the right edge aligned by fixing the label width (or drop the content text as many Settings cards do).
   SEVERITY: paper cut.

8. **ToggleSwitch track appears 36 × 18.**
   WHERE: same.
   WHAT: WinUI track 40 × 20, knob 12 px (14 on hover), 1 px `ControlStrongStrokeColorDefault` outline when off.
   PROPOSED: 40 × 20 track.
   SEVERITY: paper cut.

9. **"Recent projects kept" is a plain TextBox showing 40.**
   WHERE: numeric control.
   WHAT: `NumberBox` with `SpinButtonPlacementMode=Compact` (spin buttons appear on hover) and `Minimum/Maximum`; text should be right-aligned only if the box is a fixed narrow width (it is 96 px — fine).
   PROPOSED: `NumberBox`, min 1, max 200, compact spinners.
   SEVERITY: paper cut.

10. **SettingsCard details.**
    WHERE: three cards.
    WHAT: `SettingsCard` spec: 1 px `CardStrokeColorDefault` border, `CardBackgroundFillColorDefault` fill, 4 px radius, header Body 14, description Caption 12 `TextFillColorSecondary`, 20 px header icon, content control right-aligned with 16 px padding; cards stacked 3–4 px apart. Here: no border, ≈ 8 px between cards, description wraps to 2 lines at 1360 px content width (fine), icon 20 px (good).
    PROPOSED: add border; 3 px card gap; cap content width at 1000 px like Windows Settings so descriptions do not run 180 characters.
    SEVERITY: paper cut.

11. **Description copy is conversational and references a keystroke "(~)" without a keycap.**
    WHERE: "Every project ever opened stays a keystroke away in the prompt (~)."
    WHAT: Windows Settings descriptions are one short sentence; shortcuts are shown as "Ctrl+K" text, not "(~)".
    PROPOSED: "Older projects can still be found with Ctrl+K." Sentence case, ≤ 90 chars.
    SEVERITY: paper cut.

12. **Section headers "Startup", "Recent projects" spacing.**
    WHERE: group titles.
    WHAT: Windows Settings uses Body Strong 14 with 24 px top / 8 px bottom margin; here ≈ 20 / 8. Close; align.
    SEVERITY: paper cut.

13. **"About REDBEAM 0.2.1" footer item.**
    WHERE: bottom of pane.
    WHAT: fine as a `NavigationView.FooterMenuItems` item; version should be Caption secondary and the item should navigate to an About page with links (licence, third-party notices, check for updates).
    SEVERITY: paper cut.

14. **Empty right 40 % of the page.**
    WHERE: content region ends at ≈ 1300 px of a 2560 px window.
    WHAT: Windows Settings caps content at 1000 px and centres/left-aligns with 40 px margins — acceptable; but the huge empty area with no Mica reads as unfinished (see G2).
    SEVERITY: paper cut.

---

## 11. d11.png — Takeoff mode toolbar

1. **Toggle state shown as an accent underline pill under the icon.**
   WHERE: polygon tool (selected) with a 3 px blue bar beneath.
   WHAT: `AppBarToggleButton` checked state = `SubtleFillColorSecondary` background (whole 32/40 px button) with the icon in `TextFillColorPrimary`; the accent pill is the NavigationView selection indicator, not a toggle visual.
   GUIDELINE: `AppBarToggleButton` / `ToggleButton` visual states.
   PROPOSED: checked = filled subtle background, 4 px radius; hover = `SubtleFillColorTertiary`; remove the pill. Same fix for the hand/select tools in the first group (d3/d7 show the same pill).
   SEVERITY: major.

2. **Icon-only tools with unclear metaphors and no visible labels.**
   WHERE: polygon, scissors, ruler, "dimension box", "cart-like" glyph, "no" circle, "X".
   WHAT: the fifth glyph resembles a shopping cart; "⃠" and "×" both look like cancel. WinUI `CommandBar` supports `DefaultLabelPosition=Bottom/Right` and requires ToolTips + access keys for icon-only buttons.
   GUIDELINE: `CommandBar`, `ToolTipService`, `AccessKey`.
   PROPOSED: Segoe Fluent Icons: Area E8A5? (use E7E6 "Shape" or custom polygon), Cutout E8C6 Cut, Length E8FF? (Ruler custom), Count E9E9, and *labels* for the two terminal actions: "Cancel shape" (Esc) and "Done" (accent, Enter). ToolTips "Polygon area (A)", access keys via Alt.
   SEVERITY: major.

3. **Two dismissal controls ("⃠" and "×") side by side.**
   WHERE: right end of the tool group.
   WHAT: ambiguous: cancel current polygon vs. exit takeoff mode.
   PROPOSED: one "Done" `Button` (accent, label) + Esc handling for cancelling the in-progress shape; show a `TeachingTip` once explaining Esc/Enter.
   SEVERITY: major.

4. **Scope `DropDownButton` "● CL04 ˄" is the same control that in d3/d6 read "TROUGHS" — now with a purple dot.**
   WHERE: second group.
   WHAT: good that it reflects the current scope; but 12 px dot + 8 px gap + label + 8 px chevron in a 40 px pill is cramped, and ChevronUp again (see d6-8).
   PROPOSED: `SplitButton` (primary = current scope name, secondary = ChevronDown menu of scopes with swatches).
   SEVERITY: paper cut.

5. **The mode change is not announced.**
   WHERE: entering takeoff mode replaces "Take off" button with the tool set.
   WHAT: no `InfoBar`/`TeachingTip` says "Drawing into CL04 — click to add points, Enter to finish". Windows apps announce modal modes (Snipping Tool's toolbar shows the mode label).
   GUIDELINE: `TeachingTip` (first run), `InfoBar` (persistent status).
   PROPOSED: Caption in the toolbar group: "Area · CL04" + first-run `TeachingTip` anchored to the polygon tool.
   SEVERITY: paper cut.

6. **Toolbar group separators.**
   WHERE: thin dividers between polygon…cart and ⃠…×.
   WHAT: `AppBarSeparator` is 1 px `DividerStrokeColorDefault`, 16 px tall with 4 px margins — here ≈ 24 px tall and brighter than the control strokes.
   PROPOSED: match `AppBarSeparator`.
   SEVERITY: paper cut.

7. **Group padding inconsistent (first group 4 px, tool group 6 px, nav 16 px).**
   WHERE: all four pills.
   PROPOSED: as d6-9.
   SEVERITY: paper cut.

8. **Sheet grid numbers "2" and "6" peek out beside the floating toolbar.**
   WHERE: left and right of the dock.
   WHAT: the dock overlaps drawing content with no scrim; a floating CommandBar should sit in a reserved 56 px gutter or have `ThemeShadow` to read as a layer.
   PROPOSED: reserve bottom padding equal to dock height in the viewer, or add shadow + 1 px stroke.
   SEVERITY: paper cut.

9. **Context menu remains open while the toolbar is in a different mode.**
   WHERE: d11 still shows the d9 flyout.
   WHAT: entering a mode via the toolbar should dismiss light-dismiss flyouts (`FlyoutBase` closes on outside pointer-down).
   PROPOSED: close flyouts on any toolbar command.
   SEVERITY: paper cut (may be a capture artefact — verify).

10. **Zoom readout "50%" and page "1/1" in monospace; "+" "−" glyphs 12 px.**
    WHERE: nav group.
    PROPOSED: as d6-10/12.
    SEVERITY: paper cut.

---

## Top 10 for my persona

1. **Pick and propagate one accent** (G1): system accent or the brand red, generated through the full `AccentFillColor*` ramp; today it is an undocumented blue on a red-branded app.
2. **Mica + layered content** (G2): flat #202020 everywhere; adopt Mica on the base, `LayerFillColorDefault` on panes, `CardBackgroundFillColorDefault` on cards.
3. **Fix secondary-text contrast** (G3): use `TextFillColorSecondary` (78.6 % white); current greys fall under 4.5:1.
4. **TabView correctness** (d6-1, d10-1): active tab must be the visible content (Settings currently shows under a document tab) and use the WinUI tab visual instead of an Edge-style underline.
5. **Selection/toggle visuals** (d11-1, d3-3, d6-4): stop using the NavigationView accent pill for toggles and horizontal selectors; use `AppBarToggleButton` fills and `SelectorBar`; clear stale hover fills in the tree.
6. **Empty and disabled states** (d3-1, d3-2): empty-state message in the document area; disable dock controls when no sheet is open.
7. **Real InfoBar / TeachingTip for status** (d9-3, d11-5): "Not committed", "unverified", "scale unset", and entering takeoff mode are all system-state messages that should use the Fluent components with icon + fill.
8. **WinUI scrollbars** (G5): replace the WebView2 classic bars with the 2 px → 6 px overlay indicator.
9. **Takeoff toolbar affordances** (d11-2/3): labelled "Done"/"Cancel", ToolTips + access keys for every icon, unambiguous glyphs, `SplitButton` for scope.
10. **Typography discipline** (G4, d9-4/5, d4-5): Segoe UI Variable with tabular-nums for numbers, Caption for descriptions, sentence-case Windows copy; monospace only for literal paths.
