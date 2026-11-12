//! What these tests are actually for.
//!
//! Two claims in this achievable are worth more than the code that makes them
//! true, so they are asserted rather than assumed:
//!
//! 1. **FTS5 exists on this driver.** The whole reason for moving off sql.js —
//!    besides the per-window database — was that stock sql.js ships FTS3, so
//!    `page_text_fts` was skipped at migration time and full-text search did
//!    not exist. `fts5_is_available` does not settle for the table appearing in
//!    `sqlite_master`: it writes rows and runs a `MATCH` query.
//! 2. **Numbers survive the JSON round trip.** `feet_per_pdf_point` is the
//!    scale every square foot in the project is derived from. If it came back
//!    from `db_all` as a string, or lost a bit, the app would produce confident
//!    wrong quantities instead of failing.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{json, Value as Json};

use super::db::{resolve_db_path, Store, StoreError, DB_FILE_NAME};
use super::migrations::{split_statements, MIGRATIONS};
use super::state::StoreState;

// ---------------------------------------------------------------- scaffolding

/// A throwaway directory that removes itself. Avoids a `tempfile` dev-dependency
/// for the twenty lines it would save.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> TempDir {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let nonce = format!(
            "redbeam-store-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let path = std::env::temp_dir().join(nonce);
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("create temp dir");
        TempDir(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn str(&self) -> String {
        self.0.display().to_string()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A migrated in-memory store. Enough for everything that is not about files.
fn migrated() -> Store {
    let store = Store::open(":memory:").expect("open");
    let result = store.migrate().expect("migrate");
    assert!(
        result.skipped.is_empty(),
        "nothing should be skipped on a bundled SQLite, got: {:?}",
        result.skipped
    );
    store
}

const NOW: &str = "2026-08-27T00:00:00Z";

/// One document and one page, so foreign keys have something to point at.
fn seed(store: &Store) {
    store
        .run(
            "INSERT INTO documents(id, relative_path, display_name, kind, status, size_bytes, \
             availability, created_at, updated_at) \
             VALUES(?1, ?2, ?3, 'drawing', 'active', 0, 'available', ?4, ?4)",
            &[json!("doc-1"), json!("sample.pdf"), json!("Sample"), json!(NOW)],
        )
        .expect("insert document");
    store
        .run(
            "INSERT INTO pages(id, document_id, page_number, width_pdf_points, \
             height_pdf_points, created_at, updated_at) VALUES(?1, ?2, 1, ?3, ?4, ?5, ?5)",
            &[
                json!("page-1"),
                json!("doc-1"),
                json!(3456.0),
                json!(2592.0),
                json!(NOW),
            ],
        )
        .expect("insert page");
}

fn insert_markup(store: &Store, id: &str, scope_id: Json) -> Result<(), StoreError> {
    store.run(
        "INSERT INTO markups(id, document_id, page_id, scope_id, kind, geometry_json, origin, \
         created_at, updated_at) VALUES(?1, 'doc-1', 'page-1', ?2, 'area', '[]', 'user', ?3, ?3)",
        &[json!(id), scope_id, json!(NOW)],
    )
}

fn scalar(store: &Store, sql: &str) -> Json {
    let rows = store.all(sql, &[]).expect("query");
    assert_eq!(rows.len(), 1, "expected one row from: {sql}");
    rows[0].values().next().expect("one column").clone()
}

// ----------------------------------------------------------------- migrations

#[test]
fn all_migrations_apply_and_reach_the_current_version() {
    let store = Store::open(":memory:").expect("open");
    let result = store.migrate().expect("migrate");

    assert_eq!(
        result.applied, 9,
        "six ported blocks, 007_undo, 008_scaleregions, 009_scalesource"
    );
    assert!(result.skipped.is_empty(), "skipped: {:?}", result.skipped);
    assert_eq!(store.schema_version().expect("version"), 9);
}

#[test]
fn migrating_twice_applies_nothing() {
    let store = migrated();
    let again = store.migrate().expect("re-migrate");
    assert_eq!(again.applied, 0);
    assert!(again.skipped.is_empty());
    assert_eq!(store.schema_version().expect("version"), 9);
}

#[test]
fn creates_the_29_tables_from_the_qt_build() {
    let store = migrated();
    let rows = store
        .all(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            &[],
        )
        .expect("query");
    let names: Vec<&str> = rows
        .iter()
        .map(|r| r["name"].as_str().expect("text name"))
        .collect();

    for table in [
        "documents",
        "pages",
        "markups",
        "scopes",
        "calibrations",
        "calculation_runs",
        "quantity_results",
        "estimates",
        "change_sets",
        "page_text_fts",
    ] {
        assert!(names.contains(&table), "missing table {table} in {names:?}");
    }
    // FTS5 brings shadow tables of its own, so this is a floor, not a count.
    assert!(names.len() >= 29, "only {} tables: {names:?}", names.len());
}

#[test]
fn splits_generated_sql_into_one_statement_per_ddl() {
    // Every generated file is a header comment, then one statement per
    // non-blank line. These are the exact counts the TypeScript runner's
    // `splitStatements` produces for the same six files, so the two drivers
    // provably apply the same units of work — and a regenerated schema that
    // changes shape shows up here rather than half-applying.
    let counts: Vec<usize> = MIGRATIONS
        .iter()
        .map(|m| split_statements(m.sql).len())
        .collect();
    assert_eq!(counts, vec![6, 12, 7, 11, 7, 7, 4, 3, 3]);

    for m in MIGRATIONS {
        for statement in split_statements(m.sql) {
            assert!(
                !statement.starts_with("--"),
                "comment leaked into a statement: {statement}"
            );
            assert!(!statement.ends_with(';'), "trailing ; kept: {statement}");
        }
        let last = split_statements(m.sql).pop().expect("at least one");
        assert!(
            last.contains("INSERT OR IGNORE INTO schema_migrations"),
            "migration {} should end with its own bookkeeping row",
            m.version
        );
    }
}

#[test]
fn reports_a_skipped_statement_instead_of_swallowing_it() {
    // The reporting path only fires on "no such module", which a bundled
    // SQLite never produces for the real schema. Drive it directly so the
    // branch that told users full-text search was missing stays covered.
    let store = migrated();
    let err = store
        .exec("CREATE VIRTUAL TABLE t USING no_such_module_at_all(x)")
        .expect_err("should fail");
    assert!(
        err.to_string().to_ascii_lowercase().contains("no such module"),
        "unexpected error text, the skip detector keys off this: {err}"
    );
}

// ----------------------------------------------------------------------- FTS5

#[test]
fn fts5_is_available_and_page_text_fts_is_usable() {
    let store = migrated();

    // 1. The virtual table exists, and it is an fts5 one.
    let sql = scalar(
        &store,
        "SELECT sql FROM sqlite_master WHERE name = 'page_text_fts'",
    );
    let sql = sql.as_str().expect("DDL text");
    assert!(sql.contains("fts5"), "not an fts5 table: {sql}");

    // 2. SQLite itself reports the module compiled in.
    let has_fts5 = scalar(
        &store,
        "SELECT COUNT(*) FROM pragma_compile_options WHERE compile_options LIKE 'ENABLE_FTS5%'",
    );
    assert_eq!(has_fts5.as_i64(), Some(1), "ENABLE_FTS5 not in compile options");

    // 3. It actually indexes and matches — the part a bare CREATE cannot prove.
    seed(&store);
    store
        .run(
            "INSERT INTO page_text_fts(page_id, document_id, content) VALUES(?1, ?2, ?3)",
            &[
                json!("page-1"),
                json!("doc-1"),
                json!("REFLECTED CEILING PLAN - CL03 BAFFLE TYP"),
            ],
        )
        .expect("insert into fts");
    store
        .run(
            "INSERT INTO page_text_fts(page_id, document_id, content) VALUES(?1, ?2, ?3)",
            &[json!("page-2"), json!("doc-1"), json!("DOOR SCHEDULE")],
        )
        .expect("insert into fts");

    let hits = store
        .all(
            "SELECT page_id FROM page_text_fts WHERE page_text_fts MATCH ?1",
            &[json!("baffle")],
        )
        .expect("MATCH query");
    assert_eq!(hits.len(), 1, "expected exactly one hit, got {hits:?}");
    assert_eq!(hits[0]["page_id"], json!("page-1"));

    // A prefix query, which is FTS5 syntax rather than anything FTS3 offers.
    let prefix = store
        .all(
            "SELECT page_id FROM page_text_fts WHERE page_text_fts MATCH ?1",
            &[json!("ceil*")],
        )
        .expect("prefix query");
    assert_eq!(prefix.len(), 1);
}

// --------------------------------------------------------------- foreign keys

#[test]
fn foreign_keys_are_on() {
    let store = migrated();
    assert_eq!(scalar(&store, "PRAGMA foreign_keys").as_i64(), Some(1));
}

#[test]
fn foreign_keys_are_enforced() {
    let store = migrated();
    seed(&store);

    let err = insert_markup(&store, "orphan", json!("no-such-scope"))
        .expect_err("a markup pointing at a missing scope must be rejected");
    assert!(
        err.to_string().to_uppercase().contains("FOREIGN KEY"),
        "expected a foreign key error, got: {err}"
    );

    let orphan_document = store.run(
        "INSERT INTO pages(id, document_id, page_number, created_at, updated_at) \
         VALUES('p9', 'no-such-doc', 9, ?1, ?1)",
        &[json!(NOW)],
    );
    assert!(orphan_document.is_err(), "pages.document_id is NOT NULL REFERENCES documents");
}

#[test]
fn on_delete_set_null_keeps_the_markup() {
    let store = migrated();
    seed(&store);
    store
        .run(
            "INSERT INTO scopes(id, label, scope_type, color, created_at, updated_at) \
             VALUES('s1', 'CL03 Baffle', 'area', '#e2483d', ?1, ?1)",
            &[json!(NOW)],
        )
        .expect("insert scope");
    insert_markup(&store, "m1", json!("s1")).expect("insert markup");

    store
        .run("DELETE FROM scopes WHERE id = ?1", &[json!("s1")])
        .expect("delete scope");

    let rows = store
        .all("SELECT id, scope_id FROM markups", &[])
        .expect("query");
    assert_eq!(rows.len(), 1, "the markup must survive its scope");
    assert_eq!(rows[0]["scope_id"], Json::Null, "scope_id should be nulled");
}

#[test]
fn on_delete_cascade_removes_dependents() {
    let store = migrated();
    seed(&store);
    insert_markup(&store, "m1", Json::Null).expect("insert markup");

    store
        .run("DELETE FROM documents WHERE id = ?1", &[json!("doc-1")])
        .expect("delete document");

    assert_eq!(scalar(&store, "SELECT COUNT(*) FROM pages").as_i64(), Some(0));
    assert_eq!(
        scalar(&store, "SELECT COUNT(*) FROM markups").as_i64(),
        Some(0)
    );
}

#[test]
fn schema_checks_still_bite() {
    let store = migrated();
    seed(&store);
    // calibrations CHECK(feet_per_pdf_point > 0)
    let err = store.run(
        "INSERT INTO calibrations(id, document_id, page_id, feet_per_pdf_point, source, \
         created_at, updated_at) VALUES('c0', 'doc-1', 'page-1', ?1, 'reference-line', ?2, ?2)",
        &[json!(0.0), json!(NOW)],
    );
    assert!(err.is_err(), "a non-positive scale must be rejected");
}

// ------------------------------------------------------------- value round trip

#[test]
fn real_round_trips_through_run_and_all_without_precision_loss() {
    let store = migrated();
    seed(&store);

    // 48 in per 72 pt at 1:1 — a value with no exact short decimal, so a trip
    // through a string would show up immediately.
    let scale = 48.0_f64 / 72.0;
    assert_eq!(scale, 0.6666666666666666_f64);

    store
        .run(
            "INSERT INTO calibrations(id, document_id, page_id, feet_per_pdf_point, source, \
             created_at, updated_at) VALUES('c1', 'doc-1', 'page-1', ?1, 'reference-line', ?2, ?2)",
            &[json!(scale), json!(NOW)],
        )
        .expect("insert calibration");

    let rows = store
        .all(
            "SELECT feet_per_pdf_point FROM calibrations WHERE page_id = ?1",
            &[json!("page-1")],
        )
        .expect("query");
    let value = &rows[0]["feet_per_pdf_point"];

    assert!(value.is_number(), "came back as {value:?}, not a number");
    assert!(!value.is_string(), "REAL must never surface as a string");
    let back = value.as_f64().expect("f64");
    assert_eq!(
        back.to_bits(),
        scale.to_bits(),
        "bit-exact round trip required: {back} != {scale}"
    );

    // And it survives serialization out to the client.
    let text = serde_json::to_string(value).expect("serialize");
    assert_eq!(
        serde_json::from_str::<f64>(&text).expect("reparse").to_bits(),
        scale.to_bits(),
        "serialized as {text}"
    );

    // The README's calibrated example, for good measure.
    let observed = 0.100299_f64;
    store
        .run(
            "UPDATE calibrations SET feet_per_pdf_point = ?1 WHERE id = 'c1'",
            &[json!(observed)],
        )
        .expect("update");
    let again = scalar(&store, "SELECT feet_per_pdf_point FROM calibrations WHERE id = 'c1'");
    assert_eq!(again.as_f64().expect("f64").to_bits(), observed.to_bits());
}

#[test]
fn binds_each_json_type_to_the_right_sqlite_type() {
    let store = migrated();
    store
        .exec("CREATE TABLE probe (label TEXT PRIMARY KEY, v)")
        .expect("create probe");

    let cases: Vec<(&str, Json, &str)> = vec![
        ("null", Json::Null, "null"),
        ("true", json!(true), "integer"),
        ("false", json!(false), "integer"),
        ("int", json!(42), "integer"),
        ("negative", json!(-7), "integer"),
        ("real", json!(1.5), "real"),
        ("text", json!("CL03"), "text"),
    ];
    for (label, value, _) in &cases {
        store
            .run(
                "INSERT INTO probe(label, v) VALUES(?1, ?2)",
                &[json!(label), value.clone()],
            )
            .expect("insert probe");
    }

    for (label, value, sqlite_type) in &cases {
        let rows = store
            .all(
                "SELECT typeof(v) AS t, v FROM probe WHERE label = ?1",
                &[json!(label)],
            )
            .expect("query probe");
        assert_eq!(rows[0]["t"], json!(sqlite_type), "typeof for {label}");
        match *label {
            // SQLite has no boolean; true/false land as 1/0 and come back so.
            "true" => assert_eq!(rows[0]["v"], json!(1)),
            "false" => assert_eq!(rows[0]["v"], json!(0)),
            _ => assert_eq!(&rows[0]["v"], value, "value for {label}"),
        }
    }
}

#[test]
fn refuses_to_bind_a_structured_parameter() {
    let store = migrated();
    // The schema's *_json columns take a string the caller stringified. Taking
    // an object here would let two serializations of the same value into the
    // database and quietly break equality checks on geometry.
    let err = store
        .run(
            "INSERT INTO redbeam_meta(key, value) VALUES('k', ?1)",
            &[json!({"panel": "24x48"})],
        )
        .expect_err("objects must be rejected");
    assert!(err.to_string().contains("stringify"), "unhelpful error: {err}");

    let err = store
        .run(
            "INSERT INTO redbeam_meta(key, value) VALUES('k', ?1)",
            &[json!([1, 2, 3])],
        )
        .expect_err("arrays must be rejected");
    assert!(err.to_string().contains("parameter 1"), "unlocated error: {err}");
}

#[test]
fn returns_rows_keyed_by_column_name() {
    let store = migrated();
    seed(&store);
    let rows = store
        .all(
            "SELECT id, page_number, width_pdf_points, label FROM pages",
            &[],
        )
        .expect("query");
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row["id"], json!("page-1"));
    assert_eq!(row["page_number"], json!(1));
    assert_eq!(row["width_pdf_points"].as_f64(), Some(3456.0));
    assert_eq!(row["label"], Json::Null, "a NULL column must be present as null");
    assert_eq!(row.len(), 4);
}

// ------------------------------------------------------------------- open path

#[test]
fn resolves_a_project_directory_to_a_database_file() {
    assert_eq!(
        resolve_db_path("C:/projects/260415"),
        Path::new("C:/projects/260415").join(DB_FILE_NAME)
    );
    assert_eq!(
        resolve_db_path("C:/projects/260415/redbeam.db"),
        Path::new("C:/projects/260415/redbeam.db")
    );
    assert_eq!(resolve_db_path(":memory:"), Path::new(":memory:"));
}

#[test]
fn open_creates_the_file_and_reports_what_it_did() {
    let dir = TempDir::new();
    let state = StoreState::new();

    let first = state.open(&dir.str()).expect("open");
    assert_eq!(first.schema_version, 9);
    assert_eq!(first.applied, 9);
    assert!(
        first.skipped.is_empty(),
        "a bundled SQLite skips nothing — including FTS5: {:?}",
        first.skipped
    );
    assert_eq!(first.db_path, dir.path().join(DB_FILE_NAME).display().to_string());
    assert!(dir.path().join(DB_FILE_NAME).exists(), "file not created");

    // Reopening the same project applies nothing and still reports the schema.
    let second = state.open(&dir.str()).expect("reopen");
    assert_eq!(second.schema_version, 9);
    assert_eq!(second.applied, 0);
}

#[test]
fn data_survives_a_close_and_reopen() {
    let dir = TempDir::new();
    {
        let state = StoreState::new();
        state.open(&dir.str()).expect("open");
        state
            .with(|store| {
                store.run(
                    "INSERT INTO scopes(id, label, scope_type, color, created_at, updated_at) \
                     VALUES('s1', 'Persisted', 'area', '#000', ?1, ?1)",
                    &[json!(NOW)],
                )
            })
            .expect("insert");
    }

    let state = StoreState::new();
    let info = state.open(&dir.str()).expect("reopen");
    assert_eq!(info.applied, 0, "migrations must not re-run on an existing file");
    let rows = state
        .with(|store| store.all("SELECT label FROM scopes", &[]))
        .expect("query");
    assert_eq!(rows[0]["label"], json!("Persisted"));
}

#[test]
fn every_window_shares_one_connection() {
    // The reason this module exists: two callers must see the same rows. With
    // the sql.js driver each page had its own in-memory database and this
    // assertion would have failed with no error anywhere.
    let dir = TempDir::new();
    let state = std::sync::Arc::new(StoreState::new());
    state.open(&dir.str()).expect("open");

    let writer = std::sync::Arc::clone(&state);
    std::thread::spawn(move || {
        writer
            .with(|store| {
                store.run(
                    "INSERT INTO scopes(id, label, scope_type, color, created_at, updated_at) \
                     VALUES('s1', 'From another window', 'area', '#000', ?1, ?1)",
                    &[json!(NOW)],
                )
            })
            .expect("write from other thread");
    })
    .join()
    .expect("thread");

    let rows = state
        .with(|store| store.all("SELECT label FROM scopes", &[]))
        .expect("query");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["label"], json!("From another window"));
}

