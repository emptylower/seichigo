# 首页第四到第六屏重做（攻略 / 作品与城市 / FAQ + 收尾行动区）

日期：2026-09-07　分支：feat/home-screens-v2（当前 worktree）。前置：`2026-09-07-home-screens-v2.md`（第二、三屏）已完成，本文是同一轮视觉重做的下半部分。**先读前置文件的 §0（视觉语言与硬约束），全部同样适用。** 另外：

- 不要改本轮之前已完成的 `HomeMapDatabase.tsx`、`HomeShowcasePlan.tsx`、`homeMapDatabase.ts`、`homeShowcase.ts`（如需共享小工具，新建文件）。
- `HomePageTemplate.tsx` 只允许改本文点名的地方（第六屏换组件、给收尾行动区传 stats）。
- `lib/home/**`、`scripts/**`、`content/generated/**`、`public/images/**`、`HomeHero*.tsx` 仍然不许改。
- 所有数字来自真实数据（`postCount`、`HomeStats`）；**文章数据（`PublicPostListItem`）没有作者与摘要字段，卡片上不要出现作者、头像、摘要**，也不要用占位文字冒充。

完成标准：

```
npm run typecheck
node scripts/check-line-budget.mjs
npx vitest run tests/components/home tests/home tests/i18n
```

## 1. 第四屏：`components/home/HomeGuides.tsx` 重做

数据不变：`items: PublicPostListItem[]`（最多 6 篇；字段 `path`、`title`、`cover`、`localizedAnimeNames`/`animeIds`、`localizedCity`/`city`、`publishDate`/`publishedAt`、`localizedTags`/`tags`）。

版式（桌面 `lg`）：左右两栏，`lg:grid-cols-[300px_minmax(0,1fr)] gap-8`。

**左栏（sticky 不需要）**：

1. 小字粉色带竖条：「巡礼攻略」（沿用 `guidesTitle`）；
2. 两行大标题（`text-3xl lg:text-4xl font-extrabold`）：「来自{真实旅行者}的」换行「动漫圣地巡礼攻略」，`{真实旅行者}` 用 `text-brand-600`，i18n 用 `{accent}` 模板（与 `HomeHero.tsx` 的 `HeroTitle` 同法）；
3. 灰色两行副标题：「不只是地图和坐标，更有同好们走过的路、拍过的照片、吃过的美食和真实的感受。」；
4. 四个卖点（每个：`h-10 w-10 rounded-xl bg-brand-50 text-brand-600` 图标块 + 粗体小标题 + 灰色小字）：「真实体验 / 动漫迷亲身撰写」「详细路线 / 交通 · 住宿 · 美食」「实拍照片 / 沉浸式现场感」「实用建议 / 避坑指南 · 贴心提醒」；图标 `Users`、`MapPin`、`Camera`、`MessageSquareText`；
5. 左栏底部一行浅粉斜体小字（`text-brand-400 italic text-sm`）：「和同好一起，去看那些屏幕里的风景。」

右栏：顶部右侧一个描边胶囊按钮「查看全部攻略 →」（`prefixPath('/posts')`，沿用 `guidesViewAll`）。下面 3 列 × 2 行卡片（`md:grid-cols-2 lg:grid-cols-3 gap-5`）：

- 卡片 `rounded-2xl border border-gray-200 bg-white shadow-sm hover:shadow-lg` 过渡；
- 封面 `aspect-[16/10] object-cover`，hover 轻微放大（现有做法）；封面左上压一个半透明深色胶囊（`bg-black/45 text-white text-[11px] backdrop-blur`）：「{作品名} · {城市}」，作品名取第一个 `localizedAnimeNames`（过滤 `unknown`），没有作品名就只显示城市，两者都没有不显示胶囊；
- 卡片内容区 `p-4`：标题 `font-bold line-clamp-2`；下面一行 `text-xs text-gray-500`：`MapPin` 图标 + 城市，`CalendarDays` 图标 + 日期（`publishDate ?? publishedAt`，格式化成 `YYYY-MM-DD`；两个都没有就不显示日期）；
- 没有 `cover` 的用现有的浅粉渐变占位。

移动端：左栏在上，卖点改成 2×2；卡片单列。

