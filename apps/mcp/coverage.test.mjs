/**
 * Coverage guard: the app must not grow a capability the bridge cannot reach.
 *
 * The contract tests next door pin the SHAPE of the surface. This pins its
 * EXTENT, against the app's own source, because the failure it exists to catch
 * has already happened twice and neither time did anything go red:
 *
 *  1. The `set_tool` allowlist drifted behind the `Tool` union. `direction`
 *     and `scale-region` were both in the toolbar and neither could be
 *     selected through the bridge — so the two gestures that decide how a
 *     takeoff is MEASURED were the two an agent could not exercise. Nothing
 *     was broken; a list had simply stopped being copied.
 *  2. `commit_scope` was implemented in the invoke switch and never added to
 *     the tool's action enum. The app could do it, the schema never said so,
 *     and an agent reading tools/list had no way to find out.
 *
 * Both are one list falling behind another list. So these read the app's
 * source as TEXT and compare the lists.
 *
 * Reading source with regexes is only safe if a miss is loud. Every extractor
 * here throws with the pattern it was looking for rather than returning an
 * empty set: a guard that quietly finds nothing to compare passes forever and
 * is worse than no guard at all.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tools, METHOD_OF, ACTION_OF } from './index.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktop = path.join(here, '..', 'desktop', 'src')
/*
 * Line endings normalized on the way in. The repo is worked on Windows and
 * checked out with CRLF, so a pattern ending in a blank line matched nothing
 * and every extractor here failed at once — loudly, which is the only reason
 * it was a five-minute problem rather than a guard that silently stopped
 * guarding.
 */
const slurp = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const read = (rel) => slurp(path.join(desktop, rel))

/** The section of Workspace.tsx that answers the bridge. */
function invokeSwitchSource() {
  const src = read('Workspace.tsx')
  const start = src.indexOf('invoke: async (action, params)')
  assert.notEqual(
    start, -1,
    'could not find `invoke: async (action, params)` in Workspace.tsx — if the ' +
    'bridge handler was renamed or moved, point this guard at its new shape ' +
    'rather than deleting it.',
  )
  // To the end of the hook call. `})` at the handler's own indentation is the
  // close of useBridgeRequests; nothing inside the switch sits that far left.
  const end = src.indexOf('\n  })', start)
  assert.notEqual(end, -1, 'could not find the end of the useBridgeRequests call')
  return src.slice(start, end)
}

const invokeSrc = invokeSwitchSource()
const invokeTool = tools.find((t) => t.name === 'redbeam_invoke_ui_action')

/**
 * Values of a `const name: T[] = ['a', 'b']` literal in a source string.
 *
 * Anchored on `= [`, not on the first bracket after the name: these lists are
 * all typed `Tool[]` / `MarkupKind[]`, and the annotation's own empty brackets
 * come first — which parsed as an empty list and turned the guard into a test
 * that compared nothing against nothing.
 */
