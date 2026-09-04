//! What these tests are for.
//!
//! Three claims in D1 are worth more than the code that makes them true, so
//! they are asserted rather than assumed:
//!
//! 1. **A revert refuses rather than clobbers.** `edit_geometry` writes an
//!    absolute before-image; if a peer window reshaped the markup in between,
//!    undo must decline and leave the peer's work standing. That is
//!    `undo_refuses_when_a_peer_reshaped_the_markup`, and it is the single most
//!    important test in this module.
//! 2. **Agent-origin commands never enter the user stack.** Otherwise Ctrl+Z
//!    can revert an accepted proposal while the `change_sets` decision row goes
//!    on asserting a decision whose effect is gone.
//! 3. **Redo after a create restores the same id.** The row is soft-deleted, not
//!    dropped, so redo must not violate the primary key — the same behaviour the
//!    TypeScript `commands.test.ts` pins down.

use serde_json::{json, Value as Json};

use crate::store::state::StoreState;

use super::record::{UndoError, UndoRecord};
use super::state::UndoState;

// ---------------------------------------------------------------- scaffolding

const RING_A: &str = r#"[[{"x":0.1,"y":0.1},{"x":0.2,"y":0.1},{"x":0.2,"y":0.2}]]"#;
const RING_B: &str = r#"[[{"x":0.3,"y":0.3},{"x":0.4,"y":0.3},{"x":0.4,"y":0.4}]]"#;
const RING_C: &str = r#"[[{"x":0.5,"y":0.5},{"x":0.6,"y":0.5},{"x":0.6,"y":0.6}]]"#;

fn rings(text: &str) -> Json {
    serde_json::from_str(text).expect("ring fixture")
}

/// An open, migrated project with one document and one page, plus a fresh undo
/// handle. Every test gets its own in-memory database.
fn project() -> (StoreState, UndoState) {
    project_with_limit(super::log::DEFAULT_LIMIT)
}

fn project_with_limit(limit: usize) -> (StoreState, UndoState) {
    let store = StoreState::new();
    store.open(":memory:").expect("open");
    store
        .with(|s| {
            s.run(
                "INSERT INTO documents(id, relative_path, display_name, kind, status, size_bytes,
                                       availability, created_at, updated_at)
                 VALUES('doc-1','sample.pdf','Sample','drawing','active',0,'available',
                        datetime('now'), datetime('now'))",
                &[],
            )?;
            s.run(
                "INSERT INTO pages(id, document_id, page_number, width_pdf_points,
                                   height_pdf_points, created_at, updated_at)
                 VALUES('page-1','doc-1',1,1000,1000, datetime('now'), datetime('now'))",
                &[],
            )?;
            s.run(
                "INSERT INTO scopes(id, label, scope_type, color, specifications_json,
                                    created_at, updated_at)
                 VALUES('s1','S','area','#000','{}', datetime('now'), datetime('now'))",
                &[],
            )
        })
        .expect("seed");
    (store, UndoState::with_limit(limit))
}

fn record(value: Json) -> UndoRecord {
    serde_json::from_value(value).expect("record fixture")
}

fn create_markup(id: &str, origin: &str) -> UndoRecord {
    record(json!({
        "op": "create_markup",
        "label": "create area",
        "entityType": "markup",
        "entityId": id,
        "documentId": "doc-1",
        "pageId": "page-1",
        "after": {
            "id": id, "documentId": "doc-1", "pageId": "page-1", "scopeId": null,
            "kind": "area", "rings": rings(RING_A), "origin": origin,
            "reviewState": "accepted",
        },
        "origin": origin,
    }))
}

fn edit_geometry(id: &str, before: &str, after: &str) -> UndoRecord {
    record(json!({
        "op": "edit_geometry",
        "label": "move markup",
        "entityType": "markup",
        "entityId": id,
        "documentId": "doc-1",
        "pageId": "page-1",
        "before": rings(before),
        "after": rings(after),
        "origin": "user",
    }))
}

/// Live markups, ordered as `repo.ts::listMarkups` returns them.
fn live_markups(store: &StoreState) -> Vec<(String, String)> {
    store
        .with(|s| {
            s.all(
                "SELECT id, geometry_json FROM markups WHERE deleted_at IS NULL ORDER BY created_at",
                &[],
            )
        })
        .expect("list")
        .iter()
        .map(|r| {
            (
                r["id"].as_str().unwrap_or_default().to_string(),
                r["geometry_json"].as_str().unwrap_or_default().to_string(),
            )
        })
        .collect()
}

