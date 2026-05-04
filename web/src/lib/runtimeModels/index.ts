// Phase 22-A (slice 22-A-runtime-model-tool-plumbing): the model-tool
// plumbing interface every Phase 22 model uses. Codex audit verdict:
// ship as fully autonomous; only the per-model statistical validation
// (22-tyre-deg-bayesian, 22-battle-forecast, etc.) needs operator
// review.
//
// Two ship paths from the plan:
//   (1) If Phase 17-H (tools-use refactor) has shipped: register each
//       model as an Anthropic tool; LLM invokes by name with
//       parameters.
//   (2) If 17-H has NOT shipped: a one-off shim that intercepts
//       question patterns matching a model's keywords and routes to
//       the model helper directly. Same Node/SQL function signature
//       so the future migration to the tools-use path is mechanical.
//
// As of 2026-05-03 17-H has NOT shipped. This module implements path (2)
// with a pluggable model registry. When 17-H lands, the registry is
// reused; only the dispatch site (chatRuntime / orchestration) flips
// to the tools-use callsite.

export type RuntimeModelInput = Record<string, string | number | boolean | null | undefined>;

export type RuntimeModelOutput = {
  modelName: string;
  payload: Record<string, unknown>;
  // perf: how long the model took, for the chat trace.
  elapsedMs: number;
  // confidence: optional [0..1] confidence the model returns alongside
  // its prediction. Used by the synthesis layer to render appropriate
  // hedging language.
  confidence?: number;
  // notes: free-text caveat from the model (e.g. "extrapolating beyond
  // training distribution" / "small sample").
  notes?: string;
};

export type RuntimeModel = {
  // Stable name used both as the tools-use registration key and as the
  // shim's keyword fingerprint. Lowercase snake-case.
  readonly name: string;
  // Human-readable description for the LLM tool registration step.
  readonly description: string;
  // Phrase fingerprints — the shim path uses these to detect that a
  // user message wants this model. Phrase-level matches (case-
  // insensitive). Empty array → never routed via shim (tools-use only).
  readonly keywords: ReadonlyArray<string>;
  // Validates an input bag against the model's required fields.
  // Returns null on valid input, or a string message describing the
  // first missing/invalid field.
  validateInput(input: RuntimeModelInput): string | null;
  // Runs the model. MUST return within `runtimeBudgetMs` from
  // ModelDispatchOptions or throw an Error tagged `model_timeout`.
  run(input: RuntimeModelInput): Promise<RuntimeModelOutput>;
};

// -----------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------

const REGISTRY = new Map<string, RuntimeModel>();

export function registerRuntimeModel(model: RuntimeModel): void {
  if (REGISTRY.has(model.name)) {
    throw new Error(`runtime model already registered: ${model.name}`);
  }
  REGISTRY.set(model.name, model);
}

export function getRuntimeModel(name: string): RuntimeModel | undefined {
  return REGISTRY.get(name);
}

export function listRuntimeModels(): ReadonlyArray<RuntimeModel> {
  return Array.from(REGISTRY.values());
}

export function _resetRuntimeModelRegistryForTests(): void {
  REGISTRY.clear();
}

// -----------------------------------------------------------------------
// Shim path: phrase-level routing
// -----------------------------------------------------------------------

/**
 * Phase 22-A shim path: given a normalized message, return the first
 * registered model whose keywords match — or null. Phrase-level match
 * with the same regex shape as `proprietaryNoData` to avoid bare-token
 * collisions.
 */
export function detectRuntimeModelMatch(message: string): RuntimeModel | null {
  const lower = message.toLowerCase();
  for (const model of REGISTRY.values()) {
    for (const keyword of model.keywords) {
      const escaped = keyword
        .toLowerCase()
        .replace(/[\\.*+?^${}()|[\]]/g, "\\$&")
        .replace(/[\s-]+/g, "[\\s-]+");
      const re = new RegExp(`(^|\\b)${escaped}(\\b|$)`, "i");
      if (re.test(lower)) return model;
    }
  }
  return null;
}

// -----------------------------------------------------------------------
// Dispatch — wraps validation + timeout + telemetry
// -----------------------------------------------------------------------

export type ModelDispatchOptions = {
  runtimeBudgetMs?: number; // default 10_000
};

export async function dispatchRuntimeModel(
  modelName: string,
  input: RuntimeModelInput,
  opts: ModelDispatchOptions = {}
): Promise<RuntimeModelOutput> {
  const model = REGISTRY.get(modelName);
  if (!model) {
    throw new Error(`runtime model not registered: ${modelName}`);
  }
  const validationError = model.validateInput(input);
  if (validationError) {
    throw new Error(`runtime model "${modelName}" input invalid: ${validationError}`);
  }
  const budgetMs = opts.runtimeBudgetMs ?? 10_000;
  const startedAt = Date.now();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      model.run(input),
      new Promise<RuntimeModelOutput>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("model_timeout")), budgetMs);
      })
    ]);
    return {
      ...result,
      elapsedMs: Date.now() - startedAt
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------
// 22-A acceptance stub: a model that returns a fixed payload, used by
// the plumbing test to prove the dispatch path works end-to-end.
// -----------------------------------------------------------------------

export const STUB_MODEL: RuntimeModel = {
  name: "stub_model_22a",
  description:
    "Phase 22-A plumbing stub. Returns a fixed payload to prove the dispatch interface works end-to-end. Replace with real models in 22-B onward.",
  keywords: ["stub model 22a", "phase 22-a stub"],
  validateInput(input) {
    if (typeof input.question !== "string" || input.question.length === 0) {
      return "missing required field: question";
    }
    return null;
  },
  async run(input) {
    return {
      modelName: this.name,
      payload: {
        echoedQuestion: input.question,
        note:
          "stub model returning a fixed payload — 22-B onward replaces this with real Bayesian / forecast / Monte Carlo models."
      },
      elapsedMs: 0,
      confidence: 1.0
    };
  }
};
