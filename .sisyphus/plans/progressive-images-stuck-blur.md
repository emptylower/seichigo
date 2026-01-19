# Progressive Images Stuck/Slow Until Refresh (Post Images)

## Objective
Debug and fix the bug: on a specific post (and possibly others), images remain in the blurred/placeholder “loading” state on reopen/back/forward/client-side navigation, while a hard refresh immediately makes them render correctly.

Primary suspected area: client-side progressive image enhancer `ProgressiveImagesRuntime` (DOM scan + observers) not re-initializing reliably across route transitions / cache restores.

## Key Repo Context (Facts)
- Posts page mounts the runtime at `app/(site)/posts/[slug]/page.tsx` via `<ProgressiveImagesRuntime />` (currently unkeyed).
- Progressive image system:
  - MDX images: `lib/mdx/mdxComponents.tsx` rewrites `/assets/:id` to `placeholder/sd/hd` URLs and emits `<img data-seichi-*>`.
  - DB article images: `lib/richtext/sanitize.ts` (when `imageMode: 'progressive'`) does the same rewrite and adds `data-seichi-*` attrs.
  - Client runtime: `components/content/ProgressiveImagesRuntime.tsx` scans DOM for `img[data-seichi-full]`, attaches click handlers + `IntersectionObserver`, upgrades placeholder→SD and removes blur on `load`, then schedules HD swap.
- TOC system:
  - `components/toc/ArticleToc.tsx` performs mount-time DOM mutations and has its own scroll-based measurements; can contribute to jank and can also go stale across navigation.
- Assets route:
  - `/app/assets/[id]/route.ts` + `lib/asset/handlers.ts` serve transformed images via `sharp` with `Cache-Control: public, max-age=31536000, immutable` and no `ETag`. Progressive loading requests 3 variants per image.
- Existing tests:
  - `tests/content/progressive-images.test.tsx` covers placeholder→sd→hd and lightbox, but NOT navigation/remount/back-forward behavior.

## Success Criteria (Pass/Fail)
Functional:
- Client-side navigation between two posts (A→B, B→A) triggers progressive upgrades on the current post’s images every time.
- Returning via Back/Forward (router cache/bfcache scenarios) does not leave images stuck at placeholder or `data-seichi-blur="true"` indefinitely.
- Lightbox continues to work on every navigation (click opens dialog with `data-seichi-full`).
- TOC reflects the current post after navigation.

Observable (DevTools):
- In the broken scenario, after navigation, `img[data-seichi-full]` should quickly get `data-seichi-stage="sd"` then `data-seichi-blur="false"` when SD loads.
- Network should show SD requests (`?w=854`) being made when images approach viewport.

Regression / Hygiene:
- No accumulated scroll/resize handlers or observers after 10 route transitions.
- `npm test` passes.

## Reproduction Matrix
Run each case with cold cache and warm cache:
1. Hard refresh open (baseline): load post → scroll → verify upgrades.
2. Client-side navigation:
   - Open post A → click in-app link to post B → images upgrade.
   - Navigate back to A (Back button) → images upgrade.
3. Back-forward cache angle:
   - Open post → navigate away (another route) → back/forward repeatedly.
4. Browser:
   - Chrome stable
   - Safari (if available)

## Hypotheses (Ranked)
H1 (highest): Runtime persistence across navigation.
- `ProgressiveImagesRuntime` effect depends only on `[selector]` (default string constant). If component instance is preserved, effect does not rerun; new post images never get observers/click handlers → remain blurred/placeholder until hard refresh.
- Same pattern likely affects `ArticleToc`.

H2: “Stuck blur” resume-state bug.
- Runtime skips images with `data-seichi-stage` already set. If an image is in stage `sd` but blur never flipped (e.g., due to timing/bfcache restore), later scans won’t fix it.

H3: Performance-driven “looks stuck”.
- Image-heavy posts trigger: `IntersectionObserver` targets + scroll polling + TOC `offsetTop` reads → forced reflow thrash. Could make upgrades appear delayed.

