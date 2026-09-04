/**
 * The human estimator's numbers, and the machinery to compare against them
 * (plan 07).
 *
 * Phase 07 exists because every accuracy claim in the legacy repo is
 * self-consistency: the Qt build and this one agreeing proves only that two
 * machines share an opinion. What was missing was a number a PERSON arrived at
 * off the same drawings and was prepared to be paid against.
 *
 * That number turned out to be sitting in the project folder the whole time —
 * Maxxit's own quotation for Barclays Toronto. This file pins it, and pins the
 * comparison, so 07.2 is a matter of running a takeoff rather than of finding
 * an oracle.
 *
 * What it deliberately does NOT do is assert that the app agrees. It does not
 * yet, the takeoff is not finished, and a test that failed for that reason
 * would be measuring progress rather than correctness.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareToGroundTruth, type GroundTruth } from './groundTruth.js'

const here = dirname(fileURLToPath(import.meta.url))
const TRUTH = join(here, '..', '..', '..', 'fixtures', 'ground-truth', 'barclays-28019.json')

const truth = JSON.parse(readFileSync(TRUTH, 'utf8')) as GroundTruth

describe('the Barclays ground truth', () => {
  it('is the whole quote, not a sample of it', () => {
    // A takeoff producing a fifth scope is measuring something nobody was paid
    // for; one producing three has dropped one.
    expect(truth.scopes.map((s) => s.tag)).toEqual(['CL02', 'CL03', 'CL04', 'CL05'])
  })

  it('carries the quantities a person quoted', () => {
    const by = Object.fromEntries(truth.scopes.map((s) => [s.tag, `${s.quantity} ${s.unit}`]))
    expect(by).toEqual({
      CL02: '681 LF',
      CL03: '180 SF',
      CL04: '30 EA',
      CL05: '756 LF',
    })
  })

  it('says where it came from', () => {
    // A quantity with no provenance cannot be argued with, and this one will
    // be: it is the number the app gets measured against.
    expect(truth.source.quoteNumber).toBe('28019')
    expect(truth.source.quotedAt).toBe('2025-01-21')
    expect(truth.source.document).toBe('human_proposal.pdf')
  })
})

describe('compareToGroundTruth', () => {
  const ours = (over: Record<string, number> = {}) => ({
    CL02: 681, CL03: 180, CL04: 30, CL05: 756, ...over,
  })

  it('reports agreement as agreement', () => {
    const rows = compareToGroundTruth(truth, ours())
    expect(rows.every((r) => r.status === 'agrees')).toBe(true)
  })

  it('gives the difference as a percentage, which is what an estimator reads', () => {
    // 238.07 is what the app reported for CL03 when this was written, and it
    // is NOT an accuracy finding: the four markups behind it were drawn in
    // fourteen seconds as test boxes, not as a takeoff. It is here because it
    // is a realistic magnitude. 32% is a conversation; "58" on its own is not.
    const row = compareToGroundTruth(truth, ours({ CL03: 238.07 })).find((r) => r.tag === 'CL03')!
    expect(row.status).toBe('over')
    expect(row.percent).toBeCloseTo(32.3, 1)
  })

  it('calls a scope with no takeoff MISSING, not zero', () => {
    // Zero is a measurement. "We did not measure this" is not, and a delta
    // that showed -100% would read as the app disagreeing when it has simply
    // not been pointed at the drawing yet.
    const row = compareToGroundTruth(truth, { CL03: 180 }).find((r) => r.tag === 'CL02')!
    expect(row.status).toBe('missing')
    expect(row.ours).toBeNull()
    expect(row.percent).toBeNull()
  })

  it('reports a scope we produced that nobody quoted', () => {
    // The other direction, and the one nobody looks for: material in the
    // takeoff that was never in the bid.
    const rows = compareToGroundTruth(truth, { ...ours(), 'WP-12': 400 })
    expect(rows.find((r) => r.tag === 'WP-12')?.status).toBe('unquoted')
  })

  it('tolerates rounding, since a quote is written to the nearest unit', () => {
    // 180.4 SF quoted as 180 is agreement, not a defect. The threshold is
    // half a percent — tight enough that a real disagreement still shows.
    expect(compareToGroundTruth(truth, ours({ CL03: 180.4 })).find((r) => r.tag === 'CL03')!.status)
      .toBe('agrees')
  })

  it('orders the report worst first', () => {
    // Forty rows of agreement hide the one that is not.
    const rows = compareToGroundTruth(truth, ours({ CL03: 238.07, CL05: 760 }))
    expect(rows[0]!.tag).toBe('CL03')
  })
})
