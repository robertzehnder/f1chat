import {
  CHAT_STORE_SCHEMA_VERSION,
  type ChatStore,
  type Conversation
} from "@/lib/chatTypes";

const STORAGE_KEY = "openf1-chat-store";

export function createEmptyStore(): ChatStore {
  return {
    schemaVersion: CHAT_STORE_SCHEMA_VERSION,
    conversations: [],
    activeConversationId: null
  };
}

export function loadChatStore(): ChatStore {
  if (typeof window === "undefined") {
    return createEmptyStore();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createEmptyStore();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return createEmptyStore();
    }
    const obj = parsed as Record<string, unknown>;
    if (obj.schemaVersion !== CHAT_STORE_SCHEMA_VERSION) {
      return createEmptyStore();
    }
    if (!Array.isArray(obj.conversations)) {
      return createEmptyStore();
    }
    return {
      schemaVersion: CHAT_STORE_SCHEMA_VERSION,
      conversations: obj.conversations as Conversation[],
      activeConversationId:
        typeof obj.activeConversationId === "string" ? obj.activeConversationId : null
    };
  } catch {
    return createEmptyStore();
  }
}

export function saveChatStore(store: ChatStore): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...store,
        schemaVersion: CHAT_STORE_SCHEMA_VERSION
      })
    );
  } catch {
    /* quota or private mode */
  }
}