H4: Assets route behavior.
- Many variants + sharp transforms + missing ETag could cause real slowness on reload/revalidation, but does NOT explain “refresh makes it instant” as cleanly as H1/H2.

## Fix Plan
### Phase 1: Minimal Fix (high confidence)
Goal: guarantee re-initialization per post view.

Option A (preferred quick fix): Key the post subtree.
- In `app/(site)/posts/[slug]/page.tsx` add `key={canonicalSlug}` on a wrapper that includes both `ArticleToc` and `ProgressiveImagesRuntime`.
- Outcome: on slug change, React unmounts/remounts the subtree → effects re-run and cleanups happen.

Option B (component-level robustness): Rerun effects on route change.
- In `components/content/ProgressiveImagesRuntime.tsx`, depend on `usePathname()` (or accept an explicit `scanKey` prop).
- In `components/toc/ArticleToc.tsx`, do the same.
- Outcome: even if component is moved into a shared layout in future, it will re-scan correctly.

Decision guideline:
- If you want least invasive fix with maximum coverage now: Option A.
- If you want future-proofing against layout moves: Option B (or do both).

### Phase 2: Hardening (if minimal fix doesn’t fully resolve)
1. Resume stuck states in `ProgressiveImagesRuntime`:
- If image has `src` already at SD but blur still true, clear blur once `img.complete && img.naturalWidth > 0`.
- If `data-seichi-stage="sd"` and blur true, attach a `load` listener again (or proactively clear if complete).
- Add `error` handling to avoid permanent blur on failed loads.

2. Reduce reflow thrash (perf follow-up, not required for correctness):
- Prefer IntersectionObserver-only (remove scroll polling) if behavior remains correct.
- For TOC, avoid reading `offsetTop` on every scroll; consider IntersectionObserver-based active heading.

3. Optional bfcache/pageshow handling:
- On `pageshow` with `persisted`, trigger a re-scan.

### Phase 3: Assets route improvements (only if slowness persists)
- Add `ETag` in `lib/asset/handlers.ts` so reloads can get 304 instead of full DB fetch + sharp.
- Reconsider `immutable` if IDs are not content-hashed.
- Cache sharp outputs server-side if repeatedly requested.

## Test Plan (Vitest)
### Objective
Catch regressions where images remain stuck in blur/placeholder after navigation-like updates.

### New/Updated Tests
1. Navigation simulation (no remount) test in `tests/content/progressive-images.test.tsx`:
- Render initial DOM with one image + `<ProgressiveImagesRuntime />`.
- Replace article DOM content with a different image (simulate “post changed”) without unmounting runtime.
- Assert: runtime can be forced to re-scan (this test will guide whether you choose keying vs pathname deps).

2. Keyed remount test:
- Render runtime with `key={slug}`.
- Rerender with new slug and new image.
- Assert: new observer attaches and lightbox works for the new image.

3. Resume stuck blur test (hardening):
- Create an image state: `src=sd`, `data-seichi-stage=sd`, `data-seichi-blur=true`.
- Simulate cached completion (define `complete=true`, `naturalWidth>0` in jsdom).
- Assert: blur clears and HD scheduling occurs.

### Commands
- Focused: `npm test -- tests/content/progressive-images.test.tsx`
- Full: `npm test`

## Manual Verification Checklist
- Open problematic post.
- Navigate to another post via in-app link; then Back.
- Confirm:
  - images upgrade (placeholder→SD→HD) without waiting “forever”
  - blur clears
  - lightbox opens
  - TOC matches current post
- Repeat 10 times; watch for duplicated listeners (DevTools Performance/Memory optional).

## Notes / Open Questions
- This specific production URL likely resolves to a DB article (not MDX) because `content/zh/posts` currently contains only `README.md` in this repo snapshot.
- If the bug truly happens on a hard refresh (not navigation), revisit H2/H4 first (resume-state and asset route).
