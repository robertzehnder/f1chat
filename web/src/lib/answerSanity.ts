import {
  buildPitStopCountAnswer,
  summarizePitCycleRows,
  summarizeStintLengthRows,
  summarizeStintRows,
  summarizeStrategyRows,
  summarizeUndercutOvercutRows
} from "./answerSanity/pitStints";
import { buildSectorAnswer } from "./answerSanity/sector";
import { buildPositionsAnswer } from "./answerSanity/gridFinish";
import {
  applyPitCycleEvidenceGuard,
  applyStintStopStrategyGuard,
  applyStrategyTypeGuard,
  applyUndercutOvercutEvidenceGuard
} from "./answerSanity/strategyEvidence";
import { buildStructuredSummaryFromRows, looksLikeStructuredRowDump } from "./answerSanity/countList";

export {
  buildPitStopCountAnswer,
  buildStrategyTypeAnswer,
  hasPitPositionEvidence,
  hasUndercutOvercutEvidence,
  strategyTypeFromStops,
  summarizePitCycleRows,
  summarizeStintLengthRows,
  summarizeStintRows,
  summarizeStrategyRows,
  summarizeUndercutOvercutRows
} from "./answerSanity/pitStints";

export {
  applyPitCycleEvidenceGuard,
  applyStintStopStrategyGuard,
  applyStrategyTypeGuard,
  applyUndercutOvercutEvidenceGuard
} from "./answerSanity/strategyEvidence";
export type { StrategyEvidenceGuardResult } from "./answerSanity/strategyEvidence";

export { buildStructuredSummaryFromRows } from "./answerSanity/countList";

type AnswerSanityInput = {
  question: string;
  answer: string;
  rows: Record<string, unknown>[];
};

type AnswerSanityResult = {
  answer: string;
  notes: string[];
};

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

  const strategyTypeResult = applyStrategyTypeGuard(lowerQuestion, input.rows);
  if (strategyTypeResult) {
    return strategyTypeResult;
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

  const stintStopStrategyResult = applyStintStopStrategyGuard(lowerQuestion, answer, input.rows);
  if (stintStopStrategyResult) {
    return stintStopStrategyResult;
  }

  const pitCycleEvidenceResult = applyPitCycleEvidenceGuard(lowerQuestion, input.rows);
  if (pitCycleEvidenceResult) {
    return pitCycleEvidenceResult;
  }

  const undercutOvercutEvidenceResult = applyUndercutOvercutEvidenceGuard(lowerQuestion, input.rows);
  if (undercutOvercutEvidenceResult) {
    return undercutOvercutEvidenceResult;
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
