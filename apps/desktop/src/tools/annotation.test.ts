import { describe, it, expect } from 'vitest'
import type { Viewport } from '@redbeam/viewer'
import {
  CALLOUT_OPACITY,
  DEFAULT_CALLOUT_CONTENT,
  DEFAULT_HIGHLIGHT_CONTENT,
  HIGHLIGHT_OPACITY,
  calloutDraftBack,
  calloutDraftMove,
  calloutDraftPlace,
  calloutLeaderScreenPath,
  calloutTextColorFor,
  commitCallout,
  commitHighlight,
  drawCallout,
  drawCalloutDraft,
  drawHighlight,
  drawRectDraft,
  emptyCalloutDraft,
  emptyRectDraft,
  fitCalloutBox,
  hitTestCallout,
  hitTestHighlight,
  isCalloutCommittable,
  isRectCommittable,
  leaderAttachPoint,
  lightnessF,
  parseCalloutContent,
  parseHexColor,
  parseHighlightContent,
  rectDraftMove,
  rectDraftPlace,
  rectRing,
  ringBounds,
  serializeContent,
  wrapText,
  type CalloutMarkup,
  type HighlightMarkup,
} from './annotation.js'
import { recordingContext } from './testContext.js'

const view: Viewport = { ox: 0, oy: 0, zoom: 1, vw: 1000, vh: 1000 }
const W = 1000
const H = 1000

const highlight = (id: string, rings = [rectRing({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.3 })]):
  HighlightMarkup => ({
  id, scopeId: null, documentId: 'd', pageId: 'p', kind: 'highlight',
  rings, content: { ...DEFAULT_HIGHLIGHT_CONTENT },
})

const callout = (
  id: string,
  anchor = { x: 0.1, y: 0.1 },
  box: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 0.4, y: 0.4 }, { x: 0.7, y: 0.5 },
  ],
  text = 'CL-03 typ.',
): CalloutMarkup => ({
  id, scopeId: null, documentId: 'd', pageId: 'p', kind: 'callout',
  rings: [rectRing(box[0], box[1]), [anchor]],
  content: { ...DEFAULT_CALLOUT_CONTENT, text },
})

describe('geometry helpers', () => {
  it('normalizes a drag into a TL, TR, BR, BL ring whichever way it was dragged', () => {
    const forward = rectRing({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.7 })
    const backward = rectRing({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.3 })
    expect(forward).toEqual(backward)
    expect(forward).toEqual([
      { x: 0.2, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.6, y: 0.7 }, { x: 0.2, y: 0.7 },
    ])
  })

  it('bounds a ring, and refuses an empty one', () => {
    expect(ringBounds(rectRing({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.7 })))
      .toEqual({ left: 0.2, top: 0.3, right: 0.6, bottom: 0.7 })
    expect(ringBounds([])).toBeNull()
  })

  it('attaches a leader on the box border facing the anchor, not at its centre', () => {
    const box = { left: 100, top: 100, right: 300, bottom: 200 }
    // straight left of the box
    expect(leaderAttachPoint(box, { x: 0, y: 150 })).toEqual({ x: 100, y: 150 })
    // straight above
    expect(leaderAttachPoint(box, { x: 200, y: 0 })).toEqual({ x: 200, y: 100 })
    // a degenerate box collapses to its centre rather than dividing by zero
    const flat = { left: 100, top: 100, right: 100, bottom: 100 }
    expect(leaderAttachPoint(flat, { x: 0, y: 0 })).toEqual({ x: 100, y: 100 })
  })

  it('builds the leader path with the derived attach point last', () => {
    const path = calloutLeaderScreenPath(callout('c'), view, W, H)
    expect(path[0]).toEqual({ x: 100, y: 100 })
    expect(path.length).toBe(2)
    // ends on the box border, not inside it
    expect(path[1]!.x).toBeGreaterThanOrEqual(400)
    expect(path[1]!.y).toBeGreaterThanOrEqual(400)
  })

  it('supports a doglegged leader', () => {
    const m = callout('c')
    m.rings[1] = [{ x: 0.1, y: 0.1 }, { x: 0.1, y: 0.45 }]
    const path = calloutLeaderScreenPath(m, view, W, H)
    expect(path.length).toBe(3)
    expect(path[1]).toEqual({ x: 100, y: 450 })
  })

  it('draws no leader when the callout carries none', () => {
    const m = callout('c')
    m.rings = [m.rings[0]!]
    expect(calloutLeaderScreenPath(m, view, W, H)).toEqual([])
  })
})

