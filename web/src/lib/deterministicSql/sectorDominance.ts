import type { DeterministicSqlTemplate } from "./types";

/**
 * Driver-pair OFFICIAL-SECTOR dominance card — "which sectors / corners
 * did A gain on B?" answered at the S1/S2/S3 level from real TIMING data
 * (core.laps_enriched duration_sector_1/2/3), not telemetry speed
 * samples. Best valid sector time per driver, delta in seconds.
 *
 * This is the default for corner/sector dominance questions; the
 * 30-minisector speed card stays behind an explicit "minisector" ask
 * (its max-speed source is artifact-prone — 2025 Silverstone showed
 * +151 km/h ghosts from pit/SC samples).
 *
 * Output: 3 rows shaped for the track_heatmap detector
 * (minisector_index + name + leader), delta_unit 's'. The renderer
 * splits the track ribbon at the REAL sector boundaries supplied by the
 * track-outline API.
 *
 * Keep the SQL free of the statement separator and the banned keywords
 * scanned by src/lib/querySafety.ts.
 */

type BuildSectorDominanceTemplateInput = {
  lower: string;
  targetSession: number;
  driverA: number | undefined;
  driverB: number | undefined;
};

// Explicit minisector asks keep the legacy card.
const MINISECTOR_TRIGGER = /\bmini[\s-]?sector/;
const SECTOR_TRIGGER = /\bsectors?\b|\bcorners?\b|track dominance|dominan/;
const GAIN_TRIGGER = /\b(gain(?:ed|s)?|lose|lost|faster|quicker|slower|stronger|dominan\w*|edge|owned?|purple)\b/;

export function buildSectorDominanceTemplate(
  input: BuildSectorDominanceTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverA, driverB } = input;
  if (driverA === undefined || driverB === undefined) return null;
  if (driverA === driverB) return null;
  if (MINISECTOR_TRIGGER.test(lower)) return null;
  // F11 (golden-set audit 2026-07-02): the 3-row S1/S2/S3 dominance card
  // structurally can't answer per-corner-phase questions (M04: "Turns 7,
  // 8, 9 — where did X lose time on entry vs apex"). Named-turn and
  // corner-phase phrasings belong on the LLM path, not this template.
  if (/\b(entry|apex|exit|turn[- ]?in|braking point)\b/.test(lower)) return null;
  if (/\bturns?\s+\d+(\s*,\s*\d+)*/.test(lower)) return null;
  if (!SECTOR_TRIGGER.test(lower)) return null;
  if (!GAIN_TRIGGER.test(lower)) return null;
  if (/\bhow many\b/.test(lower)) return null;

  const bestSectors = (alias: string, driverNumber: number) => `
    ${alias} AS (
      SELECT
        MIN(duration_sector_1) AS s1,
        MIN(duration_sector_2) AS s2,
        MIN(duration_sector_3) AS s3,
        MAX(driver_name) AS driver_name
      FROM core.laps_enriched
      WHERE session_key = ${targetSession}
        AND driver_number = ${driverNumber}
        AND COALESCE(is_valid, TRUE) = TRUE
        AND COALESCE(is_pit_lap, FALSE) = FALSE
        AND COALESCE(is_pit_out_lap, FALSE) = FALSE
        AND duration_sector_1 IS NOT NULL
        AND duration_sector_2 IS NOT NULL
        AND duration_sector_3 IS NOT NULL
    )`;

  const sql = `
    WITH ${bestSectors("a", driverA)},
    ${bestSectors("b", driverB)},
    sess AS (
      SELECT circuit_short_name, country_name, location, year, session_name
      FROM core.sessions
      WHERE session_key = ${targetSession}
      LIMIT 1
    ),
    sectors AS (
      SELECT 0 AS minisector_index, 'Sector 1' AS name, a.s1 AS a_best, b.s1 AS b_best FROM a, b
      UNION ALL
      SELECT 1, 'Sector 2', a.s2, b.s2 FROM a, b
      UNION ALL
      SELECT 2, 'Sector 3', a.s3, b.s3 FROM a, b
    )
    SELECT
      s.minisector_index,
      s.name,
      CASE WHEN s.a_best <= s.b_best THEN (SELECT driver_name FROM a) ELSE (SELECT driver_name FROM b) END AS leader,
      ROUND(ABS(s.a_best - s.b_best)::numeric, 3) AS delta_ms,
      's' AS delta_unit,
      ROUND(s.a_best::numeric, 3) AS a_best,
      ROUND(s.b_best::numeric, 3) AS b_best,
      (SELECT driver_name FROM a) AS driver_a,
      (SELECT driver_name FROM b) AS driver_b,
      (SELECT circuit_short_name FROM sess) AS circuit_short_name,
      (SELECT country_name FROM sess) AS country_name,
      (SELECT location FROM sess) AS location,
      (SELECT year FROM sess) AS year,
      (SELECT session_name FROM sess) AS session_name
    FROM sectors s
    WHERE s.a_best IS NOT NULL AND s.b_best IS NOT NULL
    ORDER BY s.minisector_index
  `;

  return { templateKey: "driver_pair_sector_dominance", sql };
}
