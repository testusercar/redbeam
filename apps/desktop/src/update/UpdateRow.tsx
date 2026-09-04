/**
 * The updates card in Settings (plan TH.7).
 *
 * Small on purpose. The interesting decisions are in `updates.ts` and the ones
 * that matter are about what it REFUSES to say — see the note there about
 * "you're up to date" being the most dangerous sentence a broken updater can
 * produce.
 *
 * It sits under "This copy" with the problem reports, not among the
 * preferences: there is nothing to set, and a row that cannot be changed does
 * not belong among rows that can.
 *
 * The Tauri calls are dynamically imported so this component works in the
 * browser harness, where the updater plugin does not exist. A static import
 * would take the whole settings page down outside the desktop build.
 */
import { useState } from 'react'
import { Glyph, Info } from '../shell/icons.js'
import {
  APP_VERSION, UPDATES_CONFIGURED, updateAction, updateMessage, updateNeedsAttention,
  type UpdateState,
} from './updates.js'

const ACTION_LABEL = {
  check: 'Check for updates',
  install: 'Download and install',
  restart: 'Restart now',
} as const

export function UpdateRow({ desktop }: { desktop: boolean }) {
  const [state, setState] = useState<UpdateState>(
    UPDATES_CONFIGURED ? { kind: 'idle' } : { kind: 'unconfigured' },
  )

  const run = async () => {
    const action = updateAction(state)
    if (action === null || !desktop) return

    if (action === 'restart') {
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
      return
    }

    if (action === 'install' && state.kind === 'available') {
      setState({ kind: 'downloading', percent: null })
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const update = await check()
        if (update === null) { setState({ kind: 'current' }); return }
        let total = 0
        let got = 0
        await update.downloadAndInstall((event) => {
          // The manifest may not carry a length. `updateMessage` shows no
          // percentage rather than a stuck 0%.
          if (event.event === 'Started') total = event.data.contentLength ?? 0
          if (event.event === 'Progress') {
            got += event.data.chunkLength
            setState({ kind: 'downloading', percent: total > 0 ? (got / total) * 100 : null })
          }
        })
        setState({ kind: 'ready', version: update.version })
      } catch (err) {
        setState({ kind: 'failed', message: message(err) })
      }
      return
    }

    setState({ kind: 'checking' })
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      setState(update === null
        ? { kind: 'current' }
        : { kind: 'available', version: update.version, notes: update.body ?? null })
    } catch (err) {
      // NOT swallowed into "up to date". A check that threw knows nothing
      // about whether an update exists.
      setState({ kind: 'failed', message: message(err) })
    }
  }

  const action = updateAction(state)

  return (
    <div className={`prefs-card${updateNeedsAttention(state) ? ' attention' : ''}`}>
      <span className="prefs-cardicon"><Glyph icon={Info} role="card" /></span>
      <div className="prefs-cardtext">
        <div className="prefs-cardtitle">REDBEAM {APP_VERSION}</div>
        <div className="prefs-cardnote">{updateMessage(state)}</div>
      </div>
      {action !== null && desktop && (
        <button className="act" onClick={() => { void run() }}>
          {ACTION_LABEL[action]}
        </button>
      )}
    </div>
  )
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)
