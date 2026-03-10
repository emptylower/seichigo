# TEST SUITE GUIDE

## OVERVIEW
Tests use Vitest project split by extension: `.test.ts` runs in `node`, `.test.tsx` runs in `jsdom`. `npm test` runs line-budget check (800-line max) BEFORE vitest.

## STRUCTURE
```text
tests/
|- setup.ts                        # Global mocks + DOM shims
|- smoke.test.ts                   # Basic smoke tests
|- article/api.test.ts              # 675 lines
|- admin/translation-history.test.ts # 626 lines
|- routeBook/utils.test.ts          # 596 lines
|- comment/api.test.ts              # 593 lines
|- translation/untranslated.test.ts  # 517 lines
|- auth/, anitabi/, map/, editor/, seo/, components/, avatar/
`- ...domain-organized test suites
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Node test behavior | `vitest.config.ts` (`project: node`) | Includes `tests/**/*.test.ts` |
| JSDOM test behavior | `vitest.config.ts` (`project: jsdom`) | Includes `tests/**/*.test.tsx` |
| Global setup | `tests/setup.ts` | Prisma mock + TipTap/ProseMirror DOM shims |
| Domain test pattern | `tests/article/` + `lib/*/repoMemory.ts` | Prefer in-memory repos for business logic |
| Admin integration | `tests/admin/` | 25 test files; translation, review, user management |
| Map tests | `tests/map/` | 20 test files; JSDOM environment for hooks |

## CONVENTIONS
- Choose extension by runtime need (`.ts` node, `.tsx` jsdom).
- Keep unit tests close to existing domain folder conventions under `tests/`.
- Reuse setup mocks/shims; extend centrally if many suites need the same patch.
- Favor deterministic fixtures and avoid network/real DB dependencies.
- `npm test` failure may come from line-budget check, not test logic — check `scripts/check-line-budget.mjs`.
- Memory repo pattern (`repoMemory.ts`) is the preferred strategy for handler tests.

## COMMANDS
```bash
npm test
npm test -- tests/smoke.test.ts
npm test -- -t "auth"
npx vitest run --project node
npx vitest run --project jsdom
```

## ANTI-PATTERNS
- Do not remove `tests/setup.ts` DOM shims required by editor tests.
- Do not run UI suites as `.test.ts` (wrong environment).
- Do not couple tests to live Prisma/database state.
- Do not duplicate large mock scaffolding when `repoMemory` already exists.
