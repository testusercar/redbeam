-- Migration 2 (ported verbatim from okular-redbeam shell/redbeamproject.cpp :: schema2)
-- Do not hand-edit: regenerate with tools/extract-schema.py if the source changes.

CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page_number INTEGER NOT NULL, label TEXT, width_pdf_points REAL, height_pdf_points REAL, rotation INTEGER NOT NULL DEFAULT 0, native_text_available INTEGER NOT NULL DEFAULT 0, text_indexed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(document_id, page_number));

CREATE INDEX IF NOT EXISTS pages_document_index ON pages(document_id, page_number);

CREATE TABLE IF NOT EXISTS page_text (page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'native', indexed_at TEXT NOT NULL);

CREATE VIRTUAL TABLE IF NOT EXISTS page_text_fts USING fts5(page_id UNINDEXED, document_id UNINDEXED, content);

CREATE TABLE IF NOT EXISTS calibrations (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE, feet_per_pdf_point REAL NOT NULL CHECK(feet_per_pdf_point > 0), source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(document_id, page_id));

CREATE TABLE IF NOT EXISTS markups (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE, scope_id TEXT REFERENCES scopes(id) ON DELETE SET NULL, kind TEXT NOT NULL, geometry_json TEXT NOT NULL, style_json TEXT NOT NULL DEFAULT '{}', content_json TEXT NOT NULL DEFAULT '{}', origin TEXT NOT NULL, review_state TEXT NOT NULL DEFAULT 'accepted', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);

CREATE INDEX IF NOT EXISTS markups_page_index ON markups(document_id, page_id, deleted_at);

CREATE INDEX IF NOT EXISTS markups_scope_index ON markups(scope_id, review_state, deleted_at);

CREATE TABLE IF NOT EXISTS legacy_import_reports (id TEXT PRIMARY KEY, document_id TEXT REFERENCES documents(id) ON DELETE SET NULL, source_kind TEXT NOT NULL, source_fingerprint TEXT, state TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, resolved_at TEXT);

CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, origin TEXT NOT NULL, actor_id TEXT, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS activity_created_index ON activity(created_at DESC);

INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(2, datetime('now'));

