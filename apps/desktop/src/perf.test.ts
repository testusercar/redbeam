import { describe, it, expect } from 'vitest'
import {
  Meter, PerfRegistry, BUDGETS, WINDOW, percentile, verdict, summarize,
  WATCH_RATIO, BREACH_RATIO, type Budget,
} from './perf.js'

const B: Budget = { key: 't', label: 'Test', ms: 10, why: 'test' }

describe('percentile', () => {
  it('is nearest-rank, so it reports a duration that actually occurred', () => {
    // An interpolated p95 invents a number no frame ever took, which reads
    // wrong sitting next to "max".
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(s).toContain(percentile(s, 0.95))
    expect(percentile(s, 0.5)).toBe(5)
    expect(percentile(s, 0.95)).toBe(10)
    expect(percentile(s, 1)).toBe(10)
  })

  it('handles an empty set and a single sample', () => {
    expect(percentile([], 0.5)).toBe(0)
    expect(percentile([42], 0.95)).toBe(42)
  })
})

describe('Meter', () => {
  it('reports nothing before any sample, rather than a misleading zero', () => {
    const m = new Meter(B)
    const s = m.stats()
    expect(s.window).toBe(0)
    expect(verdict(s)).toBe('idle')
  })

  it('computes p50, p95 and max', () => {
    const m = new Meter(B)
    for (let i = 1; i <= 100; i++) m.record(i)
    const s = m.stats()
    expect(s.p50).toBe(50)
    expect(s.p95).toBe(95)
    expect(s.max).toBe(100)
    expect(s.count).toBe(100)
  })

  it('counts breaches against the budget', () => {
    const m = new Meter(B)
    for (let i = 0; i < 90; i++) m.record(5)   // under 10
    for (let i = 0; i < 10; i++) m.record(50)  // over
    const s = m.stats()
    expect(s.over).toBe(10)
    expect(s.overRatio).toBeCloseTo(0.1, 6)
  })

  it('treats a sample exactly at budget as within it', () => {
    const m = new Meter(B)
    m.record(10)
    expect(m.stats().over).toBe(0)
  })

  it('keeps a bounded window, so a long session cannot grow memory', () => {
    const m = new Meter(B)
    for (let i = 0; i < WINDOW * 3; i++) m.record(1)
    const s = m.stats()
    expect(s.window).toBe(WINDOW)
    // ...but the lifetime count is not forgotten.
    expect(s.count).toBe(WINDOW * 3)
  })

  it('forgets old samples once the window rolls', () => {
    // The point of a window: a hitch three minutes ago must stop colouring
    // the readout red once things recover.
    const m = new Meter(B)
    for (let i = 0; i < WINDOW; i++) m.record(100)
    expect(verdict(m.stats())).toBe('breach')
    for (let i = 0; i < WINDOW; i++) m.record(1)
    expect(m.stats().over).toBe(0)
    expect(verdict(m.stats())).toBe('ok')
  })

  it('drops a broken clock rather than letting it drag a percentile', () => {
    const m = new Meter(B)
    m.record(5)
    m.record(-3)
    m.record(NaN)
    m.record(Infinity)
    const s = m.stats()
    expect(s.window).toBe(1)
    expect(s.max).toBe(5)
  })

  it('resets', () => {
    const m = new Meter(B)
    for (let i = 0; i < 50; i++) m.record(1)
    m.reset()
    expect(m.stats().window).toBe(0)
    expect(m.stats().count).toBe(0)
  })
})

describe('verdict', () => {
  const withRatio = (ratio: number) => {
    const m = new Meter(B)
    const n = 100
    const over = Math.round(ratio * n)
    for (let i = 0; i < over; i++) m.record(50)
    for (let i = 0; i < n - over; i++) m.record(1)
    return m.stats()
  }

  it('does not cry wolf over a single slow sample', () => {
    // Every session has one. Colouring it red trains people to ignore red.
    expect(verdict(withRatio(0.01))).toBe('ok')
  })

  it('escalates as breaches become frequent enough to feel', () => {
    expect(verdict(withRatio(WATCH_RATIO))).toBe('watch')
    expect(verdict(withRatio(BREACH_RATIO))).toBe('breach')
    expect(verdict(withRatio(1))).toBe('breach')
  })
})

describe('PerfRegistry', () => {
  it('ships a budget for every measured operation', () => {
    const r = new PerfRegistry()
    for (const key of ['frame', 'tile', 'text', 'geometry']) {
      expect(r.stats(key), key).not.toBeNull()
    }
  })

  it('orders budgets by what actually competes with the user', () => {
    // A frame must be tighter than a tile, a tile tighter than text, and
    // geometry loosest — it runs behind the quiet gate with nobody waiting.
    expect(BUDGETS['frame']!.ms).toBeLessThan(BUDGETS['tile']!.ms)
    expect(BUDGETS['tile']!.ms).toBeLessThan(BUDGETS['text']!.ms)
    expect(BUDGETS['text']!.ms).toBeLessThan(BUDGETS['geometry']!.ms)
  })

  it('ignores an unknown key instead of throwing into a render path', () => {
    const r = new PerfRegistry()
    expect(() => r.record('nope', 5)).not.toThrow()
    expect(r.stats('nope')).toBeNull()
  })

  it('measures a block with an injected clock', () => {
    const r = new PerfRegistry()
    let t = 0
    const now = () => t
    const out = r.measure('frame', () => { t += 25; return 'done' }, now)
    expect(out).toBe('done')
    expect(r.stats('frame')!.max).toBe(25)
  })

  it('records the elapsed time even when the block throws', () => {
    // Otherwise a failing paint silently vanishes from the numbers and the
    // frame budget looks healthier than it is.
    const r = new PerfRegistry()
    let t = 0
    const now = () => t
    expect(() => r.measure('frame', () => { t += 40; throw new Error('boom') }, now)).toThrow('boom')
    expect(r.stats('frame')!.window).toBe(1)
    expect(r.stats('frame')!.max).toBe(40)
  })

  it('lists every budget with its stats', () => {
    const r = new PerfRegistry()
    r.record('frame', 8)
    const all = r.all()
    expect(all).toHaveLength(Object.keys(BUDGETS).length)
    expect(all.find((a) => a.budget.key === 'frame')!.stats.window).toBe(1)
  })
})

describe('summarize', () => {
  it('says nothing measured rather than reporting zeros', () => {
    expect(summarize(B, new Meter(B).stats())).toBe('Test —')
  })

  it('reports both percentiles and the breach rate', () => {
    const m = new Meter(B)
    for (let i = 0; i < 90; i++) m.record(4)
    for (let i = 0; i < 10; i++) m.record(40)
    const text = summarize(B, m.stats())
    expect(text).toContain('p50')
    expect(text).toContain('p95')
    expect(text).toContain('10% over 10')
  })
})
