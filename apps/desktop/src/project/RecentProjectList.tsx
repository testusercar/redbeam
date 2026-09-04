/**
 * The recent-projects list.
 *
 * Self-contained: every input is a prop and every outcome is a callback. It
 * holds exactly two pieces of state — the filter text and whether the list is
 * expanded — because both are about this widget and nothing else needs them.
 *
 * Sized for both ends of the range it will actually see. With zero projects it
 * says so in one line. With two hundred it shows a filter box and renders the
 * newest {@link INITIAL_VISIBLE} until asked for the rest, so a first paint
 * never costs two hundred rows.
 */
import { useMemo, useState } from 'react'
import {
  FILTER_THRESHOLD,
  INITIAL_VISIBLE,
  filterRecents,
  formatLastOpened,
  shortenPath,
} from './recents.js'
import type { RecentProject } from './types.js'

export interface RecentProjectListProps {
  projects: RecentProject[]
  /** A row was activated. */
  onOpen: (project: RecentProject) => void
  /** Omit to hide the per-row remove control entirely. */
  onForget?: (project: RecentProject) => void
  /** Path of the project currently being opened; its row shows as busy. */
  busyPath?: string | null
  /** Shown when there are no projects at all. */
  emptyMessage?: string
  /** Show the filter box above this many entries. Defaults to 8. */
  filterThreshold?: number
  /** Rows before "show all". Defaults to 40. */
  initialVisible?: number
  /** Injected so a render is deterministic. Defaults to `Date.now()`. */
  now?: number
}

export function RecentProjectList({
  projects,
  onOpen,
  onForget,
  busyPath = null,
  emptyMessage = 'No projects opened yet.',
  filterThreshold = FILTER_THRESHOLD,
  initialVisible = INITIAL_VISIBLE,
  now,
}: RecentProjectListProps) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const timestamp = now ?? Date.now()

  const matched = useMemo(() => filterRecents(projects, query), [projects, query])
  const visible = expanded ? matched : matched.slice(0, initialVisible)
  const hidden = matched.length - visible.length

  if (projects.length === 0) {
    return (
      <div className="row muted" data-testid="recents-empty">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div data-testid="recents">
      {projects.length > filterThreshold && (
        <div className="row">
          <input
            className="grow"
            type="search"
            value={query}
            placeholder={`Filter ${projects.length} projects`}
            aria-label="Filter recent projects"
            onChange={(e) => {
              setQuery(e.target.value)
              setExpanded(false)
            }}
            style={inputStyle}
          />
        </div>
      )}

      {matched.length === 0 && (
        <div className="row muted">No project matches “{query.trim()}”.</div>
      )}

      <div className="scrolllist">
        {visible.map((project) => {
          const busy = busyPath !== null && busyPath === project.path
          return (
            <div className="row" key={project.path} title={project.path}>
              <button
                type="button"
                className="grow"
                style={rowButtonStyle}
                disabled={busy}
                onClick={() => onOpen(project)}
              >
                <span style={{ display: 'block' }}>
                  {project.name}
                  {project.missing && (
                    <span className="warn" style={{ marginLeft: 6 }}>
                      missing
                    </span>
                  )}
                </span>
                <span className="muted mono" style={{ display: 'block' }}>
                  {shortenPath(project.path)}
                </span>
              </button>
              <span className="muted" style={{ flex: 'none' }}>
                {busy ? 'opening…' : formatLastOpened(project.lastOpenedAt, timestamp)}
              </span>
              {onForget && (
                <button
                  type="button"
                  className="link"
                  title="Remove from this list. The project folder is not touched."
                  onClick={() => onForget(project)}
                >
                  forget
                </button>
              )}
            </div>
          )
        })}
      </div>

      {hidden > 0 && (
        <div className="row">
          <button type="button" className="link" onClick={() => setExpanded(true)}>
            Show {hidden} more
          </button>
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--ads-inset)',
  color: 'var(--ads-ink)',
  border: '1px solid var(--ads-line)',
  borderRadius: 'var(--ads-radius-s)',
  padding: 'var(--ads-sp-1) var(--ads-sp-2)',
  font: 'inherit',
  minWidth: 0,
}

const rowButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  padding: 0,
  minWidth: 0,
  overflow: 'hidden',
}
