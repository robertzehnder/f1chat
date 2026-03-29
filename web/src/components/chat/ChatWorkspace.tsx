"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatApiResponse, ChatMessage, ChatMessageAssistant, ChatStore, Conversation } from "@/lib/chatTypes";
import { createEmptyStore, loadChatStore, saveChatStore } from "@/lib/chatPersistence";
import { mapChatApiResponseToParts } from "@/lib/mapChatResponse";
import { deriveResolvedContext, type ResolvedSessionContext } from "@/lib/chatContext";
import { ConversationSidebar } from "@/components/chat/ConversationSidebar";
import { MessageThread } from "@/components/chat/MessageThread";
import { Composer, type ComposerContext } from "@/components/chat/Composer";
import { SessionContextPanel } from "@/components/chat/SessionContextPanel";

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
  const [resolved, setResolved] = useState<ResolvedSessionContext | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

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
  }, [hydrated, store.activeConversationId]);

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

  const togglePin = useCallback((id: string) => {
    setStore((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) =>
        c.id === id ? { ...c, pinned: !c.pinned } : c
      )
    }));
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setStore((prev) => {
      const rest = prev.conversations.filter((c) => c.id !== id);
      const nextActive =
        prev.activeConversationId === id ? rest[0]?.id ?? null : prev.activeConversationId;
      if (rest.length === 0) {
        const c = makeConversation();
        return {
          ...prev,
          conversations: [c],
          activeConversationId: c.id
        };
      }
      return {
        ...prev,
        conversations: rest,
        activeConversationId: nextActive
      };
    });
  }, []);

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

    const assistantMessage: ChatMessageAssistant = {
      id: newId(),
      role: "assistant",
      createdAt: new Date().toISOString(),
      parts: []
    };
    const assistantTime = assistantMessage.createdAt;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          context: {
            sessionKey: snapshotAtSend.sessionKey,
            driverNumber: snapshotAtSend.driverNumber
          }
        })
      });
      const data = (await response.json()) as ChatApiResponse;

      if (!response.ok) {
        const err =
          data.error != null
            ? `Request failed: ${data.error}${data.requestId ? ` (request_id=${data.requestId})` : ""}`
            : `Request failed with status ${response.status}`;
        assistantMessage.parts = [{ type: "text", text: err }];
        setResolved(data.requestId ? { requestId: data.requestId } : null);
        patchActiveConversation((c) => ({
          ...c,
          updatedAt: assistantTime,
          messages: [...c.messages, assistantMessage]
        }));
      } else {
        assistantMessage.parts = mapChatApiResponseToParts(data);
        const dr = deriveResolvedContext(data);
        setResolved(dr);
        const nextCtx: ComposerContext = {
          sessionKey: dr.sessionKey ?? snapshotAtSend.sessionKey,
          sessionLabel: dr.sessionLabel ?? snapshotAtSend.sessionLabel,
          driverNumber: dr.driverNumbers?.[0] ?? snapshotAtSend.driverNumber
        };
        setComposerCtx(nextCtx);
        patchActiveConversation((c) => ({
          ...c,
          updatedAt: assistantTime,
          messages: [...c.messages, assistantMessage],
          lastResolved: {
            sessionKey: dr.sessionKey,
            sessionLabel: dr.sessionLabel,
            driverNumbers: dr.driverNumbers,
            resolutionStatus: dr.resolutionStatus,
            needsClarification: dr.needsClarification,
            requestId: dr.requestId
          },
          contextSnapshot: nextCtx
        }));
      }
    } catch {
      assistantMessage.parts = [{ type: "text", text: "Unable to process this request right now." }];
      patchActiveConversation((c) => ({
        ...c,
        updatedAt: assistantTime,
        messages: [...c.messages, assistantMessage]
      }));
    } finally {
      setLoading(false);
    }
  }, [input, loading, store.activeConversationId, composerCtx, patchActiveConversation]);

  const messages = activeConversation?.messages ?? [];

  return (
    <div className="flex h-full min-h-0 w-full bg-canvas">
      <ConversationSidebar
        conversations={store.conversations}
        activeId={store.activeConversationId}
        onSelect={(id) => setStore((prev) => ({ ...prev, activeConversationId: id }))}
        onNew={newChat}
        onTogglePin={togglePin}
        onDelete={deleteConversation}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex shrink-0 items-center justify-between border-b border-border bg-white px-5 py-3">
              <div>
                <h1 className="m-0 text-base font-semibold text-ink">Analyst</h1>
                <p className="m-0 text-xs text-ink-tertiary">
                  Read-only SQL · answers and evidence stay in the thread
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPanelCollapsed((c) => !c)}
                className="hidden rounded-sm border border-border bg-white px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover lg:inline-flex"
                title={panelCollapsed ? "Show context" : "Hide context"}
              >
                {panelCollapsed ? "Show context" : "Hide context"}
              </button>
            </header>
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
          <div className="hidden min-h-0 lg:flex">
            <SessionContextPanel
              resolved={resolved}
              composerContext={composerCtx}
              collapsed={panelCollapsed}
              onToggleCollapse={() => setPanelCollapsed((c) => !c)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
