/**
 * Report a bug: one small acrylic card over whatever was on screen.
 *
 * Reached from Settings (the header and About) and from the prompt
 * ("Report a bug…", and Shift+Enter on the prompt's own quick report). It is
 * a dialog because a report is the one thing in the app that is ABOUT the
 * app rather than the takeoff, and the person needs to keep looking at the
 * thing that went wrong while they describe it; the card is small and the
 * drawing stays visible around it.
 *
 * The card asks three things — what kind, what happened in a sentence, and
 * anything else — and offers a picture: the drawing as it is on screen, one
 * click, or whatever is pasted or dropped. What goes with it is shown, not
 * described: the version and machine as chips, and "where you were" as the
 * exact line that will be sent, with a switch to leave it out.
 *
 * A draft outlives the card. Closing it, or a send that fails, keeps every
 * word for the next time it opens; only a sent report clears it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { useReturnFocus } from '../returnFocus.js'
import { useFocusTrap } from '../shell/focusTrap.js'
import {
  Bug, Calculator, Camera, Check, ClipboardPaste, Clock, Copy, ErrorCircle, Eye, Glyph, MoreCircle, Send,
  TriangleAlert, X, type Icon,
} from '../shell/icons.js'
import {
  DETAILS_MAX, EMPTY_DRAFT, REPORT_KINDS, SUMMARY_MAX, buildPayload, dataUrlSize, draftProblem, gatherContext,
  imageFileToDataUrl, reportAsText, sendReport, type ReportContext, type ReportDraft, type ReportKind, type SendResult,
} from './report.js'
import './report.css'

const KIND_ICON: Record<ReportKind, Icon> = {
  broke: ErrorCircle, quantity: Calculator, looks: Eye, slow: Clock, other: MoreCircle,
}

/* The draft between openings. Module state, not storage: a report half
   written in one session is not worth resurrecting after a restart. */
let kept: ReportDraft = EMPTY_DRAFT

const CONTACT_KEY = 'redbeam.report.contact'
function rememberedContact(): string {
  try { return localStorage.getItem(CONTACT_KEY) ?? '' } catch { return '' }
}

export interface ReportDialogProps {
  onClose: () => void
  /** "Project · document · sheet", already joined; '' with nothing open. */
  where: string
  /** The drawing on screen as an image, or null when no sheet is drawn. */
  captureView?: (() => string | null) | undefined
  /** Start from this instead of the kept draft — the prompt's quick report, carried over. */
  initial?: Partial<ReportDraft> | undefined
}

type Phase =
  | { kind: 'editing' }
  | { kind: 'sending' }
  | { kind: 'sent'; id: string; filed: 'notion' | 'kept' }
  | { kind: 'failed'; reason: string }

