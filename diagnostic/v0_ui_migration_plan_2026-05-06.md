# V0 Frontend Replacement Plan — wire v0 UI to the existing backend

**Goal**: replace the entire `web/src/` user-facing frontend with the
v0 export at [_v0_drop/f1-chat-v0/](_v0_drop/f1-chat-v0/), keeping the existing
backend (`web/src/app/api/**`, `web/src/lib/**`) intact. The
compatibility boundary is `/api/chat` and its SSE `MessagePart`
stream — that's the only contract that has to hold.

**Strategy in one sentence**: v0 owns app shell + nav + styling +
chart UI; existing code owns API routes + db + resolver + Anthropic
synthesis + benchmark tooling. Nothing from the old frontend is
preserved — not as a design constraint, not as a fallback, not as
an unlinked legacy page.

---

## What we keep vs what we delete

### Backend — KEEP UNTOUCHED

```
web/src/app/api/**              all API routes (chat, sessions, query, schema, feedback, ...)
web/src/lib/**                  anthropic, db, chatRuntime, resolver, orchestration,
                                synthesis prompt builder, validators, sanity checks,
                                deterministicSql, queries, runtime models, perf tracing,
                                schema catalog, sql validation, zero-llm guard, etc.
web/src/lib/chat/consumeChatStream.ts   SSE frame parser — used by new v0 page
web/src/lib/mapChatResponse.ts          ChatApiResponse → MessagePart[] mapper
web/src/lib/chatTypes.ts                MessagePart + ChatApiResponse contracts — the boundary
                                        (NOTE: sendChatMessage.ts is DELETED in Step 5; orphaned
                                         once v0 page bypasses it. Existence in this list would
                                         mislead implementers.)
web/scripts/**                  benchmark + healthcheck tooling
web/sql/**                      migrations (n/a)
web/package.json scripts        all backend test/typecheck/healthcheck commands
web/tsconfig.json               keeps `@/* → src/*` alias
web/next.config.mjs             keep — minor edits only if a v0 file requires them
```

### Frontend — DELETE WHOLESALE

```
web/src/app/page.tsx                            (legacy root)
web/src/app/chat/**                             (legacy chat client)
web/src/app/analyticsv2/**                      (legacy non-chat surface)
web/src/app/sessions/**                         (legacy non-chat surface)
web/src/app/replay/**                           (legacy non-chat surface)
web/src/app/saved-analyses/**                   (legacy non-chat surface)
web/src/app/catalog/**                          (legacy non-chat surface)
web/src/app/telemetry/**                        (legacy non-chat surface)
web/src/app/error.tsx                           (legacy)
web/src/app/layout.tsx                          (replaced by v0 layout, minus auth provider)
web/src/components/**                           (everything — AppChrome, Nav, DataTable, chat/*, etc.)
web/src/app/globals.css                         (replaced by v0's globals.css)
```

Non-chat surfaces (`/sessions`, `/replay`, `/catalog`, `/analyticsv2/*`)
are **deleted, not hidden**. If we want any of those concepts in the
new product, they get rebuilt in v0's primitives later — they are
not constraints on this migration.

### v0 export — KEEP MOST, DROP AUTH

```
KEEP (selective — only what the chat shell + 23 charts actually import):
  components/ui/{avatar,button,card,chart,dropdown-menu,scroll-area}.tsx
                                                (the 6 shadcn primitives the chat shell imports;
                                                 add more only if a follow-up component needs them)
  components/f1-chat/**/*.tsx                   (chat shell + 23 chart renderers; sidebar included)
  hooks/use-mobile.ts                           (referenced by the shell)
  lib/utils.ts                                  (cn helper)
  lib/f1-formatters.ts
  lib/f1-team-colors.ts                         (canonical; supersedes web/src/lib/teamColors.ts)
  lib/chart-types.ts                            → web/src/lib/chart-types.ts (canonical name preserved)
  lib/mock-insights.ts                          → SPLIT into 21 per-file fixtures under
                                                  web/src/__mocks__/insights/ (Step 6); the
                                                  monolith file is NOT copied.
  app/page.tsx                                  → web/src/app/page.tsx (rewire backend; strip useAuth)
  app/layout.tsx                                → web/src/app/layout.tsx (drop AuthProvider + Analytics)
  app/globals.css                               → web/src/app/globals.css (canonical visual system)
  components.json                               → web/components.json (shadcn config)

