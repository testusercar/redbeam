/**
 * Settings: one page.
 *
 * Built to board 2 of docs/design/prompt-settings-icons-2026-09-18 (Aaron,
 * 2026-09-18). Sixteen switches do not need a navigation pane: what was a
 * category rail, a breadcrumb, a search box, a reset button and a folder
 * icon on every card is now one scrolling page of eight titled runs, a 44px
 * row per setting — the label, one line of description, the control on the
 * right — and the five layout-preview switches drawn as the family they
 * are, hanging off their parent and dimmed together while it is off.
 *
 * A changed setting shows a 2px accent bar and an inline "Default …" link,
 * the VS Code convention; "Reset all" survives in the header. The filter
 * field narrows the page to the rows that match, and the prompt's `=` mode
 * finds a setting by any word in it. About is the last run, not a page.
 *
 * Every row is still generated from the descriptor registry. A setting that
 * exists in the registry appears here, and one that does not, cannot — which
 * is what keeps validation and reset agreeing with what is on screen.
 *
 * It is a full view, mounted in the shell's `.settingsview` beneath the title
 * bar — a place you go, not a question over the work.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  CATEGORY_LABEL, SETTINGS, childrenOf, type SettingDescriptor,
} from './registry.js'
import type { SettingsStore } from './store.js'
import { useReturnFocus } from '../returnFocus.js'
import { UpdateRow } from '../update/UpdateRow.js'
import { accentReport } from '../accent.js'
import { DiagnosticsRow } from '../update/DiagnosticsRow.js'
import { APP_VERSION } from '../update/updates.js'
import { isTauri } from '../tauri/window.js'
import { useFocusTrap } from '../shell/focusTrap.js'
import { ChevronDown, ChevronLeft, ChevronUp, Glyph, Info, Reset, Search, TriangleAlert, X } from '../shell/icons.js'
import { HelpBody } from './HelpPage.js'
import './settings.css'

interface Props {
  store: SettingsStore
  onClose: () => void
  /**
   * Open scrolled to this setting's row, which flashes. From the prompt: a
   * row's Shift+Enter is "show me where it lives".
   */
  initialSettingId?: string
}

/** The page's runs: every root descriptor under its section, in registry order. */
function runs(): Array<{ title: string; roots: SettingDescriptor[] }> {
  const out: Array<{ title: string; roots: SettingDescriptor[] }> = []
  for (const d of SETTINGS) {
    if (d.parent !== undefined) continue
    const title = d.section ?? CATEGORY_LABEL[d.category]
    const last = out[out.length - 1]
    if (last !== undefined && last.title === title) last.roots.push(d)
    else out.push({ title, roots: [d] })
  }
  return out
}

