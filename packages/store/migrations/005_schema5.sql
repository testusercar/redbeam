-- Migration 5 (ported verbatim from okular-redbeam shell/redbeamproject.cpp :: schema5)
-- Do not hand-edit: regenerate with tools/extract-schema.py if the source changes.

CREATE TABLE IF NOT EXISTS agent_threads (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), provider TEXT NOT NULL, provider_thread_id TEXT, model TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS agent_turns (id TEXT PRIMARY KEY, agent_thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE, provider_turn_id TEXT, state TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT NOT NULL DEFAULT '{}', usage_json TEXT NOT NULL DEFAULT '{}', error_json TEXT NOT NULL DEFAULT '{}', started_at TEXT NOT NULL, completed_at TEXT);

CREATE TABLE IF NOT EXISTS agent_tool_calls (id TEXT PRIMARY KEY, agent_turn_id TEXT NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE, tool_name TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT NOT NULL DEFAULT '{}', state TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT);

CREATE TABLE IF NOT EXISTS agent_provider_metadata (provider TEXT PRIMARY KEY, settings_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS evaluation_events (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), agent_turn_id TEXT REFERENCES agent_turns(id), event_type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', opted_in INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS command_idempotency (origin TEXT NOT NULL, idempotency_key TEXT NOT NULL, command_type TEXT NOT NULL, request_fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(origin, idempotency_key));

INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(5, datetime('now'));

