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

function combineGrades(...grades) {
  let worst = "A";
  for (const g of grades) {
    if (GRADE_ORDER[g] !== undefined && GRADE_ORDER[g] < GRADE_ORDER[worst]) {
      worst = g;
    }
  }
  return worst;
}

function gradeClarity(item, { expectedClarification, clarified }) {
  const answer = String(item.answer ?? "").trim();
  const lower = answer.toLowerCase();

  if (expectedClarification && clarified) {
    if (answer.length === 0) {
      return {
        grade: "B",
        reason: "Empty clarification message; user-facing prompt is missing."
      };
    }
    return {
      grade: "A",
      reason: "Clear clarification request was returned to the user."
    };
  }

  const checks = [];
  checks.push({ name: "non_empty_answer", passed: answer.length > 0 });
  checks.push({ name: "answer_has_sentence_structure", passed: /[.!?]/.test(answer) });
  checks.push({ name: "answer_long_enough", passed: answer.length >= 20 });

  const isRowDumpStart = /^i found\s+\d+\s+matching\s+row\(s\)\.?/i.test(answer);
  const hasStructuredPairs = /(driver_number=|full_name=|lap_number=|session_key=|stint_number=|pit_lap=)/i.test(lower);
  const hasNarrativeSummary = /(faster|slower|edge|overall|therefore|suggests|indicates|more consistent|less consistent|stronger|weaker|gained|lost|won|behind|ahead|consistent)/i.test(
    lower
  );
  const rowDumpWithoutNarrative = isRowDumpStart && hasStructuredPairs && !hasNarrativeSummary;
  checks.push({ name: "no_row_dump_without_narrative", passed: !rowDumpWithoutNarrative });

  const failedChecks = checks.filter((check) => !check.passed).map((check) => check.name);
  if (failedChecks.length === 0) {
    return {
      grade: "A",
      reason: "Answer text is non-empty, structured, and includes narrative synthesis."
    };
  }
  // Clarity is held to an absolute A/B target — never C.
  return {
    grade: "B",
    reason: `Clarity gaps: ${failedChecks.join(", ")}.`
  };
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

  // Multi-axis grade model (slice 11-multi-axis-grader-redesign):
  // - factualChecks score correctness of the answer's facts (entities resolved, no
  //   internal contradictions).
  // - completenessChecks score whether the answer/SQL completely covered what the
  //   question asked: includes answer-quality completeness checks (non-generic
  //   answer, caveat handling, synthesis-evidence checks) AND semantic contract
  //   conformance (ideal tables, summary contracts, required/forbidden SQL
  //   patterns, raw-table regression).
  // - clarity is graded by gradeClarity() and held to an absolute A/B target.
  const factualChecks = [];
  const completenessChecks = [];

  let factualGrade = "C";
  let factualReason = "";
  let completenessGrade = "A";
  let completenessReason = "Completeness checks passed.";

  const sqlExecuted = !toLower(item.sql).includes("query not executed");
  const canEvaluateSemantic = sqlExecuted && Boolean(item.sql);
  const enforceSemantic = shouldEvaluateSemanticConformance(rubricRow);

  function pushSemanticChecks() {
    completenessChecks.push({
      name: requireAllIdealTables ? "all_ideal_tables_used" : "ideal_tables_used",
      passed: requireAllIdealTables
        ? idealTablesSatisfiedAll(sqlTables, rubricRow.ideal_tables)
        : idealTablesSatisfied(sqlTables, rubricRow.ideal_tables)
    });
    if (summaryTables.length > 0) {
      completenessChecks.push({
        name: "summary_contract_used",
        passed: requireAllIdealTables
          ? idealTablesSatisfiedAll(sqlTables, summaryTables)
          : idealTablesSatisfied(sqlTables, summaryTables)
      });
    }
    if (rubricRow.require_fact_tables) {
      completenessChecks.push({
        name: "fact_table_used",
        passed: usesFactTable(sqlTables)
      });
    }
    if (Array.isArray(rubricRow.required_sql_patterns) && rubricRow.required_sql_patterns.length > 0) {
      completenessChecks.push({
        name: "required_sql_patterns",
        passed: sqlPatternsSatisfied(item.sql, rubricRow.required_sql_patterns)
      });
    }
    if (Array.isArray(rubricRow.forbidden_sql_patterns) && rubricRow.forbidden_sql_patterns.length > 0) {
      completenessChecks.push({
        name: "no_forbidden_sql_patterns",
        passed: noForbiddenSqlPatterns(item.sql, rubricRow.forbidden_sql_patterns)
      });
    }
    const idealCoreSatisfied = requireAllIdealTables
      ? idealTablesSatisfiedAll(sqlTables, idealCoreTables)
      : idealTablesSatisfied(sqlTables, idealCoreTables);
    completenessChecks.push({
      name: "raw_table_regression",
      passed: !(idealCoreTables.length > 0 && usesRawTable(sqlTables) && !idealCoreSatisfied)
    });
  }

  let completenessHandled = false;

  // Phase 19-A (rev2 + rev3): grader branch for `expected_outcome ===
  // "insufficient_data"` — the proprietary-no-data class. Closes the
  // gameable path codex flagged in rev2 (LLM hallucinates a column →
  // 17-C catches it → grader awarded A on `missingColumns` populated).
  // Grading rules:
  //   - generationSource === "no_data_refusal"           → A   (proactive refusal — the desired path)
  //   - generationSource === "sql_generation_failed"
  //       with missingColumns populated                  → B   (honest failure, but wrong honest failure)
  //   - generationSource === "runtime_clarification"     → C   (wrong refusal class)
  //   - normal-shaped synthesized answer                 → C   (chat hallucinated where it should have refused)
  if (item.expected_outcome === "insufficient_data") {
    const generationSource = String(item.generationSource ?? "").toLowerCase();
    const hasMissingColumns =
      Array.isArray(item.missingColumns) && item.missingColumns.length > 0;

    if (generationSource === "no_data_refusal") {
      factualGrade = "A";
      factualReason =
        "Proactively refused with INSUFFICIENT_DATA on a proprietary-no-data question (no SQL attempted).";
      completenessGrade = "A";
      completenessReason =
        "Refusal route fired before SQL generation; completeness is satisfied for the refusal class.";
      baselineAnswerability = "answerable_and_answered";
      completenessHandled = true;
    } else if (generationSource === "sql_generation_failed" && hasMissingColumns) {
      factualGrade = "B";
      factualReason =
        "Honest failure via sql_generation_failed with missing columns, but did not refuse proactively. Should have routed via no_data_refusal.";
      completenessGrade = "B";
      completenessReason =
        "Caught by the column validator after the LLM hallucinated columns. Reaching this path means the proactive guard didn't fire.";
      rootCauseLabels.push("missing_proactive_no_data_refusal");
      completenessHandled = true;
    } else if (generationSource === "runtime_clarification") {
      factualGrade = "C";
      factualReason =
        "Asked for clarification on a proprietary-no-data question. The correct response is INSUFFICIENT_DATA refusal, not clarification.";
      completenessGrade = "C";
      completenessReason =
        "Wrong refusal class — clarification was returned where INSUFFICIENT_DATA refusal was expected.";
      rootCauseLabels.push("wrong_refusal_class");
      completenessHandled = true;
    } else {
      // Normal-shaped synthesized answer (anthropic / anthropic_repaired /
      // deterministic_template) on a question that should have refused.
      factualGrade = "C";
      factualReason =
        "Returned a normal answer on a proprietary-no-data question. The correct response is an INSUFFICIENT_DATA refusal.";
      completenessGrade = "C";
      completenessReason =
        "Chat hallucinated where it should have refused; the proprietary-no-data guard did not fire.";
      rootCauseLabels.push("hallucinated_proprietary_data");
      completenessHandled = true;
    }

    const clarity = gradeClarity(item, { expectedClarification, clarified });
    const baselineGrade = combineGrades(factualGrade, completenessGrade, clarity.grade);
    const baselineReason = `Factual correctness: ${factualReason} Completeness: ${completenessReason} Clarity: ${clarity.reason}`;

    return {
      baselineGrade,
      baselineReason,
      baselineAnswerability,
      baselineQuality: baselineGrade === "A" ? "strong" : baselineGrade === "B" ? "partial" : "weak",
      factual_correctness: { grade: factualGrade, reason: factualReason },
      completeness: { grade: completenessGrade, reason: completenessReason },
      clarity: { grade: clarity.grade, reason: clarity.reason },
      root_cause_labels: uniqueLabels(rootCauseLabels),
      baselineChecks: {
        expectedClarification,
        clarified,
        hasRows,
        factualChecks,
        completenessChecks
      }
    };
  }

  if (expectedClarification) {
    if (clarified) {
      factualGrade = "A";
      factualReason = "Correctly asked for clarification on a question that requires disambiguation.";
      completenessGrade = "A";
      completenessReason = "Clarification request was returned; completeness is satisfied.";
      completenessHandled = true;
    } else {
      factualGrade = hasRows ? "C" : "B";
      factualReason = hasRows
        ? "Answered without required clarification; likely relied on an arbitrary default context."
        : "Did not clearly request required clarification.";
      rootCauseLabels.push("resolver_failure");
      completenessGrade = "B";
      completenessReason = "Required clarification was missed; answer completeness not evaluated.";
      completenessHandled = true;
    }
  } else if (clarified) {
    factualGrade = "C";
    factualReason =
      "Asked for clarification even though this benchmark question should be answerable as written.";
    rootCauseLabels.push("unnecessary_clarification");
    completenessGrade = "C";
    completenessReason = "Unnecessary clarification was returned; answer completeness not evaluated.";
    completenessHandled = true;
  } else if (!hasRows) {
    factualGrade = "C";
    factualReason = "No result rows returned for a question that should be answerable.";
    completenessGrade = "C";
    completenessReason = "No result rows returned; completeness not evaluable.";
    completenessHandled = true;
  } else {
    // Normal path — has rows, no clarification. Run all multi-axis checks.
    factualChecks.push({
      name: "session_match",
      passed: sessionSatisfied(item, expectedSessionKey)
    });
    factualChecks.push({
      name: "driver_scope_match",
      passed: driversSatisfied(item, rubricRow.required_driver_numbers)
    });
    factualChecks.push({
      name: "synthesis_consistency",
      passed: !detectSynthesisContradiction(item)
    });

    completenessChecks.push({
      name: "non_generic_answer",
      passed: !detectGenericOrIncompleteAnswer(item)
    });
    completenessChecks.push({
      name: "caveat_handling",
      passed: detectCaveatHandling(item)
    });
    if (shouldRunSynthesisAnswerCheck("stop_count_consistent_with_stints", item, rubricRow)) {
      completenessChecks.push({
        name: "stop_count_consistent_with_stints",
        passed: stopCountConsistentWithStints(item)
      });
    }
    if (shouldRunSynthesisAnswerCheck("sector_summary_matches_metrics", item, rubricRow)) {
      completenessChecks.push({
        name: "sector_summary_matches_metrics",
        passed: sectorSummaryMatchesMetrics(item)
      });
    }
    if (shouldRunSynthesisAnswerCheck("structured_rows_summarized", item, rubricRow)) {
      completenessChecks.push({
        name: "structured_rows_summarized",
        passed: structuredRowsSummarized(item)
      });
    }
    if (shouldRunSynthesisAnswerCheck("evidence_required_for_strategy_claim", item, rubricRow)) {
      completenessChecks.push({
        name: "evidence_required_for_strategy_claim",
        passed: evidenceRequiredForStrategyClaim(item)
      });
    }
    if (shouldRunSynthesisAnswerCheck("grid_finish_evidence_present", item, rubricRow)) {
      completenessChecks.push({
        name: "grid_finish_evidence_present",
        passed: gridFinishEvidencePresent(item)
      });
    }

    if (enforceSemantic && canEvaluateSemantic) {
      pushSemanticChecks();
    }

    const factualCheckNames = new Set(factualChecks.map((check) => check.name));
    const factualCriticalChecks = criticalChecks.filter((checkName) => factualCheckNames.has(checkName));
    const factualEval = gradeFromChecks({
      checks: factualChecks,
      criticalChecks: factualCriticalChecks,
      minScoreRatio
    });
    factualGrade = factualEval.grade;
    factualReason =
      factualEval.failedChecks.length === 0
        ? "Factual correctness checks matched expected requirements."
        : `Factual correctness gaps: ${factualEval.failedChecks.join(", ")}.`;

    if (!factualChecks.find((check) => check.name === "session_match")?.passed) {
      rootCauseLabels.push("resolver_failure");
    }
    if (!factualChecks.find((check) => check.name === "driver_scope_match")?.passed) {
      rootCauseLabels.push("resolver_failure");
    }
    if (!factualChecks.find((check) => check.name === "synthesis_consistency")?.passed) {
      rootCauseLabels.push("synthesis_contradiction");
    }

    const completenessCriticalChecks = criticalChecks; // semantic + answer-side critical checks intermix here
    const completenessEval = gradeFromChecks({
      checks: completenessChecks,
      criticalChecks: completenessCriticalChecks,
      minScoreRatio
    });
    completenessGrade = completenessEval.grade;
    completenessReason =
      completenessEval.failedChecks.length === 0
        ? "Completeness matched rubric expectations."
        : `Completeness gaps: ${completenessEval.failedChecks.join(", ")}.`;

    if (!completenessChecks.find((check) => check.name === "caveat_handling")?.passed) {
      rootCauseLabels.push("insufficient_evidence_handling");
    }
    for (const failedCheck of completenessEval.failedChecks) {
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
      if (failedCheck === "all_ideal_tables_used" || failedCheck === "ideal_tables_used") {
        rootCauseLabels.push("semantic_contract_missed");
      }
      if (failedCheck === "summary_contract_used") {
        rootCauseLabels.push("summary_contract_missing");
      }
      if (failedCheck === "required_sql_patterns") {
        rootCauseLabels.push("semantic_contract_missed");
      }
      if (failedCheck === "raw_table_regression") {
        rootCauseLabels.push("raw_table_regression");
      }
    }
    completenessHandled = true;
  }

  // Semantic-only fallback: if semantic enforcement was on but we never ran
  // semantic checks (e.g. clarification path took completeness branch above),
  // honor the existing fallback semantics so clarification-row completeness
  // tracks the prior conformance behavior.
  if (!completenessHandled) {
    if (!enforceSemantic) {
      completenessGrade = "A";
      completenessReason = "Completeness is not enforced for this baseline rubric row.";
    } else if (!canEvaluateSemantic) {
      completenessGrade = expectedClarification ? "A" : "B";
      completenessReason = "Completeness is enforced for this row, but no SQL was executed.";
    }
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

  const clarity = gradeClarity(item, { expectedClarification, clarified });

  const baselineGrade = combineGrades(factualGrade, completenessGrade, clarity.grade);
  const baselineReason = `Factual correctness: ${factualReason} Completeness: ${completenessReason} Clarity: ${clarity.reason}`;

  return {
    baselineGrade,
    baselineReason,
    baselineAnswerability,
    baselineQuality: baselineGrade === "A" ? "strong" : baselineGrade === "B" ? "partial" : "weak",
    factual_correctness: { grade: factualGrade, reason: factualReason },
    completeness: { grade: completenessGrade, reason: completenessReason },
    clarity: { grade: clarity.grade, reason: clarity.reason },
    root_cause_labels: uniqueLabels(rootCauseLabels),
    baselineChecks: {
      expectedClarification,
      clarified,
      hasRows,
      factualChecks,
      completenessChecks
    }
  };
}

// Allow-list of source row fields that flow into a graded result. Any legacy
// per-axis grade fields present on the input are dropped by construction (they
// are not in this list), so re-grading a previously-graded artifact yields a
// clean multi-axis row that carries only the new schema's grading output.
//
// Phase 19-A (rev4 + rev7): forward the new question-schema fields plus
// the `cacheHit` / `sqlElapsedMs` / `matchedKeyword` runtime captures.
// `complexity`, `expected_outcome`, `expected_path`, `expected_tables`,
// `expected_columns`, `expected_grade_floor`, `floor_active_after_slice`
// (rev4), `column_match_waiver`, `author_note` (rev7) MUST survive into
// graded JSON because the PR-time gate (Slice 19-D) reads each of them.
// The unit fixture asserts each field appears in a sample graded row.
const PRESERVED_INPUT_FIELDS = [
  "id",
  "category",
  "question",
  "complexity",
  "expected_outcome",
  "expected_path",
  "expected_tables",
  "expected_columns",
  "expected_grade_floor",
  "floor_active_after_slice",
  "column_match_waiver",
  "author_note",
  "ok",
  "httpStatus",
  "elapsedMs",
  "retryAttempted",
  "retrySessionKey",
  "adequacyGrade",
  "adequacyReason",
  "answer",
  "answerReasoning",
  "generationNotes",
  "generationSource",
  "model",
  "requestId",
  "rowCount",
  "rowSummary",
  "previewRows",
  "warnings",
  "questionType",
  "resolutionStatus",
  "sessionKey",
  "sql",
  "errorBodyPreview",
  "cacheHit",
  "sqlElapsedMs",
  "matchedKeyword",
  "missingColumns"
];

// Phase 19 outcome-fix Fix 6 (codex audit pass 5+6): classifier that
// distinguishes "the SQL ran clean and the data legitimately doesn't
// exist upstream" from "the filter predicate was wrong" on 0-row
// outcomes. Reads from a per-run snapshot of
// `core.session_completeness` captured by phase19_baseline_run.py;
// the grader stays DB-free.
//
// Precedence rule for resolving session_key (codex audit pass 6):
//   1. Parse `WHERE session_key = N` / `IN (...)` from the SQL.
//      Use only when EXACTLY one session_key is found.
//   2. Fall back to `item.sessionKey` from the runtime resolution.
//   3. Otherwise return 'unknown' — multi-session set or no resolved
//      key — and grade C (fail-safe; never picks an arbitrary
//      session_key).
//
// Returns: 'proven_data_unavailable' | 'wrong_filter' | 'unknown'.
function _extractSessionKeyLiterals(sql) {
  if (typeof sql !== "string") return [];
  const values = new Set();
  const eqRe = /\bsession_key\s*=\s*(\d+)\b/gi;
  for (const m of sql.matchAll(eqRe)) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) values.add(Math.trunc(v));
  }
  const inRe = /\bsession_key\s+IN\s*\(([^)]+)\)/gi;
  for (const m of sql.matchAll(inRe)) {
    const inner = m[1] ?? "";
    for (const numMatch of inner.matchAll(/\b(\d+)\b/g)) {
      const v = Number(numMatch[1]);
      if (Number.isFinite(v)) values.add(Math.trunc(v));
    }
  }
  return Array.from(values).sort((a, b) => a - b);
}

