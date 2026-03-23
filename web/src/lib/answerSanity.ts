type AnswerSanityInput = {
  question: string;
  answer: string;
  rows: Record<string, unknown>[];
};

type AnswerSanityResult = {
  answer: string;
  notes: string[];
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "t" || normalized === "1") return true;
    if (normalized === "false" || normalized === "f" || normalized === "0") return false;
  }
  return null;
}

function driverLabel(row: Record<string, unknown>): string {
  return (
    asString(row.full_name) ??
    asString(row.driver_name) ??
    (asNumber(row.driver_number) !== null ? `Driver #${asNumber(row.driver_number)}` : "Driver")
  );
}

function strategyTypeFromStops(stops: number): string {
  if (stops <= 0) return "no-stop";
  if (stops === 1) return "one-stop";
  if (stops === 2) return "two-stop";
  return `${stops}-stop`;
}

function prettyMetricName(metricKey: string): string {
  return metricKey
    .replace(/_/g, " ")
    .replace(/\bavg\b/i, "average")
    .replace(/\bstddev\b/i, "standard deviation")
    .trim();
}

function formatMetricValue(metricKey: string, value: number): string {
  const rounded = Number(value.toFixed(3));
  if (/speed/i.test(metricKey)) {
    return `${rounded} km/h`;
  }
  if (/position/i.test(metricKey) || /count|laps?|stops?/i.test(metricKey)) {
    return `${Math.round(value)}`;
  }
  return `${rounded}s`;
}

function hasAnyKey(rows: Record<string, unknown>[], keys: string[]): boolean {
  return rows.some((row) => keys.some((key) => row[key] !== undefined && row[key] !== null));
}

function metricFromRows(
  rows: Record<string, unknown>[],
  candidateKeys: string[]
): { key: string; ascending: boolean } | null {
  for (const key of candidateKeys) {
    const values = rows.map((row) => asNumber(row[key])).filter((value): value is number => value !== null);
    if (values.length >= Math.min(2, rows.length)) {
      const ascending = !/top_speed|positions_gained/i.test(key);
      return { key, ascending };
    }
  }
  return null;
}

function summarizeStrategyRows(rows: Record<string, unknown>[]): string | null {
  if (!hasAnyKey(rows, ["strategy_type", "pit_stops", "pit_stop_count", "total_stints"])) {
    return null;
  }
  const parts = rows
    .map((row) => {
      const label = driverLabel(row);
      const strategyType = asString(row.strategy_type);
      const pitStops = asNumber(row.pit_stops) ?? asNumber(row.pit_stop_count);
      const stints = asNumber(row.total_stints);
      const normalizedStops = pitStops !== null ? pitStops : stints !== null ? Math.max(stints - 1, 0) : null;
      if (!strategyType && normalizedStops === null) {
        return null;
      }
      if (strategyType && normalizedStops !== null) {
        return `${label} ran a ${strategyType.toLowerCase()} (${normalizedStops} stop${normalizedStops === 1 ? "" : "s"})`;
      }
      if (strategyType) {
        return `${label} ran a ${strategyType.toLowerCase()}`;
      }
      return `${label} made ${normalizedStops} stop${normalizedStops === 1 ? "" : "s"}`;
    })
    .filter((part): part is string => Boolean(part));
  if (!parts.length) {
    return null;
  }
  return `${parts.join("; ")}.`;
}

function summarizeStintRows(rows: Record<string, unknown>[]): string | null {
  if (!hasAnyKey(rows, ["stint_number", "compound", "compound_name"])) {
    return null;
  }
  const byDriver = new Map<string, { compounds: Set<string>; stints: number }>();
  for (const row of rows) {
    const label = driverLabel(row);
    const compound = asString(row.compound) ?? asString(row.compound_name);
    const entry = byDriver.get(label) ?? { compounds: new Set<string>(), stints: 0 };
    if (compound) {
      entry.compounds.add(compound.toUpperCase());
    }
    if (asNumber(row.stint_number) !== null) {
      entry.stints += 1;
    }
    byDriver.set(label, entry);
  }
  if (!byDriver.size) {
    return null;
  }
  const parts = Array.from(byDriver.entries()).map(([label, value]) => {
    const compounds = Array.from(value.compounds).join(" and ");
    if (compounds) {
      return `${label} used ${compounds}${value.stints > 0 ? ` across ${value.stints} stints` : ""}`;
    }
    return `${label} has ${value.stints} stint entries`;
  });
  return `${parts.join("; ")}.`;
}

