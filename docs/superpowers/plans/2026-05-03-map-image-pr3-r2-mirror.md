# Map Image PR3 — R2 Persistent Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the full anitabi cover/point image set into Cloudflare R2 so map images stay available when `image.anitabi.cn` is slow or down.

**Architecture:** Two CF Workers — modified main Next.js worker that reads/writes R2 in the request path, plus a new `anitabi-mirror` worker that runs cron-driven backfill. Both share an R2 bucket binding `MAP_IMAGE_CACHE`. Three independent feature flags (`R2_READ`, `R2_WRITE`, `MIRROR_CRON`) gate rollout. Postgres `MapImageMirrorState` table is the source of truth for backfill progress and supports resume.

**Tech Stack:** Next.js 15 / React 19 / TypeScript · Cloudflare Workers + R2 · Prisma 6 + Postgres · Vitest · OpenNext for CF · Wrangler.

**Spec:** [docs/superpowers/specs/2026-05-03-map-image-pr3-r2-mirror-design.md](../specs/2026-05-03-map-image-pr3-r2-mirror-design.md)

**Branch:** create new worktree off `main` (`superpowers:using-git-worktrees`) — do not work in the brainstorming worktree.

---

## Revision History

| Date | Revision | Author | Notes |
|---|---|---|---|
| 2026-05-03 | r1 (initial) | brainstorming | First-pass plan; identified 8 critical and 12 significant issues in acceptance review |
| 2026-05-03 | r2 (this revision) | plan-revision | Fixes critical issues: missing `MapImageDiagStage` enum, missing diff-shape fields, nonexistent admin-helper reference, cross-worker import boundary, mirror-worker Prisma WASM build, OpenNext binding access, dual-write streaming clone, kind-aware variant preservation. No spec change; goal/scope/rollout sequence unchanged. |

## Task Index

- Phase 0 — Research & verification (parallel, gating)
- Phase 1 — Foundations (schema, shared libs, types; includes Task 1.6 sync diff URL-change tuples)
- Phase 2 — Main worker R2 integration
- Phase 3 — Mirror worker
- Phase 4 — Admin surfaces
- Phase 5 — Sync integration & UI attribution
- Phase 6 — Documentation
- Phase 7 — Deploy & rollout

Total: 32 tasks. Phases 0–6 are code/research; Phase 7 is operational.

---

## Phase 0 — Research & Verification (gating, parallel-safe)

### Task 0.1: D0 — anitabi mirror compliance research

**Files:**
- Create: `docs/superpowers/research/2026-05-03-anitabi-mirror-compliance.md`

- [ ] **Step 1: Open the anitabi documentation repo**

Navigate browser to `https://github.com/anitabi/anitabi.cn-document`. Search README and any files containing "镜像" / "mirror" / "rate" / "User-Agent" / "robots".

- [ ] **Step 2: Fetch `https://image.anitabi.cn/robots.txt` and `https://anitabi.cn/robots.txt`**

Run:
```bash
curl -sS https://image.anitabi.cn/robots.txt
curl -sS https://anitabi.cn/robots.txt
```

Save raw outputs into the research doc with timestamps.

- [ ] **Step 3: Write the research doc**

Template (fill in actual findings):
```markdown
# Anitabi Mirror Compliance Research (D0 for PR3)

**Date:** 2026-05-03
**Author:** PR3 implementation
**Source documentation:** https://github.com/anitabi/anitabi.cn-document (commit <sha>)

## Findings
1. **Rate limit / QPS**: <documented value or "no documented limit; we use 5 req/s">
2. **User-Agent requirements**: <documented requirements or "none">
3. **Attribution requirements**: <documented requirements>
4. **Cache TTL minimums**: <documented value>
5. **Disallowed resources**: <list>
6. **Contact channel**: <found or not>

## robots.txt snapshot
\`\`\`
<paste raw content>
\`\`\`

## Compliance verdict
- [x] GREEN — proceed with PR3 §4 throttling values as designed
- [ ] YELLOW — adjust throttle to <X req/s>; UA to <value>; expected backfill timeline shifts to ~<N> days
- [ ] RED — abort D4-γ; replan with D4-α/β

## Parameter alignment table
| Spec value | Anitabi requirement | Final PR3 value |
|---|---|---|
| 5 req/s | <X> | <Y> |
| UA `SeichiGoMirror/1.0 (+https://seichigo.com)` | <required pattern> | <final> |
| s-maxage 86400 | min <N>d | <final> |
```

- [ ] **Step 4: Commit the research doc**

```bash
git add docs/superpowers/research/2026-05-03-anitabi-mirror-compliance.md
git commit -m "research(map): anitabi mirror compliance D0 for PR3"
```

- [ ] **Step 5: Update spec with locked parameters if YELLOW**

If the verdict is YELLOW, edit `docs/superpowers/specs/2026-05-03-map-image-pr3-r2-mirror-design.md` §4 throttle values and §6 UA string, then commit:
```bash
git add docs/superpowers/specs/2026-05-03-map-image-pr3-r2-mirror-design.md
git commit -m "spec(map): align PR3 throttle params with anitabi mirror doc"
```

If GREEN, no spec change needed; proceed.

If RED, **stop**. The plan needs rewriting before any code work.

---

### Task 0.2: Verify `wrangler rollback` works with OpenNext build

**Files:**
- No file changes; result captured in research doc.

- [ ] **Step 1: List current production worker versions**

Run:
```bash
cd /Users/mac/Desktop/seichigo
wrangler deployments list 2>&1 | head -30
```

Capture the most recent 3 version IDs.

- [ ] **Step 2: Test rollback dry-run on a non-current version**

Pick the second-most-recent version. Run:
```bash
wrangler rollback <version-id> --dry-run 2>&1
```

If `--dry-run` is unsupported on this wrangler version, instead read the wrangler docs for `wrangler rollback` and verify the OpenNext-built `.open-next/worker.js` artifact format hasn't changed between deploys (compare bundle headers in the deployments).

- [ ] **Step 3: Document outcome**

Append to `docs/superpowers/research/2026-05-03-anitabi-mirror-compliance.md`:
```markdown
## Wrangler rollback verification
- Last 3 version IDs: <list>
- Rollback path: <PASS / PARTIAL / FAIL with details>
- Implication for PR3: <e.g., "rollback OK, can use as emergency kill" or "must use flag-only rollback">
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/research/2026-05-03-anitabi-mirror-compliance.md
git commit -m "$(cat <<'EOF'
Prove the PR3 rollback path before rollout depends on it

Task 0.2 verifies whether Wrangler rollback is a safe emergency revert for the
OpenNext deployment shape before Phase 7 depends on it.

Constraint: Emergency rollback guidance must be validated before production rollout
Rejected: Assume wrangler rollback works for OpenNext builds | leaves the rollback path unverified
Confidence: medium
Scope-risk: narrow
Directive: If the verdict is PARTIAL, document feature-flag-only emergency revert in the PR3 runbook before Phase 7
Tested: Task 0.2 Wrangler deployment and rollback verification steps captured in the research doc
EOF
)"
```

**Verdict → Action:**

| Verdict | Action |
|---|---|
| PASS | Proceed to Phase 1. |
| PARTIAL | Use feature-flag-only rollback; do not rely on `wrangler rollback` for emergency revert; document this in the PR3 runbook. |
| FAIL | Stop and re-plan affected phases / rollback strategy. |

---

### Task 0.3: Verify sync workflow + diff output stability

**Files:**
- No file changes; capture in research doc.

- [ ] **Step 1: Locate the sync workflow runtime**

Run:
```bash
ls /Users/mac/Desktop/seichigo/lib/anitabi/sync/
cat /Users/mac/Desktop/seichigo/lib/anitabi/sync/diff.ts | head -80
```

Identify: where is `diff.ts` called from? Is it triggered by cron, by `npm run anitabi:sync`, or both?

- [ ] **Step 2: Check last 5 sync runs for errors**

Query Postgres (admin shell):
```sql
SELECT "datasetVersion", COUNT(*), MAX("updatedAt")
FROM "AnitabiBangumi"
GROUP BY "datasetVersion"
ORDER BY MAX("updatedAt") DESC
LIMIT 5;
```

Confirm sync has run successfully recently.

- [ ] **Step 3: Document in research doc**

Append:
```markdown
## Sync workflow stability
- Trigger: <cron / manual / both>
- Last successful sync: <timestamp>
- Diff output reliable: <YES / NO with details>
- Implication for PR3 §7: <can proceed with reconcile hook / must fix sync first>
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/research/2026-05-03-anitabi-mirror-compliance.md
git commit -m "$(cat <<'EOF'
Prove sync stability before Phase 5 depends on reconcile resets

Task 0.3 verifies that the existing sync workflow and diff output are stable
enough to support the Task 5.1 reconcile hook.

Constraint: Reconcile resets are only safe if sync and diff output are already stable
Rejected: Enable the reconcile hook without verifying sync history | risks false resets from unstable sync output
Confidence: medium
Scope-risk: narrow
Directive: If the verdict is PARTIAL, keep Task 5.1 disabled until a green sync run gates Phase 5
Tested: Task 0.3 sync workflow and recent-run verification steps captured in the research doc
EOF
)"
```

**Verdict → Action:**

| Verdict | Action |
|---|---|
| PASS | Proceed to Phase 1. |
| PARTIAL | Fix sync workflow stability before enabling Task 5.1 reconcile hook; gate Phase 5 on a green sync run. |
| FAIL | Stop and re-plan affected phases / reconcile hook. |

---

### Task 0.4: Verify Postgres DB capacity for +160MB

**Files:**
- No file changes.

- [ ] **Step 1: Check current DB size**

Run on Postgres:
```sql
SELECT pg_size_pretty(pg_database_size(current_database()));
SELECT pg_size_pretty(pg_total_relation_size('"AnitabiBangumi"'));
SELECT pg_size_pretty(pg_total_relation_size('"AnitabiPoint"'));
```

- [ ] **Step 2: Check plan's storage limit**

Confirm provider (Neon/Supabase/RDS) and current plan. Estimate headroom.

- [ ] **Step 3: Document in research doc**

Append:
```markdown
## DB capacity verification
- Current DB size: <X MB>
- Provider plan: <name>
- Headroom: <Y MB free>
- PR3 expected delta: ~160MB (320k rows × ~500B + indexes)
- Verdict: <PASS / NEEDS_UPGRADE>
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/research/2026-05-03-anitabi-mirror-compliance.md
git commit -m "$(cat <<'EOF'
Prove storage headroom before PR3 adds mirror-state rows

Task 0.4 verifies the current Postgres tier can absorb the expected
MapImageMirrorState growth before schema and rollout work proceed.

Constraint: Phase 7 must not depend on a storage footprint the current tier cannot absorb
Rejected: Add the mirror-state table before checking DB headroom | risks rollout delay or emergency storage work later
Confidence: medium
Scope-risk: narrow
Directive: If the verdict is NEEDS_UPGRADE, complete the tier upgrade or shard/archive plan before Phase 7
Tested: Task 0.4 database-size and provider-plan verification steps captured in the research doc
EOF
)"
```

**Verdict → Action:**

| Verdict | Action |
|---|---|
| PASS | Proceed to Phase 1. |
| NEEDS_UPGRADE | Upgrade the Postgres tier or shard/archive `MapImageMirrorState` before Phase 7; estimate the timeline shift. |
| FAIL | Stop and re-plan affected phases / storage approach. |

---

## Phase 1 — Foundations

### Task 1.1: Add Prisma models — MapImageMirrorState + MapImageMirrorBootstrap

**Files:**
- Modify: `prisma/schema.prisma` (append after existing `MapImageDiagEvent` model)
- Migration: auto-generated by `prisma migrate dev`

- [ ] **Step 1: Add the two models**

Append at the end of `prisma/schema.prisma`:
```prisma
model MapImageMirrorState {
  id             String   @id @default(cuid())
  sourceType     String
  sourceId       String
  variant        String
  canonicalUrl   String
  r2Key          String
  status         String
  attempts       Int      @default(0)
  lastAttemptAt  DateTime?
  lastError      String?  @db.Text
  mirroredAt     DateTime?
  contentBytes   Int?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([sourceType, sourceId, variant])
  @@index([status, createdAt])
  @@index([status, lastAttemptAt])
}

model MapImageMirrorBootstrap {
  id                Int       @id @default(1)
  bangumiCursor     Int?
  pointCursor       String?
  bangumiCompleted  Boolean   @default(false)
  pointCompleted    Boolean   @default(false)
  totalEnumerated   Int       @default(0)
  startedAt         DateTime?
  completedAt       DateTime?
  lastAdvanceAt     DateTime?
  manuallyTriggered Boolean   @default(false)
}
```

- [ ] **Step 2: Generate migration**

Run:
```bash
cd /Users/mac/Desktop/seichigo
npm run db:migrate:dev -- --name add_map_image_mirror_state
```

Expected: new SQL file under `prisma/migrations/<timestamp>_add_map_image_mirror_state/migration.sql`.

- [ ] **Step 3: Verify the generated SQL**

Read the migration SQL file and confirm:
- Two `CREATE TABLE` statements.
- Three indexes on `MapImageMirrorState` (the unique + two `@@index`).
- No accidental rename or drop on existing tables.

- [ ] **Step 4: Run typecheck and tests**

```bash
npm run typecheck
npm test -- --run tests/anitabi
```

Expected: PASS. Prisma generated client now has the new models available.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add MapImageMirrorState + MapImageMirrorBootstrap for PR3"
```

---

### Task 1.2: Extract `imageNormalize.ts` from `imageProxy.ts`

**Files:**
- Create: `lib/anitabi/imageNormalize.ts`
- Modify: `lib/anitabi/imageProxy.ts` (delegate to new module)
- Test: `tests/anitabi/imageNormalize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/anitabi/imageNormalize.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeCanonicalImageUrl, computeMirrorKey } from '@/lib/anitabi/imageNormalize'

describe('computeCanonicalImageUrl', () => {
  it('rewrites anitabi.cn → image.anitabi.cn and strips /images/ prefix', () => {
    const result = computeCanonicalImageUrl('https://anitabi.cn/images/bangumi/123/cover.jpg?plan=h320')
    expect(result).toBe('https://image.anitabi.cn/bangumi/123/cover.jpg?plan=h320')
  })

  it('preserves bgm.tv cover size variants as distinct canonical URLs', () => {
    const result = computeCanonicalImageUrl('https://lain.bgm.tv/pic/cover/l/abcd.jpg')
    expect(result).toBe('https://lain.bgm.tv/pic/cover/l/abcd.jpg')
  })

  it('strips diagnostic params (__mi_*) and _retry / name', () => {
    const result = computeCanonicalImageUrl(
      'https://image.anitabi.cn/points/abc.jpg?plan=h160&__mi_session=s1&_retry=2&name=foo'
    )
    expect(result).toBe('https://image.anitabi.cn/points/abc.jpg?plan=h160')
  })

  it('sorts remaining query params lexically', () => {
    const a = computeCanonicalImageUrl('https://image.anitabi.cn/p.jpg?b=2&a=1')
    const b = computeCanonicalImageUrl('https://image.anitabi.cn/p.jpg?a=1&b=2')
    expect(a).toBe(b)
  })

  it('lowercases protocol and host', () => {
    const result = computeCanonicalImageUrl('HTTPS://IMAGE.ANITABI.CN/x.jpg')
    expect(result).toBe('https://image.anitabi.cn/x.jpg')
  })
})

describe('computeMirrorKey', () => {
  it('produces deterministic mirror/v1/<host>/<24hex>/<ext> form', async () => {
    const key = await computeMirrorKey('https://image.anitabi.cn/bangumi/123/cover.jpg?plan=h320', 'image/jpeg')
    expect(key).toMatch(/^mirror\/v1\/image\.anitabi\.cn\/[0-9a-f]{24}\/\.jpg$/)
  })

  it('different variants produce different keys', async () => {
    const a = await computeMirrorKey('https://image.anitabi.cn/p.jpg?plan=h160', 'image/jpeg')
    const b = await computeMirrorKey('https://image.anitabi.cn/p.jpg?plan=h320', 'image/jpeg')
    expect(a).not.toBe(b)
  })

  it('webp mime → .webp extension', async () => {
    const key = await computeMirrorKey('https://image.anitabi.cn/x.webp', 'image/webp')
    expect(key).toMatch(/\/\.webp$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/anitabi/imageNormalize.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/anitabi/imageNormalize'".

- [ ] **Step 3: Implement `imageNormalize.ts`**

Create `lib/anitabi/imageNormalize.ts`:
```ts
type MimeExtension = '.jpg' | '.png' | '.webp' | '.avif' | '.gif' | '.svg'

const DIAG_PARAM_PREFIX = '__mi_'
const STRIP_PARAM_NAMES = ['_retry', 'name']

export function computeCanonicalImageUrl(input: string): string {
  const url = new URL(input)
  url.protocol = url.protocol.toLowerCase()
  url.hostname = url.hostname.toLowerCase()
  if (url.pathname.endsWith('/') && url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith(DIAG_PARAM_PREFIX)) url.searchParams.delete(key)
  }
  for (const key of STRIP_PARAM_NAMES) url.searchParams.delete(key)
  if (url.hostname === 'anitabi.cn' || url.hostname === 'www.anitabi.cn') {
    url.hostname = 'image.anitabi.cn'
  }
  if (url.hostname.endsWith('anitabi.cn') && url.pathname.startsWith('/images/')) {
    url.pathname = url.pathname.slice('/images'.length)
  }
  const sortedParams = new URLSearchParams()
  const keys = [...url.searchParams.keys()].sort()
  for (const key of keys) {
    for (const value of url.searchParams.getAll(key)) sortedParams.append(key, value)
  }
  url.search = sortedParams.toString()
  return url.toString()
}

