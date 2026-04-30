export type ChatRuntimeStageLog = {
  stage:
    | "intake"
    | "entity_resolution"
    | "ambiguity_manager"
    | "completeness_check"
    | "grain_selection"
    | "query_planner";
  durationMs: number;
  details: Record<string, unknown>;
};
