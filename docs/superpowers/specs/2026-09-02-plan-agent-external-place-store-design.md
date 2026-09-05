# 计划 agent：非作品点位地点库 + 图片回显落库（设计）

日期：2026-09-02　范围：plan agent（M3 之后）　状态：待实现

## 1. 问题

daymap 交付物里的非作品条目（机场、酒店、海滩、餐厅、景点）几乎全是图片占位。
调查结论（2026-09-02）：

- 图片管线（`resolve_place` → `payload.media` → `/api/google/place-photo` 代理 → R2 镜像 → DayCards）
  本身可用，服务端复现 Google Photo 抓取成功（302 → lh3.googleusercontent.com → 200 jpeg）。
- 真正原因是 agent 几乎不调用 `resolve_place`：历史上只调用过 2 次；最近 8 个计划里只有 1 个条目
  带 `payload.place`。非作品停留点被写成 `free/lodging/meal/attraction`，不带 place，DayCards 只认
  `payload.media.displayUrl ?? point.image`，于是渲染占位。
- 提示词第 4 步只要求"用户提到非巡礼地点时"才解析；工具 schema 允许这些类型不带 place。
- 次要风险：`ResilientMapImage` 把 `/api/google/place-photo` 当直连 URL，超时 4 秒、无重试；
  `resolve_place` 的出处验证依赖进程内缓存，在 workerd 隔离体回收后会失效。

## 2. 目标

1. 尽可能减少交付物中的图片占位：凡 Google 能解析到的非作品停留点，都要有真实坐标与图片。
2. 首次解析：Google 回显 + 落库（地点元数据入 Postgres，图片字节镜像到 R2）。
3. 之后同一地点（按 placeId 或归一化查询词）直接从库里取，不再打 Google。
4. 不引入第二套图片 URL 策略；浏览器只见 keyless 的站内代理 URL；API key 不进任何载荷/日志/R2 元数据。

非目标：作品点位（Anitabi）图片；`free` 类型（"自由时间"）条目；Google 以外的地点源。

## 3. 方案总览

三层防线，从根上减少占位：

1. **提示词 + 工具契约**：每个具体的非作品停留点（机场、酒店、餐厅、景点、海滩）必须经 `resolve_place`
   解析后落 `payload.place`；条目可带 `payload.placeQuery`（更适合检索的正式名）；`resolve_place`
   支持 `nearLat/nearLng` 位置偏置。
2. **服务端兜底**（`save_plan_days`）：对 `lodging/meal/attraction` 以及无 `pointId` 且无 place 的
   `point` 条目，用 `placeQuery ?? title` 自动解析（库优先，Google 兜底），带当天坐标质心偏置与
   距离守卫，预算受限，失败静默保持原条目。
3. **地点库**（新表 `ExternalPlace` / `ExternalPlaceQuery`）：解析结果落库；照片字节在解析时后台镜像到
   R2；展示 URL 改为按 placeId 寻址（`/api/google/place-photo?placeId=...`），照片引用过期时服务端用
   Place Details 刷新，浏览器无感。

## 4. 数据模型

```prisma
model ExternalPlace {
  id                String   @id @default(cuid())
  provider          String   @default("google")
  placeId           String
  name              String
  address           String?
  lat               Float
  lng               Float
  mapsUri           String
  photoReference    String?
  photoAttribution  String?
  photoMirrorKey    String?
  photoMirrorStatus String   @default("none")   // none | pending | mirrored | failed
  photoMirroredAt   DateTime?
  fetchedAt         DateTime
  lastUsedAt        DateTime @default(now())
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  queries           ExternalPlaceQuery[]

  @@unique([provider, placeId])
}

model ExternalPlaceQuery {
  id              String   @id @default(cuid())
  provider        String   @default("google")
  normalizedQuery String
  placeId         String
  createdAt       DateTime @default(now())
  place           ExternalPlace @relation(fields: [provider, placeId], references: [provider, placeId], onDelete: Cascade)

  @@unique([provider, normalizedQuery])
  @@index([provider, placeId])
}
```

- 查询词归一化：NFKC → 小写 → 去掉末尾括注（`（抵达）`/`(arrival)`）→ 空白折叠 → trim。
- 元数据新鲜度：`fetchedAt` 超过 30 天的行按未命中处理（重新查 Google 并 upsert），符合 Places
  数据缓存政策；placeId 与 R2 镜像长期保留（用户决策：优先减少占位）。