export function SettingsPanel({ store, onClose, initialSettingId }: Props) {
  useReturnFocus(true)
  const trap = useFocusTrap<HTMLDivElement>(true)
  const [values, setValues] = useState(() => store.all())
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [rejectedDismissed, setRejectedDismissed] = useState(false)
  const [help, setHelp] = useState(false)

  useEffect(() => store.subscribe(setValues), [store])

  // Once the page has painted, bring the row into view and flash it.
  useEffect(() => {
    if (initialSettingId === undefined) return
    const el = document.getElementById(initialSettingId)?.closest('.prefs-row')
    if (!(el instanceof HTMLElement)) return
    el.scrollIntoView({ block: 'center' })
    el.classList.add('flash')
    const t = setTimeout(() => el.classList.remove('flash'), 1800)
    return () => clearTimeout(t)
  }, [initialSettingId])

  /*
   * Escape clears the filter first and leaves second — the same two-step
   * every find field uses. From anywhere on the page.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (help) setHelp(false)
      else if (query !== '') setQuery('')
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, query, help])

  const set = (id: string, raw: unknown) => setError(store.set(id, raw))
  const changed = store.modifiedCount()

  /* The filter narrows the page: a row stays when any word of it matches, and a run stays while any row in it does. */
  const q = query.trim().toLowerCase()
  const shows = (d: SettingDescriptor) => q === '' || `${d.label} ${d.description}`.toLowerCase().includes(q)
  const page = useMemo(() => runs(), [])
  const visible = page
    .map((r) => ({ ...r, roots: r.roots.filter((d) => shows(d) || childrenOf(d.id).some(shows)) }))
    .filter((r) => r.roots.length > 0)

  return (
    <div className="prefs" role="dialog" aria-label={help ? 'Help' : 'Settings'} aria-modal="true" ref={trap}>
      <div className="prefs-layer">
        <div className="prefs-page">
          <div className="prefs-head">
            {help ? (
              <button type="button" className="prefs-close" aria-label="Back to settings" title="Back to settings" onClick={() => setHelp(false)}>
                <Glyph icon={ChevronLeft} role="inline" />
              </button>
            ) : null}
            <h1 className="prefs-title">{help ? 'Help' : 'Settings'}</h1>
            <span className="grow" />
            {help ? null : (
            <label className="prefs-find">
              <Glyph icon={Search} role="row" />
              <input
                value={query}
                placeholder="Find a setting"
                aria-label="Find a setting"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            )}
            {/* Only when there is something to reset: a disabled Reset on a page at its defaults explains itself by not working. */}
            {!help && changed > 0 && (
              <button
                className="prefs-resetall"
                title="Restore every setting. Projects, takeoffs and recent projects are not touched."
                onClick={() => store.resetAll()}
              >
                <b>{changed} changed</b> · Reset all
              </button>
            )}
            {help ? null : (
              <button type="button" className="prefs-headlink" onClick={() => setHelp(true)}>Help</button>
            )}
            <button className="prefs-close" aria-label="Back to the drawing" title="Back to the drawing (Esc)" onClick={onClose}>
              <Glyph icon={X} role="inline" />
            </button>
          </div>

          {error !== null && (
            <div className="prefs-infobar caution" role="alert">
              <Glyph icon={TriangleAlert} role="inline" />
              <span className="grow">{error}</span>
              <button className="prefs-dismiss" aria-label="Dismiss" onClick={() => setError(null)}><Glyph icon={X} role="inline" /></button>
            </div>
          )}

          {/* Rejected values are surfaced rather than swallowed: a setting quietly
              reverting to its default looks like the app ignoring the user. */}
          {store.rejected.length > 0 && !rejectedDismissed && (
            <div className="prefs-infobar caution" role="status">
              <Glyph icon={TriangleAlert} role="inline" />
              <span className="grow">
                {store.rejected.length} stored setting{store.rejected.length === 1 ? '' : 's'} could not be
                read and fell back to defaults: {store.rejected.map((r) => r.id).join(', ')}.
              </span>
              <button className="prefs-dismiss" aria-label="Dismiss" onClick={() => setRejectedDismissed(true)}><Glyph icon={X} role="inline" /></button>
            </div>
          )}

          {help ? <HelpBody /> : null}

          {!help && q !== '' && visible.length === 0 && (
            <p className="prefs-empty">No setting matches “{query.trim()}”.</p>
          )}

          {!help && visible.map((r) => (
            <section key={r.title} className="prefs-run" aria-labelledby={`prefs-run-${r.title}`}>
              <h3 className="prefs-runtitle" id={`prefs-run-${r.title}`}>{r.title}</h3>
              {/* A SettingsCard group: one raised card per run, the rows divided inside it. */}
              <div className="prefs-group">
                {r.roots.map((d) => (
                  <Family key={d.id} d={d} values={values} store={store} onSet={set} shows={shows} />
                ))}
              </div>
            </section>
          ))}

          {!help && q === '' && <AboutRun />}
        </div>
      </div>
    </div>
  )
}

/**
 * A setting and, beneath it, the settings that only apply while it is on.
 * The children are dimmed, not removed, while the parent is off: removing
 * them would make a change to "show seams" look lost when the preview is
 * next turned on; dimming says "remembered, not in effect".
 */
function Family({
  d, values, store, onSet, shows,
}: {
  d: SettingDescriptor
  values: Record<string, unknown>
  store: SettingsStore
  onSet: (id: string, raw: unknown) => void
  shows: (d: SettingDescriptor) => boolean
}) {
  const children = childrenOf(d.id).filter(shows)
  const on = values[d.id] === true
  const [open, setOpen] = useState(true)
  return (
    <>
      <Row
        d={d}
        value={values[d.id]}
        modified={store.isModified(d.id)}
        onSet={onSet}
        {...(children.length > 0 ? { expanded: open, onExpand: () => setOpen((v) => !v) } : {})}
      />
      {open && children.map((child, i) => (
        <Row
          key={child.id}
          d={child}
          value={values[child.id]}
          modified={store.isModified(child.id)}
          onSet={onSet}
          child={i === children.length - 1 ? 'last' : 'mid'}
          dimmed={!on}
        />
      ))}
    </>
  )
}

