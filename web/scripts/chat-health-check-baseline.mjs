import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_RUBRIC_PATH = path.join(process.cwd(), "scripts", "chat-health-check.rubric.json");

const DRIVER_NAME_BY_NUMBER = {
  1: "max verstappen",
  16: "charles leclerc"
};

const GRADE_ORDER = { A: 3, B: 2, C: 1 };
const DRIVER_KEYS = ["verstappen", "leclerc"];
const NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
};
const EXTENDED_ANSWER_CHECK_NAMES = new Set([
  "stop_count_consistent_with_stints",
  "sector_summary_matches_metrics",
  "structured_rows_summarized",
  "evidence_required_for_strategy_claim",
  "grid_finish_evidence_present"
]);

function toLower(text) {
  return String(text ?? "").toLowerCase();
}

function collectNumericColumnFilters(sqlText, columnName) {
  const sql = String(sqlText ?? "");
  const values = new Set();
  const eqPattern = new RegExp(`(?:\\b|\\.)${columnName}\\s*=\\s*(\\d+)`, "gi");
  const inPattern = new RegExp(`(?:\\b|\\.)${columnName}\\s+in\\s*\\(([^)]*)\\)`, "gi");

  let eqMatch;
  while ((eqMatch = eqPattern.exec(sql)) !== null) {
    values.add(Number.parseInt(eqMatch[1], 10));
  }

  let inMatch;
  while ((inMatch = inPattern.exec(sql)) !== null) {
    const numbers = inMatch[1]
      .split(",")
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((value) => Number.isFinite(value));
    for (const number of numbers) {
      values.add(number);
    }
  }

  return values;
}

function extractTablesFromSql(sqlText) {
  const sql = String(sqlText ?? "");
  const tables = new Set();
  const tableRegex = /\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_."]*)/gi;

  let match;
  while ((match = tableRegex.exec(sql)) !== null) {
    const raw = match[1].replaceAll('"', "").replace(/[,;]$/, "");
    tables.add(raw.toLowerCase());
  }

  return tables;
}

function detectClarification(item) {
  const answer = toLower(item.answer);
  const sql = toLower(item.sql);
  return (
    item.generationSource === "runtime_clarification" ||
    answer.includes("please specify") ||
    answer.includes("could not confidently resolve") ||
    sql.includes("clarification required")
  );
}

function detectGenericOrIncompleteAnswer(item) {
  const answer = toLower(item.answer);
  const patterns = [
    "query returned",
    "does not include",
    "not possible to determine",
    "cannot determine",
    "could not determine",
    "would need to",
    "without",
    "data is unavailable",
    "not available in these results",
    "only retrieved"
  ];
  return patterns.some((pattern) => answer.includes(pattern));
}

function detectCaveatHandling(item) {
  const warnings = Array.isArray(item.warnings) ? item.warnings : [];
  if (warnings.length === 0) {
    return true;
  }
  const answer = toLower(item.answer);
  return (
    answer.includes("caveat") ||
    answer.includes("insufficient") ||
    answer.includes("cannot") ||
    answer.includes("could not") ||
    answer.includes("not enough") ||
    answer.includes("unavailable") ||
    answer.includes("data is missing")
  );
}

function detectSynthesisContradiction(item) {
  const answer = toLower(item.answer);
  if (!answer) {
    return false;
  }
  const hasInsufficientLanguage =
    answer.includes("cannot determine") ||
    answer.includes("could not determine") ||
    answer.includes("insufficient") ||
    answer.includes("not enough evidence");
  const hasDecisiveLanguage =
    answer.includes("was faster") ||
    answer.includes("had the higher") ||
    answer.includes("gained more") ||
    answer.includes("set the fastest");
  return hasInsufficientLanguage && hasDecisiveLanguage;
}

function hasCautiousLanguage(text) {
  const normalized = toLower(text);
  return (
    normalized.includes("insufficient") ||
    normalized.includes("cannot determine") ||
    normalized.includes("could not determine") ||
    normalized.includes("could not") ||
    normalized.includes("not enough") ||
    normalized.includes("cannot be determined") ||
    normalized.includes("not provide sufficient") ||
    normalized.includes("do not provide sufficient") ||
    normalized.includes("cannot confirm") ||
    normalized.includes("cannot be confirmed")
  );
}

