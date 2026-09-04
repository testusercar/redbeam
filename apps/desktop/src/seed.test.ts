import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SEED_SCOPES } from './seed.js'
import {
  canonicalProductType, missingRequiredMeasures, readProductType,
  PRODUCT_TYPES, type Specifications,
} from '@redbeam/domain'

describe('seed scopes', () => {
  it('every seed scope can actually calculate', () => {
    // These carried empty specifications until 2026-08-28, which meant the
    // product type fell back to `baffle` and EVERY scope in a brand-new
    // project reported "needs Spacing OC, Stock, Conn. Max" before the
    // estimator had done anything. A starter scope that cannot calculate is
    // not a starter scope.
    for (const s of SEED_SCOPES) {
      const specs = s.specifications as Specifications
      const product = readProductType(specs)
      const missing = missingRequiredMeasures(product, specs)
      expect(missing, `${s.label} (${product}) is blocked on: ${missing.join(', ')}`).toEqual([])
    }
  })

  it('declares a product type explicitly rather than relying on the fallback', () => {
    // The fallback to `baffle` is a real ported behaviour for legacy files, but
    // leaning on it here is how the blocked-seed bug happened.
    for (const s of SEED_SCOPES) {
      const declared = (s.specifications as Specifications)['productType']
      expect(typeof declared, s.label).toBe('string')
      expect(PRODUCT_TYPES, s.label).toContain(canonicalProductType(String(declared)))
    }
  })

  it('has stable, unique ids', () => {
    // Markups reference these by foreign key; renaming one orphans a takeoff.
    const ids = SEED_SCOPES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['cl03', 'cmt01', 'wp12', 'lv04', 'fix01'])
  })

  it('pairs every measure value with a unit', () => {
    // A value with no unit reads as absent, so the scope would be blocked
    // without saying anything obviously wrong in the editor.
    for (const s of SEED_SCOPES) {
      const specs = s.specifications as Record<string, string>
      for (const key of Object.keys(specs)) {
        if (key.endsWith('Unit') || key === 'productType') continue
        if (!/^(spacing|stockLength|plankWidth|panelWidth|panelLength|maxConnectorSpacing|perimeterTrimLength)$/.test(key)) continue
        expect(specs[`${key}Unit`], `${s.label}.${key} has no unit`).toBeTruthy()
      }
    }
  })

  it('covers the measurement types the tools produce', () => {
    const types = new Set(SEED_SCOPES.map((s) => s.scopeType))
    expect(types).toEqual(new Set(['area', 'linear', 'count']))
  })
})

describe('where the seed is allowed to land', () => {
  const workspace = readFileSync(
    fileURLToPath(new URL('./Workspace.tsx', import.meta.url)), 'utf8',
  )

  it('never seeds a real project', () => {
    /*
     * This ran for every empty database. Opening a new client folder wrote
     * five demo scopes into it, with FIXED ids — so the next project showed
     * the same five and read as the previous project's scopes following you
     * around, which is how Aaron reported it.
     *
     * The specifications are the worse half: their own comment calls them
     * "plausible starting points, NOT standards". A 6in baffle spacing that
     * came from nowhere, in a scope named like a real one, on a real bid.
     *
     * Asserted against the source rather than by running the effect because
     * the effect needs a database, a viewer and a project path; the condition
     * IS the fix, and it is one line somebody could delete while tidying.
     */
    const seedBlock = workspace.slice(
      workspace.indexOf('let existing = await listScopes'),
      workspace.indexOf('const asScopes'),
    )
    expect(seedBlock).toContain("opened.backend !== 'tauri'")
  })

  it('still seeds the browser demo, which has no project folder', () => {
    // The browser build exists to be looked at and has nothing to open, so an
    // empty shelf there is a worse answer than five examples.
    expect(workspace).toContain('SEED_SCOPES')
  })
})
