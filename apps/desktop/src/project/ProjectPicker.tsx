/**
 * Choose a project folder.
 *
 * Two ways in, and the second one is the reason this component is not simply a
 * button: the native folder dialog is not available everywhere. In a plain
 * browser tab there is no dialog at all, and on the desktop it exists only once
 * the dialog plugin is compiled in. Rather than break, the picker falls back to
 * a path field and says why — which also makes it the only path that works over
 * a remote session or in a screenshot test.
 *
 * Self-contained: the only state it owns is the text in its own input.
 */
import { useEffect, useState } from 'react'
import { isPlausibleProjectPath, projectPathProblem } from './recents.js'
import type { PickOutcome } from './types.js'

export interface ProjectPickerProps {
  /**
   * Open the native folder dialog. Resolves with the chosen path, with
   * `path: null` when cancelled, or with `supported: false` when this build
   * has no dialog — in which case the picker hides the Browse button and shows
   * the reason once.
   *
   * Omit it entirely to render the path field only.
   */
  onBrowse?: () => Promise<PickOutcome>
  /** Open a project at this path. Rejecting shows `error`; it is not swallowed. */
  onOpen: (path: string, options: { create: boolean }) => void | Promise<void>
  /** Offer "Create folder" alongside Open. Defaults to true. */
  allowCreate?: boolean
  /** Prefill — typically the most recent project's path. */
  defaultPath?: string
  /** Disables the controls while an open is in flight. */
  busy?: boolean
  /** Rendered under the controls. Owned by the caller, not by this component. */
  error?: string | null
  heading?: string
}

export function ProjectPicker({
  onBrowse,
  onOpen,
  allowCreate = true,
  defaultPath = '',
  busy = false,
  error = null,
  heading = 'Open a project',
}: ProjectPickerProps) {
  const [path, setPath] = useState(defaultPath)
  const [dialogUnavailable, setDialogUnavailable] = useState<string | null>(null)

  // A late-arriving default (recents load after first paint) should fill an
  // untouched field, but must never overwrite something already typed.
  useEffect(() => {
    setPath((current) => (current === '' ? defaultPath : current))
  }, [defaultPath])

  const trimmed = path.trim()
  const problem = projectPathProblem(path)
  const canSubmit = !busy && isPlausibleProjectPath(path)
  const canBrowse = onBrowse !== undefined && dialogUnavailable === null

  async function browse() {
    if (!onBrowse) return
    const outcome = await onBrowse()
    if (!outcome.supported) {
      setDialogUnavailable(outcome.reason ?? 'no folder dialog is available in this build')
      return
    }
    if (outcome.path !== null) setPath(outcome.path)
  }

  function submit(create: boolean) {
    if (!canSubmit) return
    void onOpen(trimmed, { create })
  }

  return (
    <section data-testid="project-picker">
      <h4>{heading}</h4>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input
          className="grow"
          value={path}
          disabled={busy}
          placeholder="C:\Jobs\260415 — REDBEAM"
          aria-label="Project folder"
          spellCheck={false}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit(false)
            }
          }}
          style={inputStyle}
        />
        {canBrowse && (
          <button type="button" disabled={busy} onClick={() => void browse()} style={buttonStyle}>
            Browse…
          </button>
        )}
      </div>

      <div className="row" style={{ gap: 6 }}>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => submit(false)}
          style={{ ...buttonStyle, ...primaryStyle, opacity: canSubmit ? 1 : 0.4 }}
        >
          {busy ? 'Opening…' : 'Open'}
        </button>
        {allowCreate && (
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => submit(true)}
            title="Create the folder if it does not exist, then open it"
            style={{ ...buttonStyle, opacity: canSubmit ? 1 : 0.4 }}
          >
            Create &amp; open
          </button>
        )}
      </div>

      {problem !== null && <div className="row muted">{problem}</div>}
      {dialogUnavailable !== null && (
        <div className="row muted" data-testid="dialog-unavailable">
          {dialogUnavailable}
        </div>
      )}
      {error !== null && error !== '' && (
        <div className="row err" data-testid="project-error">
          {error}
        </div>
      )}

      <div className="row muted">
        A project is a folder. REDBEAM writes one <span className="mono">redbeam.db</span> inside
        it and never modifies the drawings.
      </div>
    </section>
  )
}

/*
 * Inline styles, but every value is a token.
 *
 * These were six hardcoded hex codes from the pre-system palette, which is how
 * the project picker kept rendering the old blue accent inside a Warm Graphite
 * app long after every stylesheet had been converted — a colour that lives in
 * a TSX file is invisible to a grep of the CSS.
 */
const inputStyle: React.CSSProperties = {
  background: 'var(--ads-inset)',
  color: 'var(--ads-ink)',
  border: '1px solid var(--ads-line)',
  borderRadius: 'var(--ads-radius-s)',
  padding: 'var(--ads-sp-2) var(--ads-sp-3)',
  font: 'inherit',
  minWidth: 0,
}

const buttonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ads-ink-2)',
  border: '1px solid var(--ads-line-2)',
  borderRadius: 'var(--ads-radius-s)',
  padding: 'var(--ads-sp-2) var(--ads-sp-3)',
  font: 'inherit',
  cursor: 'pointer',
  flex: 'none',
}

/* standards/02: the primary action is an ink fill. There is no accent hue. */
const primaryStyle: React.CSSProperties = {
  background: 'var(--ads-accent)',
  borderColor: 'var(--ads-accent)',
  color: 'var(--ads-accent-ink)',
}
