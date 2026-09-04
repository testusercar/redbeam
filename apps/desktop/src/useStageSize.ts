/**
 * Canvas sizing: fill the window, and render at DEVICE pixels.
 *
 * Two bugs this exists to fix, both reported as "the visual is a little blurry
 * and muddy":
 *
 * 1. **No devicePixelRatio.** The canvases were created at a fixed
 *    `width={1180} height={780}` backing store and displayed at the same CSS
 *    size. On any display scaled above 100% — Windows commonly runs 125% or
 *    150% — the browser upscales that bitmap to physical pixels, and an
 *    upscaled raster of a line drawing is exactly "blurry and muddy". Nothing
 *    to do with which PDF engine produced it.
 *
 * 2. **A fixed viewport.** 1180x780 regardless of window size, so a large
 *    monitor got a small drawing area with dead space around it.
 *
 * The rule: CSS size is layout, backing-store size is CSS size times DPR, and
 * the viewport passed to the renderer is in CSS pixels so all the existing
 * hit-testing and geometry stays in one coordinate space. Only the final
 * blit is scaled.
 */
import { useEffect, useRef, useState } from 'react'

export interface StageSize {
  /** Layout size in CSS pixels — what the viewport and hit-testing use. */
  width: number
  height: number
  /** Physical pixels per CSS pixel. Backing store is width*dpr by height*dpr. */
  dpr: number
}

/*
 * The stage's size is the stage's size.
 *
 * This was a 320x240 floor, on the reasoning that the layout is unusable below
 * it — but clamping does not make a 280px cell usable, it makes the numbers
 * wrong. Everything downstream treats this as the stage's real dimensions:
 * the viewport clamp centres the sheet in it, hit-testing maps pointer
 * positions through it, and the canvas takes its CSS size from it. Reporting
 * 320 for a 280px cell centred the sheet 20px off, sent clicks near the right
 * edge to coordinates outside the page, and left the canvas overhanging the
 * workspace pane by the difference.
 *
 * The floor that remains exists only so a collapsed or unmounted cell cannot
 * produce a zero-sized backing store, which some canvas paths treat as an
 * error. No real cell is ever this small.
 */
const MIN_W = 1
const MIN_H = 1

/**
 * Cap the backing store so an extreme DPR cannot allocate an absurd bitmap.
 * 3 covers every shipping display; beyond that the cost is real and the
 * visible gain is not.
 */
const MAX_DPR = 3

export function useStageSize(ref: React.RefObject<HTMLElement | null>): StageSize {
  const [size, setSize] = useState<StageSize>(() => ({
    width: MIN_W,
    height: MIN_H,
    dpr: clampDpr(typeof window === 'undefined' ? 1 : window.devicePixelRatio),
  }))
  // Compared before setting state: ResizeObserver fires on every frame of a
  // window drag, and re-rendering the whole workspace each time makes the
  // resize itself feel broken.
  const last = useRef<StageSize | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = () => {
      const next = measureStage(el.getBoundingClientRect(), window.devicePixelRatio)
      const prev = last.current
      if (prev && prev.width === next.width && prev.height === next.height && prev.dpr === next.dpr) {
        return
      }
      last.current = next
      setSize(next)
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)

    // devicePixelRatio changes when the window moves to a monitor with a
    // different scale factor, and that fires no resize event. A media query on
    // the current ratio is the only reliable notification.
    let mq: MediaQueryList | null = null
    const onDprChange = () => { measure(); attachDprWatch() }
    const attachDprWatch = () => {
      mq?.removeEventListener('change', onDprChange)
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      mq.addEventListener('change', onDprChange)
    }
    attachDprWatch()

    return () => {
      ro.disconnect()
      mq?.removeEventListener('change', onDprChange)
    }
  }, [ref])

  return size
}

/**
 * A rect and a device ratio in, a stage size out.
 *
 * Split out of the observer so the part with a rule in it can be tested
 * without a layout engine: the rule is that the reported width IS the measured
 * width, and the floor only stops a collapsed cell producing a zero-sized
 * backing store.
 */
export function measureStage(rect: { width: number, height: number }, rawDpr: number): StageSize {
  return {
    width: Math.max(MIN_W, Math.round(rect.width)),
    height: Math.max(MIN_H, Math.round(rect.height)),
    dpr: clampDpr(rawDpr),
  }
}

export function clampDpr(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  return Math.min(MAX_DPR, raw)
}

/**
 * Size a canvas for a stage: CSS pixels for layout, device pixels for the
 * backing store, and a transform so drawing code keeps working in CSS pixels.
 *
 * Returns true when the canvas was actually resized, because resizing a canvas
 * CLEARS it — the caller has to repaint, and doing that unconditionally on
 * every frame would throw away the tiles it just drew.
 */
/**
 * Size one canvas to the stage. Returns true when it actually changed.
 *
 * CALLERS: when sizing more than one canvas, call this once per canvas and
 * combine the results AFTERWARDS. `a() || b()` short-circuits — b never runs
 * once a has resized — which left the markup overlay stuck at a stale size
 * while the raster tracked the stage. The visible symptom was a markup whose
 * fill stopped dead at a vertical line partway across the viewport: the
 * overlay's backing store simply ended there.
 */
export function sizeCanvas(canvas: HTMLCanvasElement | null, s: StageSize): boolean {
  if (!canvas) return false
  const w = Math.round(s.width * s.dpr)
  const h = Math.round(s.height * s.dpr)
  if (canvas.width === w && canvas.height === h) return false
  canvas.width = w
  canvas.height = h
  canvas.style.width = `${s.width}px`
  canvas.style.height = `${s.height}px`
  const ctx = canvas.getContext('2d')
  // setTransform, not scale: scale COMPOUNDS, so re-running this after a
  // resize would square the ratio and draw everything at 2.25x on a 1.5 display.
  ctx?.setTransform(s.dpr, 0, 0, s.dpr, 0, 0)
  return true
}
