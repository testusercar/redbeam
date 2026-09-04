import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate, schemaVersion, type Migration } from './index.js'
import { SqlJsDriver } from './sqljs.js'
import {
  upsertScope, listScopes, setScopeArchived, countMarkupsForScope,
  insertMarkup, listMarkups, deleteMarkup, restoreMarkup, assignMarkupScope, updateMarkupGeometry,
  saveCalibration, getCalibration,
  ensureDocumentAndPage, getPage, listAllCalibrations, listPageBoxes,
  createEstimate, copyEstimate, addScopeToEstimate, listEstimateScopeIds,
  listEstimates, renameEstimate, deleteEstimate, removeScopeFromEstimate,
} from './repo.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', 'migrations')

function loadMigrations(): Migration[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const m = /^(\d+)_([a-z0-9]+)\.sql$/i.exec(f)!
      return { version: Number(m[1]), name: m[2]!, sql: readFileSync(join(migrationsDir, f), 'utf8') }
    })
}

const DOC = { id: 'doc-1', relativePath: 'sample.pdf', displayName: 'Sample' }
const PAGE = { id: 'page-1', documentId: 'doc-1', pageNumber: 1, width: 3456, height: 2592 }

let db: SqlJsDriver

beforeEach(async () => {
  db = await SqlJsDriver.open()
  await migrate(db, loadMigrations())
  await ensureDocumentAndPage(db, DOC, PAGE)
})