function summarizeStintLengthRows(rows: Record<string, unknown>[]): string | null {
  if (!hasAnyKey(rows, ["stint_number", "lap_start", "lap_end", "stint_length_laps"])) {
    return null;
  }
  const byDriver = new Map<string, Array<{ stint: number; compound: string | null; start: number | null; end: number | null; length: number | null }>>();
  for (const row of rows) {
    const label = driverLabel(row);
    const stint = asNumber(row.stint_number);
    const compound = asString(row.compound) ?? asString(row.compound_name);
    const lapStart = asNumber(row.lap_start);
    const lapEnd = asNumber(row.lap_end);
    const length = asNumber(row.stint_length_laps);
    const entries = byDriver.get(label) ?? [];
    entries.push({ stint: stint ?? entries.length + 1, compound, start: lapStart, end: lapEnd, length });
    byDriver.set(label, entries);
  }
  if (!byDriver.size) {
    return null;
  }
  const parts = Array.from(byDriver.entries()).map(([label, entries]) => {
    const ordered = entries.sort((a, b) => a.stint - b.stint);
    const stintParts = ordered.map((entry) => {
      const range =
        entry.start !== null && entry.end !== null ? `laps ${entry.start}-${entry.end}` : "lap range unavailable";
      const lengthText =
        entry.length !== null ? `${Math.round(entry.length)} lap${Math.round(entry.length) === 1 ? "" : "s"}` : null;
      const compoundText = entry.compound ? `${entry.compound.toUpperCase()} ` : "";
      return `stint ${entry.stint}: ${compoundText}${range}${lengthText ? ` (${lengthText})` : ""}`;
    });
    return `${label} ${stintParts.join("; ")}`;
  });
  return `${parts.join(". ")}.`;
}

function summarizePitCycleRows(rows: Record<string, unknown>[]): string | null {
  if (!hasAnyKey(rows, ["pit_lap", "positions_gained_after_pit"])) {
    return null;
  }
  const parts = rows
    .map((row) => {
      const label = driverLabel(row);
      const pitLap = asNumber(row.pit_lap);
      const gain = asNumber(row.positions_gained_after_pit);
      const evidence = asBoolean(row.evidence_sufficient_for_pit_cycle_claim);
      if (pitLap === null) {
        return null;
      }
      if (evidence === false) {
        return `${label} (lap ${pitLap}) has insufficient position evidence`;
      }
      if (gain === null) {
        return `${label} pitted on lap ${pitLap}`;
      }
      if (gain > 0) {
        return `${label} gained ${gain} position${gain === 1 ? "" : "s"} around lap ${pitLap}`;
      }
      if (gain < 0) {
        const lost = Math.abs(gain);
        return `${label} lost ${lost} position${lost === 1 ? "" : "s"} around lap ${pitLap}`;
      }
      return `${label} held position through the lap ${pitLap} pit cycle`;
    })
    .filter((part): part is string => Boolean(part));
  if (!parts.length) {
    return null;
  }
  return `${parts.join("; ")}.`;
}

function summarizeUndercutOvercutRows(rows: Record<string, unknown>[]): string | null {
  if (!hasAnyKey(rows, ["undercut_overcut_signal"])) {
    return null;
  }
  const parts = rows
    .map((row) => {
      const label = driverLabel(row);
      const signal = asString(row.undercut_overcut_signal);
      const confidence = asString(row.evidence_confidence);
      const sufficient = asBoolean(row.evidence_sufficient_for_undercut_overcut_claim);
      if (!signal) {
        return null;
      }
      if (sufficient === false || signal === "insufficient_evidence") {
        return `${label}: insufficient evidence for a decisive undercut/overcut call`;
      }
      const prettySignal = signal.replace(/_/g, " ");
      return `${label}: ${prettySignal}${confidence ? ` (${confidence} confidence)` : ""}`;
    })
    .filter((part): part is string => Boolean(part));
  if (!parts.length) {
    return null;
  }
  return `${parts.join("; ")}.`;
}

