-- Deploy openf1:055_driver_identity_pairs to pg
-- requires: 054_driver_score_grid_source
--
-- Car numbers are SEASON-scoped (#1: Verstappen 2023-25 → Norris 2026),
-- but core.driver_identity_lookup collapsed identity to one row per car
-- number with the hand-seeded mapping winning over observed data. Result:
-- the 2026 Norris roster row carried Verstappen's surname/acronym, "Norris"
-- resolved to nothing in 2026 sessions, and "Verstappen" phantom-matched
-- Norris's #1. Rebuild the view per OBSERVED (number, name) pair from
-- raw.drivers, with pair-scoped first_year/last_year (mapping ranges, not
-- career ranges — the resolver's year checks finally mean what they say).
-- Seed rows enrich the pair whose name they describe; a seed for a
-- never-observed pair still emits, with NULL year range.

BEGIN;

CREATE OR REPLACE VIEW core.driver_identity_lookup AS
WITH pair_identity AS (
  SELECT DISTINCT ON (d.driver_number, LOWER(BTRIM(d.full_name)))
    d.driver_number, d.full_name, d.first_name, d.last_name,
    d.name_acronym, d.broadcast_name
  FROM raw.drivers d
  LEFT JOIN raw.sessions s ON s.session_key = d.session_key
  WHERE d.driver_number IS NOT NULL
    AND d.full_name IS NOT NULL AND BTRIM(d.full_name) <> ''
  ORDER BY d.driver_number, LOWER(BTRIM(d.full_name)),
           COALESCE(s.year, 0) DESC, d.ingested_at DESC
),
pair_meta AS (
  SELECT d.driver_number, LOWER(BTRIM(d.full_name)) AS pair_name,
         MIN(s.year) FILTER (WHERE s.year IS NOT NULL) AS first_year,
         MAX(s.year) FILTER (WHERE s.year IS NOT NULL) AS last_year,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT d.team_name ORDER BY d.team_name), NULL) AS teams
  FROM raw.drivers d
  LEFT JOIN raw.sessions s ON s.session_key = d.session_key
  WHERE d.driver_number IS NOT NULL
    AND d.full_name IS NOT NULL AND BTRIM(d.full_name) <> ''
  GROUP BY d.driver_number, LOWER(BTRIM(d.full_name))
),
driver_base AS (
  SELECT pi.driver_number,
         pi.full_name AS canonical_full_name,
         pi.first_name, pi.last_name, pi.name_acronym, pi.broadcast_name,
         pm.first_year, pm.last_year, pm.teams
  FROM pair_identity pi
  LEFT JOIN pair_meta pm
    ON pm.driver_number = pi.driver_number
   AND pm.pair_name = LOWER(BTRIM(pi.full_name))
),
derived_aliases AS (
  SELECT db.driver_number, db.canonical_full_name, db.first_name, db.last_name,
         db.name_acronym, db.broadcast_name, x.alias_text,
         public.f1_unaccent(LOWER(BTRIM(x.alias_text))) AS normalized_alias,
         x.alias_type, 'derived'::TEXT AS alias_source,
         db.first_year, db.last_year, db.teams
  FROM driver_base db
  CROSS JOIN LATERAL (
    VALUES
      (db.canonical_full_name, 'full_name'),
      (db.first_name, 'first_name'),
      (db.last_name, 'last_name'),
      (db.name_acronym, 'name_acronym'),
      (db.broadcast_name, 'broadcast_name')
  ) AS x(alias_text, alias_type)
  WHERE x.alias_text IS NOT NULL AND BTRIM(x.alias_text) <> ''
),
seed_aliases AS (
  -- Attach each seed row to the observed pair whose name it describes
  -- (name match first, newest pair as fallback for null seed names).
  -- Year range and teams only carry over when the name actually matched —
  -- a seed naming a driver never observed on that number gets NULLs, not
  -- another driver's range.
  SELECT a.driver_number,
         COALESCE(NULLIF(BTRIM(a.canonical_full_name), ''), db.canonical_full_name) AS canonical_full_name,
         COALESCE(NULLIF(BTRIM(a.first_name), ''), db.first_name) AS first_name,
         COALESCE(NULLIF(BTRIM(a.last_name), ''), db.last_name) AS last_name,
         COALESCE(NULLIF(BTRIM(a.name_acronym), ''), db.name_acronym) AS name_acronym,
         COALESCE(NULLIF(BTRIM(a.broadcast_name), ''), db.broadcast_name) AS broadcast_name,
         a.alias_text, a.normalized_alias, a.alias_type, 'seed'::TEXT AS alias_source,
         CASE WHEN db.name_matched THEN db.first_year END AS first_year,
         CASE WHEN db.name_matched THEN db.last_year END AS last_year,
         CASE WHEN db.name_matched THEN db.teams END AS teams
  FROM core.driver_alias_lookup a
  LEFT JOIN LATERAL (
    SELECT db.*,
           LOWER(BTRIM(db.canonical_full_name)) = LOWER(BTRIM(COALESCE(a.canonical_full_name, ''))) AS name_matched
    FROM driver_base db
    WHERE db.driver_number = a.driver_number
    ORDER BY (LOWER(BTRIM(db.canonical_full_name)) = LOWER(BTRIM(COALESCE(a.canonical_full_name, '')))) DESC,
             db.last_year DESC NULLS LAST
    LIMIT 1
  ) db ON TRUE
),
all_aliases AS (
  SELECT * FROM derived_aliases
  UNION ALL SELECT * FROM seed_aliases
)
SELECT DISTINCT ON (aa.driver_number, aa.normalized_alias, aa.alias_type)
  aa.driver_number, aa.canonical_full_name, aa.first_name, aa.last_name,
  aa.name_acronym, aa.broadcast_name, aa.alias_text, aa.normalized_alias,
  aa.alias_type, aa.alias_source, aa.first_year, aa.last_year, aa.teams
FROM all_aliases aa
WHERE aa.normalized_alias IS NOT NULL AND aa.normalized_alias <> ''
ORDER BY aa.driver_number, aa.normalized_alias, aa.alias_type,
         aa.alias_source DESC, aa.last_year DESC NULLS LAST;

COMMIT;
