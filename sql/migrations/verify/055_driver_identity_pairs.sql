-- Verify openf1:055_driver_identity_pairs on pg
-- Definition-based (the chain-gate sandbox has no data): the view must be
-- built per observed (number, name) pair, i.e. contain the pair_identity
-- CTE keyed on driver_number + full_name. Divides by zero otherwise.

BEGIN;

SELECT 1 / COUNT(*)
FROM pg_views
WHERE schemaname = 'core'
  AND viewname = 'driver_identity_lookup'
  AND definition LIKE '%pair_identity%'
  AND definition LIKE '%DISTINCT ON (d.driver_number, %lower(btrim(d.full_name))%';

ROLLBACK;