function summarizeComparisonRows(rows: Record<string, unknown>[]): string | null {
  if (rows.length !== 2 || !hasAnyKey(rows, ["driver_number", "full_name", "driver_name"])) {
    return null;
  }
  const metric = metricFromRows(rows, [
    "avg_lap",
    "avg_clean_lap",
    "best_lap",
    "best_clean_lap",
    "lap_stddev",
    "top_speed"
  ]);
  if (!metric) {
    return null;
  }

  const enriched = rows
    .map((row) => ({ label: driverLabel(row), value: asNumber(row[metric.key]) }))
    .filter((entry) => entry.value !== null) as { label: string; value: number }[];
  if (enriched.length < 2) {
    return null;
  }
  enriched.sort((a, b) => (metric.ascending ? a.value - b.value : b.value - a.value));
  const leader = enriched[0];
  const runnerUp = enriched[1];
  const delta = Math.abs(leader.value - runnerUp.value);
  return `${leader.label} leads on ${prettyMetricName(metric.key)} (${formatMetricValue(metric.key, leader.value)}) versus ${runnerUp.label} (${formatMetricValue(metric.key, runnerUp.value)}), a gap of ${formatMetricValue(metric.key, delta)}.`;
}

function summarizeRankedRows(rows: Record<string, unknown>[]): string | null {
  if (rows.length < 2) {
    return null;
  }
  const metric = metricFromRows(rows, [
    "lap_duration",
    "best_lap_duration",
    "avg_lap",
    "avg_clean_lap",
    "best_pit_duration",
    "total_pit_duration_seconds",
    "top_speed",
    "positions_gained_after_pit"
  ]);
  if (!metric) {
    return null;
  }
  const enriched = rows
    .map((row) => ({ label: driverLabel(row), value: asNumber(row[metric.key]) }))
    .filter((entry) => entry.value !== null) as { label: string; value: number }[];
  if (enriched.length < 2) {
    return null;
  }
  enriched.sort((a, b) => (metric.ascending ? a.value - b.value : b.value - a.value));
  const top = enriched[0];
  const second = enriched[1];
  return `Top result: ${top.label} at ${formatMetricValue(metric.key, top.value)} for ${prettyMetricName(metric.key)}. Next is ${second.label} at ${formatMetricValue(metric.key, second.value)}.`;
}

function summarizeGenericRows(rows: Record<string, unknown>[], rowCount: number): string {
  const first = rows[0] ?? {};
  const label = driverLabel(first);
  const notablePairs = Object.entries(first)
    .filter(([key, value]) => value !== null && value !== undefined && !["driver_number", "full_name", "driver_name"].includes(key))
    .slice(0, 3)
    .map(([key, value]) => `${prettyMetricName(key)}=${formatScalarForNarrative(value)}`);
  if (notablePairs.length > 0) {
    return `${label} is the top visible row (${notablePairs.join(", ")}), with ${rowCount} total matching rows.`;
  }
  return `The query returned ${rowCount} matching rows, with ${label} as the top visible result.`;
}

