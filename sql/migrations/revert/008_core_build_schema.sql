-- Revert openf1:008_core_build_schema from pg

BEGIN;

DROP SCHEMA IF EXISTS core_build CASCADE;

COMMIT;
