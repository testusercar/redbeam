import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate, type Migration } from './index.js'
import { SqlJsDriver } from './sqljs.js'
import {
  ensureDocumentAndPage, listMarkups, upsertScope, getCalibration, listActivity,
} from './repo.js'
import {
  UndoStack, createMarkup, removeMarkup, editGeometry, reassignScope, setCalibration, batch,
} from './commands.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', 'migrations')

function loadMigrations(): Migration[] {
  return readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().map((f) => {
    const m = /^(\d+)_([a-z0-9]+)\.sql$/i.exec(f)!
    return { version: Number(m[1]), name: m[2]!, sql: readFileSync(join(migrationsDir, f), 'utf8') }
  })
}

const DOC = { id: 'doc-1', relativePath: 'sample.pdf', displayName: 'Sample' }
const PAGE = { id: 'page-1', documentId: 'doc-1', pageNumber: 1, width: 1000, height: 1000 }
const ringA = [[{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }]]
const ringB = [[{ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.3 }, { x: 0.4, y: 0.4 }]]

const markup = (id = 'm1') => ({
  id, documentId: 'doc-1', pageId: 'page-1', scopeId: null,
  kind: 'area', rings: ringA, origin: 'user', reviewState: 'accepted' as const,
})

let db: SqlJsDriver
let stack: UndoStack

beforeEach(async () => {
  db = await SqlJsDriver.open()
  await migrate(db, loadMigrations())
  await ensureDocumentAndPage(db, DOC, PAGE)
  stack = new UndoStack(db)
})

describe('create / undo / redo', () => {
  it('creates, undoes, and redoes a markup', async () => {
    await stack.run(createMarkup(markup()))
    expect(await listMarkups(db)).toHaveLength(1)

    await stack.undo()
    expect(await listMarkups(db)).toHaveLength(0)

    await stack.redo()
    const after = await listMarkups(db)
    expect(after).toHaveLength(1)
    expect(after[0]!.id).toBe('m1')          // same id survives the round trip
    expect(after[0]!.rings).toEqual(ringA)
  })

  it('undoing a create soft-deletes rather than dropping the row', async () => {
    await stack.run(createMarkup(markup()))
    await stack.undo()
    expect(await listMarkups(db, { includeDeleted: true })).toHaveLength(1)
  })
})

describe('delete / undo', () => {
  it('restores a deleted markup', async () => {
    await stack.run(createMarkup(markup()))
    await stack.run(removeMarkup({ id: 'm1', kind: 'area', origin: 'user' }))
    expect(await listMarkups(db)).toHaveLength(0)

    await stack.undo()
    expect(await listMarkups(db)).toHaveLength(1)
  })
})

describe('geometry edits', () => {
  it('reverts to the previous rings', async () => {
    await stack.run(createMarkup(markup()))
    await stack.run(editGeometry('m1', ringA, ringB, 'move'))
    expect((await listMarkups(db))[0]!.rings).toEqual(ringB)

    await stack.undo()
    expect((await listMarkups(db))[0]!.rings).toEqual(ringA)

    await stack.redo()
    expect((await listMarkups(db))[0]!.rings).toEqual(ringB)
  })

  it('unwinds a chain of edits one step at a time', async () => {
    const ringC = [[{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.6, y: 0.6 }]]
    await stack.run(createMarkup(markup()))
    await stack.run(editGeometry('m1', ringA, ringB))
    await stack.run(editGeometry('m1', ringB, ringC))

    await stack.undo()
    expect((await listMarkups(db))[0]!.rings).toEqual(ringB)
    await stack.undo()
    expect((await listMarkups(db))[0]!.rings).toEqual(ringA)
    await stack.undo()
    expect(await listMarkups(db)).toHaveLength(0)
  })
})

describe('scope reassignment', () => {
  it('reverts the scope', async () => {
    await upsertScope(db, {
      id: 's1', label: 'S', scopeType: 'area', color: '#000', specifications: {}, archivedAt: null,
    })
    await stack.run(createMarkup(markup()))
    await stack.run(reassignScope('m1', null, 's1'))
    expect((await listMarkups(db))[0]!.scopeId).toBe('s1')
    await stack.undo()
    expect((await listMarkups(db))[0]!.scopeId).toBeNull()
  })
})

