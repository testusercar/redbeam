//! The managed handle: one undo stack per open project.
//!
//! # What the two locks are each for
//!
//! * [`StoreState`]'s mutex is the one that matters. Every operation here runs
//!   inside a **single** `state.with(...)` closure wrapped in `BEGIN IMMEDIATE`,
//!   so reading the top of the stack, reverting it and marking it undone are one
//!   indivisible step. D1: "Pop under the same lock as the write. Otherwise two
//!   windows hitting `Ctrl+Z` together pop the same entry twice."
//! * This module's own mutex guards only the session record — which project is
//!   adopted and under what session id. It is always taken **first**, and
//!   nothing in the crate takes the pair the other way round.
//!
//! # Why the stack is not a `Vec` in this struct
//!
//! Because it would be a second copy of something the database already holds,
//! and the first thing that copy would do is disagree with a peer window. The
//! stack lives in `undo_log`; this struct holds a session id and a limit.

use std::sync::Mutex;

use serde_json::Value as Json;

use crate::store::db::Store;
use crate::store::state::StoreState;

use super::apply;
use super::log::{self, UndoOutcome, UndoStatus, DEFAULT_LIMIT};
use super::record::{UndoError, UndoRecord, UndoTarget};

/// Which project is adopted, and the id that scopes its stack to this run.
struct Session {
    db_path: String,
    id: String,
}

/// Process-wide undo handle. Register once with `.manage(UndoState::new())`.
#[derive(Default)]
pub struct UndoState {
    inner: Mutex<Option<Session>>,
    limit: Mutex<usize>,
}

impl UndoState {
    pub fn new() -> Self {
        UndoState {
            inner: Mutex::new(None),
            limit: Mutex::new(DEFAULT_LIMIT),
        }
    }

    /// Test seam: shrink the stack so a limit test does not need 101 markups.
    #[cfg(test)]
    pub fn with_limit(limit: usize) -> Self {
        UndoState {
            inner: Mutex::new(None),
            limit: Mutex::new(limit.max(1)),
        }
    }

    // ------------------------------------------------------------ operations --

    /// Record a command, optionally performing it first.
    ///
    /// `apply_now` is the difference between the TypeScript `run()` (the core
    /// performs the write, so the mutation and its log entry are one
    /// transaction and the recorded `updated_at` is exact) and `push()` (the
    /// effect already landed; only the record is wanted).
    /// `limit` overrides the stack depth for this project — the TypeScript
    /// `UndoStack`'s constructor takes one, and silently ignoring it would make
    /// the two paths disagree about how far back Ctrl+Z reaches.
    pub fn record(
        &self,
        store: &StoreState,
        record: UndoRecord,
        apply_now: bool,
        limit: Option<usize>,
    ) -> Result<UndoStatus, UndoError> {
        // Reject an unknown op before it reaches the log, not when someone
        // presses Ctrl+Z an hour later.
        record.kind()?;
        let limit = limit.filter(|n| *n > 0).unwrap_or_else(|| self.limit());
        self.in_store(store, move |s, session| {
            transact(s, |s| {
                if apply_now {
                    apply::apply(s, &record)?;
                }
                let stamp = entity_stamp(s, &record)?;
                log::push(s, session, &record, stamp.as_deref(), limit)?;
                resync(s, session, &record, stamp.as_deref())?;
                log::status(s, session)
            })
        })
    }

    /// Undo the most recent user command anywhere in the project.
    pub fn undo(&self, store: &StoreState) -> Result<UndoOutcome, UndoError> {
        self.in_store(store, |s, session| {
            transact(s, |s| {
                let Some(entry) = log::top_done(s, session)? else {
                    return Ok(nothing(log::status(s, session)?));
                };
                // A conflict aborts the transaction: the entry stays `done` and
                // the peer's newer work is untouched. Refusing is the whole
                // point — see `apply::guard`.
                apply::revert(s, &entry.record, entry.expected_updated_at.as_deref())?;
                log::set_state(s, entry.seq, "undone")?;
                // The revert moved the row's `updated_at`. Every entry below
                // this one that touches the same entity has to hear about it,
                // or the next Ctrl+Z refuses itself. See `log::restamp_entity`.
                let stamp = entity_stamp(s, &entry.record)?;
                resync(s, session, &entry.record, stamp.as_deref())?;
                Ok(UndoOutcome {
                    ok: true,
                    op: Some(entry.record.op.clone()),
                    label: Some(entry.record.label.clone()),
                    target: Some(UndoTarget::from(&entry.record)),
                    status: log::status(s, session)?,
                })
            })
        })
    }

