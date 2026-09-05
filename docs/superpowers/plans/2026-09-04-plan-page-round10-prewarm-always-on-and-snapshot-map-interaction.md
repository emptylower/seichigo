# 计划页第十轮：图片预热常态化 + 快照地图交互与导航（2026-09-04）

工作方式同前：先通读现状；每条先补失败测试再实现；**不要 git commit**；**不跑迁移**（本轮无 schema 改动）；`node scripts/check-line-budget.mjs` 必须通过（单文件 ≤ 750 行；`app/(authed)/plan/[id]/ui.tsx` 已满 750、`lib/anitabi/handlers/imageServe.ts` 在 allowlist 813，**新逻辑一律放新文件**）。
- A（后端，glm-5.3）只碰 `lib/anitabi/handlers/imageServe.ts`、`tests/anitabi/**`。
- B（前端，kimi k3）只碰 `app/(authed)/plan/[id]/**`、`components/route/**`、`components/map/utils/mapImageLoadedCache.ts`、`components/map/ResilientMapImage.tsx`（仅 B2 提到的一处）、`tests/plan/**`、`tests/route/**`、`tests/map/**`。两边文件集合不相交，并行进行，不要碰对方范围。

## 用户反馈与本轮取证

1. **预热回归**："Agent 定点时预热图片没问题；关闭后重新打开、或刷新后打开，就不再预热，仍是点开某一天才加载。"取证：
   - `lib/anitabi/handlers/imageServe.ts:22` 渲染路径 `Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800`，**没有 `max-age`，也没有 `ETag`/`Last-Modified`**（全文件 grep 为零）。浏览器私有缓存没有新鲜期与校验器，刷新后每张图都重新走网络（最多命中边缘）。
   - `app/(authed)/plan/[id]/hooks/usePlanImagePrewarm.ts:54-81` 预热是**串行单张**：`await` 一张加载完才排下一张；warmup 车道本可同时放行到总活跃 3。刷新后几秒内点 Day 3 时队列还远没轮到。
   - `components/map/utils/mapImageLoadedCache.ts` 的"已加载"记忆是模块级内存 Map，刷新即空；`ResilientMapImage` 只有命中它才跳过视口门控→lease→计时器链路（`ResilientMapImage.tsx:187,297-306`）。
   - `ui.tsx:146-150` `prewarmDays` 依赖整个 `chat` 数组，任何消息到达都会重启预热 effect（abort 后从头重排）。
2. **快照地图交互**："PC 端不能缩放；标了序号但没法交互，不知道对应哪个点；切换 Day 有显示异常。"取证：
   - `DayCards.tsx:298` `RoutePreviewMap interactive={false}` → `RoutePreviewMap.tsx:376-382` 禁 dragPan/scrollZoom/boxZoom/doubleClickZoom/keyboard，且不加 NavigationControl；原始设计（`specs/2026-08-31-plan-page-smoke-fix-design.md` §3.E）是"inline 防手势劫持，全交互在展开态"，但展开态从未落地。
   - marker 由 `createNumberedMarker`（`RoutePreviewMap.tsx:326-339`）生成，无 click、无 Popup、无高亮，唯一信息是原生 `title`。
   - 切天异常根因：`RoutePreviewMap.tsx:515-517` props effect 开头 `if (!map || !map.isStyleLoaded()) return`——被丢弃的更新**没有任何重试**。切天时 `points` 与 `routeGeometry` 会连续两次变化（`DayMap` 的 `providerGeometry`/`fetchRouteGeometry` 在 effect 里 `setGeometry`），前一次 `setData` 尚在加载时 `isStyleLoaded()` 为 false，后一次更新整体被丢，出现"marker 是新一天、路线还是上一天"或 fitBounds 没跟上。`mapStyleFailover.ts` 的 `shouldResyncRoutePreviewOnStyleEvent` 在图层已存在时也返回 false，不会补救。
