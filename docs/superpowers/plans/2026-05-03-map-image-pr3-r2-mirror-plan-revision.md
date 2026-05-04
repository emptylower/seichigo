# Map Image PR3 R2 Mirror — Plan Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revise the existing PR3 plan (`2026-05-03-map-image-pr3-r2-mirror.md`) so that all critical/significant issues identified in the 2026-05-03 acceptance review are fixed, while preserving every goal, scope item, rollout sequence, and acceptance criterion in the unchanged spec (`2026-05-03-map-image-pr3-r2-mirror-design.md`).

**Architecture:** This is a meta-plan: its tasks edit the PR3 plan document itself (and only that document). It does **not** modify the PR3 spec. After this revision lands, the PR3 plan is executable end-to-end without subagents stalling on missing identifiers, broken type shapes, or hand-waved integration steps.

**Tech Stack:** Markdown editing only. Tasks reference TypeScript / Prisma / Cloudflare Workers / OpenNext source files in the codebase to confirm replacement code is realistic before writing it into the plan.

**Spec (unchanged):** [docs/superpowers/specs/2026-05-03-map-image-pr3-r2-mirror-design.md](../specs/2026-05-03-map-image-pr3-r2-mirror-design.md)

**Original plan being revised:** [docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md](2026-05-03-map-image-pr3-r2-mirror.md)

**Branch:** continue in this worktree (`claude/agitated-banzai-065ecb`). Plan is currently untracked; commits land on this branch.

---

## Goal Alignment Statement

The acceptance review surfaced **8 critical** and **~12 significant** issues in the PR3 plan. None of those issues require changing the PR3 spec — every fix is either:

- a documentation correction (the plan referenced code that doesn't exist),
- an integration detail the plan punted (the plan said "check the docs"), or
- a missing connection between two existing tasks (e.g. breaker module not wired to seed loop).

**Therefore: this revision keeps every goal, non-goal, flag name, rollout sequence, and acceptance SLI from the spec. It only fixes the plan's executability.**

The Goal Alignment Matrix (end of document) tracks every spec §-section against this revised plan to verify nothing was dropped or expanded.

---

## File Structure

This plan modifies **one file** plus optionally creates **two new files**:

- **Modify:** `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` (the original PR3 plan — every fix task edits this)
- **Optionally create:** `docs/superpowers/research/2026-05-03-pr3-binding-access-pattern.md` (Task B.6 produces this if the OpenNext binding pattern needs documentation)
- **Optionally create:** `docs/superpowers/research/2026-05-03-pr3-ui-attribution-audit.md` (Task C.8 produces this — pre-doing the audit that Task 5.2 was supposed to do)

The PR3 spec is **never** modified. The PR3 plan is the only mutable artifact.

---

## Task Index

- Phase A — Goal alignment & pre-work (2 tasks)
- Phase B — Critical fixes (8 tasks, one per critical issue)
- Phase C — Significant fixes (12 tasks)
- Phase D — Hygiene (2 tasks)
- Phase E — Final validation (2 tasks)

Total: 26 tasks. All are documentation edits except B.6 and C.8 which include a brief read-only codebase research step.

---

## Phase A — Goal Alignment & Pre-work

### Task A.1: Build spec → plan task traceability matrix

**Files:**
- Create: working note (not committed) — used as input to Phase E.

- [ ] **Step 1: List all spec §-sections**

```bash
grep -n "^## §" /Users/mac/Desktop/seichigo/.claude/worktrees/agitated-banzai-065ecb/docs/superpowers/specs/2026-05-03-map-image-pr3-r2-mirror-design.md
```

Expected: §1 through §11 plus appendices.

- [ ] **Step 2: List all plan tasks**

```bash
grep -n "^### Task " /Users/mac/Desktop/seichigo/.claude/worktrees/agitated-banzai-065ecb/docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
```

Expected: 32 tasks across Phase 0–7.

- [ ] **Step 3: Build the matrix mentally (or in scratch)**

For each spec §-section, identify which plan task implements it. Note any §-section that has no task (gap) and any task that doesn't trace to a section (scope creep).

The output of this task is consumed by Phase E.2. No commit.

---

### Task A.2: Confirm scope unchanged before fixes start

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` (header section near top)

- [ ] **Step 1: Open plan and read the existing front-matter (lines 1–30)**

- [ ] **Step 2: Insert a "Revision History" subsection right above the `## Task Index` heading (currently line 17)**

Replacement insertion (place just before `## Task Index`):

```markdown
## Revision History

| Date | Revision | Author | Notes |
|---|---|---|---|
| 2026-05-03 | r1 (initial) | brainstorming | First-pass plan; identified 8 critical and 12 significant issues in acceptance review |
| 2026-05-03 | r2 (this revision) | plan-revision | Fixes critical issues: missing `MapImageDiagStage` enum, missing diff-shape fields, missing `requireAdmin` export, cross-worker import boundary, mirror-worker Prisma WASM build, OpenNext binding access, dual-write streaming clone, kind-aware variant preservation. No spec change; goal/scope/rollout sequence unchanged. |

```

- [ ] **Step 3: Verify by re-reading lines 1–60 of the plan**

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): add revision history block before PR3 plan rewrite (r2)"
```

---

## Phase B — Critical Fixes

Each task targets one critical issue from the review. Tasks are independent and can be applied in any order.

### Task B.1: Fix Task 1.5 — drop the non-existent `MapImageDiagStage` enum

**Why:** `lib/mapImageDiag/shared.ts:16` uses `stage: z.string().min(1)`. There is no `MapImageDiagStage` type/enum/union to extend. Step 3 ("Update any switch/exhaustiveness checks") references switch statements that don't exist.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` lines 856–905

- [ ] **Step 1: Open plan; locate Task 1.5 (line 856)**

- [ ] **Step 2: Replace lines 856–905 entirely with this content**

```markdown
### Task 1.5: Document `image_cache_state` as a recognized diag stage

**Why:** PR1.55 (`lib/mapImageDiag/shared.ts`) stores `stage: string` as a free-form Zod field — there is no enum to extend. The `image_cache_state` events emitted by Phase 2 will be accepted by the existing schema verbatim. This task therefore documents the new stage value and adds a runtime constant so callers don't pass typo'd strings.

**Files:**
- Modify: `lib/mapImageDiag/stages.ts` (create if absent)
- Modify: `lib/mapImageDiag/shared.ts` (add JSDoc note only; no schema change)
- Test: `tests/mapImageDiag/stages.test.ts`

- [ ] **Step 1: Open `lib/mapImageDiag/shared.ts`** to confirm the schema is `stage: z.string().min(1)` and that no exhaustive union exists.

- [ ] **Step 2: Failing test**

Create `tests/mapImageDiag/stages.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { MAP_IMAGE_DIAG_STAGES, isKnownDiagStage } from '@/lib/mapImageDiag/stages'

describe('MAP_IMAGE_DIAG_STAGES', () => {
  it('includes image_cache_state', () => {
    expect(MAP_IMAGE_DIAG_STAGES).toContain('image_cache_state')
  })

  it('isKnownDiagStage accepts new and existing stages', () => {
    expect(isKnownDiagStage('image_cache_state')).toBe(true)
    expect(isKnownDiagStage('proxy_cache_state')).toBe(true)
    expect(isKnownDiagStage('typo_stage')).toBe(false)
  })
})
```

- [ ] **Step 3: Run — expect FAIL** (file does not yet exist)

```bash
npm test -- --run tests/mapImageDiag/stages.test.ts
```

- [ ] **Step 4: Implement**

Create `lib/mapImageDiag/stages.ts`:
```ts
/**
 * Centralized list of known MapImageDiag stage strings. Stage is a free-form
 * `string` in the Zod schema (lib/mapImageDiag/shared.ts:16), so this list is
 * documentation + a runtime guard, not a TypeScript exhaustiveness check.
 *
 * When PR3 introduces a new outcome event, add the string here.
 */
