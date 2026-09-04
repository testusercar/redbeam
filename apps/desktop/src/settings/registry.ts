/**
 * Application settings (plan TH.4).
 *
 * Ported in ARCHITECTURE from the Qt build's `RedbeamSettingsService`: a
 * descriptor registry supplies stable ids, categories, labels, types, defaults
 * and ranges, and that one registry drives the UI, validation, per-category
 * reset and global reset. Nothing reads a raw key.
 *
 * NOT ported: most of the Qt registry's surface. Its ten pages cover Okular
 * inheritance — presentation, text-to-speech, generators, signing — none of
 * which exists here. Porting descriptors for features the app does not have
 * would be inventing settings, not porting them.
 *
 * THE RULE THAT DECIDES WHAT IS LISTED: a setting is here only if something
 * reads it. Six were not — "Reopen projects on launch" while App.tsx reopened
 * the last project unconditionally, "Default unit" while no field pre-selected
 * one, "Thin lines", "Dim page content", "Show page thumbnails" and "Recent
 * projects kept" with no consumer at all. A switch that nothing reads is the
 * settings-page version of an updater saying "up to date" over a dead
 * channel: it looks like control and is not. They are in RETIRED below, so a
 * stored value is dropped rather than reported as an error the user caused,
 * and so whoever wires the feature knows the id it should come back under.
 *
 * The product boundary from the Qt ledger is kept, because it is the rule that
 * makes a "reset all" safe: settings are global, reversible preferences.
 * Project, document, page, scale, scope and calculation state live in their own
 * stores and are outside every reset.
 */

/*
 * Three categories, because there are nine settings. The Qt registry had six
 * and the first port kept them, which put "Viewer", "Performance" and
 * "Advanced" on one row each behind a navigation column built for forty. A
 * category is a heading on one scrolling page now, and it earns its heading
 * by holding a setting somebody reads.
 */
export type SettingCategory = 'viewer' | 'takeoff' | 'performance'

/*
 * "Drawing", not "Viewer": the rest of the shell says the drawing and the
 * sheet, and an estimator has never called the thing they are looking at a
 * viewer. The id keeps `viewer.` because ids are stable and Workspace reads
 * them by name.
 */
export const CATEGORY_LABEL: Record<SettingCategory, string> = {
  viewer: 'Drawing',
  takeoff: 'Takeoff',
  performance: 'Performance',
}

export type SettingValue = boolean | number | string

interface Base {
  id: string
  category: SettingCategory
  label: string
  description: string
  /**
   * The switch this one only means something under.
   *
   * "Show seams" with the layout preview off is a preference about pieces
   * that are not being drawn. It is still a real, remembered value — turn
   * the preview on and it applies — but on the page it sits beneath its
   * parent and is dimmed while the parent is off, so five toggles read as one
   * family rather than as five unrelated switches. One level only, and the
   * parent must be a bool in the same category; the registry test holds it.
   */
  parent?: string
}

export type SettingDescriptor =
  | (Base & { type: 'bool'; default: boolean })
  | (Base & { type: 'int'; default: number; min: number; max: number })
  | (Base & { type: 'enum'; default: string; choices: ReadonlyArray<{ value: string; label: string }> })

/**
 * The registry. Ids are STABLE and match the Qt build's where a setting
 * genuinely carries over, so a migration can map them one to one later.
 * Listed in the order the page shows them.
 */
export const SETTINGS: readonly SettingDescriptor[] = [
  {
    id: 'viewer.scrollToZoom',
    category: 'viewer',
    type: 'bool',
    default: true,
    label: 'Scroll wheel zooms',
    description:
      'On, the wheel zooms. Off, it pans and zooming is pinch or Ctrl+wheel. ' +
      'A trackpad pinch always zooms either way.',
  },
  {
    id: 'takeoff.snapEnabled',
    category: 'takeoff',
    type: 'bool',
    default: true,
    label: 'Snap while drawing',
    description: 'Snap new vertices to nearby geometry.',
  },
  /*
   * What the layout preview draws.
   *
   * Global and persisted, because these are how an estimator reads a layout
   * rather than a property of one scope: someone checking waste wants overhang
   * on for every scope they look at, and someone checking coverage wants it
   * off everywhere. Making them per-scope would mean setting the same
   * preference five times on one sheet.
   */
  {
    id: 'takeoff.layoutPreview',
    category: 'takeoff',
    type: 'bool',
    default: false,
    label: 'Show the layout preview',
    description:
      'Draw the pieces the engine laid out, over the drawing. Applies to '
      + 'every scope and every sheet, and is remembered between sessions.',
  },
  {
    id: 'takeoff.perAreaOrigin',
    category: 'takeoff',
    parent: 'takeoff.layoutPreview',
    type: 'bool',
    default: false,
    label: 'Lay each area out on its own',
    description:
      'Start a whole panel at each area’s own edge instead of sharing one '
      + 'grid across the sheet. Usually fewer part-panels, and a different '
      + 'total — the shared grid is what the Qt build produces. Planks '
      + 'already optimise per area either way.',
  },
  {
    id: 'takeoff.layoutOverflow',
    category: 'takeoff',
    parent: 'takeoff.layoutPreview',
    type: 'bool',
    default: false,
    label: 'Show material past the edge',
    description:
      'Draw the whole stock piece, including the part that overhangs the '
      + 'region and is cut off. Off, only the covered length is drawn — which '
      + 'is what is installed, not what is ordered.',
  },
  {
    id: 'takeoff.layoutRails',
    category: 'takeoff',
    parent: 'takeoff.layoutPreview',
    type: 'bool',
    default: true,
    label: 'Show suspension rails',
    description: 'Draw the rails the product hangs from, across the run.',
  },
  {
    id: 'takeoff.layoutTrim',
    category: 'takeoff',
    parent: 'takeoff.layoutPreview',
    type: 'bool',
    default: true,
    label: 'Show perimeter trim',
    description: 'Outline the edge of each region that takes perimeter trim.',
  },
  {
    id: 'takeoff.layoutSeams',
    category: 'takeoff',
    parent: 'takeoff.layoutPreview',
    type: 'bool',
    default: true,
    label: 'Show seams',
    description:
      'Mark where two pieces meet. Every seam is a joiner, so this is the '
      + 'count you are reading made visible.',
  },
  {
    id: 'performance.showBudgets',
    category: 'performance',
    type: 'bool',
    // Off: the readout used to sit in a status bar and now floats over the
    // drawing, and a diagnostic over the sheet is opted into, not shipped on.
    default: false,
    label: 'Show frame time',
    description: 'Show the rolling frame time in the corner of the drawing.',
  },
] as const

