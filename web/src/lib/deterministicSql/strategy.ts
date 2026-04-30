import type { DeterministicSqlTemplate } from "./types";

type BuildStrategyTemplateInput = {
  lower: string;
  targetSession: number;
  driverPairSql: string | undefined;
  includesAny: (text: string, candidates: string[]) => boolean;
};

export function buildStrategyTemplate(input: BuildStrategyTemplateInput): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverPairSql, includesAny } = input;

  if (driverPairSql && lower.includes("how many pit stops")) {
    return {
      templateKey: "max_leclerc_pit_stop_count",
      sql: `
        SELECT
          driver_name AS full_name,
          driver_number,
          pit_stop_count
        FROM core.strategy_summary
        WHERE session_key = ${targetSession}
          AND driver_number ${driverPairSql}
        ORDER BY driver_number
      `
    };
  }

  if (driverPairSql && lower.includes("on which laps") && lower.includes("pit")) {
    return {
      templateKey: "max_leclerc_pit_laps",
      sql: `
        SELECT
          s.driver_number,
          s.driver_name AS full_name,
          pl.lap_number,
          p.pit_duration
        FROM core.strategy_summary s
        LEFT JOIN LATERAL UNNEST(COALESCE(s.pit_laps, ARRAY[]::integer[])) AS pl(lap_number)
          ON TRUE
        LEFT JOIN raw.pit p
          ON p.session_key = s.session_key
         AND p.driver_number = s.driver_number
         AND p.lap_number = pl.lap_number
        WHERE s.session_key = ${targetSession}
          AND s.driver_number ${driverPairSql}
        ORDER BY s.driver_number, pl.lap_number
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["shorter stationary pit stop", "shortest stationary pit stop"])) {
    return {
      templateKey: "max_leclerc_shortest_pit_stop",
      sql: `
        SELECT
          p.driver_number,
          d.full_name,
          MIN(p.pit_duration) AS best_pit_duration
        FROM raw.pit p
        JOIN raw.drivers d
          ON d.session_key = p.session_key
         AND d.driver_number = p.driver_number
        WHERE p.session_key = ${targetSession}
          AND p.driver_number ${driverPairSql}
        GROUP BY p.driver_number, d.full_name
        ORDER BY best_pit_duration ASC
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["less total time in the pit lane", "least total time in the pit lane"])) {
    return {
      templateKey: "max_leclerc_total_pit_time",
      sql: `
        SELECT
          driver_number,
          driver_name AS full_name,
          total_pit_duration_seconds
        FROM core.strategy_summary
        WHERE session_key = ${targetSession}
          AND driver_number ${driverPairSql}
        ORDER BY total_pit_duration_seconds ASC
      `
    };
  }

  if (driverPairSql && lower.includes("stint lengths")) {
    return {
      templateKey: "max_leclerc_stint_lengths",
      sql: `
        SELECT
          driver_number,
          driver_name AS full_name,
          stint_number,
          compound_name AS compound,
          lap_start,
          lap_end,
          stint_length_laps,
          tyre_age_at_start
        FROM core.stint_summary
        WHERE session_key = ${targetSession}
          AND driver_number ${driverPairSql}
        ORDER BY driver_number, stint_number
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["tire compounds", "tyre compounds"])) {
    return {
      templateKey: "max_leclerc_compounds_used",
      sql: `
        SELECT
          driver_number,
          driver_name AS full_name,
          stint_number,
          compound_name AS compound,
          lap_start,
          lap_end
        FROM core.stint_summary
        WHERE session_key = ${targetSession}
          AND driver_number ${driverPairSql}
        ORDER BY driver_number, stint_number
      `
    };
  }

  if (driverPairSql && includesAny(lower, ["one-stop", "two-stop"])) {
    return {
      templateKey: "max_leclerc_strategy_type",
      sql: `
        SELECT
          driver_number,
          driver_name AS full_name,
          total_stints,
          pit_stop_count AS pit_stops,
          strategy_type
        FROM core.strategy_summary
        WHERE session_key = ${targetSession}
          AND driver_number ${driverPairSql}
        ORDER BY driver_number
      `
    };
  }

  if (driverPairSql && lower.includes("pit cycle")) {
    return {
      templateKey: "max_leclerc_position_change_around_pit_cycle",
      sql: `
        WITH pit_events AS (
          SELECT
            ss.session_key,
            ss.driver_number,
            ss.driver_name AS full_name,
            pl.lap_number AS pit_lap
          FROM core.strategy_summary ss
          JOIN LATERAL UNNEST(COALESCE(ss.pit_laps, ARRAY[]::integer[])) AS pl(lap_number)
            ON TRUE
          WHERE ss.session_key = ${targetSession}
            AND ss.driver_number ${driverPairSql}
        ),
        pit_lap_semantics AS (
          SELECT
            lsb.session_key,
            lsb.driver_number,
            lsb.lap_number AS pit_lap,
            BOOL_OR(lsb.is_pit_lap) AS is_pit_lap
          FROM core.lap_semantic_bridge lsb
          WHERE lsb.session_key = ${targetSession}
            AND lsb.driver_number ${driverPairSql}
          GROUP BY lsb.session_key, lsb.driver_number, lsb.lap_number
        ),
        position_pairs AS (
          SELECT
            pe.driver_number,
            pe.full_name,
            pe.pit_lap,
            MAX(CASE WHEN rp.lap_number = pe.pit_lap - 1 THEN rp.position_end_of_lap END) AS pre_pit_position,
            MAX(CASE WHEN rp.lap_number = pe.pit_lap + 1 THEN rp.position_end_of_lap END) AS post_pit_position,
            MAX(CASE WHEN rp.lap_number = pe.pit_lap THEN rp.previous_position END) AS previous_position,
            MAX(CASE WHEN rp.lap_number = pe.pit_lap THEN rp.positions_gained_this_lap END) AS positions_gained_this_lap
          FROM pit_events pe
          LEFT JOIN core.race_progression_summary rp
            ON rp.session_key = pe.session_key
           AND rp.driver_number = pe.driver_number
          GROUP BY pe.driver_number, pe.full_name, pe.pit_lap
        )
        SELECT
          pp.driver_number,
          pp.full_name,
          pp.pit_lap,
          pls.is_pit_lap,
          pp.pre_pit_position,
          pp.post_pit_position,
          pp.previous_position,
          pp.positions_gained_this_lap,
          CASE
            WHEN pp.pre_pit_position IS NULL OR pp.post_pit_position IS NULL THEN NULL
            ELSE pp.pre_pit_position - pp.post_pit_position
          END AS positions_gained_after_pit,
          (
            pp.pre_pit_position IS NOT NULL
            AND pp.post_pit_position IS NOT NULL
            AND COALESCE(pls.is_pit_lap, FALSE) = TRUE
          ) AS evidence_sufficient_for_pit_cycle_claim
        FROM position_pairs pp
        LEFT JOIN pit_lap_semantics pls
          ON pls.session_key = ${targetSession}
         AND pls.driver_number = pp.driver_number
         AND pls.pit_lap = pp.pit_lap
        ORDER BY pp.driver_number, pp.pit_lap
      `
    };
  }

  if (driverPairSql && lower.includes("opening stint") && lower.includes("closing stint")) {
    return {
      templateKey: "max_leclerc_opening_closing_stint_lengths",
      sql: `
        WITH stint_lengths AS (
          SELECT
            l.driver_number,
            COALESCE(l.driver_name, sd.full_name) AS full_name,
            COALESCE(l.stint_number, 0) AS stint_number,
            MIN(l.lap_number) AS lap_start,
            MAX(l.lap_number) AS lap_end
          FROM core.laps_enriched l
          LEFT JOIN core.session_drivers sd
            ON sd.session_key = l.session_key
           AND sd.driver_number = l.driver_number
          WHERE l.session_key = ${targetSession}
            AND l.driver_number ${driverPairSql}
            AND l.lap_number IS NOT NULL
            AND COALESCE(l.is_valid, TRUE) = TRUE
            AND COALESCE(l.stint_number, 0) > 0
          GROUP BY l.driver_number, COALESCE(l.driver_name, sd.full_name), COALESCE(l.stint_number, 0)
        ),
        ranked_stints AS (
          SELECT
            sl.*,
            ROW_NUMBER() OVER (PARTITION BY sl.driver_number ORDER BY sl.stint_number ASC) AS rn_open,
            ROW_NUMBER() OVER (PARTITION BY sl.driver_number ORDER BY sl.stint_number DESC) AS rn_close
          FROM stint_lengths sl
        ),
        opening_closing AS (
          SELECT
            driver_number,
            full_name,
            MAX(CASE WHEN rn_open = 1 THEN stint_number END) AS opening_stint_number,
            MAX(CASE WHEN rn_close = 1 THEN stint_number END) AS closing_stint_number,
            MIN(CASE WHEN rn_open = 1 THEN lap_start END) AS opening_lap_start,
            MAX(CASE WHEN rn_open = 1 THEN lap_end END) AS opening_lap_end,
            MIN(CASE WHEN rn_close = 1 THEN lap_start END) AS closing_lap_start,
            MAX(CASE WHEN rn_close = 1 THEN lap_end END) AS closing_lap_end
          FROM ranked_stints
          GROUP BY driver_number, full_name
        )
        SELECT
          driver_number,
          full_name,
          opening_stint_number,
          closing_stint_number,
          opening_lap_start,
          opening_lap_end,
          closing_lap_start,
          closing_lap_end,
          GREATEST(opening_lap_end - opening_lap_start + 1, 0) AS opening_stint_length,
          GREATEST(closing_lap_end - closing_lap_start + 1, 0) AS closing_stint_length
        FROM opening_closing
        ORDER BY driver_number
      `
    };
  }

  return null;
}
