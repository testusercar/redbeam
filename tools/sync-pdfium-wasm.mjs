// @embedpdf/pdfium locks down its exports map, so neither
// `import '@embedpdf/pdfium/dist/pdfium.wasm?url'` nor require.resolve() of its
// package.json works. Walk node_modules directly and copy the blob into the
// app's public/ so it is served as a plain static asset.
// Runs on postinstall; safe to re-run.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const candidates = [
  join(root, 'node_modules', '@embedpdf', 'pdfium', 'dist', 'pdfium.wasm'),
  join(root, 'packages', 'viewer', 'node_modules', '@embedpdf', 'pdfium', 'dist', 'pdfium.wasm'),
]

const src = candidates.find(existsSync)
if (!src) {
  console.error('pdfium.wasm not found. Looked in:\n  ' + candidates.join('\n  '))
  process.exit(1)
}

const dest = join(root, 'apps', 'desktop', 'public', 'pdfium.wasm')
mkdirSync(dirname(dest), { recursive: true })
copyFileSync(src, dest)
console.log('synced pdfium.wasm ->', dest)

// sql.js needs its wasm served alongside too.
const sqlSrc = join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
if (existsSync(sqlSrc)) {
  const sqlDest = join(root, 'apps', 'desktop', 'public', 'sql-wasm.wasm')
  copyFileSync(sqlSrc, sqlDest)
  console.log('synced sql-wasm.wasm ->', sqlDest)
} else {
  console.warn('sql-wasm.wasm not found at', sqlSrc)
}
