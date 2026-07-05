import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/**
 * Deterministic (zero-LLM) insight for the `minisector_dominance` template.
 *
 * Reports, for two drivers, how many minisectors each was faster in (by
 * average speed) over the whole lap, with the strongest gains called out.
 * Honest framing: it's avg-SPEED dominance (km/h), not a lap-time delta, and
 * it's whole-lap — the data has no sector (1/2/3) -> minisector mapping, so a
 * "Sector 2"-only view isn't possible. The per-minisector strip chart is
 * attached client-side by the track_heatmap detector from the same rows.
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

export type MinisectorDominanceInsightResult = {
  answer: string;
  insight: InsightFields;
};

export function buildMinisectorDominanceInsight(rows: Row[] | undefined): MinisectorDominanceInsightResult | null {
  if (!rows || rows.length === 0) return null;
  if (!("leader" in rows[0]) || !("minisector_index" in rows[0])) return null;

  const aName = str(rows[0].driver_a);
  const bName = str(rows[0].driver_b);
  if (!aName || !bName) return null;
  const aSurname = lastName(aName);
  const bSurname = lastName(bName);

  const total = rows.length;
  const aCount = rows.filter((r) => str(r.leader) === aName).length;
  const bCount = rows.filter((r) => str(r.leader) === bName).length;

  // Strongest gains for the driver who led more minisectors.
  const leaderName = aCount >= bCount ? aName : bName;
  const leaderSurname = aCount >= bCount ? aSurname : bSurname;
  const trailerSurname = aCount >= bCount ? bSurname : aSurname;
  const leaderCount = Math.max(aCount, bCount);
  const trailerCount = Math.min(aCount, bCount);
  const strongest = rows
    .filter((r) => str(r.leader) === leaderName)
    .map((r) => ({ name: str(r.name) ?? "", delta: num(r.delta_ms) ?? 0 }))
    .sort((x, y) => y.delta - x.delta)
    .slice(0, 3)
    .map((x) => x.name)
    .filter(Boolean);

  const venue = str(rows[0].location);
  const year = num(rows[0].year);
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");

  const title = venueYear ? `Minisector Dominance — ${venueYear}` : "Minisector Dominance";
  const subtitle = [venueYear || venue, `${aSurname} vs ${bSurname}`, "by best-run speed · whole lap"]
    .filter(Boolean)
    .join(" · ");

  const metrics: InsightFieldMetric[] = [
    { label: `${leaderSurname} minisectors`, value: String(leaderCount), context: "faster (best run)", emphasis: true },
    { label: `${trailerSurname} minisectors`, value: String(trailerCount) },
    { label: "Total minisectors", value: String(total) }
  ];

  const takeaways: string[] = [
    `${leaderSurname} faster in ${leaderCount} of ${total} minisectors (${leaderCount - trailerCount > 0 ? "+" : ""}${leaderCount - trailerCount} net)`,
    strongest.length ? `${leaderSurname}'s biggest margins: ${strongest.join(", ")}` : `${leaderSurname} held the bigger margins`,
    `${trailerSurname} faster in ${trailerCount} minisectors`,
    `Dominance is each driver's BEST run per minisector (top speed through it), not a lap-time delta`,
    `Whole-lap view — the data has no sector (1/2/3) mapping to isolate a single sector`
  ];

  const answer =
    `Across ${total} minisectors${venueYear ? ` at ${venueYear}` : ""}, ${leaderSurname} was faster (best-run speed) in ${leaderCount} ` +
    `and ${trailerSurname} in ${trailerCount}.` +
    (strongest.length ? ` ${leaderSurname}'s strongest gains came at ${strongest.join(", ")}.` : "") +
    ` This compares each driver's best run through each minisector (speed, km/h), not lap time, and covers the whole lap — ` +
    `the data has no sector boundary mapping, so it can't be narrowed to a single sector.`;

  return {
    answer,
    insight: {
      title,
      subtitle,
      metrics,
      key_takeaways: takeaways,
      related_questions: [
        `Compare ${aSurname} and ${bSurname} fastest-lap sector times`,
        `Which corners cost ${trailerSurname} the most time?`,
        `Show ${aSurname} vs ${bSurname} top speed`
      ]
    }
  };
}
