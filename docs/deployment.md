# Deployment

SeichiGo is deployed to **Cloudflare Workers** via OpenNext, with a
Vercel-compatible build path retained for portability. This page is the
operational runbook.

## Targets at a glance

| Target | Status | Build command | Deploy command |
|--------|--------|---------------|----------------|
| Cloudflare Workers (primary) | Production | `npm run cf:build` | `npm run cf:deploy` |
| Vercel (compatible) | Build supported, hobby cron limited | `npm run build` | `vercel deploy` |
| Local Workers preview | — | `npm run cf:build` | `npm run cf:preview` |

The canonical production URL is <https://seichigo.com>.

## Cloudflare Workers (primary)

### Bindings (`wrangler.jsonc`)

```jsonc
{
  "name": "seichigo",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-04-14",
  "compatibility_flags": [
    "nodejs_compat",
    "no_handle_cross_request_promise_resolution"
  ],
  "vars": {
    "MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED": "1",
    "NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED": "1",
    "NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED": "1"
  },
  "r2_buckets": [
    { "binding": "MAP_IMAGE_CACHE", "bucket_name": "seichigo-anitabi-images" }
  ],
  "images": { "binding": "IMAGES" },
  "assets": { "binding": "ASSETS", "directory": ".open-next/assets" },
  "observability": { "enabled": true, "head_sampling_rate": 1 }
}
```

### Build pipeline

```bash
npm run cf:build      # CLOUDFLARE_DEPLOY=1 opennextjs-cloudflare build
                      # → then node scripts/copy-prisma-wasm.mjs
npm run cf:preview    # local preview
npm run cf:deploy     # build + opennextjs-cloudflare deploy
npm run cf:upload     # build + upload (no traffic switch)
npm run cf:typegen    # wrangler types
```

The `copy-prisma-wasm.mjs` post-step is required because Cloudflare
builds use `@prisma/client/wasm` (pinned in `lib/db/prisma`).

### Domain routing

Custom apex/www domains route through Workers (not Pages). A dedicated
apex redirect worker canonicalizes `seichigo.com` → `www.seichigo.com`.
DNS records live in Cloudflare DNS.

### R2 mirror

- Bucket: `seichigo-anitabi-images`, bound as `MAP_IMAGE_CACHE`.
- Read path is gated by `NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED` and is
  on once corpus coverage exceeds ~50 %.
- Write path is driven by a dedicated mirror cron worker
  (separate from the main app worker). Cron is enabled in deploy config.
- Admin **force-complete** is a single-tick small-batch action with a
  20 s budget — it does **not** loop internally. Errors surface to the
  admin UI; force-complete also clears the mirror circuit breaker.
- Mirror scope includes user-uploaded point images (regex path filter),
  not only the system points prefix.

See [`runbooks/anitabi-r2-mirror.md`](runbooks/anitabi-r2-mirror.md) for
admin operations.

### Observability

Cloudflare Workers observability is on with 100 % head sampling. Sentry
is **disabled** for Cloudflare runtime by default to avoid Workers
incompatibilities; for Workers we rely on Cloudflare logs + internal
diagnostics.

## Vercel (compatible path)

`scripts/build-app.mjs` auto-skips `prisma migrate deploy` when
`CF_PAGES=1` or `WORKERS_CI=1`. The standard `npm run build` runs
`prisma migrate deploy + prisma generate + next build`.

Daily crons declared in `vercel.json`:

| Path | Schedule (UTC) | Purpose |
|------|----------------|---------|
| `/api/cron/anitabi/daily` | `10 3 * * *` | Anitabi delta sync |
| `/api/cron/anitabi/translate` | `25 3 * * *` | Translation batch |
| `/api/cron/ops/daily` | `0 0 * * *` | Ops report |

> Vercel Hobby does **not** support hourly crons. Use daily delta plus
> an external scheduler if hourly hits are required.

All cron routes check `Authorization: Bearer <ANITABI_CRON_SECRET>` (or
the relevant per-domain secret).

## Required environment variables

### Site

| Variable | Purpose |
|----------|---------|
| `SITE_URL` | Used for sitemap, OG image absolute URLs |
| `NEXTAUTH_URL` | NextAuth callback base |
| `NEXTAUTH_SECRET` | NextAuth session signing |

### Database

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | **Pooled** Postgres URL (Neon `-pooler.` host) |
| `DATABASE_URL_UNPOOLED` | Direct URL for Prisma migrations |

> Missing DB env or migrations typically surfaces as `503` from API routes.

### Auth & admin

| Variable | Purpose |
|----------|---------|
| `ADMIN_EMAILS` | Comma-separated admin allowlist |
| `ADMIN_DEFAULT_PASSWORD` | Optional, defaults to `112233`; first login forces change |