DROP:
  components/theme-provider.tsx                 next-themes wrapper — not needed; v0 ships dark-only
                                                via `<html className="dark">`. Skipping avoids the
                                                `next-themes` dep.
  components/ui/*.tsx (the other ~64 files)     blanket-copying drags Radix dialog/tabs/tooltip/toast/
                                                collapsible/popover/select/etc. into the bundle even
                                                though no chat component imports them. Selective copy
                                                only.
  hooks/use-toast.ts                            not currently imported by the chat shell; copy + add
                                                `sonner` only when a component pulls it in.
  lib/auth-context.tsx                          Supabase auth — replaced by no-op shim
  lib/supabase/**                               Supabase client — gone
  app/auth/**                                   Login/sign-up routes — gone
  app/profile/**                                Profile page — gone
  middleware.ts                                 Supabase middleware — gone
  styles/globals.css                            duplicate of app/globals.css; one canonical file
  app/page.tsx imports of createClient / useAuth → swapped for shim/no-op (Step 4)
```

The v0 sidebar (`chat-sidebar.tsx`) and any component that imports
`useAuth` is **kept visually**; we strip the Supabase calls and
swap them for a local no-op shim so the layout/typography/spacing
stays exactly as designed.

---

## Compatibility boundary

The ONLY contract that has to hold across this migration is the
chat API: v0's UI must consume what `/api/chat` already streams.

**Backend produces** (existing — see [web/src/lib/chatTypes.ts](web/src/lib/chatTypes.ts)):

```ts
type MessagePart =
  | { type: "text"; text: string }
  | { type: "sql"; sql: string }
  | { type: "table"; rows: Record<string, unknown>[]; rowCount?: number;
      elapsedMs?: number; truncated?: boolean; title?: string }
  | { type: "warning"; messages: string[] }
  | { type: "metadata"; ... }
  | { type: "followUps"; prompts: string[] };
```

**v0 frontend has three relevant shapes** — the wire fixture
contract (`InsightMock`), the component prop contract
(`InsightCardProps`), and a NEW intermediate streaming-draft type
(`DraftInsight`) we introduce because `InsightMock` requires
`title: string` and has no `sql` / `rows` slots:

```ts
// v0 wire format — REQUIRED title; no sql/rows fields
// (from _v0_drop/f1-chat-v0/lib/chart-types.ts:73)
type InsightMock = {
  title: string;                                                // ← REQUIRED
  subtitle?: string;
  body: string;
  metrics?: Metric[];
  chart?: ChartSpec;
  key_takeaways?: string[];                                     // ← snake_case
  related_questions?: string[];
  hero?: { value: string; label: string; context?: string };
  verdict?: { label: "YES" | "NO"; color?: string; summary: string };
  composite?: Array<{ type; title?; x_label?; y_label?; series?; vertical_markers?; metrics? }>;
  what_we_have?: string[];
  tone?: "normal" | "muted";
  // NO sql, NO rows — see "InsightCard extension" below
};

// New intermediate type for streaming — title may be empty until
// the SSE final frame lands; sql + rows live here.
// Lives in web/src/lib/chart-types.ts alongside InsightMock.
type DraftInsight = Omit<InsightMock, "title"> & {
  title?: string;                                               // ← optional during stream
  sql?: string;                                                 // ← rendered by extended InsightCard
  rows?: Record<string, unknown>[];                             // ← rendered by extended InsightCard
  rowCount?: number;
  elapsedMs?: number;
  truncated?: boolean;
};

// v0 component prop contract — camelCase
// (from _v0_drop/f1-chat-v0/components/f1-chat/insight-card.tsx:15)
type InsightCardProps = {
  title?: string; subtitle?: string; body: string;
  metrics?: Metric[]; chart?: ChartSpec;
  takeaways?: string[]; relatedQuestions?: string[];            // ← camelCase
  hero?; verdict?; composite?; what_we_have?; tone?;
  sql?: string; rows?: ...;                                     // ← added in Step 5b
};
```

**Two adapters**, both new:

1. [web/src/lib/mapInsight.ts](web/src/lib/mapInsight.ts) — collapses streaming
   `MessagePart` chunks into an evolving `DraftInsight` (the
   superset of `InsightMock` with optional title + sql/rows
   fields the backend produces). Built incrementally as parts
   arrive over SSE; never narrowed to `InsightMock` at runtime.
2. [web/src/lib/toCardProps.ts](web/src/lib/toCardProps.ts) — the
   snake_case → camelCase shape adapter. Used by both `/mock`
   (fixtures) and the live page render. Lives in `lib/`, not
   `__mocks__/`, because production imports it.

Everything else is move/delete.

---

## Step-by-step plan

### Step 0 — Branch + backend smoke

```sh
git checkout -b ui/v0-frontend-replacement
git status                                # confirm clean
cd web && npm run dev
# hit a benchmark question via the existing UI to confirm /api/chat works
# Save terminal proof; if /api/chat is broken, fix that first.
```

This step proves the backend is healthy *before* the frontend swap.
Any post-migration `/api/chat` failure can then be attributed to
the swap, not pre-existing breakage.

### Step 1 — Add v0 deps to web/package.json (minimal closure)

I probed the actual import graph of the v0 chat shell + 23 chart
renderers (`grep -rh 'from "' components/f1-chat`). The complete
non-Supabase / non-analytics dep closure is **smaller than v0's
package.json suggests** because we only copy the primitives the
chat shell actually imports (Step 3). The minimal set:

```
@radix-ui/react-avatar          ^1.1.11    (avatar primitive — sidebar)
@radix-ui/react-dropdown-menu   ^2.1.16    (dropdown-menu primitive — sidebar)
@radix-ui/react-scroll-area     ^1.2.10    (scroll-area primitive — message list)
@radix-ui/react-slot            ^1.2.4     (button asChild — used by Button)
class-variance-authority        ^0.7.1     (Button + Card variants)
clsx                            ^2.1.1     (cn helper)
lucide-react                    ^0.564.0   (icon set used everywhere)
recharts                        ^2.15.0    (all chart renderers + shadcn chart primitive)
tailwind-merge                  ^3.3.1     (cn helper)
tailwindcss-animate             ^1.0.7     (Radix open/close animations)
```

That's the entire closure. **No `@radix-ui/react-dialog`,
`-tabs`, `-tooltip`, `-toast`, `-collapsible`, `-popover`,
`-select`, etc.** — the chat shell doesn't import them. Same with
`cmdk`, `embla-carousel-react`, `react-hook-form`,
`react-day-picker`, `input-otp`, `vaul`, `next-themes`, `sonner`:
none are needed because we only copy the 6 primitives the chat
imports (Step 3) and don't bring `theme-provider.tsx` (v0's dark
theme is hard-coded on `<html className="dark">`, no toggle
needed).

**Verification gate** — `depcheck` is not currently a project
dependency (`which depcheck` → not found on a fresh checkout).
Pin it as a dev dep first, then run with proper exit semantics:

```sh
# Step 1.5 — install depcheck so the verification command is
# reproducible. Add to package.json devDependencies (same commit
# as Step 1's deps).
cd web && npm install --save-dev depcheck@^1.4.7

# After Step 3 finishes the copy, run:
cd web && npx depcheck --json > /tmp/depcheck.json
node -e '
  const r = require("/tmp/depcheck.json");
  const m = Object.keys(r.missing || {});
  if (m.length > 0) {
    console.error("MISSING DEPS:", m);
    process.exit(1);
  }
  console.log("ok");
'
```

`depcheck`'s plain-text output exits 0 in both clean and dirty
cases, and `grep "Missing"` exits 0 *when missing deps are
present* (success on failure — wrong direction). The `--json`
output + `node -e` check inverts that: nonzero exit ONLY when
deps are missing, zero exit when clean.

If `depcheck` reports any missing dep beyond the list above, add
it to `package.json` and document why in the commit. The closure
above is grounded in the current v0 export; if v0 ships an updated
zip later, re-probe.

Skip ALL Supabase deps (`@supabase/ssr`, `@supabase/supabase-js`).
Skip `@vercel/analytics` (privacy-by-default).

**Stay on Next 15.5.x.** v0's components do not require Next 16;
recharts and Radix are version-agnostic. Backend route stability
matters more than tracking v0's exact Next pin.

```sh
cd web && npm install
```

### Step 2 — Delete the legacy frontend + legacy-coupled tests

Single commit, single sweep:

```sh
cd /Users/robertzehnder/Documents/coding/f1/openf1/web

# App routes — delete every non-API user-facing surface
rm -rf src/app/page.tsx src/app/error.tsx src/app/layout.tsx src/app/globals.css
rm -rf src/app/chat src/app/analyticsv2 src/app/sessions src/app/replay
rm -rf src/app/saved-analyses src/app/catalog src/app/telemetry

# Components — wholesale delete; v0 brings replacements
rm -rf src/components

# Test cleanup — these tests assert against deleted UI surfaces or
# the deleted sendChatMessage helper. Keeping them would break
# `npm run verify`. Probed list (grep -lE "ChatWorkspace|sendChatMessage|
# session-detail|replay-viewer|saved-analyses|catalog-completeness"
# scripts/tests/*.test.mjs):
rm scripts/tests/catalog-completeness.test.mjs
rm scripts/tests/replay-viewer-mvp.test.mjs
rm scripts/tests/session-detail-pace-table.test.mjs
rm scripts/tests/session-detail-stint-timeline.test.mjs
rm scripts/tests/session-detail-strategy-summary.test.mjs
rm scripts/tests/saved-analyses.test.mjs
rm scripts/tests/session-propagation.test.mjs
rm scripts/tests/streaming-synthesis-client.test.mjs

# Note: web/src/app/api/** is UNTOUCHED; web/src/lib/** is UNTOUCHED.
# All other tests in scripts/tests/ stay — they test backend / runtime /
# resolver / validators / chat orchestration, none of which we're touching.
```

**Tests we KEEP** (backend / runtime / lib coverage that survives the
migration): `answer-cache`, `cache-benchmark`, `cache-control-markers`,
`category-regression-gate`, `chatRuntime-*`, `db-stmt-cache`,
`driver-fallback`, `expected-columns-alias-resolution`,
`fact-contract-shape`, `feature-flags-23`, `flushtrace-*`,
`grader-*`, `grading-regression`, `join-patterns-validator`,
`local-docker-db-assertion`, `no-data-refusal`, `perf-*`,
`pooled-url-assertion`, `prompt-prefix-split`,
`raw-table-prompt-reminders`, `resolver-*`, `route-trace`,
`runtime-models-*`, `skip-repair`, `sql-column-validator`,
`streaming-synthesis-route`, `streaming-synthesis-server`,
`system-prompt-schema-coverage`, `template-router-*`,
`validator-*`, `zero-llm-path`. ~48 tests retained.

Run `npm run typecheck` immediately. It will fail loudly with every
broken import — that's expected and gives us the punch list of what
the new frontend has to provide.

Run `npm run test:grading` after Step 3 lands the v0 imports —
should pass cleanly because the deleted tests are gone and the
retained tests don't import frontend modules.

### Step 3 — Import v0 frontend (selective copy, not blanket)

We copy ONLY the shadcn primitives the chat shell actually imports
(probed: `avatar`, `button`, `card`, `chart`, `dropdown-menu`,
`scroll-area`). Blanket-copying all 70 v0 UI files would drag in
deps we don't need and inflate the bundle.

```sh
cd /Users/robertzehnder/Documents/coding/f1/openf1
V0=_v0_drop/f1-chat-v0
DST=web/src

# UI primitives (shadcn) — only what the chat shell imports
mkdir -p $DST/components/ui
for f in avatar button card chart dropdown-menu scroll-area; do
  cp $V0/components/ui/${f}.tsx $DST/components/ui/${f}.tsx
done
cp $V0/components.json web/components.json

# Chat shell + chart renderers (all 23 + insight-card, sidebar, input, message-bubble, etc.)
mkdir -p $DST/components/f1-chat/charts
cp $V0/components/f1-chat/*.tsx $DST/components/f1-chat/
cp $V0/components/f1-chat/charts/*.tsx $DST/components/f1-chat/charts/

# Hooks (only what's referenced)
mkdir -p $DST/hooks
cp $V0/hooks/use-mobile.ts $DST/hooks/use-mobile.ts
# use-toast is not currently referenced by the chat shell — skip unless a later
# component pulls it in; if so, add `sonner` and copy this file then.

# Lib helpers — KEEP v0's filenames so the existing imports resolve
cp $V0/lib/utils.ts $DST/lib/utils.ts
cp $V0/lib/f1-formatters.ts $DST/lib/f1-formatters.ts
cp $V0/lib/f1-team-colors.ts $DST/lib/f1-team-colors.ts
cp $V0/lib/chart-types.ts $DST/lib/chart-types.ts          # canonical name; do NOT rename

# Mocks → per-file fixtures (Step 6 splits v0's mock-insights.ts
# into 21 individual fixture files; do not copy the monolith).
mkdir -p $DST/__mocks__/insights
# (Step 6 creates m01-hero.ts ... m22-pit-cycle-event.ts; nothing copied here.)

# App shell
cp $V0/app/page.tsx $DST/app/page.tsx        # will rewire in Step 5
cp $V0/app/layout.tsx $DST/app/layout.tsx    # will strip AuthProvider in Step 4
cp $V0/app/globals.css $DST/app/globals.css  # canonical visual system
```

**Filename note**: v0 components import from `@/lib/chart-types`
([insight-card.tsx](_v0_drop/f1-chat-v0/components/f1-chat/insight-card.tsx),
[charts/index.tsx](_v0_drop/f1-chat-v0/components/f1-chat/charts/index.tsx)).
Keep that exact filename — do NOT rename to `insightTypes.ts`.
Renaming would force a sweep across every chart file, and v0 owns
the frontend so v0's filename wins.

**If a later component pulls in another shadcn primitive** (e.g.
someone adds a `dialog`-based modal), the missing-import will
fail typecheck. Resolve by copying `$V0/components/ui/{name}.tsx`
+ adding the matching Radix package — never blanket-copy the rest.

Reconcile the existing [web/src/lib/teamColors.ts](web/src/lib/teamColors.ts) vs
the v0 [_v0_drop/f1-chat-v0/lib/f1-team-colors.ts](_v0_drop/f1-chat-v0/lib/f1-team-colors.ts):
v0's becomes canonical; the old file gets deleted. If the existing
backend imports `teamColors` (it doesn't — the colors are UI-only),
update those imports in the same commit.

### Step 4 — Strip Supabase auth from v0; install no-op shim

The v0 bundle has 22 Supabase references across components. We do
NOT want auth, but we DO want to keep the visual sidebar / header
that displays user info. Approach: write a minimal no-op shim that
preserves the import shape but returns a constant guest user.

Create [web/src/lib/auth-shim.tsx](web/src/lib/auth-shim.tsx):

```tsx
"use client";
import { createContext, useContext, type ReactNode } from "react";

export type AuthUser = { id: string; name: string; email: string | null };
type AuthCtx = { user: AuthUser | null; signOut: () => void; loading: boolean };

const guest: AuthUser = { id: "guest", name: "Guest", email: null };
const ctx = createContext<AuthCtx>({ user: guest, signOut: () => {}, loading: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  return <ctx.Provider value={{ user: guest, signOut: () => {}, loading: false }}>{children}</ctx.Provider>;
}
export function useAuth() { return useContext(ctx); }
```

Then sweep — both single AND double quotes (v0 files mix the two,
so a single-quote-only sed misses real call sites):

```sh
cd web/src
# 1. Repoint auth-context imports (both quote styles)
grep -rlE '@/lib/auth-context' . | while read f; do
  sed -i '' -E 's|"@/lib/auth-context"|"@/lib/auth-shim"|g; s|'"'"'@/lib/auth-context'"'"'|'"'"'@/lib/auth-shim'"'"'|g' "$f"
done

# 2. Find every createClient call site and surrounding Supabase usage
grep -rE "createClient|@/lib/supabase|/auth/login|@vercel/analytics" .
# Inspect each match. For each:
#   - createClient() → delete the call; remove the variable; drop any
#     branch that conditionally fetched conversations / user data.
#   - "/auth/login" router.push redirects → delete the redirect block.
#   - @vercel/analytics import + <Analytics /> JSX → delete both lines.
```

Files that typically need surgical edits (review each):
- [web/src/components/f1-chat/chat-sidebar.tsx](web/src/components/f1-chat/chat-sidebar.tsx) — kept visually; remove DB-backed conversation list, replace with localStorage-backed history (or empty for first pass)
- [web/src/components/f1-chat/user-profile.tsx](web/src/components/f1-chat/user-profile.tsx) — kept visually; show "Guest" instead of fetching profile
- [web/src/app/page.tsx](web/src/app/page.tsx) — drop `useAuth` / `createClient` calls and the `/auth/login` redirect (line ~513 of v0's page.tsx); will be rewired in Step 5
- [web/src/app/layout.tsx](web/src/app/layout.tsx) — drop `import { AuthProvider } from '@/lib/auth-context'` (single-quoted in v0; the `auth-shim` provider wraps children instead) and drop `import { Analytics } from '@vercel/analytics/next'` plus its JSX

Do NOT keep `lib/supabase/**`, `app/auth/**`, `app/profile/**`,
`middleware.ts` from v0 — they get dropped (already excluded in
Step 3's copy commands).

**Hard acceptance gate** — Step 4 is not done until this returns no
live hits:

```sh
cd web && rg -n "@/lib/supabase|createClient\(|/auth/login|@vercel/analytics|@/lib/auth-context" src
```

Comments / dead code don't count — every match must be either
(a) deleted, or (b) inside a string literal that's intentionally
documenting the removal. If `rg` returns anything actionable, the
sweep is incomplete. CI gate this command before merge.

### Step 5 — Wire v0 root page to /api/chat (mapInsight.ts)

The load-bearing step. v0's [web/src/app/page.tsx](web/src/app/page.tsx) calls
`setMessages([…mock])` directly; we replace that with a direct SSE
call against the existing `/api/chat` endpoint.

**Why we don't use [web/src/lib/chat/sendChatMessage.ts](web/src/lib/chat/sendChatMessage.ts):**
the existing helper is too tightly coupled to the legacy chat data
model. It expects a `Conversation` shape with `placeholderId` /
`patchActiveConversation` / `setResolved` / `setComposerCtx` /
`mapResponseToParts` / `deriveResolved` deps, and it imports
`ComposerContext` from `@/components/chat/Composer` — a path we
delete in Step 2. Retrofitting that helper to v0's simpler
`messages: UiMessage[]` model would require either:
(a) moving `ComposerContext` into `web/src/lib/`, OR
(b) reshaping all 6 deps to fit the new state model.

Both are more code than the alternative — bypass `sendChatMessage`
and call the lower-level `consumeChatStream` helper directly. That
helper has a clean signature (`response`, `{ onAnswerDelta }`),
returns the final `ChatApiResponse`, and only depends on
`@/lib/chatTypes` (which stays untouched). The legacy
`sendChatMessage.ts` becomes orphaned and can be deleted in the
same commit since nothing else references it after the legacy chat
client is gone.

**Step 5a — Extend `chart-types.ts`** with both `DraftInsight` AND
the missing per-shape ChartSpec fields. v0's `ChartSpec` is too
narrow for its own fixtures: `mock-insights.ts` uses `total_laps`,
`stints`, `compound_legend`, `center_label`, `slices`, `circuit`,
`sector`, `view`, `phases`, `post_cycle`, and `delta_ms` on
`segments[]` — none of which are declared on `ChartSpec`. v0's
own renderer index uses `as any` casts to paper over this
([_v0_drop/f1-chat-v0/components/f1-chat/charts/index.tsx:65](_v0_drop/f1-chat-v0/components/f1-chat/charts/index.tsx)).
On `npm run typecheck`, the 21-fixture `/mock` route would fail
unless we widen the type.

Two ways to widen — pick the lighter one for first pass:

**Picked: Option A (flat optional union)** — add every per-shape
field as an optional property on the existing `ChartSpec`. Matches
v0's current `chart as any` runtime pattern, requires no renderer
edits, and keeps fixture authoring familiar (a `donut` fixture
just sets `type: "donut"`, `slices: [...]`, leaves grouped-bar
fields undefined). Tradeoff: looser type-safety per shape; a
fixture that mistakenly puts `slices` on a `grouped_bar` would
typecheck. Acceptable — `/mock` visual review catches it.

```ts
// Edit web/src/lib/chart-types.ts: replace existing ChartSpec
// with this widened version. ChartType list stays as-is.
export interface ChartSpec {
  type: ChartType;
  // generic axes / labels (existing)
  x_axis?: string[]; y_axis?: string[];
  x_label?: string; y_label?: string;
  y1_label?: string; y2_label?: string;
  axes?: string[];                                 // radar axis labels
  max_value?: number;                              // radar
  series?: ChartSeries[];
  events?: TimelineEvent[];                        // timeline / event_timeline
  rows?: StatusGridRow[];                          // status_grid
  segments?: Array<{                               // track_heatmap (extended)
    minisector_index: number;
    name: string;
    leader: string;
    color: string;
    delta_ms?: number;
  }>;
  vertical_markers?: VerticalMarker[];
  legend?: Record<string, string>;
  horizontal_marker?: { value: number; label?: string }; // line charts

  // stint_gantt
  total_laps?: number;
  stints?: Array<{
    driver: string; start: number; end: number;
    compound: "hard" | "medium" | "soft" | "inter" | "wet";
    lap_times_avg?: number;
  }>;
  compound_legend?: Record<string, string>;

  // donut
  center_label?: string;
  slices?: Array<{ label: string; value: number; color: string }>;

  // pit_event_strip
  phases?: Array<{ label: string; duration_sec: number; color: string }>;
  post_cycle?: { before_position: number; after_position: number; recovered_by_lap?: number };

  // track_heatmap (top-level meta)
  circuit?: string;
  sector?: number;
  view?: "track_shape" | "strip";

  // stint_boundaries for line_with_stint_markers
  stint_boundaries?: Array<{ lap: number; label: string }>;
}

// Then append DraftInsight (carries streaming-only fields):
export interface DraftInsight extends Omit<InsightMock, "title"> {
  title?: string;
  sql?: string;
  rows?: Record<string, unknown>[];
  rowCount?: number;
  elapsedMs?: number;
  truncated?: boolean;
}
```

**Verification gate**: after Step 5a, importing every v0 fixture
from `mock-insights.ts` into `/mock` and running `npm run typecheck`
must produce zero errors. If a fixture uses a field still missing
from `ChartSpec`, add it to the union — don't silence with `as any`.

**Step 5b — Extend v0's `insight-card.tsx`** to render SQL + result
table. v0's card currently has no slots for either; the backend
produces both, and the spot-check acceptance gate (Step 7) requires
both render. Add three things to
[web/src/components/f1-chat/insight-card.tsx](web/src/components/f1-chat/insight-card.tsx):

1. Extend `InsightCardProps` with optional `sql?: string`,
   `rows?: Record<string, unknown>[]`, `rowCount?: number`,
   `elapsedMs?: number`, `truncated?: boolean`.
2. Below `composite` and above `relatedQuestions`, render a
   collapsible SQL block (use the `details`/`summary` HTML pair or
   a Radix `Collapsible` — but Collapsible would need adding
   `@radix-ui/react-collapsible` to deps; prefer native `details`
   for zero-dep first pass).
3. Below SQL, render a result table (`<table>` styled with the
   shadcn `Card` look) showing first 50 rows + a "showing N of M"
   footer if `truncated`. Reuse v0's design tokens —
   `border-border`, `bg-card`, `text-muted-foreground`.

This is a minor extension to v0's design, not a rewrite. The
existing 23 chart renderers and the card's hero/verdict/body slots
are untouched.

**Step 5c — Create [web/src/lib/mapInsight.ts](web/src/lib/mapInsight.ts):**

```ts
import type { MessagePart } from "@/lib/chatTypes";
import type { DraftInsight, ChartSpec } from "@/lib/chart-types";

export function foldPartsIntoInsight(
  prev: DraftInsight | null,
  part: MessagePart
): DraftInsight {
  const next: DraftInsight = prev ?? { body: "" };
  switch (part.type) {
    case "text":
      next.body = next.body ? `${next.body}\n\n${part.text}` : part.text;
      break;
    case "sql":
      next.sql = part.sql;
      break;
    case "table":
      next.rows = part.rows;
      next.rowCount = part.rowCount;
      next.elapsedMs = part.elapsedMs;
      next.truncated = part.truncated;
      if (part.title) next.title = part.title;
      next.chart = detectChart(part.rows) ?? next.chart;
      break;
    case "warning":
      // InsightMock doesn't define a `warnings` field by design —
      // see "Warning handling" note below for why we fold into
      // takeaways with a "⚠" prefix instead of adding a new field.
      next.key_takeaways = [
        ...(next.key_takeaways ?? []),
        ...part.messages.map((m) => `⚠ ${m}`),
      ];
      break;
    case "followUps":
      next.related_questions = [
        ...(next.related_questions ?? []),
        ...part.prompts,
      ];
      break;
    case "metadata":
      // suppressed — v0 doesn't surface raw metadata as a list.
      // Refusal semantics (no_data_refusal / proprietary_no_data)
      // are applied separately by `applyResponseSemantics` below
      // because they need the full ChatApiResponse, not a stream-
      // chunk view of metadata.
      break;
  }
  return next;
}

// Run ONCE after the SSE final frame lands and all parts have been
// folded. Three sub-passes apply card-level semantics that aren't
// part-shaped:
//   1) applyResponseSemantics  — generationSource → muted refusal
//   2) applyScalarHero         — single-row scalar → hero field (M01)
//   3) applyVerdictSemantics   — body starts with YES/NO → verdict (M02)
import type { ChatApiResponse } from "@/lib/chatTypes";

const PROPRIETARY_FALLBACK = [
  "Speed at any sample point on the lap",
  "Brake-pedal on/off state and pressure proxy",
  "Throttle application percentage",
  "Lap-time deltas through the brake zone",
];

export function applyResponseSemantics(
  insight: DraftInsight,
  response: ChatApiResponse,
): DraftInsight {
  const next = { ...insight };
  const src = response.generationSource;

  // M21 — no-data refusal. Either of these signals routes the card
  // to the muted "Not in dataset" treatment.
  if (src === "no_data_refusal" || src === "proprietary_no_data") {
    next.tone = "muted";
    if (!next.what_we_have || next.what_we_have.length === 0) {
      next.what_we_have = PROPRIETARY_FALLBACK;
    }
    if (!next.title) next.title = "Not in dataset";
    next.chart = undefined;
  }

  // Future: hook up other generationSource branches here
  // (heuristic_after_sql_timeout → small "estimated" pill, etc.)
  return next;
}

/**
 * M01 — Hero scalar. Promote a single-row, narrow-shape result to the
 * `hero` slot when no chart is present. Common patterns: pole lap,
 * fastest lap, total overtakes, starting compound.
 *
 * Value-column resolution (priority order):
 *   1. compound-like:      compound | starting_compound | tyre + values
 *                          matching HARD|MEDIUM|SOFT|INTER|WET (any case)
 *   2. time/duration:      string matching /^[\d:.+-]+$/ (e.g. "1:27.502")
 *   3. numeric:            typeof value === "number"
 *
 * Identifier columns are explicitly deprioritized — never selected as
 * the value: driver_number, session_key, lap_number, meeting_key,
 * year, round.
 *
 * Label resolution (priority order):
 *   1. value of a different non-identifier column on the same row
 *      (e.g. driver_name when value is compound)
 *   2. humanized form of the value column name
 *      ("pole_lap_time" → "Pole lap time")
 *   3. insight.subtitle, then "Result" as last resort
 *
 * Never returns "" for either field.
 */
