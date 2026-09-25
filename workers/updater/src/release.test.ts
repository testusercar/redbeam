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

  it('refuses a live upload outside GitHub Actions, after the dry-run return', () => {
    const dry = publish.indexOf('if ($DryRun)')
    const refuse = publish.indexOf('Refusing to upload from this machine')
    const put = publish.indexOf('function Put-R2Object')
    expect(dry).toBeGreaterThan(-1)
    expect(refuse).toBeGreaterThan(dry)
    expect(put).toBeGreaterThan(refuse)
    expect(publish).toContain('GITHUB_ACTIONS')
  })

  it('publishes a GitHub Release with the same notes in the same run as R2', () => {
    expect(workflow).toContain('default: true')
    expect(workflow).not.toContain('REDBEAM $version')
    const names = [
      'Resolve version and change notes',
      'Create draft GitHub Release',
      'Publish to R2',
      'Delete draft GitHub Release',
      'Publish GitHub Release',
      'Verify GitHub Release and update channel',
    ]
    let at = -1
    for (const name of names) {
      const next = workflow.indexOf(name, at + 1)
      expect(next, name).toBeGreaterThan(at)
      at = next
    }
    expect(workflow).toContain('Refusing to publish without change notes')
    expect(workflow).toContain('gh release create')
    expect(workflow).toContain('--draft')
    expect(workflow).toContain('gh release delete')
    expect(workflow).toContain('--draft=false')
    expect(workflow).toContain('release-notes.txt')
    expect(workflow).toContain("'-Notes'")
    expect(workflow).toContain("'-DryRun'")
    expect(workflow).toContain('"channel":"published"')
    const create = workflow.indexOf('gh release create')
    const upload = workflow.indexOf('publish.ps1 @publishArgs')
    const undraft = workflow.indexOf('--draft=false')
    expect(create).toBeLessThan(upload)
    expect(upload).toBeLessThan(undraft)
    const between = (start: string, end: string, needle: string) => {
      const from = workflow.indexOf(start)
      const to = workflow.indexOf(end, from + start.length)
      const at = workflow.indexOf(needle, from)
      expect(from, start).toBeGreaterThan(-1)
      expect(to, end).toBeGreaterThan(from)
      expect(at, needle).toBeGreaterThan(from)
      expect(at, needle).toBeLessThan(to)
    }
    between('- name: Create draft GitHub Release', '- name: Publish to R2', "if: env.DRY_RUN != 'true'")
    between('- name: Publish to R2', '- name: Delete draft GitHub Release', "steps.draft_release.outcome == 'success'")
    between('- name: Delete draft GitHub Release', '- name: Publish GitHub Release', 'failure()')
    between('- name: Publish GitHub Release', '- name: Verify GitHub Release', "steps.r2.outcome == 'success'")
    between('- name: Verify GitHub Release', 'channel":"published"', "steps.publish_release.outcome == 'success'")
  })
})
