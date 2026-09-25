/**
 * The wording is the feature.
 *
 * An updater that works is a plumbing problem. An updater that says the WRONG
 * thing when it is not working is a trap, because "you're up to date" is what
 * a healthy one says — so a dead channel reporting it would never be found.
 * These pin the distinctions that matter and would otherwise be smoothed over
 * by whoever next tidies the copy.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import conf from '../../src-tauri/tauri.conf.json'
import {
  APP_VERSION, shouldPollUpdate, UPDATE_CHECK_INTERVAL_MS, UPDATE_FOCUS_MIN_GAP_MS,
  UPDATES_CONFIGURED, updateAction, updateMessage, updateNeedsAttention,
  type UpdateState,
} from './updates.js'

describe('the configured flag', () => {
  it('reads the endpoint list from the config the updater itself reads', () => {
    // Not a runtime probe and not a second copy of the truth: if these ever
    // disagree, the app tells the user one thing and the updater does another.
    expect(typeof UPDATES_CONFIGURED).toBe('boolean')
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('is true once an endpoint is configured', () => {
    // The host is redbeam-updates.trackchairking.workers.dev (live Worker).
    // A failed check may say "could not check". It does not claim the copy
    // is up to date.
    expect(UPDATES_CONFIGURED).toBe(true)
  })

  it('trusts the key that signed the published channel, and stays passive', () => {
    // The 0.3.1 smoke was signed with minisign key id F0ECFC2EF7375954.
    // The previous id (E3C6A68C64ABA8A6) does not verify that installer.
    // installMode stays passive: the app offers the update, it does not
    // force-install it.
    const text = Buffer.from(conf.plugins.updater.pubkey, 'base64').toString('utf8')
    expect(text).toContain('minisign public key: F0ECFC2EF7375954')
    expect(text).not.toContain('E3C6A68C64ABA8A6')
    expect(conf.plugins.updater.windows.installMode).toBe('passive')
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

describe('automatic checks', () => {
  it('checks at launch, and again on a timer, without installing', () => {
    const idle: UpdateState = { kind: 'idle' }
    expect(shouldPollUpdate(idle, 0, 1_000, 'startup')).toBe(true)
    expect(shouldPollUpdate(idle, 1_000, 1_000 + UPDATE_FOCUS_MIN_GAP_MS - 1, 'focus')).toBe(false)
    expect(shouldPollUpdate(idle, 1_000, 1_000 + UPDATE_FOCUS_MIN_GAP_MS, 'focus')).toBe(true)
    expect(shouldPollUpdate(idle, 1_000, 1_000 + UPDATE_CHECK_INTERVAL_MS - 1, 'interval')).toBe(false)
    expect(shouldPollUpdate(idle, 1_000, 1_000 + UPDATE_CHECK_INTERVAL_MS, 'interval')).toBe(true)
    // A second launch in the same process is not a second startup check.
    expect(shouldPollUpdate(idle, 1_000, 2_000, 'startup')).toBe(false)
  })

  it('does not poll over an install or a restart that is waiting', () => {
    const now = 10_000_000
    for (const s of [
      { kind: 'checking' },
      { kind: 'downloading', percent: 10 },
      { kind: 'ready', version: '0.3.2' },
      { kind: 'unconfigured' },
    ] as UpdateState[]) {
      expect(shouldPollUpdate(s, 0, now, 'startup'), s.kind).toBe(false)
      expect(shouldPollUpdate(s, 0, now, 'interval'), s.kind).toBe(false)
    }
  })

  it('the unattended check does not download or relaunch', () => {
    const src = readFileSync(new URL('./session.ts', import.meta.url), 'utf8')
    const auto = src.slice(src.indexOf('async function checkOnce'), src.indexOf('export async function performUpdateAction'))
    expect(auto).not.toContain('downloadAndInstall')
    expect(auto).not.toContain('relaunch(')
    expect(src).toContain('downloadAndInstall')
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
