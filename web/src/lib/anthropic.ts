const DEFAULT_ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? "600");

type SqlGenerationInput = {
  question: string;
  context?: {
    sessionKey?: number;
    driverNumber?: number;
  };
  runtime?: {
    questionType?: string;
    grain?: string;
    resolvedEntities?: Record<string, unknown>;
    queryPlan?: Record<string, unknown>;
    requiredTables?: string[];
    completenessWarnings?: string[];
  };
};

type SqlGenerationOutput = {
  sql: string;
  reasoning?: string;
  model: string;
  rawText: string;
};

type AnswerSynthesisInput = {
  question: string;
  sql: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  runtime?: {
    questionType?: string;
    grain?: string;
    resolvedEntities?: Record<string, unknown>;
    completenessWarnings?: string[];
  };
};

type AnswerSynthesisOutput = {
  answer: string;
  reasoning?: string;
  model: string;
  rawText: string;
};

function buildSystemPrompt() {
  return `
You are a PostgreSQL analytics assistant for an OpenF1 warehouse.
Only generate read-only SQL using these schemas/tables:

core.sessions, core.session_drivers, core.meetings, core.driver_dim
core.lap_semantic_bridge, core.laps_enriched, core.driver_session_summary, core.stint_summary,
core.strategy_summary, core.grid_vs_finish, core.race_progression_summary, core.lap_phase_summary,
core.telemetry_lap_bridge, core.lap_context_summary, core.replay_lap_frames, core.metric_registry
raw.sessions, raw.drivers, raw.laps, raw.car_data, raw.location, raw.intervals, raw.position_history,
raw.weather, raw.race_control, raw.pit, raw.stints, raw.team_radio, raw.session_result,
raw.starting_grid, raw.overtakes, raw.championship_drivers, raw.championship_teams

Important column reminders:
- raw.session_result has: session_key, driver_number, position, points, status, classified (no "time" column).
- raw.laps has: session_key, driver_number, lap_number, lap_duration, date_start.
- raw.drivers has: session_key, driver_number, full_name, team_name.
- core.sessions has: session_key, meeting_name, session_name, year, country_name, location, date_start.
- core.laps_enriched is the default lap analysis contract for pace/sector/clean-lap questions.
- core.driver_session_summary, core.stint_summary, core.strategy_summary, core.grid_vs_finish,
  core.race_progression_summary are preferred summary contracts for analytics.

Rules:
- Output JSON only.
- JSON keys: "sql", "reasoning".
- SQL must be exactly one SELECT/CTE statement.
- Never use INSERT/UPDATE/DELETE/DDL.
- Prefer bounded queries with LIMIT unless aggregation naturally returns small output.
- If telemetry tables are used, prefer filtering by session_key and optionally driver_number.
- If runtime context includes resolved IDs (such as session_key, driver_number), use those exact IDs in filters.
- Do not rely on meeting_name alone for venue matching because it may be null/empty.
- Prefer semantic/core contracts over raw tables for analytical questions; use raw.* only when a required semantic view is missing.
`.trim();
}

function buildRepairPrompt() {
  return `
You are fixing a PostgreSQL query for the OpenF1 warehouse.
Return JSON only with keys: "sql", "reasoning".
The SQL must be exactly one SELECT/CTE statement.
Do not use non-existent columns.
Do not use INSERT/UPDATE/DELETE/DDL.
`.trim();
}

function buildAnswerSynthesisPrompt() {
  return `
You are reviewing SQL query output from an OpenF1 analytics system.
Return JSON only with keys: "answer", "reasoning".

Rules:
- "answer" must directly answer the user's question using only provided rows.
- Prefer plain-language summary over table-style wording.
- Never use row-dump framing like "I found N rows" or "Key results:".
- Include key values (driver names, session keys, counts, times) when present.
- If rows are insufficient, clearly say what is missing.
- Do not invent facts not present in the rows.
- Do not claim undercut/overcut benefits without explicit position-change evidence.
- Do not claim positions gained/lost without both grid and finish values.
- Keep stint count and pit-stop count logically consistent (pit_stops = stints - 1 when both are present).
- Keep sector winner statements consistent with reported best/average sector values.
- Keep "answer" concise (2-6 sentences).
- "reasoning" should briefly explain how the rows support the answer.
`.trim();
}

