# API ROUTE WRAPPERS

## OVERVIEW
`app/api` owns transport concerns only; business logic belongs in `lib/*/handlers` with deps from `lib/*/api.ts`.

## STRUCTURE
```text
app/api/
|- articles/route.ts          # Canonical wrapper pattern
|- anitabi/*/route.ts          # Map data, sync, bootstrap (19 handlers)
|- admin/*/route.ts            # Admin-only with isAdmin checks
|- admin/translations/*/       # Translation management
|- ai/*/route.ts               # AI content import
|- cron/*/route.ts             # Scheduled jobs (anitabi, translation, ops)
|- routebooks/*/route.ts       # User route collections
|- link-preview/route.ts       # SSRF-safe external fetch
`- ...100+ route.ts wrappers delegating to 15 domain factories
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add endpoint | `app/api/<domain>/route.ts` | Keep wrapper thin |
| Reuse pattern | `app/api/articles/route.ts` | Canonical `get*ApiDeps` + `createHandlers` flow |
| Error mapping | `app/api/articles/route.ts` | `routeError(err)` maps DB/env to safe 503/500 |
| SSRF-safe fetch | `app/api/link-preview/route.ts` | Validate each hop; manual redirects |
| Admin endpoints | `app/api/admin/*/route.ts` | Require `session.user.isAdmin` server-side |
| Cron endpoints | `app/api/cron/*/route.ts` | Validate cron secret via Authorization header |
| Anitabi data | `app/api/anitabi/*/route.ts` | Bootstrap, bangumi, search, chunks, sync |

## CONVENTIONS
- Resolve deps once per request via `await get*ApiDeps()`.
- Delegate logic to `createHandlers(deps).METHOD(req)`.
- Return `NextResponse.json` with explicit status + user-safe error strings.
- Keep contextual logs (`[api/<domain>] <METHOD> failed`).
- Cron endpoints validate `CRON_SECRET` or `ANITABI_CRON_SECRET` via Authorization header.

## ANTI-PATTERNS
- Do not embed domain workflows in `route.ts`.
- Do not access Prisma directly in route wrappers.
- Do not `fetch(userInput)` without SSRF guard + redirect re-validation.
- Do not swallow unknown exceptions; map and return stable API errors.
- Do not skip cron secret validation on scheduled endpoints.

## COMMANDS
```bash
npm test -- tests/article
npm test -- tests/link-preview
npx vitest run --project node
```
