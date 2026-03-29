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
  error?: string;
};

export type ChatContext = {
  sessionKey?: number;
  driverNumber?: number;
};
