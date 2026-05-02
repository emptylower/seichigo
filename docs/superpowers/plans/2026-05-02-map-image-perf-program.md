# Map Image Performance — 5-PR Program Overview

> **Status doc, not an implementation plan.** Each PR has its own task-level plan written via `superpowers:writing-plans` immediately before that PR starts. Do not pre-write PR2-5 plans — they go stale.

**North star:** After an acceptable brief loading window (W ≈ 4s), users browse all map points with no perceived friction. Hard rule: post-warmup, no individual image stalls > 2000ms before showing a placeholder.

**Worktree:** `claude/sad-curie-5740e0` (already on this branch)

**Started:** 2026-05-02 · **Owner:** seichigo team · **Tracking issue:** TBD

---

## Acceptance Metrics (B-tier, locked)

### Warmup window (T < ~4s, generous)

| Metric | Target |
|---|---|
| First usable map (tiles + markers) | < 2000ms P75 |
| First cover painted | < 3000ms P75 |
| Viewport-internal warmup complete | < 5000ms P75 |

### Steady state (T > W, strict)

| Metric | Target |
|---|---|
| Viewport change → all covers terminal (warm) | **< 1500ms** |
| Viewport change → all covers terminal (cold) | **< 3000ms** |
| pan/zoom frame time | **< 200ms** |
| Point click → detail visible | **< 800ms** |
| Single-image stall ceiling | **≤ 2000ms ⚠️ hard** |

### Steady-state-degradation (new hard rule)

> Any 60s rolling window in steady state with ≥ 3 events ≥ 2000ms wait → session flagged `steady_state_degradation`. Tracked separately from warmup latency. This is the data-side definition of "丝滑". A green dashboard with this flag firing is a lie.

### Session-level

| Metric | Current | Target |
|---|---|---|
| avg session duration | 6144ms | < 2000ms |
| P95 session duration | 6179ms | < 3500ms |
| Session failure rate (new semantics — see PR1) | 50% | < 5% |
| Cover terminal success rate (per host) | not measured | > 95% per host |
| anitabi region-down → site-wide degrade | 91 min | < 30s |

---

## PR Sequence

```
PR1 (止血)    →  deploy  →  24h observation  →  baseline snapshot
                                                       ↓
PR2 (观测)    →  deploy  →  collect new event types
                                                       ↓
PR3 (R2)      ─┐                  PR4 (体感)  ─┐  (parallel after PR2)
               │                                │
               └──── deploy ───────deploy ──────┘
                                ↓
                              PR5 (覆盖)
```

| PR | Title | Goal | Effort | Status |
|---|---|---|---|---|
| **PR1** | 止血 (Stop the bleeding) | Session failure 50% → <10%; max stall 91 min → <30s | 1 day | **In progress** ([detail plan](2026-05-02-map-image-pr1-stop-bleeding.md)) |
| PR2 | 观测 (Telemetry hardening) | Anitabi outage detected < 30s; per-host attribution; steady-state degradation flag | 0.5 day | Pending PR1 deploy |
| PR3 | R2 持久镜像 (R2 image cache) | Decouple from anitabi/bgm.tv availability; cold-edge resilience | 2-3 days | Pending PR2 baseline |
| PR4 | 体感 (Perceived speed) | LQIP placeholder; createImageBitmap pre-decode; tile preconnect; warmup lane split | 2 days | Parallel with PR3 |
| PR5 | 覆盖 (Coverage) | Adjacent-viewport prefetch; mobile budget tuning; lane upgrade discipline | 1-2 days | Last |

**Critical serialization:** PR1 must land before any other PR — it fixes a dashboard bug in `avg`/`P95` aggregation, without which all subsequent baselines are wrong.

---

## PR Scope Summaries (one-line each, full plans written just-in-time)