3. **快照列表**："支持编辑和跳转导航页面可能好一些。"取证：快照/当前两种 scope 都没有编辑入口和点位导航；仅 transit 行的 `TransitConnector` 有"在 Google 地图打开"（`TransitConnector.tsx:149-159`）。历史快照按既有设计**不可悄悄修改**（`plans/2026-09-01-plan-agent-ask-variants-daymap-timeline.md` §5.4），所以"编辑"做成"把这一天/这个点位交给规划师调整"（预填聊天输入），不做原地改数据。

不在本轮：日本公交真实时刻表（NAVITIME/駅すぱあと，第二期）；地图页多点自选线路→导航/交给 AI 规划（下一轮单独设计，涉及 `features/map/**` 大文件）。

## §0 契约（两边都按此实现，不要各自发明第二套）

- **图片响应头（A1 → 浏览器）**：渲染路径统一 `Cache-Control: public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800`；R2 命中且对象有 `httpEtag` 时回 `ETag`，请求带匹配 `If-None-Match` 时回 `304`（无 body，保留 Cache-Control）。前端不依赖 ETag，只依赖 `max-age` 让同 URL 二次打开走本地缓存。
- **已加载记忆持久化键**：`sessionStorage['seichigo:mapImageLoaded:v1']` = JSON 字符串数组（归一化后的 URL，去 `_retry`），≤ 500 条，插入序。
- **RoutePreviewMap 新 props**（B3）：
  ```ts
  points: Array<{ id: string; lat: number; lng: number; label: string }>   // id 新增，必填
  activePointId?: string | null            // 高亮的点（marker 放大 + 主色环）
  onPointSelect?: (id: string) => void     // marker 点击回调
  interactive?: boolean                     // 语义不变：false=inline（协作手势），true=全交互
  ```
  DayCards 里 `dayRoutePoints` 的 `id` 用与列表 key 相同的内容签名（`${type}|${pointId}|${title}`，见 `DayCards.tsx` 现有 key 规则），保证 marker ↔ 列表条目一一对应。
- **导航链接（B4，纯函数 `app/(authed)/plan/[id]/lib/navigationLinks.ts`）**：
  - 单点：`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>&travelmode=transit`（起点留空 = 用户当前位置）。
  - 整日：`https://www.google.com/maps/dir/?api=1&origin=<lat,lng>&destination=<lat,lng>&waypoints=<lat,lng>|…&travelmode=transit`；Google Maps URLs 对 waypoints 上限桌面 9、移动端 3，按 `maxWaypoints` 参数切成多段（每段首尾相接），UI 上 ≤ 1 段显示一个按钮，多段显示"第 1 段 / 第 2 段…"。
- **"交给规划师调整"（B4）**：`DayCards`/`DaymapCard` 新增可选 `onComposeDraft?: (text: string) => void`；`ui.tsx` 把它接到现有输入框（设置 textarea 值 + focus，不自动发送）。预填文案：点位级 `请调整第 {day} 天第 {seq} 个点位「{title}」：`；整日级 `请调整第 {day} 天的安排：`。快照 scope 额外前缀 `基于 {savedAt} 那版行程，`。

## A. 后端（glm-5.3）

