# 联合方案 v1：sitelinks 站内结构改造（Claude × Astra）

日期：2026-09-14  
状态：Astra 同意，待 Claude 签字；实施与运行验收尚未进行。

本轮已读取三份讨论文档，并完成本地代码与同版本 Next.js 实现的只读核对及独立复核。未修改文件，未运行构建、测试、Git 写操作或网络请求。Project memory loaded: 15 projects.

## 1. 对修改 A—F 的裁决

| 修改 | 裁决 | 理由与定稿修正 |
|---|---|---|
| A：独立 `(plan-start)` 路由组，不改全局语言解析 | **接受** | 三个路由模式可以共存。必须同时固定中文 page 的正文语言；仅固定 layout 不够。公共页头、页脚仍生成，但在起始页被 immersive CSS 隐藏。 |
| B：首页直接生成本地化路径 | **接受** | 新入口直接到目标语言路径；旧 root query 仅承担兼容。补上遗漏的 HomeFinalCta 调用与测试。 |
| C：缩小 metadata、品牌与其他改动范围 | **接受** | 澄清：改的是城市**索引页** H1；城市详情 H1 保留城市名。SearchAction 移出本项目，不将“无害”作为本轮已验证结论。 |
| D：首跳与直接导航验收 | **接受** | 必须检查真实 HTTP 首跳；调用了 `redirect()` 不等于已经证明返回 307。 |
| E：明确期望值的一致性测试 | **接受** | 名称、href、顺序分别断言；移动端查询限定在 dialog。补齐地图加载占位标题的语言传递。 |
| F：限制效果承诺 | **接受** | 交付承诺止于技术可访问性、索引许可及入口语言、链接信号的一致性。 |

没有需要进入下一轮才能解决的反对项。以下小修正直接纳入全文：城市详情 H1 的措辞、两处遗漏的现有测试、地图加载占位的本地化，以及首跳 307 的实施约束。

## 2. 关键代码事实

### 2.1 路由组可以共存，迁移不能变成复制

工作区锁定 Next **15.5.15**，见 [package-lock.json:13607](/Users/mac/Desktop/seichigo-wt-sitelinks/package-lock.json:13607)。本轮框架核对使用同机主仓安装的相同版本，版本见 [/Users/mac/Desktop/seichigo/node_modules/next/package.json:3](/Users/mac/Desktop/seichigo/node_modules/next/package.json:3)。

拟定路由：

| 文件 | 对外路由 |
|---|---|
| `app/(authed)/plan/page.tsx` | `/plan` |
| `app/(authed)/plan/[id]/page.tsx` | `/plan/[id]` |
| `app/(plan-start)/plan/start/page.tsx` | `/plan/start` |

Next 规范化路径时忽略路由组与末尾 `page`，见 [app-paths.js:25](/Users/mac/Desktop/seichigo/node_modules/next/dist/shared/lib/router/utils/app-paths.js:25)。静态子路径排在动态参数路径之前，见 [sorted-routes.js:44](/Users/mac/Desktop/seichigo/node_modules/next/dist/shared/lib/router/utils/sorted-routes.js:44)。因此精确 `/plan/start` 不会被 `/plan/[id]` 抢占，也不会因为共享 `/plan` 前缀而继承 `(authed)` layout。

**必须删除迁移前的 start page。** 同时保留两个组中的 start page 会产生相同 URL 的页面冲突；Next 的对应检查见 [next-app-loader/index.js:463](/Users/mac/Desktop/seichigo/node_modules/next/dist/build/webpack/loaders/next-app-loader/index.js:463)。

两组继续共享 [app/layout.tsx:60](/Users/mac/Desktop/seichigo-wt-sitelinks/app/layout.tsx:60) 的根 layout。Next 在发现双方相同根 layout 标记后，不再把其下的分组差异视为更换根 layout，见 [is-navigating-to-new-root-layout.js:27](/Users/mac/Desktop/seichigo/node_modules/next/dist/client/components/router-reducer/is-navigating-to-new-root-layout.js:27)。本次分组本身不会触发“跨根 layout 必须整页加载”。

这些是源码层面的结论，实施后仍需构建与导航验收。

### 2.2 公共壳确实渲染，但起始页的公共导航不可见

[SiteShellPublic.tsx:13](/Users/mac/Desktop/seichigo-wt-sitelinks/components/layout/SiteShellPublic.tsx:13) 与第 17 行无条件生成 Header、Footer；第 14 行生成包裹正文的 main。

起始页在 [ui.tsx:103](/Users/mac/Desktop/seichigo-wt-sitelinks/app/(authed)/plan/start/ui.tsx:103) 设置 `data-layout-immersive="true"`。[styles/globals.css:35](/Users/mac/Desktop/seichigo-wt-sitelinks/styles/globals.css:35) 将该壳的直接 header、footer 设为 `display:none`，第 40 行另去掉 main 的宽度与留白限制。