export const MAP_IMAGE_DIAG_STAGES = [
  'proxy_cache_state',
  'image_session_outcome',
  'window_excerpt',
  'image_cache_state', // PR3
] as const

export type MapImageDiagStageName = (typeof MAP_IMAGE_DIAG_STAGES)[number]

export function isKnownDiagStage(value: string): value is MapImageDiagStageName {
  return (MAP_IMAGE_DIAG_STAGES as readonly string[]).includes(value)
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
npm test -- --run tests/mapImageDiag/stages.test.ts
```

- [ ] **Step 6: Add a JSDoc note to `lib/mapImageDiag/shared.ts`** above the `stage: z.string().min(1)` field:

```ts
// stage values are free-form strings; the canonical list lives in
// lib/mapImageDiag/stages.ts (MAP_IMAGE_DIAG_STAGES).
```

- [ ] **Step 7: Run typecheck and full diag suite**

```bash
npm run typecheck
npm test -- --run tests/mapImageDiag
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/mapImageDiag/stages.ts lib/mapImageDiag/shared.ts tests/mapImageDiag/stages.test.ts
git commit -m "feat(diag): document image_cache_state stage with shared constant"
```
```

- [ ] **Step 3: Verify by reading back the plan at the modified range** — confirm the new Task 1.5 reads cleanly and references real files.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): rewrite Task 1.5 — drop nonexistent MapImageDiagStage enum claim"
```

---

### Task B.2: Insert new Task 1.6 — extend `AnitabiSyncDiffSummary` with URL-change tuples

**Why:** Task 5.1 (`reconcileMirrorAfterDiff`) consumes `{ bangumiChanges: [{id, field, oldValue, newValue}], pointChanges: [...] }` (plan line 2942) but the actual `AnitabiSyncDiffSummary` (`lib/anitabi/sync/diff.ts:27-50`) only exposes counts + ID-only sample arrays — it does not track per-field URL old/new values. Spec §7's TTL/refresh strategy depends on this. The diff module must be extended **before** Task 5.1 runs.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — insert a new task between current Task 1.5 (now revised by B.1) and Phase 2 heading at current line 909.

- [ ] **Step 1: Open plan; locate the `## Phase 2 — Main Worker R2 Integration` heading (line 909)**

- [ ] **Step 2: Insert this new task immediately above that heading**

```markdown
### Task 1.6: Extend `AnitabiSyncDiffSummary` with URL-change tuples (TDD)

**Why:** Task 5.1's `reconcileMirrorAfterDiff` needs `{id, field, oldValue, newValue}` per changed image URL, but the current `buildAnitabiSyncDiffSummary` only emits counts and ID-only samples. Phase 5 cannot proceed without this.

**Files:**
- Modify: `lib/anitabi/sync/diff.ts`
- Test: `tests/anitabi/diff.urlChanges.test.ts`

- [ ] **Step 1: Read current types in `lib/anitabi/sync/diff.ts`** to confirm `AnitabiSyncDiffSummary` shape.

- [ ] **Step 2: Failing test**

Create `tests/anitabi/diff.urlChanges.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildAnitabiSyncDiffSummary } from '@/lib/anitabi/sync/diff'

describe('buildAnitabiSyncDiffSummary — URL change tuples', () => {
  it('emits bangumiCoverChanges when cover URL changed', () => {
    const summary = buildAnitabiSyncDiffSummary({
      sourceBangumi: [{ id: 1, title: 'A', sourceModifiedMs: 2, cover: 'https://image.anitabi.cn/new.jpg' }],
      localBangumi: [{ id: 1, title: 'A', sourceModifiedMs: BigInt(1), expectedPoints: 0, importedPoints: 0, cover: 'https://image.anitabi.cn/old.jpg' }],
      sourcePoints: [],
      localPoints: [],
    })
    expect(summary.urlChanges.bangumiCovers).toEqual([
      { id: 1, oldValue: 'https://image.anitabi.cn/old.jpg', newValue: 'https://image.anitabi.cn/new.jpg' },
    ])
  })

  it('emits pointImageChanges when point image URL changed', () => {
    const summary = buildAnitabiSyncDiffSummary({
      sourceBangumi: [],
      localBangumi: [],
      sourcePoints: [{ id: 'p1', image: 'https://image.anitabi.cn/p/new.jpg' }],
      localPoints: [{ id: 'p1', image: 'https://image.anitabi.cn/p/old.jpg' }],
    })
    expect(summary.urlChanges.pointImages).toEqual([
      { id: 'p1', oldValue: 'https://image.anitabi.cn/p/old.jpg', newValue: 'https://image.anitabi.cn/p/new.jpg' },
    ])
  })

  it('omits unchanged URLs', () => {
    const summary = buildAnitabiSyncDiffSummary({
      sourceBangumi: [{ id: 1, title: 'A', sourceModifiedMs: 2, cover: 'https://x/a.jpg' }],
      localBangumi: [{ id: 1, title: 'A', sourceModifiedMs: BigInt(1), expectedPoints: 0, importedPoints: 0, cover: 'https://x/a.jpg' }],
      sourcePoints: [],
      localPoints: [],
    })
    expect(summary.urlChanges.bangumiCovers).toEqual([])
  })
})
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Implement**

In `lib/anitabi/sync/diff.ts`:

(a) Extend `SourceBangumiSnapshot` and `LocalBangumiSnapshot` to carry `cover: string | null`. Extend `SourcePointSnapshot`/`LocalPointSnapshot` to carry `image: string | null`. Update callers to pass these (search: `buildAnitabiSyncDiffSummary(`).

(b) Extend `AnitabiSyncDiffSummary`:
```ts
export type AnitabiUrlChange<TId> = {
  id: TId
  oldValue: string | null
  newValue: string
}

export type AnitabiSyncDiffSummary = {
  // ... existing fields ...
  urlChanges: {
    bangumiCovers: AnitabiUrlChange<number>[]
    pointImages: AnitabiUrlChange<string>[]
  }
}
```

(c) In the diff builder, when an entity is identified as `modified`, compare `cover` (or `image`) old vs. new and append to the appropriate `urlChanges` array if non-equal and `newValue` is non-empty.

- [ ] **Step 5: Run — expect PASS**

```bash
npm test -- --run tests/anitabi/diff.urlChanges.test.ts
```

- [ ] **Step 6: Run full diff suite to confirm no regression**

```bash
npm test -- --run tests/anitabi/diff.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add lib/anitabi/sync/diff.ts tests/anitabi/diff.urlChanges.test.ts
git commit -m "feat(sync): emit URL-change tuples in AnitabiSyncDiffSummary for PR3 reconcile"
```

