# Map Image PR3 — R2 Persistent Mirror (Design Spec)

> **Status**: Design spec, awaiting user review before plan generation.
> **Date**: 2026-05-03
> **Author**: brainstorming session, 2026-05-03 (handoff: [docs/superpowers/plans/2026-05-03-map-image-pr3-handoff.md](../../../.claude/worktrees/beautiful-mccarthy-24ff27/docs/superpowers/plans/2026-05-03-map-image-pr3-handoff.md))
> **Program plan**: [docs/superpowers/plans/2026-05-02-map-image-perf-program.md](../plans/2026-05-02-map-image-perf-program.md)
> **Decisions locked**: D4-γ (full prewarm) · A (PR2 → 24h obs → PR3) · D5-γ (header + UI) · D6-ψ (PR3/PR4 parallel after PR2)

---

## Goal & Thesis

Decouple Seichigo's map-image availability from `image.anitabi.cn` by mirroring the full anitabi cover/point image set into Cloudflare R2. After PR3 ships and the backfill completes, an anitabi outage should not degrade user experience: requests land on R2 instead of timing out on the upstream.

Concretely:
- Eliminate the 8.5s upstream-timeout cliff observed in session `cmoolf34s0000psp75waxbu0q`.
- Keep popular bangumi (e.g. `495562`) viewable when anitabi is slow.
- Provide a verifiable telemetry chain (`image_cache_state` stage) for "did R2 actually rescue this user?".

Non-goals (full list in §11): perceived-speed work, blurhash, viewport prefetch, lane splits — those belong to PR4/PR5.

---

## §1 Architecture Overview

### Two-worker split (chosen over in-line and queue-driven approaches)

```
┌─ User request ──────────────────────────────────────────────────────────┐
│                                                                         │
│   Browser ──► /api/anitabi/image-render?url=…                           │
│                       │                                                 │
│                       ▼                                                 │
│   ┌─── Main Next.js Worker (existing, modified) ───┐                    │
│   │  imageServe.ts:                                │                    │
│   │    1) CF edge cache (caches.default)           │ ── HIT ──► return  │
│   │    2) R2 lookup (NEW)                          │ ── HIT ──► return  │
│   │    3) Upstream fetch (anitabi/bgm)             │                    │
│   │    4) dual write: CF + R2 (NEW, async)         │                    │
│   │    5) On upstream 5xx/timeout → R2 fallback    │                    │
│   │       (NEW, even if R2 is "stale")             │                    │
│   └────────────────────────────────────────────────┘                    │
│                       │                                                 │
│                       ▼                                                 │
│   R2 Bucket: MAP_IMAGE_CACHE                                            │
│                       ▲                                                 │
│                       │ writes                                          │
│   ┌─── New Worker: anitabi-mirror (NEW) ─────┐                          │
│   │  cron triggers:                          │                          │
│   │    - every 5min: seed batch (initial)    │                          │
│   │    - every 1h: incremental delta scan    │                          │
│   │  logic:                                  │                          │
│   │    1) read Postgres: AnitabiBangumi.cover│                          │
│   │       AnitabiPoint.image                 │                          │
│   │    2) enumerate canonical URL variants   │                          │
│   │    3) per-URL fetch + R2 put, throttled  │                          │
│   │    4) progress in MapImageMirrorState    │                          │
│   └──────────────────────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Deployment units

| Unit | Path | Deploy command | Trigger | Responsibility |
|---|---|---|---|---|
| Main Worker (modified) | `app/api/anitabi/image-render/`, `lib/anitabi/handlers/imageServe.ts` | `npm run cf:deploy` (existing) | HTTP requests | Serve user requests; R2 read + async dual-write + R2 fallback |
| `anitabi-mirror` Worker (new) | `workers/anitabi-mirror/` | independent `wrangler.jsonc` + independent deploy | Cron triggers | Seed backfill + delta sync + progress tracking |

### Shared resources

- **R2 Bucket**: `seichigo-anitabi-images` (final name confirmed at PR3 task #1; Wrangler binding `MAP_IMAGE_CACHE` in both workers).
- **Postgres**: both workers use Prisma. New `MapImageMirrorState` and `MapImageMirrorBootstrap` tables.
- **Feature flags**:
  - `NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED` (main worker — controls R2 read path).
  - `NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED` (main worker — controls R2 write path).
  - `MAP_IMAGE_MIRROR_CRON_ENABLED` (mirror worker — controls cron execution).
  - All three independently flippable.

### Flag rollout state machine

```
PR3 deploy day 0:  R2_READ=0, R2_WRITE=0, MIRROR_CRON=0   (code shipped, all dormant)
            ↓
day 0 + 1h:        R2_WRITE=1                             (lazy writes begin populating R2)
            ↓
day 0 + 2h:        MIRROR_CRON=1                          (cron starts seed backfill)
            ↓
24h+ observation:  monitor R2 hit rate, cron failure rate
            ↓
