# 按天行程本 B3/B4 前端审查修复（2026-09-24）

> 执行者须知：先读主计划 `docs/superpowers/plans/2026-09-23-routebook-day-planner.md` 顶部硬约束。可改 `app/(authed)/me/routebooks/**`、`components/navigation/**`、`lib/i18n/locales/*.json`、`tests/routebooks/**`；**为 G1 允许最小改动 `components/route/RoutePreviewMap.tsx`（新增可选 prop，/plan 行为不变）**。不碰其它 `lib/**`、`app/api/**`。不 push、不 migrate。完成标准：typecheck 0 错；`npx vitest run --project jsdom tests/routebooks` + `npx vitest run tests/i18n tests/plan` 全绿；`npm test` 全绿；简短中文汇报。路径相对 `app/(authed)/me/routebooks/[id]/`。

## Blocker

- **G1 移动端地图首次显示不取景**：`components/MobileLayout.tsx:85,124-128,200-202`——默认 tab 为计划，地图挂在 `display:none` 容器里（0×0），`fitBounds` 无效，切到地图 tab 只 `resize` 不重新取景，停在初始缩放。改法（二选一，推荐 A）：A) 非活动的地图容器不用 `hidden`，改为保持真实尺寸但不可见且不占交互：`invisible pointer-events-none absolute inset-x-0 -z-10`（外层 `relative`，高度仍为 `COMPACT_MAP_HEIGHT`）；B) `RoutePreviewMap` 加可选 `refitNonce?: number`，变化时 `map.resize()` 后重新 `fitMapToPreview`，`MobileLayout` 在切到地图 tab 与 `selectedDayId` 变化时递增。测试：mock `RoutePreviewMap` 记录 fit/refit 调用，断言首次切到地图 tab 后发生了取景。

## Should-fix

- **G2 高德回退计时器**：`components/navigation/navLaunch.ts:43-57`——在 `visibilitychange`(hidden)/`pagehide`/`blur` 时清除计时器并移除监听；iOS 上不要用当前 tab 跳网页版（弹出被拦截时改为在菜单里显示「网页版」一行让用户点）；Android 用 intent URL：`intent://route/plan/?...#Intent;scheme=amapuri;package=com.autonavi.minimap;S.browser_fallback_url=<encodeURIComponent(webUrl)>;end`，不再需要计时器。测试补「hidden 后又 visible 不再打开网页版」。
- **G3 长按触发系统选区**：`components/TimelineItem.tsx:181,205` 移动端行加 `select-none [-webkit-touch-callout:none]`，缩略图 `<img draggable={false}>`。
- **G4 未安排视图与选中天同步**：`components/MobileLayout.tsx:86,296`、`ui.tsx:157-161`——把 `unassignedView` 提升到 `ui.tsx`（或 `useEffect` 在 `selectedDayId` 非空时置 false）；从未安排视图点「开始」→ 选天 → 返回后胶囊/列表/地图/按钮文案一致。测试覆盖。
- **G5 方式切换入口**：`components/mobile/MobileDock.tsx:106,141` 只要 `selectedDay` 存在就能打开导航 sheet，方式切换始终可用，三家地图列表只在有 targets 时渲染。
- **G6 途经点上限去重且触屏感知**：把 `MobileLayout.tsx:108-112` 的检测抽成 `components/navigation/navLaunch.ts` 的 `useMaxNavWaypoints()`（`pointer: coarse` 或移动 UA → 3，否则 9），`DayBlock` 与 `MobileLayout` 共用。

## Nit

- **G7** 外部点击关闭用 `pointerdown`（`OpenInMapsMenu.tsx:168`、`ExportMenu.tsx:116`）。
- **G8** 删除三语里无用键 `routebook.card.googleMaps`、`routebook.mobile.navGoogle`、`routebook.mobile.navSheetTitle`、`routebook.mobile.viewDay`；`routebook.sidebar.openNav` 改用 `routebook.nav.open`。
- **G9** `utils.ts dayNavStops` 住宿名不要按坐标匹配，改用 `lib/routeBook/anchors.ts` 的 `resolveDayAnchorStops`（只读 import）。
- **G10** `hooks/useWeather.ts:116-119` 空结果不缓存 1 小时（缓存 5 分钟）；`!res.ok` 时清掉旧数据。
- **G11** `ui.tsx:396` toast 断点用 `min-[769px]:bottom-6`。
- **G12** `DaySummaryBar.tsx:84`、`MobilePlanView.tsx` 的 `MoveToSheet` 底部加 safe-area。
- **G13** `utils.ts:202 nextDayFirstStopTitle` 向后找第一个有站的天，而不只看下一天。
- **G14** `utils.ts:65` 孤立 JSDoc 删掉；`OpenInMapsMenu` 的排序检测在点击时同步做（去掉打开后的闪动）。
- **G15 测试补齐**：沉浸模式撤销打卡（含最后一站）；G2 序列；`useWeather` TTL 过期与锚点变化重取；G4 流程；G1 取景。
