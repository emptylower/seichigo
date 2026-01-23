# SeichiGo SEO Optimization Plan

Scope: https://seichigo.com (Next.js App Router + TypeScript)

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

### P0: Non-semantic city slugs

Some city URLs appear as opaque IDs (e.g. `city-91bf319d`). This hurts CTR, memorability, and topical
relevance signals.

### P1: Site-level schema

Add `WebSite` + `Organization` JSON-LD globally to strengthen entity/brand understanding.

### P1/P2: Work-level schema for /anime/[id]

`/anime/[id]` currently uses Breadcrumb JSON-LD. Add a work entity schema (`TVSeries`/`Movie`, or
fallback to `CreativeWork`) with name/aliases/description/image.

### P2: Social share CTR for posts

Post OG images are currently mostly text-based. Improve by using the post cover image (when present)
as a background with an overlay for legibility.

### P2: Strengthen E-E-A-T signals in BlogPosting

Add `author` (and ensure publisher fields are consistent) on post pages.

## Implementation Plan

### Phase A  Shared SEO Utilities

1) Create `lib/seo/alternates.ts`

- Goal: centralized, consistent canonical + hreflang alternates.
- Export helpers:
  - `buildAlternates({ zhPath, enPath? })` for zh pages
  - `buildEnAlternates({ zhPath, enPath? })` for en pages
- Always include `x-default` (typically pointing to the default zh canonical).

2) Create `lib/seo/globalJsonLd.ts`

- Export:
  - `buildWebSiteJsonLd()`
  - `buildOrganizationJsonLd()`
- Use `getSiteOrigin()` from `lib/seo/site.ts`.
- Include a stable logo URL (e.g. `${origin}/brand/app-logo.png`).

3) Create `lib/seo/animeJsonLd.ts` (or `lib/seo/tvSeriesJsonLd.ts`)

- Build work entity schema from anime metadata:
  - `name`, `alternateName` (aliases)
  - `description`
  - `image` (absolute when possible)
  - `datePublished` / `copyrightYear` if available
  - `url`
- If type is unknown, use `CreativeWork` as safe default.

### Phase B  Global Injection

4) Update `app/layout.tsx`

- Inject global JSON-LD scripts for WebSite + Organization.
- Keep server-rendered and deterministic.

### Phase C  Page-level hreflang Coverage (zh)

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

### Phase D  Page-level hreflang Coverage (en)

6) Add `alternates.languages` to public en pages:

- `app/en/page.tsx`
- `app/en/anime/page.tsx`
- `app/en/anime/[id]/page.tsx`
- `app/en/city/page.tsx`
- `app/en/city/[id]/page.tsx`
- `app/en/resources/page.tsx`
- `app/en/resources/[id]/page.tsx`
- `app/en/posts/[slug]/page.tsx` (if present)

### Phase E  Structured Data Enhancements

7) Anime work schema

- Update `app/(site)/anime/[id]/page.tsx` to inject work entity JSON-LD
- Keep existing BreadcrumbList JSON-LD

8) Post BlogPosting enhancements

- Update `app/(site)/posts/[slug]/page.tsx`:
  - add `author` field
  - ensure image URLs are absolute where possible
  - verify `inLanguage` matches locale
  - keep existing route `ItemList` schema

### Phase F  OG Image Improvements

9) Improve `app/(site)/posts/[slug]/opengraph-image.tsx`

- If a cover exists:
  - render cover as background
  - apply gradient overlay
  - clamp title/subtitle to avoid overflow
- Fallback to current text-only image.

### Phase G  City Slug Cleanup (DB)

10) City slug strategy (requires DB decision + migration)

Options:

- A) Migrate city slugs to semantic values and keep redirect aliases
- B) Keep internal IDs but expose pretty slugs and redirect consistently

Requirements:

- 301 redirects from old URLs to new canonical URLs
- Sitemap uses the new canonical slugs only
- Canonical tags always point to the new slugs

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

## Priority & Rough Estimate

- P0 hreflang coverage + slug strategy decision: ~36h (slug work depends on DB/migration)
- P1 global schema + anime schema: ~24h
- P2 OG image + author enhancements: ~23h

Total: ~83h depending on the city slug migration complexity.
