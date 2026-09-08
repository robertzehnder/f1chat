import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `session_interruptions` (analyst probe G3).
 *  Honesty contract: an absence of SC/VSC/red periods is only ever stated
 *  when the race-control feed exists and the materialised intervals are
 *  empty (sentinel row kind='none'); inferred endpoints are named, never
 *  hidden. The event timeline is attached client-side. */

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

const KIND_LABEL: Record<string, string> = { sc: "Safety car", vsc: "Virtual safety car", red: "Red flag" };

export type InterruptionsInsightResult = { answer: string; insight: InsightFields };

export function buildInterruptionsInsight(rows: Row[] | undefined): InterruptionsInsightResult | null {
  if (!rows || rows.length === 0) return null;
  if (!("kind" in rows[0]) || !("race_control_rows" in rows[0])) return null;

  const venue = str(rows[0].location) ?? str(rows[0].country_name);
  const year = num(rows[0].year);
  const sessionName = str(rows[0].session_name) ?? "Race";
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");
  const rcRows = num(rows[0].race_control_rows) ?? 0;

  const pitRows = rows.filter((r) => (str(r.kind) ?? "").startsWith("pit_under_"));
  const periods = rows.filter((r) => { const k = str(r.kind) ?? ""; return k !== "none" && !k.startsWith("pit_under_"); });
  if (periods.length === 0) {
    const answer =
      `The race-control feed for ${venueYear || "this session"} (${rcRows} messages) records no safety car, virtual safety car or red-flag period. ` +
      `That is a queried absence from analytics.racing_state_intervals, not an inference from lap times.`;
    return {
      answer,
      insight: {
        title: `No Interruptions — ${venueYear || "Session"}`,
        subtitle: [venueYear || venue, sessionName, `${rcRows} race-control messages`].filter(Boolean).join(" · "),
        metrics: [
          { label: "SC / VSC / red periods", value: "0", context: "queried from race control", emphasis: true },
          { label: "Race-control messages", value: String(rcRows), context: "feed present" }
        ],
        key_takeaways: [`No neutralisation periods in the race-control feed for ${venueYear || "this session"}`],
        related_questions: [`Show the steward incidents at ${venueYear || "this race"}`]
      }
    };
  }

  const counts = { sc: 0, vsc: 0, red: 0 } as Record<string, number>;
  let lapsAffected = 0;
  let inferred = 0;
  const lines: string[] = [];
  for (const p of periods) {
    const kind = str(p.kind) ?? "sc";
    counts[kind] = (counts[kind] ?? 0) + 1;
    const startLap = num(p.lap), endLap = num(p.end_lap), la = num(p.laps_affected), dur = num(p.duration_s);
    if (la !== null) lapsAffected += la;
    const inf = str(p.endpoint_inferred);
    if (inf) inferred++;
    const span = startLap !== null ? (endLap !== null && endLap !== startLap ? `laps ${startLap}–${endLap}` : `lap ${startLap}`) : "lap unknown";
    const durTxt = dur !== null ? (dur >= 120 ? `${(dur / 60).toFixed(0)} min` : `${dur.toFixed(0)}s`) : "";
    lines.push(`${KIND_LABEL[kind] ?? kind}: ${span}${durTxt ? ` (${durTxt})` : ""}${inf ? `, end ${inf.replace(/_/g, " ")}` : ""}`);
  }

  const pitsByKind = new Map<string, string[]>();
  for (const p of pitRows) {
    const k = (str(p.kind) ?? "").replace("pit_under_", "");
    const who = `${str(p.driver) ?? "?"} L${num(p.lap) ?? "?"} ${str(p.message) ?? ""}`;
    pitsByKind.set(k, [...(pitsByKind.get(k) ?? []), who]);
  }
  const pitLines = [...pitsByKind.entries()].map(([k, who]) => `Stops under the ${KIND_LABEL[k]?.toLowerCase() ?? k}: ${who.join(", ")}`);

  const takeaways = [
    ...lines.slice(0, 5),
    ...pitLines,
    inferred
      ? `${inferred} period end(s) are inferred (this feed has no "VSC ENDED"; VSC closes at the end of the ENDING lap unless a later clear message exists)`
      : `All period endpoints come from explicit race-control messages`
  ];

  const metrics: InsightFieldMetric[] = [
    { label: "Neutralisations", value: String(periods.length), context: `SC ${counts.sc} · VSC ${counts.vsc} · red ${counts.red}`, emphasis: true },
    { label: "Laps affected", value: String(lapsAffected), context: inferred ? `${inferred} endpoint(s) inferred` : "explicit endpoints" },
    { label: "Stops under caution", value: String(pitRows.length), context: pitRows.length ? [...pitsByKind.entries()].map(([k, w]) => `${k.toUpperCase()} ${w.length}`).join(" · ") : "none (red-flag tyre changes excluded)" },
    { label: "Race-control messages", value: String(rcRows), context: "source feed" }
  ];

  const answer =
    `${venueYear || "This session"} had ${periods.length} neutralisation period${periods.length === 1 ? "" : "s"}: ` +
    lines.join("; ") +
    `. ${lapsAffected} lap${lapsAffected === 1 ? "" : "s"} ran under SC, VSC or red-flag conditions` +
    (pitLines.length ? `. ${pitLines.join("; ")}` : "") +
    (counts.vsc ? `. Any claim that the race was decided on pure pace has to account for the VSC-priced pit stops` : "") +
    `.`;

  return {
    answer,
    insight: {
      title: `Interruptions — ${venueYear || "Session"}`,
      subtitle: [venueYear || venue, sessionName, `${periods.length} periods`].filter(Boolean).join(" · "),
      metrics,
      key_takeaways: takeaways.slice(0, 6),
      related_questions: [
        `Which drivers pitted under the safety car or VSC at ${venueYear || "this race"}?`,
        `Show the race trace with safety-car bands for ${venueYear || "this race"}`,
        `What steward incidents were logged at ${venueYear || "this race"}?`
      ]
    }
  };
}
