/**
 * Page navigation: a thumbnail strip plus a go-to-page control.
 *
 * Thumbnails come from the viewer's own cache, which is separate from the tile
 * cache and gated behind the same quiet window — a strip never competes with
 * the page under the cursor. This component asks for them and forgets; the
 * viewer decides when to actually rasterize.
 */
import { useEffect, useRef, useState } from 'react'

export interface PageStripProps {
  pageCount: number
  current: number
  /** Ask the viewer for a thumbnail. Returns one immediately if cached. */
  requestThumbnail: (index: number, width?: number) => ImageBitmap | undefined
  onGoTo: (index: number) => void
  /** Page labels where a document has them; falls back to the number. */
  labels?: Record<number, string>
  thumbWidth?: number
  /** Pages either side of the current one to load without waiting for scroll. */
  eagerRadius?: number
  /**
   * What to say when there are no pages. The strip used to render nothing at
   * all, which in a pane titled Thumbnails is a blank with no explanation —
   * and the caller is the one who knows whether that blank is "no document"
   * or "still opening".
   */
  empty?: string
}

export function PageStrip({
  pageCount,
  current,
  requestThumbnail,
  onGoTo,
  labels,
  thumbWidth = 96,
  eagerRadius = 6,
  empty,
}: PageStripProps) {
  const [entry, setEntry] = useState('')
  const stripRef = useRef<HTMLDivElement>(null)

  // Keep the active page in view when it changes from outside (search, undo
  // navigating to its target).
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-page="${current}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [current])

  if (pageCount <= 0) {
    return empty === undefined ? null : <div className="paneempty pending">{empty}</div>
  }

  const commitEntry = () => {
    const n = Number.parseInt(entry, 10)
    setEntry('')
    // The control is 1-based because that is how an estimator refers to a
    // sheet; page_number and the viewer index are both 0-based.
    if (Number.isFinite(n) && n >= 1 && n <= pageCount) onGoTo(n - 1)
  }

  return (
    <div className="pagestrip">
      <div className="pagenav">
        <button onClick={() => onGoTo(Math.max(0, current - 1))} disabled={current <= 0} title="Previous page">‹</button>
        <input
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitEntry() }}
          onBlur={() => setEntry('')}
          placeholder={String(current + 1)}
          aria-label={`Go to page (1 to ${pageCount})`}
          size={4}
        />
        <span className="muted">/ {pageCount}</span>
        <button
          onClick={() => onGoTo(Math.min(pageCount - 1, current + 1))}
          disabled={current >= pageCount - 1}
          title="Next page"
        >›</button>
      </div>

      <div className="thumbs" ref={stripRef}>
        {Array.from({ length: pageCount }, (_, i) => (
          <Thumb
            key={i}
            index={i}
            active={i === current}
            label={labels?.[i] ?? String(i + 1)}
            width={thumbWidth}
            eager={Math.abs(i - current) <= eagerRadius}
            request={requestThumbnail}
            onGoTo={onGoTo}
          />
        ))}
      </div>
    </div>
  )
}

function Thumb({
  index, active, label, width, eager, request, onGoTo,
}: {
  index: number
  active: boolean
  label: string
  width: number
  /** Load without waiting to be scrolled into view. */
  eager: boolean
  request: (index: number, width?: number) => ImageBitmap | undefined
  onGoTo: (index: number) => void
}) {
  const hostRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const draw = () => {
      if (cancelled) return
      const bmp = request(index, width)
      if (!bmp) {
        // Queued behind visible tiles by design; poll rather than block.
        timer = setTimeout(draw, 300)
        return
      }
      const c = canvasRef.current
      if (!c) return
      c.width = bmp.width
      c.height = bmp.height
      c.getContext('2d')?.drawImage(bmp, 0, 0)
      setReady(true)
    }

    // Pages near the current one load straight away; the rest wait until they
    // are scrolled toward.
    //
    // Requesting all of them up front is what a naive strip does, and on a
    // 75-page 97MB set it queued 75 fit-zoom rasterizations — nothing is culled
    // at fit zoom, so each is expensive — and the tiles for the page the user
    // was looking at waited behind the lot. Measured: ~30s to first paint,
    // versus ~2s once the flood is gone.
    //
    // The eager window matters beyond speed: an IntersectionObserver never
    // fires in a zero-size viewport (a hidden window, a collapsed pane), and a
    // strip that silently renders nothing there would be worse than one that
    // is merely slow. The observer is the optimisation; the window is the
    // guarantee.
    if (eager) { draw(); return () => { cancelled = true; if (timer) clearTimeout(timer) } }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          draw()
        }
      },
      { root: host.closest('.thumbs'), rootMargin: '200px' },
    )
    io.observe(host)

    return () => { cancelled = true; io.disconnect(); if (timer) clearTimeout(timer) }
  }, [index, width, eager, request])

  return (
    <button
      ref={hostRef}
      className={`thumb${active ? ' active' : ''}`}
      data-page={index}
      onClick={() => onGoTo(index)}
      title={`Page ${label}`}
    >
      <canvas ref={canvasRef} style={{ width, minHeight: ready ? undefined : 40, opacity: ready ? 1 : 0 }} />
      <span>{label}</span>
    </button>
  )
}
