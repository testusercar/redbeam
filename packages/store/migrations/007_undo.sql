-- Migration 7 (REDBEAM — project-scoped undo). See docs/DECISIONS.md :: D1.
--
-- NOT ported from the Qt build. 001-006 are generated verbatim from
-- shell/redbeamproject.cpp by tools/extract-schema.py and must never be
-- hand-edited; this block is new work and therefore starts a new number
-- rather than extending one of them.
--
-- Why a table at all: a Command used to be {label, apply(db), revert(db)}
-- closing over JS values, which no other process could replay. D1 requires the
-- stack to live in the core and be shared by every window on the project, so
-- each command has to persist as data — op, entity, before-image, after-image.
--
-- Why not `activity`: activity stores human-readable detail (details_json),
-- not exact before-images. Why not `change_sets`: that is the propose/decide
-- review gate, and routing every vertex nudge through it would queue edits for
-- human approval.
--
-- Notes on the columns that are not obvious:
--   seq                 the stack order. AUTOINCREMENT so a trimmed-and-refilled
--                       stack can never reuse a sequence number.
--   session_id          D1 scopes the stack to "as long as the project is open".
--                       Rows from an earlier session are deleted when the core
--                       adopts the project, so undo never reaches into last week.
--   state               'done' (undoable) or 'undone' (redoable). The table IS
--                       the stack: there is no separate in-memory copy that two
--                       windows could disagree about.
--   origin              D1 excludes origin != 'user' from the user stack. Such
--                       rows are still written — they are the record of what
--                       happened — but every stack query filters them out.
--   expected_updated_at the entity's updated_at at the moment the command was
--                       recorded. Revert refuses if it no longer matches, rather
--                       than writing an absolute before-image over a peer's edit.
--   entity_id           deliberately NOT a foreign key: one table holds markup,
--                       page and batch entries, and a markup create that has
--                       been undone is soft-deleted rather than removed anyway.

CREATE TABLE IF NOT EXISTS undo_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, op TEXT NOT NULL, label TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, document_id TEXT, page_id TEXT, before_json TEXT NOT NULL DEFAULT 'null', after_json TEXT NOT NULL DEFAULT 'null', expected_updated_at TEXT, origin TEXT NOT NULL DEFAULT 'user', window_label TEXT, state TEXT NOT NULL DEFAULT 'done' CHECK(state IN ('done','undone')), created_at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS undo_log_stack_index ON undo_log(session_id, origin, state, seq);

CREATE INDEX IF NOT EXISTS undo_log_entity_index ON undo_log(entity_type, entity_id, seq DESC);

INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(7, datetime('now'));
