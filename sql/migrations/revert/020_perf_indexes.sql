-- Revert openf1:020_perf_indexes from pg

-- DROP INDEX CONCURRENTLY cannot run inside an explicit transaction block,
-- so this revert ships WITHOUT a BEGIN; ... COMMIT; wrapper. Each statement
-- runs in its own implicit transaction; ON_ERROR_STOP=1 (set by sqitch via
-- psql) aborts on the first failure.

DROP INDEX CONCURRENTLY IF EXISTS raw.idx_raw_laps_session_driver_valid_partial;
DROP INDEX CONCURRENTLY IF EXISTS raw.idx_raw_position_history_session_date;
DROP INDEX CONCURRENTLY IF EXISTS raw.idx_raw_pit_session_driver_lap;
DROP INDEX CONCURRENTLY IF EXISTS raw.idx_raw_stints_session_driver_window;
DROP INDEX CONCURRENTLY IF EXISTS raw.idx_raw_laps_session_include;