≥95% mirrored:     R2_READ=1                              (this is when users actually benefit)
```

### Boundaries (what is NOT in PR3)

- ❌ PR2 events (`queue_wait_terminal`, `host_policy_decision`, `first_view_paint`, `viewport_change_settled`, `steady_state_degradation`, anitabi probe).
- ❌ PR4 perceived-speed work (blurhash, `createImageBitmap`, tile preconnect, warmup lane split).
- ❌ bgm.tv full prewarm — bgm.tv stays on the existing ladder fallback (lazy R2 only).
- ❌ Custom CDN domain pointing directly at R2 — user requests always go through the main worker.

---

## §2 R2 Key Scheme

### Problem

The same source image is requested in multiple variants (`plan=h160`, `plan=h320`, `w=640&q=80`, `cover/m/`, `cover/l/`). R2 stores raw bytes — variants must be keyed independently.

### Key format

```
mirror/v1/<host>/<sha256(canonicalUrl)[:24]>/<ext>
```

- `mirror/v1/` — version prefix; future schema change uses `v2`.
- `<host>` — `image.anitabi.cn` or `lain.bgm.tv`, etc. Allows host-scoped R2 list/purge.
- `<sha256(canonicalUrl)[:24]>` — SHA-256 of the canonical URL, first 24 hex chars (~128 bits, sufficient for 320k objects).
- `<ext>` — `.jpg` / `.png` / `.webp` / etc., derived from MIME type via existing `extensionFromMimeType()`.

Example:

```
source URL:   https://image.anitabi.cn/bangumi/123/cover.jpg?plan=h320
canonical:    https://image.anitabi.cn/bangumi/123/cover.jpg?plan=h320
sha256[:24]:  a3f8b1c…0d4e
key:          mirror/v1/image.anitabi.cn/a3f8b1c…0d4e/.jpg
```

### Canonical URL rules

Read-path (main worker) and cron (mirror worker) **must use the same** normalization function or keys diverge. Implementation: extract pure functions from `lib/anitabi/imageProxy.ts` into a new shared module `lib/anitabi/imageNormalize.ts` (no `window` dependency), imported by both workers.

Steps:
1. Lowercase protocol and host. Strip trailing `/`.
2. Strip diagnostic params (`__mi_*`) using existing `stripMapImageDiagnosticParams()`.
3. Strip `_retry`, `name` params.
4. Apply anitabi domain rewrite (`anitabi.cn` → `image.anitabi.cn`; `/images/` prefix removal).
5. Apply bgm.tv cover-size collapse (`/pic/cover/l/` → `/m/`).
6. **Keep** `plan=` / `w=` / `h=` / `q=` — these define the variant and are part of the key.
7. Sort remaining query params lexically (`?a=1&b=2` ≡ `?b=2&a=1`).

### R2 object metadata (`customMetadata`)

Every R2 PUT records:

- `originalUrl`: full canonical URL (debug reverse-lookup; not part of key).
- `mimeType`: e.g. `image/jpeg`.
- `mirroredAt`: ISO timestamp.
- `mirrorSource`: `'lazy' | 'cron-seed' | 'cron-delta' | 'cron-refresh'`.
- `contentLength`: bytes.

### Explicit non-decisions

- ❌ Don't put the original URL in the key (URL too long, special chars, list-unfriendly).
- ❌ Don't use content addressing (would require downloading first to compute hash; conflicts with "R2 lookup before upstream" order).
- ❌ Don't dedup across hosts (same logical image at anitabi vs bgm.tv stored twice; simpler reasoning, negligible cost).

### Storage estimate

- bangumi cover: ~2 common variants (`m` default + occasional `l`) → 10k bangumi × 2 ≈ **20k objects**.
- point image: ~3 common variants (`h160` thumbnail + `h320` preview + `w=640&q=80` detail) → 100k points × 3 ≈ **300k objects**.
- **Total: ~320k objects, ~16GB**. R2 free tier 10GB; overage at $0.015/GB·month ≈ **$0.09/month**.
- One-time backfill PUT ops: 320k, well within 1M/month free tier. Class B (read) ops scale with traffic; 10M/month free tier sufficient at current volume.

---

## §3 Read Path (main worker `imageServe.ts`)

### Modified order of operations

```
Request → CF cache HIT?       ─yes─► return (unchanged)
            │ no
       parseTargetUrl + assertAllowedTargetUrl
            │
            ▼
       compute R2 key (canonicalUrl → sha256[:24])
            │
       【FLAG: R2_READ_ENABLED?】
            │ yes
       R2.get(key) HIT?       ─yes─► return + async storeRenderCache(CF)  ★
            │ no
       fetch upstream (existing logic)
            │ ok (200)
       buildRenderResponse + storeRenderCache(CF)
            │
       【FLAG: R2_WRITE_ENABLED?】
            │ yes
       ctx.waitUntil(R2.put(key, body, metadata))                          ★
            │
       return
            │ fail (timeout / 5xx)
       【FLAG: R2_READ_ENABLED?】
            │ yes
       R2.get(key) HIT?       ─yes─► return + X-Seichigo-Image-Source: r2-fallback  ★
            │ no
       return 502 (existing)
```

★ Three new insertion points: R2 hit, R2 write-through, R2 fallback.

**Critical security constraint**: R2 lookup must run **after** `assertAllowedTargetUrl()`, never before. Otherwise an attacker can submit a disallowed URL whose hash collides with a previously-cached legitimate image, leaking that image. The host allowlist + IP block (loopback/private) checks gate the R2 path equally with upstream fetch.

### New diag stage: `image_cache_state`

Add to `MapImageDiagStage` enum in `lib/mapImageDiag/shared.ts`:

```ts
type MapImageDiagStage =
  | 'proxy_target_parse'
  | 'proxy_fetch_start'
  | 'proxy_fetch_terminal'
  | 'proxy_content_validate'
  | 'proxy_stream_terminal'
  | 'proxy_allow_check'
  | 'proxy_cache_state'    // existing: CF edge cache
  | 'image_cache_state'    // NEW: combined cache decision (CF + R2)
```

Outcomes:

- `cache_hit_cf` — CF edge cache hit (mirrors existing `proxy_cache_state.cache_hit`).
- `cache_hit_r2_primary` — R2 hit before upstream attempted.
- `cache_hit_r2_fallback` — R2 hit after upstream failure.
- `cache_miss_all` — CF + R2 both miss; upstream succeeded.
- `cache_miss_r2_only` — CF miss + R2 miss; upstream succeeded.
- `cache_full_miss_failed` — all three miss; upstream failed.

`evidence` carries `r2Key` (first 24 hash chars) and `r2Bytes` (size when hit) for dashboard drill-down.

`image_cache_state` and `proxy_cache_state` coexist; `image_cache_state` is the higher-level rollup.

### Response headers

R2-hit responses add:

- `X-Seichigo-Image-Source: r2-primary | r2-fallback | upstream-with-r2-write | upstream-no-r2`
- `X-Seichigo-Image-Mirrored-At: <ISO>` (from `customMetadata`)
- `X-Original-Source: https://image.anitabi.cn/...` (D5-γ; on **all** anitabi-sourced responses regardless of cache layer).

