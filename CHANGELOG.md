# Changelog

Releases are Windows installers for x64 and ARM64, published at
https://github.com/testusercar/redbeam/releases. Both installers are unsigned;
SmartScreen will ask once.

## Unreleased

Found in the live test of the installed 0.2.0 build on the Barclays set
(`docs/AUDIT-2026-09-04.md`, "Live test").

- Opening a folder inside a project through the bridge created a second
  `redbeam.db` in it: the bridge's open now goes through the same project
  resolution as the picker.
- The palette's field refocuses on every step change (a configure chain had
  left it unfocused), and Escape cancels the palette outright.
- "This sheet has no scale" no longer shows while no sheet is open.
- Indexing progress is determinate: a ring behind the collapsed Search tab,
  the count and a foot bar on the expanded tab, and a bar with the numbers in
  the Search pane's footer. No spinner over the expanded tab.
- A round's scope rows and totals no longer read 0 after a reopen until a
  sheet is visited: the project's markups are loaded as soon as the store is
  open, and the counts come from the project rather than the open page.
- Switching or closing a project releases its database once the last window
  on it has let go (`db_close`), so its files can be moved or removed while
  the app is still running.

## 0.2.0 — 2026-09-04

The shell brought to WinUI 3, a command palette that can drive the whole
application, and two bug lists fixed the same day. Design register:
`docs/FLUENT-GAPS.md`; functionality audit: `docs/AUDIT-2026-09-04.md`.

### Shell and materials

- WinUI 3 system fills for every warning, note and toast (Caution, Critical,
  Success, Attention), in-app acrylic flyouts with the surface stroke, the
  3×16 selection pill on every selected row and tab, the black-and-white
  focus pair, Compact row heights (24 / 36), 28px menu items at Body 14, the
  40×20 toggle switch, and the Windows accent on the primary actions.
- Fluent UI System Icons throughout, chosen per role size; Lucide removed.
- Sentence-case headers everywhere a mono-caps kicker used to be.
- Thumbnails in three columns at the pane's width.
- Below the 960px window minimum the layout degrades instead of collapsing:
  the fallback grid has the right number of tracks, the wrapped command bar
  no longer slides under the sidebar, and a sheet row never rides its badge
  over the sheet number.

### The estimates pane

- The scope pane rebuilt: the scope band, two headline measures with one
  status line (nothing measured, needs setup, blocked, uncommitted, committed
  and what changed since), then Parts / Setup / Markups as a selector bar,
  with Duplicate and Remove in the foot.
- There is no separate bill of materials at the estimate root. A scope's
  parts and quantities are its Parts page; the round's exports (report, bill
  as TSV, marked-up PDF) live in the round's header menu beside Rename,
  Duplicate and Delete. The round's scope list shows one total per scope.
- Estimate export: a branded PDF with per-scope quantities and sheet
  pictures, CSV or TSV, through a native Save As dialog, from an edit sheet
  that shows what will be written.

### Settings

- A full-screen NavigationView: a pane with back, title, "Find a setting",
  one item per category with its count, About as the footer item; a content
  layer with the breadcrumb title, Reset all only while something is
  changed, rejected values as a dismissable InfoBar, families as expanders,
  rows as 68px settings cards with the On/Off word beside the switch, and an
  About page with version, update, diagnostics and third-party notices.

### The command palette

- Prefixes: `>` commands, `#` sheets, `:` page number, `@` scopes and what
  can be done to one, `/` documents, `=` settings, `~` projects, `?` lists
  them. Recents lead an untyped palette; every group says its prefix.
- Argument steps in the same field: what has been chosen sits as chips,
  Backspace on an empty field goes back, Tab advances without running, a
  text step states its rule and says when it is met.
- Toggles flip and stay (Ctrl+Enter closes). Shift+Enter opens a document in
  a context window. A row that cannot run stays listed and says why.
- Refusals keep the palette open with the store's reason and the nearest
  thing that works. Nothing destructive confirms with a dialog: deleting a
  round is refused while it holds markups (Duplicate is offered instead);
  removing a scope archives it and says its markups come back on restore.
- A miss says so in quotes and offers full-text search across every sheet.
- Every verb: zoom presets, next and previous sheet, close tab, every pane,
  close project, undo and redo with their labels; calibrate, set scale for
  this sheet, every sheet or a series of sheets; draw or remove a scale
  region; new, rename, duplicate and delete round; save report, copy bill,
  marked-up PDF; add, configure, rename, product, counts, duplicate, archive
  and restore scope, with the scope picked when none is open; take off in a
  scope, leave takeoff, every tool, direction; commit one scope or all; move
  or delete the selected markup; every setting as a switch; reset all.
- Aliases on every command and tool ("hand" finds Pan, "hole" finds Cutout);
  a whole-word alias hit ranks above a fuzzy title hit.

### Fixed

- Opening a drawing as a project and then its parent no longer breaks both
  windows: the core keeps one SQLite connection per project, undo is per
  project, and a folder inside a project resolves to the outermost
  `redbeam.db`. Nested `.redbeam` folders are skipped at any depth.
- A project opens on the Files pane rather than the first document; a
  remembered sheet still reopens.
- The wheel scrolls the sheet; Space or the middle button pans; pinch zooms
  either way. The setting says so.
- The Files pane is a nested, foldable folder tree.
- Page text is indexed for the whole project as soon as the folder is read;
  the Search tab wears a ring and says how far it has got.
- Calibrate, direction and scale region refuse a third point.
- The Estimates breadcrumb reaches the list; the dock's scope popover lets a
  round unfold in place and shows product and markup count per scope.
- Project paths, tree rows, menus, tabs and estimate rows truncate with an
  ellipsis instead of wrapping.
- The thumbnail grid's rules matched nothing after the sidebar merge; the
  drawing no longer shows through Settings; unit selects are readable.

### Removed

- `BomView` and the estimate-root bill; `fileFilter` folder grouping,
  superseded by the tree; `lucide-react`.

## 0.1.0 — 2026-09-04

First Windows release: the Fluent shell with Mica behind chrome that paints
nothing, the system accent, one sidebar with a compact collapsed form, one
acrylic command bar that sheds controls as the window narrows, and a takeoff
that blocks a quantity rather than approximating it on an uncalibrated sheet.
