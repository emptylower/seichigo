# 非作品点位地点库 + 图片回显落库 实施计划

> **For agentic workers:** 按任务顺序执行；每个任务先写失败测试，再实现，再跑测试。步骤用 `- [ ]` 跟踪。
> 设计文档：`docs/superpowers/specs/2026-09-02-plan-agent-external-place-store-design.md`（必读）。

**Goal:** daymap 里每个 Google 能解析到的非作品停留点都有真实坐标与图片；首次解析回显并落库（Postgres 元数据 + R2 照片镜像），之后从库里取。

**Architecture:** 新增 `ExternalPlace`/`ExternalPlaceQuery` 表与 `ExternalPlaceStore` 接口；`createPlaceResolver` 走"内存 → 库 → Google"阶梯并在解析后触发后台照片镜像；`/api/google/place-photo` 支持按 `placeId` 寻址（R2 read-through，引用过期自动刷新）；`save_plan_days` 在校验前对 lodging/meal/attraction/无 pointId 的 point 条目自动补齐 place；提示词要求所有具体停留点走 `resolve_place`；前端把 Google 代理 URL 当代理类处理（长超时 + 重试）。

**Tech Stack:** Next.js 15 route handlers（nodejs runtime，OpenNext on Cloudflare）、Prisma 6 + Postgres（Neon）、R2（`lib/anitabi/r2Mirror.ts`）、Vitest（`tests/**/*.test.ts` node，`tests/**/*.test.tsx` jsdom）。

**约束（全局）**
- 绝不把 Google API key 写进任何返回给模型/前端/落库/R2 元数据的字段或日志。
- 不改 `lib/anitabi/imageProxy.ts` 的候选阶梯，不引入第二套图片 URL 策略。
- 存量 `payload.media.displayUrl = /api/google/place-photo?ref=...` 必须继续可用。
- 不执行 `prisma migrate deploy` 到生产库；只创建迁移文件并在开发库（`.env`）执行 `prisma migrate dev`。
- 不要提交（commit）；由人工整理提交。
- 完成后运行：`npx vitest run tests/googlePlaces tests/planAgent tests/plan tests/map` 与 `npx tsc --noEmit`。

---

## A. 后端（glm-5.3）

### Task A1: Prisma 模型与迁移

**Files:**
- Modify: `prisma/schema.prisma`（在 `model TripPlanMessage` 之后追加）
- Create: `prisma/migrations/20260902000000_add_external_place/migration.sql`

- [ ] **Step 1: 追加模型**（内容见设计文档 §4，逐字使用）
- [ ] **Step 2: 手写迁移 SQL**（风格对齐 `prisma/migrations/20260831000000_add_trip_plan/migration.sql`）

