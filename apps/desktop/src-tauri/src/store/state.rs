//! Process-wide store handle and the shape `db_open` reports back.
//!
//! # Why one `Mutex`, and not a pool
//!
//! `rusqlite::Connection` is `Send` but not `Sync`, and Tauri's managed state
//! must be `Send + Sync`, so *some* guard is required. A plain
//! [`std::sync::Mutex`] is the right one here:
//!
//! * **A pool would defeat the point.** The reason the store moved out of the
//!   browser at all is that a per-page database let two windows diverge. A pool
//!   hands different windows different connections, which brings back the same
//!   class of bug for anything not yet committed. One connection, one truth.
//! * **SQLite serializes writes anyway.** This is a single-user, single-writer
//!   desktop app; the contention a pool would relieve does not exist. Reads are
//!   sub-millisecond against a project-sized database.
//! * **`std::sync::Mutex`, not `tokio::sync::Mutex`.** A `tokio` mutex is for
//!   holding a lock across an `.await`. Nothing here does: every command hands
//!   straight off to a synchronous method on [`StoreState`], so the guard is
//!   created and dropped inside a non-`async` frame and the returned future
//!   stays `Send`.
//! * **The commands in [`super::commands`] are `async fn` regardless**, so
//!   Tauri runs them on the async runtime rather than the main thread. A slow
//!   query then blocks a worker, not the UI.
//!
//! If write throughput ever becomes the problem, the answer is a dedicated
//! writer thread with a channel — not more connections.

use std::sync::Mutex;

use serde::Serialize;

use super::db::{Store, StoreError};

/// What `db_open` reports back about the project it just opened.
///
/// Field names are serialized as written (snake_case) — the TypeScript client
/// reads `schema_version`, `applied`, `skipped`, `db_path`.
#[derive(Debug, Clone, Serialize)]
pub struct OpenInfo {
    /// Highest applied migration version. 6 once the ported schema is current.
    pub schema_version: i64,
    /// Number of migration blocks newly applied by this call.
    pub applied: usize,
    /// Statements the driver could not run, rendered for display.
    ///
    /// On the sql.js driver this held the `page_text_fts` FTS5 statement. On
    /// this driver it should be empty; if it ever is not, the app must say so
    /// rather than behave as though full-text search exists.
    pub skipped: Vec<String>,
    /// Absolute path of the database file actually opened.
    pub db_path: String,
}

/// Process-wide store handle.
///
/// Register once with `.manage(StoreState::new())`; every window's commands
/// resolve to this same value, which is the whole reason the database moved out
/// of the browser.
#[derive(Default)]
pub struct StoreState {
    inner: Mutex<Option<Store>>,
}

impl StoreState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Open a project, run migrations, and replace whatever was open before.
    pub fn open(&self, project_path: &str) -> Result<OpenInfo, StoreError> {
        let store = Store::open(project_path)?;
        let migrated = store.migrate()?;
        let info = OpenInfo {
            schema_version: store.schema_version()?,
            applied: migrated.applied,
            skipped: migrated
                .skipped
                .iter()
                .map(|s| format!("migration {}: {} — {}", s.version, s.statement, s.reason))
                .collect(),
            db_path: store.db_path().display().to_string(),
        };
        // Dropping the previous Store closes its connection.
        *self.lock() = Some(store);
        Ok(info)
    }

    /// Borrow the open store for one operation.
    pub fn with<T>(&self, f: impl FnOnce(&Store) -> Result<T, StoreError>) -> Result<T, StoreError> {
        let guard = self.lock();
        let store = guard.as_ref().ok_or(StoreError::NotOpen)?;
        f(store)
    }

    /// Borrow the open store, but only if it is the project the caller meant.
    ///
    /// # The bug this exists to make impossible
    ///
    /// One connection for the process is the right design — it is why two
    /// windows cannot diverge — but it made a write's DESTINATION a property of
    /// time rather than of the write. Opening a project starts a folder scan
    /// that can run for minutes on a synced share; switching projects mid-scan
    /// repointed this connection, and when the first scan finished it ingested
    /// into whichever database was open by then.
    ///
    /// That is not hypothetical. On 2026-09-03 the Barclays Toronto project's
    /// database was found holding 625 documents from two other jobs, and the
    /// CoreWeave project's database was holding Barclays' three. One client's
    /// drawings, catalogued under another client's bid.
    ///
    /// The check is here rather than in the caller because here it is under the
    /// SAME lock as the write. Asking "is the right project open?" and then
    /// writing is two steps, and a switch fits between them.
    pub fn with_project<T>(
        &self,
        project_path: &str,
        f: impl FnOnce(&Store) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let guard = self.lock();
        let store = guard.as_ref().ok_or(StoreError::NotOpen)?;

        // Resolved the same way `Store::open` resolved it, so a caller may name
        // the project folder or the .db file, as `db_open` allows.
        let expected = super::db::resolve_db_path(project_path);
        if expected != store.db_path() {
            return Err(StoreError::WrongProject {
                expected: expected.display().to_string(),
                open: store.db_path().display().to_string(),
            });
        }
        f(store)
    }

    /// A poisoned lock means a panic unwound through a query. `rusqlite` keeps
    /// no invariant that a panic could leave half-broken, and bricking the
    /// user's project for the rest of the session over it would be worse than
    /// the panic was, so the guard is recovered.
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Store>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}
