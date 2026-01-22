# City Management + Auto Classification (DB-first) Implementation Plan

## Scope

- DB-first Cities: Cities are canonicalized and managed in DB.
- Auto classification: new/updated articles automatically link to cities; new cities auto-created.
- Author UI: multi-select cities with search + create-new.
- Public city pages: show all real cities and their posts.
- Admin city management: edit cover/names/aliases, merge cities, redirects.
- SEO for posts: keep **single** city output (primary city only).

## Current Baseline (Confirmed)

- City index/detail pages are file-based: `content/city/*.json` read via `lib/city/getAllCities.ts` and `lib/city/getCityById.ts`.
- Posts store city as free-text:
  - DB: `Article.city` / `ArticleRevision.city` / `Submission.city`.
  - MDX: frontmatter `city`.
- City aggregation uses `matchesCity()` equality compare against `[city.id, name_zh, name_en, name_ja]`.
- Admin patterns:
  - Articles use deps+handlers (`lib/*/api.ts`, `lib/*/handlers/*`) and thin `app/api/**/route.ts`.
  - Anime admin uses direct Prisma routes.

## Success Criteria

Functional
- Publishing/approving an article with selected cities makes it appear under those cities immediately.
- If author enters a new city name, system auto-creates a City (`needsReview=true`) and links the article.
- `/city` shows all cities with post counts (not limited to Tokyo/Kyoto JSON files).
- `/city/:slug` shows all posts for that city and continues to work after merges via redirects.
- Admin can set city cover image (via `/api/assets`), edit names, manage aliases, and merge cities.

Observable / Pass-Fail
- Creating an article with city "大阪" results in:
  - a new City exists with an alias "大阪"
  - the article appears on `/city/<new-slug>` and is counted on `/city`
- Merging City A into City B moves all article links and keeps old slug redirect.

## Data Model (Prisma)

### New Tables

1) City
- `id` String @id @default(cuid())
- `slug` String @unique
- `name_zh` String
- `name_en` String?
- `name_ja` String?
- `description_zh` String? @db.Text
- `description_en` String? @db.Text
- `transportTips_zh` String? @db.Text
- `transportTips_en` String? @db.Text
- `cover` String?
- `needsReview` Boolean @default(true)
- `hidden` Boolean @default(false)
- timestamps

2) CityAlias
- `id` String @id @default(cuid())
- `cityId` String
- `alias` String
- `aliasNorm` String (normalized)
- `langCode` String?
- `isPrimary` Boolean @default(false)
- indexes: `@@index([aliasNorm])`
- uniqueness: recommend `@@unique([aliasNorm])` to prevent ambiguous alias mapping.

3) CityRedirect
- `fromSlug` String @id
- `toCityId` String
- relation -> City

### Join Tables (Multi-city)

- `ArticleCity` (articleId, cityId) composite PK
- `ArticleRevisionCity` (revisionId, cityId) composite PK
- `SubmissionCity` (submissionId, cityId) composite PK

### Backward Compatibility

- Keep `Article.city` / `ArticleRevision.city` temporarily for display + SEO fallback.
- Keep `Submission.city` unchanged initially; add join table link.

## Canonicalization Strategy

### Normalize
Create `normalizeCityAlias(input)`:
- trim
- collapse whitespace
- lower-case
- optional: unicode NFKC

Store to `aliasNorm`.

### Resolve / Auto-create
Implement `resolveOrCreateCities(names: string[])`:
- for each input:
  - compute aliasNorm
  - look up CityAlias by aliasNorm
  - if found -> return that city
  - else create City(needsReview=true) + CityAlias(isPrimary=true)

Slug generation
- If input slugifies to ASCII safely, use it if unique.
- Else fallback `city-<shortid>` and mark needsReview=true. Admin can later change slug; changing slug should create redirect.

No fuzzy matching in v1; rely on aliases + merge.

## Public Pages (DB-first)

Update:
- `app/(site)/city/page.tsx`
- `app/(site)/city/[id]/page.tsx`
- `app/en/city/page.tsx`
- `app/en/city/[id]/page.tsx`
- `app/sitemap.ts`

Behavior
- City list from DB `City` where `hidden=false`.
- Post counts from join table + `Article.status='published'`.
- City detail:
  - find City by slug
  - if not found, check `CityRedirect.fromSlug` and 301
  - list DB posts by join

MDX support (optional, later)
- For v1, keep MDX city matching as read-time resolve (do not auto-create from MDX).

## Author UI (Multi-select + Search + Create)

### APIs (authenticated)
- `GET /api/city/search?q=`
  - search by slug/name/alias
  - return top N cities
- `POST /api/city/resolve`
  - body `{ names: string[] }`
  - return canonical cities; create unknown as needsReview

### Composer Changes
- File: `app/(site)/submit/_components/ArticleComposerClient.tsx`
- Replace single `city` input with `CityMultiSelect`:
  - selected list = ordered cities; first is primary
  - choose existing via search API
  - create new via resolve API

### Persisting
- PATCH article/revision endpoints accept `cityIds: string[]`.
- On save:
  - write join table rows (replace semantics)
  - set legacy `Article.city` / `ArticleRevision.city` = primary city display name (`City.name_zh`) for SEO.

## Auto-classification Hooks (Publish/Approve)

Ensure classification is correct and not bypassable:
- `lib/article/handlers/adminApprove.ts`
- `lib/articleRevision/handlers/adminApprove.ts`

On approve:
- if join links already exist, no-op
- else if legacy `city` string exists, resolve -> link

## Admin: City Management

### UI routes
- `/admin/panel/city` list/search
- `/admin/panel/city/[id]` edit

Add entry to `app/(site)/admin/panel/ui.tsx`.

### Admin APIs
- `GET /api/admin/city?q=`
- `GET /api/admin/city/:id`
- `PATCH /api/admin/city/:id`
- `POST /api/admin/city/:id/aliases`
- `DELETE /api/admin/city/:id/aliases/:aliasId`
- `POST /api/admin/city/:id/merge` body `{ targetCityId }`

Cover uploads use existing `POST /api/assets` and store returned `/assets/<id>` URL to `City.cover`.

### Merge semantics (transaction)
- move join rows from fromCityId -> targetCityId (dedupe)
- reassign aliases (skip conflicts by aliasNorm)
- create redirect `fromSlug -> targetCityId`
- mark from city hidden=true

## Migration / Backfill

1) Seed from JSON files
- Read `content/city/*.json`
- Create City with needsReview=false
- Create aliases for:
  - slug/id
  - name_zh, name_en, name_ja

2) Backfill from DB
- Collect distinct `Article.city`, `ArticleRevision.city`, `Submission.city`
- Resolve/create cities
- Create join table links

## Tests

Update existing tests that hardcode single city strings:
- `tests/submit/article-composer.test.tsx` (UI flow now multi-select)
- `tests/public/posts-aggregate.test.ts` (if city listing logic changes)
- `tests/article/revision-repo-contract.test.ts` (if storage expectations change)
- `tests/seo/*` remains mostly unchanged because SEO still uses single city string.

Add new tests:
- resolver: exact alias hit + create new city
- merge: relation moves + redirect

## Execution Order

1) Prisma migration for City + join tables + redirect
2) Seed + backfill scripts
3) Public `/city` pages switch to DB-first
4) City search/resolve APIs
5) Author multi-select UI + persist cityIds
6) Approve hooks ensure join links exist
7) Admin city management + merge
