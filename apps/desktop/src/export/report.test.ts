/**
 * The BOM panel could already copy a TSV, which is right for a pricing sheet
 * and wrong for a client or a supplier. This is the other half — and it
 * carries Maxxit's identity, so the brand's constraints are assertions here
 * rather than good intentions.
 */
import { describe, expect, it } from 'vitest'
import { renderTakeoffReport } from './report.js'
import type { Bom } from '@redbeam/domain'

const bom = (over: Partial<Bom> = {}): Bom => ({
  lines: [
    {
      scopeId: 'a', scopeLabel: 'C-MT-01 Plank', productType: 'planks',
      productLabel: 'Planks', itemKey: 'primary_stock', label: 'Planks',
      quantity: 506, unit: 'EA', confidence: 'unverified',
      note: 'Planks piece counts match arithmetic but are not verified against the Qt build',
    },
    {
      scopeId: 'b', scopeLabel: 'WP-12 Wall Panel', productType: 'panels',
      productLabel: 'Panels', itemKey: 'panel_count', label: 'Panels',
      quantity: 54, unit: 'EA', confidence: 'verified',
    },
  ],
  totals: [{ unit: 'EA', quantity: 54 }],
  counts: { verified: 1, unverified: 1, blocked: 0 },
  needsAttention: true,
  ...over,
} as Bom)

const render = (over: Partial<Bom> = {}) => renderTakeoffReport({
  projectName: 'Barclays Toronto',
  estimateName: '100% CD',
  bom: bom(over),
  documents: ['Interiors.pdf', 'Addendum 1.pdf'],
  generatedAt: new Date('2026-09-03T10:00:00.000Z'),
})

describe('the takeoff report', () => {
  it('is one self-contained file', () => {
    // A report that needs the internet to look right looks wrong on the one
    // machine that matters: a supplier's, offline, six months later.
    const html = render()
    expect(html).not.toMatch(/<link[^>]+href=["']http/)
    expect(html).not.toMatch(/<script/)
    expect(html).not.toMatch(/src=["']http/)
  })

  it('puts Maxxit Black on the ground and #EDEDED on the type', () => {
    // Not pure white: the guide labels Light Grey K00 but its swatch is K08.
    const html = render()
    expect(html).toContain('--black: #181A1D')
    expect(html).toContain('--ink: #EDEDED')
    expect(html).not.toMatch(/color:\s*#fff\b/i)
  })

  it('uses ONE accent, and the readable tint where it carries type', () => {
    // The product-line colours identify families; using a second to liven up
    // a page is a brand error rather than a choice. AERO:Form base fails
    // 4.5:1 on this ground, so type takes the tint.
    const html = render()
    expect(html).toContain('--accent: #CA4139')
    expect(html).toContain('--accent-ink: #D25F59')
    for (const other of ['#2E353E', '#575A3D', '#A62622', '#C17B33']) {
      expect(html, `${other} is a second accent`).not.toContain(other)
    }
  })

  it('carries the wordmark unmodified, once', () => {
    const html = render()
    expect(html).toContain('aria-label="MAXXIT"')
    // currentColor, so it is never recoloured by hand.
    expect(html).toContain('fill="currentColor"')
    expect(html.match(/aria-label="MAXXIT"/g)).toHaveLength(1)
  })

  it('sets the headline in sentence case and the labels tracked uppercase', () => {
    const html = render()
    expect(html).toContain('<h1>Barclays Toronto</h1>')
    expect(html).toContain('text-transform: uppercase')
  })

  it('says the fonts were substituted rather than pretending', () => {
    expect(render()).toContain('Gotham/Whitney substituted with Montserrat/Inter')
  })

  it('marks what is not ready to send, and says why', () => {
    const html = render()
    expect(html).toContain('class="flag"')
    expect(html).toContain('not verified against the Qt build')
    expect(html).toContain('1 line marked')
  })

  it('says nothing about attention when every line is verified', () => {
    const html = render({
      lines: [bom().lines[1]!],
      counts: { verified: 1, unverified: 0, blocked: 0 },
      needsAttention: false,
    })
    expect(html).not.toContain('line marked')
    expect(html).not.toContain('class="flag"')
  })

  it('shows a blocked line as absent rather than as zero', () => {
    const html = render({
      lines: [{
        scopeId: 'c', scopeLabel: 'WP-12', productType: 'panels', productLabel: 'Panels',
        itemKey: 'blocked', label: 'needs a pattern direction', quantity: null,
        unit: '', confidence: 'blocked', note: 'a pattern direction',
      }],
      counts: { verified: 0, unverified: 0, blocked: 1 },
    } as Partial<Bom>)
    expect(html).toContain('—')
    expect(html).not.toMatch(/>0<\/td>/)
  })

  it('escapes a project name that contains markup', () => {
    const html = renderTakeoffReport({
      projectName: '<script>alert(1)</script>', estimateName: 'A & B',
      bom: bom(), documents: [], generatedAt: new Date('2026-09-03T10:00:00.000Z'),
    })
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('A &amp; B')
  })
})
