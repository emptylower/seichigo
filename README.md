# SeichiGo (MVP)

Code-first Next.js App Router app for anime pilgrimage content, with rich-text authoring, admin moderation, and Anitabi map/sync workflows.

> This README is aligned with root and scoped `AGENTS.md` files (`app/api`, `app/(authed)/admin`, `components/editor`, `components/map`, `lib/article`, `lib/anitabi`, `lib/translation`, `lib/seo`, `tests`).

## Tech Stack

- Next.js 15 (App Router, strict TypeScript)
- Tailwind CSS (`colors.brand` pink scale)
- Prisma + Postgres (Supabase / Vercel Postgres / Neon)
- Auth.js (NextAuth) with Email OTP + password bootstrap
- MDX content layer (`content/zh/posts/*.mdx`)
- TipTap rich-text editor with custom extensions
- Vitest (split Node/JSDOM projects)
- Giscus comments
- SEO tooling (`sitemap`, `robots`, dynamic OG, audit scripts)

## Architecture At A Glance

Core API layering:

```text
app/api/**/route.ts
  -> lib/*/api.ts (get*ApiDeps)
    -> lib/*/handlers/*.ts (business logic)
```

Design intent:

- `route.ts` handles transport concerns only (request/response/error mapping/logging).
- Domain workflows live in handlers and reusable services.
- Dependencies are injected via cached `get*ApiDeps()` factories.

## Repository Structure