- 迁移：`prisma/migrations/20260902000000_add_external_place/migration.sql`，与既有迁移同风格；
  生产库需显式注入 `DATABASE_URL` 执行 `prisma migrate deploy`（人工步骤，不由实现代理执行）。

## 5. 组件与接口

### 5.1 `lib/googlePlaces/store.ts`（接口）+ `storePrisma.ts` + `storeMemory.ts`

```ts
export type ExternalPlaceRecord = ResolvedPlace & {
  photoMirrorStatus: 'none' | 'pending' | 'mirrored' | 'failed'
  photoMirrorKey: string | null
}
export interface ExternalPlaceStore {
  findByQuery(provider: 'google', normalizedQuery: string): Promise<ExternalPlaceRecord | null> // 30 天内
  findByPlaceId(provider: 'google', placeId: string): Promise<ExternalPlaceRecord | null>
  upsert(place: ResolvedPlace, normalizedQuery: string | null): Promise<void>
  setPhotoMirror(provider: 'google', placeId: string, patch: { status: ExternalPlaceRecord['photoMirrorStatus']; key?: string | null; mirroredAt?: Date | null }): Promise<void>
  updatePhotoReference(provider: 'google', placeId: string, photoReference: string | null, attribution: string | null): Promise<void>
}
```

### 5.2 `lib/googlePlaces/places.ts`（解析器）

- `createPlaceResolver(deps)` 新增 `store?: ExternalPlaceStore`、`onResolved?: (place: ResolvedPlace) => void`。
- `resolveByText(query, opts?: { near?: { lat: number; lng: number }; radiusM?: number })`：
  内存缓存 → `store.findByQuery` → 限速检查 → Google Text Search（有 `near` 时带 `location`+`radius`）
  → 组装 `ResolvedPlace`（`photo.displayUrl = /api/google/place-photo?placeId=<id>`）→ `store.upsert`
  → `onResolved` → 返回 `{ ok: true, place, fromCache }`。
- `lookup(placeId)` 改为异步：内存 → `store.findByPlaceId`。
- `buildPlacePhotoDisplayUrl({ placeId })` 生成按 placeId 寻址的 URL；`isSafePlacePhotoDisplayUrl`
  接受 `placeId`（`^[A-Za-z0-9_-]{10,300}$`）或旧的 `ref`。
- 导出 `normalizePlaceQuery(raw)`。

### 5.3 `lib/googlePlaces/photoFetch.ts` + `photoMirror.ts`

- `fetchGooglePlacePhoto({ photoReference, maxWidth, apiKey, fetchImpl })`：从现有 handler 抽出的
  "带 key 请求 + 逐跳白名单校验重定向 + MIME/大小限制"逻辑，返回 `{ ok: true, bytes, mimeType }` 或
  `{ ok: false, status: 'denied' | 'not_found' | 'upstream' | 'timeout' | 'too_large' | 'bad_type' }`。
- `buildPlacePhotoCanonicalUrl(placeId, maxWidth)`：合成 canonical
  `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1600&placeid=<id>`，只作 R2 key 输入，绝不请求。
- `mirrorPlacePhoto({ store, bucket, apiKey, fetchImpl, place })`：无 bucket 或无 photoReference 时直接返回
  `skipped`；否则抓取 → `putMirroredImage(bucket, canonical, bytes, mime, 'lazy')` → `store.setPhotoMirror`。
- `refreshPhotoReference({ placeId, apiKey, fetchImpl })`：Place Details `fields=photos`，返回新的
  `photo_reference`/署名或 null。

### 5.4 `lib/googlePlaces/handlers/placePhoto.ts`（代理）

- 参数二选一：`placeId`（新）或 `ref`（兼容存量）。
- `placeId` 路径：登录校验 → `store.findByPlaceId` → 无记录/无照片 404 → R2 read-through（canonical by placeId）
  → `fetchGooglePlacePhoto` → 若 `denied`/`not_found` 则 `refreshPhotoReference` 一次并重试 → 成功即返回，
  后台（`waitUntil`）镜像并 `setPhotoMirror`。
- 响应头保持现有 `X-Seichigo-Image-Source` 语义，新增 `google-place-photo-r2` / `-upstream` 不变。

### 5.5 `lib/planAgent/placeBackstop.ts`（保存时兜底）