测试：重写 `tests/components/home/HomeGuides.test.tsx`：渲染 6 篇、胶囊文案「作品 · 城市」、无作品名时只显示城市、无日期时不显示日期、标题里 `{accent}` 被拆成粉色片段、没有任何「作者」「摘要」相关 DOM。

## 2. 第五屏：`components/home/HomeBrowse.tsx` 重做

数据不变：`anime: HomePopularAnimeItem[]`（`anime.id`、名字取 `anime.name_zh/name_en/name_ja` 之类——先读 `components/anime/AnimeCard.tsx` 看现在怎么取本地化名与链接，复用其函数）、`cities: HomePopularCityItem[]`（`city.slug`、`city.name_zh/name_en/name_ja`、`city.cover`、`postCount`）。**不再使用 `AnimeCard` / `CityCard`**（它们是列表页的样式），本段自绘卡片；但链接构造逻辑从它们那里 import 或复制其 `href` 规则。

版式：

顶部居中：小字粉色「发现更多创作与旅行灵感」；大标题「热门作品 {&} 热门城市」，`&` 用 `text-brand-600`；灰色副标题「从你喜欢的作品出发，或前往心仪的城市，找到更多巡礼灵感。」

主体左右两栏（`lg:grid-cols-2 gap-10`）：

- 每栏顶部：粉色小图标（作品 `Clapperboard`，城市 `MapPin`）+ 粗体栏标题 +（下一行）灰色小字说明「精选高人气动漫作品，查看对应的巡礼攻略。」/「探索动漫中的真实场景，发现值得一去的目的地。」；右侧描边胶囊「全部作品 →」「全部城市 →」。
- 作品栏：4 列（`grid-cols-2 sm:grid-cols-4 gap-4`），最多 8 个。卡片：竖版海报 `aspect-[3/4] rounded-2xl overflow-hidden`，下面作品名 `font-semibold line-clamp-1`，再下面一个浅粉胶囊「攻略 {postCount} 篇」（`bg-brand-50 text-brand-700 text-xs`，图标 `BookOpen`）。没有封面用浅粉渐变。
- 城市栏：4 列，最多 12 个（`grid-cols-2 sm:grid-cols-4 gap-4`）。卡片：`aspect-[4/3]` 封面（`city.cover`，无则浅粉渐变 + 居中城市名首字），下面城市名 + 同款「攻略 {postCount} 篇」胶囊。
- `postCount` 为 0 的条目胶囊不显示（不要显示「0 篇」）。

移动端：两栏上下堆叠，网格 2 列。

测试：重写 `tests/components/home/HomeBrowse.test.tsx`：作品最多 8、城市最多 12、胶囊数字来自 `postCount`、0 篇不渲染胶囊、无封面占位、`&` 是粉色片段。`HomePopularAnime.test.tsx` / `HomePopularCities.test.tsx` 若引用了被改的东西同步修，若与本段无关则不动。

## 3. 第六屏：FAQ + 收尾行动区

### 3.1 `components/home/HomeFaq.tsx` 重做

问答内容换成下面五条（三语；**答案要与产品事实一致，不许照设计稿的营销话术**）。i18n 键沿用 `pages.home.faqQ1..5 / faqA1..5`，直接改值；`faqSectionTitle` 改「你可能会关心这些问题」，`faqSectionSubtitle` 改「如果有更多问题，欢迎通过页脚的联系方式找我们。」；另加小字 eyebrow `faqEyebrow`「常见问题」。

| # | 问 | 答（zh；en/ja 自行翻译） |
|---|---|---|
| 1 | 什么是圣地巡礼？ | 圣地巡礼是去动漫作品里出现过的真实取景地旅行。SeichiGo 把这些取景地整理成可查的点位地图，你可以按作品或城市找到它们，并对照作品画面亲自去看一眼。 |
| 2 | 规划师是怎么排行程的？ | 你说出想巡礼的作品、天数和城市，规划师会从点位库里挑出对应取景地，按地理位置分到每一天并排好顺序，再补上路线交通与用餐建议，生成可逐天查看、可继续调整的行程。 |
| 3 | 免费能用到什么？ | 点位地图、作品与城市索引、巡礼攻略全部免费。规划师免费档可以生成最多 3 天的行程，交通按直线距离估算、不含餐厅推荐；开通标准版后可解锁真实交通查询与餐厅推荐，行程最多 7 天。 |
| 4 | 点位数据从哪来？ | 点位来自公开的动漫巡礼数据库（Anitabi）与用户投稿，我们会持续同步更新，并对坐标与作品对应关系做校正。发现错误可以通过页脚联系方式反馈。 |
| 5 | 可以自己改行程吗？ | 可以。行程生成后，你可以在计划页直接告诉规划师想改的地方（换点位、调顺序、增减天数），它会在原行程上调整；也可以保存后随时回来继续修改。 |

