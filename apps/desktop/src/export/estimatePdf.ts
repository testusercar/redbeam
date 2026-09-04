/**
 * The estimate as a PDF somebody can put in front of a client.
 *
 * Built with pdf-lib rather than printed from HTML because the app has no
 * print path — a WebView2 print dialog is not an export — and because a PDF
 * whose layout depends on which browser rendered it is not the same PDF
 * twice. Every page here is placed by hand, in points.
 *
 * BRANDING follows the Maxxit brand skill:
 *
 *  - Maxxit Black `#181A1D` is the ground and `#EDEDED` the type.
 *  - ONE accent, AERO:Form Orange, for ONE meaning: "not ready to send" —
 *    an unverified or blocked line. Scope colours identify scopes, on the
 *    pictures and in their 8px dots, and nowhere else.
 *  - The wordmark top-right at 168px on content pages, larger and left on
 *    the cover. Never redrawn: it is the brand's own outlined paths.
 *  - Gotham and Whitney are licensed and cannot be embedded from here, so
 *    the PDF's standard Helvetica stands in and the footer SAYS SO.
 *  - Sentence-case headlines; uppercase only on tracked kickers.
 *
 * Letter, landscape: a takeoff picture is wider than it is tall.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { MAXXIT_WORDMARK } from './wordmark.js'
import type { EstimateExport, ExportScope } from './estimateExport.js'
import type { TakeoffSnapshot } from './snapshots.js'

const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

const BRAND = {
  black: hex('#181A1D'),
  surface: hex('#1E2126'),
  rule: hex('#2A2F36'),
  ink: hex('#EDEDED'),
  inkDim: hex('#A7ADB4'),
  inkFaint: hex('#7D858E'),
  accent: hex('#CA4139'),
  accentInk: hex('#D25F59'),
} as const

/** Letter landscape, in points. */
const PAGE = { w: 792, h: 612 } as const
/** The brand's 112/96/150 on a 1920 canvas, scaled to a Letter page. */
const M = { left: 46, right: 46, top: 40, bottom: 62 } as const
const FOLIO_Y = 44

/** The wordmark's paths, parsed once. */
const WORDMARK_PATHS = [...MAXXIT_WORDMARK.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]!)
const WORDMARK_BOX = { w: 432, h: 68.89 } as const

export interface EstimatePdfInput {
  estimate: EstimateExport
  snapshots: readonly TakeoffSnapshot[]
  /** Something went wrong producing a picture; said on the page, not hidden. */
  notes?: readonly string[]
}

const fmt = (n: number): string =>
  n >= 100 ? Math.round(n).toLocaleString('en-US') : (Math.round(n * 10) / 10).toLocaleString('en-US')

/** Draw the wordmark with its left edge at `x`, its TOP at `top`, `width` wide. */
function wordmark(page: PDFPage, x: number, top: number, width: number, color: RGB): void {
  const scale = width / WORDMARK_BOX.w
  for (const d of WORDMARK_PATHS) {
    // pdf-lib draws an SVG path with y growing DOWN from the given y, which is
    // what an SVG path expects — but the page's own y grows UP from the foot,
    // so `top`, measured from the head of the page, is turned over here.
    page.drawSvgPath(d, { x, y: PAGE.h - top, scale, color })
  }
}

interface Pen { page: PDFPage; text: PDFFont; display: PDFFont; bold: PDFFont }

function kicker(pen: Pen, x: number, y: number, label: string): void {
  pen.page.drawRectangle({ x, y: y + 3, width: 21, height: 1.2, color: BRAND.accent })
  pen.page.drawText(label.toUpperCase(), {
    x: x + 27, y, size: 7.5, font: pen.bold, color: BRAND.inkDim,
  })
}

function folio(pen: Pen, e: EstimateExport, n: number, total: number): void {
  const { page } = pen
  page.drawLine({
    start: { x: M.left, y: FOLIO_Y + 12 }, end: { x: PAGE.w - M.right, y: FOLIO_Y + 12 },
    thickness: 0.6, color: BRAND.rule,
  })
  page.drawText(`${e.projectName} · ${e.estimateName}`.toUpperCase(), {
    x: M.left, y: FOLIO_Y, size: 6.5, font: pen.text, color: BRAND.inkFaint,
  })
  const right = `${n} / ${total}`
  page.drawText(right, {
    x: PAGE.w - M.right - pen.text.widthOfTextAtSize(right, 6.5) - 6, y: FOLIO_Y,
    size: 6.5, font: pen.text, color: BRAND.inkFaint,
  })
}

