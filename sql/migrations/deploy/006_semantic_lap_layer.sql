BEGIN;

-- Compound normalization contract used by semantic lap logic.
CREATE TABLE IF NOT EXISTS core.compound_alias_lookup (
  raw_compound TEXT PRIMARY KEY,
  normalized_compound TEXT NOT NULL,
  compound_group TEXT NOT NULL CHECK (compound_group IN ('slick', 'intermediate', 'wet', 'unknown')),
  is_slick BOOLEAN NOT NULL,
  valid_from_year INTEGER,
  valid_to_year INTEGER,
  source_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO core.compound_alias_lookup (
  raw_compound,
  normalized_compound,
  compound_group,
  is_slick,
  valid_from_year,
  valid_to_year,
  source_note
)
VALUES
  ('SOFT', 'SOFT', 'slick', TRUE, NULL, NULL, 'Canonical slick alias'),
  ('MEDIUM', 'MEDIUM', 'slick', TRUE, NULL, NULL, 'Canonical slick alias'),
  ('HARD', 'HARD', 'slick', TRUE, NULL, NULL, 'Canonical slick alias'),
  ('C0', 'HARD', 'slick', TRUE, NULL, NULL, 'Legacy hard-scale alias'),
  ('C1', 'HARD', 'slick', TRUE, NULL, NULL, 'Pirelli range alias'),
  ('C2', 'MEDIUM', 'slick', TRUE, NULL, NULL, 'Pirelli range alias'),
  ('C3', 'MEDIUM', 'slick', TRUE, NULL, NULL, 'Pirelli range alias'),
  ('C4', 'SOFT', 'slick', TRUE, NULL, NULL, 'Pirelli range alias'),
  ('C5', 'SOFT', 'slick', TRUE, NULL, NULL, 'Pirelli range alias'),
  ('C6', 'SOFT', 'slick', TRUE, NULL, NULL, 'Pirelli range alias'),
  ('INTERMEDIATE', 'INTERMEDIATE', 'intermediate', FALSE, NULL, NULL, 'Wet tyre family'),
  ('WET', 'WET', 'wet', FALSE, NULL, NULL, 'Wet tyre family'),
  ('UNKNOWN', 'UNKNOWN', 'unknown', FALSE, NULL, NULL, 'Fallback normalization')
ON CONFLICT (raw_compound) DO UPDATE
SET
  normalized_compound = EXCLUDED.normalized_compound,
  compound_group = EXCLUDED.compound_group,
  is_slick = EXCLUDED.is_slick,
  valid_from_year = EXCLUDED.valid_from_year,
  valid_to_year = EXCLUDED.valid_to_year,
  source_note = EXCLUDED.source_note,
  updated_at = NOW();

-- Versioned lap-validity policy object.
CREATE TABLE IF NOT EXISTS core.valid_lap_policy (
  policy_key TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  policy_name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  min_lap_seconds DOUBLE PRECISION NOT NULL DEFAULT 50,
  max_lap_seconds DOUBLE PRECISION NOT NULL DEFAULT 200,
  exclude_pit_out_laps BOOLEAN NOT NULL DEFAULT TRUE,
  exclude_pit_in_laps BOOLEAN NOT NULL DEFAULT TRUE,
  require_sector_data BOOLEAN NOT NULL DEFAULT TRUE,
  require_known_compound BOOLEAN NOT NULL DEFAULT TRUE,
  require_slick_compound BOOLEAN NOT NULL DEFAULT TRUE,
  fuel_seconds_per_lap DOUBLE PRECISION NOT NULL DEFAULT 0.03,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (policy_key, policy_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_valid_lap_policy_default
  ON core.valid_lap_policy (is_default)
  WHERE is_default;

INSERT INTO core.valid_lap_policy (
  policy_key,
  policy_version,
  policy_name,
  is_default,
  min_lap_seconds,
  max_lap_seconds,
  exclude_pit_out_laps,
  exclude_pit_in_laps,
  require_sector_data,
  require_known_compound,
  require_slick_compound,
  fuel_seconds_per_lap,
  notes
)
VALUES (
  'openf1_semantic',
  1,
  'OpenF1 Semantic Valid Lap v1',
  TRUE,
  50,
  200,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  0.03,
  'Approximation policy aligned to helper-repo portability guidance. Strict FastF1 IsAccurate parity is not available yet.'
)
ON CONFLICT (policy_key, policy_version) DO UPDATE
SET
  policy_name = EXCLUDED.policy_name,
  is_default = EXCLUDED.is_default,
  min_lap_seconds = EXCLUDED.min_lap_seconds,
  max_lap_seconds = EXCLUDED.max_lap_seconds,
  exclude_pit_out_laps = EXCLUDED.exclude_pit_out_laps,
  exclude_pit_in_laps = EXCLUDED.exclude_pit_in_laps,
  require_sector_data = EXCLUDED.require_sector_data,
  require_known_compound = EXCLUDED.require_known_compound,
  require_slick_compound = EXCLUDED.require_slick_compound,
  fuel_seconds_per_lap = EXCLUDED.fuel_seconds_per_lap,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Canonical metric registry for semantic-layer discoverability.
CREATE TABLE IF NOT EXISTS core.metric_registry (
  metric_key TEXT PRIMARY KEY,
  metric_name TEXT NOT NULL,
  metric_category TEXT NOT NULL,
  layer_name TEXT NOT NULL,
  grain TEXT NOT NULL,
  metric_status TEXT NOT NULL CHECK (metric_status IN ('stable', 'experimental', 'draft')),
  definition TEXT,
  source_relation TEXT,
  source_columns TEXT,
  expression_hint TEXT,
  owner TEXT NOT NULL DEFAULT 'openf1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO core.metric_registry (
  metric_key,
  metric_name,
  metric_category,
  layer_name,
  grain,
  metric_status,
  definition,
  source_relation,
  source_columns,
  expression_hint
)
VALUES
  ('lap_duration', 'Lap Duration', 'lap_pace', 'core.laps_enriched', 'session,driver,lap', 'stable', 'Raw lap duration in seconds.', 'raw.laps', 'lap_duration', 'Direct mapping from raw lap row.'),
  ('is_valid', 'Valid Lap Flag', 'lap_hygiene', 'core.laps_enriched', 'session,driver,lap', 'stable', 'Policy-based validity flag for clean-lap analytics.', 'core.laps_enriched', 'is_valid', 'Computed from default row in core.valid_lap_policy.'),
  ('is_slick', 'Slick Compound Flag', 'compound', 'core.laps_enriched', 'session,driver,lap', 'stable', 'True when normalized compound belongs to slick family.', 'core.compound_alias_lookup', 'is_slick', 'Derived by joining stint compound to compound_alias_lookup.'),
  ('delta_to_rep', 'Delta To Session Representative', 'lap_pace', 'core.laps_enriched', 'session,driver,lap', 'stable', 'Lap time minus session representative valid lap.', 'core.laps_enriched', 'delta_to_rep', 'lap_duration - rep_lap_session'),
  ('pct_from_rep', 'Percent From Session Representative', 'lap_pace', 'core.laps_enriched', 'session,driver,lap', 'stable', 'Percentage delta versus session representative valid lap.', 'core.laps_enriched', 'pct_from_rep', '100 * delta_to_rep / rep_lap_session'),
  ('delta_to_fastest', 'Delta To Session Fastest', 'lap_pace', 'core.laps_enriched', 'session,driver,lap', 'stable', 'Lap time minus fastest valid lap in session.', 'core.laps_enriched', 'delta_to_fastest', 'lap_duration - fastest_valid_lap'),
  ('pct_from_fastest', 'Percent From Session Fastest', 'lap_pace', 'core.laps_enriched', 'session,driver,lap', 'stable', 'Percentage delta versus fastest valid lap in session.', 'core.laps_enriched', 'pct_from_fastest', '100 * delta_to_fastest / fastest_valid_lap'),
  ('delta_to_lap_rep', 'Delta To Lap-Number Representative', 'lap_pace', 'core.laps_enriched', 'session,driver,lap', 'stable', 'Lap time minus median valid lap at same lap number.', 'core.laps_enriched', 'delta_to_lap_rep', 'lap_duration - lap_rep_time'),
  ('pct_from_lap_rep', 'Percent From Lap-Number Representative', 'lap_pace', 'core.laps_enriched', 'session,driver,lap', 'stable', 'Percentage delta versus lap-number representative pace.', 'core.laps_enriched', 'pct_from_lap_rep', '100 * delta_to_lap_rep / lap_rep_time'),
  ('fuel_adj_lap_time', 'Fuel-Adjusted Lap Time', 'lap_pace', 'core.laps_enriched', 'session,driver,lap', 'experimental', 'Heuristic fuel-normalized lap time.', 'core.laps_enriched', 'fuel_adj_lap_time', 'lap_duration - ((max_lap - lap_number) * fuel_seconds_per_lap)'),
  ('position_end_of_lap', 'Position At Lap End', 'race_progression', 'core.laps_enriched', 'session,driver,lap', 'stable', 'Estimated race position at end of lap window.', 'raw.position_history', 'position', 'Latest position history record within lap time window.')
ON CONFLICT (metric_key) DO UPDATE
SET
  metric_name = EXCLUDED.metric_name,
  metric_category = EXCLUDED.metric_category,
  layer_name = EXCLUDED.layer_name,
  grain = EXCLUDED.grain,
  metric_status = EXCLUDED.metric_status,
  definition = EXCLUDED.definition,
  source_relation = EXCLUDED.source_relation,
  source_columns = EXCLUDED.source_columns,
  expression_hint = EXCLUDED.expression_hint,
  updated_at = NOW();

-- Cross-table bridge for semantic lap modeling.
CREATE OR REPLACE VIEW core.lap_semantic_bridge AS
WITH lap_base AS (
  SELECT
    l.session_key,
    l.meeting_key,
    s.year,
    s.session_name,
    s.session_type,
    s.country_name,
    s.location,
    s.circuit_short_name,
    s.date_start AS session_date_start,
    l.driver_number,
    d.full_name AS driver_name,
    d.team_name,
    l.lap_number,
    l.lap_duration,
    l.duration_sector_1,
    l.duration_sector_2,
    l.duration_sector_3,
    l.is_pit_out_lap,
    l.date_start AS lap_start_ts,
    (l.date_start + (COALESCE(NULLIF(l.lap_duration, 0), 120) * INTERVAL '1 second')) AS lap_end_ts,
    st.stint_number,
    st.compound AS compound_raw,
    ca.normalized_compound,
    COALESCE(ca.is_slick, FALSE) AS is_slick,
    st.tyre_age_at_start,
    CASE
      WHEN st.lap_start IS NULL OR l.lap_number IS NULL THEN NULL
      ELSE COALESCE(st.tyre_age_at_start, 0) + (l.lap_number - st.lap_start)
    END AS tyre_age_on_lap,
    p.pit_duration,
    (p.id IS NOT NULL) AS is_pit_lap
  FROM raw.laps l
  JOIN raw.sessions s
    ON s.session_key = l.session_key
  LEFT JOIN raw.drivers d
    ON d.session_key = l.session_key
   AND d.driver_number = l.driver_number
  LEFT JOIN raw.stints st
    ON st.session_key = l.session_key
   AND st.driver_number = l.driver_number
   AND l.lap_number BETWEEN st.lap_start AND st.lap_end
  LEFT JOIN core.compound_alias_lookup ca
    ON UPPER(BTRIM(COALESCE(st.compound, 'UNKNOWN'))) = ca.raw_compound
  LEFT JOIN raw.pit p
    ON p.session_key = l.session_key
   AND p.driver_number = l.driver_number
   AND p.lap_number = l.lap_number
),
lap_with_position AS (
  SELECT
    b.*,
    ph.position AS position_end_of_lap
  FROM lap_base b
  LEFT JOIN LATERAL (
    SELECT ph.position
    FROM raw.position_history ph
    WHERE ph.session_key = b.session_key
      AND ph.driver_number = b.driver_number
      AND b.lap_start_ts IS NOT NULL
      AND ph.date >= b.lap_start_ts
      AND ph.date < b.lap_end_ts
    ORDER BY ph.date DESC
    LIMIT 1
  ) ph ON TRUE
),
lap_with_flag AS (
  SELECT
    b.*,
    rc.flag AS track_flag
  FROM lap_with_position b
  LEFT JOIN LATERAL (
    SELECT rc.flag
    FROM raw.race_control rc
    WHERE rc.session_key = b.session_key
      AND rc.date <= COALESCE(b.lap_end_ts, b.lap_start_ts, b.session_date_start)
    ORDER BY rc.date DESC
    LIMIT 1
  ) rc ON TRUE
)
SELECT
  b.*,
  MIN(b.lap_duration) FILTER (
    WHERE b.lap_duration > 0
      AND COALESCE(b.is_pit_out_lap, FALSE) = FALSE
  ) OVER (PARTITION BY b.session_key, b.driver_number) AS best_driver_lap,
  (
    b.lap_duration IS NOT NULL
    AND b.lap_duration > 0
    AND b.lap_duration = MIN(b.lap_duration) FILTER (
      WHERE b.lap_duration > 0
        AND COALESCE(b.is_pit_out_lap, FALSE) = FALSE
    ) OVER (PARTITION BY b.session_key, b.driver_number)
  ) AS is_personal_best_proxy
FROM lap_with_flag b;

-- Main transformed-lap semantic contract.
CREATE OR REPLACE VIEW core.laps_enriched AS
WITH default_policy AS (
  SELECT
    policy_key,
    policy_version,
    min_lap_seconds,
    max_lap_seconds,
    exclude_pit_out_laps,
    exclude_pit_in_laps,
    require_sector_data,
    require_known_compound,
    require_slick_compound,
    fuel_seconds_per_lap
  FROM core.valid_lap_policy
  WHERE is_default
  ORDER BY policy_version DESC
  LIMIT 1
),
policy AS (
  SELECT * FROM default_policy
  UNION ALL
  SELECT
    'openf1_semantic'::TEXT AS policy_key,
    1::INTEGER AS policy_version,
    50::DOUBLE PRECISION AS min_lap_seconds,
    200::DOUBLE PRECISION AS max_lap_seconds,
    TRUE::BOOLEAN AS exclude_pit_out_laps,
    TRUE::BOOLEAN AS exclude_pit_in_laps,
    TRUE::BOOLEAN AS require_sector_data,
    TRUE::BOOLEAN AS require_known_compound,
    TRUE::BOOLEAN AS require_slick_compound,
    0.03::DOUBLE PRECISION AS fuel_seconds_per_lap
  WHERE NOT EXISTS (SELECT 1 FROM default_policy)
),
candidate AS (
  SELECT
    b.*,
    p.policy_key,
    p.policy_version,
    p.fuel_seconds_per_lap,
    (
      b.duration_sector_1 IS NOT NULL AND b.duration_sector_1 > 0
      AND b.duration_sector_2 IS NOT NULL AND b.duration_sector_2 > 0
      AND b.duration_sector_3 IS NOT NULL AND b.duration_sector_3 > 0
    ) AS has_sector_data,
    (
      b.lap_duration IS NOT NULL
      AND b.lap_duration BETWEEN p.min_lap_seconds AND p.max_lap_seconds
      AND (NOT p.exclude_pit_out_laps OR COALESCE(b.is_pit_out_lap, FALSE) = FALSE)
      AND (NOT p.exclude_pit_in_laps OR COALESCE(b.is_pit_lap, FALSE) = FALSE)
      AND (NOT p.require_sector_data OR (
        b.duration_sector_1 IS NOT NULL AND b.duration_sector_1 > 0
        AND b.duration_sector_2 IS NOT NULL AND b.duration_sector_2 > 0
        AND b.duration_sector_3 IS NOT NULL AND b.duration_sector_3 > 0
      ))
      AND (NOT p.require_known_compound OR b.normalized_compound IS NOT NULL)
      AND (NOT p.require_slick_compound OR COALESCE(b.is_slick, FALSE))
    ) AS is_valid
  FROM core.lap_semantic_bridge b
  CROSS JOIN policy p
),
session_stats AS (
  SELECT
    session_key,
    MIN(lap_duration) AS fastest_valid_lap,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY lap_duration) AS rep_lap_session
  FROM candidate
  WHERE is_valid
  GROUP BY session_key
),
lap_number_stats AS (
  SELECT
    session_key,
    lap_number,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY lap_duration) AS lap_rep_time
  FROM candidate
  WHERE is_valid
    AND COALESCE(is_pit_out_lap, FALSE) = FALSE
    AND COALESCE(is_pit_lap, FALSE) = FALSE
  GROUP BY session_key, lap_number
),
session_extent AS (
  SELECT session_key, MAX(lap_number) AS max_lap_number
  FROM candidate
  GROUP BY session_key
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
  c.driver_number,
  c.driver_name,
  c.team_name,
  c.lap_number,
  c.lap_start_ts,
  c.lap_end_ts,
  c.lap_duration,
  c.duration_sector_1,
  c.duration_sector_2,
  c.duration_sector_3,
  c.stint_number,
  c.compound_raw,
  COALESCE(c.normalized_compound, 'UNKNOWN') AS compound_name,
  c.is_slick,
  c.tyre_age_at_start,
  c.tyre_age_on_lap,
  c.is_pit_out_lap,
  c.is_pit_lap,
  c.pit_duration,
  c.position_end_of_lap,
  c.track_flag,
  c.is_personal_best_proxy,
  c.policy_key AS validity_policy_key,
  c.policy_version AS validity_rule_version,
  c.is_valid,
  NULLIF(
    CONCAT_WS(
      ';',
      CASE WHEN c.lap_duration IS NULL OR c.lap_duration <= 0 THEN 'missing_or_nonpositive_lap_duration' END,
      CASE WHEN c.lap_duration IS NOT NULL AND (c.lap_duration < 50 OR c.lap_duration > 200) THEN 'duration_out_of_bounds' END,
      CASE WHEN COALESCE(c.is_pit_out_lap, FALSE) THEN 'pit_out_lap' END,
      CASE WHEN COALESCE(c.is_pit_lap, FALSE) THEN 'pit_in_lap' END,
      CASE WHEN c.has_sector_data = FALSE THEN 'missing_sector_data' END,
      CASE WHEN c.normalized_compound IS NULL THEN 'unknown_compound' END,
      CASE WHEN COALESCE(c.is_slick, FALSE) = FALSE THEN 'non_slick_compound' END
    ),
    ''
  ) AS invalid_reason,
  ss.rep_lap_session,
  ss.fastest_valid_lap,
  ln.lap_rep_time,
  CASE
    WHEN ss.rep_lap_session IS NULL OR c.lap_duration IS NULL THEN NULL
    ELSE c.lap_duration - ss.rep_lap_session
  END AS delta_to_rep,
  CASE
    WHEN ss.rep_lap_session IS NULL OR ss.rep_lap_session = 0 OR c.lap_duration IS NULL THEN NULL
    ELSE (100.0 * (c.lap_duration - ss.rep_lap_session) / ss.rep_lap_session)
  END AS pct_from_rep,
  CASE
    WHEN ss.fastest_valid_lap IS NULL OR c.lap_duration IS NULL THEN NULL
    ELSE c.lap_duration - ss.fastest_valid_lap
  END AS delta_to_fastest,
  CASE
    WHEN ss.fastest_valid_lap IS NULL OR ss.fastest_valid_lap = 0 OR c.lap_duration IS NULL THEN NULL
    ELSE (100.0 * (c.lap_duration - ss.fastest_valid_lap) / ss.fastest_valid_lap)
  END AS pct_from_fastest,
  CASE
    WHEN ln.lap_rep_time IS NULL OR c.lap_duration IS NULL THEN NULL
    ELSE c.lap_duration - ln.lap_rep_time
  END AS delta_to_lap_rep,
  CASE
    WHEN ln.lap_rep_time IS NULL OR ln.lap_rep_time = 0 OR c.lap_duration IS NULL THEN NULL
    ELSE (100.0 * (c.lap_duration - ln.lap_rep_time) / ln.lap_rep_time)
  END AS pct_from_lap_rep,
  CASE
    WHEN c.lap_duration IS NULL OR sx.max_lap_number IS NULL THEN NULL
    ELSE c.lap_duration - ((sx.max_lap_number - c.lap_number) * c.fuel_seconds_per_lap)
  END AS fuel_adj_lap_time
FROM candidate c
LEFT JOIN session_stats ss
  ON ss.session_key = c.session_key
LEFT JOIN lap_number_stats ln
  ON ln.session_key = c.session_key
 AND ln.lap_number = c.lap_number
LEFT JOIN session_extent sx
  ON sx.session_key = c.session_key;

-- Replay intermediate contract metadata.
CREATE TABLE IF NOT EXISTS core.replay_contract_registry (
  contract_key TEXT NOT NULL,
  contract_version INTEGER NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  frame_grain TEXT NOT NULL,
  description TEXT,
  payload_shape_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contract_key, contract_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_replay_contract_default
  ON core.replay_contract_registry (is_default)
  WHERE is_default;

INSERT INTO core.replay_contract_registry (
  contract_key,
  contract_version,
  is_default,
  frame_grain,
  description,
  payload_shape_json
)
VALUES (
  'lap_frame',
  1,
  TRUE,
  'session,lap_number',
  'Intermediate replay contract for lap-indexed frames used by telemetry and progression consumers.',
  '{
    "required_fields": [
      "session_key",
      "meeting_key",
      "lap_number",
      "frame_time",
      "leader_driver_number",
      "leader_position",
      "best_valid_lap_on_lap",
      "avg_valid_lap_on_lap",
      "weather_track_temperature",
      "race_control_flag"
    ],
    "notes": "Lap-level contract intended as a stable bridge between warehouse data and replay consumers."
  }'::jsonb
)
ON CONFLICT (contract_key, contract_version) DO UPDATE
SET
  is_default = EXCLUDED.is_default,
  frame_grain = EXCLUDED.frame_grain,
  description = EXCLUDED.description,
  payload_shape_json = EXCLUDED.payload_shape_json,
  updated_at = NOW();

-- Lap-level replay frames derived from semantic lap contract.
CREATE OR REPLACE VIEW core.replay_lap_frames AS
WITH lap_rollup AS (
  SELECT
    le.session_key,
    le.meeting_key,
    le.lap_number,
    MAX(le.lap_end_ts) AS frame_time,
    MIN(le.driver_number) FILTER (WHERE le.position_end_of_lap = 1) AS leader_driver_number,
    1::INTEGER AS leader_position,
    MIN(le.lap_duration) FILTER (WHERE le.is_valid) AS best_valid_lap_on_lap,
    AVG(le.lap_duration) FILTER (WHERE le.is_valid) AS avg_valid_lap_on_lap
  FROM core.laps_enriched le
  GROUP BY le.session_key, le.meeting_key, le.lap_number
),
with_weather AS (
  SELECT
    r.*,
    w.track_temperature AS weather_track_temperature,
    w.air_temperature AS weather_air_temperature
  FROM lap_rollup r
  LEFT JOIN LATERAL (
    SELECT
      w.track_temperature,
      w.air_temperature
    FROM raw.weather w
    WHERE w.session_key = r.session_key
      AND w.date <= r.frame_time
    ORDER BY w.date DESC
    LIMIT 1
  ) w ON TRUE
),
with_flag AS (
  SELECT
    r.*,
    rc.flag AS race_control_flag
  FROM with_weather r
  LEFT JOIN LATERAL (
    SELECT rc.flag
    FROM raw.race_control rc
    WHERE rc.session_key = r.session_key
      AND rc.date <= r.frame_time
    ORDER BY rc.date DESC
    LIMIT 1
  ) rc ON TRUE
)
SELECT * FROM with_flag;

COMMIT;
