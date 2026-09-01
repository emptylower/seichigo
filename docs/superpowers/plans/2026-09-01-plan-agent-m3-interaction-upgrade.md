# Plan Agent M3 Interaction Upgrade - Execution Brief

> This document is the complete implementation brief for the delegated coding agent.
> The caller owns the design and acceptance decision. Do not treat this file as a
> request to rewrite the product scope. Implement the smallest coherent change that
> satisfies every requirement below, preserve existing behavior where explicitly
> called out, and report unfinished items instead of silently omitting them.

## 0. Target and working-tree rules

- Target worktree: `/Users/mac/Desktop/seichigo-worktrees/plan-agent-m1`.
- Target branch: `feat/plan-agent-m1`.
- Read the root `AGENTS.md` and any closer `AGENTS.md` files before editing.
- The worktree already contains unrelated, uncommitted MapTiler/map-style failover
  work. It is intentional and must be preserved. Do not run `git reset`,
  `git checkout`, `git restore`, or broad formatting/cleanup.
- Do not modify these unrelated files unless a build break makes it unavoidable:
  `components/route/RoutePreviewMap.tsx`,
  `components/route/mapStyleFailover.ts`,
  `docs/superpowers/plans/2026-09-01-plan-agent-map-failover.md`,
  `tests/route/route-preview-map-style.test.ts`, and the existing `scratch/`
  directory.
- Keep all changes scoped to the plan agent, plan-day rendering, directions/place
  retrieval, image proxy/R2 integration, tests, and the two approved plan/spec docs.
- Never expose or print values from `.env.local`. Google credentials remain
  server-only.

## 1. Product objective

Extend the existing Plan Agent M1 implementation into the approved M3 expansion.
The final Daymap must be a reliable structured itinerary, not only model prose:

1. Any agent question that needs a user answer must use `ask_user` and render a
   choice card. The existing date picker and work-preference cards remain intact.
   Ordinary opinion questions get dynamic options plus a final custom-input option;
   the always-available composer remains the ultimate fallback.
2. Choice cards for works show a cover image using the same source precedence and
   display ladder as `/map`. Missing images are read through existing fallbacks and
   mirrored to R2 without corrupting canonical Anitabi data.
3. Any user-requested non-work place that Google Maps can resolve (for example,
   Tokyo Disneyland) becomes a real point in that day's timeline, map, and route.
   Use the first Google result automatically. Persist its coordinates, identity,
   source, and image metadata; mirror the image to R2.
4. Every Daymap point card shows a concrete scheduled time. All items are ordered
   from early to late. Vague model words such as "午后" or "傍晚" may remain as a
   note, but may not be the only time shown; generated/reference times must be
   labelled as such.
5. Transport between points is explicit and consistent with the map: walking
   minutes; public-transit line/vehicle, stops, and ride duration; mixed walk plus
   transit legs; and driving duration for car/rental plans. Exact dates use the
   real dated route query where Google supports it.
6. Rural or poorly covered areas must not be forced into public transit. The agent
   asks the user through the choice-card protocol, recommends driving/rental when
   appropriate, and follows the chosen mode.
7. External facts and generated options require a real, retained citation/source.
   Missing or failed provider data degrades to explicit error information, never
   fabricated coordinates, images, routes, or claims.

## 2. Existing implementation to preserve and extend

Inspect the actual current files before editing; the following are the important
boundaries:

- Agent protocol and loop: `lib/planAgent/askUser.ts`, `lib/planAgent/tools.ts`,
  `lib/planAgent/prompt.ts`, `lib/planAgent/loop.ts`.
- Plan API/resume flow: `app/api/me/plans/[id]/agent/route.ts` and the existing
  plan handlers/repositories.
- Ask UI: `app/(authed)/plan/[id]/components/AskCard.tsx` and
  `app/(authed)/plan/[id]/ui.tsx`.
- Daymap presentation and route fetching:
  `app/(authed)/plan/[id]/components/DayCards.tsx` plus the existing plan route
  geometry route.
- Google route adapter: `lib/directions/handlers/directions.ts` and its route
  wrapper/tests.
- Anitabi image delivery/mirroring: `lib/anitabi/imageProxy.ts`,
  `lib/anitabi/handlers/imageServe.ts`, `lib/anitabi/r2Mirror.ts`, and Cloudflare
  binding helpers.
- Current persistence model: `TripPlan`, `TripPlanDay`, `TripPlanItem`, and
  `TripPlanMessage` in `prisma/schema.prisma`. `TripPlanItem.payload` is the
  intended low-risk location for heterogeneous external place, schedule,
  transport, media, and provenance data.

Do not undo the current date-picker behavior, work-preference card behavior, M1
plan APIs, the existing route-map style failover, or the successful DeepSeek
streaming/error handling.

