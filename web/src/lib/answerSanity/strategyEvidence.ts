import {
  buildStrategyTypeAnswer,
  hasPitPositionEvidence,
  hasUndercutOvercutEvidence,
  summarizeStrategyRows
} from "./pitStints";

export type StrategyEvidenceGuardResult = { answer: string; notes: string[] } | null;

export function applyStrategyTypeGuard(
  lowerQuestion: string,
  rows: Record<string, unknown>[]
): StrategyEvidenceGuardResult {
  if (!(lowerQuestion.includes("one-stop") || lowerQuestion.includes("two-stop"))) {
    return null;
  }
  const strategyAnswer = buildStrategyTypeAnswer(rows);
  if (!strategyAnswer) {
    return null;
  }
  return {
    answer: strategyAnswer,
    notes: ["answer_guard:strategy_stop_count_consistency", "stop_count_consistent_with_stints"]
  };
}

export function applyStintStopStrategyGuard(
  lowerQuestion: string,
  answer: string,
  rows: Record<string, unknown>[]
): StrategyEvidenceGuardResult {
  const matches =
    (lowerQuestion.includes("stint") && lowerQuestion.includes("stop")) ||
    (answer.toLowerCase().includes("stint") && answer.toLowerCase().includes("stop"));
  if (!matches) {
    return null;
  }
  const strategySummary = summarizeStrategyRows(rows);
  if (!strategySummary) {
    return null;
  }
  return {
    answer: strategySummary,
    notes: ["answer_guard:strategy_stop_count_consistency", "stop_count_consistent_with_stints"]
  };
}

export function applyPitCycleEvidenceGuard(
  lowerQuestion: string,
  rows: Record<string, unknown>[]
): StrategyEvidenceGuardResult {
  if (!lowerQuestion.includes("pit cycle") || hasPitPositionEvidence(rows)) {
    return null;
  }
  return {
    answer:
      "The available rows do not include reliable pre- and post-pit position pairs, so pit-cycle position gain cannot be determined confidently.",
    notes: ["answer_guard:pit_cycle_evidence_gate", "evidence_required_for_strategy_claim"]
  };
}

export function applyUndercutOvercutEvidenceGuard(
  lowerQuestion: string,
  rows: Record<string, unknown>[]
): StrategyEvidenceGuardResult {
  if (
    !(lowerQuestion.includes("undercut") || lowerQuestion.includes("overcut")) ||
    hasUndercutOvercutEvidence(rows)
  ) {
    return null;
  }
  return {
    answer:
      "The rows do not provide sufficient relative position evidence around pit windows to confirm an undercut or overcut benefit.",
    notes: ["answer_guard:undercut_overcut_evidence_gate", "evidence_required_for_strategy_claim"]
  };
}
