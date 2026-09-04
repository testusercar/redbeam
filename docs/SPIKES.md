# Spikes

Both spikes ran against the real Barclays PKG A ARCH set before any code here
was written. Raw results, method, and reproduce steps:

- [Spike 1 — PDF engine](./SPIKE-1-pdf-engine.md): Poppler vs PDFium (native + WASM)
- [Spike 2 — canvas + markups + React](./SPIKE-2-canvas.md)

Read the caveats sections. In particular Spike 2 measured main-thread CPU work
per frame, not true vsync pacing, because the test browser pane ran hidden and
`requestAnimationFrame` never fired.
