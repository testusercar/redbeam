/**
 * Settings persistence and the reset boundary (plan TH.4).
 *
 * Storage is injected so this is testable without a browser and so the desktop
 * can swap in a file-backed store later without touching a consumer.
 *
 * The reset boundary is the load-bearing rule, taken from the Qt ledger:
 * settings are global, reversible PREFERENCES. Project, document, page, scale,
 * scope and calculation data live in their own stores and are outside every
 * reset. resetAll() therefore clears exactly this store's keys and nothing
 * else — a "reset settings" that could delete a takeoff would be unusable.
 */
import {
  RETIRED, SETTINGS, defaults, descriptor, validate, inCategory,
  type SettingCategory, type SettingValue,
} from './registry.js'

export interface SettingsStorage {
  read(): string | null
  write(text: string): void
}

const KEY = 'redbeam.settings.v1'

/** localStorage-backed, with every access guarded. */
export function browserStorage(): SettingsStorage {
  return {
    read() {
      // A private window, cleared site data, or a browser configured to block
      // storage all throw on access rather than returning null.
      try { return localStorage.getItem(KEY) } catch { return null }
    },
    write(text) {
      try { localStorage.setItem(KEY, text) } catch { /* preferences are not worth failing a session over */ }
    },
  }
}

/** In-memory, for tests and for a context window that must not persist. */
export function memoryStorage(initial: Record<string, SettingValue> = {}): SettingsStorage {
  let text: string | null = Object.keys(initial).length > 0 ? JSON.stringify(initial) : null
  return { read: () => text, write: (t) => { text = t } }
}

export interface LoadResult {
  values: Record<string, SettingValue>
  /**
   * Keys that were present but unusable, with why. Surfaced rather than
   * swallowed: a setting silently reverting to its default looks like the app
   * ignoring the user.
   */
  rejected: Array<{ id: string; reason: string }>
}

export class SettingsStore {
  private values: Record<string, SettingValue>
  private readonly listeners = new Set<(v: Record<string, SettingValue>) => void>()
  readonly rejected: Array<{ id: string; reason: string }>

  private constructor(
    private readonly storage: SettingsStorage,
    loaded: LoadResult,
  ) {
    this.values = loaded.values
    this.rejected = loaded.rejected
  }

  static open(storage: SettingsStorage): SettingsStore {
    return new SettingsStore(storage, load(storage))
  }

  get<T extends SettingValue = SettingValue>(id: string): T {
    return this.values[id] as T
  }

  bool(id: string): boolean { return this.get(id) === true }
  int(id: string): number { return Number(this.get(id)) }
  str(id: string): string { return String(this.get(id)) }

  all(): Record<string, SettingValue> { return { ...this.values } }

  /** Set one value. Returns null on success, or the validation error. */
  set(id: string, raw: unknown): string | null {
    const v = validate(id, raw)
    if (!v.ok) return v.error
    if (this.values[id] === v.value) return null
    this.values = { ...this.values, [id]: v.value }
    this.persist()
    return null
  }

  /** Restore one category to its defaults. */
  resetCategory(category: SettingCategory): void {
    const next = { ...this.values }
    for (const d of inCategory(category)) next[d.id] = d.default
    this.values = next
    this.persist()
  }

  /**
   * Restore every setting.
   *
   * Clears exactly this store's keys. Project data, recent projects and
   * credentials are outside the reset boundary by construction: they are not
   * in this store, so there is nothing here that could reach them.
   */
  resetAll(): void {
    this.values = defaults()
    this.persist()
  }

  /** True when a setting differs from its shipped default. */
  isModified(id: string): boolean {
    const d = descriptor(id)
    return d !== undefined && this.values[id] !== d.default
  }

  modifiedCount(): number {
    return SETTINGS.filter((s) => this.isModified(s.id)).length
  }

  subscribe(fn: (v: Record<string, SettingValue>) => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private persist(): void {
    // Only non-default values are written. A settings file that lists every
    // key freezes today's defaults into it, so a later change to a default
    // would not reach anyone who had ever opened the settings panel.
    const diff: Record<string, SettingValue> = {}
    for (const s of SETTINGS) if (this.values[s.id] !== s.default) diff[s.id] = this.values[s.id]!
    this.storage.write(JSON.stringify(diff))
    for (const fn of this.listeners) fn(this.all())
  }
}

/** Read and validate stored values over the defaults. */
export function load(storage: SettingsStorage): LoadResult {
  const values = defaults()
  const rejected: Array<{ id: string; reason: string }> = []

  const text = storage.read()
  if (text === null) return { values, rejected }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // A corrupt file must not take the app down with it.
    return { values, rejected: [{ id: '*', reason: 'settings file was not valid JSON; defaults used' }] }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { values, rejected: [{ id: '*', reason: 'settings file was not an object; defaults used' }] }
  }

  for (const [id, raw] of Object.entries(parsed as Record<string, unknown>)) {
    // A retired key is one WE offered and then withdrew. Reporting it as
    // "could not be read" would blame the user for a switch that never did
    // anything; it is dropped, and the file loses it on the next write.
    if (RETIRED.has(id)) continue
    // Any other unknown key is a setting from a newer build. Not an error
    // worth alarming anyone with, but not silently dropped either — it stays
    // out of `values` and is listed.
    const v = validate(id, raw)
    if (v.ok) values[id] = v.value
    else rejected.push({ id, reason: v.error })
  }
  return { values, rejected }
}
