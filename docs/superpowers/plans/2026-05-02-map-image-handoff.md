# Map Image Performance — Handoff (2026-05-02 EOD)

> Continuation context for the next conversation. Production is in a known stable state with one PR's worth of follow-up identified. No emergency.

## Current production state (as of handoff)

**Worker version**: `628bf58a-fcc3-401e-a0f5-222dec785a02` (rollback build, deployed 2026-05-02T14:18:53Z) — see `git tag -l "deploy/2026-05-02*" --sort=-creatordate` to verify.

**Active flags on production**:

| Flag | Value | Purpose |
|---|---|---|
| `NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED` | `1` | Circuit breaker (degraded/blocked states + 2000ms clamp) |
| `NEXT_PUBLIC_MAP_IMAGE_LADDER_BGM_FALLBACK_ENABLED` | `1` | Bgm.tv cover ladder widened from 1→3 candidates |
| `MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED` | `1` | candTotal=1 timeout → `no_data` not `failed` |
| `NEXT_PUBLIC_MAP_IMAGE_FORCE_DECORATE_FIRST_N` | `5` | Force-decorate first 5 proxy requests for diag coverage |
| `NEXT_PUBLIC_MAP_IMAGE_HOST_POLICY_PROXY_AWARE` | **`0`** | **Disabled — rollback** (was causing UX flicker on point clicks) |

**Server-side (`wrangler.jsonc` `vars` block)**: `MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED=1` only.

## What's merged & deployed

