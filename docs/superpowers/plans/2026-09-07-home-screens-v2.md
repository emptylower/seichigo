# 首页第二屏与第三屏重做（地图数据库 + 规划师行程展示）

日期：2026-09-07　目标分支：feat/home-screens-v2（当前 worktree）

## 0. 背景与约束

首页第一屏（`components/home/HomeHero.tsx`）已经精修过，后面几屏观感掉档。本轮把第二屏改成「全球点位数据库」的世界地图，第三屏改成「规划师做出来的行程」的逐天展示，两屏都按已定稿的高保真原型图实现（原型图用文字描述在 §2、§3）。视觉语言必须与第一屏一致：

- 纯白背景；粉色 `brand-600 #db2777` / `brand-500 #ec4899` 是唯一强调色，只用在按钮、点位、编号、标题里的个别词；
- 标题 `text-gray-900` 粗体、字距略紧（`tracking-tight`）；正文 `text-gray-600`，小字 `text-gray-500`；
- 卡片：白底、`rounded-2xl`/`rounded-3xl`、`border border-gray-200`、柔和大阴影（`shadow-lg` 或 `shadow-[0_20px_60px_-20px_rgba(0,0,0,0.12)]` 这类）；
- 小标签是胶囊形（`rounded-full`），按钮是粉色实心胶囊 + 白色粗体文字 + 右侧小箭头（`lucide-react` 的 `ArrowRight`）；
- 装饰性花瓣可以复用第一屏的做法，但更克制（最多 4 片、只在 `lg` 显示、`aria-hidden`、尊重 `prefers-reduced-motion`）。

硬约束：

1. **不要 `git commit`、不要 `git stash`、不要跑 prisma migrate、不要改 `prisma/**`。**
2. **不要改** `components/home/HomeHero*.tsx`、`HomeEntryCards.tsx`、`HeroLaurel.tsx`、`HomeWorksTicker.tsx`、`scripts/**`、`content/generated/**`、`public/images/**`、`lib/home/**`（数据层与生成脚本本轮不动，只做前端）。
3. **所有数字必须来自真实数据**（`HomeStats`、`HomeMapClusters.totalPoints`、`labels[].count`、showcase 的 days/items），页面上不允许出现任何手写的统计数字或编造的地点。
4. 三语：所有新文案进 `lib/i18n/locales/{zh,en,ja}.json` 的 `pages.home.v2` 命名空间，用 `t('pages.home.v2.xxx', locale)` 取。en/ja 要是通顺的译文，不是拼音或占位。
5. 单文件行数预算：`node scripts/check-line-budget.mjs` 必须通过（新文件也受约束，超过 750 行拆文件）。
6. 首屏（第一屏）性能不能变差：新组件里的 maplibre 仍然用动态 `import('maplibre-gl')`，且只在组件进入视口附近（`IntersectionObserver`，rootMargin 约 `400px`）之后才初始化地图。
7. SSR 与客户端输出必须一致：不要在渲染路径里用随机数、`Date.now()`、`window`。
8. 服务端组件与客户端组件的边界沿用现有做法（`HomePageTemplate` 是服务端组件，两个新段是 `'use client'`）。

完成标准（都要跑，都要绿）：

```
npm run typecheck
node scripts/check-line-budget.mjs
npx vitest run tests/components/home tests/home
```

## 1. 段落顺序

`components/home/HomePageTemplate.tsx` 里 `data-home-sections` 容器内的顺序改为：

1. `HomeMapDatabase`（新，替换 `HomeMapTeaser` 的位置和作用）
2. `HomeShowcasePlan`（重做）
3. `HomeGuides`、`HomeBrowse`、`HomeFaq`（不动）

第一屏的滚动提示 `href="#home-showcase"`（在 `HomeHero.tsx`，不许改）指向的是「第二屏」——所以新的地图段的根 `<section>` 要带 `id="home-showcase"`，第三屏的行程段改用 `id="home-plan"`。