因此：

- 页头、页脚存在于生成结构中，正常应用 CSS 后不显示。
- 当前可见顶部是起始页自己的标题栏，H1 在 `ui.tsx:106`，返回首页链接在第 108 行。
- 固定中文壳语言可以保证生成结构一致，但不能称为修复了“当前可见公共导航的语言”。
- 本次保留沉浸式界面，不要求起始页展示公共页头、页脚；也不把隐藏导航当作本案新增的可见导航成果。

英日父布局已经套壳，见 [app/en/layout.tsx:4](/Users/mac/Desktop/seichigo-wt-sitelinks/app/en/layout.tsx:4)、[app/ja/layout.tsx:4](/Users/mac/Desktop/seichigo-wt-sitelinks/app/ja/layout.tsx:4)。新 page 与共享内容组件均不再套第二层壳。

### 2.3 深链接不跳语言，不代表正文已经固定语言

[middleware.ts:124](/Users/mac/Desktop/seichigo-wt-sitelinks/middleware.ts:124) 在存在语言 Cookie 时放行；第 134 行保留显式语言路径；第 149 行起只允许裸首页参与浏览器语言重定向，第 151 行放行深链接。这支持本次不改 middleware。

但 middleware 仍在第 94 行设置请求语言头。[resolveRequestLocale.ts:29](/Users/mac/Desktop/seichigo-wt-sitelinks/lib/i18n/resolveRequestLocale.ts:29) 对无语言前缀路径继续按 Cookie、Accept-Language 回退；当前 start page 在 [page.tsx:21](/Users/mac/Desktop/seichigo-wt-sitelinks/app/(authed)/plan/start/page.tsx:21) 调用 `getLocale()`。

所以 A 的完整实现必须是：

> 新中文 layout 固定 zh，中文 page 同样固定 zh；英日 page 分别固定 en、ja。起始页内容不再调用 `getLocale()` 决定语言。

全局 resolver、middleware 及 LanguageSwitcher 源码无需修改。LanguageSwitcher 当前只使用 pathname 生成切换目标，见 [LanguageSwitcher.tsx:49](/Users/mac/Desktop/seichigo-wt-sitelinks/components/LanguageSwitcher.tsx:49)、第 57 行，不会主动保留旧 `locale` query。

### 2.4 `planStartHref` 的调用与测试范围

当前 helper 在 [planStartHref.ts:8](/Users/mac/Desktop/seichigo-wt-sitelinks/components/home/planStartHref.ts:8) 为英日附加 `locale` 参数。实际调用点共有四个组件：

| 调用方 | 位置 | 行为 |
|---|---|---|
| HomeHero | `components/home/HomeHero.tsx:107` | 提交草稿 |
| HomeFinalCta | `components/home/HomeFinalCta.tsx:45` | 提交草稿 |
| HomeEntryCards | `components/home/HomeEntryCards.tsx:27` | 无草稿入口 |
| HomeShowcasePlan | `components/home/HomeShowcasePlan.tsx:210`、`:248`、`:316` | 三处无草稿入口 |

Hero 与 FinalCta 已在调用前 trim，并拦截空输入，分别见 `HomeHero.tsx:103`、`HomeFinalCta.tsx:41`。helper 无需再改变草稿内容。

旧协议断言包括：

- `tests/components/home/HomeHero.test.tsx:215`
- `tests/components/home/HomeFinalCta.test.tsx:47`——v2 漏列，补入 Commit 1。
- `tests/components/home/HomeEntryCards.test.tsx:12`
- `tests/components/home/HomeShowcasePlan.test.tsx:236`

另一个遗漏是英文攻略 H1 断言：`tests/posts/postsIndex.test.tsx:42` 仍为 `Pilgrimage guides`，补入 Commit 2。

### 2.5 地图加载占位也属于标题一致性范围

地图完成加载后的标题已符合约定，见 `features/map/anitabi/shared.ts:448`、`:558`、`:668`；H1 使用这些标题，见 `features/map/anitabi/ExplorerPanelContent.tsx:96`。

但 [AnitabiMapPageLazy.tsx:8](/Users/mac/Desktop/seichigo-wt-sitelinks/components/map/AnitabiMapPageLazy.tsx:8) 使用 `ssr:false`，loading 未传 locale；[MapPageSkeleton.tsx:7](/Users/mac/Desktop/seichigo-wt-sitelinks/components/map/MapPageSkeleton.tsx:7) 的 H1 与第 29 行的移动端标题均硬编码中文。

Commit 2 补这两个文件，覆盖加载前后标题。`features/map/anitabi/shared.ts` 保持现状。

## 3. 固定约定

### 3.1 目标与边界

交付目标：

