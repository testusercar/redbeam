import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi } from 'vitest'
import { clampDpr, sizeCanvas, type StageSize , measureStage } from './useStageSize.js'

function fakeCanvas() {
  const calls: Array<number[]> = []
  const c = {
    width: 0, height: 0, style: {} as Record<string, string>,
    getContext: () => ({ setTransform: (...a: number[]) => calls.push(a) }),
  }
  return { canvas: c as unknown as HTMLCanvasElement, calls }
}

describe('clampDpr', () => {
  it('passes through a normal ratio', () => {
    expect(clampDpr(1)).toBe(1)
    expect(clampDpr(1.5)).toBe(1.5)
    expect(clampDpr(2)).toBe(2)
  })

  it('caps an extreme ratio rather than allocating an absurd bitmap', () => {
    expect(clampDpr(8)).toBe(3)
  })

  it('falls back to 1 for nonsense', () => {
    // Some environments report 0 or NaN; a 0-pixel backing store renders nothing.
    expect(clampDpr(0)).toBe(1)
    expect(clampDpr(-2)).toBe(1)
    expect(clampDpr(NaN)).toBe(1)
    // Infinity is nonsense, not "very high": fall back to 1 rather than
    // treating it as a real ratio and allocating the cap.
    expect(clampDpr(Infinity)).toBe(1)
  })
})

describe('sizeCanvas', () => {
  const size = (over: Partial<StageSize> = {}): StageSize =>
    ({ width: 1000, height: 700, dpr: 1.5, ...over })

  it('sets the backing store in DEVICE pixels and the style in CSS pixels', () => {
    // This is the blur fix: a 1000x700 CSS canvas on a 150% display needs a
    // 1500x1050 backing store, or the browser upscales a low-res bitmap.
    const { canvas } = fakeCanvas()
    expect(sizeCanvas(canvas, size())).toBe(true)
    expect(canvas.width).toBe(1500)
    expect(canvas.height).toBe(1050)
    expect(canvas.style['width']).toBe('1000px')
    expect(canvas.style['height']).toBe('700px')
  })

  it('applies the DPR transform with setTransform, never scale', () => {
    // scale() compounds. Re-running after a resize would square the ratio and
    // draw everything at 2.25x on a 1.5 display.
    const { canvas, calls } = fakeCanvas()
    sizeCanvas(canvas, size())
    expect(calls).toEqual([[1.5, 0, 0, 1.5, 0, 0]])
  })

  it('reports NO change when the size is already right', () => {
    // Resizing a canvas clears it. Doing that every frame would throw away the
    // tiles just drawn, so the caller needs to know whether to repaint.
    const { canvas } = fakeCanvas()
    expect(sizeCanvas(canvas, size())).toBe(true)
    expect(sizeCanvas(canvas, size())).toBe(false)
  })

  it('resizes again when the DPR changes, e.g. moved to another monitor', () => {
    const { canvas } = fakeCanvas()
    sizeCanvas(canvas, size({ dpr: 1 }))
    expect(canvas.width).toBe(1000)
    expect(sizeCanvas(canvas, size({ dpr: 2 }))).toBe(true)
    expect(canvas.width).toBe(2000)
  })

  it('is a no-op on a null canvas rather than throwing during teardown', () => {
    expect(sizeCanvas(null, size())).toBe(false)
  })
})

/**
 * The stage reports the size it actually is.
 *
 * `measureStage` used to clamp to 320x240 on the reasoning that the layout is
 * unusable below it. But the clamp does not widen the cell — it only makes
 * every consumer wrong about it. The viewport clamp centres the sheet in this
 * width, hit-testing maps pointer positions through it, and the canvas takes
 * its CSS size from it, so a 280px cell reported as 320 centred the sheet 20px
 * off, sent clicks near the right edge to page coordinates that do not exist,
 * and left the canvas overhanging the workspace pane by exactly the lie.
 */
describe('measureStage', () => {
  it('reports a narrow cell at its real width', () => {
    expect(measureStage({ width: 280, height: 200 }, 1)).toEqual({ width: 280, height: 200, dpr: 1 })
  })

  it('rounds to whole pixels', () => {
    const s = measureStage({ width: 280.4, height: 199.6 }, 1)
    expect(s.width).toBe(280)
    expect(s.height).toBe(200)
  })

  it('never reports a zero-sized stage', () => {
    // A collapsed or unmounted cell measures 0, and a 0-sized backing store is
    // an error in some canvas paths. This is the only thing the floor is for.
    const s = measureStage({ width: 0, height: 0 }, 2)
    expect(s.width).toBeGreaterThan(0)
    expect(s.height).toBeGreaterThan(0)
  })

  it('clamps an absurd device ratio but not the size', () => {
    const s = measureStage({ width: 4000, height: 3000 }, 8)
    expect(s).toEqual({ width: 4000, height: 3000, dpr: 3 })
  })
})

/**
 * The canvases are absolutely positioned children sized in JavaScript, so
 * nothing in the grid constrains them. When they and the cell disagree, the
 * drawing paints across the pane next door — which is what happened before
 * `measureStage` stopped lying. The clip is the second line of defence.
 */
describe('the stage cell', () => {
  it('clips whatever the canvases turn out to be', () => {
    const css = readFileSync(fileURLToPath(new URL('./shell/shell.css', import.meta.url)), 'utf8')
    const start = css.indexOf('\n.stage {')
    expect(start).toBeGreaterThan(-1)
    expect(css.slice(start, css.indexOf('\n}', start))).toContain('overflow: hidden')
  })
})