`HomeMapTeaser.tsx` 与 `tests/components/home/HomeMapTeaser.test.tsx`：删除（被新组件取代）。其它引用处（grep `HomeMapTeaser`）一并更新。

## 2. 第二屏：`components/home/HomeMapDatabase.tsx`

Props：`{ locale: SiteLocale; clusters: HomeMapClusters; stats?: HomeStats }`。`clusters.cells` 为空时整段不渲染（与现有 teaser 一致）。

### 版式（桌面 `lg`）

自上而下、全部居中：

1. 一行小字（`text-xs font-semibold tracking-wide text-brand-600`）：「全球圣地点位数据库」。
2. 超大数字：`totalPoints` 向下取整到千位后格式化，例如 50597 → 「50,000」，后面紧跟一个粉色的「+」。数字用 `text-6xl sm:text-7xl lg:text-8xl font-black tracking-tight text-gray-900`，「+」用 `text-brand-600`。千分位按 locale（复用现有 `NUMBER_LOCALE` 做法）。
3. 粗体标题（`text-2xl sm:text-3xl lg:text-4xl font-extrabold`）：「巡礼点位，全部落在地图上」。
4. 灰色副标题一行：由真实数据拼出「来自 {works} 部动漫作品 · 覆盖 {cities} 座城市 · 每天都在增加」。`works`/`cities` 来自 `stats`；`stats` 缺失时整句只保留「每天都在增加」这一小节（参考 `HomeHero.tsx` 里 `heroSubtitle` 处理 `{points}` 缺失的方式）。
5. 大地图卡片：宽度用 `max-w-6xl`（比其它段的 `max-w-5xl` 略宽，做法是这一段自己 `-mx-*` 或者在 `HomePageTemplate` 里把它放在 `max-w-5xl` 容器之外，二选一，保证移动端不横向溢出）。高度 `h-[420px] sm:h-[520px] lg:h-[560px]`，`rounded-3xl border border-gray-200 shadow-*`，`overflow-hidden`。地图容器 `aria-hidden`、`pointer-events-none`。
   - 卡片左下角浮三个统计胶囊（白底、`rounded-2xl`、`shadow`、内含一个 lucide 小图标 + 小字标签 + 粗体数字）：「作品 {works}」「城市 {cities}」「攻略 {posts}」，数据来自 `stats`，`stats` 缺失时不渲染这一组。图标用 `Film`、`MapPin`、`BookOpen`。
   - 卡片右上角浮一个「放大预览」小卡（约 `w-72`，白底、`rounded-2xl`、`shadow-xl`、`p-2`）：里面是一张静态地图缩略图 + 一张点位小卡。**静态地图直接复用 `public/images/home/hero-phone-map.webp`（320×240）**，用 `<img>` 显示，`object-cover`，`rounded-xl`，上面按 `demo.map.markers` 的 CSS 像素坐标画粉色小圆点（做法与 `HomeHeroPhone.tsx` 里画 markers 一致，先读那个文件）。缩略图右上角一个小胶囊「东京 · 新宿区」（这一句用 i18n key `mapInsetArea`，三语固定文案）。下面一张点位小卡：左侧 `demo.day.items[0].imageUrl` 缩略图（`h-12 w-12 rounded-lg object-cover`），右侧 `demo.day.items[0].title`（按 locale 取 `titles[locale]`），末尾一个 `ChevronRight`。卡片底部一行小字：「每一个点都能点开看」。
   - 因此 Props 还要加一个可选 `demo?: HomeHeroDemoLike`（类型见 `components/home/heroDemoShape.ts`），`HomePageTemplate` 把 `data.heroDemo` 传进来；`demo` 或 `demo.map` 缺失时不渲染这张预览小卡（其余照常）。
6. 卡片下方居中：粉色胶囊按钮「打开地图」（`Link` 到 `prefixPath('/map', locale)`，带 `ArrowRight`），右侧一行小字「免登录，随便逛」。