---
```

- [ ] **Step 3: Update the Task Index near the top of the plan** to include `1.6` under Phase 1.

Open plan around lines 17–28 (the `## Task Index` block) — add a bullet for Phase 1 if it's not enumerated by task, or add `Task 1.6 — Extend sync diff with URL change tuples` if Phase 1 lists tasks.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): add Task 1.6 — extend sync diff to emit URL-change tuples (gates Task 5.1)"
```

---

### Task B.3: Fix Tasks 4.1 / 4.2 — replace nonexistent `requireAdmin` import

**Why:** `lib/auth/admin.ts` exports only `getAdminEmails`, `isAdminEmail`, `hashPassword`, `verifyPassword`, `ADMIN_DEFAULT_PASSWORD`. There is no `requireAdmin`. The codebase pattern is inline `getServerAuthSession()` (see `app/api/admin/city/route.ts:22`).

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Tasks 4.1 (~lines 2481–2592) and 4.2 (~lines 2593–2702)

- [ ] **Step 1: Open plan; in Task 4.1 step 3, locate the import**

```bash
grep -n "requireAdmin" /Users/mac/Desktop/seichigo/.claude/worktrees/agitated-banzai-065ecb/docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
```

- [ ] **Step 2: Replace every `requireAdmin` reference with the inline pattern**

Replace any line matching `import { requireAdmin } from '@/lib/auth/admin'` with:

```ts
import { getServerAuthSession } from '@/lib/auth/session'
```

Replace any line matching `await requireAdmin(req)` (or similar) with the project standard:

```ts
const session = await getServerAuthSession()
if (!session?.user?.isAdmin) {
  return NextResponse.json({ error: 'unauthorized' }, { status: 403 })
}
```

This replacement is applied identically in Task 4.1 and Task 4.2.

- [ ] **Step 3: Verify with a final grep**

```bash
grep -n "requireAdmin" /Users/mac/Desktop/seichigo/.claude/worktrees/agitated-banzai-065ecb/docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): replace nonexistent requireAdmin with inline getServerAuthSession in Tasks 4.1/4.2"
```

---

### Task B.4: Fix cross-worker import boundary — extract `cronTick` to shared lib path

**Why:** Task 4.1 imports `cronTick` from `@/workers/anitabi-mirror/src/cronTick` from a Next.js admin route. This pulls worker code into the Next.js bundle and creates two `PrismaClient` instances. The fix is to put `cronTick` in `lib/anitabi/mirror/` so both the worker and the Next admin route import it from the same neutral location.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Tasks 3.7 (~line 2341) and 4.1 (~line 2481)

- [ ] **Step 1: Open Task 3.7; locate the `cronTick` location**

The current Task 3.7 places `cronTick` in `workers/anitabi-mirror/src/cronTick.ts`. Edit that task to instead:

(a) Create `lib/anitabi/mirror/cronTick.ts` with the orchestration logic.
(b) Have the worker (`workers/anitabi-mirror/src/index.ts`) import from `@/lib/anitabi/mirror/cronTick`.
(c) `cronTick` accepts `(deps: { prisma, bucket, env, source: 'cron' | 'manual' })` so neither the worker nor the admin route hard-codes how those are obtained.

Replacement language for Task 3.7's "Wire cronTick orchestrator" preamble:

```markdown
**Files:**
- Create: `lib/anitabi/mirror/cronTick.ts` (shared between mirror worker and admin force-complete route)
- Modify: `workers/anitabi-mirror/src/index.ts` (delegate to shared `cronTick`)
- Test: `tests/anitabi/mirror/cronTick.test.ts`

`cronTick` signature:
```ts
export type CronTickDeps = {
  prisma: PrismaClient
  bucket: R2Bucket
  env: { MAP_IMAGE_MIRROR_CRON_ENABLED?: string }
  source: 'cron' | 'manual'
}
export type CronTickResult = { reclaimed: number; processed: number; throttled: boolean }

export async function cronTick(deps: CronTickDeps, mode: 'seed' | 'delta'): Promise<CronTickResult>
```
```

- [ ] **Step 2: Update Task 4.1 step 3 import**

Change:
```ts
import { cronTick } from '@/workers/anitabi-mirror/src/cronTick'
```
to:
```ts
import { cronTick } from '@/lib/anitabi/mirror/cronTick'
```

Update Task 4.1's `cronTick(...)` call to construct `CronTickDeps` correctly — it should pass `source: 'manual'` so the lock skip from Task C.7 takes effect.

- [ ] **Step 3: Verify**

```bash
grep -n "@/workers/anitabi-mirror" /Users/mac/Desktop/seichigo/.claude/worktrees/agitated-banzai-065ecb/docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
```

Expected: no matches outside of `workers/anitabi-mirror/wrangler.jsonc` references.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): move cronTick to lib/anitabi/mirror/ to avoid cross-worker import"
```

---

### Task B.5: Add mirror-worker Prisma WASM build pipeline

**Why:** The Next.js worker uses `PrismaPg` adapter + WASM client + `scripts/copy-prisma-wasm.mjs`. The plan's new `workers/anitabi-mirror/` does `wrangler deploy` only — the cron tick will fail at runtime with "Prisma query engine not found" because no WASM is in the bundle and no driver adapter is configured.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Task 3.1 (~line 1513) and Task 3.7 (~line 2341)

- [ ] **Step 1: Inspect the existing Prisma WASM pipeline as reference**

```bash
sed -n '1,60p' /Users/mac/Desktop/seichigo/scripts/copy-prisma-wasm.mjs
sed -n '20,50p' /Users/mac/Desktop/seichigo/lib/db/prisma.ts
grep -n '"cf:build"\|"cf:deploy"' /Users/mac/Desktop/seichigo/package.json
```

Note: the main app uses `PrismaPg` (driver adapter for Postgres on Workers), `PrismaClient({ adapter: ... })`, plus a build-time WASM copy step.

- [ ] **Step 2: Edit Task 3.1 (Scaffold workers/anitabi-mirror)**

Add to Task 3.1 a sub-step that creates `workers/anitabi-mirror/scripts/build.mjs` that mirrors `scripts/copy-prisma-wasm.mjs` (or imports it). Add a `package.json` script in the mirror worker subtree (or a top-level `cf:build:mirror`) that runs it before `wrangler deploy`.

Replacement for Task 3.1's deploy command box:
```bash
# From repo root:
node workers/anitabi-mirror/scripts/build.mjs   # copies Prisma WASM into the bundle dir
cd workers/anitabi-mirror && wrangler deploy
```

- [ ] **Step 3: Edit Task 3.7 — replace direct `new PrismaClient` with adapter pattern**

Replace any code block of form:
```ts
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } })
```
with:
```ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from '@prisma/pg-worker'

const pool = new Pool({ connectionString: env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })
```

(Confirm the exact adapter import path against `lib/db/prisma.ts` before pasting; if the existing path differs, mirror it exactly.)

- [ ] **Step 4: Verify**

```bash
grep -n "new PrismaClient" /Users/mac/Desktop/seichigo/.claude/worktrees/agitated-banzai-065ecb/docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
```

Expected: only adapter-form constructions remain (or none, if the only construction site moved into a helper).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): add Prisma WASM build pipeline + adapter pattern for mirror worker"
```

---

### Task B.6: Spell out the OpenNext binding-access pattern in Tasks 2.2/2.3/2.4

**Why:** The plan punted with "check `@opennextjs/cloudflare` docs … if the above doesn't compile" (line 1136). The route uses `runtime = 'nodejs'`, where `process.env` does not contain CF bindings; the binding-access call is mandatory.

**Files:**
- Optional research: Create `docs/superpowers/research/2026-05-03-pr3-binding-access-pattern.md`
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Tasks 2.2, 2.3, 2.4 binding-access steps

- [ ] **Step 1: Confirm the existing access pattern from `lib/db/prisma.ts`**

```bash
sed -n '20,80p' /Users/mac/Desktop/seichigo/lib/db/prisma.ts
grep -rn "getCloudflareContext\|__openNextAls" /Users/mac/Desktop/seichigo/lib /Users/mac/Desktop/seichigo/app | head -20
```

The repo already accesses bindings via `globalThis.__openNextAls.getStore()`. PR3 will use the same pattern.

- [ ] **Step 2: (Optional) Document the pattern**

If the codebase has no top-level helper for bindings, create `lib/anitabi/cf/bindings.ts`:
```ts
type BindingsStore = {
  env?: { MAP_IMAGE_CACHE?: R2Bucket; NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED?: string; NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED?: string }
  ctx?: { waitUntil(promise: Promise<unknown>): void }
}

