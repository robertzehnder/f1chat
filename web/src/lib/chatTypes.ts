export const CHAT_STORE_SCHEMA_VERSION = 1 as const;

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "sql"; sql: string }
  | { type: "table"; title?: string; rows: Record<string, unknown>[]; rowCount: number; elapsedMs: number; truncated: boolean }
  | { type: "warning"; messages: string[] }
  | {
      type: "metadata";
      requestId?: string;
      generationSource?: string;
      model?: string;
      adequacyGrade?: string;
      adequacyReason?: string;
      generationNotes?: string;
      answerReasoning?: string;
      queryPlanSummary?: string;
      resolutionSummary?: string;
    }
  | { type: "followUps"; prompts: string[] };

export type ChatMessageUser = {
  id: string;
  role: "user";
  createdAt: string;
  text: string;
};

export type ChatMessageAssistant = {
  id: string;
  role: "assistant";
  createdAt: string;
  parts: MessagePart[];
};

export type ChatMessage = ChatMessageUser | ChatMessageAssistant;

export type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
  messages: ChatMessage[];
  /** Last composer pins for this thread (restored when selected). */
  contextSnapshot?: ChatContext & { sessionLabel?: string };
  /** Last API resolution metadata for the right panel. */
  lastResolved?: ResolvedSessionContextSnapshot | null;
};

/** Serializable subset for persistence (same shape as ResolvedSessionContext). */
export type ResolvedSessionContextSnapshot = {
  sessionKey?: number;
  sessionLabel?: string;
  driverNumbers?: number[];
  resolutionStatus?: string;
  needsClarification?: boolean;
  requestId?: string;
};

export type ChatStore = {
  schemaVersion: typeof CHAT_STORE_SCHEMA_VERSION;
  conversations: Conversation[];
  activeConversationId: string | null;
};

/**
 * Phase 2 of the v0 visualization match plan: structured fields the
 * synthesis LLM produces alongside `answer` + `reasoning`. The wire
 * format is just additional JSON keys on the synthesis output (the
 * existing pipeline already does keyed-JSON extraction); the merged
 * plan's `<<INSIGHT>>...<<END>>` sentinel framing was overengineered
 * for this codebase. See rev3 of the merged plan.
 *
 * All fields are optional. Missing fields fall back to today's
 * body+sql+rows render — never blank.
 */
export type InsightFieldMetric = {
  label: string;
  value: string;
  unit?: string;
  emphasis?: boolean;
  /** Optional contextual annotation (e.g. "Antonelli (lap 3)"). Rendered
   *  on its own subdued line below the label — keeps the value/unit
   *  pair clean. Prompt rule: unit is pure ("s", "kph", "%"), context
   *  holds qualifiers like driver + lap. */
  context?: string;
};

export type InsightFields = {
  /** Question-relevant title — replaces the question-derived fallback. */
  title?: string;
  /** Venue · session · year line under the title. */
  subtitle?: string;
  /** vNext: promoted one-line answer ("answer at a glance") above the tiles. */
  at_a_glance?: string;
  /** A1: corner-metrics card → mini track-map highlighting one corner. */
  corner_map?: { circuit: string; corner_number?: number; corner_label?: string };
  /** 2-3 hero metric tiles under the body. */
  metrics?: InsightFieldMetric[];
  /** 3-5 bullet takeaways. */
  key_takeaways?: string[];
  /** 2-4 follow-up question chips. */
  related_questions?: string[];
  /** M21 refusal: what the warehouse DOES have (rendered as the muted
   *  "Not in dataset" card's bullet list). Lets a server-side data-gap
   *  refusal supply a relevant list instead of the generic fallback. */
  what_we_have?: string[];
  /** M01 hero scalar payload (bypasses the body for single-fact answers). */
  hero?: { value: string; label: string; context?: string };
  /** M02 yes/no verdict (bypasses the body when present). */
  verdict?: { label: "YES" | "NO"; summary: string; color?: string };
};

/** API response shape from POST /api/chat (subset used by UI). */
export type ChatApiResponse = {
  requestId?: string;
  answer: string;
  sql: string;
  generationSource?: string;
  model?: string;
  generationNotes?: string;
  answerReasoning?: string;
  adequacyGrade?: string;
  adequacyReason?: string;
  responseGrade?: string;
  gradeReason?: string;
  result?: {
    rowCount: number;
    elapsedMs: number;
    truncated: boolean;
    rows: Record<string, unknown>[];
  };
  runtime?: {
    questionType?: string;
    followUp?: boolean;
    resolution?: {
      status?: string;
      needsClarification?: boolean;
      selectedSession?: {
        sessionKey?: number;
        label?: string;
      };
      selectedDriverNumbers?: number[];
      /** B17: session disambiguation candidates. Present (with the full
       *  runtime object) on runtime_clarification responses so the client
       *  can render one-tap choice buttons instead of prose. `label` is the
       *  human-readable "Qualifying / United Arab Emirates / Yas Marina / 2025"
       *  string from buildSessionLabel(); NEVER surface sessionKey as the
       *  visible option text. */
      sessionCandidates?: Array<{
        sessionKey: number;
        sessionName?: string | null;
        year?: number | null;
        confidence?: number;
        score?: number;
        label?: string;
      }>;
    };
    completeness?: {
      warnings?: string[];
      requiredTables?: string[];
    };
    grain?: {
      grain?: string;
      expectedRowVolume?: string;
    };
    queryPlan?: {
      primary_tables?: string[];
      filters?: string[];
      risk_flags?: string[];
      expected_row_count?: string;
    };
  };
  /** Phase 2: structured fields from synthesis. `null` when extraction
   *  failed or the model didn't emit them; old clients ignore. */
  insight?: InsightFields | null;
  error?: string;
};

export type ChatContext = {
  sessionKey?: number;
  driverNumber?: number;
};
