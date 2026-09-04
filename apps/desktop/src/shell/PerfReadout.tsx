/**
 * The frame-time readout, for when `performance.showBudgets` is on.
 *
 * It lived in the pre-shell status bar, which the shell removed, and the
 * setting that promised it stayed in Settings doing nothing — a switch that
 * flips and changes nothing is worse than no switch. This is the readout the
 * setting now means: a chip in the drawing's top-right corner, and the full
 * budget table behind it.
 *
 * p95 rather than the last frame. A last-frame readout usually misses the
 * hitch entirely: what people feel is the occasional 90ms stall inside an
 * otherwise fine average.
 */
import { useState } from 'react'
import { summarize, verdict, type Budget, type Stats } from '../perf.js'

export function PerfReadout({ perf }: { perf: Array<{ budget: Budget; stats: Stats }> }) {
  const [open, setOpen] = useState(false)
  const frame = perf.find((p) => p.budget.key === 'frame')
  const tone = frame !== undefined && frame.stats.window > 0 ? verdict(frame.stats) : 'idle'

  return (
    <div className="perfreadout">
      <button
        className={`perfchip ${tone}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={frame !== undefined ? summarize(frame.budget, frame.stats) : 'no frames measured yet'}
        onClick={() => setOpen((v) => !v)}
      >
        {frame !== undefined && frame.stats.window > 0
          ? `frame p95 ${frame.stats.p95.toFixed(1)} ms`
          : 'frame —'}
        {/* Named, not just coloured: a breach says so in a word. */}
        {tone === 'breach' && ' · over budget'}
      </button>

      {open && (
        <div className="perfsheet" role="dialog" aria-label="Performance budgets">
          <table>
            <thead>
              <tr><th>op</th><th>p50</th><th>p95</th><th>max</th><th>over</th><th>budget</th></tr>
            </thead>
            <tbody>
              {perf.map(({ budget, stats }) => (
                <tr key={budget.key} className={verdict(stats)} title={budget.why}>
                  <td>{budget.label}</td>
                  {stats.window === 0
                    ? <td className="muted" colSpan={4}>not measured</td>
                    : (
                      <>
                        <td>{stats.p50.toFixed(1)}</td>
                        <td>{stats.p95.toFixed(1)}</td>
                        <td>{stats.max.toFixed(1)}</td>
                        <td>{Math.round(stats.overRatio * 100)}%</td>
                      </>
                    )}
                  <td className="muted">{budget.ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Rolling over the last {perf[0]?.stats.window ?? 0} samples. Milliseconds.
          </p>
        </div>
      )}
    </div>
  )
}
