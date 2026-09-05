# 第十一轮验收回归修复：marker 漂移与路线断段（2026-09-05）

工作方式同前：先补失败测试再改；**不要 git commit / git stash**；不跑迁移；line-budget 必须通过（`RoutePreviewMap.tsx` 715、`DayMap.tsx` 183、`DayCards.tsx` 644，新逻辑放新文件）。只碰 `app/(authed)/plan/[id]/**`、`components/route/**`、`tests/plan/**`、`tests/route/**`。

## R1 点击 marker 后所有 marker 漂到地图左上角（`components/route/routePreviewMarkers.ts`、`RoutePreviewMap.tsx`）
取证：用户截图——点一次 marker 后，marker 3/4/5 叠在地图左上角，路线仍在原位。`routePreviewMarkers.ts:90` 的 `applyMarkerActive` 给 **marker 根元素**写 `el.style.transform = translate(offset) scale(...)`。maplibre 用根元素的 `transform` 定位 marker，被覆盖后位置归零（地图原点）。`activePointId` 变化时对**所有** marker 调用该函数，所以不止被点的那个漂。第十轮 B3 引入。
改法：
- marker 根元素只交给 maplibre（不写 `transform`、不写 `left/top`）。视觉圆片放在**内层** `<span>`（编号、边框、背景、阴影、尺寸都在内层）；重叠错位改用 `new maplibregl.Marker({ element, offset: [offsetX, offsetY] })` 传给 maplibre，而不是自己写 transform。
- `applyMarkerActive(el, active)` 只改内层元素的 `transform: scale(1.25)`、背景/文字色、根元素 `zIndex`。
- 测试 `tests/route/routePreviewMarkers.test.tsx`：`createNumberedMarker` 返回的根元素 `style.transform` 为空串；`applyMarkerActive` 前后根元素 `style.transform` 仍为空串，内层元素含 `scale(1.25)`；`buildMarkerLayouts` 的 offset 通过返回值暴露（供 Marker `offset` 使用）。`RoutePreviewMap` 在 jsdom 里被 mock，无法直接测；把"创建 Marker 时传 offset"抽成纯函数 `markerOptionsFor(layout)` 一并测。

## R2 有部分真实 polyline 时路线断段（`app/(authed)/plan/[id]/components/dayRouteGeometry.ts`、`DayMap.tsx`）
取证：用户截图 Day 2——只有 8→9→10→11 与个别段有线，1/3/4/5/6/7 之间没有任何连线。`DayMap.tsx:61-73`：只要 `collectProviderGeometry(day.items)` 收集到 ≥2 个坐标，就**只**画这些 provider polyline（真实 Google 路线），其余没有 polyline 的段（估算段、日本公交参考段）既不请求路网兜底也不画直线。第九轮之后交通段部分升级为真实路线，于是从"整天一条兜底线"变成"只有几段真实线"。
改法（新文件 `app/(authed)/plan/[id]/components/dayRouteCompose.ts`）：
- `composeDayRoute(dayPoints, items): { coordinates: [lng,lat][]; coverage: 'provider' | 'mixed' | 'none' }`：按 `dayPoints` 顺序逐段处理相邻两点：找到位于这两个条目之间的 transit 条目，其 `transport.polyline` ≥2 个点且首尾与两端点距离 ≤ 300 m → 用该 polyline；否则用两端点直线。所有段首尾相接拼成一条 LineString（去掉相邻重复坐标）。`coverage`：全部段都有 polyline → `provider`；部分 → `mixed`；一段都没有 → `none`。
- `DayMap`：`coverage === 'provider' | 'mixed'` → 直接用拼好的几何，`sourceLabel` 分别为 `'provider'` / `'mixed'`（`mixed` 时右上角标注「部分示意」）；`coverage === 'none'` → 保持现有兜底流程（`fetchRouteGeometry` 路网几何，失败显示重试）。
- 测试 `tests/plan/dayRouteCompose.test.ts`：3 个点、中间一段有 polyline → 输出 = 直线段 + polyline 段拼接、coverage `mixed`；两段都有 → `provider`；都没有 → `none`；polyline 首尾离端点 >300 m → 视为无 polyline；相邻重复坐标去重。`tests/plan/dayCards.test.tsx`（或 `dayMapPopup.test.tsx`）补一条：mixed 时 mock 的 RoutePreviewMap 收到的 `routeGeometry.coordinates` 覆盖所有点位（每个点位坐标都出现在线上或距线 ≤ 1 m）。

完成标准：`npx vitest run tests/plan tests/route` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过；简短中文汇报（改动文件、行数、新增测试）。
