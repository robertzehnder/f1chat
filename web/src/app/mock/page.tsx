import { allMocks } from "@/__mocks__/insights";
import { InsightCard } from "@/components/f1-chat/insight-card";
import { toCardProps } from "@/lib/toCardProps";

export const metadata = {
  title: "F1 Insights — Mock Fixtures"
};

export default function MockPage() {
  return (
    <main className="container mx-auto py-8 space-y-10 max-w-3xl">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">Insight fixtures — visual QA surface</h1>
        <p className="text-sm text-muted-foreground">
          Renders all {Object.keys(allMocks).length} in-scope mocks. M07 (team-grouped
          ranking) and M23 (track marker map) are explicit follow-ups; their
          renderers don&apos;t exist in v0&apos;s ChartRenderer switch.
        </p>
      </header>
      {Object.entries(allMocks).map(([id, m]) => (
        <section key={id} className="space-y-3">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-mono">
            {id} — {m.title}
          </h3>
          <InsightCard {...toCardProps(m)} />
        </section>
      ))}
    </main>
  );
}
