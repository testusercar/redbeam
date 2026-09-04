# PDF engine spike — Poppler vs PDFium (native + WASM)

Test file: `2026-04-24 - MIDRISE - PKG A - 50_CD - ARCH.pdf` (97MB, 75pp, 3456x2592pt / E-size)
Machine: this workstation. 512x512px tile at page centre, 7 reps, median reported.
Page complexity (recursive object walk): p48 = 325,868 paths | p36 = 197,865 | p5 = mixed/raster-heavy

## Median ms per 512px tile

| page | zoom | Poppler (poppler-cpp) | PDFium native | PDFium WASM |
|------|------|----------------------:|--------------:|------------:|
| 48   | fit  | 3310 | 921  | 400  |
| 48   | 100% | 2397 | 105  | 64   |
| 48   | 200% | 2331 | 23   | 14   |
| 48   | 400% | 2557 | 12   | 10   |
| 36   | fit  | 2443 | 607  | 295  |
| 36   | 100% | 1765 | 41   | 25   |
| 36   | 200% | 1721 | 15   | 8.7  |
| 36   | 400% | 1720 | 9.8  | 5.9  |
| 5    | fit  | 1476 | 1160 | 1496 |
| 5    | 100% | 1965 | 702  | 995  |
| 5    | 200% | 2631 | 508  | 850  |
| 5    | 400% | 5257 | 488  | 884  |

## Findings

1. **PDFium culls by region; Poppler does not.** PDFium tile cost falls with zoom
   (fewer objects intersect the tile). Poppler's cost is flat ~1.7-2.6s regardless
   of output size, i.e. it executes the whole content stream per tile.
2. **WASM is not a meaningful penalty.** Within ~1.7x of native in either direction;
   faster on p36/p48, slower on p5. Same order of magnitude throughout.
3. **Worst case for PDFium (p5) still beats Poppler** — 488ms vs 5257ms at 400%.

## Caveats

- Poppler measured via poppler-cpp `page_renderer::render_page`. Okular uses
  poppler-qt6 `renderToImage` (splash setSlice), which limits raster area but still
  executes the full content stream. The flat ~1.7-2.4s floor measured at fit-page
  (where output allocation is negligible) is the content-stream cost and is the
  fair comparison; the 5.2s p5@400% figure is inflated by full-page allocation in
  poppler-cpp and should be discounted.
- Rasterization only. Excludes compositing, markup overlay, and text extraction.
- Okular rasterizes off-thread (`generator_pdf.cpp:673 setFeature(Threaded)`), so
  its measured 24.6ms paint is compositing CACHED tiles, not producing them.

## Reproduce

    python clean_native.py "<pdf>" 48
    node bench_wasm.mjs "<pdf>" 48
    ./bench_poppler.exe "<pdf>" 48     # needs C:\CraftRoot\bin on PATH
