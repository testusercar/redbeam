/**
 * Bill of materials (plan 06.12), as a level of the estimates panel.
 *
 * The deliverable: what to order, per scope. It was a dialog over the drawing,
 * which is the one place it cannot be read from — a bill is checked AGAINST
 * the sheet it came from, and a scrim between the two turned every check into
 * open, read, close, look, open again. It is a level under the round now,
 * beside the drawing, reached the way a scope is reached.
 *
 * Confidence is shown per LINE, not as a banner, because a banner is read once
 * and a column is read every time. Our panel counts reproduce the Qt build
 * exactly; our baffle and plank counts have never been checked against it. The
 * number on a purchase order is the number someone pays for, so the list has
 * to keep saying which is which.
 */
import { useMemo, useState } from 'react'
import { buildBom, bomToTsv, type BomLine, type ScopePieces } from '@redbeam/domain'
import { renderTakeoffReport } from '../export/report.js'
import { Calculator, Copy, FileText, Glyph, TriangleAlert } from '../shell/icons.js'
import { groupBom, reportFileName } from './bomRows.js'

export interface BomViewProps {
  /** Already narrowed to the open round — see `entriesForRound`. */
  entries: ScopePieces[]
  calibrated: boolean
  /** For the report's header — what this takeoff is OF. */
  projectName: string
  estimateName: string
  /** The drawings it was measured from. */
  documents: readonly string[]
  /**
   * Write the OPEN drawing back out with its markups on it.
   *
   * Resolves to an error to show, or null on success. It lives here beside the
   * other exports because this is where a takeoff is turned into something
   * somebody else can read — and the marked sheet is the half of that a
   * spreadsheet cannot carry.
   */
  onExportMarkedPdf?: () => Promise<string | null>
  /** Markups on the open drawing. Zero means there is nothing to write. */
  markupCount?: number
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })

export function BomView(p: BomViewProps) {
  const { entries, calibrated } = p
  const bom = useMemo(() => buildBom(entries), [entries])
  const groups = useMemo(() => groupBom(bom, entries), [bom, entries])
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  /**
   * The report, as a file you can send.
   *
   * TSV is right for a pricing sheet and wrong in front of a client. This is
   * one self-contained HTML document — no network, no font file, no external
   * stylesheet — so it survives being emailed and opened offline months later.
   */
  const saveReport = () => {
    const html = renderTakeoffReport({
      projectName: p.projectName,
      estimateName: p.estimateName,
      bom,
      documents: p.documents,
      generatedAt: new Date(),
    })
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = reportFileName(p.projectName, p.estimateName)
    a.click()
    // Revoked on the next tick: revoking synchronously races the download in
    // WebView2 and produces an empty file.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  /**
   * Writing a large sheet takes long enough to look broken, so the button says
   * what it is doing and refuses to be pressed twice.
   */
  const exportPdf = async () => {
    if (p.onExportMarkedPdf === undefined || busy) return
    setBusy(true)
    setPdfError(null)
    try {
      setPdfError(await p.onExportMarkedPdf())
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'The drawing could not be written.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bomToTsv(bom))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // A clipboard permission failure must not look like a broken export.
      setCopied(false)
    }
  }

  const noMarkups = (p.markupCount ?? 0) === 0

  return (
    <>
      <div className="wshead">
        <div className="grow">
          <h2>Bill of materials</h2>
          <div className="wsmuted">
            {p.estimateName}
            {bom.lines.length > 0 && ` · ${bom.lines.length} line${bom.lines.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <button className="primarybtn" onClick={saveReport} title="One self-contained HTML file, for sending">
          <Glyph icon={FileText} role="inline" /> Save report
        </button>
      </div>

      {/*
        The other two exports, as links under the title rather than buttons
        beside it: three buttons in a 320px head is a row that wraps, and only
        the report is the thing most people come here to make.
      */}
      <div className="bomactions">
        <button className="hlink" onClick={() => void copy()}>
          <Glyph icon={Copy} role="small" />
          {copied ? 'Copied' : 'Copy as TSV'}
        </button>
        {p.onExportMarkedPdf !== undefined && (
          <button
            className="hlink"
            disabled={busy || noMarkups}
            title={noMarkups
              ? 'The open drawing has no markups to write.'
              : 'Save the open drawing with its markups on it.'}
            onClick={() => void exportPdf()}
          >
            <Glyph icon={FileText} role="small" />
            {busy ? 'Writing…' : 'Marked-up PDF'}
          </button>
        )}
      </div>

      {/* Failures are shown, not swallowed: an export that quietly does
          nothing is indistinguishable from one that worked. */}
      {pdfError !== null && (
        <div className="wswarn" role="alert">
          <Glyph icon={TriangleAlert} role="row" />
          <span>{pdfError}</span>
        </div>
      )}

      {!calibrated && (
        <div className="wswarn">
          <Glyph icon={TriangleAlert} role="row" />
          <span>This drawing is not calibrated, so nothing here is in real units yet.</span>
        </div>
      )}

      {groups.length === 0 && (
        <div className="emptystate" role="status">
          <Glyph icon={Calculator} role="card" />
          <div className="emptytitle">Nothing to order yet</div>
          <div className="emptybody">
            A line appears here for each piece count a scope produces. Set the
            scope&rsquo;s dimensions, take off its areas, and the count arrives.
          </div>
        </div>
      )}

      {groups.map((g) => (
        <section className="wssection" key={g.scopeId}>
          <h3>
            <span className="scopedot" style={{ background: g.color }} aria-hidden="true" />
            <span className="grow">{g.scopeLabel}</span>
            <span className="hcount">{g.productLabel}</span>
          </h3>
          {g.lines.map((l, i) => <Line key={`${l.itemKey}:${i}`} line={l} />)}
        </section>
      ))}

      {bom.totals.length > 0 && (
        <section className="wssection">
          <h3>
            <Glyph icon={Calculator} role="row" />
            <span className="grow">Totals</span>
            {/* Named on the section itself: a total whose basis is a footnote
                gets quoted without the footnote. */}
            <span className="hcount">verified lines only</span>
          </h3>
          {bom.totals.map((t) => (
            <div className="kvrow" key={t.unit}>
              <span className="kvlabel">Total {t.unit}</span>
              <span className="kvvalue num">{fmt(t.quantity)} {t.unit}</span>
            </div>
          ))}
        </section>
      )}

      {bom.needsAttention && (
        <div className="wswarn">
          <Glyph icon={TriangleAlert} role="row" />
          <div className="grow">
            {bom.counts.unverified > 0 && (
              <div>
                {bom.counts.unverified} line{bom.counts.unverified === 1 ? '' : 's'} come from an
                engine that has never been checked against the Qt build — no golden fixture exists
                for that product type. Do not order from them yet.
              </div>
            )}
            {bom.counts.blocked > 0 && (
              <div>
                {bom.counts.blocked} scope{bom.counts.blocked === 1 ? '' : 's'} could not be
                calculated. Those have no quantity at all — not a quantity of zero.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function Line({ line }: { line: BomLine }) {
  /*
    The same three columns the scope's own parts table uses — part, quantity,
    unit — because it is the same kind of line. It was a key-value row with the
    quantity and the unit run together on the right, so the two places that
    list what to order disagreed about how an order line looks, and neither
    column of figures aligned on its unit.
  */
  return (
    <div className={`partsrow bomline ${line.confidence}`} title={line.note ?? ''}>
      <span>
        {line.label}
        {/* Confidence beside the label, in words: a colour alone is a
            column nobody can read the legend for. */}
        {line.confidence !== 'verified' && (
          <span className={`bomconf ${line.confidence}`}>{line.confidence}</span>
        )}
      </span>
      {/* An em dash, never 0: a blocked scope has no count, and 0 reads as
          "nothing to order". */}
      <span className="num">{line.quantity === null ? '—' : fmt(line.quantity)}</span>
      <span className="partsunit">{line.quantity === null ? '' : line.unit}</span>
    </div>
  )
}