### A1 图片渲染响应可被浏览器缓存（`lib/anitabi/handlers/imageServe.ts`）
- `RENDER_CACHE_CONTROL` 改为 §0 值（`buildRenderResponse` 与 `loadMirroredRenderResponse` 两处共用，`:423`、`:502`）。下载路径 `buildDownloadResponse`（`:483`）保持 `no-store` 不动。
- R2 命中路径：若 R2 对象暴露 `httpEtag`，响应加 `ETag`；请求头 `If-None-Match` 与之相等（允许弱比较 `W/`）→ `304`，无 body，带同样的 `Cache-Control` 与 `ETag`。上游拉取路径不做 ETag（无稳定校验器）。
- 行数：imageServe.ts 允许 813，当前 ~813，**ETag/304 逻辑放新文件** `lib/anitabi/handlers/imageServeCache.ts`（导出 `RENDER_CACHE_CONTROL`、`buildNotModifiedResponse(etag)`、`matchesIfNoneMatch(header, etag)`），imageServe.ts 只加 import 与 1–3 行调用。
- 测试 `tests/anitabi/imageServeCache.test.ts`：Cache-Control 字符串含 `max-age=86400` 与 `s-maxage=86400`；`matchesIfNoneMatch('"abc"', '"abc"')`、`('W/"abc"', '"abc"')`、`('"x", "abc"', '"abc"')` 为 true，不匹配为 false；304 响应无 body 且带头。现有 `tests/anitabi/imageServe*.test.ts` 若断言旧 Cache-Control 字符串，按新值改。
- 完成标准：`npx vitest run tests/anitabi` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过。

## B. 前端（kimi k3）

### B1 预热常态化（`hooks/usePlanImagePrewarm.ts` 重写；新文件 `hooks/planPrewarmQueue.ts`）
- 目标：**页面一挂载就开始**（首屏 `initialPlan.days` 来自 SSR，不等轮询），按 Day 1 → Day N、每天从上到下的条目顺序排队；days/daymap 变化时**只把新 URL 追加到队尾**，不打断进行中与已排队的；仅组件卸载时取消。
- `planPrewarmQueue.ts`（模块级单例，可注入 `loadImage`/`acquireSlot` 便于测试）：`enqueue(urls: string[])`（去重：已在队列、已在飞、已 `hasLoadedMapImage` 的跳过）、`start()`、`stop()`；并发 = 同时最多 3 个在飞（每个先 `acquireMapImageRequestSlot({ lane: 'warmup', signal })` 再 `new Image()`，成功 `rememberLoadedMapImage`，失败不入缓存），车道阈值本身不改（3 是调度器给 warmup 的总活跃门槛，交互态图片永远优先）。
- `usePlanImagePrewarm(days)`：`useEffect` 在 `collectPlanPrewarmUrls(days)` 的**签名**（URL 数组 join 的哈希或长度+首尾）变化时 `enqueue`，不再 abort 重来。`PLAN_PREWARM_MAX_IMAGES` 从 120 提到 240（超长行程；超过部分等用户切天时由 ResilientMapImage 正常加载）。
- `ui.tsx` 的 `prewarmDays` memo 改为只依赖 `plan.days` 与 chat 中 daymap 条目的 `revisionId` 列表（用 `useMemo` 先算 `daymapKey = chat.filter(daymap).map(revisionId).join(',')`），避免文本消息到达触发重算。ui.tsx 已 750 行：把这段与 B4 的 `onComposeDraft` 接线一起抽到新 hook `hooks/usePlanComposer.ts` / 或把 `prewarmDays` 计算移进 `usePlanImagePrewarm` 内部（接收 `plan.days` 与 `chat`），确保 ui.tsx 不超 750。
- 测试 `tests/plan/planPrewarmQueue.test.ts`（node）：10 个 URL、注入的 `loadImage` 用假计时器 → 任一时刻在飞 ≤ 3 且顺序为入队序；重复 `enqueue` 不重复加载；`enqueue` 时已 `hasLoadedMapImage` 的跳过；`stop()` 后未开始的不再加载。`tests/plan/usePlanImagePrewarm.test.tsx` 补：days 引用变化但 URL 集合不变 → 不重复 `enqueue`；新增一天 → 只追加新 URL。

