# Phase 1 Decision Report — HERE Japan Transit Coverage

**Date**: 2026-05-11
**Departure time tested**: 2026-05-13T09:30:00+09:00 (Wed JST morning rush)
**Endpoint**: `https://transit.router.hereapi.com/v8/routes`
**Key**: HERE Freemium REST API (registered 2026-05-11)
**Spike script**: [`scripts/here-japan-coverage.ts`](../scripts/here-japan-coverage.ts)
**Raw dumps**: `.cache/here-spike/` (gitignored; one JSON per pair + aggregate `report.json`)
**Decision gate** (per [roadmap §3](in-app-navigation-roadmap.md)): 9-10/10 = GO · 6-8 = REVIEW · ≤5 = HALT

---

## Verdict

**HALT.** Match score: **0/10**. Activate NAVITIME fallback.

HERE Public Transit v8 is **not viable** as the Phase 2 routing provider for seichigo's Japan POI use case.

---

## What the data says

### Per-pair results

| # | Origin → Destination | Expected operator | HERE returned | Status |
|---|---|---|---|---|
| 1 | 新宿駅 → 渋谷駅 | JR 山手線 OR 副都心線 | 池86 (都営バス, city bus) | ✗ no rail |
| 2 | 東京駅 → 京都駅 | JR 東海道新幹線 | 高速バス 前橋・高崎線 + シルクライナー (intercity bus) | ✗ no Shinkansen |
| 3 | 渋谷駅 → 鎌倉駅 | JR 横須賀線 | — | ✗ `noCoverage` |
| 4 | 関西空港 → 京都駅 | はるか + 烏丸線 | — | ✗ `noCoverage` |
| 5 | 札幌駅 → 大通駅 | 札幌市営地下鉄南北線 | — | ✗ `noCoverage` |
| 6 | 博多駅 → 天神駅 | 福岡市地下鉄空港線 | — | ✗ `noCoverage` |
| 7 | 名古屋駅 → 栄駅 | 名古屋市営地下鉄東山線 | — | ✗ `noStationsFound` |
| 8 | 池袋駅 → 川越駅 | 東武東上線 OR JR 川越線 | — | ✗ `noRouteFound` |
| 9 | 大阪駅 → 神戸三宮駅 | JR 神戸線 OR 阪急 | — | ✗ `noCoverage` |
| 10 | 上野駅 → 軽井沢駅 | JR 北陸新幹線 | — | ✗ `noStationsFound` |

### Stations probe (`/v8/stations`)

| Location | Stations returned | `transports` array contents |
|---|---|---|
| 新宿駅 (35.6896, 139.7006, r=500m) | 5 (バスタ新宿, 新宿, 新宿四丁目, …) | **All empty `[]`** |
| 名古屋駅 (35.1709, 136.8815, r=500m) | 3 (Ｊｒ名古屋駅, 名鉄バスセンター, …) | **All empty `[]`** |
| 京都駅 (34.9858, 135.7588, r=1000m) | 3 (京都, 京都駅八条口, 九条) | **All empty `[]`** |

The stations exist as POIs, but HERE has **no line/route associations** for them. That's why the router returns "noCoverage" or "noStationsFound" — there are no schedules to plan against.

### What HERE DID return

Across all 30 routes (3 alternatives × ~10 pairs of which 2 produced any output):

- **Highway buses** (高速バス, intercity coach): 日本中央バス株式会社, etc.
- **City buses**: 都営バス
- **One subway line**: 三田線 (東京都交通局) — appeared as a feeder in one alternative for pair 2
- **Zero JR rail** (no 山手線, no 中央線, no 東海道, no 新幹線, no 横須賀線, …)
- **Zero major private rail** (no Tokyo Metro, no 阪急, no 東武, no 名鉄, no 京急, no 西武, no 京王, …)
- **Zero local subway outside one Toei line in Tokyo**

### Sanity checks (HERE is fine, just not for transit)

- **Driving v8** (`router.hereapi.com/v8/routes?transportMode=car`): 新宿→渋谷 returned 758s / 4.5km — ✓ reasonable.
- **Pedestrian v8** (`?transportMode=pedestrian`): same OD returned 3863s / 3.9km — ✓ reasonable.
- The API key works. The endpoint URL is correct. The parameter set is per HERE Transit v8 docs. The issue is data, not configuration.

