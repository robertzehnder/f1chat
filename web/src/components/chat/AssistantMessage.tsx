"use client";

import type { MessagePart } from "@/lib/chatTypes";
import { CollapsibleBlock } from "@/components/chat/CollapsibleBlock";
import { ResultTable } from "@/components/chat/ResultTable";

type AssistantMessageProps = {
  parts: MessagePart[];
  onFollowUp?: (prompt: string) => void;
};

export function AssistantMessage({ parts, onFollowUp }: AssistantMessageProps) {
  return (
    <article className="border-l-2 border-accent/20 pl-4">
      <div className="space-y-4">
        {parts.map((part, i) => {
          switch (part.type) {
            case "text":
              return (
                <p key={i} className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {part.text}
                </p>
              );
            case "sql":
              return (
                <CollapsibleBlock key={i} title="SQL" variant="code">
                  <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-5 text-ink">
                    {part.sql}
                  </pre>
                </CollapsibleBlock>
              );
            case "table":
              return (
                <ResultTable
                  key={i}
                  title={part.title}
                  rows={part.rows}
                  rowCount={part.rowCount}
                  elapsedMs={part.elapsedMs}
                  truncated={part.truncated}
                />
              );
            case "warning":
              return (
                <div
                  key={i}
                  className="rounded-md border-l-[3px] border-l-semantic-warning bg-semantic-warning-soft px-3 py-2.5"
                >
                  <p className="m-0 mb-1 text-[13px] font-semibold text-semantic-warning">Warning</p>
                  <ul className="m-0 list-disc pl-4 text-[13px] text-ink-secondary">
                    {part.messages.map((w, j) => (
                      <li key={j}>{w}</li>
                    ))}
                  </ul>
                </div>
              );
            case "metadata":
              return (
                <CollapsibleBlock key={i} title="Details" defaultOpen={false}>
                  <dl className="m-0 grid gap-1.5 font-mono text-[13px] text-ink-secondary">
                    {part.requestId ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-tertiary">request_id</dt>
                        <dd className="m-0 text-ink">{part.requestId}</dd>
                      </div>
                    ) : null}
                    {part.generationSource ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-tertiary">source</dt>
                        <dd className="m-0 text-ink">{part.generationSource}</dd>
                      </div>
                    ) : null}
                    {part.model ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-tertiary">model</dt>
                        <dd className="m-0 text-ink">{part.model}</dd>
                      </div>
                    ) : null}
                    {part.adequacyGrade ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-tertiary">grade</dt>
                        <dd className="m-0 text-ink">
                          {part.adequacyGrade}
                          {part.adequacyReason ? ` — ${part.adequacyReason}` : ""}
                        </dd>
                      </div>
                    ) : null}
                    {part.generationNotes ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-tertiary">notes</dt>
                        <dd className="m-0 whitespace-pre-wrap text-ink">{part.generationNotes}</dd>
                      </div>
                    ) : null}
                    {part.answerReasoning ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-tertiary">reasoning</dt>
                        <dd className="m-0 whitespace-pre-wrap text-ink">{part.answerReasoning}</dd>
                      </div>
                    ) : null}
                    {part.queryPlanSummary ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-tertiary">plan</dt>
                        <dd className="m-0 whitespace-pre-wrap text-ink">{part.queryPlanSummary}</dd>
                      </div>
                    ) : null}
                    {part.resolutionSummary ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-tertiary">resolution</dt>
                        <dd className="m-0 whitespace-pre-wrap text-ink">{part.resolutionSummary}</dd>
                      </div>
                    ) : null}
                  </dl>
                </CollapsibleBlock>
              );
            case "followUps":
              return (
                <div key={i} className="flex flex-wrap gap-2">
                  {part.prompts.map((p, j) =>
                    onFollowUp ? (
                      <button
                        key={j}
                        type="button"
                        onClick={() => onFollowUp(p)}
                        className="inline-flex rounded-full border border-border bg-surface-secondary px-3 py-1 text-left text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
                      >
                        {p}
                      </button>
                    ) : (
                      <span
                        key={j}
                        className="inline-flex rounded-full border border-border bg-surface-secondary px-3 py-1 text-xs text-ink-secondary"
                      >
                        {p}
                      </span>
                    )
                  )}
                </div>
              );
            default:
              return null;
          }
        })}
      </div>
    </article>
  );
}
