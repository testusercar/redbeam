/**
 * The bill of materials, shaped for a 320px column.
 *
 * `buildBom` answers in LINES — one flat table, scope repeated on every row —
 * which is the right shape for a spreadsheet and the wrong one beside a
 * drawing: at the sidebar's width a six-column table is a horizontal scroll,
 * and the scope name on every line is most of what fills it. So the lines are
 * regrouped under their scope, the way the panel already groups a scope's
 * markups under their sheet, and the scope is said once.
 *
 * Kept free of React so the grouping and the estimate filter can be checked
 * without a DOM.
 */
import type { ScopePieces } from '@redbeam/domain'

export function entriesForRound(
  entries: readonly ScopePieces[],
  scopeIds: ReadonlySet<string> | null,
): ScopePieces[] {
  if (scopeIds === null) return [...entries]
  return entries.filter((e) => scopeIds.has(e.scope.id))
}

/** Lines under their scope, in the order the entries came. */
export function reportFileName(projectName: string, estimateName: string): string {
  return `${projectName} — ${estimateName} takeoff.html`.replace(/[\\/:*?"<>|]/g, '-')
}