1. 三语 AI 规划入口可匿名访问，有明确正文与独立 metadata。
2. 四个核心入口在约定位置使用一致名称与本地化 URL。
3. 公开入口具有一致的 canonical、hreflang、sitemap 信号；应用层允许索引。
4. 私有计划补充 noindex，保留权限检查。
5. 删除错误 Organization 引用，记录品牌与测量规则。

“允许索引”指技术配置，不代表搜索引擎一定收录或展示 sitelinks。

本次保持首页区块顺序、结构及首页 title/description；保留套餐入口文案、metadata 与 sitemap 状态。根默认 title、robots.txt、全局语言解析、SearchAction 不在改动范围内，不新增 SiteNavigationElement。

### 3.2 核心入口名称与顺序

| 路径 | 中文 | 英文 | 日文 |
|---|---|---|---|
| `/map` | 巡礼地图 | Pilgrimage Map | 巡礼マップ |
| `/posts` | 巡礼攻略 | Pilgrimage Guides | 巡礼ガイド |
| `/plan/start` | AI 规划 | AI Planner | AIプランナー |
| `/city` | 巡礼城市 | Pilgrimage Cities | 都市ガイド |

逐字一致范围：

- 页头、移动抽屉、页脚对应项。
- 首页三张入口卡的标题节点。
- 四个栏目入口页的 H1 与 title 第一段。
- 城市详情面包屑中指向城市索引的层级，UI 与 JSON-LD 同步。

城市详情 H1 保留具体城市名。现值位置：中文 `app/(site)/city/[id]/page.tsx:215`、英文 `app/en/city/[id]/page.tsx:189`、日文 `app/ja/city/[id]/page.tsx:186`。

“全部城市”“打开地图”等上下文 CTA 不受逐字一致规则约束。

页头、抽屉顺序：

```text
map → posts → plan/start → city → pricing
```

页脚产品列顺序：

```text
map → posts → plan/start → city → pricing → anime → resources
```

首页入口卡保持原顺序和结构。作品入口仍为“作品 / Anime / 作品”，保留在页脚与首页，不进入主导航。

### 3.3 URL 协议

下表的 200 指匿名或正常登录态；需要设置密码、管理员强制改密的会话仍执行相应认证跳转。

| 输入或场景 | 约定行为 |
|---|---|
| `/plan/start`，任意语言 Cookie/Accept-Language | 中文 200 |
| `/en/plan/start` | 英文 200 |
| `/ja/plan/start` | 日文 200 |
| `/plan/start?draft=X&locale=en` | 307 → `/en/plan/start?draft=X` |
| `/plan/start?draft=X&locale=ja` | 307 → `/ja/plan/start?draft=X` |
| root `locale` 缺失、非法、空值或为 zh | 中文 200 |
| `/en/plan/start?locale=ja&draft=X` | 英文 200，query 不覆盖路径 |
| `/ja/plan/start?locale=en&draft=X` | 日文 200，query 不覆盖路径 |
| 重复 `locale`、`draft` | 分别取第一项 |
| 首页有草稿 CTA | 直接生成目标语言路径，加 `?draft=`，不加 `locale` |
| 首页无草稿 CTA、公共导航 | 干净的目标语言路径 |
| 任意带参数的 200 入口 | canonical 为当前语言的无参数 URL |
| 私有 `/plan`、`/plan/[id]` | 继续使用无语言前缀路径 |

草稿规则：

- 兼容重定向保留第一项 draft 的解码后原值；重新编码一次，不提前 trim 或截断。
- 目标页传入客户端时执行既有 `slice(0, 500)`。当前规则见 `app/(authed)/plan/start/page.tsx:18`、`:25`。
- 区分“跳转保留完整参数值”和“输入框最多预填 500 个 UTF-16 code units”。
- 兼容跳转消费 `locale`；只承诺保留已支持的 draft，不新增其他参数协议。
- `prefixPath` 分离 query/hash 仅用于路径判断，输出时保留原后缀。
- 三语入口都按最终路径语言同步 `NEXT_LOCALE`，使创建后的无前缀计划页延续语言。

## 4. 四个提交

以下文件清单与命令均供后续实施使用，本轮未执行。

### Commit 1：三语公开入口、旧链接兼容与首页直接导航

**文件**

迁移并修改：

```text
app/(authed)/plan/start/page.tsx
  → app/(plan-start)/plan/start/page.tsx
app/(authed)/plan/start/ui.tsx
  → app/(plan-start)/plan/start/ui.tsx
app/(authed)/plan/start/locale.ts
  → app/(plan-start)/plan/start/locale.ts
```

新增：

```text
app/(plan-start)/layout.tsx
app/en/plan/start/page.tsx
app/ja/plan/start/page.tsx
components/plan/PlanStartPageContent.tsx
lib/seo/planStart.ts
```

修改：

