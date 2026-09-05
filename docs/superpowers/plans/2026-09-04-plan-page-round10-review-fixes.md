# 第十轮审查修复（2026-09-04）

背景：第十轮 A1、B1–B4 已实现并全绿（354 文件 / 2680 用例），独立审查发现下列问题。工作方式同前：每条先补失败测试再改；**不要 git commit**；**不跑迁移**；line-budget 必须通过。
- A（后端，glm-5.3）只碰 `lib/anitabi/handlers/imageServeCache.ts`、`lib/anitabi/handlers/imageServeRenderCache.ts`、`lib/anitabi/handlers/imageServe.ts`（≤ 813 行，尽量不动）、`tests/anitabi/**`。
- B（前端，kimi k3）只碰 `app/(authed)/plan/[id]/**`、`components/route/**`、`components/map/utils/mapImageLoadedCache.ts`、`components/map/ResilientMapImage.tsx`、`tests/plan/**`、`tests/route/**`、`tests/map/**`。
两边并行、文件不相交，不要碰对方范围。

## A. 后端

### M8 CF 渲染缓存命中时也要能回 304（`imageServeRenderCache.ts`）
现状：`matchRenderCache` 用不带请求头的 `Request(canonicalUrl)` 去 `caches.default.match`，命中直接回 200 全 body，R2 路径的 304 逻辑在边缘缓存命中时永远走不到。
改法：`matchRenderCache(requestUrl, ifNoneMatch?: string | null)`——命中且 `cached.headers.get('ETag')` 存在并 `matchesIfNoneMatch(ifNoneMatch, etag)` 时，返回 `withRenderCacheState(buildNotModifiedResponse(etag), 'HIT', …)`（保留现有 `X-Seichigo-Render-Cache` 等状态头）。`imageServe.ts` 调用处只多传一个参数（`req.headers.get('if-none-match')`）。
测试 `tests/anitabi/imageServe.etag.test.ts` 补：mock `caches.default.match` 返回带 `ETag:"abc"` 的 200 → 请求带 `If-None-Match:"abc"` 得 304、无 body、带 Cache-Control 与渲染缓存状态头；不匹配 → 200。

### L9 弱比较双向（`imageServeCache.ts`）
`matchesIfNoneMatch`：比较前把两侧的 `W/` 前缀都剥掉再比。测试补 `('"abc"', 'W/"abc"')` → true。

### L10 304 也过渲染缓存状态头（`imageServe.ts` 三处 R2 分支）
`mirrored.notModified` 分支的响应同样带 `X-Seichigo-Render-Cache`（口径与 200 一致，值 `BYPASS` 或现有约定）。如 `withRenderCacheState` 未导出，从 `imageServeRenderCache.ts` 导出；imageServe.ts 不得超 813 行。测试补一条断言 304 带该头。

完成标准：`npx vitest run tests/anitabi` 全绿；`npx tsc --noEmit` 无错；line-budget 通过；简短中文汇报。

## B. 前端

### H1 `stop()` 清空队列（`hooks/planPrewarmQueue.ts`、`usePlanImagePrewarm.ts`）
`stop()` 同时 `pending.length = 0`、`queued.clear()`（在飞的照常 abort）。测试：enqueue 10 → 加载 2 张后 `stop()` → `start()` + enqueue 另一组 → 只加载新组，旧组不再出现。

### H2 预热加载必须可中止且有超时（`planPrewarmQueue.ts`）
`defaultLoadImage(url, signal)`：`setTimeout(15_000)` 与 `signal` abort 任一触发 → `image.src = ''`、`onload/onerror = null`、reject；成功/失败/超时都必须让 `runOne` 的 `finally` 释放 lease。测试（假计时器 + 注入永不 settle 的 loadImage）：3 张挂起 → 15 秒后 lease 全部释放且队列继续推进；`stop()` 后挂起的 3 张立即释放。

