# 回归第四轮：图片去重、点位图稳定性 + Google 兜底落库、餐厅固定推荐（2026-09-02 夜）

工作方式同前：先通读现状；每条先补失败测试再实现；**不要 git commit**；**不对任何数据库执行迁移**（迁移文件只写不跑，由主会话负责 apply）；`node scripts/check-line-budget.mjs` 必须通过（`lib/planAgent/tools.ts` 已 747 行，**新逻辑一律放新文件**，tools.ts 只允许改字符串或加 1–2 行调用）。

- A（后端，glm-5.3）只碰 `lib/**`、`prisma/**`、`app/api/**`、`tests/planAgent/**`、`tests/googlePlaces/**`、`tests/tripPlan/**`。
- B（前端，kimi k3）只碰 `components/map/**`、`lib/anitabi/imageProxy.ts`、`app/(authed)/plan/[id]/**`、`tests/map/**`、`tests/plan/**`。
- 两者并行，文件集合不相交。A/B 之间的契约见 §0，两边都必须按契约实现，不要各自发明第二套。

## 用户反馈（2026-09-02 预览 9d10fdc7）
1. **重复图片**：「第一天从东京机场前往新宿」「傍晚新宿街头散步」「住宿新宿」三条用的是同一张电车图。原因：三条都解析到同一个 Google 地点（新宿站），地点库每个地点只存一张照片，且计划内没有任何去重环节；邻近图兜底又把同一张图复制给无图条目。
2. **点位图时有时无**：图片加载出来过一会又变回占位；作品选择卡封面同样时有时无。已确认的客户端原因：(a) `ResilientMapImage` 用 `loading="lazy"`，但超时计时器在赋 src 时就启动，视口外的图片浏览器根本不发请求，20 秒后一律被记成"超时失败"；(b) 失败计入断路器：同一图源 2 次失败降级为 2 秒超时、10 秒内 3 次失败封禁 60 秒（超时 0 毫秒 = 秒失败）；(c) 每次 `save_plan_days` 是 deleteMany + createMany，条目 id 全换，轮询拿到新计划后所有卡片按 `item.id` 重新挂载、重新请求，此时断路器已封禁，已显示的图立刻变回占位。用户要求：优先修好正常加载；实在加载不出的**从 Google 抓点位图回传并落库**。
3. **餐厅推荐固定化**：「晚餐自理」不允许再出现，午餐、晚餐固定推荐餐厅（早餐不强制）；餐厅图必须是该餐厅自己的 Google 照片，不能借迪士尼的图。原因：餐厅补齐只处理 `type==='meal'`，模型写成 free/「自理」就跳过；补齐顺序 place → restaurant，每次保存 places 配额只有 6 次，地点解析先用完，餐厅补齐 skipped，邻近图兜底再把迪士尼的图借给餐厅。

---

## §0 A/B 契约（两边都要遵守）

1. **地点照片代理支持序号**：`GET /api/google/place-photo?placeId=<id>&i=<n>&maxwidth=<w>`，`i` 为 0..9 的整数、缺省 0；`i` 超出该地点已知照片数返回 404。`buildPlacePhotoDisplayUrl({ placeId, index })` 只在 `index > 0` 时追加 `&i=<n>`（保证现有 URL 与 R2 key 不变）。
2. **点位兜底图接口**：`GET /api/google/point-photo?pointId=<AnitabiPoint.id>&maxwidth=<w>`。服务端按点位名+坐标解析 Google 地点，落库映射后按 placeId 路径回图（含 R2 镜像）。未登录 401；点位不存在 404；解析不到 404（结果也落库，7 天内不再重试）。响应头与 place-photo 相同（`Cache-Control: public, max-age=86400, ...`）。
3. **条目载荷新字段**（都是可选，前端不认识时忽略）：
   - `payload.media.photoIndex?: number`——去重后选用的照片序号（与 displayUrl 里的 `i` 一致）。
   - `payload.mealSlot?: 'breakfast' | 'lunch' | 'dinner'`——服务端归一后的用餐时段。