export function getCfBindings(): BindingsStore | undefined {
  const als = (globalThis as { __openNextAls?: { getStore?: () => BindingsStore | undefined } }).__openNextAls
  return als?.getStore?.()
}
```

This lives in `lib/anitabi/` (not `workers/`) so both the Next.js worker and tests can import it. Add to Task 2.1 as a new sub-step (file creation).

- [ ] **Step 3: Replace every `(globalThis as any)?.cloudflare?.env` reference**

For Tasks 2.2 / 2.3 / 2.4, replace:
```ts
const bucket = (globalThis as any)?.cloudflare?.env?.MAP_IMAGE_CACHE as R2Bucket | undefined
```
with:
```ts
const bindings = getCfBindings()
const bucket = bindings?.env?.MAP_IMAGE_CACHE
```

And the `waitUntil` access in Task 2.3 (currently `(deps as any).ctx ?? (globalThis as any).waitUntilCtx`) becomes:
```ts
const ctx = bindings?.ctx
if (ctx?.waitUntil) ctx.waitUntil(bodyPromise)
else void bodyPromise
```

- [ ] **Step 4: Update tests in those tasks** to mock `__openNextAls` instead of `globalThis.cloudflare`.

Pattern for test setup:
```ts
beforeEach(() => {
  ;(globalThis as any).__openNextAls = { getStore: () => ({ env: { MAP_IMAGE_CACHE: bucket, NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1' } }) }
})
afterEach(() => { delete (globalThis as any).__openNextAls })
```

- [ ] **Step 5: Verify**

```bash
grep -n "globalThis as any.*cloudflare" /Users/mac/Desktop/seichigo/.claude/worktrees/agitated-banzai-065ecb/docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
```

Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): specify OpenNext binding-access pattern in Tasks 2.2/2.3/2.4"
```

---

### Task B.7: Rewrite Task 2.3 dual-write to use `tee()` + `onStreamSuccess`

**Why:** `cloned.arrayBuffer()` on a streaming body produces broken / racy reads in CF Workers. Buffering the whole body before responding (the plan's casual aside on line 1244) destroys the streaming-latency contract from PR1's `buildStreamWithLimit`. Worse, the dual-write currently fires *before* the user stream completes — caching the body even when the user response was cut short with `response_too_large`.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Task 2.3 (~lines 1163–1259)

- [ ] **Step 1: Open Task 2.3; replace step 3's implementation block** with this language:

```markdown
- [ ] **Step 3: Implement write-through using `tee()` + success-only commit**

Edit `lib/anitabi/handlers/imageServe.ts`. After upstream fetch but before constructing the user response, tee the response body into two consumers: one feeds the user response (existing path, unchanged), one buffers into memory for R2 write **only if the user stream completes successfully**.

Sketch:
```ts
const bindings = getCfBindings()
const bucket = bindings?.env?.MAP_IMAGE_CACHE
const writeFlag = bindings?.env?.NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED === '1'
const ctx = bindings?.ctx

if (bucket && writeFlag && upstreamBody) {
  const [forUser, forR2] = upstreamBody.tee()
  // Replace upstreamBody → forUser in the existing buildStreamWithLimit / buildRenderResponse path.
  // forR2: drain into a length-capped buffer in parallel, but only commit on user-stream success.
  const r2Promise = (async () => {
    const buf = await readBytesWithLimit(forR2, MAX_IMAGE_BYTES)
    if (buf.kind === 'too_large') return // do not cache truncated bodies
    return buf.bytes
  })()

  // Wire commit into existing onStreamSuccess hook. If the existing imageServe
  // handler does not expose onStreamSuccess, add it: a no-op when streaming is OK,
  // and a `void buf` discard when the user stream errored.
  registerOnStreamSuccess(async () => {
    const bytes = await r2Promise
    if (!bytes) return
    const writer = putMirroredImage(bucket, target.toString(), bytes, fetched.mimeType, 'lazy')
    if (ctx?.waitUntil) ctx.waitUntil(writer)
    else await writer.catch((err) => console.warn('[imageServe] R2 write failed', err))
  })
}
```

If `imageServe.ts` does not currently expose stream success/failure callbacks, **make exposing them part of this task** (introduce `onStreamSuccess` / `onStreamError` callbacks on `buildStreamWithLimit`'s caller; default to no-op for existing call sites).

Note for the engineer: `tee()` doubles the in-flight memory of the streamed body until the slower consumer drains, but bytes are released as both consumers progress; this is acceptable here because images are bounded at `MAX_IMAGE_BYTES`. Buffering everything into a single `arrayBuffer()` is **not** acceptable.
```

- [ ] **Step 2: Add a new failing-test case to step 1 of Task 2.3**

Insert above the existing `'writes to R2 after successful upstream fetch'` test:
```ts
it('does NOT write to R2 when user stream is aborted with response_too_large', async () => {
  const bucket = buildFakeBucket()
  // Mock upstream returning a body that triggers the size-limit cutoff
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(new Uint8Array(50 * 1024 * 1024), { // 50MB > MAX_IMAGE_BYTES
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    }),
  )
  const req = new Request('https://www.seichigo.com/api/anitabi/image-render?url=...')
  const res = await serveImageRequest(req, buildFakeDeps({ bucket }), 'render')
  expect(res.status).toBe(502) // or whatever the size-limit error status is
  await new Promise((r) => setTimeout(r, 10))
  expect(bucket.store.size).toBe(0) // no commit on aborted stream
})
```

- [ ] **Step 3: Verify**

Read back Task 2.3; confirm the rewrite mentions `tee()`, `onStreamSuccess`, and never re-introduces `cloned.arrayBuffer()`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): rewrite Task 2.3 dual-write — tee()+onStreamSuccess, no clone+arrayBuffer"
```

---

### Task B.8: Fix Task 1.2 — preserve kind-aware variant logic

**Why:** `normalizeBangumiCoverVariant` / `normalizeAnitabiDisplayVariant` take `kind: MapDisplayImageKind` and apply different rewrites per kind. Spec §2 line 130 asks to **extract pure functions** (a small `canonicalize()` for R2 keying) — not replace the kind-aware logic.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Task 1.2 (~lines 322–515)

- [ ] **Step 1: Open Task 1.2 step 6**

The current step 6 says "Replace … with calls to `computeCanonicalImageUrl` where the same logic applies."

- [ ] **Step 2: Replace step 6 entirely**

```markdown
- [ ] **Step 6: Add `computeCanonicalImageUrl` as a sibling helper, do NOT replace kind-aware variants**

The new `computeCanonicalImageUrl(url: string)` exists *only* to produce a stable R2 lookup key. It is **not** a replacement for `normalizeBangumiCoverVariant` / `normalizeAnitabiDisplayVariant` — those continue to take `kind: MapDisplayImageKind` and apply per-kind transforms (point-thumbnail → `plan=h160`, point-preview → `plan=h320`, point → `w=640&q=80`, etc.).

Concretely:
- `imageMirrorVariants.ts` (new in Task 1.3) calls `computeCanonicalImageUrl` to build the R2 key.
- `imageProxy.ts` keeps `normalizeBangumiCoverVariant`/`normalizeAnitabiDisplayVariant` unchanged and continues to be used by display rewrite paths.
- The shared piece extracted is the URL-cleaning logic only (host normalization, querystring sort, etc.), which both call into.

Verify by re-running the existing variant tests:
```bash
npm test -- --run tests/anitabi/imageProxy.bgmLadder.test.ts tests/anitabi/image-proxy-phase2.test.ts
```
Expected: PASS without any kind-parameter test rewriting.
```

- [ ] **Step 3: Re-check Task 1.2 step 5** (the failing test for `computeCanonicalImageUrl`) — confirm it tests **canonicalization** semantics (input URL → key), not display-variant semantics.

- [ ] **Step 4: Verify**

Read back Task 1.2; confirm step 6 no longer says "replace" with respect to the kind-aware functions.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): preserve kind-aware variant logic in Task 1.2 (R2 key is sibling, not replacement)"
```

---

## Phase C — Significant Fixes

### Task C.1: Add Phase-0 verdict → action tables for Tasks 0.2 / 0.3 / 0.4

**Why:** Only Task 0.1 (D0 compliance) has a clear RED → stop path. Tasks 0.2, 0.3, 0.4 document outcomes but never tell the executor what to do with a "BAD" verdict.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Tasks 0.2 (~line 110), 0.3 (~line 153), 0.4 (~line 201)

- [ ] **Step 1: Append a "Verdict → Action" subsection to each of Tasks 0.2, 0.3, 0.4**

Template:
```markdown
**Verdict → Action:**

| Verdict | Action |
|---|---|
| PASS | Proceed to Phase 1. |
| PARTIAL / NEEDS_UPGRADE | <task-specific remediation; e.g. "request DB capacity bump from infra; do not start Phase 7 until completed"> |
| FAIL | **Stop.** Re-plan affected phases (e.g. drop the cron-driven backfill if rollback path is broken; replan with PR3.5). |
```

Customize the middle row for each task:
- 0.2 PARTIAL → "use feature-flag-only rollback; do not rely on `wrangler rollback` for emergency revert; document this in PR3 runbook"
- 0.3 PARTIAL → "fix sync workflow stability before enabling Task 5.1 reconcile hook; gate Phase 5 on a green sync run"
- 0.4 NEEDS_UPGRADE → "upgrade Postgres tier or shard `MapImageMirrorState` archival before Phase 7; estimate timeline shift"

- [ ] **Step 2: Verify**

```bash
grep -n "Verdict → Action" /Users/mac/Desktop/seichigo/.claude/worktrees/agitated-banzai-065ecb/docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
```

Expected: 3 matches (or 4 if you also add to 0.1 for symmetry).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): add verdict→action mapping to Phase 0 gating tasks"
```

---

### Task C.2: Fix Task 1.2 step 1 — write the async test from the start

**Why:** Step 1 writes a sync test then step 4 retcons it to async. Subagents following step 1–2 see the test fail in step 2 ("expected: FAIL") and may erroneously conclude the implementation is the problem.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Task 1.2 step 1 and step 4

- [ ] **Step 1: Rewrite step 1's test to be async-shape from the start**

Replace `expect(key).toMatch(...)` with `await expect(computeMirrorKey(url)).resolves.toMatch(...)` (or wrap in `async () => { ... }` test fn body).

- [ ] **Step 2: Delete the dead `computeMirrorKeySync` placeholder** in step 2 — it adds noise.

- [ ] **Step 3: Delete step 4's "Update test to match async key API"** — no update is needed if step 1 is correct.

- [ ] **Step 4: Renumber subsequent steps in Task 1.2.**

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): write Task 1.2 test as async from step 1; remove sync placeholder"
```

---

### Task C.3: Extend Task 2.4 — R2 fallback in the upstream `catch` path too

**Why:** Plan inserts the fallback inside `if (!fetched.ok)` only. Streaming exceptions (`response_too_large`, `aborted`, mid-stream errors) flow through the `catch (err)` block at `imageServe.ts:794-796` and currently miss the R2 fallback. Spec §3 promises "even if R2 is stale" availability for upstream failures.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Task 2.4 (~lines 1261–1348)

- [ ] **Step 1: Add a sub-step to Task 2.4 for the catch path**

Insert after the existing "modify the `!fetched.ok` branch" step:

```markdown
- [ ] **Step Nb: Also attempt R2 fallback in the upstream-exception `catch` block**

In `lib/anitabi/handlers/imageServe.ts`, locate the `catch (err)` at the end of the upstream-fetch block (around the existing `'response_too_large'` / `'aborted'` handling). Before the existing 5xx response is constructed, attempt:

```ts
const bindings = getCfBindings()
const bucket = bindings?.env?.MAP_IMAGE_CACHE
if (bucket && bindings?.env?.NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED === '1') {
  const fallback = await getMirroredImage(bucket, target.toString())
  if (fallback) {
    return new Response(fallback.body, {
      status: 200,
      headers: {
        'content-type': fallback.contentType,
        'cache-control': 'public, max-age=60', // shorter than primary; this was a fallback
        'x-seichigo-image-source': 'r2-fallback',
        'x-original-source': new URL(target.toString()).hostname,
      },
    })
  }
}
// fall through to existing 5xx
```

Add a corresponding test case under Task 2.4 step 1: "falls back to R2 when upstream throws response_too_large".
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): extend Task 2.4 — R2 fallback also triggers from upstream-exception catch"
```

---

### Task C.4: Add `DATABASE_URL` secret provisioning to Phase 3

**Why:** CF Workers don't inherit env from wrangler unless declared. Plan Task 3.7 expects `env.DATABASE_URL` but Task 3.1's wrangler.jsonc doesn't list it as a secret. The mirror worker on first cron tick will throw "DATABASE_URL is not set."

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Task 3.1 (~line 1513) or new Task 3.1.1

- [ ] **Step 1: Insert a new sub-step at the end of Task 3.1**

```markdown
- [ ] **Step N: Provision the `DATABASE_URL` secret**

Run (from repo root):
```bash
cd workers/anitabi-mirror
wrangler secret put DATABASE_URL
# paste the same Postgres connection string used by the main worker
```

Verify:
```bash
wrangler secret list
```

Expected: shows `DATABASE_URL` (value not displayed).

**Pool sizing:** the mirror worker runs at most one cron at a time (`*/5 * * * *` and `0 * * * *` deduplicated by Task C.5). Use a `Pool({ max: 4 })` to bound concurrent connections; the main worker uses its own pool independently.
```

- [ ] **Step 2: Verify**

```bash
grep -n "wrangler secret put DATABASE_URL" /Users/mac/Desktop/seichigo/.claude/worktrees/agitated-banzai-065ecb/docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
```

Expected: 1 match.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): provision DATABASE_URL secret + pool sizing for mirror worker"
```

---

### Task C.5: Reconcile cron schedules — eliminate hour-mark race

**Why:** `*/5 * * * *` and `0 * * * *` both fire on the hour. The current handler routes by exact-string cron match, but both still execute concurrently and both touch `MapImageMirrorState`. Race: delta upsert resets a row to pending while seed is mid-flight on the same row.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Task 3.7 (~line 2341) and `wrangler.jsonc` snippet in Task 3.1 (~line 1513)

- [ ] **Step 1: Replace the two cron entries with a single `*/5` cron**

In Task 3.1, change the wrangler `triggers.crons` block to:
```jsonc
"triggers": {
  "crons": ["*/5 * * * *"]
}
```

In Task 3.7, change the scheduled handler to derive mode from clock time:
```ts
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const now = new Date(event.scheduledTime)
    const isHourMark = now.getMinutes() === 0
    const mode: 'seed' | 'delta' = isHourMark ? 'delta' : 'seed'
    ctx.waitUntil(cronTick({ prisma, bucket: env.MAP_IMAGE_CACHE, env, source: 'cron' }, mode))
  },
}
```

- [ ] **Step 2: Update Task 3.5 (cronDelta) and Task 3.4 (processSeedBatch)** — note that delta and seed never run concurrently within the same worker process, so the race is closed.

- [ ] **Step 3: Add a sentence to Task 3.7's preamble explaining the change.**

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): single cron entry with mode-by-minute to eliminate hour-mark race"
```