`Cache-Control` unchanged (`public, s-maxage=86400, stale-while-revalidate=604800`). The 30+ day "effective R2 retention" comes from cron not deleting; not from cache headers.

### R2 fallback policy: "prefer availability" (β)

When upstream fails and R2 has any version of the object, return R2 even if potentially stale.

Rationale: anitabi modifies covers at < 1/year/image; "showing yesterday's cover" is overwhelmingly preferable to "showing 502". DevTools `X-Seichigo-Image-Source: r2-fallback` lets ops detect staleness.

Rejected alternatives:
- α (strict freshness) — defeats the point of mirroring.
- γ (smart freshness with ETag/age threshold) — high complexity, dubious benefit.

### Failure mode table

| Scenario | Behavior |
|---|---|
| CF HIT | return (millisecond, no R2 / no upstream) |
| CF MISS + R2 HIT | return + async write CF (next request faster) |
| CF MISS + R2 MISS + upstream OK | return + dual-write CF + R2 (async) |
| CF MISS + R2 MISS + upstream timeout/5xx | second R2 lookup (anti-race), still MISS → 502 |
| R2.get() throws | treat as R2 MISS (log warn), continue to upstream |
| R2.put() throws | log warn (response already sent); next lazy hit fills it |
| R2_READ_ENABLED=0 | R2 path skipped entirely; behavior reverts to pre-PR3 |
| R2_WRITE_ENABLED=0 | no R2 writes; "read-only mode" for late stage |

### Files (read-path)

- `lib/anitabi/handlers/imageServe.ts` — modify: insert R2 lookup, fallback, dual-write, new stage events.
- `lib/anitabi/imageNormalize.ts` — **new**: pure normalization functions shared by both workers.
- `lib/anitabi/imageProxy.ts` — modify: import from `imageNormalize.ts` instead of defining locally.
- `lib/anitabi/r2Mirror.ts` — **new**: R2 client abstraction (`getMirroredImage`, `putMirroredImage`, `computeMirrorKey`).
- `lib/mapImageDiag/shared.ts` — modify: add `image_cache_state` enum value.
- `wrangler.jsonc` — modify: add `r2_buckets` binding.

---

## §4 Write Path (lazy + cron)

### Triggers

| Source | Who triggers | When | Frequency |
|---|---|---|---|
| Lazy (main worker) | user request path | CF MISS + upstream 200 → `ctx.waitUntil(R2.put(…))` | sync with traffic |
| Cron seed (mirror worker) | scheduled trigger | every 5 minutes; up to N rows per tick | until full coverage |
| Cron delta (mirror worker) | scheduled trigger | every 1 hour; scan new/updated bangumi/point | continuous |
| Cron refresh (mirror worker) | scheduled trigger (default off) | weekly; oldest-N by `mirroredAt` | not enabled in v1 |

### Common put function

`lib/anitabi/r2Mirror.ts:putMirroredImage()`, called from both lazy and cron paths:

```ts
export async function putMirroredImage(
  bucket: R2Bucket,
  canonicalUrl: string,
  imageBytes: ArrayBuffer,
  mimeType: string,
  source: 'lazy' | 'cron-seed' | 'cron-delta' | 'cron-refresh',
): Promise<{ key: string; bytesWritten: number; skipped: boolean }>
```

Behavior:

1. Compute key (same as read path).
2. **Existence check**: `R2.head(key)` — if exists and `customMetadata.mirroredAt` within `R2_REFRESH_MIN_AGE_DAYS` (default 7d), **skip** to avoid duplicate writes.
3. PUT with `httpMetadata.contentType = mimeType`, `customMetadata = { originalUrl, mimeType, mirroredAt, mirrorSource, contentLength }`.

### Lazy/cron race resolution

Both workers PUT to the same key occasionally. R2 PUT is last-writer-wins with identical bytes (same canonical URL → same upstream bytes). Wastes one ops, no data corruption. Acceptable.

### `MapImageMirrorState` table

```prisma
model MapImageMirrorState {
  id             String   @id @default(cuid())
  sourceType     String   // 'bangumi-cover' | 'point-image'
  sourceId       String   // bangumiId.toString() | pointId
  variant        String   // 'default' | 'h160' | 'h320' | 'w640q80' | 'cover-m' | …
  canonicalUrl   String
  r2Key          String
  status         String   // 'pending' | 'in_progress' | 'mirrored' | 'failed' | 'skipped_404'
  attempts       Int      @default(0)
  lastAttemptAt  DateTime?
  lastError      String?  @db.Text
  mirroredAt     DateTime?
  contentBytes   Int?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([sourceType, sourceId, variant])
  @@index([status, createdAt])    // cron next-batch query
  @@index([status, lastAttemptAt]) // failure-retry scheduling
}
```

Design points:

- `status='skipped_404'` — 404 is terminal, never retried.
- `attempts` cap at 5 → status flips to `failed`, exposed on dashboard.
- `@@unique([sourceType, sourceId, variant])` — strict dedup.
- `lastError` is `@db.Text` to handle long error bodies.

Reserved meta-rows (use `sourceType` to namespace):
- `sourceType='__throttle__'` — anitabi-wide circuit breaker state.
- `sourceType='__cursor__', sourceId='delta'` — last delta scan watermark.

