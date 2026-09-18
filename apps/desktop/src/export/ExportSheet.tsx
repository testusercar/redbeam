/**
 * The moment before an estimate leaves the app.
 *
 * Aaron: "At the time of export, give the estimator the opportunity to edit
 * the estimate name, project name, and scope data before exporting, in case
 * there's anything wrong or anything needs to be cleaned up for client
 * presentation." So this is a page in the estimates sidebar, not a save
 * dialog: the cover is fields, a note can be added per scope, what is typed
 * here goes into every format, and nothing here writes back to the project —
 * a client name for the cover is not a reason to rename the round.
 *
 * Built to the approved board (docs/design/estimates-sidebar-2026-09-18):
 * the same header block as every other surface, Save PDF in the accent slot,
 * CSV and TSV in ⋯, scopes as the same 44px rows the round uses, notes opt-in,
 * and a scope with no takeoff greyed and left out of what is written.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useReturnFocus } from '../returnFocus.js'
import { Copy, Ellipsis, FileText, Glyph, X } from '../shell/icons.js'
import { estimateToCsv, estimateToTsv, exportFileName, type EstimateExport, type ExportScope } from './estimateExport.js'
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

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })

/**
 * A scope with nothing measured has no line to print. A component with no
 * quantity is the bill's "needs a direction" placeholder, not a part.
 */
export const hasTakeoff = (s: ExportScope) => s.quantities.length > 0 || s.components.some((c) => c.quantity !== null)

/** What is written: the draft, dated, without the scopes that have nothing. */
export function toWrite(draft: EstimateExport): EstimateExport {
  return { ...draft, generatedAt: new Date(), scopes: draft.scopes.filter(hasTakeoff) }
}

