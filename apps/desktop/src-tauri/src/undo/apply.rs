//! The forward and inverse effect of every op, plus the guard that stops a
//! revert from clobbering a peer.
//!
//! # The SQL is not invented here
//!
//! Every statement mirrors `packages/store/src/repo.ts` — same columns, same
//! soft-delete behaviour, same `cal-{pageId}` calibration id, same activity
//! rows. Two implementations of the same write is a real cost; it is paid
//! because the revert has to happen inside the core's lock (D1: "Pop under the
//! same lock as the write") and a round trip out to a window to run the inverse
//! would put that lock down in the middle. If the column list here ever
//! disagrees with `repo.ts`, `repo.ts` is right.
//!
//! # Timestamps
//!
//! `repo.ts` writes `new Date().toISOString()`. SQLite's
//! `strftime('%Y-%m-%dT%H:%M:%fZ','now')` produces the same millisecond-
//! precision spelling, so rows written from either side sort and compare
//! against each other. Two writes inside the same millisecond do get the same
//! stamp — see [`guard`] for why that does not make the concurrency check
//! useless.

use serde::Deserialize;
use serde_json::{json, Value as Json};

use crate::store::db::Store;

use super::record::{MarkupImage, OpKind, UndoError, UndoRecord};

// ------------------------------------------------------------------ helpers --

pub(super) fn store_err(e: impl std::fmt::Display) -> UndoError {
    UndoError::Store(e.to_string())
}

/// One timestamp in `repo.ts`'s spelling, read from SQLite so the clock is the
/// database's and not this process's.
pub(super) fn now(store: &Store) -> Result<String, UndoError> {
    let rows = store
        .all("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS t", &[])
        .map_err(store_err)?;
    rows.first()
        .and_then(|r| r.get("t"))
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| UndoError::Store("could not read the current time".into()))
}

fn run(store: &Store, sql: &str, params: &[Json]) -> Result<(), UndoError> {
    store.run(sql, params).map_err(store_err)
}

