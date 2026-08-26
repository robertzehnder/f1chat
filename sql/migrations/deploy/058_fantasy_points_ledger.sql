-- Deploy openf1:058_fantasy_points_ledger to pg
-- requires: 057_fantasy_scoring_rules
--
-- Fantasy R0: the component LEDGER — one row per scored fantasy component
-- per round, for drivers and constructors, computed retroactively from the
-- warehouse and priced from core.fantasy_scoring_rules (057). Every row
-- carries `computable` (exact | proxy) and `source` so downstream training
-- and reconciliation can separate reconstructed-official from estimated
-- points. Components the warehouse CANNOT see (driver_of_the_day, pit
-- stationary-time tiers, world-record bonus) are deliberately ABSENT —
-- never fabricated; the rules table documents them as external.
--
-- Grain: (session_key, entity_type, entity_key, component).
--   entity_type 'driver'      → entity_key = driver_number::text
--   entity_type 'constructor' → entity_key = canonical team name
-- Constructor TOTALS are driver-sums plus constructor rows; summing is the
-- reporting layer's job (analytics.fantasy_points_by_round below).
--
-- Overtakes reuse the inferred on-track pass method from the chat template
-- (lap-end classified-position snapshots, pit-window laps excluded) — a
-- documented ESTIMATE (computable='proxy').

BEGIN;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.fantasy_points_ledger_data AS
WITH scored_sessions AS (
  SELECT s.session_key, s.meeting_key, s.year, s.session_name,
         s.circuit_short_name, s.date_start
  FROM core.sessions s
  WHERE s.session_name IN ('Race', 'Sprint', 'Qualifying')
    AND s.year >= 2023
    AND EXISTS (SELECT 1 FROM raw.session_result sr WHERE sr.session_key = s.session_key)
),
rules AS (
  SELECT season, component, position, points FROM core.fantasy_scoring_rules
),
roster AS (
  SELECT sd.session_key, sd.driver_number,
         MAX(sd.full_name) AS driver_name,
         MAX(sd.team_name) AS team_name
  FROM core.session_drivers sd
  GROUP BY sd.session_key, sd.driver_number
),
results AS (
  SELECT ss.*, sr.driver_number, sr.position, sr.status,
         r.driver_name, r.team_name
  FROM scored_sessions ss
  JOIN raw.session_result sr ON sr.session_key = ss.session_key
  LEFT JOIN roster r ON r.session_key = ss.session_key AND r.driver_number = sr.driver_number
  WHERE sr.driver_number IS NOT NULL
),

-- ── Driver: qualifying position points ─────────────────────────────────
quali_pos AS (
  SELECT res.session_key, res.meeting_key, res.year, res.circuit_short_name,
         res.driver_number, res.driver_name, res.team_name,
         'quali_position'::text AS component,
         res.position::numeric AS quantity, ru.points,
         'exact'::text AS computable, 'raw.session_result'::text AS source
  FROM results res
  JOIN rules ru ON ru.season = res.year AND ru.component = 'quali_position' AND ru.position = res.position
  WHERE res.session_name = 'Qualifying' AND res.position BETWEEN 1 AND 10
),
quali_nc AS (
  SELECT res.session_key, res.meeting_key, res.year, res.circuit_short_name,
         res.driver_number, res.driver_name, res.team_name,
         CASE WHEN res.status = 'DSQ' THEN 'quali_dsq' ELSE 'quali_no_time' END AS component,
         1::numeric AS quantity, ru.points,
         'exact'::text, 'raw.session_result'::text
  FROM results res
  JOIN rules ru ON ru.season = res.year
    AND ru.component = CASE WHEN res.status = 'DSQ' THEN 'quali_dsq' ELSE 'quali_no_time' END
  WHERE res.session_name = 'Qualifying' AND res.position IS NULL
),

-- ── Driver: race + sprint finishing points ─────────────────────────────
finish_pos AS (
  SELECT res.session_key, res.meeting_key, res.year, res.circuit_short_name,
         res.driver_number, res.driver_name, res.team_name,
         CASE WHEN res.session_name = 'Race' THEN 'race_position' ELSE 'sprint_position' END AS component,
         res.position::numeric, ru.points,
         'exact'::text, 'raw.session_result'::text
  FROM results res
  JOIN rules ru ON ru.season = res.year
    AND ru.component = CASE WHEN res.session_name = 'Race' THEN 'race_position' ELSE 'sprint_position' END
    AND ru.position = res.position
  WHERE res.session_name IN ('Race', 'Sprint')
),