function parseCountToken(token) {
  const normalized = String(token ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  return Number.isFinite(NUMBER_WORDS[normalized]) ? NUMBER_WORDS[normalized] : null;
}

function driverKeyFromText(text) {
  const normalized = toLower(text);
  if (normalized.includes("verstappen") || normalized.includes("max verstappen")) {
    return "verstappen";
  }
  if (normalized.includes("leclerc") || normalized.includes("charles leclerc")) {
    return "leclerc";
  }
  return null;
}

function extractDriverStintStopClaims(answerText) {
  const answer = toLower(answerText);
  const sentences = answer.split(/[.!?]/).map((segment) => segment.trim()).filter(Boolean);
  const claims = {
    verstappen: { stints: null, stops: null },
    leclerc: { stints: null, stops: null }
  };
  const stopPatterns = [
    /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*-\s*stop\b/i,
    /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+stop(?:s|\b)/i
  ];

  for (const sentence of sentences) {
    for (const driverKey of DRIVER_KEYS) {
      const isDriverSentence =
        driverKey === "verstappen"
          ? sentence.includes("verstappen") || sentence.includes("max verstappen")
          : sentence.includes("leclerc") || sentence.includes("charles leclerc");
      if (!isDriverSentence) {
        continue;
      }

      if (!Number.isFinite(claims[driverKey].stints)) {
        const stintMatch = sentence.match(
          /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+stints?\b/i
        );
        const stintCount = parseCountToken(stintMatch?.[1]);
        if (Number.isFinite(stintCount)) {
          claims[driverKey].stints = stintCount;
        }
      }

      if (!Number.isFinite(claims[driverKey].stops)) {
        for (const pattern of stopPatterns) {
          const stopMatch = sentence.match(pattern);
          const stopCount = parseCountToken(stopMatch?.[1]);
          if (Number.isFinite(stopCount)) {
            claims[driverKey].stops = stopCount;
            break;
          }
        }
      }
    }
  }

  return claims;
}

function stopCountConsistentWithStints(item) {
  const answer = toLower(item.answer);
  if (!answer.includes("stint") || !answer.includes("stop")) {
    return true;
  }
  const claims = extractDriverStintStopClaims(item.answer);
  let evaluated = false;
  for (const driverKey of DRIVER_KEYS) {
    const { stints, stops } = claims[driverKey];
    if (Number.isFinite(stints) && Number.isFinite(stops)) {
      evaluated = true;
      if (stops !== stints - 1) {
        return false;
      }
    }
  }
  if (evaluated) {
    return true;
  }

  const firstStintCount = parseCountToken(
    answer.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+stints?\b/i)?.[1]
  );
  const firstStopCount = parseCountToken(
    answer.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*-\s*stop\b/i)?.[1] ??
      answer.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+stop(?:s|\b)/i)?.[1]
  );
  if (Number.isFinite(firstStintCount) && Number.isFinite(firstStopCount)) {
    return firstStopCount === firstStintCount - 1;
  }
  return true;
}

function parseNumberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function metricRowByDriver(previewRows) {
  const rowByDriver = {};
  for (const row of Array.isArray(previewRows) ? previewRows : []) {
    const driverKey = driverKeyFromText(row.full_name ?? row.driver_name ?? row.driver ?? "");
    if (driverKey) {
      rowByDriver[driverKey] = row;
    }
  }
  return rowByDriver;
}

function sectorWinnersFromMetrics(previewRows) {
  const byDriver = metricRowByDriver(previewRows);
  const maxRow = byDriver.verstappen;
  const lecRow = byDriver.leclerc;
  if (!maxRow || !lecRow) {
    return null;
  }

  const pickWinner = (maxMetric, lecMetric) => {
    const maxValue = parseNumberValue(maxMetric);
    const lecValue = parseNumberValue(lecMetric);
    if (!Number.isFinite(maxValue) || !Number.isFinite(lecValue)) {
      return null;
    }
    return maxValue <= lecValue ? "verstappen" : "leclerc";
  };

  return {
    best: {
      s1: pickWinner(maxRow.best_s1, lecRow.best_s1),
      s2: pickWinner(maxRow.best_s2, lecRow.best_s2),
      s3: pickWinner(maxRow.best_s3, lecRow.best_s3)
    },
    avg: {
      s1: pickWinner(maxRow.avg_s1, lecRow.avg_s1),
      s2: pickWinner(maxRow.avg_s2, lecRow.avg_s2),
      s3: pickWinner(maxRow.avg_s3, lecRow.avg_s3)
    }
  };
}