### Cron seed batch (sketch)

```ts
async function runSeedBatch() {
  const BATCH = 100
  const PER_REQUEST_DELAY_MS = 200  // 5 req/s — must align with anitabi mirror spec from D0
  const items = await prisma.mapImageMirrorState.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  })
  for (const item of items) {
    await prisma.mapImageMirrorState.update({
      where: { id: item.id },
      data: { status: 'in_progress', lastAttemptAt: new Date(), attempts: { increment: 1 } },
    })
    try {
      const res = await fetch(item.canonicalUrl, {
        headers: { 'user-agent': 'SeichiGoMirror/1.0 (+https://seichigo.com)' },  // adjusted per D0 anitabi mirror spec if required
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 404) {
        await prisma.mapImageMirrorState.update({
          where: { id: item.id }, data: { status: 'skipped_404' },
        })
        continue
      }
      if (!res.ok) throw new Error(`upstream ${res.status}`)
      const mimeType = res.headers.get('content-type') || ''
      if (!mimeType.startsWith('image/')) throw new Error('non_image_response')
      const bytes = await res.arrayBuffer()
      const result = await putMirroredImage(env.MAP_IMAGE_CACHE, item.canonicalUrl, bytes, mimeType, 'cron-seed')
      await prisma.mapImageMirrorState.update({
        where: { id: item.id },
        data: { status: 'mirrored', mirroredAt: new Date(), contentBytes: result.bytesWritten, lastError: null },
      })
    } catch (err) {
      const isMaxedOut = item.attempts >= 4
      await prisma.mapImageMirrorState.update({
        where: { id: item.id },
        data: { status: isMaxedOut ? 'failed' : 'pending', lastError: String(err).slice(0, 500) },
      })
    }
    await sleep(PER_REQUEST_DELAY_MS)
  }
}
```

### Throttling

- **Per-request delay**: 200ms (5 req/s). Final value pinned to anitabi mirror spec (D0 task).
- **Adaptive batch**: CF cron 30s wall time × ~5/s sustainable = 100–150 fetches/tick. Target BATCH=100.
- **Exponential backoff**: failed URL pauses for `2^attempts` minutes (1min, 2min, 4min, 8min, 16min).
- **Anitabi-wide circuit breaker**: ≥10 consecutive timeouts in a 5-min window → write `__throttle__` row → next cron tick reads it and self-pauses for 1h.

### Backfill timeline

Total: 320k objects · 5 req/s · 30s/300s cron duty cycle = ~7 days continuous. Compatible with the 7-day observation window before R2_READ_ENABLED gate.

R2 hit rate climbs from 0% (day 0) to ~99% (day 7); dashboard must visualize this curve.

### Delta cron

Hourly:

```sql
SELECT id FROM "AnitabiBangumi" WHERE "updatedAt" > $lastDeltaAt
SELECT id FROM "AnitabiPoint"   WHERE "updatedAt" > $lastDeltaAt
```

Each ID enumerates variants and upserts pending rows into `MapImageMirrorState`. Watermark stored in `__cursor__` meta row's `mirroredAt` field.

### Files (write-path)

- `lib/anitabi/r2Mirror.ts` — already planned in §3.
- `lib/anitabi/imageNormalize.ts` — already planned in §3.
- `lib/anitabi/imageMirrorVariants.ts` — **new**: `enumerateBangumiCoverVariants`, `enumeratePointImageVariants`.
- `prisma/schema.prisma` — modify: add `MapImageMirrorState` + indexes.
- Prisma migration: `add_map_image_mirror_state`.
- `workers/anitabi-mirror/wrangler.jsonc` — **new**.
- `workers/anitabi-mirror/src/index.ts` — **new**: scheduled handler entry.
- `workers/anitabi-mirror/src/cronSeed.ts` — **new**.
- `workers/anitabi-mirror/src/cronDelta.ts` — **new**.
- `workers/anitabi-mirror/src/throttle.ts` — **new**.

---

## §5 Resume + Progress Monitoring

### Resume guarantees (per interruption scenario)

| Scenario | Recovery mechanism |
|---|---|
| Worker killed mid-batch (30s wall time) | `reclaimStale()` resets `in_progress` rows older than 5min back to `pending` |
| New mirror worker version deployed mid-batch | same as above |
| Postgres transient connection failure | row stays in current state, next cron retries naturally |
| `MAP_IMAGE_MIRROR_CRON_ENABLED` toggled off then on | full state in Postgres; resumes from where it stopped |
| DB migration window | cron crashes, retries on next tick |
| New bangumi/point added | delta cron picks up via `updatedAt` watermark |
| `MapImageMirrorState` row manually deleted | bootstrap upserts on next run; no harm |
| R2 object manually deleted | Postgres still says `mirrored`; next request R2-misses, lazy-rewrites |

### `reclaimStale()` (first action in every cron tick)

```ts
const FIVE_MIN_AGO = new Date(Date.now() - 5 * 60 * 1000)
const result = await prisma.mapImageMirrorState.updateMany({
  where: { status: 'in_progress', lastAttemptAt: { lt: FIVE_MIN_AGO } },
  data: { status: 'pending' },
})
if (result.count > 0) {
  await emitMirrorEvent({ stage: 'mirror_reclaim', outcome: 'reclaimed', evidence: { count: result.count } })
}
```

### Bootstrap: auto-primary, manual-fallback

```prisma
model MapImageMirrorBootstrap {
  id              Int      @id @default(1)  // single row
  bangumiCursor   Int?
  pointCursor     String?
  bangumiCompleted Boolean @default(false)
  pointCompleted   Boolean @default(false)
  totalEnumerated Int      @default(0)
  startedAt       DateTime?
  completedAt     DateTime?
  lastAdvanceAt   DateTime?
  manuallyTriggered Boolean @default(false)
}
```