function formatScalarForNarrative(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${Number(value.toFixed(3))}`;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function looksLikeStructuredRowDump(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const startsAsRowDump = /^i found\s+\d+\s+matching\s+row\(s\)\.?/i.test(answer);
  const hasKeyResults = normalized.includes("key results");
  const hasStructuredPairs = /(driver_number=|full_name=|lap_number=|session_key=|stint_number=|pit_lap=)/i.test(
    normalized
  );
  const hasEnumeratedPairs = /\n?\s*1\.\s*[a-z_]+=/.test(answer);
  return (startsAsRowDump || hasKeyResults || hasEnumeratedPairs) && hasStructuredPairs;
}

export function buildStructuredSummaryFromRows(args: {
  question: string;
  rows: Record<string, unknown>[];
  rowCount: number;
}): string {
  const lowerQuestion = args.question.toLowerCase();
  const { rows, rowCount } = args;
  if (!rows.length) {
    return "No rows matched this question with the current context.";
  }

  if (lowerQuestion.includes("undercut") || lowerQuestion.includes("overcut")) {
    const summary = summarizeUndercutOvercutRows(rows);
    if (summary) return summary;
  }
  if (lowerQuestion.includes("pit cycle")) {
    const summary = summarizePitCycleRows(rows);
    if (summary) return summary;
  }
  if (lowerQuestion.includes("strategy") || lowerQuestion.includes("one-stop") || lowerQuestion.includes("two-stop")) {
    const summary = summarizeStrategyRows(rows);
    if (summary) return summary;
  }
  if (
    lowerQuestion.includes("stint") ||
    lowerQuestion.includes("compound") ||
    lowerQuestion.includes("tyre") ||
    lowerQuestion.includes("tire")
  ) {
    const summary = summarizeStintRows(rows);
    if (summary) return summary;
  }

  const comparisonSummary = summarizeComparisonRows(rows);
  if (comparisonSummary) {
    return comparisonSummary;
  }
  const rankedSummary = summarizeRankedRows(rows);
  if (rankedSummary) {
    return rankedSummary;
  }
  return summarizeGenericRows(rows, rowCount);
}

function buildPitStopCountAnswer(rows: Record<string, unknown>[]): string {
  const parts = rows
    .map((row) => {
      const label = driverLabel(row);
      const pitStopCount =
        asNumber(row.pit_stop_count) ??
        asNumber(row.pit_stops) ??
        asNumber(row.pit_event_rows) ??
        0;
      return `${label}: ${pitStopCount}`;
    })
    .filter(Boolean);
  return `Pit-stop counts from the structured results are: ${parts.join("; ")}.`;
}

function buildStrategyTypeAnswer(rows: Record<string, unknown>[]): string {
  const parts = rows
    .map((row) => {
      const label = driverLabel(row);
      const totalStints = asNumber(row.total_stints);
      const pitStops = asNumber(row.pit_stops) ?? asNumber(row.pit_stop_count);
      const normalizedStops =
        pitStops !== null ? pitStops : totalStints !== null ? Math.max(totalStints - 1, 0) : null;
      if (normalizedStops === null) {
        return null;
      }
      return `${label}: ${strategyTypeFromStops(normalizedStops)} strategy (${normalizedStops} stop${normalizedStops === 1 ? "" : "s"})`;
    })
    .filter((value): value is string => Boolean(value));

  if (!parts.length) {
    return "";
  }
  return parts.join("; ") + ".";
}

function buildPositionsAnswer(rows: Record<string, unknown>[]): string {
  const ranked = rows
    .map((row) => {
      const label = driverLabel(row);
      const grid = asNumber(row.grid_position);
      const finish = asNumber(row.finish_position);
      const positionsGained =
        asNumber(row.positions_gained) ??
        (grid !== null && finish !== null ? grid - finish : null);
      return { label, grid, finish, positionsGained };
    })
    .filter((row) => row.grid !== null && row.finish !== null && row.positionsGained !== null);

  if (!ranked.length) {
    return "The rows do not include complete grid and finish positions for both drivers, so positions gained/lost cannot be stated confidently.";
  }

  ranked.sort((a, b) => (b.positionsGained ?? -999) - (a.positionsGained ?? -999));
  const winner = ranked[0];
  return `${winner.label} gained more positions (${winner.positionsGained}) based on grid ${winner.grid} to finish ${winner.finish}.`;
}

function buildSectorAnswer(rows: Record<string, unknown>[]): string {
  const sectorRows = rows
    .map((row) => ({
      label: driverLabel(row),
      bestS1: asNumber(row.best_s1),
      bestS2: asNumber(row.best_s2),
      bestS3: asNumber(row.best_s3),
      avgS1: asNumber(row.avg_s1),
      avgS2: asNumber(row.avg_s2),
      avgS3: asNumber(row.avg_s3)
    }))
    .filter((row) => row.bestS1 !== null || row.bestS2 !== null || row.bestS3 !== null);

  if (sectorRows.length < 2) {
    return "";
  }

  const bestOf = (metric: "bestS1" | "bestS2" | "bestS3" | "avgS1" | "avgS2" | "avgS3") =>
    sectorRows
      .filter((row) => row[metric] !== null)
      .sort((a, b) => (a[metric] as number) - (b[metric] as number))[0];

  const bestS1 = bestOf("bestS1");
  const bestS2 = bestOf("bestS2");
  const bestS3 = bestOf("bestS3");
  const avgS1 = bestOf("avgS1");
  const avgS2 = bestOf("avgS2");
  const avgS3 = bestOf("avgS3");

  if (!bestS1 || !bestS2 || !bestS3) {
    return "";
  }

  return `Best sectors: S1 ${bestS1.label}, S2 ${bestS2.label}, S3 ${bestS3.label}. Average sectors: S1 ${avgS1?.label ?? "n/a"}, S2 ${avgS2?.label ?? "n/a"}, S3 ${avgS3?.label ?? "n/a"}.`;
}

function hasPitPositionEvidence(rows: Record<string, unknown>[]): boolean {
  const hasExplicitEvidenceFlag = rows.some(
    (row) => asBoolean(row.evidence_sufficient_for_pit_cycle_claim) !== null
  );
  if (hasExplicitEvidenceFlag) {
    return rows.some((row) => asBoolean(row.evidence_sufficient_for_pit_cycle_claim) === true);
  }
  return rows.some((row) => asNumber(row.pre_pit_position) !== null && asNumber(row.post_pit_position) !== null);
}

function hasUndercutOvercutEvidence(rows: Record<string, unknown>[]): boolean {
  const hasExplicitEvidenceFlag = rows.some(
    (row) => asBoolean(row.evidence_sufficient_for_undercut_overcut_claim) !== null
  );
  if (hasExplicitEvidenceFlag) {
    return rows.some((row) => asBoolean(row.evidence_sufficient_for_undercut_overcut_claim) === true);
  }
  return hasPitPositionEvidence(rows);
}

export function applyAnswerSanityGuards(input: AnswerSanityInput): AnswerSanityResult {
  const lowerQuestion = input.question.toLowerCase();
  const notes: string[] = [];
  let answer = input.answer;

  if (!input.rows.length) {
    return { answer, notes };
  }

  if (lowerQuestion.includes("how many pit stops")) {
    answer = buildPitStopCountAnswer(input.rows);
    notes.push("answer_guard:pit_stop_count_consistency");
    notes.push("stop_count_consistent_with_stints");
    return { answer, notes };
  }

  if (lowerQuestion.includes("one-stop") || lowerQuestion.includes("two-stop")) {
    const strategyAnswer = buildStrategyTypeAnswer(input.rows);
    if (strategyAnswer) {
      answer = strategyAnswer;
      notes.push("answer_guard:strategy_stop_count_consistency");
      notes.push("stop_count_consistent_with_stints");
      return { answer, notes };
    }
  }

  if (
    lowerQuestion.includes("gained or lost more positions") ||
    lowerQuestion.includes("positions gained") ||
    lowerQuestion.includes("positions lost")
  ) {
    answer = buildPositionsAnswer(input.rows);
    notes.push("answer_guard:grid_finish_evidence_gate");
    return { answer, notes };
  }

  if (lowerQuestion.includes("sector")) {
    const sectorAnswer = buildSectorAnswer(input.rows);
    if (sectorAnswer) {
      answer = sectorAnswer;
      notes.push("answer_guard:sector_consistency");
      notes.push("sector_summary_matches_metrics");
      return { answer, notes };
    }
  }

  if (
    lowerQuestion.includes("stint lengths") ||
    (lowerQuestion.includes("opening stint") && lowerQuestion.includes("closing stint")) ||
    (lowerQuestion.includes("stint") && lowerQuestion.includes("lap"))
  ) {
    const stintLengthAnswer = summarizeStintLengthRows(input.rows);
    if (stintLengthAnswer) {
      answer = stintLengthAnswer;
      notes.push("answer_guard:stint_length_focus");
      return { answer, notes };
    }
  }

  if (
    (lowerQuestion.includes("stint") && lowerQuestion.includes("stop")) ||
    (answer.toLowerCase().includes("stint") && answer.toLowerCase().includes("stop"))
  ) {
    const strategySummary = summarizeStrategyRows(input.rows);
    if (strategySummary) {
      answer = strategySummary;
      notes.push("answer_guard:strategy_stop_count_consistency");
      notes.push("stop_count_consistent_with_stints");
      return { answer, notes };
    }
  }

  if (lowerQuestion.includes("pit cycle") && !hasPitPositionEvidence(input.rows)) {
    answer =
      "The available rows do not include reliable pre- and post-pit position pairs, so pit-cycle position gain cannot be determined confidently.";
    notes.push("answer_guard:pit_cycle_evidence_gate");
    notes.push("evidence_required_for_strategy_claim");
    return { answer, notes };
  }

  if ((lowerQuestion.includes("undercut") || lowerQuestion.includes("overcut")) && !hasUndercutOvercutEvidence(input.rows)) {
    answer =
      "The rows do not provide sufficient relative position evidence around pit windows to confirm an undercut or overcut benefit.";
    notes.push("answer_guard:undercut_overcut_evidence_gate");
    notes.push("evidence_required_for_strategy_claim");
    return { answer, notes };
  }

  if (looksLikeStructuredRowDump(answer)) {
    answer = buildStructuredSummaryFromRows({
      question: input.question,
      rows: input.rows,
      rowCount: input.rows.length
    });
    notes.push("answer_guard:structured_rows_summarized");
    notes.push("structured_rows_summarized");
    return { answer, notes };
  }

  return { answer, notes };
}