function parseSectorClaimsFromClause(clause) {
  const claims = {};
  for (const sector of [1, 2, 3]) {
    const afterPattern = new RegExp(
      `s\\s*${sector}\\b[^.;,]{0,36}(verstappen|max|leclerc|charles)`,
      "i"
    );
    const beforePattern = new RegExp(
      `(verstappen|max|leclerc|charles)[^.;,]{0,36}s\\s*${sector}\\b`,
      "i"
    );
    const afterMatch = clause.match(afterPattern);
    const beforeMatch = clause.match(beforePattern);
    const token = afterMatch?.[1] ?? beforeMatch?.[1];
    const driverKey = driverKeyFromText(token ?? "");
    if (driverKey) {
      claims[`s${sector}`] = driverKey;
    }
  }
  return claims;
}

function parseSectorSummaryClaims(answerText) {
  const answer = toLower(answerText);
  const sentences = answer.split(/[.!?]/).map((segment) => segment.trim()).filter(Boolean);
  const summary = { best: {}, avg: {} };

  for (const sentence of sentences) {
    const isBest = /best\s+sector/.test(sentence);
    const isAvg = /average\s+sector|avg\s+sector/.test(sentence);
    if (!isBest && !isAvg) {
      continue;
    }
    const claims = parseSectorClaimsFromClause(sentence);
    if (isBest) {
      Object.assign(summary.best, claims);
    }
    if (isAvg) {
      Object.assign(summary.avg, claims);
    }
  }

  return summary;
}

function sectorSummaryMatchesMetrics(item) {
  const winners = sectorWinnersFromMetrics(item.previewRows);
  if (!winners) {
    return true;
  }

  const claims = parseSectorSummaryClaims(item.answer);
  const claimedKeys = [
    ...Object.keys(claims.best).map((key) => `best:${key}`),
    ...Object.keys(claims.avg).map((key) => `avg:${key}`)
  ];
  if (claimedKeys.length === 0) {
    return false;
  }

  for (const [sector, driverKey] of Object.entries(claims.best)) {
    if (winners.best[sector] && winners.best[sector] !== driverKey) {
      return false;
    }
  }
  for (const [sector, driverKey] of Object.entries(claims.avg)) {
    if (winners.avg[sector] && winners.avg[sector] !== driverKey) {
      return false;
    }
  }
  return true;
}

function structuredRowsSummarized(item) {
  const answer = String(item.answer ?? "").trim();
  if (!answer) {
    return false;
  }
  const normalized = answer.toLowerCase();
  const startsAsRowDump = /^i found\s+\d+\s+matching\s+row\(s\)\.?/i.test(answer);
  const hasKeyResults = normalized.includes("key results");
  if (!startsAsRowDump && !hasKeyResults) {
    return true;
  }

  const hasStructuredPairs = /(driver_number=|full_name=|lap_number=|session_key=|stint_number=|pit_lap=)/i.test(normalized);
  if (!hasStructuredPairs) {
    return true;
  }

  const hasNarrativeSummary = /(faster|slower|edge|overall|therefore|suggests|indicates|more consistent|less consistent|stronger|weaker)/i.test(
    normalized
  );
  return hasNarrativeSummary;
}

function hasNonNullPositionEvidence(previewRows) {
  for (const row of Array.isArray(previewRows) ? previewRows : []) {
    const pre = parseNumberValue(row.pre_pit_position);
    const post = parseNumberValue(row.post_pit_position);
    const gain = parseNumberValue(row.positions_gained_after_pit);
    const position = parseNumberValue(row.position ?? row.position_end_of_lap);
    if ((Number.isFinite(pre) && Number.isFinite(post)) || Number.isFinite(gain) || Number.isFinite(position)) {
      return true;
    }
  }
  return false;
}

function evidenceRequiredForStrategyClaim(item) {
  const question = toLower(item.question);
  const answer = toLower(item.answer);
  const strategyTopic =
    question.includes("undercut") || question.includes("overcut") || question.includes("pit cycle");
  if (!strategyTopic) {
    return true;
  }
  if (hasCautiousLanguage(answer)) {
    return true;
  }

  const sql = toLower(item.sql);
  const previewRows = Array.isArray(item.previewRows) ? item.previewRows : [];
  const hasPitContextInSql = /pit_lap|pit_duration|phase|pit_events|pit_cycle|pit stop|pit_stop|stint/i.test(sql);
  const hasPitContextInRows = previewRows.some(
    (row) => row.pit_lap !== undefined || row.pit_duration !== undefined || row.phase !== undefined
  );
  const hasPositionRows = hasNonNullPositionEvidence(previewRows);
  const hasPositionSql = /pre_pit_position|post_pit_position|positions_gained_after_pit|position_history|position_end_of_lap|position\b/i.test(
    sql
  );

  if (previewRows.length > 0) {
    return (hasPitContextInSql || hasPitContextInRows) && hasPositionRows;
  }
  return (hasPitContextInSql || hasPitContextInRows) && hasPositionSql;
}

