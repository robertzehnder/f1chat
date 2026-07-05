import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/** Deterministic insight for `session_race_trace`.
 *  Rows: one per (driver, lap) with cumulative gap to leader, pit flags,
 *  SC/VSC-neutralized flags, and is_focus on the question's pair. Two
 *  modes via analysis_kind: 'trace' (race story) and 'pit_cycle'
 *  (deterministic over/under-cut verdict — the M02 family). */

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
function truthy(v: unknown): boolean {
  return v === true || v === "true" || v === "t";
}
function lastName(fullName: string): string {
  const last = fullName.trim().split(/\s+/).pop() ?? fullName;
  return last ? last[0].toUpperCase() + last.slice(1).toLowerCase() : fullName;
}
function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(3)}`;
}

type DriverTrace = {
  name: string;
  surname: string;
  focus: boolean;
  /** The first-mentioned driver in the question — for over-cut prompts,
   *  the one the user asked about ("Did X over-cut Y"). */
  subject: boolean;
  finish: number | null;
  gaps: Map<number, number>;
  pitLaps: number[];
};

export type RaceTraceInsightResult = { answer: string; insight: InsightFields };

export function buildRaceTraceInsight(rows: Row[] | undefined): RaceTraceInsightResult | null {
  if (!rows || rows.length === 0) return null;
  if (!("gap_to_leader_s" in rows[0]) || !("analysis_kind" in rows[0])) return null;

  const venue = str(rows[0].location) ?? str(rows[0].country_name);
  const year = num(rows[0].year);
  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");
  const kind = str(rows[0].analysis_kind) ?? "trace";

  const byDriver = new Map<number, DriverTrace>();
  const neutralizedLaps = new Set<number>();
  let maxLap = 0;
  for (const r of rows) {
    const n = num(r.driver_number);
    const lap = num(r.lap_number);
    const gap = num(r.gap_to_leader_s);
    if (n === null || lap === null || gap === null) continue;
    maxLap = Math.max(maxLap, lap);
    if (truthy(r.is_neutralized)) neutralizedLaps.add(lap);
    let d = byDriver.get(n);
    if (!d) {
      const name = str(r.driver_name) ?? `Driver #${n}`;
      d = {
        name,
        surname: lastName(name),
        focus: truthy(r.is_focus),
        subject: truthy(r.is_subject),
        finish: num(r.finish_position),
        gaps: new Map(),
        pitLaps: []
      };
      byDriver.set(n, d);
    }
    d.gaps.set(lap, gap);
    if (truthy(r.is_pit_lap)) d.pitLaps.push(lap);
  }
  const drivers = [...byDriver.values()];
  if (drivers.length < 2) return null;

  // SC windows as contiguous ranges for the takeaways.
  const scLaps = [...neutralizedLaps].sort((a, b) => a - b);
  const scWindows: Array<[number, number]> = [];
  for (const lap of scLaps) {
    const last = scWindows[scWindows.length - 1];
    if (last && lap === last[1] + 1) last[1] = lap;
    else scWindows.push([lap, lap]);
  }

  const finishers = drivers
    .filter((d) => d.finish !== null)
    .sort((a, b) => (a.finish ?? 99) - (b.finish ?? 99));
  const winner = finishers[0];
  const runnerUp = finishers[1];
  const finalGap = runnerUp?.gaps.get(maxLap) ?? null;

  // --- pit_cycle mode: over/under-cut verdict on the focus pair ---
  let verdict: InsightFields["verdict"];
  let cycleSentence = "";
  let cutLede = "";
  const focus = drivers.filter((d) => d.focus);
  if (kind === "pit_cycle" && focus.length === 2) {
    const [a, b] = focus;
    const aPit = a.pitLaps[0];
    const bPit = b.pitLaps[0];
    if (aPit !== undefined && bPit !== undefined && aPit !== bPit) {
      const later = aPit > bPit ? a : b; // the over-cutter stays out longer
      const earlier = later === a ? b : a;
      const before = Math.min(aPit, bPit) - 1;
      const after = Math.max(aPit, bPit) + 1;
      const rel = (lap: number): number | null => {
        const ga = later.gaps.get(lap);
        const gb = earlier.gaps.get(lap);
        return ga !== undefined && gb !== undefined ? ga - gb : null;
      };
      const relBefore = rel(before);
      const relAfter = rel(after);
      if (relBefore !== null && relAfter !== null) {
        const aheadBefore = relBefore < 0;
        const aheadAfter = relAfter < 0;
        const swing = relBefore - relAfter; // positive = later-stopper gained
        const worked = !aheadBefore && aheadAfter;
        // Name who was ahead at each reference lap — a signed "A-vs-B gap"
        // leaves the reader doing the sign arithmetic.
        const beforeLead = `${aheadBefore ? later.surname : earlier.surname} was ${Math.abs(relBefore).toFixed(3)}s ahead on lap ${before}, before the stops`;
        const afterLead = `${aheadAfter ? later.surname : earlier.surname} was ${Math.abs(relAfter).toFixed(3)}s ahead on lap ${after}, after both had stopped`;
        // When the question's subject (first-mentioned driver) pitted
        // FIRST, they were under-cutting — "did X execute the over-cut"
        // has a failed premise and saying "the over-cut didn't deliver"
        // inverts who attempted what (seed-7 Las Vegas incident).
        const subject = focus.find((d) => d.subject);
        const subjectWasEarlier = subject !== undefined && subject === earlier;
        // Four distinct stories, not two: "the over-cut didn't deliver" is
        // misleading when the later stopper was already ahead (no pass was
        // ever needed) or when staying out actually cost the place.
        if (subjectWasEarlier) {
          verdict = {
            label: "NO",
            summary: `${subject.surname} stopped first (lap ${Math.min(aPit, bPit)}) — that's an under-cut attempt, not an over-cut; ${later.surname} stayed out to lap ${Math.max(aPit, bPit)}: ${beforeLead}; ${afterLead}`
          };
          cutLede = `${subject.surname} could not have executed an over-cut here — ${subject.surname} stopped first (lap ${Math.min(aPit, bPit)}), which is an under-cut attempt; ${later.surname} was the one staying out.`;
        } else if (worked) {
          verdict = {
            label: "YES",
            color: "#22C55E",
            summary: `${later.surname} stayed out to lap ${Math.max(aPit, bPit)} and emerged ahead of ${earlier.surname}: ${beforeLead}; ${afterLead} (${signed(swing)}s swing to ${later.surname})`
          };
          cutLede = `The over-cut worked.`;
        } else if (aheadBefore && aheadAfter) {
          verdict = {
            label: "NO",
            summary: `No over-cut pass happened — ${later.surname} was already ahead of ${earlier.surname} before the pit cycle and stayed there: ${beforeLead}; ${afterLead}${swing > 0 ? ` (${later.surname} stretched it by ${signed(swing)}s)` : ` (${earlier.surname} closed by ${signed(-swing)}s but not enough)`}`
          };
          cutLede = `There was no over-cut pass to make — ${later.surname}, the later stopper, was already ahead of ${earlier.surname} and stayed there.`;
        } else if (aheadBefore && !aheadAfter) {
          verdict = {
            label: "NO",
            color: "#EF4444",
            summary: `Staying out backfired — ${later.surname} was ahead before the stops but lost the place to ${earlier.surname} through the cycle: ${beforeLead}; ${afterLead}`
          };
          cutLede = `Staying out backfired — ${later.surname} lost the place through the pit cycle.`;
        } else {
          verdict = {
            label: "NO",
            summary: `${later.surname} stayed out longer but did not take the place from ${earlier.surname}: ${beforeLead}; ${afterLead}${swing > 0 ? ` (${later.surname} gained ${signed(swing)}s, not enough)` : ` (${earlier.surname} gained ${signed(-swing)}s through the cycle)`}`
          };
          cutLede = `The over-cut did not deliver track position.`;
        }
        cycleSentence = ` Across the pit cycle (${earlier.surname} stopped on lap ${Math.min(aPit, bPit)}, ${later.surname} on lap ${Math.max(aPit, bPit)}): ${beforeLead}; ${afterLead}.`;
      }
    }
  }

  const metrics: InsightFieldMetric[] = [
    {
      label: "Winner",
      value: winner ? winner.surname : "n/a",
      context: runnerUp && finalGap !== null ? `${signed(finalGap)}s over ${runnerUp.surname}` : undefined,
      emphasis: true
    },
    {
      label: "SC/VSC windows",
      value: String(scWindows.length),
      context: scWindows.length ? scWindows.map(([a, b]) => (a === b ? `lap ${a}` : `laps ${a}–${b}`)).join(" · ") : "none detected"
    },
    { label: "Drivers traced", value: String(drivers.length), context: `top finishers${focus.length ? " + focus pair" : ""}` }
  ];

  const takeaways = [
    winner && runnerUp && finalGap !== null
      ? `${winner.surname} won by ${finalGap.toFixed(3)}s over ${runnerUp.surname}`
      : `Final gaps from cumulative race time`,
    scWindows.length
      ? `Neutralized ${scWindows.map(([a, b]) => (a === b ? `lap ${a}` : `laps ${a}–${b}`)).join(", ")} (detected from synchronized lap-time spikes)`
      : `No SC/VSC neutralization detected from lap times`,
    `Gaps derived from cumulative lap times — immune to the sampled intervals feed's noise`,
    ...(cycleSentence ? [cycleSentence.trim()] : [])
  ];

  // The over-cut answer stays on the focus pair — the race winner is
  // irrelevant to a pit-cycle question and only dilutes the verdict.
  const scSentence = scWindows.length
    ? ` Shaded bands mark ${scWindows.length} neutralized window${scWindows.length === 1 ? "" : "s"} where the field compressed (inferred from synchronized lap-time spikes, not official race control data).`
    : ``;
  const gapCaveat = ` Gaps are computed from cumulative lap times.`;
  const answer =
    kind === "pit_cycle" && verdict
      ? `${cutLede}${cycleSentence}${scSentence}${gapCaveat}`
      : `The race trace at ${venueYear || "this race"}: each line is a driver's gap to the leader, lap by lap. ` +
        (winner && runnerUp && finalGap !== null
          ? `${winner.surname} controlled it, finishing ${finalGap.toFixed(3)}s clear of ${runnerUp.surname}.`
          : ``) +
        scSentence +
        gapCaveat;

  return {
    answer,
    insight: {
      title:
        kind === "pit_cycle" && focus.length === 2
          ? `Pit-Cycle Trace — ${focus[0].surname} vs ${focus[1].surname}${venueYear ? ` · ${venueYear}` : ""}`
          : `Race Trace${venueYear ? ` — ${venueYear}` : ""}`,
      subtitle: [venueYear || venue, str(rows[0].session_name) ?? "Race", `${drivers.length} drivers · ${maxLap} laps`]
        .filter(Boolean)
        .join(" · "),
      verdict,
      metrics,
      key_takeaways: takeaways.slice(0, 6),
      related_questions: [
        `Show the position changes at ${venueYear || "this race"}`,
        `Which pit stop gained the most time at ${venueYear || "this race"}?`,
        `Compare the winner's stint pace against P2`
      ]
    }
  };
}