/** One setting: label, one line about it, the control at the right; the accent bar and "Default" when it differs. */
function Row({
  d, value, modified, onSet, child, dimmed = false, expanded, onExpand,
}: {
  d: SettingDescriptor
  value: unknown
  modified: boolean
  onSet: (id: string, raw: unknown) => void
  child?: 'mid' | 'last'
  dimmed?: boolean
  /** A parent with children: the chevron that folds them. */
  expanded?: boolean
  onExpand?: () => void
}) {
  const on = value === true
  const defaultText = d.type === 'enum'
    ? d.choices.find((c) => c.value === d.default)?.label ?? String(d.default)
    : d.type === 'bool' ? (d.default ? 'on' : 'off') : String(d.default)
  const place = child === 'mid' ? 'child mid' : child === 'last' ? 'child last' : ''
  const rowClass = ['prefs-row', place, modified ? 'mod' : '', dimmed ? 'dimmed' : ''].filter(Boolean).join(' ')
  return (
    <div className={rowClass}>
      <label htmlFor={d.id} className="prefs-rowtext" title={d.description}>
        <span className="prefs-label">{d.label}</span>
        <span className="prefs-desc">{d.description}</span>
      </label>
      <span className="prefs-ctl">
        {modified && (
          <button
            className="prefs-default"
            title={`Restore the default: ${defaultText}`}
            aria-label={`Restore the default, ${defaultText}`}
            onClick={() => onSet(d.id, d.default)}
          >
            <Glyph icon={Reset} role="inline" />
          </button>
        )}
        {d.type === 'bool' && (
          <>
            {/* The word beside the switch: a toggle with no On or Off is a shape, not a setting. */}
            <span className="prefs-onoff" aria-hidden="true">{on ? 'On' : 'Off'}</span>
            <button
              id={d.id}
              type="button"
              role="switch"
              className={`prefs-sw${on ? ' on' : ''}`}
              aria-checked={on}
              aria-label={d.label}
              disabled={dimmed}
              onClick={() => onSet(d.id, !on)}
            ><span /></button>
          </>
        )}
        {d.type === 'int' && (
          <input
            id={d.id}
            className="prefs-num"
            type="number"
            min={d.min}
            max={d.max}
            value={Number(value)}
            onChange={(e) => onSet(d.id, e.target.value)}
          />
        )}
        {d.type === 'enum' && (
          <select id={d.id} className="prefs-select" value={String(value)} onChange={(e) => onSet(d.id, e.target.value)}>
            {d.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        )}
        {onExpand !== undefined && (
          <button
            className="prefs-expander"
            aria-expanded={expanded}
            aria-label={expanded ? `Fold ${d.label}` : `Unfold ${d.label}`}
            onClick={onExpand}
          >
            <Glyph icon={expanded ? ChevronUp : ChevronDown} role="inline" />
          </button>
        )}
      </span>
    </div>
  )
}

/** Where the accent came from, with the colour beside it. */
function AccentRow() {
  const report = accentReport()
  return (
    <div className="prefs-card">
      <div className="prefs-cardtext">
        <div className="prefs-cardtitle">Accent colour</div>
        <div className="prefs-cardnote">{report.text}</div>
      </div>
      <span className="prefs-swatch" aria-hidden="true" style={{ background: report.colour ?? 'var(--rb-accent)' }} />
    </div>
  )
}

/**
 * Facts about the installed copy, as the last run: which version this is,
 * whether it can update, what it recorded when it broke, and what it is
 * built on. Rows without switches — nothing here is a preference.
 */
function AboutRun() {
  return (
    <section className="prefs-run prefs-about" aria-label="About REDBEAM">
      <h3 className="prefs-runtitle"><Glyph icon={Info} role="row" /> About REDBEAM <span className="prefs-version">{APP_VERSION}</span></h3>
      <div className="prefs-group">
        <UpdateRow desktop={isTauri()} />
        <DiagnosticsRow desktop={isTauri()} />
        <AccentRow />
        <div className="prefs-card">
          <div className="prefs-cardtext">
            <div className="prefs-cardtitle">Third-party notices</div>
            <div className="prefs-cardnote">
              PDFium (BSD) · sql.js (MIT) · Fluent UI System Icons (MIT) · React (MIT) ·
              Tauri (MIT/Apache-2.0) · Segoe UI Variable and Cascadia Mono are the system's own faces.
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