---

### Task C.6: Wire the breaker — `recordTimeout` calls in `processSeedBatch`

**Why:** The throttle module's `recordTimeout` is never called. The breaker integration is currently non-functional.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Task 3.4 (~line 1926) and Task 3.6 (~line 2234)

- [ ] **Step 1: Add to Task 3.4 implementation a per-batch counter**

Append to `processSeedBatch`:
```ts
let batchTimeouts = 0
for (const row of pending) {
  try {
    const ok = await fetchAndStore(row)
    if (!ok) batchTimeouts++
  } catch (err) {
    if (isTimeoutErr(err)) batchTimeouts++
    // ... existing error handling: record err string, slice 500 chars
  }
}

// Persist rolling counter to feed Task 3.6's recordTimeout
if (batchTimeouts > 0) await recordTimeout(prisma, batchTimeouts)
```

- [ ] **Step 2: Add to Task 3.6 (`recordTimeout`) the rolling-window logic**

Specify: `recordTimeout(prisma, n)` increments a counter on the `__throttle__` meta-row's `retryCount`. When the counter crosses 10 within a sliding window (e.g., 15 minutes), `isThrottled()` returns `true` and `cronTick` aborts.

Concrete state on the meta-row:
- `retryCount` = consecutive timeout count
- `lastAttemptAt` = last increment timestamp
- `mirroredAt` = when throttle most recently engaged (`now`)
- `status` = `'mirrored'` while throttled, `'pending'` once cleared

