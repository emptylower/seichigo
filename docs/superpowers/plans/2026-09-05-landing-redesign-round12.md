# 第十二轮：落地页重绘——以规划师为主线，地图与攻略为两翼（2026-09-05）

分支 `feat/landing-redesign`，worktree `/Users/mac/Desktop/seichigo-worktrees/landing-redesign`。工作方式同前：先补失败测试再实现；**不要 git commit / git stash**；不跑迁移（本轮无 schema 改动）；`node scripts/check-line-budget.mjs` 必须通过（单文件 ≤ 750，新逻辑放新文件）。
- A（数据与脚本，glm-5.3）只碰 `lib/home/**`、`scripts/**`、`content/generated/home-*.json`、`public/images/showcase/**`、`app/api/me/plans/[id]/agent/route.ts`（如需）、`tests/home/**`、`tests/scripts/**`。
- B（前端，Claude Opus）只碰 `components/home/**`、`components/auth/**`、`app/(site)/**`、`app/en/**`、`app/ja/**`、`app/(authed)/plan/**`、`lib/i18n/locales/*.json`、`tests/components/home/**`、`tests/home/homePages.test.tsx`、`tests/plan/**`、`tests/auth/**`。
两边并行、文件不相交；B 在 A 的 JSON 落盘前用 §0 的形状写 fixture。

## 用户已定的决定
1. 未登录可以进入规划入口并输入，真正发送第一条消息时弹登录/注册弹窗。
2. 第二屏的展示计划直接从现有计划复制（管理员的东京 8 日计划 `cmtk6aetq0000psp7292p6uu8`）。
3. 热门作品与热门城市合并成一段。
4. 点位数、作品数、城市数、攻略数按数据库真实数据展示。

## 勘查要点（决定实现方式）
- 首页三份入口（`app/(site)/page.tsx`、`app/en/page.tsx`、`app/ja/page.tsx`）共用 `HomePageTemplate`，页面级 ISR 120s，数据来自 `lib/home/getHomePortalData.ts`（任一源失败即抛错以免缓存降级页）。
- 没有登录弹窗组件；登录逻辑在 `app/auth/signin/ui.tsx`（`POST /api/auth/request-code` → `signIn('email-code', {email, code, redirect:false})`）。`(authed)/plan/[id]/page.tsx` 对游客 `redirect('/auth/signin?callbackUrl=…')`。
- `POST /api/me/plans` 只收 `{title?}`，每人每天 3 个；`PlanPlanner`（`ui.tsx`）没有预填首条消息的入口，只有内部 `composeDraft`。
- 编辑内容 = `PublicPostListItem`（cover/title/animeNames/city/routeLength/tags/publishDate），没有作者与天数；`HomeRouteHub` 是纯静态三链接，不读数据。
- `/api/anitabi/image-render` 公开；`/api/google/place-photo`、`/api/google/point-photo` 需登录 → 展示计划里的 Google 图必须静态化。
- 没有公开统计端点；`anitabiPoint.count()`、`anitabiBangumi.count({mapEnabled:true})`、`listCitiesForIndex().length`、公开文章数需要新的缓存聚合。
- 主地图链路太重，不进首页；聚类图层 `components/map/ClusterLayers.ts` 只依赖一个 maplibre 实例 + clustered source，可单独复用；样式容错 `components/route/mapStyleFailover.ts` 可复用。

## §0 契约

### 数据文件（A 生成，B 消费；B 先用同形 fixture）
- `content/generated/home-showcase.json`
  ```ts
  { revisionId: string; savedAt: string; title: string; summary: string; days: TripPlanDayView[] }
  ```
  `days` 与 `lib/tripPlan/view.ts` 的 `TripPlanDayView` 同形；所有条目图片 URL 只允许两种：`/api/anitabi/image-render?…`（公开）或 `/images/showcase/<hash>.jpg`（静态）。`payload.media.displayUrl` 若原来是 `/api/google/place-photo…`，生成时下载到 `public/images/showcase/` 并改写；`point.image` 保留 anitabi 原始 URL（组件会走 image-render 候选梯）。
- `content/generated/home-map-clusters.json`
  ```ts
  { generatedAt: string; totalPoints: number; cells: Array<{ lng: number; lat: number; count: number }> }
  ```
  按 0.1° 网格聚合全部 AnitabiPoint（有坐标的），`cells` 按 count 降序，最多 1200 个。
