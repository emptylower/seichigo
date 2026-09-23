# 按天行程本 B1.2 第二轮冒烟反馈修复（2026-09-23）

> 执行者须知：先读 `docs/superpowers/plans/2026-09-23-routebook-day-planner.md` 顶部硬约束（不 push、不 migrate、≤750 行、不 `as any`、`$transaction` 只用 `tx`、不碰 `features/map/**` 与 `components/map/**`）。**A（后端）与 B（前端）两个会话并行**：A 只改 `lib/routeBook/**`、`tests/routeBook/**`；B 只改 `app/(authed)/me/**`、`components/me/**`、`components/LanguageSwitcher.tsx`、`components/route/**`、`lib/i18n/locales/*.json`、`tests/routebooks/**`。各自 commit（不 push），撞 `index.lock` 等几秒重试。
>
> 完成标准：`npm run typecheck:app`、`npm run typecheck:tests` 0 错；A 跑 `npx vitest run tests/routeBook`，B 跑 `npx vitest run --project jsdom tests/routebooks tests/route` 与 `npm run i18n:check`（若存在，看 package.json；没有就跑 `npx vitest run tests/i18n`）；简短中文汇报。

## 负责人原话

1. 「实际路线渲染很慢，或者说不稳定。」
2. 「具体到某一天的话，点位图标（总览时是第几天的标识）数字可以改成游览顺序。」
3. 「点位详情的小卡片中的几个交互按钮没有排版，都是向右靠齐的，应该居中均匀分布。」
4. 「我的地图页面点击多语言切换不生效。」

## 诊断结论（已实测，不用再查）

- 路线：Mapbox 调用 0.1–2.1s 且从未失败；慢在 `lib/routeBook/handlers/legs.ts:10-45` 串行做 `repo.getById`（拉整本，~700ms 多次往返 Neon）→ `pointCoords`（~330ms）→ 缓存查 → 未命中调 Mapbox → **等缓存写完才回复**（`lib/routeBook/dayGeometry.ts:47`）。单次 1.3–1.5s，冷进程 7s。legs handler 没有限流，不是 429。
- 不稳定在前端 `app/(authed)/me/routebooks/[id]/hooks/useDayLegs.ts:55-100`：签名变了旧结果仍留在 `legsByDay[dayId]`（line 94）直到新响应；请求失败（非 200/网络）写 null 且不重试（line 91）；没有 AbortController；effect 依赖整个 `detail` 对象（line 100），乐观更新与服务端确认各触发一次请求，前一次被客户端丢弃但服务端照跑。首个响应到达前地图什么都不画（`useRouteGeometry.ts:20,27`）。
- 多语言：`components/LanguageSwitcher.tsx:57` 调 `router.push(prefixPath(pathname, target))`，而 `components/layout/prefixPath.ts:3,35` 把 `/me` 归为永不加前缀 → push 到同一 URL，无事发生（cookie `NEXT_LOCALE` 其实已写，line 19/54）。`/en/me/*` 不存在也不该加。此外路线本页面文案全部硬编码中文：`app/(authed)/me/routebooks/page.tsx:8,26-31,42-44`、`components/me/MeSectionShell.tsx:16-33`、`app/(authed)/me/routebooks/ui.tsx`（28 处）、`[id]/page.tsx:8,33-34`、`[id]/components/*.tsx`（14 个文件）、`[id]/ui.tsx:75` 用 `readClientLocale()` 只给导入提示与谷歌介绍用。`/map` 能切是因为有 `app/en/map`；`/plan/start` 在 `prefixPath.ts:6` 的例外表里。cookie 方式是无前缀页面的既定机制（`lib/i18n/resolveRequestLocale.ts:21`）。

---

## A. 后端（zhipuai glm-5.3）