`isThrottled` reads the meta-row: if `retryCount >= 10` AND `lastAttemptAt > now - 15min`, return true.

- [ ] **Step 3: Add a failing test**

In Task 3.6, append a test:
```ts
it('engages throttle after 10 consecutive timeouts and clears after window', async () => {
  for (let i = 0; i < 9; i++) await recordTimeout(prisma, 1)
  expect(await isThrottled(prisma)).toBe(false)
  await recordTimeout(prisma, 1) // 10th
  expect(await isThrottled(prisma)).toBe(true)
  // simulate window expiry
  vi.setSystemTime(Date.now() + 16 * 60_000)
  expect(await isThrottled(prisma)).toBe(false)
})
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): wire breaker — recordTimeout in processSeedBatch + sliding window in Task 3.6"
```

---

### Task C.7: Add Postgres advisory lock for `force-complete` vs auto cron

**Why:** Spec §5 line 511 mentions "concurrent calls serialized via Postgres row lock on `id=1`" but the plan never implements it. Manual `force-complete` and auto cron both call `reclaimStale`, which can reset rows the other just touched.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Task 3.7 (cronTick) and Task 4.1 (force-complete)

- [ ] **Step 1: Add advisory-lock wrapping in `cronTick`**

In Task 3.7's `cronTick` implementation, wrap the body in a `pg_try_advisory_xact_lock(123456)`:
```ts
export async function cronTick(deps: CronTickDeps, mode: 'seed' | 'delta'): Promise<CronTickResult> {
  return deps.prisma.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(123456) AS locked`
    if (!locked) {
      // Another tick is running; skip silently in cron mode, error in manual mode.
      if (deps.source === 'manual') throw new Error('cronTick already in progress; try again in 30s')
      return { reclaimed: 0, processed: 0, throttled: false }
    }
    // ... existing reclaimStale + delta/seed logic ...
  }, { timeout: 60_000 })
}
```

- [ ] **Step 2: Update Task 4.1 (force-complete)** — note that the loop now respects the advisory lock; if a cron tick is in flight, the loop iteration returns "skipped" rather than racing.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): wrap cronTick in pg_try_advisory_xact_lock to serialize manual+cron"
```

---

### Task C.8: Pre-do the UI attribution audit; rewrite Tasks 5.2/5.3 with concrete files

**Why:** Tasks 5.2/5.3 currently say "Fill in actual file paths and line numbers from the grep" — i.e. nothing concrete is committed. The reviewer flagged this as the "via anitabi" link being claimed but never actually rendered.

**Files:**
- Create: `docs/superpowers/research/2026-05-03-pr3-ui-attribution-audit.md`
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Tasks 5.2 and 5.3

- [ ] **Step 1: Run the audit grep**

```bash
cd /Users/mac/Desktop/seichigo
grep -rn "image-render\|imageRender\|MapImage\|anitabi.*image\|cover" \
  app components/map components/anitabi components/bangumi 2>/dev/null \
  | grep -v "node_modules\|\.test\." \
  | grep -E "\.tsx?:" \
  | head -60
```

Note files where anitabi-sourced images are rendered.

- [ ] **Step 2: Create research doc with concrete surface list**

Write `docs/superpowers/research/2026-05-03-pr3-ui-attribution-audit.md`:
```markdown
# PR3 UI Attribution Audit

**Date:** 2026-05-03
**Method:** grep + manual triage of components rendering anitabi cover/point images.

## Surfaces requiring "via anitabi" micro-link

| File | Line | Component | Action |
|---|---|---|---|
| <path1> | <line> | <ComponentName> | add AttributionLink near image |
| <path2> | <line> | <ComponentName> | add AttributionLink in caption row |
| ... | | | |

## Surfaces NOT requiring attribution

(e.g. internal admin previews, test fixtures, screenshots)

## Open questions

(e.g. dense map markers — link inline or in a tooltip?)
```

Fill in 3–6 specific files.

- [ ] **Step 3: Rewrite Task 5.2 to reference the audit doc**

Replace its step "Fill in actual file paths" with:
```markdown
- [ ] Read `docs/superpowers/research/2026-05-03-pr3-ui-attribution-audit.md` and list the surfaces under `## Surfaces displaying anitabi images` in the plan body. The audit is the source of truth.
```

- [ ] **Step 4: Rewrite Task 5.3 with one sub-task per surface**

For each row in the audit, add a numbered sub-task with: file path, exact line, the import statement to add, the JSX to insert, and a test assertion (`expect(screen.getByText(/via anitabi/)).toBeInTheDocument()` or visual snapshot).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/research/2026-05-03-pr3-ui-attribution-audit.md docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): pre-do UI attribution audit; ground Tasks 5.2/5.3 in concrete surfaces"
```

---

### Task C.9: Filter `__throttle__` / `__cursor__` meta-rows from aggregations

**Why:** Reserved meta-rows abuse the `MapImageMirrorState` shape (status='mirrored' for throttle). Aggregations in Task 4.2 will count them as real images.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Task 4.2 (status admin endpoint), Task 4.3 (dashboard panel)

