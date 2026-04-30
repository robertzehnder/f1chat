import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..", "..");
const anthropicSourcePath = path.resolve(webRoot, "src/lib/anthropic.ts");
const buildSynthesisPromptSourcePath = path.resolve(
  webRoot,
  "src/lib/synthesis/buildSynthesisPrompt.ts"
);

async function loadAnthropicModule() {
  const dir = await mkdtemp(path.join(__dirname, ".tmp-streaming-synthesis-server-"));

  const buildSynthesisSource = await readFile(buildSynthesisPromptSourcePath, "utf8");
  const buildSynthesisOut = ts.transpileModule(buildSynthesisSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  await writeFile(path.join(dir, "buildSynthesisPrompt.mjs"), buildSynthesisOut.outputText, "utf8");

  const sourceText = await readFile(anthropicSourcePath, "utf8");
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  const rewritten = transpiled.outputText.replace(
    /@\/lib\/synthesis\/buildSynthesisPrompt/g,
    "./buildSynthesisPrompt.mjs"
  );
  await writeFile(path.join(dir, "anthropic.mjs"), rewritten, "utf8");
  const mod = await import(path.join(dir, "anthropic.mjs"));
  return { dir, mod };
}

async function withAnthropic(run) {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  const loaded = await loadAnthropicModule();
  const originalFetch = globalThis.fetch;
  try {
    await run(loaded.mod);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousKey;
    }
    await rm(loaded.dir, { recursive: true, force: true });
  }
}

function makeSseStreamingResponse(textChunks) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of textChunks) {
        const event =
          `event: content_block_delta\n` +
          `data: ${JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: chunk }
          })}\n\n`;
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

const SYNTH_INPUT = {
  question: "Who won the race?",
  sql: "SELECT 1",
  contract: {
    contractName: "core.sessions",
    grain: "session",
    keys: {},
    rows: [],
    rowCount: 0
  }
};

test("synthesizeAnswerStream emits answer_delta then reasoning_delta then a single final frame with concatenations matching the parsed JSON", async () => {
  await withAnthropic(async (mod) => {
    const textChunks = [
      `{"answer": "Lewis `,
      `Hamilton won.", "reasoning": "He `,
      `had the fastest pace."}`
    ];
    globalThis.fetch = async () => makeSseStreamingResponse(textChunks);

    const chunks = [];
    for await (const c of mod.synthesizeAnswerStream(SYNTH_INPUT)) {
      chunks.push(c);
    }

    const answerDeltas = chunks.filter((c) => c.kind === "answer_delta");
    const reasoningDeltas = chunks.filter((c) => c.kind === "reasoning_delta");
    const finalChunks = chunks.filter((c) => c.kind === "final");

    assert.ok(
      answerDeltas.length >= 2,
      `expected >=2 answer_delta chunks, got ${answerDeltas.length}`
    );
    assert.ok(
      reasoningDeltas.length >= 1,
      `expected >=1 reasoning_delta chunks, got ${reasoningDeltas.length}`
    );
    assert.equal(
      finalChunks.length,
      1,
      `expected exactly 1 final chunk, got ${finalChunks.length}`
    );

    const finalChunk = finalChunks[0];
    const concatenatedAnswer = answerDeltas.map((c) => c.text).join("");
    const concatenatedReasoning = reasoningDeltas.map((c) => c.text).join("");

    assert.equal(
      finalChunk.answer,
      concatenatedAnswer,
      "final.answer must match the concatenation of all answer_delta texts"
    );
    assert.equal(
      finalChunk.reasoning,
      concatenatedReasoning,
      "final.reasoning must match the concatenation of all reasoning_delta texts"
    );
    assert.ok(
      typeof finalChunk.model === "string" && finalChunk.model.length > 0,
      "final.model must be a non-empty string"
    );
    assert.equal(
      finalChunk.model,
      process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      "final.model must match DEFAULT_ANTHROPIC_MODEL"
    );
    assert.equal(
      finalChunk.rawText,
      textChunks.join(""),
      "final.rawText must equal the concatenation of all SSE text_delta payloads"
    );
    assert.ok(
      finalChunk.rawText.length > 0,
      "final.rawText must be non-empty"
    );

    let lastAnswerIdx = -1;
    let firstReasoningIdx = chunks.length;
    chunks.forEach((c, i) => {
      if (c.kind === "answer_delta") lastAnswerIdx = Math.max(lastAnswerIdx, i);
      if (c.kind === "reasoning_delta") firstReasoningIdx = Math.min(firstReasoningIdx, i);
    });
    assert.ok(
      lastAnswerIdx < firstReasoningIdx,
      "all answer_delta events must precede all reasoning_delta events"
    );
  });
});

test("synthesizeAnswerStream throws on malformed JSON at terminal-parse time (re-uses parseAnswerJsonPayload error class)", async () => {
  await withAnthropic(async (mod) => {
    const textChunks = [`{"answer": "abc`];
    globalThis.fetch = async () => makeSseStreamingResponse(textChunks);

    await assert.rejects(
      async () => {
        for await (const _ of mod.synthesizeAnswerStream(SYNTH_INPUT)) {
          void _;
        }
      },
      /Could not parse JSON from model output/,
      "iterator must throw the parseAnswerJsonPayload error when terminal JSON is malformed"
    );
  });
});

test("synthesizeAnswerWithAnthropic non-regression: returns {answer, reasoning, model, rawText} from non-streaming Anthropic Messages-API response", async () => {
  await withAnthropic(async (mod) => {
    const rawText = '{"answer": "stubbed", "reasoning": "stubbed-reasoning"}';
    const responseBody = {
      content: [{ type: "text", text: rawText }]
    };
    globalThis.fetch = async () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    const result = await mod.synthesizeAnswerWithAnthropic(SYNTH_INPUT);

    assert.equal(result.answer, "stubbed");
    assert.equal(result.reasoning, "stubbed-reasoning");
    assert.ok(
      typeof result.model === "string" && result.model.length > 0,
      "synthesizeAnswerWithAnthropic.model must be a non-empty string"
    );
    assert.equal(
      result.model,
      process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      "synthesizeAnswerWithAnthropic.model must match DEFAULT_ANTHROPIC_MODEL"
    );
    assert.equal(result.rawText, rawText);
  });
});