export function ReportDialog({ onClose, where, captureView, initial }: ReportDialogProps) {
  useReturnFocus(true)
  const trap = useFocusTrap<HTMLDivElement>(true)
  const [draft, setDraftState] = useState<ReportDraft>(() => ({
    ...kept,
    contact: kept.contact === '' ? rememberedContact() : kept.contact,
    ...initial,
  }))
  const [ctx, setCtx] = useState<ReportContext | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' })
  const [problem, setProblem] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [dragging, setDragging] = useState(false)
  const summaryRef = useRef<HTMLInputElement>(null)

  const setDraft = useCallback((patch: Partial<ReportDraft>) => {
    setDraftState((d) => {
      const next = { ...d, ...patch }
      kept = next
      return next
    })
    setProblem(null)
    setPhase((p) => (p.kind === 'failed' ? { kind: 'editing' } : p))
  }, [])

  useEffect(() => { void gatherContext(where).then(setCtx) }, [where])
  useEffect(() => { summaryRef.current?.focus() }, [])

  const canCapture = captureView !== undefined
  const kind = REPORT_KINDS.find((k) => k.value === draft.kind) ?? REPORT_KINDS[0]!

  const send = useCallback(async () => {
    if (phase.kind === 'sending' || phase.kind === 'sent') return
    const why = draftProblem(draft)
    if (why !== null) { setProblem(why); summaryRef.current?.focus(); return }
    const context = ctx ?? await gatherContext(where)
    setPhase({ kind: 'sending' })
    try { localStorage.setItem(CONTACT_KEY, draft.contact.trim()) } catch { /* private window */ }
    const result: SendResult = await sendReport(buildPayload(draft, context))
    if (result.ok) {
      kept = { ...EMPTY_DRAFT, contact: draft.contact }
      setPhase({ kind: 'sent', id: result.id, filed: result.filed })
    } else {
      setPhase({ kind: 'failed', reason: result.reason })
    }
  }, [ctx, draft, phase.kind, where])

  const copy = useCallback(async () => {
    const context = ctx ?? await gatherContext(where)
    try {
      await navigator.clipboard.writeText(reportAsText(buildPayload(draft, context)))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setProblem('The clipboard refused the report.')
    }
  }, [ctx, draft, where])

  /*
   * Escape closes the card and nothing under it: Settings also listens for
   * Escape, and one press should not take both away. Ctrl+Enter sends from
   * any field, as it does in every mail client.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
        onClose()
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); e.stopPropagation()
        if (phase.kind === 'sent') onClose()
        else void send()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, phase.kind, send])

  const takeImage = useCallback(async (file: Blob | null) => {
    if (file === null) return
    const url = await imageFileToDataUrl(file)
    if (url === null) setProblem('That image could not be read. Try a PNG or a JPEG.')
    else setDraft({ screenshot: url })
  }, [setDraft])

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))
    if (item === undefined) return
    e.preventDefault()
    void takeImage(item.getAsFile())
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragging(false)
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
    if (file !== undefined) void takeImage(file)
  }
  const pasteFromClipboard = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type !== undefined) { await takeImage(await item.getType(type)); return }
      }
      setProblem('There is no picture on the clipboard. Win+Shift+S takes one.')
    } catch {
      setProblem('Press Ctrl+V to paste a picture.')
    }
  }
  const capture = () => {
    const shot = captureView?.() ?? null
    if (shot === null) setProblem('There is no drawing on screen to capture.')
    else setDraft({ screenshot: shot })
  }

  const machineChip = useMemo(() => {
    if (ctx === null) return '…'
    return [ctx.machine === 'Unknown' ? null : ctx.machine, ctx.os === '' ? null : ctx.os].filter(Boolean).join(' · ') || 'This PC'
  }, [ctx])

  const summaryLeft = SUMMARY_MAX - draft.summary.length
  const busy = phase.kind === 'sending'

  return createPortal(
    <div
      className="rpt"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget && phase.kind !== 'sending') onClose() }}
    >
      <div
        className={`rpt-card${phase.kind === 'sent' ? ' done' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rpt-title"
        ref={trap}
        onPaste={onPaste}
        onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragging(true) } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
        onDrop={onDrop}
      >
        {phase.kind === 'sent' ? (
          <div className="rpt-sent" role="status">
            <span className="rpt-sentmark" aria-hidden="true"><Glyph icon={Check} role="empty" /></span>
            <h2 id="rpt-title">Report sent</h2>
            <p>
              Thank you. It is filed{phase.filed === 'notion' ? ' in the REDBEAM reports list' : ''} as
              {' '}<span className="rpt-id selectable">#{phase.id.slice(0, 8)}</span>, with
              {draft.screenshot === null ? ' no picture' : ' the picture'} and version {ctx?.version}.
            </p>
            <div className="rpt-actions">
              <span className="grow" />
              <button type="button" className="rpt-btn primary" onClick={onClose} autoFocus>Done</button>
            </div>
          </div>
        ) : (
          <>
            <header className="rpt-head">
              <span className="rpt-mark" aria-hidden="true"><Glyph icon={Bug} role="inline" /></span>
              <div className="rpt-headtext">
                <h2 id="rpt-title">Report a bug</h2>
                <p>Goes to the people who maintain REDBEAM, with this copy’s version.</p>
              </div>
              <button type="button" className="rpt-x" aria-label="Close" title="Close (Esc)" onClick={onClose}>
                <Glyph icon={X} role="small" />
              </button>
            </header>

            <div className="rpt-body">
              <div className="rpt-kinds" role="radiogroup" aria-label="What kind of problem">
                {REPORT_KINDS.map((k) => {
                  const on = k.value === draft.kind
                  return (
                    <button
                      key={k.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`rpt-kind${on ? ' on' : ''}`}
                      title={k.hint}
                      onClick={() => setDraft({ kind: k.value })}
                    >
                      <Glyph icon={KIND_ICON[k.value]} role="inline" filled={on} />
                      <span>{k.label}</span>
                    </button>
                  )
                })}
              </div>

              <label className="rpt-field">
                <span className="rpt-label">What happened?</span>
                <input
                  ref={summaryRef}
                  className="rpt-input"
                  value={draft.summary}
                  maxLength={SUMMARY_MAX + 40}
                  placeholder={kind.placeholder}
                  onChange={(e) => setDraft({ summary: e.target.value })}
                  aria-invalid={problem !== null && draft.summary.trim() === ''}
                />
                {summaryLeft < 40 && (
                  <span className={`rpt-count${summaryLeft < 0 ? ' over' : ''}`}>{summaryLeft}</span>
                )}
              </label>

              <label className="rpt-field">
                <span className="rpt-label">Anything that would help us see it <i>optional</i></span>
                <textarea
                  className="rpt-input rpt-details"
                  value={draft.details}
                  rows={4}
                  maxLength={DETAILS_MAX}
                  placeholder="What you did just before, what you expected, and what you saw instead."
                  onChange={(e) => setDraft({ details: e.target.value })}
                />
              </label>

              <div className="rpt-field">
                <span className="rpt-label">Picture <i>optional</i></span>
                {draft.screenshot === null ? (
                  <div className={`rpt-shot empty${dragging ? ' drag' : ''}`}>
                    {canCapture && (
                      <button type="button" className="rpt-btn" onClick={capture}>
                        <Glyph icon={Camera} role="inline" /> Capture the drawing
                      </button>
                    )}
                    <button type="button" className="rpt-btn" onClick={() => void pasteFromClipboard()}>
                      <Glyph icon={ClipboardPaste} role="inline" /> Paste
                    </button>
                    <span className="rpt-shothint">or drop an image here · <kbd>Win</kbd><kbd>Shift</kbd><kbd>S</kbd> takes one</span>
                  </div>
                ) : (
                  <div className={`rpt-shot full${dragging ? ' drag' : ''}`}>
                    <img src={draft.screenshot} alt="The picture that will be sent" />
                    <div className="rpt-shotmeta">
                      <span>{dataUrlSize(draft.screenshot)} · sent with the report</span>
                      <button type="button" className="rpt-link" onClick={() => setDraft({ screenshot: null })}>Remove</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rpt-sends" aria-label="Sent with the report">
                <div className="rpt-chips">
                  <span className="rpt-chip">REDBEAM {ctx?.version ?? '…'}</span>
                  <span className="rpt-chip">{machineChip}</span>
                </div>
                {where !== '' && (
                  <label className={`rpt-where${draft.includeWhere ? '' : ' off'}`}>
                    <input
                      type="checkbox"
                      checked={draft.includeWhere}
                      onChange={(e) => setDraft({ includeWhere: e.target.checked })}
                    />
                    <span className="rpt-whereline">
                      <span className="rpt-wherelabel">Where you were</span>
                      <span className="rpt-wheretext selectable" title={where}>{where}</span>
                    </span>
                  </label>
                )}
                <label className="rpt-from">
                  <span className="rpt-wherelabel">Your name</span>
                  <input
                    className="rpt-input slim"
                    value={draft.contact}
                    maxLength={120}
                    placeholder="So we know who to ask (optional)"
                    onChange={(e) => setDraft({ contact: e.target.value })}
                  />
                </label>
              </div>
            </div>

            {phase.kind === 'failed' && (
              <div className="rpt-bar caution" role="alert">
                <Glyph icon={TriangleAlert} role="inline" />
                <span className="grow">{phase.reason} Your report is kept here.</span>
                <button type="button" className="rpt-link" onClick={() => void copy()}>
                  <Glyph icon={copied ? Check : Copy} role="row" /> {copied ? 'Copied' : 'Copy it instead'}
                </button>
              </div>
            )}

            <footer className="rpt-actions">
              <span className={`rpt-status${problem !== null ? ' problem' : ''}`} role={problem !== null ? 'alert' : undefined}>
                {problem ?? (busy ? 'Sending…' : <><kbd>Ctrl</kbd><kbd>Enter</kbd> sends</>)}
              </span>
              <span className="grow" />
              <button type="button" className="rpt-btn subtle" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="rpt-btn primary" onClick={() => void send()} disabled={busy}>
                <Glyph icon={Send} role="inline" /> {phase.kind === 'failed' ? 'Try again' : busy ? 'Sending' : 'Send report'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
