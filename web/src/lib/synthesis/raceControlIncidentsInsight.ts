import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `session_race_control_incidents` (M15).
 *  Honesty contract: FIA penalty POINTS are not ingested (penalty_points
 *  is NULL throughout the warehouse) — say so explicitly and report what
 *  IS recorded. The event timeline is attached client-side. */

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

export type RaceControlIncidentsInsightResult = { answer: string; insight: InsightFields };

export function buildRaceControlIncidentsInsight(rows: Row[] | undefined): RaceControlIncidentsInsightResult | null {
  if (!rows || rows.length === 0) return null;
  if (!("kind" in rows[0]) || !("penalty_points" in rows[0])) return null;

  const venue = str(rows[0].location) ?? str(rows[0].country_name);
  const year = num(rows[0].year);
  const sessionName = str(rows[0].session_name) ?? "Race";
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");

  const total = rows.length;
  const penaltySeconds = rows
    .map((r) => num(r.penalty_seconds))
    .filter((n): n is number => n !== null && n > 0);
  const penalisedCount = penaltySeconds.length;
  const totalPenaltySeconds = penaltySeconds.reduce((s, n) => s + n, 0);
  const anyPoints = rows.some((r) => num(r.penalty_points) !== null);
  const kinds = new Map<string, number>();
  for (const r of rows) {
    const k = str(r.kind) ?? "incident";
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  const topKinds = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const drivers = new Set(
    rows.map((r) => str(r.driver)).filter((d): d is string => d !== null && d !== "Race control")
  );

  const metrics: InsightFieldMetric[] = [
    { label: "Steward events", value: String(total), context: topKinds.map(([k, n]) => `${k}: ${n}`).join(" · "), emphasis: true },
    { label: "Time penalties", value: String(penalisedCount), context: penalisedCount ? `${totalPenaltySeconds.toFixed(0)}s total` : "none recorded" },
    { label: "Penalty points", value: "n/a", context: "not ingested from FIA docs" }
  ];

  const takeaways: string[] = [
    `FIA penalty POINTS are not recorded in this warehouse — a points total can't be derived`,
    `${total} race-control events logged${drivers.size ? `, ${drivers.size} drivers involved` : ""}`,
    penalisedCount
      ? `${penalisedCount} carried a time penalty (${totalPenaltySeconds.toFixed(0)}s combined)`
      : `No time penalties recorded in the event stream`,
    `Event kinds: ${topKinds.map(([k, n]) => `${k} (${n})`).join(", ")}`
  ];

  const answer = anyPoints
    ? `Penalty-point data is partially present; treat totals with caution.`
    : `FIA penalty points aren't ingested into this dataset, so a points total for ${venueYear || "this session"} can't be answered directly. ` +
      `What is recorded: ${total} race-control events` +
      (penalisedCount ? `, of which ${penalisedCount} carried time penalties totalling ${totalPenaltySeconds.toFixed(0)}s` : ", none of which carried a recorded time penalty") +
      `. The timeline below shows each steward event by lap.`;

  return {
    answer,
    insight: {
      title: `Steward Events — ${venueYear || "Session"}`,
      subtitle: [venueYear || venue, sessionName, `${total} events`].filter(Boolean).join(" · "),
      metrics,
      key_takeaways: takeaways.slice(0, 6),
      related_questions: [
        `Which laps had safety cars or red flags at ${venueYear || "this race"}?`,
        `Did any penalty change the finishing order at ${venueYear || "this race"}?`,
        `Show track-limits deletions at ${venueYear || "this race"}`
      ]
    }
  };
}
