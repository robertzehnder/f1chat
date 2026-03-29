type ContextChipProps = {
  label: string;
  onRemove: () => void;
};

export function ContextChip({ label, onRemove }: ContextChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-dim px-2.5 py-0.5 text-xs font-medium text-accent">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded-full px-1 text-ink-muted hover:bg-white/10 hover:text-ink"
        aria-label={`Remove ${label}`}
      >
        ×
      </button>
    </span>
  );
}
