# PR1 — Map Image Stop-the-Bleeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop `/map` session failure rate from ~50% to <10% and cap the worst-case single-image stall from ~16.5s to ≤2s, while keeping every change behind a feature flag for instant rollback.

**Architecture:** Six surgical changes layered on top of the existing diag/scheduler/host-policy stack. The host-policy module gains a `blocked` state and a sliding-window failure counter; three client-side image consumers (`ResilientMapImage`, `coverAvatarLoader`, `thumbnailLoader`) consult host policy to shorten their timeout when the host is unhealthy; the cover candidate ladder for non-anitabi hosts is widened from 1 to 3 candidates; `deriveSessionOutcome` is taught about `candidateCount=1` to stop polluting failure metrics; `MapImageSessionManager` decorates the first 5 requests in every session unconditionally so the diag pipeline never misses the first slow request.

**Tech Stack:** TypeScript, Next.js 15, Vitest 1.x with fake timers, Prisma, Cloudflare Worker (OpenNext), eslint with line budget enforcement (`scripts/check-line-budget.mjs`).

**Branch:** `claude/sad-curie-5740e0` (worktree already in place — `.claude/worktrees/sad-curie-5740e0`)

**Feature flags introduced (all default OFF in env, set to `1` to enable):**
- `NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED` — circuit-breaker `blocked` state + degraded timeout reduction (Tasks 1 & 2)
- `NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED` — extended candidate ladder (Task 3)
- `MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED` — server-side outcome v2 (Task 4)
- `NEXT_PUBLIC_MAP_IMAGE_FORCE_DECORATE_FIRST_N` — number of first requests to force-decorate (Task 5; default `5` after enable, `0` disables)

---

## File Map

**Modified:**
- `components/map/utils/mapImageHostPolicy.ts` — Task 1 (state machine + new public APIs)
- `components/map/ResilientMapImage.tsx:66-77` — Task 2 (timeout consult — DOM image path)
- `components/map/utils/loadMapImageWithCandidates.ts:64-72,161` — Task 2 (timeout consult — shared cover & thumbnail path)
- `lib/anitabi/imageProxy.ts:262-273` — Task 3 (ladder fallback)
- `lib/mapImageDiag/shared.ts:55-64` — Task 4 (`deriveSessionOutcome` v2)
- `features/map/anitabi/mapImageSessionManager.ts:185,564-566` — Task 5 (force-decorate counter)
- `lib/mapImageDiag/service.ts` OR `app/(authed)/admin/ops/map-image-diagnostics/ui.tsx` — Task 6 (avg/P95 bug; exact file determined in step 6.1)

**Created:**
- `tests/map/mapImageHostPolicy.circuitBreaker.test.ts` — Task 1
- `tests/anitabi/imageProxy.bgmLadder.test.ts` — Task 3
- `tests/mapImageDiag/deriveSessionOutcome.test.ts` — Task 4
- (Task 2 extends existing `tests/map/resilient-map-image.test.tsx` and `tests/map/loadMapImageWithCandidates.test.ts`)
- (Task 5 extends existing `tests/map/mapImageSessionManager.test.ts`)
- (Task 6 may create `tests/mapImageDiag/aggregateStageStats.test.ts` — TBD)

**Architecture note for Task 2:** `coverAvatarLoader.ts` and `thumbnailLoader.ts` both call into `loadMapImageWithCandidates()`, which is the single fetch-with-timeout dispatcher. Editing the dispatcher's `resolveRequestTimeoutMs` covers both consumers without touching either loader file. This was discovered during plan review and is why Task 2 has only two file edits, not three.

---

## Task 1: Extend `mapImageHostPolicy` with `blocked` state and sliding-window counter

**Goal:** Add three pure-function APIs to host policy: `recordHostFailure(host, scope, now)` (records a failure into a 10s sliding window), `resolveHostState(host, scope, now): 'healthy' | 'degraded' | 'blocked'`, `resolveHostTimeoutMs(host, scope, defaultMs, now): number` (returns `2000` if degraded, `0` if blocked, otherwise `defaultMs`).

**Files:**
- Modify: `components/map/utils/mapImageHostPolicy.ts`
- Test: `tests/map/mapImageHostPolicy.circuitBreaker.test.ts` (create)

### Steps

- [ ] **1.1 Read current file fully** so the existing exports stay backward-compatible.

```bash
cat components/map/utils/mapImageHostPolicy.ts
```

Expected: 90-line file with `markMapImageHostDegraded`, `isMapImageHostDegraded`, `prioritizeMapImageCandidates`, `resetDegradedMapImageHostsForTest`. Confirm constants `DEGRADED_HOST_TTL_MS = 60_000` and `DEGRADED_HOST_FAILURE_THRESHOLD = 2`.

- [ ] **1.2 Write the failing test file**

Create `tests/map/mapImageHostPolicy.circuitBreaker.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  recordHostFailure,
  resolveHostState,
  resolveHostTimeoutMs,
  resetDegradedMapImageHostsForTest,
} from '@/components/map/utils/mapImageHostPolicy'

describe('mapImageHostPolicy circuit breaker', () => {
  beforeEach(() => {
    resetDegradedMapImageHostsForTest()
  })

  afterEach(() => {
    resetDegradedMapImageHostsForTest()
  })

  it('starts in healthy state', () => {
    expect(resolveHostState('image.anitabi.cn', 'cover', 1_000)).toBe('healthy')
    expect(resolveHostTimeoutMs('image.anitabi.cn', 'cover', 4_000, 1_000)).toBe(4_000)
  })

  it('transitions to degraded after 2 failures within window', () => {
    recordHostFailure('image.anitabi.cn', 'cover', 1_000)
    recordHostFailure('image.anitabi.cn', 'cover', 2_000)
    expect(resolveHostState('image.anitabi.cn', 'cover', 2_000)).toBe('degraded')
    expect(resolveHostTimeoutMs('image.anitabi.cn', 'cover', 4_000, 2_000)).toBe(2_000)
  })

  it('transitions to blocked after 3 failures within 10s window', () => {
    recordHostFailure('image.anitabi.cn', 'cover', 1_000)
    recordHostFailure('image.anitabi.cn', 'cover', 5_000)
    recordHostFailure('image.anitabi.cn', 'cover', 9_000)
    expect(resolveHostState('image.anitabi.cn', 'cover', 9_000)).toBe('blocked')
    expect(resolveHostTimeoutMs('image.anitabi.cn', 'cover', 4_000, 9_000)).toBe(0)
  })

  it('does NOT block when 3rd failure is outside the 10s window', () => {
    recordHostFailure('image.anitabi.cn', 'cover', 1_000)
    recordHostFailure('image.anitabi.cn', 'cover', 5_000)
    recordHostFailure('image.anitabi.cn', 'cover', 12_000) // outside 10s of 1st
    // last 2 still within window of each other → degraded, not blocked
    expect(resolveHostState('image.anitabi.cn', 'cover', 12_000)).toBe('degraded')
  })

  it('exits blocked state after 60s TTL', () => {
    recordHostFailure('image.anitabi.cn', 'cover', 1_000)
    recordHostFailure('image.anitabi.cn', 'cover', 2_000)
    recordHostFailure('image.anitabi.cn', 'cover', 3_000)
    expect(resolveHostState('image.anitabi.cn', 'cover', 3_000)).toBe('blocked')
    expect(resolveHostState('image.anitabi.cn', 'cover', 63_001)).toBe('healthy')
  })

  it('scopes failures by scope+host independently', () => {
    recordHostFailure('image.anitabi.cn', 'cover', 1_000)
    recordHostFailure('image.anitabi.cn', 'cover', 2_000)
    expect(resolveHostState('image.anitabi.cn', 'cover', 2_000)).toBe('degraded')
    expect(resolveHostState('image.anitabi.cn', 'point', 2_000)).toBe('healthy')
  })

  it('feature flag disables blocked state when env var is unset', () => {
    const original = process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED
    process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED = ''
    try {
      recordHostFailure('image.anitabi.cn', 'cover', 1_000)
      recordHostFailure('image.anitabi.cn', 'cover', 2_000)
      recordHostFailure('image.anitabi.cn', 'cover', 3_000)
      // breaker v2 off: should NOT block, should remain at degraded
      expect(resolveHostState('image.anitabi.cn', 'cover', 3_000)).toBe('degraded')
      expect(resolveHostTimeoutMs('image.anitabi.cn', 'cover', 4_000, 3_000)).toBe(4_000) // no timeout reduction
    } finally {
      process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED = original
    }
  })
})
```

