/**
 * Starter scopes so a fresh database is usable immediately.
 *
 * "Usable" means they can actually CALCULATE. These carried empty
 * specifications until 2026-08-28, which meant `readProductType` fell back to
 * `baffle` — the ported Qt default — and every scope in a brand-new project
 * reported "needs Spacing OC, Stock, Conn. Max" before the estimator had done
 * anything wrong. The comment promised something the data did not deliver.
 *
 * The dimensions below are plausible starting points, NOT standards. They
 * exist so the layout engine has something to chew on out of the box; a real
 * estimate replaces them from the drawing's legend.
 *
 * Ids are stable and must stay that way — markups reference them by foreign
 * key, and renaming one orphans a takeoff.
 */
export const SEED_SCOPES = [
  {
    id: 'cl03',
    label: 'CL03 Baffle Ceiling',
    scopeType: 'area',
    color: '#e2483d',
    specifications: {
      productType: 'baffle_cassette',
      spacing: '6', spacingUnit: 'in',
      stockLength: '10', stockLengthUnit: 'ft',
      maxConnectorSpacing: '4', maxConnectorSpacingUnit: 'ft',
      yieldGranularity: 'full',
      alignSeams: 'true',
    },
  },
  {
    id: 'cmt01',
    label: 'C-MT-01 Plank',
    scopeType: 'area',
    color: '#2f7fd1',
    specifications: {
      productType: 'planks',
      plankWidth: '6', plankWidthUnit: 'in',
      stockLength: '12', stockLengthUnit: 'ft',
      yieldGranularity: 'full',
      alignSeams: 'true',
    },
  },
  {
    id: 'wp12',
    label: 'WP-12 Wall Panel',
    scopeType: 'area',
    color: '#37a06b',
    specifications: {
      productType: 'panels',
      panelWidth: '2', panelWidthUnit: 'ft',
      panelLength: '4', panelLengthUnit: 'ft',
      panelGranularity: 'full',
      yieldGranularity: 'full',
      alignSeams: 'true',
    },
  },
  {
    // Louvres are quantified by run, not laid out on a grid. Custom assembly
    // is the ported product type for "measured, then priced by hand", and it
    // requires no layout dimensions — so this scope is ready, not blocked.
    id: 'lv04',
    label: 'LV-04 Louvre',
    scopeType: 'linear',
    color: '#e08b2a',
    specifications: { productType: 'custom_assembly' },
  },
  {
    id: 'fix01',
    label: 'FIX-01 Fixtures',
    scopeType: 'count',
    color: '#8256c4',
    specifications: { productType: 'custom_assembly' },
  },
]
