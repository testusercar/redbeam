/**
 * After an install, the next launch says what changed. Once.
 */
import { useState } from 'react'
import { APP_VERSION } from './updates.js'
import { NotesDialog } from './NotesDialog.js'
import {
  browserNotesStore, markWhatsNewSeen, readInstalledNotes, shouldShowInstalledWhatsNew,
} from './releaseNotes.js'

export function InstalledWhatsNew() {
  const [store] = useState(() => browserNotesStore())
  const [open, setOpen] = useState(() => shouldShowInstalledWhatsNew(APP_VERSION, store))
  if (!open) return null
  const pending = readInstalledNotes(store)
  return (
    <NotesDialog
      title="What's new in this version."
      version={APP_VERSION}
      notes={pending?.notes ?? null}
      confirmLabel={null}
      onClose={() => {
        markWhatsNewSeen(APP_VERSION, store)
        setOpen(false)
      }}
    />
  )
}