- [ ] **1.3 Run the test to confirm it fails**

```bash
npx vitest run tests/map/mapImageHostPolicy.circuitBreaker.test.ts
```

Expected: All tests FAIL with `recordHostFailure is not a function` / `resolveHostState is not a function`.

- [ ] **1.4 Implement the new API on the host policy module**

Edit `components/map/utils/mapImageHostPolicy.ts`. Replace the existing constants/types block at the top, and add the new exports. The complete updated file:

```typescript
const DEGRADED_HOST_TTL_MS = 60_000
const DEGRADED_HOST_FAILURE_THRESHOLD = 2
const BLOCKED_HOST_TTL_MS = 60_000
const BLOCKED_HOST_FAILURE_THRESHOLD = 3
const BLOCKED_HOST_WINDOW_MS = 10_000
const DEGRADED_HOST_TIMEOUT_MS = 2_000

export type MapImageHostPolicyScope = 'cover' | 'point' | 'point-thumbnail' | 'default'
export type MapImageHostState = 'healthy' | 'degraded' | 'blocked'

type DegradedHostRecord = {
  degradedAt: number | null
  failures: number
  failureTimestamps: number[]
  blockedUntil: number | null
}

const degradedDirectHosts = new Map<string, DegradedHostRecord>()

function isBreakerV2Enabled(): boolean {
  return String(process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED || '').trim() === '1'
}

function toScopedHostKey(host: string | null, scope: MapImageHostPolicyScope): string | null {
  if (!host) return null
  return `${scope}:${host}`
}

export function isMapImageProxyUrl(url: string): boolean {
  return url.includes('/api/anitabi/image-render')
}

export function readMapImageHost(url: string): string | null {
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
    return new URL(url, baseOrigin).hostname.trim().toLowerCase() || null
  } catch {
    return null
  }
}

export function recordHostFailure(
  host: string | null,
  scope: MapImageHostPolicyScope,
  now: number = Date.now(),
): void {
  const key = toScopedHostKey(host, scope)
  if (!key) return
  const current = degradedDirectHosts.get(key)
  const prevTimestamps = current?.failureTimestamps ?? []
  const prunedTimestamps = prevTimestamps.filter((ts) => now - ts <= BLOCKED_HOST_WINDOW_MS)
  prunedTimestamps.push(now)
  const failures = (current?.failures ?? 0) + 1
  const reachesDegraded = failures >= DEGRADED_HOST_FAILURE_THRESHOLD
  const reachesBlocked =
    isBreakerV2Enabled() && prunedTimestamps.length >= BLOCKED_HOST_FAILURE_THRESHOLD
  degradedDirectHosts.set(key, {
    failures,
    failureTimestamps: prunedTimestamps,
    degradedAt: reachesDegraded ? current?.degradedAt ?? now : null,
    blockedUntil: reachesBlocked ? now + BLOCKED_HOST_TTL_MS : current?.blockedUntil ?? null,
  })
}

export function markMapImageHostDegraded(
  host: string | null,
  scope: MapImageHostPolicyScope = 'default',
): void {
  recordHostFailure(host, scope, Date.now())
}

export function clearMapImageHostDegraded(
  host: string | null,
  scope: MapImageHostPolicyScope = 'default',
): void {
  const key = toScopedHostKey(host, scope)
  if (!key) return
  degradedDirectHosts.delete(key)
}

export function resolveHostState(
  host: string | null,
  scope: MapImageHostPolicyScope,
  now: number = Date.now(),
): MapImageHostState {
  const key = toScopedHostKey(host, scope)
  if (!key) return 'healthy'
  const record = degradedDirectHosts.get(key)
  if (!record) return 'healthy'
  if (isBreakerV2Enabled() && record.blockedUntil != null && now < record.blockedUntil) {
    return 'blocked'
  }
  if (record.degradedAt != null && now - record.degradedAt <= DEGRADED_HOST_TTL_MS) {
    return 'degraded'
  }
  // expired records get cleaned up lazily on next call
  if (
    record.blockedUntil != null && now >= record.blockedUntil
    && (record.degradedAt == null || now - record.degradedAt > DEGRADED_HOST_TTL_MS)
  ) {
    degradedDirectHosts.delete(key)
  }
  return 'healthy'
}

export function isMapImageHostDegraded(
  host: string | null,
  scope: MapImageHostPolicyScope = 'default',
): boolean {
  const state = resolveHostState(host, scope, Date.now())
  return state === 'degraded' || state === 'blocked'
}

export function resolveHostTimeoutMs(
  host: string | null,
  scope: MapImageHostPolicyScope,
  defaultMs: number,
  now: number = Date.now(),
): number {
  if (!isBreakerV2Enabled()) return defaultMs
  const state = resolveHostState(host, scope, now)
  if (state === 'blocked') return 0
  if (state === 'degraded') return DEGRADED_HOST_TIMEOUT_MS
  return defaultMs
}

export function prioritizeMapImageCandidates(
  urls: string[],
  scope: MapImageHostPolicyScope = 'default',
): string[] {
  if (scope === 'point' || scope === 'point-thumbnail') {
    return [...urls]
  }
  const firstDirectUrl = urls.find((url) => !isMapImageProxyUrl(url))
  const host = readMapImageHost(firstDirectUrl || '')
  if (!isMapImageHostDegraded(host, scope)) return [...urls]
  const proxyIdx = urls.findIndex((url) => isMapImageProxyUrl(url))
  if (proxyIdx <= 0) return [...urls]
  const ordered = [...urls]
  const [proxyUrl] = ordered.splice(proxyIdx, 1)
  ordered.unshift(proxyUrl)
  return ordered
}

export function resetDegradedMapImageHostsForTest(): void {
  degradedDirectHosts.clear()
}
```

