-- Scale regions: more than one scale on a sheet.
--
-- `calibrations` stays exactly as it is — one row per page, UNIQUE on
-- (document_id, page_id) — and keeps meaning "the scale of this sheet". This
-- table sits beside it and means "the scale of this part of this sheet".
--
-- A separate table rather than loosening the uniqueness on `calibrations`,
-- because every existing query, undo record and Rust path reads that table
-- expecting at most one row per page, and a schema change that quietly makes
-- them return several would break measurement in places nothing tests.
--
-- Resolution is region first, page second, nothing third. Nothing third is not
-- a gap: it means uncalibrated, and it must block rather than borrow.
CREATE TABLE IF NOT EXISTS scale_regions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  -- Normalized page coordinates, stored as the lower/upper pair so a rectangle
  -- drawn in any direction is one row rather than four orderings of one.
  x0 REAL NOT NULL,
  y0 REAL NOT NULL,
  x1 REAL NOT NULL,
  y1 REAL NOT NULL,
  feet_per_pdf_point REAL NOT NULL CHECK(feet_per_pdf_point > 0),
  -- How it was set: a preset chosen from the list, or a measured line.
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scale_regions_page ON scale_regions(page_id);

-- Both runners insert this row themselves, so adding it is inert for a project
-- that already applied block 8 (the whole block is skipped) and idempotent for
-- one that has not. It is here because every other block carries its own
-- bookkeeping row and the Rust runner's tests assert that invariant — 008
-- shipped without one, and the assertion has been failing ever since.
INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(8, datetime('now'));
