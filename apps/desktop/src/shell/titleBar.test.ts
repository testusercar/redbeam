/**
 * Guards on the title bar's two destructive-looking controls.
 *
 * Both of these shipped wrong for months and nothing caught it, because a
 * dropdown that closes your project and a dropdown that switches project look
 * identical until you click one.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('the project switcher', () => {
  const workspace = read('../Workspace.tsx')
  const app = read('../App.tsx')

  /**
   * The name of the open project used to be wired straight to Close Project:
   * clicking it threw the project away and dropped you on the start screen. It
   * looked like a dropdown and behaved like a destructive action.
   */
  it('is not wired to close the project', () => {
    expect(workspace).not.toMatch(/onPickProject/)
    expect(workspace).not.toMatch(/projectMenu[\s\S]{0,200}onOpen:\s*onCloseProject/)
  })

  /**
   * A window IS a project — its database, its undo stack and every id in the
   * workspace belong to it — so choosing another project opens a second window
   * rather than tearing this one down.
   */
  it('opens another project in a second window', () => {
    expect(app).toMatch(/openProjectWindow/)
    expect(app).toMatch(/onOpenProject=\{openProjectElsewhere\}/)
  })
})

describe('popping a tab out', () => {
  const workspace = read('../Workspace.tsx')
  const windowTs = read('../tauri/window.ts')

  /**
   * The context window must open on the sheet that was popped, not on whatever
   * the project opens first — so the target travels on the URL rather than the
   * new window guessing.
   */
  it('carries the document to the context window', () => {
    expect(windowTs).toMatch(/documentPath/)
    expect(workspace).toMatch(/openContextWindow\([^)]*tab\?\.relativePath\)/)
  })
})

/**
 * The estimate panel's toggle was given `class="tabadd"` — the tab strip's
 * "open another document" affordance — so the two were the same control as far
 * as the stylesheet and the DOM were concerned. A change to one would have
 * silently restyled the other, and assistive technology was told the panel
 * toggle was a way to add a tab.
 *
 * The shared thing is the SHAPE. What each button IS is the class beside it.
 */
describe('title-bar icon buttons', () => {
  const shell = readFileSync(fileURLToPath(new URL('./Shell.tsx', import.meta.url)), 'utf8')

  it('share a shape class and keep their own identity', () => {
    expect(shell).toContain('className="titleicon paneltoggle"')
    expect(shell).toContain('className="titleicon tabadd"')
  })

  it('never wear the tab affordance alone', () => {
    expect(shell).not.toMatch(/className="tabadd"/)
  })

  it('show the toggle is holding a state', () => {
    const css = readFileSync(fileURLToPath(new URL('./shell.css', import.meta.url)), 'utf8')
    expect(css).toContain('.titleicon[aria-pressed="true"]')
  })
})

/**
 * A window opened FOR a project opens THAT project.
 *
 * The URL carries the project id for every window, and App honoured it only
 * when the role was `context`. A second PROJECT window therefore ignored the
 * id in its own URL, fell through to the reopen-on-launch path, and opened the
 * most recent project instead — so "open another project" produced a second
 * window showing the project you already had open. Indistinguishable from the
 * command doing nothing.
 */
describe('a second project window', () => {
  const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8')

  it('adopts the project from its own URL whatever its role', () => {
    const at = app.indexOf('if (identity.projectId !== null && openPath === null)')
    expect(at, 'the URL project is not adopted').toBeGreaterThan(-1)
    // The old bug in one line: the adoption must not be gated on the role.
    const body = app.slice(at, at + 160)
    expect(body).not.toContain("role === 'context'")
  })

  it('does not then reopen the most recent project over the top of it', () => {
    const at = app.indexOf('const attempted = useRef(false)')
    expect(at).toBeGreaterThan(-1)
    const effect = app.slice(at, app.indexOf('}, [project,', at))
    expect(effect, 'reopen-on-launch does not stand down for an explicit project')
      .toContain('if (identity.projectId !== null) return')
  })
})
