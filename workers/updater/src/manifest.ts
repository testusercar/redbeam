/**
 * The Tauri updater manifest, and the one decision the worker makes with it:
 * whether the caller is already on that version.
 *
 * Tauri treats HTTP 204 as "no update" and any other 2xx body as a manifest.
 * A missing or unreadable manifest must NOT become 204 — that is the sentence
 * "you are up to date", and it is a lie when the channel is empty.
 */

export interface UpdatePlatform {
  signature: string
  url: string
}

export interface UpdateManifest {
  version: string
  notes?: string
  pub_date?: string
  platforms: Record<string, UpdatePlatform>
}

/** Numeric version compare. Null when either side is not dotted numbers. */
export function compareVersions(left: string, right: string): number | null {
  const parse = (v: string): number[] | null => {
    const parts = v.trim().split('.')
    if (parts.length === 0 || parts.some((p) => !/^\d+$/.test(p))) return null
    return parts.map((p) => Number(p))
  }
  const a = parse(left)
  const b = parse(right)
  if (a === null || b === null) return null
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function parseManifest(raw: string): UpdateManifest | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  if (typeof rec.version !== 'string' || rec.version.trim() === '') return null
  if (rec.platforms === null || typeof rec.platforms !== 'object') return null
  const platforms: Record<string, UpdatePlatform> = {}
  for (const [key, entry] of Object.entries(rec.platforms as Record<string, unknown>)) {
    if (entry === null || typeof entry !== 'object') return null
    const plat = entry as Record<string, unknown>
    if (typeof plat.signature !== 'string' || typeof plat.url !== 'string') return null
    if (plat.signature === '' || plat.url === '') return null
    platforms[key] = { signature: plat.signature, url: plat.url }
  }
  if (Object.keys(platforms).length === 0) return null
  const manifest: UpdateManifest = { version: rec.version.trim(), platforms }
  if (typeof rec.notes === 'string') manifest.notes = rec.notes
  if (typeof rec.pub_date === 'string') manifest.pub_date = rec.pub_date
  return manifest
}

/**
 * What to answer a version check with.
 *
 * 204 when the installed copy is already at or past the manifest. 200 with
 * the manifest otherwise, including when the version strings cannot be
 * compared — Tauri can still decide. 503 when there is no manifest, so the
 * app says it could not check.
 */
export function manifestStatus(
  manifest: UpdateManifest | null,
  current: string,
): 200 | 204 | 503 {
  if (manifest === null) return 503
  const cmp = compareVersions(current, manifest.version)
  if (cmp !== null && cmp >= 0) return 204
  return 200
}

/** Installer object names we will proxy. Anything else is not a release asset. */
export function safeAssetName(name: string): string | null {
  if (!/^REDBEAM_[A-Za-z0-9._-]+$/.test(name)) return null
  if (name.includes('..')) return null
  return name
}
