type QualityGrade = "A" | "B" | "C" | "D" | "F";

type GradeInput = {
  question: string;
  answer: string;
  generationSource?: string | null;
  result?: {
    rowCount: number;
    truncated: boolean;
  } | null;
  runtime?: {
    resolution?: {
      status?: string;
      needsClarification?: boolean;
      requiresSession?: boolean;
    };
    completeness?: {
      warnings?: string[];
      available?: boolean;
      canProceedWithFallback?: boolean;
    };
    questionType?: string;
  } | null;
  error?: string | null;
};

export type ChatQualityAssessment = {
  grade: QualityGrade;
  reason: string;
};

export function assessChatQuality(input: GradeInput): ChatQualityAssessment {
  const answer = (input.answer ?? "").trim();
  const normalizedAnswer = answer.toLowerCase();
  const rowCount = input.result?.rowCount ?? 0;
  const warningCount = input.runtime?.completeness?.warnings?.length ?? 0;
  const needsClarification = Boolean(input.runtime?.resolution?.needsClarification);
  const requiresSession = Boolean(input.runtime?.resolution?.requiresSession);
  const blockedByCompleteness =
    input.runtime?.completeness?.available === false && !input.runtime?.completeness?.canProceedWithFallback;
  const looksLikeTemplateSuccess =
    /^found \d+ row\(s\) in \d+ ms\./i.test(answer) ||
    (normalizedAnswer.startsWith("found ") && normalizedAnswer.includes("review the table and sql below")) ||
    /^i found\s+\d+\s+matching\s+row\(s\)\.?/i.test(answer) ||
    (normalizedAnswer.includes("key results") && /(driver_number=|full_name=|lap_number=|session_key=|stint_number=|pit_lap=)/i.test(normalizedAnswer));
  const saysNoRows = normalizedAnswer.includes("no rows matched");
  const saysUnavailable =
    normalizedAnswer.includes("could not execute this request safely") ||
    normalizedAnswer.includes("required data is unavailable");
  const asksForClarification =
    normalizedAnswer.includes("please specify") ||
    normalizedAnswer.includes("can you confirm the session key");

  if (input.error) {
    return {
      grade: "F",
      reason: "Request failed before a usable answer was produced."
    };
  }

  if (!answer) {
    return {
      grade: "F",
      reason: "No answer text was produced."
    };
  }

  if (needsClarification) {
    if (asksForClarification && requiresSession) {
      return {
        grade: "B",
        reason: "Clarification was appropriate because the question needed a specific session."
      };
    }
    return {
      grade: "D",
      reason: "Clarification was requested, but the guidance does not appear specific enough."
    };
  }

  if (blockedByCompleteness) {
    return {
      grade: saysUnavailable ? "B" : "C",
      reason: saysUnavailable
        ? "System correctly reported that required data is unavailable."
        : "Data was unavailable, but the answer did not clearly explain that."
    };
  }

  if (saysNoRows) {
    return {
      grade: "C",
      reason: "The query returned no rows, so the question remains unanswered."
    };
  }

  if (rowCount > 0 && looksLikeTemplateSuccess) {
    return {
      grade: "C",
      reason: "Data was returned, but the answer is only a generic query summary."
    };
  }

  if (rowCount > 0) {
    return {
      grade: "B",
      reason: warningCount > 0
        ? "Answer appears useful but has caveats that should be reviewed."
        : "Answer appears to address the question."
    };
  }

  if (asksForClarification && !requiresSession) {
    return {
      grade: "D",
      reason: "The answer asked for clarification even though the question may be answerable directly."
    };
  }

  return {
    grade: "D",
    reason: "The answer does not clearly show that the question was addressed."
  };
}