```text
components/layout/prefixPath.ts
components/home/planStartHref.ts
lib/i18n/locales/zh.json
lib/i18n/locales/en.json
lib/i18n/locales/ja.json
```

**改动**

1. 新中文 layout 仅套一层 `<SiteShellPublic locale="zh">`，不另建 html/body。
2. 三个 page 分别固定 zh/en/ja，均声明 `dynamic = 'force-dynamic'`，调用共享服务器内容组件。
3. 中文 page 在解析 searchParams 后优先处理旧 `locale=en|ja` 重定向；该步骤位于会话读取与共享内容渲染之前。不为此入口新增 loading/Suspense 包装。
4. `PlanStartPageContent` 统一读取会话、检查密码状态、解析 draft、渲染客户端。保留当前 `(authed)/layout.tsx:8`、`:11` 的两项检查及其顺序：
   - `needsPasswordSetup` → `/auth/set-password`
   - `isAdmin && mustChangePassword` → `/auth/change-password`
5. `(authed)` 原 layout 保留，为其他页面继续提供原行为；三个公开入口的最终内容均经过共享检查。
6. `prefixPath` 只给精确 `/plan/start` 增加本地化例外。保留 `/plan`、`/plan/abc`、`/plan/start-extra`、`/plan/start/child` 的非本地化行为。当前整个 `/plan` 被排除，见 `components/layout/prefixPath.ts:3`、`:20`。
7. `planStartHref` 改为：

```ts
const base = prefixPath('/plan/start', locale)
return draft ? `${base}?draft=${encodeURIComponent(draft)}` : base
```

8. 三个入口统一向客户端传 `syncLocaleCookie=true`，locale 来自路径绑定。更新旧注释与测试描述。
9. 返回首页链接改为 `prefixPath('/', locale)`。
10. 保留现有创建 API、sessionStorage 交接与 `/plan/${id}` 跳转。当前代码分别位于旧 `ui.tsx:65`、`:80`、`:86`。
11. 修改现有 H1，增加说明段，保留 greeting 与示例，不新增第二个 H1。

**规划入口文案**

| key | 中文 | 英文 | 日文 |
|---|---|---|---|
| `pages.planStart.title` | AI 规划 | AI Planner | AIプランナー |
| `pages.planStart.metaTitle` | AI 规划｜动漫圣地巡礼行程助手 | AI Planner \| Anime Pilgrimage Itineraries | AIプランナー｜アニメ聖地巡礼の旅行プラン |

新增 `pages.planStart.metaDescription`：

- 中文：输入作品、目的地和天数，规划每天的巡礼路线与交通建议。登录后可生成并继续调整行程。
- 英文：Enter your anime, destinations and travel dates to plan daily pilgrimage routes and transport suggestions. Sign in to generate and refine your itinerary.
- 日文：作品・行き先・日数を入力して、日ごとの巡礼ルートと交通の提案をまとめます。ログイン後にプランを作成・調整できます。

新增 `pages.planStart.intro`，本版使用上述对应语言的两句话，显示在输入框上方。

**Metadata**

`buildPlanStartMetadata(locale)` 设置 title、description、OG/Twitter，并复用既有 alternates helper：

- canonical、OG URL 使用当前语言干净路径。
- 三语 hreflang 自包含、互返，x-default 指中文。
- origin 使用既有 site helper，不硬编码生产域名。
- 三个入口继承根 robots，不另写 robots 对象。

现有 alternates 生成方式见 `lib/seo/alternates.ts:20`、`:23`、`:29`；根公开 robots 及 Googlebot 配置见 `app/layout.tsx:28`。Next 对 robots 使用整对象替换，见同机框架 `resolve-metadata.js:176`，因此没有必要添加局部覆盖。

**测试文件**

修改：

```text
tests/plan/start-locale.test.ts
tests/plan/plan-start.test.tsx
tests/layout/prefixPath.test.ts
tests/components/home/HomeHero.test.tsx
tests/components/home/HomeFinalCta.test.tsx
tests/components/home/HomeEntryCards.test.tsx
tests/components/home/HomeShowcasePlan.test.tsx
```

新增：

```text
tests/plan/start-page.test.tsx
tests/seo/plan-start-metadata.test.ts
tests/components/home/planStartHref.test.ts
```

覆盖 URL 协议表、重复参数、特殊字符、500 截断、三语页面绑定、密码检查、匿名发送后登录续接、最终语言 Cookie、返回首页 URL。更新迁移后的 import；现有旧 import 位于 `tests/plan/plan-start.test.tsx:21`、`:22` 与 `tests/plan/start-locale.test.ts:2`。

本提交只更新首页测试中的 URL 协议；入口卡改名断言留到 Commit 2。

**命令**

