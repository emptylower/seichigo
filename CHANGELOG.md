# Changelog

All notable changes to **SeichiGo** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once a `1.0.0` release ships. The current `0.x` series tracks the MVP
trajectory and may make breaking changes between minor versions.

> Scope: only the last ~30 commits leading up to the current `main` are
> captured here. Older history is available via `git log`. The full release
> history will be backfilled once `1.0.0` ships.

## [Unreleased]

### Added
- **In-app travel-mode picker** via the official Google Maps Embed API,
  so pilgrims can switch between walking / transit / driving without
  leaving SeichiGo (#41).
- **R2 persistent mirror** for Anitabi images — Cloudflare R2 acts as a
  durable origin cache for map imagery, with cron-driven backfill and
  manual force-complete tooling (#35).
- **Map image circuit breaker, retry ladder, and outcome v2 telemetry**
  ("stop the bleeding" PR1) to keep the map responsive under partial
  upstream failure.
- **MapImage request scheduler, session manager, and per-host policy** —
  unified scheduling across warmup, viewport, and DOM image lanes, plus
  scoped proxy rules.
- **Diagnostics pipeline**: server ingest endpoint, admin API, and admin
  dashboard UI for inspecting map-image sessions and failure shapes.
- **WindowExcerpt PointCards instrumentation** for the diagnostics
  pipeline (PR1.55, #34).
- **Proxy failure attribution**: proxy errors are attributed to the
  upstream host so the breaker opens against the real culprit, not the
  proxy.
- **MapImageDiag schema** and Prisma migrations to persist diagnostics.

### Changed
- **Tile preconnect + warmup-first-view lane** — the map preconnects to
  tile CDNs and prioritizes the first-viewport batch when fewer than 6
  tiles are pending, materially reducing time-to-first-paint on the map.
- **R2 mirror read path enabled at >50 % coverage** — production now
  reads from the durable R2 cache when the mirrored corpus is large
  enough to be a meaningful hit-rate, with config gating for staged
  rollout.
- **completeMode demand and cover policy** split into separate concerns
  so admin force-complete and natural traversal can evolve independently.
- **Cloudflare phase 3** improvements bundled: map image optimization,
  public content snapshot/override path, and miscellaneous polish.

### Fixed
- **Mirror cron / advisory lock**: dropped the Postgres advisory lock
  from `cronTick`; mirror worker now self-paces and skips requeue when
  the URL is unchanged.
- **R2 write path** enabled and Prisma/Cloudflare bindings hotfixed for
  PR3 (#38, #39, #40).
- **Force-complete reliability**: manual force-complete is now a single
  tick with a smaller batch (no internal loop), runs within a 20 s
  budget, surfaces errors instead of swallowing them, and clears the
  mirror circuit breaker when invoked.
- **Mirror scope** includes user-uploaded point images, not only the
  system points prefix — covered by a regex path filter.
- **Throttle clear**: `clearThrottle` now uses a flat `where` shape
  instead of the unique-constraint shape so deletes actually match.
- **Seed batch tolerance** softened and throttle tolerance raised for
  upstream timeouts during peak hours.
- **Anitabi PR3 deviations closed** to unblock the Cloudflare deploy
  (#36).
- **Prisma client** pinned to `@prisma/client/wasm` for Workers runtime
  (#38).
- **Proxy-only enforcement for points**: `__mi_*` markers propagate
  through the proxy so per-point routing decisions survive proxying, and
  point images are forced through the proxy path.

### Docs
- **PR3 R2 mirror design spec** and revised plan committed to
  `doc/`/`docs/plans/` (#37).
- **Map image handoff** notes for next-session continuation.

### Chore
- Translation, test, and line-budget allowlist adjustments to keep CI
  green during the PR1–PR3 refactors.
- Mirror worker cron enabled in the deploy config; `MAP_IMAGE_SESSION_OUTCOME_V2`
  flag enabled in the worker runtime.

---

## Conventions

- `Added` — net-new user-facing capabilities or admin tooling.
- `Changed` — behavior changes, performance, or non-breaking refactors visible to operators.
- `Fixed` — bug fixes.
- `Docs` — documentation-only updates.
- `Chore` — internal-only changes (deps, config, CI tweaks).

[Unreleased]: https://github.com/emptylower/seichigo/compare/main...HEAD
