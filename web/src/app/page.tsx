"use client";

import { useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { ChatInput } from "@/components/f1-chat/chat-input";
import { ChatSidebar, type ChatSession } from "@/components/f1-chat/chat-sidebar";
import { InsightCard } from "@/components/f1-chat/insight-card";
import { MessageBubble } from "@/components/f1-chat/message-bubble";
import { SuggestionChips } from "@/components/f1-chat/suggestion-chips";
import { UserProfile, type UserData } from "@/components/f1-chat/user-profile";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/lib/auth-shim";
import { consumeChatStream } from "@/lib/chat/consumeChatStream";
import { mapChatApiResponseToParts } from "@/lib/mapChatResponse";
import {
  applyClarification,
  applyCornerMap,
  applyInsightFields,
  applyQuestionTitle,
  applyResponseSemantics,
  applyScalarHero,
  applyVerdictSemantics,
  foldPartsIntoInsight
} from "@/lib/mapInsight";
import { toCardProps } from "@/lib/toCardProps";
import { buildActivityLog, SYNTHETIC_PHASES, type ActivityEvent } from "@/lib/activityLog";
import type { DraftInsight } from "@/lib/chart-types";
import type { ChatApiResponse } from "@/lib/chatTypes";

// First-visit chips lead with the A-tier visuals from the 2026-07-03
// design review (speed map is the standout; dominance ribbon, race
// trace, brake-zone map complete the set), pointed at the freshest
// races. Each phrasing is live-verified to hit its deterministic
// template — templates guarantee the chart, LLM SQL doesn't.
const INITIAL_SUGGESTIONS = [
  "Show Norris's speed map for the Zandvoort 2026 race — where was he fastest?",
  "Show the sector dominance between Norris and Antonelli in the Zandvoort 2026 race",
  "Show the race trace for the Hungarian 2026 Grand Prix",
  "Compare the heaviest brake zones between Leclerc and Hamilton at Spa 2026"
];

type UiMessage =
  | { id: string; type: "user"; content: string }
  | { id: string; type: "assistant"; content: string; insight: DraftInsight | null };

function makeId(): string {
  // crypto.randomUUID exists in modern browsers/Node 19+; fall back if absent.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const ACTIVE_CONVERSATION_KEY = "openf1.activeConversationId";
const GUEST_ID_KEY = "openf1.guestSessionId";

/** Browser-session guest identity (sessionStorage: survives reloads,
 *  gone when the web session ends — guest chats are scoped to it by
 *  design). Created lazily; never created for signed-in users. */
function getGuestId(create = false): string | null {
  if (typeof window === "undefined") return null;
  let id = window.sessionStorage.getItem(GUEST_ID_KEY);
  if (!id && create) {
    id = crypto.randomUUID();
    window.sessionStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
}

/** Headers carrying the guest identity to the API (no-op when absent). */
function guestHeaders(): Record<string, string> {
  const id = getGuestId();
  return id ? { "x-guest-id": id } : {};
}

type ConversationListRow = {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
  message_count: number;
};

type StoredConversationMessage = {
  role: "user" | "assistant";
  content: string;
  payload: ChatApiResponse | null;
};

/**
 * Fold a final ChatApiResponse into a DraftInsight. Shared by the live
 * streaming path (which passes the accumulated deltas) and the restore
 * path (which replays the stored payload with no live state) so a
 * restored card is pixel-identical to the one rendered live.
 */
function buildInsightFromFinalPayload(
  finalPayload: ChatApiResponse,
  questionText: string,
  live?: { body: string; reasoning: string; deltaCount: number }
): DraftInsight {
  const parts = mapChatApiResponseToParts(finalPayload);
  const skipTextParts = (live?.deltaCount ?? 0) > 0;
  let folded: DraftInsight = { body: live?.body ?? "" };
  for (const p of parts) {
    if (skipTextParts && p.type === "text") continue;
    folded = foldPartsIntoInsight(folded, p, { question: questionText });
  }
  folded = applyInsightFields(folded, finalPayload.insight ?? null);
  folded = applyResponseSemantics(folded, finalPayload);
  folded = applyClarification(folded, finalPayload, questionText);
  folded = applyScalarHero(folded);
  folded = applyCornerMap(folded);
  folded = applyVerdictSemantics(folded);
  folded = applyQuestionTitle(folded, questionText);
  if (live?.reasoning) {
    folded.reasoning = live.reasoning;
  }
  folded.streaming = false;
  folded.activity = buildActivityLog(finalPayload);
  return folded;
}

export default function F1InsightsChat() {
  const { user, signOut } = useAuth();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("current");
  // Server-side conversation this thread is persisted under. null until
  // the first persisted turn returns a `conversation` receipt.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const refreshConversations = async () => {
    try {
      const res = await fetch("/api/conversations", { headers: guestHeaders() });
      if (!res.ok) return;
      const data: { rows?: ConversationListRow[] } = await res.json();
      setSessions(
        (data.rows ?? []).map((row) => ({
          id: row.id,
          title: row.title,
          preview: row.preview,
          timestamp: new Date(row.updated_at),
          messageCount: row.message_count
        }))
      );
    } catch {
      // Sidebar list is non-critical; leave whatever we have.
    }
  };

  const loadConversation = async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, { headers: guestHeaders() });
      if (!res.ok) {
        if (res.status === 404 && typeof window !== "undefined") {
          window.localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
        }
        return;
      }
      const data: { id: string; messages: StoredConversationMessage[] } = await res.json();
      const restored: UiMessage[] = [];
      let lastQuestion = "";
      for (const msg of data.messages) {
        if (msg.role === "user") {
          lastQuestion = msg.content;
          restored.push({ id: makeId(), type: "user", content: msg.content });
        } else {
          restored.push({
            id: makeId(),
            type: "assistant",
            content: msg.content,
            insight: msg.payload
              ? buildInsightFromFinalPayload(msg.payload, lastQuestion)
              : { body: msg.content, streaming: false }
          });
        }
      }
      setMessages(restored);
      setConversationId(data.id);
      setActiveSessionId(data.id);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, data.id);
      }
    } catch {
      // Restore failure leaves the current view untouched.
    }
  };

  // Mount: populate the sidebar and reopen the last active conversation.
  useEffect(() => {
    void refreshConversations();
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem(ACTIVE_CONVERSATION_KEY)
        : null;
    if (stored) {
      void loadConversation(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guest → account claim: when a session appears (fresh mount after
  // sign-in/up) while this browser session holds a guest identity,
  // migrate the guest conversations to the account and drop the guest id.
  useEffect(() => {
    if (!user) return;
    const guestId = getGuestId();
    if (!guestId) return;
    void (async () => {
      try {
        await fetch("/api/conversations/claim", {
          method: "POST",
          headers: guestHeaders()
        });
      } catch {
        // Best-effort: the guest id survives, so a retry happens on the
        // next mount while the web session lives.
      }
      window.sessionStorage.removeItem(GUEST_ID_KEY);
      void refreshConversations();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Guest chats die with the web session — warn before leaving mid-chat.
  useEffect(() => {
    if (user || messages.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [user, messages.length]);

  // Neon Auth session → profile chip. Null while signed out (the header
  // shows a Sign in link instead).
  const userData: UserData | null = user
    ? {
        name: user.name,
        email: user.email ?? "",
        initials: user.name.slice(0, 1).toUpperCase()
      }
    : null;

  const updateAssistantInsight = (assistantId: string, insight: DraftInsight) =>
    setMessages((m) =>
      m.map((msg) =>
        msg.id === assistantId && msg.type === "assistant"
          ? { ...msg, insight }
          : msg
      )
    );

  /**
   * Functional patcher — merges a partial DraftInsight into whatever the
   * assistant slot currently holds. Critical for streaming because the
   * synthetic-phase setInterval and the SSE delta callbacks both mutate
   * the insight concurrently; an absolute set (updateAssistantInsight)
   * would wipe the other side's writes.
   */
  const patchAssistantInsight = (
    assistantId: string,
    patch: (prev: DraftInsight) => DraftInsight
  ) =>
    setMessages((m) =>
      m.map((msg) => {
        if (msg.id !== assistantId || msg.type !== "assistant") return msg;
        const prev = msg.insight ?? { body: "" };
        return { ...msg, insight: patch(prev) };
      })
    );

  const handleSend = async (text: string) => {
    if (!text.trim()) return;
    const userId = makeId();
    const assistantId = makeId();
    // Seed the assistant message with the first synthetic phase so the
    // activity log is visible the instant the user submits.
    const initialActivity: ActivityEvent[] = [
      {
        id: "synth-0",
        label: SYNTHETIC_PHASES[0].label,
        message: SYNTHETIC_PHASES[0].message,
        status: "running"
      }
    ];

    setMessages((m) => [
      ...m,
      { id: userId, type: "user", content: text },
      {
        id: assistantId,
        type: "assistant",
        content: "",
        insight: { body: "", streaming: true, activity: initialActivity }
      }
    ]);

    // Backend emits real stage events at orchestration boundaries:
    //   intake_complete → resolve_complete (or resolve_timeout) →
    //     sql_start → sql_complete → synthesis_start
    //
    // Each stage event maps to a phase index in SYNTHETIC_PHASES so the
    // visible activity log tracks real server-side progress instead of
    // a guessed timer cadence. Stage events also carry a `detail` field
    // (e.g. resolved session label, row count + ms) which becomes the
    // phase's `message` — so the user sees concrete info as it lands.
    //
    // Fallback: a 1.5s heartbeat ticks the spinner forward even when
    // stage events lag, so the UI never feels frozen on slow Neon.
    //
    // The first answer_delta / reasoning_delta also enters the drafting
    // phase as a defensive backstop in case `synthesis_start` is missed
    // (older backend, network truncation).
    const PHASE_BY_STAGE: Record<string, number> = {
      intake_complete: 1,    // → "Resolving references"
      resolve_complete: 2,   // → "Planning query"
      resolve_timeout: 1,    // stays on resolution (will be marked warn at final)
      plan_complete: 3,      // → "Running query"
      sql_start: 3,          // running query (DB executing)
      sql_complete: 4,       // → "Drafting answer"
      synthesis_start: 4     // confirms drafting started
    };
    const SYNTH_DRAFTING_IDX = 4;
    let currentPhaseIdx = 0;
    let draftingStarted = false;
    let phaseFromBackend = false; // flips true on first stage event

    /** Render the activity panel up through `idx`, with `idx` running. */
    const showPhase = (idx: number, customMessage?: string) => {
      patchAssistantInsight(assistantId, (prev) => {
        if (!prev.streaming) return prev;
        const upTo = Math.min(idx, SYNTHETIC_PHASES.length - 1);
        const events: ActivityEvent[] = SYNTHETIC_PHASES.slice(0, upTo + 1).map((p, i) => ({
          id: `synth-${i}`,
          label: p.label,
          message: i === upTo && customMessage ? customMessage : p.message,
          status: i < upTo ? ("done" as const) : ("running" as const)
        }));
        return { ...prev, activity: events };
      });
    };

    /** Advance to phase idx if it's strictly forward; ignore stale signals. */
    const advanceToPhase = (idx: number, message?: string) => {
      if (idx <= currentPhaseIdx && currentPhaseIdx > 0) return;
      currentPhaseIdx = idx;
      if (idx >= SYNTH_DRAFTING_IDX) draftingStarted = true;
      showPhase(idx, message);
    };

    /** Backstop: first delta arriving forces drafting phase. */
    const enterDraftingPhase = () => {
      if (draftingStarted) return;
      advanceToPhase(SYNTH_DRAFTING_IDX);
    };

    // Heartbeat fallback — only ticks if NO stage events have arrived.
    // Once the first real stage lands, we trust the backend to drive
    // progress and the heartbeat goes silent.
    const phaseTimer = setInterval(() => {
      if (draftingStarted || phaseFromBackend) return;
      const next = currentPhaseIdx + 1;
      if (next >= SYNTH_DRAFTING_IDX) {
        // Park at "Running query" — wait for real signal to advance.
        return;
      }
      advanceToPhase(next);
    }, 1500);

    try {
      // First send while signed out mints the browser-session guest id,
      // so the conversation persists for THIS web session and can be
      // claimed by an account later.
      if (!user) {
        getGuestId(true);
      }
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Accept: "text/event-stream",
          ...guestHeaders()
        },
        body: JSON.stringify({
          message: text,
          conversationId: conversationId ?? undefined,
          persist: true,
          context: {}
        })
      });

      // Live streaming: keep CUMULATIVE strings on the page handler scope
      // (deltaCount, the body+reasoning strings used by the final-fold).
      // The actual insight state is updated via patchAssistantInsight to
      // preserve the activity field that setInterval is writing
      // concurrently — using a local `live` snapshot would clobber it.
      let liveBody = "";
      let liveReasoning = "";
      let deltaCount = 0;
      const finalPayload: ChatApiResponse = await consumeChatStream(response, {
        onStage: (payload) => {
          phaseFromBackend = true;
          const idx = PHASE_BY_STAGE[payload.kind];
          if (typeof idx !== "number") return;
          advanceToPhase(idx, payload.detail);
        },
        onInsight: (fields) => {
          // Structured insight arrives as its own SSE frame, often
          // before the body finishes streaming. Patch into the live
          // insight so metrics + takeaways + chips can render in
          // place while body continues to stream below them.
          if (!fields) return;
          patchAssistantInsight(assistantId, (prev) => applyInsightFields(prev, fields));
        },
        onAnswerDelta: (chunk) => {
          if (!chunk) return;
          enterDraftingPhase();
          deltaCount += 1;
          liveBody += chunk;
          patchAssistantInsight(assistantId, (prev) => ({
            ...prev,
            body: liveBody,
            streaming: true
          }));
        },
        onReasoningDelta: (chunk) => {
          if (!chunk) return;
          enterDraftingPhase();
          liveReasoning += chunk;
          patchAssistantInsight(assistantId, (prev) => ({
            ...prev,
            reasoning: liveReasoning,
            streaming: true
          }));
        }
      });

      // Final frame: fold structured parts (sql, table, warnings, followUps).
      // Skip text parts ONLY IF the stream delivered answer_delta chunks —
      // otherwise (deterministic / clarification / template paths emit a
      // single `final` frame with no deltas) we need to fold the text part
      // to populate the body.
      // Stream closed — stop synthetic phase cycle.
      clearInterval(phaseTimer);

      // Shared fold pipeline (also used verbatim by conversation restore).
      const folded = buildInsightFromFinalPayload(finalPayload, text, {
        body: liveBody,
        reasoning: liveReasoning,
        deltaCount
      });
      updateAssistantInsight(assistantId, folded);

      // Persistence receipt: adopt the conversation id (lazily created on
      // the first persisted turn) and refresh the sidebar list.
      if (finalPayload.conversation?.id) {
        setConversationId(finalPayload.conversation.id);
        setActiveSessionId(finalPayload.conversation.id);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, finalPayload.conversation.id);
        }
        void refreshConversations();
      }
    } catch {
      clearInterval(phaseTimer);
      updateAssistantInsight(assistantId, {
        body: "Unable to process this request right now.",
        title: "Error",
        streaming: false
      });
    }
  };

  const handleFollowUp = (question: string) => {
    void handleSend(question);
  };

  const handleNewChat = () => {
    setActiveSessionId("current");
    setConversationId(null);
    setMessages([]);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    }
  };

  const handleSelectSession = (id: string) => {
    void loadConversation(id);
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE", headers: guestHeaders() });
    } catch {
      return;
    }
    if (conversationId === id) {
      handleNewChat();
    }
    void refreshConversations();
  };

  return (
    <div className="flex h-screen bg-background">
      <ChatSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onDeleteSession={(id) => void handleDeleteSession(id)}
        onNewChat={handleNewChat}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        isMobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
        user={userData}
        onSignOut={signOut}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="shrink-0 border-b border-border/50 bg-background/80 backdrop-blur-sm z-10 min-h-16">
          <div className="max-w-4xl mx-auto px-3 md:px-4 py-3 flex items-center justify-between min-h-16">
            <div className="flex items-center gap-2 md:gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden size-9 text-muted-foreground hover:text-foreground"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="size-5" />
              </Button>
              <div className="size-9 rounded-xl bg-[#E10600] flex items-center justify-center shadow-lg shadow-[#E10600]/20">
                <span className="text-white font-bold text-sm">F1</span>
              </div>
              <div>
                <h1 className="font-semibold text-foreground">F1 Chat</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">Powered by OpenF1</p>
              </div>
            </div>
            {userData ? (
              <UserProfile
                user={userData}
                variant="compact"
                onSignOut={signOut}
              />
            ) : (
              <a
                href="/auth/sign-in"
                className="text-sm font-medium text-foreground bg-secondary/60 hover:bg-secondary border border-border/50 rounded-lg px-3 py-1.5 transition-colors"
              >
                Sign in
              </a>
            )}
          </div>
        </header>

        {messages.length === 0 ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-4 overflow-auto">
            <div className="text-center mb-8">
              <div className="size-20 rounded-2xl bg-gradient-to-br from-[#E10600]/20 to-[#E10600]/5 flex items-center justify-center mx-auto mb-5 border border-[#E10600]/20">
                <span className="text-[#E10600] font-bold text-3xl">F1</span>
              </div>
              <h2 className="text-2xl font-semibold text-foreground mb-3 text-balance">
                What would you like to know?
              </h2>
              <p className="text-muted-foreground text-sm max-w-md leading-relaxed">
                Ask about lap times, driver comparisons, corner speeds, tyre strategy, and more. I&apos;ll
                analyze OpenF1 data and present insights in an easy-to-understand format.
              </p>
            </div>
            <SuggestionChips
              suggestions={INITIAL_SUGGESTIONS}
              onSelect={(q) => void handleSend(q)}
              className="max-w-2xl justify-center"
            />
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
            <div className="max-w-3xl mx-auto px-3 md:px-4 py-4 md:py-6 space-y-4 md:space-y-6">
              {messages.map((message) => (
                <div key={message.id}>
                  {message.type === "user" ? (
                    <MessageBubble content={message.content} />
                  ) : message.insight ? (
                    <InsightCard {...toCardProps(message.insight)} onFollowUp={handleFollowUp} onResolve={(q) => void handleSend(q)} />
                  ) : (
                    <p className="text-sm text-foreground/90">{message.content}</p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="shrink-0 border-t border-border/50 bg-background/80 backdrop-blur-sm min-h-[88px] flex flex-col justify-center">
          <div className="w-full max-w-3xl mx-auto px-3 md:px-4 py-3 md:py-4">
            {!user && messages.length > 0 && (
              <p className="text-xs text-muted-foreground text-center mb-2">
                Guest chats last only this browser session —{" "}
                <a href="/auth/sign-up" className="text-foreground underline underline-offset-2 hover:text-[#E10600]">
                  create an account
                </a>{" "}
                to keep them.
              </p>
            )}
            <ChatInput
              onSend={(q) => void handleSend(q)}
              placeholder="Ask about lap times, strategy..."
            />
            <p className="text-[10px] text-muted-foreground text-center mt-2 hidden sm:block">
              Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