function gridFinishEvidencePresent(item) {
  const answer = toLower(item.answer);
  const makesPositionClaim =
    (answer.includes("gained") || answer.includes("lost")) && answer.includes("position");
  if (!makesPositionClaim || hasCautiousLanguage(answer)) {
    return true;
  }

  const previewRows = Array.isArray(item.previewRows) ? item.previewRows : [];
  if (previewRows.length > 0) {
    return previewRows.some((row) => {
      const grid = parseNumberValue(row.grid_position ?? row.starting_grid);
      const finish = parseNumberValue(row.finish_position);
      return Number.isFinite(grid) && Number.isFinite(finish);
    });
  }
  return /grid_position|finish_position|starting_grid|session_result/i.test(toLower(item.sql));
}

function shouldRunSynthesisAnswerCheck(checkName, item, rubricRow) {
  const requiredAnswerChecks = Array.isArray(rubricRow.required_answer_checks)
    ? rubricRow.required_answer_checks
    : [];
  const criticalChecks = Array.isArray(rubricRow.critical_checks) ? rubricRow.critical_checks : [];
  if (requiredAnswerChecks.includes(checkName) || criticalChecks.includes(checkName)) {
    return true;
  }

  const question = toLower(item.question);
  switch (checkName) {
    case "stop_count_consistent_with_stints":
      return question.includes("stint") || (toLower(item.answer).includes("stint") && toLower(item.answer).includes("stop"));
    case "sector_summary_matches_metrics":
      return question.includes("sector");
    case "structured_rows_summarized":
      return Number(item.rowCount ?? 0) > 0;
    case "evidence_required_for_strategy_claim":
      return question.includes("undercut") || question.includes("overcut") || question.includes("pit cycle");
    case "grid_finish_evidence_present":
      return question.includes("gained or lost") || question.includes("positions");
    default:
      return false;
  }
}

function detectInsufficientEvidenceHandlingIssue(item) {
  const question = toLower(item.question);
  const answer = toLower(item.answer);
  const sql = toLower(item.sql);
  const cautious = hasCautiousLanguage(answer);

  if ((question.includes("undercut") || question.includes("overcut")) && !cautious) {
    return true;
  }

  if (
    question.includes("pit cycle") &&
    !cautious &&
    !/pre_pit_position|post_pit_position|positions_gained_after_pit/i.test(sql)
  ) {
    return true;
  }

  if (
    (question.includes("gained or lost") || question.includes("positions gained")) &&
    !cautious &&
    !/grid_position|finish_position|starting_grid|session_result/i.test(sql)
  ) {
    return true;
  }

  return false;
}

function driversSatisfied(item, requiredDrivers) {
  if (!Array.isArray(requiredDrivers) || requiredDrivers.length === 0) {
    return true;
  }

  const sqlDrivers = collectNumericColumnFilters(item.sql, "driver_number");
  const answerText = toLower(item.answer);

  return requiredDrivers.every((driverNumber) => {
    if (sqlDrivers.has(driverNumber)) {
      return true;
    }
    const driverName = DRIVER_NAME_BY_NUMBER[driverNumber];
    return Boolean(driverName) && answerText.includes(driverName);
  });
}

function sessionSatisfied(item, expectedSessionKey) {
  if (!Number.isFinite(expectedSessionKey)) {
    return true;
  }

  if (Number(item.sessionKey) === expectedSessionKey) {
    return true;
  }

  const sqlSessions = collectNumericColumnFilters(item.sql, "session_key");
  if (sqlSessions.has(expectedSessionKey)) {
    return true;
  }

  return toLower(item.answer).includes(String(expectedSessionKey));
}

function idealTablesSatisfied(sqlTables, idealTables) {
  if (!Array.isArray(idealTables) || idealTables.length === 0) {
    return true;
  }
  const normalizedIdeal = idealTables.map((table) => table.toLowerCase());
  return normalizedIdeal.some((table) => sqlTables.has(table));
}

function idealTablesSatisfiedAll(sqlTables, idealTables) {
  if (!Array.isArray(idealTables) || idealTables.length === 0) {
    return true;
  }
  const normalizedIdeal = idealTables.map((table) => table.toLowerCase());
  return normalizedIdeal.every((table) => sqlTables.has(table));
}

function sqlPatternsSatisfied(sqlText, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return true;
  }
  const sql = String(sqlText ?? "");
  return patterns.every((pattern) => {
    try {
      return new RegExp(pattern, "i").test(sql);
    } catch {
      return false;
    }
  });
}

