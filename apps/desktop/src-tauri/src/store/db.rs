//! The [`Store`]: one process, one SQLite connection, one project file.

use std::fmt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::Connection;
use serde_json::{Map, Value as Json};

use super::json::{json_params_to_sql, row_to_json};
use super::migrations::{self, MigrateResult, MIGRATIONS};

/// File name used when `db_open` is handed a project *directory*.
pub const DB_FILE_NAME: &str = "redbeam.db";

#[derive(Debug)]
pub enum StoreError {
    Sqlite(rusqlite::Error),
    Io(std::io::Error),
    /// A parameter could not be bound, or a value could not be converted.
    Bind(String),
    Migration {
        version: i64,
        name: &'static str,
        statement: String,
        reason: String,
    },
    /// `PRAGMA foreign_keys = ON` did not take. The ported schema leans on
    /// `ON DELETE CASCADE / RESTRICT / SET NULL`; without it those clauses are
    /// decoration and deletes corrupt the project quietly.
    ForeignKeysOff,
    /// A query command arrived before `db_open`.
    NotOpen,
    /// A command named a project other than the one currently open.
    ///
    /// Always a bug in the caller, and the bug it catches is the expensive
    /// kind: a scan that outlived its project writing into the next one. See
    /// `StoreState::with_project`.
    WrongProject { expected: String, open: String },
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::Sqlite(e) => write!(f, "{e}"),
            StoreError::Io(e) => write!(f, "{e}"),
            StoreError::Bind(m) => write!(f, "{m}"),
            StoreError::Migration {
                version,
                name,
                statement,
                reason,
            } => write!(
                f,
                "migration {version} ({name}) failed on:\n{statement}\n\n{reason}"
            ),
            StoreError::ForeignKeysOff => {
                write!(f, "PRAGMA foreign_keys did not take — refusing to open")
            }
            StoreError::NotOpen => write!(f, "no project database is open — call db_open first"),
            StoreError::WrongProject { expected, open } => write!(
                f,
                "refusing to touch the wrong project: this call is for {expected},                  but {open} is open"
            ),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        StoreError::Sqlite(e)
    }
}

impl From<std::io::Error> for StoreError {
    fn from(e: std::io::Error) -> Self {
        StoreError::Io(e)
    }
}

/// Where the project database file lives for a given `project_path`.
///
/// A path that already names a database file is used as-is; anything else is
/// treated as the project directory and gets `redbeam.db` inside it. `:memory:`
/// passes straight through so tests and throwaway sessions can use it.
pub fn resolve_db_path(project_path: &str) -> PathBuf {
    if project_path == ":memory:" || project_path.is_empty() {
        return PathBuf::from(":memory:");
    }
    let path = Path::new(project_path);
    let is_db_file = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .is_some_and(|e| matches!(e.as_str(), "db" | "sqlite" | "sqlite3" | "redbeam"));

    if is_db_file {
        path.to_path_buf()
    } else {
        path.join(DB_FILE_NAME)
    }
}

/// Owns the connection. Not internally synchronized — [`super::StoreState`]
/// holds it behind the process-wide lock.
pub struct Store {
    conn: Connection,
    db_path: PathBuf,
}

