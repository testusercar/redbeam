/**
 * `markups.review_state` has defaulted to 'accepted' since the first migration
 * and `change_sets` has been in the schema just as long — and nothing had ever
 * written a 'proposed' row, so the gate was a shape in the database rather
 * than a thing that happens.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate, type Migration } from './index.js'
import { SqlJsDriver } from './sqljs.js'
import { ensureDocumentAndPage, upsertScope, insertMarkup, listMarkups } from './repo.js'
import { recordProposal, listProposals, decideProposal } from './review.js'

const here = dirname(fileURLToPath(import.meta.url))
function loadMigrations(): Migration[] {
  return readdirSync(join(here, '..', 'migrations'))
    .filter((f) => f.endsWith('.sql')).sort()
    .map((f) => {
      const m = /^(\d+)_([a-z0-9]+)\.sql$/i.exec(f)!
      return {
        version: Number(m[1]), name: m[2]!,
        sql: readFileSync(join(here, '..', 'migrations', f), 'utf8'),
      }
    })
}

const DOC = { id: 'doc-1', relativePath: 'a.pdf', displayName: 'A' }
const PAGE = { id: 'page-1', documentId: 'doc-1', pageNumber: 0, width: 612, height: 792 }
const RING = [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]]

let db: SqlJsDriver

beforeEach(async () => {
  db = await SqlJsDriver.open()
  await migrate(db, loadMigrations())
  await ensureDocumentAndPage(db, DOC, PAGE)
  await upsertScope(db, {
    id: 's1', label: 'CL03', scopeType: 'area', color: '#000',
    specifications: {}, archivedAt: null,
  })
})

const propose = async (ids: string[]) => {
  for (const id of ids) {
    await insertMarkup(db, {
      id, documentId: DOC.id, pageId: PAGE.id, scopeId: 's1',
      kind: 'area', rings: RING, origin: 'agent', reviewState: 'proposed',
    })
  }
  await recordProposal(db, {
    id: 'cs-1', title: 'Ceilings on level 47', origin: 'agent', markupIds: ids,
  })
}

describe('the review gate', () => {
  it('keeps a proposal out of the numbers until it is accepted', async () => {
    // The whole reason an agent can propose freely: every quantity path
    // filters on review_state = 'accepted'.
    await propose(['m1', 'm2'])
    expect(await listMarkups(db, {})).toHaveLength(0)
    expect(await listMarkups(db, { reviewStates: ['proposed'] })).toHaveLength(2)
  })

  it('groups a batch so one decision covers it', async () => {
    // Proposing ten ceilings and accepting them one at a time is not review,
    // it is data entry.
    await propose(['m1', 'm2', 'm3'])
    const [set] = await listProposals(db)
    expect(set?.markupIds).toEqual(['m1', 'm2', 'm3'])
    expect(set?.title).toBe('Ceilings on level 47')
    expect(set?.origin).toBe('agent')
  })

  it('accepting puts the markups into the totals', async () => {
    await propose(['m1', 'm2'])
    expect(await decideProposal(db, 'cs-1', 'accepted')).toBe(2)
    expect(await listMarkups(db, {})).toHaveLength(2)
    expect(await listProposals(db)).toHaveLength(0)
  })

  it('rejecting keeps them out, and keeps them', async () => {
    // What was suggested and turned down is exactly what somebody
    // re-litigating a number wants to see.
    await propose(['m1'])
    await decideProposal(db, 'cs-1', 'rejected')
    expect(await listMarkups(db, {})).toHaveLength(0)
    expect(await listMarkups(db, { reviewStates: ['rejected'] })).toHaveLength(1)
  })

  it('records the decision and when it was made', async () => {
    // "Who put this quantity in the bid" gets asked months later.
    await propose(['m1'])
    await decideProposal(db, 'cs-1', 'accepted', '2026-09-03T12:00:00.000Z')
    const rows = await db.all<{ state: string, decided_at: string | null }>(
      'SELECT state, decided_at FROM change_sets WHERE id = ?', ['cs-1'],
    )
    expect(rows[0]).toEqual({ state: 'accepted', decided_at: '2026-09-03T12:00:00.000Z' })
  })

  it('does not decide the same set twice', async () => {
    await propose(['m1'])
    await decideProposal(db, 'cs-1', 'accepted')
    await decideProposal(db, 'cs-1', 'rejected')
    // The second decision finds nothing proposed and changes nothing.
    expect(await listMarkups(db, {})).toHaveLength(1)
  })
})