### Email / OTP

Recommended: Resend.

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | API key |
| `EMAIL_FROM` | Must use a verified domain |
| `EMAIL_OTP_SECRET` | Optional; defaults to `NEXTAUTH_SECRET` |
| `EMAIL_OTP_TTL_MINUTES` | Default 10 |
| `EMAIL_OTP_COOLDOWN_SECONDS` | Default 60 |

SMTP fallback: `EMAIL_SERVER` or `EMAIL_SERVER_HOST/PORT/USER/PASSWORD`.

### Comments (Giscus)

`NEXT_PUBLIC_GISCUS_REPO`, `NEXT_PUBLIC_GISCUS_REPO_ID`,
`NEXT_PUBLIC_GISCUS_CATEGORY`, `NEXT_PUBLIC_GISCUS_CATEGORY_ID`.

### Anitabi sync

| Variable | Recommendation |
|----------|----------------|
| `ANITABI_CRON_SECRET` | Long random secret |
| `ANITABI_SYNC_CONCURRENCY` | `1`–`2` on Neon/Vercel |
| `ANITABI_SYNC_MAX_ROWS_PER_RUN` | `200`–`500` on Hobby |
| `ANITABI_SYNC_MAX_RUNTIME_MS` | `6000`–`9000` on Hobby |
| `ANITABI_API_BASE_URL` / `ANITABI_SITE_BASE_URL` | Optional overrides |

### Submission rate limits

| Variable | Default |
|----------|---------|
| `RATE_LIMIT_USER_PER_DAY` | `3` |
| `RATE_LIMIT_IP_PER_DAY` | `5` |
| `RATE_LIMIT_SALT` | Optional |

### Cloudflare bindings

Defined in `wrangler.jsonc`:

- `MAP_IMAGE_CACHE` → R2 bucket `seichigo-anitabi-images`
- `IMAGES` → Cloudflare Images binding
- `ASSETS` → `.open-next/assets`
- Flags: `MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED`,
  `NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED`,
  `NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED`.

## Pre-deploy guard

Before any production deploy command (`npm run cf:deploy`,
`npm run cf:upload`, `wrangler deploy`, etc.) run the predeploy guard.
It blocks the deploy if anything would deploy code not reachable from
`origin/main`. The repo's governance suite ships this as a skill plus
backing scripts; see the four-skill suite below.

## Post-deploy ledger

After a successful deploy we tag the commit with an annotated
`deploy/<ISO>` tag containing sha, branch, author,
`WORKER_VERSION_ID`, and the last commit subject. Tags are pushed to
`origin` so every prod artifact is permanently traceable to a commit.

## Repo governance — the four-skill suite

Hard-learned from the **2026-05-02 deployed-but-uncommitted incident**
where 5000 lines were running in production without being committed
anywhere:

1. **predeploy-guard** — blocks deploys whose code isn't on origin.
2. **deploy-ledger** — tags every successful deploy at HEAD.
3. **worktree-audit** — scans all git worktrees for uncommitted /
   stale state.
4. **housekeeping** — batches uncommitted work into atomic commits with
   a feature branch + rollback tag + `--no-ff` merge.

These are not optional process. They are how this repo stays sane.

## Local development

```bash
docker run --name seichigo-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=seichigo \
  -p 5432:5432 \
  -v seichigo_pg:/var/lib/postgresql/data \
  -d postgres:16

cp .env.local .env       # Prisma CLI reads .env
npm run db:generate
npm run db:migrate:dev
npm run dev
```

For email/OTP locally, either set `RESEND_API_KEY` or rely on the
console-log fallback (the OTP payload is logged when Resend/SMTP isn't
configured).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| API returns `503` | Missing `DATABASE_URL` or unapplied migrations | Verify env, run `prisma migrate deploy` |
| Workers deploy fails at Prisma load | Missing WASM file | Re-run `npm run cf:build` (the post-step copies WASM) |
| Map images intermittently fail | Upstream Anitabi outage tripped breaker | Inspect the diag dashboard, then admin → mirror force-complete |
| OTP email never arrives | Resend domain not verified | Verify domain in Resend, set `EMAIL_FROM` accordingly |
| Sign-in succeeds but redirect loops to `/auth/set-password` | OTP-created account has no password | Expected — set a password to complete onboarding |
| Cron `403` | Bad / missing `ANITABI_CRON_SECRET` | Re-issue secret, redeploy |

For deep failure modes (1101 hangs, Prisma runtime errors, custom-domain
binding issues, image timeouts) see project memory:
`ai/projects/seichigo/worklogs/` in the project-memory vault.
