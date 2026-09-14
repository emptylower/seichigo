# Sitelinks 争取方案：导航一致性与 AI 规划公开入口（设计）

日期：2026-09-14　状态：已被联合方案取代　范围：方案 A + 品牌规则

> 2026-09-14 与 Astra（Codex）两轮评审后，实施以 `docs/superpowers/plans/2026-09-14-sitelinks-joint-plan.md` 为准。本稿中被否决或修改的条目：日文「聖地マップ / 聖地の都市」改为「巡礼マップ / 都市ガイド」；`(authed)` 整组 noindex 改为 `/plan`、`/plan/[id]` 两页各自 noindex；根布局默认 title 不改；新英日页面不再自行套壳；中文入口移入独立路由组 `(plan-start)`；首页 CTA 直接生成本地化路径，root `?locale=` 只做 307 兼容；sitemap 另补三语 `/posts`；`sameAs` 只删错误项。本稿保留作为需求背景。

## 背景与目标

2026-09-14 实搜确认，「圣地巡礼」下首页自然排名第 3，但移动端被 Anitabi 的 sitelinks 块和「圣地巡礼」知识面板压到约 4 屏以下，CTR 从 23% 跌到 7%。完整 sitelinks 只给排第 1 且被判定为导航意图的站点，我们能争取的是：

1. 头词下我们条目的单行 sitelinks（结果下方一排小链接）。
2. 品牌词「seichigo」下的完整 sitelinks（基线：2026-08-17 到 09-13 品牌词曝光 12 次）。

两者共用同一套站内结构改动。不改首页信息架构（9 月 8 日刚改过标题摘要，避免归因混乱），不加 SiteNavigationElement 结构化数据（Google 不承认其作用）。套餐页 /pricing 明确不在范围内。

## 现状问题（2026-09-14 生产抓取）

- 同一栏目多种叫法：/posts 页头「热门攻略」、页脚「文章」、首页卡片「巡礼攻略」；/city「热门城市」对「城市」；/map「地图」对首页卡片「地图探索」。
- AI 规划没有可被搜索引擎当作入口的页面：三语页头「计划」都链到未本地化的 /plan，匿名访问 307 到登录页；/plan/start 匿名可开但 title 是布局默认值「SeichiGo — 动漫圣地巡礼攻略」，/en/plan/start 与 /ja/plan/start 为 404，也不在 sitemap。
- /plan 与其他登录后页面对搜索引擎可见（robots index,follow）。
- Organization JSON-LD 的 sameAs 写 github.com/seichigo，页脚链接是 github.com/emptylower/seichigo。

## 第 1 节：导航与锚文本统一

原则：每个主入口全站只有一个名字。该名字同时用于页头、移动端抽屉、页脚、首页入口卡片标题、面包屑根节点，以及该栏目页 title 的第一段。

| 路径 | 中文 | 日文 | 英文 |
|---|---|---|---|
| /map | 巡礼地图 | 聖地マップ | Pilgrimage Map |
| /posts | 巡礼攻略 | 巡礼ガイド | Pilgrimage Guides |
| /plan/start | AI 规划 | AIプランナー | AI Planner |
| /city | 巡礼城市 | 聖地の都市 | Pilgrimage Cities |

页头顺序：巡礼地图、巡礼攻略、AI 规划、巡礼城市、套餐。「套餐」保留现状不动。「作品」/anime 只保留页脚与首页区块入口，三语名字统一为「作品 / 作品 / Anime」，不进页头。

改动点：

- `lib/i18n/locales/{zh,en,ja}.json`：`header.map/posts/plan/city` 与 `footer.posts/city/anime` 改为上表字符串；新增 `footer.map`、`footer.plan`；首页入口卡片 `entryMapTitle`、`entryPlanTitle` 改为「巡礼地图」「AI 规划」（三语同理）。
- `components/layout/HeaderPublic.tsx`、`components/layout/HeaderMobileDrawer.client.tsx`、`components/layout/Footer.tsx`：AI 规划链接改为 `prefixPath('/plan/start', locale)`；页脚补「巡礼地图」「AI 规划」两项，与页头同名同序。
- `components/home/HomeEntryCards.tsx`：仅通过文案 key 生效，不改结构。
- 栏目页 title 第一段对齐：`app/(site)/city/page.tsx`、`app/en/city/page.tsx`、`app/ja/city/page.tsx` 的 title 与 openGraph/twitter title 第一段改为表中名字；`app/ja/map` 的「巡礼マップ」改为「聖地マップ」。其余栏目页核对即可，第一段已一致的不改。
- 面包屑（`components/layout/Breadcrumbs.tsx`）若含栏目根节点标签，取同一组 i18n key，不另写字符串。