export function ExportSheet({ initial, onSavePdf, onClose }: ExportSheetProps) {
  useReturnFocus(true)
  const [draft, setDraft] = useState<EstimateExport>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  /** What the last save did — the path it went to, or that it was cancelled. */
  const [saved, setSaved] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  /** Scopes whose note field is open. A note is opt-in: most scopes have none. */
  const [noting, setNoting] = useState<Set<string>>(() => new Set(initial.scopes.filter((s) => s.note !== '').map((s) => s.id)))
  const firstField = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { firstField.current?.focus(); firstField.current?.select() }, [])
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (menuRef.current !== null && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [menuOpen])

  const patchScope = useCallback((id: string, patch: Partial<ExportScope>) => {
    setDraft((d) => ({ ...d, scopes: d.scopes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  }, [])

  const savePdf = async () => {
    if (busy !== null) return
    setBusy('Preparing the document…')
    setProblem(null)
    setSaved(null)
    try {
      const result = await onSavePdf(toWrite(draft), setBusy)
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
    const e = toWrite(draft)
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
      await navigator.clipboard.writeText(estimateToTsv(toWrite(draft)))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setProblem('The clipboard refused the text. Save the CSV instead.')
    }
  }

  const included = draft.scopes.filter(hasTakeoff)
  const lines = included.reduce((n, s) => n + s.quantities.length + s.components.length, 0)

  return (
    <div className="es-export" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="es-exportbar">
        <span className="es-exporttitle">Export {initial.estimateName}</span>
        <button className="es-btn subtle icon" title="Close" aria-label="Close" onClick={onClose}>
          <Glyph icon={X} role="row" />
        </button>
      </div>

      <div className="es-hd nodot" ref={menuRef}>
        <div className="es-hdtext">
          <div className="es-hdname">{included.length} scope{included.length === 1 ? '' : 's'} · {lines} line{lines === 1 ? '' : 's'}</div>
          <div className="es-hdsub">The PDF adds an image per sheet</div>
        </div>
        <button className="es-btn primary" onClick={() => void savePdf()} disabled={busy !== null || included.length === 0}>
          {busy === null ? 'Save PDF' : 'Saving…'}
        </button>
        <button
          className={menuOpen ? 'es-btn subtle icon on' : 'es-btn subtle icon'}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="More ways out"
          title="More ways out"
          onClick={() => setMenuOpen((v) => !v)}
        ><Glyph icon={Ellipsis} role="row" /></button>
        {menuOpen && (
          <div className="dockmenu es-menu" role="menu" aria-label="More ways out" onClick={() => setMenuOpen(false)}>
            <button className="menuitem" role="menuitem" disabled={busy !== null || included.length === 0} onClick={() => void saveCsv()}>
              <Glyph icon={FileText} role="row" /><span className="grow">Save CSV…</span>
            </button>
            <button className="menuitem" role="menuitem" disabled={included.length === 0} onClick={() => void copyTsv()}>
              <Glyph icon={Copy} role="row" /><span className="grow">{copied ? 'Copied' : 'Copy TSV'}</span>
            </button>
          </div>
        )}
      </div>

      {(problem !== null || busy !== null || saved !== null || copied) && (
        <div className={`es-ib ${problem !== null ? 'warn' : saved !== null || copied ? 'good' : 'info'}`} role="status">
          <span className="es-ibic" aria-hidden="true">{problem !== null ? '!' : saved !== null || copied ? '✓' : 'i'}</span>
          <span className="es-ibtext">{problem ?? busy ?? (copied ? 'Copied as TSV.' : saved)}</span>
          {problem !== null && (
            <button className="es-btn subtle icon tiny" aria-label="Dismiss" onClick={() => setProblem(null)}><Glyph icon={X} role="small" /></button>
          )}
        </div>
      )}

      <h3 className="es-sect">Cover<span className="es-sp" /></h3>
      <div className="es-sg one">
        <label className="es-k" htmlFor="export-project">Project</label>
        <span className="es-fieldwrap">
          <input
            id="export-project"
            ref={firstField}
            className="es-field"
            value={draft.projectName}
            onChange={(e) => setDraft({ ...draft, projectName: e.target.value })}
          />
        </span>
        <label className="es-k" htmlFor="export-estimate">Estimate</label>
        <span className="es-fieldwrap">
          <input
            id="export-estimate"
            className="es-field"
            value={draft.estimateName}
            onChange={(e) => setDraft({ ...draft, estimateName: e.target.value })}
          />
        </span>
        <label className="es-k" htmlFor="export-subtitle">Subtitle</label>
        <span className="es-fieldwrap">
          <input
            id="export-subtitle"
            className="es-field"
            value={draft.subtitle}
            placeholder="Issued for pricing · Rev 2"
            onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
          />
        </span>
      </div>

      <h3 className="es-sect">
        Scopes<span className="es-n">{included.length === draft.scopes.length ? draft.scopes.length : `${included.length} of ${draft.scopes.length}`}</span>
        <span className="es-sp" />
      </h3>
      {draft.scopes.length === 0 && (
        <div className="es-muted pad">This estimate has no scopes, so there is nothing to export yet.</div>
      )}
      {draft.scopes.map((s) => {
        const inExport = hasTakeoff(s)
        const parts = s.components.length
        const meta = inExport
          ? [...s.quantities.map((q) => `${fmt(q.quantity)} ${q.unit}`), `${parts} part${parts === 1 ? '' : 's'}`].join(' · ')
          : 'No takeoff'
        const open = noting.has(s.id)
        return (
          <div key={s.id} className={inExport ? 'es-exscope' : 'es-exscope off'}>
            <div className="es-row static">
              <span className="es-dot" style={{ background: s.color }} aria-hidden="true" />
              <span className="es-rowtext">
                <span className="es-rowname">{s.label} <span className="es-rowproduct">{s.product}</span></span>
                <span className={inExport ? 'es-rowmeta mono' : 'es-rowmeta'}>{meta}</span>
              </span>
              {inExport
                ? (
                  <button
                    className="es-link"
                    aria-expanded={open}
                    onClick={() => setNoting((n) => {
                      const next = new Set(n)
                      if (next.has(s.id)) { next.delete(s.id); patchScope(s.id, { note: '' }) } else next.add(s.id)
                      return next
                    })}
                  >{open ? 'Note ▾' : '+ Note'}</button>
                  )
                : <span className="es-aside">not in the export</span>}
            </div>
            {inExport && open && (
              <textarea
                className="es-note"
                value={s.note}
                rows={2}
                autoFocus={s.note === ''}
                placeholder="Note for the client"
                aria-label={`Note for ${s.label}`}
                onChange={(e) => patchScope(s.id, { note: e.target.value })}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
