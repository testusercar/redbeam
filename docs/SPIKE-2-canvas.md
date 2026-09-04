# Spike 2 — tiled canvas + markup overlay + React chrome

Stack under test: PDFium-WASM in a **Web Worker** → 512px tiles → `<canvas>` raster layer,
markups on a **second canvas** layer, React 18 for chrome only.
Page: real PKG A ARCH page 48 (3456x2592pt, **325,868 vector paths**).
Viewport 1100x760. Markups modeled on `RedbeamOverlayManager`
(`LineOverlay` / `PolygonOverlay` / `DotOverlay`, normalized coords, same fields).
Chrome: 200-node scope tree + 60-line estimate panel + 8,000-row markup table.

## Main-thread work per frame (ms)

| case | total markups | drawn in view | p50 | p95 | p99 | >16.7ms |
|---|---:|---:|---:|---:|---:|---:|
| 2k @100%, live React        | 2,000  | ~250  | 2.9  | 4.9  | 6.3  | 0% |
| 20k @ fit                   | 20,000 | —     | 3.5  | 7.9  | 8.8  | 0% |
| 20k @100%                   | 20,000 | 2,500 | 7.6  | 12.5 | 12.8 | 0% |
| 50k @ fit                   | 50,000 | —     | 5.7  | 16.7 | 26.4 | 4.7% |
| COLD pan @100%              | 2,000  | —     | 3.1  | 4.8  | 6.7  | 0% |
| COLD pan @200%              | 2,000  | —     | 2.7  | 4.8  | 6.9  | 0% |
| HEAVY React @100%           | 2,000  | —     | 3.0  | 4.8  | 6.4  | 0% |
| HEAVY React + 20k           | 20,000 | 2,500 | 7.3  | 10.9 | 12.7 | 0% |
| HEAVY React + 30k           | 30,000 | 3,671 | 11.8 | 16.6 | 21.9 | 3% |
| HEAVY React + 40k           | 40,000 | 4,988 | 17.4 | 28.7 | 43.5 | **56%** |

"HEAVY React" = cursor readout **and** the 8,000-row markup table both re-render
every single frame, forced synchronously via `flushSync`.

## Cost breakdown at 20k markups / 2,500 in view

- raster tile blit: **0.0–0.2 ms**  (drawImage of cached ImageBitmaps)
- markup overlay:   **4.8 ms p50**
- React commit:     **2.5 ms p50**

## Findings

1. **Worker rasterization removes tile cost from the frame budget entirely.**
   Cold panning renders tiles at 24–98ms each, yet frame work stays at p99 ~6.9ms
   and 0% over budget. Tiles pop in; panning never stutters.
2. **React is not the bottleneck** — 2.4–2.6ms per commit, flat across every
   configuration, even with an 8,000-row table re-rendering each frame (only the
   ~40 visible rows reconcile). React chrome is essentially free if it stays off
   the canvas.
3. **Ceiling is ~3,700 markups simultaneously in view** for a 60fps budget.
   Degrades sharply past ~5,000 in view (56% over budget at 4,988).
4. Overlay draw is the dominant term at scale, not raster and not React.

## Headroom vs reality

The perf commit `c512400ac` baseline page had **39 markups**. The measured ceiling
is ~3,700 in view — roughly **95x headroom** over the heaviest real page cited.

## Caveats (important)

- **rAF never fired**: the preview pane was hidden (`visibilityState: 'hidden'`), so
  these are **main-thread CPU work per simulated frame**, NOT true vsync pacing or
  GPU compositing. Main-thread work is the dominant term and the one that decides
  whether 16.7ms is achievable, but it is not the complete picture. Re-run with the
  pane visible via `window.runBench()` (the rAF version) to confirm end-to-end.
- Markups are synthetic, though structurally faithful to the real overlay structs.
- **No snap engine / hit-testing in the loop.** Qt instruments `annotator.snapToContent`
  at a 4ms budget; a real implementation adds that cost on top.
- Single page only — no continuous multi-page scroll, no text/search layer.
- Overlay is canvas2d. WebGL would raise the ceiling substantially if ever needed.

## Reproduce

    npm install && npm run dev      # port 5199
    # in devtools console:
    await window.runBenchSync({ markups: 20000, zoom: 1.0, frames: 150, liveReact: true, heavyReact: true })
    await window.runBench({ ... })  # rAF version — requires a visible window