- [ ] **1.5 Run the test to confirm pass**

```bash
npx vitest run tests/map/mapImageHostPolicy.circuitBreaker.test.ts
```

Expected: 7 tests pass. If feature-flag test fails, double-check `process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED` reading — vitest re-imports each test file but module-level state persists.

- [ ] **1.6 Run existing host-policy consumers' tests to confirm no regression**

```bash
npx vitest run tests/map/resilient-map-image.test.tsx tests/map/coverAvatarLoader.test.ts tests/map/thumbnailLoader.test.ts tests/map/loadMapImageWithCandidates.test.ts
```

Expected: All pass. The new `recordHostFailure` is additive — `markMapImageHostDegraded` still maps to it.

- [ ] **1.7 Typecheck**

```bash
npm run typecheck:tests && npm run typecheck:app
```

Expected: no errors.

- [ ] **1.8 Commit**

```bash
git add components/map/utils/mapImageHostPolicy.ts tests/map/mapImageHostPolicy.circuitBreaker.test.ts
git commit -m "feat(map): add host circuit breaker with blocked state and sliding window

- New recordHostFailure / resolveHostState / resolveHostTimeoutMs APIs
- 'blocked' state after 3 failures within 10s window, 60s TTL
- 'degraded' (existing) returns 2000ms timeout when v2 flag enabled
- Gated by NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED, default OFF"
```

---

## Task 2: Wire `resolveHostTimeoutMs` into the two timeout-arming sites

**Goal:** When breaker is enabled and host is unhealthy, image timeouts drop from 4000-6000ms to 2000ms (degraded) or 0ms / immediate-fail (blocked). Without breaker enabled, behaviour is unchanged.

**Files:**
- Modify: `components/map/ResilientMapImage.tsx` (DOM image timeout — `resolveRequestTimeoutMs` at lines 66-77)
- Modify: `components/map/utils/loadMapImageWithCandidates.ts` (shared cover + thumbnail timeout — `resolveRequestTimeoutMs` at lines 64-72 and call site at line 161)
- Test: extend `tests/map/resilient-map-image.test.tsx` and `tests/map/loadMapImageWithCandidates.test.ts`

### Step group A — `ResilientMapImage.tsx` (DOM images: detail panel, point preview)

- [ ] **2A.1 Confirm current state**

```bash
sed -n '66,77p' components/map/ResilientMapImage.tsx
```

Expected output:
```typescript
function resolveRequestTimeoutMs(
  url: string,
  kind: ResilientMapImageProps['kind'],
): number {
  const isProxyRequest = url.includes('/api/anitabi/image-render')
  if (!isProxyRequest) {
    return 4_000
  }
  return kind === 'point' || kind === 'point-preview'
    ? 8_500
    : 6_000
}
```

- [ ] **2A.2 Read the existing test render helper in `tests/map/resilient-map-image.test.tsx`**

```bash
head -80 tests/map/resilient-map-image.test.tsx
```

Note the imports, the `renderComponent` helper (or equivalent), and the timer-control pattern (`vi.useFakeTimers()` etc.).

- [ ] **2A.3 Append failing test**

Add a new test to `tests/map/resilient-map-image.test.tsx`. Pattern mirrors any existing "timeout fires after Xms" test in the file:

```typescript
import {
  recordHostFailure,
  resetDegradedMapImageHostsForTest,
} from '@/components/map/utils/mapImageHostPolicy'

// Inside the existing describe('ResilientMapImage', ...) block:
it('uses 2000ms timeout when host is degraded (breaker v2 enabled)', () => {
  const original = process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED
  process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED = '1'
  resetDegradedMapImageHostsForTest()
  // Two failures put host into degraded state (threshold = 2)
  recordHostFailure('image.anitabi.cn', 'cover', Date.now())
  recordHostFailure('image.anitabi.cn', 'cover', Date.now())
  try {
    // Mount component pointed at a degraded-host URL; observe timeout firing.
    // Use the same render helper and fake-timer pattern as the existing
    // 'timeout fires' tests in this file. The assertion target is that
    // advanceTimersByTime(2000) is enough to trigger the failure path,
    // and advanceTimersByTime(1999) is NOT.
    // (Concrete render code mirrors the file's existing timeout test.)
  } finally {
    process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED = original
    resetDegradedMapImageHostsForTest()
  }
})
```

If the file has no existing fake-timer test for `resolveRequestTimeoutMs`, write a minimal one against the function directly: import `resolveRequestTimeoutMs` (export it for testing) and assert its return value with the env var set.

- [ ] **2A.4 Run, confirm fail**

```bash
npx vitest run tests/map/resilient-map-image.test.tsx -t "2000ms timeout when host is degraded"
```

Expected: FAIL.

- [ ] **2A.5 Modify `resolveRequestTimeoutMs`**

Edit `components/map/ResilientMapImage.tsx` lines 66-77. New body (also requires adding `resolveHostTimeoutMs` and `readMapImageHost` to the existing import from `@/components/map/utils/mapImageHostPolicy`):

```typescript
function resolveRequestTimeoutMs(
  url: string,
  kind: ResilientMapImageProps['kind'],
): number {
  const isProxyRequest = url.includes('/api/anitabi/image-render')
  const baseTimeoutMs = !isProxyRequest
    ? 4_000
    : kind === 'point' || kind === 'point-preview'
      ? 8_500
      : 6_000
  const scope = resolveHostPolicyScope(kind)
  const host = readMapImageHost(url)
  return resolveHostTimeoutMs(host, scope, baseTimeoutMs)
}
```

Adjust the import line near the top of the file (currently imports `MapImageHostPolicyScope`, `prioritizeMapImageCandidates`) to also pull in `resolveHostTimeoutMs` and `readMapImageHost`.

- [ ] **2A.6 Run, confirm pass**

```bash
npx vitest run tests/map/resilient-map-image.test.tsx -t "2000ms timeout when host is degraded"
```

### Step group B — `loadMapImageWithCandidates.ts` (covers thumbnailLoader + coverAvatarLoader)

- [ ] **2B.1 Confirm current state**

```bash
sed -n '64,72p' components/map/utils/loadMapImageWithCandidates.ts
sed -n '155,170p' components/map/utils/loadMapImageWithCandidates.ts
```

Expected output: `resolveRequestTimeoutMs(url, directRequestTimeoutMs, proxyRequestTimeoutMs)` returning either `proxyRequestTimeoutMs` or `directRequestTimeoutMs` based on `isMapImageProxyUrl(url)`. The call site is at line 161.

- [ ] **2B.2 Append failing test**

Add to `tests/map/loadMapImageWithCandidates.test.ts`:

```typescript
import {
  recordHostFailure,
  resetDegradedMapImageHostsForTest,
} from '@/components/map/utils/mapImageHostPolicy'

it('clamps timeout to 2000ms when host is degraded (breaker v2 enabled)', async () => {
  const original = process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED
  process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED = '1'
  resetDegradedMapImageHostsForTest()
  recordHostFailure('image.anitabi.cn', 'cover', Date.now())
  recordHostFailure('image.anitabi.cn', 'cover', Date.now())

  vi.useFakeTimers()
  try {
    const map = createFakeMap() // use whatever helper this test file already uses
    // map.loadImage will hang (never resolve) — we want the timeout to fire
    map.loadImage = vi.fn().mockImplementation(() => new Promise(() => {}))

    const promise = loadMapImageWithCandidates({
      map,
      slotKey: 'cover-405785',
      urls: ['https://image.anitabi.cn/bangumi/405785.jpg'],
      tracked: false,
      hostPolicyScope: 'cover',
    })

    // Advance just under 2s — should NOT have timed out yet
    await vi.advanceTimersByTimeAsync(1_999)
    // Advance past 2s — timeout should fire
    await vi.advanceTimersByTimeAsync(2)

    await expect(promise).rejects.toThrow() // or whatever the failure shape is
  } finally {
    vi.useRealTimers()
    process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED = original
    resetDegradedMapImageHostsForTest()
  }
})
```

