/**
 * The second half of calibrating: the line has been drawn, and this asks how
 * long it really is.
 *
 * It lives in the dock's scale control — the pill that reads the sheet's scale
 * and whose menu offered "Calibrate from the drawing…" in the first place. A
 * gesture that starts from a control should end at it: the line is on the
 * sheet, the question is under the number the answer will change, and nothing
 * is scrimmed. It was a dialog centred over the drawing, with the line it was
 * asking about hidden behind its own scrim.
 *
 * It cannot be dismissed by clicking elsewhere. The measurement behind it was
 * just taken and would be thrown away; Cancel and Escape are the deliberate
 * ways out, and the workspace refuses to open the palette over it.
 *
 * Deliberately not window.prompt(): a modal prompt blocks the event loop,
 * cannot show the measured length alongside the input, and cannot be driven
 * by a test.
 */
import { useEffect, useRef, useState } from 'react'
import { Glyph, TriangleAlert } from './icons.js'

export interface CalibrationEntryProps {
  /** Measured length of the reference line, in PDF points. */
  lengthPdfPoints: number
  error: string | null
  onSubmit: (value: string, unit: string) => void
  onCancel: () => void
}

const UNITS = ['ft', 'in', 'm', 'cm', 'mm']

export function CalibrationEntry({ lengthPdfPoints, error, onSubmit, onCancel }: CalibrationEntryProps) {
  const [value, setValue] = useState('20')
  const [unit, setUnit] = useState('ft')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  return (
    <form
      className="calibrate"
      aria-label="Calibrate this sheet"
      onSubmit={(e) => { e.preventDefault(); onSubmit(value, unit) }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}
    >
      <div className="scopemenuhead">
        <span className="scopemenuname">Calibrate</span>
        <span className="menuhead">This sheet only</span>
      </div>

      <div className="calentrybody">
        <p>
          The line you drew is <strong className="calibratepts">{lengthPdfPoints.toFixed(2)} pt</strong> on
          the page. How long is it really?
        </p>
        <div className="calentryfields">
          <input
            ref={inputRef}
            data-testid="cal-value"
            className="kvcontrol"
            value={value}
            aria-label="Real length"
            onChange={(e) => setValue(e.target.value)}
            placeholder="20  or  7 1/2"
            inputMode="decimal"
          />
          <select
            data-testid="cal-unit"
            className="kvcontrol"
            value={unit}
            aria-label="Unit"
            onChange={(e) => setUnit(e.target.value)}
          >
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        {/* Fractions are how an estimator reads a dimension, so they are how this reads one. */}
        <div className="wsmuted">A dimension off the drawing — a whole number, a decimal, or a fraction like 7 1/2.</div>
        {error && (
          <div className="wswarn" role="alert">
            <Glyph icon={TriangleAlert} role="row" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="calentryfoot">
        <button type="button" className="ghostbtn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primarybtn" data-testid="cal-apply">Apply</button>
      </div>
    </form>
  )
}