```bash
npm test -- tests/plan/start-locale.test.ts tests/plan/plan-start.test.tsx tests/plan/start-page.test.tsx tests/seo/plan-start-metadata.test.ts tests/layout/prefixPath.test.ts tests/components/home/planStartHref.test.ts tests/components/home/HomeHero.test.tsx tests/components/home/HomeFinalCta.test.tsx tests/components/home/HomeEntryCards.test.tsx tests/components/home/HomeShowcasePlan.test.tsx
```

**风险与依赖**

主要风险是重复路由、Cookie 未延续、草稿编码变化及旧链接返回流式跳转。

Next 同时存在 HTTP status/Location 跳转路径和流式 meta refresh 路径，分别见框架 [app-render.js:1405](/Users/mac/Desktop/seichigo/node_modules/next/dist/server/app-render/app-render.js:1405)、[make-get-server-inserted-html.js:49](/Users/mac/Desktop/seichigo/node_modules/next/dist/server/app-render/make-get-server-inserted-html.js:49)。单元测试只能验证重定向目标，真实 307 由集成验收确认。

本提交先于导航切换和 sitemap 新入口发布。

### Commit 2：统一导航、栏目名称与加载标题

**文件**

修改：

```text
components/layout/HeaderPublic.tsx
components/layout/HeaderMobileDrawer.client.tsx
components/layout/Footer.tsx

lib/i18n/locales/zh.json
lib/i18n/locales/en.json
lib/i18n/locales/ja.json

app/(site)/city/page.tsx
app/en/city/page.tsx
app/ja/city/page.tsx

app/(site)/city/[id]/page.tsx
app/en/city/[id]/page.tsx
app/ja/city/[id]/page.tsx

app/ja/posts/[slug]/page.tsx

components/map/AnitabiMapPageLazy.tsx
components/map/MapPageSkeleton.tsx
```

**改动**

1. 按固定约定更新 `header.map/posts/plan/city`、`footer.posts/city`，新增 `footer.map/plan`。
2. 更新 `pages.home.v2.entryMapTitle/entryPlanTitle`；英文 `pages.home.v2.entryGuidesTitle` 与 `pages.posts.title` 改为 `Pilgrimage Guides`。
3. Header、抽屉指向 `prefixPath('/plan/start', locale)`，按约定排列。当前位置分别为 `HeaderPublic.tsx:49` 与 `HeaderMobileDrawer.client.tsx:80`。
4. Footer 增加地图与 AI 规划入口并按约定排列，现有产品列位于 `Footer.tsx:33`。
5. 城市索引 H1 改取 `t('header.city', 固定语言)`；三语现有 H1 都在对应 `city/page.tsx:43`。
6. 城市索引 title、OG/Twitter title 改为：

| 语言 | 标题 |
|---|---|
| zh | 巡礼城市｜按目的地查找动漫圣地巡礼路线 |
| en | Pilgrimage Cities \| Anime Travel by Destination in Japan |
| ja | 都市ガイド｜アニメ聖地巡礼の目的地を探す |

7. 城市详情只修改城市索引层级的面包屑标签，UI 与 JSON-LD 都取 `header.city`。位置为：
   - 中文 `app/(site)/city/[id]/page.tsx:157`、`:193`
   - 英文 `app/en/city/[id]/page.tsx:149`、`:175`
   - 日文 `app/ja/city/[id]/page.tsx:146`、`:172`
8. 日文文章面包屑的 `アニメ` 改取 `t('footer.anime', 'ja')`，保留原层级。位置为 `app/ja/posts/[slug]/page.tsx:290`、`:298`。
9. 地图 loading 传入实际 locale；骨架 H1、移动端标题使用 `header.map`，占位说明使用已有 `common.loading`。

地图 loading 可在 `AnitabiMapPageLazy.tsx` 内使用模块级 locale Context，由外层 Provider 提供 locale，命名的 loading 组件读取并传给 Skeleton。保持 `dynamic()` 在模块级；不要在 render 内重建动态组件，也不要假设 loading 回调直接收到业务 props。

日文地图正式标题与 `features/map/anitabi/shared.ts` 无需改动。HomeEntryCards 通过字典生效，不改结构。

**测试文件**

修改：

```text
tests/components/layout/guidesNavLinks.test.tsx
tests/components/layout/HeaderPublic.test.tsx
tests/components/home/HomeEntryCards.test.tsx
tests/components/home/HomeHero.test.tsx
tests/components/home/HomePageTemplate.test.tsx
tests/posts/postsIndex.test.tsx
```

新增：

```text
tests/components/layout/publicNavConsistency.test.tsx
tests/map/map-loading-locale.test.tsx
```

一致性测试分别断言三语明确名称、href、相对顺序；抽屉限定 dialog；首页只比较标题节点。保留首页原有区块顺序测试。