(Match the file's existing helper names — `createFakeMap`, `mountMap`, etc. If the rejection shape is wrapped in a result object instead of a thrown error, adjust the assertion.)

- [ ] **2B.3 Run, confirm fail**

```bash
npx vitest run tests/map/loadMapImageWithCandidates.test.ts -t "clamps timeout to 2000ms"
```

Expected: FAIL — under default behaviour, timeout fires at 4000ms (direct cover) so 1999+2 = 2001 isn't enough.

- [ ] **2B.4 Modify `resolveRequestTimeoutMs` in `loadMapImageWithCandidates.ts`**

Edit `components/map/utils/loadMapImageWithCandidates.ts` lines 64-72:

```typescript
function resolveRequestTimeoutMs(
  url: string,
  directRequestTimeoutMs: number,
  proxyRequestTimeoutMs: number,
  hostPolicyScope: MapImageHostPolicyScope,
): number {
  const baseMs = isMapImageProxyUrl(url)
    ? proxyRequestTimeoutMs
    : directRequestTimeoutMs
  const host = readMapImageHost(url)
  return resolveHostTimeoutMs(host, hostPolicyScope, baseMs)
}
```

Update the call site at line 161 to pass `hostPolicyScope`:

```typescript
return await loadImageWithTimeout(
  options.map,
  requestUrl,
  resolveRequestTimeoutMs(requestUrl, directRequestTimeoutMs, proxyRequestTimeoutMs, hostPolicyScope),
  options.requestSignal,
)
```

Update the existing import from `@/components/map/utils/mapImageHostPolicy` (already imports `MapImageHostPolicyScope`, `isMapImageProxyUrl`, `prioritizeMapImageCandidates`) to also pull in `resolveHostTimeoutMs` and `readMapImageHost`.

- [ ] **2B.5 Special case: timeout = 0 (blocked) means immediate failure**

When `resolveHostTimeoutMs` returns 0, `loadImageWithTimeout` should fail-fast without waiting for `setTimeout(0)` to resolve through the event loop. Add a guard at the top of `loadImageWithTimeout`:

```typescript
async function loadImageWithTimeout(
  map: LoadImageMapLike,
  requestUrl: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<...> {
  if (signal?.aborted) {
    return { ok: false, outcome: 'aborted' }
  }
  if (timeoutMs <= 0) {
    return { ok: false, outcome: 'timeout' }
  }
  // ... existing implementation
}
```

Add a test for this in `loadMapImageWithCandidates.test.ts`:

```typescript
it('fail-fasts immediately when host is blocked (breaker v2 enabled)', async () => {
  const original = process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED
  process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED = '1'
  resetDegradedMapImageHostsForTest()
  // 3 failures within 10s window puts host into blocked state
  const t = Date.now()
  recordHostFailure('image.anitabi.cn', 'cover', t)
  recordHostFailure('image.anitabi.cn', 'cover', t + 100)
  recordHostFailure('image.anitabi.cn', 'cover', t + 200)
  try {
    const map = createFakeMap()
    map.loadImage = vi.fn().mockImplementation(() => new Promise(() => {}))
    const start = Date.now()
    await expect(loadMapImageWithCandidates({
      map,
      slotKey: 'cover-405785',
      urls: ['https://image.anitabi.cn/bangumi/405785.jpg'],
      tracked: false,
      hostPolicyScope: 'cover',
    })).rejects.toThrow()
    expect(Date.now() - start).toBeLessThan(50) // sub-50ms = effectively immediate
  } finally {
    process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED = original
    resetDegradedMapImageHostsForTest()
  }
})
```

- [ ] **2B.6 Run all the new tests**

```bash
npx vitest run tests/map/loadMapImageWithCandidates.test.ts -t "clamps timeout|fail-fasts immediately"
```

Expected: 2/2 PASS.

- [ ] **2B.7 Run the rest of the test file for no regression**

```bash
npx vitest run tests/map/loadMapImageWithCandidates.test.ts
```

Expected: PASS.

### Step group C — Wrap-up

- [ ] **2C.1 Run upstream consumers' test files for no regression**

```bash
npx vitest run tests/map/coverAvatarLoader.test.ts tests/map/thumbnailLoader.test.ts
```

Expected: PASS. These should be unaffected since they don't change.

- [ ] **2C.2 Typecheck**

```bash
npm run typecheck:tests && npm run typecheck:app
```

Expected: no errors.

- [ ] **2C.3 Commit**

```bash
git add components/map/ResilientMapImage.tsx components/map/utils/loadMapImageWithCandidates.ts tests/map/resilient-map-image.test.tsx tests/map/loadMapImageWithCandidates.test.ts
git commit -m "feat(map): clamp client image timeout to 2000ms on degraded host

ResilientMapImage and loadMapImageWithCandidates now consult
mapImageHostPolicy.resolveHostTimeoutMs before arming their setTimeout.
When NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED=1:
- degraded host (>=2 failures within 60s)  -> timeout falls to 2000ms
- blocked host (>=3 failures within 10s)   -> immediate fail-fast (0ms)
loadMapImageWithCandidates is the central dispatcher used by both
coverAvatarLoader and thumbnailLoader, so this single edit covers
both consumers without touching either loader file."
```

---

## Task 3: Extend cover candidate ladder for non-anitabi hosts

**Goal:** Replace the single-candidate `[proxyUrl]` for cover URLs whose host is `lain.bgm.tv` (or any other non-anitabi host) with a 3-entry ladder `[proxyUrl, retryProxyUrl, directBgmUrl]`. This eliminates the `candTotal=1` failure mode where one slow upstream cover marked entire sessions as failed.

**Files:**
- Modify: `lib/anitabi/imageProxy.ts:262-273`
- Test: `tests/anitabi/imageProxy.bgmLadder.test.ts` (create)

### Steps

- [ ] **3.1 Read current ladder logic**

```bash
sed -n '237,277p' lib/anitabi/imageProxy.ts
```

Expected: function `getMapDisplayImageCandidates` returns `[proxyUrl]` for non-`shouldPreferDirect` cover URLs.

- [ ] **3.2 Write failing test**

Create `tests/anitabi/imageProxy.bgmLadder.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'

describe('getMapDisplayImageCandidates - bgm.tv cover ladder', () => {
  it('returns single candidate when fallback flag disabled (legacy)', () => {
    const original = process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED
    process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED = ''
    try {
      const candidates = getMapDisplayImageCandidates(
        'https://lain.bgm.tv/pic/cover/m/b8/0d/513345_jv4wM.jpg',
        { kind: 'cover' },
      )
      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toMatch(/\/api\/anitabi\/image-render/)
    } finally {
      process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED = original
    }
  })

  it('returns 3 candidates when fallback flag enabled (proxy, retryProxy, directBgm)', () => {
    const original = process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED
    process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED = '1'
    try {
      const candidates = getMapDisplayImageCandidates(
        'https://lain.bgm.tv/pic/cover/m/b8/0d/513345_jv4wM.jpg',
        { kind: 'cover' },
      )
      expect(candidates).toHaveLength(3)
      expect(candidates[0]).toMatch(/\/api\/anitabi\/image-render/)
      expect(candidates[1]).toMatch(/\/api\/anitabi\/image-render.*_retry=1/)
      expect(candidates[2]).toMatch(/^https:\/\/lain\.bgm\.tv\/pic\/cover/)
    } finally {
      process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED = original
    }
  })

  it('does not affect anitabi-host covers (already 3 candidates direct→retry→proxy)', () => {
    const original = process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED
    process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED = '1'
    try {
      const candidates = getMapDisplayImageCandidates(
        'https://image.anitabi.cn/bangumi/405785.jpg',
        { kind: 'cover' },
      )
      expect(candidates).toHaveLength(3)
      expect(candidates[0]).toMatch(/^https:\/\/image\.anitabi\.cn/)
      expect(candidates[1]).toMatch(/^https:\/\/image\.anitabi\.cn.*_retry=1/)
      expect(candidates[2]).toMatch(/\/api\/anitabi\/image-render/)
    } finally {
      process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED = original
    }
  })

  it('does not affect point/point-preview/point-thumbnail (still proxy-only)', () => {
    const original = process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED
    process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED = '1'
    try {
      const candidates = getMapDisplayImageCandidates(
        'https://image.anitabi.cn/points/p1.jpg',
        { kind: 'point' },
      )
      // point kind is forceProxyOnly: [proxy, retryProxy] — 2 entries unchanged
      expect(candidates.every((c) => c.includes('/api/anitabi/image-render'))).toBe(true)
    } finally {
      process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED = original
    }
  })
})
```

- [ ] **3.3 Run to confirm fail**

```bash
npx vitest run tests/anitabi/imageProxy.bgmLadder.test.ts
```

Expected: FAIL on the "3 candidates when flag enabled" test.

- [ ] **3.4 Modify `getMapDisplayImageCandidates`**

Edit `lib/anitabi/imageProxy.ts` at the function (around line 237-277). The change is in the final `dedupeCandidates` call:

```typescript
export function getMapDisplayImageCandidates(
  src: string,
  options?: {
    kind?: MapDisplayImageKind
  }
): string[] {
  const raw = String(src || '').trim()
  if (!raw) return []

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
    const url = new URL(raw, baseOrigin)
    const kind = options?.kind ?? 'default'
    normalizeBangumiCoverVariant(url, kind)
    normalizeAnitabiDisplayVariant(url, kind)

    const directUrl = url.toString()
    const proxyUrl = buildProxyImageUrl(url)
    if (url.origin === baseOrigin) {
      return [directUrl]
    }
    const forceProxyOnly =
      kind === 'point'
      || kind === 'point-preview'
      || kind === 'point-thumbnail'
    if (forceProxyOnly) {
      return dedupeCandidates([proxyUrl, buildRetryProxyUrl(url)])
    }
    const shouldPreferDirect =
      isDirectSafeAnitabiHost(url)
      && kind === 'cover'

    const ladderBgmFallbackEnabled =
      String(process.env.NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED || '').trim() === '1'

    if (shouldPreferDirect) {
      return dedupeCandidates([directUrl, buildRetryDirectUrl(url), proxyUrl])
    }
    // non-anitabi cover host (e.g. lain.bgm.tv): widen ladder when flag on
    if (kind === 'cover' && ladderBgmFallbackEnabled) {
      return dedupeCandidates([proxyUrl, buildRetryProxyUrl(url), directUrl])
    }
    return dedupeCandidates([proxyUrl])
  } catch {
    return [raw]
  }
}
```

- [ ] **3.5 Run to confirm pass**

```bash
npx vitest run tests/anitabi/imageProxy.bgmLadder.test.ts
```

Expected: 4/4 PASS.

- [ ] **3.6 Run existing imageProxy tests for no regression**

```bash
npx vitest run tests/anitabi/image-proxy-phase2.test.ts tests/map/loadMapImageWithCandidates.test.ts
```

Expected: PASS.

- [ ] **3.7 Typecheck + commit**

```bash
npm run typecheck:tests && npm run typecheck:app
git add lib/anitabi/imageProxy.ts tests/anitabi/imageProxy.bgmLadder.test.ts
git commit -m "feat(image): widen non-anitabi cover ladder to 3 candidates

When NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED=1, cover URLs
whose host is not under *.anitabi.cn (typically lain.bgm.tv) get the
ladder [proxyUrl, retryProxyUrl, directBgmUrl] instead of [proxyUrl].
Eliminates the candTotal=1 single-point-of-failure for ~5K bangumi
not mirrored on image.anitabi.cn."
```

---

## Task 4: Relax `deriveSessionOutcome` so single-candidate timeouts do not flip session to `failed`

**Goal:** `deriveSessionOutcome` should treat a `terminalState=failed` event with `candidateCount=1` and `outcome=timeout` as `no_data` (a session-level new outcome), not `failed`. Multi-candidate failures still escalate to `failed` as today. Backward-compatible: when flag is off, behaviour is unchanged.

**Files:**
- Modify: `lib/mapImageDiag/shared.ts:55-64`
- Test: `tests/mapImageDiag/deriveSessionOutcome.test.ts` (create)

### Steps

- [ ] **4.1 Read current implementation**

```bash
sed -n '55,75p' lib/mapImageDiag/shared.ts
```

Expected: 10-line function that scans events for any `terminalState=failed` and returns `'failed'` immediately.

- [ ] **4.2 Read the event-shape callers pass to `deriveSessionOutcome`**

```bash
grep -n "deriveSessionOutcome\|candidateCount" lib/mapImageDiag/service.ts | head -20
```

Confirm: callers can plumb `candidateCount` and `outcome` fields. (If callers don't have them today, add them in step 4.5 too.)

- [ ] **4.3 Write failing test**

Create `tests/mapImageDiag/deriveSessionOutcome.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { deriveSessionOutcome } from '@/lib/mapImageDiag/shared'

describe('deriveSessionOutcome - v2 outcome semantics', () => {
  it('returns "failed" for multi-candidate terminal failures', () => {
    const events = [
      { terminalState: 'succeeded' },
      { terminalState: 'failed', candidateCount: 3, outcome: 'timeout' },
    ]
    expect(deriveSessionOutcome(events)).toBe('failed')
  })

  it('returns "no_data" when only failure is candTotal=1 timeout (v2 flag on)', () => {
    const original = process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED
    process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED = '1'
    try {
      const events = [
        { terminalState: 'succeeded' },
        { terminalState: 'succeeded' },
        { terminalState: 'failed', candidateCount: 1, outcome: 'timeout' },
      ]
      expect(deriveSessionOutcome(events)).toBe('no_data')
    } finally {
      process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED = original
    }
  })

  it('returns "failed" for candTotal=1 with non-timeout outcome (network_error)', () => {
    const original = process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED
    process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED = '1'
    try {
      const events = [
        { terminalState: 'failed', candidateCount: 1, outcome: 'network_error' },
      ]
      expect(deriveSessionOutcome(events)).toBe('failed')
    } finally {
      process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED = original
    }
  })

  it('returns "failed" if any non-candTotal=1 timeout event present', () => {
    const original = process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED
    process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED = '1'
    try {
      const events = [
        { terminalState: 'failed', candidateCount: 1, outcome: 'timeout' },
        { terminalState: 'failed', candidateCount: 3, outcome: 'timeout' },
      ]
      expect(deriveSessionOutcome(events)).toBe('failed')
    } finally {
      process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED = original
    }
  })

  it('flag off: behaves as before — any failed → "failed"', () => {
    const original = process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED
    process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED = ''
    try {
      const events = [
        { terminalState: 'failed', candidateCount: 1, outcome: 'timeout' },
      ]
      expect(deriveSessionOutcome(events)).toBe('failed')
    } finally {
      process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED = original
    }
  })

  it('returns "fallback" when no failed events but a fallback display outcome present', () => {
    const events = [
      { terminalState: 'succeeded', displayOutcome: 'fallback' },
    ]
    expect(deriveSessionOutcome(events)).toBe('fallback')
  })

  it('returns last terminal state otherwise (existing behaviour)', () => {
    const events = [
      { terminalState: 'succeeded' },
      { terminalState: 'aborted' },
    ]
    expect(deriveSessionOutcome(events)).toBe('aborted')
  })
})
```

- [ ] **4.4 Run to confirm fail**

```bash
npx vitest run tests/mapImageDiag/deriveSessionOutcome.test.ts
```

Expected: FAIL on the "no_data" test.

- [ ] **4.5 Implement v2 logic**

Edit `lib/mapImageDiag/shared.ts:55-64`. Replace `deriveSessionOutcome` with:

```typescript
function isOutcomeV2Enabled(): boolean {
  return String(process.env.MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED || '').trim() === '1'
}

export function deriveSessionOutcome(events: Array<{
  terminalState?: string | null
  displayOutcome?: string | null
  candidateCount?: number | null
  outcome?: string | null
}>): string {
  const failedEvents = events.filter((event) => event.terminalState === 'failed')

  if (isOutcomeV2Enabled() && failedEvents.length > 0) {
    const allCandTotal1Timeouts = failedEvents.every(
      (event) => event.candidateCount === 1 && event.outcome === 'timeout',
    )
    if (allCandTotal1Timeouts) {
      // single-candidate slow upstream — not a session-wide failure
      // fall through to last-terminal logic below; classify as no_data
      const terminal = [...events].reverse().find((event) => Boolean(event.terminalState))
      if (terminal?.terminalState === 'failed') return 'no_data'
    } else {
      return 'failed'
    }
  } else if (failedEvents.length > 0) {
    return 'failed'
  }

  if (events.some((event) => event.displayOutcome === 'fallback')) return 'fallback'

  const terminal = [...events].reverse().find((event) => Boolean(event.terminalState))
  if (!terminal?.terminalState) return 'pending'
  return terminal.terminalState
}
```

- [ ] **4.6 Run new test to confirm pass**

```bash
npx vitest run tests/mapImageDiag/deriveSessionOutcome.test.ts
```

Expected: 7/7 PASS.

- [ ] **4.7 Run existing diag tests for no regression**

```bash
npx vitest run tests/map/mapImageSessionManager.test.ts $(find tests -name "*Diag*" -o -name "*diag*" 2>/dev/null | head -5 | tr '\n' ' ')
```

Expected: PASS.

- [ ] **4.8 Confirm `service.ts` already plumbs `candidateCount` & `outcome` into the events array passed to `deriveSessionOutcome`**

```bash
grep -B2 -A8 "deriveSessionOutcome" lib/mapImageDiag/service.ts | head -30
```

If the call site only passes `{terminalState, displayOutcome}`, extend the projection to include `candidateCount` and `outcome` (the events table has both columns per `prisma/schema.prisma`).

- [ ] **4.9 Typecheck + commit**

```bash
npm run typecheck:tests && npm run typecheck:app
git add lib/mapImageDiag/shared.ts tests/mapImageDiag/deriveSessionOutcome.test.ts
# include service.ts only if step 4.8 changed it
git commit -m "feat(diag): relax sessionOutcome for candTotal=1 timeout (no_data)

When MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED=1, a session whose only
terminal failures are single-candidate timeouts (typically a slow
bgm.tv upstream we can't fall through) is classified 'no_data' instead
of 'failed'. Multi-candidate failures still escalate. Removes the
~50% session failure rate inflation caused by 1-2 hot-but-orphaned
covers per session."
```

---

## Task 5: Force-decorate first N requests in every session

**Goal:** The current `shouldDecorateProxyRequests()` only decorates URLs with `__mi_*` query params when the session is sampled OR has already escalated. This misses the *first slow request* in 50%+ of sessions because escalation is reactive. Force the first N=5 requests in every session to be decorated, so the diag pipeline never misses the inciting incident.

**Files:**
- Modify: `features/map/anitabi/mapImageSessionManager.ts:564-566`
- Test: extend `tests/map/mapImageSessionManager.test.ts`

### Steps

- [ ] **5.1 Read context around `shouldDecorateProxyRequests` (already read in §preflight, repeat for safety)**

```bash
sed -n '180,200p' features/map/anitabi/mapImageSessionManager.ts
sed -n '264,275p' features/map/anitabi/mapImageSessionManager.ts
sed -n '548,567p' features/map/anitabi/mapImageSessionManager.ts
```

Expected: confirm `shouldDecorateProxyRequests()` returns `this.isFlushEligible()`. Confirm a private field area near line 180-200 to add `private decoratedCount = 0`.

- [ ] **5.2 Add failing test**

Append to `tests/map/mapImageSessionManager.test.ts`:

```typescript
it('force-decorates the first N requests when force-N flag set, even if not sampled or escalated', () => {
  const original = process.env.NEXT_PUBLIC_MAP_IMAGE_FORCE_DECORATE_FIRST_N
  process.env.NEXT_PUBLIC_MAP_IMAGE_FORCE_DECORATE_FIRST_N = '5'
  const transport = vi.fn()
  const manager = new MapImageSessionManager({
    random: () => 0.99,                    // sampled = false (above threshold)
    now: () => Date.now(),
    getSessionSeed: () => 'seed-force-decoration',
    transport,
  })
  try {
    const handles = []
    for (let i = 0; i < 7; i++) {
      handles.push(manager.startRequest({
        surface: 'map',
        slotKey: `cover-${i}`,
        slotType: 'cover-avatar',
        owner: 'viewport-loader',
        requestedCandidateUrl: `https://image.anitabi.cn/bangumi/${i}.jpg`,
        candidateIndex: 0,
        candidateCount: 3,
        attemptIndex: 0,
        kind: 'cover',
      }))
    }
    // First 5 should have __mi_* in their decorated requestUrl
    for (let i = 0; i < 5; i++) {
      expect(handles[i].requestUrl).toMatch(/__mi_session=/)
    }
    // 6th and 7th should be undecorated (not sampled, not escalated)
    expect(handles[5].requestUrl).not.toMatch(/__mi_session=/)
    expect(handles[6].requestUrl).not.toMatch(/__mi_session=/)
  } finally {
    process.env.NEXT_PUBLIC_MAP_IMAGE_FORCE_DECORATE_FIRST_N = original
  }
})

