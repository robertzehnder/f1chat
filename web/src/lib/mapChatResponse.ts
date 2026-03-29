import type { ChatApiResponse, MessagePart } from "@/lib/chatTypes";

export function mapChatApiResponseToParts(data: ChatApiResponse): MessagePart[] {
  const parts: MessagePart[] = [];

  const answer =
    data.answer && data.answer.trim()
      ? data.answer.trim()
      : data.error
        ? ""
        : "No answer text was returned.";

  if (answer) {
    parts.push({ type: "text", text: answer });
  }

  if (data.error && !answer) {
    parts.push({ type: "text", text: `Error: ${data.error}` });
  }

  if (data.sql?.trim()) {
    parts.push({ type: "sql", sql: data.sql.trim() });
  }

  if (data.result && data.result.rows.length >= 0) {
    parts.push({
      type: "table",
      title: "Result",
      rows: data.result.rows,
      rowCount: data.result.rowCount,
      elapsedMs: data.result.elapsedMs,
      truncated: data.result.truncated
    });
  }

  const warnings = data.runtime?.completeness?.warnings?.filter(Boolean) ?? [];
  if (warnings.length) {
    parts.push({ type: "warning", messages: warnings });
  }

  const qp = data.runtime?.queryPlan;
  let queryPlanSummary: string | undefined;
  if (qp) {
    const bits: string[] = [];
    if (qp.primary_tables?.length) {
      bits.push(`tables: ${qp.primary_tables.join(", ")}`);
    }
    if (qp.filters?.length) {
      bits.push(`filters: ${qp.filters.join(" AND ")}`);
    }
    if (qp.risk_flags?.length) {
      bits.push(`risk: ${qp.risk_flags.join(", ")}`);
    }
    if (qp.expected_row_count) {
      bits.push(`expected_rows: ${qp.expected_row_count}`);
    }
    queryPlanSummary = bits.length ? bits.join(" · ") : undefined;
  }

  const res = data.runtime?.resolution;
  let resolutionSummary: string | undefined;
  if (res) {
    const bits: string[] = [];
    if (res.status) {
      bits.push(`resolution=${res.status}`);
    }
    if (res.selectedSession?.sessionKey != null) {
      const label = res.selectedSession.label
        ? `${res.selectedSession.label} (${res.selectedSession.sessionKey})`
        : String(res.selectedSession.sessionKey);
      bits.push(`session: ${label}`);
    }
    if (res.selectedDriverNumbers?.length) {
      bits.push(`drivers: ${res.selectedDriverNumbers.join(", ")}`);
    }
    if (res.needsClarification) {
      bits.push("needs_clarification");
    }
    resolutionSummary = bits.length ? bits.join(" · ") : undefined;
  }

  const grain = data.runtime?.grain;
  const grainBits: string[] = [];
  if (grain?.grain) {
    grainBits.push(`grain=${grain.grain}`);
  }
  if (grain?.expectedRowVolume) {
    grainBits.push(`row_volume=${grain.expectedRowVolume}`);
  }
  const grainLine = grainBits.length ? grainBits.join(" · ") : undefined;

  const metaLine = [queryPlanSummary, resolutionSummary, grainLine].filter(Boolean).join(" | ");

  const adequacyGrade = data.adequacyGrade ?? data.responseGrade;
  const adequacyReason = data.adequacyReason ?? data.gradeReason;
  const hasMeta =
    data.requestId ||
    data.generationSource ||
    data.model ||
    adequacyGrade ||
    adequacyReason ||
    data.generationNotes ||
    data.answerReasoning ||
    metaLine;

  if (hasMeta) {
    parts.push({
      type: "metadata",
      requestId: data.requestId,
      generationSource: data.generationSource,
      model: data.model,
      adequacyGrade,
      adequacyReason,
      generationNotes: data.generationNotes,
      answerReasoning: data.answerReasoning,
      queryPlanSummary: metaLine || queryPlanSummary,
      resolutionSummary
    });
  }

  const followUps: string[] = [];
  if (data.runtime?.followUp) {
    followUps.push("Try narrowing the session or driver scope for a more precise answer.");
  }
  if (followUps.length) {
    parts.push({ type: "followUps", prompts: followUps });
  }

  return parts;
}
