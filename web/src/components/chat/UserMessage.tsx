type UserMessageProps = {
  text: string;
};

export function UserMessage({ text }: UserMessageProps) {
  return (
    <article>
      <div className="rounded-lg border border-accent/15 bg-accent-soft px-4 py-3 text-sm leading-relaxed text-ink">
        <p className="m-0 whitespace-pre-wrap">{text}</p>
      </div>
    </article>
  );
}
