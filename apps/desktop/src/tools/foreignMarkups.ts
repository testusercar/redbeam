/**
 * PDF markups that are not REDBEAM's — Bluebeam, Acrobat, anything the sheet
 * already carried.
 *
 * They are drawn by PDFium as part of the page. The file is never written:
 * hiding is a view of this session, remembered only in sessionStorage, and
 * the next open of the drawing shows them again. Kenneth, 2026-09-23: the
 * markups cannot be deleted, and deleting them would mean writing the PDF.
 */

export const HIDDEN_ANNOT_FLAG = 2

export function hiddenStorageKey(docId: string): string {
  return `redbeam.hidden-annots:${docId}`
}

/** Annotation indexes are per page, so the hidden set is too. */
export type HiddenBook = Record<string, number[]>

export function parseHiddenBook(raw: string | null): HiddenBook {
  if (raw === null || raw === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    // A flat list was the first shape. Keep it as page 0 rather than drop it.
    if (Array.isArray(parsed)) return { '0': parseHidden(raw) }
    if (parsed === null || typeof parsed !== 'object') return {}
    const out: HiddenBook = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^\d+$/.test(key) || !Array.isArray(value)) continue
      out[key] = value.filter((n): n is number => Number.isInteger(n) && n >= 0)
    }
    return out
  } catch {
    return {}
  }
}

export function hiddenOnPage(book: HiddenBook, page: number): number[] {
  return book[String(page)] ?? []
}

/** Stable cache token. Empty when nothing is hidden, so tile keys stay as they were. */
export function visibilityToken(indices: readonly number[]): string {
  const unique = new Set<number>()
  for (const n of indices) {
    if (Number.isInteger(n) && n >= 0) unique.add(n)
  }
  return [...unique].sort((a, b) => a - b).join(',')
}

export function parseHidden(raw: string | null): number[] {
  if (raw === null || raw === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((n): n is number => Number.isInteger(n) && n >= 0)
  } catch {
    return []
  }
}

export function hideAnnotation(current: readonly number[], index: number): number[] {
  return visibilityToken([...current, index]).split(',').filter((s) => s !== '').map(Number)
}

export function hideAll(indices: readonly number[]): number[] {
  return visibilityToken(indices).split(',').filter((s) => s !== '').map(Number)
}

export function showHidden(): number[] {
  return []
}

export function visibleAnnotations<T extends { index: number }>(
  list: readonly T[],
  hidden: ReadonlySet<number>,
): T[] {
  if (hidden.size === 0) return [...list]
  return list.filter((a) => !hidden.has(a.index))
}
