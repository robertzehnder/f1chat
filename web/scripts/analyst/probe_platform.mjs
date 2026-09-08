#!/usr/bin/env node
/**
 * probe_platform.mjs — the platform-observed packet (analyst design U5).
 *
 * Fires tiered questions at the running chat runtime on BOTH routes
 * separately — natural (deterministic templates allowed) and LLM-SQL only
 * (debug.disableTemplates) — and records per question: routing path,
 * templateKey / generation source, generated SQL, row count, the answer,
 * refusal behaviour. Reconciliation against the canonical packet happens
 * in the ledger; nothing falls back silently.
 *
 * Tiers: discovery (unprompted), timeline, atomic, adversarial, unsupported.
 * Usage: node scripts/analyst/probe_platform.mjs --session 11361 [--base http://127.0.0.1:3000]
 * Env: OPENF1_CHAT_BASE_URL (default localhost:3000); dev server must be running.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const sessionKey = Number(process.argv.find((a, i) => process.argv[i - 1] === "--session"));
const base = process.argv.find((a, i) => process.argv[i - 1] === "--base") ?? process.env.OPENF1_CHAT_BASE_URL ?? "http://127.0.0.1:3000";
const runId = `probe-${sessionKey}-${Date.now()}`;

const QUESTIONS = [
  { id: "d1", tier: "discovery", q: "Why did Antonelli beat Russell at the 2026 Italian Grand Prix?" },
  { id: "d2", tier: "discovery", q: "How did Kimi Antonelli win Monza 2026 from 19th on the grid?" },
  { id: "t1", tier: "timeline", q: "What were the decisive events of the 2026 Italian Grand Prix race?" },
  { id: "t2", tier: "timeline", q: "List the safety car, virtual safety car and red flag periods in the 2026 Italian GP race with their laps." },
  { id: "a1", tier: "atomic", q: "What caused the virtual safety car in the 2026 Italian Grand Prix race?" },
  { id: "a2", tier: "atomic", q: "Which drivers pitted during the virtual safety car at Monza 2026 and what tyre compounds did they switch to?" },
  { id: "a3", tier: "atomic", q: "How did Antonelli's gap to Russell change over the last 10 laps of the 2026 Italian GP?" },
  { id: "a4", tier: "atomic", q: "What tyre compounds did Antonelli and Russell run in each stint at the 2026 Italian Grand Prix?" },
  { id: "a5", tier: "atomic", q: "What position was Antonelli in at the restart after the red flag at Monza 2026?" },
  { id: "a6", tier: "atomic", q: "What is the drivers' championship gap between Antonelli and Russell after the 2026 Italian GP?" },
  { id: "x1", tier: "adversarial", q: "Was the 2026 Italian Grand Prix won on pure pace?" },
  { id: "x2", tier: "adversarial", q: "Did Russell lose the 2026 Italian GP because of a mistake?" },
  { id: "u1", tier: "unsupported", q: "At which corner did Antonelli pass Russell for the lead at Monza 2026?" },
  { id: "u2", tier: "unsupported", q: "Did Antonelli run into the gravel while attacking Russell at Monza 2026?" }
];

async function ask(question, disableTemplates) {
  const body = { message: question.q, context: {}, debug: { trace: true, runId, questionId: `${question.id}:${disableTemplates ? "llm" : "natural"}`, disableTemplates } };
  const t0 = Date.now();
  let payload = {}, status = 0, text = "";
  try {
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    status = res.status; text = await res.text();
    try { payload = JSON.parse(text); } catch { payload = {}; }
  } catch (e) { text = String(e.message); }
  return {
    id: question.id, tier: question.tier, route: disableTemplates ? "llm_sql_only" : "natural", question: question.q,
    http: status, ms: Date.now() - t0,
    answer: payload.answer ?? payload.message ?? null,
    sql: payload.sql ?? null,
    rowCount: payload.result?.rowCount ?? null,
    rows_preview: Array.isArray(payload.result?.rows) ? payload.result.rows.slice(0, 5) : null,
    questionType: payload.runtime?.questionType ?? null,
    resolutionStatus: payload.runtime?.resolution?.status ?? null,
    resolvedSessionKey: payload.runtime?.resolution?.selectedSession?.sessionKey ?? null,
    matchedKeyword: payload.matchedKeyword ?? null,
    warnings: payload.runtime?.completeness?.warnings ?? [],
    error: payload.error ?? (status >= 400 ? text.slice(0, 200) : null)
  };
}

const results = [];
for (const q of QUESTIONS) {
  for (const disable of [false, true]) {
    const r = await ask(q, disable);
    results.push(r);
    console.log(`${r.id.padEnd(3)} ${r.route.padEnd(13)} http=${r.http} rows=${r.rowCount ?? "-"} type=${r.questionType ?? "-"} sess=${r.resolvedSessionKey ?? "-"} | ${(r.answer ?? r.error ?? "").replace(/\s+/g, " ").slice(0, 110)}`);
  }
}

// join routing metadata from the debug trace log (queryPath / templateKey / generationSource)
const traceFile = resolve(process.cwd(), "logs", "chat_query_trace.jsonl");
if (existsSync(traceFile)) {
  const lines = readFileSync(traceFile, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((t) => t && t.runId === runId);
  for (const r of results) {
    const t = lines.find((x) => x.questionId === `${r.id}:${r.route === "llm_sql_only" ? "llm" : "natural"}`);
    if (t) Object.assign(r, { queryPath: t.queryPath ?? null, templateKey: t.templateKey ?? null, generationSource: t.generationSource ?? null, model: t.model ?? null });
  }
}
const out = resolve(process.cwd(), "..", "analyst", `2026_1293`, "probe.json");
writeFileSync(out, JSON.stringify({ runId, base, session_key: sessionKey, probed_at: new Date().toISOString(), results }, null, 2) + "\n");
console.log(`\nwrote ${out}`);
