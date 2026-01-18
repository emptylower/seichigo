# AGENTS.md (seichigo)

This file is for agentic coding tools operating in this repo.

## Repo Overview
- Stack: Next.js (App Router) + TypeScript (strict) + Tailwind CSS + Prisma + Vitest.
- Architecture: UI in `app/` + `components/`; domain logic in `lib/`; API routes are thin wrappers around `lib/*/handlers` with dependency injection via `get*ApiDeps()`.

## Install / Setup
- Install deps: `npm install` (local dev) or `npm ci` (CI/repro; requires `package-lock.json`).
- Env: copy `.env.example` to `.env.local` and fill required values.
  - Prisma CLI reads `.env` by default; for local dev you can `cp .env.local .env`.

## Commands (Canonical)
From `package.json`:
- Dev server: `npm run dev` (Next dev)
- Build: `npm run build` (runs `prisma generate && next build`)
- Start (prod): `npm run start` (Next start)
- Lint: `npm run lint` (runs `eslint . --ext .ts,.tsx || true`)
  - Note: `|| true` means lint failures do NOT fail CI; treat output as advisory unless you change the script.
  - Also note: an ESLint config file is not present in repo root, and `eslint` is not listed in `devDependencies`.
- Tests (CI run): `npm test` (runs `vitest run`)
- Tests (watch): `npm run test:watch` (runs `vitest`)
- SEO audit: `npm run seo:audit` (script in `scripts/seo-audit.js`)

## Running A Single Test (Vitest)
Vitest config: `vitest.config.ts`.

Common patterns:
- Single file:
  - `npx vitest run tests/smoke.test.ts`
  - `npm test -- tests/smoke.test.ts`
- Single test by name:
  - `npx vitest run -t "auth"`
  - `npm test -- -t "auth"`
- Filter by project (environment):
  - `npx vitest run --project node` (typically `tests/**/*.test.ts`)
  - `npx vitest run --project jsdom` (typically `tests/**/*.test.tsx`)

Test setup:
- `tests/setup.ts` (Testing Library + jsdom shims for TipTap/ProseMirror)

## Database / Prisma
Scripts in `package.json`:
- Generate Prisma client: `npm run db:generate`
- Migrate (prod/deploy): `npm run db:migrate` (`prisma migrate deploy`)
- Migrate (local dev): `npm run db:migrate:dev` (`prisma migrate dev`)

Key files:
- Prisma schema: `prisma/schema.prisma`
- Prisma client singleton: `lib/db/prisma.ts`

Operational notes:
- Many API routes assume `DATABASE_URL` is set; missing DB config often returns 503.
- Build runs `prisma generate`, so a valid Prisma schema and installed deps are required even if DB is not reachable.

## Project Structure (How To Navigate)
- Routes/pages: `app/(site)/**/page.tsx`
- API routes: `app/api/**/route.ts`
- Shared UI: `components/**`
- Domain logic:
  - `lib/article/**`, `lib/articleRevision/**`, `lib/favorite/**`, `lib/asset/**`, `lib/auth/**`, `lib/posts/**`, `lib/mdx/**`, `lib/seo/**`
- Content (MDX): `content/zh/posts/*.mdx` (see `content/zh/posts/README.md`)

## API + Domain Pattern (Important)
Follow existing patterns instead of embedding logic in `route.ts`:
- Dependency wiring: `lib/*/api.ts` exports `get*ApiDeps()` (cached) which lazily imports Prisma repos + auth + sanitizers.
  - Example: `lib/article/api.ts`
- Handlers: `lib/*/handlers/*.ts` exports `createHandlers(deps)` returning `{ GET, POST, PATCH, DELETE }` functions.
- API routes: `app/api/**/route.ts` should be thin wrappers that:
  1) get deps via `get*ApiDeps()`
  2) call `createHandlers(deps).METHOD(...)`
  3) map unexpected errors to safe JSON responses (often with a local `routeError(err)`)

## Code Style (Observed In Repo)
These are inferred from existing files (no formatter config found).

Formatting:
- Semicolons: generally omitted.
- Quotes: single quotes in TS/JS.
- Indentation: 2 spaces.

TypeScript:
- `tsconfig.json` has `strict: true` and `noEmit: true`.
- Prefer `import type { ... }` for type-only imports.
- Avoid type suppression (`as any`, `@ts-ignore`, `@ts-expect-error`).
  - Exception: targeted test shims/mocks (e.g., `tests/setup.ts`) may use `as any` to patch jsdom gaps.

Imports:
- Prefer path aliases over deep relatives:
  - `@/components/*`, `@/lib/*`, `@/content/*`, `@/styles/*` (from `tsconfig.json`).
- Local sibling imports (`./Foo`) are common inside a directory.

Naming:
- React components: PascalCase, typically default-exported from `*.tsx`.
- Types/interfaces: PascalCase.
- Functions/vars: camelCase.
- API route files are always `route.ts`.

## Error Handling / Responses
- API routes generally return `NextResponse.json({ error: string }, { status })`.
- Prefer explicit status codes:
  - `400` for validation, `401` unauthenticated, `403` forbidden, `404` not found, `429` rate-limited.
  - `502/504` for upstream fetch errors/timeouts.
  - `503` for DB not configured / schema not migrated (see `app/api/articles/route.ts`).
- Keep server error logs contextual:
  - e.g. `console.error('[api/articles] GET failed', err)`
- Domain workflows often return tagged unions instead of throwing:
  - Example: `lib/article/workflow.ts` returns `WorkflowResult<T>`.

## Security / Sanitization
- Rich text HTML is sanitized server-side; do not bypass sanitization for user-generated content.
  - Sanitizer: `lib/richtext/sanitize.ts` (strict allowlist for tags/attrs; link scheme checks; image source restrictions).
- Link preview endpoint performs basic SSRF protections; keep it strict.
  - `app/api/link-preview/route.ts`

## Testing Conventions
- Tests live under `tests/` and cover both domain logic and UI components.
- Prefer unit tests against `lib/**` handlers/workflows with in-memory repos when feasible.
  - Example patterns: `InMemory*Repo` in `lib/**/repoMemory.ts`.
- When adding new features/bugfixes, add/extend tests near existing coverage.

## Frontend Conventions
- Tailwind is the default styling approach.
- Brand color tokens exist:
  - `tailwind.config.ts` defines `colors.brand` (pink theme).
- Fonts:
  - `tailwind.config.ts` defines `fontFamily.display` and `fontFamily.body`.

## Browser Automation
Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:
1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
