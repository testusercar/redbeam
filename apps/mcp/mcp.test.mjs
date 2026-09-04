/**
 * Contract tests for the MCP surface.
 *
 * These do NOT need the app running: they pin the tool schemas and the
 * name->method mapping, which is where a rename silently breaks an agent.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { tools, METHOD_OF } from './index.mjs'

test('every tool maps to a bridge method, and every mapping has a tool', () => {
  // A tool with no mapping fails at call time with "Unknown REDBEAM tool";
  // a mapping with no tool is dead code an agent can never reach.
  const names = new Set(tools.map((t) => t.name))
  for (const t of tools) assert.ok(METHOD_OF[t.name], `${t.name} has no bridge method`)
  for (const n of Object.keys(METHOD_OF)) assert.ok(names.has(n), `${n} is mapped but not exposed`)
})

test('tool names are unique and namespaced', () => {
  const names = tools.map((t) => t.name)
  assert.equal(new Set(names).size, names.length, 'duplicate tool name')
  for (const n of names) assert.match(n, /^redbeam_[a-z_]+$/)
})

test('every tool has a description and a valid object schema', () => {
  for (const t of tools) {
    assert.ok(t.description?.length > 20, `${t.name} needs a real description`)
    assert.equal(t.inputSchema.type, 'object', `${t.name} schema must be an object`)
    for (const req of t.inputSchema.required ?? []) {
      assert.ok(t.inputSchema.properties[req], `${t.name} requires ${req} but does not define it`)
    }
  }
})

test('open_project warns that it does not open synchronously', () => {
  // The trap: `accepted` is not `opened`. An agent that reads it as done will
  // query an empty project and conclude the app is broken.
  const t = tools.find((x) => x.name === 'redbeam_open_project')
  assert.match(t.description, /accepted/i)
  assert.match(t.description, /poll/i)
})

test('execute_query says why writes are refused, not just that they are', () => {
  const t = tools.find((x) => x.name === 'redbeam_execute_query')
  assert.match(t.description, /undo|activity/i)
})

test('window-dependent tools say so', () => {
  // Store-backed tools work on a minimized app; these do not, and an agent
  // should know which kind it is calling before it blames the bridge.
  for (const name of ['redbeam_get_ui_state', 'redbeam_screenshot']) {
    const t = tools.find((x) => x.name === name)
    assert.match(t.description, /window/i, `${name} should mention needing a window`)
  }
})

test('writes are documented as landing on the undo stack', () => {
  // An agent writing takeoff must know the change is visible to the person who
  // owns the estimate, not silently applied.
  const t = tools.find((x) => x.name === 'redbeam_invoke_ui_action')
  assert.match(t.description, /undo stack/i)
  assert.match(t.description, /agent/i)
})

test('the writes that do NOT undo say so by name', () => {
  // Extended when the surface grew writes the undo stack has never covered.
  // The blanket promise above was true of every action when it was written and
  // is not any more: committing a scope records an answer rather than editing
  // one, and a scale region is project setup. An agent that believes it can
  // reverse either will tell somebody it has, which is worse than refusing.
  const t = tools.find((x) => x.name === 'redbeam_invoke_ui_action')
  assert.match(t.description, /commit_scope/)
  assert.match(t.description, /set_page_scale/)
  assert.match(t.description, /scale.region/i)
  // Named, not merely implied. `set_page_scale` covers a whole sheet series in
  // one transaction and the store writes it outside the undo stack — the
  // button has the same property — so there is no taking it back, and an
  // agent that believes there is will overwrite a scale to "try it".
  assert.match(t.description, /cannot be taken back/i)
})

test('the bill of materials warns that its total is not the sum of its rows', () => {
  // `totals` covers VERIFIED lines only and a blocked line has quantity null.
  // An agent that adds the rows up, or reads null as zero, produces a number
  // somebody prices work from.
  const t = tools.find((x) => x.name === 'redbeam_get_bom')
  assert.match(t.description, /confidence/i)
  assert.match(t.description, /verified/i)
  assert.match(t.description, /null/i)
})

test('export says where its output goes', () => {
  // Two of the three come back as text and one lands in a downloads folder the
  // agent cannot read. An agent expecting a file path for the first two, or
  // bytes for the third, is stuck either way.
  const t = tools.find((x) => x.name === 'redbeam_export')
  assert.match(t.description, /text/i)
  assert.match(t.description, /download/i)
  assert.deepEqual(
    t.inputSchema.properties.what.enum,
    ['tsv', 'report', 'marked-pdf', 'csv', 'estimate-tsv', 'pdf'],
  )
})

test('a scale can be set by name, and the names are discoverable', () => {
  // The preset ids are not guessable — `arch-1-8`, not `1/8"` — and guessing
  // one produces a refusal that says nothing about what would have worked.
  const t = tools.find((x) => x.name === 'redbeam_invoke_ui_action')
  assert.ok(t.inputSchema.properties.action.enum.includes('get_scale_presets'))
  assert.match(t.inputSchema.properties.presetId.description, /get_scale_presets/)
})

test('specifications are documented as merged, not replaced', () => {
  // The same object carries the pattern directions the direction tool writes.
  // A replacing write from an agent editing a panel size silently re-orients
  // every piece count on the scope, and nothing reports it.
  const t = tools.find((x) => x.name === 'redbeam_invoke_ui_action')
  assert.match(t.inputSchema.properties.specifications.description, /merged/i)
  assert.match(t.inputSchema.properties.specifications.description, /direction/i)
})

test('a scale region says which coordinate space it wants, like create_markup', () => {
  // Same trap, same page: PDF points are in the hundreds and would "work",
  // putting the region somewhere it governs nothing.
  const t = tools.find((x) => x.name === 'redbeam_invoke_ui_action')
  assert.match(t.inputSchema.properties.rect.description, /normalized/i)
  assert.match(t.inputSchema.properties.rect.description, /NOT PDF points/i)
})

test('create_markup says which coordinate space it wants', () => {
  // Page points are in the hundreds and would "work" — placing a markup off
  // the sheet. The schema has to say normalized, and the app rejects the rest.
  const t = tools.find((x) => x.name === 'redbeam_invoke_ui_action')
  assert.match(t.inputSchema.properties.rings.description, /normalized/i)
  assert.match(t.inputSchema.properties.rings.description, /NOT PDF points/i)
})

test('page numbering is documented as zero-based where it is exposed', () => {
  // The Qt surface is zero-based and so is ours; an off-by-one here is a
  // markup on the wrong sheet.
  const pages = tools.find((x) => x.name === 'redbeam_list_pages')
  assert.match(pages.description, /zero-based/i)
  const invoke = tools.find((x) => x.name === 'redbeam_invoke_ui_action')
  assert.match(invoke.inputSchema.properties.page.description, /zero-based/i)
  // And on every parameter that names a sheet, not just the one that did when
  // this was written. Applying a scale one sheet out puts a whole series at
  // the wrong scale, which is the same off-by-one with a hundred times the
  // blast radius.
  for (const p of ['pages', 'fromPage', 'toPage']) {
    assert.match(
      invoke.inputSchema.properties[p].description, /zero-based/i,
      `${p} names a sheet and must say the numbering is zero-based`,
    )
  }
})
