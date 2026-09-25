import { describe, expect, it } from 'vitest'
import { compareVersions, manifestStatus, parseManifest, safeAssetName } from './manifest.js'

const MANIFEST = JSON.stringify({
  version: '0.4.0',
  notes: 'Quarter panels.',
  pub_date: '2026-09-23T00:00:00Z',
  platforms: {
    'windows-x86_64': { signature: 'sig', url: 'https://updates.example/files/REDBEAM_0.4.0_x64-setup.exe' },
    'windows-aarch64': { signature: 'sig', url: 'https://updates.example/files/REDBEAM_0.4.0_arm64-setup.exe' },
  },
})

describe('updater manifest', () => {
  it('parses a Tauri manifest and rejects one that could not install', () => {
    const parsed = parseManifest(MANIFEST)
    expect(parsed?.version).toBe('0.4.0')
    expect(parsed?.platforms['windows-x86_64']?.url).toMatch(/x64-setup\.exe$/)
    expect(parseManifest('')).toBeNull()
    expect(parseManifest('{"version":"0.4.0","platforms":{}}')).toBeNull()
    expect(parseManifest('{"version":"","platforms":{"windows-x86_64":{"signature":"s","url":"u"}}}')).toBeNull()
  })

  it('compares dotted versions and refuses anything else', () => {
    expect(compareVersions('0.3.0', '0.4.0')).toBeLessThan(0)
    expect(compareVersions('0.4.0', '0.4.0')).toBe(0)
    expect(compareVersions('0.4.1', '0.4.0')).toBeGreaterThan(0)
    expect(compareVersions('0.4', '0.4.0')).toBe(0)
    expect(compareVersions('latest', '0.4.0')).toBeNull()
  })

  it('answers 204 only when the caller is already current, and 503 when the channel is empty', () => {
    const manifest = parseManifest(MANIFEST)
    expect(manifestStatus(manifest, '0.3.0')).toBe(200)
    expect(manifestStatus(manifest, '0.4.0')).toBe(204)
    expect(manifestStatus(manifest, '0.5.0')).toBe(204)
    expect(manifestStatus(manifest, 'not-a-version')).toBe(200)
    expect(manifestStatus(null, '0.3.0')).toBe(503)
  })

  it('proxies only REDBEAM release asset names', () => {
    expect(safeAssetName('REDBEAM_0.4.0_x64-setup.exe')).toBe('REDBEAM_0.4.0_x64-setup.exe')
    expect(safeAssetName('REDBEAM_0.4.0_x64-setup.exe.sig')).toBe('REDBEAM_0.4.0_x64-setup.exe.sig')
    expect(safeAssetName('../manifest.json')).toBeNull()
    expect(safeAssetName('manifest.json')).toBeNull()
  })
})
