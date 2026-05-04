-- Revert openf1:031_intervals_parser from pg

BEGIN;

DROP FUNCTION IF EXISTS core.parse_interval(text);

COMMIT;
