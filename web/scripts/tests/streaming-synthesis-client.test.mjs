import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const consumeSourcePath = path.resolve(webRoot, "src/lib/chat/consumeChatStream.ts");
const sendSourcePath = path.resolve(webRoot, "src/lib/chat/sendChatMessage.ts");
const chatWorkspacePath = path.resolve(webRoot, "src/components/chat/ChatWorkspace.tsx");

// Bundling helper. Both modules are transpiled with `typescript`'s
// `transpileModule` (ES2022 / ESNext) into a `mkdtemp`'d directory so Node
// can resolve `sendChatMessage.ts`'s sole runtime VALUE import (the relative
// `./consumeChatStream` import) against its sibling `.mjs` output. The other
// imports in both files are `import type` declarations, which TypeScript's
// import-elision drops at strip-time, so no `@/lib/*` stub sandbox is
// required for this slice (per slice 07-streaming-synthesis-client-wiring
// Step 4: "No `@/lib/*` stubs are needed for this slice"). The slice
// constrains `sendChatMessage.ts` to keep that single relative value import;
// any future addition of a runtime `@/lib/*` import here would need a stub.
async function loadHelpers() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-streaming-synthesis-client-"));

  const consumeSrc = await readFile(consumeSourcePath, "utf8");
  const consumeTranspiled = ts.transpileModule(consumeSrc, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });

  const sendSrcRaw = await readFile(sendSourcePath, "utf8");
  // Rewrite the relative `./consumeChatStream` import to the sibling .mjs that
  // we are about to write into the same tmpdir. Without this, Node throws
  // ERR_MODULE_NOT_FOUND when resolving the bare extensionless specifier.
  const sendSrc = sendSrcRaw.replace(
    /from\s+["']\.\/consumeChatStream["']/g,
    `from "./consumeChatStream.mjs"`
  );
  const sendTranspiled = ts.transpileModule(sendSrc, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });

  await writeFile(path.join(dir, "consumeChatStream.mjs"), consumeTranspiled.outputText, "utf8");
  await writeFile(path.join(dir, "sendChatMessage.mjs"), sendTranspiled.outputText, "utf8");

  const consumeMod = await import(path.join(dir, "consumeChatStream.mjs"));
  const sendMod = await import(path.join(dir, "sendChatMessage.mjs"));
  return {
    dir,
    consumeChatStream: consumeMod.consumeChatStream,
    sendChatMessage: sendMod.sendChatMessage
  };
}

async function withHelpers(run) {
  const loaded = await loadHelpers();
  try {
    await run(loaded);
  } finally {
    await rm(loaded.dir, { recursive: true, force: true });
  }
}

function encodeFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function makeSseResponse(frames) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const f of frames) {
        controller.enqueue(encoder.encode(f));
      }
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

function makeJsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

// ---------------------------------------------------------------------------
// consumeChatStream unit tests
// ---------------------------------------------------------------------------

test("consumeChatStream SSE: fires onAnswerDelta for each frame and returns final payload", async () => {
  await withHelpers(async ({ consumeChatStream }) => {
    const finalPayload = {
      requestId: "r1",
      answer: "Hello world!",
      sql: "SELECT 1",
      generationSource: "stream",
      model: "stub-model"
    };
    const response = makeSseResponse([
      encodeFrame("answer_delta", { text: "Hello " }),
      encodeFrame("answer_delta", { text: "world" }),
      encodeFrame("answer_delta", { text: "!" }),
      encodeFrame("final", finalPayload)
    ]);

    const answerDeltas = [];
    const reasoningDeltas = [];
    const result = await consumeChatStream(response, {
      onAnswerDelta: (t) => answerDeltas.push(t),
      onReasoningDelta: (t) => reasoningDeltas.push(t)
    });

    assert.deepEqual(answerDeltas, ["Hello ", "world", "!"]);
    assert.deepEqual(reasoningDeltas, []);
    assert.deepEqual(result, finalPayload);
  });
});