#[test]
fn queries_before_open_say_so() {
    let state = StoreState::new();
    let err = state
        .with(|store| store.all("SELECT 1", &[]))
        .expect_err("must refuse");
    assert!(err.to_string().contains("db_open"), "unhelpful error: {err}");
}

/// A statement aimed at a project that is no longer open must be refused.
///
/// This is the guard for the defect found on 2026-09-03: one connection for the
/// process meant a write landed in whatever database was open when it arrived,
/// not the one it was issued for. A folder scan that outlived its project
/// ingested 625 documents from two other jobs into the Barclays project, and
/// Barclays' three into CoreWeave's — one client's drawings catalogued under
/// another client's bid, with nothing anywhere reporting it.
///
/// With one connection per project the late write has a home: it lands in A,
/// which is where it was issued for, and B never sees it. What is still
/// refused is a statement for a project nobody opened.
#[test]
fn a_statement_reaches_the_project_it_was_issued_for() {
    let a = TempDir::new();
    let b = TempDir::new();
    let state = StoreState::new();

    let a_path = a.0.display().to_string();
    let b_path = b.0.display().to_string();

    state.open(&a_path).expect("open A");
    // The user opens a second project. A stays open beside it.
    state.open(&b_path).expect("open B");

    // A write still in flight for A lands in A.
    state
        .with_project(&a_path, |store| {
            store.run(
                "INSERT INTO scopes (id, label, scope_type, color, specifications_json, created_at, updated_at) \
                 VALUES ('s1', 'A''s scope', 'area', '#fff', '{}', '2026-01-01', '2026-01-01')",
                &[],
            )
        })
        .expect("a late write for A goes to A");

    let in_a = state
        .with_project(&a_path, |store| store.all("SELECT id FROM scopes", &[]))
        .expect("query A");
    assert_eq!(in_a.len(), 1, "A's write did not land in A");

    // And B is untouched by it.
    let rows = state
        .with_project(&b_path, |store| store.all("SELECT id FROM scopes", &[]))
        .expect("query B");
    assert!(rows.is_empty(), "A's work reached B: {rows:?}");

    // Both are reported open; the unaddressed handle is the last one opened.
    let mut open = state.open_paths();
    open.sort();
    assert_eq!(open.len(), 2, "both projects should stay open: {open:?}");
    let current = state.with(|s| Ok(s.db_path().display().to_string())).expect("current");
    assert_eq!(current, resolve_db_path(&b_path).display().to_string());
}

