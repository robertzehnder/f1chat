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

const INITIAL_SUGGESTIONS = [
  "What was Verstappen's pole lap time at Suzuka 2025?",
  "Compare Verstappen vs Hamilton through the Suzuka esses",
  "How many on-track overtakes happened at Singapore 2025?",
  "On which lap did the McLarens make the inters-to-slicks crossover at Silverstone 2025?"
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

export default function F1InsightsChat() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("current");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auth-shim returns a guest user; build a static profile from it.
  const userData: UserData | null = user
    ? {
        name: user.name,
        email: user.email ?? "",
        initials: user.name.slice(0, 1).toUpperCase(),
        plan: "free"
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
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Accept: "text/event-stream"
        },
        body: JSON.stringify({ message: text, context: {} })
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

      const parts = mapChatApiResponseToParts(finalPayload);
      const skipTextParts = deltaCount > 0;
      let folded: DraftInsight = { body: liveBody };
      for (const p of parts) {
        if (skipTextParts && p.type === "text") continue;
        folded = foldPartsIntoInsight(folded, p, { question: text });
      }
      // Apply structured insight from the final payload — covers
      // non-SSE responses (where onInsight never fires) and re-merges
      // for SSE in case the insight frame was missed.
      folded = applyInsightFields(folded, finalPayload.insight ?? null);
      folded = applyResponseSemantics(folded, finalPayload);
      folded = applyClarification(folded, finalPayload, text);
      folded = applyScalarHero(folded);
      folded = applyCornerMap(folded);
      folded = applyVerdictSemantics(folded);
      folded = applyQuestionTitle(folded, text);
      // Carry reasoning through; flip streaming off so the card collapses
      // it into the <details> disclosure.
      if (liveReasoning) folded.reasoning = liveReasoning;
      folded.streaming = false;
      // Replace synthetic phases with the real activity log built from
      // response.runtime — the moment of truth where vague stages become
      // concrete (resolved session, tables hit, rows + ms, generation
      // source, coverage warnings).
      folded.activity = buildActivityLog(finalPayload);
      updateAssistantInsight(assistantId, folded);
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
    setActiveSessionId(`session-${Date.now()}`);
    setMessages([]);
  };

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    setMessages([]); // No persisted history yet — follow-up PR adds localStorage.
  };

  const handleSignOut = () => {
    // No-op: auth-shim is guest-only. Hook here later if real auth lands.
  };

  const handleNavigate = (path: string) => {
    if (typeof window !== "undefined") {
      window.location.href = path;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <ChatSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        isMobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
        user={userData}
        onSignOut={handleSignOut}
        onNavigate={handleNavigate}
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
                <h1 className="font-semibold text-foreground">F1 Insights</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">Powered by OpenF1</p>
              </div>
            </div>
            {userData && (
              <UserProfile
                user={userData}
                variant="compact"
                onSignOut={handleSignOut}
                onNavigate={handleNavigate}
              />
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
