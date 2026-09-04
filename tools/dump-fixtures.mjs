/**
 * Golden fixture dump harness (plan 05.1).
 *
 * A fixture has two halves and they come from two different places:
 *
 *   INPUTS   — scope, specifications, calibration and markup geometry. These
 *              are read out of a Qt project.db, which is a real estimate an
 *              estimator actually built. This script does that half.
 *
 *   EXPECTED — the quantities the Qt engine computes from those inputs. Those
 *              must come from the RUNNING Qt build over its MCP bridge; they
 *              are NOT derived here, because a fixture derived from the same
 *              reading of the source it is meant to check proves nothing.
 *
 * A fixture written by this script therefore has `expected: null`. The runner
 * (packages/domain/src/fixtures.test.ts) reports those as PENDING and fails if
 * one is silently treated as passing. Filling them is plan 05.2 and needs the
 * bridge at %TEMP%/redbeam-okular-bridge.json, which only exists while the Qt
 * build is running.
 *
 * Usage:
 *   node tools/dump-fixtures.mjs "<path to project.db>" [--out fixtures] [--name prefix]
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
if (argv.length === 0 || argv.includes('--help')) {
  console.error('usage: node tools/dump-fixtures.mjs <project.db> [--out DIR] [--name PREFIX]')
  process.exit(argv.length === 0 ? 1 : 0)
}

const dbPath = resolve(argv[0])
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const outDir = resolve(flag('--out', 'fixtures'))
const prefix = flag('--name', '')

/**
 * The Qt markup `kind` vocabulary is NOT ours.
 *
 * Qt writes 'area', 'markup', 'pattern_direction', 'calibration_reference'.
 * Only 'area' is a takeoff quantity kind we share. The rest are mapped
 * explicitly rather than passed through, so an unrecognised kind is reported
 * rather than silently becoming something that counts.
 */
const KIND_MAP = {
  area: 'area',
  cutout: 'cutout',
  polyline: 'polyline',
  count: 'count',
  markup: 'shape',
  pattern_direction: null,      // pattern metadata, not takeoff geometry
  calibration_reference: null,  // setup, not takeoff geometry
}

const badSpace = new Set()

/**
 * Convert Qt's stored geometry to our ring form.
 *
 * Qt writes `{ bounds, points: [{x,y}], space }` — ONE flat ring plus a cached
 * bounding box, not the nested `rings` we use. `bounds` is derived and is
 * dropped rather than trusted; recomputing it is cheap and a stale cached box
 * would quietly move a quantity.
 *
 * `space` is checked, not assumed. Every row in the archived projects says
 * "normalized", but a row in page points would be off by three orders of
 * magnitude and would still parse — so an unexpected space is refused.
 */
function parseRings(json) {
  let g
  try { g = JSON.parse(json) } catch { return null }
  if (!g || typeof g !== 'object') return null
  if (g.space !== 'normalized') { badSpace.add(String(g.space)); return null }
  const pts = Array.isArray(g.points) ? g.points : null
  if (!pts || pts.length === 0) return null
  const ring = pts
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x, y: p.y }))
  return ring.length > 0 ? [ring] : null
}

const db = new DatabaseSync(dbPath, { readOnly: true })
const all = (sql, ...args) => db.prepare(sql).all(...args)

const scopes = all(
  `SELECT id, label, scope_type, color, specifications_json, archived_at FROM scopes`,
)
const calRows = all(`SELECT page_id, feet_per_pdf_point FROM calibrations`)
const calByPage = new Map(calRows.map((c) => [c.page_id, c.feet_per_pdf_point]))
const pages = new Map(
  all(`SELECT id, page_number, width_pdf_points, height_pdf_points FROM pages`)
    .map((p) => [p.id, p]),
)

const unknownKinds = new Set()
const written = []
let skippedNoCal = 0
let skippedNoGeometry = 0

for (const s of scopes) {
  const rows = all(
    `SELECT id, page_id, kind, geometry_json FROM markups
      WHERE scope_id = ? AND deleted_at IS NULL`,
    s.id,
  )

  // Group by page: calibration is per page, so a fixture is per (scope, page).
  const byPage = new Map()
  for (const m of rows) {
    const mapped = KIND_MAP[m.kind]
    if (mapped === undefined) { unknownKinds.add(m.kind); continue }
    if (mapped === null) continue
    if (!byPage.has(m.page_id)) byPage.set(m.page_id, [])
    byPage.get(m.page_id).push({ ...m, kind: mapped })
  }

  for (const [pageId, markups] of byPage) {
    const page = pages.get(pageId)
    const feetPerPoint = calByPage.get(pageId)
    // A fixture without a calibration cannot assert a quantity in feet. Skip
    // it loudly rather than inventing a scale.
    if (feetPerPoint === undefined) { skippedNoCal++; continue }
    if (!page) { skippedNoGeometry++; continue }

    const geometry = markups.map((m) => ({ id: m.id, kind: m.kind, rings: parseRings(m.geometry_json) }))
      .filter((m) => m.rings !== null)
    if (geometry.length === 0) { skippedNoGeometry++; continue }

    const name = `${prefix}${s.label}-p${page.page_number}`.replace(/[^A-Za-z0-9._-]+/g, '_')
    const fixture = {
      name,
      source: { db: dbPath, scopeId: s.id, pageId },
      scope: {
        label: s.label,
        // Qt's scope_type is the PRODUCT type; our ScopeType is the
        // measurement type. Both are recorded, neither is inferred.
        productType: s.scope_type,
        specifications: JSON.parse(s.specifications_json || '{}'),
      },
      calibration: {
        feetPerPoint,
        pageWidth: page.width_pdf_points,
        pageHeight: page.height_pdf_points,
      },
      markups: geometry,
      /**
       * Filled by plan 05.2 from the RUNNING Qt build over its MCP bridge.
       * Null means "not yet captured" and the runner reports it as pending.
       * It must never be confused with "expected nothing".
       */
      expected: null,
    }

    mkdirSync(outDir, { recursive: true })
    const file = join(outDir, `${name}.json`)
    writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n', 'utf8')
    written.push({ name, markups: geometry.length, feetPerPoint })
  }
}

db.close()

for (const w of written) {
  console.log(`wrote ${w.name}  (${w.markups} markups, ${w.feetPerPoint} ft/pt)`)
}
console.log(`\n${written.length} fixtures -> ${outDir}`)
if (skippedNoCal > 0) console.log(`skipped ${skippedNoCal} (scope,page) with no calibration`)
if (skippedNoGeometry > 0) console.log(`skipped ${skippedNoGeometry} (scope,page) with no usable geometry`)
if (badSpace.size > 0) {
  console.log(`
REFUSED geometry in unexpected coordinate space: ${[...badSpace].join(', ')}`)
  process.exitCode = 2
}
if (unknownKinds.size > 0) {
  console.log(`\nUNMAPPED markup kinds — add them to KIND_MAP: ${[...unknownKinds].join(', ')}`)
  process.exitCode = 2
}
console.log('\nEvery fixture has expected: null. Fill them from the running Qt')
console.log('build (plan 05.2) — they are inputs only until then.')