### M3 marker ↔ 条目联动跨"列表/地图"tab 可见（`DayCards.tsx`、`DayMap.tsx`、`RoutePreviewMap.tsx`）
现状：marker 点击立刻 `setView('list')` 把地图卸载，Popup 同帧被销毁；条目点击时地图未挂载，高亮不可见。改为：
- marker 点击**不切 tab**：在地图上弹 Popup（标题 + 「查看条目」小按钮）；点「查看条目」才 `setView('list')` 并 scrollIntoView + 1.5 秒高亮环。Popup 用 `maplibregl.Popup({ closeButton: true, offset: 14 })`；`RoutePreviewMap` 的 `onPointSelect(id)` 语义改为"marker 被点选"（只设 `activePointId`），新增可选 `renderPopup?: (id) => HTMLElement | null`（DayMap 传入构造含按钮的元素，按钮回调由 DayMap 提供 `onRequestShowItem(id)`）。
- 列表条目行尾新增「在地图上看」图标：`setActivePointId(id)` + `setView('map')`；地图挂载后 `activePointId` 生效（marker 放大、`easeTo`、自动打开该点 Popup）。条目本身的 `onClick` 保持只设 `activePointId`。
- `tests/plan/dayCards.test.tsx` 现有 3 条联动用例按新语义改：mock 触发 `onPointSelect` → 仍在 map tab、`activePointId` 已传；点「在地图上看」→ 切到 map tab 且 `activePointId` 为该条目；「查看条目」回调 → 切回 list 且条目 `data-active=true`。

### M4 marker 重建/切天时关闭 Popup（`RoutePreviewMap.tsx`）
`rebuildMarkers` 开头 `closePopup()` 并清 `popupPointIdRef`；卸载时也关闭。测试放 `tests/route/routePreviewMarkers.test.tsx` 或以 helper 形式抽出可测。

### M5 「展开」按钮与缩放控件重叠（`DayMap.tsx`）
布局：NavigationControl 保持右上；「展开」移到右下（`right-3 bottom-3`）；「路线加载中…」左上；「参考路线（示意）」左上第二行（`left-3 top-9`）；「路线加载失败 · 重试」左下。展开态内部同样避免遮挡（展开态可不显示「展开」）。

### M6 持久化条目首次使用不得绕过调度器（`mapImageLoadedCache.ts`、`ResilientMapImage.tsx`）
从 sessionStorage 水合的条目标记为 `persisted`（未在本会话验证）：
- `hasLoadedMapImage(url)` 只对本会话 `onload` 验证过的返回 true；新增 `hasPersistedMapImage(url)`。
- `ResilientMapImage`：`persisted` 命中 → 跳过视口门控（直接视为 inView）、**仍然申请 lease**、仍挂计时器，首选该候选；`onload` 后 `rememberLoadedMapImage` 升级为已验证。已验证命中的行为不变。
- 预热队列的去重用 `hasLoadedMapImage`（已验证），刷新后 persisted 的 URL 仍会进队（走浏览器缓存，很快）并被验证。
- 测试 `tests/map/mapImageLoadedCache.test.ts` 补：水合后 `hasPersisted` true / `hasLoaded` false；`remember` 后两者 true。`tests/map/resilientMapImage*.test.tsx`（若已有）或新文件补：persisted 命中时 `acquire` 被调用一次。

### M7 途经点上限不能在渲染期读 `matchMedia`（`DayCards.tsx`、`navigationLinks.ts`）
`maxWaypoints` 用 `useState(9)`，`useEffect` 里 `matchMedia('(pointer: coarse)')` 为真时改 3；首屏一律按 9 渲染，避免 hydration mismatch。`buildDayNavigationUrls` 不再自己读 `matchMedia`（保留纯函数签名，默认 9）。测试补：`day-cards.test.tsx` 首渲染 12 点 → 2 段。

### L11 写回用 idle 回调（`mapImageLoadedCache.ts`）
`requestIdleCallback` 存在时用它（timeout 1000），否则 `setTimeout(500)`。

### L13 展开态焦点（`DayMapExpanded.tsx`）
打开时把焦点移到关闭按钮，关闭时还原到触发元素；`aria-modal="true"`、`aria-label="第 N 天 · 路线"`。测试补一条焦点断言。

### L15 无 `onPointSelect` 时 marker 不可点、无 Popup（`routePreviewMarkers.ts`、`RoutePreviewMap.tsx`）
`createNumberedMarker(layout, { color, active, clickable })`：`clickable=false` 不加 `cursor:pointer`、不挂 click。`RoutePreviewMap` 只在 `onPointSelect` 或 `renderPopup` 存在时 `clickable=true`。路书页（`PlannerMapStage`）不传回调 → 行为与本轮前一致。测试补一条。

### L16 条目键盘可达（`DayCards.tsx`）
可点选的 `<li>` 加 `role="button" tabIndex={0}`，Enter/Space 触发同 onClick。

### L17 高亮环定时器（`DayCards.tsx`）
`flashPointId` 无论当前 tab 都设置 1.5 秒清除定时器；切天/卸载时清定时器。

完成标准：B `npx vitest run tests/plan tests/route tests/map` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过（`DayCards.tsx`、`RoutePreviewMap.tsx` 若逼近 750 继续抽新文件）；简短中文汇报（改动文件、行数、测试）。