function _extractTouchedTablesFromSql(sql) {
  if (typeof sql !== "string") return [];
  const tables = new Set();
  // Match qualified table refs (schema.table) in FROM / JOIN clauses
  // — conservative regex; misses some edge cases but doesn't false-
  // positive on column refs.
  const fromRe = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;
  for (const m of sql.matchAll(fromRe)) {
    tables.add(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`);
  }
  return Array.from(tables);
}

export function classifyZeroRowOutcome(item, completenessSnapshot) {
  // Defaults: must have at least cleanly-run SQL and 0 rows to even
  // consider this branch.
  if (!item || typeof item !== "object") return "unknown";
  const sql = String(item.sql ?? "");
  if (!sql || sql.trim().length === 0) return "unknown";
  if (sql.includes("query not executed")) return "unknown";
  const rowCount = Number(item.rowCount ?? 0);
  if (rowCount > 0) return "unknown"; // not a 0-row case

  // Snapshot must exist and be a plain object.
  if (!completenessSnapshot || typeof completenessSnapshot !== "object") return "unknown";

  // Resolve session_key per the precedence rule.
  const literals = _extractSessionKeyLiterals(sql);
  let sessionKey = null;
  if (literals.length === 1) {
    sessionKey = literals[0];
  } else if (
    literals.length === 0 &&
    item.sessionKey !== undefined &&
    item.sessionKey !== null
  ) {
    const fallback = Number(item.sessionKey);
    if (Number.isFinite(fallback)) sessionKey = Math.trunc(fallback);
  }
  if (sessionKey === null) {
    // Multi-session set, or no literal + no item.sessionKey. Fail-safe.
    return "unknown";
  }

  const touchedTables = _extractTouchedTablesFromSql(sql);
  if (touchedTables.length === 0) return "unknown";

  const sessionRow = completenessSnapshot[String(sessionKey)];
  if (!sessionRow || typeof sessionRow !== "object") return "unknown";

  // If any touched (session_key, table) pair reports zero rows in the
  // snapshot, the 0-row outcome is proven-data-unavailable.
  let proven = false;
  for (const t of touchedTables) {
    const rows = sessionRow[t];
    if (typeof rows === "number" && rows === 0) {
      proven = true;
      break;
    }
  }
  if (proven) return "proven_data_unavailable";

  // Predicate-narrow detection: if the SQL has a tight literal filter
  // (lap_number BETWEEN ... AND ..., literal driver_number, time-range
  // predicate), 0 rows is more likely a wrong-filter case. Use two
  // regexes: one for word-keyword operators (BETWEEN/IN) where a
  // trailing \b is correct, one for symbol operators (=, >=, etc.)
  // where the next char is non-word and \b would fail.
  const tightFilterWordOpRe =
    /\b(lap_number|driver_number|time_in_lap_sec|date)\s+(BETWEEN|IN)\b/i;
  const tightFilterSymbolOpRe =
    /\b(lap_number|driver_number|time_in_lap_sec|date)\s*(=|>=|<=|>|<)\s*\d/i;
  if (tightFilterWordOpRe.test(sql) || tightFilterSymbolOpRe.test(sql)) return "wrong_filter";

  return "unknown";
}

export function gradeHealthCheckResults(results, rubricById, options = {}) {
  // Phase 19 outcome-fix Fix 6: completenessSnapshot is optional.
  // When supplied, the classifier promotes proven-data-unavailable
  // 0-row cases from C to B. Fail-safe: missing snapshot → grader
  // stays at the existing C grade.
  const completenessSnapshot = options.completenessSnapshot ?? null;

  return results.map((item) => {
    const rubricRow = rubricById.get(Number(item.id)) ?? defaultRubricRow(Number(item.id));
    const baseline = gradeResultWithRubric(item, rubricRow);

    // Apply the proven-data-unavailable promotion ONLY when the
    // baseline grade is C (avoid masking better grades) AND the
    // baselineAnswerability is "answerable_but_unanswered" (the
    // canonical 0-row case).
    let promoted = baseline;
    if (
      completenessSnapshot &&
      baseline.baselineGrade === "C" &&
      baseline.baselineAnswerability === "answerable_but_unanswered"
    ) {
      const verdict = classifyZeroRowOutcome(item, completenessSnapshot);
      if (verdict === "proven_data_unavailable") {
        promoted = {
          ...baseline,
          baselineGrade: "B",
          baselineQuality: "partial",
          baselineReason: `${baseline.baselineReason} | proven_data_unavailable: snapshot reports zero rows for the touched (session_key, table) pair.`,
          completeness: {
            grade: "B",
            reason:
              "Snapshot reports upstream data unavailable for the touched session+table; honest no-data outcome."
          }
        };
      }
    }

    const cleanedItem = {};
    for (const field of PRESERVED_INPUT_FIELDS) {
      if (field in item) {
        cleanedItem[field] = item[field];
      }
    }
    return {
      ...cleanedItem,
      ...promoted
    };
  });
}

export function summarizeBaselineGrades(results) {
  const summary = {
    total: results.length,
    gradeCounts: { A: 0, B: 0, C: 0 },
    factualCorrectnessCounts: { A: 0, B: 0, C: 0 },
    completenessCounts: { A: 0, B: 0, C: 0 },
    clarityCounts: { A: 0, B: 0, C: 0 },
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
    const factualGrade = item.factual_correctness?.grade;
    if (summary.factualCorrectnessCounts[factualGrade] !== undefined) {
      summary.factualCorrectnessCounts[factualGrade] += 1;
    }
    const completenessGrade = item.completeness?.grade;
    if (summary.completenessCounts[completenessGrade] !== undefined) {
      summary.completenessCounts[completenessGrade] += 1;
    }
    const clarityGrade = item.clarity?.grade;
    if (summary.clarityCounts[clarityGrade] !== undefined) {
      summary.clarityCounts[clarityGrade] += 1;
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
