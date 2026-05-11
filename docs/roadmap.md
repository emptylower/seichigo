# Roadmap

A living view of where SeichiGo is and where it's going. Items are
labelled **Done**, **In progress**, or **Open**. Open items are fair
game for community PRs — see [`CONTRIBUTING.md`](../CONTRIBUTING.md).

> Dates are intentionally absent. We ship when items are ready and
> performance budgets are kept. CHANGELOG entries land as features ship.

## V1 — content platform (current)

Goal: a sustainable writing and reading platform with 3–5 high-quality
single-work pilgrimage articles, basic interaction, and a credible
foundation for the future app.

### Content & authoring

- **Done** — MDX content system with `<SpotList />` / `<SpotCard />` components
- **Done** — Article authoring center `/submit` (TipTap rich-text, autosave, draft / submit / withdraw)
- **Done** — Admin review pipeline `/admin/review` (approve / reject)
- **Done** — Article revision domain (`lib/articleRevision/`) separate from article lifecycle
- **Done** — Rich-text sanitizer with allowlist (`sanitizeRichTextHtml`)
- **In progress** — In-editor reference embeds (link preview, anime card) hardening
- **Open** — Bulk author tools: scheduled publish, per-article SEO overrides UI

### Map & pilgrimage UX

- **Done** — MapLibre + Supercluster clustering
- **Done** — In-app travel-mode picker via official Maps Embed API (#41)
- **Done** — Map image circuit breaker, retry ladder, outcome v2 telemetry
- **Done** — Shared request scheduler with per-host policy and proxy-attribution breaker
- **Done** — Diagnostics pipeline (server ingest, admin dashboard)
- **Done** — R2 persistent mirror for Anitabi imagery, with mirror cron + admin force-complete
- **Done** — R2 read path enabled at >50 % coverage
- **Done** — Tile preconnect + warmup-first-view lane (threshold 6)
- **In progress** — LQIP / placeholder strategy for first-view points
- **Open** — `createImageBitmap` lane for off-main-thread decode (priority F per ordering decision)

### Localization

- **Done** — Locale routing for `zh` / `en` / `ja`
- **Done** — Translation task queue with Gemini integration and batch backfill
- **Done** — Glossary builder (`npm run glossary:build`)
- **In progress** — JA / EN content depth parity
- **Open** — Locale-specific OG strings and JSON-LD audits

### SEO

- **Done** — Sitemap, robots, dynamic OG, JSON-LD on article / anime pages
- **Done** — Spoke factory (candidate extract → validate → MDX generate)
- **Done** — SEO audit script (`npm run seo:audit`)
- **Done** — SerpAPI-based rank tracker (`npm run seo:rank`)
- **Open** — Public sitemap analytics page

### Auth & accounts

- **Done** — Email OTP + admin credentials login
- **Done** — Password-set flow for OTP-created accounts
- **Done** — Force-change-password on first admin login
- **Open** — Passkey / WebAuthn for admin accounts

### Comments & community

- **Done** — Giscus comments (GitHub Discussions-backed)
- **Open** — In-app reactions on individual points
- **Open** — Author reply notifications

### Ops & governance

- **Done** — Four-skill repo governance suite
  ([predeploy-guard / deploy-ledger / worktree-audit / housekeeping](deployment.md#repo-governance--the-four-skill-suite))
- **Done** — Ops daily cron + report workflow
- **Done** — Public content snapshot + runtime override path
- **Open** — Public status page

## V2 — pilgrimage operations

Once V1 is stable, V2 deepens the *plan and use a route* loop.

- **Open** — Route Book V2: shareable URLs, public route gallery
- **Open** — Offline preflight: download a route bundle (MDX + tiles + low-res images) for travel-day use
- **Open** — Per-point check-in flow (point pool → visited / want-to-visit / done)
- **Open** — Community route submissions in addition to issue-based intake
- **Open** — Author analytics: per-article views, route adoption, comment heat
- **Open** — Editor: collaborative cursor / lock for admin review sessions

## V3 — companion app

The web is the planning surface. The app is the on-the-ground surface.

- **Open** — Native iOS / Android app (RN + Expo target)
- **Open** — "Open this route in app" deep link from web
- **Open** — Live navigation handoff to Google Maps with mid-route resumption
- **Open** — Offline route packs and photo-spot AR alignment hints
- **Open** — Sync of favorites, route books, and visited points between web and app

## Explicitly out of scope (for now)

- Complex web map interactions (filters, multi-layer toggles beyond what already ships)
- Automatic route planning (we trust hand-authored routes)
- Large social features (follow / private message / activity feed)
- Self-hosted multi-tenant CMS

## How to influence the roadmap

- Open a [feature request](../.github/ISSUE_TEMPLATE/feature_request.yml)
  — describe the user problem first.
- Open a [content submission](../.github/ISSUE_TEMPLATE/content_submission.yml)
  for new routes / corrections.
- Send PRs against **Open** items. Ping the maintainer in the PR if you
  want sequencing guidance.
