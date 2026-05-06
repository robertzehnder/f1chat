import type { ComponentProps } from "react";
import type { DraftInsight, InsightMock } from "@/lib/chart-types";
import type { InsightCard } from "@/components/f1-chat/insight-card";

/**
 * Single shared snake_case → camelCase adapter.
 *
 *   /mock route passes InsightMock fixtures (title required, no sql/rows).
 *   Live page passes DraftInsight (title optional, sql/rows present).
 *
 * Lives in lib/ (not __mocks__/) because production imports it.
 */
export function toCardProps(
  m: InsightMock | DraftInsight
): ComponentProps<typeof InsightCard> {
  return {
    title: m.title,
    subtitle: m.subtitle,
    body: m.body,
    metrics: m.metrics,
    chart: m.chart,
    takeaways: m.key_takeaways,
    relatedQuestions: m.related_questions,
    hero: m.hero,
    verdict: m.verdict,
    composite: m.composite,
    what_we_have: m.what_we_have,
    tone: m.tone,
    sql: "sql" in m ? m.sql : undefined,
    rows: "rows" in m ? m.rows : undefined,
    rowCount: "rowCount" in m ? m.rowCount : undefined,
    elapsedMs: "elapsedMs" in m ? m.elapsedMs : undefined,
    truncated: "truncated" in m ? m.truncated : undefined,
    reasoning: "reasoning" in m ? m.reasoning : undefined,
    streaming: "streaming" in m ? m.streaming : undefined
  };
}