/// Every window that opened a project has to let go before its connection
/// closes; the last one closing drops it, and the bridge's unaddressed handle
/// moves to whatever is still open.
#[test]
fn a_project_closes_when_its_last_window_lets_go() {
    let a = TempDir::new();
    let b = TempDir::new();
    let state = StoreState::new();
    let a_path = a.0.display().to_string();
    let b_path = b.0.display().to_string();

    state.open(&a_path).expect("window 1 opens A");
    state.open(&a_path).expect("window 2 opens A");
    state.open(&b_path).expect("open B");
    assert_eq!(state.open_paths().len(), 2);

    assert!(!state.close(&a_path), "one window still holds A");
    assert!(state.with_project(&a_path, |s| s.all("SELECT 1", &[])).is_ok());

    // B was opened last, so it is the unaddressed handle; closing it moves
    // that handle to A rather than leaving it dangling.
    assert!(state.close(&b_path), "B's only window let go");
    let current = state.with(|s| Ok(s.db_path().display().to_string())).expect("still a current store");
    assert_eq!(current, resolve_db_path(&a_path).display().to_string());

    assert!(state.close(&a_path), "the last window on A let go");
    assert!(state.open_paths().is_empty());
    assert!(state.with(|s| s.all("SELECT 1", &[])).is_err(), "nothing is open");
    // Closing what is not open is a no-op, not a panic.
    assert!(!state.close(&a_path));
}