impl Store {
    /// Open (creating if needed) the database for a project path, and set the
    /// pragmas the ported schema depends on.
    pub fn open(project_path: &str) -> Result<Self, StoreError> {
        let db_path = resolve_db_path(project_path);

        let conn = if db_path == Path::new(":memory:") {
            Connection::open_in_memory()?
        } else {
            if let Some(parent) = db_path.parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent)?;
                }
            }
            Connection::open(&db_path)?
        };

        // Foreign keys are OFF by default in SQLite and the schema leans on
        // them (ON DELETE CASCADE / RESTRICT / SET NULL). The sql.js driver
        // does the same thing for the same reason, and the behaviour is
        // covered by tests on both sides.
        conn.pragma_update(None, "foreign_keys", true)?;
        let on: i64 = conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
        if on != 1 {
            return Err(StoreError::ForeignKeysOff);
        }

        // A second window's command can arrive while a write is in flight.
        // Wait rather than returning SQLITE_BUSY to the UI.
        conn.busy_timeout(Duration::from_secs(5))?;

        // ONE FILE, so the project syncs. Job folders live in SharePoint
        // libraries, and the database used to run in WAL mode: every write
        // went to `redbeam.db-wal` (plus a `redbeam.db-shm` index), and with
        // SQLite's 1000-page checkpoint threshold and a connection the app
        // never closed, the project lived in the -wal indefinitely while
        // `redbeam.db` stayed a 4 KB empty shell. Anything that carried the
        // .db without its -wal (a sync, a copy, a colleague's machine) opened
        // as an empty project and was re-initialised. Found 2026-11-12 in a
        // client folder: a 4 KB redbeam.db beside 2.7 MB of WAL. Aaron: "make
        // sure that it can sync through SharePoint."
        //
        // The rollback journal keeps every committed write in `redbeam.db`
        // itself; `redbeam.db-journal` exists only while a transaction is in
        // flight. Switching an existing WAL database here also folds its -wal
        // into the main file and deletes the -wal and -shm, which repairs a
        // project written by an older build the first time it is opened. WAL's
        // one benefit, readers not blocking the writer, matters little to a
        // single-process app whose windows share one connection; an outside
        // reader waits under the busy timeout above. The resulting mode is
        // read and discarded: an in-memory database reports "memory".
        let _ = conn.query_row("PRAGMA journal_mode = DELETE", [], |row| {
            row.get::<_, String>(0)
        });

        Ok(Store { conn, db_path })
    }

    /// Apply the embedded migrations.
    pub fn migrate(&self) -> Result<MigrateResult, StoreError> {
        migrations::migrate(&self.conn, MIGRATIONS)
    }

    pub fn schema_version(&self) -> Result<i64, StoreError> {
        migrations::schema_version(&self.conn)
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    /// Run one or more statements with no parameters and no result rows.
    pub fn exec(&self, sql: &str) -> Result<(), StoreError> {
        self.conn.execute_batch(sql)?;
        Ok(())
    }

    /// Run a query and return every row as a JSON object keyed by column name.
    pub fn all(&self, sql: &str, params: &[Json]) -> Result<Vec<Map<String, Json>>, StoreError> {
        let bound = json_params_to_sql(params).map_err(StoreError::Bind)?;
        let mut stmt = self.conn.prepare(sql)?;
        let columns: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();

        let rows = stmt.query_map(rusqlite::params_from_iter(bound.iter()), |row| {
            row_to_json(row, &columns)
        })?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Run several parameterized statements as one unit: all of them, or none.
    ///
    /// # Why this exists
    ///
    /// Since 0.3.5 the project runs with a rollback journal so that it lives in
    /// `redbeam.db` alone and syncs through SharePoint. The price is that every
    /// statement run on its own is a transaction of its own: `redbeam.db-journal`
    /// created, written, flushed, the database flushed, the journal deleted.
    /// Indexing a sheet's text was six of those, measured at about 13 ms each in
    /// a SharePoint-synced job folder, and a new project ingested its documents
    /// one commit apiece. Batched, a document's worth of pages is one commit.
    ///
    /// A savepoint rather than `BEGIN`, so a batch is also safe to run inside a
    /// transaction the caller already opened (it nests instead of failing with
    /// "cannot start a transaction within a transaction"). Outside one, a
    /// savepoint behaves exactly like `BEGIN DEFERRED`.
    ///
    /// Statements run in the order given. If any fails, every statement of the
    /// batch is rolled back and the error names which one it was.
    pub fn batch(&self, statements: &[(String, Vec<Json>)]) -> Result<(), StoreError> {
        if statements.is_empty() {
            return Ok(());
        }
        self.conn.execute_batch("SAVEPOINT redbeam_batch")?;
        let outcome = statements
            .iter()
            .enumerate()
            .try_for_each(|(index, (sql, params))| {
                self.run(sql, params).map_err(|e| match e {
                    StoreError::Sqlite(inner) => StoreError::Bind(format!(
                        "statement {index} of the batch failed: {inner}\nSQL: {sql}"
                    )),
                    StoreError::Bind(m) => {
                        StoreError::Bind(format!("statement {index} of the batch: {m}"))
                    }
                    other => other,
                })
            });
        match outcome {
            Ok(()) => {
                self.conn.execute_batch("RELEASE redbeam_batch")?;
                Ok(())
            }
            Err(err) => {
                // Undo the batch's work, then drop the savepoint itself. Both
                // are attempted even if the first fails, and the error the
                // caller sees is the statement's, which is the one that matters.
                let _ = self.conn.execute_batch("ROLLBACK TO redbeam_batch");
                let _ = self.conn.execute_batch("RELEASE redbeam_batch");
                Err(err)
            }
        }
    }

    /// Run a single parameterized statement for its effect.
    ///
    /// Stepped to completion via `query` rather than `execute` so that a
    /// statement which happens to return rows (`INSERT ... RETURNING`, a
    /// `PRAGMA`) still runs instead of failing with `ExecuteReturnedResults`.
    /// Any rows produced are discarded — use `db_all` if you want them.
    pub fn run(&self, sql: &str, params: &[Json]) -> Result<(), StoreError> {
        let bound = json_params_to_sql(params).map_err(StoreError::Bind)?;
        let mut stmt = self.conn.prepare(sql)?;
        let mut rows = stmt.query(rusqlite::params_from_iter(bound.iter()))?;
        while rows.next()?.is_some() {}
        Ok(())
    }
}
