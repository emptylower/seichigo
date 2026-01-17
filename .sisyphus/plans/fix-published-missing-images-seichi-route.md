# Fix intermittent missing images and SeichiRoute on published pages

## Goal
Eliminate intermittent missing images and SeichiRoute blocks on published article pages, ensure data consistency between draft/revision and published views, add tests, and push the fix to remote.

## Observations and Evidence
- Published pages render from `contentHtml` + `renderRichTextEmbeds(...)`, while drafts use `contentJson` in the editor.
- `lib/richtext/sanitize.ts` treats `data-figure-image-frame` and `data-figure-image-container` as valid only when the attribute value is exactly "true".
- Boolean attributes (present without a value or empty string) get dropped by `exclusiveFilter`, removing the wrapper `div` and its child `img`.
- `tests/repro_image_drop.test.ts` demonstrates that `data-figure-image-frame` without a value causes `sanitizeRichTextHtml` to return an empty string.
- `renderRichTextEmbeds` for `seichi-route` uses `data-id` to map into JSON; missing/empty id causes the block to vanish.
- User reports issue is intermittent across refreshes on the same published article, indicating multiple rendering paths or data sources produce different HTML outcomes.

## Hypothesis
1) Some request path uses DOM-serialized HTML (boolean attributes) instead of `editor.getHTML()`, resulting in sanitize dropping image wrappers and wiping images in `contentHtml`.
2) Similar path intermittently drops `data-id` on `seichi-route` nodes, causing `renderRichTextEmbeds` to delete the block.

## Fix Strategy (ordered)
1) Make `sanitizeRichTextHtml` tolerant of boolean attributes for figure image wrappers.
2) Make `renderRichTextEmbeds` resilient to missing/empty `data-id` by rendering a visible placeholder and logging the anomaly.
3) Identify and remove any HTML serialization path that uses DOM `innerHTML` or other non-TipTap serialization.
4) Add tests to lock in behavior.
5) Repair affected published articles if needed.

---

## Implementation Plan

### Step 1: Reproduce and Collect Evidence
- Reproduce on the provided slug in a production-like environment.
- Inspect published HTML (View Page Source) for:
  - Presence/absence of the missing asset id.
  - Presence of `<seichi-route>` tags and whether `data-id` is empty.
- Capture server logs around sanitize and embed rendering (add temporary logging if needed) to confirm which branch is dropping content.

### Step 2: Sanitize Fix (images)
- In `lib/richtext/sanitize.ts`, introduce helper:
  - `isMarkerTrue(val)` returns true if attribute exists and is `"true"` or empty string.
- Replace strict checks for:
  - `data-figure-image-frame`
  - `data-figure-image-container`
- Normalize output so markers are written as `="true"` to prevent re-introducing boolean attributes.
- Add or update tests:
  - `tests/repro_image_drop.test.ts` should assert that boolean attributes are preserved rather than dropped.
  - Add a new sanitize test ensuring `data-figure-image-frame` with empty value still yields a valid output containing `img`.

### Step 3: SeichiRoute Robustness
- Update `renderRichTextEmbeds` to handle missing or empty `data-id`:
  - Instead of returning `""`, render a placeholder element with a clear warning for admins (e.g. "路线块数据异常，请发起更新重存").
  - Log a structured server warning including slug/id.
- Add tests to `tests/editor/seichi-route.test.tsx`:
  - Verify that missing `data-id` does not disappear silently.

### Step 4: Remove DOM Serialization Path
- Search for any code path that serializes DOM HTML (e.g., `innerHTML`, `outerHTML`, `XMLSerializer`, `DOMParser`).
- Ensure that all content writes to DB use TipTap `editor.getHTML()` and `editor.getJSON()` rather than DOM.
- Confirm the publish/approve/revision paths update both `contentHtml` and `contentJson` consistently.

### Step 5: Data Repair (if needed)
- Add a one-off script or admin operation to regenerate `contentHtml` from `contentJson` for affected articles.
- Apply to the affected slug to validate the fix.

### Step 6: Verification
- Run `lsp_diagnostics` on modified files.
- Run test suite:
  - `npm test`
  - Confirm new/updated tests pass.
- Smoke test published page rendering:
  - Verify images and SeichiRoute render consistently across refreshes.

### Step 7: Git and Deploy
- Stage changes and commit with a concise message.
- Push to remote as requested.

---

## Files Likely Involved
- `lib/richtext/sanitize.ts`
- `lib/richtext/embeds.ts`
- `tests/repro_image_drop.test.ts`
- `tests/editor/seichi-route.test.tsx`
- Publish/approve handlers (locate any HTML serialization path)

---

## Acceptance Criteria
- Published article consistently shows all images and SeichiRoute blocks across refreshes.
- No content is removed by sanitizer when boolean attributes are present.
- SeichiRoute blocks never disappear silently; missing data is visible and logged.
- Tests pass.
- Changes pushed to remote.
