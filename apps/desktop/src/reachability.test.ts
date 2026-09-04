/**
 * Every module is reachable from the running app, or is listed here with a reason.
 *
 * The recurring defect in this codebase is not a wrong line — it is a whole
 * capability written, tested, reviewed and then never called. The dimension
 * tool sat complete in `tools/dimension.ts` behind a passing test suite while
 * the toolbar had no button for it; `recordCalculation`, `copyEstimate`,
 * `createWorkerPageProbe` and `PanelCell.pageId` were each found the same way,
 * one at a time, by accident. A green suite is exactly what this failure mode
 * looks like from the outside, which is why nothing caught it.
 *
 * So: a module whose exports no PRODUCTION file names is unreachable, however
 * well tested. A test does not count as a caller — an export whose only caller
 * is its own test is precisely the shape being looked for. Nor does a barrel:
 * re-exporting something nobody imports moves the deadness, it does not fix it.
 *
 * This is a ratchet, not a cleanup. The modules below are already unreachable
 * and each says why; the test fails when a NEW one appears, and equally when a
 * listed one gets wired up, so the list cannot quietly rot into fiction.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..')

/**
 * Everywhere a caller could live. `apps/mcp` is .mjs and imports nothing from
 * these packages — it talks to the app over a socket — but it is scanned
 * anyway, because "the MCP must be calling it" is the assumption that would
 * otherwise make this test wrong rather than noisy.
 */
const AREAS = [
  'apps/desktop/src', 'apps/mcp',
  'packages/domain/src', 'packages/store/src', 'packages/viewer/src',
]

/**
 * Unreachable on purpose, or unreachable and known. Each entry is the reason
 * it is not simply deleted — that reason is the point of the list, and an
 * entry that cannot state one should be deleted instead of listed.
 */
const KNOWN = new Map<string, string>([
  ['packages/domain/src/trace.ts',
    'Finish-region tracing, ported from the Qt build. Complete and tested; no '
    + 'tool in the toolbar and no MCP verb reaches it. Wiring it needs a UI '
    + 'decision (click-to-fill is a different gesture from every other tool).'],
  ['apps/desktop/src/tools/annotation.ts',
    'Callout and highlight. The last two unwired tools from the ported toolset; '
    + 'dimension.ts was the third and is now on the toolbar. Everything below '
    + 'the tool is already in place — MarkupKind carries \'callout\' and '
    + '\'highlight\', and both are excluded from every quantity path — so what '
    + 'is missing is only the Tool union entry and the draft handling.'],
  ['apps/desktop/src/tools/pattern.ts',
    'Pattern origin, direction and direction zones, ported from the Qt tools. '
    + 'MOSTLY SUPERSEDED, not missing: Workspace\'s `directionFromEdge` sets a '
    + 'direction by picking an edge of an area already drawn (this area, or the '
    + 'whole sheet), which beats carrying a separate tool, and it writes the '
    + 'same pageDirections/areaDirections specs the layout reads. What has no '
    + 'equivalent is the direction ZONE — an arbitrary polygon with its own '
    + 'direction, independent of any area. Delete the rest when someone decides '
    + 'zones are not wanted.'],
  ['packages/store/src/review.ts',
    'The agent review gate. Deliberate: markups.review_state has defaulted to '
    + 'accepted since the first migration, so nothing proposes yet. Wiring it '
    + 'is a product decision about whether agent markups land live.'],
  ['packages/domain/src/groundTruth.ts',
    'Plan 07.2, comparing a takeoff against a human quote. Deferred by Aaron '
    + '2026-09-02 ("satisfied with ur own checks"); the fixture for it exists '
    + 'at fixtures/ground-truth/barclays-28019.json.'],
  ['apps/desktop/src/tools/testContext.ts',
    'A test helper, and legitimately test-only. Listed rather than special-cased '
    + 'so the rule stays "no production caller", with no exception for names '
    + 'that happen to contain "test".'],
])

const isTest = (f: string) => /\.(test|spec)\.(ts|tsx|mjs)$/.test(f)
const isBarrel = (f: string) => /(^|[\\/])index\.(ts|tsx)$/.test(f)

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      yield* walk(p)
    } else if (/\.(ts|tsx|mjs)$/.test(name) && !name.endsWith('.d.ts')) {
      yield p
    }
  }
}

/** Exported VALUES. An unused type is a documentation question, not dead code. */
function exportedValues(src: string): string[] {
  return [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_]\w*)/gm)]
    .map((m) => m[1] ?? '')
    .filter((n) => n !== '')
}

function unreachable(): string[] {
  const files = AREAS.flatMap((a) => [...walk(join(REPO, a))])
  const src = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]))
  const out: string[] = []

  for (const [f, text] of src) {
    if (isTest(f) || isBarrel(f)) continue
    const names = exportedValues(text)
    if (names.length === 0) continue

    // One alternation over every export: the module is reachable if ANY of its
    // surface is named. Deliberately generous — this reports a module nothing
    // touches at all, never a partly-used one.
    const re = new RegExp(`\\b(?:${names.join('|')})\\b`)
    const reachable = [...src].some(([g, gtext]) =>
      g !== f && !isTest(g) && !isBarrel(g) && re.test(gtext))
    if (!reachable) out.push(relative(REPO, f).replace(/\\/g, '/'))
  }
  return out.sort()
}

describe('reachability', () => {
  const found = unreachable()

  it('finds no module that is unreachable without a recorded reason', () => {
    const surprises = found.filter((f) => !KNOWN.has(f))
    expect(
      surprises,
      `These modules are exported, possibly tested, and called by no production code:\n`
      + `  ${surprises.join('\n  ')}\n\n`
      + 'Either wire it to something a person can reach, delete it, or add it to '
      + 'KNOWN with the reason it exists unreachable. A passing test suite is '
      + 'what this failure mode looks like — that is why the list is explicit.',
    ).toEqual([])
  })

  it('lists nothing that has since been wired up', () => {
    const stale = [...KNOWN.keys()].filter((f) => !found.includes(f)).sort()
    expect(
      stale,
      `KNOWN claims these are unreachable, but production code now calls them:\n`
      + `  ${stale.join('\n  ')}\n`
      + 'Remove the entry — a stale exemption is how the next one hides.',
    ).toEqual([])
  })
})
