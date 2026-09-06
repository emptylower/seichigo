# 第十二轮第二批：首屏 SEO 与"活"起来、第二屏首帧、地图极简呈现、攻略置顶（2026-09-05，讨论后定稿）

用户在预览 `539acfef` 上的反馈与讨论结论：
- 整体气质：**沿用白底工具风，加装饰**，不走照片编辑风、不走深色。
- 首屏本质是 AI 对话框，不靠配图撑画面；加四个元素：**打字机占位示例、规划师微演示、点阵地图背景、作品名滚动条**。
- 文案口吻：直白功能句，H1 含"圣地巡礼"关键词。
- 地图那屏：**极简细点 + 城市名标签**，不要圆圈数字铺满；文案改"全球"。
- 第二屏首帧要直接出图；攻略段《你的名字。》文章置顶（A1 已完成）。

工作方式同前：先补失败测试再改；**不要 git commit / git stash**；不跑迁移；line-budget ≤ 750。
- A（数据，glm-5.3）只碰 `lib/home/**`、`scripts/**`、`content/generated/home-map-clusters.json`、`tests/home/**`、`tests/scripts/**`。
- B（前端，Claude Opus）只碰 `components/home/**`、`app/(site)/page.tsx`、`app/en/page.tsx`、`app/ja/page.tsx`、`app/(authed)/plan/[id]/components/{DayCards,ItemThumbnail}.tsx`（仅静态模式）、`lib/i18n/locales/*.json`、`lib/seo/**`（如首页 metadata 在此）、`tests/components/home/**`、`tests/home/homePages.test.tsx`、`tests/plan/dayCards.static.test.tsx`、`tests/i18n/**`。
两边并行、文件不相交。

## §0 契约补充
- `home-map-clusters.json` 增加 `labels: Array<{ name: { zh: string; en: string; ja: string }; lng: number; lat: number; count: number }>`（A3 生成，最多 8 条，按 count 降序）；`parseHomeMapClusters` 透传并校验；缺省为空数组，前端无标签也能渲染。
- 首屏微演示与点阵背景只用页面已有数据：`data.showcase.days[0]` 的前 3 条带图条目、`data.mapClusters.cells`、`data.popularAnime`（作品名滚动条）。

## A. 数据（glm-5.3）
### A1 攻略置顶（已完成）／A2 bbox（已完成）
### A3 城市标签（`scripts/generate-home-map-clusters.mts`、`lib/home/mapClusters.ts`）
- 生成脚本：读 `City` 表（若有坐标字段用之；否则用 `AnitabiBangumi`/点位所属城市的质心）得到城市列表，对每个城市统计半径 25 km 内格子的 count 之和，取前 8 个，输出 `labels`（三语名取现有城市多语言字段，缺失回退 zh）。若 City 表无坐标且无法可靠得到质心，则改为按 cells 聚合出前 8 个热点质心并用逆向匹配最近的 City 名称；无法匹配时用格子坐标附近点位最多的 `AnitabiPoint.cityName` 一类字段（请先读 schema 决定，汇报采用的口径）。
- `parseHomeMapClusters` 校验 `labels` 形状；重跑 A3 更新 JSON（仍 ≤ 50 KB）。
- 测试 `tests/scripts/generateHomeMapClusters.test.ts` 补 `pickCityLabels(cells, cities)` 纯函数用例；`tests/home/mapClusters.test.ts` 补 labels 透传。

完成标准：`npx vitest run tests/home tests/scripts` 全绿；`npx tsc --noEmit` 无错；line-budget 通过；简短中文汇报（含 labels 内容）。

## B. 前端（Claude Opus）

