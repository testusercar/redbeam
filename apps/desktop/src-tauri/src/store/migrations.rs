//! The six ported migrations, and a runner that mirrors the TypeScript one.
//!
//! # Where the SQL comes from
//!
//! `packages/store/migrations/*.sql` is ported **verbatim** from the Qt build's
//! `shell/redbeamproject.cpp` (29 tables across 6 blocks) and is generated, not
//! hand-written — `tools/extract-schema.py` regenerates it. It must not be
//! edited here or anywhere else.
//!
//! That is exactly why this module reads those files with [`include_str!`]
//! straight out of `packages/store/migrations/` rather than keeping a copy
//! under `src-tauri/migrations/`. A copy is a second thing to keep in sync, and
//! a schema that has silently drifted between two drivers is far worse than a
//! slightly awkward relative path: the browser build and the desktop build must
//! be looking at the same bytes. The cost is that this crate only builds inside
//! the monorepo, which it does anyway.
//!
//! # Why statement-by-statement
//!
//! The runner applies each migration one statement at a time rather than as one
//! blob, so a single statement the driver cannot support does not abort an
//! otherwise-applicable migration. Anything skipped is **reported**, never
//! swallowed — the browser build depended on this to tell the user that
//! full-text search was unavailable (sql.js ships FTS3, not FTS5). On this
//! driver the list should come back empty; see `tests::fts5_is_available`.

use std::collections::HashSet;

use rusqlite::Connection;
use serde::Serialize;

use super::db::StoreError;

/// One migration block from the Qt build.
#[derive(Debug, Clone, Copy)]
pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

/// The migration SQL, embedded from the single source of truth in
/// `packages/store/migrations/`. Paths are relative to this file.
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "schema1",
        sql: include_str!("../../../../../packages/store/migrations/001_schema1.sql"),
    },
    Migration {
        version: 2,
        name: "schema2",
        sql: include_str!("../../../../../packages/store/migrations/002_schema2.sql"),
    },
    Migration {
        version: 3,
        name: "schema3",
        sql: include_str!("../../../../../packages/store/migrations/003_schema3.sql"),
    },
    Migration {
        version: 4,
        name: "schema4",
        sql: include_str!("../../../../../packages/store/migrations/004_schema4.sql"),
    },
    Migration {
        version: 5,
        name: "schema5",
        sql: include_str!("../../../../../packages/store/migrations/005_schema5.sql"),
    },
    Migration {
        version: 6,
        name: "schema6",
        sql: include_str!("../../../../../packages/store/migrations/006_schema6.sql"),
    },
    // 007 is NOT ported from the Qt build — it backs project-scoped undo
    // (docs/DECISIONS.md :: D1). Listed here so db_open reports the real
    // schema version rather than 6 until something happens to touch undo.
    Migration {
        version: 7,
        name: "undo",
        sql: include_str!("../../../../../packages/store/migrations/007_undo.sql"),
    },
    // 008 is also ours: more than one scale on a sheet. `calibrations` is left
    // exactly as it is and keeps meaning "the scale of this page"; this table
    // means "the scale of this part of this page".
    Migration {
        version: 8,
        name: "scaleregions",
        sql: include_str!("../../../../../packages/store/migrations/008_scaleregions.sql"),
    },
    // 009 is ours and is data-only: `calibrations.source` recorded a scale set
    // from a preset under two different prefixes depending on which control
    // the estimator used, and provenance nothing can read back in one query is
    // not provenance. Rewrites the old spelling; changes no column.
    Migration {
        version: 9,
        name: "scalesource",
        sql: include_str!("../../../../../packages/store/migrations/009_scalesource.sql"),
    },
];

/// A statement the driver could not run because it lacks a SQLite module.
///
/// Mirrors `MigrateResult.skipped` in `packages/store/src/index.ts`. A caller
/// that needs the capability must be able to tell the user it is missing, so
/// this is surfaced all the way out through [`super::OpenInfo`].
#[derive(Debug, Clone, Serialize)]
pub struct Skipped {
    pub version: i64,
    pub statement: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct MigrateResult {
    /// Number of migration *blocks* newly applied (not statements).
    pub applied: usize,
    pub skipped: Vec<Skipped>,
}

/// Split generated migration SQL into individual statements.
///
/// Ported from `splitStatements` in `packages/store/src/index.ts`, which splits
/// on `/;\s*\n/` and then strips whole-line `--` comments and trims. The
/// generated SQL puts one statement per line with a blank line between, so this
/// is a faithful split rather than a general-purpose SQL lexer — it would not
/// survive a semicolon inside a string literal or a `CREATE TRIGGER` body, and
/// the generator does not emit either.
///
/// The trailing `;` is dropped along with the separator, exactly as
/// `String.prototype.split` does.
pub fn split_statements(sql: &str) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut pieces: Vec<&str> = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;

    while i < bytes.len() {
        if bytes[i] == b';' {
            // `\s*` before the required newline. Horizontal whitespace only —
            // JavaScript's `\s` also matches `\n`, but consuming extra blank
            // lines only moves the start of the *next* piece, which is trimmed
            // anyway, so the resulting statements are identical.
            let mut j = i + 1;
            while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\r' | b'\x0c') {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'\n' {
                // `;` and `\n` are ASCII, so these are always char boundaries.
                pieces.push(&sql[start..i]);
                start = j + 1;
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    pieces.push(&sql[start..]);

    pieces
        .into_iter()
        .map(strip_comment_lines)
        .filter(|s| !s.is_empty())
        .collect()
}

fn strip_comment_lines(piece: &str) -> String {
    piece
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// Apply any migrations newer than the recorded schema version.
///
/// The migration files carry their own `INSERT OR IGNORE INTO schema_migrations`
/// rows, matching the Qt build; the extra insert here is belt-and-braces for a
/// block whose own bookkeeping row was one of the skipped statements.
pub fn migrate(conn: &Connection, migrations: &[Migration]) -> Result<MigrateResult, StoreError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    )?;

    let done: HashSet<i64> = {
        let mut stmt = conn.prepare("SELECT version FROM schema_migrations")?;
        let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
        rows.collect::<rusqlite::Result<HashSet<i64>>>()?
    };

    let mut ordered: Vec<&Migration> = migrations.iter().collect();
    ordered.sort_by_key(|m| m.version);

    let mut result = MigrateResult::default();

    for m in ordered {
        if done.contains(&m.version) {
            continue;
        }
        for statement in split_statements(m.sql) {
            if let Err(err) = conn.execute_batch(&statement) {
                let reason = err.to_string();
                // e.g. "no such module: fts5" on a build without FTS5. Report
                // it and keep going; anything else is a real failure.
                if reason.to_ascii_lowercase().contains("no such module") {
                    result.skipped.push(Skipped {
                        version: m.version,
                        statement,
                        reason,
                    });
                    continue;
                }
                return Err(StoreError::Migration {
                    version: m.version,
                    name: m.name,
                    statement,
                    reason,
                });
            }
        }
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(?1, datetime('now'))",
            [m.version],
        )?;
        result.applied += 1;
    }

    Ok(result)
}

/// Highest applied migration version, or 0 on a fresh database.
pub fn schema_version(conn: &Connection) -> Result<i64, StoreError> {
    let version = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(version)
}
