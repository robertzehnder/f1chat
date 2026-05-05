"use client";

import type { MessagePart } from "@/lib/chatTypes";
import { InsightCard } from "@/components/chat/InsightCard";

type AssistantMessageProps = {
  parts: MessagePart[];
  onFollowUp?: (prompt: string) => void;
};

// Phase 26 UI: assemble all message parts into one InsightCard.
// The legacy per-part renderers (text / sql / table / warning /
// metadata / followUps) collapse into the card's header / body /
// metric-tiles / chart / warnings / related-questions / SQL +
// result table sections.
export function AssistantMessage({ parts, onFollowUp }: AssistantMessageProps) {
  let bodyText = "";
  let title = "Insight";
  let sql: string | undefined;
  let rows: Record<string, string | number | null>[] = [];
  let rowCount: number | undefined;
  let elapsedMs: number | undefined;
  let truncated: boolean | undefined;
  const warnings: string[] = [];
  const followUps: string[] = [];

  for (const part of parts) {
    switch (part.type) {
      case "text":
        bodyText = bodyText ? `${bodyText}\n\n${part.text}` : part.text;
        break;
      case "sql":
        sql = part.sql;
        break;
      case "table":
        rows = (part.rows ?? []) as Record<string, string | number | null>[];
        rowCount = part.rowCount;
        elapsedMs = part.elapsedMs;
        truncated = part.truncated;
        if (part.title) title = part.title;
        break;
      case "warning":
        warnings.push(...part.messages);
        break;
      case "followUps":
        followUps.push(...part.prompts);
        break;
      case "metadata":
      default:
        // Metadata is intentionally suppressed from the new card —
        // the previous "Details" disclosure was noisy and rarely
        // useful at the assistant-card level.
        break;
    }
  }

  return (
    <InsightCard
      title={title}
      bodyText={bodyText || undefined}
      rows={rows}
      rowCount={rowCount}
      elapsedMs={elapsedMs}
      truncated={truncated}
      sql={sql}
      followUps={followUps}
      warnings={warnings}
      onFollowUp={onFollowUp}
    />
  );
}
