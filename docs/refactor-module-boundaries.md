# Refactor Module Boundaries

## Branch & Release Rule
- Active refactor branch: `codex/project-refactor`.
- `main` remains frozen for in-progress refactor work.
- Merge back only after typecheck + full tests + line budget gate pass.

## API Layer Boundaries
- `app/api/**/route.ts`
  - Transport only: parse request, invoke handler, map errors.
  - No complex Prisma orchestration.
- `lib/*/api.ts`
  - Dependency factory entry (`get*ApiDeps`).
- `lib/*/handlers/*`
  - Business workflow and domain decisions.

### Current migrated domains
- `lib/admin/*` handles admin dashboard/review/users routes.
- `lib/translation/*` handles admin translation routes.

## Frontend Boundaries
- Container pages (`app/(authed)/**/ui.tsx`)
  - Compose hooks/services + render view components.
- Orchestrators (`use*Orchestrator` or workflow helpers)
  - Long async flow/state-machine logic.
- Presentational components
  - Rendering-only blocks; business actions injected via props.

### Current high-complexity split examples
- Admin translations:
  - `app/(authed)/admin/translations/ui.tsx`
  - `helpers.ts`
  - `mapActions.ts`
  - `oneKeyMapOrchestrator.ts`
  - `TranslationsPageView.tsx`
- Editor:
  - `components/editor/RichTextEditor.tsx`
  - `components/editor/richtext/*`
- Map:
  - Public entry: `components/map/AnitabiMapPageClient.tsx` (thin re-export)
  - Implementation: `features/map/AnitabiMapPageClientImpl.tsx`
  - Shared logic: `features/map/anitabi/shared.ts`, `media.ts`, `geo.ts`

## Typecheck Boundaries
- `tsconfig.app.json`: app/runtime typecheck scope.
- `tsconfig.tests.json`: tests typecheck scope.
- Avoid mixing runtime and test-only globals in one tsconfig pass.

## Maintainability Gates
- Line budget script: `scripts/check-line-budget.mjs`.
- Budget file: `line-budget.allowlist.json`.
- Rule:
  - `app/components/lib` source files must be `<= 800` lines.
  - allowlist must remain empty after refactor completion.

## Safety Contracts (must keep)
- Rich text sanitization must go through `lib/richtext/sanitize.ts`.
- Link preview must keep SSRF guard + redirect validation.
- Prisma usage must go through singleton `lib/db/prisma.ts`.
- External API contract (path/request/response/status semantics) remains stable.
