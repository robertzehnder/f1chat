import {
  FOLLOW_UP_FIXTURES,
  IMPLEMENTED_FIXTURES,
  IN_SCOPE_MOCK_COUNT
} from "@/__mocks__/insights/manifest";
import { InsightCard } from "@/components/f1-chat/insight-card";
import { toCardProps } from "@/lib/toCardProps";

export const metadata = {
  title: "F1 Insights — Mock Fixtures"
};

export default function MockPage() {
  return (
    <main className="container mx-auto py-8 space-y-10 max-w-3xl">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">
          Insight fixtures — visual QA surface
        </h1>
        <p className="text-sm text-muted-foreground">
          Renders {IN_SCOPE_MOCK_COUNT} in-scope mocks from the
          fixture manifest (filtered by{" "}
          <code className="font-mono">status === &quot;implemented&quot;</code>).
          {FOLLOW_UP_FIXTURES.length > 0 && (
            <>
              {" "}
              {FOLLOW_UP_FIXTURES.length} follow-up{" "}
              {FOLLOW_UP_FIXTURES.length === 1 ? "fixture is" : "fixtures are"}{" "}
              enumerated below but not rendered (renderers not yet shipped).
            </>
          )}
        </p>
      </header>

      {IMPLEMENTED_FIXTURES.map((entry) =>
        entry.mock ? (
          <section key={entry.id} className="space-y-3" data-testid={`fixture-${entry.id}`}>
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-mono">
              {entry.id} — {entry.title}
            </h3>
            <InsightCard {...toCardProps(entry.mock)} />
          </section>
        ) : null
      )}

      {FOLLOW_UP_FIXTURES.length > 0 && (
        <section
          className="space-y-3 border-t border-border/50 pt-6"
          data-testid="follow-up-section"
        >
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground font-mono">
            Follow-up — not yet rendered
          </h2>
          <ul className="text-sm text-muted-foreground space-y-1">
            {FOLLOW_UP_FIXTURES.map((entry) => (
              <li key={entry.id} data-testid={`follow-up-${entry.id}`}>
                <span className="font-mono text-xs">{entry.id}</span> — {entry.title}{" "}
                <span className="text-foreground/60">({entry.renderer})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
