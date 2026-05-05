type UserMessageProps = {
  text: string;
};

// Phase 26 UI: user-side bubble lives on the right and uses a
// neutral dark surface (the F1 red accent is reserved for the
// brand mark + send button, not the bubble).
export function UserMessage({ text }: UserMessageProps) {
  return (
    <article className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl border border-border bg-surface px-5 py-3 text-[15px] leading-relaxed text-ink">
        <p className="m-0 whitespace-pre-wrap">{text}</p>
      </div>
    </article>
  );
}