## 3. Interaction contract

### 3.1 Mandatory ask-user rule

- Update the model instructions and server loop so an agent question cannot be
  delivered as ordinary assistant prose alone.
- A response may contain explanatory prose and an `ask_user` tool call in the same
  round. The tool call is the authoritative pending interaction.
- Add a narrow server-side guard for obvious interrogative intent (Chinese question
  wording, `?`, `？`, request/choice phrases) when no ask tool was emitted. Retry the
  model once with a corrective instruction; if it still violates the contract,
  persist and emit a clear recoverable protocol error rather than accepting an
  unanswerable question.
- Do not classify ordinary explanatory sentences such as a "why this order" reason
  as a user question unless they actually request an answer.

### 3.2 Choice cards and custom input

- Keep `date_range` semantics and the existing date picker unchanged.
- Keep existing single/multi work-preference choice behavior unchanged.
- For ordinary single/multi choice asks, reserve at least one final option for
  custom text. The server/tool validation should cap model-supplied options so the
  reserved custom option always fits the existing limit.
- Selecting the custom option opens/focuses text entry in the card. Direct typing
  in the global composer while an ask is pending must submit as the answer to that
  ask, carrying the correct `askId`; it must not create an unrelated chat turn.
- A custom answer may coexist with selected options for a multi-choice ask.
- Historical ask messages must remain renderable after the new fields are added.
- Keep Chinese user-facing error messages consistent with existing plan UI.

### 3.3 Option evidence and media

Every generated option should carry enough provenance for later audit:

- source kind/provider;
- source URL or stable provider identifier;
- fetched-at timestamp;
- image source/attribution when an image exists.

Do not make an uncited web-search claim an option. Reuse an existing server-side
search adapter if it is suitable; do not expose a search API key to the client.

## 4. Work cover retrieval

Implement a single reusable cover-resolution path for ask cards and plan items:

1. Local Anitabi work cover first.
2. Existing local work mapping/cover sources next (for example the linked Anime or
   BGM subject data where available).
3. A reliable external fallback only when it has a source and can be displayed.

Use the existing `/map` image candidate ladder and proxy behavior. Do not duplicate a
second ad-hoc image URL policy in the UI.

For Google images, prefer a server-side fetch using the existing server key and
store only a key-less display/proxy URL and provider metadata. Never persist a
Google API key in a browser URL, JSON payload, log, or R2 metadata.

Extend the image host allowlist/proxy logic only as narrowly as required for Google
Places photo hosts. Retain SSRF validation, MIME checks, response-size limits, and
safe redirect handling.

Mirror successful external image bytes to the existing R2 image cache. Record the
logical source, R2 key/status, MIME, and mirror time. Use read-through plus
background mirroring so a slow mirror does not block the card. If R2 is unavailable,
display the safe provider/proxy fallback and expose a non-fatal mirror status.

## 5. Google non-work place resolution

Add a backend-only place-resolution capability following the repository's existing
route-wrapper/handler/dependency-injection patterns.

- Reuse the current server-side Google key (`GOOGLE_DIRECTIONS_API_KEY`, with the
  existing fallback convention if already present). The key must have the required
  Places API enabled; return a clear configuration error otherwise.
- Resolve a text query to Google Places, automatically select the first result, and
  retain place ID, canonical name, address, lat/lng, Maps URI, provider/source,
  photo reference, and fetch time.
- Do not invent a point when no result exists. Return a typed/provider error that
  the agent can explain to the user.
- Let a geolocated external item use the existing `point` timeline semantics while
  allowing a null Anitabi `pointId` when a valid `payload.place` is present; keep
  internal Anitabi points requiring their normal point ID. If the repository chooses
  `attraction` for a non-work POI, it must still be treated as a map/routing point
  whenever `payload.place` has coordinates.
- Deduplicate repeated place IDs within a plan and avoid unnecessary Places calls.
- Apply user/plan/provider rate limits and bounded caching consistent with existing
  server limits.

Recommended logical payload sections (adapt to existing TypeScript conventions;
do not add a new table unless inspection proves it is necessary):

- `place`: provider, placeId, name, address, lat, lng, maps URI, photo metadata,
  fetchedAt.
- `schedule`: start/end local time, duration, confidence/source.
- `transport`: mode, departure/arrival, duration/distance, provider/source,
  fetchedAt, and ordered legs/steps.
- `media`: source, display/proxy URL or R2 key, attribution, mirror status.

## 6. Schedule normalization and Daymap ordering

The model may suggest a rough order, but a deterministic backend normalizer must
produce the final order before saving and before rendering:

- Resolve every item to a valid local time range. Explicit user/model times win;
  missing times are derived from day start, visit duration, and inter-point travel.
- Convert broad labels to a concrete reference time while retaining the original
  label as explanatory text.