| PR | Merge commit | Title |
|---|---|---|
| [#32](https://github.com/emptylower/seichigo/pull/32) | `f267979` | feat(map): PR1 stop-the-bleeding (circuit breaker, ladder, outcome v2) |
| [#33](https://github.com/emptylower/seichigo/pull/33) | `a10bab8f` | feat(map): attribute proxy failures to upstream host for breaker (PR1.5) |

**Local main HEAD**: `a10bab8f` (or later if any post-handoff commits).

## Deploy ledger this session

| Tag | Worker | Notes |
|---|---|---|
| `deploy/2026-05-02T13-09-09Z` | `fc03bb9c-d8dc-4b42-8782-c2431fd6e47b` | PR1 stop-the-bleeding shipped |
| `deploy/2026-05-02T13-59-04Z` | `a324d761-d133-4a07-8bbe-7f8498b8763e` | PR1.5 proxy-aware host policy enabled |
| `deploy/2026-05-02T14-18-53Z` | `628bf58a-fcc3-401e-a0f5-222dec785a02` | PR1.5 PROXY_AWARE flag flipped to 0 (rollback, current production) |

`git -C /Users/mac/Desktop/seichigo tag -l "deploy/*" --sort=-creatordate` lists them ordered.

## Where we landed (TL;DR)

- **PR1 ✓ working** — bgm.tv cover ladder is widening to 3 candidates (verified in 2nd post-PR1.5 session: `cmooetj1r0000psp7e8pmn1cp`).
- **Failure rate dropping in fresh-cache scenarios** — viewport covers all succeeding 39-360ms.
- **PR1.5 (PROXY_AWARE) caused regression** — see "Why PR1.5 was rolled back" below. Code merged but disabled via flag.
- **One real remaining issue** — session outcome marking is too strict for "1 attempt failed + retry succeeded" pattern. Surfaces in dashboard as inflated failure rate.

## Why PR1.5 was rolled back

PR1.5 wired the host policy to track upstream hosts (e.g., `image.anitabi.cn`) when a proxy URL fails or its timeout is looked up. The intent was to make the breaker activate on real upstream pain even when requests go via proxy.

**Surprise side-effect**: when the breaker promoted `point:image.anitabi.cn` to `blocked` state (3 failures in 10s), the timeout for ALL subsequent dom-image requests (point detail panel) became `0ms`. That means:

- attempt 0 fires `setTimeout(0)` → fail-fast at ~33ms
- React renders fallback UI briefly
- Retry attempt fetches via proxy → CF cache HIT in 10ms
- Image displays, but with visible flicker

In the captured session, the proxy `cache_hit` arrived at 99ms after the start — i.e., the data was there, we just didn't wait. The breaker's fail-fast is correct for direct URLs (where dead-host = death) but wrong for proxy URLs (where CF cache often saves the day).

Evidence: session `cmooetj1r0000psp7e8pmn1cp`, `dom-210272:4t2lo5vw4` chain:
- `dom_request_terminal` attempt 0: `durationMs=33, outcome=timeout, terminalState=failed`
- `dom_request_terminal` attempt 1: `durationMs=10, terminalState=succeeded, displayOutcome=fallback`
- `proxy_cache_state`: `outcome=cache_hit` for the original request

User perception: "几乎都失败了" — actual UX is brief flicker on every point click.

## What's next (recommended order)

### PR1.6 — Smarter breaker for proxy URLs (BLOCKING)

**Problem**: `resolveRequestTimeoutMs` clamps proxy URLs the same way it clamps direct URLs. For proxy, the clamp is wrong because CF cache + proxy's own 6s timeout already protect users.

**Fix**: in both `components/map/ResilientMapImage.tsx:resolveRequestTimeoutMs` and `components/map/utils/loadMapImageWithCandidates.ts:resolveRequestTimeoutMs`, exempt proxy URLs from breaker clamps:

```typescript
// Proxy URLs: CF cache + proxy's own timeout already protect us;
// breaker clamps cause false-positive flicker even when cache would hit.
if (isProxyRequest) return baseTimeoutMs
const scope = resolveHostPolicyScope(kind)
const host = readMapImageEffectiveHost(url)
return resolveHostTimeoutMs(host, scope, baseTimeoutMs, Date.now())
```

Keep failure recording untouched — host policy still tracks failures for metrics, just doesn't actuate timeout clamps on proxy URLs.

After PR1.6, re-enable `NEXT_PUBLIC_MAP_IMAGE_HOST_POLICY_PROXY_AWARE=1`.

**Effort**: 1-2 hours including tests.

### PR1.7 — Session outcome relaxation v3 (SHIPPABLE WITH PR1.6)

**Problem**: `deriveSessionOutcome` v2 only treats `candidateCount=1 + outcome=timeout` as `no_data`. But the user-visible-success case where attempt 0 fails and attempt 1 succeeds (candidateCount=2 chain) still marks the whole session as `failed`. Dashboard shows inflated failure rate even when no user saw anything broken.

**Fix**: in `lib/mapImageDiag/shared.ts:deriveSessionOutcome`, also classify as `no_data` (or new `recovered`) when:
- The chain has at least one terminal=succeeded event AND
- The failed events are all early-attempt timeouts that the chain ultimately recovered from

Pseudo:
```typescript
function isChainRecovered(events, chainId): boolean {
  const chainEvents = events.filter(e => e.chainId === chainId)
  return chainEvents.some(e => e.terminalState === 'succeeded')
       && chainEvents.some(e => e.terminalState === 'failed')
}
// only treat as session-failed if the failed event's chain never succeeded
```

**Effort**: 1 hour with tests. Bundle into PR1.6 since they ship together.

### PR2 — observability hardening (PRE-CONDITION FOR PR3+)

Was already on the roadmap. Now even more useful:
- `host_policy_decision` event — shows when degraded/blocked transitions happen
- `proxy_cache_state` already exists, but not surfaced in dashboard summary
- `viewport_change_settled` and `first_view_paint` markers
- `steady_state_degradation` flag (60s window, ≥3 events ≥2s — hard rule from §0)

See [program plan](2026-05-02-map-image-perf-program.md) §PR2 for full scope.

### PR3 — R2 persistent image cache (THE BIG ONE)

This is what truly insulates us from anitabi/bgm.tv outages. CF edge cache is great when warm; R2 mirrors give us a second-tier fallback that survives edge eviction. See program plan §PR3.

## Files of record

| File | What it has |
|---|---|
| [docs/superpowers/plans/2026-05-02-map-image-perf-program.md](2026-05-02-map-image-perf-program.md) | 5-PR program overview, locked metrics (B-tier), open decisions D3-D6 |
| [docs/superpowers/plans/2026-05-02-map-image-pr1-stop-bleeding.md](2026-05-02-map-image-pr1-stop-bleeding.md) | PR1 task plan (already executed) |
| `docs/superpowers/plans/2026-05-02-map-image-handoff.md` | This document |
| `.env.local` (gitignored) | Production flag values for next deploy |
| `wrangler.jsonc` `vars` block | Server-side runtime env |
| `lib/anitabi/imageProxy.ts` | Candidate ladder + diag URL helpers |
| `components/map/utils/mapImageHostPolicy.ts` | Circuit breaker state + helpers |
| `components/map/utils/loadMapImageWithCandidates.ts` | Central image fetch dispatcher |
| `components/map/ResilientMapImage.tsx` | DOM image with candidate retry + breaker timeout |
| `lib/mapImageDiag/shared.ts:deriveSessionOutcome` | Session outcome classifier |

## Diag dashboard

- Admin: https://www.seichigo.com/admin/ops/map-image-diagnostics (auth required)
- Single-session detail: `GET /api/admin/ops/map-image-diagnostics/<sessionId>`

To analyze a session in the next conversation:

```js
// Paste into DevTools Console while logged in to admin
(async () => {
  const ids = ['<session-id>']
  const out = {}
  for (const id of ids) {
    const r = await fetch(`/api/admin/ops/map-image-diagnostics/${id}`, { credentials: 'include' })
    out[id] = r.ok ? await r.json() : { __error: `HTTP ${r.status}` }
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `seichigo-session.json`
  a.click()
  a.remove()
})()
```

## Worktrees state (FYI)

Main worktree: `/Users/mac/Desktop/seichigo`
PR1 worktree (current dev): `/Users/mac/Desktop/seichigo/.claude/worktrees/sad-curie-5740e0`
- Branch: `claude/host-policy-proxy-aware` (PR1.5 branch, post-merge — can be deleted by next session if desired)

Other worktrees scanned and confirmed clean by `seichigo-worktree-audit` earlier this session.

## Open decisions deferred to PR2 kickoff

- D3: Anitabi probe alert channel (Telegram bot / Slack / dashboard-only)
- D4: R2 mirror scope (lazy / lazy+top-1000 / full)
- D5: R2 attribution form (response header / UI link / both)
- D6: Cadence (one-per-week vs continuous)

## Resume protocol for next conversation

1. **Read this file first**.
2. Run `seichigo-worktree-audit` to confirm working tree state hasn't drifted.
3. Read [program plan](2026-05-02-map-image-perf-program.md) for the bigger context.
4. **Recommended next action**: write PR1.6 plan via `superpowers:writing-plans`, then implement (1-2 hours), merge, deploy. After 24h observation, decide whether to re-enable `NEXT_PUBLIC_MAP_IMAGE_HOST_POLICY_PROXY_AWARE=1`.
5. **Watch the dashboard** in the meantime — the rollback should restore "session failure rate" to acceptable levels (no flicker on point clicks).

---

Status snapshot at handoff: production stable, one tracked regression rolled back via flag, code merged, plan for follow-up written. No fires.