```text
seichigo/
|- app/                  # App Router pages + API wrappers
|- components/           # Shared UI (editor/map heavy clients)
|- lib/                  # Domain logic, repos, workflows, sanitization
|- content/              # Locale content data (MDX)
|- prisma/               # Schema and migrations source of truth
|- scripts/              # SEO/i18n/Anitabi tooling
|- tests/                # Vitest suites (node + jsdom)
`- AGENTS.md             # Project knowledge base for contributors
```

## Module Playbook (From AGENTS)

### `app/api` (Route Wrappers)

Use for thin transport wrappers only.

- Resolve deps via `await get*ApiDeps()`.
- Delegate behavior to `createHandlers(deps).METHOD(req)`.
- Return explicit `NextResponse.json(..., { status })` with user-safe Chinese messages.
- Keep contextual logs like `[api/<domain>] <METHOD> failed`.
- For untrusted URL fetches, follow SSRF-safe pattern in `app/api/link-preview/route.ts` (manual redirect validation for each hop).

Avoid:

- Putting business workflow logic directly in `route.ts`.
- Direct Prisma access in route wrappers.
- Raw `fetch(userInput)` without SSRF protections.

### `app/(authed)/admin` (Privileged UI)

High-risk surfaces include moderation and translation batch flows.

- Keep authorization server-enforced (never trust client state alone).
- Preserve localized Chinese operator copy in existing screens.
- For long-running operations, always expose progress and partial-failure states.
- Make surgical edits in `app/(authed)/admin/translations/ui.tsx` (complex async state machine hotspot).

Avoid:

- Adding heavy business logic into layout-level components.
- Introducing silent failure modes in moderation/batch actions.

### `components/editor` (TipTap)

- Keep generated HTML compatible with `sanitizeRichTextHtml` allowlists.
- When extension HTML changes, update sanitizer and tests together.
- Keep extension `data-*` attributes stable unless coordinated sanitizer updates are included.

Avoid:

- Adding new tags/attrs/styles without sanitizer alignment.
- Removing ProseMirror/TipTap DOM shims from `tests/setup.ts`.

### `components/map` (MapLibre UI)

- Keep layer/source IDs and ordering stable across hooks and layer components.
- Keep heavy feature transforms in map utils, not render paths.
- Preserve map feature property contracts used by popups/cards.

### `lib/translation` (Task Queue + Batch Execution)

- Keep task lifecycle idempotent with explicit status/error transitions.
- Route wrappers stay thin; Gemini and TipTap transforms stay in translation services.
- Batch/backfill flows should remain bounded and progress-aware.

### `lib/seo` (JSON-LD + Spoke Factory)

- Keep JSON-LD generation deterministic and server-rendered.
- Keep locale canonical/alternate behavior centralized in SEO helpers.
- Preserve spoke-factory pipeline order: candidate extraction -> validation -> MDX generation.

### `lib/article` (Article Lifecycle)

- `lib/article/api.ts`: dependency wiring via `getArticleApiDeps`.
- `lib/article/handlers/*.ts`: request orchestration, validation, response shape.
- `lib/article/workflow.ts`: lifecycle state machine + `WorkflowResult` typed outcomes.
- `lib/article/repo*.ts`: repository interfaces/implementations.

Avoid:

- Prisma instantiation inside handlers.
- Collapsing author/admin flows into oversized handlers.
- Throwing opaque errors where typed workflow outcomes are expected.

### `lib/anitabi` (Sync + Enrichment Pipeline)

- Keep sync/enrichment idempotent and restart-safe.
- Respect Vercel Hobby runtime constraints.
- Isolate source fetch/normalization/persistence concerns.
- Keep output contracts stable for map/admin consumers.

Avoid:

- High default concurrency that exceeds hobby limits.
- Coupling client helper output to internal raw-store schema details.
- Bypassing cron secret checks and handler auth flow.

### `tests` (Vitest Split)

- `.test.ts` -> Node project.
- `.test.tsx` -> JSDOM project.
- Reuse `tests/setup.ts` for global mocks and DOM shims.
- Prefer deterministic tests with in-memory repos (`repoMemory`) over live DB/network dependencies.

## Global Conventions

- API/domain boundary: wrappers in `app/api`, business logic in `lib/*/handlers`.
- Prisma access: always use shared singleton `@/lib/db/prisma`.
- Rich text safety: user HTML must pass `sanitizeRichTextHtml`.
- Error style: explicit HTTP status + Chinese user-facing strings in many endpoints.
- Alias usage: `@/lib/*`, `@/components/*`, `@/*`.
- Build behavior:
  - Local/default `npm run build` runs Prisma migrate + generate before Next build.
  - Vercel build skips `prisma migrate deploy` and only runs `prisma generate + next build`.
- Lint policy: lint is advisory (`eslint ... || true`), not a release gate.

## Getting Started

### 1) Environment Variables

Copy `.env.example` to `.env.local` and fill:

- `SITE_URL`
- `DATABASE_URL` (Postgres connection string)
- `DATABASE_URL_UNPOOLED` (optional but recommended for Prisma migrations)
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
- Email provider:
  - `RESEND_API_KEY` (recommended), or
  - SMTP (`EMAIL_SERVER` / host+port+user+pass)
- Giscus public envs
- `ADMIN_EMAILS` (admin allowlist)

Prisma CLI reads `.env` by default. For local dev:

```bash
cp .env.local .env
```

### 2) Install and Run

```bash
npm install
npm run dev
```

### 3) Prisma (Local)

```bash
npm run db:generate
npm run db:migrate:dev
```

## Local Postgres (Docker)

```bash
docker run --name seichigo-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=seichigo \
  -p 5432:5432 \
  -v seichigo_pg:/var/lib/postgresql/data \
  -d postgres:16
```

Set:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/seichigo?schema=public
```

## Command Matrix

### Runtime

```bash
npm run dev
npm run build
```

### Tests

```bash
npm test
npm test -- tests/smoke.test.ts
npx vitest run --project node
npx vitest run --project jsdom
```

### Targeted Checks

```bash
npm test -- tests/article
npm test -- tests/link-preview
npm test -- tests/translation
npm test -- tests/admin
npm test -- -t "auth"
```

### SEO Audit

```bash
npm run seo:audit -- --base-url https://seichigo.com
npm run seo:audit -- --base-url http://localhost:3000 --include-private
```

## Content

- Chinese articles live at `content/zh/posts/*.mdx`.
- Template and components: `content/zh/posts/README.md`.
- Author center: `/submit` (drafts, rich-text editor, submit/withdraw).
- Admin review: `/admin/review` (approve/reject `in_review` articles).

## Anitabi Sync on Vercel

Required env vars:

- `DATABASE_URL` / `DATABASE_URL_UNPOOLED`
  - Use Neon pooled URL for `DATABASE_URL` (`-pooler.` host).
  - Use direct URL for `DATABASE_URL_UNPOOLED` (migrations).
- `ANITABI_CRON_SECRET` (long random secret)
- `ANITABI_SYNC_CONCURRENCY` (recommend `1-2` on Neon/Vercel)
- Optional `ANITABI_SYNC_MAX_ROWS_PER_RUN` (recommend `200-500` on Hobby)
- Optional `ANITABI_SYNC_MAX_RUNTIME_MS` (recommend `6000-9000` on Hobby)
- Optional `ANITABI_API_BASE_URL`, `ANITABI_SITE_BASE_URL`

Scheduled in repo:

- Daily delta: `/api/cron/anitabi/daily` at `10 3 * * *` (UTC)

Vercel Hobby note:

- Native hourly crons are not supported.
- Use daily delta + external scheduler/manual trigger for hourly endpoint if needed.

One-time bootstrap after deploy:

```bash
curl -H "Authorization: Bearer $ANITABI_CRON_SECRET" \
  https://<your-domain>/api/cron/anitabi/daily
```

Quick check:

- Open `https://<your-domain>/api/anitabi/bootstrap?locale=zh&tab=latest`.
- If `cards` is non-empty, sync data exists.

## Admin Login

- Visit `/auth/signin` with an email in `ADMIN_EMAILS`.
- Default password: `112233` (override via `ADMIN_DEFAULT_PASSWORD`).
- First successful login forces password change at `/auth/change-password`.
- Manual reset: set admin `passwordHash = NULL` and `mustChangePassword = true`, then sign in again with default password.

## Operational Notes

- Missing DB env/migrations often surface as API `503`.
- In dev, if Resend/SMTP is missing, OTP email payload is logged to server console.
- Accounts created by OTP without a password are redirected to `/auth/set-password` on first login.
- `tests/setup.ts` contains TipTap/ProseMirror DOM shims; keep when refactoring editor tests.
- `/assets/:id` supports `?w=<width>&q=<quality>` WebP variants and progressive loading.
- Legacy `/api/submissions` has basic anti-abuse per-user/IP/day (env tunable).