移动端：数字与标题缩小，统计胶囊改成地图卡片下方横排三格，放大预览小卡隐藏（`hidden lg:block`）。

### 地图本体

沿用 `HomeMapTeaser.tsx` 的 maplibre 接入方式（动态 import、`readMaplibreModule`、`interactive:false`、`attributionControl:false`、`renderWorldCopies:false`、WebGL 失败静默降级、卸载时 `remove()`），在此基础上改为世界视角：

- 初始视野：`center: [140, 20]`，`zoom` 按容器宽度取 1.2 ~ 1.8（`lg` 约 1.6），不再 `fitBounds` 到日本；要求一屏内同时看到东亚、澳大利亚、北美西岸与欧洲。
- 底图样式：仍用 `getRouteMapStyleCandidates()[0].style`，但**叠加一层极简化**：地图 `load` 后把底图样式里的 `symbol` 图层（地名文字）全部 `setLayoutProperty(id, 'visibility', 'none')`，让画面只剩陆地/水面/国界；若底图是 raster（无 key 的 OSM 兜底）就跳过这步。
- 点位图层，三层叠加做出「热力光斑」感（全部 `type:'circle'`，同一个 geojson source，`cells` 每格一个 feature，属性 `count`）：
  1. 光晕层：`circle-color: #ec4899`，`circle-radius` 按 count 插值 6 → 22（`['interpolate',['linear'],['get','count'], 2, 6, 100, 12, 1000, 18, 10000, 22]`），`circle-opacity 0.12`，`circle-blur 1`；
  2. 中间层：半径 2 → 8，`opacity 0.35`，`blur 0.6`；
  3. 核心点：半径 1.2 → 3.5，`opacity 0.9`，`blur 0`。
  目的：日本几乎被粉色铺满，东京/京都/大阪最亮，海外每个城市是一小簇清晰但更稀的点。
- 城市标签：`labels` 数据（目前全是日本城市，最多 8 条）用 HTML 浮层而不是 maplibre symbol：地图 `load`/`move` 后用 `map.project([lng,lat])` 得到像素坐标，绝对定位一组白色小胶囊（`rounded-full bg-white/95 px-2.5 py-1 text-xs shadow`），内容「{城市名} {count}」，count 用粉色粗体。名字按 locale 取 `label.name[locale]`。标签之间做最简单的碰撞规避：按 count 降序，若与已放置标签的矩形相交则跳过。`resize` 时重算。**这一段的辅助纯函数（像素碰撞判定、数字取整到千位、副标题拼接）放到 `components/home/homeMapDatabase.ts`，可在 node 里直接单测。**
- 只在容器进入视口附近后才初始化（约束 6）；`prefers-reduced-motion` 不影响地图（地图本身没动画）。

### 测试

新增 `tests/components/home/HomeMapDatabase.test.tsx`（参考被删的 `HomeMapTeaser.test.tsx` 的 FakeMap 写法）：

- 渲染出 「50,000」+「+」（用 fixture `totalPoints: 50597`）、标题、三个统计胶囊的真实数字；
- `IntersectionObserver` 在 jsdom 里没有：mock 成立即回调，断言 maplibre `Map` 被构造且 `renderWorldCopies === false`、加了三层 circle layer；
- 无 `stats` 时不渲染统计胶囊；无 `demo.map` 时不渲染放大预览小卡；
- `cells` 为空时返回 null。

`tests/components/home/homeMapDatabase.test.ts`：纯函数测试（取整到千位、碰撞判定、副标题拼接与缺省）。

## 3. 第三屏：`components/home/HomeShowcasePlan.tsx` 重做

