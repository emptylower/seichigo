# 第十二轮审查修复（2026-09-05）

背景：落地页重绘 A1–A4、B1–B3 已实现并全绿，独立审查列出 3 高 / 12 中 / 12 低，主会话 dev 走查确认三语首页与游客链路可用，但首页 HTML 930 KB（dev）。工作方式同前：每条先补失败测试再改；**不要 git commit / git stash**；不跑迁移；line-budget 必须通过。
- A（数据与脚本，glm-5.3）只碰 `lib/home/**`、`scripts/**`、`content/generated/home-*.json`、`public/images/showcase/**`、`tests/home/**`、`tests/scripts/**`、`tests/map/firstViewCanary.test.ts`。
- B（前端，Claude Opus）只碰 `components/home/**`、`components/auth/**`、`components/map/ClusterLayers.ts`（如需）、`app/(site)/**`、`app/en/**`、`app/ja/**`、`app/(authed)/plan/**`、`lib/i18n/locales/*.json`、`tests/components/home/**`、`tests/home/homePages.test.tsx`、`tests/plan/**`、`tests/auth/**`、`tests/i18n/**`。
两边并行、文件不相交。§0 补充契约：`payload.media.attribution` 在瘦身后保留并由前端渲染；`home-map-clusters.json` 形状不变；`getHomeStats(locale)` 增加 locale 参数。

## A. 数据与脚本（glm-5.3）

### 高-1 生成 JSON 改为静态 import（`lib/home/generatedHomeFiles.ts`、`getHomePortalData.ts`）
Cloudflare Worker 运行时没有 `fs`，ISR 续期会 ENOENT。两份 JSON 改为 `import showcase from '@/content/generated/home-showcase.json'`（同 `lib/mdx/publicSnapshot.ts` 的做法），保留 `parseHomeShowcase` / `parseHomeMapClusters` 做形状校验，非法即抛错（维持"任一源失败整页拒绝"）。`tests/home/getHomePortalData.test.ts` 里"文件缺失"用例改为"形状非法 → 抛错"。

### 高-3 瘦身与照片字段（`lib/home/showcase.ts` 新增 `slimShowcaseDays`，A2 脚本调用）
白名单：`place → {placeId,name,lat,lng,mapsUri?}`；`media → {source,displayUrl,attribution}`（**attribution 必须保留**）；`schedule → {start,end,confidence}`；`transport` 只保留 `itemPayload.ts` 的 `getTransport` 读取的字段，`legs` 只保留 11 个已知字段，`polyline` 坐标保留 5 位小数并抽稀到 ≤ 80 点；删除 `placeQuery`、`place.photos`、`place.photo`、`media.photoReference` 等一切 Google 引用字段。预算：`home-showcase.json` ≤ 100 KB（紧凑 JSON，`JSON.stringify(x)` 不缩进），`home-map-clusters.json` ≤ 50 KB。测试：`tests/scripts/generateHomeShowcase.test.ts` 补白名单断言与"输出不含 `photoReference`/`photos`"。

### 中-4 点位口径统一（`getHomeStats.ts`）
`points` 只数有坐标的点位（`geoLat`/`geoLng` 非空，按 schema 实际字段名），与 clusters 的 `totalPoints` 同口径。

### 中-5 展示图重生成为 320px（`scripts/generate-home-showcase.mts`）
`maxwidth=320`，删除旧的 800px 文件后重跑（目录清空再生成，避免遗留），目标总量 ≤ 1.5 MB。

### 中-12 脚本高危分支抽纯函数补测
`resolvePhotoReference`（三层分支）、下载幂等分支、`streamPointCoordinates` 游标分页各抽成接受注入 client/fs 的纯函数，各补 2–3 条用例（含 off-by-one）。

### 摘要文案（`lib/home/showcase.ts` 的 `extractShowcaseSummary`）
不再在 80 字处硬截：取第一段助手文本的**第一个完整句子**（以 。！？!? 结尾），超过 80 字仍取整句并加"…"；若首句含"我先/让我先/我来"等过程性开头，改用计划标题去掉 `｜` 之前的日期段作为摘要。补测试。

