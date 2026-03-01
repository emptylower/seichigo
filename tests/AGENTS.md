# TEST SUITE GUIDE

## OVERVIEW
Tests use Vitest project split by extension: `.test.ts` runs in `node`, `.test.tsx` runs in `jsdom`.

## STRUCTURE
```text
tests/
|- setup.ts                 # global mocks + DOM shims
|- smoke.test.ts
|- article/, auth/, ...     # domain/API tests
`- components/, editor/, ...# UI tests
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Node test behavior | `vitest.config.ts` (`project: node`) | Includes `tests/**/*.test.ts` |
| JSDOM test behavior | `vitest.config.ts` (`project: jsdom`) | Includes `tests/**/*.test.tsx` |
| Global setup | `tests/setup.ts` | Prisma mock + TipTap/ProseMirror DOM shims |
| Domain test pattern | `tests/article/` + `lib/*/repoMemory.ts` | Prefer in-memory repos for business logic |

## CONVENTIONS
- Choose extension by runtime need (`.ts` node, `.tsx` jsdom).
- Keep unit tests close to existing domain folder conventions under `tests/`.
- Reuse setup mocks/shims; extend centrally if many suites need the same patch.
- Favor deterministic fixtures and avoid network/real DB dependencies.

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