describe('calibration', () => {
  it('removes the calibration entirely when there was none before', async () => {
    await stack.run(setCalibration('doc-1', 'page-1', null, 0.5))
    expect((await getCalibration(db, 'page-1'))!.feetPerPdfPoint).toBeCloseTo(0.5, 12)

    await stack.undo()
    // must go back to uncalibrated, NOT to zero — the schema CHECK forbids zero
    // and a zero scale would silently produce nonsense quantities
    expect(await getCalibration(db, 'page-1')).toBeNull()
  })

  it('restores the previous scale when there was one', async () => {
    await stack.run(setCalibration('doc-1', 'page-1', null, 0.5))
    await stack.run(setCalibration('doc-1', 'page-1', 0.5, 1.25))
    await stack.undo()
    expect((await getCalibration(db, 'page-1'))!.feetPerPdfPoint).toBeCloseTo(0.5, 12)
  })
})

describe('batch', () => {
  it('applies and reverts as one unit, in reverse order', async () => {
    await stack.run(batch('add two', [createMarkup(markup('a')), createMarkup(markup('b'))]))
    expect(await listMarkups(db)).toHaveLength(2)
    await stack.undo()
    expect(await listMarkups(db)).toHaveLength(0)
    await stack.redo()
    expect(await listMarkups(db)).toHaveLength(2)
  })
})

describe('stack behaviour', () => {
  it('reports what can be undone and redone', async () => {
    expect(stack.state.canUndo).toBe(false)
    await stack.run(createMarkup(markup()))
    expect(stack.state).toMatchObject({ canUndo: true, canRedo: false, undoLabel: 'create area' })
    await stack.undo()
    expect(stack.state).toMatchObject({ canUndo: false, canRedo: true, redoLabel: 'create area' })
  })

  it('clears the redo branch once you diverge', async () => {
    await stack.run(createMarkup(markup('a')))
    await stack.undo()
    expect(stack.state.canRedo).toBe(true)
    await stack.run(createMarkup(markup('b')))
    expect(stack.state.canRedo).toBe(false)
  })

  it('is a no-op at the ends', async () => {
    expect(await stack.undo()).toBeNull()
    expect(await stack.redo()).toBeNull()
  })

  it('drops the oldest command past the limit', async () => {
    const small = new UndoStack(db, 3)
    for (const id of ['a', 'b', 'c', 'd', 'e']) await small.run(createMarkup(markup(id)))
    expect(small.state.depth).toBe(3)
  })
})

