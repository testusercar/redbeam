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
 * The same card is what the launch check fills in. Opening Settings is not
 * what starts the check; pressing the button is what downloads.
 */
import { Glyph, Info } from '../shell/icons.js'
import { performUpdateAction, useUpdateState } from './session.js'
import {
  APP_VERSION, updateAction, updateMessage, updateNeedsAttention,
} from './updates.js'

const ACTION_LABEL = {
  check: 'Check for updates',
  install: 'Download and install',
  restart: 'Restart now',
} as const

export function UpdateRow({ desktop }: { desktop: boolean }) {
  const state = useUpdateState(desktop)

  const run = () => {
    const action = updateAction(state)
    if (action === null || !desktop) return
    void performUpdateAction(action)
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
        <button className="act" onClick={run}>
          {ACTION_LABEL[action]}
        </button>
      )}
    </div>
  )
}
