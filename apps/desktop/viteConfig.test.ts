/**
 * The dev server's config has to actually load.
 *
 * Nothing else in this repo checks it. `tsc -b` does not include
 * vite.config.ts in the project, and no test imported it — so an edit that
 * deleted three `const` declarations out of it left `tsc` clean and 1182 tests
 * green while `vite` died on startup with "host is not defined". The app kept
 * running on its last bundle, HMR was gone, and every change after that point
 * silently did nothing. Two features were reported broken that were not.
 *
 * Importing the module is the whole test: a missing binding, a syntax error or
 * a bad import throws here rather than in a terminal nobody is reading.
 */
import { describe, expect, it } from 'vitest'

describe('the desktop vite config', () => {
  it('loads, and resolves to a config object', async () => {
    const mod = await import('./vite.config.js') as { default: unknown }
    const config = typeof mod.default === 'function'
      ? (mod.default as (env: unknown) => unknown)({ command: 'serve', mode: 'development' })
      : mod.default
    expect(config).toBeTypeOf('object')
    expect(config).not.toBeNull()
  })

  it('still serves the port the Tauri dev command expects', async () => {
    // tauri.conf.json's devUrl points at this port and `strictPort` means a
    // mismatch fails the launch rather than quietly moving.
    const mod = await import('./vite.config.js') as {
      default: { server?: { port?: number, strictPort?: boolean } }
    }
    expect(mod.default.server?.port).toBe(5180)
    expect(mod.default.server?.strictPort).toBe(true)
  })
})