function stringListAfter(src, marker, what) {
  const at = src.indexOf(marker)
  assert.notEqual(at, -1, `could not find ${what} (looked for \`${marker}\`)`)
  const literal = src.slice(at).match(/=\s*\[([\s\S]*?)\]/)
  assert.ok(literal, `${what} is not an array literal`)
  const items = [...literal[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  assert.ok(items.length > 0, `${what} came back empty — the guard has lost its target`)
  return new Set(items)
}

test('every drawing tool a person has can be selected through the bridge', () => {
  // The original drift. `Tool` is what the toolbar offers; `known` is what
  // set_tool accepts. They are the same list written twice, so make them equal
  // or the next tool added to the app is one an agent cannot test.
  const drawSrc = read('draw.ts')
  const decl = drawSrc.match(/export type Tool =([\s\S]*?)\n\n/)
  assert.ok(decl, 'could not find `export type Tool =` in draw.ts')
  const union = new Set([...decl[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]))
  assert.ok(union.size >= 6, 'the Tool union parsed suspiciously small')

  const allow = stringListAfter(invokeSrc, 'const known: Tool[]', "set_tool's allowlist")
  assert.deepEqual(
    [...allow].sort(), [...union].sort(),
    'set_tool accepts a different set of tools than draw.ts defines',
  )
})

test('every action the app implements is advertised, and every one advertised exists', () => {
  // `commit_scope` was implemented and undeclared for a whole release. An
  // action missing from the enum is unreachable in practice — an agent only
  // knows what tools/list tells it — and an enum entry with no case is a
  // promise the app answers with "unknown action".
  const cases = new Set(
    [...invokeSrc.matchAll(/^\s{8}case '([a-z_]+)':/gm)].map((m) => m[1]),
  )
  assert.ok(cases.size > 10, 'found suspiciously few `case` labels in the invoke switch')
  const advertised = new Set(invokeTool.inputSchema.properties.action.enum)
  assert.deepEqual(
    [...cases].sort(), [...advertised].sort(),
    'the invoke switch and the action enum disagree',
  )
})

test('every parameter a handler reads is declared in the schema', () => {
  // An undocumented parameter is one an agent cannot know to send, so the
  // handler that reads it behaves as though the caller never supplied it —
  // which looks like the feature not working rather than the schema being
  // short of a line.
  const used = new Set([...invokeSrc.matchAll(/params\['([a-zA-Z0-9]+)'\]/g)].map((m) => m[1]))
  const declared = new Set(Object.keys(invokeTool.inputSchema.properties))
  for (const p of used) {
    assert.ok(declared.has(p), `the invoke switch reads params['${p}'] but the schema never mentions it`)
  }
})

test('create_markup only offers kinds the domain actually has', () => {
  // Subset, not equality, and deliberately: `calibration` is written by the
  // calibrate gesture rather than drawn, and dimension/callout/highlight carry
  // their payload in `content` and are not takeoff geometry. Equality here
  // would be a demand that the bridge offer kinds create_markup cannot make.
  // What it does catch is a typo — a kind allowed here that nothing renders.
  const domain = slurp(path.join(here, '..', '..', 'packages', 'domain', 'src', 'scope.ts'))
  const decl = domain.match(/export type MarkupKind =([\s\S]*?)\n\n/)
  assert.ok(decl, 'could not find `export type MarkupKind =` in the domain')
  const kinds = new Set([...decl[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]))
  const allowed = stringListAfter(invokeSrc, 'const allowed: MarkupKind[]', "create_markup's kinds")
  for (const k of allowed) assert.ok(kinds.has(k), `create_markup offers '${k}', which is not a MarkupKind`)
})

test('the panels an agent can open are the panels the app has', () => {
  // The BOM panel could not be opened through the bridge, so the exports that
  // live on it could not be reached from an agent's seat at all. `only` is the
  // one place that says which dialogs exist and that they exclude each other.
  const src = read('Workspace.tsx')
  const decl = src.match(/const only = useCallback\(\(open: ([^)]*?)\)/)
  assert.ok(decl, "could not find the `only` panel switcher in Workspace.tsx")
  const panels = new Set([...decl[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]))
  const offered = new Set(invokeTool.inputSchema.properties.panel.enum)
  for (const p of panels) {
    assert.ok(offered.has(p), `the app has a '${p}' panel that open_panel cannot open`)
  }
  // `settings` and `none` are not in `only` — settings is a full-screen place
  // with its own opener, and `none` closes everything. Both must still work.
  for (const extra of ['settings', 'none']) assert.ok(offered.has(extra), `open_panel needs '${extra}'`)
})

test('named tools bind an action that exists and route through invoke_ui_action', () => {
  // A bound tool is sugar over the omnibus. If the binding drifts, the tool
  // silently calls a different action or none, and the error an agent sees
  // blames the app rather than the map.
  const advertised = new Set(invokeTool.inputSchema.properties.action.enum)
  for (const [toolName, action] of Object.entries(ACTION_OF)) {
    assert.ok(tools.some((t) => t.name === toolName), `${toolName} is bound but not exposed`)
    assert.equal(METHOD_OF[toolName], 'invoke_ui_action', `${toolName} must route through invoke_ui_action`)
    assert.ok(advertised.has(action), `${toolName} binds '${action}', which is not in the action enum`)
  }
})
