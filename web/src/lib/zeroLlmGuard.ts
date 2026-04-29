export function assertNoLlmForDeterministic(args: {
  generationSource: string;
  templateKey?: string;
  callSite: "generateSqlWithAnthropic" | "repairSqlWithAnthropic" | "cachedSynthesize";
}): void {
  if (process.env.NODE_ENV === "production") {
    return;
  }
  if (args.generationSource !== "deterministic_template") {
    return;
  }
  throw new Error(
    `zero-llm-path violation: callSite=${args.callSite} templateKey=${args.templateKey ?? "<unknown>"}`
  );
}
