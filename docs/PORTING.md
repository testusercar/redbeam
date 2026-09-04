# Porting from okular-redbeam

Source of truth for the old build: `../okular-redbeam` (fork of KDE Okular,
30 commits past merge-base `245f5387`, ~65,920 insertions).

## The rule

**Quantities must not move.** Estimators will not tolerate a takeoff that
changes by 0.3% because the geometry was rewritten. Anything that produces a
number gets ported literally and pinned by a test — not re-derived from first
principles because the new version looks cleaner.

Where the C++ carries a comment explaining *why* it does something odd, carry
the comment across. Those comments record bugs found against real drawings.

## Already ported

| What | From | To |
|---|---|---|
| Shoelace signed area | `redbeamSignedPolygonAreaPdfPointsSquared` | `domain/geometry.ts` |
| Cutout/nesting area rule | `redbeamPathAreaPdfPointsSquared` | `domain/geometry.ts` |
| Perimeter | `redbeamPathPerimeterPdfPoints` | `domain/geometry.ts` |
| Polyline length | `redbeamPolylineLengthPdfPoints` | `domain/geometry.ts` |
| Unit conversion | `redbeamScopeUnitToFeet` | `domain/units.ts` |
| Fraction parsing | `redbeamParseNumberOrFraction` | `domain/units.ts` |
| Measure formatting | `redbeamFormatMeasureValue` | `domain/units.ts` |
| SQLite schema (29 tables) | `shell/redbeamproject.cpp` | `store/migrations/*.sql` |

Two subtleties that must survive any refactor:

1. **Even/odd nesting, not signed-area summation.** Summing signed ring areas
   adds openings instead of removing them. Rings are classified by nesting
   depth: even is material, odd is an opening.
2. **Probe with a vertex, not an interior point.** An outer ring's natural
   interior point can land inside that ring's own hole, which would count the
   outer ring as nested and drive the whole region negative.

Both are covered in `geometry.test.ts`. If those tests start failing, the
quantities are wrong — do not "fix" the tests.

## Not ported yet — needs golden fixtures first

The piece/yield/BOM layer is the largest remaining chunk and the highest risk:

- `redbeamAllowedPieceFractions` (yield granularity)
- `redbeamBuildBafflePieces` (piece layout)
- `redbeamQuantityBomText` (BOM rendering)
- the layout/pattern-direction engine and `layout_components` freezing
- cross-document piece/stock pooling

**Do this before porting any of it:** capture golden fixtures from the Qt
build — inputs and outputs for every scope type across the real drawing sets —
and make the TS port reproduce them exactly. The Qt build is the oracle. There
is a regression harness to reuse at
`../okular-redbeam/redbeam-mcp-server/calculation-regression.test.js`.

## Known defects in the source — do not port these

- **`_simplify` livelock**, `redbeam/redbeamtakeoffonnxworker.py:305`. The loop
  sets `changed = True` on any dropped vertex but only assigns `result = kept`
  when `len(kept) >= 3`, so a rectilinear ring can spin forever with no
  iteration cap. Use a bounded Douglas-Peucker.
- **Identity smuggled through annotation names.** The Qt build encodes
  `scopeId` into an annotation's `uniqueName` string and recovers it with a
  regex, across 272 call sites, because `Okular::Annotation` had nowhere to put
  a domain foreign key. Here, identity is `markups.id` and `markups.scope_id`.
  Never parse identity out of a display string.
- **Hardcoded interpreter paths**, `redbeamtakeoffinference.cpp:36-39`
  (`C:/Python313/python.exe`). Resolve the runtime properly or fail loudly.

## Things that were never validated

Takeoff accuracy has **never been checked against a human estimator's
ground-truth takeoff**. Every validation number in the old repo is internal
self-consistency (engine vs. independent shoelace). This is the biggest open
risk in the whole program and porting does not fix it. Run one real bid package
end-to-end against an estimator's numbers and publish the delta.

## Table ownership decisions

- **`change_sets` / `change_set_items` are NOT the undo stack.** That is a
  propose/decide model — `state` defaults to `'proposed'`, and it carries
  `decided_at` and `revision_of_id`. It belongs to the agent review gate that
  pairs with `markups.review_state`. Routing local editing through it would put
  every vertex nudge into a human approval queue. Undo is a session-local
  command stack (`packages/store/src/commands.ts`).
- **`activity` is the audit trail** for edits: what changed, to which entity,
  from which origin. Undo and redo write to it too, so the history is honest
  about work that was reverted.

## Architectural constraints carried forward

- SQLite is the system of record; **source PDFs are read-only**. PDF annotation
  writing is an export concern, not persistence. This matters because PDFium
  can read but not *create* Polygon/PolyLine annotations and has no `/Measure`
  API — that layer will be hand-written (likely `pdf-lib`) on export.
- The domain package has no DOM, no SQL, no rendering imports.
- The viewer owns no domain state. The Qt overlay manager kept global static
  maps keyed by raw `Okular::Page*` and hit a use-after-free when the tile
  manager reallocated; the cache here is owned by the `Viewer` instance.

## Golden fixtures (plan 05)

`npm run fixtures:dump -- "<path>/.redbeam/project.db"` extracts the INPUT half
of a fixture from a real Qt estimate: scope, specifications, per-page
calibration and markup geometry. Four fixtures currently come from
"Testing Case Studies/Barclays - Midrise Floors Phase 1" (CL01 and CL03A across
pages 39-41).

