# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-10 (Asia/Shanghai)
**Commit:** 9dde278
**Branch:** main

## OVERVIEW
Next.js 15 App Router app for anime pilgrimage content with strict TypeScript, Prisma, Tailwind, Vitest, and MDX.
Core architecture: route-wrapper + injected domain handlers (`app/api/**/route.ts` → `lib/*/api.ts` → `lib/*/handlers/*.ts`).
15 domain factories, 79 handler files, repository pattern with memory doubles for testing.

## STRUCTURE
```text
seichigo/
|- app/                  # App Router pages + API route wrappers
|- features/             # Complex client-side feature modules (map)
|- components/           # Shared UI, editor/map presentation layer
|- lib/                  # Domain logic, repos, workflows, sanitization (34 modules)
|- content/              # Locale article/data MDX content (zh/en/ja)
|- prisma/               # Schema + migrations source of truth
|- scripts/              # SEO/i18n/Anitabi operational tooling
|- tests/                # Node + JSDOM split test suite
`- AGENTS.md             # Root instructions (this file)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add/modify API endpoint | `app/api/**/route.ts` + `lib/*/handlers/*.ts` | Keep route thin; put logic in handlers |
| Wire dependencies | `lib/*/api.ts` | Use cached `get*ApiDeps()` lazy imports (15 factories) |
| Article moderation flow | `lib/article/handlers/` | Submit/review/approve/reject/unpublish split by file |
| Article revision flow | `lib/articleRevision/handlers/` | Separate domain from article; submit/approve/reject revisions |
| Rich text safety | `lib/richtext/sanitize.ts` | Allowlist tags/attrs/style rules enforced here |
| Link preview safety | `app/api/link-preview/route.ts` | SSRF guard + manual redirect validation |
| Map feature logic | `features/map/` | Mega-hook ctx pattern; 8.9k lines; warmup/selection/complete mode |
| Map presentation layer | `components/map/` | MapLibre layers, clustering, popups |
| Quick pilgrimage mode | `components/quickPilgrimage/` | Mobile walking navigation overlay for map |
| Admin translation batch UI | `app/(authed)/admin/translations/ui.tsx` | High-complexity async UI flow |
| Translation backend queue/batch | `lib/translation/` | Task queue, Gemini integration, backfill handlers |
| SEO spoke generation | `lib/seo/spokeFactory/` | Candidate extract → validate → generate MDX pipeline |
| AI content import | `lib/ai/handlers/` | AI-assisted article creation and import |
| Route books | `lib/routeBook/handlers/` | User-curated pilgrimage route collections |
| Ops/health monitoring | `lib/ops/` | Vercel log parsing, report workflows, cron daily |
| City/area management | `lib/city/` | Area hierarchy, normalization, article-city links |
| Comment system | `lib/comment/` | Repo pattern with markdown rendering |
| Auth/security | `lib/auth/` | NextAuth options, OTP, admin bootstrap, password flows |
| Runtime/test commands | `package.json`, `vitest.config.ts` | See command matrix below |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `get*ApiDeps` | factory pattern | `lib/*/api.ts` (15 files) | high | Domain dependency injection via lazy import + cache |
| `createHandlers` | factory pattern | `lib/*/handlers/*.ts` (79 files) | high | HTTP handler implementation receiving deps |
| `routeError` | function | `app/api/articles/route.ts` | medium | Route-safe error mapping |
| `sanitizeRichTextHtml` | function | `lib/richtext/sanitize.ts` | high | XSS/style sanitization gate |
| `WorkflowResult` | type | `lib/article/workflow.ts` | medium | Tagged union for domain state transitions |
| `prisma` singleton | const | `lib/db/prisma.ts` | high | Shared Prisma client (only access point) |
| `getServerAuthSession` | function | `lib/auth/session.ts` | high | Wraps next-auth `getServerSession` |