数据不变：`showcase: HomeShowcase`（`content/generated/home-showcase.json` 的真实行程，8 天，items 类型 `point | transit | meal | lodging | attraction | free`，`payload.schedule.{start,end,confidence}`、`payload.transport.{mode,durationMin,distanceKm,transfers}`、`payload.media.displayUrl`、`point.image` / `point.name`）。**先读** `app/(authed)/plan/[id]/components/DayCards.tsx`（现有 `DaymapCard` 渲染器）和 `components/home/heroData.ts`和 `components/home/heroDemoShape.ts` 里 `heroDemoItems` 的取图逻辑，复用其中的取图、取时间、交通文案的辅助函数（若这些函数在其它模块里，直接 import，不复制）。原来的自动轮播（Day 标签定时切换、用户一动就停、尊重 reduced-motion）保留。

### 版式（桌面 `lg`）

顶部居中：

1. 小字粉色：「定制专属巡礼行程」
2. 两行粗体大标题（`text-3xl lg:text-5xl font-extrabold`）：「从出发到回程，」换行「每一天都是{精心规划}的巡礼之旅」，`{精心规划}` 用 `text-brand-600`。i18n 用与 `heroTitle` 相同的 `{accent}` 模板做法（看 `HomeHero.tsx` 的 `HeroTitle`）。
3. 灰色副标题：「说出作品和假期，规划师排好每天的点位、交通与餐厅。」

主体：左右两栏（`lg:grid-cols-[300px_minmax(0,1fr)] gap-6`），移动端上下堆叠。

**左栏「行程概览」卡**（白底 `rounded-3xl border shadow`，`p-6`）：

- 顶部一行：粉色小图标（`Route`）+「行程概览」；
- 行程标题：`showcase.title` 太长（当前是「2026东京圣诞周8日｜…」）——只取「｜」或「|」之前的部分作为标题，取不到就全量，`line-clamp-2`；
- 一行灰字：「{N} 天 · {城市列表}」，N = `days.length`，城市从 `days[].citySlug` 去重后显示；城市名不能查库（这是客户端组件），在 `components/home/homeShowcase.ts` 里放一张小的 slug → 三语名静态表（至少 tokyo/kyoto/osaka/kamakura/nara/nagoya/yokohama/sapporo/fukuoka/hakone/kobe/numazu/hanno），表里没有的 slug 显示为首字母大写；
- 一排胶囊标签（`bg-brand-50 text-brand-700 text-xs rounded-full`）：从 `days[].items` 里 `type==='point'` 的标题中提取作品名（标题格式是「作品名・点位名」，取「・」之前的部分，去重，最多 4 个）；
- 四行小项目（图标 + 灰色小标题 + 值）：「天数 {N} 天」「巡礼点位 {point 类型条目数} 处」「包含作品 {上面提取的作品名逗号连接}」「住宿 {lodging 去重后的名字，取第一条}」——没有的项目不显示；
- 底部一张大图（`aspect-[4/3] rounded-2xl object-cover`）：第一个有 `imageUrl` 的 point 条目的图片（复用 `heroDemoItems(showcase.days, 1)` 取图），图上左下压一行白字「{行程标题}」和小字「{N} 天 · 规划师生成」。
- 左栏底部按钮：粉色胶囊「用规划师做一份我的」→ `planStartHref(locale)`（现有 `showcaseCta` 文案）。

**右栏「逐天」卡**（白底 `rounded-3xl border shadow`，`p-5 lg:p-6`）：