版式：顶部居中 eyebrow + 大标题 + 副标题；下面两列（`md:grid-cols-2 gap-4`）的问答卡，卡片 `rounded-2xl border border-gray-200 bg-white p-5`，左侧 `h-8 w-8 rounded-full bg-brand-50 text-brand-700 font-bold` 圆形序号「01」，右侧问题粗体 + 答案灰字；仍用 `<details>/<summary>`，**第一条默认 `open`**，其余折叠；右侧展开箭头用 `ChevronDown`，`group-open:rotate-180`。第五条单独一行时靠左（自然网格即可）。FAQ JSON-LD（`buildFAQPageJsonLd`）保留。

### 3.2 新增 `components/home/HomeFinalCta.tsx`

Props：`{ locale: SiteLocale; stats?: HomeStats }`。放在 `HomeFaq` 之后、作为 `data-home-sections` 容器内最后一段（在 `HomePageTemplate` 里加，并传 `data.stats`）。

版式：一个通栏感的横幅卡（`rounded-3xl overflow-hidden relative`，高度约 `h-[300px] lg:h-[340px]`），背景复用第一屏的插画：`<img src="/images/home/hero-bg-landscape.webp">` `object-cover object-center`，上面压一层 `bg-white/75` 到 `bg-white/55` 的渐变让中间文案区可读；四片花瓣用与 `HomeHeroBackground.tsx` 相同的 keyframes 写法（拷贝 2 条 keyframes 到本组件的 `<style>`，`aria-hidden`，`lg` 才显示，`prefers-reduced-motion` 关闭）。

居中内容：

1. 小字粉色「开启你的动漫圣地巡礼之旅」；
2. 大标题（`text-3xl lg:text-5xl font-extrabold`）：「说出{作品}和{假期}，{规划师}帮你排好」——i18n 用一个模板 `finalCtaTitle` 含 `{a1}` `{a2}` `{a3}` 三个占位，三个词分别是 `finalCtaAccent1..3`，全部 `text-brand-600`（写一个小的模板渲染函数放在 `components/home/homeFinalCta.ts`，可单测）；
3. 一个输入框 + 按钮的表单（与第一屏的 composer 同样式：`rounded-2xl border bg-white p-2 shadow-lg`，粉色按钮「开始规划」+ `ArrowRight`）：受控输入、占位符用 `pages.home.v2.composerExample1`、提交后 `router.push(planStartHref(locale, draft))`，空输入不提交，输入法组词中的回车不提交（照抄 `HomeHero.tsx` 里 `onKeyDown` 的 `isComposing` 处理）。不要打字机效果。
4. 底部一行小字，两侧各一枝 `HeroLaurel`：「全球 {points}+ 巡礼点位 · {works}+ 动漫作品 · 你的专属行程」，`points` 取整到万位（zh/ja「5 万」「5万」，en「50k」——复用或对齐 `HomeHero.tsx` 里 `roundedPoints` 的口径，不要 import 它，`HomeHero` 不可改，把同样逻辑放到 `homeFinalCta.ts`），`works` 直接用真实值；`stats` 缺失时只显示「你的专属行程」这一小节。

测试：`tests/components/home/HomeFinalCta.test.tsx`（标题三个粉色片段、提交跳转到 `planStartHref`、空输入不跳、无 stats 时的小字）、`tests/components/home/homeFinalCta.test.ts`（模板渲染与点位取整）。`HomeFaq.test`（若不存在则新建）断言五条问题与第一条默认展开；`HomePageTemplate.test.tsx` 同步新段。

## 4. i18n

新增/修改键都在 `pages.home.v2`（FAQ 的在 `pages.home`）。zh/en/ja 三份同步，`npx vitest run tests/i18n` 通过。删除不再使用的旧键（`browseTitle` 等）时先 grep 确认没有别处引用。

## 5. 汇报

简短中文：改动/新增文件、三条命令结果、需要人工确认的点。
