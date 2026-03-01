# ANITABI PIPELINE

## OVERVIEW
`lib/anitabi` handles external-source ingestion, enrichment, sync diffs, API handlers, and client data shaping for map/content experiences.

## STRUCTURE
```text
lib/anitabi/
|- sync/          # diff + raw store + sync workflow
|- enrichment/    # AniList enrichment workflow
|- handlers/      # API-facing handlers
|- client/        # client fetch/cache helpers
`- api.ts         # dependency wiring for handlers
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Sync behavior | `lib/anitabi/sync/workflow.ts` | Runtime-budgeted ingestion flow |
| Delta logic | `lib/anitabi/sync/diff.ts` | Change detection between source snapshots |
| Enrichment flow | `lib/anitabi/enrichment/workflow.ts` | External metadata augmentation |
| API surface | `lib/anitabi/handlers/` + `api.ts` | Route integration points |
| Client usage | `lib/anitabi/client/` | Query shaping and caching |

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
