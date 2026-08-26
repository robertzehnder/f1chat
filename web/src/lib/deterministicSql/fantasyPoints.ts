import type { DeterministicSqlTemplate } from "./types";

/**
 * Fantasy round-recap template (converged fantasy roadmap R5).
 *
 * "How many fantasy points did everyone score at <race>?" → per-driver
 * reconstructed fantasy totals for the resolved session's round, from
 * analytics.fantasy_points_by_round (058). Output mirrors the
 * inferred-overtakes row shape (driver_name + one numeric + venue
 * ride-alongs) so the existing horizontal-bar detector charts it — no new
 * detector surface.
 *
 * Reconstructed ≠ official: the warehouse can't see Driver-of-the-Day or
 * stationary-time pit tiers, and overtakes are inferred. The synthesis
 * fallback text carries that caveat via the ledger's honesty flags; the
 * official per-round totals live in raw.fantasy_feed_snapshots for
 * questions that want them.
 *
 * Keep the SQL free of semicolons and querySafety's banned keywords.
 */

type BuildFantasyPointsTemplateInput = {
  lower: string;
  targetSession: number;
};

const FANTASY_TRIGGER = /\bfantasy\b/;
const POINTS_TRIGGER = /\b(points?|scores?|scored|recap|totals?)\b/;
// Season/market/decision questions are NOT a single-round recap — those go
// to the LLM path with the fantasy MATVIEW hint (official feed, projections).
const NOT_A_ROUND_RECAP = /\b(season|overall|so far|cumulative|championship|price|prices|cost|costs|value|project|projection|pick|picks|recommend|transfer|budget|ownership|selected)\b/;

export function buildFantasyPointsTemplate(
  input: BuildFantasyPointsTemplateInput
): DeterministicSqlTemplate | null {
  const { lower, targetSession } = input;
  if (!FANTASY_TRIGGER.test(lower) || !POINTS_TRIGGER.test(lower)) return null;
  if (NOT_A_ROUND_RECAP.test(lower)) return null;

  const sql = `
    SELECT
      fr.entity_name AS driver_name,
      fr.points AS fantasy_points,
      fr.circuit_short_name AS location,
      fr.year AS year,
      'Race'::text AS session_name
    FROM analytics.fantasy_points_by_round fr
    WHERE fr.meeting_key = (
        SELECT s.meeting_key FROM core.sessions s WHERE s.session_key = ${targetSession}
      )
      AND fr.entity_type = 'driver'
    ORDER BY fr.points DESC
  `;

  return { templateKey: "fantasy_round_points", sql };
}
