import type { InsightFields, InsightFieldMetric } from "@/lib/chatTypes";

/**
 * Deterministic insight builder for the `single_driver_pit_cycle` template.
 *
 * The deterministic-SQL path is intentionally LLM-free (see
 * src/lib/zeroLlmGuard.ts — calling the synthesis LLM on a
 * generationSource="deterministic_template" request throws outside
 * production). So instead of routing pit-cycle rows through the synthesis
 * prompt, we build the card's title / metric tiles / takeaways / follow-ups
 * directly from the rows. This keeps the path zero-LLM AND makes every tile
 * exactly faithful to the data (no model drift) — which is what the
 * "derive what we can, flag gaps" contract wants.
 *
 * The chart itself (pit_event_strip strip + position flow) is still attached
 * client-side by the detector registry from these same rows; this module only
 * produces the surrounding InsightFields + a plain-language answer.
 */

type Row = Record<string, unknown>;

const ORDINALS = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth"];

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
  const parts = fullName.trim().split(/\s+/);
  const last = parts[parts.length - 1] ?? fullName;
  if (!last) return fullName;
  // Names arrive UPPERCASE in this warehouse ("Max VERSTAPPEN"); title-case
  // the surname for display.
  return last[0].toUpperCase() + last.slice(1).toLowerCase();
}

function ordinalWord(seq: number | null): string {
  if (seq && seq >= 1 && seq < ORDINALS.length) return ORDINALS[seq];
  if (seq) return `${seq}th`;
  return "First";
}

function fmtSeconds(v: number): string {
  return v.toFixed(1);
}

// Compounds arrive UPPERCASE ("MEDIUM", "HARD"); title-case for display.
function fmtCompound(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
}

export type PitCycleInsightResult = {
  answer: string;
  insight: InsightFields;
};

/**
 * Build the answer + InsightFields for a single_driver_pit_cycle result set.
 * Returns null when the rows don't carry the expected pit-cycle columns
 * (caller then falls back to the generic deterministic answer).
 */
export function buildPitCycleInsight(rows: Row[] | undefined): PitCycleInsightResult | null {
  if (!rows || rows.length === 0) return null;
  const r0 = rows[0];
  const stopLap = num(r0.stop_lap);
  if (stopLap === null) return null; // not a pit-cycle shape

  const fullName = str(r0.full_name) ?? "Driver";
  const surname = lastName(fullName);
  const seq = num(r0.pit_sequence);
  const ordinal = ordinalWord(seq);
  const ordinalLower = ordinal.toLowerCase();
  const loss = num(r0.total_pit_loss_s);
  const rawCompoundBefore = str(r0.compound_before);
  const rawCompoundAfter = str(r0.compound_after);
  const compoundBefore = rawCompoundBefore ? fmtCompound(rawCompoundBefore) : null;
  const compoundAfter = rawCompoundAfter ? fmtCompound(rawCompoundAfter) : null;
  const before = num(r0.before_position);
  const after = num(r0.after_position);
  const recovered = num(r0.recovered_by_lap);
  const country = str(r0.country_name);
  const year = num(r0.year);
  const sessionName = str(r0.session_name) ?? "Race";

  const venueYear = [country, year !== null ? String(year) : null].filter(Boolean).join(" ");
  const title = venueYear
    ? `${surname} ${ordinal} Stop — ${venueYear}`
    : `${surname} ${ordinal} Stop`;
  const subtitle = [
    year !== null ? `${year} ${country ?? ""} Grand Prix`.trim() : country,
    sessionName
  ]
    .filter(Boolean)
    .join(" · ");

  // --- Metric tiles (derive what we can) ---
  const metrics: InsightFieldMetric[] = [
    // No unit — this is a lap *number* ("lap 12"), not a count of laps.
    { label: "Stop Lap", value: String(stopLap), context: surname, emphasis: true }
  ];
  const stationary = num(r0.stationary_s);
  if (loss !== null) {
    metrics.push({
      label: "Pit-Lane Loss",
      value: fmtSeconds(loss),
      unit: "s",
      context: stationary !== null ? "total time lost" : "total pit-lane loss — stationary time not recorded"
    });
  }
  if (compoundBefore && compoundAfter) {
    metrics.push({ label: "Tyre Swap", value: `${compoundBefore} → ${compoundAfter}` });
  }

  // --- Key takeaways ---
  const takeaways: string[] = [];
  if (compoundBefore && compoundAfter) {
    takeaways.push(`${ordinal} stop on lap ${stopLap} — ${compoundBefore} off, fresh ${compoundAfter} on`);
  } else {
    takeaways.push(`${ordinal} stop came on lap ${stopLap}`);
  }
  if (loss !== null) {
    takeaways.push(
      `Pit-lane time loss of ${fmtSeconds(loss)}s on the stop${stationary === null ? " (total pit-lane transit — the stationary/box time itself isn't recorded)" : ""}`
    );
  }
  if (before !== null && after !== null) {
    const recoveryClause = recovered !== null ? `, back to P${before} by lap ${recovered}` : "";
    takeaways.push(`Track position cycled P${before} → P${after}${recoveryClause}`);
  } else {
    takeaways.push(`Track position right around the stop isn't captured in the data`);
  }

  // --- Follow-up chips ---
  const venueForFollowUp = venueYear || "this race";
  const related: string[] = [];
  related.push(
    seq && seq >= 1
      ? `What was ${surname}'s ${ordinalWord(seq + 1).toLowerCase()} stop and compound?`
      : `What was ${surname}'s next stop and compound?`
  );
  related.push(`Compare pit-lane losses field-wide at ${venueForFollowUp}`);
  related.push(`Undercut window around lap ${stopLap}`);

  // --- Plain-language answer ---
  let answer: string;
  if (compoundBefore && compoundAfter) {
    answer = `${fullName}'s ${ordinalLower} stop came on lap ${stopLap}, switching from ${compoundBefore} to a fresh ${compoundAfter}.`;
  } else {
    answer = `${fullName}'s ${ordinalLower} stop came on lap ${stopLap}.`;
  }
  if (loss !== null) {
    answer += ` The pit-lane time loss was ${fmtSeconds(loss)}s.`;
  }
  if (before !== null && after !== null) {
    answer +=
      recovered !== null
        ? ` He cycled from P${before} to P${after}, recovering to P${before} by lap ${recovered}.`
        : ` He cycled from P${before} to P${after} around the stop.`;
  } else {
    answer += ` Track position right around the stop isn't fully captured in the data.`;
  }

  return {
    answer,
    insight: {
      title,
      subtitle,
      metrics,
      key_takeaways: takeaways,
      related_questions: related
    }
  };
}
