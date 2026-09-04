/**
 * Cross-window change broadcast.
 *
 * One project can be open in several windows at once (a main window plus
 * "context" windows onto the same drawing set). The Rust core owns the single
 * SQLite connection, so the data never diverges — but a window's React state
 * is a cache of that data, and nothing tells it when a peer wrote. This module
 * is that signal: after a mutation, the writer broadcasts what kind of state
 * moved, and every other window on the same project reloads it.
 *
 * Deliberately coarse. The payload says "markups changed on project P", not
 * which rows — a window re-runs the query it already knows how to run. Diff
 * shipping would need the two windows to agree on a view identity they do not
 * have, and the reload path is already exercised on every open.
 *
 * Under a plain browser (sql.js mode) there is exactly one window and no IPC,
 * so both entry points degrade to no-ops rather than throwing. A future
 * browser multi-tab mode could back this with BroadcastChannel without any
 * caller changing.
 *
 * Verified against @tauri-apps/api 2.11.1 rather than assumed:
 *   - `emit(event, payload)` fans out to ALL targets, the emitting window
 *     included. There is no built-in "everyone but me". Hence `windowLabel`
 *     in the payload and the self-echo filter in onChange().
 *   - `listen()` resolves to an UnlistenFn — the unsubscribe is only available
 *     after a round trip, so onChange() is async.
 *   - Event names may contain only alphanumerics, `-`, `/`, `:` and `_`.
 *     CHANGE_EVENT is spelled to satisfy that.
 *   - `emit`/`listen`/`getCurrentWindow` all dereference window internals at
 *     CALL time, not import time, so importing this module in Node (or a
 *     browser) is safe; calling into Tauri is what must be guarded.
 *
 * ---------------------------------------------------------------------------
 * DESIGN NOTE — what project-scoped undo requires (achievable 01.6)
 * ---------------------------------------------------------------------------
 * `UndoStack` in ./commands.ts is per-page and in memory. That was correct
 * when a page owned its own database. With one project open in several
 * windows it is not: each window accumulates its own stack over a database
 * they share, so window A's Ctrl+Z reverts against state window B has since
 * changed, and neither stack knows the other exists. Making undo correct here
 * is not a refactor of commands.ts — it is a move of ownership.
 *
 * 1. The stack moves to the core, one per open project. Windows stop holding
 *    commands and instead call `undo()` / `redo()` on the core and re-read.
 *    The stack must be popped under the same lock as the write it reverts, or
 *    two windows pressing Ctrl+Z at the same instant pop the same entry twice.
 *
 * 2. Commands must become serializable records, not closures. Today a Command
 *    is `{ label, apply(db), revert(db) }` closing over JS values (the before
 *    and after rings). A process that never saw the closure cannot revert it.
 *    Each command has to be persisted as data — op, entity id, before-image,
 *    after-image — so any window, and after a restart the core itself, can
 *    replay the inverse. `activity` is NOT that log: it records what happened
 *    for humans (`details_json`), not exact before-images, which is precisely
 *    why README says undo is not replayable. Either extend activity with
 *    before/after payloads or add a sibling `undo_log`; do not overload
 *    change_sets, which is the propose/decide review gate (docs/PORTING.md).
 *
 * 3. Undo state becomes shared state. `canUndo` / `undoLabel` now change
 *    because of what someone else did, so the broadcast has to carry (or the
 *    window has to re-query) the undo state, else the toolbar tooltip lies.
 *    Redo-branch invalidation goes global too: any window's new edit discards
 *    the redo future for every window.
 *
 * 4. Undo/redo must itself broadcast — kind derived from the command that was
 *    reverted — to the originating window as well, since the mutation happened
 *    in the core and not in the window's own optimistic state.
 *
 * Behaviour that will surprise people, in the order it will bite:
 *
 *   - Ctrl+Z in window A undoes window B's edit. One stack means undo is
 *     chronological across the project, not "my last action". A user zoomed
 *     into page 3 presses Ctrl+Z and a markup they cannot see, on page 12,
 *     reverts. This is inherent to a shared stack, so the UI must state what
 *     it is about to undo, and after undoing should navigate to or flash the
 *     affected entity. The alternative — per-window undo of only my own
 *     commands — is worse: it is out-of-order undo, and it can revert an edit
 *     a later edit depends on.
 *
 *   - An absolute before-image silently clobbers a newer peer edit.
 *     `editGeometry.revert` writes `before` unconditionally. If B reshaped the
 *     markup after A's edit, A's undo throws B's reshape away without a word.
 *     Project-scoped undo needs an optimistic-concurrency check: record the
 *     `updated_at` the command expected and refuse (or prompt) on mismatch.
 *     The other commands are more forgiving by luck — deletes are soft, and
 *     createMarkup's apply() already handles the "row still exists" redo — but
 *     geometry is last-writer-wins with no detection today.
 *
 *   - Undoing a calibration is a whole-page quantity change. Every window on
 *     that page re-reads and every number moves at once. It is the single
 *     highest-blast-radius entry that can sit on a shared stack.
 *
 *   - Undo can walk back through the review gate. Commands carry `origin`, so
 *     an agent-applied change and a human edit land on the same stack; undo
 *     would revert an accepted proposal without touching the change_sets
 *     decision record, leaving the audit trail claiming a decision whose
 *     effect is gone. Either exclude agent-applied commands from the user
 *     stack or write a compensating decision row.
 *
 *   - The stack outlives the window. Closing the window that made an edit no
 *     longer discards its undo history, because the core still holds it — and
 *     if the log is persisted, undo survives a restart, which contradicts the
 *     current documented behaviour ("Undo does not survive a reload"). That is
 *     an improvement, but it must be a deliberate one: update the README when
 *     it lands.
 */
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauriAvailable } from './tauri-driver.js'

