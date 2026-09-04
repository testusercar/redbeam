/**
 * Settings, built the way Windows 11 Settings is built.
 *
 * A NavigationView in Left mode on Mica — back, the title, Find a setting,
 * one item per category and About as the footer item — beside a content
 * layer with the 8px top-left corner, a breadcrumb title, and the page's
 * settings as SettingsCards: a 68px card with its icon at the left, the
 * setting's name and what it does, and the control at the right with its
 * On or Off word. A family of settings is a SettingsExpander — the parent's
 * card with a chevron, and its children indented beneath on the lower fill,
 * dimmed while the parent is off.
 *
 * Standard sizing here on purpose: a settings page is a place you go, not a
 * pane you work in, and Windows draws it at this density.
 *
 * Every row is still generated from the descriptor registry. A setting that
 * exists in the registry appears here, and one that does not, cannot — which
 * is what keeps validation and reset agreeing with what is on screen.
 *
 * It is a full view, mounted in the shell's `.settingsview` beneath the title
 * bar — a place you go, not a question over the work.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CATEGORY_LABEL, SETTINGS, categories, childrenOf, inCategory,
  type SettingCategory, type SettingDescriptor,
} from './registry.js'
import type { SettingsStore } from './store.js'
import { useReturnFocus } from '../returnFocus.js'
import { UpdateRow } from '../update/UpdateRow.js'
import { DiagnosticsRow } from '../update/DiagnosticsRow.js'
import { APP_VERSION } from '../update/updates.js'
import { isTauri } from '../tauri/window.js'
import { useFocusTrap } from '../shell/focusTrap.js'
import {
  ChevronDown, ChevronLeft, ChevronRight, Crosshair, FileText, Glyph, Info, Search, Status,
  TriangleAlert, X, type Icon,
} from '../shell/icons.js'
import './settings.css'

interface Props {
  store: SettingsStore
  onClose: () => void
}

type Page = SettingCategory | 'about'

/** The glyph each page — and each card on it — carries. */
const PAGE_ICON: Record<Page, Icon> = {
  viewer: FileText,
  takeoff: Crosshair,
  performance: Status,
  about: Info,
}

