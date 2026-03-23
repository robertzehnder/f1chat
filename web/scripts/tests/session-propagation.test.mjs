import assert from "node:assert/strict";
import test from "node:test";

const runIntegration = /^(1|true|yes|on)$/i.test(
  String(process.env.OPENF1_RUN_CHAT_INTEGRATION_TESTS ?? "")
);
const baseUrl = process.env.OPENF1_CHAT_BASE_URL ?? "http://127.0.0.1:3000";

async function postChat(message, questionId = 999001) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      debug: { trace: true, benchmark: true, questionId, runId: "session-propagation-test", attempt: "initial" }
    })
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { parse_error_body: text };
  }

  return { response, payload };
}

test("explicit Abu Dhabi 2025 race prompts keep canonical session 9839", async (t) => {
  if (!runIntegration) {
    t.skip(
      "Set OPENF1_RUN_CHAT_INTEGRATION_TESTS=1 to run /api/chat propagation checks against a running app."
    );
    return;
  }

  const message =
    "Between Max Verstappen and Charles Leclerc in the Abu Dhabi 2025 race session, who was quicker on fresh tires versus used tires?";
  const { response, payload } = await postChat(message);

  assert.equal(response.ok, true, `Expected 200 from /api/chat but got ${response.status}: ${JSON.stringify(payload)}`);
  assert.equal(
    Number(payload?.runtime?.resolution?.selectedSession?.sessionKey),
    9839,
    `Expected runtime resolved session_key 9839 but got ${payload?.runtime?.resolution?.selectedSession?.sessionKey}`
  );
  assert.match(String(payload?.sql ?? ""), /session_key\s*=\s*9839\b/i);
  assert.doesNotMatch(String(payload?.sql ?? ""), /session_key\s*=\s*(9693|9998|10006)\b/i);
  assert.match(String(payload?.generationNotes ?? ""), /session_pin/i);
});

test("exact Max Verstappen name resolves canonically to driver #1", async (t) => {
  if (!runIntegration) {
    t.skip(
      "Set OPENF1_RUN_CHAT_INTEGRATION_TESTS=1 to run /api/chat propagation checks against a running app."
    );
    return;
  }

  const message = "Which sessions did Max Verstappen participate in during 2025?";
  const { response, payload } = await postChat(message, 999002);

  assert.equal(response.ok, true, `Expected 200 from /api/chat but got ${response.status}: ${JSON.stringify(payload)}`);
  assert.ok(
    Array.isArray(payload?.runtime?.resolution?.selectedDriverNumbers),
    "Expected runtime.resolution.selectedDriverNumbers to be present"
  );
  assert.ok(
    payload.runtime.resolution.selectedDriverNumbers.includes(1),
    `Expected driver #1 in selectedDriverNumbers but got ${JSON.stringify(payload.runtime.resolution.selectedDriverNumbers)}`
  );
  assert.match(String(payload?.sql ?? ""), /driver_number\s*=\s*1\b/i);
  assert.doesNotMatch(String(payload?.sql ?? ""), /driver_number\s*=\s*3\b/i);
});

test("generic 'given session' prompts short-circuit to clarification", async (t) => {
  if (!runIntegration) {
    t.skip(
      "Set OPENF1_RUN_CHAT_INTEGRATION_TESTS=1 to run /api/chat propagation checks against a running app."
    );
    return;
  }

  const message = "Which drivers participated in a given session?";
  const { response, payload } = await postChat(message, 999003);

  assert.equal(response.ok, true, `Expected 200 from /api/chat but got ${response.status}: ${JSON.stringify(payload)}`);
  assert.equal(payload?.generationSource, "runtime_clarification");
  assert.equal(payload?.runtime?.resolution?.needsClarification, true);
  assert.equal(payload?.runtime?.resolution?.selectedSession ?? null, null);
  assert.equal((payload?.runtime?.resolution?.sessionCandidates ?? []).length, 0);
  assert.match(String(payload?.sql ?? ""), /query not executed \(clarification required\)/i);
});

test("generic team-by-session prompt short-circuits to clarification without session binding", async (t) => {
  if (!runIntegration) {
    t.skip(
      "Set OPENF1_RUN_CHAT_INTEGRATION_TESTS=1 to run /api/chat propagation checks against a running app."
    );
    return;
  }

  const message = "Which teams were present in a given session?";
  const { response, payload } = await postChat(message, 999004);

  assert.equal(response.ok, true, `Expected 200 from /api/chat but got ${response.status}: ${JSON.stringify(payload)}`);
  assert.equal(payload?.generationSource, "runtime_clarification");
  assert.equal(payload?.runtime?.resolution?.needsClarification, true);
  assert.equal(payload?.runtime?.resolution?.selectedSession ?? null, null);
  assert.equal((payload?.runtime?.resolution?.sessionCandidates ?? []).length, 0);
  assert.match(String(payload?.answer ?? ""), /specify the session/i);
});

