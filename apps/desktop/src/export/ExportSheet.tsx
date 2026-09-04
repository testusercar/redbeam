/**
 * The moment before an estimate leaves the app.
 *
 * Aaron: "At the time of export, give the estimator the opportunity to edit
 * the estimate name, project name, and scope data before exporting, in case
 * there's anything wrong or anything needs to be cleaned up for client
 * presentation." So this is a page in the estimates sidebar, not a save
 * dialog: the names and the scope lines are fields, what is typed here goes
 * into every format, and nothing here writes back to the project — a client
 * name for the cover is not a reason to rename the round.
 *
 * Three ways out, all from the same edited draft: the branded PDF with the
 * quantities and the pictures, a CSV file, or a TSV on the clipboard.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useReturnFocus } from '../returnFocus.js'
import { Copy, DocumentPdf, FileText, Glyph, X } from '../shell/icons.js'
import { estimateToCsv, estimateToTsv, exportFileName, type EstimateExport } from './estimateExport.js'
import { saveFile, saveOutcomeText } from './saveFile.js'

export interface ExportSheetProps {
  /** The draft as built from the project. Edits stay in this component. */
  initial: EstimateExport
  /**
   * Render and save the PDF for this draft. Resolves to a problem to show, or
   * to what happened — "saved C:\…\estimate.pdf", "PDF not saved" when the
   * dialog was cancelled. Progress arrives through `onProgress`.
   */
  onSavePdf: (
    draft: EstimateExport,
    onProgress: (text: string) => void,
  ) => Promise<{ problem: string | null; said: string }>
  onClose: () => void
}

export function ExportSheet({ initial, onSavePdf, onClose }: ExportSheetProps) {
  useReturnFocus(true)
  const [draft, setDraft] = useState<EstimateExport>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  /** What the last save did — the path it went to, or that it was cancelled. */
  const [saved, setSaved] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const firstField = useRef<HTMLInputElement | null>(null)
  useEffect(() => { firstField.current?.focus(); firstField.current?.select() }, [])

  const patchScope = useCallback((id: string, patch: Partial<EstimateExport['scopes'][number]>) => {
    setDraft((d) => ({ ...d, scopes: d.scopes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  }, [])

  const savePdf = async () => {
    if (busy !== null) return
    setBusy('Preparing the document…')
    setProblem(null)
    setSaved(null)
    try {
      const result = await onSavePdf({ ...draft, generatedAt: new Date() }, setBusy)
      // A problem is a string; a success reports where it went.
      if (result.problem !== null) setProblem(result.problem)
      else setSaved(result.said)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The PDF could not be written.')
    } finally {
      setBusy(null)
    }
  }

  const saveCsv = async () => {
    if (busy !== null) return
    const e = { ...draft, generatedAt: new Date() }
    setBusy('Choosing where to save…')
    setProblem(null)
    try {
      const outcome = await saveFile(estimateToCsv(e), {
        name: exportFileName(e, 'csv'),
        type: 'text/csv;charset=utf-8',
        filter: { name: 'CSV spreadsheet', extensions: ['csv'] },
      })
      setSaved(saveOutcomeText(outcome, 'CSV'))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The CSV could not be written.')
    } finally {
      setBusy(null)
    }
  }

  const copyTsv = async () => {
    try {
      await navigator.clipboard.writeText(estimateToTsv(draft))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setProblem('The clipboard refused the text. Save the CSV instead.')
    }
  }

  const lines = draft.scopes.reduce((n, s) => n + s.quantities.length + s.components.length, 0)

  return (
    <div className="exportsheet" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="wshead">
        <div className="grow">
          <h2>Export estimate</h2>
          <div className="wsmuted">
            Check the names and the scopes before they go to a client. Edits here change the
            export only.
          </div>
        </div>
        <button className="paneact" title="Back" aria-label="Back" onClick={onClose}>
          <Glyph icon={X} role="row" />
        </button>
      </div>

      <section className="wssection">
        <h3><span className="grow">Cover</span></h3>
        <label className="exportfield">
          <span>Project</span>
          <input
            ref={firstField}
            value={draft.projectName}
            onChange={(e) => setDraft({ ...draft, projectName: e.target.value })}
          />
        </label>
        <label className="exportfield">
          <span>Estimate</span>
          <input
            value={draft.estimateName}
            onChange={(e) => setDraft({ ...draft, estimateName: e.target.value })}
          />
        </label>
        <label className="exportfield">
          <span>Subtitle</span>
          <input
            value={draft.subtitle}
            placeholder="Issued for pricing · Rev 2"
            onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
          />
        </label>
      </section>

      <section className="wssection">
        <h3><span className="grow">Scopes</span><span>{draft.scopes.length}</span></h3>
        {draft.scopes.length === 0 && (
          <div className="wsmuted">This estimate has no scopes, so there is nothing to export yet.</div>
        )}
        {draft.scopes.map((s) => (
          <div key={s.id} className="exportscope">
            <div className="exportscopehead">
              <span className="scopedot" style={{ background: s.color }} aria-hidden="true" />
              <input
                className="exportscopename"
                value={s.label}
                aria-label="Scope name"
                onChange={(e) => patchScope(s.id, { label: e.target.value })}
              />
              <input
                className="exportscopeproduct"
                value={s.product}
                aria-label="Product"
                onChange={(e) => patchScope(s.id, { product: e.target.value })}
              />
            </div>
            <div className="exportlines">
              {s.quantities.map((q) => (
                <div key={`q-${q.label}`} className="exportline">
                  <span className="grow">{q.label}</span>
                  <span className="exportqty">{q.quantity.toLocaleString('en-US', { maximumFractionDigits: 1 })}</span>
                  <span className="wsmuted">{q.unit}</span>
                </div>
              ))}
              {s.components.map((c) => (
                <div key={`c-${c.label}`} className={`exportline${c.confidence === 'verified' ? '' : ' flagged'}`}>
                  <span className="grow">{c.label}</span>
                  <span className="exportqty">
                    {c.quantity === null ? '—' : c.quantity.toLocaleString('en-US', { maximumFractionDigits: 1 })}
                  </span>
                  <span className="wsmuted">{c.unit}</span>
                </div>
              ))}
              {s.quantities.length === 0 && s.components.length === 0 && (
                <div className="exportline wsmuted">No takeoff yet</div>
              )}
            </div>
            <textarea
              className="exportnote"
              value={s.note}
              rows={1}
              placeholder="Note for the client, if any"
              aria-label={`Note for ${s.label}`}
              onChange={(e) => patchScope(s.id, { note: e.target.value })}
            />
          </div>
        ))}
      </section>

      <div className="exportactions">
        <button className="primarybtn" onClick={() => void savePdf()} disabled={busy !== null}>
          <Glyph icon={DocumentPdf} role="inline" /> {busy === null ? 'Save PDF' : 'Saving…'}
        </button>
        <button className="ghostbtn" onClick={() => void saveCsv()} disabled={busy !== null}>
          <Glyph icon={FileText} role="inline" /> Save CSV
        </button>
        <button className="ghostbtn" onClick={() => void copyTsv()} disabled={busy !== null}>
          <Glyph icon={Copy} role="inline" /> {copied ? 'Copied' : 'Copy TSV'}
        </button>
      </div>
      <div className="exportstatus" role="status">
        {problem !== null
          ? <span className="exportproblem">{problem}</span>
          : busy !== null
            ? busy
            : saved !== null
              ? saved
              : `${lines} line${lines === 1 ? '' : 's'} · the PDF adds a picture of every sheet with takeoff`}
      </div>
    </div>
  )
}
