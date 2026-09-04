/**
 * Choosing a scale for one sheet or forty — or for a box on one.
 *
 * The list is `SCALE_PRESETS`, the ported table the Qt build used, grouped by
 * system in its original order — architectural fine-to-coarse, then
 * engineering, then metric. That order is not alphabetical and must not be
 * sorted: an estimator scans it by scale, and `1/16"` belongs beside `1/8"`.
 *
 * A stated scale needs no measuring. A plotted sheet is at true size, so
 * `1/8" = 1'-0"` IS a feet-per-point, which is why this can be applied to a
 * whole 400-series at once while the reference-line tool cannot — that one
 * measures something on a particular page.
 *
 * NOT A DIALOG. It was one, centred over the drawing with a scrim, and it is
 * reached from two moments that are each already somewhere: a right-click on
 * a selection in the sheet index, and a box just dragged with the region
 * tool. So it renders where the moment is — in the Contents pane in place of
 * the index it was asked from, or in the dock's scale control beside the box
 * it is naming — and takes the shape of its host: a column that scrolls its
 * list and keeps its actions on screen.
 *
 * There is no "detect" button and there will not be one.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SCALE_PRESETS, SYSTEM_LABELS, feetPerPointForPreset, matchPreset, presetSource,
  type ScalePreset, type ScaleSystem,
} from '@redbeam/domain'
import { ChevronRight, Glyph, TriangleAlert } from '../shell/icons.js'

export interface ScalePickerProps {
  /** What the scale will be applied to, e.g. "12 sheets" or "A-401". */
  target: string
  /** The scale those sheets carry now, when they agree on one. */
  current: number | null
  /** True when the selection carries more than one scale between them. */
  mixed?: boolean
  onApply: (feetPerPoint: number, source: string, label: string) => void
  onCancel: () => void
  /**
   * Ask for a name as well as a scale.
   *
   * Set when the target is a REGION. A page needs no name — it is the sheet —
   * but a details page grows four boxes that are otherwise told apart only by
   * where they sit, and "Detail 3 / head" is what makes a later reader able to
   * say which number came from which drawing.
   */
  withLabel?: boolean
  /**
   * Where cancelling goes back to, when the picker has replaced something —
   * "Contents" for the pane. Absent when it sits inside a control that is
   * its own way out.
   */
  backLabel?: string
}

const GROUPS: Array<{ system: ScaleSystem, presets: ScalePreset[] }> = (() => {
  const order: ScaleSystem[] = ['imperial-architectural', 'imperial-engineering', 'metric']
  return order.map((system) => ({
    system,
    presets: SCALE_PRESETS.filter((p) => p.system === system),
  }))
})()

export function ScalePicker({
  target, current, mixed, withLabel, backLabel, onApply, onCancel,
}: ScalePickerProps) {
  const currentPreset = useMemo(() => (current === null ? null : matchPreset(current)), [current])
  const [chosen, setChosen] = useState<string | null>(currentPreset?.id ?? null)
  const [label, setLabel] = useState('')
  const firstRef = useRef<HTMLElement | null>(null)

  // Focus on open, so the picker can be driven from the keyboard and so
  // Escape reaches it rather than the drawing beside it. The name, when one
  // is asked for, is the first thing to type.
  useEffect(() => { firstRef.current?.focus() }, [])

  const apply = () => {
    const preset = SCALE_PRESETS.find((p) => p.id === chosen)
    if (preset === undefined) return
    // The source records HOW the scale was set, which is the difference between
    // a number somebody chose off a title block and one measured off a line.
    onApply(feetPerPointForPreset(preset), presetSource(preset), label.trim())
  }

  return (
    <div
      className="scalepick"
      role="group"
      aria-label={`Set the scale for ${target}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
        if (e.key === 'Enter' && chosen !== null) { e.stopPropagation(); apply() }
      }}
    >
      <div className="scalepickhead">
        {backLabel !== undefined && (
          <button className="hlink" onClick={onCancel} title={`Back to ${backLabel}`}>
            <Glyph icon={ChevronRight} role="small" style={{ transform: 'rotate(180deg)' }} />
            {backLabel}
          </button>
        )}
        <strong>Set the scale</strong>
        <span className="wsmuted">{target}</span>
      </div>

      {mixed === true && (
        <div className="wswarn">
          <Glyph icon={TriangleAlert} role="row" />
          <span>
            These sheets do not all carry the same scale. Applying one will replace
            every one of them.
          </span>
        </div>
      )}

      {withLabel === true && (
        <label className="scalepickname">
          <span>Name</span>
          <input
            ref={firstRef as React.RefObject<HTMLInputElement>}
            value={label}
            placeholder="Detail 3 / head"
            aria-label="Name for this scale region"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
      )}

      <div className="scalepicklist">
        {GROUPS.map((g) => (
          <section key={g.system}>
            <h4>{SYSTEM_LABELS[g.system]}</h4>
            {g.presets.map((p, i) => {
              const isCurrent = currentPreset?.id === p.id
              const first = withLabel !== true && i === 0 && g.system === 'imperial-architectural'
              return (
                <button
                  key={p.id}
                  ref={first ? (firstRef as React.RefObject<HTMLButtonElement>) : undefined}
                  className={`scalepickoption${chosen === p.id ? ' chosen' : ''}`}
                  aria-pressed={chosen === p.id}
                  onClick={() => setChosen(p.id)}
                  onDoubleClick={() => { setChosen(p.id); apply() }}
                >
                  <span className="grow">{p.label}</span>
                  {/* Named so somebody can see the scale they are on without
                      leaving the list to check. */}
                  {isCurrent && <span className="wsmuted">current</span>}
                </button>
              )
            })}
          </section>
        ))}
      </div>

      <div className="scalepickfoot">
        {/* No number is shown for an unset sheet, because "0" and "not set" are
            different and only one of them is true. */}
        <span className="wsmuted">
          {current === null
            ? 'Not set'
            : `Now: ${currentPreset?.label ?? `1 pt = ${current.toFixed(6)} ft`}`}
        </span>
        <button className="ghostbtn" onClick={onCancel}>Cancel</button>
        <button className="primarybtn" disabled={chosen === null} onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  )
}
