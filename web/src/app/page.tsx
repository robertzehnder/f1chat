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
  applyResponseSemantics,
  applyScalarHero,
  applyVerdictSemantics,
  foldPartsIntoInsight
} from "@/lib/mapInsight";
import { toCardProps } from "@/lib/toCardProps";
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

  const handleSend = async (text: string) => {
    if (!text.trim()) return;
    const userId = makeId();
    const assistantId = makeId();
    setMessages((m) => [
      ...m,
      { id: userId, type: "user", content: text },
      // Start with streaming=true so the "Thinking…" affordance shows immediately.
      { id: assistantId, type: "assistant", content: "", insight: { body: "", streaming: true } }
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Accept: "text/event-stream"
        },
        body: JSON.stringify({ message: text, context: {} })
      });

      // Live streaming: keep a CUMULATIVE string and overwrite the body
      // each tick. Do NOT call foldPartsIntoInsight on per-chunk text —
      // that helper inserts "\n\n" between text parts, which is correct
      // for distinct final-frame parts but wrong for SSE deltas.
      let liveBody = "";
      let liveReasoning = "";
      let deltaCount = 0;
      let live: DraftInsight = { body: "", streaming: true };
      const finalPayload: ChatApiResponse = await consumeChatStream(response, {
        onAnswerDelta: (chunk) => {
          if (!chunk) return;
          deltaCount += 1;
          liveBody += chunk;
          live = { ...live, body: liveBody, streaming: true };
          updateAssistantInsight(assistantId, live);
        },
        onReasoningDelta: (chunk) => {
          if (!chunk) return;
          liveReasoning += chunk;
          live = { ...live, reasoning: liveReasoning, streaming: true };
          updateAssistantInsight(assistantId, live);
        }
      });

      // Final frame: fold structured parts (sql, table, warnings, followUps).
      // Skip text parts ONLY IF the stream delivered answer_delta chunks —
      // otherwise (deterministic / clarification / template paths emit a
      // single `final` frame with no deltas) we need to fold the text part
      // to populate the body.
      const parts = mapChatApiResponseToParts(finalPayload);
      const skipTextParts = deltaCount > 0;
      let folded: DraftInsight = { body: liveBody };
      for (const p of parts) {
        if (skipTextParts && p.type === "text") continue;
        folded = foldPartsIntoInsight(folded, p);
      }
      folded = applyResponseSemantics(folded, finalPayload);
      folded = applyScalarHero(folded);
      folded = applyVerdictSemantics(folded);
      if (!folded.title) folded.title = "Insight";
      // Carry reasoning through; flip streaming off so the card collapses
      // it into the <details> disclosure.
      if (liveReasoning) folded.reasoning = liveReasoning;
      folded.streaming = false;
      updateAssistantInsight(assistantId, folded);
    } catch {
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
        <header className="shrink-0 border-b border-border/50 bg-background/80 backdrop-blur-sm z-10">
          <div className="max-w-4xl mx-auto px-3 md:px-4 py-3 flex items-center justify-between">
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
                    <InsightCard {...toCardProps(message.insight)} onFollowUp={handleFollowUp} />
                  ) : (
                    <p className="text-sm text-foreground/90">{message.content}</p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="shrink-0 border-t border-border/50 bg-background/80 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto px-3 md:px-4 py-3 md:py-4">
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
