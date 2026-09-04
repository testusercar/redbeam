/**
 * Put focus back where it was when the overlay opened.
 *
 * Closing the command palette, the find drawer, the settings view or a dialog
 * left `document.activeElement` on `<body>` — the overlay's own focused
 * control had just been unmounted, and nothing claimed what it left behind. On
 * a mouse that is invisible. On a keyboard it means every Escape costs you
 * your place: the next Tab starts at the top of the document, however far into
 * the sheet list or the specification you were.
 *
 * The rule is the one every platform uses: whatever had focus when the overlay
 * opened gets it back when the overlay closes.
 */
import { useEffect, useRef } from 'react'

/**
 * Whether an element is somewhere focus can be RETURNED to.
 *
 * `body` is not a place anyone was — it is what is left when nothing has
 * focus, and returning to it is the bug rather than the fix.
 *
 * Pure, and exported, because this repo's tests run on node with no DOM: the
 * rule can be argued with even though the hook around it cannot be rendered.
 */
export function isReturnable(el: unknown): boolean {
  if (el === null || typeof el !== 'object') return false
  const node = el as { tagName?: string, isConnected?: boolean, focus?: unknown }
  if (typeof node.focus !== 'function') return false
  // It may be gone by the time we come back: the row that opened a dialog can
  // be the row the dialog deleted. Focusing a detached element silently moves
  // focus to body, which is exactly what this exists to avoid.
  if (node.isConnected === false) return false
  return node.tagName !== 'BODY'
}

/**
 * @param open whether the overlay is currently showing.
 *
 * Restores on close AND on unmount, because an overlay is as often torn down
 * (a project closes, a boundary catches) as it is closed politely.
 */
export function useReturnFocus(open: boolean): void {
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    const active = document.activeElement
    opener.current = isReturnable(active) ? (active as HTMLElement) : null

    return () => {
      const el = opener.current
      opener.current = null
      if (el !== null && isReturnable(el)) el.focus()
    }
  }, [open])
}