fn geometry_of(store: &StoreState, id: &str) -> Json {
    let rows = store
        .with(|s| s.all("SELECT geometry_json FROM markups WHERE id = ?", &[json!(id)]))
        .expect("geometry");
    serde_json::from_str(rows[0]["geometry_json"].as_str().expect("text")).expect("json")
}

fn activity_events(store: &StoreState) -> Vec<String> {
    store
        .with(|s| s.all("SELECT event_type FROM activity", &[]))
        .expect("activity")
        .iter()
        .map(|r| r["event_type"].as_str().unwrap_or_default().to_string())
        .collect()
}

// ------------------------------------------------------------- the stack ----

#[test]
fn creates_undoes_and_redoes_a_markup_keeping_its_id() {
    let (store, undo) = project();

    undo.record(&store, create_markup("m1", "user"), true, None)
        .expect("record");
    assert_eq!(live_markups(&store).len(), 1);

    undo.undo(&store).expect("undo");
    assert_eq!(live_markups(&store).len(), 0, "undo must remove it");

    let out = undo.redo(&store).expect("redo");
    assert!(out.ok);
    let after = live_markups(&store);
    assert_eq!(after.len(), 1);
    // The same id survives the round trip. The row was soft-deleted, so a redo
    // that INSERTed would violate the primary key instead.
    assert_eq!(after[0].0, "m1");
    assert_eq!(geometry_of(&store, "m1"), rings(RING_A));
}

#[test]
fn undoing_a_create_soft_deletes_rather_than_dropping_the_row() {
    let (store, undo) = project();
    undo.record(&store, create_markup("m1", "user"), true, None)
        .expect("record");
    undo.undo(&store).expect("undo");

    let all = store
        .with(|s| s.all("SELECT id, deleted_at FROM markups", &[]))
        .expect("rows");
    assert_eq!(all.len(), 1, "the row is an audit record; it must stay");
    assert!(all[0]["deleted_at"].is_string());
}

#[test]
fn unwinds_a_chain_of_edits_one_step_at_a_time() {
    let (store, undo) = project();
    undo.record(&store, create_markup("m1", "user"), true, None)
        .expect("create");
    undo.record(&store, edit_geometry("m1", RING_A, RING_B), true, None)
        .expect("edit 1");
    undo.record(&store, edit_geometry("m1", RING_B, RING_C), true, None)
        .expect("edit 2");
    assert_eq!(geometry_of(&store, "m1"), rings(RING_C));

    undo.undo(&store).expect("undo 1");
    assert_eq!(geometry_of(&store, "m1"), rings(RING_B));
    undo.undo(&store).expect("undo 2");
    assert_eq!(geometry_of(&store, "m1"), rings(RING_A));
    undo.undo(&store).expect("undo 3");
    assert_eq!(live_markups(&store).len(), 0);
}

#[test]
fn nothing_to_undo_is_not_an_error() {
    let (store, undo) = project();
    let out = undo.undo(&store).expect("undo");
    assert!(!out.ok);
    assert!(!out.status.can_undo);
    let out = undo.redo(&store).expect("redo");
    assert!(!out.ok);
}

#[test]
fn a_new_command_clears_the_redo_branch_for_everyone() {
    let (store, undo) = project();
    undo.record(&store, create_markup("a", "user"), true, None)
        .expect("a");
    undo.undo(&store).expect("undo");
    assert!(undo.status(&store).expect("status").can_redo);

    undo.record(&store, create_markup("b", "user"), true, None)
        .expect("b");
    assert!(
        !undo.status(&store).expect("status").can_redo,
        "once you diverge, the old future is gone"
    );
}

#[test]
fn drops_the_oldest_command_past_the_limit() {
    let (store, undo) = project_with_limit(3);
    for id in ["a", "b", "c", "d", "e"] {
        undo.record(&store, create_markup(id, "user"), true, None)
            .expect("create");
    }
    assert_eq!(undo.status(&store).expect("status").depth, 3);
}

#[test]
fn clear_drops_the_stack_without_reverting_anything() {
    let (store, undo) = project();
    undo.record(&store, create_markup("m1", "user"), true, None)
        .expect("create");
    let status = undo.clear(&store).expect("clear");
    assert!(!status.can_undo);
    assert_eq!(status.depth, 0);
    assert_eq!(live_markups(&store).len(), 1, "the markup stays");
}