test("consumeChatStream SSE: forwards reasoning_delta to onReasoningDelta", async () => {
  await withHelpers(async ({ consumeChatStream }) => {
    const finalPayload = { answer: "ok", sql: "SELECT 1" };
    const response = makeSseResponse([
      encodeFrame("reasoning_delta", { text: "think 1" }),
      encodeFrame("answer_delta", { text: "ok" }),
      encodeFrame("reasoning_delta", { text: "think 2" }),
      encodeFrame("final", finalPayload)
    ]);

    const answerDeltas = [];
    const reasoningDeltas = [];
    await consumeChatStream(response, {
      onAnswerDelta: (t) => answerDeltas.push(t),
      onReasoningDelta: (t) => reasoningDeltas.push(t)
    });

    assert.deepEqual(answerDeltas, ["ok"]);
    assert.deepEqual(reasoningDeltas, ["think 1", "think 2"]);
  });
});

test("consumeChatStream SSE: throws when an error frame is received", async () => {
  await withHelpers(async ({ consumeChatStream }) => {
    const response = makeSseResponse([
      encodeFrame("answer_delta", { text: "partial" }),
      encodeFrame("error", { message: "synthesis blew up", code: "internal" })
    ]);
    await assert.rejects(
      consumeChatStream(response, {}),
      (err) => err instanceof Error && /synthesis blew up/.test(err.message)
    );
  });
});

test("consumeChatStream JSON fallback: fires onAnswerDelta once with full answer and returns payload unchanged", async () => {
  await withHelpers(async ({ consumeChatStream }) => {
    const payload = {
      requestId: "r2",
      answer: "buffered answer text",
      sql: "SELECT 2",
      generationSource: "json"
    };
    const response = makeJsonResponse(payload);

    const answerDeltas = [];
    const result = await consumeChatStream(response, {
      onAnswerDelta: (t) => answerDeltas.push(t)
    });

    assert.deepEqual(answerDeltas, ["buffered answer text"]);
    assert.deepEqual(result, payload);
  });
});

// ---------------------------------------------------------------------------
// sendChatMessage integration tests
// ---------------------------------------------------------------------------

function makeSendDeps(overrides = {}) {
  const calls = []; // chronological log of patchActiveConversation effects
  let conversation = { id: "conv-1", title: "t", updatedAt: "0", messages: [] };
  const patchActiveConversation = (fn) => {
    conversation = fn(conversation);
    // Apply a hook the test can use to mutate state mid-stream (e.g. simulate
    // a no-op reorder of messages between deltas).
    if (overrides.afterPatch) {
      conversation = overrides.afterPatch(conversation, calls.length) ?? conversation;
    }
    calls.push({
      messages: conversation.messages.map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.role === "assistant" ? m.parts.map((p) => ({ ...p })) : null,
        text: m.role === "user" ? m.text : null
      })),
      lastResolved: conversation.lastResolved ?? null,
      contextSnapshot: conversation.contextSnapshot ?? null
    });
  };
  const setResolvedCalls = [];
  const setComposerCtxCalls = [];
  return {
    calls,
    setResolvedCalls,
    setComposerCtxCalls,
    getConversation: () => conversation,
    deps: {
      fetchImpl: overrides.fetchImpl,
      patchActiveConversation,
      setResolved: (ctx) => setResolvedCalls.push(ctx),
      setComposerCtx: (ctx) => setComposerCtxCalls.push(ctx),
      mapResponseToParts: overrides.mapResponseToParts
        ?? ((data) => [{ type: "text", text: data.answer }]),
      deriveResolved: overrides.deriveResolved ?? ((data) => ({ requestId: data.requestId }))
    }
  };
}

