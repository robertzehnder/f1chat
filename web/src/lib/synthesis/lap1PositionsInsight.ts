import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `driver_pair_lap1_positions` (M12).
 *  Verdict: who gained more positions on lap 1 (grid → end of lap 1).
 *  The diverging bar is attached client-side from position_delta. */

type Row = Record<string, unknown>;

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function lastName(fullName: string): string {
  const last = fullName.trim().split(/\s+/).pop() ?? fullName;
  return last ? last[0].toUpperCase() + last.slice(1).toLowerCase() : fullName;
}
function describeDelta(delta: number): string {
  if (delta > 0) return `gained ${delta} position${delta === 1 ? "" : "s"}`;
  if (delta < 0) return `lost ${-delta} position${delta === -1 ? "" : "s"}`;
  return "held position";
}

export type Lap1PositionsInsightResult = { answer: string; insight: InsightFields };

export function buildLap1PositionsInsight(rows: Row[] | undefined): Lap1PositionsInsightResult | null {
  if (!rows || rows.length !== 2) return null;
  if (!("position_delta" in rows[0]) || !("lap1_position" in rows[0])) return null;

  const parse = (r: Row) => ({
    name: str(r.driver_name) ?? "Driver",
    surname: lastName(str(r.driver_name) ?? "Driver"),
    grid: num(r.grid_position),
    lap1: num(r.lap1_position),
    delta: num(r.position_delta)
  });
  const a = parse(rows[0]);
  const b = parse(rows[1]);
  if (a.delta === null || b.delta === null) return null;

  const venue = str(rows[0].location) ?? str(rows[0].country_name);
  const year = num(rows[0].year);
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");

  const tie = a.delta === b.delta;
  const winner = a.delta > b.delta ? a : b;
  const loser = winner === a ? b : a;
  // "Gained more" is the wrong frame when the better car merely held or
  // lost less — say "came off better" and spell out both movements.
  const nobodyGained = !tie && winner.delta! <= 0;

  const verdict: NonNullable<InsightFields["verdict"]> = tie
    ? { label: "NO", summary: `Even launch: both ${describeDelta(a.delta)} on lap 1 (${a.surname} P${a.grid}→P${a.lap1}, ${b.surname} P${b.grid}→P${b.lap1})` }
    : {
        label: "YES",
        color: "#22C55E",
        summary: nobodyGained
          ? `Neither car gained, but ${winner.surname} came off better: ${describeDelta(winner.delta!)} (P${winner.grid}→P${winner.lap1}) while ${loser.surname} ${describeDelta(loser.delta!)} (P${loser.grid}→P${loser.lap1})`
          : `${winner.surname} ${describeDelta(winner.delta!)} (P${winner.grid}→P${winner.lap1}) vs ${loser.surname} ${loser.delta! >= 0 ? "+" + loser.delta : loser.delta} (P${loser.grid}→P${loser.lap1})`
      };

  const metrics: InsightFieldMetric[] = [
    { label: `${a.surname} lap 1`, value: `${a.delta >= 0 ? "+" : ""}${a.delta}`, context: `P${a.grid} → P${a.lap1}`, emphasis: !tie && winner === a },
    { label: `${b.surname} lap 1`, value: `${b.delta >= 0 ? "+" : ""}${b.delta}`, context: `P${b.grid} → P${b.lap1}`, emphasis: !tie && winner === b }
  ];

  const measuredLaps = rows
    .map((r) => num(r.measured_lap))
    .filter((n): n is number => n !== null && n > 1);
  const inferredHolds = rows.filter((r) => r.inferred_hold === true || r.inferred_hold === "t");
  const takeaways = [
    `${a.surname}: ${describeDelta(a.delta)} (P${a.grid} → P${a.lap1})`,
    `${b.surname}: ${describeDelta(b.delta)} (P${b.grid} → P${b.lap1})`,
    ...(inferredHolds.length
      ? [`The position feed only logs changes — no early rows for one car means it held its grid position`]
      : []),
    ...(measuredLaps.length
      ? [`Position feed is missing lap 1 for one car — earliest recorded lap (lap ${Math.max(...measuredLaps)}) used as the proxy`]
      : []),
    `Measured at the end of lap 1 — mid-lap SC timing isn't resolvable from the position feed`
  ];

  const answer = tie
    ? `Neither gained more: both ${describeDelta(a.delta)} on the lap-1 launch at ${venueYear || "this race"} (${a.surname} P${a.grid}→P${a.lap1}, ${b.surname} P${b.grid}→P${b.lap1}). Positions are measured at the end of lap 1.`
    : nobodyGained
      ? `Neither driver gained positions on the lap-1 launch at ${venueYear || "this race"}, but ${winner.surname} came off better: ${winner.surname} ${describeDelta(winner.delta!)} (P${winner.grid} to P${winner.lap1}) while ${loser.surname} ${describeDelta(loser.delta!)} (P${loser.grid} to P${loser.lap1}). Positions are measured at the end of lap 1; mid-lap safety-car timing isn't resolvable from the position feed.`
      : `${winner.surname} gained more on the lap-1 launch at ${venueYear || "this race"}: ${describeDelta(winner.delta!)} from P${winner.grid} to P${winner.lap1}, against ${loser.surname}'s ${describeDelta(loser.delta!)} (P${loser.grid} to P${loser.lap1}). Positions are measured at the end of lap 1; mid-lap safety-car timing isn't resolvable from the position feed.`;

  return {
    answer,
    insight: {
      title: `Lap-1 Launch — ${a.surname} vs ${b.surname}${venueYear ? ` · ${venueYear}` : ""}`,
      subtitle: [venueYear || venue, str(rows[0].session_name) ?? "Race", "grid → end of lap 1"].filter(Boolean).join(" · "),
      verdict,
      metrics,
      key_takeaways: takeaways,
      related_questions: [
        `How did the field's positions change on lap 1 at ${venueYear || "this race"}?`,
        `Did ${loser.surname} recover the lost ground by the finish?`,
        `Compare ${a.surname} and ${b.surname}'s restart performance`
      ]
    }
  };
}
