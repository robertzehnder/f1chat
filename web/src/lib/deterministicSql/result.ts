import type { DeterministicSqlTemplate } from "./types";

type BuildResultTemplateInput = {
  lower: string;
  targetSession: number;
  driverPairSql: string | undefined;
  includesAny: (text: string, candidates: string[]) => boolean;
};

export function buildResultTemplate(input: BuildResultTemplateInput): DeterministicSqlTemplate | null {
  const { lower, targetSession, driverPairSql, includesAny } = input;

  if (driverPairSql && includesAny(lower, ["gained or lost more positions", "gained or lost"])) {
    return {
      templateKey: "max_leclerc_positions_gained_or_lost",
      sql: `
        SELECT
          driver_name AS full_name,
          driver_number,
          grid_position,
          finish_position,
          positions_gained
        FROM core.grid_vs_finish
        WHERE session_key = ${targetSession}
          AND driver_number ${driverPairSql}
        ORDER BY positions_gained DESC
      `
    };
  }

  return null;
}