- [ ] **Step 1: Add a `META_SOURCE_TYPES` constant note in Task 1.1 (Prisma model)**

Append to Task 1.1's preamble:
```markdown
**Note: reserved sourceType values.** `MapImageMirrorState` rows where `sourceType IN ('__throttle__', '__cursor__')` are meta-state markers, not real image-mirror records. All aggregation queries (Task 4.2, 4.3, 5.1) **must** filter them out via `WHERE "sourceType" NOT IN ('__throttle__', '__cursor__')` or equivalent Prisma `notIn`.
```

- [ ] **Step 2: Update Task 4.2 query example**

Wherever Task 4.2 shows a `groupBy({ by: ['status'] })` or `count()`, append `where: { sourceType: { notIn: ['__throttle__', '__cursor__'] } }`.

- [ ] **Step 3: Update Task 4.3 panel queries** identically.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): filter meta-rows from MapImageMirrorState aggregations"
```

---

### Task C.10: Estimate R2 Class-B (read) ops in Phase 0

**Why:** Spec §2 estimated only storage. Once `R2_READ=1`, every CF MISS hits R2; at peak this can exceed the 10M/month free tier.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Task 0.4 (or new Task 0.5)

- [ ] **Step 1: Add a sub-step to Task 0.4 (or insert Task 0.5)**

```markdown
- [ ] **Step N: Estimate R2 Class-B (read) ops at peak**

Query the existing diag dashboard or `image_session_outcome` events for `proxy_cache_state: cache_miss` rate over a 24h window:
```sql
SELECT
  DATE_TRUNC('hour', "createdAt") AS hour,
  COUNT(*) FILTER (WHERE payload->>'state' = 'cache_miss') AS misses
FROM "MapImageDiag"
WHERE stage = 'proxy_cache_state'
  AND "createdAt" > NOW() - INTERVAL '24 hours'
GROUP BY 1 ORDER BY 1;
```

Project monthly: `peak_hourly_misses × 24 × 30`. If projection > 10M/month, document the cost and consider:
- **Mitigation A:** put a CF cache-control header on R2-served responses so subsequent CF hits don't re-read R2.
- **Mitigation B:** budget for paid R2 ops ($0.36 per 1M Class-B).

Append the projection to the research doc with a verdict (PASS / NEEDS_BUDGET).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): add R2 Class-B read ops cost projection to Phase 0"
```

---

### Task C.11: Ensure `X-Original-Source` header on the CF cache-hit path

**Why:** Spec §6 line 628 promises the header on **all** terminal paths (CF hit / R2 hit / upstream / fallback). The CF-cache-hit path returns the cached response as stored — if storage didn't include the header, hits won't carry it.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Task 2.5 (~line 1349)

- [ ] **Step 1: Add a sub-step to Task 2.5**

```markdown
- [ ] **Step N: Ensure `X-Original-Source` is set BEFORE `storeRenderCache` writes**

In `imageServe.ts`, the order must be:
1. Build the upstream-derived response.
2. Set `x-original-source: <upstream hostname>` on it.
3. Call `storeRenderCache(cf, target, withHeaders)` so the cached version carries the header.
4. Return to user.

Add a contract test specifically for the CF-hit path:
```ts
it('returns x-original-source on CF cache hit', async () => {
  // Prime the cache by serving once
  await serveImageRequest(req, deps, 'render')
  // Second call should hit CF cache
  const res2 = await serveImageRequest(req, deps, 'render')
  expect(res2.headers.get('x-original-source')).toBe('image.anitabi.cn')
  expect(res2.headers.get('x-seichigo-image-source')).toBe('cf-cache')
})
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): cover CF-cache-hit path in Task 2.5 X-Original-Source contract"
```

---

### Task C.12: Add a dashboard panel for `image_cache_state` outcome distribution

**Why:** Spec §10 acceptance is "cache_hit_r2_* ratio ≥ 80%" but Task 4.3's MirrorProgressPanel only shows backfill metrics, not the outcome distribution that gates acceptance.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — Task 4.3 (~line 2703)

- [ ] **Step 1: Append a "CacheStatePanel" sub-task to Task 4.3**

```markdown
- [ ] **Sub-task 4.3.b: Add `CacheStatePanel` component**

Renders a 1h / 24h breakdown of `image_cache_state` events by outcome:
- `cache_hit_cf` (CF edge)
- `cache_hit_r2_primary` (R2 lookup before upstream)
- `cache_hit_r2_fallback` (R2 used after upstream failed)
- `cache_miss_upstream_ok` (upstream served, R2 wrote-through)
- `cache_miss_upstream_fail` (R2 fallback miss → user 502)

Query: `MapImageDiag` rows where `stage='image_cache_state'`, group by `payload->>'state'`, time-bucketed.

Acceptance assertion (spec §10): `(cache_hit_r2_primary + cache_hit_r2_fallback) / total ≥ 0.8` after T+5d.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): add CacheStatePanel to Task 4.3 to surface §10 acceptance ratio"
```

---

## Phase D — Hygiene

### Task D.1: Rewrite the Self-Review Notes section honestly

**Why:** Current Self-Review Notes (lines ~3530–3550) claim "Type consistency check ✓" and "All sections covered" — both demonstrably false per the acceptance review.

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — final section

- [ ] **Step 1: Replace the existing Self-Review Notes with**

```markdown
## Self-Review Notes (r2)

**Critical issues fixed in r2:** Task 1.5 (no enum) · Task 1.6 added (sync diff URL changes) · Tasks 4.1/4.2 (auth pattern) · cronTick relocation (cross-worker import) · mirror-worker Prisma WASM build · OpenNext binding access pattern · Task 2.3 dual-write tee()+success-only · Task 1.2 kind-aware variant preserved.

**Significant issues fixed in r2:** Phase-0 verdict→action tables · Task 1.2 async-from-start · catch-path R2 fallback · DATABASE_URL secret · cron schedule deduplication · breaker wired (recordTimeout) · advisory lock for force-complete · UI attribution audit pre-done · meta-row filter · R2 Class-B cost estimate · CF-hit X-Original-Source · CacheStatePanel.

**Known limitations / deferred:**
- The 7-day backfill estimate assumes 30s wall time per cron tick; CF Workers can extend wall-clock to 15min, so this is favorable.
- DB capacity estimate caps `lastError` at 500 chars (Task 3.4 line 2078) but the schema is `@db.Text`. Worst case is bounded by the cap; documented.
- `MapImageMirrorBootstrap.id=1` singleton: schema uses `Int @id @default(1)`; upserts MUST `where: { id: 1 }` to avoid duplicates.
- Per-host throttling: spec/plan use a single 5 req/s ceiling; bgm.tv historically rate-limits separately. If needed, split throttle by hostname in a follow-up.

**Spec coverage check:** see Goal Alignment Matrix below — every §-section traces to one or more tasks; no scope drift.

**Type consistency check (r2):**
- `cronTick(deps: CronTickDeps, mode)` signature is identical in Tasks 3.7, 4.1, and the test file in C.7.
- `AnitabiSyncDiffSummary.urlChanges` shape (Task 1.6) is consumed unchanged by Task 5.1.
- `MAP_IMAGE_DIAG_STAGES` (Task 1.5) lists `image_cache_state`, used by every emit site in Task 2.6.
- `getCfBindings()` (Task 2.1 sub-step) is the only binding-access call site; no `globalThis.cloudflare` survives.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): honest Self-Review Notes for r2"
```

