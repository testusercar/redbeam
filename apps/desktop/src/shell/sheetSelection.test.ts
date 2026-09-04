import { describe, expect, it } from 'vitest'
import {
  clickSheet, describeSelection, EMPTY_SELECTION, rightClickSheet, selectedInOrder,
  type SheetSelection,
} from './sheetSelection.js'

const plain = { toggle: false, range: false }
const toggle = { toggle: true, range: false }
const range = { toggle: false, range: true }

/** A 400-series: sheets 10..19 on screen, in order. */
const VISIBLE = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]

const sel = (pages: number[], anchor: number | null = null): SheetSelection =>
  ({ pages: new Set(pages), anchor })

describe('clickSheet', () => {
  it('selects one sheet and anchors there', () => {
    const s = clickSheet(EMPTY_SELECTION, 12, plain, VISIBLE)
    expect(selectedInOrder(s)).toEqual([12])
    expect(s.anchor).toBe(12)
  })

  it('collapses a selection back to one sheet', () => {
    // What every list does. Without it a plain click would silently add to a
    // selection somebody has forgotten is there.
    const s = clickSheet(sel([10, 11, 12], 10), 15, plain, VISIBLE)
    expect(selectedInOrder(s)).toEqual([15])
  })

  it('extends a range from the anchor', () => {
    // The gesture: click A-401, shift-click A-410, set the scale once.
    const s = clickSheet(sel([12], 12), 16, range, VISIBLE)
    expect(selectedInOrder(s)).toEqual([12, 13, 14, 15, 16])
  })

  it('extends a range backwards', () => {
    const s = clickSheet(sel([16], 16), 12, range, VISIBLE)
    expect(selectedInOrder(s)).toEqual([12, 13, 14, 15, 16])
  })

  it('keeps the anchor so a range can be re-dragged', () => {
    // Shift-clicking again must re-measure from the SAME anchor, not from the
    // end of the last range, or the selection walks down the list.
    const first = clickSheet(sel([12], 12), 16, range, VISIBLE)
    const second = clickSheet(first, 14, range, VISIBLE)
    expect(selectedInOrder(second)).toEqual([12, 13, 14])
  })

  it('takes the range from what is ON SCREEN, not from page numbers', () => {
    // The list is filtered and grouped, so a range means the sheets BETWEEN
    // these two AS SHOWN. Selecting sheets nobody can see and then setting
    // their scale is the failure this prevents.
    const filtered = [10, 14, 18]
    const s = clickSheet(sel([10], 10), 18, range, filtered)
    expect(selectedInOrder(s)).toEqual([10, 14, 18])
  })

  it('falls back to a single sheet when the anchor has been filtered away', () => {
    // Better than ranging from the top of the list, which would include
    // sheets nobody pointed at.
    const s = clickSheet(sel([99], 99), 14, range, VISIBLE)
    expect(selectedInOrder(s)).toEqual([14])
    expect(s.anchor).toBe(14)
  })

  it('adds one sheet without losing the rest', () => {
    const s = clickSheet(sel([10, 11], 11), 15, toggle, VISIBLE)
    expect(selectedInOrder(s)).toEqual([10, 11, 15])
  })

  it('removes a sheet that was already selected', () => {
    const s = clickSheet(sel([10, 11, 12], 10), 11, toggle, VISIBLE)
    expect(selectedInOrder(s)).toEqual([10, 12])
  })

  it('moves the anchor to the sheet just toggled', () => {
    // So shift-click after a ctrl-click extends from where the hand was.
    const after = clickSheet(sel([10], 10), 15, toggle, VISIBLE)
    const ranged = clickSheet(after, 17, range, VISIBLE)
    expect(selectedInOrder(ranged)).toEqual([15, 16, 17])
  })

  it('has no range without an anchor', () => {
    const s = clickSheet(EMPTY_SELECTION, 14, range, VISIBLE)
    expect(selectedInOrder(s)).toEqual([14])
  })
})

describe('rightClickSheet', () => {
  it('keeps a selection when the click lands inside it', () => {
    const s = rightClickSheet(sel([10, 11, 12], 10), 11)
    expect(selectedInOrder(s)).toEqual([10, 11, 12])
  })

  it('selects the sheet under the pointer when the click lands outside', () => {
    // Otherwise somebody aims at one sheet and hits forty — and for an action
    // that changes what every quantity on those sheets means, that is not a
    // recoverable mistake.
    const s = rightClickSheet(sel([10, 11, 12], 10), 30)
    expect(selectedInOrder(s)).toEqual([30])
  })

  it('selects under the pointer when nothing is selected', () => {
    expect(selectedInOrder(rightClickSheet(EMPTY_SELECTION, 7))).toEqual([7])
  })
})

describe('describeSelection', () => {
  const label = (p: number) => `A-4${String(p).padStart(2, '0')}`

  it('names the sheet when there is one', () => {
    expect(describeSelection(sel([1]), label)).toBe('A-401')
  })

  it('counts them when there are several', () => {
    // The count is the whole confirmation before a scale lands on forty
    // drawings, so it has to be a number.
    expect(describeSelection(sel([1, 2, 3]), label)).toBe('3 sheets')
  })

  it('says so when there are none', () => {
    expect(describeSelection(EMPTY_SELECTION, label)).toBe('no sheets')
  })
})