test("generic race roster prompt short-circuits to clarification without retryable session pin", async (t) => {
  if (!runIntegration) {
    t.skip(
      "Set OPENF1_RUN_CHAT_INTEGRATION_TESTS=1 to run /api/chat propagation checks against a running app."
    );
    return;
  }

  const message = "What is the roster for a given race session, with driver and team names?";
  const { response, payload } = await postChat(message, 999005);

  assert.equal(response.ok, true, `Expected 200 from /api/chat but got ${response.status}: ${JSON.stringify(payload)}`);
  assert.equal(payload?.generationSource, "runtime_clarification");
  assert.equal(payload?.runtime?.resolution?.needsClarification, true);
  assert.equal(payload?.runtime?.resolution?.selectedSession ?? null, null);
  assert.equal((payload?.runtime?.resolution?.sessionCandidates ?? []).length, 0);
  assert.match(String(payload?.answer ?? ""), /specify the race session|specify the session/i);
});

test("single-driver ambiguity clarification is specific for missing-session prompts", async (t) => {
  if (!runIntegration) {
    t.skip(
      "Set OPENF1_RUN_CHAT_INTEGRATION_TESTS=1 to run /api/chat propagation checks against a running app."
    );
    return;
  }

  const message = "Which sessions is a specific driver missing from, despite the session existing?";
  const { response, payload } = await postChat(message, 999006);

  assert.equal(response.ok, true, `Expected 200 from /api/chat but got ${response.status}: ${JSON.stringify(payload)}`);
  assert.equal(payload?.generationSource, "runtime_clarification");
  assert.equal(payload?.runtime?.resolution?.needsClarification, true);
  assert.match(String(payload?.answer ?? ""), /full name or driver number/i);
  assert.match(String(payload?.answer ?? ""), /missing sessions/i);
});

test("explicit Abu Dhabi 2025 qualifying improvement prompt answers without clarification", async (t) => {
  if (!runIntegration) {
    t.skip(
      "Set OPENF1_RUN_CHAT_INTEGRATION_TESTS=1 to run /api/chat propagation checks against a running app."
    );
    return;
  }

  const message =
    "Between Max Verstappen and Charles Leclerc, who improved more over the course of the Abu Dhabi 2025 qualifying session?";
  const { response, payload } = await postChat(message, 999007);

  assert.equal(response.ok, true, `Expected 200 from /api/chat but got ${response.status}: ${JSON.stringify(payload)}`);
  assert.notEqual(payload?.generationSource, "runtime_clarification");
  assert.equal(payload?.runtime?.resolution?.needsClarification, false);
  assert.equal(payload?.runtime?.resolution?.selectedSession ?? null, null);
  assert.match(String(payload?.generationNotes ?? ""), /max_leclerc_qualifying_improvement/i);
});

test("explicit Abu Dhabi 2025 weekend spread prompt answers without clarification", async (t) => {
  if (!runIntegration) {
    t.skip(
      "Set OPENF1_RUN_CHAT_INTEGRATION_TESTS=1 to run /api/chat propagation checks against a running app."
    );
    return;
  }

  const message =
    "Within the Abu Dhabi 2025 weekend, which session had the smallest spread between the fastest and slowest competitive laps, and how did Max Verstappen and Charles Leclerc compare in that session?";
  const { response, payload } = await postChat(message, 999008);

  assert.equal(response.ok, true, `Expected 200 from /api/chat but got ${response.status}: ${JSON.stringify(payload)}`);
  assert.notEqual(payload?.generationSource, "runtime_clarification");
  assert.equal(payload?.runtime?.resolution?.needsClarification, false);
  assert.match(String(payload?.generationNotes ?? ""), /abu_dhabi_weekend_smallest_spread_and_comparison/i);
});

test("Q6 completeness prompt uses deterministic lightweight template path", async (t) => {
  if (!runIntegration) {
    t.skip(
      "Set OPENF1_RUN_CHAT_INTEGRATION_TESTS=1 to run /api/chat propagation checks against a running app."
    );
    return;
  }

  const message = "Which sessions have the most complete downstream data coverage?";
  const { response, payload } = await postChat(message, 999009);

  assert.equal(response.ok, true, `Expected 200 from /api/chat but got ${response.status}: ${JSON.stringify(payload)}`);
  assert.equal(payload?.runtime?.resolution?.needsClarification, false);
  assert.equal(payload?.generationSource, "deterministic_template");
  assert.match(String(payload?.generationNotes ?? ""), /sessions_most_complete_downstream_coverage/i);
  assert.match(String(payload?.sql ?? ""), /downstream_coverage_score/i);
});