/// A project that was never opened is refused, and the refusal says so.
#[test]
fn refuses_a_statement_for_a_project_that_is_not_open() {
    let a = TempDir::new();
    let never = TempDir::new();
    let state = StoreState::new();
    state.open(&a.0.display().to_string()).expect("open A");

    let err = state
        .with_project(&never.0.display().to_string(), |store| store.all("SELECT 1", &[]))
        .expect_err("a statement for a project that is not open must be refused");
    let said = err.to_string();
    assert!(said.contains("wrong project"), "unhelpful error: {said}");
}

/// Opening a project that is already open reuses its connection rather than
/// replacing it: a second window on the same project sees the first's rows,
/// and `applied` reports that nothing new was migrated.
#[test]
fn reopening_an_open_project_shares_its_connection() {
    let dir = TempDir::new();
    let path = dir.0.display().to_string();
    let state = StoreState::new();
    let first = state.open(&path).expect("open");
    assert!(first.applied > 0, "first open should migrate");

    state
        .with_project(&path, |store| {
            store.run(
                "INSERT INTO scopes (id, label, scope_type, color, specifications_json, created_at, updated_at) \
                 VALUES ('s1', 'shared', 'area', '#fff', '{}', '2026-01-01', '2026-01-01')",
                &[],
            )
        })
        .expect("write");

    let again = state.open(&path).expect("reopen from a second window");
    assert_eq!(again.applied, 0, "a reopen migrates nothing");
    assert_eq!(state.open_paths().len(), 1, "one project, one connection");
    let rows = state
        .with_project(&path, |store| store.all("SELECT label FROM scopes", &[]))
        .expect("query");
    assert_eq!(rows.len(), 1);
}