const IDENTIFIER_COLS = new Set([
  "driver_number", "session_key", "lap_number",
  "meeting_key", "year", "round", "id",
]);

const COMPOUND_COLS = new Set(["compound", "starting_compound", "tyre", "tyre_compound"]);
const COMPOUND_VALUES = /^(HARD|MEDIUM|SOFT|INTER|INTERMEDIATE|WET|C1|C2|C3|C4|C5)$/i;

function humanizeColumnName(col: string): string {
  // pole_lap_time → "Pole lap time"; total_overtakes → "Total overtakes"
  const words = col.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function isCompoundShaped(col: string, val: unknown): boolean {
  if (COMPOUND_COLS.has(col)) return true;
  return typeof val === "string" && COMPOUND_VALUES.test(val);
}

function isTimeShaped(val: unknown): boolean {
  return typeof val === "string" && /^[\d:.+-]+$/.test(val);
}

function pickValueCol(row: Record<string, unknown>, cols: string[]): string {
  // Skip identifier columns at every priority.
  const eligible = cols.filter((c) => !IDENTIFIER_COLS.has(c));
  // 1) compound-like
  const compoundCol = eligible.find((c) => isCompoundShaped(c, row[c]));
  if (compoundCol) return compoundCol;
  // 2) time-shaped string
  const timeCol = eligible.find((c) => isTimeShaped(row[c]));
  if (timeCol) return timeCol;
  // 3) numeric
  const numCol = eligible.find((c) => typeof row[c] === "number");
  if (numCol) return numCol;
  // Fallback: first eligible (or first of all if everything is an identifier).
  return eligible[0] ?? cols[0];
}

export function applyScalarHero(insight: DraftInsight): DraftInsight {
  if (insight.chart) return insight;
  if (insight.hero) return insight;
  if (!insight.rows || insight.rows.length !== 1) return insight;
  const row = insight.rows[0];
  const cols = Object.keys(row);
  if (cols.length === 0 || cols.length > 3) return insight;

  const valueCol = pickValueCol(row, cols);

  // Label = value of a different non-identifier column, else humanized
  // column name, else subtitle, else "Result". Never empty.
  const otherCol = cols.find((c) => c !== valueCol && !IDENTIFIER_COLS.has(c));
  const otherLabel = otherCol ? String(row[otherCol] ?? "").trim() : "";
  const label =
    otherLabel.length > 0
      ? otherLabel
      : humanizeColumnName(valueCol) || (insight.subtitle ?? "Result");

  const next = { ...insight };
  next.hero = { value: String(row[valueCol]), label };
  return next;
}

/**
 * M02 — Yes/No verdict. Promote answers that start with "YES" or
 * "NO" into the `verdict` slot. The remaining body becomes the
 * `summary` line; everything after the first sentence stays as
 * narrative `body`.
 */
export function applyVerdictSemantics(insight: DraftInsight): DraftInsight {
  if (insight.verdict) return insight;
  const body = insight.body?.trimStart() ?? "";
  const m = body.match(/^(YES|NO)\b[\s—:.,-]*(.*?)(?:[.!?](?:\s|$)|$)/i);
  if (!m) return insight;
  const label = m[1].toUpperCase() as "YES" | "NO";
  const summary = m[2].trim();
  if (summary.length === 0) return insight;

  const next = { ...insight };
  next.verdict = { label, summary, color: "#E10600" };
  // Strip the verdict sentence from the body; preserve the rest.
  next.body = body.slice(m[0].length).trimStart();
  return next;
}

function detectChart(rows: Record<string, unknown>[]): ChartSpec | undefined {
  if (!rows?.length) return undefined;
  const cols = Object.keys(rows[0]);

  // Tier-1 detectors (ship in this PR):
  if (cols.includes("corner_label") && cols.some(c => /entry|apex|exit|speed/.test(c))) {
    return buildGroupedBar(rows);                // M04 / M05
  }
  if (cols.includes("position_delta")) {
    return buildDivergingBar(rows);              // M12
  }
  if (cols.includes("clean_air_laps") && cols.includes("traffic_laps")) {
    return buildStackedHorizontal(rows);         // M13
  }
  if (cols.includes("compound") && cols.includes("stint_start_lap")) {
    return buildStintGantt(rows);                // M08
  }
  if (cols.includes("lap_number") && cols.some(c => /lap_time|delta/.test(c))) {
    return buildLineChart(rows);                 // M09
  }
  // Fallthrough: render a horizontal bar if we have one driver column + one numeric
  if (cols.includes("driver_name") || cols.includes("driver_number")) {
    const numericCol = cols.find(c => typeof rows[0][c] === "number");
    if (numericCol) return buildHorizontalBar(rows, numericCol);  // M06
  }
  return undefined; // body + result table only (hero is signaled by a separate
                    // `hero` field on DraftInsight, set elsewhere — not by this fn)
}

// Concrete builder contracts (each ~15-30 LoC; implemented in the
// same file). Each takes raw rows and returns a ChartSpec matching
// the discriminator the renderer switch keys on:

function buildGroupedBar(rows): ChartSpec
  // Group rows by `corner_label` (or first non-driver column);
  // pivot driver_name/driver_number into series; pick speed metric
  // from cols matching /entry|apex|exit|speed/. Use getDriverPalette
  // from f1-team-colors.ts for series.color.
  // Returns: { type: "grouped_bar", x_axis, y_label, series }

function buildDivergingBar(rows): ChartSpec
  // X axis = driver labels sorted by position_delta desc.
  // Series values = position_delta numbers (signed).
  // colors[] = per-driver team palette.
  // Returns: { type: "horizontal_bar_diverging", y_axis, x_label, series }

function buildStackedHorizontal(rows): ChartSpec
  // y_axis from `driver_name`; two series stacked: clean_air_laps
  // (gray) and traffic_laps (accent red).
  // Returns: { type: "stacked_horizontal_bar", y_axis, x_label, series }

function buildStintGantt(rows): ChartSpec
  // Group rows by driver_name; each group → one or more stint
  // segments { start: stint_start_lap, end: stint_end_lap, compound }.
  // Returns: { type: "stint_gantt", y_axis, total_laps, stints, compound_legend }

function buildLineChart(rows): ChartSpec
  // X = lap_number; pivot rows by driver_name into series; values =
  // first matching column (lap_time / delta / pace).
  // Returns: { type: "line", x_label, y_label, series }

function buildHorizontalBar(rows, numericCol): ChartSpec
  // y_axis = driver labels (driver_name or driver_number resolved
  // via DRIVER_TEAM map); single series of values from numericCol;
  // colors[] = per-driver team palette.
  // Returns: { type: "horizontal_bar", y_axis, x_label, series }

// Hero detection (separate flow — not via detectChart):
//   In the page-level wiring, after `foldPartsIntoInsight` produces
//   the DraftInsight, check whether `rows.length === 1 && cols <= 3`
//   AND `chart` is still undefined. If so, populate `hero` directly
//   on the DraftInsight using buildHero(rows) which returns
//   { value, label, context? } — NOT a ChartSpec. v0's InsightCard
//   renders hero independently of chart.

// Tier-2/3 detectors land in follow-up commits: status_grid, radar,
// scatter+regression, donut, line_dual_axis, event_timeline,
// track_heatmap, pit_event_strip, line_with_stint_markers,
// composite. Each becomes another `if` arm in detectChart() with a
// matching builder.
```

**Implementation gate**: typecheck must pass after Step 5c. That
means every `build*` function above must have a real implementation
in `mapInsight.ts` before the commit lands. Ship them as 6 stubs
that return a minimal valid `ChartSpec` first, then fill in the
real pivot logic — but the stubs must be present, not placeholders.

**Warning handling** (decision): the existing API streams a
`{ type: "warning"; messages: string[] }` part for benchmarks
flagged by validators (sanity checks, completeness misses,
fuel-correction caveats). v0's `InsightMock` does NOT define a
`warnings` field, and `InsightCard` does NOT render one. Two
options:

- **(A) Add a `warnings` field** to `chart-types.ts` and render a
  yellow callout in `insight-card.tsx`. Cleanest visual, but
  modifies v0's contract.
- **(B) Fold warnings into `key_takeaways`** with a `⚠` prefix
  so they share the bullet-list slot. No v0 contract changes.

We pick **(B) for first pass** — keeps v0's contract intact and
ships warnings visibly. If product wants a dedicated visual, switch
to (A) in a follow-up by extending `chart-types.ts` (one field) and
`insight-card.tsx` (one block). Both are localized.

**Rewrite [web/src/app/page.tsx](web/src/app/page.tsx)** (replacing v0's mock-driven
`handleSend` with a direct SSE call). Keep v0's JSX verbatim — only
swap the data-fetching guts:

```tsx
"use client";
import { useState } from "react";
import { consumeChatStream } from "@/lib/chat/consumeChatStream";
import { mapChatApiResponseToParts } from "@/lib/mapChatResponse";
import {
  foldPartsIntoInsight,
  applyResponseSemantics,
  applyScalarHero,
  applyVerdictSemantics,
} from "@/lib/mapInsight";
import { toCardProps } from "@/lib/toCardProps";   // Step-fix: see Step 6
import { InsightCard } from "@/components/f1-chat/insight-card";
import { ChatInput } from "@/components/f1-chat/chat-input";
import { ChatSidebar } from "@/components/f1-chat/chat-sidebar";
import { MessageBubble } from "@/components/f1-chat/message-bubble";
import type { DraftInsight } from "@/lib/chart-types";
// … same v0 imports

type UiMessage =
  | { id: string; type: "user"; content: string }
  | { id: string; type: "assistant"; content: string; insight: DraftInsight | null };

export default function Page() {
  const [messages, setMessages] = useState<UiMessage[]>([]);

  async function handleSend(text: string) {
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      { id: userId, type: "user", content: text },
      { id: assistantId, type: "assistant", content: "", insight: null },
    ]);

    const updateInsight = (next: DraftInsight) =>
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId && msg.type === "assistant"
            ? { ...msg, insight: next }
            : msg,
        ),
      );

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ message: text, context: {} }),
      });

      // Live streaming: keep a CUMULATIVE string and overwrite the body
      // each tick. Do NOT call foldPartsIntoInsight on per-chunk text
      // — that helper inserts "\n\n" between text parts, which is
      // correct for distinct final-frame parts but wrong for SSE deltas
      // (would produce "Verstappen\n\ntook\n\npole" as the prose
      // streams in).
      let liveBody = "";
      let live: DraftInsight = { body: "" };
      const finalPayload = await consumeChatStream(response, {
        onAnswerDelta: (chunk) => {
          liveBody += chunk;
          live = { ...live, body: liveBody };
          updateInsight(live);
        },
      });

      // When the SSE final frame arrives, fold the structured parts
      // (sql, table, warnings, followUps, metadata) into a fresh
      // insight, then run the three card-level semantic passes:
      //   applyResponseSemantics → muted refusal (M21)
      //   applyScalarHero        → hero scalar (M01)
      //   applyVerdictSemantics  → YES/NO verdict (M02)
      // Body comes from the cumulative stream string, not from
      // text-typed parts — those carry the SAME text the deltas
      // already streamed in.
      const parts = mapChatApiResponseToParts(finalPayload);
      let folded: DraftInsight = { body: liveBody };
      for (const p of parts) {
        // Skip text parts during final fold — body is already populated
        // from the streaming accumulator; folding text again would
        // double-print and insert "\n\n".
        if (p.type === "text") continue;
        folded = foldPartsIntoInsight(folded, p);
      }
      folded = applyResponseSemantics(folded, finalPayload);
      folded = applyScalarHero(folded);
      folded = applyVerdictSemantics(folded);
      // Default a title if no semantic pass filled it.
      if (!folded.title) folded.title = "Insight";
      updateInsight(folded);
    } catch (err) {
      updateInsight({ body: "Unable to process this request right now.", title: "Error" });
    }
  }

  // … render v0's JSX verbatim, using `toCardProps(message.insight)` to
  // map snake_case → camelCase before spreading into <InsightCard />
}
```

The only existing-lib modules this page depends on are
[web/src/lib/chat/consumeChatStream.ts](web/src/lib/chat/consumeChatStream.ts),
[web/src/lib/mapChatResponse.ts](web/src/lib/mapChatResponse.ts), and
[web/src/lib/chatTypes.ts](web/src/lib/chatTypes.ts) — all already in `lib/`,
all stay byte-identical.

**Delete [web/src/lib/chat/sendChatMessage.ts](web/src/lib/chat/sendChatMessage.ts)** in
the same commit. It's now orphaned and its `ComposerContext`
import would break typecheck if left in place.

**Update [web/src/app/layout.tsx](web/src/app/layout.tsx)** (copied from v0 in Step 3):
- Drop `import { AuthProvider } from '@/lib/auth-context'` (single-quoted in v0; replace with `from "@/lib/auth-shim"` if you want the shim's `AuthProvider`, or remove the wrapper entirely since the shim's `useAuth` works without a provider thanks to a default ctx value)
- Drop `import { Analytics } from '@vercel/analytics/next'` and the `<Analytics />` JSX
- Keep metadata, fonts, and `<html className="dark">` (v0's choice)

### Step 6 — Visual acceptance: /mock route renders all 21 in-scope

The visualization brief
([diagnostic/phase26_v0_visualization_brief_2026-05-05.md](diagnostic/phase26_v0_visualization_brief_2026-05-05.md))
specs 23 mocks total. M07 (team-grouped ranking) and M23 (track
marker map) are **explicit follow-up scope** — their renderers
don't exist in v0's `ChartRenderer` switch and adding them is
real product work, not a config tweak (M23 needs SVG circuit
outlines per venue).

**v0 already ships fixtures for all 21 in-scope mocks** in
[_v0_drop/f1-chat-v0/lib/mock-insights.ts](_v0_drop/f1-chat-v0/lib/mock-insights.ts)
(verified by `grep -nE "^export const \w+Mock"` — 24 total
exports). Step 6 splits that single file into 21 per-mock
fixtures. **No fixtures need to be authored from scratch in this
PR.** Authors who need to extend a fixture should edit it
in-place under `web/src/__mocks__/insights/` — the source of
truth is the per-file fixture, not the original v0 monolith.

Create [web/src/__mocks__/insights/](web/src/__mocks__/insights/) — one file per
in-scope mock. **21 files total**, each split out from v0's
existing `mock-insights.ts` (M07 + M23 are FOLLOW-UP and DO NOT
get fixture files in this PR — their renderers don't exist):

**21-file fixture map** (every file in this table ships in this
PR; nothing else):

| File | Source export in v0's `mock-insights.ts` |
|---|---|
| `m01-hero.ts` | `heroPoleLapMock` |
| `m02-yes-no.ts` | `overcutVerdictMock` |
| `m03-metric-grid.ts` | `brakingMock` (single-corner 3-tile shape) |
| `m04-corner-grouped-bar.ts` | `cornerAnalysisMock` |
| `m05-braking-grouped-bar.ts` | `brakingGroupedMock` |
| `m06-ranking-bar.ts` | `overtakingMock` |
| `m08-stint-gantt.ts` | `stintGanttMock` |
| `m09-multi-line.ts` | `lapPaceMock` |
| `m10-line-stint-markers.ts` | `stintDeltaMock` |
| `m11-scatter-regression.ts` | `tyreStrategyMock` |
| `m12-diverging-bar.ts` | `restartMock` |
| `m13-stacked-horizontal.ts` | `trafficMock` |
| `m14-dual-axis-line.ts` | `weatherMock` |
| `m15-event-timeline.ts` | `incidentsMock` |
| `m16-minisector-heatmap.ts` | `trackDominanceMock` |
| `m17-radar.ts` | `driverPerformanceMock` |
| `m18-status-grid.ts` | `dataHealthMock` |
| `m19-donut.ts` | `drsZoneDonutMock` |
| `m20-cross-cat-composite.ts` | `compositeGrainingMock` |
| `m21-no-data-refusal.ts` | `noDataBrakeTempMock` |
| `m22-pit-cycle-event.ts` | `pitEventMock` |

**Row count: 21.** No conditional / variant / "or merged into"
rows — every row above ships exactly one file with the exact name
shown.

**Unused source exports** (present in v0's `mock-insights.ts` but
NOT extracted to fixtures in this PR):

- `pitStrategyMock` — overlaps with M06 (pit-loss bar shape).
  Discarded: `overtakingMock` is the canonical M06 fixture.
- `straightLineSpeedMock` — overlaps with M06 (single-axis bar
  ranking). Discarded for the same reason.
- `minisectorMock` — overlaps with `trackDominanceMock` (M16).
  Discarded: `trackDominanceMock` has the more complete `segments`
  array.

These three are NOT copied to `web/src/__mocks__/insights/`. If a
follow-up PR wants pit-strategy or straight-line as their own
fixture variants, author them under M06b / M06c then — not here.

Each fixture file looks like:

```ts
// web/src/__mocks__/insights/m01-hero.ts
import type { InsightMock } from "@/lib/chart-types";
export const m01: InsightMock = { /* contents copied verbatim from v0's heroPoleLapMock */ };
```

Then `index.ts` re-exports:

```ts
// web/src/__mocks__/insights/index.ts
import { m01 } from "./m01-hero";
import { m02 } from "./m02-yes-no";
// … 19 more …
export const allMocks = { m01, m02, m03, m04, m05, m06, m08, m09, m10, m11, m12,
                          m13, m14, m15, m16, m17, m18, m19, m20, m21, m22 };
