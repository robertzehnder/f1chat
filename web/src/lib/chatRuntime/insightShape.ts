/**
 * Phase 3 of the v0 visualization match plan: per-shape prompt
 * templates. The synthesis prompt picks 1 of 6 shape-specific
 * templates with appropriate few-shot examples instead of
 * one-size-fits-all instructions. The shape is selected by extending
 * the existing question classifier with row-shape and topic context.
 *
 * Shapes:
 *   - "hero":               M01 single-fact answer (pole lap, fastest, count)
 *   - "verdict":            M02 yes/no with evidence (overcut worked? wet/dry?)
 *   - "metric-grid":        M03 entry/apex/exit triplet (no chart, just tiles)
 *   - "chart-with-metrics": M04-M19, M22 — body + chart + metrics + takeaways
 *   - "composite":          M20 cross-category (multiple sub-charts stacked)
 *   - "refusal":            M21 no-data refusal (muted card; what_we_have only)
 */

import type { QuestionType } from "@/lib/chatRuntime/classification";

export type InsightShape =
  | "hero"
  | "verdict"
  | "metric-grid"
  | "chart-with-metrics"
  | "composite"
  | "refusal";

/**
 * Pick the InsightShape for a question. Inputs that drive the choice:
 *   - questionType (from existing classifyQuestion)
 *   - generationSource (from runtime — refusal-class paths skip prose)
 *   - normalized message text (heuristic markers for hero / verdict /
 *     metric-grid / composite)
 *
 * The shape is independent of row-shape (which is what `detectChart`
 * uses for chart-type selection). They're orthogonal:
 *   shape  → which prompt template the LLM sees
 *   chart  → which renderer the result rows go through
 *
 * Most shapes drive into "chart-with-metrics" which is the workhorse;
 * the others are special cases for question types where a chart isn't
 * the right answer.
 */
export function pickInsightShape(args: {
  message: string;
  questionType: QuestionType;
  generationSource?: string;
}): InsightShape {
  const { message, questionType, generationSource } = args;
  const lower = message.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

  // 1. Refusal: any path that already classified as no-data
  if (
    generationSource === "no_data_refusal" ||
    generationSource === "proprietary_no_data" ||
    questionType === "data_health_question"
  ) {
    // data_health is "muted" only when generationSource confirms refusal;
    // otherwise it's a normal status_grid / chart-with-metrics question.
    if (
      generationSource === "no_data_refusal" ||
      generationSource === "proprietary_no_data"
    ) {
      return "refusal";
    }
  }

  // 2. Composite: cross-category questions that explicitly stitch two
  //    phenomena. CHECKED BEFORE VERDICT because composite questions
  //    often begin with "did" but are NOT pure yes/no — they need the
  //    multi-shape composite renderer instead of a single verdict.
  if (
    /\b(coincide|cross.?reference|interact with|in (?:addition|combination) (?:to|with)|same time as)\b/.test(lower)
  ) {
    return "composite";
  }

  // 3. Verdict: questions that begin with did/was/is or that explicitly
  //    invite a yes/no answer. Tight markers — false positives degrade
  //    the UX (the LLM will write "YES — ..." even when nuance is needed).
  if (
    /^(did|was|were|is|are|does|do|has|have|will|would|should)\b/.test(lower) &&
    !/\bhow\b/.test(lower.slice(0, 10)) // "how did" is NOT verdict
  ) {
    return "verdict";
  }

  // 4. Hero: single-fact questions. Tight markers; the LLM can still
  //    produce a hero in the chart-with-metrics shape if it judges fit.
  if (
    /^(what was|what is|what's|how many|who )/.test(lower) &&
    /\b(pole|fastest|top speed|best lap|stop count|stops|compound|grid spot|pole lap|fastest lap)\b/.test(lower)
  ) {
    return "hero";
  }

  // 5. Metric grid: 3-tile pattern questions — entry/apex/exit triplet,
  //    brake-zone speed-drop (approach/min/drop), before/after deltas.
  //    These are domain-flavored phrasings that signal "give me 3
  //    numbers and a paragraph, no chart."
  if (
    /\b(entry|apex|exit|min(?:imum)? speed)\b/.test(lower) &&
    !/\bcompare\b/.test(lower) // "compare entry/apex/exit across drivers" is chart
  ) {
    return "metric-grid";
  }
  // Brake-zone single-corner speed-drop pattern: approach + min-in-zone
  // + drop is the canonical 3-tile shape (M03 sample is q1960).
  if (
    /\bbrake.?zone\b/.test(lower) &&
    /\b(drop|delta|speed)\b/.test(lower) &&
    !/\bcompare\b/.test(lower)
  ) {
    return "metric-grid";
  }

  // 6. Default: chart-with-metrics. The workhorse for M04-M19, M22.
  //    Comparison + aggregate + telemetry + event-timeline questions all
  //    fall here; the chart auto-detector picks the right renderer from
  //    row shape.
  return "chart-with-metrics";
}
