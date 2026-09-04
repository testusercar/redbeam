//! The Tauri commands the TypeScript `UndoStack` calls.
//!
//! Thin, like `store::commands`: each takes both managed handles and hands
//! straight off to a synchronous method on [`UndoState`], where the behaviour
//! and the tests live.
//!
//! # The contract
//!
//! ```js
//! await invoke('undo_record', { record, apply: true, limit: 100 })  // -> UndoStatus
//! await invoke('undo_apply')                            // -> UndoOutcome
//! await invoke('undo_redo')                             // -> UndoOutcome
//! await invoke('undo_state')                            // -> UndoStatus
//! await invoke('undo_clear')                            // -> UndoStatus
//! ```
//!
//! Command names come from the function identifiers verbatim. Argument keys are
//! lower-camel-cased by Tauri's macro, which is why `record` and `apply` are
//! spelled as they are; the same convention as `store::commands`.
//!
//! `undo_record` is not in the original three-command sketch. It has to exist:
//! the `updated_at` that the concurrency guard compares against must be read in
//! the same lock hold as the write it describes, and a window cannot do that
//! from the outside. Making the core perform the write as well (`apply: true`)
//! is what turns D1's "the mutation happens in the core, not in a window's local
//! state" into something the code actually enforces.
//!
//! # Errors
//!
//! Rejections are strings, matching `store::commands`. The one worth reading is
//! [`UndoError::Conflict`](super::record::UndoError::Conflict): it means the
//! revert was refused because the entity moved, and its message is written to
//! be shown to the estimator as-is.

use tauri::State;

use crate::store::state::StoreState;

use super::log::{UndoOutcome, UndoStatus};
use super::record::UndoRecord;
use super::state::UndoState;

/// Record a command on the project stack, performing it first when asked.
///
/// A record whose `origin` is not `user` is written but never enters the user's
/// stack — D1 reverses an agent proposal at the review gate, not with Ctrl+Z.
#[tauri::command]
pub async fn undo_record(
    store: State<'_, StoreState>,
    undo: State<'_, UndoState>,
    record: UndoRecord,
    apply: Option<bool>,
    limit: Option<usize>,
) -> Result<UndoStatus, String> {
    undo.record(&store, record, apply.unwrap_or(true), limit)
        .map_err(|e| e.to_string())
}

/// Undo the most recent user command anywhere in the project.
///
/// `ok: false` means the stack was empty — normal, not an error. An `Err` means
/// the revert was refused, and the message says why and what to do.
#[tauri::command]
pub async fn undo_apply(
    store: State<'_, StoreState>,
    undo: State<'_, UndoState>,
) -> Result<UndoOutcome, String> {
    undo.undo(&store).map_err(|e| e.to_string())
}

/// Redo the most recently undone command.
#[tauri::command]
pub async fn undo_redo(
    store: State<'_, StoreState>,
    undo: State<'_, UndoState>,
) -> Result<UndoOutcome, String> {
    undo.redo(&store).map_err(|e| e.to_string())
}

/// What the undo control should say, and what it would act on.
///
/// Every window asks the same question of the same stack, so two windows can
/// never show different labels.
#[tauri::command]
pub async fn undo_state(
    store: State<'_, StoreState>,
    undo: State<'_, UndoState>,
) -> Result<UndoStatus, String> {
    undo.status(&store).map_err(|e| e.to_string())
}

/// Drop the stack without reverting anything.
#[tauri::command]
pub async fn undo_clear(
    store: State<'_, StoreState>,
    undo: State<'_, UndoState>,
) -> Result<UndoStatus, String> {
    undo.clear(&store).map_err(|e| e.to_string())
}
