/**
 * An estimate, shaped for leaving the app.
 *
 * Three exports share one model: the branded PDF, a CSV file, and a TSV for
 * the clipboard. Each scope in the round is listed with the quantity its
 * takeoff measured — square feet for an area scope, linear feet for a run,
 * each for a count — and with the components the piece engine produced for
 * it, each line carrying its confidence. What the estimator edits before
 * exporting (the names, the notes) is edited HERE, on this model, so all
 * three outputs say the same thing.
 *
 * Pure: no React, no DOM, no store. `buildEstimateExport` takes what the
 * workspace already holds and the renderers take its result.
 */
import {
  buildBom, PRODUCT_TYPE_LABEL, readProductType,
  type BomLine, type QuantityResult, type Scope, type ScopePieces,
} from '@redbeam/domain'

export interface ExportComponent {
  label: string
  quantity: number | null
  unit: string
  confidence: BomLine['confidence']
  note: string | null
}

export interface ExportScope {
  id: string
  /** The scope's tag on the drawings — editable before export. */
  label: string
  /** The product family, as the engine names it — editable before export. */
  product: string
  color: string
  /** Free text the estimator adds for the client. Empty by default. */
  note: string
  /** The takeoff's own numbers: area, length, count — whatever the scope measures. */
  quantities: Array<{ label: string; quantity: number; unit: string }>
  components: ExportComponent[]
  markupCount: number
  /** Sheets the scope's takeoff sits on, by label, in the order first seen. */
  sheets: string[]
}

export interface EstimateExport {
  projectName: string
  estimateName: string
  /** A line under the title — an issue date, a revision — editable. Empty by default. */
  subtitle: string
  scopes: ExportScope[]
  /** Documents the takeoff was measured from. */
  documents: string[]
  generatedAt: Date
}

export interface BuildEstimateExportInput {
  projectName: string
  estimateName: string
  /** The round's scopes, in the round's order. */
  scopes: readonly Scope[]
  /** Measured quantities per scope, as the estimates panel shows them. */
  quantities: ReadonlyArray<{ scope: Scope; rows: readonly QuantityResult[] }>
  /** Piece results per scope; the bill is built from these. */
  pieces: readonly ScopePieces[]
  /** Every markup in the project, so a scope's sheets and counts can be read off. */
  markups: ReadonlyArray<{ scopeId: string | null; documentId: string; pageId: string; kind: string }>
  /** Sheet label for a page id — "A-101", or "Page 3" — used for the sheet list. */
  sheetLabelFor: (pageId: string) => string
  documents: readonly string[]
  generatedAt?: Date
}

/** Only the markup kinds that reach a quantity. A dimension on a sheet is not takeoff. */
const TAKEOFF = new Set(['area', 'cutout', 'polyline', 'count'])

export function buildEstimateExport(input: BuildEstimateExportInput): EstimateExport {
  const inRound = new Set(input.scopes.map((s) => s.id))
  const bom = buildBom(input.pieces.filter((p) => inRound.has(p.scope.id)))

  const scopes: ExportScope[] = input.scopes.map((s) => {
    const rows = input.quantities.find((q) => q.scope.id === s.id)?.rows ?? []
    const mine = input.markups.filter((m) => m.scopeId === s.id && TAKEOFF.has(m.kind))
    const sheets: string[] = []
    for (const m of mine) {
      const label = input.sheetLabelFor(m.pageId)
      if (!sheets.includes(label)) sheets.push(label)
    }
    return {
      id: s.id,
      label: s.label,
      product: PRODUCT_TYPE_LABEL[readProductType(s.specifications)],
      color: s.color,
      note: '',
      quantities: rows.map((r) => ({ label: r.label, quantity: r.quantity, unit: r.unit })),
      components: bom.lines
        .filter((l) => l.scopeId === s.id)
        .map((l) => ({
          label: l.label, quantity: l.quantity, unit: l.unit,
          confidence: l.confidence, note: l.note ?? null,
        })),
      markupCount: mine.length,
      sheets,
    }
  })

  return {
    projectName: input.projectName,
    estimateName: input.estimateName,
    subtitle: '',
    scopes,
    documents: [...input.documents],
    generatedAt: input.generatedAt ?? new Date(),
  }
}

