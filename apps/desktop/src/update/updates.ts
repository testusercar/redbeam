/**
 * Updating an installed copy (plan TH.7).
 *
 * Without this there is exactly one route from a defect to a fix on an
 * estimator's machine: email them a 95MB installer and ask them to run it.
 * That happens once, politely, and then stops happening while the fixes pile
 * up and the copy they are bidding from drifts further from the one that works.
 *
 * THE STATE THIS FILE EXISTS FOR is `unconfigured`. The updater needs an
 * endpoint serving a manifest, and REDBEAM does not have one yet — nobody has
 * decided where it lives. The tempting thing is to let a check against no
 * endpoint fail quietly and show "you're up to date", which is the most
 * dangerous sentence available: it is what a working updater says, so nobody
 * would ever find out the mechanism was dead. An app with no update channel
 * has to say that plainly.
 */
import conf from '../../src-tauri/tauri.conf.json'

/**
 * Whether an update endpoint is configured, decided at BUILD time.
 *
 * Read from the same file the Rust side reads, so the answer cannot drift from
 * what the updater will actually do. A runtime probe would have to distinguish
 * "no endpoint" from "endpoint unreachable", and those are different problems
 * with different answers.
 */
export const UPDATES_CONFIGURED: boolean =
  (conf.plugins?.updater?.endpoints?.length ?? 0) > 0

/** The version this build is, for the "you are on X" line. */
export const APP_VERSION: string = conf.version

export type UpdateState =
  /** No endpoint. The mechanism is present and has nowhere to look. */
  | { kind: 'unconfigured' }
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available', version: string, notes: string | null }
  | { kind: 'downloading', percent: number | null }
  /** Staged. The new binary is on disk and takes effect on restart. */
  | { kind: 'ready', version: string }
  | { kind: 'failed', message: string }

/**
 * What the settings row says.
 *
 * Every branch names the state rather than reassuring: "could not check" is a
 * different thing from "up to date" and an estimator deciding whether to trust
 * a number needs to know which one they are looking at.
 */
export function updateMessage(state: UpdateState): string {
  switch (state.kind) {
    case 'unconfigured':
      return 'No update channel is set up, so this copy cannot check for or '
        + 'receive updates. It will stay on this version until someone installs '
        + 'over it.'
    case 'idle': return `You are on ${APP_VERSION}.`
    case 'checking': return 'Checking…'
    case 'current': return `You are on ${APP_VERSION}, which is the latest.`
    case 'available': return `Version ${state.version} is available.`
    case 'downloading':
      return state.percent === null
        ? 'Downloading…'
        : `Downloading… ${Math.round(state.percent)}%`
    case 'ready':
      return `Version ${state.version} is installed and starts when you restart REDBEAM.`
    case 'failed':
      // NOT "you are up to date". A failed check tells you nothing about
      // whether an update exists, and saying otherwise is a false negative
      // that hides itself.
      return `Could not check for updates: ${state.message}`
  }
}

/** Whether the row should offer an action, and what it is called. */
export function updateAction(state: UpdateState): 'check' | 'install' | 'restart' | null {
  switch (state.kind) {
    case 'unconfigured': return null
    case 'idle': case 'current': case 'failed': return 'check'
    case 'available': return 'install'
    case 'ready': return 'restart'
    case 'checking': case 'downloading': return null
  }
}

/**
 * Is this state one a person should be nudged about?
 *
 * `unconfigured` deliberately IS. It is not an error the user caused and there
 * is nothing they can do about it, but a build that cannot receive fixes is a
 * fact about the copy they are bidding from.
 */
export function updateNeedsAttention(state: UpdateState): boolean {
  return state.kind === 'unconfigured'
    || state.kind === 'available'
    || state.kind === 'ready'
    || state.kind === 'failed'
}