test("sendChatMessage inserts placeholder before any delta is processed", async () => {
  await withHelpers(async ({ sendChatMessage }) => {
    const finalPayload = {
      requestId: "rA",
      answer: "Hello world",
      sql: "SELECT 1"
    };
    const fetchImpl = async () =>
      makeSseResponse([
        encodeFrame("answer_delta", { text: "Hello " }),
        encodeFrame("answer_delta", { text: "world" }),
        encodeFrame("final", finalPayload)
      ]);

    const harness = makeSendDeps({ fetchImpl });
    await sendChatMessage(
      {
        text: "what",
        snapshotAtSend: { sessionKey: 42 },
        assistantTime: "t-assist",
        placeholderId: "ph-1"
      },
      harness.deps
    );

    // First patch must add the placeholder with empty parts (placeholder-first
    // ordering: the helper appended it BEFORE awaiting the fetch).
    assert.equal(harness.calls[0].messages.length, 1);
    assert.equal(harness.calls[0].messages[0].id, "ph-1");
    assert.equal(harness.calls[0].messages[0].role, "assistant");
    assert.deepEqual(harness.calls[0].messages[0].parts, []);

    // Subsequent patches reflect the cumulative text per delta.
    assert.equal(harness.calls[1].messages[0].parts[0].text, "Hello ");
    assert.equal(harness.calls[2].messages[0].parts[0].text, "Hello world");

    // Final patch replaces parts with mapResponseToParts output and sets
    // lastResolved + contextSnapshot.
    const finalCall = harness.calls[harness.calls.length - 1];
    assert.deepEqual(finalCall.messages[0].parts, [{ type: "text", text: "Hello world" }]);
    assert.deepEqual(finalCall.lastResolved, {
      sessionKey: undefined,
      sessionLabel: undefined,
      driverNumbers: undefined,
      resolutionStatus: undefined,
      needsClarification: undefined,
      requestId: "rA"
    });

    // Resolved/composer setters were called.
    assert.equal(harness.setResolvedCalls.length, 1);
    assert.equal(harness.setComposerCtxCalls.length, 1);
    assert.equal(harness.setComposerCtxCalls[0].sessionKey, 42);
  });
});

test("sendChatMessage patches placeholder by id even after a no-op reorder of messages", async () => {
  await withHelpers(async ({ sendChatMessage }) => {
    const finalPayload = { requestId: "rB", answer: "abc", sql: "SELECT 1" };
    const fetchImpl = async () =>
      makeSseResponse([
        encodeFrame("answer_delta", { text: "a" }),
        encodeFrame("answer_delta", { text: "b" }),
        encodeFrame("answer_delta", { text: "c" }),
        encodeFrame("final", finalPayload)
      ]);

    // After the FIRST delta patch lands (calls.length becomes 2 — index 0 was
    // the placeholder insert, index 1 was the first delta), reorder: prepend
    // an unrelated user message so the placeholder is no longer at index 0.
    // The helper must still find it by id for subsequent deltas.
    const overrides = {
      fetchImpl,
      afterPatch: (conv, callCountSoFar) => {
        if (callCountSoFar === 1) {
          return {
            ...conv,
            messages: [
              { id: "spy-user", role: "user", createdAt: "t0", text: "noop" },
              ...conv.messages
            ]
          };
        }
        return conv;
      }
    };
    const harness = makeSendDeps(overrides);
    await sendChatMessage(
      {
        text: "q",
        snapshotAtSend: {},
        assistantTime: "t",
        placeholderId: "ph-2"
      },
      harness.deps
    );

    const last = harness.calls[harness.calls.length - 1];
    // Placeholder is still present (found by id), and ended with the final
    // mapped parts. The "spy-user" reorder did not corrupt the patch path.
    const placeholder = last.messages.find((m) => m.id === "ph-2");
    assert.ok(placeholder, "placeholder must still be present after reorder");
    assert.deepEqual(placeholder.parts, [{ type: "text", text: "abc" }]);
    // Non-placeholder messages are preserved.
    const spy = last.messages.find((m) => m.id === "spy-user");
    assert.ok(spy, "reordered spy message must remain present");
  });
});

