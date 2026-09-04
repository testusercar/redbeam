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
import { buildBom, type Bom, type BomLine, type ScopePieces } from '@redbeam/domain'

export interface BomGroup {
  scopeId: string
  scopeLabel: string
  productLabel: string
  /** The scope's own colour, for the identifier dot. */
  color: string
  lines: BomLine[]
}

/**
 * Only the scopes in the open round.
 *
 * The piece calculation runs over every scope in the project, because a scope
 * outside the open round still needs its number when you switch to it. The
 * bill is a different question — what THIS bid orders — and a line from
 * another round's scope on it would be quoted. `null` means no round is open
 * and the whole project is the answer.
 */
export function entriesForRound(
  entries: readonly ScopePieces[],
  scopeIds: ReadonlySet<string> | null,
): ScopePieces[] {
  if (scopeIds === null) return [...entries]
  return entries.filter((e) => scopeIds.has(e.scope.id))
}

/** Lines under their scope, in the order the entries came. */
export function groupBom(bom: Bom, entries: readonly ScopePieces[]): BomGroup[] {
  const out: BomGroup[] = []
  for (const e of entries) {
    const lines = bom.lines.filter((l) => l.scopeId === e.scope.id)
    if (lines.length === 0) continue
    out.push({
      scopeId: e.scope.id,
      scopeLabel: e.scope.label,
      productLabel: lines[0]?.productLabel ?? '',
      color: e.scope.color,
      lines,
    })
  }
  return out
}

/** What the round's row in the overview says about its bill, in one line. */
export function bomSummary(entries: readonly ScopePieces[]): {
  lines: number
  attention: number
} {
  const bom = buildBom(entries)
  return {
    lines: bom.lines.length,
    attention: bom.counts.unverified + bom.counts.blocked,
  }
}

/**
 * A file name Windows will accept.
 *
 * Project and estimate names come from people and carry slashes, colons and
 * question marks — "260729 - Negotiations: alt 2?" is a real round name —
 * and a download whose name the OS refuses silently produces nothing.
 */
export function reportFileName(projectName: string, estimateName: string): string {
  return `${projectName} — ${estimateName} takeoff.html`.replace(/[\\/:*?"<>|]/g, '-')
}