Each cron tick:

```ts
async function cronTick(env, source: 'auto' | 'manual') {
  await reclaimStale()
  const bs = await prisma.mapImageMirrorBootstrap.upsert({
    where: { id: 1 }, create: { id: 1 }, update: {},
  })
  if (!bs.bangumiCompleted || !bs.pointCompleted) {
    const chunkSize = source === 'manual' ? 5000 : 2000
    await advanceBootstrap(chunkSize)
  }
  await processSeedBatch(100)
  await emitMirrorTickEvent({ source, ... })
}
```

**Auto path** (cron, every 5 min): chunkSize 2000.
- 10k bangumi / 2000 = 5 ticks × 5 min ≈ **25 minutes**.
- 100k points / 2000 = 50 ticks × 5 min ≈ **4 hours**.
- Bootstrap completes in ~4–5 hours. Seed runs concurrently.

**Manual path** (admin endpoint):

```
POST /api/admin/anitabi/image-mirror/bootstrap
{ mode: 'advance' | 'force-complete' }
```

- `advance` (default) — calls `cronTick(source='manual')` once with chunkSize=5000.
- `force-complete` — loops `advanceBootstrap` until both completed or 25s elapsed (HTTP timeout safety).

Idempotency: same underlying function. Cursor is monotonic; concurrent calls serialized via Postgres row lock on `id=1`.

**When manual is needed**:
- Cron flag is off (staging validation).
- Cron stuck on `bangumiCompleted=false` (dashboard not advancing).
- Want to push bootstrap immediately without waiting 5min.

### Status API

```
GET /api/admin/anitabi/image-mirror/status

Response:
{
  totals: { all, pending, in_progress, mirrored, failed, skipped_404 },
  byCron: {
    lastRunAt, lastRunDurationMs, lastBatchProcessed, lastBatchFailed,
    consecutiveFailures, throttleEngaged: false,
  },
  bootstrap: {
    bangumiCompleted, pointCompleted, bangumiCursor, pointCursor,
    totalEnumerated, startedAt, completedAt,
  },
  byType: {
    'bangumi-cover': { total, mirrored, pending, ... },
    'point-image':   { total, mirrored, pending, ... },
  },
  recentFailures: [{ canonicalUrl, lastError, attempts, lastAttemptAt }, ...],
  rates: { mirroredLast1h, mirroredLast24h, estimatedRemainingHours },
}
```

Aggregation: `GROUP BY status` + `COUNT(*) FILTER (WHERE …)`. < 100ms on 320k rows.

### Dashboard panel (extends existing `/admin/ops/map-image-diagnostics`)

```
┌─ Mirror Backfill Progress ────────────────────────────────────┐
│ Total      320,148                                            │
│ mirrored   ████████░░░░░░░░░░ 47.3% (151,428)                 │
│ pending    ░░░░░░░░░░░░░░░░░░ 52.0% (166,420)                 │
│ in_progress                   0.1% (243)                      │
│ failed                        0.4% (1,420)                    │
│ skipped_404                   0.2% (637)                      │
│                                                               │
│ rate (1h):    4.8/s        ETA: ~9.6h                         │
│ throttle:     🟢 healthy                                      │
│ last cron:    2 min ago, 28s, 134 done, 0 failed              │
│                                                               │
│ [advance bootstrap +5000]  [force-complete]                   │
└───────────────────────────────────────────────────────────────┘
```

Plus time-series chart (24h mirrored count) and recent-failures table.

### CLI status snapshot

```bash
# scripts/mirror-status.sh
curl -s -b "$ADMIN_COOKIE" https://www.seichigo.com/api/admin/anitabi/image-mirror/status \
  | jq -r '.totals | "mirrored=\(.mirrored)/\(.all)  pending=\(.pending)  failed=\(.failed)"'
```

### Cron health events (synthetic sessions)

Each cron tick emits a `MapImageDiagEvent`:

```ts
await emitMirrorEvent({
  stage: 'mirror_cron_tick',
  outcome: 'success' | 'partial_failure' | 'throttled',
  durationMs,
  evidence: { batchSize, mirroredCount, failedCount, skipped404Count, reclaimedCount, throttleEngaged },
})
```

Synthetic sessionId pattern: `mirror-cron-<ISO>`. Filterable in dashboard.

### Files (resume/monitoring)

- `app/api/admin/anitabi/image-mirror/bootstrap/route.ts` — **new**.
- `app/api/admin/anitabi/image-mirror/status/route.ts` — **new**.
- `app/(authed)/admin/ops/map-image-diagnostics/ui.tsx` — modify: add mirror progress panel.
- `prisma/schema.prisma` — modify: add `MapImageMirrorBootstrap`.
- Prisma migration: `add_map_image_mirror_bootstrap`.
- `scripts/mirror-status.sh` — **new**.
- `workers/anitabi-mirror/src/index.ts` — modify: call `reclaimStale()` first in every tick.

---

## §6 Compliance (D5-γ + D0 precondition)

### D0 — anitabi mirror spec alignment (PR3 task #1, gating)

