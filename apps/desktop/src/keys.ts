/**
 * Who a keystroke belongs to.
 *
 * The workspace listens for shortcuts on `window`, which is the only way to
 * catch them wherever focus happens to be — and, without this, also catches
 * them while somebody is typing. Every bare-letter tool shortcut fired into
 * the sheet filter, so typing "area" switched the tool three times and landed
 * on Cutout; Ctrl+A selected every markup in the document instead of the text
 * being replaced; Backspace deleted a point from a trace rather than a
 * character from the field; Enter committed the trace.
 *
 * Its own module so the rule can be argued with in a test rather than through
 * a rendered workspace.
 */

/** True when the event's target is somewhere a person is entering text. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (target === null || !(typeof target === 'object') || !('tagName' in target)) return false
  const el = target as HTMLElement
  if (el.isContentEditable) return true
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

/**
 * The shortcuts that still belong to the application while somebody is typing.
 *
 * Only the ones that OPEN something: a person reaching for settings or find
 * from a stale filter field means to go there. Everything that edits, deletes,
 * selects or draws belongs to the field under the cursor.
 */
export function survivesTextEntry(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>): boolean {
  if (e.key === 'Escape') return true
  const mod = e.ctrlKey || e.metaKey
  return mod && (e.key === ',' || e.key === 'f' || e.key === 'F')
}