/// Append to the audit trail, exactly as `repo.ts::logActivity` does.
///
/// The id is generated in SQL (`randomblob`) rather than in Rust so this module
/// needs no random-number dependency, and so the shape stays close to the
/// `act-...` ids the TypeScript path writes.
fn log_activity(
    store: &Store,
    event_type: &str,
    entity_type: &str,
    entity_id: Option<&str>,
    origin: &str,
    details: Json,
) -> Result<(), UndoError> {
    let details = serde_json::to_string(&details).unwrap_or_else(|_| "{}".to_string());
    run(
        store,
        "INSERT INTO activity(id, event_type, entity_type, entity_id, origin, details_json, created_at)
         VALUES('act-' || lower(hex(randomblob(6))), ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        &[
            json!(event_type),
            json!(entity_type),
            entity_id.map(Json::from).unwrap_or(Json::Null),
            json!(origin),
            json!(details),
        ],
    )
}

fn entity_id(rec: &UndoRecord) -> Result<String, UndoError> {
    rec.entity_id
        .clone()
        .ok_or_else(|| UndoError::Malformed(format!("{} needs an entityId", rec.op)))
}

/// Geometry is stored as the JSON text the caller sent. Anything that is not an
/// array is a caller bug, not something to be helpful about.
fn rings_text(value: &Json) -> Result<String, UndoError> {
    if !value.is_array() {
        return Err(UndoError::Malformed(
            "geometry must be an array of rings".into(),
        ));
    }
    serde_json::to_string(value).map_err(|e| UndoError::Malformed(e.to_string()))
}

/// A markup's per-kind payload as stored text.
///
/// Never fails: unlike geometry, an unreadable content blob is not a reason to
/// refuse an undo. A dimension that comes back without its label is a smaller
/// loss than an undo stack that will not replay.
fn content_text(value: &Json) -> String {
    if value.is_null() {
        return "{}".to_string();
    }
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}

fn scope_id(value: &Json) -> Result<Json, UndoError> {
    match value {
        Json::Null => Ok(Json::Null),
        Json::String(_) => Ok(value.clone()),
        other => Err(UndoError::Malformed(format!(
            "a scope id must be a string or null, got {other}"
        ))),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalibrationAfter {
    feet_per_pdf_point: f64,
    #[serde(default = "default_source")]
    source: String,
}

fn default_source() -> String {
    "reference-line".to_string()
}

// -------------------------------------------------------------- primitives --

fn markup_exists(store: &Store, id: &str) -> Result<bool, UndoError> {
    let rows = store
        .all("SELECT id FROM markups WHERE id = ?", &[json!(id)])
        .map_err(store_err)?;
    Ok(!rows.is_empty())
}

fn insert_markup(store: &Store, m: &MarkupImage, ts: &str) -> Result<(), UndoError> {
    run(
        store,
        "INSERT INTO markups(id, document_id, page_id, scope_id, kind, geometry_json,
                             style_json, content_json, origin, review_state, created_at, updated_at)
         VALUES(?,?,?,?,?,?,'{}',?,?,?,?,?)",
        &[
            json!(m.id),
            json!(m.document_id),
            json!(m.page_id),
            m.scope_id.clone().map(Json::from).unwrap_or(Json::Null),
            json!(m.kind),
            json!(rings_text(&m.rings)?),
            json!(content_text(&m.content)),
            json!(m.origin),
            json!(m.review_state),
            json!(ts),
            json!(ts),
        ],
    )
}

fn set_geometry(store: &Store, id: &str, rings: &Json, ts: &str) -> Result<(), UndoError> {
    run(
        store,
        "UPDATE markups SET geometry_json = ?, updated_at = ? WHERE id = ?",
        &[json!(rings_text(rings)?), json!(ts), json!(id)],
    )
}

fn soft_delete(store: &Store, id: &str, ts: &str) -> Result<(), UndoError> {
    run(
        store,
        "UPDATE markups SET deleted_at = ?, updated_at = ? WHERE id = ?",
        &[json!(ts), json!(ts), json!(id)],
    )
}

fn restore(store: &Store, id: &str, ts: &str) -> Result<(), UndoError> {
    run(
        store,
        "UPDATE markups SET deleted_at = NULL, updated_at = ? WHERE id = ?",
        &[json!(ts), json!(id)],
    )
}

fn assign_scope(store: &Store, id: &str, scope: &Json, ts: &str) -> Result<(), UndoError> {
    run(
        store,
        "UPDATE markups SET scope_id = ?, updated_at = ? WHERE id = ?",
        &[scope_id(scope)?, json!(ts), json!(id)],
    )
}

fn save_calibration(
    store: &Store,
    document_id: &str,
    page_id: &str,
    feet_per_pdf_point: f64,
    source: &str,
    ts: &str,
) -> Result<(), UndoError> {
    run(
        store,
        "INSERT INTO calibrations(id, document_id, page_id, feet_per_pdf_point, source, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(document_id, page_id) DO UPDATE SET
           feet_per_pdf_point=excluded.feet_per_pdf_point,
           source=excluded.source, updated_at=excluded.updated_at",
        &[
            json!(format!("cal-{page_id}")),
            json!(document_id),
            json!(page_id),
            json!(feet_per_pdf_point),
            json!(source),
            json!(ts),
            json!(ts),
        ],
    )
}

fn delete_calibration(store: &Store, page_id: &str) -> Result<(), UndoError> {
    run(
        store,
        "DELETE FROM calibrations WHERE page_id = ?",
        &[json!(page_id)],
    )
}

// ------------------------------------------------------------------- apply --

/// Do (or redo) what the record describes.
pub fn apply(store: &Store, rec: &UndoRecord) -> Result<(), UndoError> {
    let ts = now(store)?;
    match rec.kind()? {
        OpKind::CreateMarkup => {
            let m: MarkupImage = serde_json::from_value(rec.after.clone())
                .map_err(|e| UndoError::Malformed(format!("create_markup image: {e}")))?;
            // On a REDO the row still exists — revert() soft-deletes rather
            // than dropping it, so a plain INSERT would violate the primary
            // key. Restore the existing row and put its geometry back instead.
            // Same reasoning, and same behaviour, as `commands.ts::createMarkup`.
            if markup_exists(store, &m.id)? {
                restore(store, &m.id, &ts)?;
                set_geometry(store, &m.id, &m.rings, &ts)?;
            } else {
                insert_markup(store, &m, &ts)?;
            }
            log_activity(
                store,
                "markup.created",
                "markup",
                Some(&m.id),
                &m.origin,
                json!({ "kind": m.kind }),
            )
        }
        OpKind::DeleteMarkup => {
            let id = entity_id(rec)?;
            soft_delete(store, &id, &ts)?;
            log_activity(
                store,
                "markup.deleted",
                "markup",
                Some(&id),
                &rec.origin,
                json!({}),
            )
        }
        OpKind::EditGeometry => {
            let id = entity_id(rec)?;
            set_geometry(store, &id, &rec.after, &ts)?;
            log_activity(
                store,
                "markup.geometry_changed",
                "markup",
                Some(&id),
                &rec.origin,
                json!({ "what": rec.label }),
            )
        }
        OpKind::ReassignScope => {
            let id = entity_id(rec)?;
            assign_scope(store, &id, &rec.after, &ts)?;
            log_activity(
                store,
                "markup.scope_changed",
                "markup",
                Some(&id),
                &rec.origin,
                json!({ "from": rec.before, "to": rec.after }),
            )
        }
        OpKind::SetCalibration => {
            let page_id = entity_id(rec)?;
            let document_id = rec.document_id.clone().ok_or_else(|| {
                UndoError::Malformed("set_calibration needs a documentId".into())
            })?;
            let after: CalibrationAfter = serde_json::from_value(rec.after.clone())
                .map_err(|e| UndoError::Malformed(format!("set_calibration payload: {e}")))?;
            save_calibration(
                store,
                &document_id,
                &page_id,
                after.feet_per_pdf_point,
                &after.source,
                &ts,
            )?;
            log_activity(
                store,
                "page.calibrated",
                "page",
                Some(&page_id),
                &rec.origin,
                json!({ "feetPerPdfPoint": after.feet_per_pdf_point, "previous": rec.before }),
            )
        }
        OpKind::Batch => {
            for child in rec.children()? {
                apply(store, &child)?;
            }
            Ok(())
        }
    }
}

// ------------------------------------------------------------------ revert --

/// Undo what the record describes.
///
/// `expected_updated_at` is what the entity's `updated_at` was when the command
/// was recorded. `None` means the op does not carry the guard.
pub fn revert(
    store: &Store,
    rec: &UndoRecord,
    expected_updated_at: Option<&str>,
) -> Result<(), UndoError> {
    let kind = rec.kind()?;
    if kind.needs_concurrency_check() {
        guard(store, rec, kind, expected_updated_at)?;
    }

    let ts = now(store)?;
    match kind {
        OpKind::CreateMarkup => {
            let m: MarkupImage = serde_json::from_value(rec.after.clone())
                .map_err(|e| UndoError::Malformed(format!("create_markup image: {e}")))?;
            // Soft delete rather than DELETE: the row is an audit record, and a
            // redo must be able to bring back the same id.
            soft_delete(store, &m.id, &ts)?;
            log_activity(
                store,
                "markup.create_undone",
                "markup",
                Some(&m.id),
                &m.origin,
                json!({}),
            )
        }
        OpKind::DeleteMarkup => {
            let id = entity_id(rec)?;
            restore(store, &id, &ts)?;
            log_activity(
                store,
                "markup.restored",
                "markup",
                Some(&id),
                &rec.origin,
                json!({}),
            )
        }
        OpKind::EditGeometry => {
            let id = entity_id(rec)?;
            set_geometry(store, &id, &rec.before, &ts)?;
            log_activity(
                store,
                "markup.geometry_reverted",
                "markup",
                Some(&id),
                &rec.origin,
                json!({}),
            )
        }
        OpKind::ReassignScope => {
            let id = entity_id(rec)?;
            assign_scope(store, &id, &rec.before, &ts)?;
            // `commands.ts::reassignScope.revert` writes no activity row. This
            // one does: a shared stack means the revert may be invisible to the
            // person who made the edit, and the audit trail is the only place
            // it shows up. The extra row is additive and breaks nothing.
            log_activity(
                store,
                "markup.scope_reverted",
                "markup",
                Some(&id),
                &rec.origin,
                json!({ "from": rec.after, "to": rec.before }),
            )
        }
        OpKind::SetCalibration => {
            let page_id = entity_id(rec)?;
            let document_id = rec.document_id.clone().ok_or_else(|| {
                UndoError::Malformed("set_calibration needs a documentId".into())
            })?;
            // A page that had no calibration must go back to having none, not
            // to a bogus zero — the schema CHECK(feet_per_pdf_point > 0) would
            // reject that anyway, and a zero scale would silently produce
            // nonsense quantities.
            match rec.before.as_f64() {
                None => delete_calibration(store, &page_id)?,
                Some(previous) => {
                    let source = serde_json::from_value::<CalibrationAfter>(rec.after.clone())
                        .map(|a| a.source)
                        .unwrap_or_else(|_| default_source());
                    save_calibration(store, &document_id, &page_id, previous, &source, &ts)?;
                }
            }
            log_activity(
                store,
                "page.calibration_reverted",
                "page",
                Some(&page_id),
                &rec.origin,
                json!({ "restored": rec.before }),
            )
        }
        OpKind::Batch => {
            // Reverse order, or later commands undo onto state their
            // predecessors have not yet restored.
            let children = rec.children()?;
            for child in children.iter().rev() {
                revert(store, child, None)?;
            }
            Ok(())
        }
    }
}

// ------------------------------------------------------------------- guard --

/// Refuse a revert that would write an absolute before-image over newer work.
///
/// D1: "Reverting must check the entity's `updated_at` against what the command
/// recorded, and refuse with a clear message rather than clobber."
///
/// Two checks, not one:
///
/// * **`updated_at`** — the cheap, general one D1 names.
/// * **the after-image is still in place** — because two writes inside the same
///   millisecond share a timestamp, and because it catches the case that
///   actually matters: the row no longer holds what this command put there, so
///   whatever is there now belongs to someone else. Without it, a peer drag
///   completing in the same millisecond would pass the timestamp check and be
///   silently overwritten, which is the exact failure D1 exists to prevent.
fn guard(
    store: &Store,
    rec: &UndoRecord,
    kind: OpKind,
    expected_updated_at: Option<&str>,
) -> Result<(), UndoError> {
    let id = entity_id(rec)?;
    let rows = store
        .all(
            "SELECT updated_at, geometry_json, scope_id FROM markups WHERE id = ?",
            &[json!(id)],
        )
        .map_err(store_err)?;

    let row = rows.first().ok_or_else(|| UndoError::Conflict {
        entity: format!("markup {id}"),
        label: rec.label.clone(),
        detail: "the row no longer exists".into(),
    })?;

    if let Some(expected) = expected_updated_at {
        let current = row.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
        if current != expected {
            return Err(UndoError::Conflict {
                entity: format!("markup {id}"),
                label: rec.label.clone(),
                detail: format!("last edited {current}, this command expected {expected}"),
            });
        }
    }

    let still_ours = match kind {
        OpKind::EditGeometry => {
            let text = row
                .get("geometry_json")
                .and_then(|v| v.as_str())
                .unwrap_or("null");
            // Compared as parsed values, not as text: two serializers agree on
            // the numbers but need not agree on whitespace or key order.
            serde_json::from_str::<Json>(text).unwrap_or(Json::Null) == rec.after
        }
        OpKind::ReassignScope => row.get("scope_id").cloned().unwrap_or(Json::Null) == rec.after,
        _ => true,
    };

    if !still_ours {
        return Err(UndoError::Conflict {
            entity: format!("markup {id}"),
            label: rec.label.clone(),
            detail: "it now holds a value this command did not write".into(),
        });
    }

    Ok(())
}

/// A markup's current `updated_at`, or `None` if there is no such row.
///
/// This is the value the guard compares against. It is read *after* an effect
/// has landed, so it describes the row as the stack last left it.
pub(super) fn markup_updated_at(store: &Store, id: &str) -> Result<Option<String>, UndoError> {
    let rows = store
        .all("SELECT updated_at FROM markups WHERE id = ?", &[json!(id)])
        .map_err(store_err)?;
    Ok(rows
        .first()
        .and_then(|r| r.get("updated_at"))
        .and_then(|v| v.as_str())
        .map(String::from))
}

/// The markup a record touches, if it touches one.
pub(super) fn markup_entity(rec: &UndoRecord) -> Option<&str> {
    if rec.entity_type == "markup" {
        rec.entity_id.as_deref()
    } else {
        None
    }
}