```sql
-- CreateTable
CREATE TABLE "public"."ExternalPlace" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "placeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "mapsUri" TEXT NOT NULL,
    "photoReference" TEXT,
    "photoAttribution" TEXT,
    "photoMirrorKey" TEXT,
    "photoMirrorStatus" TEXT NOT NULL DEFAULT 'none',
    "photoMirroredAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalPlace_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "public"."ExternalPlaceQuery" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "normalizedQuery" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExternalPlaceQuery_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "ExternalPlace_provider_placeId_key" ON "public"."ExternalPlace"("provider", "placeId");
CREATE UNIQUE INDEX "ExternalPlaceQuery_provider_normalizedQuery_key" ON "public"."ExternalPlaceQuery"("provider", "normalizedQuery");
CREATE INDEX "ExternalPlaceQuery_provider_placeId_idx" ON "public"."ExternalPlaceQuery"("provider", "placeId");
-- AddForeignKey
ALTER TABLE "public"."ExternalPlaceQuery" ADD CONSTRAINT "ExternalPlaceQuery_provider_placeId_fkey" FOREIGN KEY ("provider", "placeId") REFERENCES "public"."ExternalPlace"("provider", "placeId") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3:** `npx prisma migrate dev --name add_external_place`（连 `.env` 开发库；若 Prisma 生成的 SQL 与手写不同，以 Prisma 生成的为准并保留目录名 `20260902000000_add_external_place`）→ `npx prisma generate`。
- [ ] **Step 4:** `npx tsc --noEmit` 通过。

### Task A2: 查询词归一化 + displayUrl 按 placeId 寻址

**Files:**
- Modify: `lib/googlePlaces/places.ts`
- Test: `tests/googlePlaces/places.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { normalizePlaceQuery, buildPlacePhotoDisplayUrl, isSafePlacePhotoDisplayUrl } from '@/lib/googlePlaces/places'
describe('normalizePlaceQuery', () => {
  it('NFKC + 小写 + 去末尾括注 + 折叠空白', () => {
    expect(normalizePlaceQuery('  新千歳空港（抵达） ')).toBe('新千歳空港')
    expect(normalizePlaceQuery('Tokyo   Disneyland (Land)')).toBe('tokyo disneyland')
    expect(normalizePlaceQuery('ＡＢＣ')).toBe('abc')
  })
})
describe('placeId display url', () => {
  it('按 placeId 生成 keyless 代理 URL 且被判定安全', () => {
    const url = buildPlacePhotoDisplayUrl({ placeId: 'ChIJ3RpcnUUgdV8R9oH25Xxguho' })
    expect(url).toBe('/api/google/place-photo?placeId=ChIJ3RpcnUUgdV8R9oH25Xxguho&maxwidth=1600')
    expect(isSafePlacePhotoDisplayUrl(url)).toBe(true)
    expect(isSafePlacePhotoDisplayUrl('/api/google/place-photo?ref=AVoNoXQO7E_XY74W4vkAxpdMeN41NvFl')).toBe(true) // 存量
    expect(isSafePlacePhotoDisplayUrl('/api/google/place-photo?placeId=x')).toBe(false)
    expect(isSafePlacePhotoDisplayUrl('/api/google/place-photo?placeId=ChIJ3RpcnUUgdV8R9oH25Xxguho&key=abc')).toBe(false)
  })
})
```

- [ ] **Step 2: 实现**

```ts
export function normalizePlaceQuery(raw: string): string {
  return String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[（(][^（）()]*[）)]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,300}$/
