# ANITABI PIPELINE

## OVERVIEW
`lib/anitabi` handles external-source ingestion, enrichment, sync diffs, API handlers, and client data shaping. Largest lib domain by file count (48 files, 5362 lines, 19 handlers).

## STRUCTURE
```text
lib/anitabi/
|- sync/          # diff + raw store + sync workflow
|- enrichment/    # AniList enrichment workflow
|- handlers/      # 19 API handlers (bootstrap, bangumi, search, chunks,
|                 #   preload*, meState/History/Favorites, geoPlace, icons,
|                 #   imageDownload, changelog, adminSync/Diff/Progress/SyncRuns, cron)
|- client/        # client fetch/cache helpers
`- api.ts         # dependency wiring for handlers
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Sync behavior | `lib/anitabi/sync/workflow.ts` | Runtime-budgeted ingestion flow |
| Delta logic | `lib/anitabi/sync/diff.ts` | Change detection between source snapshots |
| Enrichment flow | `lib/anitabi/enrichment/workflow.ts` | External metadata augmentation |
| API handlers | `handlers/` + `api.ts` | 19 handlers covering user, admin, and cron flows |
| Image proxy | `handlers/imageDownload.ts` | Complex proxy logic (212+ lines of setup before export) |
| Admin sync | `handlers/adminSync.ts`, `adminProgress.ts` | Sync control and progress tracking |
| Cron entry | `handlers/cron.ts` | Accepts delta/full mode parameter |
| Client usage | `client/` | Query shaping and caching for frontend |

## CONVENTIONS
- Keep sync/enrichment steps idempotent and restart-safe.
- Respect Vercel/cron runtime constraints when adding expensive stages.
- Isolate source-format parsing to dedicated source/sync modules.
- Maintain stable output contracts consumed by map/admin UI.

## ANTI-PATTERNS
- Do not hardcode high concurrency defaults that exceed hobby runtime limits.
- Do not mix source fetch, normalization, and persistence in one function.
- Do not couple client helper output to internal raw-store schema details.
- Do not bypass existing cron-secret and handler authorization flow.

## NOTES
- Validate with cron/bootstrap endpoints after sync changes.
- Check README runtime guidance for `ANITABI_SYNC_*` env tuning.
- `imageDownload.ts` is a complex proxy; has 212 lines of setup before the `createHandlers` export.
