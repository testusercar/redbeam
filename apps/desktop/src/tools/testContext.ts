/**
 * A recording stand-in for CanvasRenderingContext2D, for testing draw helpers.
 *
 * Test-only. There is no DOM under vitest, and pulling in a headless 2D
 * implementation to assert "did it stroke the tick" would be a much larger
 * dependency than the assertion is worth. This records the call sequence
 * instead, which is what the draw tests actually check.
 */

export interface RecordedCall {
  name: string
  args: unknown[]
}

export interface RecordingContext {
  ctx: CanvasRenderingContext2D
  calls: RecordedCall[]
  /** Every string passed to fillText / strokeText, in order. */
  text: string[]
}

const METHODS = [
  'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'rect',
  'arc', 'fill', 'stroke', 'fillText', 'strokeText', 'setLineDash', 'translate',
  'rotate', 'scale', 'clip', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse',
] as const

export function recordingContext(charWidth = 6): RecordingContext {
  const calls: RecordedCall[] = []
  const text: string[] = []
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * charWidth }),
  }
  for (const name of METHODS) {
    target[name] = (...args: unknown[]) => {
      calls.push({ name, args })
      if (name === 'fillText' || name === 'strokeText') text.push(String(args[0]))
    }
  }
  // style properties are plain assignments; let them land on the object
  return { ctx: target as unknown as CanvasRenderingContext2D, calls, text }
}
