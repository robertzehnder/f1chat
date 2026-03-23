BEGIN;

-- Helper lookup seeds (populated from f1_codex_helpers via scripts/load_codex_helpers.sh)
CREATE TABLE IF NOT EXISTS core.session_venue_alias_lookup (
  alias_text TEXT NOT NULL,
  normalized_alias TEXT,
  alias_type TEXT NOT NULL,
  country_name TEXT,
  location TEXT,
  circuit_short_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.driver_alias_lookup (
  driver_number INTEGER NOT NULL,
  canonical_full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  name_acronym TEXT,
  broadcast_name TEXT,
  alias_text TEXT NOT NULL,
  normalized_alias TEXT,
  alias_type TEXT NOT NULL,
  season INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.session_type_alias_lookup (
  raw_session_name TEXT NOT NULL,
  normalized_session_type TEXT NOT NULL,
  alias_text TEXT NOT NULL,
  normalized_alias TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.team_alias_lookup (
  alias_text TEXT NOT NULL,
  normalized_alias TEXT,
  alias_type TEXT NOT NULL,
  canonical_team_name TEXT NOT NULL,
  active_from_year INTEGER,
  active_to_year INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.weekend_session_expectation_rules (
  weekend_format TEXT NOT NULL,
  expected_session_type TEXT NOT NULL,
  min_expected_count INTEGER NOT NULL DEFAULT 1,
  max_expected_count INTEGER NOT NULL DEFAULT 1,
  active_from_year INTEGER,
  active_to_year INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.source_anomaly_manual (
  anomaly_id TEXT PRIMARY KEY,
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  subsystem TEXT NOT NULL DEFAULT 'source_audit',
  status TEXT NOT NULL DEFAULT 'open',
  year INTEGER,
  session_key BIGINT,
  meeting_key BIGINT,
  driver_number INTEGER,
  entity_label TEXT,
  symptom TEXT NOT NULL,
  details TEXT,
  evidence_ref TEXT,
  source_system TEXT,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.benchmark_question_type_lookup (
  question_type TEXT NOT NULL,
  theme TEXT,
  preferred_grain TEXT,
  preferred_tables TEXT,
  fallback_tables TEXT,
  requires_session BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.query_template_registry (
  template_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE core.session_venue_alias_lookup
  ALTER COLUMN normalized_alias DROP NOT NULL;

ALTER TABLE core.driver_alias_lookup
  ALTER COLUMN normalized_alias DROP NOT NULL;

ALTER TABLE core.session_type_alias_lookup
  ALTER COLUMN normalized_alias DROP NOT NULL;

ALTER TABLE core.team_alias_lookup
  ALTER COLUMN normalized_alias DROP NOT NULL;

ALTER TABLE core.weekend_session_expectation_rules
  DROP CONSTRAINT IF EXISTS ck_weekend_session_expectation_rules_format;

ALTER TABLE core.weekend_session_expectation_rules
  ADD CONSTRAINT ck_weekend_session_expectation_rules_format
  CHECK (weekend_format IN ('standard', 'sprint'));

ALTER TABLE core.weekend_session_expectation_rules
  DROP CONSTRAINT IF EXISTS ck_weekend_session_expectation_rules_counts;

ALTER TABLE core.weekend_session_expectation_rules
  ADD CONSTRAINT ck_weekend_session_expectation_rules_counts
  CHECK (min_expected_count >= 0 AND max_expected_count >= min_expected_count);

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_venue_alias_lookup
  ON core.session_venue_alias_lookup(COALESCE(normalized_alias, LOWER(BTRIM(alias_text))), COALESCE(country_name, ''), COALESCE(location, ''), COALESCE(circuit_short_name, ''));

CREATE UNIQUE INDEX IF NOT EXISTS uq_driver_alias_lookup
  ON core.driver_alias_lookup(driver_number, COALESCE(normalized_alias, LOWER(BTRIM(alias_text))), COALESCE(season, -1));

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_type_alias_lookup
  ON core.session_type_alias_lookup(COALESCE(normalized_alias, LOWER(BTRIM(alias_text))), normalized_session_type, raw_session_name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_team_alias_lookup
  ON core.team_alias_lookup(COALESCE(normalized_alias, LOWER(BTRIM(alias_text))), canonical_team_name, COALESCE(active_from_year, -1), COALESCE(active_to_year, -1));

CREATE UNIQUE INDEX IF NOT EXISTS uq_weekend_session_expectation_rules
  ON core.weekend_session_expectation_rules(weekend_format, expected_session_type, COALESCE(active_from_year, -1), COALESCE(active_to_year, -1));

CREATE UNIQUE INDEX IF NOT EXISTS uq_benchmark_question_type_lookup
  ON core.benchmark_question_type_lookup(question_type, COALESCE(theme, ''));

CREATE INDEX IF NOT EXISTS idx_session_venue_alias_lookup_alias
  ON core.session_venue_alias_lookup(normalized_alias);

CREATE INDEX IF NOT EXISTS idx_driver_alias_lookup_alias
  ON core.driver_alias_lookup(normalized_alias);

CREATE INDEX IF NOT EXISTS idx_driver_alias_lookup_driver_number
  ON core.driver_alias_lookup(driver_number);

CREATE INDEX IF NOT EXISTS idx_session_type_alias_lookup_alias
  ON core.session_type_alias_lookup(normalized_alias);

CREATE INDEX IF NOT EXISTS idx_team_alias_lookup_alias
  ON core.team_alias_lookup(normalized_alias);

CREATE INDEX IF NOT EXISTS idx_team_alias_lookup_canonical
  ON core.team_alias_lookup(canonical_team_name);

CREATE INDEX IF NOT EXISTS idx_source_anomaly_manual_type
  ON core.source_anomaly_manual(anomaly_type, status);

-- Canonical session search surface for entity resolution and alias-aware lookups
CREATE OR REPLACE VIEW core.session_search_lookup AS
WITH base_sessions AS (
  SELECT
    s.session_key,
    s.meeting_key,
    s.year,
    s.session_name,
    s.session_type,
    s.country_name,
    s.location,
    s.circuit_short_name,
    s.meeting_name,
    s.date_start
  FROM core.sessions s
),
intrinsic_aliases AS (
  SELECT
    bs.*,
    bs.country_name AS alias_text,
    LOWER(BTRIM(bs.country_name)) AS normalized_alias,
    'country_name'::TEXT AS alias_type,
    'intrinsic'::TEXT AS alias_source
  FROM base_sessions bs
  WHERE bs.country_name IS NOT NULL AND BTRIM(bs.country_name) <> ''

  UNION ALL

  SELECT
    bs.*,
    bs.location AS alias_text,
    LOWER(BTRIM(bs.location)) AS normalized_alias,
    'location'::TEXT AS alias_type,
    'intrinsic'::TEXT AS alias_source
  FROM base_sessions bs
  WHERE bs.location IS NOT NULL AND BTRIM(bs.location) <> ''

  UNION ALL

  SELECT
    bs.*,
    bs.circuit_short_name AS alias_text,
    LOWER(BTRIM(bs.circuit_short_name)) AS normalized_alias,
    'circuit_short_name'::TEXT AS alias_type,
    'intrinsic'::TEXT AS alias_source
  FROM base_sessions bs
  WHERE bs.circuit_short_name IS NOT NULL AND BTRIM(bs.circuit_short_name) <> ''

  UNION ALL

  SELECT
    bs.*,
    bs.session_name AS alias_text,
    LOWER(BTRIM(bs.session_name)) AS normalized_alias,
    'session_name'::TEXT AS alias_type,
    'intrinsic'::TEXT AS alias_source
  FROM base_sessions bs
  WHERE bs.session_name IS NOT NULL AND BTRIM(bs.session_name) <> ''
),
venue_aliases AS (
  SELECT
    bs.*,
    l.alias_text,
    l.normalized_alias,
    l.alias_type,
    'lookup_seed'::TEXT AS alias_source
  FROM base_sessions bs
  JOIN core.session_venue_alias_lookup l
    ON (l.country_name IS NULL OR LOWER(BTRIM(l.country_name)) = LOWER(BTRIM(COALESCE(bs.country_name, ''))))
   AND (l.location IS NULL OR LOWER(BTRIM(l.location)) = LOWER(BTRIM(COALESCE(bs.location, ''))))
   AND (l.circuit_short_name IS NULL OR LOWER(BTRIM(l.circuit_short_name)) = LOWER(BTRIM(COALESCE(bs.circuit_short_name, ''))))
),
session_type_aliases AS (
  SELECT
    bs.*,
    st.alias_text,
    st.normalized_alias,
    st.normalized_session_type AS alias_type,
    'session_type_lookup'::TEXT AS alias_source
  FROM base_sessions bs
  JOIN core.session_type_alias_lookup st
    ON LOWER(BTRIM(st.raw_session_name)) = LOWER(BTRIM(COALESCE(bs.session_name, '')))
    OR LOWER(BTRIM(st.normalized_session_type)) = LOWER(BTRIM(COALESCE(bs.session_type, '')))
),
all_aliases AS (
  SELECT * FROM intrinsic_aliases
  UNION ALL
  SELECT * FROM venue_aliases
  UNION ALL
  SELECT * FROM session_type_aliases
)
SELECT DISTINCT
  session_key,
  meeting_key,
  year,
  session_name,
  session_type,
  country_name,
  location,
  circuit_short_name,
  meeting_name,
  date_start,
  alias_text,
  normalized_alias,
  alias_type,
  alias_source
FROM all_aliases
WHERE normalized_alias IS NOT NULL
  AND normalized_alias <> '';

-- Driver identity + alias surface for robust driver resolution
CREATE OR REPLACE VIEW core.driver_identity_lookup AS
WITH latest_identity AS (
  SELECT DISTINCT ON (d.driver_number)
    d.driver_number,
    d.full_name,
    d.first_name,
    d.last_name,
    d.name_acronym,
    d.broadcast_name
  FROM raw.drivers d
  LEFT JOIN raw.sessions s
    ON s.session_key = d.session_key
  WHERE d.driver_number IS NOT NULL
  ORDER BY d.driver_number, COALESCE(s.year, 0) DESC, d.ingested_at DESC
),
seed_identity AS (
  SELECT
    a.driver_number,
    MAX(NULLIF(BTRIM(a.canonical_full_name), '')) AS canonical_full_name_seed,
    MAX(NULLIF(BTRIM(a.first_name), '')) AS first_name_seed,
    MAX(NULLIF(BTRIM(a.last_name), '')) AS last_name_seed,
    MAX(NULLIF(BTRIM(a.name_acronym), '')) AS name_acronym_seed,
    MAX(NULLIF(BTRIM(a.broadcast_name), '')) AS broadcast_name_seed
  FROM core.driver_alias_lookup a
  GROUP BY a.driver_number
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
  FULL OUTER JOIN seed_identity si
    ON si.driver_number = li.driver_number
),
driver_meta AS (
  SELECT
    d.driver_number,
    MIN(s.year) FILTER (WHERE s.year IS NOT NULL) AS first_year,
    MAX(s.year) FILTER (WHERE s.year IS NOT NULL) AS last_year,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT d.team_name ORDER BY d.team_name), NULL) AS teams
  FROM raw.drivers d
  LEFT JOIN raw.sessions s
    ON s.session_key = d.session_key
  WHERE d.driver_number IS NOT NULL
  GROUP BY d.driver_number
),
derived_aliases AS (
  SELECT
    db.driver_number,
    db.canonical_full_name,
    db.first_name,
    db.last_name,
    db.name_acronym,
    db.broadcast_name,
    x.alias_text,
    LOWER(BTRIM(x.alias_text)) AS normalized_alias,
    x.alias_type,
    'derived'::TEXT AS alias_source
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
  SELECT
    a.driver_number,
    COALESCE(NULLIF(BTRIM(a.canonical_full_name), ''), db.canonical_full_name) AS canonical_full_name,
    COALESCE(NULLIF(BTRIM(a.first_name), ''), db.first_name) AS first_name,
    COALESCE(NULLIF(BTRIM(a.last_name), ''), db.last_name) AS last_name,
    COALESCE(NULLIF(BTRIM(a.name_acronym), ''), db.name_acronym) AS name_acronym,
    COALESCE(NULLIF(BTRIM(a.broadcast_name), ''), db.broadcast_name) AS broadcast_name,
    a.alias_text,
    a.normalized_alias,
    a.alias_type,
    'seed'::TEXT AS alias_source
  FROM core.driver_alias_lookup a
  LEFT JOIN driver_base db
    ON db.driver_number = a.driver_number
),
all_aliases AS (
  SELECT * FROM derived_aliases
  UNION ALL
  SELECT * FROM seed_aliases
)
SELECT DISTINCT ON (aa.driver_number, aa.normalized_alias, aa.alias_type)
  aa.driver_number,
  aa.canonical_full_name,
  aa.first_name,
  aa.last_name,
  aa.name_acronym,
  aa.broadcast_name,
  aa.alias_text,
  aa.normalized_alias,
  aa.alias_type,
  aa.alias_source,
  dm.first_year,
  dm.last_year,
  dm.teams
FROM all_aliases aa
LEFT JOIN driver_meta dm
  ON dm.driver_number = aa.driver_number
WHERE aa.normalized_alias IS NOT NULL
  AND aa.normalized_alias <> ''
ORDER BY aa.driver_number, aa.normalized_alias, aa.alias_type, aa.alias_source DESC;

-- Team identity + alias surface for canonical team naming in resolver/runtime.
CREATE OR REPLACE VIEW core.team_identity_lookup AS
WITH seed_aliases AS (
  SELECT
    NULLIF(BTRIM(l.alias_text), '') AS alias_text,
    COALESCE(NULLIF(BTRIM(l.normalized_alias), ''), LOWER(BTRIM(l.alias_text))) AS normalized_alias,
    NULLIF(BTRIM(l.canonical_team_name), '') AS canonical_team_name,
    l.alias_type,
    l.active_from_year,
    l.active_to_year,
    l.notes,
    'seed'::TEXT AS alias_source
  FROM core.team_alias_lookup l
),
observed_aliases AS (
  SELECT
    NULLIF(BTRIM(d.team_name), '') AS alias_text,
    LOWER(BTRIM(d.team_name)) AS normalized_alias,
    NULLIF(BTRIM(d.team_name), '') AS canonical_team_name,
    'observed_team_name'::TEXT AS alias_type,
    MIN(s.year) FILTER (WHERE s.year IS NOT NULL) AS active_from_year,
    MAX(s.year) FILTER (WHERE s.year IS NOT NULL) AS active_to_year,
    'Derived from raw.drivers team_name values.'::TEXT AS notes,
    'derived'::TEXT AS alias_source
  FROM raw.drivers d
  LEFT JOIN raw.sessions s
    ON s.session_key = d.session_key
  WHERE d.team_name IS NOT NULL
    AND BTRIM(d.team_name) <> ''
  GROUP BY LOWER(BTRIM(d.team_name)), NULLIF(BTRIM(d.team_name), '')
),
all_aliases AS (
  SELECT * FROM seed_aliases
  UNION ALL
  SELECT * FROM observed_aliases
)
SELECT DISTINCT ON (
  normalized_alias,
  canonical_team_name,
  COALESCE(active_from_year, -1),
  COALESCE(active_to_year, -1)
)
  alias_text,
  normalized_alias,
  canonical_team_name,
  alias_type,
  active_from_year,
  active_to_year,
  notes,
  alias_source
FROM all_aliases
WHERE normalized_alias IS NOT NULL
  AND normalized_alias <> ''
  AND canonical_team_name IS NOT NULL
  AND canonical_team_name <> ''
ORDER BY
  normalized_alias,
  canonical_team_name,
  COALESCE(active_from_year, -1),
  COALESCE(active_to_year, -1),
  alias_source DESC;

-- Session-level completeness snapshot for routing and answer confidence.
-- This is the canonical session coverage contract for analytics gating.
CREATE OR REPLACE VIEW core.session_completeness AS
WITH drivers_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.drivers
  GROUP BY session_key
),
laps_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.laps
  GROUP BY session_key
),
pit_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.pit
  GROUP BY session_key
),
stints_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.stints
  GROUP BY session_key
),
weather_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.weather
  GROUP BY session_key
),
team_radio_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.team_radio
  GROUP BY session_key
),
position_history_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.position_history
  GROUP BY session_key
),
intervals_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.intervals
  GROUP BY session_key
),
car_data_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.car_data
  GROUP BY session_key
),
location_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.location
  GROUP BY session_key
),
session_result_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.session_result
  GROUP BY session_key
),
starting_grid_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.starting_grid
  GROUP BY session_key
),
race_control_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.race_control
  GROUP BY session_key
),
overtakes_count AS (
  SELECT session_key, COUNT(*)::BIGINT AS rows_count
  FROM raw.overtakes
  GROUP BY session_key
),
base AS (
  SELECT
    s.session_key,
    s.meeting_key,
    s.year,
    s.meeting_name,
    s.session_name,
    s.session_type,
    CASE
      WHEN LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE '%sprint qualifying%'
        OR LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE '%sprint shootout%' THEN 'Sprint Qualifying'
      WHEN LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE '%sprint%' THEN 'Sprint'
      WHEN LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE '%qualif%' THEN 'Qualifying'
      WHEN LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE '%practice%'
        OR LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE 'fp%' THEN 'Practice'
      WHEN LOWER(COALESCE(s.session_type, s.session_name, '')) LIKE '%race%' THEN 'Race'
      ELSE COALESCE(NULLIF(BTRIM(s.session_type), ''), NULLIF(BTRIM(s.session_name), ''), 'Other')
    END AS normalized_session_type,
    s.country_name,
    s.location,
    s.circuit_short_name,
    s.date_start,
    COALESCE(drivers_count.rows_count, 0) AS drivers_rows,
    COALESCE(laps_count.rows_count, 0) AS laps_rows,
    COALESCE(pit_count.rows_count, 0) AS pit_rows,
    COALESCE(stints_count.rows_count, 0) AS stints_rows,
    COALESCE(weather_count.rows_count, 0) AS weather_rows,
    COALESCE(team_radio_count.rows_count, 0) AS team_radio_rows,
    COALESCE(position_history_count.rows_count, 0) AS position_history_rows,
    COALESCE(intervals_count.rows_count, 0) AS intervals_rows,
    COALESCE(car_data_count.rows_count, 0) AS car_data_rows,
    COALESCE(location_count.rows_count, 0) AS location_rows,
    COALESCE(session_result_count.rows_count, 0) AS session_result_rows,
    COALESCE(starting_grid_count.rows_count, 0) AS starting_grid_rows,
    COALESCE(race_control_count.rows_count, 0) AS race_control_rows,
    COALESCE(overtakes_count.rows_count, 0) AS overtakes_rows,
    (COALESCE(drivers_count.rows_count, 0) > 0) AS has_drivers,
    (COALESCE(laps_count.rows_count, 0) > 0) AS has_laps,
    (COALESCE(pit_count.rows_count, 0) > 0) AS has_pit,
    (COALESCE(stints_count.rows_count, 0) > 0) AS has_stints,
    (COALESCE(weather_count.rows_count, 0) > 0) AS has_weather,
    (COALESCE(team_radio_count.rows_count, 0) > 0) AS has_team_radio,
    (COALESCE(position_history_count.rows_count, 0) > 0) AS has_position_history,
    (COALESCE(intervals_count.rows_count, 0) > 0) AS has_intervals,
    (COALESCE(car_data_count.rows_count, 0) > 0) AS has_car_data,
    (COALESCE(location_count.rows_count, 0) > 0) AS has_location,
    (COALESCE(session_result_count.rows_count, 0) > 0) AS has_session_result,
    (COALESCE(starting_grid_count.rows_count, 0) > 0) AS has_starting_grid,
    (COALESCE(race_control_count.rows_count, 0) > 0) AS has_race_control,
    (COALESCE(overtakes_count.rows_count, 0) > 0) AS has_overtakes,
    (
      (CASE WHEN COALESCE(laps_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(pit_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(stints_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(weather_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(team_radio_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(position_history_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(intervals_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(car_data_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(location_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(session_result_count.rows_count, 0) > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN COALESCE(starting_grid_count.rows_count, 0) > 0 THEN 1 ELSE 0 END)
    )::INTEGER AS completeness_score,
    (
      COALESCE(laps_count.rows_count, 0) > 0 AND
      COALESCE(stints_count.rows_count, 0) > 0 AND
      COALESCE(pit_count.rows_count, 0) > 0 AND
      COALESCE(car_data_count.rows_count, 0) > 0 AND
      COALESCE(position_history_count.rows_count, 0) > 0
    ) AS has_core_analysis_pack,
    (COALESCE(NULLIF(BTRIM(s.meeting_name), ''), NULL) IS NOT NULL) AS has_meeting_name,
    (
      (s.date_start IS NOT NULL AND s.date_start > NOW()) OR
      (s.date_start IS NULL AND COALESCE(s.year, 0) > EXTRACT(YEAR FROM NOW())::INTEGER)
    ) AS is_future_session
  FROM core.sessions s
  LEFT JOIN drivers_count ON drivers_count.session_key = s.session_key
  LEFT JOIN laps_count ON laps_count.session_key = s.session_key
  LEFT JOIN pit_count ON pit_count.session_key = s.session_key
  LEFT JOIN stints_count ON stints_count.session_key = s.session_key
  LEFT JOIN weather_count ON weather_count.session_key = s.session_key
  LEFT JOIN team_radio_count ON team_radio_count.session_key = s.session_key
  LEFT JOIN position_history_count ON position_history_count.session_key = s.session_key
  LEFT JOIN intervals_count ON intervals_count.session_key = s.session_key
  LEFT JOIN car_data_count ON car_data_count.session_key = s.session_key
  LEFT JOIN location_count ON location_count.session_key = s.session_key
  LEFT JOIN session_result_count ON session_result_count.session_key = s.session_key
  LEFT JOIN starting_grid_count ON starting_grid_count.session_key = s.session_key
  LEFT JOIN race_control_count ON race_control_count.session_key = s.session_key
  LEFT JOIN overtakes_count ON overtakes_count.session_key = s.session_key
),
classified AS (
  SELECT
    b.*,
    (
      (
        NOT b.has_meeting_name
        AND NOT (
          b.has_drivers OR
          b.has_laps OR
          b.has_car_data OR
          b.has_weather OR
          b.has_team_radio OR
          b.has_pit OR
          b.has_session_result OR
          b.has_starting_grid
        )
      )
      OR (
        b.is_future_session
        AND NOT b.has_laps
        AND NOT b.has_car_data
        AND NOT b.has_pit
        AND NOT b.has_session_result
      )
    ) AS is_placeholder
  FROM base b
)
SELECT
  c.session_key,
  c.meeting_key,
  c.year,
  c.session_name,
  c.session_type,
  c.country_name,
  c.location,
  c.circuit_short_name,
  c.date_start,
  c.drivers_rows,
  c.laps_rows,
  c.pit_rows,
  c.stints_rows,
  c.weather_rows,
  c.team_radio_rows,
  c.position_history_rows,
  c.intervals_rows,
  c.car_data_rows,
  c.location_rows,
  c.session_result_rows,
  c.starting_grid_rows,
  c.race_control_rows,
  c.overtakes_rows,
  c.has_laps,
  c.has_pit,
  c.has_stints,
  c.has_weather,
  c.has_team_radio,
  c.has_position_history,
  c.has_intervals,
  c.has_car_data,
  c.has_location,
  c.has_session_result,
  c.has_starting_grid,
  c.has_race_control,
  c.has_overtakes,
  c.completeness_score,
  c.has_core_analysis_pack,
  c.has_drivers,
  c.meeting_name,
  c.normalized_session_type,
  c.is_future_session,
  c.is_placeholder,
  c.has_meeting_name,
  CASE
    WHEN c.is_future_session AND c.is_placeholder THEN 'future_placeholder'
    WHEN c.has_core_analysis_pack AND NOT c.is_future_session THEN 'analytic_ready'
    WHEN c.completeness_score >= 4 THEN 'partially_loaded'
    ELSE 'metadata_only'
  END AS completeness_status
FROM classified c;

-- Weekend-level coverage contract to distinguish complete, partial, and placeholder weekends.
CREATE OR REPLACE VIEW core.weekend_session_coverage AS
WITH session_rows AS (
  SELECT
    COALESCE(sc.meeting_key, -sc.session_key) AS coverage_meeting_key,
    sc.meeting_key,
    sc.year,
    COALESCE(
      NULLIF(BTRIM(sc.meeting_name), ''),
      NULLIF(BTRIM(sc.location), ''),
      NULLIF(BTRIM(sc.country_name), ''),
      CONCAT('session_', sc.session_key::TEXT)
    ) AS weekend_label,
    sc.date_start,
    sc.normalized_session_type,
    sc.is_future_session,
    sc.is_placeholder,
    sc.has_core_analysis_pack,
    sc.completeness_score
  FROM core.session_completeness sc
),
rollup AS (
  SELECT
    coverage_meeting_key,
    meeting_key,
    year,
    weekend_label,
    MIN(date_start) AS weekend_start,
    MAX(date_start) AS weekend_end,
    COUNT(*)::INTEGER AS total_sessions,
    COUNT(*) FILTER (WHERE normalized_session_type = 'Practice')::INTEGER AS practice_sessions,
    COUNT(*) FILTER (WHERE normalized_session_type = 'Qualifying')::INTEGER AS qualifying_sessions,
    COUNT(*) FILTER (WHERE normalized_session_type = 'Sprint Qualifying')::INTEGER AS sprint_qualifying_sessions,
    COUNT(*) FILTER (WHERE normalized_session_type = 'Sprint')::INTEGER AS sprint_sessions,
    COUNT(*) FILTER (WHERE normalized_session_type = 'Race')::INTEGER AS race_sessions,
    COUNT(*) FILTER (WHERE is_future_session)::INTEGER AS future_sessions,
    COUNT(*) FILTER (WHERE is_placeholder)::INTEGER AS placeholder_sessions,
    COUNT(*) FILTER (WHERE has_core_analysis_pack)::INTEGER AS analytic_ready_sessions,
    ROUND(AVG(completeness_score)::numeric, 2) AS avg_completeness_score,
    ARRAY_AGG(DISTINCT normalized_session_type ORDER BY normalized_session_type) AS session_types_present
  FROM session_rows
  GROUP BY coverage_meeting_key, meeting_key, year, weekend_label
)
SELECT
  r.coverage_meeting_key,
  r.meeting_key,
  r.year,
  r.weekend_label,
  r.weekend_start,
  r.weekend_end,
  r.total_sessions,
  r.practice_sessions,
  r.qualifying_sessions,
  r.sprint_qualifying_sessions,
  r.sprint_sessions,
  r.race_sessions,
  r.future_sessions,
  r.placeholder_sessions,
  r.analytic_ready_sessions,
  r.avg_completeness_score,
  r.session_types_present,
  CASE
    WHEN r.future_sessions = r.total_sessions AND r.placeholder_sessions = r.total_sessions THEN 'future_placeholder_weekend'
    WHEN r.analytic_ready_sessions = r.total_sessions AND r.total_sessions > 0 THEN 'fully_loaded'
    WHEN r.analytic_ready_sessions > 0 THEN 'partially_loaded'
    WHEN r.placeholder_sessions > 0 THEN 'placeholder_only'
    ELSE 'metadata_only'
  END AS weekend_status
FROM rollup r;

-- Weekend/session expectation audit contract driven by explicit governance rules.
CREATE OR REPLACE VIEW core.weekend_session_expectation_audit AS
WITH weekend_base AS (
  SELECT
    w.coverage_meeting_key,
    w.meeting_key,
    w.year,
    w.weekend_label,
    w.weekend_start,
    w.weekend_end,
    w.weekend_status,
    w.total_sessions,
    w.practice_sessions,
    w.qualifying_sessions,
    w.sprint_qualifying_sessions,
    w.sprint_sessions,
    w.race_sessions,
    CASE
      WHEN w.sprint_sessions > 0 OR w.sprint_qualifying_sessions > 0 THEN 'sprint'
      ELSE 'standard'
    END AS inferred_weekend_format
  FROM core.weekend_session_coverage w
),
expanded AS (
  SELECT
    wb.coverage_meeting_key,
    wb.meeting_key,
    wb.year,
    wb.weekend_label,
    wb.weekend_start,
    wb.weekend_end,
    wb.weekend_status,
    wb.inferred_weekend_format,
    r.expected_session_type,
    r.min_expected_count,
    r.max_expected_count,
    r.notes AS expectation_notes,
    CASE r.expected_session_type
      WHEN 'Practice' THEN wb.practice_sessions
      WHEN 'Qualifying' THEN wb.qualifying_sessions
      WHEN 'Sprint Qualifying' THEN wb.sprint_qualifying_sessions
      WHEN 'Sprint' THEN wb.sprint_sessions
      WHEN 'Race' THEN wb.race_sessions
      ELSE 0
    END AS observed_count
  FROM weekend_base wb
  JOIN core.weekend_session_expectation_rules r
    ON r.weekend_format = wb.inferred_weekend_format
   AND (r.active_from_year IS NULL OR wb.year >= r.active_from_year)
   AND (r.active_to_year IS NULL OR wb.year <= r.active_to_year)
)
SELECT
  e.coverage_meeting_key,
  e.meeting_key,
  e.year,
  e.weekend_label,
  e.weekend_start,
  e.weekend_end,
  e.weekend_status,
  e.inferred_weekend_format,
  e.expected_session_type,
  e.min_expected_count,
  e.max_expected_count,
  e.observed_count,
  (e.observed_count - e.min_expected_count) AS expectation_gap_from_min,
  e.expectation_notes,
  CASE
    WHEN e.observed_count < e.min_expected_count THEN 'missing'
    WHEN e.observed_count > e.max_expected_count THEN 'overfilled'
    ELSE 'meets'
  END AS expectation_status
FROM expanded e;

-- Unified anomaly tracking surface for known data/source-quality issues.
CREATE OR REPLACE VIEW core.source_anomaly_tracking AS
WITH manual_entries AS (
  SELECT
    m.anomaly_id,
    m.anomaly_type,
    m.severity,
    m.subsystem,
    m.status,
    m.year,
    m.session_key,
    m.meeting_key,
    m.driver_number,
    m.entity_label,
    m.symptom,
    m.details,
    m.evidence_ref,
    m.source_system,
    m.reported_at AS detected_at,
    m.updated_at,
    'manual'::TEXT AS anomaly_source
  FROM core.source_anomaly_manual m
),
missing_meeting_name AS (
  SELECT
    CONCAT('missing_meeting_name:', sc.session_key::TEXT) AS anomaly_id,
    'missing_meeting_name'::TEXT AS anomaly_type,
    CASE WHEN sc.is_future_session THEN 'low' ELSE 'high' END AS severity,
    'session_metadata'::TEXT AS subsystem,
    'open'::TEXT AS status,
    sc.year,
    sc.session_key,
    sc.meeting_key,
    NULL::INTEGER AS driver_number,
    CONCAT(
      COALESCE(NULLIF(BTRIM(sc.location), ''), NULLIF(BTRIM(sc.country_name), ''), CONCAT('session_', sc.session_key::TEXT)),
      ' / ',
      COALESCE(NULLIF(BTRIM(sc.session_name), ''), 'unknown_session')
    ) AS entity_label,
    'meeting_name is missing for this session.'::TEXT AS symptom,
    CONCAT('completeness_status=', sc.completeness_status, ', placeholder=', sc.is_placeholder::TEXT) AS details,
    'core.session_completeness'::TEXT AS evidence_ref,
    'openf1'::TEXT AS source_system,
    sc.date_start AS detected_at,
    NULL::TIMESTAMPTZ AS updated_at,
    'auto'::TEXT AS anomaly_source
  FROM core.session_completeness sc
  WHERE sc.has_meeting_name = FALSE
),
partial_sessions AS (
  SELECT
    CONCAT('partial_session:', sc.session_key::TEXT) AS anomaly_id,
    'partial_session'::TEXT AS anomaly_type,
    'medium'::TEXT AS severity,
    'session_completeness'::TEXT AS subsystem,
    'open'::TEXT AS status,
    sc.year,
    sc.session_key,
    sc.meeting_key,
    NULL::INTEGER AS driver_number,
    CONCAT(
      COALESCE(NULLIF(BTRIM(sc.location), ''), NULLIF(BTRIM(sc.country_name), ''), CONCAT('session_', sc.session_key::TEXT)),
      ' / ',
      COALESCE(NULLIF(BTRIM(sc.session_name), ''), 'unknown_session')
    ) AS entity_label,
    'Session is partially loaded for analytics contracts.'::TEXT AS symptom,
    CONCAT(
      'score=', sc.completeness_score::TEXT,
      ', has_laps=', sc.has_laps::TEXT,
      ', has_car_data=', sc.has_car_data::TEXT,
      ', has_pit=', sc.has_pit::TEXT
    ) AS details,
    'core.session_completeness'::TEXT AS evidence_ref,
    'openf1'::TEXT AS source_system,
    sc.date_start AS detected_at,
    NULL::TIMESTAMPTZ AS updated_at,
    'auto'::TEXT AS anomaly_source
  FROM core.session_completeness sc
  WHERE sc.completeness_status = 'partially_loaded'
    AND sc.is_future_session = FALSE
),
driver_number_name_conflicts AS (
  SELECT
    CONCAT('driver_number_name_conflict:', c.driver_number::TEXT) AS anomaly_id,
    'driver_number_name_conflict'::TEXT AS anomaly_type,
    'high'::TEXT AS severity,
    'driver_identity'::TEXT AS subsystem,
    'open'::TEXT AS status,
    c.max_year AS year,
    NULL::BIGINT AS session_key,
    NULL::BIGINT AS meeting_key,
    c.driver_number,
    CONCAT('driver_number_', c.driver_number::TEXT) AS entity_label,
    'A single driver_number maps to multiple full_name values.'::TEXT AS symptom,
    CONCAT('full_names=', ARRAY_TO_STRING(c.full_names, ' | ')) AS details,
    'raw.drivers'::TEXT AS evidence_ref,
    'openf1'::TEXT AS source_system,
    c.last_seen_at AS detected_at,
    NULL::TIMESTAMPTZ AS updated_at,
    'auto'::TEXT AS anomaly_source
  FROM (
    SELECT
      d.driver_number,
      MIN(s.year) FILTER (WHERE s.year IS NOT NULL) AS min_year,
      MAX(s.year) FILTER (WHERE s.year IS NOT NULL) AS max_year,
      ARRAY_REMOVE(
        ARRAY_AGG(DISTINCT NULLIF(BTRIM(d.full_name), '') ORDER BY NULLIF(BTRIM(d.full_name), '')),
        NULL
      ) AS full_names,
      MAX(d.ingested_at) AS last_seen_at
    FROM raw.drivers d
    LEFT JOIN raw.sessions s
      ON s.session_key = d.session_key
    WHERE d.driver_number IS NOT NULL
      AND d.full_name IS NOT NULL
      AND BTRIM(d.full_name) <> ''
    GROUP BY d.driver_number
    HAVING COUNT(DISTINCT LOWER(BTRIM(d.full_name))) > 1
  ) c
),
driver_name_number_conflicts AS (
  SELECT
    CONCAT('driver_name_number_conflict:', REPLACE(c.normalized_full_name, ' ', '_')) AS anomaly_id,
    'driver_name_number_conflict'::TEXT AS anomaly_type,
    'medium'::TEXT AS severity,
    'driver_identity'::TEXT AS subsystem,
    'open'::TEXT AS status,
    c.max_year AS year,
    NULL::BIGINT AS session_key,
    NULL::BIGINT AS meeting_key,
    NULL::INTEGER AS driver_number,
    c.full_name AS entity_label,
    'A single full_name maps to multiple driver_number values.'::TEXT AS symptom,
    CONCAT('driver_numbers=', ARRAY_TO_STRING(c.driver_numbers, ', ')) AS details,
    'raw.drivers'::TEXT AS evidence_ref,
    'openf1'::TEXT AS source_system,
    c.last_seen_at AS detected_at,
    NULL::TIMESTAMPTZ AS updated_at,
    'auto'::TEXT AS anomaly_source
  FROM (
    SELECT
      LOWER(BTRIM(d.full_name)) AS normalized_full_name,
      MAX(NULLIF(BTRIM(d.full_name), '')) AS full_name,
      MIN(s.year) FILTER (WHERE s.year IS NOT NULL) AS min_year,
      MAX(s.year) FILTER (WHERE s.year IS NOT NULL) AS max_year,
      ARRAY_REMOVE(
        ARRAY_AGG(DISTINCT d.driver_number ORDER BY d.driver_number),
        NULL
      ) AS driver_numbers,
      MAX(d.ingested_at) AS last_seen_at
    FROM raw.drivers d
    LEFT JOIN raw.sessions s
      ON s.session_key = d.session_key
    WHERE d.driver_number IS NOT NULL
      AND d.full_name IS NOT NULL
      AND BTRIM(d.full_name) <> ''
    GROUP BY LOWER(BTRIM(d.full_name))
    HAVING COUNT(DISTINCT d.driver_number) > 1
  ) c
),
driver_team_conflicts AS (
  SELECT
    CONCAT('driver_team_conflict:', c.year::TEXT, ':', c.driver_number::TEXT) AS anomaly_id,
    'driver_team_conflict'::TEXT AS anomaly_type,
    'low'::TEXT AS severity,
    'driver_identity'::TEXT AS subsystem,
    'open'::TEXT AS status,
    c.year,
    NULL::BIGINT AS session_key,
    NULL::BIGINT AS meeting_key,
    c.driver_number,
    CONCAT('driver_number_', c.driver_number::TEXT, '_year_', c.year::TEXT) AS entity_label,
    'Driver has multiple team_name mappings within one season.'::TEXT AS symptom,
    CONCAT('team_names=', ARRAY_TO_STRING(c.team_names, ' | ')) AS details,
    'raw.drivers + raw.sessions'::TEXT AS evidence_ref,
    'openf1'::TEXT AS source_system,
    c.last_seen_at AS detected_at,
    NULL::TIMESTAMPTZ AS updated_at,
    'auto'::TEXT AS anomaly_source
  FROM (
    SELECT
      s.year,
      d.driver_number,
      ARRAY_REMOVE(
        ARRAY_AGG(DISTINCT NULLIF(BTRIM(d.team_name), '') ORDER BY NULLIF(BTRIM(d.team_name), '')),
        NULL
      ) AS team_names,
      MAX(d.ingested_at) AS last_seen_at
    FROM raw.drivers d
    JOIN raw.sessions s
      ON s.session_key = d.session_key
    WHERE d.driver_number IS NOT NULL
      AND d.team_name IS NOT NULL
      AND BTRIM(d.team_name) <> ''
      AND s.year IS NOT NULL
    GROUP BY s.year, d.driver_number
    HAVING COUNT(DISTINCT LOWER(BTRIM(d.team_name))) > 1
  ) c
),
weekend_expectation_mismatches AS (
  SELECT
    CONCAT('weekend_expectation:', wea.coverage_meeting_key::TEXT, ':', REPLACE(LOWER(wea.expected_session_type), ' ', '_')) AS anomaly_id,
    'weekend_expectation_mismatch'::TEXT AS anomaly_type,
    CASE WHEN wea.weekend_status = 'fully_loaded' THEN 'medium' ELSE 'low' END AS severity,
    'weekend_governance'::TEXT AS subsystem,
    'open'::TEXT AS status,
    wea.year,
    NULL::BIGINT AS session_key,
    wea.meeting_key,
    NULL::INTEGER AS driver_number,
    wea.weekend_label AS entity_label,
    'Observed weekend sessions do not satisfy configured expectation rules.'::TEXT AS symptom,
    CONCAT(
      'expected=', wea.expected_session_type,
      ' min=', wea.min_expected_count::TEXT,
      ' max=', wea.max_expected_count::TEXT,
      ' observed=', wea.observed_count::TEXT,
      ' status=', wea.expectation_status
    ) AS details,
    'core.weekend_session_expectation_audit'::TEXT AS evidence_ref,
    'openf1'::TEXT AS source_system,
    wea.weekend_end AS detected_at,
    NULL::TIMESTAMPTZ AS updated_at,
    'auto'::TEXT AS anomaly_source
  FROM core.weekend_session_expectation_audit wea
  WHERE wea.expectation_status <> 'meets'
    AND wea.weekend_status NOT IN ('future_placeholder_weekend')
)
SELECT * FROM manual_entries
UNION ALL
SELECT * FROM missing_meeting_name
UNION ALL
SELECT * FROM partial_sessions
UNION ALL
SELECT * FROM driver_number_name_conflicts
UNION ALL
SELECT * FROM driver_name_number_conflicts
UNION ALL
SELECT * FROM driver_team_conflicts
UNION ALL
SELECT * FROM weekend_expectation_mismatches;

COMMIT;
