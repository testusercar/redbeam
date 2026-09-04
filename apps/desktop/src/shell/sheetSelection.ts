/**
 * Selecting sheets in the index.
 *
 * The gesture this exists for: pick the whole 400-series, right-click, set one
 * scale. Setting it forty times is data entry, and the drawing already states
 * the scale in every one of those title blocks.
 *
 * Selection lives here rather than in the component because the interesting
 * part is not the rendering — it is that shift-click has to mean "the sheets
 * BETWEEN these two as they are currently shown", and what is currently shown
 * depends on the search box and on which groups are collapsed. Selecting a
 * range that includes sheets the person cannot see, and then applying a scale
 * to them, is the kind of thing nobody would notice until a quantity was wrong.
 */

export interface SheetSelection {
  /** Page indices, 0-based. */
  pages: ReadonlySet<number>
  /** Where a shift-range measures from. */
  anchor: number | null
}

export const EMPTY_SELECTION: SheetSelection = { pages: new Set(), anchor: null }

export interface ClickModifiers {
  /** Ctrl on Windows, Cmd on a Mac. Toggles one sheet. */
  toggle: boolean
  /** Shift. Extends from the anchor. */
  range: boolean
}

/**
 * The selection after a click.
 *
 * `visible` is the pages in the order they are on screen, which is what a
 * range means. A plain click collapses the selection to one sheet and moves the
 * anchor, which is what every list in every application does.
 */
export function clickSheet(
  current: SheetSelection,
  page: number,
  mods: ClickModifiers,
  visible: readonly number[],
): SheetSelection {
  if (mods.range && current.anchor !== null) {
    const from = visible.indexOf(current.anchor)
    const to = visible.indexOf(page)
    // An anchor that has been filtered away cannot define a range. Falling back
    // to a plain click is better than selecting from the top of the list, which
    // would quietly include sheets nobody pointed at.
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from <= to ? [from, to] : [to, from]
      return { pages: new Set(visible.slice(lo, hi + 1)), anchor: current.anchor }
    }
    return { pages: new Set([page]), anchor: page }
  }

  if (mods.toggle) {
    const next = new Set(current.pages)
    if (next.has(page)) next.delete(page)
    else next.add(page)
    // The anchor follows the last sheet touched, so shift-click after a
    // ctrl-click extends from where the hand was.
    return { pages: next, anchor: page }
  }

  return { pages: new Set([page]), anchor: page }
}

/**
 * The selection a right-click should act on.
 *
 * Right-clicking INSIDE a selection acts on the whole selection; right-clicking
 * outside it selects the sheet under the pointer first. Anything else lets
 * somebody aim at one sheet and hit forty — which, for an action that changes
 * what every quantity on those sheets means, is not a recoverable mistake.
 */
export function rightClickSheet(current: SheetSelection, page: number): SheetSelection {
  return current.pages.has(page) ? current : { pages: new Set([page]), anchor: page }
}

/** Selected pages in sheet order, which is the order a person expects to read. */
export function selectedInOrder(selection: SheetSelection): number[] {
  return [...selection.pages].sort((a, b) => a - b)
}

/**
 * "12 sheets", or the sheet number when there is one.
 *
 * The count is the whole confirmation an estimator gets before a scale lands on
 * forty drawings, so it says the number rather than "selection".
 */
export function describeSelection(selection: SheetSelection, labelFor: (page: number) => string): string {
  const pages = selectedInOrder(selection)
  if (pages.length === 0) return 'no sheets'
  if (pages.length === 1) return labelFor(pages[0]!)
  return `${pages.length} sheets`
}
