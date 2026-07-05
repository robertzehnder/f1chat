import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/**
 * Deterministic (zero-LLM) insight for the `inferred_overtakes` template.
 *
 * The official overtake feed is empty, so this card reports on-track passes
 * INFERRED from lap-by-lap classified positions (pit-cycle swaps excluded).
 * Every surface is labelled "estimate / unofficial", and it states plainly
 * that where-on-track (corner / DRS-zone) attribution isn't in the data — so
 * a question like "% of overtakes in the fourth DRS zone" gets the inferable
 * total plus an honest "zone breakdown unavailable" rather than a bare refusal.
 *
 * The per-driver bar chart is attached client-side by the horizontal_bar
 * detector from the same rows; this builder owns the title/metrics/takeaways.
 */

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

export type InferredOvertakesInsightResult = {
  answer: string;
  insight: InsightFields;
};

export function buildInferredOvertakesInsight(rows: Row[] | undefined): InferredOvertakesInsightResult | null {
  if (!rows || rows.length === 0) return null;
  if (!("overtakes" in rows[0]) || !("driver_name" in rows[0])) return null;

  const drivers = rows
    .map((r) => ({ name: str(r.driver_name), overtakes: num(r.overtakes) }))
    .filter((d): d is { name: string; overtakes: number } => d.name !== null && d.overtakes !== null)
    .sort((a, b) => b.overtakes - a.overtakes);
  if (drivers.length === 0) return null;

  const total = drivers.reduce((s, d) => s + d.overtakes, 0);
  const leader = drivers[0];
  const leaderSurname = lastName(leader.name);
  const venue = str(rows[0].location);
  const year = num(rows[0].year);
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");

  const title = venueYear ? `Inferred On-Track Overtakes — ${venueYear}` : "Inferred On-Track Overtakes";
  const subtitle = [venueYear || venue, "Race", "estimated from positions · unofficial"].filter(Boolean).join(" · ");

  const metrics: InsightFieldMetric[] = [
    { label: "On-track passes", value: String(total), context: "estimated", emphasis: true },
    { label: "Most passes", value: String(leader.overtakes), context: leaderSurname },
    { label: "Drivers passing", value: String(drivers.length) }
  ];

  const takeaways: string[] = [
    `~${total} on-track passes estimated (pit-stop & caution-lap swaps excluded)`,
    `${leaderSurname} made the most: ${leader.overtakes}`,
    `${drivers.length} drivers made at least one on-track pass`,
    `Official overtake data isn't recorded — inferred from lap-by-lap classified positions`,
    `Where on track each pass happened (corner / DRS zone) isn't captured in the data`
  ];

  const answer =
    `Inferred ~${total} on-track passes${venueYear ? ` at ${venueYear}` : ""}, reconstructed from lap-by-lap ` +
    `classified positions (the official overtake feed isn't recorded). Pit-stop swaps and caution ` +
    `(safety-car/VSC) laps are excluded; lapped traffic and retirements can't be fully removed, so treat this as an estimate. ` +
    `${leaderSurname} made the most (${leader.overtakes}). The data doesn't record where on track each ` +
    `pass happened, so a DRS-zone or corner breakdown isn't possible.`;

  return {
    answer,
    insight: {
      title,
      subtitle,
      metrics,
      key_takeaways: takeaways,
      related_questions: [
        `Who lost the most positions on track${venueYear ? ` at ${venueYear}` : ""}?`,
        `How many pit stops were made${venueYear ? ` at ${venueYear}` : ""}?`,
        `Show the lap-by-lap running order`
      ]
    }
  };
}