export function SettingsPanel({ store, onClose }: Props) {
  useReturnFocus(true)
  const trap = useFocusTrap<HTMLDivElement>(true)
  const [values, setValues] = useState(() => store.all())
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState<Page>(() => categories()[0] ?? 'about')
  const [query, setQuery] = useState('')
  const [rejectedDismissed, setRejectedDismissed] = useState(false)

  useEffect(() => store.subscribe(setValues), [store])

  /*
   * Escape clears the search first and leaves second — the same two-step
   * every find field uses. From anywhere on the page: the old panel only
   * listened on its field, and a full-screen place that does not answer
   * Escape reads as stuck.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (query !== '') setQuery('')
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, query])

  const set = (id: string, raw: unknown) => setError(store.set(id, raw))
  const changed = store.modifiedCount()

  /*
   * Find a setting: the label and the description, every category, as the
   * palette matches them. The results replace the page rather than opening a
   * flyout, which is what Windows Settings does with its own search.
   */
  const q = query.trim().toLowerCase()
  const hits = useMemo(
    () => (q === '' ? [] : SETTINGS.filter((d) => `${d.label} ${d.description}`.toLowerCase().includes(q))),
    [q],
  )

  const title = page === 'about' ? 'About REDBEAM' : CATEGORY_LABEL[page]

  return (
    <div className="prefs" role="dialog" aria-label="Settings" aria-modal="true" ref={trap}>
      {/* NAVIGATION PANE — on Mica, nothing painted. */}
      <nav className="prefs-nav" aria-label="Settings pages">
        <div className="prefs-navhead">
          <button className="prefs-back" aria-label="Back to the drawing" title="Back" onClick={onClose}>
            <Glyph icon={ChevronLeft} role="inline" />
          </button>
          <h1 className="prefs-title">Settings</h1>
        </div>
        <label className="prefs-search">
          <input
            value={query}
            placeholder="Find a setting"
            aria-label="Find a setting"
            onChange={(e) => setQuery(e.target.value)}
          />
          <Glyph icon={Search} role="inline" />
        </label>
        {categories().map((c) => (
          <button
            key={c}
            className={`prefs-navitem${page === c && q === '' ? ' on' : ''}`}
            aria-current={page === c && q === '' ? 'page' : undefined}
            onClick={() => { setQuery(''); setPage(c) }}
          >
            <Glyph icon={PAGE_ICON[c]} role="card" />
            <span className="grow">{CATEGORY_LABEL[c]}</span>
            <span className="prefs-navcount">{inCategory(c).length}</span>
          </button>
        ))}
        <span className="grow" />
        <div className="prefs-navsep" />
        {/* About is the pane's footer item, the way Windows Settings pins its own. */}
        <button
          className={`prefs-navitem${page === 'about' && q === '' ? ' on' : ''}`}
          aria-current={page === 'about' && q === '' ? 'page' : undefined}
          onClick={() => { setQuery(''); setPage('about') }}
        >
          <Glyph icon={Info} role="card" />
          <span className="grow">About REDBEAM</span>
          <span className="prefs-navcount">{APP_VERSION}</span>
        </button>
      </nav>

      {/* CONTENT LAYER */}
      <div className="prefs-layer">
        <div className="prefs-page">
          <div className="prefs-crumbs">
            <span className="prefs-crumb">Settings</span>
            <Glyph icon={ChevronRight} role="inline" />
            <h2 className="prefs-pagetitle">{q === '' ? title : 'Results'}</h2>
            <span className="grow" />
            {/*
              Shown only when there is something to reset. A disabled Reset
              on a page at its defaults is a control that explains itself by
              not working; the count beside it is the same fact, stated once.
            */}
            {changed > 0 && (
              <button
                className="prefs-resetall"
                title="Restore every setting. Projects, takeoffs and recent projects are not touched."
                onClick={() => store.resetAll()}
              >
                Reset all<span className="prefs-resetcount">· {changed} changed</span>
              </button>
            )}
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

          {q !== '' && hits.length === 0 && (
            <p className="prefs-empty">No setting matches “{query.trim()}”.</p>
          )}
          {q !== '' && hits.length > 0 && (
            <section className="prefs-section" aria-label="Results">
              {hits.map((d) => (
                <Card key={d.id} d={d} value={values[d.id]} modified={store.isModified(d.id)} onSet={set} icon={PAGE_ICON[d.category]} caption={CATEGORY_LABEL[d.category]} />
              ))}
            </section>
          )}

          {q === '' && page !== 'about' && <CategoryPage category={page} values={values} store={store} onSet={set} />}
          {q === '' && page === 'about' && <AboutPage />}
        </div>
      </div>
    </div>
  )
}

/** A category: its sections in registry order, each a titled run of cards. */
function CategoryPage({
  category, values, store, onSet,
}: {
  category: SettingCategory
  values: Record<string, unknown>
  store: SettingsStore
  onSet: (id: string, raw: unknown) => void
}) {
  // Children render under their parent, so the page walks only the roots.
  const roots = inCategory(category).filter((d) => d.parent === undefined)
  const sections: Array<{ title: string; roots: SettingDescriptor[] }> = []
  for (const d of roots) {
    const title = d.section ?? CATEGORY_LABEL[category]
    const last = sections[sections.length - 1]
    if (last !== undefined && last.title === title) last.roots.push(d)
    else sections.push({ title, roots: [d] })
  }
  return (
    <>
      {sections.map((s) => (
        <section key={s.title} className="prefs-section" aria-labelledby={`prefs-${category}-${s.title}`}>
          <h3 className="prefs-sectiontitle" id={`prefs-${category}-${s.title}`}>{s.title}</h3>
          {s.roots.map((d) => (
            <Family key={d.id} d={d} values={values} store={store} onSet={onSet} icon={PAGE_ICON[category]} />
          ))}
        </section>
      ))}
    </>
  )
}

/**
 * A setting and, beneath it, the settings that only apply while it is on —
 * a SettingsExpander. The children are dimmed, not removed, while the parent
 * is off: removing them would make a change to "show seams" look lost when
 * the preview is next turned on; dimming says "remembered, not in effect".
 */
