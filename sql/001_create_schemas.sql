-- Canonical location: sql/migrations/deploy/001_create_schemas.sql
-- This file is retained as a thin pointer for legacy direct callers (e.g.,
-- web/scripts/perf-explain-before-after.mjs and web/scripts/tests/saved-
-- analyses.test.mjs). New schema changes MUST be added via
-- `sqitch add <name>` under sql/migrations/. See sql/migrations/README.md.
--
BEGIN;

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS core;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

COMMIT;
