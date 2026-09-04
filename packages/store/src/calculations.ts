/**
 * Calculation runs, their quantities, and the components a freeze locks
 * (plan 06.10).
 *
 * `calculation_runs`, `quantity_results` and `layout_components` have been in
 * the schema since migration 3 and nothing has ever written to them. That is
 * the gap this closes, and it is not bookkeeping:
 *
 * # Why a takeoff has to be freezable
 *
 * Every quantity the app shows is DERIVED — move a markup, retype a spacing,
 * recalibrate a page, and the count changes underneath you. That is right while
 * an estimate is being built and wrong the moment one is sent. A bid that went
 * out on Tuesday has to still read what it read on Tuesday, whatever anybody
 * has done to the drawing since; otherwise the quantity that was priced and the
 * quantity the app reports are two different numbers and neither is labelled.
 *
 * A frozen run is that record: the specifications, the calibration and the
 * geometry as they were, the quantities they produced, and every physical piece
 * with the position it was laid at. Freezing does not stop anyone editing —
 * it stops the SENT number moving.
 *
 * Ported from okular-redbeam `redbeam/redbeamprojectsession.cpp`:
 *   RedbeamCommandType::RecordCalculation -> recordCalculation
 *   RedbeamCommandType::FreezeLayout      -> freezeLayout
 */
import type { SqlDriver } from './index.js'

/** A point pair, as `layout_components.geometry_json` stores it. */
export interface ComponentGeometry {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

export interface LayoutComponentInput {
  documentId: string | null
  pageId: string | null
  componentKind: string
  /** Installed geometry. Free-form so a panel can store a ring and a run a line. */
  geometry: Record<string, unknown>
  /** Everything else about the component: stock geometry, fraction, family. */
  properties?: Record<string, unknown>
}

export interface QuantityResultInput {
  itemKey: string
  label: string
  quantity: number
  unit: string
  details?: Record<string, unknown>
}

export interface CalculationInput {
  scopeId: string
  /** Which engine produced it. A frozen number is only meaningful with one. */
  engineVersion: string
  specificationsSnapshot: Record<string, unknown>
  calibrationSnapshot: Record<string, unknown>
  sourceSnapshot: Record<string, unknown>
  geometrySnapshot: Record<string, unknown>
  warnings?: string[]
  resultSummary?: Record<string, unknown>
  quantities: readonly QuantityResultInput[]
  components: readonly LayoutComponentInput[]
}

export interface CalculationRun {
  id: string
  scopeId: string
  state: string
  engineVersion: string
  warnings: string[]
  resultSummary: Record<string, unknown>
  specificationsSnapshot: Record<string, unknown>
  calibrationSnapshot: Record<string, unknown>
  createdAt: string
  /** Set when the run was frozen. Null means it is still a live calculation. */
  acceptedAt: string | null
  /** True when every component of this run is locked. */
  frozen: boolean
}

export interface LayoutComponent extends LayoutComponentInput {
  id: string
  calculationRunId: string
  frozen: boolean
}

/**
 * One calculation write at a time.
 *
 * `recordCalculation` and `freezeLayout` each wrap themselves in BEGIN/COMMIT,
 * and the app holds ONE connection. Two in flight at once means the second
 * BEGIN lands inside the first transaction and throws — and its rollback takes
 * the first one down with it. Committing five scopes in quick succession lost
 * one of them, silently, with the caller told it had succeeded.
 *
 * A promise chain rather than a flag: callers queue instead of failing, which
 * is what "commit these five scopes" means. It serialises the calculation
 * writes against each other only — a markup edit landing mid-commit is still
 * a separate connection-level race, and the honest fix for that is a
 * store-wide lock this module has no business declaring on its own.
 */
let writes: Promise<unknown> = Promise.resolve()

function serialised<T>(work: () => Promise<T>): Promise<T> {
  // Chain off the settled result, so one failed write does not poison the
  // queue behind it.
  const next = writes.then(work, work)
  writes = next.then(() => undefined, () => undefined)
  return next
}

const json = (v: unknown): string => JSON.stringify(v ?? {})

const parse = <T>(text: string | null, fallback: T): T => {
  if (text === null || text === '') return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    // A malformed snapshot is a corrupt row, not a crash: the run still has an
    // id, a scope and a timestamp, which is enough to show that it exists.
    return fallback
  }
}