// ------------------------------------------------- what the control says ----

#[test]
fn status_names_and_locates_what_it_will_undo() {
    let (store, undo) = project();
    undo.record(&store, create_markup("m1", "user"), true, None)
        .expect("create");
    undo.record(&store, edit_geometry("m1", RING_A, RING_B), true, None)
        .expect("edit");

    let status = undo.status(&store).expect("status");
    assert!(status.can_undo);
    assert!(!status.can_redo);
    // D1: "Not 'Undo' but 'Undo move markup — sheet A-514A.00'."
    assert_eq!(status.undo_label.as_deref(), Some("move markup"));
    let target = status.undo_target.expect("a target to navigate to");
    assert_eq!(target.entity_id.as_deref(), Some("m1"));
    assert_eq!(target.page_id.as_deref(), Some("page-1"));
    assert_eq!(target.document_id.as_deref(), Some("doc-1"));
    assert_eq!(status.depth, 2);
}

#[test]
fn status_serializes_camel_case_for_the_typescript_client() {
    let (store, undo) = project();
    undo.record(&store, create_markup("m1", "user"), true, None)
        .expect("create");
    let json = serde_json::to_value(undo.status(&store).expect("status")).expect("serialize");
    for key in [
        "canUndo",
        "canRedo",
        "undoLabel",
        "redoLabel",
        "depth",
        "undoTarget",
    ] {
        assert!(json.get(key).is_some(), "missing {key} in {json}");
    }
    assert_eq!(json["undoTarget"]["entityId"], json!("m1"));
}

// ------------------------------------------------ the concurrency guard -----

#[test]
fn undo_refuses_when_a_peer_reshaped_the_markup() {
    let (store, undo) = project();
    undo.record(&store, create_markup("m1", "user"), true, None)
        .expect("create");
    undo.record(&store, edit_geometry("m1", RING_A, RING_B), true, None)
        .expect("edit");

    // A peer window drags the same markup somewhere else. This is a direct
    // write, exactly as another window's `updateMarkupGeometry` would be.
    store
        .with(|s| {
            s.run(
                "UPDATE markups SET geometry_json = ?, updated_at = '2099-01-01T00:00:00.000Z'
                 WHERE id = 'm1'",
                &[json!(RING_C)],
            )
        })
        .expect("peer edit");

    let err = undo.undo(&store).expect_err("must refuse");
    match &err {
        UndoError::Conflict { label, .. } => assert_eq!(label, "move markup"),
        other => panic!("expected a conflict, got {other:?}"),
    }
    let message = err.to_string();
    assert!(message.contains("has changed since"), "{message}");
    assert!(message.contains("move markup"), "{message}");

    // The peer's work survives, which is the entire point.
    assert_eq!(geometry_of(&store, "m1"), rings(RING_C));
    // And the entry is still undoable: nothing was consumed by the refusal.
    assert!(undo.status(&store).expect("status").can_undo);
}

#[test]
fn the_guard_still_bites_when_the_timestamps_collide() {
    let (store, undo) = project();
    undo.record(&store, create_markup("m1", "user"), true, None)
        .expect("create");
    undo.record(&store, edit_geometry("m1", RING_A, RING_B), true, None)
        .expect("edit");

    // Same millisecond, different geometry: `updated_at` alone would wave this
    // through. The after-image check is what catches it.
    let stamp: String = store
        .with(|s| s.all("SELECT updated_at FROM markups WHERE id='m1'", &[]))
        .expect("stamp")[0]["updated_at"]
        .as_str()
        .expect("text")
        .to_string();
    store
        .with(|s| {
            s.run(
                "UPDATE markups SET geometry_json = ?, updated_at = ? WHERE id = 'm1'",
                &[json!(RING_C), json!(stamp)],
            )
        })
        .expect("peer edit");

    assert!(matches!(
        undo.undo(&store),
        Err(UndoError::Conflict { .. })
    ));
    assert_eq!(geometry_of(&store, "m1"), rings(RING_C));
}

#[test]
fn a_refused_undo_leaves_no_partial_write() {
    let (store, undo) = project();
    undo.record(&store, create_markup("m1", "user"), true, None)
        .expect("create");
    undo.record(&store, edit_geometry("m1", RING_A, RING_B), true, None)
        .expect("edit");
    let before_events = activity_events(&store).len();

    store
        .with(|s| {
            s.run(
                "UPDATE markups SET geometry_json = ?, updated_at = '2099-01-01T00:00:00.000Z'
                 WHERE id = 'm1'",
                &[json!(RING_C)],
            )
        })
        .expect("peer edit");

    assert!(undo.undo(&store).is_err());
    assert_eq!(
        activity_events(&store).len(),
        before_events,
        "a refused revert must not leave an audit row claiming it happened"
    );
}