The EXPECTED half — the quantities the Qt engine computes — is **not** derived
here and must not be. A fixture derived from the same reading of the C++ that
it is meant to check proves nothing. It has to be captured from the RUNNING Qt
build over its MCP bridge.

**Status: blocked.** The bridge advertises itself at
`%TEMP%/redbeam-okular-bridge.json`, written by `RedbeamAutomationBridge` on
startup. The currently running REDBEAM process has not written it, so the
bridge tools cannot reach it. Capturing the expectations needs that process
restarted. Until then every fixture carries `expected: null`.

`expected: null` means "not captured yet" and is never the same as "expected
nothing". `npm test` reports pending fixtures as a loud warning;
`npm run verify` runs them with `RB_FIXTURES_STRICT=1` and **fails**, because a
suite that silently passes on unfilled expectations reports coverage that does
not exist — which is exactly how a rewrite ships a wrong quantity.

Two vocabulary traps the extractor handles, both of which would parse silently
if assumed away:
- Qt markup kinds are `area`, `markup`, `pattern_direction`,
  `calibration_reference` — not ours. They are mapped explicitly; an unmapped
  kind exits non-zero rather than becoming something that counts.
- Qt geometry is `{ bounds, points, space }` — ONE flat ring plus a cached
  bounding box. `space` is checked, not assumed: a row in page points is off by
  three orders of magnitude and would still parse. The cached `bounds` is
  dropped and recomputed; a stale box would quietly move a quantity.

### Which fixtures are committed

Only fixtures with **captured expectations** are committed. Input-only
fixtures are not.

The four Barclays ones (CL01/CL03A, pages 39-41) were extracted from the
project database before the bridge was reachable and carried
`expected: null`. They were removed rather than committed pending, because
`npm run verify` fails on a pending fixture by design — and a check that is
permanently red is a check people learn to ignore, which is the same failure
the gate exists to prevent.

`npm run fixtures:dump -- "<path>/.redbeam/project.db"` regenerates their
inputs in seconds. Fill them by opening that project in the Qt build and
reading `redbeam_get_scope_calculation` per scope, the same way the Turkish
Airlines fixtures were captured.

### Capturing a fixture from the live Qt build

1. Start the Qt build (it advertises `%TEMP%/redbeam-okular-bridge.json`).
2. `redbeam_get_project_summary` — confirm the project.
3. `redbeam_list_project_scopes` — scope ids and specifications.
4. `redbeam_get_scope_workspace` per scope — markup geometry, per page.
5. `redbeam_get_scale` — feetPerPdfPoint and the page box.
6. `redbeam_get_scope_calculation` per scope — the EXPECTED quantities.

Step 6 is the only source of expectations. Never compute them from our own
engine, and never re-derive them by reading the C++: a fixture derived from
the same reading of the source it is meant to check proves nothing.

## The automation bridge (plan 11)

`REDBEAM_BRIDGE=1` starts a local JSON socket so an agent can read and drive
the app. Off by default: it exposes the open project, so it is something you
turn on to drive the app, not something every launch carries. Pair it with
`REDBEAM_START_MINIMIZED=1` for a driven run.

Discovery is written to `%TEMP%/redbeam-bridge.json` — deliberately NOT
`redbeam-okular-bridge.json`, which is the Qt build's. Both apps run at once
during the port, and one filename would point an agent at whichever started
last.

    request   {"id":1,"method":"get_state","token":"…","params":{}}\n
    response  {"id":1,"ok":true,"result":{…}}\n

One connection per call, matching the Qt bridge, so a wedged request cannot
block the next one.

### Two rules that shape every method

**Reads answer from the store, not the UI.** The Qt bridge routed everything
through the UI thread, so a modal dialog could wedge automation. Here scopes,
markups, pages and calibration come straight from SQLite, and an agent can
read a project while the app is minimized or busy.

**Writes do not bypass the undo stack.** `execute_query` runs SELECT only, and
refuses stacked statements. This is not a security boundary — the caller holds
the token — it is a guard against an agent corrupting a takeoff while "just
checking something": a DELETE issued here would change the takeoff with no
undo entry and no activity row.

`open_project` follows from the same rule in the other direction. It EMITS an
event the frontend handles exactly as it handles the picker, rather than
calling `StoreState::open` behind the UI's back — that would give the window
one project and the database another, reintroducing through the automation
door the split-brain the store moved into Rust to prevent. It therefore
answers `accepted`, not `opened`; poll `get_state` until `projectOpen`.

### Driving the app as an agent

    cd apps/desktop/src-tauri
    REDBEAM_BRIDGE=1 REDBEAM_START_MINIMIZED=1 ./target/release/redbeam.exe

`.mcp.json` at the workspace root registers `redbeam-ts`, so the twelve bridge
tools appear as MCP tools in a session started there. The server needs no
build step and no dependencies.

Reads (`get_state`, `project_summary`, `list_*`, `execute_query`) answer from
the store and work on a minimized app. `get_ui_state`, `screenshot` and
`invoke_ui_action` need a window and say so in their descriptions.

`open_project` returns `accepted`, not `opened` — poll `get_state` until
`projectOpen` is true. On the archived Barclays package that is ~35s for 693
documents in a release build.

Measured while building this: the same open took over five minutes and never
completed before the concurrent-scan fix, and a debug build is roughly ten
times slower than release because of the hand-rolled SHA-256. Time an ingest
against a release binary or the number means nothing.