## 第 2 节：AI 规划的公开入口页

目标：一个匿名可访问、三语各一个 URL、可索引、有正文的页面，作为「AI 规划」全站唯一入口；其余登录后页面对搜索引擎隐藏。

- **路由**：保留 `app/(authed)/plan/start` 作为中文版 `/plan/start`；新增 `app/en/plan/start` 与 `app/ja/plan/start`，复用同一个 `PlanStartClient` 与 `page.tsx` 的取参逻辑，只把 locale 写死为 en / ja。现有 `?locale=` 与 `?draft=` 参数逻辑保留，首页输入框跳转行为不变。新路由不在 `(authed)` 分组内，因此需要自行套 `SiteShellPublic`（与 `app/en/layout.tsx`、`app/ja/layout.tsx` 现有做法一致）。
- **元数据**：三语各自 `title`、`description`。中文 title「AI 规划｜一句话生成动漫圣地巡礼行程」（模板补 `| SeichiGo`），日文「AIプランナー｜作品と日程を伝えるだけで聖地巡礼の行程を作成」，英文「AI Planner | Turn One Sentence into an Anime Pilgrimage Itinerary」。description 各一句，写清"说出作品和假期，规划师排好每天路线与交通"。`canonical` 指向不带查询参数的干净 URL；三语互相声明 hreflang 与 x-default（指中文），做法与 `app/(site)/city/page.tsx` 相同。
- **正文**：在输入框上方加 H1（等于入口名）和一段两三句的说明，三语各一份，文案进 i18n。不加更多营销区块。
- **登录后页面隐藏**：`app/(authed)/layout.tsx` 导出 `metadata = { robots: { index: false, follow: false } }`，覆盖 /plan、/plan/[id]、/me、/submit、/admin；`app/(authed)/plan/start/page.tsx` 在页面级导出 `robots: { index: true, follow: true }` 覆盖回来。`robots.ts` 不加 Disallow，让 Google 能读到 noindex。
- **sitemap**：`app/sitemap.ts` 补 `/plan/start`、`/en/plan/start`、`/ja/plan/start`，带 alternates，优先级与 `/map` 同级。

## 第 3 节：标题修正、品牌规则

- `app/layout.tsx` 根布局默认 title 从「SeichiGo — 动漫圣地巡礼攻略」改为「SeichiGo」，模板 `%s | SeichiGo` 不变。
- Organization JSON-LD 的 `sameAs` 改为真实地址：`https://x.com/xixingshu`、`https://github.com/emptylower/seichigo`。
- 品牌规则（并入外联攻势，不新开渠道）：所有外发内容第一次提到站点时写「SeichiGo（动漫圣地巡礼地图与 AI 规划）」；日文「SeichiGo（アニメ聖地巡礼マップと AI プランナー）」；英文「SeichiGo (anime pilgrimage map and AI planner)」。站内 title 模板维持「页面名 | SeichiGo」。此条写入外联守则记忆，不涉及代码。

## 验收（预览环境，上线前）

1. 三语页头、抽屉、页脚对 /map、/posts、/plan/start、/city 的锚文本完全一致，且等于各页 title 第一段。
2. `/plan/start`、`/en/plan/start`、`/ja/plan/start` 匿名访问 200，各自 title、description、canonical、hreflang 正确，正文有 H1 与说明段；带 `?draft=` 时 canonical 仍是干净 URL。
3. `/plan`、`/me`、`/submit`、`/admin` 任一页 meta robots 为 noindex；`/plan/start` 为 index。
4. `/sitemap.xml` 含三语 `/plan/start`。
5. `tests/components/layout/guidesNavLinks.test.tsx` 按新链接与文案更新并通过；新增一个测试断言三语 header/footer 对四个入口的文案相等。
6. 首页输入框带 draft 跳转到 /plan/start 后草稿仍在（回归）。

## 上线后测量（三到六周）

每周一次：有头浏览器搜「圣地巡礼」（gl=jp 与 gl=cn，手机版），记录我们条目下方是否出现单行链接；GSC 看品牌词「seichigo」曝光与点击、首页 CTR。基线 2026-09-14：品牌词月曝光 12、首页 CTR 7%、自然排名 3.9。

## 不做的事

- 不改首页区块顺序与结构。
- 不加 SiteNavigationElement。
- 不动 /pricing 的名字、title 与 sitemap。
- 不改 robots.txt。
