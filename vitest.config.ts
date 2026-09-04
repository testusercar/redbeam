import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // apps/mcp runs on `node --test`, not vitest. It is a dependency-free
      // package on purpose — an agent's link to the app it is debugging should
      // not drag in a test framework — so vitest cannot parse its suite and
      // must not try.
      'apps/mcp/**',
    ],
  },
})
