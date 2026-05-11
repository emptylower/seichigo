# Architecture

This document describes the high-level architecture of SeichiGo. For
module-specific rules, read the nearest `AGENTS.md` next to the code.
This page is the bird's-eye view.

## Goals

1. **Code-first, AI-friendly**: every decision — migrations, cron, routes,
   bindings, copy — lives in the repo so it can be reasoned about (and
   modified) end-to-end by both humans and AI agents.
2. **Strict layering**: API routes do transport; domain logic lives in
   handlers; data access lives behind repositories with in-memory doubles.
3. **Performance ceiling for the map**: the map experience is the
   product. We pay measurable cost to keep first-viewport time low.
4. **Safe by default**: user-supplied HTML is sanitized, external fetches
   are SSRF-guarded, Prisma is a singleton, untrusted URLs are never
   passed verbatim into `fetch`.

## High-level component diagram

```text
                        ┌──────────────────────────┐
                        │      seichigo.com        │
                        │   (Cloudflare Workers)   │
                        └────────────┬─────────────┘
                                     │
              ┌──────────────────────┼─────────────────────────┐
              │                      │                         │
        ┌─────▼─────┐         ┌──────▼──────┐           ┌──────▼──────┐
        │  App      │         │  API        │           │  Static     │
        │  Router   │         │  routes     │           │  assets     │
        │ (RSC/SSR) │         │ (thin)      │           │  (R2/CF)    │
        └─────┬─────┘         └──────┬──────┘           └─────────────┘
              │                      │
              │           ┌──────────┴──────────┐
              │           │   lib/<domain>/api  │  cached get*ApiDeps()
              │           └──────────┬──────────┘
              │                      │
              │           ┌──────────▼──────────┐
              │           │ lib/<domain>/       │
              │           │   handlers + repos  │
              │           └──────────┬──────────┘
              │                      │
        ┌─────▼──────┐       ┌───────▼────────┐         ┌──────────────┐
        │  MDX       │       │  Prisma →      │         │  External    │
        │  content   │       │  Postgres      │         │  services    │
        │ (content/) │       │ (Neon/Supabase)│         │  Anitabi /   │
        └────────────┘       └────────────────┘         │  Resend /    │
                                                        │  Gemini /    │
                                                        │  Google Maps │
                                                        │  Embed       │
                                                        └──────────────┘

                ┌──────────────────────────────────────────┐
                │  R2: seichigo-anitabi-images             │
                │  ── durable mirror for map imagery       │
                │  ── cron-driven backfill + breaker       │
                └──────────────────────────────────────────┘
```

## Request layering

Every domain uses the same three layers. Treat this as a hard rule:

```text
app/api/<domain>/route.ts          # transport: parse req, map errors, return NextResponse
  ↓ awaits
lib/<domain>/api.ts                # factory: cached get*ApiDeps()
  ↓ injects
lib/<domain>/handlers/<verb>.ts    # logic: validation, workflow, response shape
  ↓ uses
lib/<domain>/repo*.ts              # data: repoPrisma (prod) + repoMemory (test)
```

- 15 `get*ApiDeps()` factories, 79 handler files in `lib/*/handlers/`.
- Handlers receive deps; they do not import Prisma directly.
- Repositories ship in two flavors: `repoPrisma.ts` for production and
  `repoMemory.ts` for tests. The memory double is the test default.

## Core domains

| Domain | Path | Notes |
|--------|------|-------|
| Article lifecycle | `lib/article/` | `workflow.ts` is a tagged-union state machine; submit / review / approve / reject / unpublish split by file |
| Article revisions | `lib/articleRevision/` | Separate domain from article; submit/approve/reject revisions |
| Translation queue | `lib/translation/` | Gemini-backed, task queue with idempotent status transitions, batch & backfill |
| Anitabi sync | `lib/anitabi/` | Idempotent, restart-safe sync of upstream pilgrimage data; respects Hobby cron limits |
| Map orchestration | `features/map/` | The mega-hook ctx-injection pattern; 8.9k+ lines split into specialized hooks |
| Map presentation | `components/map/` | MapLibre layers, clustering, popups; stable layer/source IDs |
| Rich-text sanitizer | `lib/richtext/sanitize.ts` | Allowlist tags/attrs/styles; **mandatory** for all user HTML |
| Auth | `lib/auth/` | NextAuth options, OTP, admin bootstrap, password change flow |
| Admin moderation | `app/(authed)/admin/` | Article review, translation batch UI, ops dashboard |
| Route books | `lib/routeBook/` | User-curated pilgrimage route collections |
| AI import | `lib/ai/` | AI-assisted article creation and import (admin-gated) |
| SEO / JSON-LD / OG | `lib/seo/` | Spoke factory: candidate extract → validate → generate MDX |
| City / area | `lib/city/` | Area hierarchy, normalization, article-city links |
| Comment system | `lib/comment/` | Repo pattern with markdown rendering |
| Ops monitoring | `lib/ops/` | Vercel log parsing, daily ops cron, report workflows |
| Map image diagnostics | `lib/mapImageDiag/` (incl. `app/api/map-image-diagnostics`) | Server ingest, admin dashboard, prod debugging |