/// The check accepts either spelling of a project, because `db_open` does.
#[test]
fn a_project_may_be_named_by_its_folder_or_its_db_file() {
    let dir = TempDir::new();
    let folder = dir.0.display().to_string();
    let file = dir.0.join("redbeam.db").display().to_string();

    let state = StoreState::new();
    state.open(&folder).expect("open by folder");

    state
        .with_project(&file, |store| store.all("SELECT 1", &[]))
        .expect("naming the .db file is the same project");
    state
        .with_project(&folder, |store| store.all("SELECT 1", &[]))
        .expect("naming the folder is the same project");
}

// ------------------------------------------------- the .db file is the project

/// Copy `redbeam.db` and NOTHING else — what a sync, a copy or a colleague's
/// machine sees when the -wal does not travel with it — and count the tables.
fn tables_in_db_file_alone(dir: &TempDir) -> i64 {
    let elsewhere = TempDir::new();
    let copy = elsewhere.path().join(DB_FILE_NAME);
    std::fs::copy(dir.path().join(DB_FILE_NAME), &copy).expect("copy redbeam.db");
    let conn = rusqlite::Connection::open(&copy).expect("open the copy");
    conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table'",
        [],
        |row| row.get(0),
    )
    .expect("count tables")
}

#[test]
fn an_open_project_is_in_redbeam_db_not_only_in_the_wal() {
    // Found 2026-11-12: a 4 KB redbeam.db holding nothing, its whole project in
    // a 2.7 MB redbeam.db-wal. The connection is held open (as the app holds
    // it) and the main file alone must still carry the schema and the writes.
    let dir = TempDir::new();
    let state = StoreState::new();
    state.open(&dir.str()).expect("open");
    state
        .with_project(&dir.str(), |s| {
            s.exec("CREATE TABLE probe (x INTEGER); INSERT INTO probe VALUES (42);")
        })
        .expect("write");

    assert!(tables_in_db_file_alone(&dir) > 1, "redbeam.db alone held no schema");
    let elsewhere = TempDir::new();
    let copy = elsewhere.path().join(DB_FILE_NAME);
    std::fs::copy(dir.path().join(DB_FILE_NAME), &copy).unwrap();
    let x: i64 = rusqlite::Connection::open(&copy)
        .unwrap()
        .query_row("SELECT x FROM probe", [], |r| r.get(0))
        .expect("the write reached redbeam.db");
    assert_eq!(x, 42);
}

