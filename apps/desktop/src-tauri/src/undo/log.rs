//! The `undo_log` table: the stack itself.
//!
//! # The table IS the stack
//!
//! There is no in-memory copy of the stack anywhere. `state` on each row is
//! either `done` (undoable) or `undone` (redoable), and every window reads the
//! same rows through the same connection. That is what makes "two windows
//! hitting Ctrl+Z pop the same entry twice" impossible: the pop is an `UPDATE`
//! inside the transaction that also performs the revert, under the store lock.
//!
//! # Migration 7 is applied from here
//!
//! `store::migrations::MIGRATIONS` lists 1-6 and is owned elsewhere. Rather
//! than reach into it, this module applies `007_undo.sql` itself, once, the
//! first time a project needs an undo stack — using the same file, the same
//! splitter and the same `schema_migrations` bookkeeping, so the two paths
//! cannot disagree. When `MIGRATIONS` eventually gains a seventh entry this
//! becomes a no-op: `schema_migrations` already holds version 7 and
//! [`ensure_schema`] returns immediately.

use serde::Serialize;
use serde_json::{json, Map, Value as Json};

use crate::store::db::Store;
use crate::store::migrations::split_statements;

use super::apply::{now, store_err};
use super::record::{UndoError, UndoRecord, UndoTarget};

/// How deep the user's stack goes before the oldest entry falls off.
///
/// Matches the TypeScript `UndoStack`'s default so the two paths behave the
/// same. Deliberately not unbounded: D1 scopes the stack to the session, and a
/// stack that reaches back through a whole day of measuring is a way to revert
/// an edit whose context is long gone.
pub const DEFAULT_LIMIT: usize = 100;

pub const UNDO_MIGRATION_VERSION: i64 = 7;

/// The single source of truth, shared with the browser build — see
/// `store::migrations` for why this is `include_str!` and not a copy.
pub const UNDO_MIGRATION_SQL: &str =
    include_str!("../../../../../packages/store/migrations/007_undo.sql");

/// Apply migration 7 if this project has not seen it.
pub fn ensure_schema(store: &Store) -> Result<(), UndoError> {
    store
        .exec(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
        )
        .map_err(store_err)?;

    let seen = store
        .all(
            "SELECT version FROM schema_migrations WHERE version = ?",
            &[json!(UNDO_MIGRATION_VERSION)],
        )
        .map_err(store_err)?;
    if !seen.is_empty() {
        return Ok(());
    }

    for statement in split_statements(UNDO_MIGRATION_SQL) {
        store.exec(&statement).map_err(store_err)?;
    }
    Ok(())
}

/// One row of the stack.
pub struct Entry {
    pub seq: i64,
    pub record: UndoRecord,
    /// The entity's `updated_at` when this command was recorded. Feeds the
    /// concurrency guard; `None` for ops that do not carry one.
    pub expected_updated_at: Option<String>,
}

/// What the toolbar needs to render, and what the window needs to navigate.
///
/// D1 requirement 1: the control says what it will undo, before the keystroke.
/// Requirement 2: undo navigates to its target, which needs the entity, its
/// page and its document — hence [`UndoTarget`] alongside the labels.
///
/// camelCase on the wire: this is a view-model consumed straight by the
/// TypeScript `UndoStack`, not a database row.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoStatus {
    pub can_undo: bool,
    pub can_redo: bool,
    pub undo_label: Option<String>,
    pub redo_label: Option<String>,
    /// How many user commands are currently undoable.
    pub depth: usize,
    pub undo_target: Option<UndoTarget>,
    pub redo_target: Option<UndoTarget>,
}

/// The result of an `undo_apply` / `undo_redo`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoOutcome {
    /// False when there was nothing to do. Not an error: pressing Ctrl+Z at the
    /// bottom of the stack is normal.
    pub ok: bool,
    pub op: Option<String>,
    pub label: Option<String>,
    pub target: Option<UndoTarget>,
    /// The stack as it stands afterwards, so the caller needs no second round
    /// trip to refresh a toolbar that every window shares.
    pub status: UndoStatus,
}

// ------------------------------------------------------------------ reading --

fn text(row: &Map<String, Json>, key: &str) -> Option<String> {
    row.get(key).and_then(|v| v.as_str()).map(String::from)
}

fn parse_json(row: &Map<String, Json>, key: &str) -> Json {
    row.get(key)
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(Json::Null)
}