    /// Redo the most recently undone user command.
    pub fn redo(&self, store: &StoreState) -> Result<UndoOutcome, UndoError> {
        self.in_store(store, |s, session| {
            transact(s, |s| {
                let Some(entry) = log::top_undone(s, session)? else {
                    return Ok(nothing(log::status(s, session)?));
                };
                apply::apply(s, &entry.record)?;
                log::set_state(s, entry.seq, "done")?;
                // Re-applying stamps a fresh `updated_at`. Without re-recording
                // it here the very next undo would refuse itself as a conflict.
                let stamp = entity_stamp(s, &entry.record)?;
                resync(s, session, &entry.record, stamp.as_deref())?;
                Ok(UndoOutcome {
                    ok: true,
                    op: Some(entry.record.op.clone()),
                    label: Some(entry.record.label.clone()),
                    target: Some(UndoTarget::from(&entry.record)),
                    status: log::status(s, session)?,
                })
            })
        })
    }

    /// What the toolbar should say, for every window on this project.
    pub fn status(&self, store: &StoreState) -> Result<UndoStatus, UndoError> {
        self.in_store(store, |s, session| log::status(s, session))
    }

    /// Throw the stack away without reverting anything.
    pub fn clear(&self, store: &StoreState) -> Result<UndoStatus, UndoError> {
        self.in_store(store, |s, session| {
            transact(s, |s| {
                log::clear(s, session)?;
                log::status(s, session)
            })
        })
    }

    // --------------------------------------------------------------- plumbing --

    fn limit(&self) -> usize {
        *self.limit.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Run `f` against the open store, with this project's session id.
    ///
    /// The whole body — session adoption, schema check and the operation — runs
    /// inside one `StoreState::with`, i.e. one hold of the store lock.
    ///
    /// `StoreState::with` is typed to `StoreError`, which this module cannot
    /// extend (`src/store/**` belongs to someone else). Hence the nested
    /// `Result`: the inner one carries [`UndoError`], the outer one carries the
    /// store's own failures, and both are flattened on the way out.
    fn in_store<T>(
        &self,
        store: &StoreState,
        f: impl FnOnce(&Store, &str) -> Result<T, UndoError>,
    ) -> Result<T, UndoError> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let slot = &mut *guard;

        let outcome = store.with(move |s| {
            Ok((move || -> Result<T, UndoError> {
                // Cheap when already applied: one indexed SELECT against
                // schema_migrations. Run unconditionally rather than only on
                // adoption, so a reopened project (or a second `:memory:`
                // store on the same path string) still finds its table.
                log::ensure_schema(s)?;

                let db_path = s.db_path().display().to_string();
                let adopted = slot.as_ref().is_some_and(|x| x.db_path == db_path);
                if !adopted {
                    let id = new_session_id(s)?;
                    // D1: the stack is not replayed across restarts.
                    log::purge_other_sessions(s, &id)?;
                    *slot = Some(Session { db_path, id });
                }
                let session = slot.as_ref().expect("session was just adopted").id.clone();

                f(s, &session)
            })())
        });

        match outcome {
            Ok(inner) => inner,
            // NotOpen lands here: an undo arrived before db_open.
            Err(e) => Err(UndoError::Store(e.to_string())),
        }
    }
}

/// The entity's `updated_at` as the operation just left it, or `None` when the
/// record does not touch a markup.
fn entity_stamp(store: &Store, record: &UndoRecord) -> Result<Option<String>, UndoError> {
    match apply::markup_entity(record) {
        None => Ok(None),
        Some(id) => apply::markup_updated_at(store, id),
    }
}

/// Point every log entry for this entity at the row as it now stands.
fn resync(
    store: &Store,
    session: &str,
    record: &UndoRecord,
    stamp: Option<&str>,
) -> Result<(), UndoError> {
    match apply::markup_entity(record) {
        None => Ok(()),
        Some(id) => log::restamp_entity(store, session, id, stamp),
    }
}

fn nothing(status: UndoStatus) -> UndoOutcome {
    UndoOutcome {
        ok: false,
        op: None,
        label: None,
        target: None,
        status,
    }
}

/// A session id from SQLite's own RNG, so this module needs no `rand`.
fn new_session_id(store: &Store) -> Result<String, UndoError> {
    let rows = store
        .all("SELECT lower(hex(randomblob(8))) AS id", &[])
        .map_err(apply::store_err)?;
    rows.first()
        .and_then(|r| r.get("id"))
        .and_then(Json::as_str)
        .map(String::from)
        .ok_or_else(|| UndoError::Store("could not generate a session id".into()))
}

/// Everything or nothing.
///
/// `BEGIN IMMEDIATE` rather than a plain `BEGIN`: the write lock is taken up
/// front, so a revert can never get halfway and then discover it cannot commit.
fn transact<T>(
    store: &Store,
    f: impl FnOnce(&Store) -> Result<T, UndoError>,
) -> Result<T, UndoError> {
    store.exec("BEGIN IMMEDIATE").map_err(apply::store_err)?;
    match f(store) {
        Ok(value) => {
            store.exec("COMMIT").map_err(apply::store_err)?;
            Ok(value)
        }
        Err(e) => {
            // The original failure is what the caller needs to see; a rollback
            // that also fails would only bury it.
            let _ = store.exec("ROLLBACK");
            Err(e)
        }
    }
}
