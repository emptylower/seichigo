# SeichiGo SEO Optimization Plan

Scope: https://seichigo.com (Next.js App Router + TypeScript)

Last updated: 2026-01-24

Status legend:

- [DONE] Implemented and verified in live audit
- [PARTIAL] Implemented but audit shows issues / needs follow-ups
- [TODO] Not implemented yet
- [BLOCKED] Requires product/DB decision or external dependency

## Live Audit Snapshot (2026-01-23)

Source:

- SquirrelScan v0.0.17: overall score 45 (F), audited 36 pages
- Raw audit output: `/Users/mac/.local/share/opencode/tool-output/tool_beb0aebd1001gUOMEvAHsvCI3r`
- Home HTML snapshot: `/Users/mac/.local/share/opencode/tool-output/tool_beb07f53c001YnxZyj8nkGV5UY`

Key failing findings:

- Structured Data score 0
  - `schema/json-ld-valid`: Invalid JSON-LD (validation failures)
    - `Organization.logo must be a string or array of strings`
    - `Article.publisher.logo is required`
- Meta tags in body
  - `content/meta-in-body`: Found 12 meta tags in `<body>` on 10 pages (notably `/anime/*`, `/en`, `/about`)
- hreflang emitted with camelCase attribute name
  - Home HTML shows `<link rel="alternate" hrefLang="zh|en|x-default" ...>` (tooling may expect lowercase `hreflang`)
- Core Web Vitals / performance hints
  - `perf/ttfb`: many pages > 1000ms
  - `perf/lcp-hints` + `perf/lazy-above-fold`: likely above-fold images are lazy / not preloaded
  - `perf/cls-hints`: many images without explicit dimensions (CLS risk)
- Canonical redirect chain on some posts
  - `crawl/canonical-chain`: canonical URLs redirect (likely due to URL encoding differences)

Local follow-up (not yet reflected in the live audit above):

- Implemented fixes intended to clear the two Structured Data validation items:
  - `Organization.logo` changed to URL string (`lib/seo/globalJsonLd.ts`)
  - `BlogPosting.publisher.logo` added (`lib/seo/jsonld.ts`)
- Local verification (code correctness only): `npm test` + `npm run build` passed
- Next verification after deploy: re-run live audit to confirm `schema/json-ld-valid` no longer reports these items

## Live Audit Snapshot (2026-01-24)

Sources:

- Local script: `npm run seo:audit -- --base-url https://seichigo.com`
  - Observed: multiple 500s on `/anime/*` + some `/posts/*` (canonical/OG/Twitter/JSON-LD missing as a symptom of 500)
- Squirrel v0.0.17: `squirrel audit https://seichigo.com --max-pages 50 --format json --output /tmp/squirrel-seichigo.json`
  - overall score 59 (F), audited 23 pages

Key findings:

- Production 500 is the top blocker
  - 500 pages are not crawlable/indexable, and tool reports cascade into missing metadata/schema.
  - Examples observed in sitemap-orphans:
    - `/anime/btr`, `/anime/hibike`, `/anime/%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97`, `/anime/%E5%A4%A9%E6%B0%94%E4%B9%8B%E5%AD%90`, `/anime/%E8%BD%BB%E9%9F%B3%E5%B0%91%E5%A5%B3`
    - `/posts/你的名字-your-name-tokyo-from-hida-to-suwa` (and related)
- `content/meta-in-body`
  - Not reproduced on sampled 200 pages (e.g. `/en`, `/about`, `/anime`): `<meta>` are present in `<head>`.
  - Remaining reports likely come from either:
    - 500 error documents (different renderer)
    - RSC payload markers (`"$...:metadata"`) being misclassified by some tools
- Structured Data score remains 0
  - `schema/json-ld-valid` still fails on city/resources pages.
  - Hypothesis: BreadcrumbList/ItemList serialization is accepted by browsers but rejected by Squirrel's validator.
    - Implemented mitigation in code: use `item: {"@id": url}` for BreadcrumbList and `https://schema.org/ItemListOrderAscending`.
- TTFB is still high on several pages (1s-3s range)
  - Likely contributors:
    - Auth session checks in server components (forces dynamic)
    - DB query / Prisma cold start
    - Cache misses

## Current Baseline (Already Implemented)

- Global metadata defaults: `app/layout.tsx`
- Sitemap: `app/sitemap.ts` (dynamic; includes zh/en alternates; `lastModified` for posts)
- Robots: `app/robots.ts` (blocks auth/admin/me/submit/api)
- Canonical normalization:
  - Per-page `alternates.canonical` for indexable routes
  - Canonical redirect behavior on dynamic routes (e.g. posts/anime/city) via `permanentRedirect`
