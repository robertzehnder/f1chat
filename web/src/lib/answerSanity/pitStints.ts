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

function hasAnyKey(rows: Record<string, unknown>[], keys: string[]): boolean {
  return rows.some((row) => keys.some((key) => row[key] !== undefined && row[key] !== null));
}

export function strategyTypeFromStops(stops: number): string {
  if (stops <= 0) return "no-stop";
  if (stops === 1) return "one-stop";
  if (stops === 2) return "two-stop";
  return `${stops}-stop`;
}

export function summarizeStrategyRows(rows: Record<string, unknown>[]): string | null {
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

export function summarizeStintRows(rows: Record<string, unknown>[]): string | null {
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

export function summarizeStintLengthRows(rows: Record<string, unknown>[]): string | null {
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

export function summarizePitCycleRows(rows: Record<string, unknown>[]): string | null {
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

export function summarizeUndercutOvercutRows(rows: Record<string, unknown>[]): string | null {
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

export function buildPitStopCountAnswer(rows: Record<string, unknown>[]): string {
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

export function buildStrategyTypeAnswer(rows: Record<string, unknown>[]): string {
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

export function hasPitPositionEvidence(rows: Record<string, unknown>[]): boolean {
  const hasExplicitEvidenceFlag = rows.some(
    (row) => asBoolean(row.evidence_sufficient_for_pit_cycle_claim) !== null
  );
  if (hasExplicitEvidenceFlag) {
    return rows.some((row) => asBoolean(row.evidence_sufficient_for_pit_cycle_claim) === true);
  }
  return rows.some((row) => asNumber(row.pre_pit_position) !== null && asNumber(row.post_pit_position) !== null);
}

export function hasUndercutOvercutEvidence(rows: Record<string, unknown>[]): boolean {
  const hasExplicitEvidenceFlag = rows.some(
    (row) => asBoolean(row.evidence_sufficient_for_undercut_overcut_claim) !== null
  );
  if (hasExplicitEvidenceFlag) {
    return rows.some((row) => asBoolean(row.evidence_sufficient_for_undercut_overcut_claim) === true);
  }
  return hasPitPositionEvidence(rows);
}
