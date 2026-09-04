//! Project store — the Rust process owns the one and only SQLite connection.
//!
//! # Why this exists
//!
//! The browser build used sql.js: SQLite compiled to WASM, holding the whole
//! database **in memory, per page**. The desktop app is one project per window
//! with optional additional context windows onto the same project, so a
//! per-page in-memory database cannot work — each window would open its own
//! private copy and the two would silently diverge with no error anywhere.
//! Here the Rust process owns a single [`rusqlite::Connection`]; windows are
//! views onto it and every write lands in one place.
//!
//! Two things fall out of that, and both are the point:
//!
//! * **FTS5 is back.** Stock sql.js ships FTS3, so `page_text_fts` was skipped
//!   at migration time and full-text search was unavailable. `rusqlite` with
//!   `bundled` compiles SQLite in with FTS5 enabled, so migration 2 now applies
//!   in full. That claim is not assumed — `tests::fts5_is_available_and_page_text_fts_is_usable`
//!   writes rows and runs a `MATCH` query, and every migration test asserts
//!   that `skipped` comes back empty.
//! * **Nothing is re-exported on a debounce.** The connection writes straight
//!   to the project's `.db` file.
//!
//! # Layout
//!
//! * [`db`] — the [`Store`](db::Store) type: connection ownership, pragmas, path
//!   resolution, and the JSON-facing `exec` / `all` / `run` surface.
//! * [`migrations`] — the six ported migrations, embedded, and a runner that
//!   mirrors the TypeScript one in `packages/store/src/index.ts`
//!   statement-by-statement.
//! * [`json`] — `serde_json::Value` <-> SQLite value conversion. `REAL` must
//!   round-trip as a number: `feet_per_pdf_point` is the whole scale of every
//!   quantity in the project and must never come back as a string.
//! * [`state`] — [`StoreState`], the one managed handle every window shares.
//! * [`commands`] — the four Tauri commands the TypeScript client calls.
//!
//! # Wiring (for whoever owns `lib.rs`)
//!
//! ```ignore
//! mod store;
//!
//! tauri::Builder::default()
//!     .manage(store::StoreState::new())
//!     .invoke_handler(tauri::generate_handler![
//!         store::commands::db_open,
//!         store::commands::db_exec,
//!         store::commands::db_all,
//!         store::commands::db_run,
//!     ])
//! ```
//!
//! The handler list must name `store::commands::*`, not a re-export.
//! `#[tauri::command]` emits a helper macro alongside each function and
//! `generate_handler!` resolves both names in the same module, so a `pub use`
//! of the function alone would not carry the macro with it.

pub mod commands;
pub mod db;
pub mod json;
pub mod migrations;
pub mod state;

#[cfg(test)]
mod tests;

/// The one thing `lib.rs` needs to name directly. Everything else is reached
/// through its own module so this stays free of unused re-exports.
pub use state::StoreState;