describe('activity trail', () => {
  it('records what happened, including the undo', async () => {
    await stack.run(createMarkup(markup()))
    await stack.undo()
    const events = (await listActivity(db)).map((a) => a.eventType)
    expect(events).toContain('markup.created')
    expect(events).toContain('markup.create_undone')
  })

  it('does NOT write to the review queue', async () => {
    await stack.run(createMarkup(markup()))
    // change_sets is the propose/decide gate; editing must not enqueue there
    expect(await db.all('SELECT id FROM change_sets')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Project-scoped undo (docs/DECISIONS.md :: D1)
//
// Everything above exercises the browser fallback: one page, one sql.js
// database, the stack in memory. Everything below exercises the desktop path,
// where the stack belongs to the Rust core and this class is a client of it.
// The core's own behaviour — the concurrency guard, the shared pop — is tested
// in Rust (`src-tauri/src/undo/tests.rs`); what is checked here is that the
// client speaks the contract and holds no stack of its own.
// ---------------------------------------------------------------------------

/** A stand-in for the core. Records every call and replays scripted answers. */
function fakeCore(script: Record<string, unknown[]> = {}) {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = []
  const queues: Record<string, unknown[]> = { ...script }
  const invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ cmd, args: args ?? {} })
    const queue = queues[cmd]
    const next = queue && queue.length > 0 ? queue.shift() : undefined
    if (next instanceof Error) throw next
    return (next ?? status()) as T
  }
  return { invoke, calls }
}

function status(over: Record<string, unknown> = {}) {
  return {
    canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, depth: 0,
    undoTarget: null, redoTarget: null, ...over,
  }
}

function coreStack(invoke: ReturnType<typeof fakeCore>['invoke'], limit = 100) {
  return new UndoStack(db, limit, { mode: 'core', invoke })
}

describe('core mode — the stack lives in the Rust process', () => {
  it('hands the command to the core as data and does not write locally', async () => {
    const core = fakeCore({
      undo_record: [status({ canUndo: true, undoLabel: 'create area', depth: 1 })],
    })
    const coreUndo = coreStack(core.invoke)

    await coreUndo.run(createMarkup(markup()))

    expect(core.calls).toHaveLength(1)
    expect(core.calls[0]!.cmd).toBe('undo_record')
    expect(core.calls[0]!.args).toMatchObject({ apply: true, limit: 100 })
    const record = core.calls[0]!.args.record as Record<string, unknown>
    expect(record).toMatchObject({
      op: 'create_markup', label: 'create area', entityType: 'markup',
      entityId: 'm1', documentId: 'doc-1', pageId: 'page-1', origin: 'user',
    })
    expect((record.after as Record<string, unknown>).rings).toEqual(ringA)

    // The core owns the write. A local apply as well would double-insert.
    expect(await listMarkups(db)).toHaveLength(0)
    expect(coreUndo.state).toMatchObject({ canUndo: true, undoLabel: 'create area', depth: 1 })
  })

  it('push() records without asking the core to apply', async () => {
    const core = fakeCore()
    await coreStack(core.invoke).push(createMarkup(markup()))
    expect(core.calls[0]!.args).toMatchObject({ apply: false })
  })

  it('undo reports what it reverted, and where to find it', async () => {
    const core = fakeCore({
      undo_apply: [{
        ok: true, op: 'edit_geometry', label: 'move markup',
        target: { entityType: 'markup', entityId: 'm1', documentId: 'doc-1', pageId: 'page-12' },
        status: status({ canRedo: true, redoLabel: 'move markup' }),
      }],
    })
    const coreUndo = coreStack(core.invoke)

    const out = await coreUndo.undo()
    expect(core.calls[0]!.cmd).toBe('undo_apply')
    expect(out).toEqual({
      op: 'edit_geometry',
      label: 'move markup',
      // D1: an undo you cannot see is the failure mode, so the window has to be
      // told which page to go to.
      target: { entityType: 'markup', entityId: 'm1', documentId: 'doc-1', pageId: 'page-12' },
    })
    expect(coreUndo.state).toMatchObject({ canRedo: true, redoLabel: 'move markup' })
  })

  it('is a no-op at the ends, without inventing an outcome', async () => {
    const core = fakeCore({
      undo_apply: [{ ok: false, status: status() }],
      undo_redo: [{ ok: false, status: status() }],
    })
    const coreUndo = coreStack(core.invoke)
    expect(await coreUndo.undo()).toBeNull()
    expect(await coreUndo.redo()).toBeNull()
  })

  it('surfaces a refused revert instead of swallowing it', async () => {
    // The core refuses when the entity moved since the command was recorded.
    // The message is written to be shown to the estimator as-is, so it must not
    // be replaced with something generic on the way through.
    const refusal = new Error(
      'cannot undo "move markup": markup m1 has changed since that edit ' +
        '(last edited 2026-08-28T09:00:00.000Z, this command expected 2026-08-28T08:59:00.000Z).',
    )
    const coreUndo = coreStack(fakeCore({ undo_apply: [refusal] }).invoke)
    await expect(coreUndo.undo()).rejects.toThrow(/has changed since that edit/)
  })

  it('re-reads shared state, because a peer window can change it', async () => {
    const peerLabel = 'a peer window edit'
    const core = fakeCore({ undo_state: [status({ canUndo: true, undoLabel: peerLabel })] })
    const coreUndo = coreStack(core.invoke)
    expect(coreUndo.state.canUndo).toBe(false)

    const fresh = await coreUndo.fetchState()
    expect(core.calls[0]!.cmd).toBe('undo_state')
    expect(fresh.undoLabel).toBe(peerLabel)
    expect(coreUndo.state.undoLabel).toBe(peerLabel)
  })

  it('carries the constructor limit to the core rather than ignoring it', async () => {
    const core = fakeCore()
    await coreStack(core.invoke, 3).run(createMarkup(markup()))
    expect(core.calls[0]!.args).toMatchObject({ limit: 3 })
  })

  it('accepts a snake_case status, in case the core ever changes its mind', async () => {
    const core = fakeCore({
      undo_state: [{ can_undo: true, can_redo: false, undo_label: 'create area', depth: 2 }],
    })
    const s = await coreStack(core.invoke).fetchState()
    expect(s).toMatchObject({ canUndo: true, undoLabel: 'create area', depth: 2 })
  })
})

describe('serializable records', () => {
  it('describes each command as op / entity / before / after', () => {
    const where = { documentId: 'doc-1', pageId: 'page-1' }
    expect(editGeometry('m1', ringA, ringB, 'move', where).record).toEqual({
      op: 'edit_geometry', label: 'move', entityType: 'markup', entityId: 'm1',
      documentId: 'doc-1', pageId: 'page-1', before: ringA, after: ringB, origin: 'user',
    })

    expect(setCalibration('doc-1', 'page-1', null, 0.5).record).toMatchObject({
      op: 'set_calibration', entityType: 'page', entityId: 'page-1',
      before: null, after: { feetPerPdfPoint: 0.5, source: 'reference-line' },
    })

    const b = batch('add two', [createMarkup(markup('a')), createMarkup(markup('b'))]).record
    expect(b.op).toBe('batch')
    expect((b.after as { children: unknown[] }).children).toHaveLength(2)
  })

  it('exposes what undo would act on, not just its label', async () => {
    await stack.run(createMarkup(markup()))
    expect(stack.state.undoTarget).toEqual({
      entityType: 'markup', entityId: 'm1', documentId: 'doc-1', pageId: 'page-1',
    })
  })
})

describe('agent-origin commands', () => {
  it('are applied but never enter the user stack', async () => {
    // D1: an agent proposal is reversed by rejecting it at the review gate.
    // Mixing them means Ctrl+Z could revert an accepted proposal while the
    // change_sets decision row asserts a decision whose effect is gone.
    await stack.run(createMarkup({ ...markup('agent-1'), origin: 'agent' }))
    expect(await listMarkups(db)).toHaveLength(1)
    expect(stack.state.canUndo).toBe(false)
  })

  it('are stepped over, leaving the user their own last edit', async () => {
    await stack.run(createMarkup(markup('mine')))
    await stack.run(createMarkup({ ...markup('theirs'), origin: 'agent' }))

    expect(stack.state.undoLabel).toBe('create area')
    await stack.undo()
    const left = (await listMarkups(db)).map((m) => m.id)
    expect(left).toEqual(['theirs'])
  })

  it('taint a batch that contains one', async () => {
    await stack.run(batch('mixed', [
      createMarkup(markup('a')),
      createMarkup({ ...markup('b'), origin: 'agent' }),
    ]))
    expect(await listMarkups(db)).toHaveLength(2)
    expect(stack.state.canUndo).toBe(false)
  })
})

describe('command origin', () => {
  /**
   * Undo DEPTH counts only `user` entries, so Ctrl+Z steps past an agent's
   * work to the person's own. A command an agent issued but logged as `user`
   * therefore makes the estimator's next undo revert something they never did.
   */
  it('defaults to user but can be attributed to an agent', () => {
    expect(setCalibration('d', 'p', null, 0.5).record.origin).toBe('user')
    expect(setCalibration('d', 'p', null, 0.5, 'agent', 'agent').record.origin).toBe('agent')

    expect(reassignScope('m', null, 's').record.origin).toBe('user')
    expect(reassignScope('m', null, 's', undefined, 'agent').record.origin).toBe('agent')

    const rings = [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]]
    expect(editGeometry('m', rings, rings).record.origin).toBe('user')
    expect(editGeometry('m', rings, rings, 'edit', undefined, 'agent').record.origin).toBe('agent')
  })

  it('keeps the calibration SOURCE and the undo ORIGIN separate', () => {
    // The source describes how the scale was derived; the origin describes who
    // asked for it. A title-block scale applied by a person is
    // source=preset:<id>, origin=user, and conflating them loses one of the
    // two answers. The source is carried through verbatim — the command layer
    // does not spell it, `presetSource` does.
    const c = setCalibration('d', 'p', null, 0.5, 'preset:arch-1-8', 'user')
    expect(c.record.origin).toBe('user')
    expect(c.record.after).toMatchObject({ source: 'preset:arch-1-8' })
  })
})
