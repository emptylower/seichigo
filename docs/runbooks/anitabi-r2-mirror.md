# Anitabi R2 Mirror Runbook

## §8 Deploy & Rollback Playbook

### Flag matrix

| `R2_READ` | `R2_WRITE` | `MIRROR_CRON` | Behavior | When |
|---|---|---|---|---|
| 0 | 0 | 0 | identical to pre-PR3 | day 0 — code shipped, dormant |
| 0 | 1 | 0 | lazy writes only, not read | rare; verify write path doesn't error |
| 0 | 1 | 1 | bootstrap + cron seed running, read path unchanged | **default observation window (day 0–7)** |
| 1 | 1 | 1 | full PR3 activated | once mirrored ≥ 95% |
| 1 | 1 | 0 | R2 read-only, no new writes | emergency: cron failing, anitabi complaining |
| 1 | 0 | 0 | stable read-only asset | long-term steady state |
| 0 | 0 | 1 | cron writes but read path doesn't use | **invalid** — alert |

### Rollout timeline

```text
T+0    deploy mirror worker (MIRROR_CRON_ENABLED=0)
       deploy main worker (R2_READ=0, R2_WRITE=0)
       run DB migrations (MapImageMirrorState + MapImageMirrorBootstrap)
       verify: dashboard loads, bootstrap endpoint 200 (empty), imageServe behavior unchanged
       ↓
T+1h   set R2_WRITE_ENABLED=1
       verify: lazy R2 writes accumulating in dashboard
       ↓
T+2h   set MIRROR_CRON_ENABLED=1
       optional: hit `/bootstrap?mode=force-complete` to fast-forward enumeration
       ↓
T+3h   observe: dashboard progress moving, throttle green, fail rate < 1%
       continue 24-48h
       ↓
T+3d   expected mirrored ≈ 60-80%; assess curve health
       ↓
T+5d   expected mirrored ≈ 90%+; set R2_READ_ENABLED=1
       verify: new sessions show `image_cache_state: cache_hit_r2_*` in majority
       verify: P75/P95 latency drops as expected
       ↓
T+7d   expected mirrored ≈ 99%; PR3 declared "active"
```

### Rollback playbook (event-keyed)

| Event | Primary action | Fallback | Severity |
|---|---|---|---|
| anitabi complaint / rate-limit signal | `MIRROR_CRON_ENABLED=0` | wait 24h, reduce throttle, re-enable | high |
| cron fail rate > 50% suddenly | `MIRROR_CRON_ENABLED=0` | check `lastError` trends; could be transient anitabi outage | medium |
| user reports stale image | none (β = prefer availability is intentional) | trigger sync workflow → `reconcileMirrorAfterDiff` | low |
| 502 surge after deploy | `R2_READ_ENABLED=0` (revert to pre-PR3) | inspect imageServe stack trace, fix, redeploy, re-enable | **critical** |
| R2 hit but corrupted bytes | `R2_READ_ENABLED=0` | trace `putMirroredImage` / content-type validation; bulk-delete bad objects | high |
| Postgres connection pool exhausted by cron | `MIRROR_CRON_ENABLED=0` | reduce BATCH 100→25, add `lastAttemptAt` index, profile slow queries | medium |
| Bootstrap stuck (cursor not advancing) | call `/bootstrap?mode=force-complete` | inspect `MapImageMirrorBootstrap.bangumiCursor`/`pointCursor`; possible missing index | low |
| Dashboard `image_cache_state` event flood | tighten frontend aggregation rate limit | sample-rate the events at 10% | low |

### Emergency kill switches

```bash
# Main worker rollback
wrangler rollback --version-id <pre-PR3 worker version>
# (Last known-good: deploy/2026-05-02T17-04-45Z, PR1.55 build)

# Mirror worker kill
cd workers/anitabi-mirror && wrangler rollback
# OR remove triggers.crons in wrangler.jsonc and redeploy
```

**Implementation pre-verification**: project deploys via `npm run cf:deploy` through OpenNext. Confirm `wrangler rollback` semantics align with OpenNext's deployment artifact expectations. Tracked as PR3 pre-deploy verification task.

### Files (deploy/rollback)

- `wrangler.jsonc` — modify: add `r2_buckets`, vars `NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED`, `NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED`.
- `workers/anitabi-mirror/wrangler.jsonc` — **new** (already in §4).
- `docs/runbooks/anitabi-r2-mirror.md` — **new**: production runbook (mirrors this section).

## Operational Tips

- Dashboard: check the admin map-image diagnostics page for mirror progress, bootstrap completion, and recent cache behavior. The panel fetches `/api/admin/anitabi/image-mirror/status` and `/api/admin/anitabi/image-mirror/bootstrap`; admin authentication is required. For request-path validation, confirm recent sessions are emitting `image_cache_state` outcomes and that `cache_hit_r2_*` becomes the dominant terminal state after `R2_READ` is enabled.
- `mirror-status.sh`: run `ADMIN_COOKIE='<logged-in admin cookie>' scripts/mirror-status.sh` for the default production endpoint, or prefix `BASE_URL='https://staging-or-preview.example.com'` to target another environment. The script derives the status URL from `BASE_URL` as `/api/admin/anitabi/image-mirror/status`; it currently does not take a separate status-URL override.
- Alerting/escalation: alert the on-call maintainer through the standard incident channel for anitabi rate-limit complaints, 502 surges, corrupted R2 bytes, or Postgres pool exhaustion. Attach the incident time window, environment/base URL, `mirror-status.sh` output, relevant dashboard screenshots, representative `image_cache_state` samples or server stack traces, and affected object keys or row IDs when corruption/data-specific evidence exists.