- Include transit rows in the same chronological sequence as their origin and
  destination.
- Sort all saved items by resolved local start time and regenerate stable
  `sortOrder` values. The UI must also defensively sort structured times rather
  than trusting insertion order.
- Validate invalid times, impossible overlaps, missing coordinates for routed items,
  and external points without `payload.place`. Retry/re-normalize or return an
  explicit error; never silently drop a point.
- Date and time calculations use the destination/day city timezone. Fuzzy date plans
  use estimated/reference transport and schedule labels.

Every visible point card must show a time string, not only "午后/傍晚". The UI may
show a small reference/estimated marker, but the actual clock time must be present.

## 7. Real transport and route rendering

Reuse and extend the existing Google Directions adapter instead of adding a second
incompatible client:

- Accept walking, transit, and driving requests, with departure datetime when the
  plan has an exact date/time.
- Preserve full Google leg/step data, including walking segments, transit line or
  vehicle name/number, departure/arrival stops, stop count, duration, distance, and
  instructions.
- For a mixed journey, present every leg in order: walk to stop, ride the service,
  walk from the destination stop to the place.
- For transit `ZERO_RESULTS`, do not silently convert the user's requested transit
  plan into a walking-only plan. Return a distinguishable result so the agent asks
  the user about driving/rental or another mode.
- For driving/rental, retain the drive duration and distance and show it on the
  transition before the destination.
- Keep provider errors, quota errors, and unavailable routes explicit and localized.

The Daymap map must receive the same point coordinates and route mode/details used
by the timeline. Internal and external coordinates both participate in route
geometry. Prefer provider geometry for the selected mode/date; retain the existing
map geometry as a clearly marked visual fallback only when the authoritative route
cannot be drawn. Do not touch the independent MapTiler style failover files.

## 8. Public-transit convenience policy

The agent must ask before forcing an inconvenient route:

- Hard trigger: provider reports no public-transit route.
- Soft trigger: configurable poor-coverage signal such as excessive transfers,
  unavailable service window, or transit time materially worse than driving.
- The ask card should offer the recommended driving/rental choice, public transit,
  mixed mode, and custom input. The option count remains model-controlled apart
  from the mandatory custom fallback.
- Once the user chooses a mode, use that mode for subsequent route calls and explain
  the consequence in the Daymap.

Do not use a hidden heuristic to force public transit in rural pilgrimage examples
such as Yuru Camp.

## 9. Documentation updates required in the implementation

Update the approved design and M1 plan documents to reflect that this is an M3
scope expansion, not a contradiction hidden in code:

- `docs/superpowers/specs/2026-08-31-plan-agent-ia-redesign-design.md`
- `docs/superpowers/plans/2026-08-31-plan-agent-m1.md`

Document the ask-user contract, custom fallback, media/source precedence, Google
POI persistence, R2 mirroring, schedule normalization, real transport details,
poor-transit question flow, provider quotas/errors, and the revised acceptance
matrix. Preserve the existing M1 history; add a dated change entry rather than
rewriting historical decisions.

## 10. Required verification

Add or update focused tests in the repository's existing Node/JSDOM split. At a
minimum cover:

- ask-user validation, mandatory custom option, direct composer fallback, and
  historical payload compatibility;
- protocol guard behavior for a prose-only question and for prose plus ask tool;
- local cover precedence, fallback candidates, safe Google image handling, and R2
  mirror metadata without secret leakage;
- first-result Google place resolution, deduplication, provider/configuration
  errors, and external-point payload validation;
- schedule normalization, vague-time conversion, chronological sort, transit-row
  placement, and conflict/error handling;
- Directions parsing for walking, driving, transit, and mixed walk/transit legs,
  including exact departure time and `ZERO_RESULTS` preservation;
- Daymap rendering of internal plus external points, visible concrete times, route
  details, and map geometry fallback.

Run focused tests first, then the relevant type checks, then the full test command
appropriate for the changed areas. Do not claim success for a command that was not
run. If external credentials or a live database prevent an integration test, add a
deterministic injected-dependency test and report the missing live gate explicitly.

## 11. Definition of done

The change is complete only when:

- all requirements in sections 3-8 are implemented without regressing existing
  date/work cards;
- no external point is silently dropped from the timeline or map;
- every point card has a concrete time and the saved/rendered order is chronological;
- transport text and map geometry describe the same selected route/mode/date;
- all external images and facts have safe provenance and failure behavior;
- tests and type checks pass, or any blocker is reported with the exact command and
  reason;
- `git status` and `git diff` clearly show only scoped changes plus the pre-existing
  map failover files listed in section 0.

At the end, report changed files, tests run/results, known limitations, and whether a
preview deployment is safe. Do not deploy production as part of this task.
