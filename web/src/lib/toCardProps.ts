import type { ComponentProps } from "react";
import type { DraftInsight, InsightMock } from "@/lib/chart-types";
import type { InsightCard } from "@/components/f1-chat/insight-card";

/**
 * When a card has no explicit `at_a_glance` (deterministic builders + older
 * cached answers don't emit one), promote the first sentence of the body as
 * the "answer at a glance" line and show the REST as the supporting prose —
 * so the glance never just duplicates the paragraph below it. Conservative:
 * only splits a genuinely multi-sentence body whose lead sentence is a
 * reasonable one-liner; otherwise leaves the body untouched (no glance).
 */
// Abbreviations that end in "." mid-sentence — never a real sentence boundary.
// NB: deliberately excludes F1 tokens like Q3/P2/GP — those legitimately END a
// sentence ("Verstappen was fastest in Q3."), so skipping them would merge two
// sentences into the glance.
const GLANCE_ABBREV = /^(no|vs|dr|mr|mrs|ms|st|etc|eg|ie|jr|sr|approx|fig|avg)$/i;

function deriveGlance(body: string | undefined): { glance?: string; body: string } {
  const text = (body ?? "").trim();
  if (!text) return { body: text };
  // Scan for the first REAL sentence boundary: a .!? followed by a space, that
  // isn't a decimal ("0.36" → dot has no space after), an abbreviation
  // ("No. 4", "vs. VER"), a single-letter initial ("P. Gasly"), or inside a
  // multi-line lead. Keeps the promoted glance a clean one-liner.
  const re = /[.!?]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const idx = m.index;
    const after = text[idx + 1];
    if (after !== undefined && after !== " ") continue; // not a boundary (decimals, mid-word)
    if (idx + 1 < 20) continue; // lead too short — keep scanning
    const lead = text.slice(0, idx + 1).trim();
    const rest = text.slice(idx + 1).trim();
    if (lead.length > 180) break; // lead too long to be a glance
    if (/\n/.test(lead)) break; // multi-line lead — reject
    if (!/\s/.test(lead)) continue; // single token — not a sentence
    const prevWord = (lead.slice(0, -1).match(/(\S+)$/)?.[1] ?? "").replace(/[.,]/g, "");
    if (GLANCE_ABBREV.test(prevWord) || /^[A-Z]$/.test(prevWord)) continue; // abbrev / initial
    if (rest.length < 20) return { body: text }; // nothing meaningful left → don't split
    return { glance: lead, body: rest };
  }
  return { body: text };
}

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
  // Explicit at_a_glance (fixtures + LLM synthesis) wins. Else derive from the
  // body — UNLESS a hero number or verdict pill already leads the card (those
  // ARE the "answer at a glance", so a second derived line would be redundant).
  const derived = m.at_a_glance
    ? { glance: m.at_a_glance, body: m.body }
    : m.hero || m.verdict
      ? { glance: undefined, body: m.body }
      : deriveGlance(m.body);
  return {
    title: m.title,
    subtitle: m.subtitle,
    atAGlance: derived.glance,
    body: derived.body,
    metrics: m.metrics,
    chart: m.chart,
    cornerMap: m.corner_map,
    clarification: m.clarification
      ? { prompt: m.clarification.prompt, options: m.clarification.options }
      : undefined,
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
    streaming: "streaming" in m ? m.streaming : undefined,
    activity: "activity" in m ? m.activity : undefined
  };
}
