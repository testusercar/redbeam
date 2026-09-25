/**
 * The release path is a workflow plus publish.ps1. These pin the parts that
 * a tidy edit would quietly drop: wrangler --remote, the free-tier stop,
 * both architectures, and a version check that refuses a tag the tree was
 * not bumped to.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertReleaseVersion } from '../assert-version.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('assertReleaseVersion', () => {
  it('accepts the version the tree already has, with or without a v', () => {
    expect(assertReleaseVersion('v0.3.0', root)).toBe('0.3.0')
    expect(assertReleaseVersion('0.3.0', root)).toBe('0.3.0')
  })

  it('rejects a tag the tree was not bumped to', () => {
    expect(() => assertReleaseVersion('0.9.9', root)).toThrow(/0\.3\.0/)
  })

  it('rejects anything that is not MAJOR.MINOR.PATCH', () => {
    expect(() => assertReleaseVersion('v1.2.3-beta', root)).toThrow(/dotted numbers/)
  })
})

describe('the release workflow', () => {
  const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
  const publish = readFileSync(join(root, 'workers/updater/publish.ps1'), 'utf8')

  it('builds both Windows NSIS installers on GitHub-hosted Windows', () => {
    expect(workflow).toContain('runs-on: windows-latest')
    expect(workflow).toContain('x86_64-pc-windows-msvc')
    expect(workflow).toContain('aarch64-pc-windows-msvc')
    expect(workflow).toContain('--bundles nsis')
    expect(workflow).toContain('v*.*.*')
    expect(workflow).toContain('workflow_dispatch')
    expect(workflow).toContain('dry_run:')
    expect(workflow).toContain('publish.ps1')
    expect(workflow).toContain('TAURI_SIGNING_PRIVATE_KEY')
    expect(workflow).toContain('CLOUDFLARE_API_TOKEN')
    expect(workflow).toContain('CLOUDFLARE_ACCOUNT_ID')
  })

  it('does not put objects itself; publish.ps1 does, and every put is --remote', () => {
    expect(workflow).not.toContain('r2 object put')
    const puts = publish
      .split('\n')
      .filter((line) => line.includes('r2 object put') && !line.trimStart().startsWith('#'))
    expect(puts.length).toBeGreaterThan(0)
    for (const line of puts) expect(line, line).toContain('--remote')
  })

  it('keeps the free-tier stop and a non-interactive switch', () => {
    expect(publish).toContain('$StopBytes = 512MB')
    expect(publish).toContain('$WarnBytes = 200MB')
    expect(publish).toContain('[switch]$Yes')
    expect(publish).toContain('[switch]$AllowSingleArch')
    expect(publish).toContain('Do not set a storage class')
    expect(publish).toContain('Do not create another bucket')
  })
})