### B2 已加载记忆跨刷新（`components/map/utils/mapImageLoadedCache.ts`，`ResilientMapImage.tsx` 一处）
- 模块初始化时从 `sessionStorage['seichigo:mapImageLoaded:v1']` 水合（try/catch，无 window/解析失败视为空）；`rememberLoadedMapImage` 后用 `requestIdleCallback`/`setTimeout(…, 500)` 去抖写回（同样 try/catch，超配额静默）。`resetLoadedMapImageCacheForTest` 同时清存储。
- 新增 `forgetLoadedMapImage(url)`：`ResilientMapImage` 走"缓存命中直渲"路径时若 `onError`（浏览器缓存已被逐出且上游失败），先 `forgetLoadedMapImage(requestSrc)` 再进入现有失败链（`ResilientMapImage.tsx:440` 附近，只加 1–2 行）。
- 测试 `tests/map/mapImageLoadedCache.test.ts`：写入后新 import（`vi.resetModules`）能命中；超过 500 条逐出最旧且存储同步；`forget` 后不命中；sessionStorage 抛错时不影响内存行为。

### B3 快照/当前地图交互（`components/route/RoutePreviewMap.tsx`，新文件 `components/route/routePreviewMarkers.ts`、`components/route/routePreviewSync.ts`；`DayCards.tsx`）
1. **修切天丢更新**：新文件 `routePreviewSync.ts` 导出 `createPendingSync()`：`{ request(apply), markReady(), reset() }`——`request` 在 ready 时立即执行，否则记住最新一次；`markReady` 由 map `load`/`style.load`/`idle` 调用并执行挂起的那次。props effect 不再 `isStyleLoaded()` 早退，改为 `pending.request(() => sync(points, routeGeometry, compact))`；provider failover `setStyle` 后 `reset()` 再等 `style.load` `markReady()`。测试 `tests/route/routePreviewSync.test.ts`（node）：ready 前多次 request 只执行最后一次；ready 后立即执行；reset 后回到挂起态。
2. **PC 可缩放不劫持滚动**：`interactive=false` 时不再禁用 dragPan/scrollZoom，改为 Map 选项 `cooperativeGestures: true`（Ctrl/⌘ + 滚轮缩放、单指拖动页面滚动、双指操作地图，maplibre 内置提示；`locale` 覆盖为中文：`CooperativeGesturesHandler.WindowsHelpText: '按住 Ctrl 并滚动可缩放地图'`、`MacHelpText: '按住 ⌘ 并滚动可缩放地图'`、`MobileHelpText: '双指操作地图'`），并在 inline 态也加 `NavigationControl({ showCompass: false })`（右上角 ± 按钮，PC 无需按键即可缩放）。`boxZoom`/`keyboard` 仍禁用。删掉 DayMap 自己叠的"双指缩放地图"胶囊（`DayCards.tsx` DayMap 返回块）。
3. **marker ↔ 条目**：marker 创建移到 `routePreviewMarkers.ts`（`buildMarkerLayouts`、`createNumberedMarker(layout, { color, active })`、`applyMarkerActive(el, active)`）。marker 元素 `data-point-id`，点击 → `onPointSelect(id)`；`activePointId` 变化只切换 class（不重建 marker）：active 态放大 1.25 倍、主色填充白字、`z-index` 提升。marker 点击同时用 `maplibregl.Popup({ closeButton: false, offset: 14 })` 显示 `label`（再次点击/点击地图空白关闭）。
   DayCards：`DayMap` 与列表之间共享 `activePointId` state（放在 `DayCards` 内，切天重置）；列表条目（`TimelineCardRow` 的可点击外层）`onClick` 设置 `activePointId` 并让地图 `flyTo`（通过 `activePointId` 变化在 RoutePreviewMap 内 `easeTo({ center, duration: 300 })`，仅当该点不在当前视口内）；marker 点击 → 对应条目 `scrollIntoView({ block: 'nearest' })` 并加 1.5 秒高亮环（`ring-2 ring-rose-400`），条目 `data-point-id` 与 marker 同值。