describe('colour', () => {
  it('parses short and long hex', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 1, g: 1, b: 1 })
    expect(parseHexColor('#000000')).toEqual({ r: 0, g: 0, b: 0 })
    expect(parseHexColor('rebeccapurple')).toBeNull()
  })

  it('computes QColor lightnessF as HSL lightness', () => {
    expect(lightnessF('#000000')).toBe(0)
    expect(lightnessF('#ffffff')).toBe(1)
    expect(lightnessF('#ff0000')).toBeCloseTo(0.5, 12)
  })

  it('picks white text on a dark scope colour, black otherwise', () => {
    // the Qt rule: lightnessF() < 0.35
    expect(calloutTextColorFor('#2d9cdb')).toBe('#000000')
    expect(calloutTextColorFor('#101820')).toBe('#ffffff')
    expect(calloutTextColorFor('#ffffff')).toBe('#000000')
  })
})

describe('content_json', () => {
  it('defaults to the Qt tool XML values', () => {
    expect(DEFAULT_HIGHLIGHT_CONTENT.opacity).toBe(HIGHLIGHT_OPACITY)
    expect(DEFAULT_CALLOUT_CONTENT.opacity).toBe(CALLOUT_OPACITY)
    expect(DEFAULT_CALLOUT_CONTENT.borderWidth).toBe(1.2)
    expect(DEFAULT_CALLOUT_CONTENT.fontPx).toBe(10)
  })

  it('round-trips', () => {
    const hc = { color: '#ff0000', opacity: 0.5 }
    expect(parseHighlightContent(serializeContent(hc))).toEqual(hc)
    const cc = {
      text: 'note', color: '#00ff00', textColor: '#ffffff',
      opacity: 0.2, fontPx: 14, borderWidth: 2,
    }
    expect(parseCalloutContent(serializeContent(cc))).toEqual(cc)
  })

  it('falls back on garbage without throwing', () => {
    for (const bad of ['', '{', 'null', null, undefined, 7, [], { opacity: 'x' }]) {
      expect(parseHighlightContent(bad)).toEqual(DEFAULT_HIGHLIGHT_CONTENT)
      expect(parseCalloutContent(bad)).toEqual(DEFAULT_CALLOUT_CONTENT)
    }
  })

  it('clamps opacity into range', () => {
    expect(parseHighlightContent({ opacity: 4 }).opacity).toBe(1)
    expect(parseHighlightContent({ opacity: -1 }).opacity).toBe(0)
  })
})

describe('highlight drafting', () => {
  it('needs a real drag in both axes', () => {
    let d = emptyRectDraft()
    expect(isRectCommittable(d)).toBe(false)
    d = rectDraftPlace(d, { x: 0.2, y: 0.2 })
    expect(isRectCommittable(d)).toBe(false)
    d = rectDraftMove(d, { x: 0.2, y: 0.5 })
    expect(isRectCommittable(d)).toBe(false) // zero width
    d = rectDraftMove(d, { x: 0.5, y: 0.5 })
    expect(isRectCommittable(d)).toBe(true)
    expect(commitHighlight(d)!.rings[0]).toEqual(rectRing({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.5 }))
  })

  it('commits with the Qt opacity unless told otherwise', () => {
    let d = rectDraftPlace(emptyRectDraft(), { x: 0.2, y: 0.2 })
    d = rectDraftMove(d, { x: 0.5, y: 0.5 })
    expect(commitHighlight(d)!.content.opacity).toBe(HIGHLIGHT_OPACITY)
    expect(commitHighlight(d, { color: '#abcdef' })!.content.color).toBe('#abcdef')
    expect(commitHighlight(emptyRectDraft())).toBeNull()
  })
})

describe('callout drafting', () => {
  it('takes the anchor first, then the box', () => {
    let d = emptyCalloutDraft()
    d = calloutDraftPlace(d, { x: 0.1, y: 0.1 })
    expect(d.anchor).toEqual({ x: 0.1, y: 0.1 })
    expect(isCalloutCommittable(d)).toBe(false)
    d = calloutDraftPlace(d, { x: 0.4, y: 0.4 })
    d = calloutDraftMove(d, { x: 0.7, y: 0.5 })
    expect(isCalloutCommittable(d)).toBe(true)

    const committed = commitCallout(d, { text: 'CL-03' })!
    expect(committed.rings[0]).toEqual(rectRing({ x: 0.4, y: 0.4 }, { x: 0.7, y: 0.5 }))
    expect(committed.rings[1]).toEqual([{ x: 0.1, y: 0.1 }])
    expect(committed.content.text).toBe('CL-03')
    expect(committed.content.opacity).toBe(CALLOUT_OPACITY)
  })

  it('backs out the box, then the anchor', () => {
    let d = calloutDraftPlace(emptyCalloutDraft(), { x: 0.1, y: 0.1 })
    d = calloutDraftPlace(d, { x: 0.4, y: 0.4 })
    d = calloutDraftBack(d)
    expect(d.box.start).toBeNull()
    expect(d.anchor).not.toBeNull()
    d = calloutDraftBack(d)
    expect(d.anchor).toBeNull()
  })

  it('refuses a callout with no box', () => {
    const d = calloutDraftPlace(emptyCalloutDraft(), { x: 0.1, y: 0.1 })
    expect(commitCallout(d)).toBeNull()
  })
})

