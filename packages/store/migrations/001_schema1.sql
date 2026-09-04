-- Migration 1 (ported verbatim from okular-redbeam shell/redbeamproject.cpp :: schema1)
-- Do not hand-edit: regenerate with tools/extract-schema.py if the source changes.

CREATE TABLE IF NOT EXISTS redbeam_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, size_bytes INTEGER NOT NULL, modified_at_observed TEXT, content_fingerprint TEXT, base_content_fingerprint TEXT, annotation_fingerprint TEXT, issue_date TEXT, file_date_hint TEXT, availability TEXT NOT NULL, preferred_working_copy INTEGER NOT NULL DEFAULT 0, missing INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS documents_fingerprint_index ON documents(content_fingerprint);

CREATE INDEX IF NOT EXISTS documents_kind_index ON documents(kind, status);

INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, datetime('now'));