- `lib/home/getHomeStats.ts` 导出 `getHomeStats(): Promise<{ points: number; works: number; cities: number; posts: number }>`，`unstable_cache` 600s；任一计数失败抛错（与 `getHomePortalData` 同口径，避免缓存降级页）。`getHomePortalData` 增加 `stats`、`showcase`、`mapClusters`、`guides`（= 现有 featured + latest 里挑 6 篇：优先 `routeLength` 非空、有 cover）字段。

### 游客到规划师的通道（B）
- 首页 hero 输入框提交 → `router.push('/plan/start?draft=<encodeURIComponent(text)>')`（zh/en/ja 都到同一非本地化路径，`/plan` 属 `NON_LOCALIZED_PREFIXES`）。
- 新页面 `app/(authed)/plan/start/page.tsx`（**不做游客重定向**）：渲染"规划师起始页"——白底标题栏（回到网站）、一条规划师欢迎气泡、三个示例 chip、底部输入框（预填 `draft`）。发送时：
  - 已登录：`POST /api/me/plans {title: 截取前 30 字}` → `sessionStorage['planDraft:pending'] = JSON.stringify({ text, createdAt })` → `router.push('/plan/'+id)`；429（每日上限）显示提示。
  - 未登录：打开 `LoginModal`；登录成功后执行同一段逻辑（不刷新页面）。
- `app/(authed)/plan/[id]/ui.tsx`：挂载时读取并删除 `sessionStorage['planDraft:pending']`（createdAt 在 10 分钟内才算数）；若计划尚无任何消息则**自动发送**该文本，否则只预填输入框。ui.tsx 已 734 行，逻辑放新 hook `hooks/usePendingDraft.ts`。
- `components/auth/LoginModal.tsx`：props `{ open, onClose, onSuccess }`；内部复用登录页的验证码流程（邮箱 → 发送验证码 → 输入验证码 → `signIn('email-code', {email, code, redirect:false})`），成功后 `onSuccess()`；把 `app/auth/signin/ui.tsx` 里可复用的请求逻辑抽到 `components/auth/useEmailCodeLogin.ts`（登录页与弹窗共用，登录页行为不变）。

### 展示计划的静态渲染（B）
- `DayCards`/`DaymapCard` 新增可选 `static?: boolean`：为 true 时不预取 route-geometry、不显示"保存到我的地图"与"交给规划师调整"、不使用 `/api/google/point-photo` 兜底、导航链接保留。`DayMap` 在 static 且 `coverage === 'none'` 时不请求路网，只画直线。
- 首页第二屏 `HomeShowcasePlan`：`DaymapCard`（static）+ Day 标签每 5 秒自动轮播（用户交互后停止）+ 右上"用规划师做一份我的" → `/plan/start`。

## A. 数据与脚本（glm-5.3）

### A1 `lib/home/getHomeStats.ts` + 接入 `getHomePortalData`
按 §0；测试 `tests/home/getHomeStats.test.ts`（mock prisma/count 源）；`tests/home/getHomePortalData.test.ts` 补 `stats/showcase/mapClusters/guides` 字段断言（showcase/mapClusters 读取 JSON 文件，文件缺失时抛错）。

### A2 `scripts/generate-home-showcase.mts`
`npx tsx scripts/generate-home-showcase.mts --plan <planId> [--out content/generated/home-showcase.json]`：用 `lib/tripPlan/repo` 取计划与 days（取最新 daymap 快照的 `days`，没有则当前 days），改写 Google 图为静态文件（下载 `maxwidth=800`，文件名 sha1(url).jpg，已存在跳过；下载失败则去掉 `media` 让组件走 point.image），输出 §0 形状；`summary` 用计划标题后的第一段 assistant 文本前 80 字或空串。并把本次生成的 JSON 与图片一起落盘（用 `.env.local` 的生产库读取，只读）。测试 `tests/scripts/generateHomeShowcase.test.ts`：对纯函数 `rewriteShowcaseDays(days, downloader)` 断言改写规则与失败回退。

### A3 `scripts/generate-home-map-clusters.mts`
按 §0 网格聚合（Prisma 分页流式读 `anitabiPoint` 坐标，内存聚合），输出 JSON；测试对纯函数 `aggregateCells(points, cellDeg, maxCells)`。

### A4 生成产物
运行 A2（`--plan cmtk6aetq0000psp7292p6uu8`）与 A3，把 `content/generated/home-showcase.json`、`content/generated/home-map-clusters.json`、`public/images/showcase/*.jpg` 落盘（这些文件要入库）。汇报文件大小与 cells 数量。

