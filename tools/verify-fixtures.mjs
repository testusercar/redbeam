/**
 * Run the golden fixture suite in STRICT mode (plan 05.3).
 *
 * Strict turns a PENDING fixture — one with real inputs but no Qt-captured
 * expectations — into a failure. `npm test` leaves it as a warning so the
 * corpus can be grown before the Qt oracle is reachable; `npm run verify`
 * refuses, because a suite that silently passes on unfilled expectations
 * reports coverage that does not exist.
 *
 * A tiny script rather than an inline env var: `RB_X=1 cmd` is not portable to
 * cmd.exe or PowerShell, and adding cross-env for one variable is not worth a
 * dependency.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

// Run vitest's own entry with the current node rather than shelling out to
// npx: spawning a .cmd needs shell:true on Windows, and shell:true turns the
// argument list back into a string that has to be quoted correctly.
const vitest = createRequire(import.meta.url).resolve('vitest/vitest.mjs')

const r = spawnSync(
  process.execPath,
  [vitest, 'run', 'packages/domain/src/fixtures.test.ts'],
  { stdio: 'inherit', env: { ...process.env, RB_FIXTURES_STRICT: '1' } },
)

if (r.error) {
  console.error('could not run vitest:', r.error.message)
  process.exit(1)
}
process.exit(r.status ?? 1)