function ground(page: PDFPage): void {
  page.drawRectangle({ x: 0, y: 0, width: PAGE.w, height: PAGE.h, color: BRAND.black })
}

/** Break text into lines that fit `width`. Words, not characters. */
function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split(/\r?\n/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter((w) => w !== '')) {
      const next = line === '' ? word : `${line} ${word}`
      if (font.widthOfTextAtSize(next, size) <= width || line === '') line = next
      else { out.push(line); line = word }
    }
    out.push(line)
  }
  return out
}

/** Trim with an ellipsis so a long scope label cannot walk into the next column. */
function fit(font: PDFFont, size: number, text: string, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1)
  return `${t}…`
}

// ------------------------------------------------------------------ pages --

function cover(doc: PDFDocument, fonts: Omit<Pen, 'page'>, e: EstimateExport): PDFPage {
  const page = doc.addPage([PAGE.w, PAGE.h])
  ground(page)
  const pen = { page, ...fonts }
  wordmark(page, M.left, M.top + 6, 200, BRAND.ink)

  kicker(pen, M.left, 330, 'Takeoff estimate')
  const title = wrap(fonts.display, 30, e.projectName, PAGE.w - M.left - M.right)
  let y = 296
  for (const line of title.slice(0, 3)) {
    page.drawText(line, { x: M.left, y, size: 30, font: fonts.display, color: BRAND.ink })
    y -= 36
  }
  page.drawText(e.estimateName, { x: M.left, y: y - 2, size: 14, font: fonts.text, color: BRAND.inkDim })
  if (e.subtitle.trim() !== '') {
    page.drawText(e.subtitle.trim(), { x: M.left, y: y - 22, size: 11, font: fonts.text, color: BRAND.inkDim })
  }

  // The totals, big, the way the brand puts a number on a page.
  const totals = new Map<string, number>()
  for (const s of e.scopes) for (const q of s.quantities) totals.set(q.unit, (totals.get(q.unit) ?? 0) + q.quantity)
  let x = M.left
  const ty = 150
  for (const [unit, quantity] of totals) {
    const n = fmt(quantity)
    page.drawText(n, { x, y: ty, size: 34, font: fonts.display, color: BRAND.ink })
    page.drawText(unit.toUpperCase(), {
      x, y: ty - 16, size: 7.5, font: fonts.bold, color: BRAND.inkFaint,
    })
    x += fonts.display.widthOfTextAtSize(n, 34) + 44
  }
  const scopesLine = `${e.scopes.length} scope${e.scopes.length === 1 ? '' : 's'} · ${e.documents.length} drawing${e.documents.length === 1 ? '' : 's'}`
  page.drawText(scopesLine, { x: M.left, y: ty - 44, size: 9, font: fonts.text, color: BRAND.inkDim })
  return page
}

