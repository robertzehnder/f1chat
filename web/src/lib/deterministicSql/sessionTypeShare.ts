import type { DeterministicSqlTemplate } from "./types";

type BuildSessionTypeShareTemplateInput = {
  lower: string;
};

// Session-type composition donut. Groups core.sessions.session_type for a
// season into a share breakdown. The aggregate is aliased `session_count`
// (matches donutDetector's /count/ value regex) and the group key `label`
// (donutDetector requires a literal `label` column) so the row shape routes
// to the donut renderer without an LLM-authored alias. A season has 4-6
// distinct session_types, landing inside donutDetector's 2..6 row window.
// Season-grain: no session pin, so this runs BEFORE the session gate in the
// router (like the data-health / performance-radar families).
export function buildSessionTypeShareTemplate(
  ctx: BuildSessionTypeShareTemplateInput
): DeterministicSqlTemplate | null {
  const { lower } = ctx;
  // Anchor on explicit session-composition phrasing; keep it narrow so we
  // don't swallow generic "how many races" counting questions.
  const asksSessionMix =
    (lower.includes("session type") ||
      lower.includes("session types") ||
      lower.includes("types of session") ||
      lower.includes("session breakdown") ||
      lower.includes("session mix") ||
      lower.includes("session composition")) &&
    (lower.includes("how many") ||
      lower.includes("breakdown") ||
      lower.includes("share") ||
      lower.includes("split") ||
      lower.includes("mix") ||
      lower.includes("composition") ||
      lower.includes("each"));
  if (!asksSessionMix) return null;

  // Year: default to 2025 (the season the app centers on); honor an
  // explicit 4-digit year 2018-2025 when present.
  const yearMatch = lower.match(/\b(20(1[89]|2[0-5]))\b/);
  const year = yearMatch ? Number(yearMatch[1]) : 2025;

  return {
    templateKey: "session_type_share",
    sql: `
      SELECT
        session_type AS label,
        COUNT(*) AS session_count
      FROM core.sessions
      WHERE year = ${year}
        AND session_type IS NOT NULL
      GROUP BY session_type
      ORDER BY session_count DESC, label ASC
      LIMIT 6
    `
  };
}
