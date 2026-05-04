# Anitabi Attribution Audit (PR3 §6)

Scope: I reviewed only real rendering surfaces in `app/`, `components/`, and `features/`. I treated backend transforms and data shaping as context only, and I excluded generic cover cards that are not clearly Anitabi-derived.

`originLink` was treated as a real attribution link. Visible `origin` text without a link was treated as partial attribution, not a source link.

| File | Surface | Already attributes? | Status | Action |
| --- | --- | --- | --- | --- |
| `components/map/PointPopupCard.tsx:114-180` | Point popup image card in the map popup | Partial. It shows `point.origin` as visible text, but no `originLink` or source URL. | Ready | Add a compact visible `via Anitabi` / source link near the meta chips. Keep the Google Maps action separate. |
| `features/map/anitabi/DetailPanel.tsx:98-115` | Selected point detail strip | Partial. It shows `selectedPoint.origin`, but not a clickable source link. | Ready | Add a small source link or micro-label beside the origin chip. |
| `features/map/anitabi/DetailPanel.tsx:191-201` | Bangumi work-detail cover in the sidebar | No. The cover renders with no attribution UI. | Ready | Add a `via Anitabi` micro-link under the cover or in the card footer. |
| `features/map/anitabi/ExplorerPanelContent.tsx:260-303` | Bangumi explorer list cards | No. The card cover is rendered without any source/origin UI. | Ready | Add a compact attribution footer or micro-link below the cover/title block. |
| `components/map/WindowExcerptOverlay.tsx:77-145` | Desktop bangumi avatar rail and point card rail | No. The rail cards render covers/thumbnails only. | Decision | Needs product decision. The rail is cramped, so use a single compact source label only if the design can absorb it. |
| `components/map/MobileVisualCenterOverlay.tsx:63-143` | Mobile bangumi row and point strip | No. The compact mobile chips render covers/thumbnails only. | Decision | Needs product decision. Prefer a tiny source chip only if it does not break the rail. |
| `components/quickPilgrimage/QuickPilgrimageMode.tsx:363-367` | Intro cover from `resolveAnitabiAssetUrl(bangumi.card.cover)` | No. The cover renders with no attribution UI. | Ready | Add a compact source label under the intro cover. |
| `components/quickPilgrimage/QuickPilgrimageMode.tsx:507-514` | Current point image from `resolveAnitabiAssetUrl(currentPoint.image)` | No. The image renders with no attribution UI. | Ready | Add a compact `via Anitabi` label or source link near the image caption. |
| `components/checkin/CheckInModal.tsx:146-162` | Shared check-in modal reference image. QuickPilgrimageMode passes `referenceImageUrl` from `components/quickPilgrimage/QuickPilgrimageMode.tsx:656-660`; RouteBookImmersiveMode also passes `currentPreview.image` from `app/(authed)/me/routebooks/[id]/components/RouteBookImmersiveMode.tsx:272-277`. | No. The shared modal renders the reference image with no visible attribution UI. | Shared | Add attribution in `CheckInModal`; treat the caller prop handoffs as context only, not as visible source credit. |
| `features/map/anitabi/useMapInteractionActions.tsx:256-309` | Preview image button for the selected point via `ResilientMapImage` and `openImagePreview` handoff | No. The control is labeled as a preview action, not source attribution. | Context | Treat this row as caller context only. Do not assign preview attribution ownership here unless product wants an inline source label directly on the trigger. |
| `features/map/anitabi/MapDialogs.tsx:256-285` | Image preview modal for point images | No. The preview modal shows the image and save action, but no attribution. | Ready | Implementation owner for preview attribution. Add source text in the modal footer next to save/original actions. |
| `app/(authed)/me/routebooks/ui.tsx:245-280` | Routebook list cards with cover / first-point image | No, but provenance is mixed. `metadata.cover` is generic; `firstPointImage` is likely Anitabi-derived. | Decision | Only annotate the `firstPointImage` path unless the data model splits cover vs. Anitabi image. |
| `app/(authed)/me/routebooks/[id]/components/PlannerPointPoolPanel.tsx:36-92` | Point pool tiles | No. The tiles render `preview.image` with no source UI. | Ready | Add a compact `via Anitabi` label below the image. |
| `app/(authed)/me/routebooks/[id]/components/PlannerRoutePanel.tsx:56-161` | Route stop cards and checked-in cards | No. The preview image is shown with no provenance text. | Ready | Add a compact source label in the card footer. |
| `app/(authed)/me/routebooks/[id]/components/RouteBookImmersiveMode.tsx:179-185,272-277` | Immersive first-stop card and per-point image view | No. Both states render the image without attribution UI. | Ready | Add source text beneath the image in both states. |
| `components/share/CheckInCard.tsx:54-119` | Exported check-in share card | No. The canvas uses the image directly and has no source footer or watermark. | Ready | Add an attribution footer/watermark in the canvas. The exported image itself has no visible source today. |
| `components/share/RouteBookCard.tsx:80-223` | Exported routebook share card | No. The canvas uses point images and map art, but no attribution footer. | Ready | Add attribution in the canvas footer or alongside the QR code. |

Not included: `app/(authed)/me/favorites/ui.tsx` was inspected and treated as out of scope because its `item.cover` values are generic article/MDX covers and the file does not prove Anitabi provenance.

Status legend: `Ready` = implementation owner is clear, `Shared` = one rendering owner serves multiple flows, `Context` = caller/handoff only, `Decision` = product call needed before implementation.

### Recommended 5.3 change set

Start with the highest-value implementation owners and shared renderers:

1. `components/map/PointPopupCard.tsx`
2. `features/map/anitabi/DetailPanel.tsx`
3. `components/quickPilgrimage/QuickPilgrimageMode.tsx`
4. `components/checkin/CheckInModal.tsx`
5. `features/map/anitabi/MapDialogs.tsx`
6. `components/share/CheckInCard.tsx`
7. `components/share/RouteBookCard.tsx`

If the map rail surfaces also need labels, extend the same treatment to:

1. `features/map/anitabi/ExplorerPanelContent.tsx`
2. `app/(authed)/me/routebooks/[id]/components/PlannerPointPoolPanel.tsx`
3. `app/(authed)/me/routebooks/[id]/components/PlannerRoutePanel.tsx`
4. `app/(authed)/me/routebooks/[id]/components/RouteBookImmersiveMode.tsx`

Context-only rows to keep out of ownership assignment unless product explicitly wants inline labels:

1. `features/map/anitabi/useMapInteractionActions.tsx`

Product-decision rows:

1. `app/(authed)/me/routebooks/ui.tsx`
2. `components/map/WindowExcerptOverlay.tsx`
3. `components/map/MobileVisualCenterOverlay.tsx`