function extensionFromMimeType(mime: string): MimeExtension {
  const lower = mime.toLowerCase()
  if (lower.includes('image/png')) return '.png'
  if (lower.includes('image/webp')) return '.webp'
  if (lower.includes('image/avif')) return '.avif'
  if (lower.includes('image/gif')) return '.gif'
  if (lower.includes('image/svg')) return '.svg'
  return '.jpg'
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function computeMirrorKey(canonicalUrl: string, mimeType: string): Promise<string> {
  const url = new URL(canonicalUrl)
  const hash = (await sha256Hex(canonicalUrl)).slice(0, 24)
  const ext = extensionFromMimeType(mimeType)
  return `mirror/v1/${url.hostname}/${hash}/${ext}`
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run tests/anitabi/imageNormalize.test.ts
```

Expected: all 8 tests PASS. These assertions cover canonicalization semantics only for `computeCanonicalImageUrl` and `computeMirrorKey`; they must not become display-variant tests for per-kind map image rewrites.

- [ ] **Step 5: Add `computeCanonicalImageUrl` as a sibling helper, do NOT replace kind-aware variants**

Keep `lib/anitabi/imageProxy.ts` kind-aware display logic intact. `normalizeBangumiCoverVariant(url, kind)` and `normalizeAnitabiDisplayVariant(url, kind)` must continue to own display rewrite paths and continue receiving `kind: MapDisplayImageKind` from `getMapDisplayImageCandidates`.

Extract only the shared URL-cleaning and canonicalization pieces into `lib/anitabi/imageNormalize.ts` so `computeCanonicalImageUrl(url: string)` can normalize host/path/query state for stable mirror lookups without changing display semantics.

Task 1.3's `imageMirrorVariants.ts` should call `computeCanonicalImageUrl` when building stable R2 variant keys. That helper is a sibling to the display-variant functions, not a replacement for them.

If `imageProxy.ts` reuses any extracted helper, limit that reuse to URL-cleaning/canonicalization that is independent of `MapDisplayImageKind`. Size/variant rewrites stay in the kind-aware display helpers and in mirror variant enumerators, not in the generic canonicalizer. Do not collapse or delete the per-kind display transforms in `normalizeBangumiCoverVariant`, `normalizeAnitabiDisplayVariant`, or the `getMapDisplayImageCandidates` call flow. Existing tests `tests/anitabi/imageProxy.bgmLadder.test.ts` and `tests/anitabi/image-proxy-phase2.test.ts` must still pass.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: this is a repo-wide gate, and it is currently blocked by pre-existing unrelated line-budget failures unless those are fixed first. Do not treat a line-budget failure here as a Task 1.2 regression; the task-local proof is the direct Vitest runs above, plus the existing image-proxy tests.

- [ ] **Step 7: Run direct imageProxy variant tests**

```bash
npx vitest run tests/anitabi/imageProxy.bgmLadder.test.ts tests/anitabi/image-proxy-phase2.test.ts
```

Expected: PASS. This is the primary Task 1.2 proof that the extracted canonicalization helper did not change kind-aware imageProxy variant behavior.

- [ ] **Step 8: Commit**

```bash
git add lib/anitabi/imageNormalize.ts lib/anitabi/imageProxy.ts tests/anitabi/imageNormalize.test.ts
git commit -m "$(cat <<'EOF'
Stabilize shared image canonicalization without changing display variants

Task 1.2 extracts URL canonicalization for mirror-key generation while keeping
kind-aware display rewrite behavior in imageProxy.ts.

Constraint: computeCanonicalImageUrl is only for stable canonical lookup inputs
Rejected: Replace normalizeBangumiCoverVariant and normalizeAnitabiDisplayVariant | would break MapDisplayImageKind-aware display transforms
Confidence: high
Scope-risk: narrow
Directive: Keep canonicalization helpers separate from per-kind display variant rewrites
Tested: npx vitest run tests/anitabi/imageNormalize.test.ts
Tested: npx vitest run tests/anitabi/imageProxy.bgmLadder.test.ts tests/anitabi/image-proxy-phase2.test.ts
Not-tested: npm test repo-wide gate remains blocked by pre-existing unrelated line-budget failures unless those are fixed first
EOF
)"
```

---

### Task 1.3: Create `imageMirrorVariants.ts`

**Files:**
- Create: `lib/anitabi/imageMirrorVariants.ts`
- Test: `tests/anitabi/imageMirrorVariants.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/anitabi/imageMirrorVariants.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  enumerateBangumiCoverVariants,
  enumeratePointImageVariants,
} from '@/lib/anitabi/imageMirrorVariants'

describe('enumerateBangumiCoverVariants', () => {
  it('returns 2 variants for an anitabi cover URL', () => {
    const variants = enumerateBangumiCoverVariants('https://image.anitabi.cn/bangumi/123/cover.jpg')
    expect(variants).toHaveLength(2)
    const labels = variants.map((v) => v.label).sort()
    expect(labels).toEqual(['cover-l', 'cover-m'])
  })

  it('returns 2 variants for a bgm.tv cover URL', () => {
    const variants = enumerateBangumiCoverVariants('https://lain.bgm.tv/pic/cover/l/abcd.jpg')
    expect(variants).toHaveLength(2)
    expect(variants.map((v) => v.label).sort()).toEqual(['cover-l', 'cover-m'])
    expect(variants.find((v) => v.label === 'cover-l')?.url).toBe('https://lain.bgm.tv/pic/cover/l/abcd.jpg')
    expect(variants.find((v) => v.label === 'cover-m')?.url).toBe('https://lain.bgm.tv/pic/cover/m/abcd.jpg')
  })

  it('returns empty array for null / empty input', () => {
    expect(enumerateBangumiCoverVariants(null)).toEqual([])
    expect(enumerateBangumiCoverVariants('')).toEqual([])
  })
})