### B1 首屏（`HomeHeroComposer.tsx` 拆成 `HomeHero.tsx` 编排 + 新文件 `HomeHeroTypewriter.ts`(hook)、`HomeHeroDemo.tsx`、`HomeHeroDots.tsx`、`HomeWorksTicker.tsx`）
1. **文案与 SEO**（三语键 `pages.home.v2.hero*` 重写）：H1 zh `动漫圣地巡礼行程，AI 规划师帮你排好`；en `Anime pilgrimage itineraries, planned by AI`；ja `アニメ聖地巡礼の旅程を、AIプランナーが組み立てる`。副标题一句：zh `全球 {points}+ 巡礼点位地图 · 说出作品和假期，规划师排好每天的路线、交通与餐厅 · 人写的巡礼攻略`（`{points}` 取整到万位如 `5 万`，en `50k`）。品牌线小字 `SeichiGo 圣地GO · 动漫圣地巡礼`。三份 page.tsx 的 `generateMetadata`：title `动漫圣地巡礼行程规划 · AI 规划师 + 全球巡礼点位地图 | SeichiGo`，description ≤ 120 字含"圣地巡礼、行程规划、巡礼地图、巡礼攻略"；en/ja 对应；保留 alternates/hreflang/OG；新增 `WebSite` JSON-LD（`potentialAction: SearchAction` → `/plan/start?draft={search_term_string}`），与 FAQ JSON-LD 并存。
2. **打字机占位**：`useTypewriterPlaceholder(examples, { typeMs: 45, holdMs: 1800, eraseMs: 20 })`；输入框 `placeholder` 随之变化；用户聚焦或输入即停，恢复静态占位；`prefers-reduced-motion` 下直接显示第一条。
3. **规划师微演示**（桌面右栏 / 移动端输入框下方）：四个步骤 chip `搜索作品 → 查点位 → 排 Day 1 → 查交通` 每 900 ms 依次点亮（品牌粉描边 + 小勾），全部点亮后淡入一张迷你结果卡：Day 1 徽标、3 条条目（48px 缩略图 `/images/showcase/*.jpg`、标题、时间 chip）与一条"步行 12 分钟"交通线；循环一次后停在结果卡。数据来自 `data.showcase.days[0]`；缩略图 `width/height` 固定、`loading="eager"`。`prefers-reduced-motion` 下直接显示结果卡。
4. **点阵背景**：`HomeHeroDots` 把 `data.mapClusters.cells` 渲染成一张静态 SVG（`viewBox` 按 bbox，`r` 按 count 分 3 档 1/1.6/2.4，填充品牌粉 `opacity` 0.10–0.18），绝对定位在首屏右上、`pointer-events:none`，移动端缩小并右移出血；不加载地图库。
5. **作品名滚动条**：`HomeWorksTicker` 用 `data.popularAnime` 名称（不足 8 个时重复一轮）做 CSS `translateX` 无限滚动（40 s 一圈），hover 暂停，`prefers-reduced-motion` 下静态排列。放在示例 chip 下方，字号 12，灰色。
- 输入框容器：白底、`shadow-lg`、聚焦粉色 2px 描边；按钮品牌粉；chip 带小图标。
- 测试：`HomeHero*.test.tsx`（打字机在假计时器下推进与停止；微演示四步点亮后出现结果卡；reduced-motion 直出；点阵 SVG 的 circle 数与 cells 数一致且 ≤ 上限；ticker 渲染作品名）；`homePages.test.tsx` 补 `WebSite` JSON-LD；`tests/i18n/homeKeys.test.ts` 键对齐。

### B2 第二屏首帧（`HomeShowcasePlan.tsx`、`DayCards.tsx`/`ItemThumbnail.tsx` 静态模式）
静态模式改渲染原生 `<img>`（固定 `width/height`、`decoding="async"`），当前 Day 前 6 张 `loading="eager"`，其余 lazy；`HomeShowcasePlan` 用 `ReactDOM.preload` 预载 Day 1 前 4 张。非静态模式不变。测试 `dayCards.static.test.tsx` 补断言。

### B3 地图预览（`HomeMapTeaser.tsx`）
- 标题 `全球 {count} 个巡礼点位`（en `{count} pilgrimage spots worldwide`，ja `世界 {count} か所の聖地`），副标题 `点开地图看每一个点`。
- 呈现：**不聚类、不标数字**。每个格子一个细点：`circle-radius` 按 count 分档 1.5 / 2.5 / 3.5 px，品牌粉，`circle-opacity` 0.7，无描边；另一图层用 `labels` 画城市名（`symbol` 图层，`text-field` 取 locale 名，字号 11，深灰字白描边 1px，`text-anchor` top，`text-offset` [0, 0.6]；`symbol-sort-key` 按 count）。`labels` 为空时不建该图层。初始视野 `fitBounds(bbox, { padding: 24 })`；`interactive` 关闭；整块可点进 `/map`。
- 测试：断言 source 无 `cluster`、点图层无 text、标签图层 `text-field` 取自 labels、`fitBounds` 用 bbox。

### B4 攻略段（`HomeGuides.tsx`）
消费 A1 顺序；首张卡跨两列做主推。测试补一条。

完成标准：`npx vitest run tests/components/home tests/home tests/plan/dayCards.static.test.tsx tests/i18n` 全绿；`npx tsc --noEmit` 无错；`npm run typecheck:tests` 无新增；line-budget 通过；简短中文汇报。

## 主会话验收
预览三语：H1 含"圣地巡礼"、title/description 更新、`WebSite` JSON-LD；首屏打字机、微演示、点阵背景、作品名滚动条可见且 reduced-motion 下静态；第二屏首帧直接出图；地图预览标题"全球"、细点 + 城市名、无数字圆圈；攻略首张为《你的名字。》文章。
