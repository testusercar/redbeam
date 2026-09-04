/**
 * Keeping a popover on screen.
 *
 * Every floating menu in the shell is anchored to the control that opened it
 * — `left: 0` or `right: 0` of a pill button, or the pointer for a context
 * menu — and anchoring is the right default: a menu that opens away from its
 * button is one nobody finds. It is also the wrong last word. At a 1280px
 * window with both panes open the dock wraps, the document pill lands at the
 * LEFT of the viewport, and its scale menu (anchored `right: 0`) opened with
 * two-thirds of itself past the viewport's left edge, where `overflow: hidden`
 * cut it off. The tool overflow had the mirror problem on the right. Neither
 * produced an error; both looked like a menu with half its rows missing.
 *
 * The anchor decides where a menu WANTS to be; this decides where it CAN be.
 * A menu is measured after it mounts and slid the smallest distance that puts
 * it inside its clipping container — the viewport for a dock menu, the window
 * for a fixed one. Sliding rather than flipping, because a flipped menu moves
 * its first row out from under the pointer, and a slide keeps the anchor edge
 * as close as the space allows.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'

export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * The smallest shift that brings `box` inside `bounds`, keeping `margin` clear
 * of every edge.
 *
 * When the box is larger than the space, the leading edge wins: the top-left
 * is where reading starts, and a menu whose last rows are off screen still
 * scrolls, while one whose first rows are off screen does not.
 */
export function shiftIntoBounds(box: Box, bounds: Box, margin = 0): { dx: number; dy: number } {
  let dx = 0
  let dy = 0
  if (box.right > bounds.right - margin) dx = bounds.right - margin - box.right
  if (box.left + dx < bounds.left + margin) dx = bounds.left + margin - box.left
  if (box.bottom > bounds.bottom - margin) dy = bounds.bottom - margin - box.bottom
  if (box.top + dy < bounds.top + margin) dy = bounds.top + margin - box.top
  return { dx, dy }
}

/** The margin a slid menu keeps from the edge that stopped it. */
const EDGE = 8

/**
 * A ref for the menu element and the inline transform that keeps it visible.
 *
 * Measured in a layout effect so the correction lands before paint — a menu
 * that appears clipped and then jumps is worse than one that appears in
 * place. `deps` re-measures when the menu's content changes size while open
 * (the scale menu's "All 26 scales" disclosure is the case in hand).
 */
export function useClampedPopover<T extends HTMLElement>(
  open: boolean,
  deps: ReadonlyArray<unknown> = [],
): { ref: MutableRefObject<T | null>; style: CSSProperties } {
  const ref = useRef<T | null>(null)
  const [shift, setShift] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 })

  useLayoutEffect(() => {
    if (!open) { setShift({ dx: 0, dy: 0 }); return }
    const el = ref.current
    if (el === null) return
    // The viewport cell clips its own children; a menu outside it (fixed to
    // the pointer, hanging from the title bar) answers to the window.
    const container = el.closest('.viewport')
    const measure = () => {
      // Measured with any previous shift removed, or a second measurement
      // would compound the first.
      el.style.transform = ''
      const box = el.getBoundingClientRect()
      const bounds: Box = container === null
        ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
        : container.getBoundingClientRect()
      setShift(shiftIntoBounds(box, bounds, EDGE))
    }
    measure()
    /*
     * ...and again whenever the space changes. A menu used to be measured
     * once, on opening, which was enough while every menu closed at the next
     * click. The dock's scale control now stays open for as long as a
     * calibration or a region is waiting for its answer, through pane
     * toggles and window resizes — and a shift computed for the old width
     * pushed the form clean off the drawing at the new one.
     */
    window.addEventListener('resize', measure)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(container ?? document.documentElement)
    return () => {
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps])

  const style: CSSProperties = shift.dx === 0 && shift.dy === 0
    ? {}
    : { transform: `translate(${shift.dx}px, ${shift.dy}px)` }
  return { ref, style }
}