describe('enumeratePointImageVariants', () => {
  it('returns 3 variants (h160, h320, w640q80) for an anitabi point URL', () => {
    const variants = enumeratePointImageVariants('https://image.anitabi.cn/points/abc.jpg')
    expect(variants).toHaveLength(3)
    expect(variants.map((v) => v.label).sort()).toEqual(['h160', 'h320', 'w640q80'])
  })

  it('each variant URL is a canonical form', () => {
    const variants = enumeratePointImageVariants('https://image.anitabi.cn/points/abc.jpg')
    for (const v of variants) {
      expect(v.url).toMatch(/^https:\/\/image\.anitabi\.cn\/points\/abc\.jpg\?/)
    }
  })

  it('returns empty array for non-anitabi point URLs', () => {
    expect(enumeratePointImageVariants('https://other.example/p.jpg')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run tests/anitabi/imageMirrorVariants.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

Create `lib/anitabi/imageMirrorVariants.ts`:
```ts
import { computeCanonicalImageUrl } from '@/lib/anitabi/imageNormalize'

export type MirrorVariant = { label: string; url: string }

export function enumerateBangumiCoverVariants(rawUrl: string | null | undefined): MirrorVariant[] {
  if (!rawUrl) return []
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return []
  }
  const host = url.hostname.toLowerCase()
  const isAnitabi = host === 'image.anitabi.cn' || host.endsWith('.anitabi.cn')
  const isBgmTv = host.endsWith('bgm.tv')
  if (!isAnitabi && !isBgmTv) return []

  const out: MirrorVariant[] = []
  if (isBgmTv) {
    const m = new URL(url.toString())
    m.pathname = m.pathname.replace('/pic/cover/l/', '/pic/cover/m/')
    out.push({ label: 'cover-m', url: computeCanonicalImageUrl(m.toString()) })
    const l = new URL(url.toString())
    l.pathname = l.pathname.replace('/pic/cover/m/', '/pic/cover/l/')
    out.push({ label: 'cover-l', url: computeCanonicalImageUrl(l.toString()) })
  } else {
    out.push({ label: 'cover-m', url: computeCanonicalImageUrl(url.toString()) })
    const l = new URL(url.toString())
    l.searchParams.set('plan', 'l')
    out.push({ label: 'cover-l', url: computeCanonicalImageUrl(l.toString()) })
  }
  return out
}

export function enumeratePointImageVariants(rawUrl: string | null | undefined): MirrorVariant[] {
  if (!rawUrl) return []
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return []
  }
  const host = url.hostname.toLowerCase()
  if (host !== 'image.anitabi.cn' && !host.endsWith('.anitabi.cn')) return []

  const buildVariant = (label: string, mutate: (u: URL) => void): MirrorVariant => {
    const u = new URL(url.toString())
    mutate(u)
    return { label, url: computeCanonicalImageUrl(u.toString()) }
  }

  return [
    buildVariant('h160', (u) => u.searchParams.set('plan', 'h160')),
    buildVariant('h320', (u) => u.searchParams.set('plan', 'h320')),
    buildVariant('w640q80', (u) => {
      u.searchParams.delete('plan')
      u.searchParams.set('w', '640')
      u.searchParams.set('q', '80')
    }),
  ]
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run tests/anitabi/imageMirrorVariants.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/anitabi/imageMirrorVariants.ts tests/anitabi/imageMirrorVariants.test.ts
git commit -m "$(cat <<'EOF'
Preserve distinct mirror variants for bangumi covers and point plans

Task 1.3 enumerates stable mirror variants while keeping bgm `cover-l`
and `cover-m` as separate canonical URLs and keys.

Constraint: Task-local verification must bypass npm test because unrelated line-budget checks currently block the repo-wide gate
Rejected: Collapse bgm /pic/cover/l/ into /pic/cover/m/ during canonicalization | would merge distinct mirror variants into one key
Confidence: high
Scope-risk: narrow
Directive: Keep variant expansion in imageMirrorVariants.ts and display fallbacks in kind-aware image proxy helpers, not in computeCanonicalImageUrl
Tested: npx vitest run tests/anitabi/imageMirrorVariants.test.ts
Not-tested: npm test repo-wide gate remains blocked by pre-existing unrelated line-budget failures unless those are fixed first
EOF
)"
```

---

### Task 1.4: Create `r2Mirror.ts` shared client

**Files:**
- Create: `lib/anitabi/r2Mirror.ts`
- Test: `tests/anitabi/r2Mirror.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/anitabi/r2Mirror.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { putMirroredImage, getMirroredImage } from '@/lib/anitabi/r2Mirror'

class FakeR2Bucket {
  store = new Map<string, { body: ArrayBuffer; metadata: any }>()
  async head(key: string) {
    const entry = this.store.get(key)
    if (!entry) return null
    return { customMetadata: entry.metadata.customMetadata, size: entry.body.byteLength }
  }
  async get(key: string) {
    const entry = this.store.get(key)
    if (!entry) return null
    return {
      arrayBuffer: async () => entry.body,
      customMetadata: entry.metadata.customMetadata,
      httpMetadata: entry.metadata.httpMetadata,
      size: entry.body.byteLength,
    }
  }
  async put(key: string, body: ArrayBuffer, opts: any) {
    this.store.set(key, { body, metadata: opts })
    return { key }
  }
}

describe('putMirroredImage', () => {
  let bucket: FakeR2Bucket

  beforeEach(() => {
    bucket = new FakeR2Bucket()
  })

  it('puts new object with full customMetadata', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const result = await putMirroredImage(
      bucket as any,
      'https://image.anitabi.cn/x.jpg?plan=h320',
      bytes,
      'image/jpeg',
      'lazy',
    )
    expect(result.skipped).toBe(false)
    expect(result.bytesWritten).toBe(3)
    expect(bucket.store.size).toBe(1)
    const stored = [...bucket.store.values()][0]
    expect(stored.metadata.customMetadata.mirrorSource).toBe('lazy')
    expect(stored.metadata.customMetadata.originalUrl).toBe('https://image.anitabi.cn/x.jpg?plan=h320')
  })

  it('skips if object exists and is fresh (within 7d)', async () => {
    const bytes = new Uint8Array([1]).buffer
    await putMirroredImage(bucket as any, 'https://image.anitabi.cn/x.jpg', bytes, 'image/jpeg', 'lazy')
    const result = await putMirroredImage(bucket as any, 'https://image.anitabi.cn/x.jpg', bytes, 'image/jpeg', 'cron-seed')
    expect(result.skipped).toBe(true)
  })
})

describe('getMirroredImage', () => {
  it('returns null on miss', async () => {
    const bucket = new FakeR2Bucket()
    const result = await getMirroredImage(bucket as any, 'https://image.anitabi.cn/missing.jpg', 'image/jpeg')
    expect(result).toBeNull()
  })

  it('returns body + metadata on hit', async () => {
    const bucket = new FakeR2Bucket()
    const bytes = new Uint8Array([7, 8]).buffer
    await putMirroredImage(bucket as any, 'https://image.anitabi.cn/x.jpg', bytes, 'image/jpeg', 'lazy')
    const result = await getMirroredImage(bucket as any, 'https://image.anitabi.cn/x.jpg', 'image/jpeg')
    expect(result).not.toBeNull()
    expect(result!.bytes.byteLength).toBe(2)
    expect(result!.customMetadata.mirrorSource).toBe('lazy')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
npm test -- --run tests/anitabi/r2Mirror.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/anitabi/r2Mirror.ts`:
```ts
import { computeCanonicalImageUrl, computeMirrorKey } from '@/lib/anitabi/imageNormalize'

const REFRESH_MIN_AGE_DAYS = 7

type MirrorSource = 'lazy' | 'cron-seed' | 'cron-delta' | 'cron-refresh'

export type R2MirrorBucket = {
  head(key: string): Promise<{ customMetadata?: Record<string, string>; size?: number } | null>
  get(key: string): Promise<{
    arrayBuffer: () => Promise<ArrayBuffer>
    customMetadata?: Record<string, string>
    httpMetadata?: { contentType?: string }
    size?: number
  } | null>
  put(
    key: string,
    body: ArrayBuffer,
    opts: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>
}

export type PutResult = { key: string; bytesWritten: number; skipped: boolean }

export async function putMirroredImage(
  bucket: R2MirrorBucket,
  rawUrl: string,
  imageBytes: ArrayBuffer,
  mimeType: string,
  source: MirrorSource,
): Promise<PutResult> {
  const canonicalUrl = computeCanonicalImageUrl(rawUrl)
  const key = await computeMirrorKey(canonicalUrl, mimeType)

  const existing = await bucket.head(key)
  if (existing?.customMetadata?.mirroredAt) {
    const ageMs = Date.now() - new Date(existing.customMetadata.mirroredAt).getTime()
    if (ageMs < REFRESH_MIN_AGE_DAYS * 24 * 60 * 60 * 1000) {
      return { key, bytesWritten: imageBytes.byteLength, skipped: true }
    }
  }

  const mirroredAt = new Date().toISOString()
  await bucket.put(key, imageBytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      originalUrl: canonicalUrl,
      mimeType,
      mirroredAt,
      mirrorSource: source,
      contentLength: String(imageBytes.byteLength),
    },
  })
  return { key, bytesWritten: imageBytes.byteLength, skipped: false }
}

export async function getMirroredImage(
  bucket: R2MirrorBucket,
  rawUrl: string,
  mimeType: string,
): Promise<{ bytes: ArrayBuffer; customMetadata: Record<string, string>; httpContentType?: string } | null> {
  const canonicalUrl = computeCanonicalImageUrl(rawUrl)
  const key = await computeMirrorKey(canonicalUrl, mimeType)
  try {
    const obj = await bucket.get(key)
    if (!obj) return null
    return {
      bytes: await obj.arrayBuffer(),
      customMetadata: obj.customMetadata ?? {},
      httpContentType: obj.httpMetadata?.contentType,
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- --run tests/anitabi/r2Mirror.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/anitabi/r2Mirror.ts tests/anitabi/r2Mirror.test.ts
git commit -m "feat(map): r2Mirror client (put/get with metadata + freshness skip)"
```

---

### Task 1.5: Document `image_cache_state` as a recognized diag stage

**Why:** PR1.55 (`lib/mapImageDiag/shared.ts`) stores `stage: string` as a free-form Zod field — there is no enum to extend. The `image_cache_state` events emitted by Phase 2 will be accepted by the existing schema verbatim. This task therefore documents the new stage value and adds a runtime constant so callers don't pass typo'd strings.

**Files:**
- Modify: `lib/mapImageDiag/stages.ts` (create if absent)
- Modify: `lib/mapImageDiag/shared.ts` (add comment note only; no schema change)
- Test: `tests/mapImageDiag/stages.test.ts`

- [ ] **Step 1: Open `lib/mapImageDiag/shared.ts`** to confirm the schema is `stage: z.string().min(1)` and that no exhaustive union exists. Also verify the current repo stage strings before updating the registry so drift is caught:

```bash
rg -n "(stage:\\s*['\"]|viewport_loader_request|first_view_anchor)" lib app features tests
```

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
    expect(isKnownDiagStage('dom_request_start')).toBe(true)
    expect(isKnownDiagStage('viewport_loader_request_start')).toBe(true)
    expect(isKnownDiagStage('first_view_anchor')).toBe(true)
    expect(isKnownDiagStage('proxy_stream_terminal')).toBe(true)
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
 * Centralized registry of known MapImageDiag stage strings discovered in the
 * current repo plus PR3 additions. Stage is a free-form `string` in the Zod
 * schema (lib/mapImageDiag/shared.ts:16), so this list is documentation + a
 * runtime guard, not a TypeScript exhaustiveness check.
 *
 * Re-verify current stage strings with:
 *   rg -n "(stage:\\s*['\"]|viewport_loader_request|first_view_anchor)" lib app features tests
 * before adding or removing entries so the registry stays aligned with the
 * source tree.
 */
export const MAP_IMAGE_DIAG_STAGES = [
  // DOM request lifecycle
  'dom_request_start',
  'dom_request_terminal',

  // Viewport loader lifecycle
  'viewport_loader_request_start',
  'viewport_loader_request_terminal',

  // First-view anchor diagnostics
  'first_view_anchor',

  // Proxy request lifecycle
  'proxy_target_parse',
  'proxy_fetch_start',
  'proxy_allow_check',
  'proxy_content_validate',
  'proxy_fetch_terminal',
  'proxy_stream_terminal',
  'proxy_cache_state',

  // PR3
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

- [ ] **Step 6: Add a note to `lib/mapImageDiag/shared.ts`** above the `stage: z.string().min(1)` field:

```ts
// stage values are free-form strings; the known-stage registry lives in
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
git commit -m "Document PR3 diag stage naming before R2 telemetry rollout" \
  -m "The diag schema intentionally accepts free-form stage strings, so PR3 records image_cache_state in a shared registry without pretending there is an enum to extend." \
  -m "Constraint: MapImageDiag shared schema stores stage as z.string().min(1)" \
  -m "Rejected: Add a MapImageDiagStage enum | no such type exists and it would exceed this task" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: npm run typecheck; npm test -- --run tests/mapImageDiag" \
  -m "Not-tested: full application test suite"
```

---

### Task 1.6: Extend `AnitabiSyncDiffSummary` with URL-change tuples (TDD)

**Why:** Task 5.1's `reconcileMirrorAfterDiff` needs `{id, field, oldValue, newValue}` per changed image URL, but the current `buildAnitabiSyncDiffSummary` only emits counts and ID-only samples. Phase 5 cannot proceed without this.

**Files:**
- Modify: `lib/anitabi/sync/diff.ts`
- Modify: `lib/anitabi/handlers/adminDiff.ts`
- Test: `tests/anitabi/diff.urlChanges.test.ts`
- Test: `tests/anitabi/diff.test.ts` (update existing caller-shape coverage if needed)

- [ ] **Step 1: Read current types in `lib/anitabi/sync/diff.ts`** to confirm `AnitabiSyncDiffSummary` shape.

- [ ] **Step 2: Failing test**

Create `tests/anitabi/diff.urlChanges.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildAnitabiSyncDiffSummary } from '@/lib/anitabi/sync/diff'

describe('buildAnitabiSyncDiffSummary — URL change tuples', () => {
  it('emits bangumiChanges when cover URL changed', () => {
    const summary = buildAnitabiSyncDiffSummary({
      sourceBangumi: [{ id: 1, title: 'A', sourceModifiedMs: 2, cover: 'https://image.anitabi.cn/new.jpg' }],
      localBangumi: [{ id: 1, title: 'A', sourceModifiedMs: BigInt(1), expectedPoints: 0, importedPoints: 0, cover: 'https://image.anitabi.cn/old.jpg' }],
      sourcePoints: [],
      localPoints: [],
    })
    expect(summary.urlChanges.bangumiChanges).toEqual([
      { id: 1, field: 'cover', oldValue: 'https://image.anitabi.cn/old.jpg', newValue: 'https://image.anitabi.cn/new.jpg' },
    ])
  })

  it('emits pointChanges when point image URL changed', () => {
    const summary = buildAnitabiSyncDiffSummary({
      sourceBangumi: [],
      localBangumi: [],
      sourcePoints: [{ id: 'p1', image: 'https://image.anitabi.cn/p/new.jpg' }],
      localPoints: [{ id: 'p1', image: 'https://image.anitabi.cn/p/old.jpg' }],
    })
    expect(summary.urlChanges.pointChanges).toEqual([
      { id: 'p1', field: 'image', oldValue: 'https://image.anitabi.cn/p/old.jpg', newValue: 'https://image.anitabi.cn/p/new.jpg' },
    ])
  })

  it('omits unchanged URLs', () => {
    const summary = buildAnitabiSyncDiffSummary({
      sourceBangumi: [{ id: 1, title: 'A', sourceModifiedMs: 2, cover: 'https://x/a.jpg' }],
      localBangumi: [{ id: 1, title: 'A', sourceModifiedMs: BigInt(1), expectedPoints: 0, importedPoints: 0, cover: 'https://x/a.jpg' }],
      sourcePoints: [],
      localPoints: [],
    })
    expect(summary.urlChanges.bangumiChanges).toEqual([])
  })
})
```

- [ ] **Step 3: Run — expect FAIL**

```bash
npx vitest run tests/anitabi/diff.urlChanges.test.ts
```

- [ ] **Step 4: Implement**

In `lib/anitabi/sync/diff.ts`:

(a) Extend `SourceBangumiSnapshot` and `LocalBangumiSnapshot` to carry `cover: string | null`. Add `SourcePointSnapshot`/`LocalPointSnapshot` with `id: string` and `image: string | null`. Update `buildAnitabiSyncDiffSummary` to accept a single object input:

```ts
buildAnitabiSyncDiffSummary({
  sourceBangumi,
  localBangumi,
  sourcePoints,
  localPoints,
  sampleLimit,
})
```

Update all callers and existing diff tests when changing this signature (search: `buildAnitabiSyncDiffSummary(`).

(b) Extend `AnitabiSyncDiffSummary`:
```ts
export type AnitabiUrlChange<TId, TField extends string> = {
  id: TId
  field: TField
  oldValue: string | null
  newValue: string
}

export type AnitabiSyncDiffSummary = {
  // ... existing fields ...
  urlChanges: {
    bangumiChanges: AnitabiUrlChange<number, 'cover'>[]
    pointChanges: AnitabiUrlChange<string, 'image'>[]
  }
}
```

(c) In the diff builder, when an entity is identified as `modified`, compare `cover` (or `image`) old vs. new and append to the appropriate `urlChanges` array if non-equal and `newValue` is non-empty. The emitted shape must match Task 5.1's `SyncDiffSummary` contract: `{ id, field, oldValue, newValue }`.

(d) In `lib/anitabi/handlers/adminDiff.ts`, pass real URL fields into the diff builder:

- Include `cover: true` in the local `anitabiBangumi.findMany` select.
- Import and use `resolveAnitabiAssetUrl` from `@/lib/anitabi/utils`, plus `normalizeBangumi` / `normalizePoints` from `@/lib/anitabi/source/normalize`, so source URLs are normalized the same way the sync workflow persists them.
- Add `cover: resolveAnitabiAssetUrl(normalizeBangumi(row).cover, deps.getSiteBase())` to source bangumi snapshots.
- Add `cover: row.cover ?? null` to local bangumi snapshots.
- Fetch local point snapshots with `deps.prisma.anitabiPoint.findMany({ select: { id: true, image: true } })`.
- Fetch source point snapshots for changed/missing bangumi candidates by calling both `${deps.getApiBase()}/bangumi/${id}/points` and `${deps.getApiBase()}/bangumi/${id}/points/detail`.
- Derive source point snapshots through `normalizePoints(id, pointsDetail, pointsSummary)` and then map each normalized point to `{ id: point.id, image: resolveAnitabiAssetUrl(point.image, deps.getSiteBase()) }`. This preserves summary-only points and matches the existing sync pipeline in `lib/anitabi/sync/workflow.ts`.
- Pass `sourcePoints` and `localPoints` to `buildAnitabiSyncDiffSummary`.

Do not make `reconcileMirrorAfterDiff` rediscover old/new URLs; `adminDiff` and `buildAnitabiSyncDiffSummary` own that diff responsibility.

- [ ] **Step 5: Run the new test directly — expect PASS**

```bash
npx vitest run tests/anitabi/diff.urlChanges.test.ts
```

- [ ] **Step 6: Run full diff suite to confirm no regression**

```bash
npm test -- --run tests/anitabi/diff.test.ts
```

- [ ] **Step 7: Run typecheck for caller/signature coverage**

```bash
npm run typecheck:app
```

- [ ] **Step 8: Commit**

```bash
git add lib/anitabi/sync/diff.ts lib/anitabi/handlers/adminDiff.ts tests/anitabi/diff.test.ts tests/anitabi/diff.urlChanges.test.ts
git commit -m "Surface URL-change tuples before PR3 mirror reconcile logic" \
  -m "Task 5.1 relies on old/new cover and point image tuples, so the sync diff summary now emits structured URL changes instead of forcing reconcile logic to rediscover them." \
  -m "Constraint: AnitabiSyncDiffSummary previously exposed counts and ID-only sample arrays" \
  -m "Rejected: Compute URL tuples inside reconcileMirrorAfterDiff | it would duplicate diff responsibility and leave Phase 5 under-specified" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: npx vitest run tests/anitabi/diff.urlChanges.test.ts; npm test -- --run tests/anitabi/diff.test.ts; npm run typecheck:app" \
  -m "Not-tested: full application test suite"
```

---

## Phase 2 — Main Worker R2 Integration

### Task 2.1: Add R2 binding + flag vars to `wrangler.jsonc`

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `worker-configuration.d.ts` (generated by `npm run cf:typegen`)
- Create: `lib/anitabi/cf/bindings.ts`

- [ ] **Step 1: Edit wrangler.jsonc**

Open `wrangler.jsonc`. Add after the existing `vars` block:
```jsonc
  "r2_buckets": [
    {
      "binding": "MAP_IMAGE_CACHE",
      "bucket_name": "seichigo-anitabi-images"
    }
  ],
```

Add to the `vars` block:
```jsonc
  "vars": {
    "MAP_IMAGE_SESSION_OUTCOME_V2_ENABLED": "1",
    "NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED": "0",
    "NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED": "0"
  },
```

- [ ] **Step 2: Create the R2 bucket on Cloudflare**

```bash
wrangler r2 bucket create seichigo-anitabi-images
```

If it already exists, this returns "bucket already exists" — fine.

- [ ] **Step 3: Regenerate worker types**

```bash
npm run cf:typegen
```

Expected: `worker-configuration.d.ts` (or similar) now includes `MAP_IMAGE_CACHE: R2Bucket` in the env type.

- [ ] **Step 4: Create the OpenNext binding helper**

Create `lib/anitabi/cf/bindings.ts` so the main worker reads Cloudflare bindings from the same request-scoped OpenNext store already used in `lib/db/prisma.ts` and `lib/mapImageDiag/proxy.ts`:
```ts
type CfWaitUntil = (promise: Promise<unknown>) => void

export type CfBindingsStore = {
  env?: {
    MAP_IMAGE_CACHE?: R2Bucket
    NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED?: string
    NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED?: string
  }
  waitUntil?: CfWaitUntil
  ctx?: { waitUntil?: CfWaitUntil }
}

export function getCfBindings(): CfBindingsStore | undefined {
  const als = (globalThis as typeof globalThis & {
    __openNextAls?: { getStore?: () => CfBindingsStore | undefined }
  }).__openNextAls
  if (!als || typeof als.getStore !== 'function') return undefined
  return als.getStore?.()
}
```

Keep this helper narrow: request-scoped binding/env access only. Do not add Node-process env fallbacks, runtime-global env shims, or route-local fallback branches.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add wrangler.jsonc worker-configuration.d.ts lib/anitabi/cf/bindings.ts
git commit -m "Expose OpenNext R2 bindings for map-image mirror rollout" \
  --trailer "Constraint: OpenNext request bindings must come from __openNextAls, not ad-hoc global fallbacks" \
  --trailer "Directive: Reuse lib/anitabi/cf/bindings.ts for MAP_IMAGE_CACHE and waitUntil access" \
  --trailer "Confidence: high" \
  --trailer "Scope-risk: narrow" \
  --trailer "Tested: npm run cf:typegen && npm run typecheck"
```

---

### Task 2.2: Modify `imageServe.ts` — R2 lookup before upstream (TDD)

**Files:**
- Modify: `lib/anitabi/handlers/imageServe.ts`
- Test: `tests/anitabi/imageServe.r2.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/anitabi/imageServe.r2.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serveImageRequest } from '@/lib/anitabi/handlers/imageServe'
import { putMirroredImage } from '@/lib/anitabi/r2Mirror'

function buildFakeBucket() {
  const store = new Map<string, { body: ArrayBuffer; metadata: any }>()
  return {
    store,
    async head(key: string) {
      const e = store.get(key)
      return e ? { customMetadata: e.metadata.customMetadata, size: e.body.byteLength } : null
    },
    async get(key: string) {
      const e = store.get(key)
      if (!e) return null
      return {
        arrayBuffer: async () => e.body,
        customMetadata: e.metadata.customMetadata,
        httpMetadata: e.metadata.httpMetadata,
        size: e.body.byteLength,
      }
    },
    async put(key: string, body: ArrayBuffer, opts: any) {
      store.set(key, { body, metadata: opts })
      return { key }
    },
  }
}

type TestBindingsStore = {
  env?: {
    MAP_IMAGE_CACHE?: ReturnType<typeof buildFakeBucket>
    NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED?: string
    NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED?: string
  }
  waitUntil?: (promise: Promise<unknown>) => void
  ctx?: { waitUntil?: (promise: Promise<unknown>) => void }
}

function installOpenNextBindings(store: TestBindingsStore) {
  ;(globalThis as typeof globalThis & {
    __openNextAls?: { getStore?: () => TestBindingsStore | undefined }
  }).__openNextAls = {
    getStore: () => store,
  }
}

function buildFakeDeps() {
  return {
    prisma: { mapImageDiagSession: {}, mapImageDiagEvent: {} } as any,
    getSiteBase: () => 'https://www.seichigo.com',
  } as any
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  delete (globalThis as typeof globalThis & { __openNextAls?: unknown }).__openNextAls
})

describe('imageServe — R2 read path', () => {

  it('returns R2 hit with X-Seichigo-Image-Source: r2-primary', async () => {
    const bucket = buildFakeBucket()
    const bytes = new Uint8Array([1, 2, 3]).buffer
    await putMirroredImage(bucket as any, 'https://image.anitabi.cn/x.jpg', bytes, 'image/jpeg', 'cron-seed')
    installOpenNextBindings({
      env: {
        MAP_IMAGE_CACHE: bucket,
        NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED: '1',
      },
    })

    const fetchSpy = vi.spyOn(global, 'fetch')

    const req = new Request(
      'https://www.seichigo.com/api/anitabi/image-render?url=' +
        encodeURIComponent('https://image.anitabi.cn/x.jpg'),
    )
    const res = await serveImageRequest(req, buildFakeDeps(), 'render')

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Seichigo-Image-Source')).toBe('r2-primary')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls through to upstream when R2_READ flag is off', async () => {
    const bucket = buildFakeBucket()
    const bytes = new Uint8Array([1]).buffer
    await putMirroredImage(bucket as any, 'https://image.anitabi.cn/x.jpg', bytes, 'image/jpeg', 'cron-seed')
    installOpenNextBindings({
      env: {
        MAP_IMAGE_CACHE: bucket,
        NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '0',
        NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED: '1',
      },
    })

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([9]), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    )

    const req = new Request(
      'https://www.seichigo.com/api/anitabi/image-render?url=' +
        encodeURIComponent('https://image.anitabi.cn/x.jpg'),
    )
    const res = await serveImageRequest(req, buildFakeDeps(), 'render')

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
npm test -- --run tests/anitabi/imageServe.r2.test.ts
```

Expected: FAIL — R2 logic not yet integrated.

- [ ] **Step 3: Implement R2 read path**

Open `lib/anitabi/handlers/imageServe.ts`. After `parseTargetUrl` + `assertAllowedTargetUrl` succeed and before `fetchValidatedImage`, insert:
```ts
const bindings = getCfBindings()
const bucket = bindings?.env?.MAP_IMAGE_CACHE
const r2ReadEnabled = bindings?.env?.NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED === '1'

// R2 primary lookup (gated by flag, after host allowlist check)
if (mode === 'render' && r2ReadEnabled && bucket) {
  emitProxyEvent({ stage: 'image_cache_state', outcome: 'cf_miss_r2_check', evidence: { target: target.toString() } })
  const r2Hit = await getMirroredImage(bucket, target.toString(), 'image/jpeg').catch(() => null)
  if (r2Hit) {
    emitProxyEvent({
      stage: 'image_cache_state',
      outcome: 'cache_hit_r2_primary',
      terminalState: 'succeeded',
      evidence: { r2Bytes: r2Hit.bytes.byteLength, mirrorSource: r2Hit.customMetadata.mirrorSource },
    })
    const headers = new Headers({
      'Content-Type': r2Hit.httpContentType ?? r2Hit.customMetadata.mimeType ?? 'image/jpeg',
      'Cache-Control': RENDER_CACHE_CONTROL,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'X-Seichigo-Image-Source': 'r2-primary',
      'X-Seichigo-Image-Mirrored-At': r2Hit.customMetadata.mirroredAt ?? '',
      'X-Original-Source': r2Hit.customMetadata.originalUrl ?? target.toString(),
      'Content-Length': String(r2Hit.bytes.byteLength),
    })
    return new Response(r2Hit.bytes, { status: 200, headers })
  }
}
```

Add the import at top of the file:
```ts
import { getCfBindings } from '@/lib/anitabi/cf/bindings'
import { getMirroredImage, putMirroredImage } from '@/lib/anitabi/r2Mirror'
```

Do **not** add an `env` field to `AnitabiApiDeps` and do **not** add route-level Cloudflare plumbing for this task. Keep binding access inside `imageServe.ts` via `getCfBindings()`, matching the existing request-store pattern already used elsewhere in the repo.

- [ ] **Step 4: Run tests**

```bash
npm test -- --run tests/anitabi/imageServe.r2.test.ts
```

Expected: PASS for the two tests.

- [ ] **Step 5: Run full anitabi suite to confirm no regression**

```bash
npm test -- --run tests/anitabi
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/anitabi/handlers/imageServe.ts tests/anitabi/imageServe.r2.test.ts
git commit -m "Prefer mirrored map images before hitting anitabi upstream" \
  -m "Add the initial imageServe R2 read-path coverage and route request-scoped binding access through getCfBindings so render requests can short-circuit to MAP_IMAGE_CACHE without route-level env plumbing." \
  --trailer "Constraint: Main-worker bindings must stay on getCfBindings/__openNextAls rather than dependency-injected env fields or runtime-global fallbacks" \
  --trailer "Confidence: high" \
  --trailer "Scope-risk: narrow" \
  --trailer "Tested: npm test -- --run tests/anitabi/imageServe.r2.test.ts" \
  --trailer "Tested: npm test -- --run tests/anitabi"
```

---

### Task 2.3: Modify `imageServe.ts` — async R2 dual-write on upstream success (TDD)

**Files:**
- Modify: `lib/anitabi/handlers/imageServe.ts`
- Modify: `tests/anitabi/imageServe.r2.test.ts` (add cases)

- [ ] **Step 1: Add a failing test for the write path**

Append to `tests/anitabi/imageServe.r2.test.ts`:
```ts
describe('imageServe — R2 write path', () => {
  it('writes to R2 after successful upstream fetch when WRITE flag on', async () => {
    const bucket = buildFakeBucket()
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      void promise.catch(() => undefined)
    })
    installOpenNextBindings({
      env: {
        MAP_IMAGE_CACHE: bucket,
        NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED: '1',
      },
      ctx: { waitUntil },
    })
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '3' },
      }),
    )
    const req = new Request(
      'https://www.seichigo.com/api/anitabi/image-render?url=' +
        encodeURIComponent('https://image.anitabi.cn/y.jpg'),
    )
    const res = await serveImageRequest(req, buildFakeDeps(), 'render')
    expect(res.status).toBe(200)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    // Wait one microtask cycle for the waitUntil-style write to complete
    await new Promise((r) => setTimeout(r, 10))
    expect(bucket.store.size).toBe(1)
  })

  it('does NOT write to R2 when WRITE flag is off', async () => {
    const bucket = buildFakeBucket()
    installOpenNextBindings({
      env: {
        MAP_IMAGE_CACHE: bucket,
        NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED: '0',
      },
    })
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([7]), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    )
    const req = new Request(
      'https://www.seichigo.com/api/anitabi/image-render?url=' +
        encodeURIComponent('https://image.anitabi.cn/z.jpg'),
    )
    const res = await serveImageRequest(req, buildFakeDeps(), 'render')
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 10))
    expect(bucket.store.size).toBe(0)
  })

  it('does not commit a mirror object when the mirrored branch aborts or exceeds the byte limit', async () => {
    const bucket = buildFakeBucket()
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      void promise.catch(() => undefined)
    })
    installOpenNextBindings({
      env: {
        MAP_IMAGE_CACHE: bucket,
        NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED: '1',
      },
      ctx: { waitUntil },
    })
    const oversized = new Uint8Array(6 * 1024 * 1024)
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(oversized, {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(oversized.byteLength),
        },
      }),
    )
    const req = new Request(
      'https://www.seichigo.com/api/anitabi/image-render?url=' +
        encodeURIComponent('https://image.anitabi.cn/too-large.jpg'),
    )
    const res = await serveImageRequest(req, buildFakeDeps(), 'render')
    await res.arrayBuffer().catch(() => undefined)
    await new Promise((r) => setTimeout(r, 10))
    expect(bucket.store.size).toBe(0)
  })
})
```

Reuse the Task 2.2 `afterEach` cleanup so every write-path test deletes `globalThis.__openNextAls` after it runs.

- [ ] **Step 2: Run — expect fail**

```bash
npm test -- --run tests/anitabi/imageServe.r2.test.ts
```

- [ ] **Step 3: Implement write-through**

In `lib/anitabi/handlers/imageServe.ts`, locate the success path where `buildRenderResponse` returns the response. Right before returning that response (after `storeRenderCache(CF)`), add:
```ts
const bindings = getCfBindings()
const bucket = bindings?.env?.MAP_IMAGE_CACHE
const r2WriteEnabled = bindings?.env?.NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED === '1'
const waitUntil = bindings?.ctx?.waitUntil ?? bindings?.waitUntil

let responseForClient = renderResponse

if (r2WriteEnabled && bucket && renderResponse.body) {
  const [clientBody, mirrorBody] = renderResponse.body.tee()
  const mirrorBytesPromise = readBytesWithLimit(mirrorBody, MAX_IMAGE_BYTES)

  responseForClient = new Response(clientBody, {
    status: renderResponse.status,
    headers: renderResponse.headers,
  })

  const commitMirror = async () => {
    try {
      const bytes = await mirrorBytesPromise
      await putMirroredImage(bucket, target.toString(), bytes, fetched.mimeType, 'lazy')
    } catch (err) {
      console.warn('[imageServe] R2 write skipped', err)
    }
  }

  responseForClient = attachStreamLifecycle(responseForClient, {
    onStreamSuccess: () => {
      if (waitUntil) waitUntil(commitMirror())
      else void commitMirror()
    },
    onStreamError: () => {
      void mirrorBytesPromise.catch(() => undefined)
    },
  })
}

return responseForClient
```

If `buildRenderResponse` already owns the stream lifecycle wrapper, put `tee()` there instead of layering a second wrapper around the returned `Response`: keep one client stream, one mirror stream, and trigger `onStreamSuccess` only after the client stream completes. The R2 commit must happen only from that success callback, never before, so aborted/oversized streams do not persist partial objects. Keep `getCfBindings()` as the only source of bucket/env/waitUntil access.

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- --run tests/anitabi/imageServe.r2.test.ts
```

- [ ] **Step 5: Read back Task 2.3 for B.7 verification**

