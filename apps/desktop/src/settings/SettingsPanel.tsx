/**
 * Settings (plan TH.4).
 *
 * Every row is generated from the descriptor registry. There is no hand-written
 * form: a setting that exists in the registry appears here, and one that does
 * not, cannot. That is what keeps validation and reset agreeing with what is
 * on screen.
 *
 * ONE PAGE, ONE COLUMN. The first port kept the Qt build's shape — a category
 * column beside the settings, a search field, a reset button per section and
 * another for the whole — which is the right shape for the forty controls
 * Qt has and the wrong one for the nine this app reads. Three of the six
 * categories held a single row, so choosing "Viewer" showed one switch on a
 * 1440px screen; the search field searched fifteen labels that fit on the
 * screen without it; and the modified count was stated twice at once. What
 * is left is what nine settings need: headings, rows, a family indented
 * under the switch it depends on, and one Reset that appears when there is
 * something to reset.
 *
 * Search is the palette's. Every switch is already a typed command there
 * ("turn on snap while drawing"), which is faster than any search box inside
 * a page you first have to open.
 *
 * It is a full view, mounted in the shell's `.settingsview` beneath the title
 * bar — a place you go, not a question over the work — and this file only
 * describes what is inside it.
 */
import { useEffect, useState } from 'react'
import {
  CATEGORY_LABEL, categories, childrenOf, inCategory,
  type SettingCategory, type SettingDescriptor,
} from './registry.js'
import type { SettingsStore } from './store.js'
import { useReturnFocus } from '../returnFocus.js'
import { UpdateRow } from '../update/UpdateRow.js'
import { DiagnosticsRow } from '../update/DiagnosticsRow.js'
import { isTauri } from '../tauri/window.js'
import { useFocusTrap } from '../shell/focusTrap.js'
import { Glyph, X } from '../shell/icons.js'
import './settings.css'

interface Props {
  store: SettingsStore
  onClose: () => void
}

export function SettingsPanel({ store, onClose }: Props) {
  useReturnFocus(true)
  const trap = useFocusTrap<HTMLDivElement>(true)
  const [values, setValues] = useState(() => store.all())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => store.subscribe(setValues), [store])

  /*
   * Escape leaves, from anywhere on the page. The old panel only listened on
   * its search field, so Escape with a switch focused did nothing — and a
   * full-screen place that does not answer Escape reads as stuck.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (id: string, raw: unknown) => setError(store.set(id, raw))
  const changed = store.modifiedCount()

  return (
    <div className="prefs" role="dialog" aria-label="Settings" aria-modal="true" ref={trap}>
      <header className="prefs-head">
        <div className="prefs-col prefs-headrow">
          <h1 className="prefs-title">Settings</h1>
          {/*
            Shown only when there is something to reset. A disabled Reset on
            a page at its defaults is a control that explains itself by not
            working; the count beside it is the same fact, stated once.
          */}
          {changed > 0 && (
            <button
              className="prefs-resetall"
              title="Restore every setting. Projects, takeoffs and recent projects are not touched."
              onClick={() => store.resetAll()}
            >
              Reset all · {changed} changed
            </button>
          )}
          <button className="prefs-close" aria-label="Close settings" onClick={onClose}>
            <Glyph icon={X} role="inline" />
          </button>
        </div>
      </header>

      <div className="prefs-body">
        <div className="prefs-col">
          {error !== null && <div className="warnblock" role="alert">{error}</div>}

          {/*
            Rejected values are surfaced rather than swallowed. A setting
            quietly reverting to its default looks like the app ignoring the
            user.
          */}
          {store.rejected.length > 0 && (
            <div className="warnblock">
              {store.rejected.length} stored setting{store.rejected.length === 1 ? '' : 's'} could not be
              read and fell back to defaults: {store.rejected.map((r) => r.id).join(', ')}
            </div>
          )}

          {categories().map((c) => (
            <Section key={c} category={c} values={values} store={store} onSet={set} />
          ))}

          {/*
            Not settings. Which version this is, whether it can update, and
            what it recorded when it broke are facts about the installed copy,
            and they sit in their own section after the preferences rather than
            among them — nothing here has a switch.
          */}
          <section className="prefs-section" aria-labelledby="prefs-copy">
            <h2 className="prefs-kicker" id="prefs-copy">This copy</h2>
            <UpdateRow desktop={isTauri()} />
            <DiagnosticsRow desktop={isTauri()} />
          </section>
        </div>
      </div>
    </div>
  )
}

function Section({
  category, values, store, onSet,
}: {
  category: SettingCategory
  values: Record<string, unknown>
  store: SettingsStore
  onSet: (id: string, raw: unknown) => void
}) {
  // Children render under their parent, so the section walks only the roots.
  const roots = inCategory(category).filter((d) => d.parent === undefined)
  return (
    <section className="prefs-section" aria-labelledby={`prefs-${category}`}>
      <h2 className="prefs-kicker" id={`prefs-${category}`}>{CATEGORY_LABEL[category]}</h2>
      {roots.map((d) => (
        <Family key={d.id} d={d} values={values} store={store} onSet={onSet} />
      ))}
    </section>
  )
}

/** A setting and, beneath it, the settings that only apply while it is on. */
function Family({
  d, values, store, onSet,
}: {
  d: SettingDescriptor
  values: Record<string, unknown>
  store: SettingsStore
  onSet: (id: string, raw: unknown) => void
}) {
  const children = childrenOf(d.id)
  const on = values[d.id] === true
  return (
    <>
      <Row d={d} value={values[d.id]} modified={store.isModified(d.id)} onSet={onSet} />
      {children.length > 0 && (
        /*
         * Dimmed, not removed, while the parent is off. Removing them would
         * make a change to "show seams" look like it had been lost when the
         * preview is next turned on; dimming says "remembered, not in
         * effect" — and `aria-disabled` rather than `disabled` keeps the
         * switch reachable, because flipping it here is still a real edit.
         */
        <div className={`prefs-children${on ? '' : ' off'}`} aria-disabled={!on}>
          {children.map((child) => (
            <Row
              key={child.id}
              d={child}
              value={values[child.id]}
              modified={store.isModified(child.id)}
              onSet={onSet}
            />
          ))}
        </div>
      )}
    </>
  )
}

function Row({
  d, value, modified, onSet,
}: {
  d: SettingDescriptor
  value: unknown
  modified: boolean
  onSet: (id: string, raw: unknown) => void
}) {
  return (
    <div className={`prefs-row${modified ? ' modified' : ''}`}>
      <label htmlFor={d.id} className="prefs-text">
        <span className="prefs-label">{d.label}</span>
        <span className="prefs-desc">{d.description}</span>
      </label>

      {/*
        A row that differs from its default says so with a control, not a
        colour: the old amber bar read as a warning about a preference
        somebody chose on purpose. "Default" restores this one row, which is
        the reset most people actually want.
      */}
      {modified && (
        <button
          className="prefs-default"
          title={`Restore the default (${String(d.default)})`}
          onClick={() => onSet(d.id, d.default)}
        >Default</button>
      )}

      {/*
        A switch, not a raw checkbox. The rest of the product draws state as a
        switch; a browser checkbox here was the one control that looked like it
        came from a different application.
      */}
      {d.type === 'bool' && (
        <button
          id={d.id}
          type="button"
          role="switch"
          className={`swtoggle${value === true ? ' on' : ''}`}
          aria-checked={value === true}
          aria-label={d.label}
          onClick={() => onSet(d.id, value !== true)}
        ><span /></button>
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
    </div>
  )
}
