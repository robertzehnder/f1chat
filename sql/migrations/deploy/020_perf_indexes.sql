-- Phase 4 performance indexes (roadmap §4 Phase 4).
--
-- CREATE INDEX CONCURRENTLY cannot run inside an explicit transaction block,
-- so this file ships WITHOUT a BEGIN; ... COMMIT; wrapper. Apply with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/020_perf_indexes.sql
-- (no --single-transaction / -1). Each statement runs in its own implicit
-- transaction; ON_ERROR_STOP=1 aborts the run on the first failure.
--
-- Column lists are schema-verified against sql/002_create_tables.sql.
--
-- The driver+session+lap primary access pattern is already served by the
-- pre-existing unique index `uq_laps_session_driver_lap` on the same column
-- tuple (sql/004_constraints.sql:7-8). A duplicate `idx_raw_laps_session_driver_lap`
-- index would be functionally redundant and never picked by the planner — see
-- the Blocker diagnosis in diagnostic/slices/04-perf-indexes-sql.md (round-5).

-- index-only scans for valid-lap and sector filters on raw.laps
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_laps_session_include
  ON raw.laps (session_key)
  INCLUDE (lap_duration, is_pit_out_lap, duration_sector_1, duration_sector_2, duration_sector_3);

-- compound dimension and stint-window join key on raw.stints
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_stints_session_driver_window
  ON raw.stints (session_key, driver_number, lap_start, lap_end)
  INCLUDE (compound);

-- pit-in lap derivation on raw.pit
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_pit_session_driver_lap
  ON raw.pit (session_key, driver_number, lap_number);

-- position-history time scans on raw.position_history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_position_history_session_date
  ON raw.position_history (session_key, date);

-- partial index for the valid-lap filter on raw.laps
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_laps_session_driver_valid_partial
  ON raw.laps (session_key, driver_number)
  WHERE lap_duration IS NOT NULL;
