import { describe, expect, it } from 'vitest'
import { statusHold, statusTone } from './statusTone.js'

/**
 * The strings below are the workspace's own — each is a `setStatus` call in
 * Workspace.tsx. If a refusal is rephrased, this is where it has to stay a
 * refusal.
 */
describe('statusTone', () => {
  it.each([
    'cannot remove — a shape needs its minimum vertices',
    'cannot delete: the round still holds takeoff',
    'cannot commit C-MT-01: panel width is not set',
    'could not commit C-MT-01: disk full',
    'error: page 3 failed to render',
    'direction needs two different points',
    'that edge has no length, so it is not a direction',
    'Create an estimate first — a takeoff has to land in a bidding round',
  ])('treats a refusal as a problem: %s', (text) => {
    expect(statusTone(text)).toBe('problem')
  })

  it.each([
    'committed C-MT-01',
    'undid area',
    'redid cutout',
    'copied 3 markups',
    'calibrated: 1 pt = 0.001389 ft',
    'scale region removed',
    'updated from another window',
    'desktop store · C:/Jobs/00051',
    'orientation set for C-MT-01',
    '2 selected',
    'round deleted',
  ])('treats a result as a notice: %s', (text) => {
    expect(statusTone(text)).toBe('notice')
  })

  it('does not mistake a result that happens to contain "first" for a refusal', () => {
    expect(statusTone('copied to first round')).toBe('notice')
  })

  it('holds a problem longer than a notice', () => {
    expect(statusHold('problem')).toBeGreaterThan(statusHold('notice'))
  })
})
