-- Deploy openf1:025_alias_view_diacritic_alignment to pg
-- requires: 024_alias_trgm_indexes
--
-- Phase 14-E: align every view-side and index-side normalization site
-- with public.f1_unaccent(LOWER(BTRIM(...))) so query-side
-- (resolver.ts.normalizeAliasText, chatRuntime.ts.normalize) and
-- seed-side (load_codex_helpers.sh UPDATE expressions) values join
-- exactly. Without this, "Sao Paulo" vs "São Paulo" and similar
-- diacritic-bearing intrinsic aliases miss on the exact-match path.

BEGIN;

-- 1. core.session_search_lookup
CREATE OR REPLACE VIEW core.session_search_lookup AS
WITH base_sessions AS (
  SELECT
    s.session_key, s.meeting_key, s.year, s.session_name, s.session_type,
    s.country_name, s.location, s.circuit_short_name, s.meeting_name, s.date_start
  FROM core.sessions s
),
intrinsic_aliases AS (
  SELECT bs.*, bs.country_name AS alias_text,
         public.f1_unaccent(LOWER(BTRIM(bs.country_name))) AS normalized_alias,
         'country_name'::TEXT AS alias_type, 'intrinsic'::TEXT AS alias_source
  FROM base_sessions bs
  WHERE bs.country_name IS NOT NULL AND BTRIM(bs.country_name) <> ''
  UNION ALL
  SELECT bs.*, bs.location AS alias_text,
         public.f1_unaccent(LOWER(BTRIM(bs.location))) AS normalized_alias,
         'location'::TEXT, 'intrinsic'::TEXT
  FROM base_sessions bs
  WHERE bs.location IS NOT NULL AND BTRIM(bs.location) <> ''
  UNION ALL
  SELECT bs.*, bs.circuit_short_name AS alias_text,
         public.f1_unaccent(LOWER(BTRIM(bs.circuit_short_name))) AS normalized_alias,
         'circuit_short_name'::TEXT, 'intrinsic'::TEXT
  FROM base_sessions bs
  WHERE bs.circuit_short_name IS NOT NULL AND BTRIM(bs.circuit_short_name) <> ''
  UNION ALL
  SELECT bs.*, bs.session_name AS alias_text,
         public.f1_unaccent(LOWER(BTRIM(bs.session_name))) AS normalized_alias,
         'session_name'::TEXT, 'intrinsic'::TEXT
  FROM base_sessions bs
  WHERE bs.session_name IS NOT NULL AND BTRIM(bs.session_name) <> ''
),
venue_aliases AS (
  SELECT bs.*, l.alias_text, l.normalized_alias, l.alias_type,
         'lookup_seed'::TEXT AS alias_source
  FROM base_sessions bs
  JOIN core.session_venue_alias_lookup l
    ON (l.country_name IS NULL OR public.f1_unaccent(LOWER(BTRIM(l.country_name))) = public.f1_unaccent(LOWER(BTRIM(COALESCE(bs.country_name, '')))))
   AND (l.location IS NULL OR public.f1_unaccent(LOWER(BTRIM(l.location))) = public.f1_unaccent(LOWER(BTRIM(COALESCE(bs.location, '')))))
   AND (l.circuit_short_name IS NULL OR public.f1_unaccent(LOWER(BTRIM(l.circuit_short_name))) = public.f1_unaccent(LOWER(BTRIM(COALESCE(bs.circuit_short_name, '')))))
),
session_type_aliases AS (
  SELECT bs.*, st.alias_text, st.normalized_alias,
         st.normalized_session_type AS alias_type,
         'session_type_lookup'::TEXT AS alias_source
  FROM base_sessions bs
  JOIN core.session_type_alias_lookup st
    ON public.f1_unaccent(LOWER(BTRIM(st.raw_session_name))) = public.f1_unaccent(LOWER(BTRIM(COALESCE(bs.session_name, ''))))
    OR public.f1_unaccent(LOWER(BTRIM(st.normalized_session_type))) = public.f1_unaccent(LOWER(BTRIM(COALESCE(bs.session_type, ''))))
),
all_aliases AS (
  SELECT * FROM intrinsic_aliases
  UNION ALL SELECT * FROM venue_aliases
  UNION ALL SELECT * FROM session_type_aliases
)
SELECT DISTINCT
  session_key, meeting_key, year, session_name, session_type,
  country_name, location, circuit_short_name, meeting_name, date_start,
  alias_text, normalized_alias, alias_type, alias_source
