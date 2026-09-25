/**
 * "Ready to update", above Settings.
 *
 * The block installs. A separate control opens the manifest notes first.
 * Nothing here is shown unless an update is actually available.
 */
import { useRef, useState } from 'react'
import { Glyph, Info, Refresh } from '../shell/icons.js'
import { NotesDialog } from './NotesDialog.js'
import { performUpdateAction, useUpdateState } from './session.js'
import { harnessUpdatePreview, sidebarUpdateCopy, type SidebarUpdateCopy } from './releaseNotes.js'
import type { UpdateState } from './updates.js'

export function ReadyToUpdateBlock({
  state, onInstall, onRestart, onReview,
}: {
  state: UpdateState
  onInstall: () => void
  onRestart: () => void
  onReview: () => void
}) {
  const copy = sidebarUpdateCopy(state)
  if (copy === null) return null
  return (
    <div className="sideupdate" role="group" aria-label="Ready to update">
      <button
        type="button"
        className="sideupdate-install"
        aria-label={`${copy.title}. ${copy.note}`}
        disabled={copy.action === null}
        aria-busy={copy.action === null || undefined}
        onClick={() => {
          if (copy.action === 'install') onInstall()
          else if (copy.action === 'restart') onRestart()
        }}
      >
        <Glyph icon={Refresh} role="card" />
        <UpdateCopy copy={copy} />
      </button>
      <button type="button" className="sideupdate-notes" aria-label="Review what's new" onClick={onReview}>
        <Glyph icon={Info} role="card" />
        <span className="sideupdate-noteslabel">What's new</span>
      </button>
    </div>
  )
}

function UpdateCopy({ copy }: { copy: SidebarUpdateCopy }) {
  return (
    <span className="sideupdate-copy">
      <span className="sideupdate-title">{copy.title}</span>
      <span className="sideupdate-note">{copy.note}</span>
    </span>
  )
}

export function ReadyToUpdate({ desktop }: { desktop: boolean }) {
  const live = useUpdateState(desktop)
  const preview = harnessUpdatePreview()
  const state = preview ?? live
  const remembered = useRef<{ version: string; notes: string | null } | null>(null)
  const [review, setReview] = useState(false)
  if (state.kind === 'available') remembered.current = { version: state.version, notes: state.notes }
  if (!desktop && preview === null) return null
  const copy = sidebarUpdateCopy(state)
  if (copy === null) return null

  const version = state.kind === 'available' || state.kind === 'ready'
    ? state.version
    : remembered.current?.version ?? ''
  const notes = state.kind === 'available' ? state.notes : remembered.current?.notes ?? null

  const install = () => { if (desktop) void performUpdateAction('install') }
  const restart = () => { if (desktop) void performUpdateAction('restart') }

  return (
    <>
      <ReadyToUpdateBlock state={state} onInstall={install} onRestart={restart} onReview={() => setReview(true)} />
      {review && (
        <NotesDialog
          title="What's new"
          version={version}
          notes={notes}
          confirmLabel={copy.action === 'install' ? 'Download and install' : copy.action === 'restart' ? 'Restart now' : null}
          onConfirm={() => {
            setReview(false)
            if (copy.action === 'install') install()
            else if (copy.action === 'restart') restart()
          }}
          onClose={() => setReview(false)}
        />
      )}
    </>
  )
}
