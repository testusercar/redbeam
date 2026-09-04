import { describe, it, expect } from 'vitest'
import { drawPanelLayout, layoutSummary, type LayoutDrawOptions } from './drawLayout.js'
import { recordingContext } from '../tools/testContext.js'
import type { PanelCell } from '@redbeam/domain'
import type { Viewport } from '@redbeam/viewer'

const PAGE = { width: 3024.24, height: 2160.24 }
const view: Viewport = { ox: 0, oy: 0, zoom: 1, vw: 1000, vh: 800 }
const opts: LayoutDrawOptions = { color: '#e07a1f', pageWidth: PAGE.width, pageHeight: PAGE.height }

const rect = (x: number, y: number, w: number, h: number) =>
  [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]

const cell = (over: Partial<PanelCell> = {}): PanelCell => ({
  gridRow: 0, gridColumn: 0,
  fullPath: rect(100, 100, 120, 60),
  clippedRegion: [rect(100, 100, 120, 60)],
  clippedArea: 7200,
  stockPath: rect(100, 100, 120, 60),
  coverageFraction: 1, stockFraction: 1, stockKind: 'full',
  requiredLengthFraction: 1, requiredWidthFraction: 1,
  halfLengthFit: false, halfWidthFit: false,
  halfLengthUncoveredFraction: 0, halfWidthUncoveredFraction: 0,
  halfLengthOverageFraction: 0, halfWidthOverageFraction: 0,
  halfLengthScore: 0, halfWidthScore: 0,
  selectionReason: '', halfLengthReason: '', halfWidthReason: '',
  ...over,
})

describe('drawPanelLayout', () => {
  it('draws nothing and touches no state for an empty layout', () => {
    const ctx = recordingContext()
    drawPanelLayout(ctx.ctx, [], view, opts)
    expect(ctx.calls).toHaveLength(0)
  })

  it('balances save and restore', () => {
    // An unbalanced restore leaks clip and transform into whatever paints next.
    const ctx = recordingContext()
    drawPanelLayout(ctx.ctx, [cell(), cell({ stockKind: 'half-length' })], view, opts)
    const saves = ctx.calls.filter((c) => c.name === 'save').length
    const restores = ctx.calls.filter((c) => c.name === 'restore').length
    expect(saves).toBe(restores)
    expect(saves).toBeGreaterThan(0)
  })

  it('resets globalAlpha so later painting is not left translucent', () => {
    const ctx = recordingContext()
    drawPanelLayout(ctx.ctx, [cell()], view, opts)
    expect(ctx.ctx.globalAlpha).toBe(1)
  })

  it('hides the full grid cell by default', () => {
    // The full cell extends past the ceiling edge — accurate, but it reads as
    // material that is not there.
    const plain = recordingContext()
    drawPanelLayout(plain.ctx, [cell()], view, opts)
    const withFull = recordingContext()
    drawPanelLayout(withFull.ctx, [cell()], view, { ...opts, showFullCells: true })
    expect(withFull.calls.length).toBeGreaterThan(plain.calls.length)
    expect(plain.calls.some((c) => c.name === 'setLineDash')).toBe(false)
  })

  it('draws a half piece differently from a full one', () => {
    // 194 halves and 565 fulls is a materially different order from 759 fulls,
    // and they look identical unless the preview says so.
    //
    // The stub records method calls, not property assignments, so this reads
    // the style the draw LEFT on the context after one cell. That is only
    // meaningful because exactly one cell is drawn — the stub does not
    // implement save/restore semantics for style state.
    const full = recordingContext()
    drawPanelLayout(full.ctx, [cell({ stockKind: 'full' })], view, { ...opts, labels: false })
    const half = recordingContext()
    drawPanelLayout(half.ctx, [cell({ stockKind: 'half-width' })], view, { ...opts, labels: false })
    expect(full.ctx.lineWidth).not.toBe(half.ctx.lineWidth)
    expect(half.ctx.lineWidth).toBeGreaterThan(full.ctx.lineWidth)
  })

  it('labels only the exceptions, and only when zoomed in', () => {
    const zoomedIn = recordingContext()
    drawPanelLayout(zoomedIn.ctx, [cell({ stockKind: 'half-length' })], view, opts)
    expect(zoomedIn.calls.some((c) => c.name === 'fillText')).toBe(true)

    // A full panel is the norm; labelling every one of 565 is noise.
    const allFull = recordingContext()
    drawPanelLayout(allFull.ctx, [cell({ stockKind: 'full' })], view, opts)
    expect(allFull.calls.some((c) => c.name === 'fillText')).toBe(false)

    const zoomedOut = recordingContext()
    drawPanelLayout(zoomedOut.ctx, [cell({ stockKind: 'half-length' })],
      { ...view, zoom: 0.2 }, opts)
    expect(zoomedOut.calls.some((c) => c.name === 'fillText')).toBe(false)
  })

  it('survives a degenerate cell rather than throwing mid-paint', () => {
    // A throw here leaves the canvas half-drawn and the app looking broken.
    const ctx = recordingContext()
    expect(() => drawPanelLayout(ctx.ctx, [cell({ stockPath: [], fullPath: [] })], view, opts))
      .not.toThrow()
  })
})

describe('layoutSummary', () => {
  it('reports the engine count, not a recomputed one', () => {
    // Re-deriving "two halves make a panel" in a label is how it starts
    // disagreeing with the BOM it describes.
    expect(layoutSummary({
      placedCellCount: 759, fullPieceCount: 565, halfPieceCount: 194, panelCount: 662,
      fullPanelCount: 540, partialPanelCount: 219,
    })).toBe('759 cells · 565 full + 194 half → 662 ordered')
  })

  it('says so when nothing was laid out', () => {
    expect(layoutSummary({
      placedCellCount: 0, fullPieceCount: 0, halfPieceCount: 0, panelCount: 0,
      fullPanelCount: 0, partialPanelCount: 0,
    })).toBe('nothing laid out')
  })
})
