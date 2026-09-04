/**
 * Guards on the icon vocabulary and on what the dock is allowed to say.
 *
 * Both of these were design defects that survived a long time because nothing
 * failed when they were introduced — they only showed up when somebody looked
 * at four screens side by side and said the product looked like three products.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SIZE } from './icons.js'

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('the icon vocabulary', () => {
  /**
   * The roles used to carry four different weights — 2.5, 2, 2, 1.75, 1.75 —
   * on the theory that a smaller glyph needs a heavier line. What it actually
   * produced was a chevron, a row icon and a section icon that visibly came
   * from three different icon sets, sitting 8px apart.
   */
  it('draws every icon from one family, Fluent UI System Icons', () => {
    const src = read('./icons.tsx')
    expect(src).toContain("from '@fluentui/react-icons'")
    expect(src).not.toContain('lucide')
  })

  /** 12 chevrons, 14 rows, 16 controls, 18 rail, 24 empty state. 8 is a dot. */
  it('offers no size off the layout module', () => {
    const sizes = Object.values(SIZE).map((s) => s.size).sort((a, b) => a - b)
    expect(sizes).toEqual([8, 12, 14, 16, 18, 24])
  })
})

describe('the dock', () => {
  const dock = read('./Dock.tsx')

  /**
   * The dock carries controls, not status.
   *
   * A tool mismatch and a paused layout both used to surface over the drawing —
   * one as a strip that reflowed the pill and moved the tools out from under
   * the cursor, one as a bar inside it. Both are properties of the SCOPE, true
   * whether or not you are holding a tool, so both belong in the estimates
   * panel beside the number they are about.
   */
  it('renders no warning or blocker of its own', () => {
    expect(dock).not.toMatch(/dockwarn|dockblock|toolWarning|TriangleAlert/)
  })

  /**
   * Red is navigation, white is action, scope colour is data. A control filled
   * or outlined in the scope's colour is a fourth rule, and on an amber scope
   * it reads as a warning rather than as the thing to press.
   */
  it('never paints a control in the active scope’s colour', () => {
    expect(dock).not.toMatch(/borderColor:\s*active\.color|color:\s*active\.color/)
  })
})
