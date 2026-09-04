//! Project-scoped undo — the stack the whole project shares.
//!
//! # Why this is not in a window
//!
//! `UndoStack` used to live in one browser page and hold JS closures. Windows
//! now share one project through the core, so a per-page stack cannot undo a
//! peer's edit, and an absolute before-image can silently clobber newer work.
//! `docs/DECISIONS.md` :: D1 settles the semantics; this module implements it:
//!
//! * **One stack per open project**, owned here, shared by every window.
//! * **Popped under the same lock as the write it reverts.** Every undo runs
//!   inside a single [`StoreState::with`](crate::store::state::StoreState::with)
//!   closure wrapped in `BEGIN IMMEDIATE`, so two windows hitting `Ctrl+Z`
//!   together cannot pop the same entry twice.
//! * **Optimistic concurrency on revert.** A geometry revert writes an absolute
//!   before-image; it refuses when the row moved under it. See [`apply`].
//! * **`origin != 'user'` is excluded** from the user stack. An agent proposal
//!   is reversed at the review gate, not with `Ctrl+Z`.
//! * **Session-scoped.** D1: the stack lives as long as the project is open and
//!   is not replayed across restarts. Rows from an earlier session are dropped
//!   when this process adopts the project.
//!
//! # Layout
//!
//! * [`record`] — [`UndoRecord`](record::UndoRecord), the serializable command.
//! * [`apply`]  — the forward and inverse effect of each op, in SQL that mirrors
//!   `packages/store/src/repo.ts` statement for statement.
//! * [`log`]    — the `undo_log` table: push, pop, redo, trim, and migration 7.
//! * [`state`]  — [`UndoState`], the managed handle, and the session bookkeeping.
//! * [`commands`] — the Tauri commands the TypeScript `UndoStack` calls.
//!
//! # Wiring (for whoever owns `lib.rs` and `Cargo.toml`)
//!
//! `Cargo.toml` needs **nothing**: this module uses only `rusqlite` (indirectly,
//! through `store::Store`), `serde`, `serde_json` and `tauri`, all already
//! present.
//!
//! `lib.rs` needs:
//!
//! ```ignore
//! mod undo;
//!
//! tauri::Builder::default()
//!     .manage(store::StoreState::new())
//!     .manage(undo::UndoState::new())          // <- add
//!     .invoke_handler(tauri::generate_handler![
//!         // ... existing ...
//!         undo::commands::undo_record,
//!         undo::commands::undo_apply,
//!         undo::commands::undo_redo,
//!         undo::commands::undo_state,
//!         undo::commands::undo_clear,
//!     ])
//! ```
//!
//! As in `store`, the handler list must name `undo::commands::*` rather than a
//! re-export: `#[tauri::command]` emits a helper macro beside each function and
//! `generate_handler!` resolves both names in the same module.
//!
//! # Lock order
//!
//! [`UndoState`]'s mutex is always taken **before** [`StoreState`]'s, never
//! after. Nothing in the crate takes them the other way round, so the pair
//! cannot deadlock. The session mutex only guards bookkeeping; the atomicity
//! that matters comes from the store lock plus `BEGIN IMMEDIATE`.

pub mod apply;
pub mod commands;
pub mod log;
pub mod record;
pub mod state;

#[cfg(test)]
mod tests;

/// The one name `lib.rs` needs directly; everything else is reached through its
/// own module, so this stays free of re-exports nothing consumes.
pub use state::UndoState;