/**
 * Tauri event name. Alphanumerics, `-`, `/`, `:` and `_` only — the runtime
 * rejects anything else.
 */
export const CHANGE_EVENT = 'redbeam://project-change'

/**
 * What moved. Coarse on purpose: a receiver reloads a whole slice.
 *
 *   markups     — created, edited, deleted, restored, rescoped
 *   scopes      — scope list or specifications
 *   calibration — a page's feet_per_pdf_point (moves every quantity on it)
 *   estimates   — estimate / quantity roll-up rows
 *   all         — reload everything; use after undo/redo of a batch, or when
 *                 the writer genuinely does not know the blast radius
 */
export type ChangeKind = 'markups' | 'scopes' | 'calibration' | 'estimates' | 'all'

export const CHANGE_KINDS: readonly ChangeKind[] = [
  'markups',
  'scopes',
  'calibration',
  'estimates',
  'all',
]

/** The broadcast payload. Kept flat so it survives the JSON hop unambiguously. */
export interface ProjectChange {
  kind: ChangeKind
  /** Which project this concerns. Windows on another project must ignore it. */
  projectId: string
  /**
   * Label of the window that wrote. `emit` delivers to the emitter as well, so
   * without this a window would reload in response to its own edit and fight
   * its optimistic state.
   */
  windowLabel: string
  /** Epoch ms, for ordering and for debugging a reload storm. */
  at: number
}

export type Unsubscribe = () => void

export interface BroadcastOptions {
  /** Override the originating label. Defaults to the current window's. */
  windowLabel?: string
}

export interface OnChangeOptions {
  /** Ignore changes for other projects. Omit to receive every project. */
  projectId?: string
  /** This window's label. Defaults to the current window's. */
  windowLabel?: string
  /** Receive our own echoes too. Off by default; only useful for debugging. */
  includeSelf?: boolean
}

/**
 * This window's Tauri label, or 'browser' when there is no Tauri runtime.
 *
 * `getCurrentWindow()` reads `window.__TAURI_INTERNALS__.metadata`, so it
 * throws outside a webview — hence the guard and the catch. The fallback label
 * is a real value rather than an empty string so that self-echo suppression
 * still behaves sanely if a runtime ever reports no label.
 */
export function currentWindowLabel(): string {
  if (!isTauriAvailable()) return 'browser'
  try {
    return getCurrentWindow().label || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Does a received change require reloading this slice of state? */
export function changeAffects(change: ProjectChange, kind: ChangeKind): boolean {
  return change.kind === 'all' || change.kind === kind
}

/** Runtime validation — the payload crossed a process boundary, so check it. */
export function isProjectChange(value: unknown): value is ProjectChange {
  if (value === null || typeof value !== 'object') return false
  const c = value as Partial<ProjectChange>
  return (
    typeof c.kind === 'string' &&
    (CHANGE_KINDS as readonly string[]).includes(c.kind) &&
    typeof c.projectId === 'string' &&
    typeof c.windowLabel === 'string' &&
    typeof c.at === 'number'
  )
}

/**
 * Tell every other window on this project that something changed.
 *
 * Call AFTER the write has been acknowledged by the core, never before: a peer
 * that reloads on an optimistic broadcast can read the pre-write state and
 * cache it as truth.
 *
 * A no-op outside Tauri, where there is exactly one window.
 */
export async function broadcastChange(
  kind: ChangeKind,
  projectId: string,
  opts: BroadcastOptions = {},
): Promise<ProjectChange | null> {
  if (!isTauriAvailable()) return null
  const change: ProjectChange = {
    kind,
    projectId,
    windowLabel: opts.windowLabel ?? currentWindowLabel(),
    at: Date.now(),
  }
  await emit(CHANGE_EVENT, change)
  return change
}

/**
 * Subscribe to peer changes. Resolves to the unsubscribe function.
 *
 * Outside Tauri this resolves immediately to a no-op unsubscribe, so callers
 * (React effects included) need no branch of their own.
 */
export async function onChange(
  handler: (change: ProjectChange) => void,
  opts: OnChangeOptions = {},
): Promise<Unsubscribe> {
  if (!isTauriAvailable()) return () => {}

  const self = opts.windowLabel ?? currentWindowLabel()
  let live = true

  const unlisten = await listen<unknown>(CHANGE_EVENT, (event) => {
    if (!live) return
    const payload = event.payload
    // Another window wrote this. Anything malformed is dropped rather than
    // handed on as a half-typed object.
    if (!isProjectChange(payload)) return
    if (!opts.includeSelf && payload.windowLabel === self) return
    if (opts.projectId !== undefined && payload.projectId !== opts.projectId) return
    handler(payload)
  })

  return () => {
    live = false
    void unlisten()
  }
}