function summaryPages(doc: PDFDocument, fonts: Omit<Pen, 'page'>, e: EstimateExport): PDFPage[] {
  const pages: PDFPage[] = []
  const cols = { scope: M.left, product: M.left + 150, item: M.left + 270, qty: PAGE.w - M.right - 190, unit: PAGE.w - M.right - 130, standing: PAGE.w - M.right - 90 }
  const rowH = 15
  const top = PAGE.h - M.top - 60
  const bottom = FOLIO_Y + 30

  let page: PDFPage | null = null
  let pen: Pen | null = null
  let y = 0
  const newPage = () => {
    page = doc.addPage([PAGE.w, PAGE.h])
    ground(page)
    pen = { page, ...fonts }
    wordmark(page, PAGE.w - M.right - 84, M.top, 84, BRAND.ink)
    kicker(pen, M.left, PAGE.h - M.top - 6, 'Quantities by scope')
    page.drawText('Every scope, what it measured, and what that orders', {
      x: M.left, y: PAGE.h - M.top - 30, size: 15, font: fonts.display, color: BRAND.ink,
    })
    // header row
    const hy = top
    for (const [label, x] of [['Scope', cols.scope], ['Product', cols.product], ['Item', cols.item], ['Unit', cols.unit], ['Standing', cols.standing]] as const) {
      page.drawText(label.toUpperCase(), { x, y: hy, size: 6.5, font: fonts.bold, color: BRAND.inkFaint })
    }
    page.drawText('QTY', { x: cols.qty + 40 - fonts.bold.widthOfTextAtSize('QTY', 6.5), y: hy, size: 6.5, font: fonts.bold, color: BRAND.inkFaint })
    page.drawLine({ start: { x: M.left, y: hy - 5 }, end: { x: PAGE.w - M.right, y: hy - 5 }, thickness: 0.6, color: BRAND.rule })
    y = hy - 5 - rowH
    pages.push(page)
  }
  newPage()

  const row = (
    scope: ExportScope | null, product: string, item: string, qty: string, unit: string,
    standing: string, flagged: boolean, dot: boolean,
  ) => {
    if (y < bottom) newPage()
    const p = page!
    if (flagged) p.drawRectangle({ x: M.left - 8, y: y - 3, width: 1.5, height: rowH - 2, color: BRAND.accent })
    if (scope !== null) {
      if (dot) p.drawCircle({ x: cols.scope + 3, y: y + 3, size: 3, color: hex(scope.color) })
      p.drawText(fit(fonts.bold, 8.5, scope.label, cols.product - cols.scope - 16), { x: cols.scope + 11, y, size: 8.5, font: fonts.bold, color: BRAND.ink })
    }
    p.drawText(fit(fonts.text, 8, product, cols.item - cols.product - 8), { x: cols.product, y, size: 8, font: fonts.text, color: BRAND.inkDim })
    p.drawText(fit(fonts.text, 8.5, item, cols.qty - cols.item - 8), { x: cols.item, y, size: 8.5, font: fonts.text, color: BRAND.ink })
    p.drawText(qty, { x: cols.qty + 40 - fonts.text.widthOfTextAtSize(qty, 8.5), y, size: 8.5, font: fonts.text, color: BRAND.ink })
    p.drawText(unit, { x: cols.unit, y, size: 8, font: fonts.text, color: BRAND.inkDim })
    p.drawText(fit(fonts.text, 7.5, standing, PAGE.w - M.right - cols.standing), { x: cols.standing, y, size: 7.5, font: fonts.text, color: flagged ? BRAND.accentInk : BRAND.inkDim })
    p.drawLine({ start: { x: M.left, y: y - 4 }, end: { x: PAGE.w - M.right, y: y - 4 }, thickness: 0.4, color: BRAND.rule })
    y -= rowH
  }

  for (const s of e.scopes) {
    let first = true
    if (s.quantities.length === 0 && s.components.length === 0) {
      row(s, s.product, 'No takeoff yet', '—', '', '', false, true)
      first = false
    }
    for (const q of s.quantities) {
      row(first ? s : null, first ? s.product : '', q.label, fmt(q.quantity), q.unit, 'measured', false, first)
      first = false
    }
    for (const c of s.components) {
      const flagged = c.confidence !== 'verified'
      row(first ? s : null, first ? s.product : '', c.label, c.quantity === null ? '—' : fmt(c.quantity), c.unit, c.note ?? c.confidence, flagged, first)
      first = false
    }
    if (s.note.trim() !== '') {
      for (const line of wrap(fonts.text, 7.5, s.note.trim(), PAGE.w - M.right - cols.item)) {
        if (y < bottom) newPage()
        page!.drawText(line, { x: cols.item, y, size: 7.5, font: fonts.text, color: BRAND.inkDim })
        y -= 11
      }
      y -= 4
    }
  }

  const attention = e.scopes.reduce((n, s) => n + s.components.filter((c) => c.confidence !== 'verified').length, 0)
  if (attention > 0) {
    if (y < bottom + 40) newPage()
    const text = `${attention} line${attention === 1 ? '' : 's'} marked. A marked line is blocked or produced by an engine no golden fixture reproduces yet; the quantity may be right, and it has not been proven.`
    let ny = y - 6
    for (const line of wrap(fonts.text, 8, text, PAGE.w - M.left - M.right - 16)) {
      page!.drawText(line, { x: M.left + 8, y: ny, size: 8, font: fonts.text, color: BRAND.inkDim })
      ny -= 11
    }
    page!.drawRectangle({ x: M.left, y: ny + 4, width: 1.5, height: y - ny - 2, color: BRAND.accent })
  }
  void pen
  return pages
}