describe('highlight hit-testing', () => {
  const m = highlight('h')

  it('follows the hit.ts precedence: vertex, edge, interior', () => {
    expect(hitTestHighlight(200, 200, [m], view, W, H))
      .toEqual({ markupId: 'h', part: 'vertex', index: 0, ring: 0 })
    expect(hitTestHighlight(350, 200, [m], view, W, H))
      .toEqual({ markupId: 'h', part: 'edge', index: 0, ring: 0 })
    expect(hitTestHighlight(350, 250, [m], view, W, H))
      .toEqual({ markupId: 'h', part: 'inside', index: -1, ring: 0 })
    expect(hitTestHighlight(900, 900, [m], view, W, H)).toBeNull()
  })

  it('tests every quad a multi-line highlight carries', () => {
    const multi = highlight('h', [
      rectRing({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.24 }),
      rectRing({ x: 0.2, y: 0.26 }, { x: 0.4, y: 0.3 }),
    ])
    const hit = hitTestHighlight(300, 280, [multi], view, W, H)
    expect(hit).toEqual({ markupId: 'h', part: 'inside', index: -1, ring: 1 })
  })

  it('prefers the topmost markup', () => {
    expect(hitTestHighlight(350, 250, [m, highlight('top')], view, W, H)?.markupId).toBe('top')
  })
})

describe('callout hit-testing', () => {
  const m = callout('c')

  it('gives the anchor priority — it is small and lives outside the box', () => {
    expect(hitTestCallout(100, 100, [m], view, W, H))
      .toEqual({ markupId: 'c', part: 'anchor', index: 0, ring: 1 })
  })

  it('distinguishes a knee from the anchor', () => {
    const dogleg = callout('c')
    dogleg.rings[1] = [{ x: 0.1, y: 0.1 }, { x: 0.1, y: 0.45 }]
    expect(hitTestCallout(100, 450, [dogleg], view, W, H))
      .toEqual({ markupId: 'c', part: 'knee', index: 1, ring: 1 })
  })

  it('hits the box vertex, edge and interior in that order', () => {
    expect(hitTestCallout(400, 400, [m], view, W, H))
      .toEqual({ markupId: 'c', part: 'vertex', index: 0, ring: 0 })
    expect(hitTestCallout(550, 400, [m], view, W, H))
      .toEqual({ markupId: 'c', part: 'edge', index: 0, ring: 0 })
    expect(hitTestCallout(550, 450, [m], view, W, H))
      .toEqual({ markupId: 'c', part: 'inside', index: -1, ring: 0 })
  })

  it('hits the leader line itself, reported on ring 1', () => {
    // midway along the leader from (100,100) to the box corner
    const path = calloutLeaderScreenPath(m, view, W, H)
    const mid = {
      x: (path[0]!.x + path[1]!.x) / 2,
      y: (path[0]!.y + path[1]!.y) / 2,
    }
    expect(hitTestCallout(mid.x, mid.y, [m], view, W, H))
      .toEqual({ markupId: 'c', part: 'edge', index: 0, ring: 1 })
  })

  it('misses cleanly', () => {
    expect(hitTestCallout(900, 900, [m], view, W, H)).toBeNull()
  })
})

describe('text layout', () => {
  it('wraps greedily and keeps explicit newlines', () => {
    const ctx = recordingContext().ctx
    // 6px per char in the recorder: 60px fits 10 characters
    expect(wrapText(ctx, 'aaa bbb ccc ddd', 60)).toEqual(['aaa bbb', 'ccc ddd'])
    expect(wrapText(ctx, 'one\ntwo', 600)).toEqual(['one', 'two'])
    expect(wrapText(ctx, 'one\n\ntwo', 600)).toEqual(['one', '', 'two'])
  })

  it('never drops a word that is wider than the box', () => {
    const ctx = recordingContext().ctx
    expect(wrapText(ctx, 'supercalifragilistic', 12)).toEqual(['supercalifragilistic'])
  })

  it('grows the box to fit the text and never shrinks it', () => {
    const rc = recordingContext()
    // a deliberately short box: 300px wide, 10px tall, against text that
    // wraps to several 12.5px lines
    const m = callout('c', { x: 0.1, y: 0.1 }, [{ x: 0.4, y: 0.4 }, { x: 0.7, y: 0.41 }],
      'a very long callout that will not fit on one line at this width')
    const grown = fitCalloutBox(rc.ctx, m, view, W, H)!
    const before = ringBounds(m.rings[0]!)!
    const after = ringBounds(grown)!
    expect(after.left).toBe(before.left)
    expect(after.top).toBe(before.top)
    expect(after.right).toBeGreaterThanOrEqual(before.right)
    expect(after.bottom).toBeGreaterThan(before.bottom)
  })

  it('leaves a roomy box alone', () => {
    const rc = recordingContext()
    const m = callout('c', { x: 0.1, y: 0.1 }, [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }], 'hi')
    expect(fitCalloutBox(rc.ctx, m, view, W, H)).toEqual(m.rings[0])
  })
})

