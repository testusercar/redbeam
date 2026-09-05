/**
 * The project gate.
 *
 * A window IS a project (docs/DECISIONS.md, and the window model in
 * docs/PLAN.md). Nothing below this point runs until one is open, because the
 * database, the undo stack and every id in the workspace belong to a project —
 * there is no meaningful "no project" state to render a takeoff in.
 *
 * A context window is handed its project through the URL rather than the start
 * screen: it is a second view onto a project that is already open, so showing
 * it a picker would be wrong.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ProjectStartScreen, useProject } from './project/index.js'
import { getWindowRole, isTauri, openProjectWindow } from './tauri/window.js'
import { useWindowControls } from './tauri/useWindowControls.js'
import Workspace from './Workspace.js'
import { WindowControls } from './shell/Shell.js'
import { ShellHarness } from './shell/ShellHarness.js'
import { ErrorBoundary } from './ErrorBoundary.js'

export default function App() {
  const identity = useMemo(() => getWindowRole(), [])

  /*
   * `?harness=shell` renders the chrome against fixture data with no project,
   * no database and no PDF. It exists because the shell only assembles after a
   * project is open and a page has rendered, which makes "is this spacing
   * right" a five-minute round trip through a real 110-sheet set.
   */
  if (new URLSearchParams(location.search).get('harness') === 'shell') {
    return <ShellHarness />
  }
  const [openPath, setOpenPath] = useState<string | null>(null)

  /*
   * The window draws its own frame, so it also draws its own controls. They
   * mount here rather than inside the title bar because the start screen has no
   * title bar and a frameless window still has to be closable from it.
   */
  const win = useWindowControls()
  useEffect(() => {
    document.documentElement.toggleAttribute('data-frameless', win.frameless)
  }, [win.frameless])

  const project = useProject({
    onOpened: (info) => {
      // useProject does not touch the database — it hands us the location and
      // lets the workspace open it. If that throws, useProject leaves the
      // project closed with an error rather than claiming it is open.
      setOpenPath(info.path)
    },
  })

  /**
   * The automation bridge asks to open a project by emitting an event, and it
   * is handled HERE — the same state change the picker makes.
   *
   * The bridge deliberately does not open the store itself: that would give
   * the window one project and the database another, which is the split-brain
   * the store moved into Rust to prevent. Routing through the UI keeps one
   * path, so a bridge-opened project behaves identically to a clicked one.
   */
  useEffect(() => {
    if (!isTauri()) return
    let stop: (() => void) | undefined
    let cancelled = false
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event')
      const un = await listen<{ path?: string }>('redbeam://bridge/open-project', (e) => {
        const path = e.payload?.path
        // Through `project.open`, the same road the picker takes: it resolves
        // the folder to the outermost project root before anything opens a
        // database. Setting the path straight in opened `<folder>/redbeam.db`
        // for whatever folder was named — a second database inside a project,
        // for a folder that was never a project.
        if (typeof path === 'string' && path.length > 0) void project.open(path)
      })
      if (cancelled) un()
      else stop = un
    })()
    return () => { cancelled = true; stop?.() }
  }, [project.open])

  /**
   * Reopen the last project on launch.
   *
   * Every launch used to land on the picker, including the overwhelmingly
   * common one where you are coming back to the job you were on ten minutes
   * ago. The start screen is for the first run and for switching projects; it
   * is not a toll gate on every start.
   *
   * Only a live entry qualifies — a `missing: true` recent means the folder
   * moved or a drive is offline, and silently failing to open it would look
   * like a broken launch. Runs once: `attempted` guards against re-opening
   * after a deliberate Close Project, which would make closing impossible.
   */
  const attempted = useRef(false)
  useEffect(() => {
    if (attempted.current || identity.role === 'context') return
    /*
     * A window told which project to open never falls back to the last one.
     *
     * Without this, asking for a second project opened a window that ignored
     * the project in its own URL and reopened the most recent one instead — so
     * "open another project" produced a second window showing the project you
     * already had open, which looks exactly like the command doing nothing.
     */
    if (identity.projectId !== null) return
    if (project.loading || openPath !== null) return
    attempted.current = true
    const last = project.recents.find((p) => !p.missing)
    if (last !== undefined) void project.openRecent(last)
  }, [project, identity.role, openPath])

  /*
   * A window opened FOR a project opens that project, whatever its role.
   *
   * This was gated on `role === 'context'`, so a context window inherited its
   * project and a second PROJECT window silently did not: the id sat unread in
   * its own URL while the reopen-on-launch path opened the most recent project
   * over the top of it. Both kinds of window are handed a project the same
   * way; only the picker differs, and neither of them should see one here.
   */
  useEffect(() => {
    if (identity.projectId !== null && openPath === null) {
      setOpenPath(identity.projectId)
    }
  }, [identity.projectId, openPath])

  const closeProject = useCallback(() => {
    setOpenPath(null)
    project.close()
  }, [project])

  /**
   * Open another project in a SECOND window, leaving this one alone.
   *
   * A window is a project — its database, its undo stack and every id in the
   * workspace belong to it — so there is no in-place switch to make; "switch"
   * would mean tearing all of that down. It is also what an estimator comparing
   * two bid packages actually wants, which is both of them on screen.
   *
   * The label is the project path, so asking for a project that is already open
   * focuses that window instead of duplicating it.
   */
  const openProjectElsewhere = useCallback((path: string) => {
    void openProjectWindow(path, `project-${path}`)
  }, [])

  /** Pick a folder, then open it in a second window. */
  const browseForProject = useCallback(() => {
    void (async () => {
      const outcome = await project.browse()
      if (outcome.path !== null) openProjectElsewhere(outcome.path)
    })()
  }, [project, openProjectElsewhere])

  const controls = win.frameless
    ? (
      <WindowControls
        maximized={win.maximized}
        onMinimize={win.minimize}
        onToggleMaximize={win.toggleMaximize}
        onClose={win.close}
      />
      )
    : null

  if (openPath) {
    // Keyed on the path so switching projects tears the workspace down rather
    // than leaving one project's markups in another's state.
    return (
      <>
        {controls}
        {/*
          Keyed on the path as well, so closing a broken project and opening
          another gets a fresh boundary rather than the old error.
        */}
        <ErrorBoundary key={`boundary-${openPath}`} onCloseProject={closeProject}>
          <Workspace
            key={openPath}
            projectPath={openPath}
            onCloseProject={closeProject}
            recentProjects={project.recents}
            onOpenProject={openProjectElsewhere}
            {...(project.desktop ? { onBrowseProject: browseForProject } : {})}
            initialDocumentPath={identity.documentPath}
          />
        </ErrorBoundary>
      </>
    )
  }

  return (
    <>
    {controls}
    <ProjectStartScreen
      recents={project.recents}
      onOpenPath={(path, options) => project.open(path, options)}
      onOpenRecent={(p) => void project.openRecent(p)}
      onForgetRecent={(p) => void project.forget(p)}
      // exactOptionalPropertyTypes: an optional prop must be absent, not
      // explicitly undefined — so this is spread in rather than passed as null.
      {...(project.desktop
        ? { onBrowse: project.browse, onOpenDrawing: project.openDrawing }
        : {})}
      busy={project.busy}
      busyPath={project.busyPath}
      error={project.error}
      notice={
        project.desktop
          ? null
          : 'Running in a browser, so there are no file dialogs — type a folder ' +
            'path. Full-text search and multi-window are desktop-only.'
      }
    />
    </>
  )
}
