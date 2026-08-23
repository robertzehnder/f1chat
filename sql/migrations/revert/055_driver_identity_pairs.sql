-- Revert openf1:055_driver_identity_pairs from pg
-- Restores the 025-era per-number definition (seed-first identity,
-- career-range first/last_year), extracted verbatim from
-- deploy/025_alias_view_diacritic_alignment.sql.

BEGIN;

CREATE OR REPLACE VIEW core.driver_identity_lookup AS
WITH latest_identity AS (
  SELECT DISTINCT ON (d.driver_number)
    d.driver_number, d.full_name, d.first_name, d.last_name,
    d.name_acronym, d.broadcast_name
  FROM raw.drivers d
  LEFT JOIN raw.sessions s ON s.session_key = d.session_key
  WHERE d.driver_number IS NOT NULL
  ORDER BY d.driver_number, COALESCE(s.year, 0) DESC, d.ingested_at DESC
),
seed_identity AS (
  SELECT a.driver_number,
         MAX(NULLIF(BTRIM(a.canonical_full_name), '')) AS canonical_full_name_seed,
         MAX(NULLIF(BTRIM(a.first_name), '')) AS first_name_seed,
         MAX(NULLIF(BTRIM(a.last_name), '')) AS last_name_seed,
         MAX(NULLIF(BTRIM(a.name_acronym), '')) AS name_acronym_seed,
         MAX(NULLIF(BTRIM(a.broadcast_name), '')) AS broadcast_name_seed
  FROM core.driver_alias_lookup a GROUP BY a.driver_number
),
driver_base AS (
  SELECT
    COALESCE(si.driver_number, li.driver_number) AS driver_number,
    COALESCE(si.canonical_full_name_seed, li.full_name) AS canonical_full_name,
    COALESCE(si.first_name_seed, li.first_name) AS first_name,
    COALESCE(si.last_name_seed, li.last_name) AS last_name,
    COALESCE(si.name_acronym_seed, li.name_acronym) AS name_acronym,
    COALESCE(si.broadcast_name_seed, li.broadcast_name) AS broadcast_name
  FROM latest_identity li
  FULL OUTER JOIN seed_identity si ON si.driver_number = li.driver_number
),
driver_meta AS (
  SELECT d.driver_number,
         MIN(s.year) FILTER (WHERE s.year IS NOT NULL) AS first_year,
         MAX(s.year) FILTER (WHERE s.year IS NOT NULL) AS last_year,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT d.team_name ORDER BY d.team_name), NULL) AS teams
  FROM raw.drivers d
  LEFT JOIN raw.sessions s ON s.session_key = d.session_key
  WHERE d.driver_number IS NOT NULL
  GROUP BY d.driver_number
),
derived_aliases AS (
  SELECT db.driver_number, db.canonical_full_name, db.first_name, db.last_name,
         db.name_acronym, db.broadcast_name, x.alias_text,
         public.f1_unaccent(LOWER(BTRIM(x.alias_text))) AS normalized_alias,
         x.alias_type, 'derived'::TEXT AS alias_source
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
  SELECT a.driver_number,
         COALESCE(NULLIF(BTRIM(a.canonical_full_name), ''), db.canonical_full_name) AS canonical_full_name,
         COALESCE(NULLIF(BTRIM(a.first_name), ''), db.first_name) AS first_name,
         COALESCE(NULLIF(BTRIM(a.last_name), ''), db.last_name) AS last_name,
         COALESCE(NULLIF(BTRIM(a.name_acronym), ''), db.name_acronym) AS name_acronym,
         COALESCE(NULLIF(BTRIM(a.broadcast_name), ''), db.broadcast_name) AS broadcast_name,
         a.alias_text, a.normalized_alias, a.alias_type, 'seed'::TEXT AS alias_source
  FROM core.driver_alias_lookup a
  LEFT JOIN driver_base db ON db.driver_number = a.driver_number
),
all_aliases AS (
  SELECT * FROM derived_aliases
  UNION ALL SELECT * FROM seed_aliases
)
SELECT DISTINCT ON (aa.driver_number, aa.normalized_alias, aa.alias_type)
  aa.driver_number, aa.canonical_full_name, aa.first_name, aa.last_name,
  aa.name_acronym, aa.broadcast_name, aa.alias_text, aa.normalized_alias,
  aa.alias_type, aa.alias_source, dm.first_year, dm.last_year, dm.teams
FROM all_aliases aa
LEFT JOIN driver_meta dm ON dm.driver_number = aa.driver_number
WHERE aa.normalized_alias IS NOT NULL AND aa.normalized_alias <> ''
ORDER BY aa.driver_number, aa.normalized_alias, aa.alias_type, aa.alias_source DESC;

COMMIT;
