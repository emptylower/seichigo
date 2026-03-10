# SEO DOMAIN

## OVERVIEW
`lib/seo` contains metadata/JSON-LD generation, SERP/GSC utilities, and spoke-factory pipelines for scalable SEO content operations. 23 files, 2367 lines, 5 subdirectories.

## STRUCTURE
```text
lib/seo/
|- jsonld.ts / placeJsonLd.tsx / tvSeriesJsonLd.ts / faqJsonLd.ts
|- alternates.ts / site.ts / globalJsonLd.ts
|- serp/               # Rank check + client/quota logic
|- gsc/                # Google Search Console sync client/workflow
|- keywords/           # Keyword seed/inference tooling
`- spokeFactory/       # candidate → validate → generate MDX pipeline
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Generic JSON-LD assembly | `lib/seo/jsonld.ts`, `lib/seo/globalJsonLd.ts` | Keep schema keys stable for existing pages/tests |
| Entity-specific schema | `lib/seo/placeJsonLd.tsx`, `lib/seo/tvSeriesJsonLd.ts`, `lib/seo/faqJsonLd.ts` | Ensure page type alignment |
| Canonical/alternate logic | `lib/seo/alternates.ts`, `lib/seo/site.ts` | Locale URL consistency is critical |
| Ranking/GSC workflows | `lib/seo/serp/*`, `lib/seo/gsc/*` | Respect quotas and retry windows |
| Programmatic content pipeline | `lib/seo/spokeFactory/*` | Extraction + validation + MDX artifact generation |

## CONVENTIONS
- Emit JSON-LD server-side and keep payloads deterministic for testability.
- Keep locale alternate links and canonical paths aligned with middleware locale routing.
- In spoke-factory flow, validate candidates before artifact generation; reject ambiguous/low-signal inputs early.
- Keep SEO clients quota-aware and explicit about partial failures.

## ANTI-PATTERNS
- Do not hardcode locale URLs outside shared `site`/`alternates` helpers.
- Do not inject unsanitized user strings directly into JSON-LD script payloads.
- Do not skip spoke candidate validation prior to writing MDX artifacts.
- Do not collapse SERP/GSC client errors into silent success states.

## NOTES
- GitHub Actions workflow `.github/workflows/seo-spoke-factory.yml` automates spoke generation with post-merge production URL verification.
- Admin SEO UI at `app/(authed)/admin/seo/ui.tsx` (756 lines) is a hotspot.

## COMMANDS
```bash
npm test -- tests/seo
npm test -- tests/seo-spoke-factory.test.ts
npm run seo:audit -- --base-url http://localhost:3000 --include-private
```
