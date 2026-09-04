-- Migration 4 (ported verbatim from okular-redbeam shell/redbeamproject.cpp :: schema4)
-- Do not hand-edit: regenerate with tools/extract-schema.py if the source changes.

CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT);

CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, role TEXT NOT NULL, content_json TEXT NOT NULL, provider TEXT, created_at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS messages_task_index ON messages(task_id, created_at);

CREATE TABLE IF NOT EXISTS context_references (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, message_id TEXT REFERENCES messages(id) ON DELETE CASCADE, document_id TEXT REFERENCES documents(id), page_id TEXT REFERENCES pages(id), markup_id TEXT REFERENCES markups(id), scope_id TEXT REFERENCES scopes(id), content_fingerprint TEXT, region_json TEXT NOT NULL DEFAULT '{}', label TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS change_sets (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'proposed', origin TEXT NOT NULL, actor_id TEXT, revision_of_id TEXT REFERENCES change_sets(id), summary_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, decided_at TEXT);

CREATE TABLE IF NOT EXISTS change_set_items (id TEXT PRIMARY KEY, change_set_id TEXT NOT NULL REFERENCES change_sets(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, command_type TEXT NOT NULL, payload_json TEXT NOT NULL, result_json TEXT, UNIQUE(change_set_id, ordinal));

CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), artifact_type TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'draft', managed_path TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS artifact_exports (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE, destination_path TEXT NOT NULL, content_fingerprint TEXT, state TEXT NOT NULL, error_message TEXT, created_at TEXT NOT NULL, completed_at TEXT);

CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, cancellation_requested INTEGER NOT NULL DEFAULT 0, input_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}', error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS jobs_state_index ON jobs(state, updated_at DESC);

INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(4, datetime('now'));

