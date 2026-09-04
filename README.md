# REDBEAM

Construction quantity takeoff from PDF drawings. TypeScript rewrite of the
Okular-fork build (`../okular-redbeam`).

Maxxit's own estimating tool. The source is public; the software is not
released under an open-source licence and no rights are granted — see
[Licence](#licence).

Leaving GPL/Poppler behind was a free choice rather than a requirement,
because nothing here derives from Okular: the rewrite shares none of its code.

## Why this exists

The Qt/KDE build worked but was slow to iterate on and effectively
unbuildable outside one machine. Two spikes established the case:

**Spike 1 — PDF engine.** Median ms to rasterize one 512px tile from the real
PKG A ARCH page 48 (3456x2592pt, 325,868 vector paths):

| zoom | Poppler | PDFium native | PDFium WASM |
|------|--------:|--------------:|------------:|
| fit  | 3310    | 921           | 400         |
| 100% | 2397    | 105           | 64          |
| 200% | 2331    | 23            | 14          |
| 400% | 2557    | 12            | 10          |

PDFium culls objects by region; Poppler executes the whole content stream per
tile, so its cost is flat regardless of output size. WASM is within ~1.7x of
native in either direction — not a meaningful penalty.

**Spike 2 — canvas + markups + React.** Main-thread work per frame, real page,
markups modeled on the Qt overlay primitives:

| case | markups | in view | p50 | p99 | >16.7ms |
|---|---:|---:|---:|---:|---:|
| 20k @ 100%             | 20,000 | 2,500 | 7.6  | 12.8 | 0% |
| cold pan @ 200%        | 2,000  | —     | 2.7  | 6.9  | 0% |
| heavy React + 20k      | 20,000 | 2,500 | 7.3  | 12.7 | 0% |
| heavy React + 40k      | 40,000 | 4,988 | 17.4 | 43.5 | 56% |

Ceiling is ~3,700 markups simultaneously in view. Rasterization runs in a Web
Worker, so tile cost (24-98ms each) never touches the frame budget. React
commits cost ~2.5ms flat and are not the bottleneck.

Full method and caveats: `docs/SPIKES.md`.

## Layout

    packages/domain    pure TS — geometry, units, quantity roll-up. No DOM, no SQL.
    packages/store     SQLite schema (ported verbatim) + migration runner
    packages/viewer    PDFium worker, tile cache, two-layer canvas compositor
    apps/desktop       React shell

The domain package must stay dependency-free. That property is what let the
Qt build's logic be lifted out at all — see `docs/PORTING.md`.

## Getting started

```bash
npm install          # postinstall copies pdfium.wasm into apps/desktop/public
npm test             # domain unit tests
npm run typecheck    # tsc -b across all projects
npm run dev          # http://localhost:5180
```

`apps/desktop/public/sample.pdf` is gitignored — drop any drawing there to
load it. Scroll to zoom, drag to pan.

## Status

Working end to end and used on real bid sets: PDFium tile rendering with a
two-layer compositor, pan/zoom, a 75-sheet index read from the drawing's own
bookmarks, markup authoring (area / cutout / polyline / count / dimension),
snapping, per-page calibration and per-region scales, SQLite persistence in a
native Rust driver, the ported layout engine (planks, panels, baffles,
cassettes) with piece and part counts, the bill of materials, branded HTML and
marked-up-PDF export, undo/redo, full-text search, and an MCP automation
surface that can drive the app the way a person would.

Quantities are verified against golden fixtures ported from the Qt build, and
against a human estimator's quoted quantities in
`fixtures/ground-truth/barclays-28019.json`.

The shell is Windows 11 Fluent: Mica behind untinted chrome, the accent read
from the user's own Windows theme, one command bar over the drawing, and a
single sidebar whose tabs expand.

### Known gaps

- **The scope configurator is half-designed.** Required measures are marked on
  the field, but the measure captions, unit combo boxes and the derived-triple
  hint (spacing = width + reveal) are drawn in the design and not yet built.
- **Three capabilities are written, tested and unreachable** — finish-region
  tracing, callout/highlight annotation, and direction zones. `reachability.test.ts`
  lists them with the reason each one is still there; nothing silently rots.
- **The agent review gate is schema only.** `markups.review_state` has
  defaulted to `accepted` since the first migration, so nothing proposes yet.
- **Accuracy against a human takeoff has not been measured.** The oracle exists;
  the comparison run (plan 07.2) has not been done, so every accuracy claim here
  is still self-consistency.
- **Installers are unsigned**, and no update endpoint is configured — the
  updater says so rather than claiming the copy is current.

## Licence

None granted. This repository is readable so the work can be shown and
discussed; it is not open source, and publishing it is not a licence to use,
copy, modify or redistribute it. If you want to do any of those, ask.

## Builds

Installers for both Windows architectures are on the Releases page — `x64` for
most machines, `arm64` for Snapdragon and other ARM devices. They are unsigned,
so SmartScreen warns on first run: **More info → Run anyway**. Building from
source is documented in `docs/PACKAGING.md`.
