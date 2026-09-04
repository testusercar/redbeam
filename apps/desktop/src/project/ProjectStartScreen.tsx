/**
 * The screen a window shows when it is not yet showing a project.
 *
 * # What was wrong with the old one
 *
 * It led with a text field and asked you to type `C:\Jobs\...` by hand. The one
 * control that would have made that unnecessary — Browse — was hidden, because
 * the native dialog sat behind a Cargo feature nothing enabled (see the note in
 * `src-tauri/src/project.rs`), so the fallback WAS the interface on every build
 * ever shipped. Under it sat the sentence "A project is a folder", which is our
 * bookkeeping presented as the first thing a user has to understand.
 *
 * Nobody is handed a project folder. They are handed a drawing set. So:
 *
 *  - **The primary action opens a PDF.** The project becomes the folder that
 *    PDF lives in, derived rather than asked for.
 *  - **Recents come second and are one click**, because after the first day
 *    that is the only route anyone uses.
 *  - **A project folder** is the third option, for reopening a job that already
 *    has a database.
 *  - **The path field is behind a disclosure.** It is the remote-session and
 *    screenshot-test path, not the front door.
 *
 * The whole screen is a `.ads` surface: archetype C proportions (600px, single
 * column, the job stated in one line), which is what this is — one decision,
 * made in bursts.
 */
import { useState } from 'react'
import { ProjectPicker } from './ProjectPicker.js'
import { RecentProjectList } from './RecentProjectList.js'
import type { DrawingPickOutcome, PickOutcome, RecentProject } from './types.js'

export interface ProjectStartScreenProps {
  recents: RecentProject[]
  onOpenPath: (path: string, options: { create: boolean }) => void | Promise<void>
  onOpenRecent: (project: RecentProject) => void
  onForgetRecent?: (project: RecentProject) => void
  onBrowse?: () => Promise<PickOutcome>
  /** Open a PDF and take its folder as the project. Desktop only. */
  onOpenDrawing?: () => Promise<DrawingPickOutcome>
  /** Path currently being opened, if any. */
  busyPath?: string | null
  busy?: boolean
  error?: string | null
  /** Shown above everything — e.g. "browser mode: data lives in IndexedDB". */
  notice?: string | null
  now?: number
}

export function ProjectStartScreen({
  recents,
  onOpenPath,
  onOpenRecent,
  onForgetRecent,
  onBrowse,
  onOpenDrawing,
  busyPath = null,
  busy = false,
  error = null,
  notice = null,
  now,
}: ProjectStartScreenProps) {
  const mostRecent = recents.find((p) => !p.missing)
  const [pathOpen, setPathOpen] = useState(false)

  // With no dialogs at all — a browser tab — the path field is not an advanced
  // option, it is the only way in, so it opens with the screen.
  const hasDialogs = onOpenDrawing !== undefined || onBrowse !== undefined
  const showPath = pathOpen || !hasDialogs

  return (
    <div className="startscreen">
      {/* No title bar on this screen, so the strip the window controls sit in
          is the only place left to grab. */}
      <div className="startdrag" data-tauri-drag-region />
      <div className="startcard">
        <header className="starthead">
          <div className="brand" aria-hidden="true">RB</div>
          <div>
            <h1>REDBEAM</h1>
            <p className="wsmuted">Quantity takeoff from construction drawings.</p>
          </div>
        </header>

        {notice !== null && notice !== '' && (
          <p className="wsmuted startnotice">{notice}</p>
        )}

        {hasDialogs && (
          <div className="startactions">
            {onOpenDrawing !== undefined && (
              <button
                type="button"
                className="primarybtn startprimary"
                disabled={busy}
                onClick={() => void onOpenDrawing()}
              >
                {busy ? 'Opening…' : 'Open a drawing set…'}
              </button>
            )}
            {onBrowse !== undefined && (
              <button
                type="button"
                className="ghostbtn"
                disabled={busy}
                onClick={() => void onBrowse().then((o) => {
                  if (o.supported && o.path !== null) void onOpenPath(o.path, { create: false })
                })}
              >
                Open a project folder…
              </button>
            )}
          </div>
        )}

        {onOpenDrawing !== undefined && (
          <p className="wsmuted">
            REDBEAM writes one <span className="mono">redbeam.db</span> beside the drawings
            and never modifies them.
          </p>
        )}

        {error !== null && error !== '' && (
          <div className="wswarn" data-testid="project-error">{error}</div>
        )}

        {recents.length > 0 && (
          <section className="wssection startrecents">
            <h3><span className="grow">Recent</span></h3>
            <RecentProjectList
              projects={recents}
              onOpen={onOpenRecent}
              {...(onForgetRecent ? { onForget: onForgetRecent } : {})}
              busyPath={busyPath}
              {...(now === undefined ? {} : { now })}
            />
          </section>
        )}

        {showPath
          ? (
            <section className="startpath">
              <ProjectPicker
                {...(onBrowse ? { onBrowse } : {})}
                onOpen={onOpenPath}
                busy={busy}
                error={null}
                heading="Open a folder by path"
                defaultPath={mostRecent?.path ?? ''}
              />
            </section>
            )
          : (
            <button type="button" className="link startdisclose" onClick={() => setPathOpen(true)}>
              Open a folder by path instead
            </button>
            )}
      </div>
    </div>
  )
}
