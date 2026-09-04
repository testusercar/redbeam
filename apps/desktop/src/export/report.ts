/**
 * The takeoff package, as a document somebody can send.
 *
 * The BOM panel could already copy a TSV, which is the right thing to paste
 * into a pricing sheet and the wrong thing to put in front of a client or a
 * supplier. This is the other half: one self-contained HTML file carrying the
 * quantities, what each line can be trusted for, and what it was measured
 * from.
 *
 * BRANDING follows the Maxxit brand skill, and the constraints are theirs:
 *
 *  - Maxxit Black `#181A1D` is the ground and `#EDEDED` is the type. Not pure
 *    white — the guide labels Light Grey as K00 but its printed swatch is K08,
 *    and #EDEDED is what the brand actually looks like on a near-black ground.
 *  - ONE accent, used for ONE meaning. Here it is AERO:Form Orange, and it
 *    means "this line is not ready to send" — unverified or blocked, nothing
 *    else. The other product-line colours identify product families and using
 *    one to make a page livelier is a brand error rather than a choice.
 *  - The accent is `#CA4139` for marks and `#D25F59` where it carries type,
 *    because the base fails 4.5:1 on this ground and the tint clears it.
 *  - Gotham and Whitney are licensed, so this substitutes Montserrat and Inter
 *    and SAYS SO in the footer rather than pretending.
 *  - Headlines are sentence case. Uppercase is for tracked labels only.
 *  - No shadows, no glows, no gradients on type.
 */
import { MAXXIT_WORDMARK } from './wordmark.js'
import type { Bom, BomLine } from '@redbeam/domain'

export interface ReportInput {
  projectName: string
  estimateName: string
  bom: Bom
  /** Documents the takeoff was measured from. */
  documents: readonly string[]
  /** When it was produced. Passed in so the output is reproducible in a test. */
  generatedAt: Date
}

const BRAND = {
  black: '#181A1D',
  surface: '#1E2126',
  rule: '#2A2F36',
  ink: '#EDEDED',
  inkDim: '#A7ADB4',
  inkFaint: '#7D858E',
  /** AERO:Form Orange. The document's one accent: "not ready to send". */
  accent: '#CA4139',
  /** Its on-dark tint, 4.58:1 — the base fails as type. */
  accentInk: '#D25F59',
} as const

/** `&` and `<` are the only two that can break out of a text node or an attribute. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const fmt = (n: number): string =>
  n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1)

function line(l: BomLine): string {
  const needs = l.confidence !== 'verified'
  return `<tr${needs ? ' class="flag"' : ''}>
  <td>${esc(l.scopeLabel)}</td>
  <td class="dim">${esc(l.productLabel)}</td>
  <td>${esc(l.label)}</td>
  <td class="num">${l.quantity === null ? '—' : esc(fmt(l.quantity))}</td>
  <td class="dim">${esc(l.unit)}</td>
  <td class="${needs ? 'flagink' : 'dim'}">${esc(l.note ?? l.confidence)}</td>
</tr>`
}

/**
 * Render the report.
 *
 * Pure and self-contained: no network, no external stylesheet, no font file.
 * A report that needs the internet to look right is a report that looks wrong
 * on the one machine that matters — a supplier's, offline, six months later.
 */
