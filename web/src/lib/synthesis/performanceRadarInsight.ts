import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `driver_pair_performance_radar` (M17).
 *  Two rows (driver A first) with the 7 season axis scores. The radar
 *  chart itself is attached client-side by the radar detector. */

type Row = Record<string, unknown>;

const AXES: ReadonlyArray<{ col: string; label: string }> = [
  { col: "qualifying_axis", label: "Qualifying" },
  { col: "race_pace_axis", label: "Race pace" },
  { col: "tyre_management_axis", label: "Tyre management" },
  { col: "restart_axis", label: "Restarts" },
  { col: "traffic_handling_axis", label: "Traffic" },
  { col: "overtake_difficulty_axis", label: "Overtaking" },
  { col: "error_rate_axis", label: "Consistency" }
];

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
function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

export type PerformanceRadarInsightResult = { answer: string; insight: InsightFields };

export function buildPerformanceRadarInsight(rows: Row[] | undefined): PerformanceRadarInsightResult | null {
  if (!rows || rows.length !== 2) return null;
  if (!("qualifying_axis" in rows[0]) || !("driver_name" in rows[0])) return null;
  const [ra, rb] = rows;
  const aName = str(ra.driver_name) ?? "Driver A";
  const bName = str(rb.driver_name) ?? "Driver B";
  const aLast = lastName(aName);
  const bLast = lastName(bName);
  const year = num(ra.season_year);

  // Per-axis deltas (A − B). A 0 score is an upstream COALESCE floor
  // (axis not populated), not a real rating — an axis where EITHER
  // driver reads exactly 0 can't support a "biggest edge" claim, so
  // those are excluded from the ranking and flagged instead.
  const deltas = AXES.map(({ col, label }) => {
    const a = num(ra[col]);
    const b = num(rb[col]);
    return {
      label,
      a,
      b,
      delta: a !== null && b !== null ? a - b : null,
      unpopulated: a === 0 || b === 0
    };
  });
  const live = deltas.filter((d) => d.delta !== null && !d.unpopulated);
  if (live.length === 0) return null;
  const sorted = [...live].sort((x, y) => Math.abs(y.delta!) - Math.abs(x.delta!));
  const biggest = sorted[0];
  const aEdges = live.filter((d) => d.delta! > 0).sort((x, y) => y.delta! - x.delta!);
  const bEdges = live.filter((d) => d.delta! < 0).sort((x, y) => x.delta! - y.delta!);
  const unpopulatedCount = deltas.filter((d) => d.unpopulated).length;

  const metrics: InsightFieldMetric[] = sorted.slice(0, 3).map((d, i) => ({
    label: d.label,
    value: `${signed(d.delta!)}`,
    context: `${aLast} ${d.a!.toFixed(1)} · ${bLast} ${d.b!.toFixed(1)}`,
    emphasis: i === 0
  }));

  const takeaways: string[] = [];
  if (aEdges.length) {
    takeaways.push(`${aLast} leads on ${aEdges.map((d) => `${d.label} (${signed(d.delta!)})`).join(", ")}`);
  }
  if (bEdges.length) {
    takeaways.push(`${bLast} leads on ${bEdges.map((d) => `${d.label} (${signed(-d.delta!)})`).join(", ")}`);
  }
  // F22 (golden-set audit 2026-07-02): attribute the gap to the LEADER with
  // a positive magnitude — the old "−30.0 to Norris" gave the leading driver
  // a negative number.
  takeaways.push(
    `Largest single gap: ${biggest.label} (${Math.abs(biggest.delta!).toFixed(1)} in ${biggest.delta! > 0 ? aLast : bLast}'s favour)`
  );
  if (unpopulatedCount > 0) {
    // F22: only "both read 0" axes are genuinely unpopulated; an axis where
    // ONE driver scored 0 and the other didn't is a real (if lopsided) score
    // and shouldn't be called "not populated".
    const bothZero = deltas.filter((d) => d.unpopulated && d.a === 0 && d.b === 0);
    const oneSided = deltas.filter((d) => d.unpopulated && !(d.a === 0 && d.b === 0));
    if (bothZero.length > 0) {
      takeaways.push(
        `${bothZero.length} of ${AXES.length} axes not yet populated in the score model (${bothZero.map((d) => d.label).join(", ")}) — excluded from the comparison`
      );
    }
    if (oneSided.length > 0) {
      takeaways.push(
        `${oneSided.map((d) => d.label).join(", ")}: one driver scored 0 while the other didn't — excluded from the "biggest gap" ranking as lopsided, not missing`
      );
    }
  }
  takeaways.push(
    `Season-aggregate scores (0–100 scale) from the 7-axis performance model; Consistency is the inverted error-rate axis (higher = fewer errors)`
  );

  // The marquee axes (qualifying, race pace) are what radar questions
  // usually ask about by name — when they're unpopulated, the answer must
  // open with that, not bury it in a takeaway.
  const unpopulatedNames = deltas.filter((d) => d.unpopulated).map((d) => d.label);
  const unpopulatedLede = unpopulatedNames.length
    ? `A direct answer isn't possible yet: the ${unpopulatedNames.map((n) => n.toLowerCase()).join(" and ")} ax${unpopulatedNames.length === 1 ? "is" : "es"} read${unpopulatedNames.length === 1 ? "s" : ""} 0.0 in the ${year ?? "season"} score model (not yet populated), so a question about ${unpopulatedNames.length > 1 ? "those axes" : "that axis"} can't be settled from this data. Among the ${live.length} populated axes: `
    : "";

  const answer =
    unpopulatedLede +
    `${unpopulatedLede ? "the" : "The"} biggest gap between ${aLast} and ${bLast} in ${year ?? "the season"} is ${biggest.label}: ` +
    `${biggest.a!.toFixed(1)} vs ${biggest.b!.toFixed(1)} (${signed(biggest.delta!)} to ${biggest.delta! > 0 ? aLast : bLast}). ` +
    (aEdges.length ? `${aLast} is ahead on ${aEdges.map((d) => d.label.toLowerCase()).join(", ")}. ` : "") +
    (bEdges.length ? `${bLast} is ahead on ${bEdges.map((d) => d.label.toLowerCase()).join(", ")}. ` : "") +
    `Scores are season aggregates from the 7-axis model, not single-race data.`;

  return {
    answer,
    insight: {
      title: `Performance Radar — ${aLast} vs ${bLast}${year !== null ? ` · ${year}` : ""}`,
      subtitle: [`Season ${year ?? ""}`.trim(), "7-axis model", `${live.length} axes populated`].join(" · "),
      metrics,
      key_takeaways: takeaways.slice(0, 6),
      related_questions: [
        `How does ${aLast}'s qualifying edge translate to grid positions in ${year ?? "the season"}?`,
        `Compare ${aLast} and ${bLast}'s tyre degradation at a specific race`,
        `Who has the better restart record in ${year ?? "the season"}?`
      ]
    }
  };
}
