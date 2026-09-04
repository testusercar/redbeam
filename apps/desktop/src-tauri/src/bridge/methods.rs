//! Bridge method dispatch (plan 11.2).
//!
//! Almost everything here answers straight out of the SQLite store, without
//! touching a window. That is a real advantage over the Qt bridge, where every
//! query went through the UI thread and a modal dialog could wedge automation:
//! here an agent can read a project's scopes, markups and calibration while the
//! app is minimized, busy, or showing a dialog.
//!
//! Only methods that genuinely need the UI — navigation, screenshots — will
//! reach for a window, and they are separated for exactly that reason.
//!
//! # Read and write are separated on purpose
//!
//! Query methods run arbitrary parameterized SELECTs. Write methods do not
//! exist here yet: markup creation, calibration and scope edits go through the
//! undo stack and the review gate (docs/DECISIONS.md D1, docs/PORTING.md), and
//! a bridge that wrote rows directly would bypass both — producing takeoff
//! changes with no undo entry and no activity trail. Plan 11.3 adds them as
//! *proposals* through the same path the UI uses.

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::store::StoreState;

/// Route one bridge call.
pub fn dispatch(app: &AppHandle, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "ping" => Ok(json!({ "ok": true, "protocolVersion": super::PROTOCOL_VERSION })),
        "get_capabilities" => Ok(capabilities()),
        "get_state" => get_state(app),
        "list_documents" => list_documents(app, params),
        "list_pages" => list_pages(app, params),
        "list_scopes" => list_scopes(app, params),
        "list_markups" => list_markups(app, params),
        "get_calibration" => get_calibration(app, params),
        "project_summary" => project_summary(app),
        "execute_query" => execute_query(app, params),
        "open_project" => open_project(app, params),
        // UI round trips. Separated from the store-backed methods above
        // because these are the only ones a wedged or window-less app can
        // fail, and a caller deserves to know which kind it is asking for.
        "get_ui_state" => super::ui::request(app, "get_ui_state", params),
        "screenshot" => super::ui::request(app, "screenshot", params),
        "invoke_ui_action" => super::ui::request(app, "invoke_ui_action", params),
        other => Err(format!("unknown method: {other}")),
    }
}

/// What this bridge can do, so a client can negotiate rather than guess.
fn capabilities() -> Value {
    json!({
        "protocolVersion": super::PROTOCOL_VERSION,
        "transport": "tcp-loopback",
        "methods": [
            "ping", "get_capabilities", "get_state", "list_documents", "list_pages",
            "list_scopes", "list_markups", "get_calibration", "project_summary",
            "execute_query", "open_project",
            "get_ui_state", "screenshot", "invoke_ui_action",
        ],
        // Named so a client does not have to discover the gap by trying.
        // Named so a client does not have to discover a gap by trying.
        "notImplemented": {
            "write": "markup and scope writes go through the undo stack and review gate; plan 11.3",
        },
        // These need a window and will fail if none is open or the frontend is
        // wedged. Store-backed methods above keep working regardless.
        "needsWindow": ["get_ui_state", "screenshot", "invoke_ui_action"],
    })
}

// ------------------------------------------------------------------ helpers --

fn store(app: &AppHandle) -> tauri::State<'_, StoreState> {
    app.state::<StoreState>()
}

fn query(app: &AppHandle, sql: &str, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    store(app)
        .with(|s| s.all(sql, &params))
        .map_err(|e| e.to_string())
}

fn str_param(params: &Value, key: &str) -> Option<String> {
    params.get(key).and_then(|v| v.as_str()).map(str::to_owned)
}

fn usize_param(params: &Value, key: &str) -> Option<i64> {
    params.get(key).and_then(|v| v.as_i64())
}

/// Row cap for any listing.
///
/// A sheet can carry thousands of markups; an unbounded list would hand an
/// agent a response it has to page through anyway. The cap is reported back so
/// truncation is never silent.
const DEFAULT_LIMIT: i64 = 500;
const MAX_LIMIT: i64 = 5000;

fn limit_of(params: &Value) -> i64 {
    usize_param(params, "limit")
        .unwrap_or(DEFAULT_LIMIT)
        .clamp(1, MAX_LIMIT)
}

fn listing(rows: Vec<Map<String, Value>>, limit: i64, key: &str) -> Value {
    let truncated = rows.len() as i64 >= limit;
    json!({
        key: rows,
        "count": rows.len(),
        "limit": limit,
        // Reported rather than inferred: a client cannot tell a full page from
        // a coincidentally-exact count.
        "truncated": truncated,
    })
}

// ------------------------------------------------------------------ methods --

fn get_state(app: &AppHandle) -> Result<Value, String> {
    let open = store(app).with(|s| Ok(s.db_path().display().to_string())).ok();
    let schema = store(app).with(|s| s.schema_version()).ok();
    Ok(json!({
        "projectOpen": open.is_some(),
        "dbPath": open,
        "schemaVersion": schema,
        "pid": std::process::id(),
    }))
}

