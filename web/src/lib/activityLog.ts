import type { ChatApiResponse } from "@/lib/chatTypes";

export type ActivityStatus = "running" | "done" | "warn" | "error";

export interface ActivityEvent {
  id: string;
  label: string;
  message?: string;
  status: ActivityStatus;
}

/**
 * Synthetic phase list shown WHILE the SSE stream is still open.
 * The page-level handler cycles through these on a timer so the user
 * sees something happening immediately. Phase labels deliberately mirror
 * the real backend stages so the live and final-frame logs feel coherent.
 */
export const SYNTHETIC_PHASES: ReadonlyArray<{ label: string; message: string }> = [
  { label: "Reading question", message: "Parsing intent and topic." },
  { label: "Resolving references", message: "Looking up session, drivers, venue." },
  { label: "Planning query", message: "Selecting tables and filters." },
  { label: "Running query", message: "Executing against the database." },
  { label: "Drafting answer", message: "Synthesizing the response." }
];

/**
 * Build a structured activity log from the FINAL ChatApiResponse.
 * Pulls from response.runtime (queryPlan, resolution, completeness),
 * response.result (row count + timing), response.generationSource, etc.
 *
 * Result is rendered by <ActivityLog> in InsightCard. Replaces the
 * synthetic phase stream once the stream closes.
 */
export function buildActivityLog(response: ChatApiResponse): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const r = response.runtime;

  // 1. Question intake
  events.push({
    id: "intake",
    label: "Reading question",
    message: r?.questionType ? `Topic: ${r.questionType}` : "Parsed and classified.",
    status: "done"
  });

  // 2. Resolution (session + driver lookup)
  if (r?.resolution) {
    const res = r.resolution;
    if (res.needsClarification) {
      events.push({
        id: "resolve",
        label: "Resolving references",
        message: "Couldn't uniquely identify session or driver.",
        status: "warn"
      });
    } else {
      const sessionLabel = res.selectedSession?.label
        ? res.selectedSession.label
        : res.selectedSession?.sessionKey != null
          ? `session ${res.selectedSession.sessionKey}`
          : null;
      const drivers = res.selectedDriverNumbers?.length
        ? `drivers ${res.selectedDriverNumbers.join(", ")}`
        : null;
      const bits = [sessionLabel, drivers].filter(Boolean).join(" · ");
      events.push({
        id: "resolve",
        label: "Resolving references",
        message: bits || "Resolved.",
        status: "done"
      });
    }
  }

  // 3. Query plan (which tables / filters)
  if (r?.queryPlan?.primary_tables?.length) {
    const tables = r.queryPlan.primary_tables.slice(0, 3).join(", ");
    const more = r.queryPlan.primary_tables.length > 3 ? ` (+${r.queryPlan.primary_tables.length - 3})` : "";
    const filters = r.queryPlan.filters?.length
      ? ` · ${r.queryPlan.filters.length} filter${r.queryPlan.filters.length === 1 ? "" : "s"}`
      : "";
    events.push({
      id: "plan",
      label: "Planning query",
      message: `Tables: ${tables}${more}${filters}`,
      status: "done"
    });
  }

  // 4. Database execution (rows + timing)
  if (response.result && Array.isArray(response.result.rows)) {
    const rows = response.result.rowCount;
    const ms = response.result.elapsedMs;
    const truncated = response.result.truncated ? " (truncated)" : "";
    events.push({
      id: "query",
      label: "Running query",
      message: `${rows} row${rows === 1 ? "" : "s"} · ${ms}ms${truncated}`,
      status: "done"
    });
  } else if (response.sql && response.sql.trim() && !response.sql.includes("not executed")) {
    events.push({
      id: "query",
      label: "Running query",
      message: "SQL prepared but not executed.",
      status: "warn"
    });
  }

  // 5. Coverage warnings (if validators flagged anything)
  if (r?.completeness?.warnings?.length) {
    const w = r.completeness.warnings[0];
    const more =
      r.completeness.warnings.length > 1
        ? ` (+${r.completeness.warnings.length - 1} more)`
        : "";
    events.push({
      id: "coverage",
      label: "Coverage gap",
      message: `${w}${more}`,
      status: "warn"
    });
  }

  // 6. Answer synthesis
  if (response.generationSource) {
    const isRefusal =
      response.generationSource === "no_data_refusal" ||
      response.generationSource === "proprietary_no_data";
    const isClarification = response.generationSource === "runtime_clarification";
    events.push({
      id: "synth",
      label: isRefusal ? "Refused" : isClarification ? "Asked for clarification" : "Drafted answer",
      status: isRefusal || isClarification ? "warn" : "done"
    });
  }

  return events;
}