```

After splitting, `_v0_drop/f1-chat-v0/lib/mock-insights.ts` is
NOT copied to `web/src/`. The per-file fixtures become the
source of truth.

**This-PR scope: 21 fixtures, not 23.** v0's `ChartRenderer`
([_v0_drop/f1-chat-v0/components/f1-chat/charts/index.tsx](_v0_drop/f1-chat-v0/components/f1-chat/charts/index.tsx))
has switch cases for 16 chart types; the remaining 7 mocks (M01
hero, M02 verdict, M03 metric_grid, M21 no-data, M07
team-grouped-ranking, M23 track-marker-map, plus the M20 composite
sub-shapes) either go through `InsightCard`'s `hero`/`verdict`/
`metrics`/`tone="muted"` slots OR need new chart types added.

- **M07 (`horizontal_bar_team_grouped`)** — NOT in the
  `ChartRenderer` switch. Either (a) drop M07 from this PR and
  fold its layout into M06 with a `team` field, OR (b) add a new
  case + renderer. **Decision: follow-up PR**, render M07 as M06
  in this PR (gate the team-color side-bar on a future field).

- **M23 (`track_marker_map`)** — NOT in `ChartRenderer`. Needs an
  SVG circuit-outline renderer per venue, which is genuinely new
  product work (SVG tracks for ~24 venues). **Decision: follow-up
  PR**, render M23 questions with a body-only InsightCard for now
  (M21-style muted note: "Track-map view coming soon").

- **The other 21** all go through existing v0 paths and must
  render correctly on `/mock` before merge.

Add a comment to `ChartRenderer`'s default case so the dev
experience for unimplemented types is clear:

```tsx
default:
  // Known unimplemented (follow-up PR): horizontal_bar_team_grouped, track_marker_map
  return (
    <div className="text-sm text-muted-foreground p-4 text-center">
      Chart type &quot;{chart.type}&quot; not yet implemented (follow-up PR)
    </div>
  );
