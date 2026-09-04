-- Migration 6 (ported verbatim from okular-redbeam shell/redbeamproject.cpp :: schema6)
-- Do not hand-edit: regenerate with tools/extract-schema.py if the source changes.

CREATE TABLE IF NOT EXISTS estimates (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, state TEXT NOT NULL DEFAULT 'working', source_estimate_id TEXT REFERENCES estimates(id) ON DELETE SET NULL, notes_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, exported_at TEXT);

CREATE INDEX IF NOT EXISTS estimates_state_index ON estimates(state, updated_at DESC);

CREATE TABLE IF NOT EXISTS estimate_scopes (estimate_id TEXT NOT NULL REFERENCES estimates(id) ON DELETE CASCADE, scope_id TEXT NOT NULL UNIQUE REFERENCES scopes(id) ON DELETE CASCADE, copied_from_scope_id TEXT REFERENCES scopes(id) ON DELETE SET NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY(estimate_id, scope_id));

CREATE INDEX IF NOT EXISTS estimate_scopes_estimate_index ON estimate_scopes(estimate_id, position, created_at);

INSERT INTO estimates(id, name, state, notes_json, created_at, updated_at) SELECT 'estimate-' || lower(hex(randomblob(16))), 'Estimate 1', 'working', '{}', datetime('now'), datetime('now') WHERE NOT EXISTS (SELECT 1 FROM estimates) AND EXISTS (SELECT 1 FROM scopes);

INSERT OR IGNORE INTO estimate_scopes(estimate_id, scope_id, position, created_at) SELECT (SELECT id FROM estimates ORDER BY created_at LIMIT 1), s.id, (SELECT COUNT(*) FROM estimate_scopes), datetime('now') FROM scopes s WHERE NOT EXISTS (SELECT 1 FROM estimate_scopes es WHERE es.scope_id=s.id);

INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(6, datetime('now'));

