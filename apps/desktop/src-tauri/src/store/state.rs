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
//!   class of bug for anything not yet committed. One connection PER PROJECT,
//!   one truth per project — see [`StoreState`] for why it is not one per
//!   process.
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

use std::collections::HashMap;
use std::path::PathBuf;
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

/// The open connections, one per project, and which one was opened last.
///
/// Each carries a count of the windows holding it: every `db_open` adds one
/// and every `db_close` takes one away, and the connection is dropped at
/// zero. Without the count a project switched away from stayed open for the
/// life of the process, and its files could not be moved or deleted while
/// the app ran. A window that dies without closing leaves its count behind —
/// the old behaviour, and harmless.
#[derive(Default)]
struct Open {
    stores: HashMap<PathBuf, (Store, usize)>,
    /// The most recently opened project — what an unaddressed caller (the
    /// automation bridge, a crash report) means by "the project".
    current: Option<PathBuf>,
}

/// Process-wide store handle.
///
/// Register once with `.manage(StoreState::new())`; every window's commands
/// resolve to this same value, which is the whole reason the database moved out
/// of the browser.
///
/// # One connection PER PROJECT, not per process
///
/// This held exactly one `Store`, and `open` replaced it. That was right for
/// the case it was written for — every window on one project shares one
/// connection, so none can diverge — and wrong for the case the shell then
/// built on top of it: "open another project" opens a SECOND WINDOW, and a
/// window is a project. The second window's `db_open` swapped the process's
/// only connection under the first, whose every subsequent `db_all`/`db_run`
/// was then refused as `WrongProject`. From the first window nothing worked:
/// no markups loaded, no scope saved, and no error anyone could act on.
///
/// Aaron hit it by opening a drawing as a project and then its parent folder
/// as another. So the map: each project keeps its own connection for as long
/// as the process lives, windows on the same project still share exactly one,
/// and a write is addressed to the project it belongs to.
#[derive(Default)]
pub struct StoreState {
    inner: Mutex<Open>,
}

impl StoreState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Open a project and run its migrations. The connection is kept beside
    /// any other open project's; opening the same project again reuses it.
    pub fn open(&self, project_path: &str) -> Result<OpenInfo, StoreError> {
        let key = super::db::resolve_db_path(project_path);
        let mut guard = self.lock();
        // `:memory:` is a fresh database every time it is opened, and a test
        // that opens it twice wants two — so it is the one path never reused.
        let reuse = key != PathBuf::from(":memory:") && guard.stores.contains_key(&key);
        if reuse {
            guard.stores.get_mut(&key).expect("checked").1 += 1;
        } else {
            let store = Store::open(project_path)?;
            guard.stores.insert(key.clone(), (store, 1));
        }
        let (store, _) = guard.stores.get(&key).expect("just inserted");
        // Migrating an already-open project is a no-op that reports zero
        // applied, which is what a reopen should say.
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
        guard.current = Some(key);
        Ok(info)
    }

    /// Borrow the most recently opened store for one operation.
    ///
    /// For callers with no project of their own — the bridge, the crash
    /// reporter. Anything acting on a window's behalf goes through
    /// [`with_project`](Self::with_project).
    pub fn with<T>(&self, f: impl FnOnce(&Store) -> Result<T, StoreError>) -> Result<T, StoreError> {
        let guard = self.lock();
        let key = guard.current.as_ref().ok_or(StoreError::NotOpen)?;
        let (store, _) = guard.stores.get(key).ok_or(StoreError::NotOpen)?;
        f(store)
    }

    /// One window has let go of a project. The connection is dropped when
    /// the last one has; `true` says it was dropped now.
    pub fn close(&self, project_path: &str) -> bool {
        let key = super::db::resolve_db_path(project_path);
        let mut guard = self.lock();
        let Some(entry) = guard.stores.get_mut(&key) else {
            return false;
        };
        entry.1 = entry.1.saturating_sub(1);
        if entry.1 > 0 {
            return false;
        }
        // Dropping the Store closes its connection.
        guard.stores.remove(&key);
        if guard.current.as_ref() == Some(&key) {
            // The unaddressed callers (the bridge) fall back to whatever is
            // still open, if anything.
            guard.current = guard.stores.keys().next().cloned();
        }
        true
    }

    /// Borrow the store for the project the caller meant.
    ///
    /// # The bug this exists to make impossible
    ///
    /// A write's DESTINATION must be a property of the write, not of time.
    /// Opening a project starts a folder scan that can run for minutes on a
    /// synced share; switching projects mid-scan used to repoint the
    /// connection, and when the first scan finished it ingested into whichever
    /// database was open by then.
    ///
    /// That is not hypothetical. On 2026-09-03 the Barclays Toronto project's
    /// database was found holding 625 documents from two other jobs, and the
    /// CoreWeave project's database was holding Barclays' three. One client's
    /// drawings, catalogued under another client's bid.
    ///
    /// With one connection per project the wrong destination cannot be open
    /// by accident; what is refused now is a project that was never opened.
    pub fn with_project<T>(
        &self,
        project_path: &str,
        f: impl FnOnce(&Store) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let guard = self.lock();
        // Resolved the same way `Store::open` resolved it, so a caller may name
        // the project folder or the .db file, as `db_open` allows.
        let expected = super::db::resolve_db_path(project_path);
        match guard.stores.get(&expected) {
            Some((store, _)) => f(store),
            None => Err(StoreError::WrongProject {
                expected: expected.display().to_string(),
                open: guard
                    .current
                    .as_ref()
                    .map(|p| p.display().to_string())
                    .unwrap_or_else(|| "nothing".to_string()),
            }),
        }
    }

    /// The projects currently open, as database paths.
    pub fn open_paths(&self) -> Vec<String> {
        self.lock()
            .stores
            .keys()
            .map(|p| p.display().to_string())
            .collect()
    }

    /// A poisoned lock means a panic unwound through a query. `rusqlite` keeps
    /// no invariant that a panic could leave half-broken, and bricking the
    /// user's project for the rest of the session over it would be worse than
    /// the panic was, so the guard is recovered.
    fn lock(&self) -> std::sync::MutexGuard<'_, Open> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}