export function isValidPlaceId(id: string): boolean { return PLACE_ID_PATTERN.test(String(id || '').trim()) }
export function buildPlacePhotoDisplayUrl(input: { placeId: string } | { photoReference: string }, maxWidth = 1600): string {
  if ('placeId' in input) return `/api/google/place-photo?placeId=${encodeURIComponent(input.placeId)}&maxwidth=${maxWidth}`
  return `/api/google/place-photo?ref=${encodeURIComponent(input.photoReference)}&maxwidth=${maxWidth}`
}
```
`isSafePlacePhotoDisplayUrl`：`ref` 有效 或 `placeId` 有效（二者至少一个），密钥类参数一律拒绝。更新既有调用点（`resolveByText` 组装 photo 时改用 `{ placeId }`）。

- [ ] **Step 3:** `npx vitest run tests/googlePlaces/places.test.ts` 通过。

### Task A3: ExternalPlaceStore（接口 + 内存实现 + Prisma 实现）

**Files:**
- Create: `lib/googlePlaces/store.ts`、`lib/googlePlaces/storeMemory.ts`、`lib/googlePlaces/storePrisma.ts`
- Test: `tests/googlePlaces/store.test.ts`（针对内存实现；Prisma 实现只做类型检查）

- [ ] **Step 1: 接口**（设计文档 §5.1 逐字）；`PLACE_METADATA_TTL_MS = 30 * 24 * 3600 * 1000`，`findByQuery` 对 `fetchedAt` 超期的行返回 null。
- [ ] **Step 2: 内存实现测试**

```ts
it('upsert 后按归一化查询词与 placeId 都能命中；30 天后按查询词未命中', async () => {
  const now = { value: Date.parse('2026-09-02T00:00:00Z') }
  const store = createMemoryExternalPlaceStore({ now: () => now.value })
  await store.upsert(place /* fetchedAt = now */, '新千歳空港')
  expect((await store.findByQuery('google', '新千歳空港'))?.placeId).toBe(place.placeId)
  expect((await store.findByPlaceId('google', place.placeId))?.photoMirrorStatus).toBe('none')
  now.value += 31 * 24 * 3600 * 1000
  expect(await store.findByQuery('google', '新千歳空港')).toBeNull()
  expect(await store.findByPlaceId('google', place.placeId)).not.toBeNull()
})
it('setPhotoMirror / updatePhotoReference 更新对应字段', ...)
```

- [ ] **Step 3: Prisma 实现**：`prisma.externalPlace.upsert`（`where: { provider_placeId }`）+ `prisma.externalPlaceQuery.upsert`（`where: { provider_normalizedQuery }`）；`findByQuery` 先查 query 表再 include place；`lastUsedAt` 在 `findByPlaceId`/`findByQuery` 命中时用 `updateMany` 异步刷新（失败忽略）。记录 → `ExternalPlaceRecord` 映射时 `photo` 由 `photoReference` 组装（`displayUrl = buildPlacePhotoDisplayUrl({ placeId })`）。
- [ ] **Step 4:** 测试与 tsc 通过。

### Task A4: 解析器接入库 + 位置偏置 + fromCache + onResolved + 异步 lookup

**Files:**
- Modify: `lib/googlePlaces/places.ts`
- Modify: `lib/planAgent/tools.ts`（`placeProvenanceError` 改 async；`resolve_place` 支持 `nearLat/nearLng`，返回 `fromCache`）
- Modify: `lib/planAgent/travelHelpers.ts`（若有依赖 `lookup` 同步语义处）
- Test: `tests/googlePlaces/places.test.ts`、`tests/planAgent/*.test.ts`（既有 `resolve_place`/`save_plan_days` 测试同步改为 await lookup）

- [ ] **Step 1: 失败测试**

```ts
it('库命中时不打 Google 且 fromCache=true', async () => {
  const store = createMemoryExternalPlaceStore(); await store.upsert(place, normalizePlaceQuery('新千歳空港'))
  const fetchImpl = vi.fn(); const r = createPlaceResolver({ apiKey: 'k', fetchImpl, store })
  const res = await r.resolveByText('新千歳空港（抵达）')
  expect(res).toMatchObject({ ok: true, fromCache: true }); expect(fetchImpl).not.toHaveBeenCalled()
})
it('未命中时打 Google、带 location/radius 偏置、upsert 入库并触发 onResolved', async () => {
  const onResolved = vi.fn(); const store = createMemoryExternalPlaceStore()
  const fetchImpl = vi.fn(async () => googlePlaceBody())
  const r = createPlaceResolver({ apiKey: 'k', fetchImpl, store, onResolved })
  const res = await r.resolveByText('新千歳空港', { near: { lat: 42.78, lng: 141.69 } })
  const url = new URL(String(fetchImpl.mock.calls[0][0]))
  expect(url.searchParams.get('location')).toBe('42.78,141.69'); expect(url.searchParams.get('radius')).toBe('30000')
  expect(res).toMatchObject({ ok: true, fromCache: false })
  expect(await store.findByPlaceId('google', 'ChIJ...')).not.toBeNull(); expect(onResolved).toHaveBeenCalledTimes(1)
  expect(await r.lookup('ChIJ...')).not.toBeNull()
})
it('库抛错时降级为无库模式（仍能解析）', ...)
```

- [ ] **Step 2: 实现**（`PlaceResolution` 成功分支加 `fromCache: boolean`；`lookup(): Promise<ResolvedPlace | null>`；`store` 调用全部 try/catch + `console.warn('[googlePlaces] store unavailable', err)`）。
- [ ] **Step 3:** 更新 `tools.ts`：`resolve_place` 参数 schema 增加 `nearLat`/`nearLng`（number，可选，描述"附近点位坐标，用于消歧"）；`placeProvenanceError` 变 `async` 并 `await deps.places.lookup(placeId)`；所有调用点 `await`。
- [ ] **Step 4:** `npx vitest run tests/googlePlaces tests/planAgent` 通过。

### Task A5: 照片抓取抽取 + 镜像服务 + 引用刷新

**Files:**
- Create: `lib/googlePlaces/photoFetch.ts`、`lib/googlePlaces/photoMirror.ts`
- Modify: `lib/googlePlaces/handlers/placePhoto.ts`（改用 `fetchGooglePlacePhoto`，行为不变）
- Test: `tests/googlePlaces/photoFetch.test.ts`、`tests/googlePlaces/photoMirror.test.ts`

- [ ] **Step 1: 失败测试（photoFetch）**：302 白名单跳转成功返回 bytes/mime；非白名单 Location → `{ ok: false, status: 'upstream' }`；403 → `denied`；`content-type: text/html` → `bad_type`；超 10MB → `too_large`。（把 `tests/googlePlaces/placePhoto.test.ts` 里的 fetch mock 复用）
- [ ] **Step 2: 实现 photoFetch**（从 handler 搬出 `buildUpstreamUrl`/`isSafePhotoRedirectUrl`/跳转循环/MIME/大小检查）。导出 `buildPlacePhotoCanonicalUrl(placeId, maxWidth)`（合成 canonical，见设计 §5.3）。
- [ ] **Step 3: 失败测试（photoMirror）**：无 bucket → `{ status: 'skipped' }` 且 store 不变；有 bucket 且抓取成功 → `bucket.put` 被调用、`store.setPhotoMirror(..., { status: 'mirrored', key })`；抓取失败 → `status: 'failed'`。`refreshPhotoReference`：mock Place Details 返回 `result.photos[0].photo_reference` → 返回新引用。
- [ ] **Step 4: 实现 photoMirror**（`putMirroredImage(bucket, canonical, bytes, mime, 'lazy')`）。
- [ ] **Step 5:** `npx vitest run tests/googlePlaces` 通过（含既有 `placePhoto.test.ts` 不回归）。

### Task A6: 代理支持 placeId 路径

**Files:**
- Modify: `lib/googlePlaces/handlers/placePhoto.ts`、`lib/googlePlaces/api.ts`（deps 增加 `store`）
- Test: `tests/googlePlaces/placePhoto.test.ts`

- [ ] **Step 1: 失败测试**：`?placeId=` 未知 → 404；库有行 + R2 命中 → 200 且 `X-Seichigo-Image-Source: google-place-photo-r2`，不打 Google；R2 未命中 → 上游成功 200，`bucket.put` 经 `waitUntil` 调用，`store.setPhotoMirror` 被调用；上游 403 → `refreshPhotoReference` 被调用一次、`store.updatePhotoReference` 更新、重试成功；`?ref=` 旧路径行为不变。
- [ ] **Step 2: 实现**（设计 §5.4）。`deps.store` 缺省时 `placeId` 路径返回 503 `{ error: '地点库未配置' }`。
- [ ] **Step 3:** 测试通过。

### Task A7: 保存时兜底 `backfillExternalPlaces`

**Files:**
- Create: `lib/planAgent/placeBackstop.ts`
- Modify: `lib/planAgent/tools.ts`（`save_plan_days` 在校验前调用；item payload schema 增加 `placeQuery`；返回 `autoResolvedPlaces`/`skippedPlaces`）
- Test: `tests/planAgent/placeBackstop.test.ts`、`tests/planAgent/tools.save-plan-days-backfill.test.ts`

- [ ] **Step 1: 失败测试（placeBackstop）**

```ts
it('lodging/meal/attraction 与无 pointId 的 point 会被解析并写入 payload.place；free 与带 pointId 的不动', ...)
it('模糊标题（自由时间/机动/返程准备）跳过', ...)
it('结果距当天质心 > 50km 拒绝并记录 skipped', ...)
it('Google 调用预算 6 次：库命中不计入，第 7 次未命中的跳过', ...)
it('解析抛错/返回 error 时跳过，不抛出', ...)
it('用 payload.placeQuery 优先于 title 作为查询词，并把 near=质心 传给 resolver', ...)
```

- [ ] **Step 2: 实现**（设计 §5.5；haversine 复用 `lib/planAgent` 既有 `haversineKm`；质心 = 坐标平均值；`dayCoordinates` 由 `tools.ts` 提供：`points.getPointsByIds(当天 pointId 列表, plan.bangumiIds)` 的坐标 + 当天已有 `payload.place` 坐标）。
- [ ] **Step 3: tools.ts 集成测试**：用内存 repo + 假 `places`（`resolveByText` 返回固定 place）保存一条 `lodging` 条目（无 place）→ 落库后 `payload.place.placeId` 与 `payload.media.displayUrl`（`/api/google/place-photo?placeId=...`）都存在；`resolve_place` 未配置（`deps.places` 缺省）时保存仍成功且条目原样。
- [ ] **Step 4:** `npx vitest run tests/planAgent` 通过。

### Task A8: 提示词 + serverDeps 装配

**Files:**
- Modify: `lib/planAgent/prompt.ts`、`lib/planAgent/serverDeps.ts`、`lib/googlePlaces/api.ts`
- Test: `tests/planAgent/serverDeps.test.ts`（若无则新建：`buildPlanAgentServerDeps` 注入 store 后 `places.resolveByText` 库命中不打网络）

- [ ] **Step 1: 提示词**（替换第 4 步与"外部地点条目"要点）：

```
4. 非作品停留点（机场、酒店/住宿区、餐厅、景点、海滩、商场等）只要是具体地点，一律先用 resolve_place 解析（有库缓存，重复调用不花配额），把返回的 place 原样存进条目 payload.place，media 存进 payload.media；不确定正式名称时在条目 payload.placeQuery 写更适合检索的名称，服务端会自动补齐。能落到具体地标就不要写成"自由时间"。解析失败就如实告知，绝不编造地点或坐标。
```
要点区追加：`- lodging/meal/attraction 条目同样要带 payload.place（或至少带 payload.placeQuery），否则界面上没有图片与地图点。`

- [ ] **Step 2: serverDeps**：`createPrismaExternalPlaceStore()` 进程级单例；`createPlaceResolver({ ..., store, onResolved })`，`onResolved` = `(place) => runInBackground(() => mirrorPlacePhoto({ store, bucket: getCfBindings()?.env?.MAP_IMAGE_CACHE, apiKey, place }))`，`runInBackground` 优先 `getCfBindings()?.ctx?.waitUntil`，否则 `void promise.catch(...)`。`lib/googlePlaces/api.ts` 的 `getGooglePlacesApiDeps` 注入同一 store。
- [ ] **Step 3:** 全量：`npx vitest run tests/googlePlaces tests/planAgent tests/plan` + `npx tsc --noEmit`。

---

## B. 前端（kimi k3）

### Task B1: Google 代理 URL 纳入代理类判定

**Files:**
- Modify: `components/map/utils/mapImageHostPolicy.ts`（`isMapImageProxyUrl`）
- Modify: `components/map/ResilientMapImage.tsx`（`withRetryNonce`、`resolveRequestTimeoutMs`、`advanceAfterFailure` 的重试分支、`trackedCandidateCount` 全部改用 `isMapImageProxyUrl`）
- Test: `tests/map/mapImageHostPolicy.proxyAware.test.ts`（新增用例）、`tests/map/resilient-map-image.test.tsx`（新增用例）

- [ ] **Step 1: 失败测试（host policy）**

```ts
it('isMapImageProxyUrl 识别 anitabi 与 google 代理', () => {
  expect(isMapImageProxyUrl('/api/anitabi/image-render?url=x')).toBe(true)
  expect(isMapImageProxyUrl('https://seichigo.com/api/google/place-photo?placeId=ChIJabc')).toBe(true)
  expect(isMapImageProxyUrl('https://image.anitabi.cn/a.jpg')).toBe(false)
})
```

- [ ] **Step 2: 失败测试（ResilientMapImage，参考文件内既有 fake timers 用法）**：`src="/api/google/place-photo?placeId=ChIJ3RpcnUUgdV8R9oH25Xxguho&maxwidth=1600"`、`kind="point"`：
  - 首次 `onError` 后 `img.src` 带 `_retry=1`（同一 URL 重试一次），再次 `onError` 才渲染 fallback；
  - 5 秒未 load 不触发超时（超时预算为 8.5 秒），9 秒才进入重试。
- [ ] **Step 3: 实现**：`isMapImageProxyUrl = (url) => url.includes('/api/anitabi/image-render') || url.includes('/api/google/place-photo')`；`ResilientMapImage.tsx` 内四处 `includes('/api/anitabi/image-render')` 全部替换为 `isMapImageProxyUrl(...)`。`readMapImageUpstreamHost` 保持只解析 image-render 的 `url` 参数（Google 代理没有上游 host 概念，返回 null 即可）。
- [ ] **Step 4:** `npx vitest run tests/map tests/plan` 通过；`npx tsc --noEmit` 通过。不改 DayCards。

---

## C. 人工收尾（不由代理执行）
1. 生产库迁移：`DATABASE_URL=<Neon> npx prisma migrate deploy`（先 `prisma migrate status` 核对只差 1 条）。
2. `npm run cf:upload` 出预览版本冒烟：新计划含机场/酒店 → daymap 卡片出图；`ExternalPlace` 有行；R2 出现 `mirror/v1/maps.googleapis.com/<hash>/.jpg`；同名二次解析 `fromCache=true`。
3. 整理提交（`seichigo-housekeeping`）。