Anitabi publishes mirror documentation at [github.com/anitabi/anitabi.cn-document](https://github.com/anitabi/anitabi.cn-document). Tasks:

1. Locate the section on mirroring/scraping. Extract:
   - QPS / concurrency / per-IP-window limits.
   - User-Agent string requirements (project URL, contact email, etc.).
   - Attribution form requirements (header? UI? specific text?).
   - Cache TTL minimums ("please cache ≥ N days").
   - Disallowed resource categories (if any).

2. Treat anitabi's published constraints as **hard constraints** on §4 throttling:
   - If their spec says ≤ 2 req/s, lower from 5 to 2.
   - If their spec mandates a UA format, update cron worker UA.
   - If their spec mandates ≥30 day cache, §7 TTL strategy adjusts.

3. Output: `docs/superpowers/research/2026-05-XX-anitabi-mirror-compliance.md`. Cites doc URL/snapshot, our params vs. their requirements table, deviations explained.

**Possible outcomes**:
- GREEN (default expected): anitabi allows mirroring + we align → §4 §5 ship as designed, parameters tuned.
- YELLOW: spec demands stricter throttling that lengthens backfill → tune and recompute timeline.
- RED (not expected): explicit prohibition → fall back to D4-α (lazy-only); spec needs rewrite. User has confirmed RED is unlikely based on prior knowledge.

### `X-Original-Source` header (D5-γ)

All `/api/anitabi/image-render` responses (CF hit / R2 hit / upstream / fallback) carry:

```http
X-Original-Source: <canonicalUrl>
```

`canonicalUrl` = the same value used to derive the R2 key, regardless of how the response was assembled.

Special cases:
- Upstream is `bgm.tv` (cover ladder fallback): header points to bgm.tv URL.
- Upstream is same-origin (shouldn't happen, defensive): header omitted.

Implementation: `buildRenderResponse()` accepts `originalUrl` parameter.

### UI attribution audit + extension

Existing: `AnitabiPoint.originLink` is shown in point-detail drawers. Unchanged.

PR3 audit sub-task (one task in the implementation plan): grep the codebase for every UI surface rendering anitabi-sourced images, then add `via anitabi.cn` micro-link wherever it's currently missing. The list below enumerates the candidate surfaces; the audit confirms which already have attribution and which need it added.

| Location | Default expectation (audit verifies) | PR3 action if missing |
|---|---|---|
| Point-detail drawer / sheet | already has `originLink` | unchanged |
| Bangumi cover detail (anime page) | likely missing | add link to `https://anitabi.cn/bangumi/<id>` |
| Map point card (`PointCard`) | likely missing | add 12px caption "via anitabi" linking to `https://anitabi.cn/bangumi/<bangumiId>` |
| WindowExcerpt 9-card grid (PR1.55 surface) | likely missing | same as PointCard |
| `/api/anitabi/image-download` PDF/single-image | likely missing | embed source URL in PDF metadata or watermark single-image download |

Visual spec:
- Font: 12px / 0.75em (caption tier).
- Color: 50% opacity of secondary text color.
- Text: `via anitabi.cn` or `图片来源: anitabi.cn` (i18n via existing system).
- Hover/focus: full URL tooltip.
- Link: `target="_blank"` + `rel="noopener noreferrer"`.

### Server-side audit log

Mirror cron PUT writes structured JSON to `console.log` (CF Workers Logs auto-capture):

```ts
{
  event: 'mirror_put',
  ts: '2026-05-03T14:23:11Z',
  canonicalUrl: '…',
  r2Key: 'mirror/v1/…',
  source: 'cron-seed',
  bytesWritten: 51234,
  upstreamStatus: 200,
}
```

No new infrastructure; relies on existing log capture.

### Outreach (recommended, non-blocking)

Post-deploy, attempt contact via:
- Anitabi Twitter/X account.
- bgm.tv anitabi project page feedback.
- GitHub issue on `anitabi.cn-document`.

Template: brief note that we mirror N images, attribute via header + UI link, request feedback if scope/frequency should change.

### Files (compliance)

- `lib/anitabi/handlers/imageServe.ts` — modify: emit `X-Original-Source` on all paths.
- UI files identified by the audit sub-task (likely `app/(site)/anime/...`, `components/.../PointCard.tsx`, `components/.../WindowExcerpt.tsx`, plus the image-download route).
- `lib/anitabi/i18n/...` — modify: new keys `image.attribution.viaAnitabi`, `image.attribution.sourceLink`.
- `docs/superpowers/research/2026-05-XX-anitabi-mirror-compliance.md` — **new**.

---

## §7 TTL / Refresh Strategy

### Chosen: Type C (cache invalidation via sync diff)

Hook into `lib/anitabi/sync/diff.ts`. After each sync cycle, for any bangumi/point whose `cover` or `image` URL changed:

```ts
async function reconcileMirrorAfterDiff(diffResult: DiffResult) {
  for (const change of diffResult.bangumiChanges) {
    if (change.field === 'cover' && change.oldValue !== change.newValue) {
      // Old URL's rows: reset to pending so they get re-mirrored at the new URL value
      await prisma.mapImageMirrorState.updateMany({
        where: { sourceType: 'bangumi-cover', sourceId: String(change.id) },
        data: { status: 'pending', attempts: 0, lastError: null, mirroredAt: null },
      })
      // New URL's rows: upsert variants
      const newVariants = enumerateBangumiCoverVariants(change.newValue!)
      for (const v of newVariants) {
        await prisma.mapImageMirrorState.upsert({
          where: {
            sourceType_sourceId_variant: {
              sourceType: 'bangumi-cover', sourceId: String(change.id), variant: v.label,
            },
          },
          create: {
            sourceType: 'bangumi-cover', sourceId: String(change.id), variant: v.label,
            canonicalUrl: v.url, r2Key: computeMirrorKey(v.url), status: 'pending',
          },
          update: {
            canonicalUrl: v.url, r2Key: computeMirrorKey(v.url), status: 'pending',
          },
        })
      }
    }
  }
  // Same for pointChanges...
}
```

Result: changed images naturally enter the pending queue; cron consumes them within hours.

### Rejected alternatives

- **Type A (never refresh)**: simple, but stale forever.
- **Type B (weekly periodic refresh)**: doubles ops cost (~$0.50/month over free tier), continuous load on anitabi.

### Old R2 object cleanup

Chosen: **don't actively delete**. Anitabi changes covers at < 1/year/image; 10-year accumulation < 200MB. Cleanup logic isn't worth the complexity.

If accumulation becomes an issue, future PR adds a daily GC cron that purges objects whose `MapImageMirrorState` row no longer references them.

### TTL header (browser cache)

Unchanged: `public, s-maxage=86400, stale-while-revalidate=604800`.

Three-layer caching:
- Browser/CF edge: 1d fresh + 7d SWR.
- R2: 30+d effective (cron doesn't delete).
- Each layer is independent; failure at one doesn't impact others.

### anitabi spec compatibility

If D0 reveals a TTL minimum:
- N ≤ 1d: existing config compliant.
- 1 < N ≤ 30d: bump `s-maxage`.
- N > 30d: postpone any future R2 GC accordingly.

### Pre-implementation verification (sub-task)

Sync workflow stability/diff-output reliability needs a quick check before PR3 wires into it. If sync workflow is unstable, fix sync first.

### Files (TTL/refresh)

- `lib/anitabi/sync/diff.ts` — modify: invoke `reconcileMirrorAfterDiff()` post-diff.
- `lib/anitabi/sync/mirrorReconcile.ts` — **new**: reconcile logic.

---

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

```
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

---

## §9 Failure Modes (production angles)

Items not already covered by §3 (request-path) or §4/§5 (cron retries).

1. **R2 quota / billing exceeded**: PUT returns 429/5xx → `putMirroredImage` catches, lazy/cron both treat as failure, `failed` rows accumulate. Dashboard "R2 error rate" sub-metric (count `lastError` matching `R2_QUOTA`); alert and human-escalate.
2. **anitabi URL pattern change**: 404 surge → `skipped_404` count spikes; sync workflow updates `cover`/`image` to new URLs → §7 reconcile re-mirrors. Monitor "24h new `skipped_404` count".
3. **Main worker deploy momentary R2 binding unavailable**: < 100ms gap; R2.get() throws → §3 treats as MISS → user transparent.
4. **Lazy-vs-cron PUT race**: identical bytes; last-writer-wins; one wasted op.
5. **`MapImageMirrorState` table size**: ~160MB data + indexes for 320k rows. DB capacity verification listed under "Pre-implementation verification" in the implementation plan inputs section below; runs in parallel with D0.
6. **CF cron not firing**: dashboard `lastRunAt > 10min` displays red. Manual `force-complete` substitutes one tick.
7. **Reverse-proxy abuse via R2 path**: prevented by §3 invariant — R2 lookup runs **after** `assertAllowedTargetUrl()`.
8. **mirror worker DDoS**: no HTTP exposure; only cron triggers + admin-auth-protected bootstrap endpoint on main worker. No new attack surface.
9. **Upstream returns 200 with non-image body**: existing main-worker `mimeType.startsWith('image/')` check rejects; cron worker mirrors the same check.
10. **bgm.tv outage**: ladder fallback in PR1 + host policy / breaker continue handling. PR3 doesn't change bgm.tv dependency.
11. **DB migration vs cron deploy ordering**: must migrate `MapImageMirrorState` + `MapImageMirrorBootstrap` **before** mirror worker deploy or cron crashes immediately. Hardcoded task order in implementation plan.
12. **`X-Original-Source` content correctness**: contract test asserts it matches `^https://([^/]*\.)?(anitabi\.cn|bgm\.tv)/`.

---

## §10 Testing Strategy

### Test pyramid

| Layer | Scope | Framework | Coverage target |
|---|---|---|---|
| Unit | URL normalization, key computation, variant enumeration, throttle/backoff math | existing project unit framework | each public fn ≥1 happy + ≥1 edge |
| Integration (route) | `imageServe.ts` with R2 mock + upstream mock; full request paths (CF HIT / R2 HIT / fallback / write-through) | Miniflare or existing | 12-cell matrix: 3 upstream states × 2 R2 states × 2 flag combos |
| Integration (cron) | mirror tick: reclaim / bootstrap / seed / throttle / retry | Miniflare scheduled handler | 8 core scenarios (below) |
| Contract | `X-Original-Source` legality across all paths | shared with integration | 3 paths × 2 host types |
| DB schema | migrate up/down clean | Prisma migrate test | both new tables |
| Manual smoke | staging: trigger bootstrap, observe dashboard, run a cron tick | n/a | one-time |

### 8 cron integration scenarios

1. cold-start: empty DB → advanceBootstrap → rows created.
2. interruption recovery: 100 stale `in_progress` rows (lastAttemptAt 10min ago) → `reclaimStale` → all back to pending.
3. seed happy: 10 pending + upstream 200 → 10 R2 objects + rows mirrored.
4. seed 404: upstream 404 → row → `skipped_404`, no retry.
5. seed timeout: upstream sleeps 30s, AbortSignal at 15s → row attempts++, returns to pending.
6. seed maxed: row at attempts=4 + failure → status `failed`.
7. throttle trigger: 10 consecutive timeouts in a window → `__throttle__` row written → subsequent ticks skip.
8. delta cron: 5 new bangumi rows (updatedAt > cursor) → delta run → 5 new pending rows.

### Mock strategy

- R2: Miniflare R2 emulator OR in-memory `Map` implementing `R2Bucket`.
- Postgres: real Postgres test DB + Prisma migrate (no mock).
- Upstream fetch: `vi.spyOn(global, 'fetch')` or nock.
- Cron: Miniflare `triggerScheduled()`.
- Time: `vi.useFakeTimers()` for `lastAttemptAt < 5min` checks.

### Out of test scope

- ❌ R2 network reliability (CF responsibility).
- ❌ Postgres `@@unique` enforcement (Prisma responsibility).
- ❌ `ctx.waitUntil` lifecycle (CF responsibility).
- ❌ Latency benchmarking (PR4/PR5 responsibility).
- ❌ Dashboard UI itself (read-only aggregation; contract guarded at status API).

### Acceptance criteria (production, 7 days post-deploy)

| Metric | Target | Source |
|---|---|---|
| Mirror progress | ≥ 95% mirrored within 7 days | dashboard rates |
| Cron tick failure rate | < 5% (excludes 404 skips) | `MapImageMirrorState` aggregate |
| `image_cache_state: cache_hit_r2_*` ratio (after R2_READ on) | ≥ 80% | `MapImageDiagEvent` aggregate |
| `proxy_fetch_terminal: timeout` rate (vs. 7-day baseline) | down ≥ 70% | dashboard 7-day comparison |
| anitabi complaints | 0 | manual check |

Failure on any metric maps to the §8 rollback playbook.

### CI / deploy gates

- All unit + integration tests pass in < 10 min CI.
- `bun typecheck` / lint pre-deploy.
- `seichigo-predeploy-guard` enforced on both worker deploys.

---

## §11 Out of Scope & Non-Goals

### Explicitly excluded (consolidates "not doing" mentions throughout)

| Excluded | Owner | Reason |
|---|---|---|
| `queue_wait_terminal`, `host_policy_decision`, `first_view_paint`, etc. | PR2 | program plan PR2 scope |
| anitabi probe + alert webhook | PR2 | program plan PR2 scope |
| `targetHostBucket`-grouped stageStats panel | PR2 | program plan PR2 scope |
| LQIP / blurhash | PR4 | perceived-speed work |
| `createImageBitmap` off-thread decode | PR4 | perceived-speed work |
| Tile preconnect / lane split | PR4 | perceived-speed work |
| Adjacent viewport prefetch | PR5 | coverage optimization |
| Mobile budget tuning | PR5 | coverage optimization |
| bgm.tv full prewarm | never | lazy + ladder fallback sufficient |
| R2 → custom CDN domain | never | users always go through main worker |
| Content-addressed keys | never | conflicts with "R2 lookup before upstream" order |
| Cross-host dedup | never | simpler reasoning, negligible cost |
| Active R2 GC | not in v1 | < 200MB / decade waste |
| Periodic cron-refresh (Type B) | not in v1 | Type C (sync-diff invalidation) replaces it |

### Future candidates (not PR3)

| Candidate | Trigger condition |
|---|---|
| Cloudflare Queue replaces cron | cron throttle/retry complexity grows beyond single instance |
| WebP transcoding via CF Images | bandwidth metrics show savings opportunity |
| Multi-region R2 replicas | non-APAC user base grows |
| User-uploaded images via R2 | feature added |
| `lastError` full-text search/clustering | failure-mode diversity exceeds current dashboard |

### Not PR3 acceptance metrics

| Metric | Why not |
|---|---|
| Single-image stall ≤ 2000ms | program-level B-tier; PR3 contributes but PR4+PR5 also required |
| Viewport change → all covers terminal warm < 1500ms | same |
| pan/zoom frame time < 200ms | not image-related; PR4/PR5 |
| Session failure rate < 5% | PR1 already pushed down; PR3 contributes; PR4 finishes the job |

### Philosophy

- PR3 is an **availability + redundancy** project, not a performance project. Metric: "does anitabi shaking still affect users?" — not "how many ms per image?".
- PR3 doesn't pre-optimize unobserved problems (ops tier billing, cross-region replication, queue upgrade).
- PR3 doesn't refactor existing code. `imageServe.ts` security checks, MIME validation, streaming response are preserved as-is; R2 hooks insert at clean boundary points.
- PR3 assumes `anitabi.cn` continues operating. If anitabi disappears permanently, PR3 lets us limp on for 30+ days; recovering data sources is PR6+ scope.

---

## Implementation Plan Inputs (for `superpowers:writing-plans`)

When this spec converts to an implementation plan, the plan should sequence work as:

1. **D0 — anitabi mirror compliance research** (1-2h, gating; updates D5/throttling/UA params)
2. **Pre-implementation verification** (parallel to D0; ~1h)
   - `wrangler rollback` semantics with OpenNext.
   - Sync workflow stability + diff output reliability (per §7).
   - Postgres DB capacity check.
3. **Schema migration** (`MapImageMirrorState` + `MapImageMirrorBootstrap`).
4. **Shared library**: extract `lib/anitabi/imageNormalize.ts` from `imageProxy.ts`.
5. **Main worker modifications** (R2 read, write-through, fallback, headers, new diag stage).
6. **Variant enumeration** (`lib/anitabi/imageMirrorVariants.ts`).
7. **`r2Mirror.ts` shared client**.
8. **Mirror worker scaffold** (`workers/anitabi-mirror/`).
9. **Cron logic** (reclaim, bootstrap advance, seed batch, delta, throttle).
10. **Admin endpoints** (`/bootstrap`, `/status`).
11. **Dashboard panel**.
12. **UI attribution audit + extension**.
13. **Sync diff reconcile hook**.
14. **Tests** (unit, integration, contract).
15. **Runbook** (`docs/runbooks/anitabi-r2-mirror.md`).
16. **Deploy** (DB migrate → mirror worker → main worker → flag rollout per §8).

---

## Cross-references

- Program plan: [docs/superpowers/plans/2026-05-02-map-image-perf-program.md](../plans/2026-05-02-map-image-perf-program.md)
- PR1 (止血): [docs/superpowers/plans/2026-05-02-map-image-pr1-stop-bleeding.md](../plans/2026-05-02-map-image-pr1-stop-bleeding.md)
- PR3 handoff (this session input): the handoff at `.claude/worktrees/beautiful-mccarthy-24ff27/docs/superpowers/plans/2026-05-03-map-image-pr3-handoff.md` (untracked; will be committed as part of PR3 housekeeping)
- Reference session for upstream-bottleneck thesis: `cmoolf34s0000psp75waxbu0q`
