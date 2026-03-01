# API ROUTE WRAPPERS

## OVERVIEW
`app/api` owns transport concerns only; business logic belongs in `lib/*/handlers` with deps from `lib/*/api.ts`.

## STRUCTURE
```text
app/api/
|- articles/route.ts
|- link-preview/route.ts
|- admin/*/route.ts
`- ...domain endpoints...
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add endpoint | `app/api/<domain>/route.ts` | Keep wrapper thin |
| Reuse pattern | `app/api/articles/route.ts` | Canonical `get*ApiDeps` + `createHandlers` flow |
| Error mapping | `app/api/articles/route.ts` | `routeError(err)` maps DB/env to safe 503/500 |
| SSRF-safe fetch | `app/api/link-preview/route.ts` | Validate each hop; manual redirects |

## CONVENTIONS
- Resolve deps once per request via `await get*ApiDeps()`.
- Delegate logic to `createHandlers(deps).METHOD(req)`.
- Return `NextResponse.json` with explicit status + user-safe error strings.
- Keep contextual logs (`[api/<domain>] <METHOD> failed`).

## ANTI-PATTERNS
- Do not embed domain workflows in `route.ts`.
- Do not access Prisma directly in route wrappers.
- Do not `fetch(userInput)` without SSRF guard + redirect re-validation.
- Do not swallow unknown exceptions; map and return stable API errors.

## COMMANDS
```bash
npm test -- tests/article
npm test -- tests/link-preview
npx vitest run --project node
```