```

Add the shared snake_case → camelCase adapter at
[web/src/lib/toCardProps.ts](web/src/lib/toCardProps.ts) — NOT under
`__mocks__/`. Production code (the live page) needs to import it,
and importing from a `__mocks__` namespace in production is an
anti-pattern: it implies the value is test-only, leaks the path
into the production bundle, and confuses code-review tooling. The
adapter is real production logic shared by `/mock` (fixtures) and
`/` (live SSE). Live in `lib/`, import from both call sites.

```ts
// web/src/lib/toCardProps.ts
import type { DraftInsight, InsightMock } from "@/lib/chart-types";
import type { ComponentProps } from "react";
import type { InsightCard } from "@/components/f1-chat/insight-card";

// Two callers, one adapter:
//   /mock route passes InsightMock fixtures (title required).
//   Live page passes DraftInsight (title optional, sql/rows present).
// Accept either; pass sql/rows through if present.
export function toCardProps(
  m: InsightMock | DraftInsight
): ComponentProps<typeof InsightCard> {
  return {
    title: m.title,
    subtitle: m.subtitle,
    body: m.body,
    metrics: m.metrics,
    chart: m.chart,
    takeaways: m.key_takeaways,
    relatedQuestions: m.related_questions,
    hero: m.hero,
    verdict: m.verdict,
    composite: m.composite,
    what_we_have: m.what_we_have,
    tone: m.tone,
    sql: "sql" in m ? m.sql : undefined,
    rows: "rows" in m ? m.rows : undefined,
    rowCount: "rowCount" in m ? m.rowCount : undefined,
    elapsedMs: "elapsedMs" in m ? m.elapsedMs : undefined,
    truncated: "truncated" in m ? m.truncated : undefined,
  };
}
```

Then [web/src/app/mock/page.tsx](web/src/app/mock/page.tsx):

```tsx
import { allMocks } from "@/__mocks__/insights";
import { toCardProps } from "@/lib/toCardProps";
import { InsightCard } from "@/components/f1-chat/insight-card";
export default function MockPage() {
  return (
    <main className="container mx-auto py-8 space-y-8">
      {Object.entries(allMocks).map(([id, m]) => (
        <section key={id}>
          <h3 className="text-sm uppercase tracking-wide text-muted-foreground mb-3">{id}</h3>
          <InsightCard {...toCardProps(m)} />
        </section>
      ))}
    </main>
  );
}
```

The same `toCardProps` adapter is used by the live SSE path in
Step 5 — `mapInsight.ts` builds a `DraftInsight` (NOT an
`InsightMock`; the runtime shape includes streaming-only fields
like `sql` and `rows`), and the page-level render calls
`toCardProps()` once before passing to `<InsightCard />`. The
adapter accepts the union `InsightMock | DraftInsight` so /mock
fixtures and live SSE both flow through it. **Single adapter,
one call site per render tree, no prop-name drift, no runtime
narrowing to fixture shape.**

**Merge gate**: all **21** in-scope fixtures must render cleanly
on `/mock` before this PR ships (M07 + M23 are follow-up — see
above). Live auto-detection in `mapInsight.ts` only needs to ship
the Tier 1 detectors (M01, M03, M06, M09, M21); Tier 2 / Tier 3
detectors land in follow-up PRs but the renderers must already
exist and be QA'd via fixtures.

### Step 7 — Three-level acceptance: backend / adapter / browser

The benchmark runner ([web/scripts/run_category_benchmarks.mjs](web/scripts/run_category_benchmarks.mjs))
posts directly to `/api/chat` and grades the raw SSE response — it
**does not exercise** `mapInsight.ts`, `toCardProps`, the
`InsightCard` extensions, or any v0 renderer. Treating its A-rate
as proof that the migration is done would miss adapter regressions
entirely.

So acceptance has three independent levels:

**(a) Backend parity** — same as before:

```sh
cd web && OPENF1_CHAT_BASE_URL=http://127.0.0.1:3000 \
  node scripts/run_category_benchmarks.mjs --category all \
  --out ../diagnostic/phase_19_baseline_2026-05-06.json