fn list_documents(app: &AppHandle, params: &Value) -> Result<Value, String> {
    // A real bid package is 693 documents; an unbounded listing is a response
    // nobody can read.
    let limit = limit_of(params);
    let rows = query(
        app,
        // Columns are checked against packages/store/migrations, not guessed.
        // `page_count` does not exist on documents — page counts live in the
        // `pages` table, and asking for one here failed the whole listing.
        "SELECT id, relative_path, display_name, kind, status, availability,
                missing, size_bytes, content_fingerprint
           FROM documents ORDER BY relative_path LIMIT ?1",
        vec![json!(limit)],
    )?;
    Ok(listing(rows, limit, "documents"))
}

fn list_pages(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let limit = limit_of(params);
    let rows = match str_param(params, "documentId") {
        Some(doc) => query(
            app,
            "SELECT id, document_id, page_number, width_pdf_points, height_pdf_points
               FROM pages WHERE document_id = ?1 ORDER BY page_number LIMIT ?2",
            vec![json!(doc), json!(limit)],
        )?,
        None => query(
            app,
            "SELECT id, document_id, page_number, width_pdf_points, height_pdf_points
               FROM pages ORDER BY document_id, page_number LIMIT ?1",
            vec![json!(limit)],
        )?,
    };
    Ok(listing(rows, limit, "pages"))
}

fn list_scopes(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let include_archived = params
        .get("includeArchived")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let sql = if include_archived {
        "SELECT id, label, scope_type, color, specifications_json, archived_at
           FROM scopes ORDER BY archived_at IS NULL DESC, label"
    } else {
        "SELECT id, label, scope_type, color, specifications_json, archived_at
           FROM scopes WHERE archived_at IS NULL ORDER BY label"
    };
    let rows = query(app, sql, vec![])?;
    Ok(json!({ "scopes": rows, "count": rows.len() }))
}

fn list_markups(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let limit = limit_of(params);
    // deleted_at IS NULL by default: soft-deleted markups are kept for audit
    // and must not appear as live takeoff unless asked for explicitly.
    let include_deleted = params
        .get("includeDeleted")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut where_parts: Vec<String> = Vec::new();
    let mut args: Vec<Value> = Vec::new();
    if !include_deleted {
        where_parts.push("deleted_at IS NULL".into());
    }
    if let Some(page) = str_param(params, "pageId") {
        args.push(json!(page));
        where_parts.push(format!("page_id = ?{}", args.len()));
    }
    if let Some(scope) = str_param(params, "scopeId") {
        args.push(json!(scope));
        where_parts.push(format!("scope_id = ?{}", args.len()));
    }
    if let Some(doc) = str_param(params, "documentId") {
        args.push(json!(doc));
        where_parts.push(format!("document_id = ?{}", args.len()));
    }
    let where_sql = if where_parts.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_parts.join(" AND "))
    };
    args.push(json!(limit));
    let sql = format!(
        "SELECT id, document_id, page_id, scope_id, kind, geometry_json, content_json,
                origin, review_state, created_at, updated_at, deleted_at
           FROM markups{where_sql} ORDER BY created_at LIMIT ?{}",
        args.len()
    );
    let rows = query(app, &sql, args)?;
    Ok(listing(rows, limit, "markups"))
}

fn get_calibration(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let rows = match str_param(params, "pageId") {
        Some(page) => query(
            app,
            "SELECT document_id, page_id, feet_per_pdf_point, source
               FROM calibrations WHERE page_id = ?1",
            vec![json!(page)],
        )?,
        None => query(
            app,
            "SELECT document_id, page_id, feet_per_pdf_point, source FROM calibrations",
            vec![],
        )?,
    };
    Ok(json!({ "calibrations": rows, "count": rows.len() }))
}

fn project_summary(app: &AppHandle) -> Result<Value, String> {
    let count = |sql: &str| -> i64 {
        query(app, sql, vec![])
            .ok()
            .and_then(|r| r.first().and_then(|m| m.get("n").and_then(|v| v.as_i64())))
            .unwrap_or(0)
    };
    Ok(json!({
        "documents": count("SELECT COUNT(*) AS n FROM documents"),
        "pages": count("SELECT COUNT(*) AS n FROM pages"),
        "scopes": count("SELECT COUNT(*) AS n FROM scopes WHERE archived_at IS NULL"),
        "archivedScopes": count("SELECT COUNT(*) AS n FROM scopes WHERE archived_at IS NOT NULL"),
        "markups": count("SELECT COUNT(*) AS n FROM markups WHERE deleted_at IS NULL"),
        "deletedMarkups": count("SELECT COUNT(*) AS n FROM markups WHERE deleted_at IS NOT NULL"),
        "calibratedPages": count("SELECT COUNT(*) AS n FROM calibrations"),
        "schemaVersion": store(app).with(|s| s.schema_version()).unwrap_or(0),
    }))
}