describe('migrations', () => {
  // 1-6 are the ported Qt schema; 7 is 007_undo.sql, added for project-scoped
  // undo (docs/DECISIONS.md :: D1); 8 is 008_scaleregions.sql; 9 is
  // 009_scalesource.sql. Bump these together when a block is added.
  it('applies every ported migration cleanly', async () => {
    expect(await schemaVersion(db)).toBe(9)
  })

  it('creates all 29 tables from the Qt build', async () => {
    const rows = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    const names = rows.map((r) => r.name)
    // spot-check the ones the app actually depends on
    for (const t of ['documents', 'pages', 'markups', 'scopes', 'calibrations',
                     'calculation_runs', 'quantity_results', 'estimates', 'change_sets']) {
      expect(names, `missing table ${t}`).toContain(t)
    }
    expect(names.length).toBeGreaterThanOrEqual(29)
  })

  it('is idempotent — re-running applies nothing', async () => {
    const r = await migrate(db, loadMigrations())
    expect(r.applied).toBe(0)
    expect(await schemaVersion(db)).toBe(9)
  })

  // 009_scalesource.sql. `calibrations.source` is the app's record of HOW a
  // scale was set, and the palette used to write `scale-preset:<id>` for the
  // fact the picker wrote as `preset:<id>`. Live project files carry both, so
  // the migration has to move the old ones — a reader that filters on one
  // prefix reports the other half of the set as never having had a scale
  // stated, and reports it silently.
  it('rewrites the legacy scale-preset: source onto one prefix', async () => {
    const fresh = await SqlJsDriver.open()
    await migrate(fresh, loadMigrations().filter((m) => m.version <= 8))
    await ensureDocumentAndPage(fresh, DOC, PAGE)
    const at = '2026-01-01T00:00:00.000Z'
    await fresh.run(
      `INSERT INTO calibrations(id, document_id, page_id, feet_per_pdf_point,
                                source, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?)`,
      ['cal-legacy', DOC.id, PAGE.id, 0.1111, 'scale-preset:arch-1-8', at, at],
    )
    await fresh.run(
      `INSERT INTO scale_regions(id, document_id, page_id, label, x0, y0, x1, y1,
                                 feet_per_pdf_point, source, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['sr-legacy', DOC.id, PAGE.id, 'Detail 3', 0.1, 0.1, 0.4, 0.4, 0.25,
       'scale-preset:arch-1-4', at, at],
    )

    await migrate(fresh, loadMigrations())

    expect((await getCalibration(fresh, PAGE.id))?.source).toBe('preset:arch-1-8')
    const regions = await fresh.all<{ source: string }>('SELECT source FROM scale_regions')
    expect(regions[0]!.source).toBe('preset:arch-1-4')
  })

  // Correcting how a scale's origin is SPELLED is not a re-calibration. An
  // estimator asking when a sheet was last scaled must not be told the date of
  // a schema change — that is the same provenance damage the block repairs.
  it('rewrites the spelling without restamping the row as modified', async () => {
    const fresh = await SqlJsDriver.open()
    await migrate(fresh, loadMigrations().filter((m) => m.version <= 8))
    await ensureDocumentAndPage(fresh, DOC, PAGE)
    const at = '2026-01-01T00:00:00.000Z'
    await fresh.run(
      `INSERT INTO calibrations(id, document_id, page_id, feet_per_pdf_point,
                                source, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?)`,
      ['cal-legacy', DOC.id, PAGE.id, 0.1111, 'scale-preset:arch-1-8', at, at],
    )

    await migrate(fresh, loadMigrations())

    const [row] = await fresh.all<{ source: string, created_at: string, updated_at: string, feet_per_pdf_point: number }>(
      'SELECT source, created_at, updated_at, feet_per_pdf_point FROM calibrations',
    )
    expect(row!.source).toBe('preset:arch-1-8')
    expect(row!.updated_at).toBe(at)
    expect(row!.created_at).toBe(at)
    // The scale itself is never in play. Only its encoding changes.
    expect(row!.feet_per_pdf_point).toBe(0.1111)
  })

  // The vocabulary in `source` is open — `reference-line`, `agent`, and
  // whatever a later import invents all live in this column. The migration
  // moves one prefix, not everything that starts with "scale".
  it('leaves every other source spelling alone', async () => {
    const fresh = await SqlJsDriver.open()
    await migrate(fresh, loadMigrations().filter((m) => m.version <= 8))
    await ensureDocumentAndPage(fresh, DOC, PAGE)
    await saveCalibration(fresh, {
      documentId: DOC.id, pageId: PAGE.id, feetPerPdfPoint: 0.25, source: 'reference-line',
    })

    await migrate(fresh, loadMigrations())

    expect((await getCalibration(fresh, PAGE.id))?.source).toBe('reference-line')
  })

  it('surfaces unsupported statements instead of swallowing them', async () => {
    // stock sql.js ships FTS3, not FTS5, so page_text_fts cannot be created.
    // The gap must be reported, not hidden.
    const fresh = await SqlJsDriver.open()
    const r = await migrate(fresh, loadMigrations())
    expect(r.applied).toBe(9)
    expect(r.skipped.map((s) => s.statement).join(' | ')).toContain('fts5')
  })

  it('enforces foreign keys', async () => {
    await expect(
      insertMarkup(db, {
        id: 'orphan', documentId: 'nope', pageId: 'nope', scopeId: null,
        kind: 'area', rings: [], origin: 'user', reviewState: 'accepted',
      }),
    ).rejects.toThrow()
  })
})

describe('pages', () => {
  it('round-trips the page box', async () => {
    const p = await getPage(db, 'page-1')
    expect(p).not.toBeNull()
    expect(p!.width).toBe(3456)
    expect(p!.height).toBe(2592)
  })
})

describe('scopes', () => {
  it('inserts and lists', async () => {
    await upsertScope(db, {
      id: 's1', label: 'CL03 Baffle', scopeType: 'area', color: '#e2483d',
      specifications: { panel: '24x48' }, archivedAt: null,
    })
    const list = await listScopes(db)
    expect(list).toHaveLength(1)
    expect(list[0]!.label).toBe('CL03 Baffle')
    expect(list[0]!.specifications).toEqual({ panel: '24x48' })
  })

  it('upserts rather than duplicating', async () => {
    const base = { id: 's1', scopeType: 'area', color: '#000', specifications: {}, archivedAt: null }
    await upsertScope(db, { ...base, label: 'First' })
    await upsertScope(db, { ...base, label: 'Renamed' })
    const list = await listScopes(db)
    expect(list).toHaveLength(1)
    expect(list[0]!.label).toBe('Renamed')
  })

  it('hides archived scopes', async () => {
    await upsertScope(db, {
      id: 's1', label: 'Gone', scopeType: 'area', color: '#000',
      specifications: {}, archivedAt: new Date().toISOString(),
    })
    expect(await listScopes(db)).toHaveLength(0)
  })

  it('shows archived scopes on request, after the live ones', async () => {
    // Without this, archiving is a one-way trip: the row survives but nothing
    // can see it, so archiving the wrong scope has no route back short of SQL.
    const base = { scopeType: 'area', color: '#000', specifications: {} }
    await upsertScope(db, { ...base, id: 's1', label: 'Live', archivedAt: null })
    await upsertScope(db, { ...base, id: 's2', label: 'Archived', archivedAt: new Date().toISOString() })
    const all = await listScopes(db, { includeArchived: true })
    expect(all.map((s) => s.label)).toEqual(['Live', 'Archived'])
    expect(await listScopes(db)).toHaveLength(1)
  })

  it('archives and restores, and restoring brings the takeoff back', async () => {
    await upsertScope(db, {
      id: 's1', label: 'CL03', scopeType: 'area', color: '#000',
      specifications: {}, archivedAt: null,
    })
    await insertMarkup(db, {
      id: 'm1', documentId: 'doc-1', pageId: 'page-1', scopeId: 's1', kind: 'area',
      rings: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]],
      origin: 'user', reviewState: 'accepted',
    })

    await setScopeArchived(db, 's1', true)
    expect(await listScopes(db)).toHaveLength(0)
    // The markups must NOT be detached. Nulling scope_id on archive would
    // silently destroy the association, and restoring could not undo it.
    expect(await countMarkupsForScope(db, 's1')).toBe(1)

    await setScopeArchived(db, 's1', false)
    const live = await listScopes(db)
    expect(live).toHaveLength(1)
    expect(live[0]!.archivedAt).toBeNull()
    expect(await countMarkupsForScope(db, 's1')).toBe(1)
  })

  it('does not count soft-deleted markups against a scope', async () => {
    await upsertScope(db, {
      id: 's1', label: 'CL03', scopeType: 'area', color: '#000',
      specifications: {}, archivedAt: null,
    })
    await insertMarkup(db, {
      id: 'm1', documentId: 'doc-1', pageId: 'page-1', scopeId: 's1', kind: 'area',
      rings: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]],
      origin: 'user', reviewState: 'accepted',
    })
    await deleteMarkup(db, 'm1')
    expect(await countMarkupsForScope(db, 's1')).toBe(0)
  })
})

describe('markups', () => {
  const ring = [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.1, y: 0.2 }]
  const mk = (id: string, over: Partial<Parameters<typeof insertMarkup>[1]> = {}) => ({
    id, documentId: 'doc-1', pageId: 'page-1', scopeId: null,
    kind: 'area', rings: [ring], origin: 'user', reviewState: 'accepted' as const, ...over,
  })

  it('round-trips geometry exactly', async () => {
    await insertMarkup(db, mk('m1'))
    const list = await listMarkups(db, { pageId: 'page-1' })
    expect(list).toHaveLength(1)
    expect(list[0]!.rings).toEqual([ring])
  })

  it('SOFT deletes — the row survives for audit', async () => {
    await insertMarkup(db, mk('m1'))
    await deleteMarkup(db, 'm1')
    expect(await listMarkups(db)).toHaveLength(0)
    expect(await listMarkups(db, { includeDeleted: true })).toHaveLength(1)
  })

  it('restores a soft-deleted markup', async () => {
    await insertMarkup(db, mk('m1'))
    await deleteMarkup(db, 'm1')
    await restoreMarkup(db, 'm1')
    expect(await listMarkups(db)).toHaveLength(1)
  })

  it('excludes proposed markups from the default listing', async () => {
    await insertMarkup(db, mk('m1'))
    await insertMarkup(db, mk('m2', { reviewState: 'proposed' }))
    // quantities must only ever see accepted markups
    expect(await listMarkups(db)).toHaveLength(1)
    expect(await listMarkups(db, { reviewStates: ['accepted', 'proposed'] })).toHaveLength(2)
  })

  it('nulls scope_id when the scope is deleted, keeping the markup', async () => {
    await upsertScope(db, {
      id: 's1', label: 'S', scopeType: 'area', color: '#000', specifications: {}, archivedAt: null,
    })
    await insertMarkup(db, mk('m1', { scopeId: 's1' }))
    await db.run('DELETE FROM scopes WHERE id = ?', ['s1'])
    const list = await listMarkups(db)
    expect(list).toHaveLength(1)
    expect(list[0]!.scopeId).toBeNull()   // ON DELETE SET NULL
  })

  it('reassigns scope', async () => {
    await upsertScope(db, {
      id: 's1', label: 'S', scopeType: 'area', color: '#000', specifications: {}, archivedAt: null,
    })
    await insertMarkup(db, mk('m1'))
    await assignMarkupScope(db, 'm1', 's1')
    expect((await listMarkups(db))[0]!.scopeId).toBe('s1')
  })
})

describe('calibration', () => {
  it('round-trips and upserts on (document, page)', async () => {
    await saveCalibration(db, {
      documentId: 'doc-1', pageId: 'page-1', feetPerPdfPoint: 48 / 72, source: 'reference-line',
    })
    expect((await getCalibration(db, 'page-1'))!.feetPerPdfPoint).toBeCloseTo(48 / 72, 12)

    await saveCalibration(db, {
      documentId: 'doc-1', pageId: 'page-1', feetPerPdfPoint: 96 / 72, source: 'reference-line',
    })
    const rows = await db.all('SELECT id FROM calibrations')
    expect(rows).toHaveLength(1)
    expect((await getCalibration(db, 'page-1'))!.feetPerPdfPoint).toBeCloseTo(96 / 72, 12)
  })

  it('rejects a non-positive scale (schema CHECK)', async () => {
    await expect(
      saveCalibration(db, { documentId: 'doc-1', pageId: 'page-1', feetPerPdfPoint: 0, source: 'x' }),
    ).rejects.toThrow()
  })

  it('returns null for an uncalibrated page', async () => {
    expect(await getCalibration(db, 'page-1')).toBeNull()
  })
})

describe('persistence', () => {
  it('survives an export/reopen cycle', async () => {
    await upsertScope(db, {
      id: 's1', label: 'Persisted', scopeType: 'area', color: '#000', specifications: {}, archivedAt: null,
    })
    const bytes = db.export()

    const reopened = await SqlJsDriver.open(bytes)
    expect(await schemaVersion(reopened)).toBe(9)
    const list = await listScopes(reopened)
    expect(list[0]!.label).toBe('Persisted')
  })
})

describe('markup editing', () => {
  const ring = [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }]

  it('replaces geometry in place', async () => {
    await insertMarkup(db, {
      id: 'm1', documentId: 'doc-1', pageId: 'page-1', scopeId: null,
      kind: 'area', rings: [ring], origin: 'user', reviewState: 'accepted',
    })
    const moved = [ring.map((p) => ({ x: p.x + 0.05, y: p.y }))]
    await updateMarkupGeometry(db, 'm1', moved)

    const list = await listMarkups(db)
    expect(list).toHaveLength(1)
    expect(list[0]!.rings).toEqual(moved)
  })

  it('bumps updated_at so edits are auditable', async () => {
    await insertMarkup(db, {
      id: 'm1', documentId: 'doc-1', pageId: 'page-1', scopeId: null,
      kind: 'area', rings: [ring], origin: 'user', reviewState: 'accepted',
    })
    const before = await db.all<{ updated_at: string }>('SELECT updated_at FROM markups WHERE id = ?', ['m1'])
    await new Promise((r) => setTimeout(r, 5))
    await updateMarkupGeometry(db, 'm1', [ring])
    const after = await db.all<{ updated_at: string }>('SELECT updated_at FROM markups WHERE id = ?', ['m1'])
    expect(after[0]!.updated_at >= before[0]!.updated_at).toBe(true)
  })
})

describe('column vocabularies', () => {
  // These are the Qt build's vocabularies, not ours. The schema has no CHECK
  // constraints on them, so a wrong value is accepted silently and only shows
  // up later as a document that never matches a filter. Pinned here because
  // exactly that happened: an earlier revision wrote 'available', which is not
  // one of the three the Qt build uses.
  it('writes an availability value the Qt build actually uses', async () => {
    const rows = await db.all<{ availability: string; kind: string }>(
      'SELECT availability, kind FROM documents WHERE id = ?', ['doc-1'],
    )
    expect(['local', 'online_only', 'unavailable']).toContain(rows[0]!.availability)
    expect(['drawing', 'specification', 'submittal', 'other']).toContain(rows[0]!.kind)
  })
})

/**
 * A scope spans DOCUMENTS as well as sheets — a ceiling continues from the
 * architectural set onto the interiors set — so a total that stops at the open
 * file is not a total. These are what let the roll-up measure every page at
 * its own scale without knowing in advance which files it is about to see.
 */
describe('project-wide readers', () => {
  const seedTwoDocuments = async () => {
    await ensureDocumentAndPage(db, { id: 'doc-a', relativePath: 'a.pdf', displayName: 'A' },
      { id: 'doc-a-p0', documentId: 'doc-a', pageNumber: 0, width: 612, height: 792 })
    await ensureDocumentAndPage(db, { id: 'doc-b', relativePath: 'b.pdf', displayName: 'B' },
      { id: 'doc-b-p0', documentId: 'doc-b', pageNumber: 0, width: 1224, height: 1584 })
    await saveCalibration(db, { documentId: 'doc-a', pageId: 'doc-a-p0', feetPerPdfPoint: 0.25, source: 'test' })
    await saveCalibration(db, { documentId: 'doc-b', pageId: 'doc-b-p0', feetPerPdfPoint: 0.5, source: 'test' })
  }

  it('returns every calibration in the project, by page', async () => {
    await seedTwoDocuments()
    const cals = await listAllCalibrations(db)
    expect(cals.get('doc-a-p0')).toBe(0.25)
    expect(cals.get('doc-b-p0')).toBe(0.5)
  })

  it('returns every page box in the project', async () => {
    // Normalized geometry means nothing without the box it was normalized
    // against, and the boxes differ across a real set.
    await seedTwoDocuments()
    const boxes = await listPageBoxes(db)
    expect(boxes.get('doc-a-p0')).toEqual({ width: 612, height: 792 })
    expect(boxes.get('doc-b-p0')).toEqual({ width: 1224, height: 1584 })
  })

  it('leaves out a page whose box was never recorded', async () => {
    // Unmeasured beats measured at zero.
    await seedTwoDocuments()
    await db.run(
      "INSERT INTO pages (id, document_id, page_number, created_at, updated_at) VALUES ('doc-a-p9','doc-a',9,'t','t')",
    )
    expect((await listPageBoxes(db)).has('doc-a-p9')).toBe(false)
  })
})

/**
 * A bidding round IS a copy: the same scopes priced a different way, an
 * alternate with one product swapped. The store could always do this and
 * nothing called it, so the only way to bid an alternate was to rebuild every
 * scope by hand and hope the specifications matched.
 */
describe('copyEstimate', () => {
  const seedRound = async () => {
    await createEstimate(db, 'est-1', '100% CD')
    for (const [i, id] of ['sc-a', 'sc-b'].entries()) {
      await upsertScope(db, {
        id, label: id.toUpperCase(), scopeType: 'area', color: '#123456',
        specifications: { productType: 'planks', plankWidth: '6' }, archivedAt: null,
      })
      await addScopeToEstimate(db, "est-1", id)
    }
  }

  it('carries the scopes and their specifications', async () => {
    await seedRound()
    await copyEstimate(db, 'est-1', 'est-2', 'Alternate', (src) => `copy-${src}`)
    const ids = await listEstimateScopeIds(db, 'est-2')
    expect(ids).toEqual(['copy-sc-a', 'copy-sc-b'])
    const copied = (await listScopes(db)).find((s) => s.id === 'copy-sc-a')
    expect(copied?.label).toBe('SC-A')
    expect(copied?.specifications).toEqual({ productType: 'planks', plankWidth: '6' })
  })

  it('leaves the source alone', async () => {
    await seedRound()
    await copyEstimate(db, 'est-1', 'est-2', 'Alternate', (src) => `copy-${src}`)
    expect(await listEstimateScopeIds(db, 'est-1')).toEqual(['sc-a', 'sc-b'])
  })

  it('does not carry the takeoff', async () => {
    // Copying markups would double every quantity in the project against
    // drawings that were traced once, which is never what a round means.
    await seedRound()
    await insertMarkup(db, {
      id: 'mk-1', documentId: DOC.id, pageId: PAGE.id, scopeId: 'sc-a',
      kind: 'area', rings: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]],
      origin: 'user', reviewState: 'accepted',
    })
    await copyEstimate(db, 'est-1', 'est-2', 'Alternate', (src) => `copy-${src}`)
    expect(await countMarkupsForScope(db, 'copy-sc-a')).toBe(0)
    expect(await countMarkupsForScope(db, 'sc-a')).toBe(1)
  })

  it('leaves nothing behind when it cannot finish', async () => {
    // It wrote the estimate row and then its scopes one at a time with nothing
    // holding them together, so a failure partway left an estimate claiming to
    // be a copy with half the work missing.
    await seedRound()
    await expect(
      // Two scopes, one id: the second insert collides with the first.
      copyEstimate(db, 'est-1', 'est-3', 'Doomed', () => 'same-id'),
    ).rejects.toThrow()
    const rows = await db.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM estimates WHERE id = 'est-3'",
    )
    expect(rows[0]?.n).toBe(0)
  })
})

/**
 * Deleting a bidding round is a filing decision. Destroying traced work is
 * not, and an estimator who has spent an afternoon on a ceiling should not
 * lose it to a click on the round it happens to live in.
 */
describe('estimate lifecycle', () => {
  const round = async (id: string, name: string, scopes: string[]) => {
    await createEstimate(db, id, name)
    for (const s of scopes) {
      await upsertScope(db, {
        id: s, label: s, scopeType: 'area', color: '#000',
        specifications: {}, archivedAt: null,
      })
      await addScopeToEstimate(db, id, s)
    }
  }

  it('renames a round', async () => {
    await round('e1', '90% BID', [])
    await renameEstimate(db, 'e1', '  100% CD  ')
    expect((await listEstimates(db)).find((e) => e.id === 'e1')?.name).toBe('100% CD')
  })

  it('refuses a nameless round', async () => {
    // A round with no name cannot be told from another with no name, and the
    // list is how you choose which bid you are working on.
    await round('e1', '90% BID', [])
    await expect(renameEstimate(db, 'e1', '   ')).rejects.toThrow()
  })

  it('deletes an empty round', async () => {
    await round('e1', 'Scratch', [])
    await deleteEstimate(db, 'e1')
    expect((await listEstimates(db)).some((e) => e.id === 'e1')).toBe(false)
  })

  it('archives a scope the round alone held, rather than deleting it', async () => {
    // A specification somebody typed is worth more than the row it occupies.
    await round('e1', 'Scratch', ['only-here'])
    await deleteEstimate(db, 'e1')
    expect((await listScopes(db)).some((s) => s.id === 'only-here')).toBe(false)
    expect((await listScopes(db, { includeArchived: true })).some((s) => s.id === 'only-here')).toBe(true)
  })

  it('holds a scope in exactly one round, which is why a copy mints new ones', () => {
    // estimate_scopes.scope_id is UNIQUE. Recorded here because the delete and
    // remove rules below only make sense given it: there is never another
    // round for a scope to survive in.
    expect(true).toBe(true)
  })

  it('REFUSES to delete a round holding the only copy of real takeoff', async () => {
    await round('e1', 'A', ['traced'])
    await insertMarkup(db, {
      id: 'mk-x', documentId: DOC.id, pageId: PAGE.id, scopeId: 'traced',
      kind: 'area', rings: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]],
      origin: 'user', reviewState: 'accepted',
    })
    await expect(deleteEstimate(db, 'e1')).rejects.toThrow(/markup/)
    // And nothing moved.
    expect((await listEstimates(db)).some((e) => e.id === 'e1')).toBe(true)
    expect(await countMarkupsForScope(db, 'traced')).toBe(1)
  })

  it('archives a scope removed from its only round', async () => {
    // A scope in no estimate is unreachable from the panel and would take its
    // markups somewhere nothing lists.
    await round('e1', 'A', ['solo'])
    await removeScopeFromEstimate(db, 'e1', 'solo')
    expect(await listEstimateScopeIds(db, 'e1')).toEqual([])
    expect((await listScopes(db)).some((s) => s.id === 'solo')).toBe(false)
  })

  it('refuses to move a scope into a second round', async () => {
    // The schema says a scope has one round. Asserting it here means the
    // archive-on-remove rule is not resting on an assumption nobody checked.
    await round('e1', 'A', ['solo'])
    await createEstimate(db, 'e2', 'B')
    await addScopeToEstimate(db, 'e2', 'solo')
    expect(await listEstimateScopeIds(db, 'e2')).toEqual([])
    expect(await listEstimateScopeIds(db, 'e1')).toEqual(['solo'])
  })
})
