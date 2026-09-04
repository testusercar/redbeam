-- Migration 3 (ported verbatim from okular-redbeam shell/redbeamproject.cpp :: schema3)
-- Do not hand-edit: regenerate with tools/extract-schema.py if the source changes.

CREATE TABLE IF NOT EXISTS scopes (id TEXT PRIMARY KEY, label TEXT NOT NULL, scope_type TEXT NOT NULL, color TEXT NOT NULL, specifications_json TEXT NOT NULL DEFAULT '{}', archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS scopes_active_index ON scopes(archived_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS calculation_runs (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE RESTRICT, state TEXT NOT NULL, engine_version TEXT NOT NULL, specifications_snapshot_json TEXT NOT NULL, calibration_snapshot_json TEXT NOT NULL, source_snapshot_json TEXT NOT NULL, geometry_snapshot_json TEXT NOT NULL, warnings_json TEXT NOT NULL DEFAULT '[]', formulas_json TEXT NOT NULL DEFAULT '{}', result_summary_json TEXT NOT NULL DEFAULT '{}', accepted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS calculation_scope_index ON calculation_runs(scope_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quantity_results (id TEXT PRIMARY KEY, calculation_run_id TEXT NOT NULL REFERENCES calculation_runs(id) ON DELETE CASCADE, item_key TEXT NOT NULL, label TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', UNIQUE(calculation_run_id, item_key));

CREATE TABLE IF NOT EXISTS layout_components (id TEXT PRIMARY KEY, calculation_run_id TEXT NOT NULL REFERENCES calculation_runs(id) ON DELETE CASCADE, document_id TEXT REFERENCES documents(id), page_id TEXT REFERENCES pages(id), component_kind TEXT NOT NULL, geometry_json TEXT NOT NULL, properties_json TEXT NOT NULL DEFAULT '{}', frozen INTEGER NOT NULL DEFAULT 0);

INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(3, datetime('now'));