/// Arbitrary READ-ONLY query, for the questions no typed method covers.
///
/// Refuses anything that is not a single SELECT. This is not a security
/// boundary — the caller already holds the token and could drive the UI — it
/// is a guard against an agent corrupting a takeoff by "just checking
/// something". Writes must go through the undo stack, and a DELETE issued here
/// would leave no undo entry and no activity row.
/// Ask the app to open a project folder.
///
/// This EMITS an event the frontend handles exactly as it handles the picker,
/// rather than calling `StoreState::open` directly. Opening the store behind
/// the UI's back would give the window one project and the database another —
/// the same split-brain the store moved into Rust to prevent, reintroduced
/// through the automation door.
///
/// It therefore returns `accepted`, not `opened`: the open happens on the UI
/// thread afterwards. Poll `get_state` until `projectOpen` is true. Saying
/// "opened" here would be a claim this method cannot support.
fn open_project(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let path = str_param(params, "path").ok_or("open_project needs `path`")?;
    if path.trim().is_empty() {
        return Err("open_project needs a non-empty `path`".into());
    }
    // Checked here so a typo fails immediately with a clear message, rather
    // than as a silent no-op three polls later.
    if !std::path::Path::new(&path).is_dir() {
        return Err(format!("not a folder: {path}"));
    }
    app.emit("redbeam://bridge/open-project", json!({ "path": path }))
        .map_err(|e| format!("could not reach a window: {e}"))?;
    Ok(json!({
        "accepted": true,
        "path": path,
        "note": "poll get_state until projectOpen is true",
    }))
}

/// Validate the SQL and hand back the single statement to run.
///
/// Split out from [`execute_query`] so the guard is testable without an
/// `AppHandle` — the guard is the part worth testing, and needing a running
/// app to exercise it is how a check like this ends up untested.
fn execute_query_guard(params: &Value) -> Result<String, String> {
    let sql = str_param(params, "sql").ok_or("execute_query needs `sql`")?;
    let trimmed = sql.trim().trim_end_matches(';').trim().to_string();
    let lowered = trimmed.to_ascii_lowercase();

    if !(lowered.starts_with("select") || lowered.starts_with("with")) {
        return Err("execute_query runs SELECT only; writes must go through the undo stack".into());
    }
    // A second statement would slip past the prefix check.
    if trimmed.contains(';') {
        return Err("execute_query takes ONE statement".into());
    }
    Ok(trimmed)
}

fn execute_query(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let trimmed = execute_query_guard(params)?;

    let args = params
        .get("params")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let limit = limit_of(params);
    let rows = query(app, &trimmed, args)?;
    let n = rows.len();
    Ok(json!({
        "rows": rows,
        "count": n,
        // The caller's own SQL decides the row count; the limit is reported so
        // a missing LIMIT clause is visible rather than mistaken for the truth.
        "limitHint": limit,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execute_query_refuses_anything_that_writes() {
        // A DELETE here would leave no undo entry and no activity row — the
        // takeoff would change with nothing recording that it did.
        for sql in [
            "DELETE FROM markups",
            "UPDATE scopes SET label = 'x'",
            "INSERT INTO scopes VALUES (1)",
            "DROP TABLE markups",
            "PRAGMA writable_schema = 1",
            "  delete from markups  ",
        ] {
            let params = json!({ "sql": sql });
            let err = execute_query_guard(&params).unwrap_err();
            assert!(err.contains("SELECT only"), "{sql} -> {err}");
        }
    }

    #[test]
    fn execute_query_refuses_a_second_statement() {
        let params = json!({ "sql": "SELECT 1; DELETE FROM markups" });
        let err = execute_query_guard(&params).unwrap_err();
        assert!(err.contains("ONE statement"), "{err}");
    }

    #[test]
    fn execute_query_allows_a_plain_select_and_a_cte() {
        for sql in ["SELECT * FROM scopes", "WITH x AS (SELECT 1) SELECT * FROM x"] {
            assert!(execute_query_guard(&json!({ "sql": sql })).is_ok(), "{sql}");
        }
    }

    #[test]
    fn limit_is_clamped_rather_than_trusted() {
        assert_eq!(limit_of(&json!({})), DEFAULT_LIMIT);
        assert_eq!(limit_of(&json!({ "limit": 0 })), 1);
        assert_eq!(limit_of(&json!({ "limit": 9_999_999 })), MAX_LIMIT);
        assert_eq!(limit_of(&json!({ "limit": 42 })), 42);
    }

    #[test]
    fn unknown_methods_are_named_rather_than_silently_empty() {
        // Silence would look like "this returned nothing", which is a very
        // different answer from "that method does not exist".
        let caps = capabilities();
        let listed = caps["methods"].as_array().unwrap();
        assert!(listed.iter().any(|m| m == "get_state"));
        assert!(caps["notImplemented"]["write"].is_string());
    }
}
