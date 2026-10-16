/**
 * The same update row as Settings, shown when there is something to do.
 *
 * It is not a dialog and it does not install by itself. Settings covers it
 * (the settings view sits above this), and that page has the same row, fed
 * by the same check. While an update is available the row is also here, so
 * a person does not have to open Settings to be offered it.
 */
import { UpdateRow } from './UpdateRow.js'
import { useUpdateState } from './session.js'
import '../settings/settings.css'

export function UpdateOffer({ desktop }: { desktop: boolean }) {
  const state = useUpdateState(desktop)
  if (!desktop) return null
  if (state.kind !== 'available' && state.kind !== 'downloading' && state.kind !== 'ready') {
    return null
  }
  return (
    <div className="update-offer" role="region" aria-label="Application update">
      <UpdateRow desktop={desktop} />
    </div>
  )
}
