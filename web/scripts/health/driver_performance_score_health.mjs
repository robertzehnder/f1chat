#!/usr/bin/env node
//
// driver_performance_score_health.mjs
//
// Regression gate for analytics.driver_performance_score_data.
// Plan: ../diagnostic/driver_performance_score_data_quality_plan_2026-05-23.md
//
// Runs four protections from §5 (acceptance criteria) of the plan and exits
// non-zero if any one trips:
//
//   A2  — per-axis source-row count vs threshold
//   B1.5 — existence anti-join: source has driver, matview missing populated row
//   B1.6 — full-outer-join staleness: matview_null_source_has_value /
//          matview_populated_source_absent / value_mismatch
//   §5.2 — primary team-mate populate consistency for traffic_handling_axis
//
// Usage:
//   node web/scripts/health/driver_performance_score_health.mjs               # defaults to 2025
//   node web/scripts/health/driver_performance_score_health.mjs --season=2024 # arbitrary season
//
// Env: reads web/.env.local for NEON_DB_* connection details (same pattern
// as web/scripts/phase25_probe_overtakes.mjs).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

async function loadEnv() {
  try {
    const text = await readFile(path.resolve(projectRoot, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch (err) {
    // .env.local may not exist in CI; fall through and rely on injected env.
    if (err.code !== "ENOENT") throw err;
  }
}

function parseArgs(argv) {
  const args = { season: 2025 };
  for (const raw of argv.slice(2)) {
    const m = /^--season=(\d{4})$/.exec(raw);
    if (m) args.season = Number(m[1]);
  }
  if (!Number.isFinite(args.season)) {
    throw new Error(`Invalid --season argument: ${args.season}`);
  }
  return args;
}

// Thresholds — keep aligned with §5.1 of the plan.
const THRESHOLDS = {
  qual_src_drivers: 18,
  race_src_drivers: 18,
  tyre_src_drivers: 18,
  overtake_src_drivers: 15,
  avg_qual_axis: 30,
  avg_pace_axis: 30,
  avg_tyre_axis: 20,
};

// ---------------------------------------------------------------------------
// Check A2 — source-row populated counts vs thresholds.
// ---------------------------------------------------------------------------
async function checkA2(client, season) {
  const sql = `
    WITH season_drivers AS (
      SELECT DISTINCT sd.driver_number
      FROM core.session_drivers sd
      JOIN core.sessions s ON s.session_key = sd.session_key
      WHERE s.year = $1
        AND s.session_name IN ('Race', 'Qualifying', 'Sprint', 'Sprint Qualifying')
    ),
    qual_present     AS (SELECT DISTINCT sg.driver_number FROM raw.starting_grid sg
                          JOIN core.sessions s ON s.session_key = sg.session_key
                          WHERE s.year = $1 AND s.session_name = 'Race' AND sg.grid_position IS NOT NULL),
    race_present     AS (SELECT DISTINCT sr.driver_number FROM raw.session_result sr
                          JOIN core.sessions s ON s.session_key = sr.session_key
                          WHERE s.year = $1 AND s.session_name = 'Race' AND sr.position IS NOT NULL),
    tyre_present     AS (SELECT DISTINCT sdc.driver_number FROM analytics.stint_degradation_curve sdc
                          JOIN core.sessions s ON s.session_key = sdc.session_key
                          WHERE s.year = $1 AND sdc.degradation_per_lap_s IS NOT NULL),
    restart_present  AS (SELECT DISTINCT rp.driver_number FROM analytics.restart_performance rp
                          JOIN core.sessions s ON s.session_key = rp.session_key
                          WHERE s.year = $1 AND rp.position_delta IS NOT NULL),
    traffic_present  AS (SELECT DISTINCT tap.driver_number FROM analytics.traffic_adjusted_pace tap
                          JOIN core.sessions s ON s.session_key = tap.session_key
                          WHERE s.year = $1 AND tap.traffic_pace_delta_s IS NOT NULL),
    overtake_present AS (SELECT DISTINCT oe.overtaking_driver_number AS driver_number FROM analytics.overtake_events oe
                          JOIN core.sessions s ON s.session_key = oe.session_key
                          WHERE s.year = $1)
    SELECT
      COUNT(DISTINCT sd.driver_number)                                              AS total_drivers,
      COUNT(DISTINCT sd.driver_number) FILTER (WHERE qp.driver_number  IS NOT NULL) AS qual_src_drivers,
      COUNT(DISTINCT sd.driver_number) FILTER (WHERE rp.driver_number  IS NOT NULL) AS race_src_drivers,
      COUNT(DISTINCT sd.driver_number) FILTER (WHERE tp.driver_number  IS NOT NULL) AS tyre_src_drivers,
      COUNT(DISTINCT sd.driver_number) FILTER (WHERE rsp.driver_number IS NOT NULL) AS restart_src_drivers,
      COUNT(DISTINCT sd.driver_number) FILTER (WHERE trp.driver_number IS NOT NULL) AS traffic_src_drivers,
      COUNT(DISTINCT sd.driver_number) FILTER (WHERE op.driver_number  IS NOT NULL) AS overtake_src_drivers
    FROM season_drivers sd
    LEFT JOIN qual_present     qp  USING (driver_number)
    LEFT JOIN race_present     rp  USING (driver_number)
    LEFT JOIN tyre_present     tp  USING (driver_number)
    LEFT JOIN restart_present  rsp USING (driver_number)
    LEFT JOIN traffic_present  trp USING (driver_number)
    LEFT JOIN overtake_present op  USING (driver_number)
  `;
  const axisAggSql = `
    SELECT
      ROUND(AVG(qualifying_axis)::numeric, 1)      AS avg_qual_axis,
      ROUND(AVG(race_pace_axis)::numeric, 1)       AS avg_pace_axis,
      ROUND(AVG(tyre_management_axis)::numeric, 1) AS avg_tyre_axis
    FROM analytics.driver_performance_score_data
    WHERE season_year = $1
  `;
  const [{ rows: [counts] }, { rows: [axes] }] = await Promise.all([
    client.query(sql, [season]),
    client.query(axisAggSql, [season]),
  ]);
  const failures = [];
  for (const [key, min] of Object.entries(THRESHOLDS)) {
    const actual = Number(counts?.[key] ?? axes?.[key] ?? 0);
    if (!(actual >= min)) {
      failures.push(`A2 ${key} = ${actual} (threshold ${min})`);
    }
  }
  return { name: "A2", failures, sample: { ...counts, ...axes } };
}

// ---------------------------------------------------------------------------
// Check B1.5 — existence anti-join per axis (source has driver, matview missing populated row).
// ---------------------------------------------------------------------------
const B1_5_BLOCKS = [
  {
    axis: "qualifying",
    sql: (s) => `
      SELECT src.driver_number FROM (
        SELECT DISTINCT sg.driver_number FROM raw.starting_grid sg
          JOIN core.sessions s ON s.session_key = sg.session_key
          WHERE s.year = ${s} AND s.session_name = 'Race' AND sg.grid_position IS NOT NULL
      ) src
      EXCEPT
      SELECT driver_number FROM analytics.driver_performance_score_data
        WHERE season_year = ${s} AND avg_grid_position IS NOT NULL`
  },
  {
    axis: "race_pace",
    sql: (s) => `
      SELECT src.driver_number FROM (
        SELECT DISTINCT sr.driver_number FROM raw.session_result sr
          JOIN core.sessions s ON s.session_key = sr.session_key
          WHERE s.year = ${s} AND s.session_name = 'Race' AND sr.position IS NOT NULL
      ) src
      EXCEPT
      SELECT driver_number FROM analytics.driver_performance_score_data
        WHERE season_year = ${s} AND avg_race_position IS NOT NULL`
  },
  {
    axis: "tyre_management",
    sql: (s) => `
      SELECT src.driver_number FROM (
        SELECT DISTINCT sdc.driver_number FROM analytics.stint_degradation_curve sdc
          JOIN core.sessions s ON s.session_key = sdc.session_key
          WHERE s.year = ${s} AND sdc.degradation_per_lap_s IS NOT NULL
      ) src
      EXCEPT
      SELECT driver_number FROM analytics.driver_performance_score_data
        WHERE season_year = ${s} AND avg_deg_s IS NOT NULL`
  },
  {
    axis: "restart",
    sql: (s) => `
      SELECT src.driver_number FROM (
        SELECT DISTINCT rp.driver_number FROM analytics.restart_performance rp
          JOIN core.sessions s ON s.session_key = rp.session_key
          WHERE s.year = ${s} AND rp.position_delta IS NOT NULL
      ) src
      EXCEPT
      SELECT driver_number FROM analytics.driver_performance_score_data
        WHERE season_year = ${s} AND avg_restart_delta IS NOT NULL`
  },
  {
    axis: "traffic_handling",
    sql: (s) => `
      SELECT src.driver_number FROM (
        SELECT DISTINCT tap.driver_number FROM analytics.traffic_adjusted_pace tap
          JOIN core.sessions s ON s.session_key = tap.session_key
          WHERE s.year = ${s} AND tap.traffic_pace_delta_s IS NOT NULL
      ) src
      EXCEPT
      SELECT driver_number FROM analytics.driver_performance_score_data
        WHERE season_year = ${s} AND avg_traffic_delta_s IS NOT NULL`
  },
  {
    axis: "overtake",
    sql: (s) => `
      SELECT src.driver_number FROM (
        SELECT DISTINCT oe.overtaking_driver_number AS driver_number FROM analytics.overtake_events oe
          JOIN core.sessions s ON s.session_key = oe.session_key
          WHERE s.year = ${s}
      ) src
      EXCEPT
      SELECT driver_number FROM analytics.driver_performance_score_data
        WHERE season_year = ${s}`
  },
  {
    axis: "error_rate",
    sql: (s) => `
      SELECT src.driver_number FROM (
        SELECT DISTINCT rci.driver_number FROM analytics.race_control_incidents rci
          JOIN core.sessions s ON s.session_key = rci.session_key
          WHERE s.year = ${s} AND rci.driver_number IS NOT NULL
      ) src
      EXCEPT
      SELECT driver_number FROM analytics.driver_performance_score_data
        WHERE season_year = ${s}`
  },
];

async function checkB1_5(client, season) {
  const failures = [];
  for (const block of B1_5_BLOCKS) {
    const { rows } = await client.query(block.sql(season));
    if (rows.length > 0) {
      failures.push(
        `B1.5 ${block.axis}: ${rows.length} driver(s) in source but matview row missing/null: ` +
          rows.map((r) => r.driver_number).join(",")
      );
    }
  }
  return { name: "B1.5", failures };
}

// ---------------------------------------------------------------------------
// Check B1.6 — FULL OUTER JOIN value staleness per axis.
//
// Each block returns rows where issue ∈ {matview_null_source_has_value,
// matview_populated_source_absent, value_mismatch, matview_missing_driver_row}.
// Zero rows across all blocks = pass.
// ---------------------------------------------------------------------------
const FLOAT_TOL = 0.001;

function avgAxisBlock({ axis, surfacedCol, sourceTable, srcCol, extraFilter }) {
  return (season) => `
    WITH expected AS (
      SELECT ${srcCol} AS driver_number,
             AVG(${axis.metric}) AS expected_val
      FROM ${sourceTable} src
      JOIN core.sessions s ON s.session_key = src.session_key
      WHERE s.year = ${season}${extraFilter ? " AND " + extraFilter : ""}
      GROUP BY ${srcCol}
    ),
    mv AS (
      SELECT driver_number, ${surfacedCol} AS mv_val
      FROM analytics.driver_performance_score_data
      WHERE season_year = ${season}
    )
    SELECT '${axis.label}' AS axis_input,
           COALESCE(mv.driver_number, e.driver_number) AS driver_number,
           mv.mv_val, e.expected_val,
           CASE
             WHEN mv.mv_val IS NULL     AND e.expected_val IS NOT NULL THEN 'matview_null_source_has_value'
             WHEN mv.mv_val IS NOT NULL AND e.expected_val IS NULL     THEN 'matview_populated_source_absent'
             WHEN mv.mv_val IS NOT NULL AND e.expected_val IS NOT NULL
                  AND ABS(mv.mv_val - e.expected_val) > ${FLOAT_TOL}    THEN 'value_mismatch'
           END AS issue
    FROM mv FULL OUTER JOIN expected e USING (driver_number)
    WHERE (mv.mv_val IS NULL     AND e.expected_val IS NOT NULL)
       OR (mv.mv_val IS NOT NULL AND e.expected_val IS NULL)
       OR (mv.mv_val IS NOT NULL AND e.expected_val IS NOT NULL
           AND ABS(mv.mv_val - e.expected_val) > ${FLOAT_TOL});
  `;
}

const B1_6_BLOCKS = [
  avgAxisBlock({
    axis: { label: "avg_grid_position", metric: "src.grid_position::DOUBLE PRECISION" },
    surfacedCol: "avg_grid_position",
    sourceTable: "raw.starting_grid",
    srcCol: "src.driver_number",
    extraFilter: "s.session_name = 'Race' AND src.grid_position IS NOT NULL",
  }),
  avgAxisBlock({
    axis: { label: "avg_race_position", metric: "src.position::DOUBLE PRECISION" },
    surfacedCol: "avg_race_position",
    sourceTable: "raw.session_result",
    srcCol: "src.driver_number",
    extraFilter: "s.session_name = 'Race' AND src.position IS NOT NULL",
  }),
  avgAxisBlock({
    axis: { label: "avg_deg_s", metric: "src.degradation_per_lap_s" },
    surfacedCol: "avg_deg_s",
    sourceTable: "analytics.stint_degradation_curve",
    srcCol: "src.driver_number",
    extraFilter: "src.degradation_per_lap_s IS NOT NULL",
  }),
  avgAxisBlock({
    axis: { label: "avg_restart_delta", metric: "src.position_delta::DOUBLE PRECISION" },
    surfacedCol: "avg_restart_delta",
    sourceTable: "analytics.restart_performance",
    srcCol: "src.driver_number",
    extraFilter: "src.position_delta IS NOT NULL",
  }),
  avgAxisBlock({
    axis: { label: "avg_traffic_delta_s", metric: "src.traffic_pace_delta_s" },
    surfacedCol: "avg_traffic_delta_s",
    sourceTable: "analytics.traffic_adjusted_pace",
    srcCol: "src.driver_number",
    extraFilter: "src.traffic_pace_delta_s IS NOT NULL",
  }),
  // Count axes (integer compare; matview is COALESCE'd to 0).
  (season) => `
    WITH expected AS (
      SELECT oe.overtaking_driver_number AS driver_number, COUNT(*)::INT AS expected_cnt
      FROM analytics.overtake_events oe
      JOIN core.sessions s ON s.session_key = oe.session_key
      WHERE s.year = ${season}
      GROUP BY oe.overtaking_driver_number
    ),
    mv AS (
      SELECT driver_number, season_overtakes AS mv_cnt
      FROM analytics.driver_performance_score_data WHERE season_year = ${season}
    )
    SELECT 'season_overtakes' AS axis_input,
           COALESCE(mv.driver_number, e.driver_number) AS driver_number,
           mv.mv_cnt AS matview_val, COALESCE(e.expected_cnt, 0) AS expected_val,
           CASE WHEN mv.mv_cnt IS NULL THEN 'matview_missing_driver_row'
                WHEN mv.mv_cnt <> COALESCE(e.expected_cnt, 0) THEN 'value_mismatch' END AS issue
    FROM mv FULL OUTER JOIN expected e USING (driver_number)
    WHERE mv.mv_cnt IS NULL OR mv.mv_cnt <> COALESCE(e.expected_cnt, 0);
  `,
  (season) => `
    WITH expected AS (
      SELECT rci.driver_number,
             COUNT(*) FILTER (WHERE rci.action_status IN ('time_penalty', 'drive_through', 'grid_penalty'))::INT AS expected_cnt
      FROM analytics.race_control_incidents rci
      JOIN core.sessions s ON s.session_key = rci.session_key
      WHERE s.year = ${season} AND rci.driver_number IS NOT NULL
      GROUP BY rci.driver_number
    ),
    mv AS (
      SELECT driver_number, season_penalties AS mv_cnt
      FROM analytics.driver_performance_score_data WHERE season_year = ${season}
    )
    SELECT 'season_penalties' AS axis_input,
           COALESCE(mv.driver_number, e.driver_number) AS driver_number,
           mv.mv_cnt AS matview_val, COALESCE(e.expected_cnt, 0) AS expected_val,
           CASE WHEN mv.mv_cnt IS NULL THEN 'matview_missing_driver_row'
                WHEN mv.mv_cnt <> COALESCE(e.expected_cnt, 0) THEN 'value_mismatch' END AS issue
    FROM mv FULL OUTER JOIN expected e USING (driver_number)
    WHERE mv.mv_cnt IS NULL OR mv.mv_cnt <> COALESCE(e.expected_cnt, 0);
  `,
];

async function checkB1_6(client, season) {
  const failures = [];
  for (const block of B1_6_BLOCKS) {
    const { rows } = await client.query(block(season));
    if (rows.length > 0) {
      const sample = rows.slice(0, 3).map((r) => `${r.driver_number}:${r.issue}`).join(",");
      failures.push(
        `B1.6 ${rows[0].axis_input}: ${rows.length} mismatched row(s) [${sample}${rows.length > 3 ? ",…" : ""}]`
      );
    }
  }
  return { name: "B1.6", failures };
}

// ---------------------------------------------------------------------------
// Check §5.2 — primary team-mate populate consistency for traffic_handling_axis.
// ---------------------------------------------------------------------------
async function checkTeammateConsistency(client, season) {
  const sql = `
    WITH race_participation AS (
      SELECT sd.driver_number, sd.team_name, COUNT(*) AS race_rows
      FROM core.session_drivers sd
      JOIN core.sessions s ON s.session_key = sd.session_key
      WHERE s.year = $1 AND s.session_name = 'Race'
      GROUP BY sd.driver_number, sd.team_name
    ),
    ranked AS (
      SELECT dps.season_year, dps.team_name, dps.driver_number, dps.driver_name,
             dps.traffic_handling_axis, dps.avg_traffic_delta_s,
             ROW_NUMBER() OVER (
               PARTITION BY dps.season_year, dps.team_name
               ORDER BY COALESCE(rp.race_rows, 0) DESC, dps.driver_number
             ) AS team_rank
      FROM analytics.driver_performance_score_data dps
      LEFT JOIN race_participation rp
        ON rp.driver_number = dps.driver_number AND rp.team_name = dps.team_name
      WHERE dps.season_year = $1
    ),
    primary_pair AS (
      SELECT season_year, team_name,
             ARRAY_AGG(driver_name ORDER BY team_rank)                            AS drivers,
             ARRAY_AGG(traffic_handling_axis ORDER BY team_rank)                  AS axis_vals,
             ARRAY_AGG((avg_traffic_delta_s IS NOT NULL)::int ORDER BY team_rank) AS input_populated_flags
      FROM ranked WHERE team_rank <= 2
      GROUP BY season_year, team_name
    )
    SELECT team_name, drivers, axis_vals, input_populated_flags
    FROM primary_pair
    WHERE array_length(drivers, 1) = 2
      AND input_populated_flags @> ARRAY[0]
      AND input_populated_flags @> ARRAY[1];
  `;
  const { rows } = await client.query(sql, [season]);
  const failures = rows.length === 0
    ? []
    : rows.map((r) =>
        `§5.2 team-mate inconsistency at "${r.team_name}": drivers=${JSON.stringify(r.drivers)}, populated_flags=${JSON.stringify(r.input_populated_flags)}`
      );
  return { name: "§5.2", failures };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
async function main() {
  const { season } = parseArgs(process.argv);
  await loadEnv();

  if (!process.env.NEON_DB_HOST) {
    console.error("driver_performance_score_health: NEON_DB_HOST is not set; cannot connect.");
    process.exit(2);
  }

  const pool = new pg.Pool({
    host: process.env.NEON_DB_HOST,
    port: Number(process.env.NEON_DB_PORT ?? 5432),
    database: process.env.NEON_DB_NAME ?? "neondb",
    user: process.env.NEON_DB_USER,
    password: process.env.NEON_DB_PASSWORD,
    ssl: { rejectUnauthorized: true },
    statement_timeout: 30_000,
  });

  let exitCode = 0;
  try {
    const client = await pool.connect();
    try {
      console.log(`driver_performance_score_health: target_season=${season}`);
      const checks = [
        await checkA2(client, season),
        await checkB1_5(client, season),
        await checkB1_6(client, season),
        await checkTeammateConsistency(client, season),
      ];
      for (const r of checks) {
        if (r.failures.length === 0) {
          console.log(`  ok  ${r.name}`);
          if (r.sample) console.log(`        sample: ${JSON.stringify(r.sample)}`);
        } else {
          exitCode = 1;
          console.error(`  FAIL ${r.name}`);
          for (const f of r.failures) console.error(`        ${f}`);
        }
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(`driver_performance_score_health: error: ${err.message}`);
    exitCode = 2;
  } finally {
    await pool.end();
  }
  process.exit(exitCode);
}

await main();