### PR1 — 止血
1. Host circuit breaker: 3 fails / 10s window → host `blocked` for 60s, returns placeholder fail-fast
2. Degraded-host timeout: drop client per-image timeout from 4-6s → 2000ms when host in degraded/blocked
3. Bgm.tv cover ladder: extend single-candidate `[proxyUrl]` → `[proxyUrl, retryProxy, directBgm]`
4. Session outcome v2: `candTotal=1 + outcome=timeout` → `no_data` (not session-`failed`)
5. First-N forced `__mi_*` decoration: ensure first 5 cover requests in every session emit diag
6. Dashboard avg/P95 bug fix (`warmup_request_terminal` shows avg > P95 — math impossible)
7. Feature flags + tests + housekeeping → predeploy-guard → deploy → ledger

### PR2 — 观测
- New stage `queue_wait_terminal` (split scheduler queue from network)
- New event `host_policy_decision` (degraded/healthy/blocked transitions)
- New event `first_view_paint` (page open → first cover painted)
- New event `viewport_change_settled` (pan/zoom rest → covers terminal)
- New event `steady_state_degradation` (60s/3-fail/2s rule)
- Anitabi upstream synthetic probe (5-min cron) + alert webhook
- Anitabi sync health card on diag dashboard
- Dashboard: stageStats grouped by `targetHostBucket`

### PR3 — R2 持久镜像
- New `MAP_IMAGE_CACHE` R2 binding in `wrangler.json`
- `imageServe.ts`: success → async R2 put; upstream timeout/5xx → R2 lookup before fail
- Background warmer cron: top-N covers (by `MapImageDiagEvent` hit count) preheated to R2
- Cache state stage: `image_cache_state: HIT-R2 / HIT-CF / MISS`
- Compliance: `X-Original-Source` header; UI keeps existing `originLink` attribution
- Purge admin endpoint `/api/admin/anitabi/image-cache/purge`

### PR4 — 体感
- LQIP/blurhash field on `AnitabiBangumi` & `AnitabiPoint` (computed at sync)
- Inline blurhash in `/api/anitabi/preload` & `bulk-cards` payloads
- `ResilientMapImage` & `coverAvatarLoader` use blurhash as instant placeholder
- `createImageBitmap` off-thread decode before `map.addImage`
- Tile-provider preconnect in `app/(site)/map/head.tsx` (maptiler/mapbox/stadia)
- Warmup lane split: `warmup-first-view` (threshold 6) vs background `warmup` (threshold 3)

### PR5 — 覆盖
- Adjacent-viewport prefetch on 200ms pan-rest
- Stale-viewport request cancellation discipline
- Lane preemption when `interaction-critical` queue grows
- Mobile budget: `DEFAULT_MAX_LOADED` adaptive (160 desktop / 80 low-end mobile)
- 4G network detection guard

---

## Risks & Rollback

Every PR is gated by `NEXT_PUBLIC_MAP_IMAGE_*_ENABLED` flags. Rollback = flip flag, no redeploy.

| Risk | Mitigation |
|---|---|
| Circuit breaker false-positives | Configurable thresholds; 60s TTL; `blocked_host_count` panel metric |
| Session-outcome v2 hides real failures | Add separate `terminal_failure_rate` metric (decoupled from `sessionOutcome`) |
| R2 caches stale/wrong images | 30d TTL; manual purge endpoint; first-fail tries upstream once before R2 |
| Blurhash inflates sync time | Async queue; first version only top-1000 covers |

---

## Open Decisions (defer until each PR starts)

- **D3** — Anitabi probe alert channel (Telegram bot / Slack / dashboard-only). Decide at PR2 kickoff.
- **D4** — R2 mirror scope: lazy-on-hit + top-1000 prewarm, or lazy-only, or full prewarm (~2.5GB). Decide at PR3 kickoff.
- **D5** — R2 attribution form (response header / UI link / both). Decide at PR3 kickoff.
- **D6** — Cadence between PRs (one-per-week vs. continuous-deploy). Default: one-per-week with 24h+ observation between.

---

## Source Material

- Conversation: this session, 2026-05-02
- Diag JSON: `/Users/mac/Downloads/seichigo-sessions-2026-05-02.json` (5 sessions + 7d overview)
- Anitabi API docs: https://github.com/anitabi/anitabi.cn-document
- Production Worker version (deployed 2026-04-19): `79dc74d8-9739-4331-96bf-7ab1a2cc7bcf`
- Local main HEAD ahead 8 commits: `bb58f6c`
