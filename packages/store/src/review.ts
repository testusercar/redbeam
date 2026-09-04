/**
 * The review gate.
 *
 * An agent proposes markups; a person decides. `markups.review_state` has
 * defaulted to `'accepted'` since the first migration and `change_sets` /
 * `change_set_items` have been in the schema just as long — and nothing has
 * ever written a `'proposed'` row, so the gate has been a shape in the
 * database rather than a thing that happens.
 *
 * Two rules run through everything here:
 *
 *  - A PROPOSAL CHANGES NO NUMBER. Every quantity path filters on
 *    `review_state = 'accepted'`, so a proposal is invisible to the totals
 *    until somebody accepts it. That is what makes it safe for an agent to
 *    propose freely; it is also why the review card has to show what the
 *    number WOULD become, since nothing else will.
 *
 *  - A DECISION IS RECORDED, NOT APPLIED AND FORGOTTEN. Accepting flips the
 *    markups and stamps the change set; rejecting does the same the other way.
 *    Either way the set survives with its decision and its time on it, because
 *    "who put this quantity in the bid" is a question that gets asked months
 *    later.
 */
import type { SqlDriver } from './index.js'

const nowIso = (): string => new Date().toISOString()

export type ChangeSetState = 'proposed' | 'accepted' | 'rejected'

export interface ChangeSet {
  id: string
  title: string
  state: ChangeSetState
  /** `agent` or `user`. A person's own edits do not go through the gate. */
  origin: string
  actorId: string | null
  summary: Record<string, unknown>
  createdAt: string
  decidedAt: string | null
  /** Markup ids this set proposes, in the order they were proposed. */
  markupIds: string[]
}

interface SetRow {
  id: string
  title: string
  state: string
  origin: string
  actor_id: string | null
  summary_json: string | null
  created_at: string
  decided_at: string | null
}

function parse<T>(text: string | null, fallback: T): T {
  if (text === null || text === '') return fallback
  try { return JSON.parse(text) as T } catch { return fallback }
}

/**
 * Record a proposal: the change set, and which markups it covers.
 *
 * The markups themselves are written by the normal markup path with
 * `reviewState: 'proposed'` — this does not duplicate them, it groups them, so
 * that a decision is made once over a batch rather than fifty times over its
 * parts. Proposing ten ceilings and accepting them one at a time is not review,
 * it is data entry.
 */
export async function recordProposal(
  db: SqlDriver,
  input: {
    id: string
    title: string
    origin: string
    actorId?: string | null
    summary?: Record<string, unknown>
    markupIds: readonly string[]
  },
): Promise<void> {
  const now = nowIso()
  await db.run('BEGIN')
  try {
    await db.run(
      `INSERT INTO change_sets(id, title, state, origin, actor_id, summary_json, created_at)
       VALUES(?,?,'proposed',?,?,?,?)`,
      [input.id, input.title, input.origin, input.actorId ?? null,
        JSON.stringify(input.summary ?? {}), now],
    )
    for (let i = 0; i < input.markupIds.length; i++) {
      await db.run(
        `INSERT INTO change_set_items(id, change_set_id, ordinal, command_type, payload_json)
         VALUES(?,?,?,'create_markup',?)`,
        [`${input.id}-${i}`, input.id, i, JSON.stringify({ markupId: input.markupIds[i] })],
      )
    }
    await db.run('COMMIT')
  } catch (err) {
    await db.run('ROLLBACK')
    throw err
  }
}

/** Change sets still awaiting a decision, oldest first. */
export async function listProposals(db: SqlDriver): Promise<ChangeSet[]> {
  const rows = await db.all<SetRow>(
    `SELECT id, title, state, origin, actor_id, summary_json, created_at, decided_at
       FROM change_sets WHERE state = 'proposed' ORDER BY created_at, id`,
  )
  const out: ChangeSet[] = []
  for (const r of rows) {
    const items = await db.all<{ payload_json: string }>(
      'SELECT payload_json FROM change_set_items WHERE change_set_id = ? ORDER BY ordinal',
      [r.id],
    )
    out.push({
      id: r.id,
      title: r.title,
      state: r.state as ChangeSetState,
      origin: r.origin,
      actorId: r.actor_id,
      summary: parse<Record<string, unknown>>(r.summary_json, {}),
      createdAt: r.created_at,
      decidedAt: r.decided_at,
      markupIds: items
        .map((i) => parse<{ markupId?: string }>(i.payload_json, {}).markupId)
        .filter((id): id is string => typeof id === 'string'),
    })
  }
  return out
}

/**
 * Accept or reject a change set, and its markups with it.
 *
 * One transaction: a set marked accepted whose markups are still proposed
 * would be a decision the totals never heard about, and the estimator would be
 * looking at a bid that disagrees with the record of how it was made.
 *
 * A rejected markup is left `'rejected'` rather than deleted. It is evidence —
 * what was suggested and turned down is exactly what somebody re-litigating a
 * number wants to see — and it costs a row.
 */
export async function decideProposal(
  db: SqlDriver,
  changeSetId: string,
  decision: 'accepted' | 'rejected',
  now = nowIso(),
): Promise<number> {
  const items = await db.all<{ payload_json: string }>(
    'SELECT payload_json FROM change_set_items WHERE change_set_id = ? ORDER BY ordinal',
    [changeSetId],
  )
  const ids = items
    .map((i) => parse<{ markupId?: string }>(i.payload_json, {}).markupId)
    .filter((id): id is string => typeof id === 'string')

  await db.run('BEGIN')
  try {
    if (ids.length > 0) {
      await db.run(
        `UPDATE markups SET review_state = ?, updated_at = ?
          WHERE review_state = 'proposed' AND id IN (${ids.map(() => '?').join(',')})`,
        [decision, now, ...ids],
      )
    }
    await db.run(
      `UPDATE change_sets SET state = ?, decided_at = ? WHERE id = ? AND state = 'proposed'`,
      [decision, now, changeSetId],
    )
    await db.run('COMMIT')
  } catch (err) {
    await db.run('ROLLBACK')
    throw err
  }
  return ids.length
}