export function renderTakeoffReport(input: ReportInput): string {
  const { bom } = input
  const attention = bom.counts.unverified + bom.counts.blocked
  const date = input.generatedAt.toISOString().slice(0, 10)

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.projectName)} — ${esc(input.estimateName)} takeoff</title>
<style>
  :root {
    --black: ${BRAND.black}; --surface: ${BRAND.surface}; --rule: ${BRAND.rule};
    --ink: ${BRAND.ink}; --ink-dim: ${BRAND.inkDim}; --ink-faint: ${BRAND.inkFaint};
    --accent: ${BRAND.accent}; --accent-ink: ${BRAND.accentInk};
    /* Gotham and Whitney are licensed. Substitutes, stated in the footer. */
    --display: 'Maxxit Display', Montserrat, Gotham, system-ui, sans-serif;
    --text: 'Maxxit Text', Inter, Whitney, system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 64px 56px 96px;
    background: var(--black); color: var(--ink);
    font-family: var(--text); font-size: 15px; line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .sheet { max-width: 1100px; margin: 0 auto; }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 32px; }
  /* One placement per page. Clear space is one cap-height all round. */
  .mark { width: 168px; flex: none; color: var(--ink); }
  .mark svg { display: block; width: 100%; height: auto; }
  .kicker {
    display: flex; align-items: center; gap: 12px;
    font-size: 12px; font-weight: 600; letter-spacing: .18em; text-transform: uppercase;
    color: var(--ink-dim); margin: 0 0 14px;
  }
  /* The brand's one recurring flourish: a 42x2 rule before a kicker. */
  .kicker::before { content: ''; width: 42px; height: 2px; background: var(--accent); flex: none; }
  h1 { font-family: var(--display); font-size: 40px; font-weight: 600; letter-spacing: -.015em;
       margin: 0 0 8px; }
  .lede { color: var(--ink-dim); font-size: 17px; margin: 0; }
  .totals { display: flex; flex-wrap: wrap; gap: 48px; margin: 44px 0 8px; }
  .total .n { font-family: var(--display); font-size: 54px; font-weight: 700;
              letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
  .total .k { font-size: 12px; font-weight: 600; letter-spacing: .16em;
              text-transform: uppercase; color: var(--ink-faint); }
  table { width: 100%; border-collapse: collapse; margin-top: 36px; font-size: 14px; }
  th {
    text-align: left; padding: 0 12px 10px 0; border-bottom: 1px solid var(--rule);
    font-size: 11px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase;
    color: var(--ink-faint);
  }
  td { padding: 11px 12px 11px 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .dim { color: var(--ink-dim); }
  .flagink { color: var(--accent-ink); }
  .flag td:first-child { box-shadow: inset 2px 0 0 var(--accent); padding-left: 12px; }
  .note {
    margin-top: 32px; padding: 16px 18px; border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--accent) 33%, transparent);
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    color: var(--ink-dim); font-size: 14px;
  }
  footer {
    margin-top: 56px; padding-top: 16px; border-top: 1px solid var(--rule);
    display: flex; justify-content: space-between; gap: 24px;
    font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint);
  }
  @media print { body { padding: 24px; } }
</style>
</head><body>
<div class="sheet">
  <header>
    <div>
      <p class="kicker">Takeoff · ${esc(input.estimateName)}</p>
      <h1>${esc(input.projectName)}</h1>
      <p class="lede">${bom.lines.length} line${bom.lines.length === 1 ? '' : 's'} from ${
        input.documents.length} drawing${input.documents.length === 1 ? '' : 's'}.</p>
    </div>
    <div class="mark">${MAXXIT_WORDMARK}</div>
  </header>

  <div class="totals">
    ${bom.totals.map((t) => `<div class="total">
      <div class="n">${esc(fmt(t.quantity))}</div>
      <div class="k">${esc(t.unit)}</div>
    </div>`).join('\n    ')}
  </div>

  <table>
    <thead><tr>
      <th>Scope</th><th>Product</th><th>Item</th>
      <th class="num">Qty</th><th>Unit</th><th>Standing</th>
    </tr></thead>
    <tbody>
${bom.lines.map(line).join('\n')}
    </tbody>
  </table>

  ${attention === 0 ? '' : `<p class="note"><strong>${attention} line${
    attention === 1 ? '' : 's'} marked.</strong> A marked line is either blocked
    or produced by an engine no golden fixture reproduces yet. The quantity may
    still be right; it has not been proven against the Qt build, and it is not
    included in the totals above.</p>`}

  <footer>
    <span>${esc(input.documents.join(' · '))}</span>
    <span>${esc(date)} · Gotham/Whitney substituted with Montserrat/Inter</span>
  </footer>
</div>
</body></html>`
}
