"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessage, ChatStore, Conversation } from "@/lib/chatTypes";
import { createEmptyStore, loadChatStore, saveChatStore } from "@/lib/chatPersistence";
import { mapChatApiResponseToParts } from "@/lib/mapChatResponse";
import { deriveResolvedContext, type ResolvedSessionContext } from "@/lib/chatContext";
import { sendChatMessage } from "@/lib/chat/sendChatMessage";
import { MessageThread } from "@/components/chat/MessageThread";
import { Composer, type ComposerContext } from "@/components/chat/Composer";

function newId() {
  return crypto.randomUUID();
}

function makeConversation(): Conversation {
  const id = newId();
  const now = new Date().toISOString();
  return {
    id,
    title: "New chat",
    updatedAt: now,
    messages: []
  };
}

function titleFromFirstMessage(text: string) {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= 52) {
    return t;
  }
  return `${t.slice(0, 49)}…`;
}

export function ChatWorkspace() {
  const [hydrated, setHydrated] = useState(false);
  const [store, setStore] = useState<ChatStore>(() => createEmptyStore());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [composerCtx, setComposerCtx] = useState<ComposerContext>({});
  const [, setResolved] = useState<ResolvedSessionContext | null>(null);

  useEffect(() => {
    setHydrated(true);
    const s = loadChatStore();
    if (s.conversations.length === 0) {
      const c = makeConversation();
      setStore({
        ...s,
        conversations: [c],
        activeConversationId: c.id
      });
    } else {
      setStore(s);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    saveChatStore(store);
  }, [store, hydrated]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const id = store.activeConversationId;
    if (!id) {
      return;
    }
    const c = store.conversations.find((x) => x.id === id);
    if (c) {
      setComposerCtx(c.contextSnapshot ?? {});
      setResolved(c.lastResolved ?? null);
    }
  }, [hydrated, store.activeConversationId, store.conversations]);

  const activeConversation = useMemo(
    () => store.conversations.find((c) => c.id === store.activeConversationId) ?? null,
    [store.conversations, store.activeConversationId]
  );

  const patchActiveConversation = useCallback(
    (fn: (c: Conversation) => Conversation) => {
      setStore((prev) => {
        const id = prev.activeConversationId;
        if (!id) {
          return prev;
        }
        return {
          ...prev,
          conversations: prev.conversations.map((c) => (c.id === id ? fn(c) : c))
        };
      });
    },
    []
  );

  const newChat = useCallback(() => {
    const c = makeConversation();
    setStore((prev) => ({
      ...prev,
      conversations: [c, ...prev.conversations],
      activeConversationId: c.id
    }));
    setComposerCtx({});
    setResolved(null);
    setInput("");
  }, []);

  // Phase 26 UI: togglePin/deleteConversation were used by the
  // (now-removed) ConversationSidebar — kept on the store schema
  // for re-introduction later but not wired into the chat-only UI.

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !store.activeConversationId) {
      return;
    }

    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      createdAt: new Date().toISOString(),
      text
    };

    const snapshotAtSend: ComposerContext = { ...composerCtx };

    patchActiveConversation((c) => {
      const nextTitle = c.title === "New chat" ? titleFromFirstMessage(text) : c.title;
      return {
        ...c,
        title: nextTitle,
        updatedAt: userMessage.createdAt,
        messages: [...c.messages, userMessage],
        contextSnapshot: snapshotAtSend
      };
    });

    setInput("");
    setLoading(true);

    // Streaming POST opts in via Accept: text/event-stream; sendChatMessage
    // owns the placeholder-first ordering, fetch, and stream consumption.
    try {
      await sendChatMessage(
        {
          text,
          snapshotAtSend,
          assistantTime: new Date().toISOString(),
          placeholderId: newId()
        },
        {
          patchActiveConversation,
          setResolved,
          setComposerCtx,
          mapResponseToParts: mapChatApiResponseToParts,
          deriveResolved: deriveResolvedContext
        }
      );
    } finally {
      setLoading(false);
    }
  }, [input, loading, store.activeConversationId, composerCtx, patchActiveConversation]);

  const messages = activeConversation?.messages ?? [];

  // Phase 26 UI: F1 Insights header + chat-only column. The
  // ConversationSidebar and SessionContextPanel were removed at
  // user request — chat is the root experience.
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-canvas">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-canvas px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white shadow-sm">
            F1
          </div>
          <div>
            <h1 className="m-0 text-base font-semibold text-ink">F1 Insights</h1>
            <p className="m-0 text-xs text-ink-tertiary">Powered by OpenF1</p>
          </div>
        </div>
        <button
          type="button"
          onClick={newChat}
          className="rounded-md border-0 bg-transparent px-3 py-1.5 text-sm text-ink-secondary hover:text-ink"
        >
          New chat
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageThread
          messages={messages}
          loading={loading}
          onFollowUp={(p) => setInput((prev) => (prev.trim() ? `${prev.trim()}\n${p}` : p))}
          onSuggestedPrompt={(p) => setInput(p)}
        />
        <Composer
          value={input}
          onChange={setInput}
          onSubmit={send}
          loading={loading}
          context={composerCtx}
          onContextChange={setComposerCtx}
        />
      </div>
    </div>
  );
}