// ------------------------------------------------------------------ text --

/** One row per quantity and per component, so a spreadsheet gets everything. */
export interface ExportRow {
  scope: string
  product: string
  kind: 'Quantity' | 'Component'
  item: string
  quantity: number | null
  unit: string
  standing: string
  note: string
  sheets: string
}

export function exportRows(e: EstimateExport): ExportRow[] {
  const out: ExportRow[] = []
  for (const s of e.scopes) {
    const sheets = s.sheets.join('; ')
    for (const q of s.quantities) {
      out.push({
        scope: s.label, product: s.product, kind: 'Quantity', item: q.label,
        quantity: q.quantity, unit: q.unit, standing: 'measured', note: s.note, sheets,
      })
    }
    for (const c of s.components) {
      out.push({
        scope: s.label, product: s.product, kind: 'Component', item: c.label,
        quantity: c.quantity, unit: c.unit, standing: c.confidence, note: c.note ?? '', sheets,
      })
    }
    if (s.quantities.length === 0 && s.components.length === 0) {
      out.push({
        scope: s.label, product: s.product, kind: 'Quantity', item: 'No takeoff yet',
        quantity: null, unit: '', standing: '', note: s.note, sheets,
      })
    }
  }
  return out
}

const HEADER: Array<keyof ExportRow> = [
  'scope', 'product', 'kind', 'item', 'quantity', 'unit', 'standing', 'note', 'sheets',
]
const HEADER_LABEL: Record<keyof ExportRow, string> = {
  scope: 'Scope', product: 'Product', kind: 'Kind', item: 'Item', quantity: 'Quantity',
  unit: 'Unit', standing: 'Standing', note: 'Note', sheets: 'Sheets',
}

/** A number the way a spreadsheet wants it: no thousands separators, no unit. */
const cellNumber = (n: number | null): string => (n === null ? '' : String(Math.round(n * 100) / 100))

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** Tabs and newlines cannot be escaped in TSV; they are replaced by spaces. */
function tsvCell(v: string): string {
  return v.replace(/[\t\r\n]+/g, ' ')
}

function table(e: EstimateExport, cell: (v: string) => string, sep: string): string {
  const lines: string[] = []
  lines.push(HEADER.map((h) => cell(HEADER_LABEL[h])).join(sep))
  for (const r of exportRows(e)) {
    lines.push(HEADER.map((h) => {
      const v = r[h]
      return cell(h === 'quantity' ? cellNumber(v as number | null) : String(v ?? ''))
    }).join(sep))
  }
  return lines.join('\r\n') + '\r\n'
}

/**
 * The estimate as CSV. Excel opens it by double-click; the first two rows
 * name the project and the round so the file stands on its own.
 */
export function estimateToCsv(e: EstimateExport): string {
  const head = [
    `${csvCell('Project')},${csvCell(e.projectName)}`,
    `${csvCell('Estimate')},${csvCell(e.estimateName)}`,
    `${csvCell('Generated')},${csvCell(e.generatedAt.toISOString().slice(0, 10))}`,
    '',
  ].join('\r\n')
  return head + '\r\n' + table(e, csvCell, ',')
}

/** The estimate as TSV, for pasting straight into a pricing sheet. */
export function estimateToTsv(e: EstimateExport): string {
  return table(e, tsvCell, '\t')
}

/** A file name Windows will accept. */
export function exportFileName(e: EstimateExport, ext: string): string {
  return `${e.projectName} — ${e.estimateName} estimate.${ext}`.replace(/[\\/:*?"<>|]/g, '-')
}
