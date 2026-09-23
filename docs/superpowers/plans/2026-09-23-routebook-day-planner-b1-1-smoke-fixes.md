# 按天行程本 B1.1 冒烟反馈修复（2026-09-23）

> 执行者须知：先读 `docs/superpowers/plans/2026-09-23-routebook-day-planner.md` 顶部硬约束（不 push、不 migrate dev/reset/db push、≤750 行、不 `as any`、`$transaction` 只用 `tx`、路由 `runtime='nodejs'`、不碰 `features/map/**` 与 `components/map/**`）。本文件是负责人在预览环境冒烟后的 5 条反馈。**A（后端）与 B（前端）由两个会话并行**：A 只改 `lib/**`、`prisma/**`、`app/api/**`、`tests/routeBook/**`、`tests/tripPlan/**`、`tests/googlePlaces/**`；B 只改 `app/(authed)/me/routebooks/**`、`components/route/**`、`tests/routebooks/**`。各自 commit（不 push），撞 `index.lock` 就等几秒重试。
>
> 完成标准：`npm run typecheck:app`、`npm run typecheck:tests` 0 错；A 跑 `npx vitest run tests/routeBook tests/tripPlan tests/googlePlaces`，B 跑 `npx vitest run --project jsdom tests/routebooks tests/route`；简短中文汇报。

## 负责人原话（需求真值）

1. 「路线仍然是点位连线，我们明明做了实际路线在底图上渲染，还是实际渲染效果比较好。」
2. 「1 2 3… 分天的点位不用一次全部选出来，这样点位很乱：一开始加载可以全部显示，当用户点击具体某一天的列表时，就应该只显示当天的点位和路线。」
3. 「点位中应该有每个点上的点位图片预览（模仿 /map 页的交互），点一下可以显示点位详情；非作品点位返回该点位的谷歌点位介绍，不放图。」
4. 「个人地图页面缺少导航栏，只有一个返回地图页按钮，需要修复。」

## 前后端契约

- `GET /api/me/routebooks/[id]/days/[dayId]/legs` 响应新增 `dayGeometry: { type: 'LineString', coordinates: [lng, lat][] } | null`（整天真实道路几何，含住宿首尾），其余字段不变。
- `RouteBookPlace` 新增 `googlePlaceId: string | null`，`GET /` 详情响应里的 `places[]` 带它。
- 新接口 `GET /api/me/routebooks/[id]/places/[placeId]/intro` → `{ ok: true, intro: { name, address, rating, userRatingsTotal, summary, openingHours: string[], website, mapsUrl } }`；无 `googlePlaceId` 或上游无结果 → 404 `{ error: '该地点暂无谷歌信息' }`。所有字段除 `name` 外都可为 null。

---

## A. 后端（zhipuai glm-5.3）

### A1 整天真实道路几何
现有 `lib/routeBook/handlers/routeGeometry.ts` 已经会用 Mapbox Directions 把多个点串成道路几何（旧路线本页面就是调它的 `/route-geometry?points=…&mode=walking`）。把它里面"给定有序坐标 + mode → 调 Mapbox → 返回 LineString/distance/duration"的核心抽成纯函数模块 `lib/routeBook/mapboxRoute.ts`（`fetchMapboxRoute(stops: {lat,lng}[], profile: 'walking'|'driving'|'cycling', deps: { token, fetch })`），原 handler 改为调用它（行为与响应不变，`tests/routeBook/routeGeometry.test.ts` 必须继续通过）。
然后 `lib/routeBook/handlers/legs.ts`：算完 `legs` 后，用同一停靠序列（含 `lodging:start/end`）调 `fetchMapboxRoute`，profile 映射 `walking→walking`、`driving→driving`、`transit→walking`（Mapbox 无公交，旧页面也是 walking）；结果放 `dayGeometry`，失败/无 token/少于 2 站 → `null`，不影响 `legs`。缓存：用 `lib/routeBook/legCache.ts` 的表，key = `sha256('dayroute|' + profile + '|' + 所有站点 lat5,lng5 用 ; 连接)`，TTL 7 天。Mapbox token 沿用 `routeGeometry.ts` 现在读的环境变量。
测试：`tests/routeBook/legs.test.ts` 加 "dayGeometry 有/无（mock fetch）" 两例；`mapboxRoute.test.ts` 覆盖 URL 拼接与错误返回 null。