```

Compare to 104/167 from May-5. **Backend A-rate must not regress.**
A drop here means we accidentally touched something in
`web/src/app/api/**` or `web/src/lib/**` — fix that, not the
adapter. **This benchmark cannot validate the adapter** and the
plan's "wrong shape" claim about benchmark drops is incorrect.

**(b) Adapter unit test** (NEW —
[web/scripts/tests/mapInsight.test.ts](web/scripts/tests/mapInsight.test.ts) — runs via `tsx --test`):

Capture 8-10 real `ChatApiResponse` payloads to fixture files
during dev (one per Tier 1 detector + one each for hero, verdict,
muted refusal). Then write a TypeScript test (`.test.ts`, not
`.mjs`) that loads each fixture and runs it through the adapter:

```ts
// web/scripts/tests/mapInsight.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  foldPartsIntoInsight,
  applyResponseSemantics,
  applyScalarHero,
  applyVerdictSemantics,
} from "../../src/lib/mapInsight";
import { mapChatApiResponseToParts } from "../../src/lib/mapChatResponse";
import type { ChatApiResponse } from "../../src/lib/chatTypes";
import type { DraftInsight } from "../../src/lib/chart-types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loadFixture = (name: string): ChatApiResponse =>
  JSON.parse(readFileSync(path.join(__dirname, "fixtures", name), "utf8"));

// Shared helper — runs the same pipeline as web/src/app/page.tsx
function runPipeline(fx: ChatApiResponse): DraftInsight {
  let insight: DraftInsight = { body: fx.answer ?? "" };
  for (const p of mapChatApiResponseToParts(fx)) {
    if (p.type !== "text") insight = foldPartsIntoInsight(insight, p);
  }
  insight = applyResponseSemantics(insight, fx);
  insight = applyScalarHero(insight);
  insight = applyVerdictSemantics(insight);
  return insight;
}

test("q1717 Suzuka esses → grouped_bar", () => {
  const r = runPipeline(loadFixture("q1717-suzuka-esses.json"));
  assert.equal(r.chart?.type, "grouped_bar");
  assert.ok(r.rows && r.rows.length > 0);
});

test("q1922 pole lap → hero scalar (M01)", () => {
  const r = runPipeline(loadFixture("q1922-pole-lap.json"));
  assert.ok(r.hero, "expected applyScalarHero to populate hero");
  assert.ok(/^[\d:.]+/.test(r.hero!.value), `hero.value=${r.hero!.value} not time-shaped`);
  assert.ok(r.hero!.label.trim().length > 0, "hero.label must not be empty");
  assert.equal(r.chart, undefined);
});

test("applyScalarHero — single-column row produces non-empty label", () => {
  // Regression guard: { pole_lap_time: "1:27.502" } must not yield
  // hero.label === "" via subtitle fallback when subtitle is also empty.
  const insight: DraftInsight = {
    body: "",
    rows: [{ pole_lap_time: "1:27.502" }],
  };
  const r = applyScalarHero(insight);
  assert.ok(r.hero, "hero set");
  assert.equal(r.hero!.value, "1:27.502");
  assert.equal(r.hero!.label, "Pole lap time", "humanized column name");
});

test("applyScalarHero — q1941 starting compound prefers compound over driver_number", () => {
  // Regression guard: identifier columns must not be picked as the
  // hero value when a compound-shaped column is present. Without the
  // identifier deny-list, value would be "1" (Verstappen's number)
  // and label would be "MEDIUM" — visually wrong.
  const insight: DraftInsight = {
    body: "",
    rows: [{ driver_number: 1, compound: "MEDIUM" }],
  };
  const r = applyScalarHero(insight);
  assert.ok(r.hero, "hero set");
  assert.equal(r.hero!.value, "MEDIUM", "compound column wins over identifier");
  // Label falls through to humanized column name because the only
  // other column is an identifier (driver_number) and we skip those.
  assert.equal(r.hero!.label, "Compound");
});

test("applyScalarHero — compound recognized by enum value even without compound-named column", () => {
  // Defensive: backend that emits { driver_name, tyre_compound } should still
  // route the hero to the compound, not the driver name.
  const insight: DraftInsight = {
    body: "",
    rows: [{ driver_name: "Max VERSTAPPEN", tyre_compound: "SOFT" }],
  };
  const r = applyScalarHero(insight);
  assert.ok(r.hero, "hero set");
  assert.equal(r.hero!.value, "SOFT");
  assert.equal(r.hero!.label, "Max VERSTAPPEN", "driver name as label");
});

test("q2062 over-cut verdict → YES verdict (M02)", () => {
  const r = runPipeline(loadFixture("q2062-overcut-verdict.json"));
  assert.ok(r.verdict, "expected applyVerdictSemantics to populate verdict");
  assert.ok(r.verdict!.label === "YES" || r.verdict!.label === "NO");
  assert.ok(r.verdict!.summary.length > 0);
});

test("q1750 brake temps → muted refusal (M21)", () => {
  const r = runPipeline(loadFixture("q1750-brake-temps.json"));
  assert.equal(r.tone, "muted");
  assert.ok(r.what_we_have && r.what_we_have.length > 0);
  assert.equal(r.chart, undefined);
});

// ... q2080 horizontal_bar, q1924 line, q2103 horizontal_bar_diverging,
// q2041 stacked_horizontal_bar, q1943 stint_gantt — one per Tier 1 detector.
// Total: 8-10 tests, each ~15 lines. Captured fixtures live under
// web/scripts/tests/fixtures/.
```

The existing `tsx` dev dep already in
[web/package.json](web/package.json) handles TypeScript imports
under the Node test runner — `node --test` alone does not. Add an
`npm run test:adapter` script that runs:

```json
"test:adapter": "tsx --test scripts/tests/mapInsight.test.ts"
```

Then update `verify` to include it:

```json
"verify": "npm run typecheck && npm run test:grading && npm run test:adapter && npm run build"
```

Note: `test:grading` uses `node --test scripts/tests/*.test.mjs`,
which excludes the new `.test.ts` file by extension. The adapter
test is its own command to keep the runner setup distinct.

**(c) Browser smoke** — manual, single pass before merge:

```sh
cd web && npm run dev
```

- [ ] Root page renders v0's chat shell — sidebar, input, suggested
      prompts, dark theme, F1 branding all from v0
- [ ] Sending a prompt streams text into the card body
- [ ] Final SQL renders into the collapsible SQL section (added in Step 5b)
- [ ] Final table renders into the result table (added in Step 5b)
- [ ] Tier 1 detectors fire on these 5 spot-check questions:
  - q1922 (pole lap) → `hero` field populated, no chart
  - q1717 (Suzuka esses) → `chart.type === "grouped_bar"`
  - q2080 (Imola overtakes) → `chart.type === "horizontal_bar"`
  - q1924 (Monza pace) → `chart.type === "line"`
  - q1750 (brake temps) → `tone === "muted"`, `what_we_have` populated
- [ ] `/mock` renders all 21 in-scope fixtures (M07 + M23 are FOLLOW-UP)
- [ ] Dark theme tokens match v0's design (do NOT bend toward old palette)

All three levels must pass before the PR merges. (a) catches
backend changes; (b) catches adapter / type collapse changes; (c)
catches anything visual the first two miss.

### Step 8 — Cleanup

```sh
rm -rf _v0_drop/
git add -A
git commit -m "chore: remove v0 source drop"
```

Push the branch and open a PR titled
`ui: replace frontend wholesale with v0; preserve backend`.

---

## Commit sequence

Each commit leaves the tree typecheck-passing (or, for Step 2, a
deliberate red state we know we're about to fix).

1. `chore: branch ui/v0-frontend-replacement; add v0 deps + depcheck`
2. `chore: delete legacy frontend + 8 legacy-coupled tests + sendChatMessage.ts`
3. `feat: import v0 frontend (components, charts, hooks, lib helpers, mocks) — selective copy`
4. `feat: install v0 globals.css + tailwind tokens as canonical visual system`
5. `feat: replace Supabase auth in v0 components with no-op shim`
6. `feat: widen ChartSpec for all v0 fixture shapes + add DraftInsight + extend InsightCard with sql/table slots`
7. `feat: wire v0 root page to /api/chat SSE; mapInsight.ts with applyResponseSemantics + applyScalarHero + applyVerdictSemantics`
8. `feat: implement Tier 1 chart builders (groupedBar, divergingBar, stacked, gantt, line, horizontalBar)`
9. `feat: extract 21 in-scope mock fixtures + /mock route as visual QA surface`
10. `test: add mapInsight adapter unit tests (tsx --test) + 8-10 captured ChatApiResponse fixtures`
11. `chore: remove _v0_drop/ source`

Eleven commits, one PR.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Stripping Supabase leaves dangling imports the typecheck misses | High | Step 4's `rg` gate (covers single + double quotes) is the hard merge-block. Comments / dead JSX with `useAuth` references must also be deleted, not commented |
| `<InsightCard {...mock} />` spread silently drops `key_takeaways` and `related_questions` because the prop names are camelCase | High | The single `toCardProps` adapter (Step 5/6) is the only path from `InsightMock` to `InsightCardProps`. Direct spread is forbidden — typecheck catches it because the types differ |
| Selective shadcn copy breaks when a follow-up component references a primitive we didn't bring (`dialog`, `tabs`, etc.) | Medium | Step 1's `depcheck` + Step 6's typecheck catch this immediately. Resolution: copy `$V0/components/ui/{name}.tsx` + add the matching Radix package; never blanket-copy |
| Bypassing `sendChatMessage` means we lose the legacy helper's `Conversation`-shape patching, resolved-context tracking, and follow-up ComposerContext updates | Medium | The new model doesn't NEED those — v0's UI is a flat `messages: UiMessage[]` with no per-conversation state. If a Phase 27 feature wants resolved-context display (e.g. "answered for Verstappen at Suzuka 2025"), reintroduce a thinner version then. Tracked as out-of-scope in this PR |
| Folding warnings into `key_takeaways` with `⚠` prefix loses semantic distinction between primary insight bullets and validator warnings | Low | Acceptable for first pass — warnings are still surfaced and visually flagged. Promote to a dedicated `warnings` field in `chart-types.ts` + `insight-card.tsx` if product wants stronger visual separation |
| `mapInsight.ts` collapse breaks chart auto-detection on real responses but the unit test fixtures don't catch it | Medium | Step 7(b) requires 8-10 captured-payload fixtures, one per Tier 1 detector + edge cases (hero, verdict, muted refusal). Adapter test runs in `npm run verify`. Coverage is the variety of fixtures, not the count |
| Backend benchmark A-rate drop misattributed to adapter changes | Medium | Step 7(a) explicitly notes the benchmark cannot validate the adapter. A drop means backend `lib/` or `api/` was touched; check the `git diff --stat` filter from the Done checklist before blaming `mapInsight.ts` |
| M07 (team-grouped ranking) and M23 (track-marker map) need new renderers v0 didn't ship | High | Explicitly out of this PR's scope. Step 6 adds a comment to `ChartRenderer`'s default case; questions that would have produced these chart types fall through to body+table. Tracked for follow-up |
| Extending `InsightCard` with sql/table slots drifts from v0's design intent | Low | The extension is additive (new optional props); existing v0 fixtures don't break. If product wants the SQL hidden in the live chat experience, gate the slot on a feature flag in a follow-up |
| `npm run verify` breaks because legacy tests reference deleted UI surfaces (`session-detail-pace-table`, `replay-viewer-mvp`, `streaming-synthesis-client`, etc.) | High | Step 2 explicitly deletes the 8 probed legacy-coupled tests in the same commit as the frontend deletion. `test:grading` re-passes after Step 3 lands. List is grounded in actual `grep -lE` output, not speculation |
| Adapter test runs `node --test` against `.ts` source but vanilla Node can't resolve TypeScript imports | High | Step 7b uses `tsx --test scripts/tests/mapInsight.test.ts` (tsx is already a dev dep). Separate `test:adapter` script keeps the runner config distinct from `test:grading`'s `.mjs` files |
| `depcheck` grep gate has inverted exit semantics (success when missing deps exist) | Medium | Step 1 pins `depcheck@^1.4.7` as a dev dep and uses `--json` + `node -e` script that exits nonzero ONLY when missing deps are detected. Replaces the `grep "Missing"` formulation |
| Live SSE streaming inserts `\n\n` between every chunk because `foldPartsIntoInsight` joins text parts | Medium | Step 5c uses a separate cumulative string for the live stream; folding only runs on FINAL non-text parts. Skip text parts during the final fold (body is already populated from the accumulator) |
| M21 refusal questions (q1750-1758) silently render as plain text because no part-folder sets `tone="muted"` or `what_we_have` | High | `applyResponseSemantics` (Step 5c) runs once after parts fold, keys on `response.generationSource === "no_data_refusal" \| "proprietary_no_data"`. Adapter test fixture for q1750 enforces this in CI |
| M01 hero (q1922 pole lap) silently renders as plain body text because `hero` field is never populated | High | `applyScalarHero` (Step 5c) runs after `applyResponseSemantics`. Promotes single-row/narrow-shape results to `hero` only when no chart is set. Adapter test fixture for q1922 enforces hero presence + time-shaped value |
| M02 verdict (q2062 over-cut) silently renders as plain body text starting "YES …" | High | `applyVerdictSemantics` (Step 5c) regex-matches `^(YES\|NO)…` at body start, splits into `verdict.label` + `verdict.summary` + remaining body. Adapter test fixture for q2062 enforces verdict presence |
| Production code imports `toCardProps` from `__mocks__/insights/` (anti-pattern) | Medium | Adapter lives at `web/src/lib/toCardProps.ts`. Production page + mock route both import from there. The `__mocks__/insights/` directory holds fixtures only |
| `ChartSpec` is too narrow for v0's own fixtures (`stint_gantt`, `donut`, `pit_event_strip`, etc. use fields not declared on the type) — typecheck breaks on `/mock` | High | Step 5a widens `ChartSpec` to a flat optional union covering every per-shape field used by `mock-insights.ts` (`total_laps`, `stints`, `compound_legend`, `slices`, `center_label`, `phases`, `post_cycle`, `circuit`, `sector`, etc.). v0's renderer's `as any` casts can be progressively replaced |
| recharts adds ~400KB to first-load bundle | Low | Acceptable for the v0 design system; can lazy-import per chart later |
| Next 15.5 + Radix 1.x peer-dep mismatch | Low | Radix supports React 18+; widely used on Next 15 |
| Deleting `/sessions`, `/replay`, `/catalog`, `/analyticsv2/*` removes a surface someone was using | Medium | These are research/internal pages; if a stakeholder wants them back, rebuild in v0 primitives later. Decision is recorded in this plan |
| v0 sidebar's conversation history relied on Supabase rows | Medium | First pass: empty sidebar (or hide it). Follow-up PR: localStorage-backed history with a small adapter |
| v0's globals.css collides with backend route response styling (e.g. `/api/health` HTML responses) | Low | API routes are JSON-only; no HTML response surface to style |

---

## Out of scope

- Re-running the benchmark to chase A-rate gains beyond parity (Phase 27)
- Light-mode toggle (v0 ships dark; we keep dark)
- Re-implementing `/sessions`, `/replay`, `/catalog`, `/analyticsv2/*` in v0 primitives
- Adding any auth (deliberately no auth — Phase 17+ design choice)
- Building a real backed-up conversation history (sidebar = empty or localStorage in first pass)
- Deploying the result to a public URL — local dev only for the migration PR

---

## Estimated effort

- Step 0 (branch + smoke): 15 min
- Step 1 (deps + depcheck pin): 15 min
- Step 2 (delete legacy frontend + 8 legacy tests): 20 min
- Step 3 (import v0 + run depcheck gate): 30 min
- Step 4 (auth-shim sweep): 1 hr (review each useAuth/createClient site)
- Step 5a (widen ChartSpec + add DraftInsight to chart-types.ts): 45 min
- Step 5b (extend InsightCard with sql/table slots): 1 hr
- Step 5c (mapInsight + applyResponseSemantics + applyScalarHero + applyVerdictSemantics + page wiring + 6 builder stubs): 2.5 hr
- Step 5d (real builder implementations for Tier 1): 1.5 hr
- Step 6 (split 21 in-scope fixtures from v0's mock-insights.ts + toCardProps + /mock route): 1.5 hr
- Step 7a (backend benchmark): 1 hr
- Step 7b (adapter unit tests + capture 8-10 fixtures via dev-server): 1.5 hr
- Step 7c (browser smoke): 30 min
- Step 8 (cleanup + PR): 15 min

**Total: ~12-13 hours of focused work**, single PR.

---

## Done = these all hold

- [ ] `web/src/components/` contains only v0-derived files
- [ ] `web/src/app/` non-API routes are: `page.tsx`, `layout.tsx`,
      `globals.css`, `mock/page.tsx`. Nothing else
- [ ] **Existing backend lib files** under `web/src/lib/` are
      byte-identical to pre-migration. **Allowed changes** under
      `web/src/lib/`:
      - **New UI helpers** (added): `mapInsight.ts`, `auth-shim.tsx`,
        `chart-types.ts`, `utils.ts`, `f1-formatters.ts`,
        `f1-team-colors.ts`, `toCardProps.ts`
      - **Orphaned helpers** (deleted): `chat/sendChatMessage.ts`
        (deleted in Step 5 because v0 page bypasses it; nothing else
        references it once legacy chat client is gone)
      - **Untouched** (must not appear in the diff): everything
        else, especially `anthropic.ts`, `chatRuntime.ts`, `db.ts`,
        `synthesis/*`, `validators/*`, `chat/consumeChatStream.ts`,
        `mapChatResponse.ts`, `chatTypes.ts`
      - Verify by:
        ```sh
        git diff --stat main..HEAD -- web/src/lib \
          | grep -vE "(mapInsight|auth-shim|chart-types|utils|f1-formatters|f1-team-colors|toCardProps|chat/sendChatMessage)\.tsx?\s*\|"
        ```
        The remaining diff lines must all show `0 additions,
        0 deletions` (or no output).
- [ ] `npm run typecheck` passes
- [ ] `npm run verify` passes (typecheck + grading tests + build + new adapter test)
- [ ] `/api/chat` streams the same `MessagePart` protocol as before
- [ ] Sending a benchmark question through the new UI returns an
      InsightCard with body, SQL, table, and (for Tier 1 questions)
      a chart
- [ ] `/mock` renders all **21** in-scope chart fixtures (M07 + M23 are
      explicit follow-ups, not merge blockers — see Step 6)
- [ ] **Backend** benchmark A-rate ≥ 104/167 (Step 7a — backend parity only;
      not a measure of adapter correctness)
- [ ] **Adapter** unit test passes on 8-10 captured `ChatApiResponse`
      fixtures (Step 7b — covers hero, verdict, muted refusal, and
      every Tier 1 chart type)
- [ ] **Browser** smoke check passes the 5 spot-check questions
      (Step 7c — q1922, q1717, q2080, q1924, q1750)
- [ ] No Supabase package remains in `web/package.json`
- [ ] `rg -n "@/lib/supabase|createClient\(|/auth/login|@vercel/analytics|@/lib/auth-context" web/src` returns no live hits
- [ ] No legacy frontend file remains in git history of the branch
      after squash (or kept in commit 2 if commits aren't squashed)

---

**File**: [diagnostic/v0_ui_migration_plan_2026-05-06.md](diagnostic/v0_ui_migration_plan_2026-05-06.md)
**Companion specs**:
- [diagnostic/phase26_v0_visualization_brief_2026-05-05.md](diagnostic/phase26_v0_visualization_brief_2026-05-05.md) — the 23-mock visualization contract
- [diagnostic/phase26_analysis_categories_plan_2026-05-05.md](diagnostic/phase26_analysis_categories_plan_2026-05-05.md) — the 14-category data view