## The map sub-system

The map is the single most complex part of the app. Its overall shape:

```text
features/map/
  ├── useMapCtx          # mega-hook orchestrator; passes ctx to specialized hooks
  ├── warmup lane         # threshold 6 → first-viewport priority
  ├── viewport lane       # natural traversal
  ├── DOM image lane      # cards in popups/sidebar
  ├── scheduler           # shared request scheduler with per-host policy
  ├── circuit breaker     # opens against upstream host (proxy errors are
  │                         attributed to upstream)
  ├── outcome v2          # session-level telemetry (MAP_IMAGE_SESSION_OUTCOME_V2)
  └── diag pipeline       # server ingest → admin dashboard
```

Coupled durable layer:

- **R2 mirror** (`seichigo-anitabi-images` bucket, binding `MAP_IMAGE_CACHE`):
  cron worker backfills upstream Anitabi imagery; production read path is
  enabled once corpus coverage exceeds ~50 %. Admin force-complete is a
  single-tick small-batch action (no internal loop) with a 20 s budget
  and explicit error surfacing. See `docs/runbooks/anitabi-r2-mirror.md`.
- **Cloudflare Images** binding (`IMAGES`): runtime image transforms.
- **Image render vs download lanes** are split; first-view uses smaller
  source variants with retryable UI fallbacks.

## Locale strategy

- Middleware (`middleware.ts`) detects locale via `x-vercel-ip-country`,
  cookies, and path prefix.
- Path prefixes: `/` (Chinese default), `/en/...`, `/ja/...`.
- Content lives at `content/<lang>/posts/*.mdx`. Articles can be
  authored in one locale and machine-translated into others via the
  translation queue.
- JSON-LD and OG generation is centralized in `lib/seo/`; canonical and
  alternate hreflang are handled in one helper.

## Data layer

- Single Prisma client at `@/lib/db/prisma`. No ad-hoc clients.
- `DATABASE_URL` is pooled (use Neon `-pooler.` host).
  `DATABASE_URL_UNPOOLED` is the direct URL used for migrations.
- On Cloudflare Workers we use `@prisma/client/wasm` and the
  `@prisma/adapter-pg` adapter. Cloudflare builds run `copy-prisma-wasm.mjs`
  after the OpenNext build to make the WASM client load correctly.
- Migrations: `prisma/migrations` is the source of truth. Local
  `npm run build` runs `prisma migrate deploy + generate`; Cloudflare /
  Vercel builds only run `generate` (migrations are applied out-of-band).

## Safety boundaries

| Boundary | Mechanism |
|----------|-----------|
| User HTML → DOM | `sanitizeRichTextHtml` (allowlist tags/attrs/styles) |
| Untrusted external URLs → server fetch | Manual redirect validation per hop, host allowlist (see `app/api/link-preview/route.ts`) |
| Admin actions | Server-enforced; never trust client state alone |
| Cron endpoints | Bearer secret (`ANITABI_CRON_SECRET`, `OPS_CRON_SECRET`) |
| Map image proxy | `__mi_*` markers propagate, per-host policy, breaker per upstream host |
| Submission abuse | Per-user and per-IP daily caps, salted IP hash |

## Build, test, and CI

- **Build entry:** `scripts/build-app.mjs` (auto-skips `prisma migrate deploy`
  on Cloudflare CI via `CF_PAGES=1` / `WORKERS_CI=1`).
- **Test split:** `.test.ts` → node project, `.test.tsx` → jsdom.
  Mocks in `tests/setup.ts`; **do not** remove ProseMirror DOM shims.
- **Line budget:** `scripts/check-line-budget.mjs` enforces an 800-line
  cap. The allowlist is monotonically shrinking — adding new entries
  requires explicit justification.
- **Type checking:** split between `tsconfig.app.json` and
  `tsconfig.tests.json`.
- **Lint policy:** advisory (`eslint ... || true`); not a release gate.

## Observability

- Sentry server + edge (`sentry.server.config.ts`, `sentry.edge.config.ts`).
  Cloudflare builds disable the full Sentry runtime by default to avoid
  Workers compatibility issues.
- Cloudflare Workers observability is enabled (`wrangler.jsonc`) with
  100 % head sampling.
- Internal map-image diagnostics ingest into a Prisma table
  (`MapImageDiag`) and surface in an admin dashboard for ad-hoc triage.

## Where to read next

- [`docs/deployment.md`](deployment.md) — full deploy runbook
- [`docs/api.md`](api.md) — endpoint index
- [`docs/roadmap.md`](roadmap.md) — what's next
- [`docs/runbooks/anitabi-r2-mirror.md`](runbooks/anitabi-r2-mirror.md) — R2 mirror operations
- `AGENTS.md` (root) — top-level project knowledge base
- Per-module `AGENTS.md` files — hard-won, code-adjacent rules
