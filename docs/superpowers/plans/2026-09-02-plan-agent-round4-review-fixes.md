# 回归第四轮 A 部分审查修复（2026-09-02 夜）

背景：`docs/superpowers/plans/2026-09-02-plan-agent-round4-image-dedupe-stability-meals.md` 的 A1–A6 已实现并全绿，审查发现以下问题。工作方式同前：每条先补失败测试再改；**不要 git commit**；**不跑任何数据库迁移**；只碰 `lib/**`、`tests/planAgent/**`、`tests/googlePlaces/**`；`node scripts/check-line-budget.mjs` 必须通过（tools.ts 已 749 行，不要再加行）。另一个 opencode 正在并行改前端（`components/**`、`app/(authed)/**`、`tests/map/**`、`tests/plan/**`），不要碰那些文件。

## 高

### R1 用餐归一误伤（`lib/planAgent/enrich/mealEnricher.ts`）
现在 `haystack = title + note`，且不看 `pointId`：一个站内点位条目 note 里写「参观后午餐」就会被改成 meal，作品点位被吞掉。改为：**只匹配标题**、且 `item.pointId` 为空、且 `validateExternalPlacePayload(item.payload?.place) !== null`（已带合法 place 的条目也不改类型；已是 meal 的照常推断 slot）。测试：带 pointId 且 note 含「午餐」的 point 条目类型不变；title「晚餐自理」free 条目仍转 meal。

### R2 地点兜底不要抢餐厅（`lib/planAgent/placeBackstop.ts`）
`isBackfillCandidate` 对 `type==='meal'` 且 `payload.mealSlot` 为 `lunch`/`dinner` 的条目返回 false（留给 restaurantEnricher；否则「午餐」被 Text Search 成垃圾地点，还烧掉预留配额）。`dayHasBackfillCandidate` 同步生效。测试：`placeBackstop.test.ts` 补「lunch meal 不被解析、不消耗预算」；`tests/planAgent/enrich/index.test.ts` 补「places.max=3、1 个 lunch、2 个待解析地点、findRestaurants 可用 → 餐厅一定拿到 place」。

### R3 点位链接失效后要能重新解析（`lib/googlePlaces/handlers/pointPhoto.ts`）
`servePlacePhotoByPlaceId` 返回 404 时现在写了 `not_found` 并把本地 `point` 也标成 not_found，紧接着的 7 天守卫直接 404，永远走不到重新解析，而且一次瞬时 404 会把点位封 7 天。改为：404 时**只清空本地** `point.googlePlaceId/googlePlaceStatus/googlePlaceResolvedAt = null`（不落库），继续往下走解析流程；解析结果再按现有规则落库。测试：`pointPhoto.test.ts` 补「已有链接 → placeId 路径 404 → 触发 Text Search → 新链接落库 → 回图」。

### R4 点位解析不写查询词行（`lib/googlePlaces/places.ts`、`lib/googlePlaces/api.ts`）
点位名多是「踏切」「阶段」「交差点」这类泛词，point-photo 的解析器会把它们写进 `ExternalPlaceQuery`，污染计划 agent 的 `findByQuery`。`PlaceResolverDeps` 增加 `persistQuery?: boolean`（缺省 true）；为 false 时 `upsertToStore(place, null)`、也不查 `findByQuery`（只查内存与 placeId）。`api.ts` 的 point-photo 解析器传 `persistQuery: false`。测试：`places.test.ts` 补 `persistQuery:false` 时 `store.upsert` 第二参数为 null 且不调用 `findByQuery`。

## 中

### R5 去重不要反复补拉同一地点（`lib/planAgent/enrich/imageDedupeEnricher.ts`）
本次运行内维护 `attemptedPlaceIds: Set<string>`，同一 placeId 只调一次 `fetchPlacePhotos`（无论成功与否）。测试：3 条同地点、库里 1 张、`fetchPlacePhotos` 返回 null → 只调用 1 次，预算只扣 1。

### R6 序号 > 0 不覆盖镜像状态（`lib/googlePlaces/handlers/placePhoto.ts`）
`setPhotoMirror` 没有序号维度：只有 `index === 0` 时才写 mirrored/failed 状态；`index > 0` 的上游成功仍然 put R2（canonical 带 `i`），但不改 `photoMirror*` 列。测试：`i=1` 成功后 `setPhotoMirror` 未被调用。

### R7 `upsert` 的 photos 列不要残留旧值（`lib/googlePlaces/storePrisma.ts`、`storeMemory.ts`）
update 路径：新解析结果无照片时写 `photos: []`（不是 undefined）；新结果只有 1 张而库里已有 ≥ 2 张（来自 Place Details）时**保留库里整组**，只把 `photoReference`/`photoAttribution` 对齐为库里 photos[0]（不要用 1 张覆盖 10 张）。内存实现同语义。测试：先 `updatePhotos` 3 张，再 `upsert` 只带 1 张 → `photos.length` 仍为 3。

### R8 邻近图兜底的 N+1 查库（`lib/planAgent/enrich/neighborImageEnricher.ts`）
在 `runNeighborImageEnricher` 里建 `Map<placeId, PlacePhotoRef[]>` 备忘并传给 `expandCandidateImages`，同一 placeId 只查一次库。测试：注入计数的 store，3 个无图条目共用 2 个候选地点 → `findByPlaceId` ≤ 2 次。

## 低

### R9 图片键带 origin（`imageDedupeEnricher.ts` 的 `imageKeyOf`）
非 Google URL 用 `${url.origin}${url.pathname}`（哨兵 origin `https://plan-image.invalid` 时只用 pathname）。测试：两个不同 host 同路径不相等。

### R10 `ref=` 路径拒绝 `i>0`（`placePhoto.ts`）
不带 placeId 而带 `i>0` → 400。测试补一条。

完成标准：`npx vitest run tests/planAgent tests/googlePlaces tests/tripPlan` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增错误；line-budget 通过；简短中文汇报。