### A1 legs 接口瘦身
- `lib/routeBook/repo.ts` 新增 `getDayContext(routeBookId, userId, dayId): Promise<{ day: RouteBookDay; items: RouteBookItem[]; places: RouteBookPlace[]; lodgings: RouteBookLodging[] } | null>`：Prisma 用**一条** `routeBookDay.findFirst({ where: { id: dayId, routeBook: { id: routeBookId, userId } }, include: { items: { orderBy: { sortOrder: 'asc' } }, routeBook: { select: { places: true, lodgings: true, defaultTravelMode… } } } })` 拿齐（一个往返）；内存仓储同样实现。
- `lib/routeBook/handlers/legs.ts` 改用它，不再 `getById`；`pointCoords` 只传该天 point 条目的 id；`legs` 计算与 `dayGeometry` 的缓存读取并行（`Promise.all`）。
- `lib/routeBook/dayGeometry.ts:47`：缓存写入改为 `void setCachedLeg(...).catch(() => {})`，不阻塞响应。
- 响应头加 `Cache-Control: private, max-age=0`（避免中间层缓存）。
- 目标：热请求 ≤ 600ms（本机到 Neon 一次往返约 190ms）。在汇报里给出你用 `tests/routeBook/legs.handler.timing` 或临时脚本测到的本地耗时（临时脚本用完删）。
- 测试：`tests/routeBook/handlers.test.ts` legs 用例改为覆盖 `getDayContext`（外本 dayId → 404）；`repoMemory.test.ts` 加 `getDayContext`。

---

## B. 前端（kimi k3）

### B1 路线加载稳定性（`hooks/useDayLegs.ts`、`hooks/useRouteGeometry.ts`、`PlannerMapStage.tsx`）
- effect 依赖只放 `routeBookId, selectedDayId, signature, enabled`，不放 `detail`。
- 用 `AbortController`，cleanup 时 `abort()`；被中止的请求不写状态。
- 签名变化时把该天条目标为 `stale: true`（保留旧数据用于占位），地图在 stale 期间**立即用站点直连画虚线**（stops 顺序从 `detail` 本地算，不等服务端），响应到达后换成实线。首次加载同样先画虚线再换实线——用户永远能立刻看到路线雏形。
- 失败（非 200 / 网络 / 超时 15s）→ 1 秒后自动重试一次；两次都失败保留虚线并在连接行显示「路线加载失败 · 重试」按钮。
- 单天模式切天时 `fitBounds` 立即执行，不等 legs。

### B2 单天模式徽标 = 游览顺序
`PlannerMapStage.tsx` 的 `markerVariants[*].badge`：全部模式保持「Day 序号」（多天 `1·3`）；**单天模式改为该天内的游览顺序 1..N**（只数有坐标的 point/place，按 sortOrder），与左栏时间线序号一致。左栏时间线每条前面也显示同一序号（如果还没有的话）。

### B3 详情卡按钮排版
`components/PointDetailCard.tsx`：操作区改为 `flex flex-wrap justify-center gap-2`，每个按钮 `flex-1 basis-0 min-w-[96px] max-w-[160px] justify-center`，图标 + 文案居中；移动端抽屉同样。作品点位 4 个按钮（在巡礼地图查看 / Google 地图 / 移到… / 删除）两行各两个也可接受，但必须居中均匀。

### B4 多语言生效
1. `components/LanguageSwitcher.tsx:56-58`：`const next = prefixPath(pathname, target); if (next === pathname) { router.refresh() } else { router.push(next) }`（cookie 已在前面写好）。
2. 路线本页面全部文案改 `t()`：
   - 三语字典 `lib/i18n/locales/{zh,en,ja}.json` 新增 `routebook.*` 命名空间（列表页、详情页、日程侧栏、时间线、连接行、右栏、详情卡、沉浸模式、天顺序/选天 sheet、导入提示——把现有 `routebook.importSummary/importDegraded` 并进来）。中文原样搬，英日由你写，语气与 `auth.modal` 一致。
   - 服务端页面 `app/(authed)/me/routebooks/page.tsx`、`[id]/page.tsx`：用 `getLocale()`（看 `app/(authed)/layout.tsx:13` 怎么取）拿 locale，`generateMetadata` 三语，并把 `locale` 作为 prop 传给客户端 `ui.tsx`。
   - `components/me/MeSectionShell.tsx`：接收 `locale` prop，tab 文案走 `t('me.tabs.*')`（其它 /me 页面调用处补传 locale，不传时默认 `zh` 以免破坏）。
   - `[id]/ui.tsx` 及其 components/hooks：去掉 `readClientLocale()`（line 75），全部从 prop 拿 `locale` 并透传；`<html lang>` 不用管。
   - 日期显示（`dayLabel` 里的「周六」等）按 locale 用 `Intl.DateTimeFormat`。
