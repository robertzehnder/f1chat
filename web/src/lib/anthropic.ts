import type { FactContract } from "@/lib/contracts/factContract";
import { buildSynthesisPrompt } from "@/lib/synthesis/buildSynthesisPrompt";

const DEFAULT_ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
/** Short JSON answers; keep separate from SQL generation which needs a much higher ceiling. */
const ANSWER_MAX_TOKENS = Number(
  process.env.ANTHROPIC_MAX_TOKENS_ANSWER ?? process.env.ANTHROPIC_MAX_TOKENS ?? "1024"
);
/** Large CTEs exceed 600 tokens easily; override with ANTHROPIC_MAX_TOKENS_SQL. */
const SQL_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS_SQL ?? "4096");

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

export type AnswerSynthesisInput = {
  question: string;
  sql: string;
  contract: FactContract;
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
- Put only executable SQL in "sql". Never append trace lines, notes, or text like session_pin_* inside the JSON or the query string.
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

export function buildSynthesisPromptParts(
  input: AnswerSynthesisInput
): { staticPrefix: string; dynamicSuffix: string } {
  return buildSynthesisPrompt(input);
}

export function buildSynthesisRequestParams(
  input: AnswerSynthesisInput
): {
  system: Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }>;
  messages: Array<{ role: "user"; content: string }>;
} {
  const { staticPrefix, dynamicSuffix } = buildSynthesisPromptParts(input);
  return {
    system: [{ type: "text", text: staticPrefix, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: dynamicSuffix }]
  };
}

function stripModelTraceNoise(text: string): string {
  return text.replace(/\s*\|\s*session_pin_[a-z0-9_]+\([^)]*\)\s*$/gim, "").trim();
}

/** Remove echoed session-pin trace fragments the model sometimes appends inside the SQL string. */
function stripSqlEchoArtifacts(sql: string): string {
  return sql.replace(/\s*\|\s*session_pin_[a-z0-9_]+\([^)]*\)/gi, "").trimEnd();
}