-- ── Driver: positions gained/lost (grid → flag, via grid_vs_finish) ────
pos_delta AS (
  SELECT res.session_key, res.meeting_key, res.year, res.circuit_short_name,
         res.driver_number, res.driver_name, res.team_name,
         CASE WHEN res.session_name = 'Race' THEN 'race_positions_delta' ELSE 'sprint_positions_delta' END AS component,
         gvf.positions_gained::numeric AS quantity,
         CASE
           WHEN res.session_name = 'Sprint' AND gvf.positions_gained < 0
             THEN GREATEST(gvf.positions_gained * ru.points, cap.points)
           ELSE gvf.positions_gained * ru.points
         END AS points,
         CASE WHEN gvf.grid_source = 'raw.starting_grid' AND gvf.finish_source = 'raw.session_result'
              THEN 'exact' ELSE 'proxy' END AS computable,
         (COALESCE(gvf.grid_source, 'none') || ' -> ' || COALESCE(gvf.finish_source, 'none'))::text AS source
  FROM results res
  JOIN core.grid_vs_finish gvf
    ON gvf.session_key = res.session_key AND gvf.driver_number = res.driver_number
  JOIN rules ru ON ru.season = res.year
    AND ru.component = CASE WHEN res.session_name = 'Race' THEN 'race_position_delta_per_place' ELSE 'sprint_position_delta_per_place' END
  LEFT JOIN rules cap ON cap.season = res.year AND cap.component = 'sprint_delta_loss_cap'
  WHERE res.session_name IN ('Race', 'Sprint')
    AND gvf.positions_gained IS NOT NULL
),

-- ── Driver: not classified / DSQ penalties ─────────────────────────────
-- Reconciliation finding (2026-08-26): the game penalizes NOT CLASSIFIED,
-- not the DNF flag — a late retiree who covered race distance is
-- classified with a position and scores it normally. position IS NULL is
-- the correct condition (DSQ is charged to the constructor separately).
race_nc AS (
  SELECT res.session_key, res.meeting_key, res.year, res.circuit_short_name,
         res.driver_number, res.driver_name, res.team_name,
         CASE WHEN res.session_name = 'Race' THEN 'race_not_classified' ELSE 'sprint_not_classified' END AS component,
         1::numeric, ru.points,
         'exact'::text, 'raw.session_result'::text
  FROM results res
  JOIN rules ru ON ru.season = res.year
    AND ru.component = CASE WHEN res.session_name = 'Race' THEN 'race_not_classified' ELSE 'sprint_not_classified' END
  WHERE res.session_name IN ('Race', 'Sprint')
    AND res.position IS NULL AND res.status <> 'DSQ'
),

-- ── Driver: fastest valid lap (proxy for the official award) ───────────
fastest_lap AS (
  SELECT DISTINCT ON (le.session_key)
         le.session_key, ss.meeting_key, ss.year, ss.circuit_short_name,
         le.driver_number, r.driver_name, r.team_name,
         CASE WHEN ss.session_name = 'Race' THEN 'race_fastest_lap' ELSE 'sprint_fastest_lap' END AS component,
         1::numeric AS quantity,
         (SELECT ru.points FROM rules ru WHERE ru.season = ss.year
            AND ru.component = CASE WHEN ss.session_name = 'Race' THEN 'race_fastest_lap' ELSE 'sprint_fastest_lap' END) AS points,
         'proxy'::text, 'core.laps_enriched fastest valid lap'::text
  FROM core.laps_enriched le
  JOIN scored_sessions ss ON ss.session_key = le.session_key
  LEFT JOIN roster r ON r.session_key = le.session_key AND r.driver_number = le.driver_number
  WHERE ss.session_name IN ('Race', 'Sprint')
    AND le.is_valid AND le.lap_duration IS NOT NULL
  ORDER BY le.session_key, le.lap_duration ASC
),

