# Refactor Debt Register

Updated: 2026-03-10

## Large-file hotspots still over 750 lines

- `features/map/anitabi/useAnitabiMapController.ts` (current orchestration hub after main shell extraction)
- `features/map/anitabi/useCompleteMode.ts`
- `features/map/anitabi/shared.ts`
- `app/(authed)/admin/translations/TranslationsPageView.tsx`
- `app/(authed)/submit/_components/ArticleComposerClient.tsx`
- `app/(authed)/admin/seo/ui.tsx`

## Legacy admin/API routes still not converged to handler pattern

- `app/api/admin/city/route.ts`
- `app/api/admin/city/[id]/route.ts`
- `app/api/admin/city/[id]/aliases/route.ts`
- `app/api/admin/city/[id]/aliases/[aliasId]/route.ts`
- `app/api/admin/city/[id]/merge/route.ts`
- `app/api/admin/seo/route.ts`
- `app/api/admin/seo/keywords/route.ts`
- `app/api/admin/seo/keywords/[id]/route.ts`
- `app/api/admin/seo/keywords/bulk/route.ts`
- `app/api/admin/seo/rank/route.ts`
- `app/api/admin/stats/route.ts`
- `app/api/anime/route.ts`

## Next recommended sequence

1. Split `useAnitabiMapController.ts` by `refs`, `ui state`, and `side effects`.
2. Break `TranslationsPageView.tsx` into controller + table/filters/batch-action sections.
3. Move city and SEO admin routes onto `lib/*/handlers` wrappers.