4. **展开态**：DayMap 右上角"展开"按钮 → 全屏遮罩（`fixed inset-0 z-50 bg-white`，顶部标题"第 N 天 · 路线"，右上关闭），内部再挂一个 `RoutePreviewMap interactive` 同 points/geometry/activePointId；Esc 关闭；遮罩内 `body` 加 `overflow-hidden`。新文件 `app/(authed)/plan/[id]/components/DayMapExpanded.tsx`。
- 行数：RoutePreviewMap.tsx 现 581，抽出 marker 与 sync 后应回到 ~500；DayCards.tsx 现 572，把 `DayMap` 整个函数抽到新文件 `components/DayMap.tsx`（含展开按钮与 route 请求逻辑），DayCards 只保留列表与 tab。
- 测试：`tests/plan/dayCards.test.tsx` 补「点击条目 → 该条目 `data-active=true`，且 mock 的 RoutePreviewMap 收到 `activePointId`」「mock 触发 `onPointSelect(id)` → 对应条目获得高亮 class」「展开按钮 → 出现 `role=dialog`，Esc 关闭」。`tests/route/routePreviewMarkers.test.ts`（node/jsdom）：`createNumberedMarker` 元素含 `data-point-id` 与序号；`applyMarkerActive` 切换 class。RoutePreviewMap 本体继续 mock（jsdom 无 WebGL）。

### B4 快照/当前列表的导航与"交给规划师调整"（新文件 `app/(authed)/plan/[id]/lib/navigationLinks.ts`；`DayCards.tsx`/`DayMap.tsx`/`ui.tsx`）
- `navigationLinks.ts`：`buildPointNavigationUrl({lat,lng})`、`buildDayNavigationUrls(points, { maxWaypoints })` 按 §0 分段；`maxWaypoints` 由 `matchMedia('(pointer: coarse)')` 决定 3/9（无 window 时 9）。测试 `tests/plan/navigationLinks.test.ts`：2 点 → 1 段无 waypoints；12 点、max 9 → 2 段且第 2 段起点 = 第 1 段终点；坐标保留 6 位小数；URL 经 `encodeURIComponent`。
- Day 头部（tab 下方、地图上方或地图左下）加「整日导航」按钮（多段时下拉列出各段）；每个带坐标的条目行尾加「导航」小图标外链（`target=_blank rel=noopener`）；两种 scope 都显示。
- 「交给规划师调整」：条目行尾图标 + Day 头部按钮，点击调用 `onComposeDraft(text)`（§0 文案）。`ui.tsx` 接线：把 `textareaRef` 赋值 + `setInput`（或现有输入 state）+ `focus()` 封装成 `composeDraft(text)` 传给 `DayCards`/`DaymapCard`；ui.tsx 满 750 行，接线只允许 +3 行以内，超出则把「输入框 state + composeDraft + 发送」抽到 `hooks/usePlanComposer.ts`。
- 测试 `tests/plan/day-cards.test.tsx` 补：条目「导航」href 符合单点格式；「整日导航」href 含 `waypoints`；点击「交给规划师调整」→ `onComposeDraft` 收到含天数、序号、标题的文案；snapshot scope 文案含 `基于`。`tests/plan/plan-timeline.test.tsx` 补：DaymapCard 触发 `onComposeDraft` 后 textarea 值为该文案且获得焦点。

完成标准：B `npx vitest run tests/plan tests/route tests/map` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过；简短中文汇报（改动文件、新增测试、行数）。

## 主会话验收（本轮结束时做）
- 预览上 `curl -sI` 任一 `/api/anitabi/image-render?...` 与 R2 命中图：`cache-control` 含 `max-age=86400`；带 `If-None-Match` 二次请求 R2 命中图 → 304。
- 管理员东京计划：刷新后 5 秒内切到 Day 3/Day 5，条目图直接可见（DevTools Network 显示 `(disk cache)`/`(memory cache)`，无新请求或仅 304）。
- 快照地图：PC 滚轮 + Ctrl 缩放、± 按钮缩放；点 marker 弹出点名且列表条目高亮滚入；点条目 marker 放大；连续快速切 Day 1→2→3 路线与 marker 一致；展开态全交互。
- 「整日导航」打开 Google Maps 多途经点路线；「交给规划师调整」预填输入框不自动发送。
