/**
 * What the palette ran last.
 *
 * A palette is reopened for the thing you ran a minute ago far more often
 * than for something new, so the untyped list leads with the last few. Kept
 * as command ids in the webview's own storage: ids are stable across
 * sessions, and a row whose command no longer exists is simply not listed.
 */
export const RECENT_KEY = 'redbeam.palette.recent'
export const RECENT_LIMIT = 3

export function readRecent(storage: Storage | null = safeStorage()): string[] {
  try {
    const raw = storage?.getItem(RECENT_KEY)
    if (raw === null || raw === undefined) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

/** Newest first, no duplicates, capped. Returns the new list. */
export function pushRecent(id: string, storage: Storage | null = safeStorage()): string[] {
  const next = [id, ...readRecent(storage).filter((x) => x !== id)].slice(0, RECENT_LIMIT)
  try { storage?.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* a private window, or storage blocked */ }
  return next
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