Read back this Task 2.3 section and confirm all three conditions still hold before committing:
- it mentions `tee()`
- it mentions success-only commit via `onStreamSuccess` or an equivalent client-stream success callback
- it does not reintroduce `cloned.arrayBuffer()`, `clone().arrayBuffer()`, or any buffer-everything-before-response guidance

If useful, run:
```bash
rg -n "Task 2\\.3|tee\\(\\)|onStreamSuccess|cloned\\.arrayBuffer|clone\\(\\)\\.arrayBuffer|buffer-everything" docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
```

- [ ] **Step 6: Commit**

```bash
git add lib/anitabi/handlers/imageServe.ts tests/anitabi/imageServe.r2.test.ts
git commit -m "Mirror successful upstream map-image responses without blocking the client" \
  -m "Switch the plan to a single tee-based write-through path: split the response stream once, defer the R2 commit until onStreamSuccess, and skip persistence when the mirrored branch aborts or exceeds the byte limit." \
  --trailer "Constraint: Reuse getCfBindings for MAP_IMAGE_CACHE and waitUntil; do not reintroduce dependency-injected env branches or legacy runtime globals" \
  --trailer "Rejected: response cloning plus full-body buffering on the returned response | commits partial or failed streams and conflicts with streamed bodies" \
  --trailer "Confidence: high" \
  --trailer "Scope-risk: narrow" \
  --trailer "Tested: npm test -- --run tests/anitabi/imageServe.r2.test.ts"
```

---

### Task 2.4: Modify `imageServe.ts` — R2 fallback after upstream failure (TDD)

**Files:**
- Modify: `lib/anitabi/handlers/imageServe.ts`
- Modify: `tests/anitabi/imageServe.r2.test.ts` (add cases)

- [ ] **Step 1: Add failing tests**

If `tests/anitabi/imageServe.r2.test.ts` does not already hoist a diagnostics spy, add the same pattern used in `tests/anitabi/image-proxy-phase2.test.ts` near the top of the file before importing `serveImageRequest`:
```ts
const mocks = vi.hoisted(() => ({
  emitMapImageProxyEvent: vi.fn(),
}))

vi.mock('@/lib/mapImageDiag/proxy', () => ({
  dispatchMapImageProxyEvent: (...args: any[]) => mocks.emitMapImageProxyEvent(...args),
  emitMapImageProxyEvent: (...args: any[]) => mocks.emitMapImageProxyEvent(...args),
}))
```

Reset `mocks.emitMapImageProxyEvent` in the file's `beforeEach` alongside the other spies, then append:
```ts
describe('imageServe — R2 fallback on upstream failure', () => {
  it('returns R2 with r2-fallback header and upstream_error diag when upstream fetch throws', async () => {
    const bucket = buildFakeBucket()
    const bytes = new Uint8Array([2, 2, 2]).buffer
    await putMirroredImage(bucket as any, 'https://image.anitabi.cn/boom.jpg', bytes, 'image/jpeg', 'cron-seed')
    installOpenNextBindings({
      env: {
        MAP_IMAGE_CACHE: bucket,
        NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED: '1',
      },
    })

    const deps = buildFakeDeps()
    const requestUrl = new URL(
      'https://www.seichigo.com/api/anitabi/image-render?url=' +
        encodeURIComponent('https://image.anitabi.cn/boom.jpg'),
    )

    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('socket hang up'))

    const res = await serveImageRequest(new Request(requestUrl), deps, 'render')

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Seichigo-Image-Source')).toBe('r2-fallback')
    expect(mocks.emitMapImageProxyEvent).toHaveBeenCalledWith(
      deps.prisma,
      requestUrl,
      expect.objectContaining({
        stage: 'image_cache_state',
        outcome: 'cache_hit_r2_fallback',
        evidence: expect.objectContaining({
          reason: 'upstream_error',
        }),
      }),
    )
  })

  it('returns 502 when both upstream fails AND R2 misses', async () => {
    const bucket = buildFakeBucket()
    installOpenNextBindings({
      env: {
        MAP_IMAGE_CACHE: bucket,
        NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED: '1',
      },
    })

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('bad gateway', {
        status: 502,
        headers: { 'content-type': 'text/plain' },
      }),
    )

    const req = new Request(
      'https://www.seichigo.com/api/anitabi/image-render?url=' +
        encodeURIComponent('https://image.anitabi.cn/miss.jpg'),
    )

    const res = await serveImageRequest(req, buildFakeDeps(), 'render')

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: '图片读取失败' })
  })
})
```

If you also want a dedicated timeout regression, reuse the same arrangement but reject `fetch` with `Object.assign(new Error('timeout'), { name: 'AbortError' })`; the implementation path should still go through the same `!fetched.ok` branch and only differ by returning the original 504 when R2 misses.

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement fallback**

In `imageServe.ts`, keep `fetchValidatedImage()` as the source of truth for upstream terminal failures. It already converts thrown fetches and timeouts into `{ ok: false, response }` with status `500` / `504`, so Task 2.4 should extend the existing `if (!fetched.ok)` branch instead of adding a new outer `catch`.

Use the same `getCfBindings()`-derived env access pattern as in Task 2.2/2.3. Extract the R2 response construction into a small helper (for example `tryServeR2Fallback(reason)`), but keep the reason narrow for this task:
```ts
const bindings = getCfBindings()
const bucket = bindings?.env?.MAP_IMAGE_CACHE
const r2ReadEnabled = bindings?.env?.NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED === '1'

type UpstreamFallbackReason = 'upstream_non_ok' | 'upstream_error'

async function tryServeR2Fallback(reason: UpstreamFallbackReason) {
  if (!r2ReadEnabled || !bucket) return null

  const r2Fallback = await getMirroredImage(bucket, target.toString(), 'image/jpeg').catch(() => null)
  if (r2Fallback) {
    emitProxyEvent({
      stage: 'image_cache_state',
      outcome: 'cache_hit_r2_fallback',
      terminalState: 'succeeded',
      evidence: {
        reason,
        r2Bytes: r2Fallback.bytes.byteLength,
      },
    })

    const headers = new Headers({
      'Content-Type': r2Fallback.httpContentType ?? 'image/jpeg',
      'Cache-Control': RENDER_CACHE_CONTROL,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'X-Seichigo-Image-Source': 'r2-fallback',
      'X-Seichigo-Image-Mirrored-At': r2Fallback.customMetadata.mirroredAt ?? '',
      'X-Original-Source': r2Fallback.customMetadata.originalUrl ?? target.toString(),
      'Content-Length': String(r2Fallback.bytes.byteLength),
    })
    return new Response(r2Fallback.bytes, { status: 200, headers })
  }

  emitProxyEvent({
    stage: 'image_cache_state',
    outcome: 'cache_full_miss_failed',
    terminalState: 'failed',
    evidence: { reason },
  })
  return null
}

if (!fetched.ok) {
  const failureReason: UpstreamFallbackReason =
    fetched.response.status === 500 || fetched.response.status === 504
      ? 'upstream_error'
      : 'upstream_non_ok'

  const fallback = await tryServeR2Fallback(failureReason)
  if (fallback) return fallback
  return fetched.response
}
```

This keeps the current fetch flow intact:
- upstream `Response.ok === false` still returns the existing `502` when R2 misses
- thrown fetches and `AbortError` timeouts are observed here as `500` / `504` from `fetchValidatedImage()`, and should only become `r2-fallback` responses when mirrored bytes exist

Only refactor `fetchValidatedImage()` itself if you explicitly want to surface a richer failure kind than status-based mapping. Do not introduce an undefined helper or a second outer error path for this task.

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- --run tests/anitabi/imageServe.r2.test.ts
```

- [ ] **Step 5: Verify the binding-access rewrite stayed clean**

Run:
```bash
! rg -n "globalThis as any.*cloudflare|globalThis\\.cloudflare|@cloudflare/next-on-pages|waitUntilCtx|\\(process\\.env as any\\)\\.MAP_IMAGE_CACHE" \
  lib/anitabi tests/anitabi
# Expected: no output; `rg` exits 1 here because forbidden raw binding patterns are gone.

rg --files lib/anitabi/cf | rg '^lib/anitabi/cf/bindings\\.ts$'
rg -n "getCfBindings|__openNextAls" \
  lib/anitabi/cf/bindings.ts \
  lib/anitabi/handlers/imageServe.ts \
  tests/anitabi/imageServe.r2.test.ts
# Expected: helper file exists, and helper/test wiring matches `getCfBindings` + `__openNextAls`.
```

- [ ] **Step 6: Commit**

```bash
git add lib/anitabi/handlers/imageServe.ts tests/anitabi/imageServe.r2.test.ts
git commit -m "Preserve map-image availability when upstream fetches fail" \
  --trailer "Constraint: Binding access must stay on getCfBindings/__openNextAls without raw Cloudflare globals or process-env fallbacks" \
  --trailer "Confidence: high" \
  --trailer "Scope-risk: narrow" \
  --trailer "Tested: npm test -- --run tests/anitabi/imageServe.r2.test.ts" \
  --trailer "Tested: ! rg -n \"globalThis as any.*cloudflare|globalThis\\.cloudflare|@cloudflare/next-on-pages|waitUntilCtx|\\(process\\.env as any\\)\\.MAP_IMAGE_CACHE\" lib/anitabi tests/anitabi" \
  --trailer "Tested: rg --files lib/anitabi/cf | rg '^lib/anitabi/cf/bindings\\.ts$' && rg -n \"getCfBindings|__openNextAls\" lib/anitabi/cf/bindings.ts lib/anitabi/handlers/imageServe.ts tests/anitabi/imageServe.r2.test.ts"
```

---

### Task 2.5: Add `X-Original-Source` header on all anitabi responses

**Files:**
- Modify: `lib/anitabi/handlers/imageServe.ts`
- Modify: `tests/anitabi/imageServe.r2.test.ts` (contract test)

- [ ] **Step 1: Add contract test**

Append to `tests/anitabi/imageServe.r2.test.ts`:
```ts
describe('imageServe — X-Original-Source header (D5-γ contract)', () => {
  const expectedPattern = /^https:\/\/([a-z0-9.-]+\.)?(anitabi\.cn|bgm\.tv)\//

  it('upstream-served response carries X-Original-Source pointing at anitabi', async () => {
    installOpenNextBindings({
      env: {
        NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '0',
        NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED: '0',
      },
    })
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([2]), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    )
    const req = new Request(
      'https://www.seichigo.com/api/anitabi/image-render?url=' +
        encodeURIComponent('https://image.anitabi.cn/h.jpg'),
    )
    const res = await serveImageRequest(req, buildFakeDeps(), 'render')
    expect(res.headers.get('X-Original-Source')).toMatch(expectedPattern)
  })

  it('R2-served response carries X-Original-Source matching the canonical URL', async () => {
    const bucket = buildFakeBucket()
    const bytes = new Uint8Array([5]).buffer
    await putMirroredImage(bucket as any, 'https://image.anitabi.cn/k.jpg', bytes, 'image/jpeg', 'lazy')
    installOpenNextBindings({
      env: {
        MAP_IMAGE_CACHE: bucket,
        NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '1',
        NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED: '1',
      },
    })
    const req = new Request(
      'https://www.seichigo.com/api/anitabi/image-render?url=' +
        encodeURIComponent('https://image.anitabi.cn/k.jpg'),
    )
    const res = await serveImageRequest(req, buildFakeDeps(), 'render')
    expect(res.headers.get('X-Original-Source')).toMatch(expectedPattern)
  })
})
```

- [ ] **Step 2: Run — verify R2 paths already pass; upstream path likely fails**

```bash
npm test -- --run tests/anitabi/imageServe.r2.test.ts
```

R2 paths set the header in tasks 2.2/2.4. Upstream path must be augmented.

- [ ] **Step 3: Augment upstream success path with X-Original-Source**

Modify `buildRenderResponse` to accept an `originalUrl` parameter:
```ts
async function buildRenderResponse(input: {
  upstream: Response
  mimeType: string
  abort: () => void
  timeoutMs: number
  originalUrl: string  // NEW
  onStreamSuccess?: () => void
  onStreamError?: (outcome: string) => void
}): Promise<Response> {
  // ... existing logic ...
  const headers = new Headers({
    'Content-Type': input.mimeType,
    'Cache-Control': RENDER_CACHE_CONTROL,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'X-Original-Source': input.originalUrl,                     // NEW
    'X-Seichigo-Image-Source': 'upstream-with-r2-write',        // NEW (overridden by caller for write-disabled case)
  })
  // ... rest unchanged ...
}
```

Caller passes `target.toString()` (the canonical anitabi/bgm URL).

When `R2_WRITE_ENABLED=0`, the source header should say `upstream-no-r2`. Pass that distinction through.

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add lib/anitabi/handlers/imageServe.ts tests/anitabi/imageServe.r2.test.ts
git commit -m "Preserve attribution across every anitabi image response path" \
  -m "Extend the imageServe contract so upstream, R2-primary, and R2-fallback responses always expose X-Original-Source while continuing to source rollout flags and MAP_IMAGE_CACHE from installOpenNextBindings/getCfBindings." \
  --trailer "Constraint: Tests must install OpenNext bindings for flag and bucket coverage instead of pushing fake env fields through deps" \
  --trailer "Confidence: high" \
  --trailer "Scope-risk: narrow" \
  --trailer "Tested: npm test -- --run tests/anitabi/imageServe.r2.test.ts"
```

---

### Task 2.6: Emit consolidated `image_cache_state` events for all paths

**Files:**
- Modify: `lib/anitabi/handlers/imageServe.ts`
- Add: `tests/anitabi/imageServe.diag.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/anitabi/imageServe.diag.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serveImageRequest } from '@/lib/anitabi/handlers/imageServe'

const dispatchSpy = vi.fn()
vi.mock('@/lib/mapImageDiag/proxy', () => ({
  dispatchMapImageProxyEvent: (..._args: any[]) => dispatchSpy(..._args),
}))

beforeEach(() => {
  dispatchSpy.mockReset()
})

afterEach(() => {
  delete (globalThis as typeof globalThis & { __openNextAls?: unknown }).__openNextAls
})

function installOpenNextBindings(store: {
  env?: {
    MAP_IMAGE_CACHE?: unknown
    NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED?: string
    NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED?: string
  }
}) {
  ;(globalThis as typeof globalThis & {
    __openNextAls?: { getStore?: () => typeof store | undefined }
  }).__openNextAls = {
    getStore: () => store,
  }
}

function buildDeps() {
  return {
    prisma: {} as any,
    getSiteBase: () => 'https://www.seichigo.com',
  } as any
}

describe('imageServe — image_cache_state stage emission', () => {
  it('emits image_cache_state: cache_miss_all when CF + R2 miss but upstream OK', async () => {
    installOpenNextBindings({
      env: {
        NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED: '0',
        NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED: '0',
      },
    })
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    )
    const req = new Request(
      'https://www.seichigo.com/api/anitabi/image-render?url=' +
        encodeURIComponent('https://image.anitabi.cn/m.jpg'),
    )
    await serveImageRequest(req, buildDeps(), 'render')
    const calls = dispatchSpy.mock.calls.flatMap((c) => c[2] ?? [])
    const stages = calls.filter((e: any) => e?.stage === 'image_cache_state').map((e: any) => e.outcome)
    expect(stages).toContain('cache_miss_all')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement consolidated emission**

In `imageServe.ts`, ensure for each terminal path one of these `image_cache_state` outcomes is emitted exactly once:
- CF hit → `cache_hit_cf` (right after the existing `proxy_cache_state: cache_hit`)
- R2 primary hit → `cache_hit_r2_primary` (already added in 2.2)
- R2 fallback hit → `cache_hit_r2_fallback` (already added in 2.4)
- All miss + upstream OK → `cache_miss_all` (new — emit at the upstream-success terminal, after `proxy_stream_terminal: succeeded`)
- All miss + upstream fail + R2 miss → `cache_full_miss_failed` (already added in 2.4)

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- --run tests/anitabi/imageServe.diag.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/anitabi/handlers/imageServe.ts tests/anitabi/imageServe.diag.test.ts
git commit -m "Make image-cache terminal state visible in one diagnostic stage" \
  -m "Add focused diagnostic coverage for imageServe terminal paths and document the binding-based test setup so cache-state emission no longer depends on fake env injection through handler deps." \
  --trailer "Constraint: Diagnostic tests must install request-scoped OpenNext bindings instead of passing env through deps" \
  --trailer "Confidence: high" \
  --trailer "Scope-risk: narrow" \
  --trailer "Tested: npm test -- --run tests/anitabi/imageServe.diag.test.ts"
```

---

## Phase 3 — Mirror Worker

### Task 3.1: Scaffold `workers/anitabi-mirror/`

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `workers/anitabi-mirror/wrangler.jsonc`
- Create: `workers/anitabi-mirror/package.json`
- Create: `workers/anitabi-mirror/scripts/build.mjs`
- Create: `workers/anitabi-mirror/tsconfig.json`
- Create: `workers/anitabi-mirror/worker-configuration.d.ts` (generated via `wrangler types`)
- Create: `workers/anitabi-mirror/src/index.ts` (skeleton scheduled handler)
- Create: `workers/anitabi-mirror/README.md`

- [ ] **Step 1: Create directory and config**

Run:
```bash
cd /Users/mac/Desktop/seichigo
mkdir -p workers/anitabi-mirror/scripts workers/anitabi-mirror/src
```

Create `workers/anitabi-mirror/wrangler.jsonc`:
```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "seichigo-anitabi-mirror",
  "main": "src/index.ts",
  "compatibility_date": "2026-04-14",
  "compatibility_flags": ["nodejs_compat"],
  "triggers": {
    "crons": [
      "*/5 * * * *",
      "0 * * * *"
    ]
  },
  "vars": {
    "MAP_IMAGE_MIRROR_CRON_ENABLED": "0"
  },
  "r2_buckets": [
    {
      "binding": "MAP_IMAGE_CACHE",
      "bucket_name": "seichigo-anitabi-images"
    }
  ]
}
```

The `*/5 * * * *` runs the seed every 5 min; the `0 * * * *` runs delta hourly. The handler dispatches based on schedule string.

- [ ] **Step 2: package.json + tsconfig**

Create `workers/anitabi-mirror/package.json`:
```json
{
  "name": "@seichigo/anitabi-mirror",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "node scripts/build.mjs",
    "deploy": "npm run build && wrangler deploy",
    "dev": "wrangler dev",
    "typegen": "wrangler types"
  }
}
```

Keep the nested worker package dependency-light and resolve Prisma packages from the repo root. Before Task 3.7 wires the runtime entrypoint, add `@prisma/pg-worker` to the root `dependencies` next to `@prisma/adapter-pg` and `@prisma/client` by running this exact command from `/Users/mac/Desktop/seichigo`:
```bash
npm install --save-exact @prisma/pg-worker@6.9.0
```

Pin `@prisma/pg-worker` to `6.9.0` exactly because that is the current latest published package version. Do **not** invent a fake Prisma-family match such as `@prisma/pg-worker@6.16.0`; that version is not published, so any plan that tells implementers to "match the repo Prisma version family" for this package is not executable. This task intentionally mixes `@prisma/pg-worker@6.9.0` with repo-root `@prisma/adapter-pg`, `@prisma/client`, and `prisma` at `6.16.x`, so the implementation must verify the exact root `package.json` entry and the exact installed `package-lock.json` version before proceeding to Task 3.7's Worker `Pool` wiring and deploy checks. If Prisma later publishes a matching `@prisma/pg-worker` version, update the pin deliberately in both `package.json` and `package-lock.json` with lockfile proof rather than silently floating to a guessed version.