-- ── Driver: inferred on-track overtakes (estimate) ─────────────────────
lap_ends AS (
  SELECT le.session_key, le.driver_number, le.lap_number, MAX(le.lap_end_ts) AS lap_end_ts
  FROM core.laps_enriched le
  JOIN scored_sessions ss ON ss.session_key = le.session_key AND ss.session_name IN ('Race', 'Sprint')
  WHERE le.lap_end_ts IS NOT NULL
  GROUP BY le.session_key, le.driver_number, le.lap_number
),
pit_window AS (
  SELECT DISTINCT p.session_key, p.driver_number, w.lap_number
  FROM raw.pit p
  CROSS JOIN LATERAL (VALUES (p.lap_number), (p.lap_number + 1)) AS w(lap_number)
  WHERE p.lap_number IS NOT NULL
),
pos_snap AS (
  SELECT lend.session_key, lend.driver_number, lend.lap_number,
         (SELECT ph.position FROM raw.position_history ph
          WHERE ph.session_key = lend.session_key
            AND ph.driver_number = lend.driver_number
            AND ph.date <= lend.lap_end_ts
          ORDER BY ph.date DESC LIMIT 1) AS position
  FROM lap_ends lend
),
gains AS (
  SELECT cur.session_key, cur.driver_number,
         SUM(GREATEST(prev.position - cur.position, 0)) AS passes
  FROM pos_snap cur
  JOIN pos_snap prev
    ON prev.session_key = cur.session_key
   AND prev.driver_number = cur.driver_number
   AND prev.lap_number = cur.lap_number - 1
  WHERE cur.position IS NOT NULL AND prev.position IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pit_window pw
                    WHERE pw.session_key = cur.session_key
                      AND pw.driver_number = cur.driver_number
                      AND pw.lap_number = cur.lap_number)
  GROUP BY cur.session_key, cur.driver_number
),
overtakes AS (
  SELECT g.session_key, ss.meeting_key, ss.year, ss.circuit_short_name,
         g.driver_number, r.driver_name, r.team_name,
         'race_overtake'::text AS component,
         g.passes::numeric AS quantity,
         g.passes * ru.points AS points,
         'proxy'::text, 'inferred from raw.position_history (pit laps excluded)'::text
  FROM gains g
  JOIN scored_sessions ss ON ss.session_key = g.session_key AND ss.session_name = 'Race'
  JOIN rules ru ON ru.season = ss.year AND ru.component = 'race_overtake'
  LEFT JOIN roster r ON r.session_key = g.session_key AND r.driver_number = g.driver_number
  WHERE g.passes > 0
),

-- ── Constructor: DSQ penalty, Q2/Q3 progression, fastest stop ──────────
dsq_constructor AS (
  -- Both cars can be DSQ'd in one race (it has happened): aggregate per
  -- team so the ledger grain stays unique — quantity carries the count.
  SELECT res.session_key, res.meeting_key, res.year, res.circuit_short_name,
         NULL::int AS driver_number, NULL::text AS driver_name, res.team_name,
         'race_dsq_constructor'::text,
         COUNT(*)::numeric AS quantity,
         COUNT(*) * ru.points AS points,
         'exact'::text, 'raw.session_result'::text
  FROM results res
  JOIN rules ru ON ru.season = res.year AND ru.component = 'race_dsq_constructor'
  WHERE res.session_name = 'Race' AND res.status = 'DSQ' AND res.team_name IS NOT NULL
  GROUP BY res.session_key, res.meeting_key, res.year, res.circuit_short_name,
           res.team_name, ru.points
),
quali_progression AS (
  SELECT res.session_key, res.meeting_key, res.year, res.circuit_short_name,
         NULL::int, NULL::text, res.team_name,
         comp.component,
         comp.quantity, ru.points,
         'proxy'::text, 'progression proxied from final quali classification'::text
  FROM (
    SELECT r2.session_key, r2.meeting_key, r2.year, r2.circuit_short_name, r2.team_name,
           COUNT(*) FILTER (WHERE r2.position <= 15) AS q2_count,
           COUNT(*) FILTER (WHERE r2.position <= 10) AS q3_count
    FROM results r2
    WHERE r2.session_name = 'Qualifying' AND r2.team_name IS NOT NULL
    GROUP BY r2.session_key, r2.meeting_key, r2.year, r2.circuit_short_name, r2.team_name
  ) res
  CROSS JOIN LATERAL (
    VALUES
      (CASE res.q2_count WHEN 0 THEN 'constructor_q2_none' WHEN 1 THEN 'constructor_q2_one' ELSE 'constructor_q2_both' END, res.q2_count::numeric),
      (CASE res.q3_count WHEN 1 THEN 'constructor_q3_one' WHEN 2 THEN 'constructor_q3_both' ELSE NULL END, res.q3_count::numeric)
  ) AS comp(component, quantity)
  JOIN rules ru ON ru.season = res.year AND ru.component = comp.component
  WHERE comp.component IS NOT NULL
),
fastest_stop AS (
  SELECT DISTINCT ON (p.session_key)
         p.session_key, ss.meeting_key, ss.year, ss.circuit_short_name,
         NULL::int, NULL::text, r.team_name,
         'pit_fastest_of_race'::text, 1::numeric,
         (SELECT ru.points FROM rules ru WHERE ru.season = ss.year AND ru.component = 'pit_fastest_of_race'),
         'proxy'::text, 'fastest pit-LANE time in race (stationary time unavailable)'::text
  FROM raw.pit p
  JOIN scored_sessions ss ON ss.session_key = p.session_key AND ss.session_name = 'Race'
  LEFT JOIN roster r ON r.session_key = p.session_key AND r.driver_number = p.driver_number
  WHERE p.pit_duration IS NOT NULL AND r.team_name IS NOT NULL
  ORDER BY p.session_key, p.pit_duration ASC
),