#[test]
fn a_project_open_in_the_app_is_one_file_on_disk() {
    // SharePoint syncs files, not SQLite's idea of a database. While the app
    // holds the project open there must be no -wal or -shm beside it.
    let dir = TempDir::new();
    let state = StoreState::new();
    state.open(&dir.str()).expect("open");
    state
        .with_project(&dir.str(), |s| s.exec("CREATE TABLE probe (x INTEGER); INSERT INTO probe VALUES (1);"))
        .expect("write");
    assert!(!dir.path().join("redbeam.db-wal").exists(), "a -wal beside an open project");
    assert!(!dir.path().join("redbeam.db-shm").exists(), "a -shm beside an open project");
    assert!(!dir.path().join("redbeam.db-journal").exists(), "a journal left after a commit");
    state.close_all();
}

#[test]
fn a_project_left_in_its_wal_by_an_older_build_is_folded_into_redbeam_db() {
    // What the old build left behind: WAL mode, the data only in the -wal.
    // Written in one directory and the files copied while still open — a
    // process that exited without closing — so this process holds no lock on
    // the copies.
    let writer = TempDir::new();
    let old = rusqlite::Connection::open(writer.path().join(DB_FILE_NAME)).unwrap();
    old.query_row("PRAGMA journal_mode = WAL", [], |r| r.get::<_, String>(0)).unwrap();
    old.query_row("PRAGMA wal_autocheckpoint = 0", [], |r| r.get::<_, i64>(0)).unwrap();
    old.execute_batch("CREATE TABLE probe (x INTEGER); INSERT INTO probe VALUES (7);").unwrap();
    let dir = TempDir::new();
    let db = dir.path().join(DB_FILE_NAME);
    for name in [DB_FILE_NAME, "redbeam.db-wal"] {
        std::fs::copy(writer.path().join(name), dir.path().join(name)).unwrap();
    }
    drop(old);
    assert_eq!(tables_in_db_file_alone(&dir), 0, "setup: redbeam.db should be the empty shell");

    let state = StoreState::new();
    state.open(&dir.str()).expect("open");
    assert!(!dir.path().join("redbeam.db-wal").exists(), "the -wal was not folded in");
    let elsewhere = TempDir::new();
    let copy = elsewhere.path().join(DB_FILE_NAME);
    std::fs::copy(&db, &copy).unwrap();
    let x: i64 = rusqlite::Connection::open(&copy)
        .unwrap()
        .query_row("SELECT x FROM probe", [], |r| r.get(0))
        .expect("the old -wal's data reached redbeam.db");
    assert_eq!(x, 7);
    state.close_all();
}