/**
 * Record one calculation, its quantities and its components.
 *
 * Written as a single transaction. A run whose quantities landed but whose
 * components did not would be a frozen bid with no evidence behind it, which is
 * worse than no record — so either all of it is there or none of it is.
 *
 * Returns the new run's id.
 */
export async function recordCalculation(
  db: SqlDriver,
  input: CalculationInput,
  now = new Date().toISOString(),
  id = crypto.randomUUID(),
): Promise<string> {
  return serialised(() => recordUnserialised(db, input, now, id))
}

async function recordUnserialised(
  db: SqlDriver,
  input: CalculationInput,
  now: string,
  id: string,
): Promise<string> {
  await db.run('BEGIN')
  try {
    await db.run(
      `INSERT INTO calculation_runs
         (id, scope_id, state, engine_version, specifications_snapshot_json,
          calibration_snapshot_json, source_snapshot_json, geometry_snapshot_json,
          warnings_json, formulas_json, result_summary_json, accepted_at,
          created_at, updated_at)
       VALUES (?, ?, 'recorded', ?, ?, ?, ?, ?, ?, '{}', ?, NULL, ?, ?)`,
      [
        id, input.scopeId, input.engineVersion,
        json(input.specificationsSnapshot), json(input.calibrationSnapshot),
        json(input.sourceSnapshot), json(input.geometrySnapshot),
        json(input.warnings ?? []), json(input.resultSummary ?? {}),
        now, now,
      ],
    )

    for (const q of input.quantities) {
      await db.run(
        `INSERT INTO quantity_results
           (id, calculation_run_id, item_key, label, quantity, unit, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), id, q.itemKey, q.label, q.quantity, q.unit, json(q.details ?? {})],
      )
    }

    for (const c of input.components) {
      await db.run(
        `INSERT INTO layout_components
           (id, calculation_run_id, document_id, page_id, component_kind,
            geometry_json, properties_json, frozen)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          crypto.randomUUID(), id, c.documentId, c.pageId, c.componentKind,
          json(c.geometry), json(c.properties ?? {}),
        ],
      )
    }
    await db.run('COMMIT')
  } catch (err) {
    await db.run('ROLLBACK')
    throw err
  }
  return id
}

/**
 * Freeze a run: lock every component and stamp when it was accepted.
 *
 * The Qt build only sets `frozen` on the components. `accepted_at` is stamped
 * here as well, because "when was this frozen" is the first thing anyone asks
 * of a frozen bid and the component rows cannot answer it.
 */
export async function freezeLayout(
  db: SqlDriver,
  calculationRunId: string,
  now = new Date().toISOString(),
): Promise<void> {
  return serialised(() => freezeUnserialised(db, calculationRunId, now))
}

async function freezeUnserialised(
  db: SqlDriver,
  calculationRunId: string,
  now: string,
): Promise<void> {
  await db.run('BEGIN')
  try {
    await db.run(
      'UPDATE layout_components SET frozen = 1 WHERE calculation_run_id = ?',
      [calculationRunId],
    )
    await db.run(
      `UPDATE calculation_runs
          SET state = 'frozen', accepted_at = COALESCE(accepted_at, ?), updated_at = ?
        WHERE id = ?`,
      [now, now, calculationRunId],
    )
    await db.run('COMMIT')
  } catch (err) {
    await db.run('ROLLBACK')
    throw err
  }
}

interface RunRow {
  id: string
  scope_id: string
  state: string
  engine_version: string
  warnings_json: string | null
  result_summary_json: string | null
  specifications_snapshot_json: string | null
  calibration_snapshot_json: string | null
  created_at: string
  accepted_at: string | null
  frozen_count: number
  component_count: number
}

const toRun = (r: RunRow): CalculationRun => ({
  id: r.id,
  scopeId: r.scope_id,
  state: r.state,
  engineVersion: r.engine_version,
  warnings: parse<string[]>(r.warnings_json, []),
  resultSummary: parse<Record<string, unknown>>(r.result_summary_json, {}),
  specificationsSnapshot: parse<Record<string, unknown>>(r.specifications_snapshot_json, {}),
  calibrationSnapshot: parse<Record<string, unknown>>(r.calibration_snapshot_json, {}),
  createdAt: r.created_at,
  acceptedAt: r.accepted_at,
  // A run with no components at all is not frozen — `0 of 0` would otherwise
  // read as locked, and an empty calculation is exactly the one you must not
  // be able to send.
  frozen: r.component_count > 0 && r.frozen_count === r.component_count,
})