地图测试覆盖**实际 loading fallback 的 locale 传递链**，不能仅直接给 Skeleton 传 locale 后断言标题。栏目 metadata、城市索引 H1 与详情面包屑通过下节集成验收检查。

**命令**

```bash
npm test -- tests/components/layout tests/components/home tests/posts/postsIndex.test.tsx tests/map/map-loading-locale.test.tsx tests/layout/prefixPath.test.ts
```

**风险与依赖**

依赖 Commit 1。重点检查英文长导航的可访问性、抽屉换行、测试误匹配，以及地图动态组件是否因错误重建而重复加载。

### Commit 3：私有计划 noindex 与公开入口 sitemap

**文件**

修改：

```text
app/(authed)/plan/page.tsx
app/(authed)/plan/[id]/page.tsx
app/sitemap.ts
tests/seo/sitemap.test.ts
```

新增：

```text
tests/seo/plan-private-metadata.test.ts
```

**改动**

两个私有 plan page 分别导出：

```ts
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}
```

不增加 `(authed)` 整组 noindex。

现有 `/me`、`/submit`、`/admin` 已有 noindex，分别见对应 layout 第 3、3、4 行；现有响应头规则位于 `next.config.ts:37`。`robots.ts:11` 已有私有前缀 Disallow，因此本方案不声称“所有私有页面都能被抓取到 noindex”。

sitemap 新增六个干净 URL，每个一次：

```text
/plan/start
/en/plan/start
/ja/plan/start
/posts
/en/posts
/ja/posts
```

每组三语互返，包含 x-default。新增条目不写 `lastModified`、`priority`；既有条目不顺带清理。当前静态条目清单位于 `app/sitemap.ts:49`。

**测试**

验证：

- 两个私有 page 的 metadata。
- 六个新增 URL 唯一、无参数，alternates 正确。
- sitemap 不包含私有计划列表或详情。
- 保留严格数据源失败传播测试，现有用例见 `tests/seo/sitemap.test.ts:53`。

测试导入私有页面时 mock 依赖，不调用真实数据库或创建计划。

**命令**

```bash
npm test -- tests/seo/sitemap.test.ts tests/seo/plan-private-metadata.test.ts tests/seo/robots-share.test.ts tests/seo/alternates.test.ts
```

**风险与依赖**

依赖 Commit 1，建议在 Commit 2 后合并。

`/plan` 当前是跳转入口，并可能创建计划：`app/(authed)/plan/page.tsx:14` 匿名跳登录，第 18 行跳已有计划，第 20 行创建新计划。不能用登录态访问它进行“无副作用探测”，也不能通过跟随登录跳转后的 noindex 来证明源页面 metadata。

详情权限检查保留，见 `app/(authed)/plan/[id]/page.tsx:13`、`:17`。

### Commit 4：纠正实体引用，落地品牌与测量文档

**文件**

修改：

```text
lib/seo/globalJsonLd.ts
```

新增：

```text
tests/seo/global-jsonld.test.ts
docs/superpowers/plans/2026-09-14-sitelinks-implementation.md
```

**改动**

1. 删除 Organization `sameAs` 中错误的 `https://github.com/seichigo`，当前位于 `lib/seo/globalJsonLd.ts:41`。
2. 保留现有 X 项，不新增 GitHub 仓库身份声明。
3. 页脚源码链接保留，现值见 `components/layout/Footer.tsx:61`。
4. 实施文档记录最终范围、验证证据、发布日期、提交 SHA、部署版本、基线与回滚步骤。
5. 记录三语外发内容的首次品牌提及规则：

| 语言 | 首次提及 |
|---|---|
| 中文 | SeichiGo（动漫圣地巡礼地图与 AI 规划） |
| 日文 | SeichiGo（アニメ聖地巡礼マップと AI プランナー） |
| 英文 | SeichiGo (anime pilgrimage map and AI planner) |

站内 title 模板继续使用 `%s | SeichiGo`。外联规则由既有记忆维护者同步到明确的外联守则位置，实施记录写明去向。

SearchAction 留待独立任务，不设本项目 Commit 5。

**测试与命令**

断言 Organization 中错误 GitHub 项已删除、未新增源码仓库项，其他身份字段保持预期。

```bash
npm test -- tests/seo/global-jsonld.test.ts
```

此提交可独立回滚。删除错误引用不等于已重新验证其他外部账号归属。

## 5. 集成验收

本节为实施完成后的验收要求，不是本轮执行记录。

### 5.1 工程检查

```bash
npm run typecheck:app
npm run typecheck:tests
npm run check:line-budget
npm run cf:build
```

`next.config.ts:25` 设置了 `ignoreBuildErrors:true`，构建通过不能替代 typecheck。命令定义见 `package.json:10`、`:15`、`:16`、`:30`。

使用既有 Cloudflare/OpenNext 构建链。默认 build 脚本具有迁移分支，见 `scripts/build-app.mjs:29`、`:43`，不作为随手执行的无副作用检查。