#[test]
fn redo_restamps_the_guard_so_the_next_undo_is_not_a_false_conflict() {
    let (store, undo) = project();
    undo.record(&store, create_markup("m1", "user"), true, None)
        .expect("create");
    undo.record(&store, edit_geometry("m1", RING_A, RING_B), true, None)
        .expect("edit");

    undo.undo(&store).expect("undo");
    undo.redo(&store).expect("redo");
    assert_eq!(geometry_of(&store, "m1"), rings(RING_B));

    // Re-applying wrote a fresh updated_at. If it were not re-recorded, this
    // second undo would refuse itself.
    undo.undo(&store).expect("undo again");
    assert_eq!(geometry_of(&store, "m1"), rings(RING_A));
}

// ---------------------------------------------------- the review-gate line --

#[test]
fn agent_origin_commands_never_enter_the_user_stack() {
    let (store, undo) = project();

    let status = undo
        .record(&store, create_markup("agent-1", "agent"), true, None)
        .expect("record");
    assert!(
        !status.can_undo,
        "an agent proposal is reversed at the review gate, not with Ctrl+Z"
    );
    assert_eq!(status.depth, 0);
    assert_eq!(live_markups(&store).len(), 1, "but it was still applied");

    // It is written to the log — the record of what happened is not thrown away.
    let rows = store
        .with(|s| s.all("SELECT origin FROM undo_log", &[]))
        .expect("log");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["origin"], json!("agent"));
}

#[test]
fn undo_skips_past_an_agent_command_to_the_users_own() {
    let (store, undo) = project();
    undo.record(&store, create_markup("mine", "user"), true, None)
        .expect("user");
    undo.record(&store, create_markup("theirs", "agent"), true, None)
        .expect("agent");

    let out = undo.undo(&store).expect("undo");
    assert_eq!(out.target.expect("target").entity_id.as_deref(), Some("mine"));
    let live: Vec<String> = live_markups(&store).into_iter().map(|(id, _)| id).collect();
    assert_eq!(live, vec!["theirs".to_string()]);
}

// ------------------------------------------------------------ other ops -----

#[test]
fn reverts_a_scope_reassignment() {
    let (store, undo) = project();
    undo.record(&store, create_markup("m1", "user"), true, None)
        .expect("create");
    undo.record(
        &store,
        record(json!({
            "op": "reassign_scope", "label": "change scope", "entityType": "markup",
            "entityId": "m1", "documentId": "doc-1", "pageId": "page-1",
            "before": null, "after": "s1", "origin": "user",
        })),
        true,
        None,
    )
    .expect("reassign");

    let scope = store
        .with(|s| s.all("SELECT scope_id FROM markups WHERE id='m1'", &[]))
        .expect("scope");
    assert_eq!(scope[0]["scope_id"], json!("s1"));

    undo.undo(&store).expect("undo");
    let scope = store
        .with(|s| s.all("SELECT scope_id FROM markups WHERE id='m1'", &[]))
        .expect("scope");
    assert!(scope[0]["scope_id"].is_null());
}

#[test]
fn undoing_a_first_calibration_removes_it_entirely() {
    let (store, undo) = project();
    undo.record(
        &store,
        record(json!({
            "op": "set_calibration", "label": "calibrate page", "entityType": "page",
            "entityId": "page-1", "documentId": "doc-1", "pageId": "page-1",
            "before": null, "after": { "feetPerPdfPoint": 0.5, "source": "reference-line" },
            "origin": "user",
        })),
        true,
        None,
    )
    .expect("calibrate");

    let rows = store
        .with(|s| s.all("SELECT feet_per_pdf_point FROM calibrations", &[]))
        .expect("cal");
    assert_eq!(rows[0]["feet_per_pdf_point"], json!(0.5));

    undo.undo(&store).expect("undo");
    // Back to uncalibrated, NOT to zero — CHECK(feet_per_pdf_point > 0) would
    // reject that, and a zero scale would silently produce nonsense quantities.
    let rows = store
        .with(|s| s.all("SELECT feet_per_pdf_point FROM calibrations", &[]))
        .expect("cal");
    assert!(rows.is_empty());
}