function noForbiddenSqlPatterns(sqlText, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return true;
  }
  const sql = String(sqlText ?? "");
  return patterns.every((pattern) => {
    try {
      return !new RegExp(pattern, "i").test(sql);
    } catch {
      return false;
    }
  });
}

function usesFactTable(sqlTables) {
  return Array.from(sqlTables).some((table) => table.startsWith("raw."));
}

function usesRawTable(sqlTables) {
  return Array.from(sqlTables).some((table) => table.startsWith("raw."));
}

function expectedSummaryTables(idealTables) {
  if (!Array.isArray(idealTables)) {
    return [];
  }
  return idealTables.filter((table) => {
    const normalized = String(table ?? "").toLowerCase();
    return (
      normalized.includes("_summary") ||
      normalized === "core.grid_vs_finish" ||
      normalized === "core.race_progression_summary"
    );
  });
}

function gradeFromChecks({ checks, criticalChecks, minScoreRatio }) {
  const passedCount = checks.filter((check) => check.passed).length;
  const scoreRatio = checks.length > 0 ? passedCount / checks.length : 1;
  const failedChecks = checks.filter((check) => !check.passed).map((check) => check.name);
  const failedCriticalCheck = failedChecks.some((name) => criticalChecks.includes(name));

  let grade = "C";
  if (failedChecks.length === 0) {
    grade = "A";
  } else if (!failedCriticalCheck && scoreRatio >= minScoreRatio) {
    grade = "B";
  }

  return {
    grade,
    passedCount,
    scoreRatio,
    failedChecks,
    failedCriticalCheck
  };
}

function combineGrades(answerGrade, semanticGrade) {
  return GRADE_ORDER[answerGrade] <= GRADE_ORDER[semanticGrade] ? answerGrade : semanticGrade;
}

function uniqueLabels(labels) {
  return Array.from(new Set(labels.filter(Boolean))).sort();
}

function defaultRubricRow(id) {
  return {
    question_id: id,
    should_be_answerable: true,
    needs_clarification: false,
    is_derived_logic: false,
    expected_session_key: null,
    required_driver_numbers: [],
    ideal_resolution: "",
    ideal_tables: [],
    require_fact_tables: false,
    ideal_answer_summary: "",
    grade_rules: [],
    required_answer_checks: []
  };
}

function mergeQuestions(baseQuestions, overrideQuestions) {
  const byId = new Map();
  for (const row of baseQuestions) {
    byId.set(Number(row.question_id), row);
  }
  for (const row of overrideQuestions) {
    const id = Number(row.question_id);
    const existing = byId.get(id);
    byId.set(id, existing ? { ...existing, ...row } : row);
  }
  return Array.from(byId.values()).sort((a, b) => Number(a.question_id) - Number(b.question_id));
}

async function loadRubricWithInheritance(rubricPath, seen = new Set()) {
  const absolutePath = path.resolve(rubricPath);
  if (seen.has(absolutePath)) {
    throw new Error(`Circular rubric inheritance detected at: ${absolutePath}`);
  }
  seen.add(absolutePath);

  const raw = await readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  const localQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
  const extendsRubric = typeof parsed.extends_rubric === "string" ? parsed.extends_rubric.trim() : "";

  if (!extendsRubric) {
    seen.delete(absolutePath);
    return {
      rubricPath: absolutePath,
      parsed,
      questions: localQuestions,
      chain: [absolutePath]
    };
  }

  const parentPath = path.resolve(path.dirname(absolutePath), extendsRubric);
  const parent = await loadRubricWithInheritance(parentPath, seen);
  seen.delete(absolutePath);

  return {
    rubricPath: absolutePath,
    parsed,
    questions: mergeQuestions(parent.questions, localQuestions),
    chain: [...parent.chain, absolutePath]
  };
}

export async function loadBaselineRubric(rubricPath = DEFAULT_RUBRIC_PATH) {
  const loaded = await loadRubricWithInheritance(rubricPath);
  const rubricById = new Map();
  for (const row of loaded.questions) {
    rubricById.set(Number(row.question_id), row);
  }
  return {
    rubricPath: loaded.rubricPath,
    meta: {
      ...loaded.parsed,
      resolved_rubric_chain: loaded.chain
    },
    rubricById
  };
}