```ts
export async function backfillExternalPlaces(input: {
  days: Array<{ dayIndex: number; items: ParsedItem[] }>
  places?: PlaceResolver
  dayCoordinates: (dayIndex: number) => Array<{ lat: number; lng: number }>  // 当天已知坐标（Anitabi 点 + 已有 place）
  maxGoogleCalls?: number  // 默认 6
}): Promise<{ resolved: number; skipped: Array<{ title: string; reason: string }> }>
```

规则：候选 = `type ∈ {lodging, meal, attraction}` 或（`type='point'` 且无 `pointId`）且无合法 `payload.place`；
查询词 = `payload.placeQuery ?? title`，归一化后长度 < 2 或命中模糊词（自由|休息|机动|返程|准备|待定）则跳过；
偏置 = 当天坐标质心、半径 30 km；有质心时结果距质心 > 50 km 则拒绝；`fromCache=false` 的调用计入预算，
超预算跳过；成功则写入 `payload.place`（完整 `ResolvedPlace`，含 `photo`），由既有 `derivePlaceMedia`
派生 `payload.media`。任何失败只记录 `skipped`，绝不让保存失败。兜底在出处/形状校验之前执行。

### 5.6 `lib/planAgent/tools.ts` / `prompt.ts` / `serverDeps.ts`

- `resolve_place` 参数新增 `nearLat`/`nearLng`（可选）；返回值增加 `fromCache`。
- `save_plan_days` 的 item payload schema 新增 `placeQuery`；保存流程在校验前调用 `backfillExternalPlaces`，
  结果写入返回 JSON（`autoResolvedPlaces`, `skippedPlaces`）供模型转述。
- `placeProvenanceError` 改为异步（`await places.lookup`）。
- 提示词第 4 步改为：所有具体非作品停留点必须解析；给 `placeQuery`；能落到具体地标就不要写"自由时间"；
  `resolve_place` 有库缓存、可以放心多次调用。
- `serverDeps.ts`：注入 Prisma store 单例与 `onResolved → 后台镜像`（有 `ctx.waitUntil` 用之，否则浮动 promise）。
- `lib/googlePlaces/api.ts`：代理依赖增加 `store`。

### 5.7 前端

- `components/map/utils/mapImageHostPolicy.ts`：`isMapImageProxyUrl` 同时识别 `/api/anitabi/image-render`
  与 `/api/google/place-photo`。
- `components/map/ResilientMapImage.tsx`：超时、重试 nonce、候选计数全部改用 `isMapImageProxyUrl`，
  Google 代理 URL 获得与 anitabi 代理相同的 8.5 秒（point）预算与一次 `_retry` 重试。
- DayCards 无需改动（已按 `payload.media` 渲染）。

## 6. 错误处理

- Google 配置错误/配额：解析返回 typed 错误，兜底跳过，`resolve_place` 原样转述。
- 照片引用过期：代理刷新一次，仍失败返回 502，前端退回占位；`photoMirrorStatus='failed'`。
- R2 不可用：镜像跳过，展示走上游代理；不影响保存。
- 库不可用（迁移未跑）：store 抛错由解析器捕获并降级为"无库"模式（只用内存缓存 + Google），并 `console.warn`。

## 7. 测试

- node：`normalizePlaceQuery`；store 内存实现；解析器"库命中不打 Google / 30 天过期重查 / 偏置参数 /
  fromCache"；`fetchGooglePlacePhoto` 重定向白名单与错误分类；`mirrorPlacePhoto` 无 bucket 跳过、成功写状态；
  代理 `placeId` 路径（404 / R2 命中 / 上游 / 刷新引用重试）；`backfillExternalPlaces`（候选筛选、模糊词跳过、
  距离守卫、预算、失败不阻塞）；`save_plan_days` 集成（lodging 条目自动带 place+media）；`isSafePlacePhotoDisplayUrl`
  接受 placeId。
- jsdom：`ResilientMapImage` 对 Google 代理 URL 的超时与重试；`mapImageHostPolicy.isMapImageProxyUrl`。

## 8. 上线步骤

1. 开发库：`npx prisma migrate dev`（.env）。
2. 生产库：`DATABASE_URL=<Neon> npx prisma migrate deploy`（人工执行，先 dry-run 核对）。
3. 预览版本冒烟：新建计划含酒店/机场，确认 daymap 卡片出图、`ExternalPlace` 有行、R2 出现
   `mirror/v1/maps.googleapis.com/<hash>/.jpg`；第二次同名解析不打 Google（日志 `fromCache=true`）。