Create `workers/anitabi-mirror/scripts/build.mjs`:
```js
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

async function assertExists(target, label) {
  try {
    await fs.access(target)
  } catch {
    throw new Error(`${label} not found: ${target}. Run \`npm run db:generate\` from the repo root first.`)
  }
}

async function main() {
  const prismaWasmEntrypoint = require.resolve('@prisma/client/wasm')
  const prismaClientDir = path.resolve(path.dirname(prismaWasmEntrypoint), '../../.prisma/client')
  const generatedWasmClientPath = path.join(prismaClientDir, 'wasm.js')
  const wasmWorkerLoaderPath = path.join(prismaClientDir, 'wasm-worker-loader.mjs')
  const queryCompilerWasmPath = path.join(prismaClientDir, 'query_compiler_bg.wasm')

  await assertExists(prismaWasmEntrypoint, '@prisma/client/wasm entrypoint')
  await assertExists(generatedWasmClientPath, 'Prisma generated wasm client')
  await assertExists(wasmWorkerLoaderPath, 'Prisma wasm worker loader')
  await assertExists(queryCompilerWasmPath, 'Prisma query compiler WASM')

  const loaderSource = await fs.readFile(wasmWorkerLoaderPath, 'utf8')
  if (!loaderSource.includes("import('./query_compiler_bg.wasm')")) {
    throw new Error(
      `Prisma wasm worker loader does not import ./query_compiler_bg.wasm: ${wasmWorkerLoaderPath}`,
    )
  }

  console.log('[mirror-build] verified Prisma wasm resolution chain', {
    prismaWasmEntrypoint,
    generatedWasmClientPath,
    wasmWorkerLoaderPath,
    queryCompilerWasmPath,
  })
}

main().catch((error) => {
  console.error('[mirror-build] failed', error)
  process.exitCode = 1
})
```

This worker does **not** add a worker-local Prisma install. It imports `@prisma/client/wasm` from the repo install that Node actually resolves from `workers/anitabi-mirror/scripts/build.mjs`, so the build script must verify the real module chain that Wrangler bundles: `@prisma/client/wasm` -> `.prisma/client/wasm.js` -> `.prisma/client/wasm-worker-loader.mjs` -> `query_compiler_bg.wasm`. Fail fast if `prisma generate` has not run, if the resolution lands somewhere unexpected, or if Prisma changes the loader import away from `./query_compiler_bg.wasm`; a silent no-op would ship a broken cron worker. Do **not** patch a fake worker-local client or `node_modules/.prisma/client/index.js` unless a future upstream Prisma change leaves no narrower fallback.

The same root-level install must also provide `@prisma/pg-worker` for the raw Worker entrypoint in Task 3.7. The main app can keep its repo-style adapter patterns on Node, but this standalone Cloudflare Worker cannot construct `PrismaPg` from plain object options because that path resolves the local `@prisma/adapter-pg` package and its Node `pg` transport. The Worker must instead wrap a bounded `@prisma/pg-worker` `Pool`, while still importing `@prisma/client/wasm` from the root-generated client.

Create `workers/anitabi-mirror/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "./dist",
    "noEmit": true
  },
  "include": ["worker-configuration.d.ts", "src/**/*.ts"]
}
```

- [ ] **Step 3: Skeleton handler**

Create `workers/anitabi-mirror/src/index.ts`:
```ts
type Env = {
  MAP_IMAGE_CACHE: R2Bucket
  MAP_IMAGE_MIRROR_CRON_ENABLED: string
  DATABASE_URL: string
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.MAP_IMAGE_MIRROR_CRON_ENABLED !== '1') {
      console.log('[mirror] cron disabled by flag')
      return
    }
    console.log(`[mirror] tick: cron=${event.cron} scheduledTime=${event.scheduledTime}`)
    if (event.cron === '0 * * * *') {
      // delta cron path (placeholder; implemented in Task 3.5)
    } else {
      // 5-min seed cron path (placeholder; implemented in Tasks 3.2-3.4)
    }
  },
}
```

- [ ] **Step 4: README stub**

Create `workers/anitabi-mirror/README.md`:
```markdown
# anitabi-mirror Worker

Cron-driven worker that backfills R2 with anitabi cover/point images.
Spec: docs/superpowers/specs/2026-05-03-map-image-pr3-r2-mirror-design.md

Build + deploy from repo root:

`cd workers/anitabi-mirror && npm run typegen`

`cd workers/anitabi-mirror && npm run deploy`
```

- [ ] **Step 5: Verify exact `@prisma/pg-worker` version, generated types, resolved Prisma WASM chain, and Wrangler packaging**

```bash
cd /Users/mac/Desktop/seichigo/workers/anitabi-mirror && npm run typegen
cd /Users/mac/Desktop/seichigo
node -e "const pkg=require('./package.json'); if (pkg.dependencies?.['@prisma/pg-worker'] !== '6.9.0') { console.error(pkg.dependencies?.['@prisma/pg-worker']); process.exit(1) }"
node -e "const lock=require('./package-lock.json'); const root=lock.packages?.['']?.dependencies?.['@prisma/pg-worker']; const installed=lock.packages?.['node_modules/@prisma/pg-worker']?.version; if (root !== '6.9.0' || installed !== '6.9.0') { console.error({ root, installed }); process.exit(1) }"
rg -n "\"@prisma/pg-worker\"|\"@prisma/adapter-pg\"|\"@prisma/client\"|\"prisma\"" package.json package-lock.json
node workers/anitabi-mirror/scripts/build.mjs
node --input-type=module <<'EOF'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(process.cwd() + '/workers/anitabi-mirror/scripts/build.mjs')
const prismaWasmEntrypoint = require.resolve('@prisma/client/wasm')
const wasmWorkerLoaderPath = path.resolve(path.dirname(prismaWasmEntrypoint), '../../.prisma/client/wasm-worker-loader.mjs')
const queryCompilerWasmPath = path.join(path.dirname(wasmWorkerLoaderPath), 'query_compiler_bg.wasm')

console.log({ prismaWasmEntrypoint, wasmWorkerLoaderPath, queryCompilerWasmPath })
EOF
loader_path=$(node --input-type=module <<'EOF'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(process.cwd() + '/workers/anitabi-mirror/scripts/build.mjs')
const prismaWasmEntrypoint = require.resolve('@prisma/client/wasm')
process.stdout.write(path.resolve(path.dirname(prismaWasmEntrypoint), '../../.prisma/client/wasm-worker-loader.mjs'))
EOF
)
rg -n "export default import\\('./query_compiler_bg\\.wasm'\\)" "$loader_path"
cd workers/anitabi-mirror && npm run deploy -- --dry-run 2>&1 | tail -20
```

Expected: `worker-configuration.d.ts` is generated; the root `package.json` dependency entry for `@prisma/pg-worker` is exactly `6.9.0`; `package-lock.json` records both the root dependency and `node_modules/@prisma/pg-worker` installed version as exactly `6.9.0`; the build script prints the resolved `@prisma/client/wasm` entry, `wasm-worker-loader.mjs`, and `query_compiler_bg.wasm` paths; the resolved loader imports `./query_compiler_bg.wasm`; and the deploy dry-run succeeds with no syntax errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/mac/Desktop/seichigo
git add package.json package-lock.json workers/anitabi-mirror
git commit -m "Package Prisma WASM before deploying the mirror worker" \
  -m "The worker scaffold includes a build step that verifies the resolved Prisma WASM module chain before Wrangler deploy so the cron entrypoint matches the actual package resolution path used by @prisma/client/wasm." \
  -m "Constraint: Cloudflare Workers cannot run Prisma's Rust query engine and the raw worker entrypoint must get @prisma/pg-worker from the repo-root Prisma install" \
  -m "Constraint: The latest published @prisma/pg-worker is 6.9.0, while the repo's @prisma/adapter-pg, @prisma/client, and prisma stay on 6.16.x" \
  -m "Rejected: Add a worker-local Prisma install | unnecessary duplicate package surface for a single worker when the nested package resolves root-installed Prisma modules" \
  -m "Rejected: Pin @prisma/pg-worker to 6.16.0 to match the rest of Prisma | @prisma/pg-worker@6.16.0 is not published and npm returns E404" \
  -m "Rejected: Deploy directly with wrangler only | the worker bundle would miss Prisma's WASM query compiler" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: worker typegen; root package.json/package-lock exact @prisma/pg-worker@6.9.0 checks; build.mjs Prisma WASM resolution-chain check; resolved loader import grep; wrangler deploy dry-run" \
  -m "Not-tested: production cron execution"
```

---

### Task 3.2: Implement `reclaimStale()` (TDD)

**Files:**
- Create: `workers/anitabi-mirror/src/reclaim.ts`
- Create: `workers/anitabi-mirror/src/__tests__/reclaim.test.ts`
- Modify: `vitest.config.ts` (add workers test path)

- [ ] **Step 1: Extend vitest config to pick up worker tests**

Edit `vitest.config.ts` `test.projects[0].test.include`:
```ts
include: ['tests/**/*.test.ts', 'workers/**/*.test.ts'],
```

- [ ] **Step 2: Write failing test**

Create `workers/anitabi-mirror/src/__tests__/reclaim.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { reclaimStale } from '../reclaim'

describe('reclaimStale', () => {
  it('resets in_progress rows older than 5 minutes to pending', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 })
    const prisma = { mapImageMirrorState: { updateMany } } as any
    const now = new Date('2026-05-03T12:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const result = await reclaimStale(prisma)

    expect(result.count).toBe(3)
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: 'in_progress',
        lastAttemptAt: { lt: new Date('2026-05-03T11:55:00Z') },
      },
      data: { status: 'pending' },
    })
    vi.useRealTimers()
  })
})
```

- [ ] **Step 3: Run — expect fail**

```bash
cd /Users/mac/Desktop/seichigo
npm test -- --run workers/anitabi-mirror/src/__tests__/reclaim.test.ts
```

- [ ] **Step 4: Implement**

Create `workers/anitabi-mirror/src/reclaim.ts`:
```ts
import type { PrismaClient } from '@prisma/client'

const STALE_THRESHOLD_MS = 5 * 60 * 1000

export async function reclaimStale(prisma: PrismaClient): Promise<{ count: number }> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS)
  const result = await prisma.mapImageMirrorState.updateMany({
    where: { status: 'in_progress', lastAttemptAt: { lt: cutoff } },
    data: { status: 'pending' },
  })
  return { count: result.count }
}
```

- [ ] **Step 5: Run — expect pass**

- [ ] **Step 6: Commit**

```bash
git add workers/anitabi-mirror/src/reclaim.ts workers/anitabi-mirror/src/__tests__/reclaim.test.ts vitest.config.ts
git commit -m "feat(mirror): reclaimStale resets stale in_progress rows"
```

---

### Task 3.3: Implement `advanceBootstrap()` (TDD)

**Files:**
- Create: `workers/anitabi-mirror/src/bootstrap.ts`
- Create: `workers/anitabi-mirror/src/__tests__/bootstrap.test.ts`

- [ ] **Step 1: Failing test**

Create `workers/anitabi-mirror/src/__tests__/bootstrap.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { advanceBootstrap } from '../bootstrap'

function buildPrismaMock(opts: {
  bangumi: Array<{ id: number; cover: string | null }>
  points: Array<{ id: string; image: string | null }>
  bsState: any
}) {
  const upserts: any[] = []
  return {
    upserts,
    prisma: {
      mapImageMirrorBootstrap: {
        upsert: vi.fn().mockResolvedValue(opts.bsState),
        update: vi.fn().mockImplementation(({ data }) => ({ ...opts.bsState, ...data })),
      },
      anitabiBangumi: {
        findMany: vi.fn().mockResolvedValue(opts.bangumi),
      },
      anitabiPoint: {
        findMany: vi.fn().mockResolvedValue(opts.points),
      },
      mapImageMirrorState: {
        upsert: vi.fn().mockImplementation((args) => {
          upserts.push(args)
          return Promise.resolve({})
        }),
      },
    },
  }
}

describe('advanceBootstrap', () => {
  it('enumerates bangumi covers + creates pending rows for each variant', async () => {
    const { prisma, upserts } = buildPrismaMock({
      bangumi: [{ id: 1, cover: 'https://image.anitabi.cn/bangumi/1/cover.jpg' }],
      points: [],
      bsState: { id: 1, bangumiCursor: null, pointCursor: null, bangumiCompleted: false, pointCompleted: false, totalEnumerated: 0 },
    })
    await advanceBootstrap(prisma as any, 100)
    // 1 bangumi × 2 variants = 2 upserts for bangumi-cover
    const bangumiUpserts = upserts.filter((u) => u.create?.sourceType === 'bangumi-cover')
    expect(bangumiUpserts).toHaveLength(2)
  })

  it('marks bangumi completed when findMany returns empty', async () => {
    const { prisma } = buildPrismaMock({
      bangumi: [],
      points: [{ id: 'p1', image: 'https://image.anitabi.cn/points/p1.jpg' }],
      bsState: { id: 1, bangumiCursor: 999999, pointCursor: null, bangumiCompleted: false, pointCompleted: false, totalEnumerated: 0 },
    })
    await advanceBootstrap(prisma as any, 100)
    expect(prisma.mapImageMirrorBootstrap.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bangumiCompleted: true }) }),
    )
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

Create `workers/anitabi-mirror/src/bootstrap.ts`:
```ts
import type { PrismaClient } from '@prisma/client'
import { enumerateBangumiCoverVariants, enumeratePointImageVariants } from '@/lib/anitabi/imageMirrorVariants'
import { computeMirrorKey } from '@/lib/anitabi/imageNormalize'

