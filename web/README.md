# OpenF1 Web App (MVP Scaffold)

This is the first implementation scaffold for an exploratory OpenF1 app over your local PostgreSQL warehouse.

## What is included

- Next.js + TypeScript app shell
- Read-only Postgres query layer using `pg`
- SQL safety guardrails for API query execution
- Initial pages:
  - `/` home metrics
  - `/sessions` session browser with filters
  - `/sessions/:sessionKey` session detail + completeness
  - `/telemetry` bounded telemetry explorer
  - `/chat` analyst-style chat (heuristic SQL mode)
  - `/catalog` schema browser
- Initial API surface:
  - `GET /api/schema`
  - `GET /api/sessions`
  - `GET /api/sessions/:sessionKey`
  - `GET /api/sessions/:sessionKey/completeness`
  - `GET /api/sessions/:sessionKey/drivers`
  - `GET /api/sessions/:sessionKey/laps`
  - `GET /api/sessions/:sessionKey/telemetry`
  - `GET /api/sessions/:sessionKey/weather`
  - `GET /api/sessions/:sessionKey/race-control`
  - `POST /api/query/preview`
  - `POST /api/query/run`
  - `POST /api/chat`
  - `GET /api/saved-analyses`

## Local setup

1. Copy env template:

```bash
cd /Users/robertzehnder/Documents/coding/f1/openf1/web
cp .env.local.example .env.local
```

Set `ANTHROPIC_API_KEY` in `.env.local` to enable Sonnet-powered chat SQL generation.

2. Install dependencies:

```bash
npm install
```

3. Run dev server:

```bash
npm run dev
```

4. Open:

```text
http://localhost:3000
```

## Build dependencies

### Google Fonts network requirement

`npm run build` (and `next build`) fetches font metrics from Google Fonts at build time via
`next/font/google` (`web/src/app/layout.tsx`). **Network access is required** unless fonts are
self-hosted locally.

CI runs the `web-build` job on GitHub-hosted runners (`ubuntu-latest`), which have outbound network
access, so this dependency is satisfied automatically in CI.

### Self-hosting fonts (offline / air-gapped builds)

To remove the network dependency:

1. Download the font files (e.g. `Inter`) into `web/public/fonts/`.
2. Replace the `next/font/google` import in `web/src/app/layout.tsx` with `next/font/local`,
   pointing `src` at the local files.
3. Delete or empty the `subset` / `display` options that only apply to the Google loader.

This migration is out of scope for the current roadmap phase; see roadmap §1 for context.

## Notes

- This scaffold assumes your Postgres container is already running and reachable using the env values.
- Query APIs are read-only by design and reject non-SELECT SQL.
- `POST /api/chat` now uses Anthropic Sonnet (`ANTHROPIC_MODEL`, default `claude-sonnet-4-6`) to generate SQL.
- Generated SQL still passes through read-only SQL validation + bounded execution.
- If generated SQL fails against Postgres, the API attempts one automatic repair pass before fallback.
- If Anthropic config is missing/unavailable, chat falls back to deterministic heuristic SQL generation.
- Chat API writes structured logs to `web/logs/chat_api.log` by default (`OPENF1_WEB_LOG_DIR` overrides this).
