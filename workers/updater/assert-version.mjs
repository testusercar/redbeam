/**
 * Fail unless the version being released is the version already committed.
 *
 * A tag v0.3.2 on a commit whose tauri.conf.json still says 0.3.1 would
 * build an installer named for 0.3.1 and publish it as 0.3.2. The installed
 * app would then report the old version and the next check would lie.
 *
 * Called from .github/workflows/release.yml:
 *   node workers/updater/assert-version.mjs v0.3.2
 */
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function readVersion(repoRoot, rel) {
  const parsed = JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'))
  if (typeof parsed.version !== 'string') {
    throw new Error(`${rel} has no version`)
  }
  return parsed.version
}

export function versionsInTree(repoRoot = root) {
  const cargo = readFileSync(join(repoRoot, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8')
  const match = cargo.match(/\[package\][\s\S]*?^version = "([^"]+)"/m)
  if (match === null) throw new Error('Cargo.toml has no [package] version')
  return {
    'tauri.conf.json': readVersion(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'),
    'Cargo.toml': match[1],
    'apps/desktop/package.json': readVersion(repoRoot, 'apps/desktop/package.json'),
    'package.json': readVersion(repoRoot, 'package.json'),
  }
}

export function assertReleaseVersion(raw, repoRoot = root) {
  const version = String(raw ?? '').trim().replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Version must be dotted numbers, for example 0.3.2 (got '${raw}').`)
  }
  const found = versionsInTree(repoRoot)
  const mismatches = Object.entries(found).filter(([, value]) => value !== version)
  if (mismatches.length > 0) {
    const detail = mismatches.map(([name, value]) => `${name} is ${value}`).join(', ')
    throw new Error(
      `Refusing to release ${version}: ${detail}. Bump those to ${version} and commit before tagging.`,
    )
  }
  return version
}

function runCli() {
  const raw = process.argv[2]
  if (!raw) {
    console.error('usage: node workers/updater/assert-version.mjs <version>')
    process.exit(1)
  }
  try {
    console.log(assertReleaseVersion(raw))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'assert-version.mjs') runCli()
