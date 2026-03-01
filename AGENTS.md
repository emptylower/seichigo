# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-28 (Asia/Shanghai)
**Commit:** 9fc74cc
**Branch:** main

## OVERVIEW
Next.js 15 App Router app with strict TypeScript, Prisma, Tailwind, Vitest, and MDX content.
Core architecture is route-wrapper + injected domain handlers (`app/api/**/route.ts` -> `lib/*/api.ts` -> `lib/*/handlers/*.ts`).

## STRUCTURE
```text
seichigo/
|- app/                  # App Router pages + API route wrappers
|- components/           # Shared UI, editor/map heavy clients
|- lib/                  # Domain logic, repos, workflows, sanitization
|- content/              # Locale article/data content
|- prisma/               # Schema + migrations source of truth
|- scripts/              # SEO/i18n/Anitabi operational tooling
|- tests/                # Node + JSDOM split test suite
`- AGENTS.md             # Root instructions (this file)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add/modify API endpoint | `app/api/**/route.ts` + `lib/*/handlers/*.ts` | Keep route thin; put logic in handlers |
| Wire dependencies | `lib/*/api.ts` | Use cached `get*ApiDeps()` lazy imports |
| Article moderation flow | `lib/article/handlers/` | Submit/review/approve/reject/unpublish split by file |
| Rich text safety | `lib/richtext/sanitize.ts` | Allowlist tags/attrs/style rules enforced here |
| Link preview safety | `app/api/link-preview/route.ts` | SSRF guard + manual redirect validation |
| Complex map behavior | `components/map/AnitabiMapPageClient.tsx` | Large stateful hotspot |
| Admin translation batch UI | `app/(authed)/admin/translations/ui.tsx` | High-complexity async UI flow |
| Runtime/test commands | `package.json`, `vitest.config.ts` | See command matrix below |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `getArticleApiDeps` | function | `lib/article/api.ts` | high | Domain dependency factory |
| `createHandlers` | function | `lib/article/handlers/articles.ts` | high | HTTP handler implementation |
| `routeError` | function | `app/api/articles/route.ts` | medium | Route-safe error mapping |
| `sanitizeRichTextHtml` | function | `lib/richtext/sanitize.ts` | high | XSS/style sanitization gate |
| `prisma` singleton | const | `lib/db/prisma.ts` | high | Shared Prisma client |

## CONVENTIONS (PROJECT-SPECIFIC)
- API routes are wrappers; domain logic belongs in `lib/*/handlers`.
- `build` script runs Prisma migrate + generate before Next build.
- Lint script is advisory (`eslint ... || true`); do not treat lint pass as release gate.
- Path aliases are canonical (`@/lib/*`, `@/components/*`, `@/*`).
- Vitest project split is extension-driven: `.test.ts` (node), `.test.tsx` (jsdom).

## ANTI-PATTERNS (THIS PROJECT)
- Do not put business logic directly in `app/api/**/route.ts`.
- Do not bypass `sanitizeRichTextHtml` for user rich text.
- Do not fetch untrusted URLs without SSRF checks/manual redirects (`link-preview` pattern).
- Do not instantiate ad-hoc Prisma clients; use `@/lib/db/prisma` singleton.
- Do not hardcode locale/admin logic outside centralized middleware/auth config.

## UNIQUE STYLES
- Response errors use explicit status + Chinese user-facing messages in many endpoints.
- Workflows often return tagged unions (`WorkflowResult`) over exception control flow.
- Tailwind theme anchors on `colors.brand` (pink scale) and display/body font pairing.

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
```

## HIERARCHY
- `app/api/AGENTS.md` - route wrapper and response conventions.
- `app/(authed)/admin/AGENTS.md` - admin review/translation hotspots.
- `components/editor/AGENTS.md` - TipTap extension/editing rules.
- `lib/article/AGENTS.md` - article domain lifecycle and handler boundaries.
- `lib/anitabi/AGENTS.md` - sync/enrichment pipeline rules.
- `tests/AGENTS.md` - test split, setup shims, execution patterns.

## NOTES
- Missing DB env/migrations commonly surface as 503 in API routes.
- `tests/setup.ts` includes TipTap/ProseMirror DOM shims; keep them when refactoring editor tests.
- Vercel hobby cron constraints affect Anitabi sync cadence (`README.md`).
