# Anitabi Attribution Audit (PR3 §6)

Scope: I reviewed only real rendering surfaces in `app/`, `components/`, and `features/`. I treated backend transforms and data shaping as context only, and I excluded generic cover cards that are not clearly Anitabi-derived.

`originLink` was treated as a real attribution link. Visible `origin` text without a link was treated as partial attribution, not a source link.

| File | Surface | Already attributes? | Action |
| --- | --- | --- | --- |
| `components/map/PointPopupCard.tsx:114-180` | Point popup image card in the map popup | Partial. It shows `point.origin` as visible text, but no `originLink` or source URL. | Add a compact visible `via Anitabi` / source link near the meta chips. Keep the Google Maps action separate. |
| `features/map/anitabi/DetailPanel.tsx:98-115` | Selected point detail strip | Partial. It shows `selectedPoint.origin`, but not a clickable source link. | Add a small source link or micro-label beside the origin chip. |
| `features/map/anitabi/DetailPanel.tsx:191-201` | Bangumi work-detail cover in the sidebar | No. The cover renders with no attribution UI. | Add a `via Anitabi` micro-link under the cover or in the card footer. |
| `features/map/anitabi/ExplorerPanelContent.tsx:260-303` | Bangumi explorer list cards | No. The card cover is rendered without any source/origin UI. | Add a compact attribution footer or micro-link below the cover/title block. |
| `components/map/WindowExcerptOverlay.tsx:77-145` | Desktop bangumi avatar rail and point card rail | No. The rail cards render covers/thumbnails only. | Needs product decision. The rail is cramped, so use a single compact source label only if the design can absorb it. |
| `components/map/MobileVisualCenterOverlay.tsx:63-143` | Mobile bangumi row and point strip | No. The compact mobile chips render covers/thumbnails only. | Needs product decision. Prefer a tiny source chip only if it does not break the rail. |
| `components/quickPilgrimage/QuickPilgrimageMode.tsx:363-367` | Intro cover from `resolveAnitabiAssetUrl(bangumi.card.cover)` | No. The cover renders with no attribution UI. | Add a compact source label under the intro cover. |
| `components/quickPilgrimage/QuickPilgrimageMode.tsx:507-514` | Current point image from `resolveAnitabiAssetUrl(currentPoint.image)` | No. The image renders with no attribution UI. | Add a compact `via Anitabi` label or source link near the image caption. |
| `components/quickPilgrimage/QuickPilgrimageMode.tsx:656-660` | Check-in modal reference image passed via `referenceImageUrl` | No visible attribution here. The modal/share flow receives the Anitabi URL, but this surface does not show a source. | Follow up in the modal/share flow with attribution; do not count this prop handoff as visible source credit. |
| `features/map/anitabi/useMapInteractionActions.tsx:256-309` | Preview image button for the selected point via `ResilientMapImage` | No. The control is labeled as a preview action, not source attribution. | Add a source label in the preview surface or carry attribution into the modal that the preview opens. |
| `features/map/anitabi/MapDialogs.tsx:256-285` | Image preview modal for point images | No. The preview modal shows the image and save action, but no attribution. | Add source text in the modal footer next to save/original actions. |
| `app/(authed)/me/routebooks/ui.tsx:245-280` | Routebook list cards with cover / first-point image | No, but provenance is mixed. `metadata.cover` is generic; `firstPointImage` is likely Anitabi-derived. | Needs product decision. Only annotate the `firstPointImage` path unless the data model splits cover vs. Anitabi image. |
| `app/(authed)/me/routebooks/[id]/components/PlannerPointPoolPanel.tsx:36-92` | Point pool tiles | No. The tiles render `preview.image` with no source UI. | Add a compact `via Anitabi` label below the image. |
| `app/(authed)/me/routebooks/[id]/components/PlannerRoutePanel.tsx:56-161` | Route stop cards and checked-in cards | No. The preview image is shown with no provenance text. | Add a compact source label in the card footer. |
| `app/(authed)/me/routebooks/[id]/components/RouteBookImmersiveMode.tsx:179-185,272-277` | Immersive first-stop card and per-point image view | No. Both states render the image without attribution UI. | Add source text beneath the image in both states. |
| `components/share/CheckInCard.tsx:54-119` | Exported check-in share card | No. The canvas uses the image directly and has no source footer or watermark. | Add an attribution footer/watermark in the canvas. The exported image itself has no visible source today. |
| `components/share/RouteBookCard.tsx:80-223` | Exported routebook share card | No. The canvas uses point images and map art, but no attribution footer. | Add attribution in the canvas footer or alongside the QR code. |

Not included: `app/(authed)/me/favorites/ui.tsx` was inspected and treated as out of scope because its `item.cover` values are generic article/MDX covers and the file does not prove Anitabi provenance.

### Recommended 5.3 change set

Start with the highest-value visible surfaces:

1. `components/map/PointPopupCard.tsx`
2. `features/map/anitabi/DetailPanel.tsx`
3. `components/quickPilgrimage/QuickPilgrimageMode.tsx`
4. `features/map/anitabi/MapDialogs.tsx`
5. `components/share/CheckInCard.tsx`
6. `components/share/RouteBookCard.tsx`

If the map rail surfaces also need labels, extend the same treatment to:

1. `features/map/anitabi/ExplorerPanelContent.tsx`
2. `features/map/anitabi/useMapInteractionActions.tsx`
3. `components/map/WindowExcerptOverlay.tsx`
4. `components/map/MobileVisualCenterOverlay.tsx`
5. `app/(authed)/me/routebooks/[id]/components/PlannerPointPoolPanel.tsx`
6. `app/(authed)/me/routebooks/[id]/components/PlannerRoutePanel.tsx`
7. `app/(authed)/me/routebooks/[id]/components/RouteBookImmersiveMode.tsx`

Routebook list cards need a decision on whether `firstPointImage` should get attribution independently from generic routebook covers:

1. `app/(authed)/me/routebooks/ui.tsx`