保留全局语言相关现有测试作为回归检查，无需修改测试文件：

```bash
npm test -- tests/i18n/resolveRequestLocale.test.ts tests/middleware/i18n-redirect.test.ts tests/components/LanguageSwitcher.test.tsx
```

### 5.2 页面、导航与语言

1. 三个干净 start 入口匿名返回 200；每页一个公共壳、一个 main、一个起始页 H1。
2. 保留 immersive 行为：公共页头、页脚在生成结构中存在，浏览器中隐藏；起始页自己的 H1、说明和返回首页入口正常显示。
3. 使用冲突 Cookie、Accept-Language，分别检查普通 UA 与 Googlebot UA；路径绑定的正文、登录弹窗、返回首页链接、metadata 语言保持正确。
4. 检查四个栏目 title 第一段、H1、导航与页脚名称；地图同时检查 loading 和完成加载两个阶段。
5. 城市详情 H1 仍是城市名，面包屑城市索引层级与 JSON-LD 一致。
6. 桌面及移动抽屉检查名称、href、顺序；英文长标签可以完整访问。
7. 首页卡片与区块顺序保持原状；套餐入口保持原行为。

既有根 HTML 初始 `lang="zh"`，见 `app/layout.tsx:62`；客户端由 `HtmlLangSync.tsx:15` 按路径同步。本次不改根 layout，不把“英日原始 HTML 的根 lang 已本地化”列为交付成果。正文及 metadata 的路径语言一致性须独立核验，客户端最终 lang 同样检查。

### 5.3 Metadata 与 sitemap

1. 三个 start 的 title、description、OG/Twitter 使用对应语言。
2. canonical 不含 draft、locale；hreflang 自包含、互返，x-default 指中文。
3. origin 按 `SITE_URL` 与既有 helper 配置验收，见 `lib/seo/site.ts:4`。预览请求域名不必等于 canonical 域名。
4. 公开入口的应用层 robots、Googlebot meta、X-Robots-Tag 不施加 noindex；区分平台统一的预览防索引头。
5. 检查完整响应和最终 DOM，避免遗漏流式 metadata。
6. sitemap 包含六个新增规范 URL，各一次；无参数入口、私有计划。
7. 使用已有测试计划检查所有者详情 200 的 noindex；匿名及非所有者行为保持原样。

### 5.4 草稿与重定向

预览首跳检查示例：

```bash
SITE_PREVIEW='https://实际预览域名'

curl -sS -D - "$SITE_PREVIEW/plan/start"
curl -sS -D - "$SITE_PREVIEW/en/plan/start"
curl -sS -D - "$SITE_PREVIEW/ja/plan/start"

curl -sS -D - --get \
  --data-urlencode 'draft=東京 5 日間 & 京都' \
  --data-urlencode 'locale=ja' \
  "$SITE_PREVIEW/plan/start"

curl -sS "$SITE_PREVIEW/sitemap.xml"
```

验收要求：

- 旧链接首跳必须是 307，Location 指向对应语言路径，消费 locale。
- Location 中 draft 解码后逐字相同；不同空格编码形式不算内容变化。
- 不使用 `-L` 隐藏首跳；`200 + meta refresh` 不算 307 验收通过。
- 三语首页 Hero 与 FinalCta 提交后，直接进入目标语言路径，无 root 兼容中间跳转。除地址栏外，核对导航记录。
- 覆盖特殊字符、重复参数、空值及超过 500 的输入；分别验证重定向保留值与最终预填截断。
- 完成“首页输入 → start → 登录 → 创建 → 详情续接”流程，检查最终 Cookie 与详情语言。
- 覆盖已有登录态、密码设置、管理员强制改密、登录失败重试、创建失败重试与重复点击。

若首跳检查失败，Commit 1 尚未完成；必须修正后再发布依赖它的导航和 sitemap。

## 6. 基线口径与上线测量

### 6.1 当前已提供的数据

以下来自 Claude 提供的 GSC 数据与观察，本轮未联网复核。

| 指标 | 口径与数据 |
|---|---|
| 移动端前窗 | 2026-08-17 至 08-26，10 天；85 点击 / 362 曝光 |
| 移动端后窗 | 2026-08-28 至 09-12，16 天；24 点击 / 320 曝光 |
| 两窗共同筛选 | page 精确为 `https://seichigo.com/`；query 为“圣地巡礼”；device=MOBILE；全部国家 |
| 桌面端 | Claude 提供同查询、页面口径 CTR 约 21% → 6.9%；原始计数待记录 |
| 品牌词 | 精确 query `seichigo`；2026-08-17 至 09-13；曝光 12、点击 7 |
| 排名 | GSC 平均排名 3.9；一次实搜自然结果第 3，分别记录 |

