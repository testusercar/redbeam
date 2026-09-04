//! The serializable command, and what can go wrong reverting one.
//!
//! D1: "Commands become serializable records, not closures." A `Command` in
//! `packages/store/src/commands.ts` is `{label, apply(db), revert(db)}` closing
//! over JS values; a core that never saw the closure cannot revert it. This is
//! the same command expressed as data, and it is what crosses the IPC hop.

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

/// Which operation a record describes.
///
/// The wire spelling is snake_case and matches `UndoOpKind` in
/// `packages/store/src/commands.ts`. Kept as an enum rather than a bare string
/// so an unknown op is rejected at the boundary instead of being written to the
/// log and only failing later, when someone presses Ctrl+Z.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpKind {
    CreateMarkup,
    DeleteMarkup,
    EditGeometry,
    ReassignScope,
    SetCalibration,
    Batch,
}

impl OpKind {
    pub fn parse(s: &str) -> Result<OpKind, UndoError> {
        Ok(match s {
            "create_markup" => OpKind::CreateMarkup,
            "delete_markup" => OpKind::DeleteMarkup,
            "edit_geometry" => OpKind::EditGeometry,
            "reassign_scope" => OpKind::ReassignScope,
            "set_calibration" => OpKind::SetCalibration,
            "batch" => OpKind::Batch,
            other => return Err(UndoError::UnknownOp(other.to_string())),
        })
    }

    /// Does reverting this op write an absolute before-image over a row a peer
    /// may have moved since?
    ///
    /// D1 names geometry. `reassign_scope` has the identical hazard — its
    /// revert also writes an absolute previous value — and D1's list of
    /// "forgiving by construction" commands (soft deletes, `createMarkup`'s
    /// existing-row handling) does not actually cover it. Guarding both costs
    /// one extra column read and turns a silent clobber into a refusal, so both
    /// are guarded. A deliberate widening of D1, noted here rather than made
    /// quietly.
    pub fn needs_concurrency_check(self) -> bool {
        matches!(self, OpKind::EditGeometry | OpKind::ReassignScope)
    }
}

/// One undoable command, as data.
///
/// Field names are camelCase on the wire — this is a view-model crossing to
/// TypeScript, not a database row, and the TypeScript side builds it directly.
/// (`store::OpenInfo` is snake_case on the wire and camelized by the client;
/// the difference is deliberate, and the client normalizes either spelling.)
///
/// Payload shapes by op, all carried in `before` / `after`:
///
/// * `create_markup`  — entity: markup id; before: null; after: a full markup
///   image (see [`MarkupImage`]).
/// * `delete_markup`  — entity: markup id; before: `{kind, origin}`; after: null.
/// * `edit_geometry`  — entity: markup id; before/after: rings.
/// * `reassign_scope` — entity: markup id; before/after: scope id or null.
/// * `set_calibration`— entity: page id; before: feet-per-point or null;
///   after: `{feetPerPdfPoint, source}`.
/// * `batch`          — entity: null; after: `{children: [record, ...]}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoRecord {
    /// See [`OpKind`]. Held as a string so a malformed value produces
    /// [`UndoError::UnknownOp`] naming the offending text, rather than a serde
    /// error naming the whole payload.
    pub op: String,
    /// What the control says it will undo: "move markup", "calibrate page".
    /// D1 requires the button to name its target before the keystroke.
    pub label: String,
    /// `markup`, `page`, or `batch`.
    pub entity_type: String,
    #[serde(default)]
    pub entity_id: Option<String>,
    /// D1 requires undo to navigate to what it reverted, which needs the
    /// document and page even when the entity is not currently visible.
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub page_id: Option<String>,
    #[serde(default)]
    pub before: Json,
    #[serde(default)]
    pub after: Json,
    /// `user` unless an agent applied it. Anything else is written to the log
    /// but never enters the user's stack — D1, "Excluded: agent-origin commands".
    #[serde(default = "origin_user")]
    pub origin: String,
    /// Which window recorded it. Diagnostic only; the stack is chronological
    /// across the project and is never filtered by window.
    #[serde(default)]
    pub window_label: Option<String>,
}