function picturePages(
  doc: PDFDocument, fonts: Omit<Pen, 'page'>, e: EstimateExport, snapshots: readonly TakeoffSnapshot[],
): Promise<PDFPage[]> {
  return (async () => {
    const pages: PDFPage[] = []
    for (const snap of snapshots) {
      const page = doc.addPage([PAGE.w, PAGE.h])
      ground(page)
      const pen = { page, ...fonts }
      wordmark(page, PAGE.w - M.right - 84, M.top, 84, BRAND.ink)
      kicker(pen, M.left, PAGE.h - M.top - 6, 'Takeoff')
      page.drawText(`${snap.sheetLabel} · ${snap.documentName}`, {
        x: M.left, y: PAGE.h - M.top - 30, size: 15, font: fonts.display, color: BRAND.ink,
      })
      // Legend: the scopes on this picture, each with its dot.
      let lx = M.left
      const ly = PAGE.h - M.top - 48
      for (const s of snap.scopes) {
        page.drawCircle({ x: lx + 3, y: ly + 3, size: 3, color: hex(s.color) })
        page.drawText(s.label, { x: lx + 11, y: ly, size: 8, font: fonts.text, color: BRAND.inkDim })
        lx += fonts.text.widthOfTextAtSize(s.label, 8) + 28
      }

      const img = await doc.embedPng(snap.png)
      const boxW = PAGE.w - M.left - M.right
      const boxH = PAGE.h - M.top - 62 - (FOLIO_Y + 24)
      const scale = Math.min(boxW / img.width, boxH / img.height)
      const w = img.width * scale
      const h = img.height * scale
      const x = M.left + (boxW - w) / 2
      const y = FOLIO_Y + 24 + (boxH - h) / 2
      // The sheet is the one bright object on the page, framed by a rule.
      page.drawRectangle({ x: x - 1, y: y - 1, width: w + 2, height: h + 2, color: BRAND.rule })
      page.drawImage(img, { x, y, width: w, height: h })
      pages.push(page)
    }
    return pages
  })()
}

/** Render the whole document. Returns the PDF bytes. */
export async function renderEstimatePdf(input: EstimatePdfInput): Promise<Uint8Array> {
  const { estimate: e } = input
  const doc = await PDFDocument.create()
  doc.setTitle(`${e.projectName} — ${e.estimateName}`)
  doc.setAuthor('Maxxit')
  doc.setProducer('REDBEAM')
  doc.setCreationDate(e.generatedAt)
  const fonts = {
    text: await doc.embedFont(StandardFonts.Helvetica),
    display: await doc.embedFont(StandardFonts.HelveticaBold),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  }

  cover(doc, fonts, e)
  summaryPages(doc, fonts, e)
  await picturePages(doc, fonts, e, input.snapshots)

  const notes = [...(input.notes ?? [])]
  if (notes.length > 0) {
    const page = doc.addPage([PAGE.w, PAGE.h])
    ground(page)
    kicker({ page, ...fonts }, M.left, PAGE.h - M.top - 6, 'Notes')
    let y = PAGE.h - M.top - 34
    for (const n of notes) {
      for (const line of wrap(fonts.text, 9, `· ${n}`, PAGE.w - M.left - M.right)) {
        page.drawText(line, { x: M.left, y, size: 9, font: fonts.text, color: BRAND.inkDim })
        y -= 13
      }
    }
  }

  // Folios and the last word on the fonts, once every page exists.
  const all = doc.getPages()
  all.forEach((page, i) => {
    const pen = { page, ...fonts }
    folio(pen, e, i + 1, all.length)
  })
  const last = all[all.length - 1]!
  const credit = `${e.generatedAt.toISOString().slice(0, 10)} · ${e.documents.join(' · ')} · Gotham/Whitney substituted with Helvetica`
  last.drawText(fit(fonts.text, 6.5, credit, PAGE.w - M.left - M.right - 60).toUpperCase(), {
    x: M.left, y: FOLIO_Y - 12, size: 6.5, font: fonts.text, color: BRAND.inkFaint,
  })

  return doc.save()
}
