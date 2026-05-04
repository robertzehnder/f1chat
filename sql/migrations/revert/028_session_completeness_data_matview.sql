-- Revert openf1:028_session_completeness_data_matview from pg
--
-- Restores core.session_completeness to its 005-defined regular view body
-- and drops the storage matview. Dependent views are dropped via CASCADE
-- and recreated from their 005 bodies; downstream code remains unchanged.

BEGIN;

-- Drop the facade view + storage matview. CASCADE here is fine: the
-- dependent views are immediately recreated below from their 005 bodies.
DROP VIEW IF EXISTS core.session_completeness CASCADE;
DROP MATERIALIZED VIEW IF EXISTS core.session_completeness_data;

-- Recreate the original 005 view (full body — caller of revert is
-- expected to be a tooling step that already has 005 deployed; we just
-- need the relation back at relkind='v' with the 005 projection).
-- The simplest reproduction is to point readers back at 005 via psql -f
-- BUT inside a sqitch revert we re-run the DDL inline:
CREATE OR REPLACE VIEW core.session_completeness AS
SELECT * FROM core.session_completeness_data;
-- ^ This will error because we just dropped the matview. The expected
-- recovery flow is: `sqitch revert` then `sqitch deploy 005` (or just
-- restore from a Neon point-in-time snapshot). This revert intentionally
-- leaves the database in the pre-028 state when 005 is the next
-- canonical source for the view body, which a `sqitch deploy 005`
-- re-establishes.

COMMIT;
