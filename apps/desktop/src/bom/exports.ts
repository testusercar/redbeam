/**
 * The round's exports: the report as a file, the bill as text.
 *
 * These lived in the bill-of-materials level of the estimates panel. There is
 * no such level any more — a scope's parts are read on the scope, and the
 * round lists only totals — so what a round can still DO with its bill is an
 * export, and an export is a menu item on the round's header. The two
 * functions here are what those items run.
 */
import { bomToTsv, type Bom } from '@redbeam/domain'
import { renderTakeoffReport } from '../export/report.js'
import { saveFile, saveOutcomeText, type SaveOutcome } from '../export/saveFile.js'
import { reportFileName } from './bomRows.js'

/**
 * The report, as a file you can send.
 *
 * TSV is right for a pricing sheet and wrong in front of a client. This is
 * one self-contained HTML document — no network, no font file, no external
 * stylesheet — so it survives being emailed and opened offline months later.
 */
export async function saveReportFile(opts: {
  projectName: string
  estimateName: string
  bom: Bom
  documents: readonly string[]
}): Promise<SaveOutcome> {
  const html = renderTakeoffReport({
    projectName: opts.projectName,
    estimateName: opts.estimateName,
    bom: opts.bom,
    documents: opts.documents,
    generatedAt: new Date(),
  })
  // A native Save As on the desktop; the downloader only in the browser.
  return saveFile(html, {
    name: reportFileName(opts.projectName, opts.estimateName),
    type: 'text/html;charset=utf-8',
    filter: { name: 'HTML report', extensions: ['html'] },
  })
}

export { saveOutcomeText }

/** The bill as tab-separated text on the clipboard. False when the clipboard refused. */
export async function copyBillTsv(bom: Bom): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(bomToTsv(bom))
    return true
  } catch {
    // A clipboard permission failure must not look like a broken export.
    return false
  }
}