- 顶部 Day 标签行：每天一个胶囊按钮，选中态 `bg-brand-600 text-white`，未选中 `bg-gray-100 text-gray-700`；胶囊里第一行「Day N」，第二行小字是 `day.date` 格式化成「MM-DD」——**当前数据 `date` 为 null，则不显示第二行**，不要编日期。超过 6 天时标签行横向滚动（`overflow-x-auto`，隐藏滚动条）。
- 标签行右侧：描边胶囊按钮「查看完整行程」→ `planStartHref(locale)`。
- 下面一行：粉色小图标 + 「Day N」+ 灰字 `day.summary`（`line-clamp-1`）。
- 时间轴列表：左侧一条竖线 + 粉色圆点；每行左列是时间与类型（`schedule.start` 有就显示 `HH:MM`，没有就不显示；类型用 lucide 图标 + 小字：point→`MapPin`「圣地」、meal→`Utensils`「用餐」、lodging→`BedDouble`「住宿」、attraction→`Ticket`「景点」、free→`Footprints`「自由活动」），右列是一张条目卡（`rounded-2xl border border-gray-200 p-3`，左侧 `h-16 w-16 rounded-xl object-cover` 缩略图，取 `payload.media.displayUrl` 或 `point.image`，都没有就用一个浅灰占位块；中间标题 `font-semibold text-gray-900` + 一行 `text-xs text-gray-500` 的 `note`，`line-clamp-1`；右侧一个浅色胶囊标签：point→「圣地」、meal→「美食推荐」、lodging→「住宿」、attraction→「景点」、free→「自由活动」）。
- **`transit` 条目不做成卡片**：在相邻两张卡片之间显示一行极小的灰字「{交通方式} {durationMin} 分钟{ · distanceKm km}」，交通方式按 `transport.mode`（walk→步行、train/rail/subway→电车、bus→巴士、其它→交通）。没有 `transport` 时显示「→」占位一行即可。
- 每天最多显示 6 张卡片（按 sortOrder），超过的折叠成一行「还有 {n} 项 · 查看完整行程」链接。
- **不要出现**「已预订」「已确认」这类暗示站内下单的标签，也不要天气。

移动端：左栏概览卡放在上方、去掉底部大图；Day 标签横向滚动。

### 测试

重写 `tests/components/home/HomeShowcasePlan.test.tsx`：

- 用一个 3 天的 fixture（含 point/transit/meal/lodging，有的 item 有 `schedule.start`，有的没有），断言标题、Day 标签数量、作品名提取（「你的名字・须贺神社男坂」→「你的名字」）、transit 显示为交通小行而非卡片、第 7 项开始折叠、没有「已预订」字样；
- `date` 为 null 时 Day 胶囊没有第二行；
- 提取作品名 / 标题截断 / 交通文案这些纯函数放到 `components/home/homeShowcase.ts`，单独 `tests/components/home/homeShowcase.test.ts` 覆盖。

## 4. i18n 新增键（`pages.home.v2` 下）

第二屏：`mapDbEyebrow`、`mapDbTitle`、`mapDbSubtitle`（含 `{works}` `{cities}` 占位，用「 · 」分节）、`mapDbSubtitleTail`（「每天都在增加」）、`mapDbStatWorks`、`mapDbStatCities`、`mapDbStatPosts`、`mapInsetArea`、`mapInsetHint`、`mapDbCta`（沿用 `mapTeaserCta` 亦可）、`mapDbCtaNote`。旧的 `mapTeaserTitle/Subtitle/Cta` 若无人再用则删除（三语同步）。

第三屏：`planEyebrow`、`planTitle`（含 `{accent}`）、`planTitleAccent`、`planSubtitle`、`planOverview`、`planDays`（「{n} 天」）、`planSpots`、`planWorks`、`planLodging`、`planGenerated`（「规划师生成」）、`planViewFull`、`planMore`（「还有 {n} 项」）、`planTypePoint/Meal/Lodging/Attraction/Free`、`planTransitWalk/Train/Bus/Other`、`planMinutes`（「{n} 分钟」）。已有的 `showcaseTitle/showcaseSubtitle/showcaseCta` 中还用得上的保留。

zh/en/ja 三份都要写全；`npx vitest run tests/i18n` 若有键完整性测试也要过。

## 5. 汇报

完成后用简短中文汇报：改动/新增/删除的文件清单、三条完成标准命令的结果、以及你认为需要人工确认的点（例如某个 slug → 城市名的映射没找到现成函数）。
