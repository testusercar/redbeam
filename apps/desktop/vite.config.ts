import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Set by `tauri dev`/`tauri build`. Absent for a plain `npm run dev`, and the
// config deliberately leaves the web-only defaults alone in that case.
const tauriPlatform = process.env.TAURI_ENV_PLATFORM
const tauriDebug = !!process.env.TAURI_ENV_DEBUG
// Only set when developing against a device on the LAN (mobile / another box).
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  // pdfium ships a large wasm blob; let it load at runtime rather than prebundling
  optimizeDeps: { exclude: ['@embedpdf/pdfium'] },
  worker: { format: 'es' },
  // Tauri owns the terminal during `tauri dev`; vite must not wipe its output.
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  server: {
    port: 5180,
    strictPort: true,
    host: host || false,
    ...(host ? { hmr: { protocol: 'ws', host, port: 5181 } } : {}),
    // The Rust tree is not frontend source; watching it restarts HMR pointlessly.
    watch: { ignored: ['**/src-tauri/**'] },
  },
  ...(tauriPlatform
    ? {
        build: {
          // WebView2 on Windows is evergreen Chromium; WKWebView is the floor
          // elsewhere. No point shipping transpiled output to either.
          target: tauriPlatform === 'windows' ? 'chrome105' : 'safari13',
          minify: tauriDebug ? (false as const) : ('esbuild' as const),
          sourcemap: tauriDebug,
        },
      }
    : {}),
})
