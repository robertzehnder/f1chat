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

  // Driver-focused off-track mode (analyst probe u2): "did X run into the
  // gravel / run wide / have a lap deleted?" — answer from that driver's
  // rows (deletions, notes, penalties) with the cited lap and corner, and
  // say plainly when none exist. Never the penalty-points boilerplate.
  if (str(rows[0].question_mode) === "offtrack") return buildOfftrackAnswer(rows);

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


function buildOfftrackAnswer(rows: Row[]): RaceControlIncidentsInsightResult {
  const venue = str(rows[0].location) ?? str(rows[0].country_name);
  const year = num(rows[0].year);
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");
  const byDriver = new Map<string, Row[]>();
  for (const r of rows) {
    const d = str(r.driver) ?? "Race control";
    if (d === "Race control") continue;
    byDriver.set(d, [...(byDriver.get(d) ?? []), r]);
  }
  const describe = (r: Row) => {
    const lap = num(r.occurred_lap) ?? num(r.lap);
    const corner = num(r.corner);
    const action = str(r.action_status) ?? "event";
    const label = action === "lap_deleted" ? "lap-time deletion for track limits" : action.replace(/_/g, " ");
    return `lap ${lap ?? "?"}: ${label}${corner !== null ? ` at Turn ${corner}` : ""}`;
  };
  const parts: string[] = [];
  const takeaways: string[] = [];
  let total = 0;
  for (const [driver, evs] of byDriver) {
    const ordered = [...evs].sort((a, b) => (num(a.occurred_lap) ?? num(a.lap) ?? 0) - (num(b.occurred_lap) ?? num(b.lap) ?? 0));
    total += ordered.length;
    parts.push(`${driver}: ${ordered.map(describe).join("; ")}`);
    for (const r of ordered.slice(0, 3)) takeaways.push(`${driver} — ${describe(r)}`);
  }
  const answer = byDriver.size
    ? `Race control logged the following for ${[...byDriver.keys()].join(" and ")} at ${venueYear || "this session"}: ${parts.join(". ")}. ` +
      `A track-limits deletion is the feed's record of running wide at that corner; it does not describe gravel or contact, which are not in the timing data.`
    : `Race control logged no off-track, deleted-lap or incident message for the resolved drivers at ${venueYear || "this session"} — a queried absence from analytics.race_control_incidents.`;
  return {
    answer,
    insight: {
      title: `Off-track & Deleted Laps — ${venueYear || "Session"}`,
      subtitle: [venueYear || venue, `${total} logged event${total === 1 ? "" : "s"}`].filter(Boolean).join(" · "),
      metrics: [
        { label: "Logged events", value: String(total), context: [...byDriver.keys()].join(", ") || "none", emphasis: true },
        { label: "Source", value: "race control", context: "deletions, notes, stewards" }
      ],
      key_takeaways: takeaways.length ? takeaways.slice(0, 6) : ["No off-track or deleted-lap message for these drivers"],
      related_questions: [
        `Which laps were neutralised by SC, VSC or red flag at ${venueYear || "this race"}?`,
        `Show the race trace for ${venueYear || "this race"}`
      ]
    }
  };
}
