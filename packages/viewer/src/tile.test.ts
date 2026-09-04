import { describe, expect, it } from 'vitest'
import { tileExtent } from './types.js'

/**
 * A tile bitmap is filled white before PDFium draws into it — that white is the
 * paper, since PDFium paints no background. So any part of the bitmap beyond
 * the page renders as paper that is not there.
 *
 * The symptom, on a real bid set: a US Letter spec sheet at 24% zoom is
 * 147 x 190 device pixels, which fits inside one 512px tile. The viewer drew a
 * 512 x 512 white square with the page tucked in its top-left corner, floating
 * in the middle of the viewport. It read as a broken render; it was a correct
 * render of a bitmap that was too big.
 */
describe('tileExtent', () => {
  const TILE = 512

  it('gives a full tile where the page still covers it', () => {
    // A 3456 x 2592 sheet at 100%: tile (0,0) is entirely inside the page.
    expect(tileExtent(3456, 2592, TILE, 0, 0)).toEqual({ bw: 512, bh: 512 })
    expect(tileExtent(3456, 2592, TILE, 5, 4)).toEqual({ bw: 512, bh: 512 })
  })

  it('clips the last column and row to where the page ends', () => {
    // 3456 = 6 * 512 + 384, and 2592 = 5 * 512 + 32.
    expect(tileExtent(3456, 2592, TILE, 6, 0).bw).toBe(384)
    expect(tileExtent(3456, 2592, TILE, 0, 5).bh).toBe(32)
    expect(tileExtent(3456, 2592, TILE, 6, 5)).toEqual({ bw: 384, bh: 32 })
  })

  it('never returns a bitmap wider or taller than the page itself', () => {
    // The regression: a letter sheet at 24% is smaller than one tile, and the
    // bitmap must be the page — not a tile with a page in the corner.
    const fullW = Math.round(612 * 0.24)
    const fullH = Math.round(792 * 0.24)
    expect(fullW).toBe(147)
    expect(fullH).toBe(190)
    expect(tileExtent(fullW, fullH, TILE, 0, 0)).toEqual({ bw: 147, bh: 190 })
  })

  it('tiles a page exactly, with no pixel counted twice or missed', () => {
    for (const [fullW, fullH] of [[3456, 2592], [147, 190], [512, 512], [513, 511]] as const) {
      const cols = Math.ceil(fullW / TILE)
      const rows = Math.ceil(fullH / TILE)
      let area = 0
      for (let ty = 0; ty < rows; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const { bw, bh } = tileExtent(fullW, fullH, TILE, tx, ty)
          expect(tx * TILE + bw, `column ${tx} of ${fullW}`).toBeLessThanOrEqual(fullW)
          expect(ty * TILE + bh, `row ${ty} of ${fullH}`).toBeLessThanOrEqual(fullH)
          area += bw * bh
        }
      }
      expect(area, `${fullW}x${fullH} must tile exactly`).toBe(fullW * fullH)
    }
  })

  it('never returns a zero dimension', () => {
    // PDFium refuses a zero-sized bitmap. A tile wholly past the page should
    // never be requested, but returning 0 would turn a scheduling mistake into
    // a crash in the worker rather than one blank tile.
    expect(tileExtent(147, 190, TILE, 1, 0).bw).toBe(1)
    expect(tileExtent(147, 190, TILE, 0, 1).bh).toBe(1)
    expect(tileExtent(0, 0, TILE, 0, 0)).toEqual({ bw: 1, bh: 1 })
  })
})