function extractJsonText(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text.trim();
}

function parseAnthropicTextFromResponse(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("content" in payload)) {
    throw new Error("Unexpected Anthropic response shape.");
  }
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error("Anthropic response did not include content array.");
  }
  const textBlocks = content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const maybeText = (block as { type?: unknown; text?: unknown }).text;
      return typeof maybeText === "string" ? maybeText : "";
    })
    .filter(Boolean);
  if (!textBlocks.length) {
    throw new Error("Anthropic response contained no text.");
  }
  return textBlocks.join("\n");
}

export async function generateSqlWithAnthropic(
  input: SqlGenerationInput
): Promise<SqlGenerationOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const model = DEFAULT_ANTHROPIC_MODEL;
  const contextText = JSON.stringify(input.context ?? {});
  const runtimeText = JSON.stringify(input.runtime ?? {});
  const userPrompt = `
Question:
${input.question}

Context:
${contextText}

Runtime:
${runtimeText}

Return JSON only.
`.trim();

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      temperature: 0,
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const rawText = parseAnthropicTextFromResponse(payload);
  const jsonText = extractJsonText(rawText);

  let parsed: { sql?: string; reasoning?: string };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Could not parse JSON from model output: ${rawText}`);
  }

  if (!parsed.sql || typeof parsed.sql !== "string") {
    throw new Error("Model output did not include a valid 'sql' field.");
  }

  return {
    sql: parsed.sql,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    model,
    rawText
  };
}

export async function repairSqlWithAnthropic(input: {
  question: string;
  failingSql: string;
  dbError: string;
  context?: {
    sessionKey?: number;
    driverNumber?: number;
  };
  runtime?: {
    questionType?: string;
    grain?: string;
    resolvedEntities?: Record<string, unknown>;
    queryPlan?: Record<string, unknown>;
    requiredTables?: string[];
    completenessWarnings?: string[];
  };
}): Promise<SqlGenerationOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const model = DEFAULT_ANTHROPIC_MODEL;
  const contextText = JSON.stringify(input.context ?? {});
  const runtimeText = JSON.stringify(input.runtime ?? {});
  const userPrompt = `
Question:
${input.question}

Context:
${contextText}

Runtime:
${runtimeText}

Failing SQL:
${input.failingSql}

Database error:
${input.dbError}

Provide corrected SQL only in JSON format.
`.trim();

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      temperature: 0,
      system: `${buildSystemPrompt()}\n\n${buildRepairPrompt()}`,
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const rawText = parseAnthropicTextFromResponse(payload);
  const jsonText = extractJsonText(rawText);

  let parsed: { sql?: string; reasoning?: string };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Could not parse JSON from model output: ${rawText}`);
  }

  if (!parsed.sql || typeof parsed.sql !== "string") {
    throw new Error("Model repair output did not include a valid 'sql' field.");
  }

  return {
    sql: parsed.sql,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    model,
    rawText
  };
}

export async function synthesizeAnswerWithAnthropic(
  input: AnswerSynthesisInput
): Promise<AnswerSynthesisOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const model = DEFAULT_ANTHROPIC_MODEL;
  const runtimeText = JSON.stringify(input.runtime ?? {});
  const rowsForPrompt = input.rows.slice(0, 25);
  const userPrompt = `
Question:
${input.question}

SQL:
${input.sql}

Row count:
${input.rowCount}

Rows (sample):
${JSON.stringify(rowsForPrompt)}

Runtime:
${runtimeText}

Return JSON only.
`.trim();

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: DEFAULT_MAX_TOKENS,
      temperature: 0,
      system: buildAnswerSynthesisPrompt(),
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const rawText = parseAnthropicTextFromResponse(payload);
  const jsonText = extractJsonText(rawText);

  let parsed: { answer?: string; reasoning?: string };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Could not parse JSON from model output: ${rawText}`);
  }

  if (!parsed.answer || typeof parsed.answer !== "string") {
    throw new Error("Model output did not include a valid 'answer' field.");
  }

  return {
    answer: parsed.answer.trim(),
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    model,
    rawText
  };
}
