# PR3 UI Attribution Audit

- Date: 2026-05-03
- Branch/worktree: `claude/agitated-banzai-065ecb`
- Method: read-only audit of end-user map and quick-pilgrimage UI surfaces that currently render anitabi-hosted imagery without an adjacent source link. Line references below were verified against the current worktree before Task 5.3 planning edits.

## Surfaces requiring "via anitabi" micro-link

| File | Lines | Surface | Current render | Required placement | Href source |
|---|---|---|---|---|---|
| `components/map/PointPopupCard.tsx` | 114-130, 137-158 | Point detail popup hero image | `ResilientMapImage kind="point"` inside the popup frame; no visible attribution link | Add `via anitabi` inside the image frame, anchored away from the close button and EP/time chips | `point.originLink ?? https://www.anitabi.cn/bangumi/${point.bangumiId}` |
| `components/map/MobileVisualCenterOverlay.tsx` | 120-139 | Mobile point strip cards | `ResilientMapImage kind="point"` plus caption gradient row; no visible attribution link | Restructure each point card into a non-button wrapper with sibling interactions: keep the existing selectable card button for `onPointClick`, and place a separately positioned attribution anchor outside the button subtree in the bottom gradient row or image corner | `item.originLink ?? https://www.anitabi.cn/bangumi/${item.bangumiId}` after `originLink` is threaded into `WindowExcerptPointItem` |
| `components/map/WindowExcerptOverlay.tsx` | 134-154 | Window excerpt point cards (desktop + compact mobile card body) | `ResilientMapImage kind="point"` plus bottom caption gradient; no visible attribution link | Restructure each `PointCard` into a non-button wrapper with sibling interactions: keep the existing card button for point activation, and place a separately positioned attribution anchor outside the button subtree along the right edge of the caption overlay | `item.originLink ?? https://www.anitabi.cn/bangumi/${item.bangumiId}` after `originLink` is threaded into `WindowExcerptPointItem` |
| `components/quickPilgrimage/QuickPilgrimageMode.tsx` | 358-369 | Quick Pilgrimage intro cover | Raw `<img>` for `bangumi.card.cover`; no attribution link near the cover frame | Add a micro-link adjacent to or inside the intro cover frame without competing with the CTA button | `https://www.anitabi.cn/bangumi/${bangumi.card.id}` |
| `components/quickPilgrimage/QuickPilgrimageMode.tsx` | 507-514 | Quick Pilgrimage current point image | Raw `<img>` for `currentPoint.image`; no attribution link in the frame | Add a micro-link inside the image frame, bottom-right or bottom-left over the existing gradient affordance | `currentPoint.originLink ?? https://www.anitabi.cn/bangumi/${bangumi.card.id}` |

## Surfaces NOT requiring attribution

| File | Lines | Surface | Why it is not required for PR3 visible text |
|---|---|---|---|
| `components/map/MobileVisualCenterOverlay.tsx` | 55-87 | Dense bangumi avatar row | The 40px circular avatars are too small for legible inline text. If design wants a credit affordance later, use `title`, tooltip, or a compact icon rather than visible text in PR3. |
| `components/map/WindowExcerptOverlay.tsx` | 70-103 | Dense bangumi avatar chips | Same density issue as the mobile avatar row; visible text would occlude artwork and count badges more than it would help attribution. |
| N/A | N/A | Canvas marker sprites / map pins | Marker sprites are not stable DOM text surfaces. Attribution should live on the popup/card/detail surfaces that expose the image at readable size. |

Admin/internal previews were not part of this pass because PR3 §6 is about end-user map and quick-pilgrimage surfaces.

## Open questions

1. For the dense bangumi avatar rows, should the fallback affordance be `title`/tooltip-only, or do we want a shared icon-only credit treatment in a later pass?
2. The smallest concrete data path for excerpt cards is to add nullable `originLink` to the preload DTO and `WindowExcerptPointItem`. If preload payload size is sensitive, confirm that cost before expanding `AnitabiPreloadChunkPointDTO`.
3. The intro cover and current-point frame in Quick Pilgrimage should probably reuse the same shared `AttributionLink` primitive as the map surfaces so the visual language stays consistent across light and dark overlays.
