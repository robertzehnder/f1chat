import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `driver_pair_corner_delta` (A5). One row per
 *  corner with each driver's best entry/apex/exit speed and signed phase
 *  deltas (A - B, positive = A carried more speed). The at-a-glance line
 *  names who owned more corners on apex speed + the biggest single swing.
 *
 *  NB (A5 P0): InsightFields.verdict is the literal union "YES" | "NO"
 *  (chatTypes.ts) — a corner-delta card has no yes/no answer, so we route
 *  the summary sentence into `at_a_glance` (free-form) rather than forcing a
 *  wrong YES/NO badge. */

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

export type CornerDeltaInsightResult = { answer: string; insight: InsightFields };

export function buildCornerDeltaInsight(rows: Row[] | undefined): CornerDeltaInsightResult | null {
  if (!rows || rows.length === 0) return null;
  if (!("corner_delta_kind" in rows[0]) || !("apex_delta_kph" in rows[0])) return null;

  const aName = str(rows[0].a_driver_name) ?? "Driver A";
  const bName = str(rows[0].b_driver_name) ?? "Driver B";
  const aLast = lastName(aName);
  const bLast = lastName(bName);

  type C = { label: string; entry: number | null; apex: number | null; exit: number | null };
  const corners: C[] = [];
  for (const r of rows) {
    const label = str(r.corner_label);
    if (!label) continue;
    corners.push({
      label,
      entry: num(r.entry_delta_kph),
      apex: num(r.apex_delta_kph),
      exit: num(r.exit_delta_kph)
    });
  }
  const apexCorners = corners.filter((c) => c.apex !== null) as Array<C & { apex: number }>;
  if (apexCorners.length === 0) return null;

  const EVEN_KPH = 1;
  const aWon = apexCorners.filter((c) => c.apex >= EVEN_KPH);
  const bWon = apexCorners.filter((c) => c.apex <= -EVEN_KPH);
  const even = apexCorners.length - aWon.length - bWon.length;
  const meanApex = apexCorners.reduce((s, c) => s + c.apex, 0) / apexCorners.length;
  const overallLeader = meanApex >= 0 ? aLast : bLast;
  const overallTrailer = meanApex >= 0 ? bLast : aLast;
  const leaderWonCount = meanApex >= 0 ? aWon.length : bWon.length;

  const biggest = [...apexCorners].sort((x, y) => Math.abs(y.apex) - Math.abs(x.apex))[0];
  const biggestLeader = biggest.apex >= 0 ? aLast : bLast;

  const venue = str(rows[0].location) ?? str(rows[0].country_name);
  const year = num(rows[0].year);
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");

  // A5 P0: no yes/no verdict — route the summary into the free-form
  // at_a_glance line rendered above the metric tiles.
  const atAGlance =
    `${overallLeader} carried more apex speed at ${leaderWonCount} of ${apexCorners.length} corners ` +
    `(${Math.abs(meanApex).toFixed(1)} km/h average edge over ${overallTrailer}); ` +
    `biggest swing at ${biggest.label} (${biggestLeader} by ${Math.abs(biggest.apex).toFixed(1)} km/h).`;

  const metrics: InsightFieldMetric[] = [...apexCorners]
    .sort((x, y) => Math.abs(y.apex) - Math.abs(x.apex))
    .slice(0, 3)
    .map((c, i) => ({
      label: c.label,
      value: `${c.apex >= 0 ? "+" : ""}${c.apex.toFixed(1)} km/h`,
      context:
        Math.abs(c.apex) < EVEN_KPH
          ? `even on apex (${aLast} − ${bLast})`
          : `${c.apex > 0 ? aLast : bLast} quicker (${aLast} − ${bLast} apex)`,
      emphasis: i === 0
    }));

  const takeaways = [
    `Apex-speed corners won: ${aLast} ${aWon.length}, ${bLast} ${bWon.length}${even ? `, even ${even}` : ""} (of ${apexCorners.length})`,
    `Average apex edge: ${overallLeader} by ${Math.abs(meanApex).toFixed(1)} km/h`,
    `Biggest swing: ${biggest.label}, ${biggestLeader} by ${Math.abs(biggest.apex).toFixed(1)} km/h`,
    `Deltas are each driver's BEST phase speed per corner across their valid laps (max entry, min apex, max exit) — telemetry corner samples, not continuous traces`
  ];

  const answer =
    `Across ${apexCorners.length} corners at ${venueYear || "this race"}, ` +
    `${overallLeader} carried more apex speed at ${leaderWonCount} of them ` +
    `(${Math.abs(meanApex).toFixed(1)} km/h average edge over ${overallTrailer}), ` +
    `with the biggest gap at ${biggest.label} (${biggestLeader} by ${Math.abs(biggest.apex).toFixed(1)} km/h). ` +
    `The map sizes each corner node by the apex-speed gap and colours it by the faster driver; the ladder ranks corners by that gap. ` +
    `Speeds are best-per-phase across each driver's valid laps from telemetry corner samples.`;

  return {
    answer,
    insight: {
      title: `Corner-by-corner — ${aLast} vs ${bLast}${venueYear ? ` · ${venueYear}` : ""}`,
      subtitle: [venueYear || venue, str(rows[0].session_name) ?? "Race", `${apexCorners.length} corners`].filter(Boolean).join(" · "),
      at_a_glance: atAGlance,
      metrics,
      key_takeaways: takeaways.slice(0, 6),
      related_questions: [
        `Where on the lap did ${aLast} and ${bLast}'s biggest apex gap open up?`,
        `Compare ${aLast} and ${bLast}'s straight-line speed at ${venueYear || "this race"}`,
        `Did the corner-speed gap track the lap-time gap?`
      ]
    }
  };
}