function shouldEvaluateSemanticConformance(rubricRow) {
  const mode = toLower(rubricRow.semantic_enforcement);
  if (mode === "strict") {
    return true;
  }
  if (mode === "off") {
    return false;
  }

  const hasRequiredPatterns =
    Array.isArray(rubricRow.required_sql_patterns) && rubricRow.required_sql_patterns.length > 0;
  const hasForbiddenPatterns =
    Array.isArray(rubricRow.forbidden_sql_patterns) && rubricRow.forbidden_sql_patterns.length > 0;
  const requiresAllIdeal = Boolean(rubricRow.require_all_ideal_tables);
  const criticalChecks = Array.isArray(rubricRow.critical_checks) ? rubricRow.critical_checks : [];
  const semanticCriticalChecks = new Set([
    "ideal_tables_used",
    "all_ideal_tables_used",
    "summary_contract_used",
    "fact_table_used",
    "required_sql_patterns",
    "no_forbidden_sql_patterns",
    "raw_table_regression"
  ]);
  const hasSemanticCriticalCheck = criticalChecks.some((check) => semanticCriticalChecks.has(check));

  return hasRequiredPatterns || hasForbiddenPatterns || requiresAllIdeal || hasSemanticCriticalCheck;
}

export function gradeResultWithRubric(item, rubricRowInput) {
  const rubricRow = {
    ...defaultRubricRow(Number(item.id)),
    ...(rubricRowInput ?? {})
  };
  const rowCount = Number(item.rowCount ?? 0);
  const hasRows = rowCount > 0;
  const clarified = detectClarification(item);
  const sqlTables = extractTablesFromSql(item.sql);
  const expectedClarification = Boolean(rubricRow.needs_clarification || !rubricRow.should_be_answerable);
  const expectedSessionKey = Number.isFinite(rubricRow.expected_session_key)
    ? Number(rubricRow.expected_session_key)
    : null;
  const criticalChecks = Array.isArray(rubricRow.critical_checks) ? rubricRow.critical_checks : [];
  const minScoreRatio = Number.isFinite(Number(rubricRow.minimum_score_ratio))
    ? Number(rubricRow.minimum_score_ratio)
    : 0.6;
  const requireAllIdealTables = Boolean(rubricRow.require_all_ideal_tables);
  const summaryTables = expectedSummaryTables(rubricRow.ideal_tables);
  const idealCoreTables = Array.isArray(rubricRow.ideal_tables)
    ? rubricRow.ideal_tables.filter((table) => String(table ?? "").toLowerCase().startsWith("core."))
    : [];
  const rootCauseLabels = [];

  let baselineAnswerability = "answerable_and_answered";
  if (expectedClarification && clarified) {
    baselineAnswerability = "expected_clarification_met";
  } else if (expectedClarification && !clarified) {
    baselineAnswerability = "expected_clarification_missed";
  } else if (!expectedClarification && clarified) {
    baselineAnswerability = "unnecessary_clarification";
  } else if (!hasRows) {
    baselineAnswerability = "answerable_but_unanswered";
  }

  // Dual-grade model:
  // - answerChecks score correctness/completeness/caution quality.
  // - semanticChecks score conformance to preferred semantic contracts.
  const answerChecks = [];
  const semanticChecks = [];

  let answerGrade = "C";
  let answerReason = "";

  if (expectedClarification) {
    if (clarified) {
      answerGrade = "A";
      answerReason = "Correctly asked for clarification on a question that requires disambiguation.";
    } else {
      answerGrade = hasRows ? "C" : "B";
      answerReason = hasRows
        ? "Answered without required clarification; likely relied on an arbitrary default context."
        : "Did not clearly request required clarification.";
      rootCauseLabels.push("resolver_failure");
    }
  } else if (clarified) {
    answerGrade = "C";
    answerReason =
      "Asked for clarification even though this benchmark question should be answerable as written.";
    rootCauseLabels.push("unnecessary_clarification");
  } else if (!hasRows) {
    answerGrade = "C";
    answerReason = "No result rows returned for a question that should be answerable.";
  } else {
    answerChecks.push({
      name: "session_match",
      passed: sessionSatisfied(item, expectedSessionKey)
    });
    answerChecks.push({
      name: "driver_scope_match",
      passed: driversSatisfied(item, rubricRow.required_driver_numbers)
    });
    answerChecks.push({
      name: "non_generic_answer",
      passed: !detectGenericOrIncompleteAnswer(item)
    });
    answerChecks.push({
      name: "caveat_handling",
      passed: detectCaveatHandling(item)
    });
    answerChecks.push({
      name: "synthesis_consistency",
      passed: !detectSynthesisContradiction(item)
    });
    if (shouldRunSynthesisAnswerCheck("stop_count_consistent_with_stints", item, rubricRow)) {
      answerChecks.push({
        name: "stop_count_consistent_with_stints",
        passed: stopCountConsistentWithStints(item)
      });
    }
    if (shouldRunSynthesisAnswerCheck("sector_summary_matches_metrics", item, rubricRow)) {
      answerChecks.push({
        name: "sector_summary_matches_metrics",
        passed: sectorSummaryMatchesMetrics(item)
      });
    }
    if (shouldRunSynthesisAnswerCheck("structured_rows_summarized", item, rubricRow)) {
      answerChecks.push({
        name: "structured_rows_summarized",
        passed: structuredRowsSummarized(item)
      });
    }
    if (shouldRunSynthesisAnswerCheck("evidence_required_for_strategy_claim", item, rubricRow)) {
      answerChecks.push({
        name: "evidence_required_for_strategy_claim",
        passed: evidenceRequiredForStrategyClaim(item)
      });
    }
    if (shouldRunSynthesisAnswerCheck("grid_finish_evidence_present", item, rubricRow)) {
      answerChecks.push({
        name: "grid_finish_evidence_present",
        passed: gridFinishEvidencePresent(item)
      });
    }

    const answerCheckNames = new Set(answerChecks.map((check) => check.name));
    const answerCriticalChecks = criticalChecks.filter((checkName) => answerCheckNames.has(checkName));

    const answerEval = gradeFromChecks({
      checks: answerChecks,
      criticalChecks: answerCriticalChecks,
      minScoreRatio
    });
    answerGrade = answerEval.grade;
    answerReason =
      answerEval.failedChecks.length === 0
        ? "Answer quality matched expected requirements."
        : `Answer quality gaps: ${answerEval.failedChecks.join(", ")}.`;

    if (!answerChecks.find((check) => check.name === "session_match")?.passed) {
      rootCauseLabels.push("resolver_failure");
    }
    if (!answerChecks.find((check) => check.name === "driver_scope_match")?.passed) {
      rootCauseLabels.push("resolver_failure");
    }
    if (!answerChecks.find((check) => check.name === "synthesis_consistency")?.passed) {
      rootCauseLabels.push("synthesis_contradiction");
    }
    if (!answerChecks.find((check) => check.name === "caveat_handling")?.passed) {
      rootCauseLabels.push("insufficient_evidence_handling");
    }
    for (const failedCheck of answerEval.failedChecks) {
      if (EXTENDED_ANSWER_CHECK_NAMES.has(failedCheck)) {
        rootCauseLabels.push(failedCheck);
      }
      if (
        failedCheck === "evidence_required_for_strategy_claim" ||
        failedCheck === "grid_finish_evidence_present"
      ) {
        rootCauseLabels.push("insufficient_evidence_handling");
      }
      if (failedCheck === "stop_count_consistent_with_stints" || failedCheck === "sector_summary_matches_metrics") {
        rootCauseLabels.push("synthesis_contradiction");
      }
    }
  }

  let semanticConformanceGrade = "A";
  let semanticConformanceReason = "Semantic conformance checks passed.";

  const enforceSemanticConformance = shouldEvaluateSemanticConformance(rubricRow);
  const sqlExecuted = !toLower(item.sql).includes("query not executed");
  const canEvaluateSemantic = sqlExecuted && Boolean(item.sql);
  if (!enforceSemanticConformance) {
    semanticConformanceGrade = "A";
    semanticConformanceReason = "Semantic conformance is not enforced for this baseline rubric row.";
  } else if (canEvaluateSemantic) {
    semanticChecks.push({
      name: requireAllIdealTables ? "all_ideal_tables_used" : "ideal_tables_used",
      passed: requireAllIdealTables
        ? idealTablesSatisfiedAll(sqlTables, rubricRow.ideal_tables)
        : idealTablesSatisfied(sqlTables, rubricRow.ideal_tables)
    });
    if (summaryTables.length > 0) {
      semanticChecks.push({
        name: "summary_contract_used",
        passed: requireAllIdealTables
          ? idealTablesSatisfiedAll(sqlTables, summaryTables)
          : idealTablesSatisfied(sqlTables, summaryTables)
      });
    }
    if (rubricRow.require_fact_tables) {
      semanticChecks.push({
        name: "fact_table_used",
        passed: usesFactTable(sqlTables)
      });
    }
    if (Array.isArray(rubricRow.required_sql_patterns) && rubricRow.required_sql_patterns.length > 0) {
      semanticChecks.push({
        name: "required_sql_patterns",
        passed: sqlPatternsSatisfied(item.sql, rubricRow.required_sql_patterns)
      });
    }
    if (Array.isArray(rubricRow.forbidden_sql_patterns) && rubricRow.forbidden_sql_patterns.length > 0) {
      semanticChecks.push({
        name: "no_forbidden_sql_patterns",
        passed: noForbiddenSqlPatterns(item.sql, rubricRow.forbidden_sql_patterns)
      });
    }

    const idealCoreSatisfied = requireAllIdealTables
      ? idealTablesSatisfiedAll(sqlTables, idealCoreTables)
      : idealTablesSatisfied(sqlTables, idealCoreTables);
    semanticChecks.push({
      name: "raw_table_regression",
      passed: !(idealCoreTables.length > 0 && usesRawTable(sqlTables) && !idealCoreSatisfied)
    });

    const semanticEval = gradeFromChecks({
      checks: semanticChecks,
      criticalChecks,
      minScoreRatio
    });
    semanticConformanceGrade = semanticEval.grade;
    semanticConformanceReason =
      semanticEval.failedChecks.length === 0
        ? "Semantic conformance matched rubric expectations."
        : `Semantic conformance gaps: ${semanticEval.failedChecks.join(", ")}.`;

    if (semanticEval.failedChecks.includes("all_ideal_tables_used") || semanticEval.failedChecks.includes("ideal_tables_used")) {
      rootCauseLabels.push("semantic_contract_missed");
    }
    if (semanticEval.failedChecks.includes("summary_contract_used")) {
      rootCauseLabels.push("summary_contract_missing");
    }
    if (semanticEval.failedChecks.includes("required_sql_patterns")) {
      rootCauseLabels.push("semantic_contract_missed");
    }
    if (semanticEval.failedChecks.includes("raw_table_regression")) {
      rootCauseLabels.push("raw_table_regression");
    }
  } else {
    semanticConformanceGrade = expectedClarification ? "A" : "B";
    semanticConformanceReason =
      "Semantic conformance is enforced for this row, but no SQL was executed.";
  }

  if (detectInsufficientEvidenceHandlingIssue(item)) {
    rootCauseLabels.push("insufficient_evidence_handling");
  }

  if (baselineAnswerability === "expected_clarification_missed") {
    rootCauseLabels.push("resolver_failure");
  }
  if (baselineAnswerability === "unnecessary_clarification") {
    rootCauseLabels.push("unnecessary_clarification");
  }

  const baselineGrade = combineGrades(answerGrade, semanticConformanceGrade);
  const baselineReason = `Answer: ${answerReason} Semantic: ${semanticConformanceReason}`;

  return {
    baselineGrade,
    baselineReason,
    baselineAnswerability,
    baselineQuality: baselineGrade === "A" ? "strong" : baselineGrade === "B" ? "partial" : "weak",
    answer_grade: answerGrade,
    answer_grade_reason: answerReason,
    semantic_conformance_grade: semanticConformanceGrade,
    semantic_conformance_reason: semanticConformanceReason,
    root_cause_labels: uniqueLabels(rootCauseLabels),
    baselineChecks: {
      expectedClarification,
      clarified,
      hasRows,
      answerChecks,
      semanticChecks
    }
  };
}