#[test]
fn a_batch_applies_and_reverts_as_one_unit_in_reverse_order() {
    let (store, undo) = project();
    let batch = record(json!({
        "op": "batch", "label": "add two", "entityType": "batch",
        "after": { "children": [
            serde_json::to_value(create_markup("a", "user")).unwrap(),
            serde_json::to_value(create_markup("b", "user")).unwrap(),
        ]},
        "origin": "user",
    }));

    undo.record(&store, batch, true, None).expect("batch");
    assert_eq!(live_markups(&store).len(), 2);
    assert_eq!(undo.status(&store).expect("status").depth, 1, "one entry");

    undo.undo(&store).expect("undo");
    assert_eq!(live_markups(&store).len(), 0);
    undo.redo(&store).expect("redo");
    assert_eq!(live_markups(&store).len(), 2);
}

#[test]
fn record_without_applying_only_logs() {
    let (store, undo) = project();
    // The effect already landed — a window wrote it through db_run.
    store
        .with(|s| {
            s.run(
                "INSERT INTO markups(id, document_id, page_id, scope_id, kind, geometry_json,
                                     style_json, content_json, origin, review_state, created_at, updated_at)
                 VALUES('m1','doc-1','page-1',NULL,'area',?, '{}','{}','user','accepted',
                        datetime('now'), datetime('now'))",
                &[json!(RING_A)],
            )
        })
        .expect("pre-applied");

    let status = undo
        .record(&store, create_markup("m1", "user"), false, None)
        .expect("record");
    assert_eq!(status.depth, 1);
    assert_eq!(live_markups(&store).len(), 1, "no second row");
}

// ----------------------------------------------------------- the trail ------

#[test]
fn writes_the_activity_trail_and_never_the_review_queue() {
    let (store, undo) = project();
    undo.record(&store, create_markup("m1", "user"), true, None)
        .expect("create");
    undo.undo(&store).expect("undo");

    let events = activity_events(&store);
    assert!(events.iter().any(|e| e == "markup.created"), "{events:?}");
    assert!(
        events.iter().any(|e| e == "markup.create_undone"),
        "{events:?}"
    );

    // change_sets is the propose/decide gate; editing must not enqueue there.
    let queued = store
        .with(|s| s.all("SELECT id FROM change_sets", &[]))
        .expect("change_sets");
    assert!(queued.is_empty());
}

// ------------------------------------------------------------- lifecycle ----

#[test]
fn an_undo_before_the_project_is_open_says_so() {
    let undo = UndoState::new();
    let store = StoreState::new();
    let err = undo.status(&store).expect_err("no project");
    assert!(err.to_string().contains("db_open"), "{err}");
}

#[test]
fn rows_from_an_earlier_session_are_not_undoable() {
    let (store, undo) = project();
    undo.record(&store, create_markup("m1", "user"), true, None)
        .expect("create");
    assert!(undo.status(&store).expect("status").can_undo);

    // A second handle is a second run of the process against the same project.
    // D1: the stack is not replayed across restarts.
    let restarted = UndoState::new();
    assert!(!restarted.status(&store).expect("status").can_undo);
    let rows = store
        .with(|s| s.all("SELECT seq FROM undo_log", &[]))
        .expect("log");
    assert!(rows.is_empty(), "the earlier session's rows are purged");
}

#[test]
fn an_unknown_op_is_rejected_at_the_boundary() {
    let (store, undo) = project();
    undo.status(&store).expect("adopt the project first");
    let bad = record(json!({
        "op": "reticulate_splines", "label": "?", "entityType": "markup",
        "entityId": "m1", "origin": "user",
    }));
    let err = undo.record(&store, bad, true, None).expect_err("must reject");
    assert!(err.to_string().contains("reticulate_splines"), "{err}");
    let rows = store
        .with(|s| s.all("SELECT seq FROM undo_log", &[]))
        .expect("log");
    assert!(rows.is_empty(), "nothing may reach the log");
}

#[test]
fn migration_seven_registers_its_version() {
    let (store, undo) = project();
    undo.status(&store).expect("status");
    let rows = store
        .with(|s| {
            s.all(
                "SELECT version FROM schema_migrations WHERE version = ?",
                &[json!(super::log::UNDO_MIGRATION_VERSION)],
            )
        })
        .expect("versions");
    assert_eq!(rows.len(), 1, "007 must record itself like 001-006 do");
}
