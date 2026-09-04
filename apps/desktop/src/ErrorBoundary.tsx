/**
 * The last thing between a render error and a white window.
 *
 * A desktop app that throws during render shows a blank rectangle with no menu,
 * no title bar of its own — the frame is drawn by the app too — and no way to
 * report what happened. There is no browser back button and no address bar to
 * retype. The user's only move is to kill the process.
 *
 * This was written after exactly that: a `const` referenced by the command
 * palette's list but declared further down the component put it in its temporal
 * dead zone, and the whole workspace threw before painting. Type checking
 * allowed it (the reference sits inside an arrow function, which is usually
 * deferred) and 1137 tests passed, because none of them render this component.
 * The browser found it in one reload.
 *
 * So: show what broke, offer the two things that actually recover — reload, or
 * close the project and come back to the start screen — and put the stack
 * somewhere it can be copied into a bug report.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportCrash } from './crash.js'

interface Props {
  children: ReactNode
  /** Return to the start screen. Absent in a window that has no project. */
  onCloseProject?: () => void
}

interface State {
  error: Error | null
  componentStack: string | null
  /** Where the report was written, once it has been. */
  savedTo: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: null, savedTo: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept as well as displayed: the console copy survives the user clicking
    // Reload, and is what a `tauri dev` session shows in the terminal.
    console.error('[redbeam] render failed', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
    /*
     * And onto disk (TH.8). Everything on this screen dies the moment somebody
     * presses Reload, which is the first thing anybody presses — so the copy
     * that can be sent has to exist before they do.
     */
    void reportCrash(
      'render',
      error.message,
      [error.stack ?? String(error), info.componentStack ?? '']
        .filter((x) => x !== '')
        .join('\n\n'),
    ).then((file) => { if (file !== null) this.setState({ savedTo: file }) })
  }

  override render(): ReactNode {
    const { error, componentStack, savedTo } = this.state
    if (error === null) return this.props.children

    const detail = [error.stack ?? String(error), componentStack ?? '']
      .filter((s) => s !== '')
      .join('\n\n')

    return (
      <div className="crashscreen" role="alert">
        <div className="crashcard">
          <h1>REDBEAM stopped drawing this window</h1>
          <p>
            Nothing on disk has changed — your project, its markups and its
            takeoffs are saved. This window failed to render.
          </p>
          <pre className="crashdetail selectable">{detail}</pre>
          {/* Named, not just promised: somebody being asked to send a report
              needs the path, and it survives the reload this screen invites. */}
          {savedTo !== null && (
            <p className="crashsaved selectable">A report was saved to {savedTo}</p>
          )}
          <div className="crashactions">
            <button className="primarybtn" onClick={() => location.reload()}>
              Reload the window
            </button>
            {this.props.onCloseProject !== undefined && (
              <button
                className="ghostbtn"
                onClick={() => {
                  this.setState({ error: null, componentStack: null, savedTo: null })
                  this.props.onCloseProject?.()
                }}
              >Close the project</button>
            )}
            <button
              className="ghostbtn"
              onClick={() => void navigator.clipboard?.writeText(detail)}
            >Copy the details</button>
          </div>
        </div>
      </div>
    )
  }
}