fn to_entry(row: &Map<String, Json>) -> Result<Entry, UndoError> {
    Ok(Entry {
        seq: row
            .get("seq")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| UndoError::Malformed("undo_log row has no seq".into()))?,
        expected_updated_at: text(row, "expected_updated_at"),
        record: UndoRecord {
            op: text(row, "op").unwrap_or_default(),
            label: text(row, "label").unwrap_or_default(),
            entity_type: text(row, "entity_type").unwrap_or_default(),
            entity_id: text(row, "entity_id"),
            document_id: text(row, "document_id"),
            page_id: text(row, "page_id"),
            before: parse_json(row, "before_json"),
            after: parse_json(row, "after_json"),
            origin: text(row, "origin").unwrap_or_else(|| "user".into()),
            window_label: text(row, "window_label"),
        },
    })
}

const COLUMNS: &str = "seq, op, label, entity_type, entity_id, document_id, page_id,
                       before_json, after_json, expected_updated_at, origin, window_label";

/// The newest undoable user command, or `None` at the bottom of the stack.
///
/// `origin = 'user'` is not decoration — D1 excludes agent-origin commands from
/// this stack, because reverting an accepted proposal without touching its
/// `change_sets` decision row leaves an audit trail that lies.
pub fn top_done(store: &Store, session: &str) -> Result<Option<Entry>, UndoError> {
    one(
        store,
        &format!(
            "SELECT {COLUMNS} FROM undo_log
             WHERE session_id = ? AND origin = 'user' AND state = 'done'
             ORDER BY seq DESC LIMIT 1"
        ),
        session,
    )
}

/// The most recently undone command — the lowest `seq` of the undone run,
/// because undo walks downwards and redo has to walk back up the same way.
pub fn top_undone(store: &Store, session: &str) -> Result<Option<Entry>, UndoError> {
    one(
        store,
        &format!(
            "SELECT {COLUMNS} FROM undo_log
             WHERE session_id = ? AND origin = 'user' AND state = 'undone'
             ORDER BY seq ASC LIMIT 1"
        ),
        session,
    )
}

fn one(store: &Store, sql: &str, session: &str) -> Result<Option<Entry>, UndoError> {
    let rows = store.all(sql, &[json!(session)]).map_err(store_err)?;
    match rows.first() {
        None => Ok(None),
        Some(row) => Ok(Some(to_entry(row)?)),
    }
}