it('does NOT force-decorate when flag is 0 or unset', () => {
  const original = process.env.NEXT_PUBLIC_MAP_IMAGE_FORCE_DECORATE_FIRST_N
  process.env.NEXT_PUBLIC_MAP_IMAGE_FORCE_DECORATE_FIRST_N = '0'
  const manager = new MapImageSessionManager({
    random: () => 0.99,
    now: () => Date.now(),
    getSessionSeed: () => 'seed-no-force',
    transport: vi.fn(),
  })
  try {
    const handle = manager.startRequest({
      surface: 'map',
      slotKey: 'cover-0',
      slotType: 'cover-avatar',
      owner: 'viewport-loader',
      requestedCandidateUrl: 'https://image.anitabi.cn/bangumi/0.jpg',
      candidateIndex: 0,
      candidateCount: 3,
      attemptIndex: 0,
      kind: 'cover',
    })
    expect(handle.requestUrl).not.toMatch(/__mi_session=/)
  } finally {
    process.env.NEXT_PUBLIC_MAP_IMAGE_FORCE_DECORATE_FIRST_N = original
  }
})
```

(Adjust the `startRequest` argument shape to whatever the existing test file uses — the assertion target is whether `requestUrl` contains `__mi_session=`.)

- [ ] **5.3 Run to confirm fail**

```bash
npx vitest run tests/map/mapImageSessionManager.test.ts -t "force-decorates"
```

Expected: FAIL — first 5 are NOT decorated (sampled=false, escalated=null).

- [ ] **5.4 Implement counter**

Edit `features/map/anitabi/mapImageSessionManager.ts`. Around the existing private fields (~line 185 area), add:

```typescript
  private decoratedCount = 0