### A2 自定义点带谷歌 placeId
- `prisma/schema.prisma` `RouteBookPlace` 加 `googlePlaceId String?`；新迁移目录 `prisma/migrations/20260923150000_routebook_place_google_id/migration.sql`：`ALTER TABLE "RouteBookPlace" ADD COLUMN "googlePlaceId" TEXT;`（用 `prisma migrate diff` 生成核对）。开发库按 B1 任务 1 的方式 `db execute` + `migrate resolve --applied`，然后 `prisma generate`。**生产由负责人另行应用，不要碰。**
- `lib/routeBook/repo.ts` `PlaceInput` / `RouteBookPlace` 加 `googlePlaceId?: string | null`；Prisma 与内存仓储、`handlers/places.ts` 的 zod（`z.string().max(200).nullable().optional()`）、详情响应都带上。
- `lib/tripPlan/exportMapping.ts`：建 place 时把 `payload.place.placeId` 写进 `googlePlaceId`（`ExportPlace` 加字段，`exportStorePrisma.ts` 写入）。`tests/tripPlan/exportRouteBook.test.ts` 加断言。

### A3 谷歌点位介绍接口
- 新建 `lib/googlePlaces/details.ts`：`createPlaceDetails(deps: { apiKey: string; fetchImpl?: typeof fetch })` → `getPlaceIntro(googlePlaceId, language: 'zh-CN'|'en'|'ja')`，调 `https://maps.googleapis.com/maps/api/place/details/json?place_id=…&fields=name,formatted_address,rating,user_ratings_total,editorial_summary,opening_hours,website,url&language=…&key=…`，映射成契约里的 `intro`（`summary = editorial_summary.overview ?? null`，`openingHours = opening_hours.weekday_text ?? []`，`mapsUrl = url`）。key 的读取方式照 `lib/googlePlaces/nearby.ts` / `api.ts`。**不请求 photos。**
- 缓存：`legCache.ts` 的表，key `place-intro|<lang>|<placeId>`，TTL 7 天。
- `lib/routeBook/handlers/placeIntro.ts` + 路由 `app/api/me/routebooks/[id]/places/[placeId]/intro/route.ts`：鉴权 + 归属校验（place 必须属于本行程本），语言取 `?lang=`（默认 zh-CN）。每用户每分钟 30 次限流（照 `routeGeometry.ts` 的 `checkRateLimit`）。
- `RouteBookApiDeps` 加 `placeIntro: (googlePlaceId, lang) => Promise<PlaceIntro | null>`（Prisma 工厂用真实实现，测试注入假的）。
- 测试：`tests/googlePlaces/details.test.ts`（mock fetch：正常映射、ZERO_RESULTS → null、缺字段为 null）；`tests/routeBook/handlers.test.ts` 加 intro 路由的 401/404/200。

---

## B. 前端（kimi k3）

### B1 地图显示模式：全部 → 单天
`app/(authed)/me/routebooks/[id]/ui.tsx` + `components/PlannerMapStage.tsx` + `hooks/`：
- 页面加载时 `selectedDayId = null`：地图显示**全部**天的点位（徽标仍显示 Day 序号，如 `1·3`）与未安排点位（空心），**不画路线**。
- 用户点击左栏某一天（标题行）→ `selectedDayId` 设为该天：地图**只显示该天的点位**（其它天与未安排的标记全部不渲染，不是变淡）+ 该天路线；`fitBounds` 到该天点位。
- 再点一次同一天标题 或 左栏工具栏新增「显示全部」按钮 → 回到全部模式。移动端：日期胶囊轨道增加一个「全部」胶囊，语义相同。
- 右栏「+」在全部模式下加到「未安排」，单天模式下加到选中天（现有逻辑不变）。

