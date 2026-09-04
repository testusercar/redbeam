/**
 * Keep Tab inside an open dialog.
 *
 * Every dialog here says `aria-modal="true"` and none of them meant it: Tab
 * walked straight out from behind the scrim into the sheet index, and Shift+Tab
 * from the first field landed on the title bar. On a mouse that is invisible.
 * On a keyboard it means a dialog can be left without being closed, with its
 * scrim still up and Escape now going to whatever has focus underneath.
 *
 * The rule is the platform's: Tab from the last control wraps to the first,
 * Shift+Tab from the first wraps to the last, and nothing outside the dialog
 * is reachable until it closes. The cycling is a pure function so
 * `focusTrap.test.ts` can pin it; the hook only finds the controls.
 */
import { useEffect, useRef, type MutableRefObject } from 'react'

/**
 * The index to move to. `index` is where focus is now, or -1 when it is not
 * on one of the dialog's controls (the scrim, or nowhere) — from there Tab
 * goes to the first and Shift+Tab to the last.
 */
export function cycle(count: number, index: number, backwards: boolean): number {
  if (count <= 0) return -1
  if (index < 0 || index >= count) return backwards ? count - 1 : 0
  return backwards ? (index - 1 + count) % count : (index + 1) % count
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Controls a person can Tab to, in document order, skipping anything hidden. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((el) => el.offsetParent !== null || el === document.activeElement)
}

export function useFocusTrap<T extends HTMLElement>(active: boolean): MutableRefObject<T | null> {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const root = ref.current
      if (root === null) return
      const items = focusableWithin(root)
      if (items.length === 0) return
      const at = items.indexOf(document.activeElement as HTMLElement)
      const next = items[cycle(items.length, at, e.shiftKey)]
      if (next === undefined) return
      e.preventDefault()
      next.focus()
    }
    // Capture, so a dialog's own key handlers (Escape, Enter) still run and
    // only Tab is decided here before anything underneath can see it.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])
  return ref
}