```

Replace the `shouldDecorateProxyRequests` method (~line 564):

```typescript
  private shouldDecorateProxyRequests(): boolean {
    if (this.isFlushEligible()) return true
    const forceN = this.resolveForceDecorateFirstN()
    if (forceN > 0 && this.decoratedCount < forceN) {
      this.decoratedCount += 1
      return true
    }
    return false
  }

  private resolveForceDecorateFirstN(): number {
    const raw = String(process.env.NEXT_PUBLIC_MAP_IMAGE_FORCE_DECORATE_FIRST_N || '').trim()
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return Math.min(parsed, 50) // hard ceiling for safety
  }
```

- [ ] **5.5 Run to confirm pass**

```bash
npx vitest run tests/map/mapImageSessionManager.test.ts -t "force-decorates"
npx vitest run tests/map/mapImageSessionManager.test.ts -t "does NOT force-decorate"
```

Expected: PASS for both.

- [ ] **5.6 Run full session-manager test for no regression**

```bash
npx vitest run tests/map/mapImageSessionManager.test.ts
```

Expected: PASS.

- [ ] **5.7 Typecheck + commit**

```bash
npm run typecheck:tests && npm run typecheck:app
git add features/map/anitabi/mapImageSessionManager.ts tests/map/mapImageSessionManager.test.ts
git commit -m "feat(diag): force-decorate first N requests per session

NEXT_PUBLIC_MAP_IMAGE_FORCE_DECORATE_FIRST_N (default 0, recommended 5)
ensures the diag pipeline captures the inciting slow/failed request in
every session, not just sampled or escalated ones. Closes the gap where
~50% of sessions had no diag for their first failure."
```

---

## Task 6: Investigate and fix the dashboard `avg > P95` math bug

**Goal:** The handoff observed `warmup_request_terminal` with `avg=11362ms > P95=3891ms` — mathematically impossible if avg is mean and P95 is 95th-percentile. Find which side of the pipeline (server aggregation in `service.ts`, dashboard SQL, or client UI in `app/(authed)/admin/ops/.../ui.tsx`) has the swap, and fix it. This is a prerequisite for trusting the post-deploy baseline comparison.

**Files:**
- Investigate: `lib/mapImageDiag/service.ts`, `app/(authed)/admin/ops/map-image-diagnostics/ui.tsx` (or wherever `stageStats` is computed)
- Modify: TBD by step 6.1
- Test: TBD by step 6.1

### Steps

- [ ] **6.1 Locate the aggregation**

```bash
grep -rn "avgDurationMs\|p95DurationMs\|stageStats" lib/mapImageDiag/ app/\(authed\)/admin/ops/ 2>/dev/null | grep -v test | head -25
```

Identify the aggregation site. Likely candidates:
- A SQL `AVG(durationMs)` and `PERCENTILE_DISC(0.95)` in `service.ts`
- A JS reduce over events in the dashboard's data loader

- [ ] **6.2 Read the aggregation code, look for the swap**

The bug pattern is usually one of:
- `{ avg: p95Value, p95: avgValue }` shape mismatch in result mapping
- `ORDER BY` reversed in percentile calc
- Filtering events differently for avg vs p95 (avg over all events, p95 over only sampled — would explain skew)

Document the suspected root cause in the commit message body when you fix it.

- [ ] **6.3 Write a regression test**

In whichever file you ended up editing, add a vitest case (under e.g. `tests/mapImageDiag/aggregateStageStats.test.ts`) that asserts:

```typescript
import { describe, expect, it } from 'vitest'
// Import the exported aggregation function (export it if it's currently private)

