/**
 * Release notes, in one dialog.
 *
 * Used twice: before an install, from the sidebar block, and once after the
 * new version has started. The body is the manifest. The title is chosen by
 * the caller — the post-update one is fixed, "What's new in this version."
 */
import { useEffect } from 'react'
import { useReturnFocus } from '../returnFocus.js'
import { useFocusTrap } from '../shell/focusTrap.js'
import { notesBody } from './releaseNotes.js'

export function NotesDialog({
  title, version, notes, confirmLabel, onConfirm, onClose,
}: {
  title: string
  version: string
  notes: string | null
  /** Absent when the only action is to dismiss. */
  confirmLabel: string | null
  onConfirm?: () => void
  onClose: () => void
}) {
  useReturnFocus(true)
  const trap = useFocusTrap<HTMLDivElement>(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="releasenotes"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="releasenotes-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="releasenotes-title"
        ref={trap}
      >
        <h2 id="releasenotes-title">{title}</h2>
        <p className="releasenotes-version">Version {version}</p>
        <p className="releasenotes-body selectable">{notesBody(notes)}</p>
        <div className="releasenotes-actions">
          {confirmLabel !== null && onConfirm !== undefined && (
            <button type="button" className="st-btn" autoFocus onClick={onConfirm}>{confirmLabel}</button>
          )}
          <button type="button" className="st-btn subtle" autoFocus={confirmLabel === null} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
