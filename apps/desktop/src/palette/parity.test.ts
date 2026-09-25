/**
 * The prompt is the control surface. Every action the toolbar, the sidebar,
 * the menus and the MCP can take has a palette command, and the command does
 * the thing IN the prompt: it collects what it needs as steps and runs, and
 * it does not open a panel for the person to finish there.
 *
 * Aaron, 2026-09-11: "I should be able to drive the entire UI from the
 * command prompt without it shunting me off to a UI surface. This is very,
 * very important."
 *
 * Two ratchets. The first is a register: every UI affordance and MCP verb,
 * with the command id that reaches the same function; the test fails when a
 * listed id disappears from the workspace. Adding an affordance means adding
 * a row here. The second names the rows whose ONLY job is to open a surface,
 * which are the allowed exceptions (a pane is a place, not an action), and
 * fails if any other row's `run` merely opens the sidebar, settings or a
 * pane.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workspace = readFileSync(fileURLToPath(new URL('../Workspace.tsx', import.meta.url)), 'utf8')
const projects = readFileSync(fileURLToPath(new URL('./projects.ts', import.meta.url)), 'utf8')
const source = workspace + projects

/** UI affordance or MCP verb -> the palette command that does the same thing. */
const REGISTER: ReadonlyArray<[affordance: string, commandId: string]> = [
  // title bar and app menu
  ['app menu · Open project', 'project:browse'],
  ['app menu · New project', 'project:new'],
  ['project switcher · a recent project', 'project:'],
  ['project switcher · rename / hide / set aside / reveal', 'project:manage'],
  ['app menu · Close project', 'close-project'],
  ['app menu · Settings', 'settings'],
  ['settings, at a card', 'settings-at'],
  ['tab strip · close tab', 'close-tab'],
  ['tab strip · close other tabs', 'close-other-tabs'],
  ['tab strip · reopen closed tab', 'reopen-tab'],
  ['tab strip · pop out to a context window', 'context-window'],
  // left rail
  ['rail · Files / Contents / Thumbnails / Search panes', 'pane-'],
  ['rail · Search pane', 'search-pane'],
  ['search field · project', 'search'],
  ['search field · this document', 'search-document'],
  ['search field · this sheet', 'search-sheet'],
  ['search field · this folder', 'search-folder'],
  ['files footer · Refresh', 'refresh-files'],
  ['files pane · open a document', 'doc-'],
  ['contents pane · go to a sheet', 'page-'],
  // dock
  ['dock · previous sheet', 'prev-sheet'],
  ['dock · next sheet', 'next-sheet'],
  ['dock · fit sheet', 'fit-page'],
  ['dock · fit width', 'fit-width'],
  ['dock · a tool', 'tool-'],
  ['dock · leave takeoff', 'leave-takeoff'],
  ['dock · scale pill · preset for this sheet', 'set-scale'],
  ['dock · scale pill · a range of sheets', 'scale-range'],
  ['dock · scale pill · every sheet', 'scale-all'],
  ['dock · scale pill · calibrate from the drawing', 'calibrate'],
  ['dock · scale pill · draw a region', 'scale-region'],
  ['dock · scale pill · remove a region', 'remove-region'],
  ['dock · direction', 'set-direction'],
  ['dock · layout preview (a setting row)', 'set:'],
  ['dock · undo / redo', 'undo'],
  // estimates pane
  ['estimates · toggle the pane', 'pane-estimates'],
  ['estimates · new round', 'new-round'],
  ['estimates · a round (open, rename, duplicate, delete)', 'est-'],
  ['round · rename', 'rename-round'],
  ['round · duplicate', 'duplicate-round'],
  ['round · delete', 'delete-round'],
  ['round · export estimate', 'export-estimate'],
  ['round · save report', 'save-report'],
  ['round · copy bill', 'copy-bill'],
  ['round · save marked-up PDF', 'save-marked'],
  ['round · add scope', 'add-scope'],
  ['round · a scope (everything, as a hub)', 'scope-'],
  ['scope · take off', 'take-off'],
  ['scope · configure', 'configure-scope'],
  ['scope · product', 'set-product'],
  ['scope · measured as (custom assembly)', 'set-counts'],
  ['scope · colour', 'scope-colour'],
  ['scope · rename', 'rename-scope'],
  ['scope · duplicate', 'duplicate-scope'],
  ['scope · archive', 'remove-scope'],
  ['scope · restore', 'restore-scope'],
  ['scope · commit', 'commit-scope'],
  ['round · commit every scope', 'commit-all'],
  ['scope · parts page', 'quantities'],
  ['scope · setup page', 'specs'],
  ['scope · markups page', 'scope-markups'],
  ['markup row · move to another scope', 'move-markup'],
  ['markup row · delete', 'delete-markup'],
  ['drawing menu · direction from an edge', 'direction-from-edge'],
  ['drawing menu · start the pattern here', 'start-pattern'],
  ['drawing menu · hide PDF markups', 'hide-pdf-markups'],
  ['app menu · set project data aside', 'set-project-aside'],
  ['drawing menu · convert the PDF\'s markups', 'convert-annotations'],
  // settings
  ['settings · every switch', 'set:'],
  ['settings · reset all', 'reset-settings'],
]

/**
 * Rows allowed to do nothing but open a surface: a pane is a place, not an
 * action, and "show me where it lives" is the whole point of these.
 */
const SURFACE_ROWS = new Set([
  'pane-files', 'pane-contents', 'pane-thumbnails', 'pane-search', 'pane-estimates',
  'search-pane', 'settings', 'settings-at', 'context-window', 'cfg-open',
])

describe('the prompt is the control surface', () => {
  for (const [affordance, id] of REGISTER) {
    it(`${affordance} -> ${id}`, () => {
      const literal = source.includes(`id: '${id}'`)
      const template = source.includes(`id: \`${id}`)
      const prefix = source.includes(`'${id}`)
      expect(literal || template || prefix, `no palette command ${id} for: ${affordance}`).toBe(true)
    })
  }

  it('no command exists only to open the sidebar, settings or a pane', () => {
    // A `run` whose body is exactly a surface opener, on a row not allowed to be one.
    const shunts = [
      /id: '([a-z0-9:.-]+)'[^\n]*run: (?:openParts|openScopeEditor|openSettings|openSearch|openBrowser)\b/g,
      /id: '([a-z0-9:.-]+)'[^\n]*run: \(\) => \{? ?set(?:OpenScopeId|WorkOpen|SettingsOpen|RailPanel)\([^)]*\) ?\}?,?\s*$/gm,
    ]
    const offenders: string[] = []
    for (const re of shunts) {
      for (const m of workspace.matchAll(re)) if (!SURFACE_ROWS.has(m[1]!)) offenders.push(m[1]!)
    }
    expect(offenders, 'these rows only open a surface; give them the action in the prompt').toEqual([])
  })

  it('never skips the scope choice because one happens to be open', () => {
    // The old shape: `step: shown === undefined ? pickScope(...) : something(shown.id).step!`
    expect(workspace).not.toMatch(/step: shown === undefined \? pickScope/)
    // Nor the same choice spread in: `...(shown === undefined ? { step: pickScope(...) } : { run })`.
    expect(workspace).not.toMatch(/shown === undefined\s*\?\s*\{ step: pickScope/)
  })

  it('collects a number setting in the prompt rather than opening Settings', () => {
    expect(workspace).not.toMatch(/id: `set:\$\{d\.id\}`,[\s\S]{0,300}run: openSettings,/)
  })
})
