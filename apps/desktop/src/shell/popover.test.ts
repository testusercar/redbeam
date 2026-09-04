import { describe, expect, it } from 'vitest'
import { shiftIntoBounds, type Box } from './popover.js'

const bounds: Box = { left: 100, top: 50, right: 900, bottom: 650 }
const box = (left: number, top: number, w = 260, h = 300): Box =>
  ({ left, top, right: left + w, bottom: top + h })

describe('shiftIntoBounds', () => {
  it('leaves a menu that already fits where it is', () => {
    expect(shiftIntoBounds(box(300, 100), bounds, 8)).toEqual({ dx: 0, dy: 0 })
  })

  /** The scale menu at a wrapped dock: anchored right, spilling left. */
  it('slides a menu that spills past the left edge back in', () => {
    const { dx, dy } = shiftIntoBounds(box(-60, 100), bounds, 8)
    expect(dx).toBe(168)
    expect(dy).toBe(0)
  })

  /** The tool overflow at the right end of the pill: anchored left, spilling right. */
  it('slides a menu that spills past the right edge back in', () => {
    const { dx } = shiftIntoBounds(box(800, 100), bounds, 8)
    expect(800 + 260 + dx).toBe(900 - 8)
  })

  /** A context menu opened near the bottom of the window. */
  it('slides a menu up rather than letting its last rows fall off the bottom', () => {
    const { dy } = shiftIntoBounds(box(300, 500), bounds, 8)
    expect(500 + 300 + dy).toBe(650 - 8)
  })

  it('keeps the margin the caller asked for', () => {
    const { dx } = shiftIntoBounds(box(-60, 100), bounds, 16)
    expect(-60 + dx).toBe(100 + 16)
  })

  /**
   * A menu taller than the space cannot be made to fit; the top edge wins so
   * the first rows are readable and the rest scroll.
   */
  it('prefers the leading edge when the menu is bigger than the space', () => {
    const { dy } = shiftIntoBounds(box(300, 40, 260, 900), bounds, 8)
    expect(40 + dy).toBe(50 + 8)
  })
})