export async function advanceBootstrap(prisma: PrismaClient, chunkSize: number): Promise<void> {
  const bs = await prisma.mapImageMirrorBootstrap.upsert({
    where: { id: 1 },
    create: { id: 1, startedAt: new Date() },
    update: {},
  })
  let totalEnumerated = bs.totalEnumerated ?? 0

  if (!bs.bangumiCompleted) {
    const where = bs.bangumiCursor != null ? { id: { gt: bs.bangumiCursor } } : {}
    const batch = await prisma.anitabiBangumi.findMany({
      where: { mapEnabled: true, cover: { not: null }, ...where },
      orderBy: { id: 'asc' },
      take: chunkSize,
      select: { id: true, cover: true },
    })
    if (batch.length === 0) {
      await prisma.mapImageMirrorBootstrap.update({
        where: { id: 1 },
        data: { bangumiCompleted: true, lastAdvanceAt: new Date() },
      })
    } else {
      for (const b of batch) {
        const variants = enumerateBangumiCoverVariants(b.cover)
        for (const v of variants) {
          const key = await computeMirrorKey(v.url, 'image/jpeg')
          await prisma.mapImageMirrorState.upsert({
            where: {
              sourceType_sourceId_variant: {
                sourceType: 'bangumi-cover',
                sourceId: String(b.id),
                variant: v.label,
              },
            },
            create: {
              sourceType: 'bangumi-cover',
              sourceId: String(b.id),
              variant: v.label,
              canonicalUrl: v.url,
              r2Key: key,
              status: 'pending',
            },
            update: {},
          })
          totalEnumerated++
        }
      }
      await prisma.mapImageMirrorBootstrap.update({
        where: { id: 1 },
        data: {
          bangumiCursor: batch[batch.length - 1].id,
          totalEnumerated,
          lastAdvanceAt: new Date(),
        },
      })
    }
    return // one type per tick to keep wall time bounded
  }

  if (!bs.pointCompleted) {
    const where = bs.pointCursor != null ? { id: { gt: bs.pointCursor } } : {}
    const batch = await prisma.anitabiPoint.findMany({
      where: { image: { not: null }, ...where },
      orderBy: { id: 'asc' },
      take: chunkSize,
      select: { id: true, image: true },
    })
    if (batch.length === 0) {
      await prisma.mapImageMirrorBootstrap.update({
        where: { id: 1 },
        data: { pointCompleted: true, completedAt: new Date(), lastAdvanceAt: new Date() },
      })
    } else {
      for (const p of batch) {
        const variants = enumeratePointImageVariants(p.image)
        for (const v of variants) {
          const key = await computeMirrorKey(v.url, 'image/jpeg')
          await prisma.mapImageMirrorState.upsert({
            where: {
              sourceType_sourceId_variant: {
                sourceType: 'point-image',
                sourceId: p.id,
                variant: v.label,
              },
            },
            create: {
              sourceType: 'point-image',
              sourceId: p.id,
              variant: v.label,
              canonicalUrl: v.url,
              r2Key: key,
              status: 'pending',
            },
            update: {},
          })
          totalEnumerated++
        }
      }
      await prisma.mapImageMirrorBootstrap.update({
        where: { id: 1 },
        data: {
          pointCursor: batch[batch.length - 1].id,
          totalEnumerated,
          lastAdvanceAt: new Date(),
        },
      })
    }
  }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add workers/anitabi-mirror/src/bootstrap.ts workers/anitabi-mirror/src/__tests__/bootstrap.test.ts
git commit -m "feat(mirror): advanceBootstrap enumerates bangumi/point variants"
```

---

### Task 3.4: Implement `processSeedBatch()` (TDD)

**Files:**
- Create: `workers/anitabi-mirror/src/seed.ts`
- Create: `workers/anitabi-mirror/src/__tests__/seed.test.ts`

- [ ] **Step 1: Failing test**

Create `workers/anitabi-mirror/src/__tests__/seed.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { processSeedBatch } from '../seed'

function buildPrismaMock(rows: any[]) {
  const updates: any[] = []
  return {
    updates,
    prisma: {
      mapImageMirrorState: {
        findMany: vi.fn().mockResolvedValue(rows),
        update: vi.fn().mockImplementation((args) => {
          updates.push(args)
          return Promise.resolve(rows.find((r) => r.id === args.where.id))
        }),
      },
    },
  }
}

function buildBucket() {
  const store = new Map<string, any>()
  return {
    store,
    head: vi.fn().mockResolvedValue(null),
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockImplementation((key: string, body: ArrayBuffer, opts: any) => {
      store.set(key, { body, opts })
      return Promise.resolve({ key })
    }),
  }
}

describe('processSeedBatch', () => {
  it('mirrors a happy 200 image to R2 and marks row mirrored', async () => {
    const { prisma, updates } = buildPrismaMock([
      {
        id: 'r1',
        canonicalUrl: 'https://image.anitabi.cn/x.jpg',
        attempts: 0,
        sourceType: 'point-image',
      },
    ])
    const bucket = buildBucket()
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    )
    await processSeedBatch(prisma as any, bucket as any, { batchSize: 1, perRequestDelayMs: 0 })
    expect(bucket.store.size).toBe(1)
    const last = updates[updates.length - 1]
    expect(last.data.status).toBe('mirrored')
  })

  it('sets skipped_404 when upstream returns 404', async () => {
    const { prisma, updates } = buildPrismaMock([
      { id: 'r2', canonicalUrl: 'https://image.anitabi.cn/missing.jpg', attempts: 0, sourceType: 'point-image' },
    ])
    const bucket = buildBucket()
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
    await processSeedBatch(prisma as any, bucket as any, { batchSize: 1, perRequestDelayMs: 0 })
    const last = updates[updates.length - 1]
    expect(last.data.status).toBe('skipped_404')
  })

  it('sets failed when attempts maxed out', async () => {
    const { prisma, updates } = buildPrismaMock([
      { id: 'r3', canonicalUrl: 'https://image.anitabi.cn/y.jpg', attempts: 4, sourceType: 'point-image' },
    ])
    const bucket = buildBucket()
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('boom'))
    await processSeedBatch(prisma as any, bucket as any, { batchSize: 1, perRequestDelayMs: 0 })
    const last = updates[updates.length - 1]
    expect(last.data.status).toBe('failed')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

Create `workers/anitabi-mirror/src/seed.ts`:
```ts
import type { PrismaClient } from '@prisma/client'
import { putMirroredImage, type R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

const MAX_ATTEMPTS = 5
const FETCH_TIMEOUT_MS = 15_000

const DEFAULT_USER_AGENT = 'SeichiGoMirror/1.0 (+https://seichigo.com)'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type SeedBatchOptions = { batchSize: number; perRequestDelayMs: number; userAgent?: string }

export async function processSeedBatch(
  prisma: PrismaClient,
  bucket: R2MirrorBucket,
  opts: SeedBatchOptions,
): Promise<{ mirrored: number; failed: number; skipped404: number }> {
  const items = await prisma.mapImageMirrorState.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: opts.batchSize,
  })
  let mirrored = 0,
    failed = 0,
    skipped404 = 0

  for (const item of items) {
    await prisma.mapImageMirrorState.update({
      where: { id: item.id },
      data: { status: 'in_progress', lastAttemptAt: new Date(), attempts: { increment: 1 } },
    })
    try {
      const res = await fetch(item.canonicalUrl, {
        headers: { 'user-agent': opts.userAgent ?? DEFAULT_USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (res.status === 404) {
        await prisma.mapImageMirrorState.update({ where: { id: item.id }, data: { status: 'skipped_404' } })
        skipped404++
        continue
      }
      if (!res.ok) throw new Error(`upstream_${res.status}`)
      const ct = res.headers.get('content-type') || ''
      if (!ct.startsWith('image/')) throw new Error('non_image_response')
      const bytes = await res.arrayBuffer()
      const result = await putMirroredImage(bucket, item.canonicalUrl, bytes, ct, 'cron-seed')
      await prisma.mapImageMirrorState.update({
        where: { id: item.id },
        data: { status: 'mirrored', mirroredAt: new Date(), contentBytes: result.bytesWritten, lastError: null },
      })
      mirrored++
    } catch (err) {
      const isMaxedOut = (item.attempts ?? 0) + 1 >= MAX_ATTEMPTS
      await prisma.mapImageMirrorState.update({
        where: { id: item.id },
        data: {
          status: isMaxedOut ? 'failed' : 'pending',
          lastError: String(err).slice(0, 500),
        },
      })
      if (isMaxedOut) failed++
    }
    if (opts.perRequestDelayMs > 0) await sleep(opts.perRequestDelayMs)
  }
  return { mirrored, failed, skipped404 }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add workers/anitabi-mirror/src/seed.ts workers/anitabi-mirror/src/__tests__/seed.test.ts
git commit -m "feat(mirror): processSeedBatch with retry, 404 skip, attempts cap"
```

---

### Task 3.5: Implement `cronDelta()` (TDD)

**Files:**
- Create: `workers/anitabi-mirror/src/delta.ts`
- Create: `workers/anitabi-mirror/src/__tests__/delta.test.ts`

- [ ] **Step 1: Failing test**

```ts
// workers/anitabi-mirror/src/__tests__/delta.test.ts
import { describe, it, expect, vi } from 'vitest'
import { cronDelta } from '../delta'

describe('cronDelta', () => {
  it('reads watermark, finds new bangumi/points since cursor, upserts pending rows', async () => {
    const cursorAt = new Date('2026-05-02T00:00:00Z')
    const newBangumi = [{ id: 999, cover: 'https://image.anitabi.cn/bangumi/999/cover.jpg' }]
    const newPoints = [{ id: 'pn1', image: 'https://image.anitabi.cn/points/pn1.jpg' }]
    const upserts: any[] = []
    const prisma = {
      mapImageMirrorState: {
        findUnique: vi.fn().mockResolvedValue({ mirroredAt: cursorAt }),
        upsert: vi.fn().mockImplementation((args) => {
          upserts.push(args)
          return Promise.resolve({})
        }),
      },
      anitabiBangumi: { findMany: vi.fn().mockResolvedValue(newBangumi) },
      anitabiPoint: { findMany: vi.fn().mockResolvedValue(newPoints) },
    } as any

    await cronDelta(prisma)

    expect(prisma.anitabiBangumi.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ updatedAt: { gt: cursorAt } }) }),
    )
    // 1 bangumi × 2 variants + 1 point × 3 variants + 1 watermark upsert = 6 upserts
    expect(upserts.length).toBeGreaterThanOrEqual(5)
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

Create `workers/anitabi-mirror/src/delta.ts`:
```ts
import type { PrismaClient } from '@prisma/client'
import { enumerateBangumiCoverVariants, enumeratePointImageVariants } from '@/lib/anitabi/imageMirrorVariants'
import { computeMirrorKey } from '@/lib/anitabi/imageNormalize'

const CURSOR_KEY = { sourceType: '__cursor__', sourceId: 'delta', variant: '__' }

export async function cronDelta(prisma: PrismaClient): Promise<{ enqueued: number }> {
  const cursorRow = await prisma.mapImageMirrorState.findUnique({
    where: { sourceType_sourceId_variant: CURSOR_KEY },
  })
  const cursorAt = cursorRow?.mirroredAt ?? new Date(0)
  const now = new Date()
  let enqueued = 0

  const newBangumi = await prisma.anitabiBangumi.findMany({
    where: { updatedAt: { gt: cursorAt }, mapEnabled: true, cover: { not: null } },
    select: { id: true, cover: true },
  })
  for (const b of newBangumi) {
    for (const v of enumerateBangumiCoverVariants(b.cover)) {
      const key = await computeMirrorKey(v.url, 'image/jpeg')
      await prisma.mapImageMirrorState.upsert({
        where: {
          sourceType_sourceId_variant: { sourceType: 'bangumi-cover', sourceId: String(b.id), variant: v.label },
        },
        create: {
          sourceType: 'bangumi-cover',
          sourceId: String(b.id),
          variant: v.label,
          canonicalUrl: v.url,
          r2Key: key,
          status: 'pending',
        },
        update: { canonicalUrl: v.url, r2Key: key, status: 'pending', attempts: 0, lastError: null },
      })
      enqueued++
    }
  }

  const newPoints = await prisma.anitabiPoint.findMany({
    where: { updatedAt: { gt: cursorAt }, image: { not: null } },
    select: { id: true, image: true },
  })
  for (const p of newPoints) {
    for (const v of enumeratePointImageVariants(p.image)) {
      const key = await computeMirrorKey(v.url, 'image/jpeg')
      await prisma.mapImageMirrorState.upsert({
        where: {
          sourceType_sourceId_variant: { sourceType: 'point-image', sourceId: p.id, variant: v.label },
        },
        create: {
          sourceType: 'point-image',
          sourceId: p.id,
          variant: v.label,
          canonicalUrl: v.url,
          r2Key: key,
          status: 'pending',
        },
        update: { canonicalUrl: v.url, r2Key: key, status: 'pending', attempts: 0, lastError: null },
      })
      enqueued++
    }
  }

  // Update watermark
  await prisma.mapImageMirrorState.upsert({
    where: { sourceType_sourceId_variant: CURSOR_KEY },
    create: { ...CURSOR_KEY, canonicalUrl: 'cursor', r2Key: 'cursor', status: 'mirrored', mirroredAt: now },
    update: { mirroredAt: now },
  })

  return { enqueued }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add workers/anitabi-mirror/src/delta.ts workers/anitabi-mirror/src/__tests__/delta.test.ts
git commit -m "feat(mirror): cronDelta enqueues new bangumi/points via updatedAt watermark"
```

---

### Task 3.6: Implement throttle / circuit breaker (TDD)

**Files:**
- Create: `workers/anitabi-mirror/src/throttle.ts`
- Create: `workers/anitabi-mirror/src/__tests__/throttle.test.ts`

- [ ] **Step 1: Failing test**

```ts
// workers/anitabi-mirror/src/__tests__/throttle.test.ts
import { describe, it, expect, vi } from 'vitest'
import { isThrottled, recordTimeout, clearThrottle } from '../throttle'

const THROTTLE_KEY = { sourceType: '__throttle__', sourceId: 'global', variant: '__' }

describe('throttle', () => {
  it('isThrottled returns false when no throttle row exists', async () => {
    const prisma = {
      mapImageMirrorState: { findUnique: vi.fn().mockResolvedValue(null) },
    } as any
    expect(await isThrottled(prisma)).toBe(false)
  })

  it('isThrottled returns true when throttle row exists and is fresh (<1h)', async () => {
    const prisma = {
      mapImageMirrorState: {
        findUnique: vi.fn().mockResolvedValue({ mirroredAt: new Date(Date.now() - 30 * 60 * 1000) }),
      },
    } as any
    expect(await isThrottled(prisma)).toBe(true)
  })

  it('isThrottled returns false when throttle row exists but is stale (>1h)', async () => {
    const prisma = {
      mapImageMirrorState: {
        findUnique: vi.fn().mockResolvedValue({ mirroredAt: new Date(Date.now() - 2 * 60 * 60 * 1000) }),
      },
    } as any
    expect(await isThrottled(prisma)).toBe(false)
  })

  it('recordTimeout writes throttle row when 10 timeouts in window', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const prisma = {
      mapImageMirrorState: { upsert },
    } as any
    await recordTimeout(prisma, /* recentTimeoutCount */ 10)
    expect(upsert).toHaveBeenCalled()
  })

  it('recordTimeout does NOT write throttle row when below threshold', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const prisma = { mapImageMirrorState: { upsert } } as any
    await recordTimeout(prisma, 5)
    expect(upsert).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

Create `workers/anitabi-mirror/src/throttle.ts`:
```ts
import type { PrismaClient } from '@prisma/client'

const THROTTLE_KEY = { sourceType: '__throttle__', sourceId: 'global', variant: '__' }
const THROTTLE_DURATION_MS = 60 * 60 * 1000
const TIMEOUT_THRESHOLD = 10

export async function isThrottled(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.mapImageMirrorState.findUnique({
    where: { sourceType_sourceId_variant: THROTTLE_KEY },
  })
  if (!row?.mirroredAt) return false
  const ageMs = Date.now() - row.mirroredAt.getTime()
  return ageMs < THROTTLE_DURATION_MS
}

export async function recordTimeout(prisma: PrismaClient, recentTimeoutCount: number): Promise<void> {
  if (recentTimeoutCount < TIMEOUT_THRESHOLD) return
  await prisma.mapImageMirrorState.upsert({
    where: { sourceType_sourceId_variant: THROTTLE_KEY },
    create: { ...THROTTLE_KEY, canonicalUrl: 'throttle', r2Key: 'throttle', status: 'mirrored', mirroredAt: new Date() },
    update: { mirroredAt: new Date() },
  })
}

export async function clearThrottle(prisma: PrismaClient): Promise<void> {
  await prisma.mapImageMirrorState
    .delete({ where: { sourceType_sourceId_variant: THROTTLE_KEY } })
    .catch(() => null)
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add workers/anitabi-mirror/src/throttle.ts workers/anitabi-mirror/src/__tests__/throttle.test.ts
git commit -m "feat(mirror): anitabi-wide circuit breaker via __throttle__ row"
```

---

### Task 3.7: Wire `cronTick()` orchestrator + scheduled handler entry

**Files:**
- Create: `lib/anitabi/mirror/cronTick.ts`
- Move/create shared helper modules under `lib/anitabi/mirror/` as needed: `reclaim.ts`, `bootstrap.ts`, `seed.ts`, `delta.ts`, `throttle.ts`
- Modify: `workers/anitabi-mirror/src/index.ts`
- Create: `tests/anitabi/mirror/cronTick.test.ts`

- [ ] **Step 1: Test for cronTick orchestration**

```ts
// tests/anitabi/mirror/cronTick.test.ts
import { describe, it, expect, vi } from 'vitest'
import { cronTick } from '@/lib/anitabi/mirror/cronTick'

vi.mock('@/lib/anitabi/mirror/reclaim', () => ({ reclaimStale: vi.fn().mockResolvedValue({ count: 0 }) }))
vi.mock('@/lib/anitabi/mirror/bootstrap', () => ({ advanceBootstrap: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/anitabi/mirror/seed', () => ({
  processSeedBatch: vi.fn().mockResolvedValue({ mirrored: 0, failed: 0, skipped404: 0 }),
}))
vi.mock('@/lib/anitabi/mirror/delta', () => ({ cronDelta: vi.fn().mockResolvedValue({ enqueued: 0 }) }))
vi.mock('@/lib/anitabi/mirror/throttle', () => ({ isThrottled: vi.fn().mockResolvedValue(false), recordTimeout: vi.fn() }))

describe('cronTick', () => {
  it('runs reclaim → bootstrap → seed when not throttled', async () => {
    const { reclaimStale } = await import('@/lib/anitabi/mirror/reclaim')
    const { advanceBootstrap } = await import('@/lib/anitabi/mirror/bootstrap')
    const { processSeedBatch } = await import('@/lib/anitabi/mirror/seed')
    const prisma = {
      mapImageMirrorBootstrap: {
        findUnique: vi.fn().mockResolvedValue({ bangumiCompleted: false, pointCompleted: false }),
      },
    } as any
    const bucket = {} as any
    const env = { MAP_IMAGE_MIRROR_CRON_ENABLED: '1' }
    await cronTick({ prisma, bucket, env, source: 'cron' }, 'seed')
    expect(reclaimStale).toHaveBeenCalledWith(prisma)
    expect(advanceBootstrap).toHaveBeenCalledWith(prisma, 2000)
    expect(processSeedBatch).toHaveBeenCalled()
  })

  it('skips seed and bootstrap when throttled', async () => {
    const { isThrottled } = await import('@/lib/anitabi/mirror/throttle')
    ;(isThrottled as any).mockResolvedValueOnce(true)
    const { advanceBootstrap } = await import('@/lib/anitabi/mirror/bootstrap')
    const { processSeedBatch } = await import('@/lib/anitabi/mirror/seed')
    const prisma = {} as any
    const bucket = {} as any
    const env = { MAP_IMAGE_MIRROR_CRON_ENABLED: '1' }
    const result = await cronTick({ prisma, bucket, env, source: 'cron' }, 'seed')
    expect(result).toEqual({ reclaimed: 0, processed: 0, throttled: true })
    expect(advanceBootstrap).not.toHaveBeenCalled()
    expect(processSeedBatch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

Create `lib/anitabi/mirror/cronTick.ts`:
```ts
import type { PrismaClient } from '@prisma/client'
import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'
import { reclaimStale } from '@/lib/anitabi/mirror/reclaim'
import { advanceBootstrap } from '@/lib/anitabi/mirror/bootstrap'
import { processSeedBatch } from '@/lib/anitabi/mirror/seed'
import { cronDelta } from '@/lib/anitabi/mirror/delta'
import { isThrottled } from '@/lib/anitabi/mirror/throttle'

export type CronTickDeps = {
  prisma: PrismaClient
  bucket: R2MirrorBucket
  env: { MAP_IMAGE_MIRROR_CRON_ENABLED?: string }
  source: 'cron' | 'manual'
}
export type CronTickResult = { reclaimed: number; processed: number; throttled: boolean }

export async function cronTick(deps: CronTickDeps, mode: 'seed' | 'delta'): Promise<CronTickResult> {
  const reclaimResult = await reclaimStale(deps.prisma)
  if (await isThrottled(deps.prisma)) {
    return { reclaimed: reclaimResult.count, processed: 0, throttled: true }
  }
  if (mode === 'delta') {
    const deltaResult = await cronDelta(deps.prisma)
    return { reclaimed: reclaimResult.count, processed: deltaResult.enqueued, throttled: false }
  }
  const bs = await deps.prisma.mapImageMirrorBootstrap.findUnique({ where: { id: 1 } })
  if (!bs?.bangumiCompleted || !bs?.pointCompleted) {
    const chunkSize = deps.source === 'manual' ? 5000 : 2000
    await advanceBootstrap(deps.prisma, chunkSize)
  }
  const seedResult = await processSeedBatch(deps.prisma, deps.bucket, { batchSize: 100, perRequestDelayMs: 200 })
  return { reclaimed: reclaimResult.count, processed: seedResult.mirrored, throttled: false }
}
```

Do not import `@/workers/anitabi-mirror/src/*` from `lib/anitabi/mirror/cronTick.ts`. If Tasks 3.2–3.6 have already created helper modules under `workers/anitabi-mirror/src/`, move that logic into the matching `lib/anitabi/mirror/*` modules and leave the worker subtree as entrypoint/config only. The shared `lib` code must typecheck under the app tsconfig, so use the repo-owned `R2MirrorBucket` abstraction instead of raw Cloudflare `R2Bucket`.

Before wiring `cronTick`, migrate any tests/imports produced by Tasks 3.2–3.6 from worker-relative paths to shared paths:

- `workers/anitabi-mirror/src/__tests__/reclaim.test.ts` → `tests/anitabi/mirror/reclaim.test.ts`, importing `@/lib/anitabi/mirror/reclaim`
- `workers/anitabi-mirror/src/__tests__/bootstrap.test.ts` → `tests/anitabi/mirror/bootstrap.test.ts`, importing `@/lib/anitabi/mirror/bootstrap`
- `workers/anitabi-mirror/src/__tests__/seed.test.ts` → `tests/anitabi/mirror/seed.test.ts`, importing `@/lib/anitabi/mirror/seed`
- `workers/anitabi-mirror/src/__tests__/delta.test.ts` → `tests/anitabi/mirror/delta.test.ts`, importing `@/lib/anitabi/mirror/delta`
- `workers/anitabi-mirror/src/__tests__/throttle.test.ts` → `tests/anitabi/mirror/throttle.test.ts`, importing `@/lib/anitabi/mirror/throttle`

If keeping worker-local compatibility files is useful, they must be thin re-export shims only; implementation and tests live under `lib/anitabi/mirror/*` / `tests/anitabi/mirror/*`.

- [ ] **Step 4: Update `src/index.ts` to wire it**

```ts
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client/wasm'
import { Pool } from '@prisma/pg-worker'
import { cronTick, type CronTickDeps } from '@/lib/anitabi/mirror/cronTick'

type Env = {
  MAP_IMAGE_CACHE: R2Bucket
  MAP_IMAGE_MIRROR_CRON_ENABLED: string
  DATABASE_URL: string
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.MAP_IMAGE_MIRROR_CRON_ENABLED !== '1') {
      console.log('[mirror] cron disabled by flag')
      return
    }
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 4,
    })
    const adapter = new PrismaPg(pool)
    const prisma = new PrismaClient({ adapter })
    try {
      const deps: CronTickDeps = {
        prisma,
        bucket: env.MAP_IMAGE_CACHE as unknown as CronTickDeps['bucket'],
        env,
        source: 'cron',
      }
      if (event.cron === '0 * * * *') {
        const result = await cronTick(deps, 'delta')
        console.log(`[mirror] delta tick reclaimed=${result.reclaimed} processed=${result.processed} throttled=${result.throttled}`)
      } else {
        const result = await cronTick(deps, 'seed')
        console.log(`[mirror] seed tick reclaimed=${result.reclaimed} processed=${result.processed} throttled=${result.throttled}`)
      }
    } catch (err) {
      console.error('[mirror] tick failed', err)
    } finally {
      await prisma.$disconnect()
      await pool.end()
    }
  },
}
```

Keep `@prisma/client/wasm` and do **not** add `datasources` here. The main Next.js app can continue to use its existing repo-style adapter configuration on Node, but this raw mirror Worker must use the Workers-compatible `@prisma/pg-worker` transport. `new PrismaPg({ ...plain options... })` is not acceptable for the Worker because it resolves `@prisma/adapter-pg`'s local Node `pg` transport instead of the Workers-safe pool. Keep the mirror pool bounded (`max: 4`) so hourly/5-minute cron overlap does not monopolize shared Postgres connections.

- [ ] **Step 5: Run tests**

```bash
npm test -- --run tests/anitabi/mirror
rg -n "@prisma/pg-worker|new Pool|new PrismaPg\\(pool\\)|datasources|@prisma/client/wasm" workers/anitabi-mirror/src/index.ts
```

Expected: all shared mirror tests PASS, the worker entrypoint imports `@prisma/pg-worker` and `@prisma/client/wasm`, constructs `new Pool(...)` and `new PrismaPg(pool)`, and does not reintroduce `datasources`.

- [ ] **Step 6: Commit**

```bash
git add lib/anitabi/mirror workers/anitabi-mirror/src/index.ts tests/anitabi/mirror
git commit -m "Keep mirror cron orchestration on a shared boundary" \
  -m "The worker entrypoint and admin bootstrap route both rely on cronTick, so the plan moves that orchestrator into lib/anitabi/mirror to avoid importing worker source into the Next.js bundle." \
  -m "Constraint: Next admin routes must not import worker-only modules, and the raw mirror Worker must create PrismaPg from a bounded @prisma/pg-worker Pool rather than adapter-pg's plain-object Node transport" \
  -m "Rejected: Leave cronTick under workers/anitabi-mirror/src | it creates a cross-worker import boundary into the app bundle" \
  -m "Rejected: Construct PrismaPg from plain object options in the Worker | @prisma/adapter-pg resolves the local Node pg transport instead of the Workers-compatible pool" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: npm test -- --run tests/anitabi/mirror; rg -n \"@prisma/pg-worker|new Pool|new PrismaPg\\(pool\\)|datasources|@prisma/client/wasm\" workers/anitabi-mirror/src/index.ts" \
  -m "Not-tested: production worker schedule"
```

---

## Phase 4 — Admin Surfaces

### Task 4.1: Bootstrap admin endpoint

**Files:**
- Create: `app/api/admin/anitabi/image-mirror/bootstrap/route.ts`
- Create: `lib/anitabi/handlers/adminImageMirrorBootstrap.ts`
- Modify: `lib/anitabi/api.ts` (inject node-safe `R2MirrorBucket | null` binding accessor)
- Create: `tests/route/image-mirror-bootstrap.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/route/image-mirror-bootstrap.test.ts
import { describe, it, expect, vi } from 'vitest'
import { POST } from '@/app/api/admin/anitabi/image-mirror/bootstrap/route'

const cronTick = vi.fn().mockResolvedValue({ reclaimed: 0, processed: 1, throttled: false })
const bucket = {} as any
vi.mock('@/lib/anitabi/api', () => ({
  getAnitabiApiDeps: vi.fn().mockResolvedValue({
    prisma: {
      mapImageMirrorBootstrap: {
        findUnique: vi.fn().mockResolvedValue({ bangumiCompleted: false, pointCompleted: false }),
      },
      mapImageMirrorState: {
        groupBy: vi.fn().mockResolvedValue([{ status: 'pending', _count: { _all: 1 } }]),
      },
    },
    getImageMirrorBucket: vi.fn(() => bucket),
  }),
}))
vi.mock('@/lib/auth/session', () => ({ getServerAuthSession: vi.fn().mockResolvedValue({ user: { isAdmin: true } }) }))
vi.mock('@/lib/anitabi/mirror/cronTick', () => ({ cronTick }))

describe('POST /bootstrap', () => {
  it('rejects non-admin', async () => {
    const { getServerAuthSession } = await import('@/lib/auth/session')
    ;(getServerAuthSession as any).mockResolvedValueOnce(null)
    const req = new Request('https://x/api/admin/anitabi/image-mirror/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ mode: 'advance' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('returns progress on advance mode', async () => {
    const req = new Request('https://x/api/admin/anitabi/image-mirror/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ mode: 'advance' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

Extend `lib/anitabi/api.ts` so `AnitabiApiDeps` exposes a node-safe bucket accessor:
```ts
import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

export type AnitabiApiDeps = {
  // ...existing deps...
  getImageMirrorBucket?: () => R2MirrorBucket | null
}
```

If no binding is available, the accessor returns `null` and the handler returns a clear `503` instead of reading raw globals in the route.

Create `lib/anitabi/handlers/adminImageMirrorBootstrap.ts`:
```ts
import { NextResponse } from 'next/server'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { advanceBootstrap } from '@/lib/anitabi/mirror/bootstrap'
import { cronTick } from '@/lib/anitabi/mirror/cronTick'

const FORCE_COMPLETE_BUDGET_MS = 25_000

export async function handleImageMirrorBootstrap(req: Request, deps: AnitabiApiDeps) {
  const bucket = deps.getImageMirrorBucket?.()
  if (!bucket) {
    return NextResponse.json({ error: 'MAP_IMAGE_CACHE binding unavailable' }, { status: 503 })
  }

  let body: { mode?: 'advance' | 'force-complete' } = {}
  try {
    body = await req.json()
  } catch {
    body = { mode: 'advance' }
  }

  const startedAt = Date.now()
  const runDeps = {
    prisma: deps.prisma,
    bucket,
    env: { MAP_IMAGE_MIRROR_CRON_ENABLED: '1' },
    source: 'manual' as const,
  }

  if (body.mode === 'force-complete') {
    while (Date.now() - startedAt < FORCE_COMPLETE_BUDGET_MS) {
      const bs = await deps.prisma.mapImageMirrorBootstrap.findUnique({ where: { id: 1 } })
      if (bs?.bangumiCompleted && bs?.pointCompleted) break
      await advanceBootstrap(deps.prisma, 5000)
    }
  } else {
    await cronTick(runDeps, 'seed')
  }

  const final = await deps.prisma.mapImageMirrorBootstrap.findUnique({ where: { id: 1 } })
  const counts = await deps.prisma.mapImageMirrorState.groupBy({
    by: ['status'],
    _count: { _all: true },
  })
  const totals: Record<string, number> = {}
  for (const c of counts) totals[c.status] = (c._count as any)._all

  return NextResponse.json({
    bootstrap: final,
    totals,
    elapsedMs: Date.now() - startedAt,
    stillNeedsManualPush: !(final?.bangumiCompleted && final?.pointCompleted),
  })
}
```

Create `app/api/admin/anitabi/image-mirror/bootstrap/route.ts` as a thin wrapper:
```ts
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { getServerAuthSession } from '@/lib/auth/session'
import { handleImageMirrorBootstrap } from '@/lib/anitabi/handlers/adminImageMirrorBootstrap'

export async function POST(req: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const deps = await getAnitabiApiDeps()
  return handleImageMirrorBootstrap(req, deps)
}
```

Use the existing inline session-admin guard pattern from other `/admin/...` routes.

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/anitabi/image-mirror/bootstrap/route.ts lib/anitabi/api.ts lib/anitabi/handlers/adminImageMirrorBootstrap.ts tests/route/image-mirror-bootstrap.test.ts
git commit -m "Add a documented admin bootstrap route pattern that matches existing auth flows" \
  -m "The PR3 plan now keeps the bootstrap route thin, uses getServerAuthSession for auth, and delegates mirror orchestration to a handler with an injected R2 mirror bucket." \
  -m "Constraint: Admin routes in this codebase use inline session checks rather than a dedicated helper" \
  -m "Rejected: Introduce a new admin-only guard helper in the plan | it would diverge from existing route patterns" \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Tested: route snippet and test snippet updated to the session-based guard pattern; handler owns bootstrap orchestration and missing bucket response" \
  -m "Not-tested: generated implementation outside the plan document"
```

---

### Task 4.2: Status admin endpoint

**Files:**
- Create: `app/api/admin/anitabi/image-mirror/status/route.ts`
- Create: `tests/route/image-mirror-status.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/route/image-mirror-status.test.ts
import { describe, it, expect, vi } from 'vitest'
import { GET } from '@/app/api/admin/anitabi/image-mirror/status/route'

vi.mock('@/lib/auth/session', () => ({ getServerAuthSession: vi.fn().mockResolvedValue({ user: { isAdmin: true } }) }))
vi.mock('@/lib/anitabi/api', () => ({
  getAnitabiApiDeps: vi.fn().mockResolvedValue({
    prisma: {
      mapImageMirrorState: {
        groupBy: vi.fn().mockResolvedValue([
          { status: 'mirrored', _count: { _all: 100 } },
          { status: 'pending', _count: { _all: 50 } },
        ]),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(150),
      },
      mapImageMirrorBootstrap: {
        findUnique: vi.fn().mockResolvedValue({ bangumiCompleted: true, pointCompleted: false, totalEnumerated: 150 }),
      },
    },
  }),
}))

describe('GET /status', () => {
  it('returns aggregated totals', async () => {
    const req = new Request('https://x/api/admin/anitabi/image-mirror/status')
    const res = await GET(req)
    const body = await res.json()
    expect(body.totals.mirrored).toBe(100)
    expect(body.totals.pending).toBe(50)
    expect(body.totals.all).toBe(150)
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

Create `app/api/admin/anitabi/image-mirror/status/route.ts`:
```ts
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { getServerAuthSession } from '@/lib/auth/session'

export async function GET(req: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const deps = await getAnitabiApiDeps()
  const counts = await deps.prisma.mapImageMirrorState.groupBy({
    by: ['status'],
    _count: { _all: true },
  })
  const totals: any = { all: 0, pending: 0, in_progress: 0, mirrored: 0, failed: 0, skipped_404: 0 }
  for (const c of counts) {
    const n = (c._count as any)._all
    totals[c.status] = n
    totals.all += n
  }
  const bootstrap = await deps.prisma.mapImageMirrorBootstrap.findUnique({ where: { id: 1 } })
  const recentFailures = await deps.prisma.mapImageMirrorState.findMany({
    where: { status: 'failed' },
    orderBy: { lastAttemptAt: 'desc' },
    take: 10,
    select: { canonicalUrl: true, lastError: true, attempts: true, lastAttemptAt: true },
  })
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const mirroredLast1h = await deps.prisma.mapImageMirrorState.count({
    where: { status: 'mirrored', mirroredAt: { gt: oneHourAgo } },
  })
  const mirroredLast24h = await deps.prisma.mapImageMirrorState.count({
    where: { status: 'mirrored', mirroredAt: { gt: oneDayAgo } },
  })
  const ratePerSec = mirroredLast1h / 3600
  const remaining = totals.pending + totals.in_progress
  const estimatedRemainingHours = ratePerSec > 0 ? remaining / ratePerSec / 3600 : null

  return NextResponse.json({
    totals,
    bootstrap,
    recentFailures,
    rates: { mirroredLast1h, mirroredLast24h, ratePerSec, estimatedRemainingHours },
  })
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/anitabi/image-mirror/status/route.ts tests/route/image-mirror-status.test.ts
git commit -m "Add a documented admin status route pattern that matches existing auth flows" \
  -m "The PR3 plan now uses getServerAuthSession for the status endpoint and its test snippet so the implementation guidance matches current admin-route conventions." \
  -m "Constraint: Admin routes in this codebase use inline session checks rather than a dedicated helper" \
  -m "Rejected: Introduce a new admin-only guard helper in the plan | it would diverge from existing route patterns" \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Tested: route snippet and test snippet updated to the session-based guard pattern" \
  -m "Not-tested: generated implementation outside the plan document"
```

---

### Task 4.3: Dashboard panel UI extension

**Files:**
- Modify: `app/(authed)/admin/ops/map-image-diagnostics/ui.tsx`
- Create: `app/(authed)/admin/ops/map-image-diagnostics/MirrorProgressPanel.tsx`

- [ ] **Step 1: Read the existing UI file**

```bash
sed -n '1,60p' /Users/mac/Desktop/seichigo/app/\(authed\)/admin/ops/map-image-diagnostics/ui.tsx
```

Identify how panels are currently composed.

- [ ] **Step 2: Create MirrorProgressPanel component**

Create `app/(authed)/admin/ops/map-image-diagnostics/MirrorProgressPanel.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'

type Status = {
  totals: { all: number; pending: number; in_progress: number; mirrored: number; failed: number; skipped_404: number }
  bootstrap: { bangumiCompleted: boolean; pointCompleted: boolean; totalEnumerated: number; bangumiCursor: number | null; pointCursor: string | null } | null
  recentFailures: Array<{ canonicalUrl: string; lastError: string | null; attempts: number; lastAttemptAt: string | null }>
  rates: { mirroredLast1h: number; mirroredLast24h: number; ratePerSec: number; estimatedRemainingHours: number | null }
}

export function MirrorProgressPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/admin/anitabi/image-mirror/status', { credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setStatus(data)
      } catch (e: any) {
        if (!cancelled) setError(String(e))
      }
    }
    load()
    const id = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  async function bootstrap(mode: 'advance' | 'force-complete') {
    try {
      await fetch('/api/admin/anitabi/image-mirror/bootstrap', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
    } catch (e) {
      setError(String(e))
    }
  }

  if (error) return <div className="rounded border border-red-300 p-3 text-sm">Error: {error}</div>
  if (!status) return <div className="rounded border border-gray-300 p-3 text-sm">Loading mirror status…</div>

  const { totals, bootstrap: bs, recentFailures, rates } = status
  const mirroredPct = totals.all > 0 ? (totals.mirrored / totals.all) * 100 : 0

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-base font-semibold">Mirror Backfill Progress</h3>
      <div className="mb-3 text-sm">
        <div>Total: <strong>{totals.all.toLocaleString()}</strong></div>
        <div className="my-1 h-2 w-full overflow-hidden rounded bg-gray-100">
          <div className="h-2 bg-emerald-500" style={{ width: `${mirroredPct.toFixed(1)}%` }} />
        </div>
        <div className="text-xs text-gray-600">
          mirrored {totals.mirrored.toLocaleString()} ({mirroredPct.toFixed(1)}%) ·
          pending {totals.pending.toLocaleString()} ·
          in_progress {totals.in_progress} ·
          failed {totals.failed} ·
          skipped_404 {totals.skipped_404}
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-gray-700">
        <div>Rate (1h): {rates.ratePerSec.toFixed(2)}/s</div>
        <div>ETA: {rates.estimatedRemainingHours == null ? '—' : `${rates.estimatedRemainingHours.toFixed(1)} h`}</div>
        <div>Last 24h mirrored: {rates.mirroredLast24h.toLocaleString()}</div>
      </div>
      {bs && (
        <div className="mb-3 rounded bg-gray-50 p-2 text-xs">
          <div>Bootstrap bangumi: {bs.bangumiCompleted ? '✓ completed' : `cursor=${bs.bangumiCursor ?? '—'}`}</div>
          <div>Bootstrap points: {bs.pointCompleted ? '✓ completed' : `cursor=${bs.pointCursor ?? '—'}`}</div>
          <div>Total enumerated: {bs.totalEnumerated.toLocaleString()}</div>
        </div>
      )}
      <div className="mb-3 flex gap-2">
        <button className="rounded bg-blue-600 px-3 py-1 text-xs text-white" onClick={() => bootstrap('advance')}>
          Advance bootstrap +5000
        </button>
        <button className="rounded bg-amber-600 px-3 py-1 text-xs text-white" onClick={() => bootstrap('force-complete')}>
          Force complete
        </button>
      </div>
      {recentFailures.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-700">Recent failures ({recentFailures.length})</summary>
          <ul className="mt-1 list-disc pl-5">
            {recentFailures.map((f, i) => (
              <li key={i} className="truncate">
                attempts={f.attempts} · {f.lastError ?? 'no error message'} · {f.canonicalUrl}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Mount the panel**

Edit `app/(authed)/admin/ops/map-image-diagnostics/ui.tsx`. Import and place at the top of the existing layout:
```tsx
import { MirrorProgressPanel } from './MirrorProgressPanel'
// ...
<MirrorProgressPanel />
```

- [ ] **Step 4: Visual smoke test**

```bash
cd /Users/mac/Desktop/seichigo
npm run dev
```

Open `http://localhost:3000/admin/ops/map-image-diagnostics`. Verify the panel renders (data will be empty pre-deploy; that's expected). Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add app/\(authed\)/admin/ops/map-image-diagnostics/MirrorProgressPanel.tsx 'app/(authed)/admin/ops/map-image-diagnostics/ui.tsx'
git commit -m "feat(admin): mirror progress panel with bootstrap controls"
```

---

### Task 4.4: CLI status snapshot script

**Files:**
- Create: `scripts/mirror-status.sh`

- [ ] **Step 1: Write the script**

Create `scripts/mirror-status.sh`:
```bash
#!/usr/bin/env bash
# Quick mirror status snapshot. Requires ADMIN_COOKIE env var with logged-in admin session cookie.
set -euo pipefail

if [[ -z "${ADMIN_COOKIE:-}" ]]; then
  echo "ADMIN_COOKIE env var required" >&2
  exit 1
fi

BASE_URL="${BASE_URL:-https://www.seichigo.com}"

curl -sS -b "$ADMIN_COOKIE" "$BASE_URL/api/admin/anitabi/image-mirror/status" \
  | jq -r '
    .totals as $t |
    .bootstrap as $b |
    .rates as $r |
    "mirrored=\($t.mirrored)/\($t.all)  pending=\($t.pending)  failed=\($t.failed)  skipped_404=\($t.skipped_404)\n" +
    "bootstrap.bangumi=\($b.bangumiCompleted)  bootstrap.point=\($b.pointCompleted)\n" +
    "rate(1h)=\($r.ratePerSec | tostring | .[0:5])/s  ETA=\($r.estimatedRemainingHours)h"
  '
```

- [ ] **Step 2: Make executable + smoke**

```bash
chmod +x scripts/mirror-status.sh
ADMIN_COOKIE='ignored' BASE_URL='http://localhost:3000' ./scripts/mirror-status.sh || true
```

Will fail without a real cookie; just verify the script doesn't have syntax errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/mirror-status.sh
git commit -m "feat(scripts): mirror-status.sh CLI snapshot"
```

---

## Phase 5 — Sync Integration & UI Attribution

### Task 5.1: Sync diff hook — `reconcileMirrorAfterDiff()` (TDD)

**Files:**
- Create: `lib/anitabi/sync/mirrorReconcile.ts`
- Modify: `lib/anitabi/sync/diff.ts`
- Create: `tests/anitabi/mirrorReconcile.test.ts`

- [ ] **Step 1: Read current diff.ts to find the right hook point**

```bash
sed -n '1,80p' /Users/mac/Desktop/seichigo/lib/anitabi/sync/diff.ts
```

Identify where the diff completes (where it returns the diff result).

- [ ] **Step 2: Failing test**

Create `tests/anitabi/mirrorReconcile.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { reconcileMirrorAfterDiff } from '@/lib/anitabi/sync/mirrorReconcile'

describe('reconcileMirrorAfterDiff', () => {
  it('upserts new variants for changed bangumi cover URLs', async () => {
    const upserts: any[] = []
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const prisma = {
      mapImageMirrorState: {
        upsert: vi.fn().mockImplementation((args) => {
          upserts.push(args)
          return Promise.resolve({})
        }),
        updateMany,
      },
    } as any
    await reconcileMirrorAfterDiff(prisma, {
      bangumiChanges: [
        {
          id: 1,
          field: 'cover',
          oldValue: 'https://image.anitabi.cn/bangumi/1/old.jpg',
          newValue: 'https://image.anitabi.cn/bangumi/1/new.jpg',
        },
      ],
      pointChanges: [],
    })
    expect(upserts.length).toBeGreaterThanOrEqual(2) // 2 cover variants
    expect(updateMany).toHaveBeenCalled() // resets old rows
  })

  it('skips changes where field !== cover/image', async () => {
    const upserts: any[] = []
    const prisma = {
      mapImageMirrorState: {
        upsert: vi.fn().mockImplementation((args) => upserts.push(args)),
        updateMany: vi.fn(),
      },
    } as any
    await reconcileMirrorAfterDiff(prisma, {
      bangumiChanges: [{ id: 1, field: 'titleZh', oldValue: 'a', newValue: 'b' }],
      pointChanges: [],
    })
    expect(upserts).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run — expect fail**

- [ ] **Step 4: Implement**

Create `lib/anitabi/sync/mirrorReconcile.ts`:
```ts
import type { PrismaClient } from '@prisma/client'
import { enumerateBangumiCoverVariants, enumeratePointImageVariants } from '@/lib/anitabi/imageMirrorVariants'
import { computeMirrorKey } from '@/lib/anitabi/imageNormalize'

type FieldChange<T> = { id: T; field: string; oldValue: string | null; newValue: string | null }
export type SyncDiffSummary = {
  bangumiChanges: FieldChange<number>[]
  pointChanges: FieldChange<string>[]
}

export async function reconcileMirrorAfterDiff(
  prisma: PrismaClient,
  diff: SyncDiffSummary,
): Promise<void> {
  for (const change of diff.bangumiChanges) {
    if (change.field !== 'cover' || !change.newValue || change.oldValue === change.newValue) continue
    await prisma.mapImageMirrorState.updateMany({
      where: { sourceType: 'bangumi-cover', sourceId: String(change.id) },
      data: { status: 'pending', attempts: 0, lastError: null, mirroredAt: null },
    })
    for (const v of enumerateBangumiCoverVariants(change.newValue)) {
      const key = await computeMirrorKey(v.url, 'image/jpeg')
      await prisma.mapImageMirrorState.upsert({
        where: {
          sourceType_sourceId_variant: {
            sourceType: 'bangumi-cover',
            sourceId: String(change.id),
            variant: v.label,
          },
        },
        create: {
          sourceType: 'bangumi-cover',
          sourceId: String(change.id),
          variant: v.label,
          canonicalUrl: v.url,
          r2Key: key,
          status: 'pending',
        },
        update: { canonicalUrl: v.url, r2Key: key, status: 'pending', attempts: 0, lastError: null },
      })
    }
  }
  for (const change of diff.pointChanges) {
    if (change.field !== 'image' || !change.newValue || change.oldValue === change.newValue) continue
    await prisma.mapImageMirrorState.updateMany({
      where: { sourceType: 'point-image', sourceId: change.id },
      data: { status: 'pending', attempts: 0, lastError: null, mirroredAt: null },
    })
    for (const v of enumeratePointImageVariants(change.newValue)) {
      const key = await computeMirrorKey(v.url, 'image/jpeg')
      await prisma.mapImageMirrorState.upsert({
        where: {
          sourceType_sourceId_variant: {
            sourceType: 'point-image',
            sourceId: change.id,
            variant: v.label,
          },
        },
        create: {
          sourceType: 'point-image',
          sourceId: change.id,
          variant: v.label,
          canonicalUrl: v.url,
          r2Key: key,
          status: 'pending',
        },
        update: { canonicalUrl: v.url, r2Key: key, status: 'pending', attempts: 0, lastError: null },
      })
    }
  }
}
```

- [ ] **Step 5: Wire into `lib/anitabi/sync/diff.ts`**

Locate the function that emits the diff summary at the end of the sync pipeline. Add a call to `reconcileMirrorAfterDiff(prisma, summary)` immediately after the existing diff side effects, behind a flag:
```ts
if (process.env.MAP_IMAGE_MIRROR_RECONCILE_ENABLED === '1') {
  try {
    await reconcileMirrorAfterDiff(prisma, summary)
  } catch (err) {
    console.warn('[sync] mirror reconcile failed', err)
  }
}
```

This decouples sync stability from the new code: if reconcile breaks, sync still works.

- [ ] **Step 6: Run tests**

```bash
npm test -- --run tests/anitabi/mirrorReconcile.test.ts tests/anitabi/diff.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add lib/anitabi/sync/mirrorReconcile.ts lib/anitabi/sync/diff.ts tests/anitabi/mirrorReconcile.test.ts
git commit -m "feat(sync): reconcileMirrorAfterDiff resets mirror rows on URL change"
```

---

### Task 5.2: UI attribution audit

**Files:**
- Create: `docs/superpowers/research/2026-05-XX-anitabi-attribution-audit.md`

- [ ] **Step 1: Grep for anitabi image rendering surfaces**

Run:
```bash
cd /Users/mac/Desktop/seichigo
grep -rln 'image.anitabi.cn\|toMapDisplayImageUrl\|getMapDisplayImageCandidates\|cover\|originLink' \
  app components features lib \
  | grep -v '\.test\.' \
  | sort -u
```

For each file, open and check if:
1. It renders an anitabi image AND
2. It does NOT already display a "via anitabi" link or `originLink`

- [ ] **Step 2: Write the audit doc**

Create `docs/superpowers/research/2026-05-XX-anitabi-attribution-audit.md`:
```markdown
# Anitabi Attribution Audit (PR3 §6)

## Surfaces displaying anitabi images
| File | Surface | Already attributes? | Action |
|---|---|---|---|
| `<file:lines>` | Point detail drawer | YES (originLink) | none |
| `<file:lines>` | PointCard | NO | add `via anitabi` micro-link in Task 5.3 |
| `<file:lines>` | WindowExcerpt grid | NO | same |
| `<file:lines>` | Bangumi cover hero | <YES/NO> | <action> |
| ... | ... | ... | ... |
```

Fill in actual file paths and line numbers from the grep.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/research/
git commit -m "audit(map): UI attribution coverage for PR3 §6"
```

---

### Task 5.3: Add `via anitabi` micro-link to identified surfaces

**Files:**
- Modify: each UI file flagged by Task 5.2 audit
- Create: `components/anitabi/AttributionLink.tsx`
- Modify: `lib/anitabi/i18n/...` (add new keys)

- [ ] **Step 1: Create reusable AttributionLink component**

Create `components/anitabi/AttributionLink.tsx`:
```tsx
'use client'

type Props = {
  href: string
  className?: string
  label?: string
}

export function AnitabiAttributionLink({ href, className, label }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-[0.75em] text-gray-500 opacity-70 hover:opacity-100 hover:underline ${className ?? ''}`}
      title={href}
    >
      {label ?? 'via anitabi.cn'}
    </a>
  )
}
```

- [ ] **Step 2: Add i18n keys**

Locate the project's i18n catalog files (search for `image.attribution` or `img.attribution` or any existing image-related i18n keys). Add:
```
image.attribution.viaAnitabi: "via anitabi.cn"           // en
image.attribution.viaAnitabi: "图片来源：anitabi.cn"      // zh
image.attribution.viaAnitabi: "出典: anitabi.cn"         // ja (if locale exists)
```

- [ ] **Step 3: Insert AttributionLink in each flagged surface**

For each file in the audit doc with action "add `via anitabi`", import and render the component near the image. Example for a `PointCard.tsx`:
```tsx
import { AnitabiAttributionLink } from '@/components/anitabi/AttributionLink'

// inside the card layout, near the image:
<div className="absolute bottom-1 right-1">
  <AnitabiAttributionLink href={`https://anitabi.cn/bangumi/${bangumiId}`} />
</div>
```

- [ ] **Step 4: Visual smoke test**

```bash
npm run dev
```

Open the map; verify "via anitabi.cn" micro-link appears on each previously-unattributed surface. Hover shows full URL.

- [ ] **Step 5: Run tests**

```bash
npm run typecheck
npm test
```

- [ ] **Step 6: Commit**

```bash
git add components/anitabi/AttributionLink.tsx <each modified UI file> <i18n files>
git commit -m "feat(ui): add via-anitabi micro-link on map cover/point surfaces (D5-γ)"
```

---

## Phase 6 — Documentation

### Task 6.1: Production runbook

**Files:**
- Create: `docs/runbooks/anitabi-r2-mirror.md`

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/anitabi-r2-mirror.md`. Reuse the prose from spec §8 verbatim (rollout timeline, flag matrix, rollback playbook, emergency kill switches), and add operational tips at the bottom (how to check dashboard, how to run mirror-status.sh, who to alert).

- [ ] **Step 2: Commit**

```bash
mkdir -p docs/runbooks
git add docs/runbooks/anitabi-r2-mirror.md
git commit -m "docs(runbook): production runbook for anitabi R2 mirror"
```

---

## Phase 7 — Deploy & Rollout

### Task 7.1: Pre-deploy housekeeping + predeploy-guard

**Files:**
- No file changes; environmental.

- [ ] **Step 1: Audit worktrees**

```bash
# From any seichigo path
seichigo-worktree-audit
```

Confirm no stale dirty worktrees.

- [ ] **Step 2: Run housekeeping if needed**

```bash
# Only if uncommitted work exists in this worktree
seichigo-housekeeping
```

- [ ] **Step 3: Run predeploy-guard**

```bash
seichigo-predeploy-guard
```

Address any violations (un-pushed commits, stale lockfile, etc.) before proceeding.

---

### Task 7.2: Deploy DB migration

- [ ] **Step 1: Run prod migration**

```bash
cd /Users/mac/Desktop/seichigo
npm run db:migrate
```

Expected: applies the `add_map_image_mirror_state` migration successfully.

- [ ] **Step 2: Verify tables exist in prod**

Connect to prod DB and:
```sql
\dt "MapImageMirror*"
```

Expected: `MapImageMirrorState` and `MapImageMirrorBootstrap`.

- [ ] **Step 3: Tag the migration deploy**

```bash
git tag -a "deploy/$(date -u +%Y-%m-%dT%H-%M-%SZ)-pr3-db" -m "PR3 DB migration"
git push --tags
```

---

### Task 7.3: Deploy mirror worker (`MIRROR_CRON=0`)

- [ ] **Step 1: Set the mirror worker `DATABASE_URL` secret**

```bash
cd /Users/mac/Desktop/seichigo/workers/anitabi-mirror
wrangler secret put DATABASE_URL
```

Use the production Postgres URL that already contains the PR3 migration. This secret must exist before the first deploy so the later activation path already has its DB credential and the rollout does not introduce a missing-secret gap when cron is enabled.

- [ ] **Step 2: Verify the secret is present**

```bash
cd /Users/mac/Desktop/seichigo/workers/anitabi-mirror
wrangler secret list | rg DATABASE_URL
```

Expected: `DATABASE_URL` is listed for `seichigo-anitabi-mirror`.

- [ ] **Step 3: Deploy via the build-backed script**

```bash
cd /Users/mac/Desktop/seichigo/workers/anitabi-mirror
npm run deploy
```

Expected: deployment succeeds. This validates packaging, deploy wiring, and deployed config while `MAP_IMAGE_MIRROR_CRON_ENABLED=0`; because Task 3.7 returns before creating `Pool`/`Prisma` when cron is disabled, this deploy does not exercise DB boot until Task 7.6 enables cron or a future explicit probe is added.

- [ ] **Step 4: Verify deployment**

```bash
cd /Users/mac/Desktop/seichigo/workers/anitabi-mirror
wrangler deployments list 2>&1 | head
```

- [ ] **Step 5: Tag**

```bash
cd /Users/mac/Desktop/seichigo
seichigo-deploy-ledger  # or manual tag if skill not available
```

---

### Task 7.4: Deploy main worker (R2 flags = 0)

- [ ] **Step 1: Run predeploy-guard again**

```bash
seichigo-predeploy-guard
```

- [ ] **Step 2: Deploy**

```bash
cd /Users/mac/Desktop/seichigo
npm run cf:deploy
```

- [ ] **Step 3: Smoke verify**

Browser: load https://www.seichigo.com/map. Confirm images still load (R2 paths inactive, behavior unchanged from PR1.55).

- [ ] **Step 4: Tag**

```bash
seichigo-deploy-ledger
```

---

### Task 7.5: Activation T+1h — flip `R2_WRITE=1`

- [ ] **Step 1: Update wrangler.jsonc**

Edit `wrangler.jsonc`:
```jsonc
"NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED": "1",
```

- [ ] **Step 2: Redeploy main worker**

```bash
npm run cf:deploy
```

- [ ] **Step 3: Verify lazy writes**

After 5-10 minutes of normal traffic, list R2 contents:
```bash
wrangler r2 object list seichigo-anitabi-images --limit 20
```

Expected: a handful of objects with `mirrorSource=lazy` in metadata.

- [ ] **Step 4: Commit + tag**

```bash
git add wrangler.jsonc
git commit -m "Activate lazy R2 writes after the dormant PR3 deploy proves stable" \
  -m "Constraint: R2 reads remain disabled during the first activation step" \
  -m "Rejected: Enable read + write together | would blur whether lazy mirroring works before cron backfill starts" \
  -m "Confidence: medium" \
  -m "Scope-risk: narrow" \
  -m "Tested: npm run cf:deploy; wrangler r2 object list seichigo-anitabi-images --limit 20" \
  -m "Not-tested: sustained production traffic beyond the first observation window"
seichigo-deploy-ledger
```

---

### Task 7.6: Activation T+2h — flip `MIRROR_CRON=1`

- [ ] **Step 1: Update mirror worker config**

Edit `workers/anitabi-mirror/wrangler.jsonc`:
```jsonc
"MAP_IMAGE_MIRROR_CRON_ENABLED": "1",
```

- [ ] **Step 2: Redeploy mirror worker**

```bash
cd workers/anitabi-mirror && npm run deploy
```

- [ ] **Step 3: Watch cron logs**

```bash
wrangler tail seichigo-anitabi-mirror
```

After ~5 minutes, expect a `[mirror] tick` log line.

- [ ] **Step 4: Commit + tag**

```bash
cd /Users/mac/Desktop/seichigo
git add workers/anitabi-mirror/wrangler.jsonc
git commit -m "Start cron backfill only after the dormant mirror deploy is verified" \
  -m "Constraint: DATABASE_URL secret must already exist for the mirror worker" \
  -m "Rejected: Enable cron on the first mirror deploy | packaging and secret issues would be harder to separate from cron behavior" \
  -m "Confidence: medium" \
  -m "Scope-risk: narrow" \
  -m "Tested: cd workers/anitabi-mirror && npm run deploy; wrangler tail seichigo-anitabi-mirror" \
  -m "Not-tested: multi-hour steady-state cron throughput"
seichigo-deploy-ledger
```

---

### Task 7.7: Optional — manual force-complete bootstrap

- [ ] **Step 1: Hit the admin endpoint**

```bash
ADMIN_COOKIE='<paste>' \
curl -X POST -b "$ADMIN_COOKIE" \
  https://www.seichigo.com/api/admin/anitabi/image-mirror/bootstrap \
  -H 'content-type: application/json' \
  -d '{"mode":"force-complete"}'
```

Repeat until response shows `bootstrap.bangumiCompleted=true && bootstrap.pointCompleted=true`.

- [ ] **Step 2: Verify on dashboard**

Open `https://www.seichigo.com/admin/ops/map-image-diagnostics`. Bootstrap section shows both completed.

---

### Task 7.8: Observation window (24-48h)

- [ ] **Step 1: Daily snapshot via CLI**

```bash
ADMIN_COOKIE='<paste>' ./scripts/mirror-status.sh
```

Capture output. Compare day-over-day: `mirrored` count must increase substantially.

- [ ] **Step 2: Watch dashboard for failures**

Check the "Recent failures" expansion in the dashboard panel. If a single error class dominates (e.g., all timeouts), investigate.

- [ ] **Step 3: Watch cron health**

```bash
wrangler tail seichigo-anitabi-mirror | grep '\[mirror\] tick'
```

Confirm ticks fire every ~5 minutes, batches process ~50-150 each, fail count low.

---

### Task 7.9: Activation T+5d — flip `R2_READ=1`

Gate: dashboard shows mirrored ≥ 95%.

- [ ] **Step 1: Update wrangler.jsonc**

```jsonc
"NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED": "1",
```

- [ ] **Step 2: Redeploy main worker**

```bash
npm run cf:deploy
```

- [ ] **Step 3: Verify R2 hits in production**

Open browser DevTools on https://www.seichigo.com/map. Inspect a cover image response. Expect `X-Seichigo-Image-Source: r2-primary` and `X-Original-Source: https://image.anitabi.cn/...`.

- [ ] **Step 4: Verify diag dashboard**

Pull a recent session via the existing diag tool. Confirm `image_cache_state: cache_hit_r2_primary` events dominate.

- [ ] **Step 5: Commit + tag**

```bash
git add wrangler.jsonc
git commit -m "deploy(map): activate R2_READ_ENABLED — PR3 fully on"
seichigo-deploy-ledger
```

---

### Task 7.10: Acceptance check (T+7d)

- [ ] **Step 1: Pull mirror status**

```bash
./scripts/mirror-status.sh
```

Verify: `mirrored / all ≥ 0.95`.

- [ ] **Step 2: Pull diag aggregates**

In the admin diag dashboard, look at the past 24h:
- `image_cache_state: cache_hit_r2_primary` ≥ 80% of total terminal events.
- `proxy_fetch_terminal: timeout` count vs. 7-day-prior baseline: must be down ≥ 70%.

- [ ] **Step 3: Document acceptance**

Append to the runbook:
```markdown
## PR3 acceptance — <date>
| Metric | Target | Actual |
|---|---|---|
| Mirror progress | ≥ 95% | <X>% |
| cache_hit_r2_*  | ≥ 80% | <Y>% |
| Timeout rate vs baseline | down ≥ 70% | <Z>% |
| anitabi complaints | 0 | <count> |

Verdict: <PASS / DEGRADED / FAIL with rollback action>
```

- [ ] **Step 4: Commit acceptance record**

```bash
git add docs/runbooks/anitabi-r2-mirror.md
git commit -m "docs(runbook): record PR3 7-day acceptance results"
```

---

## Self-Review Notes

Spec coverage check (each spec section → task):

- §1 Architecture → Tasks 2.1, 3.1, 7.3, 7.4
- §2 R2 key scheme → Tasks 1.2, 1.4
- §3 Read path → Tasks 2.2, 2.4, 2.5, 2.6
- §4 Write path → Tasks 1.1, 1.3, 1.4, 2.3, 3.4
- §5 Resume + monitoring → Tasks 1.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4
- §6 Compliance + D0 → Tasks 0.1, 5.2, 5.3
- §7 TTL/refresh → Tasks 0.3, 5.1
- §8 Deploy + rollback → Tasks 0.2, 6.1, 7.1–7.10
- §9 Failure modes → covered across read/write/cron tests
- §10 Testing → integrated TDD per task
- §11 Out of scope → no tasks (correct: nothing to do)

All sections covered.

Type consistency check: `MirrorVariant`, `R2MirrorBucket`, `PutResult`, `MirrorSource` use consistent naming throughout. `cronTick(deps, mode)` with `CronTickDeps` / `CronTickResult` matches in Task 3.7 / 4.1 and keeps the Next.js admin route on the shared `lib/anitabi/mirror` boundary. `reconcileMirrorAfterDiff(prisma, diff)` matches Task 5.1 callsite. ✓

No placeholder phrases (TBD / TODO / "implement later") in plan steps.

Verification spot-check:

```bash
grep -n 'Verdict →'" Action" docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md
```

Expected: 3 matches (Tasks 0.2, 0.3, and 0.4 only).

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-03-map-image-pr3-r2-mirror.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach?**
