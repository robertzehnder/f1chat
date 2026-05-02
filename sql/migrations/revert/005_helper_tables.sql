-- Revert openf1:005_helper_tables from pg

BEGIN;

DROP VIEW IF EXISTS core.source_anomaly_tracking;
DROP VIEW IF EXISTS core.weekend_session_expectation_audit;
DROP VIEW IF EXISTS core.weekend_session_coverage;
DROP VIEW IF EXISTS core.session_completeness;
DROP VIEW IF EXISTS core.team_identity_lookup;
DROP VIEW IF EXISTS core.driver_identity_lookup;
DROP VIEW IF EXISTS core.session_search_lookup;

DROP TABLE IF EXISTS core.query_template_registry;
DROP TABLE IF EXISTS core.benchmark_question_type_lookup;
DROP TABLE IF EXISTS core.source_anomaly_manual;
DROP TABLE IF EXISTS core.weekend_session_expectation_rules;
DROP TABLE IF EXISTS core.team_alias_lookup;
DROP TABLE IF EXISTS core.session_type_alias_lookup;
DROP TABLE IF EXISTS core.driver_alias_lookup;
DROP TABLE IF EXISTS core.session_venue_alias_lookup;

COMMIT;