---

## Root cause analysis

HERE markets "Japan transit" but the practical coverage is:

1. **Long-distance bus** (大手 highway-bus operators)
2. **A handful of municipal bus systems**
3. **Tokyo Toei subway (partial — only 三田線 surfaced)**

JR, Tokyo Metro, 私鉄 (private railway), and Shinkansen — the **80%+ of how Japan actually moves** — are absent. HERE's 2025-08 release notes mentioned a "Japan feed Beta" improvement, but as of 2026-05-11 the freemium tier sees none of that.

This is consistent with HERE's positioning as a logistics/automotive vendor whose transit data comes from incomplete GTFS-like feeds rather than direct rail-operator partnerships (which is what NAVITIME built its business around).

---

## Program decision (2026-05-11)

After reviewing the Phase 1 result, the project owner decided to **cancel the in-map custom transit program**. The reasoning:

1. **NAVITIME path requires Japanese-company business contact**, RapidAPI subscription costs, ToS clarification round-trips (2-7 day reply windows), then a 3-4 week custom-UI build.
2. **Phase 0 Google Embed API picker already works** — users can pick walk / transit / drive / bike and the iframe renders Google's official transit data with full JR + 私鉄 + Shinkansen coverage.
3. **Custom in-map rendering on MapLibre would be a nice-to-have** but the engineering and ongoing-maintenance cost (provider SLA, KV cache, polyline decoding, schema-adapter drift, multi-provider fallback) is not worth the marginal UX improvement over a working iframe.

**Outcome**: Phase 0 is the long-term solution. Phase 2 and Phase 3 (custom UI track) are **cancelled**, not deferred. NAVITIME is **not** being pursued.

### What stays in place

- The Google Maps Embed API picker shipped in Phase 0 (commit `99121b4`) — production, no changes needed.
- The `lib/route/google.ts` + `lib/route/embedNavigation.ts` + `<NavModeToggle>` codepath — production.
- The deep-link to native Google Maps app (`comgooglemaps://` / `google.navigation:`) for users who want real GPS turn-by-turn.

### What gets dropped from the original roadmap

- ~~Phase 2 — HERE/NAVITIME provider integration + custom `<TransitRouteView>` on MapLibre~~
- ~~Phase 3 — visual polish, departure time picker, realtime indicators, provider switch runbook~~
- The provider-agnostic `Route` / `RouteLeg` / `TransitLine` TS schema in roadmap §4.3 (not built — no consumer)
- KV cache, `/api/route/*` worker proxy, `@here/flexible-polyline` dependency (not needed)

---

## What this report rules out (for future maintainers)

If a future session considers re-opening the in-map custom transit track, read this first:

- **HERE Public Transit v8 in Japan**: confirmed by direct probe on 2026-05-11 — JR / Tokyo Metro / 私鉄 / Shinkansen all absent. Re-test only if HERE publishes a Japan-feed GA announcement (their 2025-08 release notes mentioned "Beta improvements" with no measurable effect).
- **NAVITIME**: pursue only if there's a clear product reason that exceeds the current Google Embed picker UX. The 2-7 day ToS round-trip + RapidAPI paid plan + custom UI build is the entry cost.
- **OTP + GTFS-JP self-host**: 2-4 month workstream per roadmap §6. Only justified if Google Embed itself becomes unworkable (e.g., quota changes, ToS changes, geo-restriction).

The decision boundaries from roadmap §1 still hold and should be re-read before any pivot:
- MCP is not a SaaS-runtime dependency answer.
- Google Routes API cannot be drawn on MapLibre per Google's service terms.
- Real GPS turn-by-turn is not permitted in browser-based UI globally (EEA exception).

---

## Open follow-up items

- [ ] (Optional) Revoke/rotate the HERE Freemium key — HERE is no longer a load-bearing dependency. Maintainer chose to leave the key in `.env.local` for potential future ad-hoc driving spikes.
- [ ] (Optional) Update the local `docs/in-app-navigation-roadmap.md` to reflect program termination, or remove it. Currently untracked in the main worktree.