完成标准：`npx vitest run tests/home tests/scripts` 全绿；`npx tsc --noEmit` 无错；line-budget 通过；简短中文汇报。

## B. 前端（Claude Opus）

### B1 新首页信息架构（`components/home/HomePageTemplate.tsx` 重写为编排壳，各段拆新文件）
顺序与内容：
1. `HomeHeroComposer`：一行标题（zh：`告诉我看过的作品和假期，我来排巡礼行程`；en/ja 各写一版）、一句副标题、输入框（占位：`例如：圣诞周去东京 8 天，想巡礼《天气之子》和《你的名字》`）、三个示例 chip（点击填入）、按钮"开始规划"。回车/按钮 → `/plan/start?draft=…`。移动端优先：输入框占满宽度，chip 横向滚动。
2. `HomeEntryCards`：三张卡——AI 规划（→ `/plan/start`）、地图探索（→ `/map`）、巡礼攻略（→ `/posts` 或现有文章索引路径）；各带一句话与真实数字（`stats.points` 点位、`stats.works` 作品、`stats.cities` 城市、`stats.posts` 篇攻略），数字用 `Intl.NumberFormat(locale)`。
3. `HomeShowcasePlan`：§0 所述，标题"看看规划师做出来的行程"。
4. `HomeMapTeaser`：maplibre 只读地图（`interactive={false}` 同 inline 语义、不加控件），数据 `mapClusters.cells` 作为 clustered GeoJSON source（`cluster: true`）+ 复用 `ensureClusterLayers`；标题"全日本 {totalPoints} 个巡礼点位"，整块可点击 → `/map`。jsdom 测试 mock maplibre。样式走 `mapStyleFailover`。
5. `HomeGuides`：6 张攻略大卡（cover、标题、作品名、城市、`routeLength`），来自 `data.guides`；标题"巡礼攻略"，右上"全部攻略"。
6. `HomeBrowse`：合并版"按作品和城市浏览"——左列热门作品（复用 `HomePopularAnime` 的卡片）、右列热门城市（复用 `HomePopularCities`），一屏内。
7. FAQ 保留（含 JSON-LD）；删除 App 预告段（`AppWaitlistPromoCtas` 不再渲染，组件文件保留）；`HomeRouteHub`、`HomeStarterSteps` 不再渲染。
- i18n：新增 key 全部放 `pages.home.v2.*`，三份 JSON 同步；加测试 `tests/i18n/homeKeys.test.ts` 断言三份 JSON 的 `pages.home.v2` 键集合一致。
- `HomePageTemplate.tsx` 控制在 200 行内，只做布局编排。

### B2 规划师起始页与登录弹窗
`app/(authed)/plan/start/page.tsx` + `ui.tsx`、`components/auth/LoginModal.tsx`、`components/auth/useEmailCodeLogin.ts`、`app/(authed)/plan/[id]/hooks/usePendingDraft.ts`（§0）。测试：`tests/plan/plan-start.test.tsx`（游客发送 → 弹窗；登录成功回调 → POST /api/me/plans 与 sessionStorage 写入 → push；已登录直接走；429 提示）、`tests/auth/loginModal.test.tsx`（发送验证码、提交、成功回调）、`tests/plan/pendingDraft.test.tsx`（无消息自动发送一次、有消息只预填、过期不用）。

### B3 静态渲染开关
`DayCards`/`DaymapCard`/`DayMap` 的 `static` 行为（§0）；测试补 `tests/plan/dayCards.static.test.tsx`。

完成标准：`npx vitest run tests/components/home tests/home tests/plan tests/auth tests/i18n` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过；简短中文汇报（新增文件与行数、i18n 键数、测试数）。

## 主会话验收
- 本地 `next dev`：三语首页首屏为输入框，三张入口卡数字与库中真实计数一致；第二屏展示计划可切 Day、图片全部来自公开路径（DevTools 无 401）；地图预览显示聚类圆点并可点进 `/map`；攻略卡 6 张；合并段一屏。
- 游客：输入示例 → 起始页预填 → 发送弹登录 → 验证码登录后自动建计划并进入计划页，首条消息已自动发送。
- 已登录：同路径不弹窗直接进入。
- 预览环境跑一次同样流程；水合无错误；Lighthouse 移动端首页性能不低于当前首页。
