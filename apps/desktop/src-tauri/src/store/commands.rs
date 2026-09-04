//! The four Tauri commands the TypeScript client calls.
//!
//! Deliberately thin: each one takes the lock and hands straight off to a
//! synchronous method on [`StoreState`], which is where the behaviour — and
//! the test coverage — lives. Everything about the locking choice is explained
//! in [`super::state`].
//!
//! # Argument names on the JavaScript side
//!
//! These use the plain `#[tauri::command]` default, matching the rest of the
//! crate. Tauri v2 defaults `argument_case` to `Camel` and looks the argument
//! up in the IPC payload under `key.to_lower_camel_case()`
//! (`tauri-macros/src/command/wrapper.rs`), so the Rust parameter
//! `project_path` is bound from the JavaScript key `projectPath`:
//!
//! ```js
//! await invoke('db_open', { projectPath })
//! ```
//!
//! Command *names* are untouched by that mapping — they come from the function
//! identifier verbatim, so they stay `db_open` / `db_exec` / `db_all` /
//! `db_run`. So do the field names of the returned [`OpenInfo`], which are
//! serialized by serde as written: `schema_version`, `applied`, `skipped`,
//! `db_path`.

use serde_json::{Map, Value as Json};
use tauri::State;

use super::db::StoreError;
use super::state::{OpenInfo, StoreState};

fn to_message(e: StoreError) -> String {
    e.to_string()
}

/// Open (creating if needed) the project database and bring it up to schema 6.
///
/// Invoked from JavaScript as `invoke('db_open', { projectPath })`.
///
/// `project_path` may be the project directory — the database is then
/// `redbeam.db` inside it — or the path of the `.db` file itself.
///
/// Safe to call again: it reopens and replaces the current connection, which is
/// how switching projects works.
#[tauri::command]
pub async fn db_open(
    state: State<'_, StoreState>,
    project_path: String,
) -> Result<OpenInfo, String> {
    state.open(&project_path).map_err(to_message)
}

/// Run one or more statements with no parameters and no results.
#[tauri::command]
pub async fn db_exec(
    state: State<'_, StoreState>,
    project_path: String,
    sql: String,
) -> Result<(), String> {
    state
        .with_project(&project_path, |store| store.exec(&sql))
        .map_err(to_message)
}

/// Run a query; each row comes back as an object keyed by column name.
#[tauri::command]
pub async fn db_all(
    state: State<'_, StoreState>,
    project_path: String,
    sql: String,
    params: Vec<Json>,
) -> Result<Vec<Map<String, Json>>, String> {
    state
        .with_project(&project_path, |store| store.all(&sql, &params))
        .map_err(to_message)
}

/// Run a parameterized statement for its effect.
#[tauri::command]
pub async fn db_run(
    state: State<'_, StoreState>,
    project_path: String,
    sql: String,
    params: Vec<Json>,
) -> Result<(), String> {
    state
        .with_project(&project_path, |store| store.run(&sql, &params))
        .map_err(to_message)
}