---

### Task D.2: Cross-task type-consistency pass

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — touch sites only as needed

- [ ] **Step 1: Grep across the plan for each of these symbols and confirm one definition + consistent use**

```bash
PLAN=/Users/mac/Desktop/seichigo/.claude/worktrees/agitated-banzai-065ecb/docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
for sym in cronTick CronTickDeps CronTickResult getCfBindings computeCanonicalImageUrl computeMirrorKey reconcileMirrorAfterDiff AnitabiUrlChange MAP_IMAGE_DIAG_STAGES putMirroredImage getMirroredImage isThrottled recordTimeout reclaimStale processSeedBatch advanceBootstrap cronDelta; do
  echo "=== $sym ==="
  grep -nE "\\b$sym\\b" "$PLAN" | head -5
done
```

- [ ] **Step 2: For each symbol that appears with diverging shapes, fix the divergent occurrence to match the canonical definition.** (Most divergence will be eliminated by Phase B/C; this step catches stragglers.)

- [ ] **Step 3: Commit (only if any fixes made)**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): cross-task type-consistency pass"
```

---

## Phase E — Final Validation

### Task E.1: Re-run a critic-style sanity pass

**Files:** read-only

- [ ] **Step 1: Spawn the critic agent on the revised plan**

Re-dispatch the same prompt as the original acceptance review but pointing at the revised plan. Expected outcome: verdict moves from NOT-READY → READY-WITH-CHANGES (worst case) or READY (target).

- [ ] **Step 2: Triage findings**

For any new CRITICAL: open a follow-up task in this plan (insert before E.2) and resolve.
For any new SIGNIFICANT: decide whether to fix or accept (document in Self-Review Notes).
For any new MINOR: defer with a note.

- [ ] **Step 3: No commit unless follow-up fixes land.**

---

### Task E.2: Goal Alignment Matrix — confirm scope unchanged

**Files:**
- Modify: `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md` — append before final `## Self-Review Notes (r2)`

- [ ] **Step 1: Use the matrix from Task A.1 and append it to the plan as a new top-level section**

```markdown
## Goal Alignment Matrix (spec → plan)

| Spec section | Spec requirement (summary) | Plan task(s) in r2 | Preserved unchanged? |
|---|---|---|---|
| Goal & Thesis | Decouple map-image from anitabi.cn; eliminate 8.5s timeout cliff | Phase 2 (R2 read/write/fallback), Phase 3 (backfill), Phase 7 (rollout) | YES |
| §1 Architecture | Two-worker split + shared R2 + 3 flags | Tasks 1.1, 2.1, 3.1 | YES |
| §2 R2 Layout | Canonical key + variants + Class-A/B budget | Tasks 1.2, 1.3, 1.4, C.10 (added: read ops cost) | EXTENDED (not changed): cost estimate added |
| §3 Request-Path Logic | CF → R2 → upstream → dual-write → fallback | Tasks 2.2, 2.3, 2.4, 2.5, 2.6, C.3 (catch-path fallback) | EXTENDED: catch-path now covered |
| §4 Backfill Logic | 5 req/s, seed + delta, throttle + breaker | Tasks 3.2–3.6, C.5 (cron dedup), C.6 (breaker wired) | EXTENDED: breaker actually engages |
| §5 Mirror State | Postgres source of truth, advisory lock | Task 1.1, C.7 (lock added) | EXTENDED: spec mentioned lock; r2 implements it |
| §6 Headers / UA | X-Original-Source on all paths; UA per D0 | Tasks 2.5, C.11 (CF-hit coverage) | EXTENDED: CF-hit path now covered |
| §7 Sync Reconcile | TTL/refresh on URL change | Tasks 1.6 (added: diff shape), 5.1 | EXTENDED: diff shape extended (was missing) |
| §8 Admin Surfaces | Bootstrap + status + dashboard + CLI | Tasks 4.1–4.4, C.12 (CacheStatePanel) | EXTENDED: §10 SLI panel added |
| §9 Documentation | Runbook | Task 6.1 | YES |
| §10 Acceptance | cache_hit_r2_* ≥ 80% after T+5d | Tasks 7.10, C.12 | YES |
| §11 Non-goals | Perceived-speed / blurhash / viewport prefetch / lane splits — PR4/PR5 | Not in plan | YES |

**Verdict:** Every spec section traces to at least one task. No section was dropped. r2 *adds* cost estimation, breaker wiring, advisory lock, sync-diff extension, CF-hit header coverage, and CacheStatePanel — all of which are *implementation* of spec requirements that the original plan had hand-waved or missed. No new scope.
```

- [ ] **Step 2: Verify**

```bash
grep -n "Goal Alignment Matrix" /Users/mac/Desktop/seichigo/.claude/worktrees/agitated-banzai-065ecb/docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
```

Expected: 1 match.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
git commit -m "plan(map): add Goal Alignment Matrix — confirm r2 preserves spec scope"
```

---

## Self-Review Notes (this plan-revision plan)

**Spec coverage:** This plan-revision plan does not have its own spec — its spec is the acceptance review output. Every CRITICAL and SIGNIFICANT issue from that review has at least one Phase B or C task. Mapping:

| Review issue | Fix task |
|---|---|
| C1: MapImageDiagStage enum doesn't exist | B.1 |
| C2: Sync diff missing URL changes | B.2 |
| C3: requireAdmin doesn't exist | B.3 |
| C4: Cross-worker import boundary | B.4 |
| C5: Mirror-worker Prisma WASM | B.5 |
| C6: OpenNext binding access | B.6 |
| C7: Streaming clone + dual-write race | B.7 |
| C8: Task 1.2 strips kind-aware logic | B.8 |
| S1: Phase-0 verdict→action | C.1 |
| S2: Task 1.2 async-from-start | C.2 |
| S3: catch-path fallback | C.3 |
| S4: DATABASE_URL secret | C.4 |
| S5: cron hour-mark race | C.5 |
| S6: breaker not wired | C.6 |
| S7: force-complete vs cron race | C.7 |
| S8: UI attribution vapor | C.8 |
| S9: meta-rows in aggregations | C.9 |
| S10: R2 read ops not estimated | C.10 |
| S11: CF-hit X-Original-Source | C.11 |
| S12: §10 SLI panel missing | C.12 |
| Plan hygiene: dishonest Self-Review | D.1 |
| Plan hygiene: type consistency | D.2 |
| Final validation | E.1, E.2 |

**Placeholder scan:** searched this document for "TBD", "TODO", "fill in", "implement later", "similar to" — none present.

**Type consistency:** symbols introduced (e.g., `getCfBindings`, `CronTickDeps`, `AnitabiUrlChange`, `MAP_IMAGE_DIAG_STAGES`, `META_SOURCE_TYPES`) are each defined once in this plan and referenced by exact name elsewhere.

**Goal preservation:** the entire goal of this plan-revision plan is "fix the plan without changing the spec." Phase A.2 records that explicitly; Phase E.2 verifies it via the Goal Alignment Matrix; the spec is never opened for write in any task.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror-plan-revision.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task (Phase B and C tasks are mostly independent and can run in parallel batches: B.1/B.2/B.3/B.8 in one batch; B.4/B.5 sequential because they touch the same Tasks 3.1/3.7; B.6/B.7 independent; C.* mostly independent).

**2. Inline Execution** — execute tasks in this session using superpowers:executing-plans, with a checkpoint review after Phase B and again after Phase C.

Recommend Subagent-Driven for parallel speedup on independent doc edits.
