# 按天行程本 B2 派发单（2026-09-23）

> 执行者须知：主计划是 `docs/superpowers/plans/2026-09-23-routebook-day-planner.md`（先读顶部硬约束与「评审修订记录」，再读 **B2 任务 13–17**）。B1 与两轮冒烟修复（`…-b1-fixes.md`、`…-b1-1-smoke-fixes.md`、`…-b1-2-smoke-fixes.md`）已全部合并上线，本文件只说明 B2 的分工、契约和 B1 之后代码现状的差异；任务细节以主计划为准，与本文件冲突时以本文件为准。**A（后端）与 B（前端）并行**：A 只改 `lib/**`（不含 `lib/i18n`）、`app/api/**`、`prisma/**`、`tests/routeBook/**`、`tests/share/**`；B 只改 `app/(authed)/me/**`、`components/route/**`、`components/me/**`、`lib/i18n/locales/*.json`、`tests/routebooks/**`。各自 commit（不 push），撞 `index.lock` 等几秒重试。
>
> 完成标准：`npm run typecheck:app`、`npm run typecheck:tests` 0 错；A 跑 `npx vitest run tests/routeBook tests/share`，B 跑 `npx vitest run --project jsdom tests/routebooks tests/route` 与 `npx vitest run tests/i18n`；`npm test`（含 750 行预算）全绿；简短中文汇报。

## B1 之后的代码现状（已核实，不用再查）

- `lib/routeBook/legs.ts` 已有 `LegResolver` 类型与 `resolveDayLegs(stops, agentLegs, defaultMode, resolver)`；`handlers/legs.ts` 的 `createLegHandlers(deps, resolver = async () => null)` 现在恒走 heuristic。`GET /days/[dayId]/legs?sig=` 响应已含 `legs[]`、`stops[]`、`staleTransitItemIds`、`dayGeometry`（Mapbox 整天几何）。
- `lib/routeBook/legCache.ts` 已有 `getCachedLegs(keys[])`/`setCachedLeg(key, payload, ttlDays)`（`RouteLegCache` 表，sha256 via `crypto.subtle`）；`dayGeometry.ts`、`placeIntro.ts` 都在用它。
- `RouteBookApiDeps`（`lib/routeBook/api.ts`）已有 `pointCoords`、`placeIntro`、`readDayGeometryBySig`、`fetchDayGeometry`。
- `RouteBookPlace` 已有 `googlePlaceId`；`GET /places/[placeId]/intro` 已存在；自定义点在右栏与地图已能显示（B1.1），但**还没有**新建/编辑自定义点的 UI（`PlaceEditorDialog`）、住宿 UI（`LodgingDialog`）、备注 UI（`NoteEditorDialog`）、天顺序弹窗（`DayOrderDialog`）、连接行点击改方式。`POST/PATCH/DELETE /places`、`/lodgings` 接口后端已可用。
- 撤销环 `lib/routeBook/undoRing.ts`? —— **不存在**；现有撤销逻辑在 `app/(authed)/me/routebooks/[id]/hooks/useUndoRing.ts`（前端），工具栏已有撤销按钮。
- 前端：`components/` 下有 `DayBlock/DayPlanSidebar/LegConnector/TimelineItem/UnassignedBlock/PointDetailCard/PlannerMapStage/PlannerPointPoolPanel/RouteBookImmersiveMode/StartDayPickerSheet/MobilePointPoolSheet`；hooks 有 `useTripData/useTripMutations/useTripDnd/useDayLegs/useRouteGeometry/useUndoRing/usePointPreviews`。`components/route/RoutePreviewMap.tsx` 已支持 `legs`、`markerVariants`、`markerImages`、`onMarkerPointerDown`、`onMapContextMenu`（右键/长按回调已存在但页面还没接「在这里添加自定义点」）。
- **行数预算告急**：`[id]/ui.tsx` 689 行、`hooks/useTripMutations.ts` 730 行、`RoutePreviewMap.tsx` 516 行。B 部分任何往这三个文件加代码前必须先拆：`useTripMutations.ts` 拆成 `useItemMutations.ts` / `useDayMutations.ts` / `usePlaceLodgingMutations.ts`；`ui.tsx` 把弹窗编排抽到 `components/DialogsHost.tsx`。
- 文案：全部走 `t('routebook.…', locale)`（`lib/i18n/locales/{zh,en,ja}.json` 的 `routebook.*` 命名空间），三语同时加；`tests/i18n` 会检查三语键一致。
- 地址搜索：`lib/share/geocode.ts` 只有反向地理编码 `fetchMapTilerAddresses`；正向搜索需新建（A1）。
- 日本境内 `transit` 不调 Google（`lib/directions/googleClient.ts:143-149`，ZERO_RESULTS）。

