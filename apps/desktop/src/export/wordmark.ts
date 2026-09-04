/**
 * The Maxxit wordmark, from `MAXXIT-logo-2021.pdf` by way of the brand skill.
 *
 * Outlined glyph paths with `fill="currentColor"`, so it takes the colour of
 * whatever it sits in and is never recoloured by hand. Inlined rather than
 * linked because a takeoff report is emailed, and a logo that arrives as a
 * broken image is worse than no logo.
 *
 * NEVER redraw, recolour, stretch or outline this. If the logo is reissued,
 * re-derive it from the new PDF.
 */
export const MAXXIT_WORDMARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 432.00 68.89" fill="currentColor" role="img" aria-label="MAXXIT">
  <path d="M 343.637 0.000 L 343.637 68.848 L 360.816 68.848 L 360.816 0.000 Z M 343.637 0.000 "/>
  <path d="M 117.023 0.000 L 86.180 68.848 L 104.945 68.848 L 125.270 24.324 L 145.488 68.848 L 164.355 68.848 L 133.516 0.000 "/>
  <path d="M 309.676 0.039 L 295.730 20.957 L 280.625 0.039 L 260.777 0.039 L 284.387 34.105 L 260.266 68.891 L 280.406 68.891 L 295.227 47.082 L 310.051 68.891 L 331.430 68.891 L 295.746 20.973 L 315.121 20.973 L 329.691 0.039 "/>
  <path d="M 226.137 0.039 L 212.191 20.957 L 197.090 0.039 L 177.238 0.039 L 200.848 34.105 L 176.727 68.891 L 196.867 68.891 L 211.691 47.082 L 226.512 68.891 L 247.895 68.891 L 212.207 20.973 L 231.586 20.973 L 246.156 0.039 "/>
  <path d="M 374.480 0.000 L 374.480 16.184 L 394.605 16.184 L 394.605 68.848 L 411.875 68.848 L 411.875 33.129 L 394.629 16.180 L 432.000 16.184 L 432.000 0.000 "/>
  <path d="M 54.789 0.180 L 36.285 25.570 L 17.781 0.180 L 0.000 0.180 L 0.000 68.848 L 17.270 68.848 L 17.270 28.242 L 33.488 50.391 L 38.520 50.391 L 55.207 28.168 L 55.207 68.848 L 72.477 68.848 L 72.477 45.520 L 55.410 28.062 L 72.477 28.062 L 72.477 0.180 "/>
</svg>`

/** Its aspect ratio, 6.27 : 1, so a width is enough to place it. */
export const WORDMARK_ASPECT = 432 / 68.89
