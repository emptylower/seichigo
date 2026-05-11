# API

SeichiGo's HTTP surface follows a strict layering rule (see
[`architecture.md`](architecture.md)): every endpoint is a thin route
wrapper at `app/api/<domain>/route.ts` delegating to
`lib/<domain>/handlers/*.ts`. This page indexes the public-ish endpoints
by area and notes auth requirements.

> Internal admin endpoints under `/api/admin/*` are intentionally not
> documented here — they evolve quickly and are gated by admin session.
> Read the handlers directly.

## Conventions

- All responses are JSON unless noted.
- Errors return `{ message: <human Chinese string>, ...details }` with
  an explicit HTTP status. Many endpoints return Chinese user-facing
  messages — this is intentional and matches the surrounding style.
- Auth: most write endpoints require a NextAuth session cookie. Cron
  endpoints require `Authorization: Bearer <secret>`.
- Rate limiting: legacy submissions and waitlist endpoints apply
  per-user and per-IP daily caps.

## Public content

| Method · Path | Purpose | Notes |
|---------------|---------|-------|
| `GET /api/articles` | Article list / search | Public; paginated |
| `GET /api/anime` | Anime index | Public |
| `GET /api/comments` | Comment list for a target | Public read |
| `POST /api/comments` | Post a comment | Session required |
| `POST /api/waitlist` | Subscribe to app waitlist | Rate-limited |

## Submissions & authoring

| Method · Path | Purpose | Auth |
|---------------|---------|------|
| `POST /api/submissions` | Legacy submission endpoint (anti-abuse caps) | Session optional |
| `POST /api/revisions/[id]/submit` | Submit a revision for review | Author |
| `POST /api/revisions/[id]/withdraw` | Withdraw an in-review revision | Author |
| `GET /api/revisions/[id]` | Inspect a revision | Author or admin |
| `POST /api/assets` | Upload an asset (image, etc.) | Session |
| `GET /assets/[id]?w=<w>&q=<q>` | Read asset with WebP variant & progressive load | Public |

## Personal / "me"

| Method · Path | Purpose | Auth |
|---------------|---------|------|
| `GET·PATCH /api/me/profile` | Read / update profile | Session |
| `GET·POST /api/me/routebooks` | List / create route books | Session |
| `GET·PATCH·DELETE /api/me/routebooks/[id]` | Read / update / delete | Session, owner |
| `GET /api/me/routebooks/[id]/directions` | Maps directions for a book | Session, owner |
| `GET /api/me/routebooks/[id]/route-geometry` | Route geometry | Session, owner |
| `GET·POST /api/me/point-pool` | User point pool | Session |
| `GET·POST /api/me/point-states` | Per-user point visit state | Session |
| `GET·POST /api/favorites` | Per-user favorites | Session |

## Anitabi / Map data

| Method · Path | Purpose | Auth |
|---------------|---------|------|
| `GET /api/anitabi/bootstrap?locale=zh&tab=latest` | Initial map bootstrap payload | Public; quick liveness check (`cards` non-empty means sync data exists) |
| `GET /api/anitabi/search` | Search across pilgrimage data | Public |
| `GET /api/anitabi/bulk-cards` | Bulk cards fetch | Public |
| `GET /api/anitabi/changelog` | Changelog since timestamp | Public |
| `GET /api/anitabi/preload/manifest` | Preload manifest | Public |
| `GET /api/anitabi/preload/chunks/[index]` | Preload chunks | Public |
| `GET /api/anitabi/chunks/[index]` | Chunked dataset access | Public |
| `GET /api/anitabi/icons.svg` | Sprite | Public |
| `GET /api/anitabi/bangumi/[id]` | Bangumi metadata | Public |
| `GET /api/anitabi/geo/place` | Geo / place lookup | Public |
| `GET /api/anitabi/image-render` | Image render lane | Public, proxy-aware |
| `GET /api/anitabi/image-download` | Image download lane (split from render) | Public |
| `GET·POST /api/anitabi/me/favorites` | Anitabi-scoped favorites | Session |
| `GET·POST /api/anitabi/me/state` | Anitabi user state | Session |
| `GET /api/anitabi/me/history` | Anitabi visit history | Session |

## Link preview (SSRF-guarded)

| Method · Path | Purpose | Auth |
|---------------|---------|------|
| `GET /api/link-preview?url=<url>` | Fetch OpenGraph for a URL with **manual redirect validation per hop** and host allowlist | Public |

This endpoint is the reference implementation for any new untrusted URL
fetching. **Do not** copy `fetch(userInput)` patterns from elsewhere.

## AI

| Method · Path | Purpose | Auth |
|---------------|---------|------|
| `POST /api/ai` | AI-assisted authoring helpers | Session; admin for some routes |

## Diagnostics (admin)

| Method · Path | Purpose | Auth |
|---------------|---------|------|
| `POST /api/map-image-diagnostics` | Server ingest for map-image diag events | Public ingest (validated payload) |
| Admin dashboard pages | Inspection UI | Admin |

## Cron (Bearer secret)

| Method · Path | Schedule | Purpose |
|---------------|----------|---------|
| `GET /api/cron/anitabi/daily` | `10 3 * * *` UTC | Anitabi delta sync |
| `GET /api/cron/anitabi/hourly` | external trigger | Hourly sync (Hobby has no native hourly cron) |
| `GET /api/cron/anitabi/translate` | `25 3 * * *` UTC | Translation queue batch |
| `GET /api/cron/anitabi/enrich` | external trigger | Enrichment pass |
| `GET /api/cron/ops/daily` | `0 0 * * *` UTC | Ops daily report |

Each cron checks `Authorization: Bearer <secret>` against
`ANITABI_CRON_SECRET` / `OPS_CRON_SECRET` as appropriate. One-time
bootstrap after deploy:

```bash
curl -H "Authorization: Bearer $ANITABI_CRON_SECRET" \
  https://seichigo.com/api/cron/anitabi/daily
```

## Auth

NextAuth v4 handles `/api/auth/*` routes. SeichiGo's auth surface is
configured at `lib/auth/`:

- **Email OTP** (recommended): Resend or SMTP
- **Credentials** (admin only): email in `ADMIN_EMAILS` plus password;
  first login forces a change

## Adding a new endpoint

1. Create the handler under `lib/<domain>/handlers/<verb>.ts`.
2. Add it to the domain factory at `lib/<domain>/api.ts` (cached
   `get*ApiDeps()`).
3. Add a thin route wrapper at `app/api/<domain>/<...>/route.ts`:
   - `await get<Domain>ApiDeps()`
   - `createHandlers(deps).METHOD(req)`
   - `NextResponse.json(...)` with explicit status and Chinese error
     copy where neighboring routes already do
4. Write tests under `tests/<domain>/<...>` using the `repoMemory`
   double; do not hit real DB/network in unit tests.
5. If the new endpoint changes a public contract, add an entry to
   [`CHANGELOG.md`](../CHANGELOG.md).