### 低项
- 低-1 `getHomeStats(locale)`：文章数按 locale 计。
- 低-2 删除无人渲染的 `heroDisplay`、`more`、`starterSteps` 与 `Math.random()`（`getHomePortalData.ts`、`types.ts`、相关测试）。
- 低-3 落盘紧凑 JSON。低-4 `MAX_CELLS` 提到 2000 并断言文件 ≤ 50 KB。低-5 变量名与注释改准确。
- 低-9 `tests/map/firstViewCanary.test.ts`：文件不存在时 `it.skipIf` 跳过并打印提示（`.omx` 是 gitignored）。
- 低-10 删除起始页 429 的死分支不在 A 范围，略。

重新运行 A2/A3 生成产物并汇报大小。完成标准：`npx vitest run tests/home tests/scripts tests/map/firstViewCanary.test.ts` 全绿；`npx tsc --noEmit` 无错；line-budget 通过；简短中文汇报。

## B. 前端（Claude Opus）

### 高-2 地图库按需加载（`DayCards.tsx`）
`DayMap` 改为 `next/dynamic(() => import('./DayMap'), { ssr: false, loading: 占位 })`，`DayMapExpanded` 随之只在展开时加载。调整受影响测试（`tests/plan/{dayCards,day-cards,daymap-card,dayMapPopup,dayMapRouteCoverage,dayPointCard,dayCards.static}.test.tsx`、`tests/components/home/HomeShowcasePlan.test.tsx`）：mock `next/dynamic` 为同步或改用 `findBy*`。`tests/home/homePages.test.tsx` 的 maplibre 桩应可移除（首页不再静态引到 maplibre）；加一条断言：`components/home/**` 的静态 import 图不含 `maplibre-gl`（可用简单的源码 grep 测试）。

### 高-3 渲染图片署名（`DayCards.tsx`、`DayPointCard.tsx`）
条目图右下角渲染 `media.attribution`（小字，Google 照片要求可见署名），静态与非静态模式都渲染。测试补一条。

### 中-1 登录后状态（`plan/start/ui.tsx`）
`signedIn` 改本地 state，`LoginModal.onSuccess` 置 true。

### 中-2 IME 守卫（`plan/start/ui.tsx`、`HomeHeroComposer.tsx`）
回车发送加 `!e.nativeEvent.isComposing`。

### 中-3 地图预览不二次聚类（`HomeMapTeaser.tsx`）
不用 `cluster:true`，直接按 `['get','count']` 画 circle（半径与颜色按 count 分档，标签显示 `count`），孤立格子也画。测试改为断言 `[count,lng,lat]` 三元组（中-10）。

### 中-6 轮播（`useDayAutoRotate.ts`、`HomeShowcasePlan.tsx`）
仅在可见（IntersectionObserver）且页面前台（`visibilitychange`）时轮播，转满一圈自停，用户交互即停。

### 中-7 弹窗可达性（`LoginModal.tsx`）
Esc 关闭、打开时焦点进入邮箱框、焦点陷阱、遮罩点击关闭、`aria-modal`/`aria-labelledby`。

### 中-8 / 中-9 起始页与草稿（`plan/start/ui.tsx`、`usePendingDraft.ts`）
成功分支不放开 busy 直到 push；`usePendingDraft` 在 busy 无法自动发送时回退为预填（不丢草稿）。

### 中-11 fixture 与图片链路
showcase fixture 加带 `media.displayUrl`/`attribution` 的 meal/lodging 条目，断言渲出图片与署名。

### 低项
- 低-6 起始页与登录弹窗文案 i18n：从首页跳转时带 `?locale=`（zh 不带），起始页据此选 zh/en/ja，键放 `pages.planStart.*` 与 `auth.modal.*`，三份 JSON 同步；`tests/i18n/homeKeys.test.ts` 改为递归展平比较并覆盖这两个前缀（低-11）。
- 低-7 `HomeMapTeaser` 标题拼接不用空格硬拼，改 i18n 模板。
- 低-10 删除起始页 429 死分支，直接显示服务端 error 文案。
- 低-8：`DayCards.tsx` 694、`ui.tsx` 742，本轮不得再增，超出就外置。

完成标准：`npx vitest run tests/components/home tests/home tests/plan tests/auth tests/i18n` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过；简短中文汇报。

## 主会话验收
- 生产构建后首页 HTML/RSC 体积（`curl` 三语）较修复前明显下降，目标 ≤ 350 KB 未压缩。
- 地图预览圆圈数字与格子 count 一致、孤立格子可见。
- 展示计划图片有署名；轮播离开视口即停。
- 游客链路：登录弹窗键盘可达；登录后再发不再弹窗；连点发送只建 1 个计划。
- 预览环境三语首页与游客链路走查无报错。