pub fn depth(store: &Store, session: &str) -> Result<usize, UndoError> {
    let rows = store
        .all(
            "SELECT COUNT(*) AS n FROM undo_log
             WHERE session_id = ? AND origin = 'user' AND state = 'done'",
            &[json!(session)],
        )
        .map_err(store_err)?;
    Ok(rows
        .first()
        .and_then(|r| r.get("n"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
        .max(0) as usize)
}

pub fn status(store: &Store, session: &str) -> Result<UndoStatus, UndoError> {
    let undoable = top_done(store, session)?;
    let redoable = top_undone(store, session)?;
    Ok(UndoStatus {
        can_undo: undoable.is_some(),
        can_redo: redoable.is_some(),
        undo_label: undoable.as_ref().map(|e| e.record.label.clone()),
        redo_label: redoable.as_ref().map(|e| e.record.label.clone()),
        depth: depth(store, session)?,
        undo_target: undoable.as_ref().map(|e| UndoTarget::from(&e.record)),
        redo_target: redoable.as_ref().map(|e| UndoTarget::from(&e.record)),
    })
}

// ------------------------------------------------------------------ writing --

/// Append a command to the stack.
///
/// `expected_updated_at` is read by the caller *after* the command's effect has
/// landed, so it describes the row as this command left it.
///
/// Pushing a user command clears the redo branch, which is the behaviour every
/// editor has: once you diverge, the old future is gone. D1 makes that global —
/// any window's new edit discards the redo future for every window.
pub fn push(
    store: &Store,
    session: &str,
    rec: &UndoRecord,
    expected_updated_at: Option<&str>,
    limit: usize,
) -> Result<i64, UndoError> {
    if rec.is_user() {
        clear_redo(store, session)?;
    }

    let ts = now(store)?;
    store
        .run(
            "INSERT INTO undo_log(session_id, op, label, entity_type, entity_id, document_id,
                                  page_id, before_json, after_json, expected_updated_at, origin,
                                  window_label, state, created_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'done',?)",
            &[
                json!(session),
                json!(rec.op),
                json!(rec.label),
                json!(rec.entity_type),
                opt(&rec.entity_id),
                opt(&rec.document_id),
                opt(&rec.page_id),
                json!(serde_json::to_string(&rec.before).unwrap_or_else(|_| "null".into())),
                json!(serde_json::to_string(&rec.after).unwrap_or_else(|_| "null".into())),
                expected_updated_at.map(Json::from).unwrap_or(Json::Null),
                json!(rec.origin),
                opt(&rec.window_label),
                json!(ts),
            ],
        )
        .map_err(store_err)?;

    trim(store, session, limit)?;

    let rows = store
        .all("SELECT last_insert_rowid() AS seq", &[])
        .map_err(store_err)?;
    Ok(rows
        .first()
        .and_then(|r| r.get("seq"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0))
}

fn opt(value: &Option<String>) -> Json {
    value.clone().map(Json::from).unwrap_or(Json::Null)
}

/// Move one entry between `done` and `undone`.
pub fn set_state(store: &Store, seq: i64, state: &str) -> Result<(), UndoError> {
    store
        .run(
            "UPDATE undo_log SET state = ? WHERE seq = ?",
            &[json!(state), json!(seq)],
        )
        .map_err(store_err)
}

/// Bring every entry for one entity up to date with the entity's `updated_at`.
///
/// # Why this is not cheating
///
/// The recorded stamp answers one question: *has anything the stack does not
/// know about written to this row since?* Every operation this module performs
/// — applying, reverting, redoing — legitimately moves `updated_at`, so leaving
/// the older entries pointing at a superseded stamp would make the second
/// `Ctrl+Z` of a chain refuse itself as a conflict against its own predecessor.
/// That is a false positive, and a guard that fires on the normal case is a
/// guard people learn to work around.
///
/// What is still caught is exactly what D1 is about: a write that did **not**
/// come through the stack — a peer window's drag landing between the edit and
/// the undo — because nothing re-stamps on its behalf. The second half of
/// [`super::apply::guard`], which checks the row still holds this command's own
/// after-image, covers the remainder.
pub fn restamp_entity(
    store: &Store,
    session: &str,
    entity_id: &str,
    stamp: Option<&str>,
) -> Result<(), UndoError> {
    store
        .run(
            "UPDATE undo_log SET expected_updated_at = ?
             WHERE session_id = ? AND entity_type = 'markup' AND entity_id = ?",
            &[
                stamp.map(Json::from).unwrap_or(Json::Null),
                json!(session),
                json!(entity_id),
            ],
        )
        .map_err(store_err)
}

/// Discard the redo future for the whole project.
pub fn clear_redo(store: &Store, session: &str) -> Result<(), UndoError> {
    store
        .run(
            "DELETE FROM undo_log WHERE session_id = ? AND state = 'undone'",
            &[json!(session)],
        )
        .map_err(store_err)
}

/// Drop the oldest entries once the stack is deeper than `limit`.
fn trim(store: &Store, session: &str, limit: usize) -> Result<(), UndoError> {
    store
        .run(
            "DELETE FROM undo_log
             WHERE seq IN (
               SELECT seq FROM undo_log
               WHERE session_id = ? AND origin = 'user' AND state = 'done'
               ORDER BY seq DESC LIMIT -1 OFFSET ?
             )",
            &[json!(session), json!(limit as i64)],
        )
        .map_err(store_err)
}

/// Empty this session's stack.
pub fn clear(store: &Store, session: &str) -> Result<(), UndoError> {
    store
        .run(
            "DELETE FROM undo_log WHERE session_id = ?",
            &[json!(session)],
        )
        .map_err(store_err)
}

/// Drop everything from a previous session.
///
/// D1, "Scope: the session, not forever" — the stack lives as long as the
/// project is open and is not replayed across restarts. Undo that reaches back
/// into last week invites reverting an edit whose context is long gone, and
/// `activity` already answers "what happened". Done on adoption rather than on
/// close because a crash never gets to run a close handler.
pub fn purge_other_sessions(store: &Store, session: &str) -> Result<(), UndoError> {
    store
        .run(
            "DELETE FROM undo_log WHERE session_id <> ?",
            &[json!(session)],
        )
        .map_err(store_err)
}