describe('aggregateStageStats', () => {
  it('avg never exceeds P95 for a non-empty population', () => {
    const events = [
      { stage: 'warmup_request_terminal', durationMs: 100 },
      { stage: 'warmup_request_terminal', durationMs: 200 },
      { stage: 'warmup_request_terminal', durationMs: 300 },
      { stage: 'warmup_request_terminal', durationMs: 400 },
      { stage: 'warmup_request_terminal', durationMs: 5000 }, // P95 outlier
    ]
    const result = aggregateStageStats(events)
    const warmup = result.find((s) => s.stage === 'warmup_request_terminal')!
    expect(warmup.avgDurationMs).toBeLessThanOrEqual(warmup.p95DurationMs!)
  })
})
```

- [ ] **6.4 Run to confirm fail**

```bash
npx vitest run tests/mapImageDiag/aggregateStageStats.test.ts
```

Expected: FAIL (or PASS — if it PASSES, the bug is upstream of the aggregation; investigate dashboard rendering layer instead).

- [ ] **6.5 Fix the bug**

Apply the targeted fix.

- [ ] **6.6 Run to confirm pass**

```bash
npx vitest run tests/mapImageDiag/aggregateStageStats.test.ts
```

- [ ] **6.7 Manual verification against staging data**

If staging is available, hit the dashboard endpoint and confirm `avg <= P95` for every stage. If no staging, add a defensive assertion in the API handler that logs (does not throw) when `avg > P95` so production data anomalies surface in logs.

- [ ] **6.8 Typecheck + commit**

```bash
npm run typecheck:tests && npm run typecheck:app
git add <whatever-files-changed>
git commit -m "fix(diag): correct avg/P95 swap in stage stats aggregation

[Root cause description from step 6.2]
Adds regression test that fails if avg > P95 for any stage."
```

---

## Task 7: Integration verification + housekeeping

**Goal:** Run the full test suite, verify all 4 feature flags can be toggled independently, and prepare for deploy.

### Steps

- [ ] **7.1 Run the entire test suite**

```bash
npm test
```

Expected: ALL pass. The line-budget check (`scripts/check-line-budget.mjs`) may reject if files grew too much; if so, refactor (Task 1's `mapImageHostPolicy.ts` adds ~80 lines — likely fine but verify against `line-budget.allowlist.json`).

- [ ] **7.2 Run lint**

```bash
npm run lint
```

Expected: no new errors.

- [ ] **7.3 Manually test the feature flag matrix**

Set each flag to `1` in `.env.local`, restart `npm run dev`, and exercise `/map`:

| Flag | What to verify |
|---|---|
| `NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED=1` | Block a hostname via `/etc/hosts` → after 3 requests, that host's images fail-fast (< 200ms, not 4-6s). |
| `NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED=1` | Pick a bangumi that goes via `lain.bgm.tv` → DevTools network shows 3 sequential candidate URLs on failure. |
| `MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED=1` | Visit a page, induce a single bgm.tv timeout, check `/api/admin/ops/map-image-diagnostics/<sid>` → `sessionOutcome === 'no_data'`. |
| `NEXT_PUBLIC_MAP_IMAGE_FORCE_DECORATE_FIRST_N=5` | Open DevTools network → first 5 cover requests have `__mi_session` query param even when not sampled. |

- [ ] **7.4 Update `.env.example` with documentation for the new flags**

Append to `.env.example`:

```
# Map image PR1 — set to 1 in production after deploy to activate
NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED=
NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED=
MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED=
NEXT_PUBLIC_MAP_IMAGE_FORCE_DECORATE_FIRST_N=
```

- [ ] **7.5 Commit env documentation**

```bash
git add .env.example
git commit -m "docs(env): document map image PR1 feature flags"
```

- [ ] **7.6 Run `seichigo-housekeeping` skill**

This wraps the work into a reviewable shape (atomic commits, pre-merge tag).

- [ ] **7.7 Push the branch + open PR**

```bash
git push -u origin claude/sad-curie-5740e0
gh pr create --title "feat(map): PR1 stop-the-bleeding — circuit breaker, ladder, outcome v2" --body "$(cat <<'EOF'
## Summary
Implements PR1 of the map image performance program (see [program plan](docs/superpowers/plans/2026-05-02-map-image-perf-program.md)).

Six surgical changes, all behind feature flags (default OFF):

1. Host circuit breaker with `blocked` state + sliding window
2. Per-host degraded timeout (4-6s → 2000ms)
3. Bgm.tv cover ladder widened from 1 to 3 candidates
4. Session outcome v2: candTotal=1 timeout → `no_data`, not `failed`
5. First-N (default 5) forced `__mi_*` decoration per session
6. Dashboard avg/P95 swap fix

## Expected impact
- Session failure rate: 50% → <10%
- Worst-case single-image stall: ~16.5s → ≤ 2s
- Diag pipeline captures inciting slow request in 100% of sessions (was ~50%)

## Rollout
Deploy with all four `*_ENABLED` flags OFF. Confirm zero behavioural change. Then enable in this order, 24h apart:
1. `NEXT_PUBLIC_MAP_IMAGE_FORCE_DECORATE_FIRST_N=5` (observability only, no behaviour change)
2. `MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED=1` (server-side, dashboard semantics shift)
3. `NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED=1` (more candidates, slightly higher upstream load)
4. `NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED=1` (circuit breaker — biggest behavioural shift)

## Test plan
- [ ] All vitest tests pass
- [ ] Typecheck passes for app + tests
- [ ] Lint passes
- [ ] Manual: each flag toggled independently in dev, verified per Task 7.3 matrix
- [ ] Production: flags off → no behavioural change vs current main
- [ ] Production 24h after each flag enable: dashboard shows expected metric movement

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **7.8 Pre-deploy checklist before merging**

- [ ] All 4 flags documented in `.env.example`
- [ ] PR description references the program plan
- [ ] CI green
- [ ] Run `seichigo-predeploy-guard` skill before merge

- [ ] **7.9 After merge to main, deploy**

```bash
npm run cf:deploy
```

- [ ] **7.10 Run `seichigo-deploy-ledger` skill** to record the deploy with annotated tag.

---

## Self-Review Checklist

After all tasks complete, verify:

- [ ] **Spec coverage:** Every PR1 bullet from the program plan has a task here. Specifically: circuit breaker (Task 1+2), bgm.tv ladder (Task 3), session outcome v2 (Task 4), first-N decorate (Task 5), avg/P95 fix (Task 6), feature flags (every task), tests (every task), housekeeping/deploy (Task 7).

- [ ] **Type consistency:** `recordHostFailure`, `resolveHostState`, `resolveHostTimeoutMs` are referenced consistently in Task 1, Task 2, and the host-policy file. `isOutcomeV2Enabled` is internal to `shared.ts` only. `decoratedCount` is private in `MapImageSessionManager`.

- [ ] **Feature flag names:** Four flags total — all spelled identically across tasks. `NEXT_PUBLIC_*` for client-readable, plain names for server-only.

- [ ] **No placeholders:** Every step contains the actual code or command. The only TBD is in Task 6.5 (the actual fix), which is intentional — it depends on the diagnosis from 6.2. Acceptable because step 6.3-6.4 lock in the regression test first.

- [ ] **Steps are bite-sized:** Each step 2-5 minutes. The bigger blocks (Task 1.4, Task 3.4) are single Edit operations with the complete file contents shown — still bounded, just larger.

---

## Execution Handoff

When the user is ready to execute this plan, two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, with code-review between tasks. Use `superpowers:subagent-driven-development`.

**2. Inline Execution** — Execute tasks in the current session with checkpoints. Use `superpowers:executing-plans`.

**Recommended for this plan:** Subagent-Driven, because Tasks 1-5 are independent and Task 6 has unknown investigation scope that benefits from a fresh-eye reviewer.