unioned AS (
  SELECT * FROM quali_pos
  UNION ALL SELECT * FROM quali_nc
  UNION ALL SELECT * FROM finish_pos
  UNION ALL SELECT * FROM pos_delta
  UNION ALL SELECT * FROM race_nc
  UNION ALL SELECT * FROM fastest_lap
  UNION ALL SELECT * FROM overtakes
  UNION ALL SELECT * FROM dsq_constructor
  UNION ALL SELECT * FROM quali_progression
  UNION ALL SELECT * FROM fastest_stop
)
SELECT
  u.session_key, u.meeting_key, u.year, u.circuit_short_name,
  CASE WHEN u.driver_number IS NULL THEN 'constructor' ELSE 'driver' END AS entity_type,
  COALESCE(u.driver_number::text, u.team_name) AS entity_key,
  u.driver_number, u.driver_name, u.team_name,
  u.component, u.quantity, u.points, u.computable, u.source
FROM unioned u
WHERE u.points IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fantasy_points_ledger
  ON analytics.fantasy_points_ledger_data (session_key, entity_type, entity_key, component);

CREATE OR REPLACE VIEW analytics.fantasy_points_ledger AS
SELECT * FROM analytics.fantasy_points_ledger_data;

-- Reporting layer: totals per round. Constructor total = its drivers' point
-- sum (race+quali+sprint components) + constructor-specific components.
CREATE OR REPLACE VIEW analytics.fantasy_points_by_round AS
WITH driver_totals AS (
  SELECT meeting_key, year, circuit_short_name, driver_number,
         MAX(driver_name) AS driver_name, MAX(team_name) AS team_name,
         SUM(points) AS points,
         BOOL_AND(computable = 'exact') AS all_exact
  FROM analytics.fantasy_points_ledger
  WHERE entity_type = 'driver'
  GROUP BY meeting_key, year, circuit_short_name, driver_number
),
constructor_extra AS (
  SELECT meeting_key, team_name, SUM(points) AS points,
         BOOL_AND(computable = 'exact') AS all_exact
  FROM analytics.fantasy_points_ledger
  WHERE entity_type = 'constructor'
  GROUP BY meeting_key, team_name
)
SELECT dt.meeting_key, dt.year, dt.circuit_short_name,
       'driver' AS entity_type, dt.driver_number::text AS entity_key,
       dt.driver_name AS entity_name, dt.team_name,
       dt.points, dt.all_exact
FROM driver_totals dt
UNION ALL
SELECT dt.meeting_key, dt.year, dt.circuit_short_name,
       'constructor', dt.team_name, dt.team_name, dt.team_name,
       SUM(dt.points) + COALESCE(MAX(ce.points), 0),
       BOOL_AND(dt.all_exact) AND COALESCE(BOOL_AND(ce.all_exact), TRUE)
FROM driver_totals dt
LEFT JOIN constructor_extra ce
  ON ce.meeting_key = dt.meeting_key AND ce.team_name = dt.team_name
WHERE dt.team_name IS NOT NULL
GROUP BY dt.meeting_key, dt.year, dt.circuit_short_name, dt.team_name;

COMMIT;
