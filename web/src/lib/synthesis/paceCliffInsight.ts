import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/**
 * Deterministic insight builder for the `single_driver_pace_cliff` template.
 *
 * Like the pit-cycle builder, the deterministic-SQL path is LLM-free (see
 * src/lib/zeroLlmGuard.ts), so we build the verdict / metric tiles /
 * takeaways directly from the pre-stop stint rows. This makes the answer
 * reproducible (the previous LLM path flipped YES/NO run-to-run on identical
 * data) and keeps the language honest: the data has NO graining / tyre-temp
 * signal, so we report a PACE cliff "consistent with graining", never assert
 * graining as the cause.
 *
 * The lap-pace line chart is attached client-side by the
 * line_with_stint_markers detector from these same rows (it reads
 * is_cliff_onset / is_pit_lap for the markers).
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
function truthy(v: unknown): boolean {
  return v === true || v === "true" || v === "t";
}
function lastName(fullName: string): string {
  const last = fullName.trim().split(/\s+/).pop() ?? fullName;
  return last ? last[0].toUpperCase() + last.slice(1).toLowerCase() : fullName;
}
function fmtCompound(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
}
// Lap times render as m:ss.mmm above 60s, else raw seconds.
function fmtLap(sec: number): string {
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s.toFixed(3).padStart(6, "0")}`;
  }
  return `${sec.toFixed(3)}s`;
}
function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(3)}`;
}

export type PaceCliffInsightResult = {
  answer: string;
  insight: InsightFields;
};

export function buildPaceCliffInsight(rows: Row[] | undefined): PaceCliffInsightResult | null {
  if (!rows || rows.length === 0) return null;
  const r0 = rows[0];
  // Must look like pace-cliff rows.
  if (!("lap_duration" in r0) || !("is_cliff_onset" in r0)) return null;

  const fullName = str(r0.full_name) ?? "Driver";
  const surname = lastName(fullName);
  // Prefer the circuit location ("Imola") over country ("Italy"), which is
  // ambiguous (Imola = Emilia-Romagna GP, Monza = Italian GP, both Italy).
  const venue = str(r0.location) ?? str(r0.country_name);
  const year = num(r0.year);
  const sessionName = str(r0.session_name) ?? "Race";
  const pitLap = num(r0.first_pit_lap);

  // Green (non-pit) laps for the stint baseline + best.
  const green = rows.filter((r) => !truthy(r.is_pit_lap) && !truthy(r.is_pit_out_lap));
  const greenDurs = green
    .map((r) => ({ lap: num(r.lap_number), dur: num(r.lap_duration) }))
    .filter((x): x is { lap: number; dur: number } => x.lap !== null && x.dur !== null);
  if (greenDurs.length === 0) return null;
  const best = greenDurs.reduce((a, b) => (b.dur < a.dur ? b : a));

  // Most common compound across the stint.
  const compoundCounts = new Map<string, number>();
  for (const r of green) {
    const c = str(r.compound_name);
    if (c) compoundCounts.set(c, (compoundCounts.get(c) ?? 0) + 1);
  }
  const compoundRaw = [...compoundCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const compound = compoundRaw ? fmtCompound(compoundRaw) : null;

  const cliffRow = rows.find((r) => truthy(r.is_cliff_onset));
  const cliffLap = cliffRow ? num(cliffRow.lap_number) : null;
  const cliffDelta = cliffRow ? num(cliffRow.delta_vs_rolling_avg) : null;
  const cliffTyreAge = cliffRow ? num(cliffRow.tyre_age_on_lap) : null;
  const hasCliff = cliffLap !== null;

  // Pit lap time (the in-lap) for the metric tile.
  const pitRow = rows.find((r) => truthy(r.is_pit_lap)) ?? (pitLap !== null ? rows.find((r) => num(r.lap_number) === pitLap) : undefined);
  const pitLapTime = pitRow ? num(pitRow.lap_duration) : null;

  const venueYear = [venue, year !== null ? String(year) : null].filter(Boolean).join(" ");
  const compoundTitle = compound ? `${compound} Tyre ` : "";
  const title = venueYear
    ? `${surname} ${compoundTitle}Pace Cliff — ${venueYear}`
    : `${surname} ${compoundTitle}Pace Cliff`;
  // Range reflects the laps actually shown (lap 1 / standing start is dropped
  // upstream), so the subtitle and the chart x-axis agree.
  const firstLap = rows.map((r) => num(r.lap_number)).filter((n): n is number => n !== null).sort((a, b) => a - b)[0] ?? null;
  const stintRange =
    firstLap !== null && pitLap !== null
      ? `Stint 1, laps ${firstLap}–${pitLap}`
      : "Opening stint";
  const subtitle = [venueYear || venue, sessionName, stintRange].filter(Boolean).join(" · ");

  // --- Metrics ---
  const metrics: InsightFieldMetric[] = [];
  if (hasCliff) {
    metrics.push({
      label: "Cliff onset",
      value: `Lap ${cliffLap}`,
      context: cliffDelta !== null ? `${signed(cliffDelta)}s vs rolling avg` : undefined,
      emphasis: true
    });
  } else {
    metrics.push({ label: "Cliff onset", value: "None", context: "no sustained step", emphasis: true });
  }
  metrics.push({
    label: "Stint best",
    value: fmtLap(best.dur),
    context: `lap ${best.lap}`
  });
  if (pitLap !== null) {
    // Keep the tile value short (avoids truncation in the 3-col grid);
    // push the in-lap time + tyre age into the context line.
    metrics.push({
      label: "Pit stop lap",
      value: `Lap ${pitLap}`,
      context: [
        pitLapTime !== null ? `in-lap ${fmtLap(pitLapTime)}` : null,
        cliffTyreAge !== null ? `tyre age ${cliffTyreAge}` : null
      ]
        .filter(Boolean)
        .join(" · ") || undefined
    });
  }

  // --- Takeaways ---
  const takeaways: string[] = [];
  takeaways.push(`Stint best of ${fmtLap(best.dur)} on lap ${best.lap}${hasCliff && cliffLap ? `; pace held through lap ${cliffLap - 1}` : ""}`);
  if (hasCliff && cliffLap !== null) {
    if (cliffDelta !== null) {
      takeaways.push(`Lap ${cliffLap} broke the threshold: ${signed(cliffDelta)}s above the 3-lap rolling average`);
    }
    if (pitLap !== null && pitLap > cliffLap) {
      takeaways.push(`Laps ${cliffLap}–${pitLap - 1} stayed elevated — a sustained step, not a one-off`);
      takeaways.push(`Pit stop on lap ${pitLap}, ${pitLap - cliffLap} lap(s) after cliff onset — reactive, not pre-planned`);
    }
  } else {
    takeaways.push(`No green lap exceeded the rolling-average threshold before the stop — pace held flat`);
  }
  takeaways.push(`Inferred from lap-time pace; per-tyre graining isn't directly measured in the data`);

  // --- Verdict (honest: pace cliff, "consistent with graining") ---
  const verdict: NonNullable<InsightFields["verdict"]> = hasCliff
    ? {
        label: "YES",
        color: "#22C55E",
        summary:
          `Pace cliff onset lap ${cliffLap}` +
          (cliffDelta !== null ? ` (${signed(cliffDelta)}s vs rolling avg)` : "") +
          (pitLap !== null ? `, stop lap ${pitLap}` : "") +
          ` — consistent with graining`
      }
    : {
        label: "NO",
        summary: `No sustained pace cliff before the stop — pace held within the rolling-average band`
      };

  // --- Answer body ---
  let answer: string;
  if (hasCliff && cliffLap !== null) {
    const tyrePhrase = compound ? `${compound} tyres` : "tyres";
    answer =
      `${fullName}'s pace on ${tyrePhrase} showed a sustained step-change beginning on lap ${cliffLap}` +
      (cliffDelta !== null ? ` (${signed(cliffDelta)}s above the 3-lap rolling average)` : "") +
      `, holding elevated through the stop` +
      (pitLap !== null ? ` on lap ${pitLap}` : "") +
      `. The stint best was ${fmtLap(best.dur)} (lap ${best.lap}). This is a pace cliff consistent with graining; the data carries no direct tyre-graining or temperature signal, so the cause is inferred from lap times rather than measured.`;
  } else {
    answer =
      `${fullName}'s pace held within the rolling-average band through the pre-stop stint (best ${fmtLap(best.dur)} on lap ${best.lap}), so no sustained pace cliff is evident before the stop. Note the data has no direct graining signal — this is a lap-time inference only.`;
  }

  return {
    answer,
    insight: {
      title,
      subtitle,
      verdict,
      metrics,
      key_takeaways: takeaways,
      related_questions: [
        `How did ${surname}'s pace recover after the stop?`,
        `Compare stint-1 degradation across the front-runners at ${venueYear || "this race"}`,
        `What compound and tyre age did ${surname} run in stint 1?`
      ]
    }
  };
}