## 契约

1. `GET /api/geocode/search?q=<text>&lang=<zh|en|ja>&near=<lat,lng>` → `{ ok: true, results: [{ title, address, lat, lng }] }`（≤5 条；登录用户；每用户 30 次/分钟；无 key 或上游失败 → `{ ok: true, results: [] }`）。
2. `GET /days/[dayId]/legs` 的 `legs[].source` 现在可为 `'google' | 'agent' | 'heuristic'`，`google` 段带 `polyline`；前端连接行按 source 区分样式（google 实线、agent 标「AI 已查」、heuristic 虚线「估算」）。整天几何 `dayGeometry` 仍是地图主线；连接行时长/距离用 `legs`。
3. `PATCH /items/[itemId]` 已接受 `legMode`（`transit|walking|driving|null`）——连接行改方式只调它。

## A. 后端（zhipuai glm-5.3）— 主计划任务 13（后端部分）+ 15

- **A1 正向地址搜索**：`lib/share/geocodeSearch.ts`（MapTiler `GET https://api.maptiler.com/geocoding/{encodeURIComponent(q)}.json?key=…&language=<lang>&limit=5&proximity=<lng,lat>`，key 与 `fetchMapTilerAddresses` 同一环境变量）+ `app/api/geocode/search/route.ts`（`runtime='nodejs'`，鉴权，限流照 `routeGeometry.ts` 的 `checkRateLimit` 30/min，Zod 校验 q 1–120 字）。测试 `tests/share/geocodeSearch.test.ts`（解析、无 key 空数组、上游 500 空数组）。
- **A2 Google 步行/驾车段**：主计划任务 15，按「评审修订」：`lib/routeBook/legResolverGoogle.ts` 只处理 `walking|driving`，`transit` 返回 null；两端 `isWithinJapan` 才调 `fetchGoogleDirections`；polyline 用 `decodePolyline(readOverviewPolyline(body))`；缓存 key `leg|<mode>|lat5,lng5|lat5,lng5`，TTL 7 天，用 `legCache.ts`；`handlers/legs.ts`：先 `getCachedLegs` 批量读，未命中的并发 4、整体 8 秒截止，超时的段 heuristic；每用户每分钟 10 次限流。`RouteBookApiDeps` 加 `legResolver: LegResolver`（Prisma 工厂用 Google 实现，`createLegHandlers` 默认取 `deps.legResolver`）。测试：`tests/routeBook/legResolverGoogle.test.ts`、`legs.test.ts` 加并发/截止（fake timers）与缓存命中不调 Google。
- 汇报要带：新增/改动文件、测试数。

## B. 前端（kimi k3）— 主计划任务 13（UI）、14、16、17

先做拆文件（见上「行数预算告急」），再做功能：

- **B1 自定义点与住宿 UI**（任务 13）：`PlaceEditorDialog.tsx`（kind 四选、名称、地址搜索框调契约 1 并可选结果自动填坐标、小地图微调可用 `RoutePreviewMap` 的 `interactive` 单点模式或简单经纬度输入、备注）；右栏「+ 添加自定义点」；地图 `onMapContextMenu` → 打开对话框并预填坐标 + 反向地理编码（调现有 `/api/…` 若有暴露，没有就只填坐标）；`LodgingDialog.tsx`（选已有 lodging 自定义点或新建、入住日..退房日、可选时间）；`DayBlock` 标题行住宿徽标（绿入住/红退房/灰续住）+「添加住宿」；`DayDetailCard.tsx`（地图右上可折叠：住宿卡；天气位置留空给 B4）。
- **B2 备注**（任务 14）：`NoteEditorDialog.tsx`（标题、详情、10 图标、6 颜色、可选时间）；`TimelineItem` note 卡按颜色着色；`DayBlock`「+ 备注」。
- **B3 连接行交互**（任务 16）：点击 → 菜单 步行/公共交通/驾车/用当天默认 → `updateItem(toItemId, { legMode })`；按 `source` 区分样式（契约 2）。
- **B4 天顺序弹窗 + 并发提示**（任务 17）：`DayOrderDialog.tsx`（dnd-kit 排序、任意位置插入、空天可删）；工具栏「调整天顺序」；409 `stale` → 顶部提示条「行程已在别处修改」+ 刷新。撤销 hover 显示上一步名称（若已有则跳过）。
- 测试：`tests/routebooks/PlaceEditorDialog.test.tsx`（提交 `onSubmit` 且 lat/lng 数字）、`NoteEditorDialog.test.tsx`、`LegConnector.test.tsx`（菜单项触发 `onChangeLegMode`）、`DayOrderDialog.test.tsx`（提交 `orderedDayIds`）。
- 三语文案同时加进 `routebook.*`。