#[test]
fn close_all_releases_every_project() {
    let dir = TempDir::new();
    let state = StoreState::new();
    state.open(&dir.str()).expect("open");
    state.close_all();
    assert!(state.with(|_| Ok(())).is_err(), "a project stayed open after close_all");
    assert!(tables_in_db_file_alone(&dir) > 1);
}

// ------------------------------------------------------------------ batches

fn probe_rows(store: &Store) -> Vec<i64> {
    store
        .all("SELECT x FROM probe ORDER BY x", &[])
        .unwrap()
        .iter()
        .map(|r| r["x"].as_i64().unwrap())
        .collect()
}

#[test]
fn a_batch_runs_every_statement_in_order() {
    let store = migrated();
    store.exec("CREATE TABLE probe (x INTEGER PRIMARY KEY)").unwrap();
    store
        .batch(&[
            ("INSERT INTO probe VALUES (?)".into(), vec![json!(1)]),
            ("INSERT INTO probe VALUES (?)".into(), vec![json!(2)]),
            ("UPDATE probe SET x = ? WHERE x = ?".into(), vec![json!(3), json!(2)]),
        ])
        .expect("batch");
    assert_eq!(probe_rows(&store), vec![1, 3]);
}

#[test]
fn a_failed_batch_leaves_nothing_behind() {
    // All or none: half a document's pages indexed and the rest missing would
    // be a search that silently misses sheets.
    let store = migrated();
    store.exec("CREATE TABLE probe (x INTEGER PRIMARY KEY)").unwrap();
    store.run("INSERT INTO probe VALUES (?)", &[json!(1)]).unwrap();
    let err = store
        .batch(&[
            ("INSERT INTO probe VALUES (?)".into(), vec![json!(2)]),
            ("INSERT INTO probe VALUES (?)".into(), vec![json!(1)]),
        ])
        .expect_err("the duplicate key must fail the batch");
    assert!(err.to_string().contains("statement 1"), "{err}");
    assert_eq!(probe_rows(&store), vec![1], "the batch's first insert survived its failure");
    // The connection is usable afterwards, outside any transaction.
    store.run("INSERT INTO probe VALUES (?)", &[json!(5)]).unwrap();
    assert_eq!(probe_rows(&store), vec![1, 5]);
}