export function gradeHealthCheckResults(results, rubricById) {
  return results.map((item) => {
    const rubricRow = rubricById.get(Number(item.id)) ?? defaultRubricRow(Number(item.id));
    const baseline = gradeResultWithRubric(item, rubricRow);
    return {
      ...item,
      ...baseline
    };
  });
}

export function summarizeBaselineGrades(results) {
  const summary = {
    total: results.length,
    gradeCounts: { A: 0, B: 0, C: 0 },
    answerGradeCounts: { A: 0, B: 0, C: 0 },
    semanticConformanceGradeCounts: { A: 0, B: 0, C: 0 },
    answerability: {
      expected_clarification_met: 0,
      expected_clarification_missed: 0,
      unnecessary_clarification: 0,
      answerable_and_answered: 0,
      answerable_but_unanswered: 0
    },
    rootCauseCounts: {}
  };

  for (const item of results) {
    if (summary.gradeCounts[item.baselineGrade] !== undefined) {
      summary.gradeCounts[item.baselineGrade] += 1;
    }
    if (summary.answerGradeCounts[item.answer_grade] !== undefined) {
      summary.answerGradeCounts[item.answer_grade] += 1;
    }
    if (summary.semanticConformanceGradeCounts[item.semantic_conformance_grade] !== undefined) {
      summary.semanticConformanceGradeCounts[item.semantic_conformance_grade] += 1;
    }
    if (summary.answerability[item.baselineAnswerability] !== undefined) {
      summary.answerability[item.baselineAnswerability] += 1;
    }
    for (const label of Array.isArray(item.root_cause_labels) ? item.root_cause_labels : []) {
      summary.rootCauseCounts[label] = (summary.rootCauseCounts[label] ?? 0) + 1;
    }
  }

  return summary;
}