/**
 * Ids that were listed and are not any more, with what would bring each back.
 *
 * A stored value under one of these is dropped on load without being reported:
 * the user did nothing wrong by having flipped a switch we offered. The id is
 * kept so the feature, when it is wired, comes back under the name any old
 * settings file already uses.
 */
export const RETIRED: ReadonlyMap<string, string> = new Map([
  ['general.restoreProjectWindows', 'App.tsx reopens the last project unconditionally and never read this'],
  ['general.recentProjectLimit', 'the recents list is capped in Rust (MAX_RECENTS) and nothing read this'],
  ['appearance.dimPageContent', 'no painter read it'],
  ['appearance.showPageStrip', 'the page strip renders unconditionally and never read this'],
  ['takeoff.defaultMeasureUnit', 'no specification or calibration field pre-selected from it'],
  ['advanced.thinLines', 'no painter read it'],
])

const BY_ID = new Map(SETTINGS.map((s) => [s.id, s]))

export function descriptor(id: string): SettingDescriptor | undefined {
  return BY_ID.get(id)
}

export function categories(): SettingCategory[] {
  const seen: SettingCategory[] = []
  for (const s of SETTINGS) if (!seen.includes(s.category)) seen.push(s.category)
  return seen
}

export function inCategory(category: SettingCategory): SettingDescriptor[] {
  return SETTINGS.filter((s) => s.category === category)
}

/** The settings that sit beneath this one on the page. */
export function childrenOf(id: string): SettingDescriptor[] {
  return SETTINGS.filter((s) => s.parent === id)
}

export type Validation =
  | { ok: true; value: SettingValue }
  | { ok: false; error: string }

/**
 * Validate and COERCE a value for a setting.
 *
 * Coercion matters because values arrive from a JSON file written by an older
 * build, or from an input element that only ever produces strings. Rejecting
 * "true" for a boolean would make a settings file unreadable after a refactor,
 * which is a worse outcome than accepting the obvious intent.
 *
 * An out-of-range number is CLAMPED rather than rejected, matching the Qt
 * registry's range behaviour: a stored 5000 for a limit whose max is 200 is a
 * stale value, not a reason to refuse to start.
 */
export function validate(id: string, raw: unknown): Validation {
  const d = BY_ID.get(id)
  if (!d) return { ok: false, error: `unknown setting: ${id}` }
  return validateAgainst(d, raw)
}

/**
 * The same, against a descriptor rather than an id.
 *
 * Separate so the int and enum rules stay testable while the registry
 * happens to hold only switches: the rules are the registry's contract with
 * the next setting, not a property of the current list.
 */
export function validateAgainst(d: SettingDescriptor, raw: unknown): Validation {
  const id = d.id
  switch (d.type) {
    case 'bool': {
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      if (raw === 'true' || raw === 1) return { ok: true, value: true }
      if (raw === 'false' || raw === 0) return { ok: true, value: false }
      return { ok: false, error: `${id}: expected a boolean` }
    }
    case 'int': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
      if (!Number.isFinite(n)) return { ok: false, error: `${id}: expected a number` }
      const clamped = Math.min(d.max, Math.max(d.min, Math.round(n)))
      return { ok: true, value: clamped }
    }
    case 'enum': {
      if (typeof raw !== 'string') return { ok: false, error: `${id}: expected a string` }
      if (!d.choices.some((c) => c.value === raw)) {
        return { ok: false, error: `${id}: not one of ${d.choices.map((c) => c.value).join(', ')}` }
      }
      return { ok: true, value: raw }
    }
  }
}

/** Every default, as a plain map. */
export function defaults(): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {}
  for (const s of SETTINGS) out[s.id] = s.default
  return out
}
