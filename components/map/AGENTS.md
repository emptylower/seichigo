# MAP MODULE

## OVERVIEW
`components/map` is the **MapLibre presentation layer** (rendering, clustering, popups, map-mode UI). Business/state logic lives in `features/map/`; data contracts come from `lib/anitabi`.

## STRUCTURE
```text
components/map/
|- AnitabiMapPageClient.tsx   # Main stateful map container (hotspot)
|- hooks/                     # Map layer/mode hooks
|- utils/                     # Cluster, sprite, priority, and feature helpers
`- *Layers.ts                 # Render-time layer composition
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Main map behavior | `components/map/AnitabiMapPageClient.tsx` | Large integration surface and state orchestration |
| Layer toggles/composition | `components/map/hooks/useMapLayers.ts`, `components/map/CompleteModeLayers.ts` | Keep layer IDs and ordering stable |
| Cluster behavior | `components/map/utils/clusterEngine.ts`, `components/map/ClusterLayers.ts` | Performance-sensitive; avoid per-frame heavy transforms |
| Popup/card rendering | `components/map/PointPopupCard.tsx` | Keep schema compatible with map feature properties |
| Sprite/thumbnail loading | `components/map/utils/spriteRenderer.ts`, `components/map/utils/thumbnailLoader.ts` | Watch memory churn and cache invalidation |
| Quick pilgrimage overlay | `components/quickPilgrimage/QuickPilgrimageMode.tsx` | 720-line mobile walking navigation; consumes map state |

## CONVENTIONS
- Preserve layer ordering intent; changing order can silently hide interaction or label layers.
- Keep map logic split by concern: container state in page client, pure math/transform in `utils/`, render composition in layer components.
- Reuse existing feature-property keys; downstream code assumes stable keys for cards/popups/highlights.
- Prefer memoized transforms and incremental updates over rebuilding full feature collections.
- This module handles rendering only; complex state/data logic belongs in `features/map/`.

## ANTI-PATTERNS
- Do not move heavy query/transformation work into React render paths.
- Do not introduce ad-hoc map source/layer IDs that diverge from existing naming patterns.
- Do not bypass shared helpers (`clusterEngine`, `priorityCalculator`, `globalFeatureCollection`) with duplicated logic.
- Do not tie map view state to unrelated page state that forces broad re-renders.

## COMMANDS
```bash
npm test -- tests/map
npm test -- tests/anitabi
npx vitest run --project jsdom -- tests/map/useMapMode.test.tsx
```