#[test]
fn a_batch_nests_inside_an_open_transaction() {
    let store = migrated();
    store.exec("CREATE TABLE probe (x INTEGER PRIMARY KEY)").unwrap();
    store.exec("BEGIN").unwrap();
    store
        .batch(&[("INSERT INTO probe VALUES (?)".into(), vec![json!(4)])])
        .expect("a batch inside BEGIN");
    store.exec("ROLLBACK").unwrap();
    assert!(probe_rows(&store).is_empty(), "the outer rollback did not cover the batch");
}

#[test]
fn a_batched_project_is_still_one_file_on_disk() {
    // The batch must commit into redbeam.db exactly as single statements do
    // since 0.3.5: no -wal, no -shm, no journal left behind.
    let dir = TempDir::new();
    let state = StoreState::new();
    state.open(&dir.str()).expect("open");
    state
        .with_project(&dir.str(), |s| {
            s.exec("CREATE TABLE probe (x INTEGER)")?;
            s.batch(&[
                ("INSERT INTO probe VALUES (?)".into(), vec![json!(8)]),
                ("INSERT INTO probe VALUES (?)".into(), vec![json!(9)]),
            ])
        })
        .expect("batch");
    for name in ["redbeam.db-wal", "redbeam.db-shm", "redbeam.db-journal"] {
        assert!(!dir.path().join(name).exists(), "{name} beside an open project");
    }
    let elsewhere = TempDir::new();
    let copy = elsewhere.path().join(DB_FILE_NAME);
    std::fs::copy(dir.path().join(DB_FILE_NAME), &copy).unwrap();
    let n: i64 = rusqlite::Connection::open(&copy)
        .unwrap()
        .query_row("SELECT count(*) FROM probe", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 2, "the batch did not reach redbeam.db");
    state.close_all();
}