function Family({
  d, values, store, onSet, icon,
}: {
  d: SettingDescriptor
  values: Record<string, unknown>
  store: SettingsStore
  onSet: (id: string, raw: unknown) => void
  icon: Icon
}) {
  const children = childrenOf(d.id)
  const on = values[d.id] === true
  const [expanded, setExpanded] = useState(true)
  if (children.length === 0) {
    return <Card d={d} value={values[d.id]} modified={store.isModified(d.id)} onSet={onSet} icon={icon} />
  }
  return (
    <div className="prefs-expander">
      <Card
        d={d}
        value={values[d.id]}
        modified={store.isModified(d.id)}
        onSet={onSet}
        icon={icon}
        trailing={
          <button
            className="prefs-chevron"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${d.label}` : `Expand ${d.label}`}
            onClick={() => setExpanded((v) => !v)}
          >
            <Glyph icon={ChevronDown} role="inline" style={expanded ? { transform: 'rotate(180deg)' } : undefined} />
          </button>
        }
      />
      {expanded && (
        <div className={`prefs-children${on ? '' : ' off'}`} aria-disabled={!on}>
          {children.map((child) => (
            <Card key={child.id} d={child} value={values[child.id]} modified={store.isModified(child.id)} onSet={onSet} child />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A SettingsCard: icon, header, description, and the control at the right.
 *
 * A row that differs from its default says so with a control, not a colour:
 * "Default" restores this one row, which is the reset most people want.
 */
function Card({
  d, value, modified, onSet, icon, caption, trailing, child = false,
}: {
  d: SettingDescriptor
  value: unknown
  modified: boolean
  onSet: (id: string, raw: unknown) => void
  icon?: Icon
  /** Where the setting lives, for a search result. */
  caption?: string
  trailing?: ReactNode
  child?: boolean
}) {
  const on = value === true
  return (
    <div className={`prefs-card${child ? ' child' : ''}${modified ? ' modified' : ''}`}>
      {icon !== undefined && <span className="prefs-cardicon"><Glyph icon={icon} role="card" /></span>}
      <label htmlFor={d.id} className="prefs-cardtext">
        <span className="prefs-cardtitle">{d.label}</span>
        <span className="prefs-cardnote">{d.description}{caption !== undefined && <span className="prefs-cardwhere"> · {caption}</span>}</span>
      </label>
      <span className="prefs-cardctl">
        {modified && (
          <button
            className="prefs-default"
            title={`Restore the default (${String(d.default)})`}
            onClick={() => onSet(d.id, d.default)}
          >Default</button>
        )}
        {d.type === 'bool' && (
          <>
            <span className="prefs-onoff">{on ? 'On' : 'Off'}</span>
            <button
              id={d.id}
              type="button"
              role="switch"
              className={`swtoggle${on ? ' on' : ''}`}
              aria-checked={on}
              aria-label={d.label}
              onClick={() => onSet(d.id, !on)}
            ><span /></button>
          </>
        )}
        {d.type === 'int' && (
          <input
            id={d.id}
            className="prefs-control"
            type="number"
            min={d.min}
            max={d.max}
            value={Number(value)}
            onChange={(e) => onSet(d.id, e.target.value)}
          />
        )}
        {d.type === 'enum' && (
          <select id={d.id} className="prefs-control" value={String(value)} onChange={(e) => onSet(d.id, e.target.value)}>
            {d.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        )}
        {trailing}
      </span>
    </div>
  )
}

/**
 * Facts about the installed copy: which version this is, whether it can
 * update, what it recorded when it broke, and what it is built on. Cards
 * without switches — nothing here is a preference.
 */
function AboutPage() {
  return (
    <>
      <section className="prefs-section" aria-label="This copy">
        <h3 className="prefs-sectiontitle">This copy</h3>
        <UpdateRow desktop={isTauri()} />
        <DiagnosticsRow desktop={isTauri()} />
      </section>
      <section className="prefs-section" aria-label="Licences">
        <h3 className="prefs-sectiontitle">Licences</h3>
        <div className="prefs-card">
          <span className="prefs-cardicon"><Glyph icon={FileText} role="card" /></span>
          <span className="prefs-cardtext">
            <span className="prefs-cardtitle">Third-party notices</span>
            <span className="prefs-cardnote">
              PDFium (BSD) · sql.js (MIT) · Fluent UI System Icons (MIT) · React (MIT) ·
              Tauri (MIT/Apache-2.0) · Segoe UI Variable and Cascadia Mono are the system's own faces.
            </span>
          </span>
        </div>
      </section>
    </>
  )
}

