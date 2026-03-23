"use client";

import { FormEvent, useState } from "react";
import { DataTable } from "@/components/DataTable";

type ChatResponse = {
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

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function ChatClient() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionKey, setSessionKey] = useState("");
  const [driverNumber, setDriverNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<ChatResponse | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) {
      return;
    }

    const userText = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setLoading(true);
    setLastResult(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: userText,
          context: {
            sessionKey: sessionKey ? Number(sessionKey) : undefined,
            driverNumber: driverNumber ? Number(driverNumber) : undefined
          }
        })
      });
      const data: ChatResponse = await response.json();
      if (!response.ok) {
        const message = data.error
          ? `Request failed: ${data.error}${data.requestId ? ` (request_id=${data.requestId})` : ""}`
          : `Request failed with status ${response.status}`;
        setMessages((prev) => [...prev, { role: "assistant", content: message }]);
        setLastResult(null);
        return;
      }

      const answer =
        data.answer && data.answer.trim()
          ? data.answer
          : `Request completed${data.requestId ? ` (request_id=${data.requestId})` : ""}, but no answer text was returned.`;
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
      setLastResult(data);
    } catch {
      const fallback = "Unable to process this request right now.";
      setMessages((prev) => [...prev, { role: "assistant", content: fallback }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-shell">
      <section className="card">
        <h2 className="panel-title">Analyst Chat</h2>
        <p className="muted">
          Anthropic Sonnet is used for SQL generation when configured, with safe read-only SQL
          validation/execution after generation.
        </p>
      </section>

      <section className="card">
        <form className="filter-form" onSubmit={onSubmit}>
          <label>
            Session Key (optional context)
            <input value={sessionKey} onChange={(e) => setSessionKey(e.target.value)} />
          </label>
          <label>
            Driver Number (optional context)
            <input value={driverNumber} onChange={(e) => setDriverNumber(e.target.value)} />
          </label>
          <label>
            Ask a question
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Compare lap pace for driver 1 in session 9839."
            />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? (
              <span className="inline-loading">
                <span className="spinner" aria-hidden="true" />
                Running...
              </span>
            ) : (
              "Ask"
            )}
          </button>
        </form>
      </section>

      <section className="card chat-log">
        {loading ? (
          <article className="bubble assistant">
            <strong>Analyst</strong>
            <p className="inline-loading">
              <span className="spinner" aria-hidden="true" />
              Thinking...
            </p>
          </article>
        ) : null}
        {messages.map((message, index) => (
          <article key={index} className={`bubble ${message.role}`}>
            <strong>{message.role === "user" ? "You" : "Analyst"}</strong>
            <p>{message.content}</p>
          </article>
        ))}
      </section>

      {lastResult ? (
        <section className="stack">
          <section className="card">
            <h3>Executed SQL</h3>
            <pre className="muted">{lastResult.sql}</pre>
            {lastResult.result ? (
              <p className="muted">
                rows={lastResult.result.rowCount} · elapsed_ms={lastResult.result.elapsedMs} ·
                truncated={String(lastResult.result.truncated)}
              </p>
            ) : null}
            <p className="muted">
              source={lastResult.generationSource ?? "unknown"} · model=
              {lastResult.model ?? "n/a"}
            </p>
            {lastResult.adequacyGrade || lastResult.responseGrade ? (
              <p className="muted">
                adequacy_grade={lastResult.adequacyGrade ?? lastResult.responseGrade}
                {lastResult.adequacyReason || lastResult.gradeReason
                  ? ` · ${lastResult.adequacyReason ?? lastResult.gradeReason}`
                  : ""}
              </p>
            ) : null}
            {lastResult.requestId ? <p className="muted">request_id={lastResult.requestId}</p> : null}
            {lastResult.generationNotes ? <p className="muted">{lastResult.generationNotes}</p> : null}
            {lastResult.answerReasoning ? <p className="muted">row_reasoning={lastResult.answerReasoning}</p> : null}
          </section>
          {lastResult.runtime ? (
            <section className="card">
              <h3>Runtime Plan</h3>
              <p className="muted">
                question_type={lastResult.runtime.questionType ?? "n/a"} · grain=
                {lastResult.runtime.grain?.grain ?? "n/a"} · row_volume=
                {lastResult.runtime.grain?.expectedRowVolume ?? "n/a"}
              </p>
              <p className="muted">
                resolution={lastResult.runtime.resolution?.status ?? "n/a"} · session=
                {lastResult.runtime.resolution?.selectedSession?.sessionKey ?? "n/a"} · drivers=
                {lastResult.runtime.resolution?.selectedDriverNumbers?.join(", ") ?? "n/a"}
              </p>
              {lastResult.runtime.completeness?.warnings?.length ? (
                <p className="muted">
                  warnings={lastResult.runtime.completeness.warnings.join(" | ")}
                </p>
              ) : null}
              {lastResult.runtime.queryPlan?.primary_tables?.length ? (
                <p className="muted">
                  tables={lastResult.runtime.queryPlan.primary_tables.join(", ")}
                </p>
              ) : null}
              {lastResult.runtime.queryPlan?.filters?.length ? (
                <p className="muted">
                  filters={lastResult.runtime.queryPlan.filters.join(" AND ")}
                </p>
              ) : null}
              {lastResult.runtime.queryPlan?.risk_flags?.length ? (
                <p className="muted">
                  risk_flags={lastResult.runtime.queryPlan.risk_flags.join(", ")}
                </p>
              ) : null}
            </section>
          ) : null}
          {lastResult.result ? <DataTable rows={lastResult.result.rows} title="Result Preview" /> : null}
        </section>
      ) : null}
    </div>
  );
}
