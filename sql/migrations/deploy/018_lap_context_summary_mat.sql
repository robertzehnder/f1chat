BEGIN;

-- Phase 3 scale-out: materialize core.lap_context_summary into a real
-- storage table sourced from core_build.lap_context_summary, and replace the
-- public view with a thin SELECT * facade over that table. Column list,
-- types, and ordering mirror the public view as defined at
-- sql/007_semantic_summary_contracts.sql:763 ff. The canonical query
-- aggregates by (session_key, meeting_key, year, session_name, session_type,
-- country_name, location, lap_number) where the six non-grain columns are
-- functionally determined by session_key, so the effective output identity
-- is (session_key, lap_number) and is enforced as a real PRIMARY KEY; a
-- non-unique grain would abort the bulk INSERT below with a clean
-- PK-violation error and roll back the whole transaction.
CREATE TABLE IF NOT EXISTS core.lap_context_summary_mat (
  session_key                  BIGINT  NOT NULL,
  meeting_key                  BIGINT,
  year                         INTEGER,
  session_name                 TEXT,
  session_type                 TEXT,
  country_name                 TEXT,
  location                     TEXT,
  lap_number                   INTEGER NOT NULL,
  valid_driver_count           BIGINT,
  fastest_valid_lap_on_number  NUMERIC,
  avg_valid_lap_on_number      NUMERIC,
  rep_valid_lap_on_number      NUMERIC,
  PRIMARY KEY (session_key, lap_number)
);

-- Idempotent re-population from the canonical source-definition view.
-- TRUNCATE before INSERT makes re-running the migration safe; the bulk INSERT
-- doubles as a grain assertion via the PRIMARY KEY constraint above. The
-- PK-implied unique btree on (session_key, lap_number) doubles as the
-- deferred per-session_key delete-then-insert refresh's lookup index, so no
-- additional CREATE INDEX statements are needed here.
TRUNCATE core.lap_context_summary_mat;
INSERT INTO core.lap_context_summary_mat
SELECT * FROM core_build.lap_context_summary;

-- Replace the public aggregating view with a facade over the storage table.
-- CREATE OR REPLACE VIEW (not DROP VIEW + CREATE VIEW) for pattern
-- consistency with prior Phase 3 materialization slices and to remain robust
-- against any future SQL view that depends on core.lap_context_summary.
-- CREATE OR REPLACE VIEW is dependency-safe because the storage table above
-- is declared with the same column names, types, and ordering as the
-- original view's projection.
CREATE OR REPLACE VIEW core.lap_context_summary AS
SELECT * FROM core.lap_context_summary_mat;

COMMIT;