按原始计数，移动端两窗 CTR 分别为 **23.48%** 与 **7.50%**。报告应采用这些值或明确的四舍五入值，不继续把 24/320 写成精确的 7%。

原两窗不等长，只作为历史观察。不能从现有汇总计数推算等长窗口结果。

### 6.2 正式基线

发布前补齐：

- 明确实际发布日期 D。
- 取 D 前最近一个数据完整的连续 14 天窗口，记录起止日期。
- 固定 page、精确 query、device、country、Search type；移动端与桌面端分开。
- 保存点击、曝光、CTR、平均排名及导出记录。
- 品牌词单独记录页面、设备、国家与 Search type 范围；现有 12 次曝光样本不用于稳定的效果推断。
- 重算历史前后对比时，同样使用完整、等长 14 天窗口，并记录所有筛选条件。

未获得重算数据前，实施文档标记“待补”，不制造正式基线数字。

### 6.3 上线后测量

观察窗口三至六周，品牌样本不足则延长。

每周固定设备、viewport、语言、地区设置、登录状态及实际出口地区，检查泛查询与品牌查询，保存截图并记录：

- 是否出现附加链接。
- 链接目标 URL 与标签。
- 搜索结果顶部距页面顶部的位置。
- 同次观察的自然排序与其他搜索模块占位。

GSC 使用相同筛选与完整、等长窗口比较。先确认入口发现、抓取、canonical 与索引状态，再观察 sitelinks 和 CTR。

不将一次实搜排序与 GSC 平均排名混用，不把知识面板占位认定为全部 CTR 变化的已证实原因。本次结构改造不承诺展示 sitelinks，也不承诺抵消其他搜索模块的屏幕占位。

## 7. 回滚与完成标准

回滚以记录的提交与部署版本为单位：

- **路由、语言或草稿故障：**同步回滚依赖该路由的导航、首页 helper 与 sitemap 改动。不能先移除英日路由，留下入口链接。
- **导航文案或布局问题：**可回滚 Commit 2，保留三语入口和旧链接兼容。
- **sitemap 或私有 metadata 问题：**可独立回滚 Commit 3。
- **实体引用问题：**可独立回滚 Commit 4 的代码改动，保留实施记录。

工程回滚可以恢复站点行为，搜索引擎已抓取结果不保证同步恢复。

完成标准是：四个提交的必要检查通过，预览验收有证据，首跳与草稿流程实际验证，另一次独立审查确认没有未解决的阻断。当前签字表示同意这份实施方案，不表示代码已经实施、测试已经通过或搜索效果已经产生。

Astra 签字：同意（已纳入本轮代码核实所需的小修正；实施与运行验收待执行）。
---

## Claude 附录：签字与基线补充（2026-09-14）

### 等长窗口基线（GSC，page = `https://seichigo.com/`，query 精确「圣地巡礼」，全部国家，Web）

| 设备 | 前窗 2026-08-13 至 08-26（14 天） | 后窗 2026-08-29 至 09-11（14 天） |
|---|---|---|
| 移动 | 108 点击 / 477 曝光，CTR 22.6%，平均排名 5.2 | 19 / 287，CTR 6.6%，平均排名 3.8 |
| 桌面 | 47 / 227，CTR 20.7%，平均排名 5.2 | 12 / 182，CTR 6.6%，平均排名 3.9 |
| 平板 | 0 / 10 | 1 / 8 |

§6.1 里不等长窗口的桌面端原始计数补记：08-17 至 08-26 为 37 / 175（21.1%），08-28 至 09-12 为 14 / 204（6.9%）。§6.2 要求的"发布前最近 14 天窗口"仍按发布日 D 另取一次。

### 对 Astra 小修正的确认

- 城市详情 H1 保留城市名，只改面包屑城市索引层级：同意。
- `tests/components/home/HomeFinalCta.test.tsx`、`tests/posts/postsIndex.test.tsx` 补入对应提交：同意。
- 地图 loading 占位本地化：同意目标；实现方式不强制模块级 Context，执行者可选等价做法，验收只看 loading 与完成两阶段的 H1 语言。
- 首跳以真实 HTTP 307 为准，`200 + meta refresh` 不通过：同意。

### 执行约束（项目既有规则）

- 实施在独立 worktree `feat/sitelinks-nav` 上进行，主目录只做合并与部署。
- 代码改动派给 opencode（前端 kimi k3 max，其余 glm-5.3 max），按四个提交逐个交付；每个提交完成后由 Claude 审阅并跑该提交的测试命令，再进入下一个。
- 预览环境自测并经负责人确认后再部署；部署走 predeploy guard 与 deploy ledger。

Claude 签字：同意。本方案为双方共识的最终实施方案；代码尚未实施，效果承诺以 §3.1 与 §6.3 的表述为准。
