/**
 * What the sheet draws of the PDF's own annotations. A VIEW, never a write.
 *
 * Three reasons an annotation is not drawn, all applied through PDFium's
 * hidden flag in memory (see `pdf.worker.ts`), so the file is untouched:
 *
 *  - the person hid it (Kenneth's hide path, remembered per session);
 *  - it is a baked copy of a live REDBEAM markup, which the overlay already
 *    draws — drawing both would show every area twice, slightly apart the
 *    moment one of them is edited;
 *  - "Show only REDBEAM takeoff" is on, which hides every PDF markup.
 */

/** The markup kinds that are takeoff. Everything else is annotation. */
export const TAKEOFF_KINDS: ReadonlySet<string> = new Set(['area', 'cutout', 'polyline', 'count'])

export interface ViewAnnot { index: number, name: string }

export function hiddenForView(opts: {
  annots: readonly ViewAnnot[]
  userHidden: readonly number[]
  linkedNames: ReadonlySet<string>
  takeoffOnly: boolean
}): number[] {
  const out = new Set<number>()
  for (const i of opts.userHidden) out.add(i)
  for (const a of opts.annots) {
    if (opts.takeoffOnly || (a.name !== '' && opts.linkedNames.has(a.name))) out.add(a.index)
  }
  return [...out].sort((a, b) => a - b)
}

/** The annotations a person can pick on the sheet: not the ones the overlay stands in for. */
export function pickableAnnotations<T extends ViewAnnot>(list: readonly T[], linkedNames: ReadonlySet<string>): T[] {
  return list.filter((a) => a.name === '' || !linkedNames.has(a.name))
}

/** The overlay under "Show only REDBEAM takeoff". */
export function takeoffOverlay<T extends { kind: string }>(markups: readonly T[], takeoffOnly: boolean): T[] {
  return takeoffOnly ? markups.filter((m) => TAKEOFF_KINDS.has(m.kind)) : [...markups]
}
