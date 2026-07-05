-- Revert openf1:047_core_sample_lap_position from pg

BEGIN;

DROP VIEW IF EXISTS core.car_data_lap_position;
DROP VIEW IF EXISTS core.location_lap_position;

COMMIT;