function extractJsonText(text: string): string {
  let t = stripModelTraceNoise(text);

  const fenced = t.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const openJsonFence = t.match(/```json\s*([\s\S]*)/i);
  if (openJsonFence?.[1]) {
    return openJsonFence[1].trim();
  }

  const fencedPlain = t.match(/```\s*([\s\S]*?)```/);
  if (fencedPlain?.[1]?.trim().startsWith("{")) {
    return fencedPlain[1].trim();
  }

  const firstBrace = t.indexOf("{");
  const lastBrace = t.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return t.slice(firstBrace, lastBrace + 1);
  }

  return t.trim();
}

/**
 * When the model hits max_tokens mid-JSON, recover the sql string value if it started.
 */
function recoverSqlFromTruncatedJsonPayload(payload: string): string | null {
  const match = /"sql"\s*:\s*"/.exec(payload);
  if (!match || match.index === undefined) {
    return null;
  }
  let i = match.index + match[0].length;
  let out = "";
  while (i < payload.length) {
    const c = payload[i];
    if (c === "\\") {
      if (i + 1 >= payload.length) {
        break;
      }
      const n = payload[i + 1];
      if (n === "n") {
        out += "\n";
        i += 2;
        continue;
      }
      if (n === "t") {
        out += "\t";
        i += 2;
        continue;
      }
      if (n === "r") {
        out += "\r";
        i += 2;
        continue;
      }
      if (n === '"' || n === "\\" || n === "/") {
        out += n;
        i += 2;
        continue;
      }
      if (n === "u" && i + 5 < payload.length) {
        const hex = payload.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
      }
      out += n;
      i += 2;
      continue;
    }
    if (c === '"') {
      break;
    }
    out += c;
    i += 1;
  }

  let sql = stripSqlEchoArtifacts(stripModelTraceNoise(out).trim());
  if (sql.length < 12) {
    return null;
  }
  if (!/\b(WITH|SELECT)\b/i.test(sql)) {
    return null;
  }
  return sql;
}

function parseSqlJsonPayload(jsonText: string, rawText: string): { sql: string; reasoning?: string } {
  let parsed: { sql?: string; reasoning?: string };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const recovered = recoverSqlFromTruncatedJsonPayload(jsonText);
    if (recovered) {
      return { sql: recovered, reasoning: undefined };
    }
    throw new Error(`Could not parse JSON from model output: ${rawText.slice(0, 4000)}`);
  }

  if (!parsed.sql || typeof parsed.sql !== "string") {
    throw new Error("Model output did not include a valid 'sql' field.");
  }
  let sql = stripSqlEchoArtifacts(stripModelTraceNoise(parsed.sql).trim());
  if (!sql) {
    throw new Error("Model output did not include a valid 'sql' field.");
  }
  return {
    sql,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined
  };
}

function parseAnswerJsonPayload(jsonText: string, rawText: string): { answer: string; reasoning?: string } {
  let parsed: { answer?: string; reasoning?: string };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Could not parse JSON from model output: ${rawText.slice(0, 4000)}`);
  }

  if (!parsed.answer || typeof parsed.answer !== "string") {
    throw new Error("Model output did not include a valid 'answer' field.");
  }
  return {
    answer: parsed.answer.trim(),
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined
  };
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
      max_tokens: SQL_MAX_TOKENS,
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
  const parsed = parseSqlJsonPayload(jsonText, rawText);

  return {
    sql: parsed.sql,
    reasoning: parsed.reasoning,
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
      max_tokens: SQL_MAX_TOKENS,
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
  const parsed = parseSqlJsonPayload(jsonText, rawText);

  return {
    sql: parsed.sql,
    reasoning: parsed.reasoning,
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
  const { system, messages } = buildSynthesisRequestParams(input);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: ANSWER_MAX_TOKENS,
      temperature: 0,
      system,
      messages
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const rawText = parseAnthropicTextFromResponse(payload);
  const jsonText = extractJsonText(rawText);
  const parsed = parseAnswerJsonPayload(jsonText, rawText);

  return {
    answer: parsed.answer,
    reasoning: parsed.reasoning,
    model,
    rawText
  };
}

export type StreamChunk =
  | { kind: "answer_delta"; text: string }
  | { kind: "reasoning_delta"; text: string }
  | { kind: "final"; answer: string; reasoning?: string; model: string; rawText: string };

function decodeJsonStringSoFar(
  raw: string,
  startIdx: number
): { decoded: string; closed: boolean } {
  let i = startIdx;
  let out = "";
  let closed = false;
  while (i < raw.length) {
    const c = raw[i];
    if (c === "\\") {
      if (i + 1 >= raw.length) break;
      const n = raw[i + 1];
      if (n === "n") { out += "\n"; i += 2; continue; }
      if (n === "t") { out += "\t"; i += 2; continue; }
      if (n === "r") { out += "\r"; i += 2; continue; }
      if (n === "b") { out += "\b"; i += 2; continue; }
      if (n === "f") { out += "\f"; i += 2; continue; }
      if (n === '"' || n === "\\" || n === "/") { out += n; i += 2; continue; }
      if (n === "u") {
        if (i + 5 >= raw.length) break;
        const hex = raw.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      out += n;
      i += 2;
      continue;
    }
    if (c === '"') {
      closed = true;
      i += 1;
      break;
    }
    out += c;
    i += 1;
  }
  return { decoded: out, closed };
}

export async function* synthesizeAnswerStream(
  input: AnswerSynthesisInput
): AsyncGenerator<StreamChunk, void, undefined> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const model = DEFAULT_ANTHROPIC_MODEL;
  const { system, messages } = buildSynthesisRequestParams(input);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: ANSWER_MAX_TOKENS,
      temperature: 0,
      system,
      messages,
      stream: true
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  if (!response.body) {
    throw new Error("Anthropic streaming response did not include a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let accumulated = "";

  let answerStart = -1;
  let reasoningStart = -1;
  let answerYielded = "";
  let reasoningYielded = "";
  let answerClosed = false;
  let reasoningClosed = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });

    let eventBoundary;
    while ((eventBoundary = sseBuffer.indexOf("\n\n")) !== -1) {
      const eventBlock = sseBuffer.slice(0, eventBoundary);
      sseBuffer = sseBuffer.slice(eventBoundary + 2);

      for (const line of eventBlock.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let evt: { type?: unknown; delta?: { type?: unknown; text?: unknown } };
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }
        if (
          evt.type !== "content_block_delta" ||
          !evt.delta ||
          evt.delta.type !== "text_delta" ||
          typeof evt.delta.text !== "string"
        ) {
          continue;
        }
        accumulated += evt.delta.text;

        if (answerStart === -1) {
          const m = /"answer"\s*:\s*"/.exec(accumulated);
          if (m && m.index !== undefined) {
            answerStart = m.index + m[0].length;
          }
        }
        if (reasoningStart === -1) {
          const m = /"reasoning"\s*:\s*"/.exec(accumulated);
          if (m && m.index !== undefined) {
            reasoningStart = m.index + m[0].length;
          }
        }

        if (answerStart !== -1 && !answerClosed) {
          const { decoded, closed } = decodeJsonStringSoFar(accumulated, answerStart);
          if (decoded.length > answerYielded.length) {
            const delta = decoded.slice(answerYielded.length);
            answerYielded = decoded;
            yield { kind: "answer_delta", text: delta };
          }
          if (closed) answerClosed = true;
        }

        if (reasoningStart !== -1 && !reasoningClosed) {
          const { decoded, closed } = decodeJsonStringSoFar(accumulated, reasoningStart);
          if (decoded.length > reasoningYielded.length) {
            const delta = decoded.slice(reasoningYielded.length);
            reasoningYielded = decoded;
            yield { kind: "reasoning_delta", text: delta };
          }
          if (closed) reasoningClosed = true;
        }
      }
    }
  }

  const jsonText = extractJsonText(accumulated);
  const parsed = parseAnswerJsonPayload(jsonText, accumulated);

  yield {
    kind: "final",
    answer: parsed.answer,
    reasoning: parsed.reasoning,
    model,
    rawText: accumulated
  };
}