describe('rendering', () => {
  it('fills every quad of a highlight at its opacity', () => {
    const rc = recordingContext()
    const multi = highlight('h', [
      rectRing({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.24 }),
      rectRing({ x: 0.2, y: 0.26 }, { x: 0.4, y: 0.3 }),
    ])
    drawHighlight(rc.ctx, multi, view, W, H, { color: '#123456' })
    expect(rc.calls.filter((c) => c.name === 'fill').length).toBe(2)
    expect((rc.ctx as unknown as { fillStyle: string }).fillStyle).toBe('#123456')
  })

  it('lets the content colour override the scope colour', () => {
    const rc = recordingContext()
    const m = highlight('h')
    m.content.color = '#abcdef'
    drawHighlight(rc.ctx, m, view, W, H, { color: '#123456' })
    expect((rc.ctx as unknown as { fillStyle: string }).fillStyle).toBe('#abcdef')
  })

  it('defaults to source-over, because the overlay has no raster to multiply with', () => {
    const rc = recordingContext()
    drawHighlight(rc.ctx, highlight('h'), view, W, H)
    expect((rc.ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation)
      .toBe('source-over')

    const blended = recordingContext()
    drawHighlight(blended.ctx, highlight('h'), view, W, H, { blend: 'multiply' })
    expect((blended.ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation)
      .toBe('multiply')
  })

  it('skips a degenerate quad instead of drawing a sliver', () => {
    const rc = recordingContext()
    drawHighlight(rc.ctx, highlight('h', [[{ x: 0.1, y: 0.1 }]]), view, W, H)
    expect(rc.calls.filter((c) => c.name === 'fill').length).toBe(0)
  })

  it('draws a callout leader, box and wrapped text', () => {
    const rc = recordingContext()
    drawCallout(rc.ctx, callout('c'), view, W, H, { color: '#2d9cdb' })
    expect(rc.calls.some((c) => c.name === 'stroke')).toBe(true)
    expect(rc.text).toEqual(['CL-03 typ.'])
  })

  it('draws an empty callout without text', () => {
    const rc = recordingContext()
    drawCallout(rc.ctx, callout('c', undefined, undefined, ''), view, W, H)
    expect(rc.text).toEqual([])
  })

  it('draws nothing for a callout with no box', () => {
    const rc = recordingContext()
    const m = callout('c')
    m.rings = [[]]
    drawCallout(rc.ctx, m, view, W, H)
    expect(rc.calls.length).toBe(0)
  })

  it('leaves the context state balanced', () => {
    const draws: Array<(ctx: CanvasRenderingContext2D) => void> = [
      (ctx) => drawHighlight(ctx, highlight('h'), view, W, H),
      (ctx) => drawCallout(ctx, callout('c'), view, W, H),
    ]
    for (const draw of draws) {
      const rc = recordingContext()
      draw(rc.ctx)
      expect(rc.calls.filter((c) => c.name === 'save').length)
        .toBe(rc.calls.filter((c) => c.name === 'restore').length)
    }
  })

  it('draws the in-progress rectangle and callout', () => {
    const rect = recordingContext()
    let d = rectDraftPlace(emptyRectDraft(), { x: 0.2, y: 0.2 })
    d = rectDraftMove(d, { x: 0.5, y: 0.5 })
    drawRectDraft(rect.ctx, d, view, W, H)
    expect(rect.calls.some((c) => c.name === 'fill')).toBe(true)

    const empty = recordingContext()
    drawRectDraft(empty.ctx, emptyRectDraft(), view, W, H)
    expect(empty.calls.length).toBe(0)

    const co = recordingContext()
    let c = calloutDraftPlace(emptyCalloutDraft(), { x: 0.1, y: 0.1 })
    c = calloutDraftPlace(c, { x: 0.4, y: 0.4 })
    c = calloutDraftMove(c, { x: 0.7, y: 0.5 })
    drawCalloutDraft(co.ctx, c, view, W, H)
    expect(co.calls.some((c2) => c2.name === 'stroke')).toBe(true)

    const noAnchor = recordingContext()
    drawCalloutDraft(noAnchor.ctx, emptyCalloutDraft(), view, W, H)
    expect(noAnchor.calls.length).toBe(0)
  })
})