4. **前端候选梯**：`ResilientMapImage` 新增 prop `fallbackSrc?: string | null`，作为候选梯最后一档（同源相对路径）。`isMapImageProxyUrl` 必须把 `/api/google/point-photo` 也算作代理 URL。
5. **断路器口径**：只有真实网络错误（`onError`）计入断路器；超时不计入。

---

## A. 后端（glm-5.3）

### A1 迁移：地点多照片 + 点位→Google 映射

**Files**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260902020000_add_place_photos_and_point_google_link/migration.sql`

`ExternalPlace` 增加：
```prisma
  /** 最多 10 张照片：[{ photoReference, attribution }]；photoReference 列始终等于 photos[0] */
  photos            Json?
```
`AnitabiPoint` 增加：
```prisma
  googlePlaceId         String?
  /** resolved | not_found；null 表示从未尝试 */
  googlePlaceStatus     String?
  googlePlaceResolvedAt DateTime?
```
migration.sql：
```sql
ALTER TABLE "ExternalPlace" ADD COLUMN "photos" JSONB;
ALTER TABLE "AnitabiPoint" ADD COLUMN "googlePlaceId" TEXT;
ALTER TABLE "AnitabiPoint" ADD COLUMN "googlePlaceStatus" TEXT;
ALTER TABLE "AnitabiPoint" ADD COLUMN "googlePlaceResolvedAt" TIMESTAMP(3);
```
跑 `npx prisma generate`（不要 migrate）。

### A2 地点库多照片（`lib/googlePlaces/store.ts`、`storeMemory.ts`、`storePrisma.ts`、`places.ts`、`nearby.ts`、`photoMirror.ts`）

- `places.ts`：
  - 新增类型 `export type PlacePhotoRef = { photoReference: string; attribution: string | null }`。
  - `ResolvedPlace` 增加可选 `photos?: PlacePhotoRef[]`（Text Search / Nearby 只回 1 张，此时 `photos = [photo]`）。
  - `buildPlacePhotoDisplayUrl` 入参改为 `{ placeId: string; index?: number } | { photoReference: string }`，`index > 0` 时追加 `&i=<index>`。
  - `isSafePlacePhotoDisplayUrl` 不变（`i` 不是密钥类参数，已放行）。
- `store.ts`：`ExternalPlaceRecord` 增加 `photos: PlacePhotoRef[]`（无照片为 `[]`）；接口新增
  ```ts
  /** 覆盖写入该地点的全部照片引用（Place Details 补拉后回写）；同时把 photoReference 列同步为 photos[0] */
  updatePhotos(provider: 'google', placeId: string, photos: PlacePhotoRef[]): Promise<void>
  ```
- `storePrisma.ts`：`toRecord` 从 `row.photos`（JSON 数组，逐项校验 `isValidPhotoReference`）派生 `photos`；没有 `photos` 列值时退化为 `[ { photoReference: row.photoReference, attribution: row.photoAttribution } ]`。`upsert` 写 `photos: place.photos ?? (place.photo ? [place.photo] : [])`（去掉 displayUrl，只存 photoReference/attribution）。`updatePhotos` 同时更新 `photoReference`/`photoAttribution` = photos[0]，**不改 fetchedAt**。`updatePhotoReference` 保持现状，但若 `photos` 非空则把 photos[0] 一并替换。
- `storeMemory.ts` 同语义。
- `photoMirror.ts`：把 `refreshPhotoReference` 拆成
  ```ts
  export async function fetchPlacePhotos(input: { placeId: string; apiKey: string; fetchImpl?: typeof fetch }): Promise<PlacePhotoRef[] | null>
  ```
  （Place Details `fields=photos`，最多取前 10 个合法引用；失败 null），`refreshPhotoReference` 改为调用它并返回第 1 张（行为不变）。
- `nearby.ts`：餐厅结果的 `place.photos = photo ? [photo 的 {photoReference, attribution}] : []`。

测试：`tests/googlePlaces/store.test.ts` 补 `updatePhotos` 后 `findByPlaceId().photos.length === 3` 且 `photo.photoReference === photos[0]`；`tests/googlePlaces/photoMirror.test.ts` 补 `fetchPlacePhotos` 返回 3 张；`places.test.ts` 补 `buildPlacePhotoDisplayUrl({ placeId, index: 2 })` 含 `&i=2`、`index: 0` 不含。

### A3 照片代理按序号取图（`lib/googlePlaces/handlers/placePhoto.ts`、`lib/googlePlaces/photoFetch.ts`）

- `buildPlacePhotoCanonicalUrl(placeId, maxWidth, index = 0)`：`index > 0` 时追加 `&i=<n>`（R2 key 由 canonical 派生，旧图不受影响）。
- handler：解析 `i`（非整数/负数/>9 → 400），`getPlaceIdPhoto(placeId, maxWidth, index)`：`record.photos[index]` 不存在 → 404；引用过期刷新时用 `fetchPlacePhotos` 拿整组并 `store.updatePhotos`，再按 index 重试。
- 把 `getPlaceIdPhoto` 提升为导出函数 `servePlacePhotoByPlaceId(deps, placeId, maxWidth, index)`（A5 的点位接口复用），`createPlacePhotoHandlers` 内部改为调用它。

测试：`tests/googlePlaces/placePhoto.test.ts` 补 `i=1` 取第二张（fetch 被调用的 photoreference 是第二个）、`i=5` 超界 404、`i=abc` 400。

### A4 计划内图片去重（新文件 `lib/planAgent/enrich/imageDedupeEnricher.ts` + `neighborImageEnricher.ts` + `placeQuery.ts`）

**执行顺序改为** place → restaurant → transport → media → **dedupe** → neighbor（`enrich/index.ts`；`EnricherName` 增加 `'dedupe'`，`emptyEnrichReport().applied.dedupe = 0`）。

图片键 `imageKeyOf(displayUrl)`（放 `imageDedupeEnricher.ts` 导出，neighbor 也用）：place-photo URL → `google:<placeId>:<i>`（忽略 maxwidth；ref 形式用 `googleref:<ref>`）；其他 URL → 去掉 query 的 URL 字符串。

`runImageDedupeEnricher(days, ctx, report)`（async）：
1. 按天序、条目序遍历非 transit 条目，取自身图（`payload.media.displayUrl` 优先，否则站内点位 `coordsByPointId.get(pointId).image`）。
2. 站内点位图、`media.source === 'neighbor'` 的条目：只登记键，不改。
3. Google 图（`media.displayUrl` 是安全 place-photo URL 且 `payload.place.placeId` 存在）：键未用过 → 登记；键已用过 →
   - 取该地点已知照片：`ctx.deps.externalPlaces.findByPlaceId('google', placeId)` 的 `photos`（库不可用则 `place.photos ?? []`）；
   - 若已知照片 ≤ 1 且 `ctx.deps.fetchPlacePhotos` 存在且 `ctx.budget.places.used < max`：调用一次（`onGoogleCall` 计入 `budget.places.used`），成功则 `externalPlaces.updatePhotos`，用返回的整组；
   - 从 index 1 起找第一个未登记的序号 n：改写 `payload.media.displayUrl = buildPlacePhotoDisplayUrl({ placeId, index: n })`、`payload.media.photoIndex = n`、`payload.media.attribution = photos[n].attribution ?? undefined`，登记，`report.applied.dedupe += 1`；
   - 找不到（照片只有 1 张）→ 保持重复，`report.skipped.push({ enricher: 'dedupe', itemTitle, reason: '该地点只有一张照片' })`。
4. 幂等：条目已带 `photoIndex` 且键未被更早的条目占用时原样保留。
5. 导出 `collectUsedImageKeys(days, ctx): Set<string>` 供 neighbor 用。

`EnrichContext.deps` 增加可选 `fetchPlacePhotos?: (input: { placeId: string; onGoogleCall?: () => void }) => Promise<PlacePhotoRef[] | null>`；`serverDeps.ts` 装配：有 apiKey 时提供（内部调 `photoMirror.fetchPlacePhotos`，调用前先 `onGoogleCall?.()`），`tools.ts` 的 `enrichContext.deps` 透传（一行）。

`neighborImageEnricher.ts`：
- 跳过 `payload.mealSlot === 'lunch' | 'dinner'` 的 meal 条目（餐厅绝不借图，见 A6）。
- 候选顺序不变（当天前一个 → 当天后一个 → 前一天最后一个），但每个候选先展开成"该候选的可用图列表"：候选有 Google 图且 `payload.place.photos.length > 1`（或库里 `photos.length > 1`）时展开为各序号 URL，否则就它自己那张；从近到远、按展开顺序选**第一个键不在 `collectUsedImageKeys` 里**的图；全都用过了才退回最近候选的原图（现行为）。选定后登记到 used 集合（同一天多个无图条目不要都借同一张）。

`placeQuery.ts` 的 `MODIFIER_WORDS` 增加（长词在前）：`街头散步`、`散步`、`漫步`、`闲逛`、`逛街`、`购物`、`街头`、`清晨`、`早上`、`上午`、`中午`、`下午`、`傍晚`、`晚上`、`夜晚`、`夜间`。用例：「傍晚新宿街头散步」→ 新宿；「上午浅草寺周边」→ 浅草寺；「自由が丘散步」→ 自由が丘。

测试（新建 `tests/planAgent/enrich/imageDedupe.test.ts`）：
- 三条目同一 placeId、库里该地点有 3 张照片 → 第 1 条 `i` 缺省、第 2 条 `&i=1`、第 3 条 `&i=2`，`applied.dedupe === 2`。
- 库里只有 1 张、注入 `fetchPlacePhotos` 返回 3 张 → 调用 1 次、`updatePhotos` 被调用、第 2 条 `&i=1`。
- 预算已满 → 不调 `fetchPlacePhotos`，记 skipped。
- 连跑两次第二次 `applied.dedupe === 0`。
- neighbor：两条无图条目相邻一个多照片地点 → 分别借到 `i=0`/`i=1`；lunch meal 无图不借。
- `placeQuery.test.ts` 补上述 3 个用例。

### A5 点位兜底图接口（新文件 `lib/googlePlaces/pointPlaceLink.ts`、`lib/googlePlaces/pointPlaceLinkPrisma.ts`、`lib/googlePlaces/handlers/pointPhoto.ts`、`app/api/google/point-photo/route.ts`；改 `lib/googlePlaces/api.ts`）

`pointPlaceLink.ts`：
```ts
export type PointPlaceLinkRow = {
  id: string; name: string; nameZh: string | null; lat: number | null; lng: number | null
  googlePlaceId: string | null; googlePlaceStatus: 'resolved' | 'not_found' | null; googlePlaceResolvedAt: Date | null
}
export interface PointPlaceLinkStore {
  findPoint(pointId: string): Promise<PointPlaceLinkRow | null>
  setLink(pointId: string, link: { placeId: string | null; status: 'resolved' | 'not_found'; resolvedAt: Date }): Promise<void>
}
export const POINT_LINK_NOT_FOUND_RETRY_MS = 7 * 24 * 3600 * 1000
export const POINT_LINK_MAX_DISTANCE_KM = 1
export function createMemoryPointPlaceLinkStore(seed?: PointPlaceLinkRow[]): PointPlaceLinkStore
```
`pointPlaceLinkPrisma.ts`：`prisma.anitabiPoint.findUnique({ select: { id, name, nameZh, geoLat, geoLng, googlePlaceId, googlePlaceStatus, googlePlaceResolvedAt } })` 与 `update`。

`handlers/pointPhoto.ts`：
```ts
export type PointPhotoHandlerDeps = PlacePhotoHandlerDeps & {
  pointLinks: PointPlaceLinkStore
  /** 解析器：rateKey 固定 'point-photo'，与计划无关；测试注入 */
  resolver: PlaceResolver
}
export function createPointPhotoHandlers(deps: PointPhotoHandlerDeps): { GET(req: Request): Promise<Response> }
```
流程：未登录 401 → `pointId` 为空/超 200 字符 400 → `findPoint` null → 404 → 已有 `googlePlaceId` → `servePlacePhotoByPlaceId(deps, placeId, maxWidth, 0)`（404 时视为链接失效：清空后走解析）→ `status === 'not_found'` 且 `resolvedAt` 距今 < 7 天 → 404 `{ error: '该点位没有可用的 Google 图片' }` → 否则解析：`resolver.resolveByText(nameZh || name, { near: { lat, lng }, radiusM: 300 })`（点位无坐标则不带 near）；成功且与点位直线距离 ≤ 1 km（`haversineKm` 来自 `lib/planAgent/cluster.ts`，无坐标不校验）→ `setLink({ placeId, status: 'resolved' })` 后 `servePlacePhotoByPlaceId`；否则 `setLink({ placeId: null, status: 'not_found' })` → 404。解析 `rate_limited`/`provider_error` 不落库，返回 503。

`api.ts`：新增 `getGooglePointPhotoDeps()`：复用 `loadStableDeps()`，追加 `pointLinks`（Prisma 实现单例）与 `resolver = createPlaceResolver({ apiKey, rateKey: 'point-photo', store, rateWindow: createPlacesRateWindow({ maxCalls: 30 }) })`（进程级缓存，无 onResolved；镜像由 photo 路径的 lazy put 负责）。`route.ts` 与 place-photo 的一样薄。

测试（新建 `tests/googlePlaces/pointPhoto.test.ts`，仿 `placePhoto.test.ts` 的 fetch mock）：已有链接直接取图不调 Text Search；无链接 → Text Search 一次 → `setLink` resolved → 回图；结果距离 5 km → not_found 404 且 `setLink` not_found；7 天内再次请求不再调 Text Search；未登录 401。

### A6 用餐归一 + 餐厅必达（新文件 `lib/planAgent/enrich/mealEnricher.ts`；改 `restaurantEnricher.ts`、`placeBackstop.ts`、`enrich/types.ts`、`enrich/index.ts`、`prompt.ts`、`tools.ts` 字符串）

`mealEnricher.ts`（同步，作为**第一个** runner，`EnricherName` 增加 `'meal'`）：
- 对非 transit 条目，标题或 note 命中 `/(早餐|早饭|午餐|午饭|中饭|晚餐|晚饭|夜宵|用餐|就餐|吃饭|自理)/` 且 `type !== 'meal'` → `type = 'meal'`。
- 推断 `payload.mealSlot`：标题含 早餐|早饭 → breakfast；午餐|午饭|中饭 → lunch；晚餐|晚饭|夜宵 → dinner；否则按 `timeHint`/`payload.schedule` 解析出的小时（复用 `schedule.ts` 的解析函数，若无导出则新导出 `parseStartMinutes(item)`）：< 10:30 breakfast、< 16:00 lunch、其余 dinner；完全无法判断 → lunch。已有合法 `mealSlot` 不改。
- 标题清洗：去掉 `自理|自行安排|自行解决|自由用餐`，去掉首尾标点；清洗后为空 → 按 slot 写「早餐」「午餐」「晚餐」。
- `report.applied.meal` 计数为改动条目数。

预算预留（`types.ts`）：`EnrichBudget.places` 增加可选 `reserved?: number`（缺省视为 0，现有测试里手写的 `{ used, max }` 不必改）；`createEnrichBudget` 初始化为 0；`rollEnrichBudgetWindow` 不动它。新增
```ts
/** 除去预留后 places 还可用的次数（预留给餐厅补齐） */
export function placesRemaining(budget: EnrichBudget): number {
  return Math.max(0, budget.places.max - budget.places.used - (budget.places.reserved ?? 0))
}
```
- `mealEnricher` 末尾：`budget.places.reserved = 当前 lunch/dinner 且无合法 place 的 meal 条目数`（上限 `budget.places.max`）。
- `placeBackstop.ts`：有 budget 时用 `placesRemaining(budget) <= 0` 判定预算耗尽（替换现有 `used >= max`）。
- `restaurantEnricher.ts`：只处理 `mealSlot === 'lunch' | 'dinner'`（breakfast 跳过、不记 skipped）；处理每条前 `budget.places.reserved = Math.max(0, reserved - 1)`；预算判定改为 `budget.places.used >= budget.places.max`（自身可用完整预算）。搜索成功时 `place` 照抄（含 `photos`），note 备选逻辑不变；额外把 `payload.restaurantPending` 删除。失败（无结果/预算/异常）时写 `payload.restaurantPending = true`（下一轮保存会再试；前端不认识该字段）。
- `mediaEnricher.ts` 不变（餐厅图从 `place.photo` 派生，就是餐厅自己的照片）。
- `prompt.ts` 行程编排规则里把 meal 那条改为：
  > 每天必须各有一条午餐、一条晚餐的 meal 条目（早餐不用单独安排，可写进住宿 note）。meal 条目要先用 find_restaurants 以用餐前最后一个点位的坐标为中心搜索，选评分最高且顺路的一家写进 payload.place；找不到或预算用完时仍要输出 meal 条目（title 写「午餐」/「晚餐」），服务端会自动补齐餐厅。绝不要写「自理」「自行安排」，绝不要凭记忆编造餐厅名。
- `tools.ts` 的 `find_restaurants` 工具描述末尾追加一句「午餐、晚餐固定推荐餐厅，禁止写自理」（只改字符串）。

测试：新建 `tests/planAgent/enrich/mealEnricher.test.ts`（free「晚餐自理」→ meal/dinner/标题「晚餐」；「12:00 用餐」→ lunch；已是 meal 且 slot 合法不动；reserved 计算）；`tests/planAgent/enrich/index.test.ts` 补「places.max=2、1 个 lunch 无餐厅、2 个待解析地点 → 只解析 1 个地点、餐厅补齐成功」；`restaurantEnricher` 现有用例改为带 `mealSlot`；`placeBackstop.test.ts` 补 reserved 生效用例；`tests/planAgent/budgetReserve.test.ts` 补 `placesRemaining`。

### A 完成标准
`npx vitest run tests/planAgent tests/googlePlaces tests/tripPlan` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增错误（`tests/lib/prisma-client-lifecycle.test.ts` 的 3 条是存量）；`node scripts/check-line-budget.mjs` 通过；简短中文汇报改动文件与测试结果。

---

## B. 前端（kimi k3）

### B1 `ResilientMapImage`：视口门控、超时不计断路器、已加载缓存、`fallbackSrc`（`components/map/ResilientMapImage.tsx`、新文件 `components/map/utils/mapImageLoadedCache.ts`、`components/map/utils/mapImageHostPolicy.ts`、`lib/anitabi/imageProxy.ts`）

该组件也被 `/map` 页（PointPopupCard、MobileVisualCenterOverlay、WindowExcerptOverlay、MapDialogs、useMapInteractionActions）使用，改动必须对现有 props 完全向后兼容，现有 `tests/map/resilient-map-image.test.tsx` 全部保持通过（只允许因"超时不再计入断路器"调整断言）。

1. **视口门控**：`loading === 'lazy'` 时，在真正发起请求（acquire lease → setRequestSrc）之前，先渲染 fallback 加一个零尺寸哨兵 `<span aria-hidden data-map-image-sentinel style={{ display: 'block', width: 0, height: 0 }} ref={sentinelRef} />`，用 `IntersectionObserver({ rootMargin: '200px' })` 观察它；首次相交后置 `inView = true` 才走现有请求链。`loading === 'eager'`、`typeof IntersectionObserver === 'undefined'`（jsdom/测试）时 `inView` 初始即 true。请求发出后渲染的 `<img>` 一律 `loading="eager"`（门控已由我们负责，避免浏览器再延迟导致计时器失真）。`raw` 变化时 `inView` 不重置（同一位置换图不必再等一次相交）。
2. **超时不计断路器**：`advanceAfterFailure(outcome)` 里只有 `outcome === 'network_error'` 才 `markMapImageHostDegraded`；`timeout` 只换候选/重试/回退。`resolveHostTimeoutMs` 返回 0（blocked）时不再"立即失败"，而是直接跳到下一候选（若无下一候选则用 `DEGRADED_HOST_TIMEOUT_MS` 正常尝试一次）——封禁只影响排序与超时，不再产生秒失败。
3. **已加载缓存**（`mapImageLoadedCache.ts`）：
   ```ts
   export function rememberLoadedMapImage(url: string): void   // 有界 500 条，超出逐出最旧
   export function hasLoadedMapImage(url: string): boolean
   export function resetLoadedMapImageCacheForTest(): void
   ```
   `onLoad` 时登记 `currentCandidate`（去掉 `_retry` 参数）。挂载/换 raw 时若候选梯中有已登记的 URL：跳过视口门控、lease 与计时器，直接以该 URL 作为 `requestSrc` 渲染（onError 仍走正常失败链）。
4. **`fallbackSrc`**：新增 prop `fallbackSrc?: string | null`；非空时追加为候选梯最后一档（原样、不再走 `getMapDisplayImageCandidates`，去重）。`mapImageHostPolicy.isMapImageProxyUrl` 增加 `/api/google/point-photo`；`readMapImageEffectiveHost` 对它返回固定标识 `'google-point-photo'`。
5. 计时基准不变（point 20s / 其他代理 6s / 直连 4s）。

测试（`tests/map/resilient-map-image.test.tsx` 追加，需要时 mock `IntersectionObserver`）：
- lazy 且未相交：不 acquire lease、20s 后仍是 fallback 且断路器 `resolveHostState` 保持 healthy；相交后发出请求。
- timeout 三次后 host 仍 healthy；`fireEvent.error` 两次后 degraded。
- 首次 onLoad 后卸载再挂载同 src：立即渲染 `<img>`（同步查询到 alt），不经过 lease。
- `fallbackSrc` 在两档代理都 error 后被使用；再 error 才 fallback 节点。
- `tests/map/mapImageHostPolicy.proxyAware.test.ts` 补 point-photo 识别。

### B2 卡片挂载稳定（`app/(authed)/plan/[id]/components/DayCards.tsx`）

- 列表 key 不再用 `item.id`（每次保存都会变）：改为内容签名 `${item.type}|${item.pointId ?? ''}|${item.title}`，同一天内重复签名追加 `#<序号>`；天的 key 用 `day.dayIndex`。这样轮询后同样内容的卡片不重挂载，已显示的图不重新请求。
- point 条目传 `fallbackSrc={item.pointId ? `/api/google/point-photo?pointId=${encodeURIComponent(item.pointId)}&maxwidth=400` : null}`；站内点位 `point.image` 为空时 `src` 直接用这个兜底 URL（不再直接渲染占位；候选梯去重后不会重复请求）。
- `TransitConnectorRow` 若也渲染图片（返程目的地卡片）同样处理。

测试（`tests/plan/dayCards.test.tsx`）：同标题条目 id 变化后 `<img>` 元素引用不变（rerender 前后 `container.querySelector('img')` 为同一节点）；无 image 的 point 条目渲染的 img src 含 `/api/google/point-photo?pointId=`。

### B3 作品选择卡封面（`app/(authed)/plan/[id]/components/AskCard.tsx`）

- `OptionCover` 保持 `kind="cover"`，无需改 props；B1 的视口门控与缓存自动生效。确认选项列表 key 用 `option.id`（已是）。
- `tests/plan/ask-card.test.tsx` 补一个"封面加载成功后父组件 rerender 不重挂载 img"的用例。

### B 完成标准
`npx vitest run tests/map tests/plan` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增错误；简短中文汇报。