3. 测试：`tests/routebooks/i18n.test.tsx`——用 `locale='en'` 渲染 `DayPlanSidebar` 与 `PointDetailCard`，断言不出现任何 CJK 字符（正则 `/[぀-ヿ㐀-鿿]/`）；`LanguageSwitcher` 在无前缀路径上调用 `router.refresh`。

### A2 热路径压到 1 次往返（A1 之后追加）
A1 实测热路径仍 ~950ms：`getDayContext`（~490ms）→ `pointCoords`（~240ms）→ 缓存读（~220ms）三次串行往返。改法：
1. **坐标并入天上下文**：`getDayContext` 的 Prisma 查询对 `items` 用 `include: { point: { select: { id: true, geoLat: true, geoLng: true } } }`（或 `select`），`DayContext` 类型加 `pointCoords: Map<string, { lat; lng }>`（由仓储从关系字段组装，null 坐标不进 Map）；handler 不再单独调 `deps.pointCoords`。内存仓储用注入的 `pointCoords` 假实现组装同样的 Map。
2. **缓存读与库查并行**：`GET /days/[dayId]/legs?sig=<客户端计算的顺序签名>`——`sig` 是客户端对「该天条目 id 顺序 + 当天默认方式 + 住宿 placeId」算的短哈希（任意稳定字符串，服务端只当不透明 key 用，最长 64 字符，缺省则退回现在的流程）。handler 在发起库查询的**同时**用 `dayroute-sig|<dayId>|<sig>` 读 `RouteLegCache`；命中则直接用缓存的 `dayGeometry`（跳过 Mapbox）。库查回来后正常算 legs；Mapbox 结果写入时同时写两个 key（原坐标 key 与 sig key）。sig 与实际数据不一致的风险由客户端保证（sig 变即换 key），服务端不校验。
3. 目标：热路径（缓存命中）≈ 1 次 Neon 往返 + 极小开销；用与 A1 相同的临时脚本测三个数字（getDayContext 含坐标、并行缓存读、总耗时）写进汇报，脚本用完删。
4. 测试：`tests/routeBook/handlers.test.ts` 加「带 sig 命中缓存时不调 Mapbox」「不带 sig 走原流程」；`repoMemory.test.ts` 的 `getDayContext` 断言含 `pointCoords`。

### B5 前端接线 `?sig=`（A2 之后追加，B1–B4 提交后单独执行）
`hooks/useDayLegs.ts` 已经为每天算了一个顺序签名（用于缓存/失效）。把它作为 `?sig=<signature>` 追加到 `GET /api/me/routebooks/[id]/days/[dayId]/legs` 的请求 URL 上（`encodeURIComponent`，≤64 字符——若现有签名更长，用一个简单稳定的 32 位哈希如 FNV-1a 转 hex）。签名输入必须至少包含：该天有坐标条目的 id 顺序、`day.defaultTravelMode`、覆盖该天的住宿 `placeId`（首尾锚点变了几何就变）。服务端对 sig 只当不透明 key（见 A2），命中时跳过 Mapbox。jsdom 测试：`tests/routebooks/useDayLegs.test.tsx` 断言请求 URL 含 `sig=` 且同一顺序两次签名相同、顺序变化签名不同。

### A3 行数预算（追加）
`lib/routeBook/repoMemory.ts` 已 753 行，超过 750 上限，`npm test` 的 line-budget 检查会失败。把「天」相关方法（insertDay/updateDay/deleteDay/reorderDays 及其辅助）抽到 `lib/routeBook/repoMemoryDays.ts`（导出纯函数或一个 mixin，主类调用），主文件降到 ≤ 650 行，行为与测试不变；**不要**改 `line-budget.allowlist.json`。跑 `npm test`（含 line-budget）必须通过。只碰 `lib/routeBook/**`。
