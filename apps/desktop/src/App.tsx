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
import { ProjectStartScreen, useProject, type RecentProject } from './project/index.js'
import { NestingChoice } from './project/NestingChoice.js'
import { getWindowRole, isTauri, openProjectWindow } from './tauri/window.js'
import { useWindowControls } from './tauri/useWindowControls.js'
import Workspace from './Workspace.js'
import { WindowControls } from './shell/Shell.js'
import { ShellHarness } from './shell/ShellHarness.js'
import { ErrorBoundary } from './ErrorBoundary.js'
import { SettingsStore, browserStorage } from './settings/store.js'
import { visibleRecents } from './project/recents.js'
import { UpdateOffer } from './update/UpdateOffer.js'

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
        // Through `project.open`, the same road the picker takes. A folder
        // inside an existing project asks whether to open the parent or the
        // folder itself before anything opens a database.
        if (typeof path === 'string' && path.length > 0) void project.open(path)
      })
      if (cancelled) un()
      else stop = un
    })()
    return () => { cancelled = true; stop?.() }
  }, [project.open])

  /**
   * Reopen the last project on launch — when asked to.
   *
   * This reopened the last project unconditionally, on the reasoning that the
   * start screen "is not a toll gate on every start". Kenneth's first bug of
   * the 2026-09-10 review was exactly that toll gate's absence: the app opens
   * on whatever job was open last, and an estimator with six bids on the go
   * wants to be asked. So the start screen is the default and the old
   * behaviour is a setting, `general.restoreProjectWindows`, off unless
   * turned on. The last project is the first row of the start screen either
   * way.
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
    if (!SettingsStore.open(browserStorage()).bool('general.restoreProjectWindows')) return
    const last = project.recents.find((p) => !p.missing)
    if (last !== undefined) void project.openRecent(last)
  }, [project, identity.role, openPath])
  /*
   * The lists show the newest N, less the expired, from Settings › General.
   * Re-read whenever the list or the open project changes: the panel that
   * changes these lives inside the project, and leaving it is the moment the
   * start screen is next seen.
   */
  const shownRecents = useMemo(() => {
    const store = SettingsStore.open(browserStorage())
    return visibleRecents(project.recents, store.int('general.recentProjectLimit'), store.str('general.recentExpiry'))
  }, [project.recents, openPath])

  /*
   * A window opened FOR a project opens that project, whatever its role.
   *
   * This was gated on `role === 'context'`, so a context window inherited its
   * project and a second PROJECT window silently did not: the id sat unread in
   * its own URL while the reopen-on-launch path opened the most recent project
   * over the top of it. Both kinds of window are handed a project the same
   * way; only the picker differs, and neither of them should see one here.
   */
  const openedFromUrl = useRef(false)
  useEffect(() => {
    if (openedFromUrl.current) return
    if (identity.projectId === null || openPath !== null) return
    openedFromUrl.current = true
    // A context window is a second view of a project already chosen. A project
    // window handed a folder still asks when that folder sits inside another.
    if (identity.role === 'context') void project.open(identity.projectId, { own: true })
    else void project.open(identity.projectId)
  }, [identity.projectId, identity.role, openPath, project.open])

  /**
   * QUICK VIEW: a drawing open with no project behind it.
   *
   * Aaron, 2026-09-18: opening a drawing set "should not create a project
   * instantly. It should just open the file for quick viewing. If any markup
   * actions need to be taken it should prompt the user to select the file's
   * project folder first." So a picked or dropped PDF that no job already
   * holds opens here, in memory; one that a job holds opens that job.
   */
  const [quick, setQuick] = useState<{ folder: string; file: string; relativePath: string } | null>(null)
  /** The document to open first once a project comes up — the drawing that was just viewed or picked. */
  const [firstDocument, setFirstDocument] = useState<string | null>(null)

  const closeProject = useCallback(() => {
    setOpenPath(null)
    setQuick(null)
    setFirstDocument(null)
    project.close()
  }, [project])

  /** A drawing, picked or dropped: the job that holds it, or quick view. */
  const showDrawing = useCallback((pick: { path: string | null; project: { path: string; hasDatabase: boolean } | null; relativePath: string | null }) => {
    if (pick.path === null) return
    if (pick.project !== null && pick.project.hasDatabase && pick.relativePath !== null) {
      setFirstDocument(pick.relativePath)
      void project.open(pick.project.path)
      return
    }
    const cut = Math.max(pick.path.lastIndexOf('\\'), pick.path.lastIndexOf('/'))
    const folder = pick.path.slice(0, cut)
    const name = pick.path.slice(cut + 1)
    setQuick({ folder, file: pick.path, relativePath: name })
  }, [project])

  const viewDrawing = useCallback(() => {
    void project.viewDrawing().then((pick) => { if (pick !== null) showDrawing(pick) })
  }, [project, showDrawing])

  /** A dropped path: a PDF is viewed, a folder is opened as a job. */
  const dropPath = useCallback((path: string) => {
    if (/\.pdf$/i.test(path)) { void project.locateFile(path).then((pick) => { if (pick !== null) showDrawing(pick) }); return }
    void project.open(path, { create: false })
  }, [project, showDrawing])

  /**
   * Quick view's way out: the drawing's project folder. It has to contain the
   * drawing — a project cannot hold a file outside itself — and then the job
   * opens on that drawing, created if the folder had no database yet.
   */
  const adoptProject = useCallback(() => {
    if (quick === null) return
    void (async () => {
      const outcome = await project.browse()
      if (outcome.path === null) return
      const folder = outcome.path.replace(/[\\/]+$/, '')
      const norm = (p: string) => p.replace(/\//g, '\\').toLowerCase()
      if (!norm(quick.file).startsWith(`${norm(folder)}\\`)) {
        setQuickNote(`${folder} does not contain this drawing. Choose the folder the drawing is in, or one above it.`)
        return
      }
      const rel = quick.file.slice(folder.length + 1).replace(/\\/g, '/')
      setFirstDocument(rel)
      await project.open(folder, { create: true })
      setQuick(null)
    })()
  }, [project, quick])
  const [quickNote, setQuickNote] = useState<string | null>(null)

  /**
   * A window asked to view a file from outside — `?view=<path>` in its URL,
   * the road a "redbeam://open" link or a shell association will take. The
   * same road a drop takes, so it lands in a job or in quick view alike.
   */
  const viewedFromUrl = useRef(false)
  useEffect(() => {
    if (viewedFromUrl.current || !project.desktop) return
    const wanted = new URLSearchParams(location.search).get('view')
    if (wanted === null || wanted === '') return
    viewedFromUrl.current = true
    dropPath(wanted)
  }, [project.desktop, dropPath])

  /** A recent job that moved: pick where it went, open it there, and forget the stale entry. */
  const locateRecent = useCallback((recent: RecentProject) => {
    void (async () => {
      const outcome = await project.browse()
      if (outcome.path === null) return
      await project.open(outcome.path)
      void project.forget(recent)
    })()
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

  const nestingDialog = project.nesting === null ? null : (
    <NestingChoice
      parentName={project.nesting.parentName}
      onParent={() => project.chooseNesting('parent')}
      onOwn={() => project.chooseNesting('own')}
      onCancel={project.dismissNesting}
    />
  )

  if (openPath || quick !== null) {
    const path = openPath ?? quick!.folder
    // Keyed on the path so switching projects tears the workspace down rather
    // than leaving one project's markups in another's state.
    return (
      <>
        {controls}
        {nestingDialog}
        {/*
          Keyed on the path as well, so closing a broken project and opening
          another gets a fresh boundary rather than the old error.
        */}
        <ErrorBoundary key={`boundary-${openPath ?? `view:${quick?.file}`}`} onCloseProject={closeProject}>
          <Workspace
            key={openPath ?? `view:${quick?.file}`}
            projectPath={path}
            onCloseProject={closeProject}
            recentProjects={shownRecents}
            onOpenProject={openProjectElsewhere}
            {...(project.desktop && openPath ? { onBrowseProject: browseForProject, onRevealProject: () => void project.reveal(openPath) } : {})}
            onRenameProject={(name) => {
              const mine = project.recents.find((r) => r.path === openPath)
              if (mine !== undefined) void project.rename(mine, name)
            }}
            onRecentsChanged={project.refreshRecents}
            initialDocumentPath={openPath ? (firstDocument ?? identity.documentPath) : quick!.relativePath}
            {...(openPath === null && quick !== null
              ? { quickView: { file: quick.file, relativePath: quick.relativePath, onAdopt: adoptProject } }
              : {})}
          />
        </ErrorBoundary>
        <UpdateOffer desktop={isTauri()} />
      </>
    )
  }

  return (
    <>
    {controls}
    {nestingDialog}
    <ProjectStartScreen
      recents={shownRecents}
      onOpenPath={(path, options) => project.open(path, options)}
      onOpenRecent={(p) => void project.openRecent(p)}
      onOpenRecentElsewhere={(p) => openProjectElsewhere(p.path)}
      onForgetRecent={(p) => void project.forget(p)}
      onRenameRecent={(p, name) => void project.rename(p, name)}
      {...(project.desktop
        ? {
            onRemoveData: (p: RecentProject) => void project.removeData(p),
            onRevealRecent: (p: RecentProject) => void project.reveal(p.path),
            onLocateRecent: locateRecent,
            onViewDrawing: viewDrawing,
            onDropPath: dropPath,
          }
        : {})}
      // exactOptionalPropertyTypes: an optional prop must be absent, not
      // explicitly undefined — so this is spread in rather than passed as null.
      {...(project.desktop ? { onBrowse: project.browse } : {})}
      busy={project.busy}
      busyPath={project.busyPath}
      error={quickNote ?? project.error}
      notice={
        project.desktop
          ? null
          : 'Running in a browser, so there are no file dialogs — type a folder ' +
            'path. Full-text search and multi-window are desktop-only.'
      }
    />
    <UpdateOffer desktop={isTauri()} />
    </>
  )
}