- Structured data builders: `lib/seo/jsonld.ts`
  - `BlogPosting`, `BreadcrumbList`, `ItemList` (route spots)
  - City page adds `Place` schema
- OpenGraph images:
  - Site-wide: `app/opengraph-image.tsx`
  - Post-specific: `app/(site)/posts/[slug]/opengraph-image.tsx`

## Gaps / Opportunities

### P0: hreflang in HTML head (not only sitemap)

Sitemap.xml includes `<xhtml:link rel="alternate" hreflang=...>` but public pages should also emit
`<link rel="alternate" hreflang="...">` in the HTML head. In Next.js this is done via
`Metadata.alternates.languages`.

Status: [PARTIAL]

- HTML includes `link[rel=alternate]` on home page, but some pages still fail `content/meta-in-body`.
- Rendered attribute is `hrefLang` (camelCase) rather than `hreflang`.

### P0: Non-semantic city slugs

Some city URLs appear as opaque IDs (e.g. `city-91bf319d`). This hurts CTR, memorability, and topical
relevance signals.

### P1: Site-level schema

Add `WebSite` + `Organization` JSON-LD globally to strengthen entity/brand understanding.

Status: [PARTIAL]

- JSON-LD is present globally, but audit reports `Organization.logo` type validation failure.

### P1/P2: Work-level schema for /anime/[id]

`/anime/[id]` currently uses Breadcrumb JSON-LD. Add a work entity schema (`TVSeries`/`Movie`, or
fallback to `CreativeWork`) with name/aliases/description/image.

Status: [PARTIAL]

- Work schema is present on zh anime detail; verify structured data validation after fixing global schema issues.

### P2: Social share CTR for posts

Post OG images are currently mostly text-based. Improve by using the post cover image (when present)
as a background with an overlay for legibility.

Status: [DONE]

### P2: Strengthen E-E-A-T signals in BlogPosting

Add `author` (and ensure publisher fields are consistent) on post pages.

Status: [PARTIAL]

- `author` is added, but audit reports `Article.publisher.logo is required`.

## Implementation Plan

### Phase A: Shared SEO Utilities

1) Create `lib/seo/alternates.ts`

- Goal: centralized, consistent canonical + hreflang alternates.
- Export helpers:
  - `buildAlternates({ zhPath, enPath? })` for zh pages
  - `buildEnAlternates({ zhPath, enPath? })` for en pages
- Always include `x-default` (typically pointing to the default zh canonical).

Status: [PARTIAL]

- Implemented and used across pages.
- Follow-up: address `hrefLang` casing and `content/meta-in-body` failures in live audit.

2) Create `lib/seo/globalJsonLd.ts`

- Export:
  - `buildWebSiteJsonLd()`
  - `buildOrganizationJsonLd()`
- Use `getSiteOrigin()` from `lib/seo/site.ts`.
- Include a stable logo URL (e.g. `${origin}/brand/app-logo.png`).

Status: [PARTIAL]

- Implemented and injected globally.
- Follow-up: make `Organization.logo` validate (audit requires string/array of strings).

3) Create `lib/seo/animeJsonLd.ts` (or `lib/seo/tvSeriesJsonLd.ts`)

- Build work entity schema from anime metadata:
  - `name`, `alternateName` (aliases)
  - `description`
  - `image` (absolute when possible)
  - `datePublished` / `copyrightYear` if available
  - `url`
- If type is unknown, use `CreativeWork` as safe default.

Status: [PARTIAL]

- Implemented for zh anime detail.
- Follow-up: re-check structured data validation after fixing global schema errors.

### Phase B: Global Injection

4) Update `app/layout.tsx`

- Inject global JSON-LD scripts for WebSite + Organization.
- Keep server-rendered and deterministic.

Status: [PARTIAL]

- Implemented, but structured-data validation still fails site-wide.

### Phase C: Page-level hreflang Coverage (zh)

5) Add `alternates.languages` to public zh pages:

- `app/(site)/page.tsx`
- `app/(site)/about/page.tsx`
- `app/(site)/anime/page.tsx`
- `app/(site)/anime/[id]/page.tsx`
- `app/(site)/city/page.tsx`
- `app/(site)/city/[id]/page.tsx`
- `app/(site)/resources/page.tsx`
- `app/(site)/resources/[id]/page.tsx`
- `app/(site)/posts/[slug]/page.tsx`

Notes:

- Canonical should match the current locale page.
- For pages that currently set `alternates.canonical` as a relative path, keep that pattern but add
  `languages` as absolute URLs.

Status: [PARTIAL]

- Implemented on key zh pages.
- Follow-up: resolve `content/meta-in-body` failures on some routes and normalize hreflang output.

### Phase D: Page-level hreflang Coverage (en)

6) Add `alternates.languages` to public en pages:

- `app/en/page.tsx`
- `app/en/anime/page.tsx`
- `app/en/anime/[id]/page.tsx`
- `app/en/city/page.tsx`
- `app/en/city/[id]/page.tsx`
- `app/en/resources/page.tsx`
- `app/en/resources/[id]/page.tsx`
- `app/en/posts/[slug]/page.tsx` (if present)

Status: [PARTIAL]

- Implemented for en hubs and detail pages.
- Note: `/en/posts/[slug]` is implemented as redirect/noindex and is excluded from sitemap; do not treat it as a real localized content page.

### Phase E: Structured Data Enhancements

7) Anime work schema

- Update `app/(site)/anime/[id]/page.tsx` to inject work entity JSON-LD
- Keep existing BreadcrumbList JSON-LD

Status: [PARTIAL]

- Implemented on zh anime detail pages.
- Follow-up: validate after global schema fixes.

8) Post BlogPosting enhancements

- Update `app/(site)/posts/[slug]/page.tsx`:
  - add `author` field
  - ensure image URLs are absolute where possible
  - verify `inLanguage` matches locale
  - keep existing route `ItemList` schema

Status: [PARTIAL]

- `author` added.
- Follow-up: add `publisher.logo` to BlogPosting JSON-LD and re-validate `Organization.logo`.

### Phase F: OG Image Improvements

9) Improve `app/(site)/posts/[slug]/opengraph-image.tsx`

- If a cover exists:
  - render cover as background
  - apply gradient overlay
  - clamp title/subtitle to avoid overflow
- Fallback to current text-only image.

Status: [DONE]

### Phase G: City Slug Cleanup (DB)

10) City slug strategy (requires DB decision + migration)

Options:

- A) Migrate city slugs to semantic values and keep redirect aliases
- B) Keep internal IDs but expose pretty slugs and redirect consistently

Requirements:

- 301 redirects from old URLs to new canonical URLs
- Sitemap uses the new canonical slugs only
- Canonical tags always point to the new slugs

Status: [BLOCKED]

- Requires product decision + DB migration + redirects.

## Verification Checklist

### Build & Tests

- `npm test`
- `npm run build`

### HTML/SEO Validation (spot-check)

- Fetch HTML and confirm:
  - `link[rel=canonical]` correct
  - `link[rel=alternate][hreflang=zh|en|x-default]` present
  - OpenGraph/Twitter tags present (and absolute where needed)
  - JSON-LD validates in Schema validator

### Automated Audit

- `npm run seo:audit -- --base-url https://seichigo.com`

## Remaining SEO/ICU Work Items (Derived from Audit)

P0 (breaks validation / trust):

- Fix JSON-LD validation failures site-wide
  - Change `Organization.logo` to a string URL (or array of URLs) to satisfy validator.
  - Add `publisher.logo` to BlogPosting JSON-LD (`Article.publisher.logo is required`).
- Resolve `content/meta-in-body` on affected routes (10 pages in audit)
  - Confirm whether Next is streaming metadata into `<body>` and adjust routing/layout/head usage so meta is emitted in `<head>`.
- Normalize hreflang output
  - Home HTML currently emits `hrefLang=...` (camelCase). Ensure output is `hreflang` and is consistently in `<head>`.

P1 (CWV / ICU performance):

- Reduce TTFB (many pages > 1000ms)
  - Identify slow server render paths (DB queries, external fetches), add caching where safe.
- Improve LCP
  - Ensure likely LCP images are not `loading=lazy`; preload or use `fetchpriority="high"` where appropriate.
- Reduce CLS
  - Ensure all images (especially maps/covers) reserve space via explicit width/height or CSS `aspect-ratio`.

P2 (SEO hygiene):

- Fix `crawl/canonical-chain` for posts
  - Ensure canonical URLs do not redirect (likely URL-encoding normalization).

## Priority & Rough Estimate


- P0 validation (JSON-LD + meta-in-head + hreflang normalization): ~2-6h
- P1 CWV/ICU improvements (TTFB/LCP/CLS): ~4-12h depending on root cause
- City slug strategy decision + migration: depends on DB + redirect plan

Total: depends on CWV scope and whether city slug migration proceeds.