## CONVENTIONS (PROJECT-SPECIFIC)
- API routes are wrappers; domain logic belongs in `lib/*/handlers`.
- Every domain follows: `api.ts` (factory) → `handlers/*.ts` (logic) → `repo*.ts` (data).
- Repository pattern with `repoPrisma.ts` + `repoMemory.ts` doubles for testing.
- `build` script runs Prisma migrate + generate before Next build (skips migrate on Vercel).
- `test` script runs line-budget check (800-line max) before Vitest; keep `line-budget.allowlist.json` monotonic.
- Lint script is advisory (`eslint ... || true`); do not treat lint pass as release gate.
- Path aliases are canonical (`@/lib/*`, `@/components/*`, `@/*`).
- Vitest project split is extension-driven: `.test.ts` (node), `.test.tsx` (jsdom).
- Locale detection via middleware (`x-vercel-ip-country`, cookies, path prefix).

## ANTI-PATTERNS (THIS PROJECT)
- Do not put business logic directly in `app/api/**/route.ts`.
- Do not bypass `sanitizeRichTextHtml` for user rich text.
- Do not fetch untrusted URLs without SSRF checks/manual redirects (`link-preview` pattern).
- Do not instantiate ad-hoc Prisma clients; use `@/lib/db/prisma` singleton.
- Do not hardcode locale/admin logic outside centralized middleware/auth config.
- Do not suppress type errors (`as any`, `@ts-ignore`) — only 2 justified instances exist.
- Do not exceed 800-line file limit without adding to `line-budget.allowlist.json`.

## UNIQUE STYLES
- Response errors use explicit status + Chinese user-facing messages in many endpoints.
- Workflows return tagged unions (`WorkflowResult`) over exception control flow.
- Tailwind theme anchors on `colors.brand` (pink scale) and `display`/`body` font pairing.
- `features/map/` uses mega-hook "ctx injection" pattern — single orchestrator passing state to specialized hooks.
- `dangerouslySetInnerHTML` usage is restricted to JSON-LD injection and sanitized article content.

## COMMANDS
```bash
npm run dev
npm run build
npm test
npm test -- tests/smoke.test.ts
npx vitest run --project node
npx vitest run --project jsdom
npm run db:migrate:dev
npm run seo:audit -- --base-url http://localhost:3000 --include-private
npm run typecheck:app
npm run typecheck:tests
```

## HIERARCHY
- `app/api/AGENTS.md` — route wrapper and response conventions.
- `app/(authed)/admin/AGENTS.md` — admin review/translation/ops hotspots.
- `features/map/AGENTS.md` — mega-hook map architecture, data flow, warmup.
- `components/editor/AGENTS.md` — TipTap extension/editing rules.
- `components/map/AGENTS.md` — MapLibre layer, clustering, and performance constraints.
- `lib/article/AGENTS.md` — article domain lifecycle and handler boundaries.
- `lib/articleRevision/AGENTS.md` — revision lifecycle, separate from article domain.
- `lib/anitabi/AGENTS.md` — sync/enrichment pipeline rules.
- `lib/translation/AGENTS.md` — translation queue, batch, and admin orchestration.
- `lib/seo/AGENTS.md` — schema/jsonld + spoke-factory generation boundaries.
- `lib/ops/AGENTS.md` — operational health monitoring and report workflows.
- `lib/city/AGENTS.md` — city/area hierarchy and normalization.
- `lib/comment/AGENTS.md` — comment domain with repo pattern.
- `lib/auth/AGENTS.md` — authentication, authorization, admin bootstrap.
- `lib/routeBook/AGENTS.md` — user pilgrimage route collections.
- `lib/ai/AGENTS.md` — AI content import and generation handlers.
- `tests/AGENTS.md` — test split, setup shims, execution patterns.

## NOTES
- Missing DB env/migrations commonly surface as 503 in API routes.
- `tests/setup.ts` includes TipTap/ProseMirror DOM shims; keep them when refactoring editor tests.
- `app/api` currently mixes strict wrapper style with legacy direct-Prisma routes (mostly admin/translation); keep new endpoints on handler pattern.
- Vercel hobby cron constraints affect Anitabi sync cadence (`README.md`).
- Sentry integration via `withSentryConfig` with dry-run support if tokens are missing.
- `vercel.json` defines daily crons: Anitabi sync (03:10), translation (03:25), ops (00:00).
