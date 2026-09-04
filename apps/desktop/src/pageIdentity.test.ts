/**
 * Every page id in the workspace must come from the ref, never from state.
 *
 * This exists because of a bug that was invisible in every way a bug can be.
 * `commitDraft` built its page id from the `pageIndex` STATE while `pageIndex`
 * was missing from its `useCallback` dependency array, so the callback closed
 * over the index from first render and never saw another. Every markup drawn
 * on every page was written to page 1 — the geometry was right, the sheet it
 * was filed under was wrong, nothing threw, nothing logged, and the markup
 * simply was not there when you went back to the page you drew it on.
 *
 * `Workspace.tsx` is ~2,000 lines with dozens of callbacks. The rule that
 * makes the whole class impossible is narrow and mechanical: a page id is
 * derived from `pageIndexRef.current`, always. The refs are synced during
 * render, so they cannot lag an effect either.
 *
 * This is a static check rather than a behavioural test on purpose — the bug
 * lives in a closure, and a rendered-component test that happened to re-create
 * the callback would pass while the shipped build stayed broken.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, 'Workspace.tsx'), 'utf8')

/** Strip comments so prose about the rule cannot trip the rule. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** Every `pageIdFor(a, b)` call, returning the second argument verbatim. */
function pageIdArguments(text: string): string[] {
  return [...code(text).matchAll(/pageIdFor\(\s*([^,)]+),\s*([^)]+)\)/g)].map((m) =>
    (m[2] ?? '').trim(),
  )
}

describe('page identity', () => {
  it('finds the call sites it is meant to police', () => {
    // A guard that silently matches nothing is worse than no guard.
    expect(pageIdArguments(SOURCE).length).toBeGreaterThan(5)
  })

  it('derives every page id from the ref, never from state', () => {
    /*
     * One exception, and it is a different shape of thing.
     *
     * The rule exists because reading the pageIndex STATE inside a callback
     * closes over whatever it was when the callback was made. A sweep that
     * enumerates every page has no "current page" to be wrong about — it
     * visits all of them by construction — so its loop variable is not a
     * stale read. It is named `sweepPage` rather than `i` precisely so that
     * saying so here does not also excuse an ordinary local.
     */
    /*
     * `targetPage` is the second exception, and the same shape as the first.
     *
     * The scale gestures act on sheets somebody SELECTED — a range in the sheet
     * index, one row from a right-click — so the page arrives as an argument
     * and there is no current page for it to be a stale read of. It is named
     * `targetPage` rather than `page` for the same reason `sweepPage` is not
     * `i`: an ordinary local still has to fail this test.
     */
    const ALLOWED = ['pageIndexRef.current', 'sweepPage', 'targetPage']
    const offenders = pageIdArguments(SOURCE).filter((arg) => !ALLOWED.includes(arg))
    expect(
      offenders,
      `pageIdFor() was called with ${offenders.join(', ')}.\n`
      + `Use pageIndexRef.current: reading the pageIndex state inside a callback `
      + `closes over whatever it was when the callback was created, and a missing `
      + `dependency then files every row under the wrong page — silently.`,
    ).toEqual([])
  })

  it('keeps the latest-value refs synced during render, not in an effect', () => {
    // In an effect these lag by one pass: an effect declared above the sync
    // still sees the previous page on the render where the page changed.
    const src = code(SOURCE)
    expect(src).toMatch(/^\s*pageIndexRef\.current = pageIndex$/m)
    expect(src).toMatch(/^\s*docIdRef\.current = activeDocId/m)
    expect(src).not.toMatch(/useEffect\(\(\) => \{ pageIndexRef\.current/)
  })

  it('records the scope orientation against the ref too', () => {
    // Same trap, different row: `sourcePage` is what a direction is measured
    // against, and a wrong one silently rotates a scope's whole layout.
    expect(code(SOURCE)).toMatch(/sourcePage: pageIndexRef\.current/)
  })
})