const RUN_SELECT = `
  SELECT c.id, c.scope_id, c.state, c.engine_version, c.warnings_json,
         c.result_summary_json, c.specifications_snapshot_json,
         c.calibration_snapshot_json, c.created_at, c.accepted_at,
         (SELECT COUNT(*) FROM layout_components lc
           WHERE lc.calculation_run_id = c.id) AS component_count,
         (SELECT COUNT(*) FROM layout_components lc
           WHERE lc.calculation_run_id = c.id AND lc.frozen = 1) AS frozen_count
    FROM calculation_runs c`

/** Every run for a scope, newest first. */
export async function listCalculations(db: SqlDriver, scopeId: string): Promise<CalculationRun[]> {
  const rows = await db.all<RunRow>(
    `${RUN_SELECT} WHERE c.scope_id = ? ORDER BY c.created_at DESC, c.id DESC`,
    [scopeId],
  )
  return rows.map(toRun)
}

/** The most recent run for a scope, or null when it has never been calculated. */
export async function latestCalculation(
  db: SqlDriver,
  scopeId: string,
): Promise<CalculationRun | null> {
  const rows = await db.all<RunRow>(
    `${RUN_SELECT} WHERE c.scope_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT 1`,
    [scopeId],
  )
  const row = rows[0]
  return row === undefined ? null : toRun(row)
}

/**
 * The newest FROZEN run for a scope.
 *
 * This is the one a bid was sent on. It is looked up separately from the latest
 * run on purpose: recalculating after a freeze must not quietly replace the
 * frozen answer, so the two live side by side and the caller decides which it
 * is showing.
 */
export async function latestFrozenCalculation(
  db: SqlDriver,
  scopeId: string,
): Promise<CalculationRun | null> {
  const rows = await db.all<RunRow>(
    `${RUN_SELECT}
      WHERE c.scope_id = ?
        AND c.accepted_at IS NOT NULL
      ORDER BY c.accepted_at DESC, c.id DESC
      LIMIT 1`,
    [scopeId],
  )
  const row = rows[0]
  return row === undefined ? null : toRun(row)
}

/** The quantities a run recorded, in insertion order. */
export async function listCalculationQuantities(
  db: SqlDriver,
  calculationRunId: string,
): Promise<QuantityResultInput[]> {
  const rows = await db.all<{
    item_key: string; label: string; quantity: number; unit: string; details_json: string | null
  }>(
    `SELECT item_key, label, quantity, unit, details_json
       FROM quantity_results WHERE calculation_run_id = ? ORDER BY rowid`,
    [calculationRunId],
  )
  return rows.map((r) => ({
    itemKey: r.item_key,
    label: r.label,
    quantity: r.quantity,
    unit: r.unit,
    details: parse<Record<string, unknown>>(r.details_json, {}),
  }))
}

/** The components a run recorded, in insertion order. */
export async function listLayoutComponents(
  db: SqlDriver,
  calculationRunId: string,
): Promise<LayoutComponent[]> {
  const rows = await db.all<{
    id: string; calculation_run_id: string; document_id: string | null; page_id: string | null
    component_kind: string; geometry_json: string | null; properties_json: string | null
    frozen: number
  }>(
    `SELECT id, calculation_run_id, document_id, page_id, component_kind,
            geometry_json, properties_json, frozen
       FROM layout_components WHERE calculation_run_id = ? ORDER BY rowid`,
    [calculationRunId],
  )
  return rows.map((r) => ({
    id: r.id,
    calculationRunId: r.calculation_run_id,
    documentId: r.document_id,
    pageId: r.page_id,
    componentKind: r.component_kind,
    geometry: parse<Record<string, unknown>>(r.geometry_json, {}),
    properties: parse<Record<string, unknown>>(r.properties_json, {}),
    frozen: r.frozen === 1,
  }))
}
