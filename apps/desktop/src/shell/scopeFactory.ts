/**
 * A new scope, from a name.
 *
 * "Add scope" used to open a dialog that made a scope called "Scope 4" and
 * then asked you to rename it, choose a colour, and pick a product, one row
 * per question, over the drawing. The one thing a person actually has in
 * their head at that moment is the tag off the drawings — C-MT-01, WP-12 —
 * so the name is the one question asked, and everything else is a default
 * the scope's own detail page edits in place.
 */
import type { Scope } from '@redbeam/domain'

/**
 * Ten hues, cycled. Distinct on the warm paper the sheet renders on, and in
 * the order the Qt build assigned them, so a project's fourth scope is the
 * same green it always was.
 */
export const SCOPE_PALETTE: readonly string[] = [
  '#e2483d', '#2f7fd1', '#f4b740', '#4caf7d', '#9b6bd6',
  '#e07a3f', '#2d9cdb', '#c2549b', '#6b8e9e', '#8bc34a',
]

/**
 * The next colour nobody in the list is using, or the palette wrapped.
 *
 * Counting the list was the old rule, and archiving a scope then adding one
 * gave the newcomer the colour of a scope that could come back.
 */
export function nextScopeColor(existing: ReadonlyArray<{ color: string }>): string {
  const taken = new Set(existing.map((s) => s.color.toLowerCase()))
  const free = SCOPE_PALETTE.find((c) => !taken.has(c))
  return free ?? SCOPE_PALETTE[existing.length % SCOPE_PALETTE.length]!
}

export function newScope(label: string, existing: ReadonlyArray<{ color: string }>): Scope {
  return {
    id: `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: label.trim(),
    scopeType: 'area',
    color: nextScopeColor(existing),
    // Panels: the one product whose counts are proven against the Qt build,
    // and what most of the trade's ceiling scopes are.
    specifications: { productType: 'panels' },
  }
}