fn origin_user() -> String {
    "user".to_string()
}

impl UndoRecord {
    pub fn kind(&self) -> Result<OpKind, UndoError> {
        OpKind::parse(&self.op)
    }

    pub fn is_user(&self) -> bool {
        self.origin == "user"
    }

    /// Children of a `batch`, in the order they were applied.
    pub fn children(&self) -> Result<Vec<UndoRecord>, UndoError> {
        let raw = self
            .after
            .get("children")
            .cloned()
            .unwrap_or_else(|| Json::Array(Vec::new()));
        serde_json::from_value(raw)
            .map_err(|e| UndoError::Malformed(format!("batch children are unreadable: {e}")))
    }
}

/// The markup image a `create_markup` record carries in `after`.
///
/// Mirrors `MarkupRow` in `packages/store/src/repo.ts`. `rings` stays a raw
/// [`Json`] on purpose: geometry is written back to `geometry_json` as the
/// caller sent it, and parsing it into a point type here would only invent an
/// opportunity to round it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkupImage {
    pub id: String,
    pub document_id: String,
    pub page_id: String,
    #[serde(default)]
    pub scope_id: Option<String>,
    pub kind: String,
    #[serde(default)]
    pub rings: Json,
    #[serde(default = "origin_user")]
    pub origin: String,
    #[serde(default = "review_accepted")]
    pub review_state: String,
    /**
     * Per-kind payload — a dimension's offset and label, a callout's text.
     *
     * Defaulted, because every record written before dimensions were reachable
     * has no such field and must still replay. Without this the redo path
     * re-inserted `content_json` as '{}' and a dimension came back stripped of
     * the two things that make it a dimension rather than a line.
     */
    #[serde(default)]
    pub content: Json,
}

fn review_accepted() -> String {
    "accepted".to_string()
}

/// Where a record points, so the UI can name it and navigate to it.
///
/// D1 requirement 2: "If the affected entity is not visible in the focused
/// window, that window goes to it and flashes it. An undo you cannot see is the
/// failure mode."
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UndoTarget {
    pub entity_type: String,
    pub entity_id: Option<String>,
    pub document_id: Option<String>,
    pub page_id: Option<String>,
}

impl From<&UndoRecord> for UndoTarget {
    fn from(r: &UndoRecord) -> Self {
        UndoTarget {
            entity_type: r.entity_type.clone(),
            entity_id: r.entity_id.clone(),
            document_id: r.document_id.clone(),
            page_id: r.page_id.clone(),
        }
    }
}

#[derive(Debug)]
pub enum UndoError {
    /// The store rejected a statement, or no project is open.
    Store(String),
    /// The record named an op this build does not implement.
    UnknownOp(String),
    /// The record's payload is not the shape its op requires.
    Malformed(String),
    /// The entity moved since the command was recorded. Reverting would throw a
    /// peer's work away, so it is refused. D1, "Guards this decision requires".
    Conflict {
        entity: String,
        label: String,
        detail: String,
    },
}

impl fmt::Display for UndoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            UndoError::Store(m) => write!(f, "{m}"),
            UndoError::UnknownOp(op) => write!(f, "unknown undo op '{op}'"),
            UndoError::Malformed(m) => write!(f, "malformed undo record: {m}"),
            // Actionable on purpose: it names what it refused, why, and what to
            // do next. A bare "conflict" would leave the estimator guessing.
            UndoError::Conflict {
                entity,
                label,
                detail,
            } => write!(
                f,
                "cannot undo \"{label}\": {entity} has changed since that edit ({detail}). \
                 Undoing it now would discard the newer change. Reload, and undo the newer \
                 edit first if you meant to reverse both."
            ),
        }
    }
}

impl std::error::Error for UndoError {}
