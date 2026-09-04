-- Migration 9 (REDBEAM) — one spelling for "this scale came from a preset".
--
-- NOT ported from the Qt build. 001-006 are generated verbatim from
-- shell/redbeamproject.cpp by tools/extract-schema.py and must never be
-- hand-edited; this block is new work, like 007 and 008.
--
-- `calibrations.source` records HOW a scale was set, and the answer an
-- estimator wants from it is "measured, or stated in the title block?". The
-- same fact was being written two ways: the command palette and the Dock's
-- scale chips wrote `scale-preset:<id>`, while the multi-sheet picker and the
-- automation bridge's set_page_scale wrote `preset:<id>`.
--
-- That is not cosmetic. Provenance exists to be read back — a report column, a
-- filter, a "which sheets were never measured" audit — and any reader written
-- against one prefix passes silently over every row carrying the other. Half
-- the set reads as unstated when it was stated, and nothing errors.
--
-- `preset:` wins because three of the four writers and both tables already
-- used it, so this rewrites the smaller half of the rows. `presetSource` in
-- packages/domain/src/scale.ts is now the only thing that spells it.
--
-- `updated_at` is deliberately NOT touched. Correcting how a scale's origin is
-- spelled is not a re-calibration, and stamping six sheets as modified today
-- would destroy the same kind of provenance this block exists to repair — an
-- estimator asking "when was this sheet last scaled?" would get the date of a
-- schema change. The row's meaning is unchanged; only its encoding is.
UPDATE calibrations
   SET source = 'preset:' || substr(source, length('scale-preset:') + 1)
 WHERE source LIKE 'scale-preset:%';

-- No writer has ever put `scale-preset:` in scale_regions — regions arrived
-- with 008, after the picker and the bridge were already on `preset:`. Run it
-- anyway: it costs one scan of a small table at open, and it means the two
-- tables cannot be left disagreeing by a project file that took a route
-- nobody remembers.
UPDATE scale_regions
   SET source = 'preset:' || substr(source, length('scale-preset:') + 1)
 WHERE source LIKE 'scale-preset:%';

-- Matched on the exact prefix rather than `scale-%`, because `source` is an
-- open vocabulary — `reference-line`, `agent`, and whatever a later import
-- invents share this column, and a pattern-matched migration renames values it
-- was never shown. The Qt build's own project files are the live example: they
-- carry a bare `scale-preset` with no id at all, which says a preset was used
-- but not which one. Nothing in this app opens those files (there is no legacy
-- importer yet), so they are out of scope here — but a `scale-%` sweep would
-- have turned them into `preset:` with an empty id, and an importer that ever
-- reads them has to decide what a preset-with-no-id means before it writes one.
INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(9, datetime('now'));