FROM all_aliases
WHERE normalized_alias IS NOT NULL AND normalized_alias <> '';

-- 2. core.driver_identity_lookup — only the derived_aliases CTE
--    normalized_alias expression changes; everything else verbatim.
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

-- 3. core.team_identity_lookup
CREATE OR REPLACE VIEW core.team_identity_lookup AS
WITH seed_aliases AS (
  SELECT
    NULLIF(BTRIM(l.alias_text), '') AS alias_text,
    COALESCE(NULLIF(BTRIM(l.normalized_alias), ''), public.f1_unaccent(LOWER(BTRIM(l.alias_text)))) AS normalized_alias,
    NULLIF(BTRIM(l.canonical_team_name), '') AS canonical_team_name,
    l.alias_type, l.active_from_year, l.active_to_year, l.notes,
    'seed'::TEXT AS alias_source
  FROM core.team_alias_lookup l
),
observed_aliases AS (
  SELECT
    NULLIF(BTRIM(d.team_name), '') AS alias_text,
    public.f1_unaccent(LOWER(BTRIM(d.team_name))) AS normalized_alias,
    NULLIF(BTRIM(d.team_name), '') AS canonical_team_name,
    'observed_team_name'::TEXT AS alias_type,
    MIN(s.year) FILTER (WHERE s.year IS NOT NULL) AS active_from_year,
    MAX(s.year) FILTER (WHERE s.year IS NOT NULL) AS active_to_year,
    'Derived from raw.drivers team_name values.'::TEXT AS notes,
    'derived'::TEXT AS alias_source
  FROM raw.drivers d
  LEFT JOIN raw.sessions s ON s.session_key = d.session_key
  WHERE d.team_name IS NOT NULL AND BTRIM(d.team_name) <> ''
  GROUP BY public.f1_unaccent(LOWER(BTRIM(d.team_name))), NULLIF(BTRIM(d.team_name), '')
),
all_aliases AS (
  SELECT * FROM seed_aliases
  UNION ALL SELECT * FROM observed_aliases
)
SELECT DISTINCT ON (
  normalized_alias, canonical_team_name,
  COALESCE(active_from_year, -1), COALESCE(active_to_year, -1)
)
  alias_text, normalized_alias, canonical_team_name,
  alias_type, active_from_year, active_to_year, notes, alias_source
FROM all_aliases
WHERE normalized_alias IS NOT NULL AND normalized_alias <> ''
  AND canonical_team_name IS NOT NULL AND canonical_team_name <> ''
ORDER BY normalized_alias, canonical_team_name,
         COALESCE(active_from_year, -1), COALESCE(active_to_year, -1),
         alias_source DESC;

-- 4. Seed-table partial-unique indexes — wrap COALESCE fallback with f1_unaccent
DROP INDEX IF EXISTS core.uq_session_venue_alias_lookup;
CREATE UNIQUE INDEX uq_session_venue_alias_lookup
  ON core.session_venue_alias_lookup(
    COALESCE(normalized_alias, public.f1_unaccent(LOWER(BTRIM(alias_text)))),
    COALESCE(country_name, ''), COALESCE(location, ''), COALESCE(circuit_short_name, '')
  );

DROP INDEX IF EXISTS core.uq_driver_alias_lookup;
CREATE UNIQUE INDEX uq_driver_alias_lookup
  ON core.driver_alias_lookup(
    driver_number,
    COALESCE(normalized_alias, public.f1_unaccent(LOWER(BTRIM(alias_text)))),
    COALESCE(season, -1)
  );

DROP INDEX IF EXISTS core.uq_session_type_alias_lookup;
CREATE UNIQUE INDEX uq_session_type_alias_lookup
  ON core.session_type_alias_lookup(
    COALESCE(normalized_alias, public.f1_unaccent(LOWER(BTRIM(alias_text)))),
    normalized_session_type, raw_session_name
  );

DROP INDEX IF EXISTS core.uq_team_alias_lookup;
CREATE UNIQUE INDEX uq_team_alias_lookup
  ON core.team_alias_lookup(
    COALESCE(normalized_alias, public.f1_unaccent(LOWER(BTRIM(alias_text)))),
    canonical_team_name,
    COALESCE(active_from_year, -1), COALESCE(active_to_year, -1)
  );

COMMIT;