### B2 真实道路路线
`hooks/useRouteGeometry.ts` / `PlannerMapStage.tsx`：legs 响应带 `dayGeometry` 时，把它作为一条实线（亮芯 + 暗壳，现有样式）传给 `RoutePreviewMap` 的 `routeGeometry`（这正是 /plan 在用的 prop，无需新样式）；`legs` 分段虚线只在 `dayGeometry === null` 时作为回退。连接行的时长/距离仍用 `legs`。

### B3 缩略图标记（模仿 /map）
`components/route/routePreviewMarkers.ts`（与 `RoutePreviewMap.tsx`）新增可选 prop `markerImages?: Record<pointKey, string | null>`：
- 有图：圆形缩略图（直径 44px，白色 2px 描边，`object-fit: cover`，加载失败回退为现有序号圆点），右下角保留序号徽标。视觉参考 `/map` 页（`components/map/CompleteModeLayers.ts` 的缩略图层——只看不改）。
- 无图（自定义点）：按 `kind` 显示 lucide 图标圆点（lodging=`bed`、restaurant=`utensils`、station=`train`、other=`map-pin`），底色 `#0f172a`。
- 选中态放大到 56px + 品牌色描边。`/plan` 不传该 prop 时样式与现在完全一致。
- `PlannerMapStage.tsx` 用 `getPointPreview(pointId).image` 填 `markerImages`。

### B4 点位详情
新建 `components/PointDetailCard.tsx`（桌面：浮在地图左下角的卡片，宽 360px；移动端：底部抽屉），由 `RoutePreviewMap` 的 `onPointSelect` 触发（同一标记再点或 ✕ 关闭）：
- **作品点位**：顶部大图（`getPointPreview.image`，无图用现有渐变占位）、名称、作品名、地址（详情接口如已返回则显示）、按钮：「在巡礼地图查看」（链接 `/map?point=<pointId>`，与 /map 现有深链参数一致——去 `features/map/anitabi/shared.ts` 查参数名，只读）、「Google 地图」（单点深链，复用 `utils.buildGoogleDirectionsUrl`）、「从当天移除」/「移到…」（复用时间线条目的操作）。
- **自定义点**：**不放图**。名称、kind 标签、地址；挂载时 `GET /places/[placeId]/intro?lang=<locale>`，成功后显示评分（★ 4.3 · 1,234 条）、简介 `summary`、营业时间（可折叠）、网站、「在 Google 地图打开」（`mapsUrl`）；404 时显示「暂无谷歌信息」。加载中骨架。
- 状态放在 `ui.tsx`（`selectedPointKey`），左栏时间线点击条目也应打开同一张卡片并让地图飞到该点。
- jsdom 测试 `tests/routebooks/PointDetailCard.test.tsx`：作品点位渲染图与作品名；自定义点渲染 intro 且不渲染 `<img>`；404 显示占位文案。

### B5 导航栏
`ui.tsx`：去掉自定义顶栏（SeichiGo logo + 「返回我的地图」那一段）与 `data-layout-immersive="true"`，保留 `data-layout-wide="true"`，让 `app/(authed)/layout.tsx` 的 `SiteShellPublic` 站点页头正常显示（隐藏规则在 `styles/globals.css:26-38`：`.site-shell-public:has([data-layout-immersive='true']) > header/footer` 被隐藏；只要行程本页不再打这个属性即可，**不要改 CSS**，`components/plan/PlanShell.tsx` 仍靠它）。页头下方保留一行细面包屑：「我的地图 › 《行程标题》」（标题可点进入改名，沿用现有 `handleTitleSave`）。移动端同样显示站点页头；底部「开始 Day N」按钮不变。骨架屏 `RouteBookDetailSkeleton` 同步去掉 immersive。
