/**
 * What the sidebar and the what's-new modal are allowed to say.
 *
 * The notes are the update manifest's. This module does not invent a
 * changelog, and it does not show the post-update modal on a launch that
 * did not just install one.
 */
import type { UpdateState } from './updates.js'

export const WHATS_NEW_SEEN_KEY = 'redbeam.update.whats-new-seen'
export const INSTALLED_NOTES_KEY = 'redbeam.update.installed-notes'

export interface InstalledNotes {
  version: string
  notes: string | null
}

/** The two keys this feature writes. Tests pass a memory map; the app uses localStorage. */
export interface NotesStore {
  get(key: string): string | null
  set(key: string, value: string): void
}

export function browserNotesStore(): NotesStore {
  return {
    get(key) {
      try { return localStorage.getItem(key) } catch { return null }
    },
    set(key, value) {
      try { localStorage.setItem(key, value) } catch { /* a private window keeps nothing */ }
    },
  }
}

/**
 * The sidebar block is for an update you can install, or one already in motion.
 *
 * Idle, up to date, checking, a failed check, and a build with no channel
 * are not an update. The block is absent for all of those.
 */
/**
 * The shell harness can show the block without an updater.
 *
 * `?harness=shell&update=available` (or `downloading`, or `ready`). A normal
 * launch never reads this. The notes in the preview are a fixture, not copy
 * the installed app shows.
 */
export function harnessUpdatePreview(): UpdateState | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('harness') !== 'shell') return null
  const mode = params.get('update')
  if (mode === 'available') {
    return {
      kind: 'available',
      version: '0.9.1',
      notes: 'The scale badge names the sheet.\nSnap no longer pulls onto hatching.',
    }
  }
  if (mode === 'downloading') return { kind: 'downloading', percent: 40 }
  if (mode === 'ready') return { kind: 'ready', version: '0.9.1' }
  return null
}

export function sidebarUpdateVisible(state: UpdateState): boolean {
  return state.kind === 'available' || state.kind === 'downloading' || state.kind === 'ready'
}

export interface SidebarUpdateCopy {
  title: string
  note: string
  action: 'install' | 'restart' | null
}

/** The words on the block. Null when the block should not be rendered. */
export function sidebarUpdateCopy(state: UpdateState): SidebarUpdateCopy | null {
  if (state.kind === 'available') {
    return {
      title: 'Ready to update',
      note: `Version ${state.version} is available to install.`,
      action: 'install',
    }
  }
  if (state.kind === 'downloading') {
    const percent = state.percent === null ? 'Downloading…' : `Downloading… ${Math.round(state.percent)}%`
    return { title: 'Ready to update', note: percent, action: null }
  }
  if (state.kind === 'ready') {
    return {
      title: 'Restart to finish',
      note: `Version ${state.version} is installed and starts when you restart REDBEAM.`,
      action: 'restart',
    }
  }
  return null
}

/** Manifest notes, or null when the release did not include any. */
export function manifestNotes(notes: string | null | undefined): string | null {
  if (notes == null) return null
  const trimmed = notes.trim()
  return trimmed === '' ? null : trimmed
}

/** What the modal body says. Blank notes stay blank of marketing. */
export function notesBody(notes: string | null | undefined): string {
  return manifestNotes(notes) ?? 'This release did not include notes.'
}

export function rememberInstalledNotes(version: string, notes: string | null, store: NotesStore): void {
  const payload: InstalledNotes = { version, notes: manifestNotes(notes) }
  store.set(INSTALLED_NOTES_KEY, JSON.stringify(payload))
}

export function readInstalledNotes(store: NotesStore): InstalledNotes | null {
  const raw = store.get(INSTALLED_NOTES_KEY)
  if (raw === null || raw === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    const version = (parsed as { version?: unknown }).version
    const notes = (parsed as { notes?: unknown }).notes
    if (typeof version !== 'string' || version === '') return null
    if (notes !== null && typeof notes !== 'string') return null
    return { version, notes }
  } catch {
    return null
  }
}

/**
 * Open "What's new in this version" once, on the launch after an install.
 *
 * The pending record is written when the installer finishes, and it names
 * the version that was installed. The next process is that version. A later
 * launch of the same version has been marked seen and stays quiet. A launch
 * that never installed through the app has no pending record.
 */
export function shouldShowInstalledWhatsNew(installedVersion: string, store: NotesStore): boolean {
  const pending = readInstalledNotes(store)
  if (pending === null || pending.version !== installedVersion) return false
  return store.get(WHATS_NEW_SEEN_KEY) !== installedVersion
}

export function markWhatsNewSeen(installedVersion: string, store: NotesStore): void {
  store.set(WHATS_NEW_SEEN_KEY, installedVersion)
}