test("sendChatMessage replaces placeholder with error message when stream throws mid-stream", async () => {
  await withHelpers(async ({ sendChatMessage }) => {
    const fetchImpl = async () =>
      makeSseResponse([
        encodeFrame("answer_delta", { text: "partial" }),
        encodeFrame("error", { message: "boom", code: "internal" })
      ]);

    const harness = makeSendDeps({ fetchImpl });
    await sendChatMessage(
      {
        text: "q",
        snapshotAtSend: {},
        assistantTime: "t",
        placeholderId: "ph-3"
      },
      harness.deps
    );

    const final = harness.calls[harness.calls.length - 1];
    const placeholder = final.messages.find((m) => m.id === "ph-3");
    assert.ok(placeholder, "placeholder must be present after error");
    assert.equal(placeholder.parts.length, 1);
    assert.equal(placeholder.parts[0].type, "text");
    // Error path replaces parts with the error notice — placeholder is NOT
    // left in streaming state (still showing the partial cumulative text).
    assert.equal(placeholder.parts[0].text, "Unable to process this request right now.");
  });
});

test("sendChatMessage replaces placeholder with error message when fetch itself rejects", async () => {
  await withHelpers(async ({ sendChatMessage }) => {
    const fetchImpl = async () => {
      throw new Error("network down");
    };
    const harness = makeSendDeps({ fetchImpl });
    await sendChatMessage(
      {
        text: "q",
        snapshotAtSend: {},
        assistantTime: "t",
        placeholderId: "ph-4"
      },
      harness.deps
    );

    const final = harness.calls[harness.calls.length - 1];
    const placeholder = final.messages.find((m) => m.id === "ph-4");
    assert.ok(placeholder, "placeholder must be present after fetch reject");
    assert.equal(placeholder.parts[0].text, "Unable to process this request right now.");
  });
});

test("sendChatMessage falls back gracefully on JSON response (no SSE stream)", async () => {
  await withHelpers(async ({ sendChatMessage }) => {
    const payload = {
      requestId: "rC",
      answer: "buffered fallback",
      sql: "SELECT 3"
    };
    const fetchImpl = async () => makeJsonResponse(payload);
    const harness = makeSendDeps({ fetchImpl });
    await sendChatMessage(
      {
        text: "q",
        snapshotAtSend: {},
        assistantTime: "t",
        placeholderId: "ph-5"
      },
      harness.deps
    );

    // calls[0] = placeholder insert; calls[1] = single onAnswerDelta with the
    // full answer string; calls[2] = final replacement parts.
    assert.equal(harness.calls[0].messages[0].parts.length, 0);
    assert.equal(harness.calls[1].messages[0].parts[0].text, "buffered fallback");
    const final = harness.calls[harness.calls.length - 1];
    assert.deepEqual(final.messages[0].parts, [{ type: "text", text: "buffered fallback" }]);
  });
});

// ---------------------------------------------------------------------------
// ChatWorkspace.tsx wiring assertion (deterministic source-grep gate)
// ---------------------------------------------------------------------------

test("ChatWorkspace.tsx is wired into sendChatMessage and opts into SSE", async () => {
  const source = await readFile(chatWorkspacePath, "utf8");
  // (a) The component delegates the post-user-message work to sendChatMessage.
  assert.ok(
    source.includes("sendChatMessage("),
    "ChatWorkspace.tsx must call sendChatMessage(...) (delegation gate)"
  );
  // (b) The Accept: text/event-stream opt-in is present in the live component
  // (substring test — the actual header is set by the helper, which the
  // component documents inline so the wiring is self-evident at the call site).
  assert.ok(
    source.includes("text/event-stream"),
    "ChatWorkspace.tsx must reference text/event-stream (SSE opt-in gate)"
  );
  // (c) The old inline JSON-only fetch block must be removed: no direct
  // fetch("/api/chat") call may remain anywhere in the file. (Helper-only
  // refactors that leave the component issuing JSON-only requests are blocked
  // by this assertion.)
  assert.ok(
    !source.includes('fetch("/api/chat"'),
    "ChatWorkspace.tsx must not contain a direct double-quoted fetch(\"/api/chat\") literal"
  );
  assert.ok(
    !source.includes("fetch('/api/chat'"),
    "ChatWorkspace.tsx must not contain a direct single-quoted fetch('/api/chat') literal"
  );
});
