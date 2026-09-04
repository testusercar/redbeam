/**
 * The wording is the feature.
 *
 * An updater that works is a plumbing problem. An updater that says the WRONG
 * thing when it is not working is a trap, because "you're up to date" is what
 * a healthy one says — so a dead channel reporting it would never be found.
 * These pin the distinctions that matter and would otherwise be smoothed over
 * by whoever next tidies the copy.
 */
import { describe, expect, it } from 'vitest'
import {
  APP_VERSION, UPDATES_CONFIGURED, updateAction, updateMessage, updateNeedsAttention,
  type UpdateState,
} from './updates.js'

describe('the configured flag', () => {
  it('reads the endpoint list from the config the updater itself reads', () => {
    // Not a runtime probe and not a second copy of the truth: if these ever
    // disagree, the app tells the user one thing and the updater does another.
    expect(typeof UPDATES_CONFIGURED).toBe('boolean')
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('is false while no endpoint has been chosen', () => {
    // This is the current state and it is deliberate — an endpoint that 404s
    // reads as "up to date". When one is configured this test SHOULD fail, and
    // the person configuring it should flip it rather than delete it.
    expect(UPDATES_CONFIGURED).toBe(false)
  })
})

describe('updateMessage', () => {
  it('says plainly that there is no update channel', () => {
    // The sentence this whole module exists for.
    const text = updateMessage({ kind: 'unconfigured' })
    expect(text).toMatch(/cannot check for or receive updates/)
    expect(text).toMatch(/stay on this version/)
  })

  it('never tells an unconfigured build it is up to date', () => {
    // The failure mode: a dead channel reporting the healthy sentence, so
    // nobody discovers it is dead.
    expect(updateMessage({ kind: 'unconfigured' })).not.toMatch(/latest|up to date/i)
  })

  it('never tells a FAILED check it is up to date either', () => {
    // A failed check tells you nothing about whether an update exists. Saying
    // "you are on the latest" would be a false negative that hides itself.
    const text = updateMessage({ kind: 'failed', message: 'network unreachable' })
    expect(text).not.toMatch(/latest|up to date/i)
    expect(text).toMatch(/network unreachable/)
  })

  it('distinguishes installed-and-waiting from installed', () => {
    // The update is staged, not running. Telling somebody it is "installed"
    // full stop is how they keep working in the old binary believing they are
    // in the new one — and then report a bug that was fixed last week.
    expect(updateMessage({ kind: 'ready', version: '0.2.0' }))
      .toMatch(/starts when you restart/)
  })

  it('names the version in every state that has one', () => {
    expect(updateMessage({ kind: 'available', version: '0.2.0', notes: null }))
      .toContain('0.2.0')
    expect(updateMessage({ kind: 'current' })).toContain(APP_VERSION)
  })

  it('shows progress only when it knows any', () => {
    // A content-length-less download reporting "0%" looks stuck.
    expect(updateMessage({ kind: 'downloading', percent: null })).toBe('Downloading…')
    expect(updateMessage({ kind: 'downloading', percent: 41.6 })).toBe('Downloading… 42%')
  })
})

describe('updateAction', () => {
  it('offers nothing to press when there is nowhere to look', () => {
    // A Check button that cannot succeed is worse than no button: it invites
    // somebody to conclude the channel works because pressing it did nothing
    // visible.
    expect(updateAction({ kind: 'unconfigured' })).toBeNull()
  })

  it('offers a retry after a failure rather than dead-ending', () => {
    expect(updateAction({ kind: 'failed', message: 'x' })).toBe('check')
  })

  it('offers nothing mid-flight', () => {
    expect(updateAction({ kind: 'checking' })).toBeNull()
    expect(updateAction({ kind: 'downloading', percent: 10 })).toBeNull()
  })

  it('asks for a restart once an update is staged', () => {
    expect(updateAction({ kind: 'ready', version: '0.2.0' })).toBe('restart')
  })
})

describe('updateNeedsAttention', () => {
  it('flags a build that cannot receive fixes', () => {
    // Not the user's fault and not their problem to solve, but it is a fact
    // about the copy they are bidding from.
    expect(updateNeedsAttention({ kind: 'unconfigured' })).toBe(true)
  })

  it('stays quiet when there is nothing to say', () => {
    for (const s of [
      { kind: 'idle' }, { kind: 'checking' }, { kind: 'current' },
    ] as UpdateState[]) {
      expect(updateNeedsAttention(s), s.kind).toBe(false)
    }
  })
})
